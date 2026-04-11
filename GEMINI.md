# GEMINI.md — ImWeb Development Context for Gemini CLI

This file gives Gemini CLI the context needed to contribute to ImWeb without breaking things. Read CLAUDE.md for full project detail — this file covers your specific role and tools.

---

## What this project is

ImWeb is a browser-based real-time video synthesis instrument — a reimplementation of Tom Demeyer and Steina Vasulka's Image/ine (STEIM Amsterdam, 1997/2008) in the modern browser. Vite 5 + Three.js + vanilla JS. No framework.

Running at localhost:5173 (npm run dev). Chrome 113+ required.

---

## Your role alongside Claude Code

| Task                                    | Tool        |
|-----------------------------------------|-------------|
| Surgical JS/CSS edits, complex logic    | Claude Code |
| grep, recon, reading files              | Gemini CLI  |
| Browser screenshots for verification   | Gemini CLI  |
| GLSL shader drafting                    | Gemini CLI  |
| Docs, CHANGELOG, markdown files        | Gemini CLI  |
| CSS variable tweaks                     | Gemini CLI  |
| Git log / status checks                 | Gemini CLI  |

---

## Tools available to you

1. Chrome DevTools MCP — navigate, screenshot, console, network, Lighthouse
2. File system — list_directory, glob, grep_search, read_file, write_file, replace
3. Shell — run_shell_command for git, bash, Vite checks
4. Web — google_web_search, web_fetch

---

## Rules (same as CLAUDE.md)

- NEVER rewrite whole JS files — surgical replace edits only
- write_file is acceptable ONLY for markdown/docs files
- One task per prompt
- git log --oneline -5 and git status BEFORE any edit
- git commit before AND after every change
- NEVER add frameworks, transpilers, or bundler changes
- NEVER touch Pipeline.js or main.js render loop without explicit instruction
- NEVER hardcode API keys

---

## Standard prompt template
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

## Verification workflow

After any code change:
1. Check Vite console for errors (run_shell_command: check npm run dev output)
2. Take Chrome DevTools screenshot to confirm visual result
3. Report: what changed, what the screenshot confirms, any console warnings

---

## Conventional commit messages
feat:     new capability
fix:      bug correction
docs:     markdown / comments only
refactor: restructure without behaviour change
chore:    deps, config, tooling
style:    CSS only, no logic change

---

## Project structure (quick reference)
src/ai/           AI provider system (Anthropic/Gemini/OpenAI/Ollama)
src/controls/     ParameterSystem, ControllerManager, LFO, Automation
src/core/         Pipeline.js — WebGL compositing chain
src/inputs/       Camera, Movie, Draw, Text, Particles, SlitScan,
                  VasulkaWarp (experimental — strip-buffer slit-scan, hidden from UI)
src/io/           ProjectFile (.imweb), OSCBridge, LUTLoader
src/scene3d/      Three.js 3D scene and geometry
src/shaders/      All GLSL as named exports
src/state/        Preset + Tables (IndexedDB)
src/ui/           UI.js — all interface builders

---

## Current version: 0.7.0

### Recent additions (2026-04-11)
- ParticleSystem: emitter shapes (Box/Ring/LineH/LineV/Point), emitter XY position,
  two attractor nodes, scale-by-speed point size mode
- Displacement Map Editor: WarpMode/WarpAmt param rows, preset buttons auto-activate Custom mode
- VASULKA_WARP shader (dual-oscillator scanline warp) — in pipeline, hidden from UI
- Raw keyer uniform (uFGRaw/uRawKey) for pre-color-correction luminance keying
- VasulkaWarp strip-buffer: full-width RT, GPU scissor capture, feeds camera3d texture

### Experimental / architecture deferred
VasulkaWarp (vwarp.* params, VasulkaWarp.js): code runs but is hidden from all UI panels,
the signal path, and the source selector. Candidate future direction: replace the GPU ring
buffer with a Sequence slot backed by disk/IndexedDB. Do not re-expose to UI without
explicit instruction.

---

## Key CSS variables
--text-1: #e0e0f0        primary text
--text-2: #8888a0        muted/inactive text
--accent: #c8a020        primary yellow
--accent-dim: #8c7a28    dimmed accent
--bg-1: #12121a          main background
--bg-2: #18181f          panel background
--bg-3: #1f1f25          section background
--bg-4: #26262e          hover state

---

## Credits

Original Image/ine: Tom Demeyer and Steina Vasulka, STEIM Foundation, Amsterdam
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson
