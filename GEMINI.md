# GEMINI.md — ImWeb Development Context for Antigravity CLI

This file gives Antigravity CLI the context needed to contribute to ImWeb without breaking things.
Read CLAUDE.md for full project detail — this file covers your specific role and constraints.

> **Last verified against the repo: 2026-08-14, at v0.19.0.** Every version number,
> path and colour below was checked on that date rather than remembered. If you
> are reading this much later, re-check before quoting it — the previous revision
> of this file claimed Vite 5.4 and a 5400-line main.js long after both had moved,
> and a stale fact in an instruction file is worse than an absent one, because it
> gets used with confidence.

---

## What this project is

ImWeb is a browser-based real-time video synthesis instrument — a reimagining of Tom Demeyer
and Steina Vasulka's Image/ine (STEIM Amsterdam, 1997/2008) for the modern browser.
**Vite 8** + **Three.js r168** + vanilla JS. No framework. No TypeScript.

It now has an **audio half** as well as a video one: an AudioWorklet engine with a
tape, partitions, recording and playback zones, a spectral writer, a corpus index
and a grain player. See `docs/ImWeb-Audio-Blueprint.md` — that document is the
design of record and is written to, not just read.

Dev server at `localhost:5173` (`npm run dev`). Chrome 113+ required.
**Do not start a second dev server** — see the advisory lessons below; a different
port is a different origin, and localStorage splits across it.

---

## Your role alongside other agents

| Task                                          | Agent       |
|-----------------------------------------------|-------------|
| Surgical JS/CSS edits, complex logic          | Claude Code |
| Pipeline.js, shader work, render loop         | Claude Code |
| Audio engine / worklet / protocol             | Claude Code |
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
- **NEVER commit to `main`.** Branch first, land through a PR — see the workflow below

---

## Debugging Protocols

These rules apply to all AI agents working on ImWeb. They come from hard-won
session experience and must be followed before writing any fix prompt.

### Read the live `[advisory]` lessons first

`docs/LEARNED.md` tags every lesson by whether it has been made mechanical:
`[audit]` runs in `npm test`, `[hook]` *is* a git hook, `[skill]` is a step in a
skill, `[tool]` is executable on demand. Those defend themselves whether you have
read them or not.

**`[advisory]` is the tag with no mechanism.** It works only if the agent knows
it, which makes those entries the ones that bite silently. Claude Code has them
injected at session start by `.claude/hooks/session-advisory.sh`; you do not run
that hook, so pull them yourself:

```bash
grep -E '^- [0-9]{4}-[0-9]{2}-[0-9]{2} \[advisory\]:' docs/LEARNED.md
```

They are dated, and an entry reaching 90 days fails
`tests/audit-learned-advisory-age.mjs`, so the list stays short deliberately.

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
- The `Brainstorms/` directory layout

This prohibition covers "cleanup", "simplification", and "improvement" passes.
The pipeline is intentionally minimal and must remain exactly as-is.

> The previous revision also listed `dev-catcher.js` and `process-ideas.sh`.
> **Neither exists in the repo today.** They are left out rather than left in:
> a protected-zone list naming files that are absent teaches the reader that the
> list is approximate, which is the opposite of what a prohibition needs.

---

## Testing — this repo has real enforcement now

```bash
npm test          # ~1200 checks across 32 audits. Must be green before any push.
npm run mutate    # proves the audits can FAIL — see below
```

A **pre-push git hook** runs `npm test` and blocks the push if it is red, and CI
re-runs it on every PR. Install the hooks with `npm run install-hooks`.

`npm run mutate` is the mutation harness: it breaks the code in specific,
committed ways (`tests/mutations.mjs`) and asserts the matching audit goes red.
It restores from bytes held in memory, so **uncommitted work in a mutated file
survives** — it is the safe way to probe, and much safer than `git checkout`,
which restores from the index and has destroyed hours of work in this repo.

If you add or change an audit, land its mutation registry entries in the same PR.
An audit that claims calibration without them is a number nobody can re-derive.

---

## Standard workflow

Before touching anything:

1. `git log --oneline -5`
2. `git status`
3. Read the relevant file(s)

Making the change:

