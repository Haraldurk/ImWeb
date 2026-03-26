# GEMINI.md — ImWeb Development Context for Gemini CLI

This file gives Gemini CLI the context needed to contribute 
to ImWeb without breaking things.

## What this project is

ImWeb is a browser-based real-time video synthesis instrument —
a reimplementation of Tom Demeyer's Image/ine (STEIM, 1997/2008)
in the modern browser. Vite 5 + Three.js + vanilla JS. No framework.

For full context see CLAUDE.md.

## Your role in this project

Gemini CLI works alongside Claude Code. Division of labour:

| Task                              | Tool          |
|-----------------------------------|---------------|
| Surgical JS/CSS edits             | Claude Code   |
| File reads, grep, structural recon| Gemini CLI    |
| Browser verification (screenshot) | Gemini CLI   |
| GLSL shader drafting              | Gemini CLI    |
| Docs / CHANGELOG / markdown       | Gemini CLI    |
| Complex multi-file wiring         | Claude Code   |

## Rules (same as CLAUDE.md)

- NEVER rewrite whole files
- Surgical edits only — use replace, not write_file on large files
- One task per prompt
- git log --oneline -5 and git status BEFORE any edit
- git commit before AND after every change
- NEVER add frameworks, transpilers, or bundler changes
- NEVER touch Pipeline.js render loop without explicit instruction

## Verification workflow

After any change:
1. Check Vite console for errors (run_shell_command)
2. Take a Chrome DevTools screenshot to confirm visual result
3. Report what changed and what the screenshot shows

## Conventional commit messages

feat:     new capability
fix:      bug correction
docs:     markdown / comments only
refactor: restructure without behaviour change
chore:    deps, config, tooling
style:    CSS only, no logic change

## Project structure

src/ai/          AI provider system (AIFeatures.js)
src/controls/    ParameterSystem, ControllerManager, LFO, Automation
src/core/        Pipeline.js — WebGL compositing chain
src/inputs/      Camera, Movie, Draw, Text, Particles, SlitScan
src/io/          ProjectFile, OSCBridge, LUT loader
src/scene3d/     Three.js 3D scene
src/shaders/     All GLSL as named exports
src/state/       Preset, Tables
src/ui/          UI.js — all interface builders
