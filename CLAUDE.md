# CLAUDE.md — ImWeb Development Context

This file gives Claude Code the context needed to contribute effectively to ImWeb. Read it fully before touching anything.

---

## Document hierarchy

| File | Role |
|---|---|
| `CLAUDE.md` (this file) | Agent rules + architecture invariants + pointers. Lean — loaded every session. |
| `docs/WORKFLOW.md` | Canonical multi-agent workflow (tool roster, prompt template, rituals). Supersedes all previous workflow docs. |
| `KNOWN-ISSUES.md` | Canonical active issues + resolved history. Read before touching related code. |
| `docs/LEARNED.md` | Append-only lessons log. Wins over CLAUDE.md on conflict. |
| `docs/imweb-obsidian.md` | Full project knowledge base: feature status, architecture decisions, open questions. |

---

## Editing Rules

- CLAUDE.md, docs/WORKFLOW.md, KNOWN-ISSUES.md, and docs/imweb-obsidian.md may only be modified during an owner-declared **consolidation session** for that file — the project owner must explicitly state it in the same conversation. Exception: adding new issues to KNOWN-ISSUES.md or moving fixed ones to its Resolved table (per its own header) is allowed in normal sessions.
- docs/LEARNED.md is the designated append-only file for lessons. Never add lessons to CLAUDE.md directly.
- Always run grep/search recon BEFORE editing any file. Verify the exact code block exists and check for duplicates or related code that may be affected.
- When implementing features, write code immediately after a brief targeted recon (max 5-10 tool calls). Do NOT spend an entire session exploring without producing code unless explicitly asked to explore only.

## Self-Learning
- When the project owner corrects you, or you catch yourself making a
  mistake: finish the current fix first, then append ONE line to
  docs/LEARNED.md. Format:
  `- YYYY-MM-DD: <rule> (trigger: <what went wrong>)`
- Keep it general enough to prevent recurrence, specific enough to be
  actionable. If a similar lesson already exists in LEARNED.md, refine
  it instead of duplicating.
- NEVER add lessons to CLAUDE.md directly. CLAUDE.md remains READ-ONLY
  outside owner-authorized consolidation sessions.
- At session start: read CLAUDE.md, then docs/LEARNED.md. LEARNED.md
  wins on conflict.

---

## What this project is

**ImWeb** is a browser-based real-time video synthesis instrument — a reimagining of Tom Demeyer and Steina Vasulka's *Image/ine* (STEIM Amsterdam, 1997/2008) for the modern browser. It is not a port or recreation — it is a new instrument in the same lineage.

The instrument composites video sources through a signal chain of effects and renders to a WebGL canvas.

Current release: **v0.11.0** (touch & ergonomics overhaul). Next planned: dual-deck A/B video — blueprint at `docs/ImWeb-DualDeck-v0.12-Blueprint.md`.

---

## Tech stack

| Layer       | Technology                                                      |
|-------------|-----------------------------------------------------------------|
| Renderer    | Three.js r160+ (WebGL, WebGLRenderTarget ping-pong)             |
| Build       | Vite 5.4 (ES modules, HMR)                                      |
| UI          | Vanilla JS + DOM; no React/Vue                                  |
| Style       | src/style.css; CSS variables for theming                        |
| Persistence | IndexedDB (presets, tables); localStorage (AI config, settings) |
| Input       | WebRTC (camera), File API, Web MIDI API, touch/pen pointer events |
| Audio       | Web Audio API (AnalyserNode FFT/VU)                             |
| AI          | Switchable provider (Anthropic / Gemini / OpenAI / Ollama)      |

Useful npm scripts: `dev` (http :5173), `dev:https` (iPad — camera/mic/motion need secure origin), `sync-docs` (copies manuals → public/docs), `push-master`, `install-hooks` (`scripts/install-hooks.sh`).

---

## Project structure
src/
  main.js                   Bootstrap, render loop, all feature wiring (~6400 lines)
  style.css                 All styles — dark performance UI
  perf-logger.js            Performance logging utility
  ai/
    AIFeatures.js           AI provider system (Anthropic/Gemini/OpenAI/Ollama)
  controls/
    ParameterSystem.js      All parameters declared here; reactive onChange
    ControllerManager.js    Mouse, MIDI, LFO, Sound, Key, Random, Expression,
                            Gamepad, Wacom, OSC, Monty drivers
    LFO.js                  Sine/Triangle/Sawtooth/Square/S&H + beat sync
    Automation.js           Record/play parameter movements, loop playback
    StepSequencer.js        Step-based preset sequencer
    BeatDetector.js         Auto-BPM from onset detection
  core/
    Pipeline.js             WebGL compositing chain — all render passes
    GestureArbitrator.js    Mode-based touch grammar for the output canvas
                            (touch.mode: Camera/Pad/Locked; 3-finger clutch)
  shaders/
    index.js                All GLSL effect shaders as named exports
    analog_crt.frag         CRT scanline/phosphor shader
    analog_source_signal.frag  Analog signal generation shader
  inputs/
    CameraInput.js          WebRTC getUserMedia → VideoTexture
    MovieInput.js           Video file → VideoTexture; speed/loop/BPM sync
    StillsBuffer.js         Frame capture store
    SlitScanBuffer.js       Rolling slit scan effect
    SequenceBuffer.js       Sequence recorder + timewarp mode (slit-scan temporal)
    TimeDisplaceEngine.js   Time-displacement source (`tdisp` slot)
    SDFGenerator.js         GPU-raymarched SDF metaballs → WebGLRenderTarget
    TextLayer.js            Canvas 2D text → Texture
    DrawLayer.js            Freehand canvas → Texture (Wacom pressure)
    ParticleSystem.js       GPU particle field (legacy entry point)
    VasulkaWarp.js          Temporal strip-buffer slit-scan — EXPERIMENTAL, hidden
    WarpMapEditor.js        Interactive WarpMap brush editor
    WarpMaps.js             Procedural warp map generators
    VideoDelayLine.js       Frame delay buffer
    AnalogTV.js             Analog TV / CRT simulation source
    AnalogParams.js         Analog TV parameter declarations
    AnalogPresets.js        Analog TV factory presets
    TeletextSource.js       Teletext input source → WebGLRenderTarget
    TeletextUI.js           Teletext UI builder
    TeletextParams.js       Teletext parameter declarations
    teletext_draw.js        Teletext drawing utilities
    teletext_pages/         Teletext page data files
    VectorscopeInput.js     Audio visualiser (Lissajous/Waveform/FFT)
  particles/
    ParticleEngine.js       Main particle engine coordinator
    ParticleGPU.js          GPU-accelerated particle simulation
    ParticleRender.js       Particle render pass
    ForceField.js           Force field system (attractors/repulsors)
    ForceFormulas.js        Force calculation library
    GhostNodes.js           Ghost node effects
    VideoAnalysis.js        Video-reactive particle input
    PointerPerf.js          Pointer/touch performance utilities
  io/
    ProjectFile.js          .imweb JSON save/load — full session
    OSCBridge.js            WebSocket ↔ UDP OSC relay
    MontyBridge.js          Monty controller bridge → ControllerManager signal
                            (see docs/Monty Manual.md)
    CubeLoader.js           .cube LUT file import
    ClipLibrary.js          128-slot clip library (8 banks × 16, MIDI note mapping)
    ImXImporter.js          Legacy ImX project file importer
  scene3d/
    SceneManager.js         Three.js 3D scene → RenderTarget
    GeometryFactory.js      13 procedural geometry generators
    HypercubeGeometry.js    N-dimensional vertex/edge generation
    HypercubeObject.js      Hypercube render object (edges, points)
    HypercubeFaces.js       Hypercube 2-cell face rendering
    HypercubeInstancer.js   InstancedMesh at hypercube vertex positions
    HypercubeUI.js          Hypercube UI builder
  state/
    Preset.js               Presets + 128 States per Bank, IndexedDB
    TableManager.js         Response curve table management (16,384 pt)
    DemoPresets.js          Legacy demo presets (not used in boot sequence)
  ui/
    UI.js                   Tab/panel builders, signal path, context menus,
                            seq cards; re-exports componentized pieces
    components/
      ParamRow.js           Parameter row builder (label/badge/min/max/value)
      CtrlPopover.js        Controller badge popover (openCtrlPopover)
      MobileStatePad.js     Mobile state pad modal
      Select.js             Select component
    bindings/ParamBinding.js  Param ↔ DOM binding layer
    layout/LayoutManager.js   Panel/layout management
    touch.js                Shared touch constants/utilities
    ColorPicker.js          HSV colour picker component

main.js is the integration hub (~6400 lines). Most feature wiring lives here. Do not split it without a clear architectural reason.

### Architecture Notes
- Pipeline.js (src/core/Pipeline.js) owns the noise material uniform init block and the generateNoise() setter — NOT main.js. main.js only contains the call site and event listeners.
- Noise shader lives at src/shaders/index.js (not src/core/shaders/)
- Touch input on the output canvas is routed exclusively through GestureArbitrator (single-writer rule: one gesture owner per pointer — never add a second handler that writes the same params).

---

## Key conventions

### Parameters
All controllable values live in ParameterSystem. Each has a namespace (e.g. movie.speed, seq1.source). Types:
- CONTINUOUS — float with min/max/step
- TOGGLE — boolean
- SELECT — integer index into options array
- TRIGGER — fire-once event

Declare new params in ParameterSystem.js using the single-object form: `{ id, type, min, max, step, ... }` — one object per param, matching the surrounding declarations.

Read: ps.get('name').value
Write: ps.set('name', v) — fires onChange callbacks

**Append-only lists:** source-slot lists and SELECT options arrays are append-only. Add new entries at the true end — never reorder or insert mid-list. Indices are persisted in saved states/projects; reordering corrupts every existing preset.

### Controllers
Each parameter can have one controller assigned. Controller object shape: { type: 'random'|'lfo'|'fixed'|'midi'|..., hz, slew, tableId, value, ... }. Settings edited via badge popover (right-click or Ctrl+click on badge in param row).

### Parameter row UI pattern (src/ui/components/ParamRow.js)
[label]  [ctrlBadge]  [minField]  [maxField]  [valueDisplay]
- ctrlBadge — shows controller type (RND, LFO, MIDI…); right-click → openCtrlPopover (src/ui/components/CtrlPopover.js)
- minField / maxField — drag (ns-resize cursor) or double-click to type; enforce min≤max
- Drag delta: (startY - currentY) × 0.1; Shift = × step
- Double-click opens inline text input; Enter commits, Escape cancels
- Touch: double-tap value field opens precision type-in editor (iOS-safe — no `pattern` attr, serves decimal pad)

### Controller badge popover (CtrlPopover.js)
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
4. UI: add builder to UI.js (or a component under src/ui/components/), call from main.js
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
- Do not reorder SELECT options or source-slot lists (see Append-only lists above)

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

## Debugging Protocols

### Save / Load bugs
1. Ask for the serialized file FIRST (.imweb, .imbank, .imstate, .json).
   Read the data before reading any code. The file is the ground truth.
2. Ask "how was the asset loaded?" before assuming anything about the
   loading method. Drag-drop and URL-load are different code paths with
   different persistence behaviour.

### Before writing any fix
1. Verify every variable name in the actual source file before using it.
   Never guess a reference name (this.sm vs this.extras.scene3d vs
   sceneManager) — grep or read the file first.
2. State one way the fix could still fail before implementing.
3. One task per prompt — hard rule. If a task feels like it needs two
   prompts, it does. Split it.

### Serialized file inspection

```bash
# Check what a .imweb file actually contains:
cat file.imweb | python3 -c "import json,sys; d=json.load(sys.stdin);
  print('banks:', len(d.get('presets',[])));
  print('scene3d:', d.get('scene3d',{}));
  print('activePreset:', d.get('activePreset'))"

# Check if a key is present anywhere:
cat file.imweb | python3 -c "import json,sys;
  t=sys.stdin.read(); print('modelAsset present:', 'modelAsset' in t)"
```

---

## Git Workflow

After completing each task, commit with a descriptive message and move to the next task. Session continuity is handled by context-mode (MCP). Do not add session logging to CLAUDE.md.

---

## AI Workflow

Canonical multi-agent workflow (tool roster, prompt template, session rituals, recon pattern) lives in **`docs/WORKFLOW.md`** — read it before multi-agent sessions.
Hard rule kept here: **one agent per task; do not duplicate work across agents.**

---

## Browser Verification — verdict-cli

verdict-cli (installed globally; `Bash(verdict:*)` already permitted) is a token-efficient headless Chromium CLI for DOM and logic verification:
- JS console errors after any main.js edit (`verdict console`)
- localStorage flags (`verdict js "localStorage.getItem(...)"`)
- UI elements exist after wiring (`verdict snapshot -i`)
- Smoke-test app load at localhost:5173

**Limits:** headless Chromium — no ANGLE Metal backend, no H.264 decode, throttled timers/rAF. It CANNOT verify WebGL rendering, shader output, 3D geometry, or any visual pixel output. Never treat a passing snapshot as rendering confirmation.

