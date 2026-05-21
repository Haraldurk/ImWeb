# GEMINI.md — ImWeb Development Context for Antigravity CLI

This file gives Antigravity CLI the context needed to contribute to ImWeb without breaking things.
Read CLAUDE.md for full project detail — this file covers your specific role and constraints.

---

## What this project is

ImWeb is a browser-based real-time video synthesis instrument — a reimagining of Tom Demeyer
and Steina Vasulka's Image/ine (STEIM Amsterdam, 1997/2008) for the modern browser.
Vite 5.4 + Three.js r160+ + vanilla JS. No framework. No TypeScript.

Running at localhost:5173 (`npm run dev`). Chrome 113+ required.

---

## Your role alongside other agents

| Task                                          | Agent       |
|-----------------------------------------------|-------------|
| Surgical JS/CSS edits, complex logic          | Claude Code |
| Pipeline.js, shader work, render loop         | Claude Code |
| Multi-file wiring, architecture changes       | Claude Code |
| grep, recon, reading large files              | Antigravity CLI |
| Browser screenshots for verification          | Antigravity CLI |
| GLSL review and documentation (not drafting)  | Antigravity CLI |
| CHANGELOG.md and all markdown/docs            | Antigravity CLI |
| CSS variable tweaks                           | Antigravity CLI |
| Git log / status checks                       | Antigravity CLI |

One agent per task. Do not duplicate work across agents.

---

## Tools typically available

- Chrome DevTools MCP — navigate, screenshot, console, network, Lighthouse
- File system — list_directory, glob, grep_search, read_file, write_file, replace
- Shell — run_shell_command for git, bash, Vite checks
- Web — google_web_search, web_fetch

Actual availability depends on how the session was launched. Verify before assuming.

---

## Rules

- NEVER rewrite whole JS files — surgical replace edits only
- write_file is acceptable ONLY for markdown / docs files
- One task per prompt
- NEVER add frameworks, transpilers, or bundler changes
- NEVER touch Pipeline.js or main.js render loop without explicit instruction
- NEVER hardcode API keys
- NEVER touch the Dev Capture pipeline (see protected zones below)

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
  cat file.imweb | python3 -c "
import json,sys
d=json.load(sys.stdin)
for bank in d.get('presets',[]):
  for i,s in enumerate(bank.get('states',[])):
    v=s.get('params',s.get('values',{})).get('scene3d.geo','MISSING')
    print(f'{bank[\"name\"]} state {i}: scene3d.geo={v}')"
```

---

## PROTECTED ZONES — DO NOT TOUCH

No AI agent may modify, refactor, disable, rename, or interfere with any part of the
Dev Capture pipeline without explicit written permission from the project owner in the
same conversation. This includes:

- The `_dc*` block in `src/main.js`
- `dev-catcher.js`
- `process-ideas.sh`
- The `Brainstorms/` directory layout

This prohibition covers "cleanup", "simplification", and "improvement" passes.
The pipeline is intentionally minimal and must remain exactly as-is.

---

## Standard workflow

Before touching anything:

1. `git log --oneline -5`
2. `git status`
3. Read the relevant file(s)

After every change:

1. Check Vite console for errors (`npm run dev` output)
2. Take a Chrome DevTools screenshot to confirm visual result
3. `git add [files] && git commit -m "[message]" && git push`
4. Report: what changed, what the screenshot confirms, any console warnings

---

## Conventional commit messages

```
feat:     new capability
fix:      bug correction
docs:     markdown / comments only
refactor: restructure without behaviour change
chore:    deps, config, tooling
style:    CSS only, no logic change
```

---

## Current version

See CHANGELOG.md for current version and recent changes.

---

## Project structure (approximate — run `find src -name '*.js' | sort` for current list)

```
src/
  main.js               Bootstrap, render loop, all feature wiring (~5400 lines)
  style.css             All styles — dark performance UI
  ai/
    AIFeatures.js       Switchable AI provider (Anthropic/Gemini/OpenAI/Ollama)
  controls/
    ParameterSystem.js  All parameters declared here; reactive onChange
    ControllerManager.js Mouse, MIDI, LFO, Sound, Key, Random, Expression, Gamepad, Wacom, OSC
    LFO.js              Sine/Triangle/Sawtooth/Square/S&H + beat sync
    Automation.js       Record/play parameter movements
  core/
    Pipeline.js         WebGL compositing chain — all render passes
  shaders/
    index.js            All GLSL effect shaders as named exports
  inputs/
    CameraInput.js      WebRTC getUserMedia → VideoTexture
    MovieInput.js       Video file → VideoTexture; speed/loop/BPM sync
    StillsBuffer.js     Frame capture store
    SlitScanBuffer.js   Rolling slit scan effect
    SDFGenerator.js     GPU-raymarched SDF metaballs → WebGLRenderTarget
    TextLayer.js        Canvas 2D text → Texture
    DrawLayer.js        Freehand canvas → Texture (Wacom pressure)
    ParticleSystem.js   GPU particle field
    VasulkaWarp.js      Temporal strip-buffer slit-scan — EXPERIMENTAL, hidden from UI
  io/
    ProjectFile.js      .imweb JSON save/load — full session
    OSCBridge.js        WebSocket ↔ UDP OSC relay
    LUTLoader.js        .cube file import
  scene3d/
    SceneManager.js     Three.js 3D scene → RenderTarget
    GeometryFactory.js  13 procedural geometry generators
  state/
    Preset.js           Presets + 64 States per Bank, IndexedDB
  ui/
    UI.js               All UI builders: param rows, tabs, signal path,
                        context menus, seq cards, WarpMap editor,
                        sidebar state management, controller badge popovers
```

---

## Key CSS variables

```
--text-1: #e0e0f0        primary text
--text-2: #8888a0        muted/inactive text
--accent: #c8a020        primary yellow
--accent-dim: #8c7a28    dimmed accent
--bg-1: #12121a          main background
--bg-2: #18181f          panel background
--bg-3: #1f1f25          section background
--bg-4: #26262e          hover state
```
