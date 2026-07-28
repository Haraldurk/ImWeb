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

## Architecture Notes

main.js is the integration hub (~7550 lines). Most feature wiring lives here. Do not split it without a clear architectural reason.

- Pipeline.js (src/core/Pipeline.js) owns the noise material uniform init block and the generateNoise() setter — NOT main.js. main.js only contains the call site and event listeners.
- Noise shader lives at src/shaders/index.js (not src/core/shaders/)
- VasulkaWarp.js (src/inputs/) is EXPERIMENTAL but no longer hidden — its panel lives under "From the Signal" in #tab-sources (restored Phase 24, Step 4). Phase 24 rule: routable source ⇒ visible UI.
- AIFeatures.js persists provider/key config to localStorage 'imweb-ai-config'; all calls route through _call(systemPrompt, userPrompt).
- **Build is Vite 8** (`vite ^8.1.5`, `@vitejs/plugin-basic-ssl ^2.3.0`). Verify
  against `npx vite preview`, never the https dev server — automation rejects
  its self-signed cert.

### Warp drawing (Phase 24)
- **One axis convention, everywhere.** `DataTexture` defaults to `flipY:false`,
  so warp-map row 0 is the BOTTOM of the screen: the map's y axis is y-UP while
  pointer coords are y-down. Position AND direction must both be flipped —
  fixing one without the other just moves the mirror from where a stroke lands
  to which way it smears. Both axes are then negated into `brush()` because the
  shader samples `vUv + displacement`, so a positive map value moves the picture
  the opposite way. The grid overlay flips `(nj + dy)`, not just `nj`.
- **The map is authored at texel CENTRES** — `(n + 0.5)/TEX_SIZE`, matching how
  `texture2D` samples it under LinearFilter. Authoring at `n/(TEX_SIZE-1)` put
  the field a half-texel out of register and squeezed it toward the centre by
  127/128 (exact in the middle, ~0.4% off at the edges).
- **ONE brush formula**: unit direction × distance-proportional strength
  (`min(mag × 10, 0.4) × amt`). Passing a raw delta as the *direction* multiplies
  the movement in twice — that is what made the mini editor ~30× weaker than the
  main canvas. `_warpStroke` (main.js) is the reference; the mini editor matches
  it deliberately, it does not get its own tuning.
- **Radius and Strength are single params**, `displace.warpDrawRadius` and
  `displace.warpDrawAmt`, shared by all three surfaces (mini editor,
  main-canvas drag, WarpDrawX/Y). The editor's sliders are VIEWS that read the
  param at USE time — do not reintroduce a local `let`, which is exactly why
  dialling radius there once did nothing to the main canvas.
- **Slot vs preset capture differs on purpose.** `displace.warpPreset` is
  group 'displace' and IS captured by Display States (the eight shapes live in
  code, so an index means the same thing everywhere). `displace.warpSlot` is
  group 'global' and is NOT — slot *contents* live in per-origin localStorage,
  so a captured index would recall a different map on another machine or port.
  warpSlot is therefore appended to warp-draw-params by id and excluded from
  global-params, as glsl.preset is.
- **`getCoalescedEvents()` needs a `.length` guard, not `?? []`** — the method
  EXISTS and returns an empty array for untrusted events, so `?? [e]` never
  fires and the drag draws nothing. `attachDrawSurface` still has this pattern.

### Source list & mix buses (Phase 23)
- **ONE canonical source list.** `SOURCE_DEFS` in ParameterSystem.js is the single
  origin; `SOURCES` (labels) and `SOURCE_KEYS` (inputs-bag keys) derive from it and
  are imported by Pipeline._resolveSource(), main.js _resolveLayerTex(), the
  TimeDisplace capture path and AIFeatures. **APPEND-ONLY forever** — SELECT values
  persist as integer indices into it. Never hand-copy this list: six copies once
  existed and three had silently drifted, breaking TimeDisplace capture and the AI
  Narrator for the newest sources.
- **Three mix buses** — sources 26/27/28 (Mix 1/2/3). Params come from one
  `MIX_BUS_PARAMS` descriptor registered for prefixes `mix` / `mix2` / `mix3`, the
  same shape as `MOVIE_DECK_PARAMS`. Bus 1 keeps the bare `mix.` prefix and its
  v0.12 ids/labels — renaming to `mix1.` breaks every saved state, bank, .imweb
  file and MIDI mapping for zero gain.
- **srcA/srcB are free source selectors**, resolved through the same
  `_resolveSource()` the layers use — a bus is a real graph node, not a hardwired
  deck crossfader. Group `mix`/`mix2`/`mix3`, NOT `global`: unlike glsl.preset they
  ARE captured by Display States, because the source list is append-only and not
  user-editable, so its indices cannot drift under a saved state.
- **Double-buffered, NOT feedback-guarded.** Each bus writes its back buffer and
  flips `_mixCur` only after the draw. One rule, no special cases: later-reads-
  earlier sees THIS frame; earlier-reads-later and self-read see LAST frame. Do not
  add an identity guard here — the double buffer is the mechanism (see Guard Logic
  Rules: this is the case where a second target beats a guard). Targets allocate
  lazily, so a project routing no bus pays no VRAM.
- **Consumption is a fixpoint** — `_srcUsed(i)` in main.js: a source is used by a
  layer, by td.captureSource, or by a live mix input; a bus is needed if any needed
  bus reads it (transitive in both directions). Extend THAT function when adding a
  consumer — do not copy the pattern, which is how seven near-duplicates accrued.

### UI structure (Phase 23)
- Tabs follow signal flow: **Sources · Mix · Effects · Output | 3D · Analog · Draw ·
  Project**. 3D/Analog/Draw are top-level because they are large *source editors*,
  not a different taxonomic kind — do not silently “fix” this by folding them into Sources.
- Section labels and order live in index.html. `buildMappingPanels()` (UI.js) is a
  container-id → params map with no labels and no ordering, so regrouping tabs needs
  no JS change as long as container ids are preserved.
- The `.panel-section` carrying `data-default-open` decides BOTH which section is
  expanded and which tab the app lands on (`activateDefaultTab()`, module scope in
  main.js). The `active` classes in index.html are a **first-paint hint only** —
  do not delete them: every .tab-content is display:none until a class is set, so
  the panel paints blank until the module graph evaluates, and stays blank forever
  if it fails to load.
- I/O and Hypercube panels are **injected at runtime** (into #tab-sources and
  #tab-scene3d) — they move in JS, not markup. The #tab-buffer and #tab-glsl wrapper
  ids are queried by main.js: keep them, and keep them class-less (giving them
  .tab-content would permanently hide them).

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

Before investigating any bug or writing any fix prompt, invoke the
`imweb-debugging` skill (.claude/skills/imweb-debugging/SKILL.md) — it holds the
save/load investigation order, the pre-prompt verification rules, the one-task-per-prompt
rule, and the serialized-file inspection commands.
