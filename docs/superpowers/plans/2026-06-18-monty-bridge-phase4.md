# Monty Bridge — Phase 4 Implementation Plan
**Date:** 2026-06-18
**Design spec:** `docs/superpowers/specs/2026-06-18-monty-bridge-phase4-design.md` (commit c3f5343)
**Status:** Ready to execute

---

## Task Breakdown

### Task 0 — Luminance-as-depth (Python)

In `_monty_thread`, after saving `rgb_0.png` and before `switch_to_scene(0)`:

1. Convert PIL image to numpy array
2. Compute grayscale: `gray = np.mean(rgb_array, axis=2)`
3. Map to depth range: `depth = (0.5 + gray / 255.0).astype(np.float32)`
4. Write `depth_0.data`: `depth.tofile(str(depth_path))`
5. Add `depth_path` variable alongside existing `rgb_path`

Also remove the `_setup_scene_folder` static depth write — the startup seed frame will use the same luminance pipeline (black seed → depth 0.5 everywhere, which is non-zero and will produce valid geometry).

**Verify:** send a frame with varied content → bridge logs show non-zero confidence or prediction_error. If prediction_error stays saturated at 1.0 due to edge curvature noise, add `scipy.ndimage.gaussian_filter(gray, sigma=2)` before depth conversion.

### Task 1 — Named Monty controller sources (JS)

Five files, small changes each:

**1a. `src/io/MontyBridge.js`:**
- Add `this._signal = { sx: 0.5, sy: 0.5, confidence: 0, pe: 0 }` in constructor
- In `_onMessage()`, mutate `_signal` properties before existing buffer-param writes

**1b. `src/controls/ControllerManager.js`:**
- Add `this._montySignal = null` in constructor
- Add method: `setMontySignal(signal) { this._montySignal = signal; }`
- In `tick()`, in the `this.ps.getAll().forEach` block alongside `rand1/2/3`:
  ```js
  if (ct === 'monty-saccade-x' && this._montySignal)  p.setNormalized(this._montySignal.sx);
  if (ct === 'monty-saccade-y' && this._montySignal)  p.setNormalized(this._montySignal.sy);
  if (ct === 'monty-confidence' && this._montySignal) p.setNormalized(this._montySignal.confidence);
  if (ct === 'monty-pe' && this._montySignal)         p.setNormalized(this._montySignal.pe);
  ```

**1c. `index.html`:**
- Add 4 `data-ctrl` buttons after the pen-pressure group

**1d. `src/ui/UI.js`:**
- Add badge label entries for `monty-saccade-x` → `MX`, etc.

**1e. `src/main.js`:**
- After MontyBridge and ControllerManager construction: `ctrl.setMontySignal(montyBridge._signal)`

**Verify:** build passes. Right-click param badge → Monty options visible. Assign to a param → value tracks signal when bridge connected.

### Task 2 — Adaptive governor (Python)

1. Add `AdaptiveGovernor` class to `monty-bridge.py` with the corrected formula
2. Add `--governor adaptive|static` flag (default: `adaptive`)
3. In `run_live()`: instantiate governor based on flag
4. In WS handler: use `governor.accept(now)` instead of inline interval check
5. In `_monty_thread`: track peak PE per episode, call `governor.update(peak_pe)` after `model.post_episode()`
6. Pass governor to thread (or use a shared float for the update)

**Complication:** governor state is shared between the asyncio handler (reads `current`) and the monty thread (writes via `update`). Use `threading.Lock` or just accept the benign race (governor.current is a single float, reads/writes are atomic on CPython).

**Verify:** `--governor adaptive` with varied content → logs show interval changing. `--governor static` → same as Phase 3.0.

### Task 3 — Self-supervised mode (Python)

1. Add `--model pretrained|self` flag (default: `pretrained`)
2. In `_setup_monty()`: conditional Hydra overrides based on model flag
3. When `--model self`: override monty config to `noresetevidencegraph_exp20_e3_t3_tot2500`, set `model_name_or_path=null`
4. Print `mode: self-supervised` or `mode: pretrained` at startup

**Verify:** `--model self` starts without error. First episode: low confidence. After 5+ episodes of same content: confidence rises.

### Task 4 — Confidence aggregation flag (Python)

1. Add `--confidence-agg mean|max` flag (default: `mean`)
2. Pass to `_monty_thread`
3. In signal extraction: `np.mean(confidences)` vs `np.max(confidences)` based on flag

**Verify:** with single LM, both produce identical results.

---

## Implementation Order

```
Task 0 (luminance-as-depth)  →  verify signals non-zero
Task 1 (controller sources)  →  verify UI + param routing
Task 2 (adaptive governor)   →  verify interval adapts
Task 3 (self-supervised)     →  verify learning over episodes
Task 4 (confidence-agg)      →  verify flag works
```

Task 0 first (unblocks everything). Tasks 1–4 are independent after that.

---

## Risk Assessment

| Risk | Mitigation |
|---|---|
| Luminance depth produces saturated PE from edge curvature noise | Gaussian blur on luminance before depth conversion (sigma=2) |
| Self-supervised model construction fails via Hydra override | Config name verified: `noresetevidencegraph_exp20_e3_t3_tot2500` exists |
| Governor race between asyncio and monty threads | Single-float atomic read/write on CPython; benign worst case |
| Motor policy still returns empty actions with luminance depth | Random saccade fallback from Phase 3.0 remains as safety net |
