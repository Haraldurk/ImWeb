# CLAUDE.md — ImWeb Development Context

This file gives Claude Code the context needed to contribute effectively to ImWeb. Read it fully before touching anything.

---

## Editing Rules

- Always run grep/search recon BEFORE editing any file. Verify the exact code block exists and check for duplicates or related code that may be affected.
- When implementing features, write code immediately after a brief targeted recon (max 5-10 tool calls). Do NOT spend an entire session exploring without producing code unless explicitly asked to explore only.

---

## What this project is

**ImWeb** is a browser-based real-time video synthesis instrument — a ground-up reimplementation of Tom Demeyer and Steina Vasulka's *Image/ine* (STEIM Amsterdam, 1997/2008) in the modern browser.

The instrument composites video sources through a signal chain of effects and renders to a WebGL canvas. Every visual parameter is mappable to a controller (MIDI, LFO, audio, mouse, key, random, expression). The interface is also the performance — no edit/perform mode split.

---

## Tech stack

| Layer       | Technology                                                      |
|-------------|-----------------------------------------------------------------|
| Renderer    | Three.js r160+ (WebGL, WebGLRenderTarget ping-pong)             |
| Build       | Vite 5.4 (ES modules, HMR)                                      |
| UI          | Vanilla JS + DOM; no React/Vue                                  |
| Style       | src/style.css; CSS variables for theming                        |
| Persistence | IndexedDB (presets, tables); localStorage (AI config, settings) |
| Input       | WebRTC (camera), File API, Web MIDI API                         |
| Audio       | Web Audio API (AnalyserNode FFT/VU)                             |
| AI          | Switchable provider (Anthropic / Gemini / OpenAI / Ollama)      |

---

## Project structure
src/
main.js                   Bootstrap, render loop, all feature wiring
style.css                 All styles — dark performance UI
ai/
AIFeatures.js           AI provider system: narrator, coach, preset
generator. Provider/key config persisted to
localStorage 'imweb-ai-config'. All calls
route through _call(systemPrompt, userPrompt).
controls/
ParameterSystem.js      All parameters declared here; reactive onChange
ControllerManager.js    Mouse, MIDI, LFO, Sound, Key, Random,
Expression, Gamepad, Wacom, OSC drivers
LFO.js                  Sine/Triangle/Sawtooth/Square/S&H + beat sync
Automation.js           Record/play parameter movements, loop playback
core/
Pipeline.js             WebGL compositing chain — all render passes
shaders/
index.js                All GLSL effect shaders as named exports
inputs/
CameraInput.js          WebRTC getUserMedia → VideoTexture
MovieInput.js           Video file → VideoTexture; speed/loop/BPM sync
StillsBuffer.js         Frame capture store
SlitScanBuffer.js       Rolling slit scan effect
TextLayer.js            Canvas 2D text → Texture
DrawLayer.js            Freehand canvas → Texture (Wacom pressure)
ParticleSystem.js       GPU particle field as pipeline source
io/
ProjectFile.js          .imweb JSON save/load — full session
OSCBridge.js            WebSocket ↔ UDP OSC relay
LUTLoader.js            .cube file import
scene3d/
SceneManager.js         Three.js 3D scene → RenderTarget
GeometryFactory.js      13 procedural geometry generators
state/
Preset.js               Presets + 128 Display States, IndexedDB
ui/
UI.js                   All UI builders: param rows, tabs, signal path,
context menus, seq cards, WarpMap editor,
controller badge popovers

main.js is the integration hub (~2000 lines). Most feature wiring lives here. Do not split it without a clear architectural reason.

---

## Key conventions

### Parameters
All controllable values live in ParameterSystem. Each has a namespace (e.g. movie.speed, seq1.source). Types:
- CONTINUOUS — float with min/max/step
- TOGGLE — boolean
- SELECT — integer index into options array
- TRIGGER — fire-once event

Read: ps.get('name').value
Write: ps.set('name', v) — fires onChange callbacks

### Controllers
Each parameter can have one controller assigned. Controller object shape: { type: 'random'|'lfo'|'fixed'|'midi'|..., hz, slew, tableId, value, ... }. Settings edited via badge popover (right-click or Ctrl+click on badge in param row).

### Parameter row UI pattern
[label]  [ctrlBadge]  [minField]  [maxField]  [valueDisplay]
- ctrlBadge — shows controller type (RND, LFO, MIDI…); right-click → _openCtrlPopover()
- minField / maxField — drag (ns-resize cursor) or double-click to type; enforce min≤max
- Drag delta: (startY - currentY) × 0.1; Shift = × step
- Double-click opens inline text input; Enter commits, Escape cancels

### Controller badge popover (_openCtrlPopover)
Opens dark panel adjacent to badge. Closes on click-outside or Escape.
- Random: Rate (hz), Slew (s), Table
- LFO: Shape, Freq, Phase, Slew, Table
- Fixed: Value
All fields use same drag/dblclick pattern as range fields.