Workflow boundary:

    Claude Code edits → verdict: DOM/console/localStorage checks
                      → human: visual confirmation in real Chrome (Metal)
                      → Claude Chat: diagnosis from screenshots/logs → next patch

---

## Known issues

Active issues and resolved history live in **`KNOWN-ISSUES.md`** (repo root). Read it before touching related code; when you fix an issue, move it to the Resolved table there.

### Experimental / architecture deferred
- **VasulkaWarp (temporal slit-scan)**: VasulkaWarp.js + `vwarp.*` params exist and run, but the feature is hidden from UI pending an architecture decision (strip-buffer approach conflicts with the pipeline source model — details in KNOWN-ISSUES.md).
- **VASULKA_WARP shader**: exists in Pipeline, hidden from signal path and UI until wired to a proper effect slot with a UI section.

Chrome 113+ recommended. Firefox and Safari work with minor WebGL limitations.

---

## MasterProject System

### What it is
`public/Projects/MasterProject.imweb` is the factory default project. It is a standard `.imweb` project file (JSON) that gets loaded automatically on the very first launch (when IndexedDB is empty). Returning users keep their own saved state from IndexedDB — MasterProject is only applied once, on a fresh browser.

Users can also restore it explicitly via **Project tab → ⟳ Restore MasterProject** (shows a confirmation warning before wiping current state).

### Developer workflow — updating MasterProject
1. Open ImWeb and build the desired default state (banks, states, params, tables).
2. In the **Project tab**, click **📤 Save as MasterProject [DEV]** — downloads `MasterProject.imweb`.
3. Copy it to `public/Projects/MasterProject.imweb`, replacing the old one.
4. Run `npm run push-master` — stages, commits (if needed), and pushes in one step.
   Optional: `npm run install-hooks` once per clone for automatic push on any commit that includes MasterProject.imweb.

### Key files
| File | Role |
|---|---|
| `public/Projects/MasterProject.imweb` | Factory default project (served as static asset) |
| `src/io/ProjectFile.js` | `importFromURL(url)` / `exportAsMasterProject()` |
| `src/state/Preset.js` | `presetMgr._firstLaunch` — true when IndexedDB was empty on init() |
| `src/main.js` | First-launch load block (~line 1866); Project file UI with both buttons |

### Architecture note
`DemoPresets.js` is not used in the boot sequence. `presetMgr.init()` sets `_firstLaunch = true` when IndexedDB is empty and creates a blank Bank 0. `main.js` then calls `projectFile.importFromURL('/Projects/MasterProject.imweb')` to populate it. If the fetch fails, a warning is logged and the app starts with a blank bank — no crash.

---

## Dev Capture System

A local-only multimodal brainstorming pipeline for capturing ideas during live performance sessions.
**Development-only. Never shipped in the production build.**

**Important:** the server/script side — `dev-catcher.js` and `process-ideas.sh` — is **local-only and untracked** (gitignored; absent from fresh clones). Only the browser-side modal lives in the repo.

### How it works
- `Ctrl + Shift + D` in the browser toggles the Dev Capture Modal (keydown listener at `src/main.js` ~line 6164; `_dc*` block ~lines 5919–6170).
- The modal POSTs screenshot + audio + state JSON + notes to `dev-catcher.js` (Express, port 5174), which writes timestamp-prefixed files (`<unix-ts>-screenshot.png`, `-audio.webm`, `-state.json`, `-notes.txt`) to `Brainstorms/` (gitignored).
- `./process-ideas.sh` finds the newest capture group and synthesises a Markdown spec via the Gemini CLI to `Brainstorms/Idea-<ts>.md`. It temporarily renames `.gitignore` (with a trap guaranteeing restoration) because the Gemini CLI refuses to read gitignored files.
- Harmless if :5174 is not running.

Three processes: ImWeb (Vite :5173, `npm run dev`) · Dev Catcher (Express :5174, `node dev-catcher.js`) · Gemini CLI (`./process-ideas.sh`).

---

> **AGENT RULE — DO NOT VIOLATE**
>
> **No AI agent may modify, refactor, disable, rename, or interfere with any part of the Dev Capture pipeline** (the `_dc*` block in `src/main.js`, `dev-catcher.js`, `process-ideas.sh`, or the `Brainstorms/` directory layout) **without explicit written permission from the project owner in the same conversation.** This includes "cleanup", "simplification", or "improvement" passes. The pipeline is intentionally minimal and must remain exactly as-is unless the owner requests a specific change.

---
