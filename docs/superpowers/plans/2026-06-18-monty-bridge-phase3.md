# Monty Bridge — Phase 3.0 Implementation Plan
**Date:** 2026-06-18
**Design spec:** `docs/superpowers/specs/2026-06-17-monty-bridge-phase3-design.md` (commit b291e9a)
**Status:** Ready to implement

---

## Timing Validation

Measured `SaccadeOnImageFromStreamEnvironment._observations()` overhead:

| Metric | Value |
|---|---|
| Per observation | 0.02 ms |
| 50-saccade episode | ~1 ms |
| 200-saccade episode | ~5 ms |
| Throughput | 42,816 obs/sec |

**Verdict:** env overhead is negligible. The file-drop hybrid will feel live with no rate concern. JS-side slew on `buffer.fs1` is purely aesthetic smoothing, not compensating for latency.

---

## Scope

Two files changed. No schema changes, no new params, no pipeline changes.

| File | What changes |
|---|---|
| `monty-bridge.py` | Add `--live` mode: model load, frame queue, Monty thread, signal extraction |
| `src/io/MontyBridge.js` | Add `_sendSeedFrame()` on connect, `sendCaptureFrame()` on `buffer.capture` |

Plus one wiring line in `src/main.js` (the `buffer.capture` onChange callback).

---

## Task Breakdown

### Task 1 — Python: scaffold `--live` argument and model loading

Add to `monty-bridge.py`:

1. `argparse` flags: `--live`, `--steps N` (default 50), `--min-interval S` (default 0.5)
2. When `--live`:
   - Create scene folder: `~/tbp/data/worldimages/world_data_stream/scene_0/`
   - Write `depth_0.data` (zeros, float32, H×W) once at startup
   - Load `supervised_pre_training_base` from `~/tbp/results/monty/pretrained_models/pretrained_ycb_v12/`
   - Instantiate `SaccadeOnImageFromStreamEnvironment(patch_size=64)`
   - Print `LMs: {n}` so column count is visible
3. When not `--live`: existing Phase 2 mock behaviour unchanged

**Verify:** `python monty-bridge.py --live` prints `LMs: N` and starts WS server without error.

### Task 2 — Python: frame queue + governor + Monty thread

1. `frame_queue = queue.Queue(maxsize=1)` — latest-wins semantics (on Full: discard old, put new)
2. `signal_queue = queue.Queue()` — unbounded, drained by asyncio loop
3. Governor: drop binary frames arriving within `--min-interval` of last accepted
4. WS handler: `isinstance(message, bytes)` → governor → `frame_queue`
5. Background thread (`threading.Thread(daemon=True)`):
   - `frame_queue.get()` blocks until frame available
   - Write `scene_0/rgb_0.png` (PIL Image from bytes)
   - `env.switch_to_object(0, 0)` to reload
   - Run `--steps` iterations of `model.step()` per episode
6. Asyncio drain loop: pull from `signal_queue`, broadcast JSON to connected WS clients

**Key detail:** the Monty thread is blocking (model.step is CPU-bound). The asyncio event loop stays responsive because the thread communicates only via queues.

### Task 3 — Python: state extraction per step

After each `model.step(observations, state)`:

1. **Saccade:** `env.current_loc` is `[y, x]` (numpy convention). Normalise:
   - `saccade_x = env.current_loc[1] / W` (horizontal → `buffer.fs1`)
   - `saccade_y = env.current_loc[0] / H` (vertical → future use)

2. **Confidence:** mean evidence across LMs, clamped [0, 1]:
   ```python
   confidences = [lm.current_mlh["evidence"] / max(lm.object_evidence_threshold, 1)
                   for lm in model.learning_modules]
   confidence = np.clip(np.mean(confidences), 0.0, 1.0)
   ```