### CSS variables (key values)
--text-1: #e0e0f0        primary text
--text-2: #8888a0        muted/inactive text
--accent: #c8a020        primary yellow
--accent-dim: #8c7a28    dimmed accent
--bg-1: #12121a          main background
--bg-2: #18181f          panel background
--bg-3: #1f1f25          section background
--bg-4: #26262e          hover state

### Adding a new feature
1. Declare parameters in ParameterSystem.js
2. Implement logic in relevant src/inputs/ or src/core/ module
3. Wire in main.js (tick loop and/or onChange callbacks)
4. UI: add builder to UI.js, call from main.js
5. Styles: add to style.css
6. Document in CHANGELOG.md

### Shaders
All GLSL in src/shaders/index.js as named exports. Minimal fragment shaders reading from tDiffuse. Add to pipeline via Pipeline.addPass().

---

## What NOT to do

- Do not use React, Vue, or any component framework
- Do not add bundled state management — ParameterSystem is the state
- Do not rewrite whole files — surgical str_replace edits only
- Do not refactor main.js into many small files without clear reason
- Do not change the Three.js render loop without understanding the ping-pong buffer chain in Pipeline.js
- Do not add TypeScript
- Do not hardcode API keys anywhere

---

## Project-Specific Notes

For barlowgen.html and ImWeb projects: these are large single-file HTML/JS apps. Use surgical edits — never rewrite entire files. Always verify edit targets with grep first, and check that updateDisplay() or similar refresh functions won't overwrite new UI elements.

---

## Git Workflow

After completing each task, commit with a descriptive message and move to the next task. Follow git discipline: commit early and often.

---

## Collaboration model

Claude Code handles: multi-file wiring, complex JS logic, Pipeline/shader work, AIFeatures.js.
Gemini CLI (see GEMINI.md) handles: grep/recon, browser screenshots via Chrome DevTools MCP, GLSL drafting, docs.

### Standard prompt template
You are working on ImWeb. Codebase: ~/Documents/GitHub/ImWeb
Rules: NEVER rewrite whole files. Surgical edits only.
One feature per prompt.
BEFORE TOUCHING ANYTHING:

git log --oneline -5
git status
Read [relevant file]

TASK: [single clearly scoped task]
ACCEPTANCE: [what done looks like]
AFTER: git add [files] && git commit -m "[message]" && git push

---

## Current version: 0.5.1

See CHANGELOG.md for full history.

### Completed through Phase 4 + 0.4.x updates
- Full signal chain: 21+ sources, 20+ effect passes
- All ImOs9 features restored (WarpMap with interactive brush editor,
  Tables 16k, ExternalMapping, Sequencers ×3, FrameSelect, TransferMode 22 modes, rand1/2/3)
- 3D scene integration (Three.js → pipeline; 13 geometries; GLB/GLTF/OBJ/STL; depth pass; live video texture on mesh)
- 3D Cloner (InstancedMesh MoGraph) with effectors: Twist, Scatter, WaveShape, WaveAmp, WaveFreq, CloneScale, ScaleStep
- Blob/Morph vertex displacement shader (onBeforeCompile; USE_INSTANCING independent per clone)
- SDF Generator (GPU raymarched metaballs → pipeline source; shape/repeat/warp — Phase 1 + 2)
- Movie clip reverse playback, MovieEnd, MovieLoop SELECT modes
- AI provider system (Anthropic/Gemini/OpenAI/Ollama switchable, key management UI)
- .imweb project file format
- PWA manifest + service worker
- ~200+ parameters, all MIDI/LFO-assignable
- Controller badge popover (right-click RND/LFO/etc for Rate, Slew, Table, Shape)
- Min/Max range fields: drag or double-click to edit

### Remaining (Phase 5)
- [ ] Factory demo presets (4–6, no camera required; startup loads preset 0)
- [ ] First-visit onboarding overlay (what this is, 3 gestures, link to manual; localStorage dismiss flag)
- [ ] Keyboard shortcut lock toggle (status bar button; blocks 0–9/letter keys when typing in fields)
- [ ] MidiSync / AutoSync (frame rate locked to MIDI clock)
- [ ] Non-realtime capture mode (frame-by-frame export)
- [ ] Performance profiling / GPU display
- [ ] Projection mapping (Phase 6 — homography corner-pin, second monitor output)

---

## Running the project
```bash
npm install
npm run dev     # Vite dev server at localhost:5173
npm run build   # Production build to dist/
```

Chrome 113+ recommended. Firefox and Safari work with minor WebGL limitations.

---

## Credits

Original Image/ine: Tom Demeyer and Steina Vasulka, STEIM Foundation, Amsterdam
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson
---
