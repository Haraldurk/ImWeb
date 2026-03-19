# CLAUDE.md — ImWeb Development Context

This file gives an AI assistant working on ImWeb the context needed to contribute effectively.

---

## What this project is

**ImWeb** is a browser-based real-time video synthesis instrument — a ground-up reimplementation of Tom Demeyer's *Image/ine* (STEIM Amsterdam, 1997/2008) in the modern browser. It is an artistic and technical project by H. Karlsson.

The instrument composites video sources (camera, movie clips, 3D scene, stills buffer, etc.) through a signal chain of effects (keyer, displacement, warp, blend, color shift, interlace, fade) and renders to a WebGL canvas. Every visual parameter is mappable to a controller (MIDI, LFO, audio, mouse, key, random, expression).

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Renderer | Three.js (WebGL, `WebGLRenderTarget` ping-pong) |
| Build | Vite (ES modules, no transpilation needed for dev) |
| UI | Vanilla JS + DOM; no React/Vue |
| Style | Single `src/style.css`; CSS variables for theming |
| Persistence | IndexedDB (presets); localStorage (settings) |
| Input | WebRTC (camera), File API (video/images), Web MIDI API |
| Audio | Web Audio API (`AnalyserNode` for FFT/VU) |

---

## Project structure

```
src/
  main.js                   Bootstrap, render loop, event wiring, all feature glue
  style.css                 All styles — dark performance UI

  controls/
    ParameterSystem.js      All parameters declared here; reactive onChange
    ControllerManager.js    Mouse, MIDI, LFO, Sound, Key, Random, Expression drivers
    LFO.js                  Sine / Triangle / Sawtooth / Square + beat sync

  core/
    Pipeline.js             WebGL compositing chain — all render passes

  shaders/
    index.js                All GLSL effect shaders as template literals

  inputs/
    CameraInput.js          WebRTC getUserMedia → VideoTexture
    MovieInput.js           Video file → VideoTexture; speed/loop/scrub/BPM sync
    StillsBuffer.js         Frame capture store (up to 16 frames)
    SlitScanBuffer.js       Rolling slit scan effect
    TextLayer.js            Canvas 2D text → Texture

  scene3d/
    SceneManager.js         Three.js 3D scene → RenderTarget; auto-spin, model import

  state/
    Preset.js               Preset save/load, Display States, IndexedDB

  ui/
    UI.js                   All UI builders: param rows, tabs, signal path,
                            context menu, seq cards, buildSeqParams()
```

`main.js` is the integration hub. It is large (~1800 lines). Most features are wired here.

---

## Key conventions

### Parameters
All controllable values live in `ParameterSystem`. Each has a namespace (e.g. `movie.speed`, `seq1.source`, `output.resolution`). Types:
- `CONTINUOUS` — float with min/max/step
- `TOGGLE` — boolean
- `SELECT` — integer index into an options array
- `TRIGGER` — fire-once event

Use `ps.get('name').value` to read, `ps.set('name', v)` to write with notifications.

### Adding a new feature
1. Declare any new parameters in `ParameterSystem.js`
2. Implement the logic in the relevant `src/inputs/` or `src/core/` module
3. Wire it in `main.js` (tick loop and/or onChange callbacks)
4. If it needs UI: add a builder function to `UI.js` and call it from `main.js`
5. Add styles to `style.css`

### Shaders
All GLSL is in `src/shaders/index.js` as named exports. Each shader is a minimal fragment shader that reads from `tDiffuse` (or named uniforms) and writes to `gl_FragColor`. Added to the pipeline via `Pipeline.addPass()`.

### Signal path display
The signal path is rendered by `UI.js`'s `_render()` method inside `SignalPath`. It reads live from `ps` values and regenerates HTML each frame. Node order: FG → BG → DS → TransferMode → Displacement → WarpMap → Keyer → Blend → ColorShift → LUT → Interlace → Fade.

### Second monitor
`⊡` opens `window.open()` popup. The popup reads `window.opener.document.getElementById('output-canvas')` directly (same-origin, `preserveDrawingBuffer: true` on renderer). Letterbox scaling via `ctx.drawImage(src, 0,0,iw,ih, dx,dy,dw,dh)`.

### Ghost mode
Purely visual: `body.classList.toggle('ghost-mode')`. CSS dims `#output-canvas` to `opacity: 0.18` and shows `#ghost-label` overlay. No layout changes — the ResizeObserver is guarded to ignore resize events when ghost mode is active.

---

## What NOT to do

- Do not use React, Vue, or any component framework — this is intentional vanilla JS
- Do not add a bundled state management library — `ParameterSystem` is the state
- Do not refactor `main.js` into many small files without a clear reason — the current structure is intentional; `main.js` is the single integration point
- Do not change the Three.js render loop structure without understanding the ping-pong buffer chain in `Pipeline.js`
- Do not add TypeScript; this project stays plain ES modules

---

## Current version: 0.3.0

See `CHANGELOG.md` for full history. The git tag `v0.3.0` marks the Phase 3 checkpoint.

### What was completed in Phase 3
- Sequence recorders with variable frame count
- Second monitor output (window.open + letterbox)
- Ghost mode
- Movie clip thumbnails
- Signal path float/dock
- LUT node in signal path
- Status bar resolution buttons
- Startup defaults (camera on, layers set, sections collapsed)
- Cmd+S quick-save

### What is still planned
See the Phase 3–5 items in `README.md`. Priority candidates for next session:
- WarpMode editor
- Draw layer improvements
- `.imweb` project file format (save/restore full session)
- PWA manifest

---

## Running the project

```bash
npm install
npm run dev     # Vite dev server at localhost:3000
npm run build   # Production build to dist/
```

Chrome 113+ recommended for best WebGL performance. Firefox works; Safari works with minor WebGL limitations.

---

## Credits

Original Image/ine: Tom Demeyer, STEIM Foundation, Amsterdam
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson
