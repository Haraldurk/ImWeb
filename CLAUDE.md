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
ParticleSystem.js       GPU particle field (emitter shapes, attractors, scale modes)
VasulkaWarp.js          Temporal strip-buffer slit-scan — EXPERIMENTAL, hidden from UI
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

### Architecture Notes
- Pipeline.js (src/core/Pipeline.js) owns the noise material uniform init block and the generateNoise() setter — NOT main.js. main.js only contains the call site and event listeners.
- Noise shader lives at src/shaders/index.js (not src/core/shaders/)

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

## Guard Logic Rules

Before implementing any flag or conditional guard:
1. State explicitly: what value does the flag hold at the exact line where
   the guard is evaluated?
2. If the answer is 'always the same value' — the guard is dead code. Stop.
   Rethink the architecture before writing any code.
3. For WebGL feedback loop fixes: the identity check pattern
   (tex === this.target.texture) is always preferred over timing flags.
   Flags depend on call order. Identity checks depend on values.
4. If a fix fails: git revert to the last clean commit. Do not stack a
   new patch on a broken fix. Clean slate only.
5. Before any fix: state one way this fix could still fail.

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

## Current version: 0.8.4

See CHANGELOG.md for full history.

### Completed through Phase 6 (current)
- **Hypercube pipeline texture on faces (Session 2)** — `ShaderMaterial` faces sampling pipeline texture, `faces.active/opacity` params, UI controls
- **Hypercube 2-cell face rendering (Session 1)** — `InstancedMesh` plane faces, centroid/normal tracking, `generate2CellFaces` N-D logic
- **Real screen-space hypercube edge width** — quad `Mesh` edges, screen-space extrusion shader, `uResolution` sync, 0.5–8.0 px width
- **Hypercube edge width shader (Session 1)** — `ShaderMaterial` on edges, `uEdgeWidth` uniform (0.5–8.0), `hypercube.edgeWidth` param and UI slider
- **N-D Hypercube engine (4D–12D)** — 60fps at 12D; vertex/edge generation, Givens projection, morph state machine, 5 easing functions; permanent Float32/Float64 buffers, zero per-frame allocation, `_colorsDirty` GPU gate, `MAX_DIM` draw range, circular points shader, vertex pub/sub
- **Hypercube UI** — dimension pills, collapsible rotation tiers, deferred DOM rebuild on morph
- Full signal chain: 23+ sources, 20+ effect passes
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
- ~210+ parameters, all MIDI/LFO-assignable
- Controller badge popover (right-click RND/LFO/etc for Rate, Slew, Table, Shape)
- Min/Max range fields: drag or double-click to edit
- Text animations, 3D materials, pointer events (Phase 5)
- ParticleSystem: emitter shapes (Box/Ring/LineH/LineV/Point), XY emitter position,
  two attractor nodes, scale-by-speed point size mode
- Displacement Map Editor: WarpMode/WarpAmt param rows in editor panel;
  preset buttons auto-activate Custom mode; section renamed from WarpMap Editor
- VASULKA_WARP shader: dual-oscillator scan-line UV warp (Wobbulator-inspired) — hidden from UI
- Raw keyer: uFGRaw/uRawKey uniform for pre-color-correction luminance keying
- VasulkaWarp (strip-buffer temporal slit-scan): full-width RT, GPU-only scissor capture;
  feeds camera3d texture when 3D camera is active — EXPERIMENTAL, hidden from UI

### Experimental / architecture deferred
- **VasulkaWarp (temporal slit-scan)**: VasulkaWarp.js + `vwarp.*` params exist and run, but
  the feature is hidden from UI pending a clearer architecture decision. The strip-buffer
  approach works but conflicts with the pipeline source model. Candidate future direction:
  treat it as a Sequence slot backed by disk/IndexedDB rather than a live GPU ring buffer.
- **VASULKA_WARP shader**: exists in Pipeline, hidden from signal path and UI until wired
  to a proper effect slot with a UI section.

### Remaining (Phase 6)
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

## Dev Capture System

A local-only multimodal brainstorming pipeline for capturing ideas during live performance sessions.
**This is a development-only tool. It is never shipped in the production build.**