1. **Branch first** — `git switch -c <type>/<short-name>`. Never commit to `main`.
2. Make the edit
3. `npm test` — green, or stop
4. Check the Vite console for errors, and take a Chrome DevTools screenshot to
   confirm the visual result
5. Commit, push the branch, and open a PR with `gh pr create`
6. **Opening the PR is where the task ends.** Do not merge unless asked.
7. **Name yourself on the commit** — end the message with
   `Co-Authored-By: Gemini 3 Pro <noreply@ai-assisted.invalid>`, using the model
   you actually are. The `prepare-commit-msg` hook does this for you when
   `AI_MODEL` is exported; append it by hand if it is not. Claude Code stamps
   itself and nothing else did, so the history credited one model for work six
   tools shared — do not let that go on being true.
7. Report: what changed, what the screenshot confirms, any console warnings

> The previous revision ended step 3 with `git add … && git commit && git push`
> straight onto whatever branch you were on. That predates the PR workflow, the
> pre-push hook and CI.

---

## Conventional commit messages

```
feat:     new capability
fix:      bug correction
docs:     markdown / comments only
refactor: restructure without behaviour change
chore:    deps, config, tooling
style:    CSS only, no logic change
test:     audits, mutation registry, harness
```

---

## Current version

v0.19.0. See CHANGELOG.md for recent changes, and `docs/LEARNED.md` for the
lessons log.

---

## Project structure (approximate — run `find src -name '*.js' | sort` for current list)

```
src/
  main.js               Bootstrap, render loop, all feature wiring (~8900 lines)
  style.css             All styles — dark performance UI
  soak.js               Long-run soak harness
  perf-logger.js        Frame timing capture
  ai/
    AIFeatures.js       Switchable AI provider (Anthropic/Gemini/OpenAI/Ollama)
  audio/                THE AUDIO HALF — see docs/ImWeb-Audio-Blueprint.md
    AudioEngine.js      Owns the ONE AudioContext; worklet lifecycle
    AudioBinding.js     The only module that sees both halves; params <-> protocol
    protocol.js         The OSC-representable message vocabulary (PROTO_VERSION 5)
    engine/
      tape-processor.js The AudioWorklet — zero imports by construction
    spectral-image.js   Scales and pan modes — client-side, never on the wire
    corpus-index.js     The descriptor map (§4.6)
    graph-view.js       The audio row for the signal path display
    TapeView.js         Tape + partitions + zones display
    CorpusView.js       The corpus pad
    tape-geometry.js    Shared span arithmetic
    ctrl-handoff.js     Controller descriptions handed to the worklet (§8.7)
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
    VasulkaWarp.js      Temporal strip-buffer slit-scan
  particles/            GPU particle field, force fields, video analysis
  io/
    ProjectFile.js      .imweb JSON save/load — full session
    OSCBridge.js        WebSocket ↔ UDP OSC relay
    LUTLoader.js        .cube file import
  scene3d/
    SceneManager.js     Three.js 3D scene → RenderTarget
    GeometryFactory.js  14 procedural geometry generators
  state/
    Preset.js           Presets + 64 States per Bank, IndexedDB
  ui/
    UI.js               Param rows, tabs, signal path, context menus,
                        seq cards, WarpMap editor, controller badge popovers
    Guide.js            Guided tour
    ColorPicker.js      HSV pickers
    bindings/ components/ layout/   extracted UI pieces
    touch.js            Gesture arbitration
```

> **`VasulkaWarp.js` is no longer hidden from the UI.** Phase 24 gave it a panel
> under "From the Signal" in the Sources tab; the rule is that a routable source
> gets visible UI. The previous revision still described it as hidden.

---

## Key CSS variables

**Phase 24 changed the text and accent colours for contrast** — the values below
are the current ones, read from `src/style.css`. The previous revision listed the
pre-Phase-24 palette, which fails the contrast ratio the change was made to fix.

```
--text-1: #c2c2d6        primary text
--text-2: #a6a6c0        muted/inactive text
--accent: #e8c840        primary yellow
--accent-dim: #8c7a28    dimmed accent
--bg-1: #111114          main background
--bg-2: #18181c          panel background
--bg-3: #1f1f25          section background
--bg-4: #26262e          hover state
```
