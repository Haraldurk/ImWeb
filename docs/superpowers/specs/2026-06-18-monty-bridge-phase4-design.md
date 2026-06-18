# Monty Bridge — Phase 4 Design Spec
**Date:** 2026-06-18 (revised)
**Status:** Ready for implementation
**Depends on:** Phase 3.0 (commit 02cf1b5)

---

## Context

Phase 3.0 shipped the live Monty inference loop: `monty-bridge.py --live` loads a pretrained YCB model, accepts PNG frames from ImWeb over WebSocket, runs saccade episodes, and emits `saccade`, `confidence`, `prediction_error` signals. The signals drive `buffer.fs1`, `buffer.scatter`, and `buffer.capture` through hardcoded mappings in `MontyBridge._onMessage()`.

**Phase 3.0 limitation:** confidence and prediction_error are always 0. The sensor module feature pipeline gates on `valid_signals = valid_sn and valid_pc` (line 90 of `ObservationProcessor._extract_and_add_features`). With flat depth, the point cloud is a degenerate plane — surface normals are valid but principal curvatures are undefined (`valid_pc=False`), so `use_state=False` and the LM ignores all observations. This is model-independent: both pretrained and self-supervised variants use the same sensor module.

Phase 4 fixes this and opens up the signal routing:

1. **Luminance-as-depth** — prerequisite that makes the feature pipeline produce valid signals
2. **Named Monty controller sources** — any parameter driven by any Monty signal
3. **Adaptive governor** — responsive rate limiting
4. **Self-supervised mode** — the brain learns from what it sees
5. **Confidence aggregation flag** — mean vs max across LMs

---

## Feature 0: Luminance-as-Depth (Prerequisite)

### The problem

Monty's feature pipeline requires valid 3D geometry to produce `use_state=True` percepts. The chain:

```
depth → DepthTo3DLocations → obs_3d[x,y,z,semantic_id]
  → semantic_id > 0 → on_object=True ✓
  → TLS surface normal → valid_sn=True ✓ (flat plane has well-defined normal)
  → principal_curvatures → valid_pc=False ✗ (flat plane has degenerate curvature)
  → use_state = on_object AND (valid_sn AND valid_pc) = False
  → LM ignores percept → zero evidence → zero confidence/PE
```

This blocks ALL downstream features — pretrained and self-supervised alike.

### The fix

Convert each incoming RGB frame to grayscale and use luminance as a depth proxy:

```python
gray = np.mean(rgb_array, axis=2)              # H×W, range 0–255
depth = 0.5 + (gray / 255.0)                    # H×W, range 0.5–1.5
depth.astype(np.float32).tofile(depth_path)
```

Bright regions → depth 1.5 (closer), dark regions → depth 0.5 (farther). This creates:
- Non-zero depth everywhere → `on_object=True`
- Varied depth surface → valid TLS surface normals → `valid_sn=True`
- Image-driven curvature from brightness contours → `valid_pc=True`
- `use_state=True` → features flow into LM → evidence accumulates

The depth topology directly follows the visual structure: bright spots create bumps, dark areas create valleys. Curvature features become a proxy for image texture, which creates a meaningful relationship between visual content and Monty's 3D feature space. Both `rgba`/`hsv` features (pure RGB) and curvature features (depth-derived) carry information.

### Implementation

In `_monty_thread`, after saving `rgb_0.png` and before `switch_to_scene(0)`:

```python
rgb_array = np.array(img)  # H×W×3
gray = np.mean(rgb_array, axis=2)
depth = (0.5 + gray / 255.0).astype(np.float32)
depth.tofile(str(depth_path))
```

The static `depth_0.data` written at startup becomes a fallback only (for the seed frame). Each subsequent frame overwrites it with luminance-derived depth.

### Files changed

| File | Change |
|---|---|
| `monty-bridge.py` | Generate luminance-as-depth in `_monty_thread` per frame |

---

## Feature 1: Named Monty Controller Sources

### What
Four new controller types in the badge/popover UI:

| Controller type | Badge label | Signal source | Range |
|---|---|---|---|
| `monty-saccade-x` | `MX` | saccade[0] — horizontal gaze position | 0–1 |
| `monty-saccade-y` | `MY` | saccade[1] — vertical gaze position | 0–1 |
| `monty-confidence` | `MC` | confidence — how sure the brain is | 0–1 |
| `monty-pe` | `MP` | prediction_error — how surprised the brain is | 0–1 |

Any continuous parameter can be routed to any Monty signal by right-clicking the controller badge → selecting one of these four types. The parameter's min/max range maps to the 0–1 signal via `setNormalized()`.

### Architecture

**MontyBridge stores latest signal values as a mutable object:**
```js
// In constructor — allocated once, mutated in place, never replaced
this._signal = { sx: 0.5, sy: 0.5, confidence: 0, pe: 0 };
```

**Critical: `_signal` is mutated in place, never reassigned.** ControllerManager holds a reference to this object. If `_onMessage()` ever does `this._signal = { ... }` instead of `Object.assign(this._signal, { ... })`, the controller reference goes stale. The update in `_onMessage()`:

