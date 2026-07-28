# ImWeb Draw Section Upgrade — Comprehensive Export

> Generated 2026-07-13 · 10 commits · [Draw P1–P4c] + ink-source expansion + perf fixes

---

## Part 1: Code Modification Log

### Files changed (7 files, 10 commits)

| File | Phases | Lines changed |
|------|--------|---------------|
| `src/inputs/DrawLayer.js` | P1, P3 refactor, perf, ink-source | ~200+ added |
| `src/inputs/StrokeLooper.js` | P3 | NEW (170 lines) |
| `src/main.js` | P1–P4c, ink wiring | ~200+ added |
| `src/controls/ParameterSystem.js` | P1–P4, ink-source | ~70 added |
| `src/controls/ControllerManager.js` | P4c | ~50 added |
| `src/ui/components/CtrlPopover.js` | P4c | ~50 added |
| `index.html` | P4c, ink context menu | ~25 added |
| `src/style.css` | P4c badge | 4 added |
| `src/io/ProjectFile.js` | P3 persistence | ~10 added |
| `CHANGELOG.md` | docs | 5 entries |

### Commit-by-commit log

```
2a78ed9  feat: pen-ready drawing — Pointer Events, pressure, DrawLayer point queue (Draw P1)
4ee2d87  feat: draw directly on the output canvas — touch.mode 'Draw' (Draw P2)
21a7cc8  feat: 4-slot stroke looper — record/loop drawings while drawing live (Draw P3)
37a5013  feat: draw↔synthesis crossovers — StrokeEmit particles, ⇢ Warp / ⇢ Key shortcuts (Draw P4)
d6128d9  feat: stroke→LFO controller driver — draw loops as modulation sources (Draw P4c)
6995248  perf: guard DrawLayer texture upload behind dirty flag
9236fde  feat: video-as-ink — draw with camera/movie pixels
8371bbf  fix: video-as-ink — white ghost strokes, per-frame cache, DOM insertion
1fb2753  feat: expand inkSource to Noise + Output + MovieB
f53b852  docs: CHANGELOG for video-as-ink
e18f804  perf: lazy-fill ink cache, half-res cache, fix flicker
da6e3a9  perf: currentTime guard on video decode
1afdaf8  fix: 256px cache, min 4px stamp
b549c3f  fix: fallback frame-counter for iOS Safari
```

### Function/block additions per file

**DrawLayer.js:**
- `queuePoint(pt)` — point queue for pointer/LFO/loop events
- `drawSegment(pt, prev)` — shared render path with solid-color + video-ink branches
- `_resolve(raw, ps)` — resolve brush fields from params + pressure
- `this._queue`, `this._prevByOrigin`, `this.onSegment` — queue infrastructure
- `this.liveStroke`, `this.strokeActive` — pointer state flags
- `this.inkVideo`, `this.inkSource` — video-as-ink references
- `this._inkCache`, `this._inkCacheCtx` — per-frame video snapshot cache
- `this._lastVideoTime`, `this._inkFrameCount` — video frame dedup
- `tick()` — ink cache fill block (video/noise/output branches), dirty guard on `needsUpdate`

**StrokeLooper.js (NEW):**
- `constructor(drawLayer, ps)` — hooks into DrawLayer.onSegment
- `toggleRecord(i)`, `setPlaying(i, on)`, `clear(i)` — transport
- `tick(dt)` — per-slot playhead advance + point emission
- `_emit(slot, i, to, wrapped)` — queue points via drawLayer.queuePoint
- `serialize()`, `restore(data)` — .imweb persistence
- Loop-feedback guard: skips `origin.startsWith('loop')` in recorder

**ControllerManager.js:**
- `this.strokes` Map, `this._strokeLooper` reference
- `setStrokeLooper(looper)` setter
- Stroke tick block: advance playheads, sample slot points, `setNormalized`
- `stroke-{n}-{axis}` type parser in `assign()`
- Cleanup in `_removeController()`

**ParameterSystem.js:**
- `draw.pressure.size`, `draw.pressure.opacity` (CONTINUOUS)
- `touch.mode` option "Draw" (index 3, append-only)
- `drawloop{n}.rec/play/clear/speed` (4 slots × 4 params)
- `draw.toParticles` (TOGGLE)
- `draw.inkSource` (SELECT: Color/Camera/Movie/MovieB/Noise/Output)
- `controllerLabel`: `'stroke-{n}-{axis}'` → `S1X`–`S4Y`
- `controllerClass`: `startsWith('stroke')` → `'stroke'`

**CtrlPopover.js:**
- `stroke-*` branch: slot select, axis toggle button, rate drag field
- Live driver state sync on rate change

**main.js:**
- `attachDrawSurface(el, gate)` — shared pointer handler factory
- Preview canvas + main canvas pointer handlers (coalesced events, palm rejection)
- `touch.mode === 3` gate on main canvas
- ⊕ Canvas toggle button
- ⇢ Warp / ⇢ Key shortcut buttons
- Stroke looper transport strip (L1–L4, ● ▶ ✕)
- `strokeLooper.tick(dt)` before `drawLayer.tick(ps)`
- `ctrl.setStrokeLooper(strokeLooper)` wire-up
- Ink-source routing: camera/movie/movieB video → drawLayer.inkVideo
- Output snapshot: `renderer.domElement` → `drawLayer._inkCache`
- `draw.toParticles` → `particle.emitx/emity` in render loop

**index.html:**
- "Stroke Looper" section in `#param-context-menu` (8 buttons: stroke-1-x through stroke-4-y)

**style.css:**
- `.param-ctrl.stroke { color: #e8c840; }`

**ProjectFile.js:**
- `strokeLoops` key in save JSON
- `extras.strokeLooper.restore()` in load path
- `strokeLooper` in extras constructor

