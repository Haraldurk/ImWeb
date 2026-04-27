# AGENTS.md — ImWeb

Browser-based real-time video synthesis instrument. Composites video sources through a WebGL shader chain.

## Commands

```bash
npm run dev         # Vite HMR at localhost:5173
npm run build       # Production build → dist/
npm run preview     # Serve dist/
npm run prep-video  # Video file prep tool
```

Chrome 113+ required. No test suite or linter — verify by running `npm run dev` and checking the browser console.

## Architecture

- **`src/main.js`** (~5500 lines) — Integration hub. Render loop (`requestAnimationFrame`), all feature wiring, keyboard shortcuts, UI event handlers. Do not split without architectural reason.
- **`src/core/Pipeline.js`** — WebGL compositing. Ping-pong `WebGLRenderTarget` chain: 30+ full-screen quad shader passes. Owns all shader materials and `generateNoise()`.
- **`src/controls/ParameterSystem.js`** — Single source of truth. All ~210+ parameters live here. Read: `ps.get('name').value`. Write: `ps.set('name', v)`. Fires `onChange` callbacks. No other state management.
- **`src/ui/UI.js`** — All DOM builders. Param rows with drag/dblclick editing. The function `buildParamRow(param, contextMenu)` returns a DOM row element.
- **`src/shaders/index.js`** — All GLSL fragment shaders as named exports.
- **`src/scene3d/`** — 3D scene rendering into pipeline texture. Hypercube engine (4D–12D), 13 procedural geometries, model import.
- **`src/inputs/`** — Camera, Movie, Buffers, Draw, Text, Particles, SDF, SlitScan, Vectorscope, VasulkaWarp, VideoDelay, WarpMaps.
- **`src/state/`** — Presets (IndexedDB), tables (response curves).
- **`src/ai/AIFeatures.js`** — Multi-provider AI (Anthropic/Gemini/OpenAI/Ollama). Keys in `localStorage`.

## Critical conventions

- **Never rewrite files.** Surgical `str_replace` edits only.
- **No React, Vue, TypeScript, or bundled state management.** Vanilla JS DOM only.
- **`ps.register()` MUST use single-object form:**
  ```js
  ps.register({ id: 'my.param', type: 'continuous', min: 0, max: 100, value: 50 })
  ```
  The two-arg form `ps.register('id', {})` silently stores under key `undefined` — all `ps.get()` lookups will fail.
- **New features follow this order:** 1) Declare params in ParameterSystem.js, 2) Implement logic, 3) Wire in main.js, 4) Add UI in UI.js, 5) Add CSS in style.css.
- **Guard logic rule:** Before adding any flag-based guard, confirm the flag's value at the guard site isn't statically predictable. For WebGL feedback loops, prefer identity checks (`tex === this.target.texture`) over timing flags.
- **`_detachSection()`** in main.js handles floating panel detach. Sections must use `.panel-section` / `.section-header` CSS classes to be collapsible and detachable.

## Parameter system

Parameters are typed: `continuous` (float with min/max/step), `toggle` (0/1), `select` (index into options array), `trigger` (fire-once). Groups determined by id prefix (e.g. `particle.*`, `hypercube.*`). Controller assignment: each param can have one controller (MIDI, LFO, random, etc.) configured via right-click on the controller badge in the param row UI.

## Dev Capture pipeline — DO NOT TOUCH

The `_dc*` block in `src/main.js`, `dev-catcher.js`, `process-ideas.sh`, and the `Brainstorms/` directory are a development-only capture pipeline. **No agent may modify, refactor, disable, or "clean up" any part of this system** without explicit written permission from the project owner. This rule is absolute.