```js
this._signal.sx = msg.saccade[0];
this._signal.sy = msg.saccade[1];
this._signal.confidence = msg.confidence;
this._signal.pe = msg.prediction_error;
```

Direct property writes — no object replacement.

**Disconnected-state behaviour:** when the bridge disconnects or is offline, `_signal` retains its last-known values. Parameters routed to Monty sources freeze at the last received signal. This is intentional — a hard reset to initial values (0.5, 0.5, 0, 0) would cause a visible parameter jump at disconnect, which is worse than smooth freeze. The status badge already turns grey on disconnect, giving the user visual feedback.

**ControllerManager reads from MontyBridge:**
```js
// In tick(), alongside the rand1/rand2/rand3 block:
if (ct === 'monty-saccade-x')  p.setNormalized(this._montySignal.sx);
if (ct === 'monty-saccade-y')  p.setNormalized(this._montySignal.sy);
if (ct === 'monty-confidence') p.setNormalized(this._montySignal.confidence);
if (ct === 'monty-pe')         p.setNormalized(this._montySignal.pe);
```

The ControllerManager gets a reference to MontyBridge's `_signal` object at wiring time (not a copy). MontyBridge writes at WS message rate; ControllerManager reads at frame rate.

**UI additions — `index.html` context menu:**
Add 4 buttons after the `pen-pressure` group, in a new "Monty" section:
```html
<button class="menu-item" data-ctrl="monty-saccade-x">Monty Saccade X</button>
<button class="menu-item" data-ctrl="monty-saccade-y">Monty Saccade Y</button>
<button class="menu-item" data-ctrl="monty-confidence">Monty Confidence</button>
<button class="menu-item" data-ctrl="monty-pe">Monty Pred.Error</button>
```

**Badge label rendering in UI.js:**
The badge shows a 2-3 character abbreviation. Add to the existing type→label map:
```js
'monty-saccade-x': 'MX',
'monty-saccade-y': 'MY',
'monty-confidence': 'MC',
'monty-pe': 'MP',
```

### Interaction with existing buffer mappings

The hardcoded buffer mappings in `_onMessage()` remain:
- `buffer.fs1 ← saccade[0] × (frameCount - 1)` — immediate, no controller needed
- `buffer.scatter ← (1 - confidence) × 32` — immediate
- `buffer.capture ← prediction_error > 0.7` — trigger

These are the "instrument default behaviour." Named controller sources are for users who want to route Monty signals to *other* parameters (e.g., `displace.amount ← monty-pe`, or `lfo1.freq ← monty-confidence`).

### Files changed

| File | Change |
|---|---|
| `src/io/MontyBridge.js` | Add `_signal` object; mutate in `_onMessage()` |
| `src/controls/ControllerManager.js` | Add `setMontySignal(signal)` setter; read in `tick()` |
| `index.html` | 4 new `data-ctrl` buttons in context menu |
| `src/ui/UI.js` | Badge label map entries |
| `src/main.js` | Wire `ctrl.setMontySignal(montyBridge._signal)` after construction |

---

## Feature 2: Adaptive Governor

### What

Replace the static `--min-interval` rate limiter with an adaptive one that responds to the brain's prediction_error:

- **Low prediction_error** (brain is bored) → accept frames faster → the brain gets new stimulation
- **High prediction_error** (brain is startled) → accept frames slower → let the brain process what it's seeing

### Design

```python
class AdaptiveGovernor:
    def __init__(self, min_interval=0.15, max_interval=2.0, initial=0.5):
        self.min = min_interval
        self.max = max_interval
        self.current = initial
        self._last_accepted = 0.0

    def accept(self, now: float) -> bool:
        if now - self._last_accepted >= self.current:
            self._last_accepted = now
            return True
        return False

    def update(self, prediction_error: float):
        """Call after each episode completes with the peak prediction_error."""
        # Linear interpolation across the full dynamic range:
        # PE=0 → min_interval (0.15s, fast), PE=1 → max_interval (2.0s, slow)
        target = self.min + (self.max - self.min) * prediction_error
        # Exponential moving average for smooth transitions
        self.current = self.current * 0.7 + target * 0.3
        self.current = max(self.min, min(self.max, self.current))
```

`--governor adaptive` enables this (default). `--governor static` preserves Phase 3.0 behaviour with `--min-interval`.

The governor is updated with the peak `prediction_error` from each completed episode. The peak captures the strongest surprise moment in the episode, which is the meaningful signal for rate adjustment.

### Files changed

| File | Change |
|---|---|
| `monty-bridge.py` | `AdaptiveGovernor` class; `--governor` flag; update after each episode |

---

## Feature 3: Self-Supervised Mode (`--model self`)

### What

A second model mode where Monty starts with **no pretrained knowledge** and builds graph memory from the frames it receives during the session. Instead of recognising YCB household objects, it learns whatever ImWeb shows it — abstract textures, video feedback, faces.

### Prerequisite

Feature 0 (luminance-as-depth) must be implemented first. Without valid depth-derived features, the self-supervised model's LM receives no percepts and cannot learn anything.