3. **Prediction error:** max evidence delta across LMs, clamped [0, 1]:
   ```python
   deltas = [lm.previous_mlh["evidence"] - lm.current_mlh["evidence"]
             for lm in model.learning_modules if lm.previous_mlh is not None]
   prediction_error = np.clip(max(deltas, default=0) / threshold, 0.0, 1.0)
   ```
   Also check `lm.buffer.stats` for a cleaner accessor — use delta as fallback.

4. Emit to `signal_queue` using existing v1 schema with `source: "live"`:
   ```json
   {
     "source": "live",
     "step": N,
     "saccade": [saccade_x, saccade_y],
     "confidence": 0.0–1.0,
     "prediction_error": 0.0–1.0
   }
   ```

**Verify:** connect with `websocat ws://localhost:8765`, send a PNG binary frame, confirm JSON signals arrive with `source: "live"`.

### Task 4 — JS: seed frame on connect

Add `_sendSeedFrame()` to `MontyBridge.js`:

1. Create 320×240 canvas, encode to PNG blob, send as binary over WS
2. Call from `ws.onopen` after existing `_backoff = 1000` line
3. Blank black frame is valid — Monty will saccade across it and generate initial signals

**Verify:** open browser DevTools Network tab, confirm binary frame sent on WS connect.

### Task 5 — JS: capture frame on `buffer.capture`

Add `sendCaptureFrame(renderer, renderTarget)` to `MontyBridge.js`:

1. `renderer.readRenderTargetPixels()` at 320×240
2. Flip Y (WebGL bottom-left origin → top-left)
3. Canvas → PNG blob → binary WS send
4. Guard: early return if WS not open or `!this.active`

Wire in `main.js` after MontyBridge instantiation:
```js
ps.get('buffer.capture').onChange(() => {
  if (!montyBridge.active) return;
  montyBridge.sendCaptureFrame(renderer, pipeline.output);
});
```

**Verify:** trigger `buffer.capture` manually, confirm binary frame appears in Python console log.

### Task 6 — Integration test: closed loop

1. Start `python monty-bridge.py --live --steps 50`
2. Open ImWeb at localhost:5173
3. Confirm:
   - Seed frame triggers first episode immediately
   - `buffer.fs1` sweeps with saccade (not the 21s sine)
   - `buffer.scatter` stays high (YCB model confused by ImWeb footage)
   - `buffer.capture` fires on prediction_error spikes → new frames → new episodes
   - Governor limits to ~2 frames/sec accepted
   - Status badge shows `source: "live"`
   - Disconnect Python → badge greys, params freeze; reconnect resumes

---

## Implementation Order

```
Task 1 (model load)  →  Task 2 (queues/thread)  →  Task 3 (extraction)
                                                          ↓
Task 4 (seed frame)  →  Task 5 (capture frame)  →  Task 6 (integration)
```

Tasks 1–3 are Python-only, can be developed and tested with `websocat` before touching JS. Tasks 4–5 are JS-only, small additions to existing MontyBridge.js. Task 6 is manual verification.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| `model.step()` blocks longer than expected | Governor already rate-limits input; thread isolation keeps WS responsive. Increase `--min-interval` if needed. |
| `lm.current_mlh` or `lm.previous_mlh` missing/None on first step | Guard with `if lm.previous_mlh is not None` (already in spec). Emit confidence=0, prediction_error=0 for guarded steps. |
| `env.switch_to_object` caches image despite file overwrite | Timing test confirms it re-reads from disk. No caching. |
| WebGL readback stalls render loop | 320×240 readback is <1 ms. Only fires on `buffer.capture` trigger, not every frame. |
| `__new__` bypass in timing test hid a constructor dependency | Live mode uses normal constructor. Any missing attr will surface at Task 1 and be fixed then. |

---

## What's NOT in Phase 3.0

- Adaptive governor (Phase 4)
- Self-supervised model / `--model self` (Phase 4)
- `--confidence-agg mean|max` flag (Phase 4)
- Named Monty controller sources in ControllerManager (Phase 4)
- Multi-LM aggregation strategy changes (Phase 4)
