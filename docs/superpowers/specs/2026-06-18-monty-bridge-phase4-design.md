# Monty Bridge — Phase 4 Design Spec
**Date:** 2026-06-18
**Status:** Draft — awaiting review
**Depends on:** Phase 3.0 (commit 02cf1b5)

---

## Context

Phase 3.0 shipped the live Monty inference loop: `monty-bridge.py --live` loads a pretrained YCB model, accepts PNG frames from ImWeb over WebSocket, runs saccade episodes, and emits `saccade`, `confidence`, `prediction_error` signals. The signals drive `buffer.fs1`, `buffer.scatter`, and `buffer.capture` through hardcoded mappings in `MontyBridge._onMessage()`.

Phase 4 opens this up:
1. **Any parameter** can be driven by a Monty signal — not just the three buffer params.
2. The **governor becomes adaptive** — tightens when the brain is bored, loosens when it's startled.
3. A **self-supervised mode** lets the brain build its own graph memory from buffer frames — it starts knowing nothing and learns what it sees.
4. A **confidence aggregation flag** lets the user choose mean (consensus) or max (any column confident).

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

**MontyBridge stores latest signal values:**
```js
// New properties on MontyBridge
this._signal = { sx: 0.5, sy: 0.5, confidence: 0, pe: 0 };
```

Updated from `_onMessage()` before the existing buffer-param writes. The buffer writes remain for backwards compatibility — they're the "default mapping" that works without the user configuring anything.

**ControllerManager reads from MontyBridge:**
```js
// In tick(), alongside the rand1/rand2/rand3 block:
if (ct === 'monty-saccade-x')  p.setNormalized(this._montySignal.sx);
if (ct === 'monty-saccade-y')  p.setNormalized(this._montySignal.sy);
if (ct === 'monty-confidence') p.setNormalized(this._montySignal.confidence);
if (ct === 'monty-pe')         p.setNormalized(this._montySignal.pe);
```

The ControllerManager gets a reference to the MontyBridge's `_signal` object (a plain JS object, no subscription needed — the tick loop reads the latest values each frame). MontyBridge writes to it at message rate; ControllerManager reads at frame rate.

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
| `src/io/MontyBridge.js` | Add `_signal` object; update in `_onMessage()` |
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
    def __init__(self, base_interval=0.5, min_interval=0.15, max_interval=2.0):
        self.base = base_interval
        self.min = min_interval
        self.max = max_interval
        self.current = base_interval
        self._last_accepted = 0.0
    
    def accept(self, now: float) -> bool:
        if now - self._last_accepted >= self.current:
            self._last_accepted = now
            return True
        return False
    
    def update(self, prediction_error: float):
        """Call after each episode completes with the peak prediction_error."""
        # High PE → slow down (more processing time)
        # Low PE → speed up (brain is bored, feed it new images)
        target = self.base + (self.max - self.base) * prediction_error
        # Exponential moving average for smooth transitions
        self.current = self.current * 0.7 + target * 0.3
        self.current = max(self.min, min(self.max, self.current))
```

`--governor adaptive` enables this (default). `--governor static` preserves Phase 3.0 behaviour.

The governor is updated with the peak `prediction_error` from each completed episode. The peak captures the strongest surprise moment in the episode, which is the meaningful signal for rate adjustment.

### Files changed

| File | Change |
|---|---|
| `monty-bridge.py` | `AdaptiveGovernor` class; `--governor` flag; update after each episode |

---

## Feature 3: Self-Supervised Mode (`--model self`)

### What

A second model mode where Monty starts with **no pretrained knowledge** and builds graph memory from the frames it receives during the session. Instead of recognising YCB household objects, it learns whatever ImWeb shows it — abstract textures, video feedback, faces.

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
1. Use `MontyForNoResetEvidenceGraphMatching` as the `monty_class` in the Hydra config
2. Use `NoResetEvidenceGraphLM` as the learning module class
3. Do NOT load pretrained weights (skip `model_name_or_path`)
4. The model starts with empty graph memory and learns from each frame

The self-supervised model will build graph nodes from features it observes. Over a session, it develops an internal representation of what it's seeing. Confidence rises as it sees repeated patterns; prediction_error spikes when the visual content changes dramatically.

**This is the aesthetically richest mode:** the brain doesn't know what anything is and builds its own reality from the visual signal.

### Hydra config difference

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

```
Feature 1 (controller sources)  →  Feature 4 (agg flag)
                                       ↓
Feature 2 (adaptive governor)  →  Feature 3 (self-supervised)
```

Feature 1 is the largest and most user-visible. Feature 4 is a one-line flag. Feature 2 is Python-only. Feature 3 requires careful Hydra config work.

Features 1 and 2 are independent. Feature 3 depends on Feature 2 (the adaptive governor matters most when the self-supervised model's evidence evolves over time). Feature 4 is independent of everything.

---

## Verification

### Feature 1
1. Right-click any param badge → "Monty Saccade X" appears in menu
2. Assign `monty-saccade-x` to `displace.amount` → value tracks saccade movement when bridge connected
3. Badge shows "MX" in accent colour when connected
4. Existing buffer.fs1/scatter/capture mappings still work alongside controller routes

### Feature 2
1. `--governor adaptive` (default): governor interval visible in logs, shortens during low-PE periods
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

- **Learning persistence**: save/load self-supervised graph memory to disk across sessions
- **Multi-LM inference**: 5-LM config (`supervised_pre_training_5lms`) for richer voting behaviour
- **Monty-driven effects**: Monty signals driving shader uniforms directly (e.g., prediction_error → CRT distortion amount)
- **Depth estimation**: monocular depth from RGB (MiDaS/ZoeDepth) to replace flat depth — gives real surface normals and curvature for the feature pipeline
