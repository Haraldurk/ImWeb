# CLAUDE.md — ImWeb Development Context

This file gives Claude Code the context needed to contribute effectively to ImWeb. Read it fully before touching anything.

---

## Editing Rules

- CLAUDE.md and imweb-obsidian.md are READ-ONLY for Claude Code.
  Never modify either file unless the project owner explicitly instructs
  it in the same conversation with the exact lines to change.

- Always run grep/search recon BEFORE editing any file. Verify the exact code block exists and check for duplicates or related code that may be affected.
- When implementing features, write code immediately after a brief targeted recon (max 5-10 tool calls). Do NOT spend an entire session exploring without producing code unless explicitly asked to explore only.

## Project reference
Full project knowledge base: `imweb-obsidian.md` (project root). 
Read it for feature status, architecture decisions, and open questions.

---

## What this project is

**ImWeb** is a browser-based real-time video synthesis instrument — a reimagining of Tom Demeyer and Steina Vasulka's *Image/ine* (STEIM Amsterdam, 1997/2008) for the modern browser. It is not a port or recreation — it is a new instrument in the same lineage.

The instrument composites video sources through a signal chain of effects and renders to a WebGL canvas.

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
SDFGenerator.js       GPU-raymarched SDF metaballs → WebGLRenderTarget
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

main.js is the integration hub (~5400 lines). Most feature wiring lives here. Do not split it without a clear architectural reason.

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

## Git Workflow

After completing each task, commit with a descriptive message and move to the next task. Follow git discipline: commit early and often.

Session continuity is handled by context-mode (MCP). Do not add session logging to CLAUDE.md.

---

## AI Workflow Boundaries

- **Claude Code** (this instance): surgical JS edits, multi-file wiring, Pipeline/shader work
- **Gemini CLI**: CHANGELOG.md and documentation only — never JS
- **OpenCode/DeepSeek**: exploration, recon, grep-heavy investigation — never edits
- **Claude Chat**: architecture decisions, planning, CLAUDE.md review

One agent per task. Do not duplicate work across agents.

---

### Experimental / architecture deferred
See CHANGELOG.md for current version and full history.
- **VasulkaWarp (temporal slit-scan)**: VasulkaWarp.js + `vwarp.*` params exist and run, but
  the feature is hidden from UI pending a clearer architecture decision. The strip-buffer
  approach works but conflicts with the pipeline source model. Candidate future direction:
  treat it as a Sequence slot backed by disk/IndexedDB rather than a live GPU ring buffer.
- **VASULKA_WARP shader**: exists in Pipeline, hidden from signal path and UI until wired
  to a proper effect slot with a UI section.

---

Chrome 113+ recommended. Firefox and Safari work with minor WebGL limitations.

---

## MasterProject System

### What it is
`public/Projects/MasterProject.imweb` is the factory default project. It is a standard `.imweb` project file (JSON) that gets loaded automatically on the very first launch (when IndexedDB is empty). Returning users keep their own saved state from IndexedDB — MasterProject is only applied once, on a fresh browser.

Users can also restore it explicitly via **Project tab → ⟳ Restore MasterProject** (shows a confirmation warning before wiping current state).

### Developer workflow — updating MasterProject
1. Open ImWeb and build the desired default state (banks, states, params, tables).
2. In the **Project tab**, click **📤 Save as MasterProject [DEV]** — this downloads `MasterProject.imweb` to your Downloads folder.
3. Move/copy the downloaded file to `public/Projects/MasterProject.imweb`, replacing the old one.
4. Run `npm run push-master` — stages, commits (if needed), and pushes in one step.
   Optional: run `npm run install-hooks` once per clone to enable automatic push
   whenever any commit includes MasterProject.imweb.

That's all. The next first-launch (fresh browser / cleared IndexedDB) will load the new version.

### Key files
| File | Role |
|---|---|
| `public/Projects/MasterProject.imweb` | Factory default project (served as static asset) |
| `src/io/ProjectFile.js` | `importFromURL(url)` — fetches and applies a project from a URL |
| `src/io/ProjectFile.js` | `exportAsMasterProject()` — downloads current project as MasterProject.imweb |
| `src/state/Preset.js` | `presetMgr._firstLaunch` — true when IndexedDB was empty on init() |
| `src/main.js` | First-launch load block (~line 1680); Project file UI with both buttons |

### Architecture note
`DemoPresets.js` is no longer used in the boot sequence. `presetMgr.init()` sets `_firstLaunch = true` when IndexedDB is empty and creates a blank Bank 0. `main.js` then immediately calls `projectFile.importFromURL('/Projects/MasterProject.imweb')` to populate it. If the fetch fails (e.g. file missing), a warning is logged and the app starts with a blank bank — no crash.

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
