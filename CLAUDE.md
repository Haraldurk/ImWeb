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
Full project knowledge base: `docs/imweb-obsidian.md` (project root). 
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

### Live GLSL & AI Subsystem
- **Live GLSL Editor:** Uses CodeMirror 6. Must gracefully catch syntax errors via a last-good compile fallback to ensure the master render loop is never dropped.
- **AI Shader Generation:** Natural-language-to-GLSL pipeline utilizing `claude-sonnet-5` via the Anthropic API.
- **Safety Nets:** API calls must include an empty-response abort to prevent the WebGL compiler from crashing on blank strings. All AI prompts must enforce strict WebGL 1.0 / GLSL ES 1.00 syntax.
- **Preset bank (`glsl.preset`):** SELECT param mirroring the preset dropdown (built-ins + localStorage `imweb.glslUserPresets`, `user:`-prefixed). Declared `group: 'global'` deliberately — excludes it from Display State capture (the value is an index into a user-editable list; saved states would drift) and it is filtered out of the auto-built global-params panel in UI.js. Controller-driven recalls always compile (the Auto checkbox gates only the manual dropdown path). Options sync happens in `_rebuildUserGlslOptions()` (main.js) — keep it there if the save/delete paths change.
- **GLSL preset row grammar:** badge (assign via right-click on the "Preset:" label → context menu; edit via badge → popover), min/max recall-range fields writing `ctrlMin`/`ctrlMax` as index bounds.
- **Response tables:** table resolution (incl. the `'global'` tableSlot) lives in `Parameter.setNormalized` via `_resolveTable()` — do NOT add per-call-site table lookups in ControllerManager; both write paths (`ps.setNormalized` and direct `p.setNormalized`) must stay identical.
- **User presets are per-origin:** localStorage keys split across ports (5173 vs 4173 vs a bumped 5174). "Lost presets" almost always means "different origin" — check before assuming data loss.

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

## Debugging Protocols

These rules apply to all AI agents working on ImWeb. They come from hard-won
session experience and must be followed before writing any fix prompt.

### Save / Load bugs
1. Ask for the serialized file FIRST (.imweb, .imbank, .imstate, .json).
   Read the data before reading any code. The file is the ground truth —
   if modelAsset is absent from the JSON, no amount of code reading will
   reveal why the model isn't loading.
2. Ask "how was the asset loaded?" before assuming anything about the
   loading method. Drag-drop and URL-load are different code paths with
   different persistence behaviour. One question saves three fix loops.

### Before writing any Claude Code prompt
1. Verify every variable name in the actual source file before putting it
   in a prompt. Never guess a reference name (this.sm vs this.extras.scene3d
   vs sceneManager) — grep or read the file first. One wrong name costs
   an entire session loop.
2. State one way the fix could still fail before sending the prompt.
   Per the Guard Logic Rules above: if you cannot answer this, the fix
   is not fully understood.

### One task per prompt — hard rule
If a task feels like it needs two prompts, it does. Split it. A prompt
that touches two separate things produces one correct fix and one subtle
regression that costs twice as long to find.

### Serialized file inspection commands
Quick reads for common ImWeb file types:

```bash
  # Check what a .imweb file actually contains:
  cat file.imweb | python3 -c "import json,sys; d=json.load(sys.stdin);
    print('banks:', len(d.get('presets',[])));
    print('scene3d:', d.get('scene3d',{}));
    print('activePreset:', d.get('activePreset'))"

  # Check if modelAsset is present:
  cat file.imweb | python3 -c "import json,sys;
    t=sys.stdin.read(); print('modelAsset present:', 'modelAsset' in t)"

  # Check all states in a bank for a specific param:
  cat file.imweb | python3 -c \"
import json,sys
d=json.load(sys.stdin)
for bank in d.get('presets',[]):
  for i,s in enumerate(bank.get('states',[])):
    v=s.get('params',s.get('values',{})).get('scene3d.geo','MISSING')
    print(f'{bank[\"name\"]} state {i}: scene3d.geo={v}')\"
