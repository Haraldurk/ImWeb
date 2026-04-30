# ImWeb — Performance Findings

Generated: 2026-04-30

---

## Sprint 1 — Forced Reflow

### requestAnimationFrame loops containing DOM reads

| File | Line | DOM reads |
|---|---|---|
| `src/main.js` | 4566 | `canvas.getBoundingClientRect()` @ 5006 (warp grid overlay, conditional) |
| `src/ui/ColorPicker.js` | 160 | `offsetWidth` / `offsetHeight` in `_drawSV()` @ 175, 177 and `_drawHue()` @ 219, 221 — runs per-pointermove |

### setInterval loops containing DOM reads

| File | Line | DOM reads |
|---|---|---|
| `src/main.js` | 1223 | `panel.querySelector(".cm-list")`, `list.querySelectorAll(".cm-remove")` — controller mapping panel, 1s poll |

### Animation loops without DOM reads (audited, clear)

`src/main.js:1513`, `src/controls/ControllerManager.js:703`, `src/inputs/TeletextSource.js:85`, `src/inputs/TeletextUI.js:93`, `src/scene3d/HypercubeUI.js:230`

---

## Sprint 2 — scene3d Investigation — COMPLETE

Finding: scene3d uses shared renderer (no dual-context cost), no parallel 
RAF loop, no shadow map overhead. Full frame cost: DC:13 / Tri:520K at 
locked 60fps / 0 jank. No optimization needed.

Measurement fix: renderer.info.autoReset = false with manual reset before 
first render pass — accumulates all passes correctly.

Status: ✅ Closed — architecture healthy, cost acceptable.

---

## Sprint 3 — Open

### Candidate investigations

| # | Area | Hypothesis | Priority |
|---|---|---|---|
| 3.1 | Shader uniform uploads | Per-frame uniform sets for inactive/hidden passes may be wasting driver time | Medium |
| 3.2 | Parameter tick loop | ParameterSystem onChange fan-out — profile cost at ~210 params with active LFOs/MIDI | Medium |
| 3.3 | GC audit (controllers) | ControllerManager slew/interpolation — any remaining per-tick allocations? | Low |
| 3.4 | IndexedDB write pressure | Preset auto-save cadence — how often, how large, any jank on flush? | Low |

### Status
🔲 Not started