### Model variant

`MontyForNoResetEvidenceGraphMatching` from `tbp.monty.frameworks.models.no_reset_evidence_matching`:
- Evidence persists across episodes (no reset between frames)
- Hypothesis space evolves continuously
- Uses `NoResetEvidenceGraphLM` which computes displacements from `last_location` instead of resetting
- Uses `BurstSamplingHypothesesUpdater` for more aggressive hypothesis pruning

### Invocation

```bash
python monty-bridge.py --live --model self        # self-supervised, no pretrained knowledge
python monty-bridge.py --live --model pretrained   # default, YCB pretrained (Phase 3.0 behavior)
```

### Architecture changes

When `--model self`:
1. Override monty config to `noresetevidencegraph_exp20_e3_t3_tot2500` (verified exists in `~/tbp/tbp.monty/src/tbp/monty/conf/monty/`)
2. Set `experiment.config.model_name_or_path=null` — no pretrained weights
3. The model starts with empty graph memory and learns from each frame

The self-supervised model will build graph nodes from features it observes. Over a session, it develops an internal representation of what it's seeing. Confidence rises as it sees repeated patterns; prediction_error spikes when the visual content changes dramatically.

**This is the aesthetically richest mode:** the brain doesn't know what anything is and builds its own reality from the visual signal.

### Hydra config override

```python
if model_mode == "self":
    overrides.extend([
        "monty=noresetevidencegraph_exp20_e3_t3_tot2500",
        "experiment.config.model_name_or_path=null",
    ])
```

### Files changed

| File | Change |
|---|---|
| `monty-bridge.py` | `--model pretrained|self` flag; conditional Hydra overrides |

---

## Feature 4: Confidence Aggregation Flag

### What

`--confidence-agg mean|max` controls how confidence is aggregated across learning modules:

| Mode | Formula | Interpretation |
|---|---|---|
| `mean` (default) | `np.mean(confidences)` | All columns must agree — thousand-brains consensus |
| `max` | `np.max(confidences)` | At least one column is confident — any-column match |

### Why configurable

With a single LM (the `supervised_pre_training_base` model), `mean` and `max` are identical. But with multi-LM models (5-LM YCB config), the aggregation matters:
- `mean` keeps confidence low unless all columns agree → more prediction_error spikes → more captures → more visual activity
- `max` lets confidence rise when any single column matches → calmer visual behaviour

### Files changed

| File | Change |
|---|---|
| `monty-bridge.py` | `--confidence-agg` flag; conditional aggregation in `_monty_thread` |

---

## Implementation Order

All features are technically independent — no hard dependencies between them. The recommended sequencing is by priority and impact:

```
Feature 0 (luminance-as-depth)     — prerequisite, unblocks all signal flow
Feature 1 (controller sources)     — largest, most user-visible
Feature 2 (adaptive governor)      — Python-only, independent
Feature 3 (self-supervised)        — most aesthetically interesting, benefits from F0+F2
Feature 4 (confidence-agg flag)    — one-line change, independent
```

Feature 0 must come first (unblocks non-zero signals). After that, F1/F2/F4 can be done in any order. F3 depends on F0 technically (needs valid features to learn) and synergises with F2 artistically (adaptive governor matters most when evidence evolves over time), but is not blocked by either.

---

## Verification

### Feature 0
1. Send a frame with varied visual content → bridge logs show non-zero confidence or prediction_error
2. Saccade moves in response to motor policy actions (not just random fallback)

### Feature 1
1. Right-click any param badge → "Monty Saccade X" appears in menu
2. Assign `monty-saccade-x` to `displace.amount` → value tracks saccade movement when bridge connected
3. Badge shows "MX" in accent colour when connected
4. Disconnect bridge → parameters freeze at last-known values (no jump to initial)
5. Existing buffer.fs1/scatter/capture mappings still work alongside controller routes

### Feature 2
1. `--governor adaptive` (default): governor interval visible in logs, shortens during low-PE periods, lengthens during high-PE
2. `--governor static`: same behaviour as Phase 3.0
3. No runaway capture behaviour — governor self-corrects

### Feature 3
1. `--model self`: bridge starts with `LMs: 1`, no pretrained weights loaded
2. First episode: confidence ≈ 0, prediction_error ≈ 0 (nothing learned yet)
3. After 5+ episodes with the same visual content: confidence slowly rises
4. Changing visual content dramatically: prediction_error spikes

### Feature 4
1. `--confidence-agg mean`: same as Phase 3.0 behaviour
2. `--confidence-agg max`: with single LM, identical to mean (verified)

---

## Phase 5 Boundary

- **Monocular depth estimation**: MiDaS/ZoeDepth for real depth — gives physically accurate surface normals and curvature instead of luminance proxy. Upgrades feature quality but adds a heavy dependency.
- **Learning persistence**: save/load self-supervised graph memory to disk across sessions
- **Multi-LM inference**: 5-LM config (`supervised_pre_training_5lms`) for richer voting behaviour
- **Monty-driven effects**: Monty signals driving shader uniforms directly (e.g., prediction_error → CRT distortion amount)