### Purpose
Lets the developer record a voice note + annotated screenshot + live parameter state while ImWeb is running, then synthesise everything into a structured Markdown specification via the Gemini CLI — without leaving the browser.

### Keyboard shortcut
`Ctrl + Shift + D` (in the browser, anywhere in the ImWeb UI)  
Toggles the **Dev Capture Modal** open/closed.  
Defined in `src/main.js` at the `keydown` listener near line 4221.

### Architecture — three processes

| Process | Port | Entry point | Role |
|---|---|---|---|
| ImWeb (Vite) | **5173** | `npm run dev` | The instrument itself |
| Dev Catcher (Express) | **5174** | `node dev-catcher.js` | Receives multipart POST from the browser and writes files to `Brainstorms/` |
| Gemini CLI | — | `./process-ideas.sh` | Reads the captured files and writes a Markdown spec to `Brainstorms/Idea-<ts>.md` |

The catcher (`dev-catcher.js`) prefixes every saved file with a Unix timestamp (`Math.floor(Date.now() / 1000)`) so that files from a single capture session all share the same prefix (e.g. `1776007563-screenshot.png`, `1776007563-audio.webm`, `1776007563-state.json`, `1776007563-notes.txt`).

### Files produced per capture

| Suffix | Contents | Always present? |
|---|---|---|
| `-screenshot.png` | Canvas screenshot (WebGL readback) | Yes (recording path); No (send-only) |
| `-audio.webm` | MediaRecorder mic/audio | Only when "Start Recording" was used |
| `-state.json` | Full serialised ParameterSystem snapshot | Always |
| `-notes.txt` | Free-text notes from the textarea | Always (may be empty) |

### process-ideas.sh — how the synthesis works

1. Finds the single newest timestamp-prefixed file in `Brainstorms/` (`ls -t [0-9]*-* | head -1`).
2. Extracts the prefix (everything before the first `-`) and resolves all four paths from it.
3. Files missing for that prefix are silently omitted — no cross-session contamination.
4. Inlines `state.json` and `notes.txt` as text in the Gemini prompt; passes image and audio paths for the CLI's `read_file` tool.
5. Writes output to `Brainstorms/Idea-<timestamp>.md`.

### .gitignore bypass hack

The Gemini CLI refuses to read files that are excluded by `.gitignore` (`Brainstorms/` is gitignored to keep captures out of version control). The script works around this immediately before invoking `gemini`:

```bash
# Temporarily rename .gitignore so the CLI cannot see it
[[ -f "$GITIGNORE" ]] && mv "$GITIGNORE" "${GITIGNORE}.bak"

# A bash trap guarantees restoration on EXIT, INT, and TERM
trap 'restore_gitignore' EXIT INT TERM
```

After `gemini` exits (success, error, or Ctrl+C) the trap fires `restore_gitignore()`, which renames `.gitignore.bak` back to `.gitignore`. The file is never absent for more than the duration of the CLI run.

### Relevant files

| File | Role |
|---|---|
| `dev-catcher.js` | Express server; multer storage → `Brainstorms/`; runs on :5174 |
| `process-ideas.sh` | Bash synthesis script; timestamp grouping; gitignore bypass |
| `src/main.js` ~4004–4226 | `_dc*` vars, DevCaptureModal DOM, `Ctrl+Shift+D` keydown listener |
| `Brainstorms/` | Output directory (gitignored) |

---

> **AGENT RULE — DO NOT VIOLATE**
>
> **No AI agent may modify, refactor, disable, rename, or interfere with any part of the Dev Capture pipeline** (the `_dc*` block in `src/main.js`, `dev-catcher.js`, `process-ideas.sh`, or the `Brainstorms/` directory layout) **without explicit written permission from the project owner in the same conversation.** This includes "cleanup", "simplification", or "improvement" passes. The pipeline is intentionally minimal and must remain exactly as-is unless the owner requests a specific change.

---

## Session Log

