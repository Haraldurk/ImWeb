# Monty Bridge — Phase 3.0 Design Spec
**Date:** 2026-06-17
**Status:** Approved for implementation

---

## Context

Phase 2 built the full bridge architecture in mock form: a Python WebSocket server emitting synthetic saccade/confidence/prediction_error signals, a JS client receiving and mapping them to `buffer.fs1`, `buffer.scatter`, and `buffer.capture`. Everything from the transport layer to the v1 JSON schema to the per-param slew was validated against real ImWeb output.

Phase 3.0 replaces the mock signal generator with real Monty inference. The rest of the architecture — `MontyBridge.js`, the v1 schema, the buffer param mapping, the slew — is unchanged. Phase 3.0 ships `--live` mode in `monty-bridge.py`.

**Aesthetic:** Monty is trained on YCB household objects (mugs, bowls, tools). It will never recognise what it sees in ImWeb footage — abstract textures, faces, video noise. It will be perpetually bewildered: continuous saccade movement, persistently low confidence, frequent prediction-error spikes. This is intentional. The instrument is a brain dreaming household objects at your footage. Maximum novelty, maximum engagement.

---

## Scope

Changes to exactly two files:

| File | Change |
|---|---|
| `monty-bridge.py` | Add `--live` mode: load model, run Monty episode per captured frame, emit real signals |
| `src/io/MontyBridge.js` | Add binary frame send: seed on `onopen`, capture on each `buffer.capture` trigger |

No changes to `MontyBridge.js` connection logic, the v1 JSON schema, `ParameterSystem.js`, or any render pipeline code.

---

## Monty Model — Phase 3.0

- **Model**: `supervised_pre_training_base` from `~/tbp/results/monty/pretrained_models/pretrained_ycb_v12/`
- **Environment**: `SaccadeOnImageFromStreamEnvironment(patch_size=64)`
- **Episode length**: 50 steps (`--steps` flag, default 50)

At startup, print `LMs: {len(model.learning_modules)}` so the actual column count is visible. `supervised_pre_training_base` is likely single-LM; multi-LM aggregation becomes a real question at Phase 4.

---

## File Format — Scene Folder

**Single scene, overwritten per capture.** `switch_to_object` reads from disk every call — no caching — so overwriting is safe and correct.

```
~/tbp/data/worldimages/world_data_stream/
└── scene_0/
    ├── rgb_0.png       ← 320×240 RGB PNG from ImWeb, overwritten each capture
    └── depth_0.data    ← zeros array (H×W float32), written once at startup
```

Create `scene_0/` and write `depth_0.data` at bridge startup. On each accepted frame: overwrite `rgb_0.png`, then call `env.switch_to_object(0, 0)`, then run the episode.

---

## Python `monty-bridge.py --live` Architecture

Three components in one process:

```
asyncio event loop (main thread)
  ├─ WebSocket server (port 8765)
  │    ├─ text frames  → JSON → broadcast to JS clients   [unchanged from Phase 2]
  │    └─ binary frames → PNG bytes → governor → frame_queue
  └─ signal drain loop: drains signal_queue → broadcast JSON to JS clients

Monty thread (background, blocking)
  ├─ waits on frame_queue.get()
  ├─ writes scene_0/rgb_0.png
  ├─ calls env.switch_to_object(0, 0)
  └─ runs N steps: model.step() → extract state → signal_queue.put_nowait()
```

### Queue design

- `frame_queue = queue.Queue(maxsize=1)` — latest-wins. Each new accepted frame replaces the waiting one. `put_nowait()` + catch `queue.Full` → discard old, put new. Monty always processes the most recent moment, never a backlog.
- `signal_queue = queue.Queue()` — unbounded. Each Monty step produces one item. The asyncio drain loop clears it fast.

### Governor

Static rate limiter. Drops incoming binary frames that arrive within `--min-interval` seconds (default 0.5) of the last accepted frame.

```python
_last_accepted = 0.0

def governor_accept(now: float, min_interval: float) -> bool:
    global _last_accepted
    if now - _last_accepted >= min_interval:
        _last_accepted = now
        return True
    return False
```

No adaptive behaviour in Phase 3.0.

### Bootstrap seed

On first WS connection open, the JS client sends one binary frame immediately (before any `buffer.capture` fires). This closes the loop from cold start — Monty gets input, generates signals, those signals drive capture, capture generates more input.

---

## State Extraction (per Monty step)

After each `model.step(observations, state)` call:

### Saccade

```python
H, W = env.current_rgb_image.shape[:2]
# env.current_loc is [y, x] (numpy/image convention)
# saccade[0] = x (horizontal), saccade[1] = y (vertical)
saccade_x = env.current_loc[1] / W   # horizontal axis
saccade_y = env.current_loc[0] / H   # vertical axis
```

**Axis ordering is explicit.** `env.current_loc` uses numpy convention `[row, col]` = `[y, x]`. The Phase 2 mapping uses `saccade[0]` as the horizontal axis driving `buffer.fs1` (frame position). Swapping would silently produce the wrong mapping.

### Confidence (mean across LMs — thousand-brains voting)

