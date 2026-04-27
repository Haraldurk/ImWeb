# ImWeb — Architecture Overview

**ImWeb** is a browser-based real-time video synthesis instrument — a modern reimplementation of Tom Demeyer's *Image/ine* (STEIM, 1997). It composites video sources through a signal chain of GPU shader effects and renders to WebGL.

## Tech stack

- **Three.js v0.168** — WebGL renderer, WebGLRenderTarget ping-pong
- **Vite 5.4** — ES module bundler, HMR dev server on `:5173`
- **Vanilla JS + DOM** — no React/Vue framework
- **IndexedDB** — presets, banks, tables
- **localStorage** — AI config, settings
- **Web MIDI, Web Audio, WebRTC** — real-time inputs

## Source structure (`src/` — 12 modules)

| Module | Role |
|---|---|
| `main.js` (~5400 lines) | **Integration hub**: bootstrap, render loop (`requestAnimationFrame`), all feature wiring, keyboard shortcuts, UI event handlers |
| `core/Pipeline.js` | WebGL compositing chain — 30+ shader passes on full-screen quads with ping-pong `WebGLRenderTarget` buffers |
| `controls/ParameterSystem.js` | Declares all ~210+ parameters (continuous, toggle, select, trigger). Each param fires `onChange` callbacks. Slew/lag smoothing. |
| `controls/ControllerManager.js` | Assigns controllers to parameters: Mouse, MIDI, LFO, Sound, Key, Random, Expression, Gamepad, Wacom, OSC |
| `controls/LFO.js` | 6 LFO shapes (sine, triangle, saw, ramp, square, S&H) with beat sync |
| `controls/Automation.js` | Record/playback parameter movements |
| `inputs/` (14 files) | Sources: `CameraInput` (WebRTC), `MovieInput` (video file), `StillsBuffer`, `SequenceBuffer` ×3, `SlitScanBuffer`, `VectorscopeInput`, `DrawLayer`, `TextLayer`, `SDFGenerator`, `WarpMaps`, `WarpMapEditor`, `VasulkaWarp`, `VideoDelayLine` |
| `scene3d/` (7 files) | Three.js 3D scene → pipeline texture. Hypercube engine (4D–12D), 13 procedural geometries, InstancedMesh cloner, geometry import (GLB/OBJ/STL) |
| `shaders/index.js` | All GLSL fragment shaders as named exports (keyer, blend, displace, 20+ post-FX) |
| `particles/` (8 files) | GPU particle field with emitters, attractors, force fields |
| `ui/UI.js` | All DOM builders: param rows with drag/dblclick, tabs, signal path, context menus, controller badge popovers, state bar |
| `state/` (3 files) | Preset manager (IndexedDB), 128 display states per bank, table manager (response curves) |
| `io/` (5 files) | Project file (`.imweb` JSON), OSC bridge, `.cube` LUT loader, `.imX` importer, clip library |
| `ai/AIFeatures.js` | Multi-provider AI (Anthropic/Gemini/OpenAI/Ollama) for narrating state, coaching suggestions, preset generation |

## Startup sequence (in `main()`)

1. Create Three.js WebGL renderer on `<canvas id="output-canvas">`
2. Initialize `ParameterSystem` + register all ~210+ parameters
3. Create `ControllerManager` (MIDI, audio, keyboard, etc.)
4. Create all input sources (camera, movie, buffers, draw, text, particles, SDF, 3D scene, hypercube)
5. Create `Pipeline` (pre-builds all shader materials)
6. Build UI (tabs, param rows, signal path, state bar, context menu)
7. Initialize `PresetManager` and load saved state from IndexedDB
8. Start `requestAnimationFrame` render loop

## Per-frame render loop

1. **Gate check** — MIDI sync, auto-sync divisor, capture mode
2. **Logic tick** — slew smoothing, beat phase, controllers (LFO/RND/sound), morph animation, automation playback
3. **Input tick** — camera, movie, buffers, sequences, draw, text, vectorscope, slit scan, particles, SDF, 3D scene
4. **Noise generation** — on-demand only (512×512 dedicated target)
5. **3D scene render** — on-demand, feeds pipeline with `scene3d.texture`
6. **Assemble inputs object** — up to 20+ texture sources
7. **`Pipeline.render(inputs, ps, dt)`** — the compositing chain:

   ```
   Sources → [Per-layer color correct + mirror + self-blend]
           → TransferMode composite (FG + BG, 22 modes)
           → Displacement (4-source warp)
           → Luma Keyer → Chroma Keyer
           → WarpMap (procedural displacement map)
           → Feedback Blend (with offset/scale/rotate/zoom on prev frame)
           → Color Shift
           → Post-FX chain (pixelate, edge, RGB shift, kaleidoscope, posterize,
              vignette, bloom, levels, LUT, film grain, etc.)
           → Interlace → Fade → Custom GLSL → Final blit to canvas
   ```

8. **Post-pipeline** — delay capture, VasulkaWarp, sequence timewarp, second screen output, profiler

## Key design patterns

- **Parameter → Callback wiring**: Every visual knob is a `Parameter` with `onChange` callbacks. Controllers write normalized values; rendering code reads via `ps.get('name').value`.
- **Ping-pong render targets**: Pipeline alternates between two `WebGLRenderTarget` textures, compositing effects sequentially without intermediate canvas readback.
- **On-demand rendering**: Noise, 3D scene, SDF, and particles only render when actively routed as a layer source (source index check).
- **Controller badge popovers**: Right-click any parameter's controller badge to assign LFO, MIDI, random, audio, keys, etc. with rate/slew/table settings.
- **Single `main.js` hub**: By design — this is a performance instrument, not a modular app. All wiring lives in one file for hot-reload speed and clarity of signal flow.