### 2026-04-16 (Session 5)
- feat(hypercube): hypercube pipeline texture on faces (Session 2 complete)
- HypercubeFaces.js: MeshBasicMaterial replaced with ShaderMaterial, uFaceTexture / uOpacity / uHasTexture uniforms, samples pipeline texture per face quad, falls back to white when no texture assigned
- HypercubeObject.js: setFaceTexture(), setFaceOpacity(), setFacesVisible() proxy methods added
- SceneManager.js: passes inputs.faceTex to hypercube each frame in render()
- main.js: faceTex: pipeline.prev.texture added to scene3d.render() call; hypercube.faces.active (toggle) and hypercube.faces.opacity (continuous) registered with correct single-object form; onChange callbacks wired
- HypercubeUI.js: Faces toggle and Face opacity slider added to RENDER section
- Critical fix: all 12 hypercube param registrations corrected from two-arg form ps.register('id', {}) to single-object form ps.register({ id:'', ... }) — previously every param stored under key undefined, silently breaking all ps.get() lookups on hypercube params
- fix(scene3d): break GL_INVALID_OPERATION feedback loop by nulling face texture and mesh material.map before render pass (97e88e8)
- sw.js cache errors on video range requests: known PWA limitation, benign

### 2026-04-16 (Session 4)
- feat(hypercube): 2-cell face rendering — Session 1 complete
- Added generate2CellFaces(dim) to HypercubeGeometry.js
  Returns { corners:[i,i,i,i], axisA, axisB } for all C(dim,2)*2^(dim-2) faces
- Added HypercubeFaces.js (new file)
  InstancedMesh of PlaneGeometry(1,1), additive white material
  update() culls by axis/vertex count, computes centroid, size, normal per frame
  Module-level _zUp/_zAxis/_zeroMatrix avoid per-frame allocation
- Wired into HypercubeObject.js (4 lines: import, construct, update, dispose)
- 4D renders 24 faces correctly, rotating with the hypercube
- Session 2: setFaceTexture(), pipeline texture assignment, opacity/active params

### 2026-04-16 (Session 3)
- feat(hypercube): real screen-space edge width (commits 9823e07, a4a5fdb)
- Replaced LineSegments with quad Mesh — each edge is now 2 triangles
- Per-edge quad buffers: _quadEndABuf, _quadEndBBuf, _quadColBuf, _quadSideBuf, _quadIndexBuf
- Vertex shader extrudes perpendicular to line direction in clip space
- uResolution uniform synced from SceneManager each frame
- DoubleSide added to ShaderMaterial — back-face culling was killing quads
- Edge Width slider now produces real variable-width edges (0.5–8.0)
- gl_VertexID selects A/B endpoint per vertex; aSide drives extrusion direction

### 2026-04-16 (Session 2)
- feat(hypercube): edge width shader — Session 1 complete (commit b0d0820)
- Replaced LineBasicMaterial with ShaderMaterial on hypercube edges
- vertexColors flag removed (breaks GLSL compile on ShaderMaterial)
- uEdgeWidth uniform wired through _lineMat, updated each frame in _updateBuffers
- setEdgeWidth() public setter added, clamped 0.5–8.0
- hypercube.edgeWidth param registered in main.js, slider added to HypercubeUI.js
- Current behavior: value > 0.5 = visible, ≤ 0.5 = hidden (on/off stub)
- Session 2 will replace LineSegments with quad geometry for real screen-space width

### 2026-04-16 (Session 1)
- feat(scene3d): N-D Hypercube engine (4D–12D), 60fps at 12D
- HypercubeGeometry.js: vertex/edge generation, Givens projection, morph state machine, 5 easing functions
- HypercubeObject.js: Three.js wrapper, permanent Float32/Float64 buffers, zero per-frame allocation, _colorsDirty GPU gate, MAX_DIM draw range, circular points shader, vertex pub/sub
- HypercubeUI.js: dimension pills, collapsible rotation tiers, deferred DOM rebuild on morph
- SceneManager.js: createHypercube(), update integration
- 7 fix sessions: color offset, morph doubling, JS heap leak, GPU upload waste, missing edges, morph freeze

---

## Credits

Original Image/ine: Tom Demeyer and Steina Vasulka, STEIM Foundation, Amsterdam
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson
---