```python
confidences = [
    lm.current_mlh["evidence"] / max(lm.object_evidence_threshold, 1)
    for lm in model.learning_modules
]
confidence = float(np.mean(confidences))
confidence = max(0.0, min(1.0, confidence))
```

**Design choice documented:** `np.mean` reads as "consensus across columns" — all columns must agree for confidence to be high. The alternative (`np.max`) would mean "at least one column is confident." Mean is correct for the thousand-brains voting interpretation. Phase 4 may want to make this configurable (`--confidence-agg mean|max`).

### Prediction error (max across LMs — surprise is non-distributive)

```python
threshold = max(model.learning_modules[0].object_evidence_threshold, 1)
deltas = [
    lm.previous_mlh["evidence"] - lm.current_mlh["evidence"]
    for lm in model.learning_modules
    if lm.previous_mlh is not None
]
raw = max(deltas, default=0)
prediction_error = max(0.0, min(1.0, raw / threshold))
```

**Aggregation is max, not mean.** One column getting startled is the whole instrument feeling surprise — surprise is non-distributive across cortical columns. Mean would dilute genuine novelty signals.

**Implementation note:** also check `lm.buffer.stats` during implementation — `_append_mlh_prediction_error_to_stats()` may expose a cleaner accessor than the delta proxy. The delta formula is the fallback if stats are not accessible outside the logging path.

---

## ImWeb `MontyBridge.js` Changes

Two additions to the existing class:

### 1. Seed frame on connect (`onopen`)

```js
ws.onopen = () => {
  this._backoff = 1000;
  this._sendSeedFrame();           // ← new
  this._updateBadge('connected');
};

_sendSeedFrame() {
  if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;
  canvas.getContext('2d');  // blank black frame is valid
  canvas.toBlob(blob => {
    if (!blob) return;
    blob.arrayBuffer().then(buf => {
      if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(buf);
    });
  }, 'image/png');
}
```

### 2. Capture frame on `buffer.capture` trigger

Wire in `main.js` after MontyBridge instantiation:

```js
ps.get('buffer.capture').onChange(() => {
  if (!montyBridge.active) return;
  montyBridge.sendCaptureFrame(renderer, pipeline.output);
});
```

New method on `MontyBridge`:

```js
sendCaptureFrame(renderer, renderTarget) {
  if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
  // WebGL readback at 320×240
  const W = 320, H = 240;
  const pixels = new Uint8Array(W * H * 4);
  renderer.readRenderTargetPixels(renderTarget, 0, 0, W, H, pixels);
  // Flip Y (WebGL origin is bottom-left)
  const flipped = new Uint8Array(W * H * 4);
  for (let row = 0; row < H; row++) {
    flipped.set(pixels.slice((H - 1 - row) * W * 4, (H - row) * W * 4), row * W * 4);
  }
  // Encode to PNG via canvas
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');
  const imgData = new ImageData(new Uint8ClampedArray(flipped.buffer), W, H);
  ctx.putImageData(imgData, 0, 0);
  canvas.toBlob(blob => {
    if (!blob) return;
    blob.arrayBuffer().then(buf => {
      if (this._ws?.readyState === WebSocket.OPEN) this._ws.send(buf);
    });
  }, 'image/png');
}
```

> **Note:** `renderer` and `pipeline.output` (the current render target) are passed in at call time — not stored on `MontyBridge` — so the bridge has no dependency on the renderer or pipeline at construction.

---

## WS Message Protocol (binary direction)

Binary frames (JS → Python): raw PNG bytes, no framing header. The server discriminates by `isinstance(message, bytes)`. Minimum viable; no versioning needed on the upload direction.

Text frames (Python → JS): unchanged v1 JSON schema. `source: "live"` for Phase 3.0.

---

## Invocation

```bash
# Phase 2 mock (unchanged):
python monty-bridge.py

# Phase 3.0 live:
python monty-bridge.py --live

# Phase 3.0 with tuning:
python monty-bridge.py --live --steps 30 --min-interval 0.3
```

`--live` flag now runs real Monty instead of exiting with the Phase 2 stub message.

---

## Phase 4 Boundary

- Replace `--min-interval` governor with the adaptive version (tighten when prediction_error is low, loosen when high)
- Add `--model self` mode: `MontyForNoResetEvidenceGraphMatching`, learns from buffer frames over session
- Add `--confidence-agg mean|max` flag
- Expose `monty.saccade_x`, `monty.confidence`, `monty.prediction_error` as named controller sources in `ControllerManager` (any param routable to Monty signals through badge/popover UI)

---

## Verification

1. `python monty-bridge.py --live` starts without error; prints `LMs: N` and `Monty bridge listening on ws://localhost:8765 (live mode)`
2. Connect from ImWeb → seed frame triggers first Monty episode; signals flow immediately
3. `source: "live"` appears in status badge
4. `buffer.fs1` sweeps at the saccade rate (50 steps × step time, not the 21s sine)
5. `buffer.scatter` stays high (YCB model perpetually uncertain about ImWeb footage)
6. `buffer.capture` fires on prediction_error spikes, filling the buffer with new frames
7. Closed loop: captures generate new Monty episodes, which generate more captures
8. Governor visible: rapid manual captures don't flood Monty — only ~2/sec accepted
9. Disconnect Python → badge turns grey; params freeze; reconnect resumes
