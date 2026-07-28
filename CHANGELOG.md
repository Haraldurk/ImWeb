# Changelog

All notable changes to ImWeb are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
ImWeb uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

---

## [Unreleased]

*Importing a project used to delete banks. `importAll()` pruned every bank in
IndexedDB whose index the incoming file did not claim — no prompt, no undo —
and it sat behind three call sites, including a drag-dropped `.imx`. The local
MasterProject went from six banks to two before anyone noticed. Import is now
additive; the only thing that still destroys banks is the button whose job is
destroying banks.*

### Fixed
- **Project import no longer deletes local banks.** The prune is gone.
  `PresetManager.importAll()` merges: banks already in the store are left alone,
  and the project's own banks are written alongside them.
- **Nor does it silently overwrite them.** Banks are keyed by `index` and
  `dbPut` overwrites by key, so deletion was only half the blast radius — an
  incoming bank at index 8 destroyed a local bank 8 just as thoroughly. A
  colliding incoming bank is now **reindexed** to the lowest free slot. The
  free-index set is seeded from IndexedDB *and* from memory, because a bank can
  exist in the store without being in `presets` (an import before `init()`, or a
  second tab).
- **`activePreset` follows the reindexing.** `ProjectFile` takes the index map
  `importAll()` returns and translates the saved id through it; without that, a
  merge that moved a bank would silently restore a different one.
- **The hidden `#bank-select` proxy tracks the bank set.** Its `<option>`
  elements were rebuilt only when the bank dropdown was opened, so any bank
  added since then had no option and the select read `""`. Extracted into
  `_syncBankSelect()` and called from `_refresh()`, which already listens for
  bank activation, saving, recall and rename.

### Changed
- **Destructive import is now opt-in**, via `importAll(data, { replace: true })`.
  Two callers pass it: "Restore MasterProject", which already warns that the
  action cannot be undone, and the first-ever launch — `init()` saves a blank
  `Preset(0)` before MasterProject loads, so a merge there would collide with it
  and shift every factory bank one slot. `_firstLaunch` means the store was
  empty, so the only bank replace can destroy is that empty one.
- **Loading the same project twice now duplicates its banks** rather than
  replacing them. This is the deliberate trade: duplicate banks can be deleted,
  deleted banks cannot be recovered.

---

## [0.13.0] — 2026-07-28 — Performative Warp Drawing (Phase 24)

*The displacement map had an editor but no performance. You could sculpt a warp
in a 288×200 panel, or pick one of eight procedural shapes, and that was the
instrument. Phase 24 makes the warp map something you play: draw it on the
output itself, drive it from LFO/MIDI/OSC, recall it from a controller, and
crossfade between saved maps. Design doc:
`docs/ImWeb-UI-Taxonomy-Phase24-Proposal.md`.*

### Added
- **Draw the warp on the main canvas** — Touch Mode `Warp` (index 4) claims the
  output surface, so dragging smears the displacement map under the pointer.
  Claims its own mode index for the same reason the Draw surface does: camera
  orbit and the pad gate on theirs, so a bare listener would have made every
  orbit drag also smear the map.
- **`displace.warpDrawX` / `warpDrawY`** — the same brush driven by parameters
  instead of a pointer, so an LFO pair produces an orbiting drag and MIDI can
  sculpt the map live. Direction comes from motion between frames, which is why
  a stationary pair of sliders does nothing and no on/off switch is needed.
- **`displace.warpDrawRadius`** (2–50%) and **`displace.warpDrawAmt`**
  ("Strength", 0–200%) — brush width and bite, now real parameters. Both are
  shared by all three drawing surfaces: the mini editor, the main-canvas drag
  and the WarpDrawX/Y path. The mini editor's Radius and Strength sliders are
  *views* of these params, not private variables, so a controller visibly moves
  them and dialling them changes what the main canvas draws.
- **`displace.warpSlot` (1–16) and `displace.warpPreset` (8 shapes)** — slot and
  preset recall as SELECT params with a leading "—" no-op, so LFO/MIDI/OSC can
  fire them. One recall implementation in main.js; the editor's buttons set the
  param rather than recalling directly, so button, MIDI and LFO share a path.
  Capture semantics differ on purpose: `warpPreset` is captured by Display
  States (the eight shapes live in code, so an index means the same thing
  everywhere) while `warpSlot` is not (slot *contents* live in per-origin
  localStorage, so a captured index would recall a different map elsewhere).
- **`displace.warpSlotFade`** — slot and preset recall crossfades the control
  grid over N seconds instead of snapping, on a smoothstep that eases in *and*
  out and lands on the target exactly. Interruptible: re-targeting mid-fade
  snapshots wherever it reached.
- **`displace.warpDrawFixed` / `warpDrawAngle`** — a steady wind field you can
  aim, instead of a direction that changes with the way you happen to be moving.
  Motion still decides *whether* to draw and how hard, just not which way.
- **Controller assignment on controls that are not param rows** — the mini
  editor's Radius/Strength sliders and the preset buttons take right-click or
  Ctrl+click; slot buttons take Ctrl+click only, because plain right-click
  already saves to the slot.

### Changed
- **WarpAmt ceiling raised from 100% to 200%.** The shader displaces by
  `(map − 0.5) × uStrength × 0.3` and control points clamp at ±0.49, so 100%
  capped every warp at ~15% of the frame. Raising the *param* ceiling rather
  than the shader's `0.3` keeps every saved map, preset, Display State and
  `.imweb` project rendering byte-for-byte as before.
- Warp param labels shortened (`Strength`, `Radius`, `Fixed Dir`, `Angle`,
  `Slot Fade`) — five of them overflowed the panel's label column and rendered
  as an identical `WarpDraw…`, which made the new Radius param unfindable. IDs
  are unchanged, so saved states and MIDI mappings are unaffected.

### Fixed
- **Warp drawing was mirrored vertically, twice.** `DataTexture` defaults to
  `flipY: false`, so map row 0 is the *bottom* of the screen while pointer
  coordinates are y-down. Fixing the stroke position without the drag direction
  then simply moved the mirror from where a stroke landed to which way it
  smeared — position and direction have to share one axis convention.
- **Half-texel register error in the warp map.** `_rebuild()` stored the field
  at `n/(TEX_SIZE−1)` — texel *corners* — while the shader samples texel
  *centres* at `(n+0.5)/TEX_SIZE`. The whole map was squeezed toward the centre
  by 127/128: exact in the middle, ~0.4% of the canvas off at the edges, which
  is why a brush stroke drifted the further out you drew.
- **The grid overlay drew an upside-down picture of the warp** it claims to
  show. The flip wraps `(nj + dy)`, not just `nj` — flipping the node but not
  its displacement would put the lines in the right places while bulging them
  the wrong way.
- **The mini editor barely drew.** Its mousemove passed the raw per-event delta
  as the brush *direction*, but `brush()` already scales by `strength`, so the
  movement was multiplied in twice — roughly 30× weaker than the main canvas.
  Now a unit direction with distance-proportional strength, matching
  `_warpStroke`.
- **The mini editor's mesh was 2.5× exaggerated**, drawing nodes up to 1.2
  canvas-widths from home for warps the video renders calmly, and disagreeing
  with the unscaled main-canvas overlay. Now 1:1.
- **Fast strokes on the main canvas drew nothing.** The browser batches motion
  into one `pointermove`, and a single large step trips the teleport guard —
  the faster you moved, the less happened. Now replays `getCoalescedEvents()`,
  guarding on the list being *empty* rather than absent (it exists and returns
  `[]` for untrusted events, so `?? [e]` never fired).

---

## [0.13.0] — 2026-07-28 — MixBus Rethink (Phase 23)

*The MixBus shipped in v0.12 as a crossfader hardwired to the two movie decks.
ImWeb's actual model is a source graph — `layer.fg/bg/ds` pick freely from one
shared list — so the bus was the only node in the instrument with fixed inputs.
Phase 23 makes it a real graph node, adds two more, and rebuilds the panel
taxonomy around signal flow. Blueprint: `docs/ImWeb-MixBus-Rethink-Blueprint.md`.*

### Added
- **Free source selection on every mix bus** — `mix.srcA` / `mix.srcB` (and the
  `mix2.*` / `mix3.*` mirrors) select any of the 29 sources, resolved through
  the same `_resolveSource()` the layers use. Camera against Noise, Draw against
  the SDF generator, the 3D scene displaced by the Analog TV signal — all
  reachable. The MIXBUS shader was already source-agnostic and is unchanged;
  only the binding was hardwired. Defaults (1 = Movie, 25 = Movie B) reproduce
  the old wiring exactly, so existing projects render identically.
- **Three mix buses** — sources 26/27/28 ("Mix 1/2/3"), built from one
  `MIX_BUS_PARAMS` descriptor registered for prefixes `mix` / `mix2` / `mix3`,
  the same shape as `MOVIE_DECK_PARAMS`. Bus 1 keeps the bare `mix.` prefix and
  its exact v0.12 ids and labels — renaming to `mix1.` would break every saved
  state, bank, `.imweb` file and MIDI mapping for zero gain.
- **One-frame-behind feedback** — each bus is double-buffered, writing its back
  buffer and flipping only after the draw. One rule covers every case with no
  feedback flag: a later bus reading an earlier one sees *this* frame, an
  earlier bus reading a later one sees *last* frame, and a bus reading itself
  sees *last* frame — safe because the sampled texture is physically a different
  target from the one being written. Targets allocate lazily, so a project that
  routes no bus pays no VRAM.

### Changed
- **Panel taxonomy follows signal flow** — the tab bar is now
  `Sources · Mix · Effects · Output | 3D · Analog · Draw · Project`. "Mapping"
  held 23 sections (essentially the whole instrument) and was named after one
  section inside it; 3D/Analog/Draw stay top-level because they are large
  *source editors*, not a different taxonomic kind. Renames: Movie Clips →
  Movie A, ColorSrc 1&2 → Color / Gradient, Sequences → Frame Sequences,
  Particles / GPU Engine → Particles, SDF / Metaballs → Metaballs, Camera (3D
  tab) → 3D Camera, Response Curves "Tables" → Response Curves. No parameter
  ids and no source indices changed.
- **Consumption analysis is a fixpoint** — a bus renders only when something
  reads it, and that is transitive in both directions (an earlier bus reading a
  later one is still a real consumer). A bus feeding only itself never becomes
  needed and costs nothing. The seven duplicated "is source *i* used" tests
  collapsed into one `_srcUsed(i)` covering layers, TimeDisplace capture and
  live mix inputs.
- **Initial tab activation is data-driven** — the `.panel-section` carrying
  `data-default-open` decides both which section is expanded and which tab the
  app opens on. The `active` classes remaining in `index.html` are a documented
  first-paint hint, not the source of truth.

### Fixed
- **TimeDisplace could not capture Movie B or Mix Bus** — `TD_CAPTURE_KEYS` had
  25 entries against a 27-entry source list, so those indices resolved to
  `undefined` and `tdEngine.capture()` silently no-oped. The `_gTdCap === 26`
  branch in the idle-deck upload gate was therefore dead code.
- **AI Narrator reported '?' for the newest sources** — `SOURCE_NAMES` in
  `AIFeatures.js` was a stale 25-entry hand-copy, the exact recurrence its own
  comment warned about.
- **Six hand-synced copies of the source list, three drifted** — replaced by a
  single exported origin (`SOURCE_DEFS` → `SOURCES` / `SOURCE_KEYS`). Dead,
  mis-ordered `SOURCE_ABBREV` in `UI.js` deleted.
- **Auto-expand no longer depends on header text** — `_collapseToLayers()`
  matched the literal string `"Layers"`, so moving that section (as the
  taxonomy restructure did) silently booted the app fully collapsed.

---

## [0.13.0] — 2026-07-28 — The Live GLSL Overhaul (Phases 13–20)

### Added
- **Pen-ready drawing (Pointer Events + pressure)** — the Draw preview
  canvas now uses Pointer Events: Apple Pencil / stylus pressure
  modulates brush size and opacity via two new params (`PressSize`,
  default 100%, and `PressOpacity`, default 0%; set to 0 to ignore
  pressure). Fast strokes stay smooth via coalesced events (no more
  dot quantization), palm touches are rejected while a pen is in
  contact, and the pen barrel button (or right mouse button) erases.
  Param-driven drawing (LFO/MIDI/Automation on DrawX/DrawY) is
  unchanged. DrawLayer gains a shared point-queue/`drawSegment` path
  that live input, param drawing, and future stroke playback all
  render through.
- **Draw on the output canvas** — a new "Draw" canvas interaction
  mode (Touch Mode index 3, joining Camera/Pad/Locked) routes canvas
  pointers straight to the draw layer: paint at full scale over the
  live composite with the same pressure/palm-rejection grammar as the
  panel preview. Toggle via the ⊕ Canvas button in the Draw tab, the
  `g` key, or a 3-finger tap; a crosshair cursor marks the mode, and
  leaving it restores the previous mode. Camera orbit/pan and pad
  gestures are untouched in their own modes.
- **Stroke looper** — a 4-slot looper pedal for drawing. Record
  strokes (pointer or LFO/MIDI-driven alike) into a slot, stop to
  loop them back as ghost strokes while drawing new ones live; slots
  free-run at independent lengths and speeds (10–400%), so loops
  polyrhythm against each other. Rec/Play/Clear/Speed are params
  (`Loop1Rec` … `Loop4Speed`) — assign MIDI pads for hands-on
  looping; a compact transport strip lives in the Draw tab. Brush
  size/color/opacity (and pen pressure) are baked into each recorded
  point, so playback ignores later pen changes. Combine with DrawFade
  for drawings that animate as they decay and repaint each cycle.
  Loop data saves/loads with `.imweb` project files.
- **Draw ↔ synthesis crossovers** — `StrokeEmit` toggle makes the pen
  drive the particle emitter while drawing (strokes trail particles);
  ⇢ Warp and ⇢ Key buttons in the Draw tab route the drawing into
  the existing displacement pass and external-key input (one-click
  `DisplaceSrc → Draw` setups — the pipeline already supported any
  source there, including Draw).
- **Stroke→LFO controller driver** — recorded stroke loops can now
  drive any continuous parameter as an LFO-like modulation source. Assign
  via the controller context menu: `Stroke L1 X` … `Stroke L4 Y` read the
  X or Y position from the corresponding Stroke Looper slot at an
  independent playhead with configurable rate (0.1–10×). The same slot
  can drive multiple params at different rates and axes — four draw loops
  become four freely-routable modulation lanes. Edit slot, axis, and rate
  in the controller popover (right-click the badge).
- **Video-as-ink drawing** — `InkSource` SELECT (Color / Camera / Movie /
  MovieB / Noise / Output) lets you paint with live source pixels instead
  of a solid colour. Camera and Movie stamp video frames through the
  brush shape; Noise generates random greyscale static each frame; Output
  snapshots the previous composite (any source routed through FG) — paint
  with the whole pipeline. A per-frame cache canvas avoids expensive
  per-point video decodes. Works on iPad via HTTPS.
- **GLSL preset MIDI recall (`glsl.preset`)** — the Live GLSL preset
  list (built-ins + saved user presets) is now a SELECT parameter with
  a standard controller badge next to the preset dropdown. Assign
  MIDI CC/Note, LFO, Random, Key, or OSC via right-click (ctrl+click /
  touch long-press) to recall shaders live; controller-driven recalls
  always compile, regardless of the Auto checkbox. Options stay in
  sync as user presets are saved/deleted. Excluded from Display State
  capture (the index would drift as the user preset list changes).
- **Recall range for GLSL presets (and all SELECT params)** — SELECT
  parameters now honor `ctrlMin`/`ctrlMax`, clamping the controller
  sweep to an index sub-range. The GLSL preset row gains min/max
  fields (drag or double-click to edit, same grammar as param rows;
  tooltip shows the preset name at each index) so MIDI/LFO recall can
  cycle just a chosen slice of the preset list.
- **AI shader generation (✨ Prompt AI)** — describe an effect in
  natural language and the configured AI provider (AI panel) writes
  the GLSL. The system prompt embeds the full VJ uniform contract;
  the result is compile-checked before it reaches the editor, with
  one automatic AI repair attempt on compiler errors. Generated
  shaders name their own uParam1–4 knob labels via metadata.
  Touch-friendly modal with pulsing progress and inline errors;
  no-key errors offer a 🔑 button that opens AI Settings with the
  key field focused.
- **VJ uniform contract for Live GLSL** — custom shaders now receive
  `tAudio` (256×2 FFT + waveform DataTexture), `tPrev` (previous
  output frame for feedback/trails), `uBPM`/`uBeat` (beat phase 0..1
  from the BeatDetector), and `uLevel`/`uBass`/`uMid`/`uHigh` audio
  bands. The full contract is auto-injected as a header (including
  the previously missing `uResolution`) and degrades gracefully when
  Sound is off. New built-in preset **Audio React** demonstrates
  bass zoom, beat flash, FFT bars, and trails.
- **GLSL insert routing** — new Target selector routes the custom
  shader to Master Output (default), Foreground, Background, or
  Displace Layer. FG/BG inserts run on the resolved layer source
  before color correction, so blends and the keyer see the shader
  output. `glsl.target` is a normal SELECT param — state-recallable
  and saved in `.imweb` automatically.
- **Live GLSL persistence** — editor source, auto-apply state, and
  active flag are saved in `.imweb` projects (additive `glsl` key;
  old files load unchanged) and restored on import.
- **User shader presets** — 💾 saves the current editor code as a
  named preset (localStorage, "— User —" group), 📄 clears to a
  blank boilerplate with a hidden "Custom" dropdown state, ✕ deletes
  the selected user preset and falls back to Passthrough.
- **CodeMirror 6 editor** — the Live GLSL `<textarea>` is replaced
  with a CodeMirror instance (lang-cpp grammar, custom dark highlight
  style, line numbers, proper iPad touch editing, vertical resize
  handle). Tab indents, Ctrl/Cmd+Enter applies, auto-apply fires on
  document changes.

### Fixed
- **Response tables now apply to every controller type** — MIDI CC,
  MIDI note velocity, mouse, tilt/compass, Wacom pressure, sound
  bands, gamepad, key, and fixed controllers wrote parameters through
  a path that skipped the assigned table entirely; only LFO and
  Random were shaped. Table resolution (including the "global" slot)
  now lives inside `Parameter.setNormalized`, so all write paths
  behave identically.
- **Live GLSL compile errors no longer kill the running shader** —
  last-good fallback keeps the previous shader rendering while the
  error panel reports the real GLSL info log (the old link-status
  introspection never matched in three r160, letting broken shaders
  slip through as "success").
- **AI response handling hardened end-to-end** — thinking-first
  responses from adaptive-thinking models (claude-sonnet-5, Opus
  4.7+) are parsed correctly (the text block is found, not assumed
  at position 0); fenced/unfenced/split/truncated model output is
  extracted robustly (quoted excerpts never win over the real
  shader); empty provider responses abort with a clear message
  instead of feeding the compiler a phantom "Missing main()"; the
  CRITICAL RULES system prompt forbids uniform redeclaration and
  WebGL 2.0 syntax; DEV-only `[glsl-ai]` console logging records raw
  response → extraction → compile errors for ground-truth debugging.
- **GLSL header injection is qualifier-proof** — regex probes
  (tolerating `lowp`/`mediump`/`highp` and extra whitespace, tested
  against comment-stripped source) replace the brittle substring
  checks, so pasted ShaderToy-style declarations are no longer
  double-injected.
- **MovieInput NaN crash** — seeks no longer write a non-finite
  `currentTime` (and kill the render loop) when a clip's metadata
  hasn't loaded or its source failed.
- **AI connection test names what it tested** — "✓ Connected —
  <model> @ <provider>", exposing saved-config mismatches; Anthropic
  model list updated to current IDs (claude-sonnet-5 default,
  claude-opus-4-8, claude-haiku-4-5).
- **GLSL preset-row buttons pushed off-panel** — the preset select
  now shrinks properly (`min-width:0`) so 📄/💾/✕ stay visible.

## [0.12.0] — 2026-07-10 — Dual-Deck & Touch Polish

### Fixed
- **iPad context-menu taps** — prompt-based assignments (LFO, Fixed, MIDI,
  Key, Expr) silently failed on iOS: `preventDefault()` on touchend killed
  the native click, and `window.prompt()` is only authorized by an
  untampered activation. Valid taps now let the native click through;
  direct-assign items (Sound/Gamepad/Tilt/Compass) keep a 350ms synthetic
  fallback in case the native click never arrives. 10px drag-guard retained
  so a scroll release never assigns.
- **TimeDisplace "Native" on large desktops** — Native buffer resolution is
  clamped to 1280 wide (aspect preserved): the 120-frame delay ring
  multiplies resolution by ~500 bytes/px, so unclamped 2000px+ panels
  silently failed WebGL allocation.
- **Repo hygiene** — user bank saves (`public/Projects/*.imweb` except
  MasterProject) untracked and ignored; the broad `!public/**` gitignore
  negation had let them slip into commits.

### Changed
- **Menu restructure** — tab bar is now Mapping | Movies | 3D | Analog |
  Draw | Project. Clips renamed Movies; Buffer content merged into Movies,
  Text into Draw, Tables + GLSL into Project (wrapper element ids kept so
  all existing JS keeps working).
- **Movie B status header** — now shows the active Deck B clip's thumbnail
  and name (▶/⏸ + clip count) instead of plain text.

### Added
- **Desktop state-bar ＋ tile** — quick-save state to next empty slot from
  the desktop bottom bar (same action as ⇧S / the mobile ＋ button).
- **Autoplay recovery** — one-time first-gesture hook resumes both decks if
  Chrome's engagement policy rejected play(); videos remain strictly
  muted + playsinline with caught play() rejections.
- **Deck target toggle (touch)** — "Target: A / B" segmented control in the
  Clip Library header routes tapped clips to the chosen deck, making Deck B
  loading possible on iPad without a keyboard. UI-local state (never flipped
  by state recall/morph), defaults to A each launch; ⇧-click remains a
  hardware override that always routes to Deck B.
- **Idle-deck upload gating** — a deck that provably cannot contribute to
  the frame skips its texImage2D upload (playback keeps running for cue;
  the currentTime change-detector re-uploads instantly on wake). Deck B
  gates whenever nothing routes to it (source 25, TimeDisp capture, or a
  live MixBus with xfade > 0). Deck A keeps exact v0.11 always-upload
  behavior except the one provably-hidden case: MixBus routed, Crossfade
  pinned at xfade = 1, no direct route, and no legacy reader live (seq
  capture, 3D scene, particles, analog, SDF, ClipLib REC all veto the
  gate). Single-deck performance cost returns to pre-dual-deck levels.
- **Deck B UI + clip routing** — "Movie B" and "Mix Bus" collapsible panels
  in the Clips tab (movieB.* and mix.* param rows via the standard mapping
  system). ⇧-click a Clip Library slot or a Deck A clip, or ⇧-drop a video
  file anywhere, to route it to Deck B; plain click/drop keeps loading
  Deck A as before. Deck B panel shows a live status line (▶/⏸ + active
  clip name + count).
- **MixBus A/B engine** — new `mix.*` param group (`xfade` 0–1 default 0 =
  pure Deck A, `mode` [Crossfade/Add/Multiply/Luma Mask/Displace], `dispAmt`,
  `maskLo`, `maskHi`) driving a MIXBUS shader pass that mixes the two movie
  decks into a dedicated render target ahead of layer resolution. "Mix Bus"
  appended as source index 26 — selectable as FG/BG/DS. Pass is skipped when
  neither deck is live; it reads only the deck textures, so no feedback
  hazard. No UI yet (Step 4).
- **Deck B movie engine (headless)** — second `MovieInput` instance driven by
  `movieB.*` params (registered from a shared descriptor table with Deck A so
  the two can never drift); "Movie B" appended as source index 25, selectable
  as FG/BG/DS and everywhere the shared source list is offered. No UI yet —
  dev console access via `window.__decks` (dev builds only). Build plan:
  `docs/ImWeb-DualDeck-v0.12-BuildPlan.md`.

### Fixed
- `_resolveLayerTex()` source-key list was missing `tdisp` (index 24), so
  "TimeDisp" fell through to the Output fallback in secondary lookups
  (e.g. `td.captureSource`).

---

## [0.11.0] — 2026-07-07 — Touch & Ergonomics Overhaul

A ruthless UX audit of the touch layout ("the Grill Report") followed by
systematic fixes: live-performance safety, main-thread performance,
finger-sized ergonomics, touch physics, desktop canvas parity, and
iOS-hardened precision value entry.

### Added
- **Flick momentum on param drags** — fast touch/pen drags hand residual
  velocity to a friction glide on clean pointerup; never on pointercancel
  (reverts), never on controller-owned params, and the loop yields the
  instant anything else writes the value. `e218857`
- **Touch value entry** — double-tap any continuous value field (and the
  min/max fields) for an inline type-in editor; iOS-hardened: synchronous
  focus inside the gesture, `type=text inputmode=decimal` for the numeric
  pad, explicit min/max clamping, and the ImWeb virtual keyboard now types
  directly into focused fields. `16938d8`, `dc40305`, `d53c2f6`
- **Desktop canvas parity** — 'g' cycles Camera/Pad/Locked (3-finger-tap
  equivalent; macOS eats trackpad 3-finger gestures); wheel/trackpad-pinch
  zoom eases toward `scene3d.scale` with a Wheel Zoom toggle + sensitivity
  in Global params; left-drag orbits with the same coast inertia as a touch
  flick (shared physics via GestureArbitrator), right-drag pans.
  `647db84`, `47aa1bd`, `c99cafa`
- **UI chrome toggles** — version in the logo (from package.json), ◎ OSD
  toggle ('i'), ▤ state bar toggle ('u', localStorage, auto-hidden in
  fullscreen incl. the mobile bar), signal path hidden by default with the
  ┄ button as show/hide (float/dock moved to Shift+P). `47aa1bd`, `b952999`
- **Unified long-press** — one `LONG_PRESS_MS` (400ms) constant replaces
  the fractured 220/500/600ms timings across badges, rows, and state
  tiles. `4a384a2`

### Fixed
- **Live-performance safety (Grill Report P1)** — `overscroll-behavior:
  none` lockdown + beforeunload guard against swipe-back killing the show;
  `viewport-fit=cover` + safe-area insets so the mobile state bar clears
  the iOS home indicator; pointercancel recovery reverts browser-hijacked
  drags instead of leaving corrupted values; the virtual keyboard no longer
  rests on top of the state tiles. `7469337`
- **Rotation slider stutter** — a touch on the slider had three writers
  fighting (row relative drag, native absolute slider, rAF thumb
  write-back); slider gestures are now single-writer, and `scene3d.rot.*`
  re-bases the mesh while auto-spin runs, so rotation is live during spin
  (root cause of "rotation slider dead" — MasterProject states carry
  non-zero spin). `3b2455f`, `7b10cc7`
- **Context menu scroll safety** — a tap that stops iOS momentum scroll
  can no longer trigger a controller assignment (150ms capture-phase click
  guard); menu overscroll is contained. `4a384a2`
- **Coach notification** — centered over the canvas (was on top of the
  status bar) and transient (2.5s, was 10s). `b952999`
- **Detached panels & floated signal path drag on touch** — mouse-only
  drag handlers migrated to pointer events with capture and
  `touch-action:none`. `c88b890`

### Changed
- **Coarse-pointer param rows rebuilt** — 44px min/max fields, full-height
  badge/value hit areas (no dead stripes), 22px slider lane with a 20px
  thumb on a slim visual track, touch-sized option button groups; labels
  keep room ("Rotation X" fits the 300px slide-over). Desktop rules
  untouched. `a37b0c9`, `3b2455f`, `f3e5cd8`

### Performance
- **rAF-batched param→DOM sync** — controller writes (LFO/Random/Sound at
  60Hz) no longer fan out synchronous DOM writes per change; all bindings
  flush once per frame. **Targeted MobileStatePad refresh** — persistent
  index-keyed tiles replace the full innerHTML rebuild per sequencer tick;
  hidden modal grid skipped. `e3302fc`

---

## [0.10.0] — 2026-07-07 — The Touch Instrument

ImWeb becomes a full touch instrument on the iPad: mode-based canvas
gestures, a mobile performance layout, camera over trusted HTTPS, and
the device itself as a controller.

### Added
- **Device motion controllers (Phase 6)** — Tilt X, Tilt Y (±90° → 0–1,
  flat = 0.5, screen-orientation compensated) and Compass (0–360° → 0–1,
  wraps at north) join the assignable controller list, behaving like any
  MIDI fader or LFO (slew/tables apply). iOS sensor permission is
  requested inline when a motion controller is assigned; the Global
  "Enable Motion" trigger covers preset-recall cases. The
  `deviceorientation` listener binds only while a motion mapping exists.
  Requires HTTPS (`npm run dev:https`) — sensors are dead on plain http.
  Commits `b2fd9b3`, `4bce2d0` (scrollable controller menu on small
  screens; permission outcome flashed in the OSD with sensor-event
  logging for on-device diagnosis).
- **Slot-based mirror: Mirror FG / Mirror BG (Phase 5, breaking)** — the
  three source toggles (Mirror Cam/Movie/Buffer) are replaced by two slot
  toggles that flip whatever occupies the Foreground/Background layer —
  any source, not just camera/movie/buffer. The flip is folded into the
  per-layer colorcorrect pass (`uFlipH`), so mirroring costs no extra
  render pass, cannot collide in the two-target ping-pong pool (the
  `b36851b` regression that blanked mirrored layers), and now composes
  with hue/sat/brightness instead of bypassing them. Selfie heuristic
  targets whichever slot the camera occupies. Legacy mirror params stay
  registered so old presets load, but no longer have any effect
  (discovery: the Layers "Mirror Movie" row never worked — it was a
  different param than the one the pipeline read). Commits `b36851b`,
  `bbbcc9a`.
- **Pad-mode crosshair (Phase 5)** — a thin accent crosshair over the
  canvas tracks the pad X/Y touch point (1-finger or 2-finger centroid):
  full visibility while driving, 0.25-opacity parked ghost on release,
  hidden whenever the touch mode leaves Pad by any path. Touch devices
  only. Commit `480b83d`.
- **Orbit inertia (Phase 5)** — flicking a 1-finger orbit lets the scene
  coast with friction (0.92/frame, frame-rate independent) until it stops;
  holding still before lifting doesn't coast; touching the canvas while
  coasting kills the momentum instantly (tactile clutch). Commit `d7284b1`.
- **3-finger tap mode cycle (Phase 5)** — a quick 3-finger tap on the
  canvas advances the touch mode (Camera → Pad → Locked → …) and flashes
  a large "MODE: <NAME>" OSD that fades after 800ms. Works in Locked mode
  (so it can unlock); camera values are restored on clutch engage so the
  tap is a net no-op on the image; held/moved 3-finger contact remains an
  unbound null zone. Commit `e9d91b6`.
- **Movie texture upload gating (Phase 5)** — movie textures upload to the
  GPU only when the decoded position actually moves (plus a `seeked`
  refresh for async seek completion); paused or held frames are no longer
  re-uploaded every render tick. Note: rVFC gating à la the camera fix
  does NOT work for file playback — `requestVideoFrameCallback` never
  fires for these non-DOM `<video>` elements — so `currentTime` change is
  the gate. Commit `ea35381`.
- **Mobile state pad (Phase 4)** — on ≤900px screens the 32-tile state bar
  is replaced by a single touch button showing the active state's thumbnail
  and name; tapping opens a full-screen modal with a 4-column grid of large
  pads for the current bank. Pad taps use the exact desktop code path
  (`pm.recallState`) and auto-close the modal; button and grid subscribe to
  the same PresetManager events as the desktop StateBar, so MIDI/sequencer
  recalls never leave a stale thumbnail. New `src/ui/components/
  MobileStatePad.js`; elements mount as direct `<body>` children (modal
  z-index 300). Desktop layout untouched. Commit `9b78bf8`.
- **Mobile ergonomics (Phase 4 Task 2)** — mobile media queries now also
  match large touch devices (`(max-width: 1366px) and (hover: none) and
  (pointer: coarse)`), so iPad landscape gets the mobile layout; [＋Save]
  and [○Clear] quick actions flank the mobile state button and appear in
  the modal head (Save = exact Shift+S quick-save path, extracted into a
  shared `quickSaveState()`; Clear = the desktop ○ `neutralState` event);
  virtual keyboard keys enlarged 26×30→40×44px. Commit `dd28177`.
- **Hybrid mobile state bar (Phase 4 Task 3)** — the wide Current State
  button is replaced by `[○Clear] [＋Save] [scrolling thumbnail strip]
  [⋯More]`; the strip shows every stored state as a tappable mini-tile
  (same `pm.recallState` path), active tile ringed and kept in view, new
  saves appear live; ⋯More opens the modal pad grid. Also reverts
  `resize: both`/`overflow: auto` on the virtual keyboard panel — iOS
  doesn't support `resize`, and `overflow: auto` made iOS eat key taps
  (async-scroll region pointercancel); key size increases kept.
  Commit `9e14dd2`.
- **Long-press to clear + callout suppression (Phase 4 Task 4)** —
  long-pressing a state thumbnail (strip or modal grid, 600ms / <10px
  travel) clears that slot through the identical code path as the desktop
  tile menu's Clear, with a red-ring shrink flash as feedback; movement,
  lift, or cancel aborts the timer so scrolling never deletes.
  `-webkit-touch-callout: none` (+ selection/drag lockdown) applied to the
  mobile bar and modal subtrees, killing iOS's native Save Image/Share
  menu on long-press. Desktop right-click menu unaffected.
  Commit `4975ebc`.
- **Long-press action menu** — long-press on a state thumbnail now opens
  a Duplicate / Clear menu instead of instantly deleting; Duplicate copies
  the state into the next empty slot (export/import path, " copy" name
  suffix); outside tap dismisses (capture-phase listener). Commit `a9add76`.
- **Touch double-tap on param rows** — double-tap resets a continuous
  param (same as desktop double-click); double-tap on a min/max range
  field opens the inline number editor. Touch pointers only — desktop
  dblclick behavior unchanged. Commit `cc71cdc`.
- **Canvas grab takes control from auto-spin** — while spin is active the
  rot params are ignored by SceneManager, which made 1-finger orbit
  invisible; a Camera-mode gesture start now freezes the live mesh pose
  into `scene3d.rot.*` (0–360-wrapped, no jump) and zeroes the spins.
  Commit `d439457`.
- **Opt-in HTTPS dev server** — `npm run dev:https` serves over TLS
  (basic-ssl) so iPad Safari allows camera/mic (`getUserMedia` requires a
  secure origin); plain `npm run dev` stays http to keep the Dev Capture
  catcher (:5174) reachable. Commit `3020a35`.
- **Endless 1-finger orbit** — touch orbit wraps rotation modulo 360
  instead of clamping at the rot param bounds, so a drag keeps spinning
  past full turns. Commit `613af0b`.
- **Front/back camera flip (mobile)** — new ⇄ status-bar button (mobile
  media query only) toggles `facingMode` user/environment;
  `CameraInput.switchFacing()` restarts the live stream after stopping
  all previous tracks so device hardware is cleanly released. Trusted
  mkcert dev certificate added for `dev:https` (iPad Safari has no
  self-signed bypass) — `certs/` gitignored, root CA install documented.
  Commits `fc646a5`, `eac52a3`.
- **Camera device select in Layers + selfie mirror** — the `camera.device`
  param (previously registered but orphaned) now renders next to Mirror
  Cam in the Layers section, populated from device enumeration, and is
  the single camera-restart path (the I/O dropdown drives and follows
  it); flipping to the front camera auto-sets Mirror Cam, back camera
  clears it. Rendered as a true dropdown (`select: true`) with the device
  list re-enumerated after camera permission (iOS hides front cameras
  until granted), and a label heuristic (front/facetime vs back/rear)
  drives Mirror Cam on manual device picks too. Commits `e324bf9`,
  `f03a52a`, `ce8434d`.
- **Canvas touch grammar — GestureArbitrator (Phase 3)** — new
  `src/core/GestureArbitrator.js` routes touch/pen gestures on the output
  canvas by pointer count and the new `touch.mode` SELECT param
  (Camera / Pad / Locked, global group — preset/MIDI/sequencer-capable):
  Camera = 1-finger orbit (`scene3d.rot.x/y`, 0.35°/px) + 2-finger pinch
  zoom (`scene3d.scale`); Pad = normalized canvas X/Y (finger or 2-finger
  centroid) fed into the ControllerManager mouse channel, driving every
  mouse-x/mouse-y-assigned param; Locked = touch ignored. 3+ fingers is a
  null-zone clutch: output suspends until all fingers lift — nothing is
  bound to 3+ fingers so iOS system gestures (three-finger undo/redo)
  can never corrupt state; `touch-action: none` + non-passive touchstart
  preventDefault suppress the OS recognizers. Desktop mouse grammar
  untouched (mouse pointers ignored). Replaces the always-on two-finger
  pinch block in main.js, which is now Camera-mode-gated.

- **Touch refinements (Phase 3)** — 1-finger orbit on iPad: scroll
  suppression is `touch-action: none` ONLY (stylesheet + inline in the
  arbitrator constructor); a touchmove-preventDefault approach was tried
  and reverted (`a9edf05`) because iOS WebKit stops synthesizing
  pointermove events for cancelled touches; new status-bar **Camera** toggle
  (`btn-camera-toggle`, wired to `camera.active`, mirrors the MovieOn
  pattern); fullscreen button now enters true device fullscreen
  (`requestFullscreen` + webkit fallback, `pointerup` for iOS activation)
  with a `fullscreenchange` sync so browser-initiated exits drop the
  layout class. Commit `4e7bef7`.
- **2-finger double-tap fullscreen + video touch hardening** — a 2-finger
  double-tap on the canvas (taps ≤300ms / ≤12px travel, ≤300ms apart)
  triggers the same fullscreen toggle as the status-bar button
  (GestureArbitrator `onDoubleTap2` hook); all texture video elements
  (MovieInput, CameraInput, ClipLibrary probe) carry `playsinline` +
  `webkit-playsinline` attributes and `pointer-events: none` so iOS
  media-session heuristics can't pause/play them during touch
  interaction. Commit `ed68d2f`.

### Changed
- **Phase 2 UI componentization complete** (tag `ui-componentization-done`) —
  five verbatim extractions from the UI.js / main.js monoliths, zero visual
  change; every moved function is re-imported under its original alias so all
  call sites and the main.js import block are untouched:
  - `mkSelect` → `src/ui/components/Select.js`. Commit `bb0b2c7`.
  - `openCtrlPopover` → `src/ui/components/CtrlPopover.js`. Commit `0d9af03`.
  - New `src/ui/bindings/ParamBinding.js` — `createBinding(param)` with
    immediate-fire `sync(fn)` and idempotent `dispose()`. Commit `66215f5`.
  - `buildParamRow` → `src/ui/components/ParamRow.js`; all 5 `param.onChange`
    call sites routed through `binding.sync()`. Commit `d2f1001`.
  - `initTabs` (UI.js) + `_applyLayout` (main.js) →
    `src/ui/layout/LayoutManager.js`. Commit `5076e22`.

### Fixed
- **camera.active now drives the hardware** — toggling the param (status
  bar, V key, presets, MIDI) previously changed display state only; the
  stream and camera LED kept running because start/stop lived solely in
  the I/O button's click handler. Commit `5409d01`. Also `c34bc2a`:
  camera texture no longer force-re-uploads every render frame (three's
  VideoTexture rVFC gating now applies). Note: desktop low-fps reports on
  the MacBook were ultimately macOS automatic graphics switching parking
  Chrome on the Intel iGPU — disable switching (Battery → Options) for
  performance sessions; not a code issue.
- **iPad boot crash: mediaDevices in insecure contexts** — `navigator.
  mediaDevices` is undefined on iOS Safari over http:// (LAN dev server),
  so the I/O section's `enumerateDevices()` property access threw a
  TypeError seconds after first paint (the call sits late in main()'s
  async boot flow — no polling loop involved). Both main.js call sites now
  optional-chain the full expression; all other mediaDevices callers were
  already try/catch-wrapped. Camera/audio remain unavailable over http on
  iOS (WebKit policy) — the app now degrades gracefully instead of dying.
  Commit `5bbc934`.
- **Param-row listener leak on search rebuild** — `row._psUnsub` released only
  the `updateDisplay` subscription; the range-field, button-group/dropdown, and
  slider subscriptions leaked on every param-search rerender. `_psUnsub` now
  disposes the row's full ParamBinding (all subscriptions), with no change to
  the consumer in main.js. Commit `d2f1001`.

- **Mobile slide-over panel unclickable / grayed out** — `#panel-overlay`
  (z 199) painted on top of `#control-panel` (z 200), so panel taps hit the
  overlay's tap-to-close handler and dismissed the menu. Root cause: `#app`
  was `position: fixed`; Chromium promotes fixed elements to composited
  layers, forcing a stacking context that trapped the panel's z-index below
  the body-level overlay. Fix: `#app` is now `position: absolute` — pixel-
  identical since body never scrolls, but the panel's z-index resolves in
  the root stacking context again. Pre-existing bug (present at `bdbe955`),
  diagnosed via DevTools + headless hit-testing.

- **Status bar buttons clipped on narrow windows** — `#status-bar` was a
  fixed-height flex row without wrap; buttons overflowed off the right edge.
  Now `flex-wrap: wrap` with `min-height` and a 4px row gap; `applyLayout()`
  syncs `--status-h` to the measured bar height on init/resize so `#app` and
  the slide-over panel start below the wrapped bar (with anti-ratchet reset
  and a fullscreen zero-height guard). Pre-existing (present at `bdbe955`).
  Commit `ae1e661`.

## [0.9.0] — 2026-06-15

### Added
- feat(shaders): uSwirl added to PsrdWarp — gradient vs curl warp blend;
  mix(gsum, vec2(-gsum.y, gsum.x), uSwirl) in octave loop
- feat(shaders): uRidge added to PsrdWarp — abs() accumulation blend;
  orthogonal to uSwirl
- feat(ui): Swirl and Ridge sliders wired into noise panel fractalSection
- **PsrdWarp gradient domain warp as uType 40** — added `psrdnoise_grad()` helper returning a `PsrdResult` struct for WebGL ES 1.00 compatibility, mapped `PsrdWarp` at parameter index 40, and wired it under the `Periodic` noise family in `UI.js`. Commit `09fb511`.
- **psrdnoise2 support as uType 39 (Phase 2)** — implemented Stefan Gustavson's 2D periodic simplex noise (`psrdnoise2`) as noise type 39 under a new `Periodic` noise family. Commit `9fcde26`.
- **Wired psrdnoise2 parameters** — registered `noise.period.x`, `noise.period.y`, and `noise.alpha` in `ParameterSystem.js`, wired them in the Pipeline rendering path, and integrated them into the Noise panel in `UI.js`. Commit `6d40b20`.
- **Noise panel family→type selector, Phase 1** — added `noise.family`
  with Gradient, Fractal, Cellular, Warp, Pattern, and Analog families; rebuilt
  the Noise panel as `buildNoisePanel()` with a family row, type grid, shared
  params, and a Fractal-only section.

### Changed
- **Noise UI wiring simplified** — `main.js` now calls exported
  `buildNoisePanel()` and passes `p.family` into `generateNoise`; legacy
  `_syncNoiseParamVisibility()` and `_patchNoiseTypeOptgroups()` code was
  removed. Commit `d2b7fe2`.

### Fixed
- **HyperCube wireframe framerate** — wireframe was dropping from 60 fps
  to 30–40 fps while Points mode held 60 fps. Root cause: `_updateBuffers()`
  unconditionally uploaded full MAX_DIM-sized GPU buffers (~1.1 MB each for
  `aEndA`/`aEndB`) every frame and drew all 24,576 edges regardless of active
  dimension. For a 4D cube only 32 edges are active. Fix: `_computeLastActiveEdge()`
  scans the edge list once per dimension change and stores the buffer index of
  the last active edge; per-frame `setDrawRange` and `addUpdateRange` are scoped
  to that ceiling, cutting GPU upload from ~2.2 MB to ~14 KB and draw calls from
  147,456 to ~1,000 triangles for 4D. Commits 30530de, 853ab66.
- `_resetAllParams` (↺ button, Shift+Esc): suspend `global.morphspeed`
  during `ps.getAll()` reset cascade to prevent interpolated transitions
  when MORPH is active. Commit 0bfdfe9.
- `neutralState` listener (○ button, Shift+0): same morph suspension fix
  applied — was the actual button causing the reported "shifting loop"
  on reset. Commit 83118ba.
- fix(scene3d): white default material when no texture assigned
  (emissive floor 0.35, preserves directional lighting and shadows)
- fix(scene3d): _noiseUsed flag includes scene3d.mat.texsrc=Noise
- fix(scene3d): auto-seamless noise period matched to uScale
- fix(scene3d): triplanar sampling eliminates UV seam — vObjPos + USE_OBJ_NOISE
- fix(scene3d): T-Displace uses noise texture when texsrc=Noise
- fix(scene3d): T-Displace triplanar sampling matches visual texture
- fix(scene3d): material.color always 0xffffff; MatHue/MatSat route to
  emissive tinting only; stale hue fallback 240 fixed to 0
- **PsrdWarp mod() wrapping removed** — eliminated manual `mod()` on
  `warped` coordinates in uType 40 branch; `psrdnoise` handles periodic
  lattice boundaries internally and requires continuous input coordinates.
  Commit 1b2ed0a.
- **PsrdWarp/Psrd2D asymmetric period response fixed** — introduced
  `periodicP = p.xy + vec2(floor(uScale * 0.5) + 1.0)` in both uType 39
  and uType 40 so all canvas coordinates are positive, eliminating the
  left-side/lower-side-only effect when period sliders change.
  Commits 3d5f6da, a56cdb7.
- **Noise animation stutter from wall-clock time** — replaced
  `time: lastTime / 1000` with a capped-dt `noiseTime` accumulator;
  frame hitches no longer cause large shader time jumps. Commit 386b7fb.
- **Speed slider phase jump** — added `uPhase` uniform driven by
  `noisePhase += speed * dt` accumulated in JS before render-gate guards;
  shader now uses `t = uPhase + uSeed`, eliminating phase discontinuity
  when Speed is changed mid-session.
- **noisePhase render-gate bypass** — moved `noisePhase` accumulator
  before `_captureMode` / `shouldRender` early returns so phase advances
  every RAF tick regardless of frame skipping.
- **Alpha cycling in non-periodic mode** — `alphaPhase` mod() bounding
  now only applies when period > 0; period = 0 (organic mode) uses
  unbounded `alpha = time` as in the original Gustavson reference,
  restoring continuously evolving non-repeating animation.
- **Period step reverted to 1** — `step: 2` even-integer enforcement on
  `noise.period.x` and `noise.period.y` was based on an incorrect lattice
  alignment diagnosis and unnecessarily excluded odd values; reverted
  to `step: 1`.
- **Pipeline._noiseTime initialized** — added `this._noiseTime = 0` in
  Pipeline constructor to prevent NaN accumulation affecting film grain,
  interlace, and custom shader time uniforms.
- **psrdnoise GLSL ES compatibility** — rewrote the `psrdnoise` implementation in `src/shaders/index.js` to remove the `out vec2 gradient` parameter and replaced the `any(greaterThan(period, vec2(0.0)))` check with a float step comparison to ensure compatibility with WebGL 1 / GLSL ES 1.00.
- **psrdnoise animation flow** — changed animation drive from `uAlpha` to `t + uAlpha` in `src/shaders/index.js` so that the noise pattern animates/flows naturally according to the main Speed slider.
- **Chrome 148 ANGLE/Metal regression diagnosed** — vertex shader rendering 
  broken on macOS Chrome 148 for Hypercube wireframe edges (LineSegments) and 
  Harabara GLB model (SkinnedMesh). Root cause: Chrome 148 ANGLE/Metal backend 
  regression. Confirmed across multiple GPU types (Intel UHD 630, AMD RX 590). 
  Safari and Firefox unaffected. Chromium bug filed May 16 2026.
- **Workaround:** launch Chrome with --use-angle=gl flag
- **aTB attribute** replaces gl_VertexID in HypercubeObject edge shader
- **highp sampler2D** precision declared on vertex-stage samplers in 
  SceneManager displacement shader injection
- **textureLod** replaces texture() in vertex shader displacement and warp paths
- **SkinnedMesh → plain Mesh** conversion in loadGLTF() to eliminate 
  USE_SKINNING / texelFetch bone texture in vertex stage
- **Noise scale from center** — fixed scale calculation in `NOISE_BFG` 
  (`vUv * uScale` → `(vUv - 0.5) * uScale + 0.5`) in `src/shaders/index.js` to keep scaling centered
- **Chrome 148 ANGLE/Metal regression — resolved upstream (2026-06-10)**:
  Google fixed the Chromium bug filed above. Hypercube wireframe edges and
  the Harabara GLB model now render correctly on Chrome with the default
  Metal backend; the `--use-angle=gl` workaround is no longer required.
- **Noise: Sharpen relocated into Noise panel** — `noise.sharpen` is now a
  per-noise-texture unsharp-mask pass (dedicated `_noiseSharpTarget`,
  2px kernel radius, up to 8x amount) instead of a global Effects pass.
  Commits `f2cecb4`, `fff4bfa`.
- **Noise: Value/Gradient speed-pulsing fixed** — `vNoise` blends a second
  sample at a half-cell time offset so the quintic ease curve's
  zero-derivative point on one phase is covered by the other's peak,
  removing the periodic "speed up/slow down" breathing. Isolated to
  Gradient/Value (uType==1). Commit `c079d4b`.

### Added

- **OpenRouter AI provider** — added as a fifth provider (chat completions +
  model list), giving access to many vendors' models through a single API
  key. Commit `1ee3b17`.
- **In-app Markdown docs viewer** — new `#docs-viewer` modal renders Quick
  Reference / Full Manual from the Settings panel without leaving the app
  (lazy-loads `marked`, ~35KB); "Quick Reference" / "Full Manual" links open
  this modal instead of downloading the raw `.md`. Added a "Keyboard
  Shortcuts" link that opens the existing `#kb-help` overlay. Commit
  `6794b23`.
- **Param search overlay filter chips** — All / Active / LFO / MIDI / Sound /
  Mouse / Other / **Modified** chips filter the 385 params by controller type
  or by whether the value differs from its default, composing with text
  search. Panel enlarged (560px, 60vh results), result cap raised 20 → 60.
  Commits `2eb4e02` and this release's "Modified" chip.
- **AI Settings: live model lists + persistent connection status** — "⟳
  Refresh models" fetches each provider's live model list (Anthropic, Gemini,
  OpenAI, Ollama); "✕ Clear key" per provider; connection status now shows the
  last test result with a relative timestamp ("✓ Connected (5m ago)") that
  survives panel rebuilds and reloads. Commit `f9a6860`.
- **AI Performance settings** — Narrator/Coach poll intervals (5–60s / 15–120s)
  and Narrator description length (Short/Medium/Long) are now configurable in
  AI Settings. Commit `85a9d27`.
- **SDF Generator** now raymarches at half resolution and bilinear-upscales on
  composite — the 96-step raymarch + 6-sample normals + AO was too expensive
  per-pixel at full canvas resolution.

### Changed

- **Narrator/Coach defaults** — Narrator default interval raised from 2.5s to
  10s (was issuing ~24 calls/min, burning API cost in minutes); Coach default
  45s. Commit `85a9d27`.
- **Search Parameters results** now reuse `buildParamRow` for inline
  drag/toggle/select/dblclick-reset editing directly in the results list, with
  a ⌖ button to scroll-to/highlight the live row. Commit `b024db6`.
- **MasterProject factory default** updated to 8 banks (was 5), `activePreset`
  reset to 0.

### Fixed

- **Narrator source-name mapping** — `SOURCE_NAMES` now mirrors
  `ParameterSystem.js` exactly (25 sources including 3D Depth/SDF/VWarp/
  Analog/TimeDisp), fixing misreported active sources (e.g. an active Noise
  source reported as "3D"); added `describeSourceDetail()` so the Narrator
  describes the active noise type / 3D geometry / SDF shape / analog source /
  sequence detail. Commit `1ee3b17`.
- **AI Coach empty-response / error handling** — shows a visible hint when a
  model resolves successfully with an empty string (e.g. a "thinking" model
  consumes its budget on reasoning), and surfaces errors (rate limit, bad key,
  etc.) instead of silently fading the placeholder; `.ai-coach-notif` now wraps
  and centers longer text. Commits `a1412b5`, `85a9d27`.
- **Shift+P no longer also toggles AI Coach** — Narrator/Coach `n`/`p` keydown
  handler restricted to plain keys (no modifiers), since Shift+P is also bound
  to the Signal Path panel toggle; documented previously-missing shortcuts
  (q/a/z, d, n/p, Shift+P, Shift+V) in `#kb-help` and updated button tooltips.
  Commit `7ced27b`.
- **Active Controller assignments panel position** — was anchored off-screen
  above its toolbar button; now positions below the button, clamped to the
  viewport. Commit `b024db6`.
- **þ/Þ as alternate Search Parameters shortcut** — `/` didn't fire on
  Icelandic keyboards (Shift+7=/ intercepted by the clip-select shortcut).
  Commit `b024db6`.
- **Assign-controller context menu z-index** — raised above the param search
  overlay (`.context-menu` was below `#param-search`, opening the menu behind
  the overlay). Commit `9950db0`.
- **Stills Buffer slot count docs corrected** — 1–64 via a configurable 8×8
  grid (default 4×4=16), not 4–32 as previously documented. Commit `003240c`.

## [0.8.9] — 2026-05-12

### Fixed

- **Active bank lookup** now uses bank `.index` field, not array position
- **3D model (Harabara-optimized.glb)** now loads correctly from MasterProject on first launch
- **Model URL persisted in state mediaRefs** — survives bank switches and state recalls
- **blend.active and feedback.active** now gate their pipeline passes correctly
- **feedback.active registration** — was not registered as a parameter; added to ParameterSystem
- **Bundled Models button** click handler used wrong SceneManager reference

### Changed

- **feedback.mode** option 0 renamed Copy → Off
- **BG blend mode** labelled "Self-process mode" to clarify asymmetry with FG blend
- **Splash screen** shows MasterProject load status on first launch only
- **Bundled Models section** added to 3D tab for URL-based public asset loading

## [0.8.8] — 2026-05-06

### Fixed

- **Splash version missing** — `__APP_VERSION__` now injected via Vite `define`; value written into `#onboarding-version` span on load (98fecac)
- **3D models lost on save/load** — `currentModelUrl` persisted as `modelAsset` in `.imweb` and `.imbank` project files; restored on import via `SceneManager` (1175e44)
- **Second screen → black output** — DPR change handled with `matchMedia` listener re-registration; added `webglcontextlost` / `webglcontextrestored` handlers to recover gracefully from GPU context loss (45fbaa04)
- **MasterProject not auto-pushed** — `npm run push-master` script added; optional post-commit hook available via `npm run install-hooks`; workflow documented in CLAUDE.md (726e0c0)

## [0.8.7] — 2026-04-29

### Changed

**Per-layer blend architecture refactor**
- FG.blend now composites FG over BG (was self-blend — blending a texture against itself), using the full 22-mode TRANSFERMODE shader
- FG.blendAmount slider (0–1) controls blend opacity; defaults to 1.0 for backward compatibility
- BG.blend remains a self-process tone treatment (Screen/Multiply/etc.)
- Removed `layer.ds.blend` — DS is a displacement source, not a visual layer

**Feedback loop improvements**
- `output.transfer` renamed to `feedback.mode` — drives blend mode for the temporal feedback loop (22 modes: Add, Difference, Multiply, etc.) instead of simple `mix()`
- Feedback loop now uses TRANSFERMODE shader; blend mode + blend.amount enable creative feedback trails (Add-feedback, Difference-feedback)

**uBlendAmount uniform**
- Added `uBlendAmount` (0–1) to TRANSFERMODE shader; defaults to 1.0 in material constructor so all existing call sites preserve current behavior

### Fixed

**WebGL feedback loop (GL_INVALID_OPERATION)**
- Guard moved into `_pass()` itself — checks every texture uniform against the render target texture before rendering, substituting fallback if they collide
- Covers all call sites (feedback, FG-on-BG, displacement, keyer, chromakey, warp, all effects) regardless of upstream pass count
- Rate-limited console warning fires up to 10 times for regression detection

**Migration**
- `output.transfer` → `feedback.mode` in `importState()` for backward-compatible preset/project loading
- DemoPresets and ImXImporter updated

### Added

**Hypercube Face Masks**
- Luminance-based alpha masking on face quads — route any pipeline source (Camera, Movie, Screen, Draw, Buffer, Noise) as a mask; bright areas reveal the face, dark areas cut it
- Mask invert toggle and Mask level gain (0–4×) for fine control
- Mask texture goes through the same isolated copy-blit path as the face texture — no WebGL feedback loop

**Hypercube Face & Instancer Material Controls**
- Blend mode dropdown per face layer: Normal / Additive / Multiply / Subtract
- Hue and Saturation controls for face tint (white by default = no tint)
- Texture source dropdown for both Faces and Instancer — route Camera / Movie / Screen / Draw / Buffer / Noise directly onto face quads or instancer geometry

**Hypercube Instancer**
- InstancedMesh at each hypercube vertex position; 13 geometry types via GeometryFactory (Sphere, Torus, Cube, Plane, Cylinder, Capsule, TorusKnot, Cone, Dodecahedron, Icosahedron, Octahedron, Tetrahedron, Ring)
- Scale, opacity, and texture source controls; all parameters MIDI/LFO-assignable
- Render mode `none` hides wireframe and points for instancer-only view
- SceneManager adopts instancer mesh — unified material pipeline; receives lights and material params from the existing Material panel

### Fixed
- Faces invisible in 3D Scene (visible only in 3D Depth): missing `instanceMatrix` application in ShaderMaterial vertex shader
- `depthTest: true` caused faces to occlude/be occluded by 3D geometry — set to `false` (faces are transparent overlays)
- Black plane visible in scene when renderMode=`none`: `_updateVisibility()` now explicitly hides faces and instancer mesh
- State save/restore: all hypercube parameters now correctly save and restore including instancer, faces, blend, hue, tex source
- Hypercube UI selects showing defaults after state recall: deferred panel rebuild via `_hcPanelRebuild` callback
- WebGL feedback loop when pipeline output routed to face/mask texture: isolated copy-blit render target

---

## [0.8.5] — 2026-04-16

### Added
- **Analog TV & CRT Simulation (Phase 1)** — Dedicated 720x480 internal render target for stable performance; includes 4:3 cropping and base signal color grading (hue, saturation, brightness, contrast); routed as a standard Layer Source.
- HypercubeInstancer — InstancedMesh at hypercube vertex positions, 13 geometry types, scale, opacity controls
- Instancer texture — pipeline output wired to instancer material each frame
- Render mode `none` — hides wireframe and points for instancer-only view
- SceneManager adopts HypercubeInstancer mesh — unified material pipeline

### Fixed
- Unbind blend uPrev before copyToPrev — eliminates WebGL feedback loop
- zeroMatrix was identity — caused ghost planes at origin
- hFaces.update moved after projection — was reading stale projBuf
- Use emissiveMap on instancer — texture now renders without scene light dependency
- setVisible() now updates `_visible` flag — was only setting mesh.visible
- Removed per-frame setInstancerTexture() call from main.js — SceneManager now owns instancer texture via _adoptMesh
- Emissive forced white when texture active on adopted mesh
- Feedback loop guard bypassed for adopted instancer mesh

---

## [0.8.4] — 2026-04-16

### Added
- **Hypercube pipeline texture on faces (Session 2)** — `HypercubeFaces.js` now uses `ShaderMaterial` with `uFaceTexture` to sample the real-time pipeline texture onto hypercube faces; added `hypercube.faces.active` and `hypercube.faces.opacity` parameters with UI controls; corrected all hypercube parameter registrations in `main.js` to use the valid single-object `ps.register({})` form, fixing a critical bug where parameters were stored under `undefined`.

### Fixed
- fix(scene3d): null face texture before render pass to break WebGL feedback loop (97e88e8 — actually committed earlier)
- fix(scene3d): null mesh material.map before render pass to break pipeline feedback loop (97e88e8)

### Known Issues
- WebGL feedback loop (GL_INVALID_OPERATION) fires on startup in SDF/Metaballs pipeline. Source not yet identified — SceneManager.js confirmed not involved. Investigation deferred to next session.

---

## [0.8.3] — 2026-04-16

### Added
- **Hypercube 2-cell face rendering (Session 1)** — Added `generate2CellFaces(dim)` to `HypercubeGeometry.js` returning corners and axes for all $C(dim,2) \cdot 2^{dim-2}$ faces; introduced `HypercubeFaces.js` using `InstancedMesh` of `PlaneGeometry` with zero-allocation optimizations; wired into `HypercubeObject.js` for real-time centroid/normal/size computation; 4D hypercube now correctly renders 24 rotating faces.

---

## [0.8.2] — 2026-04-16

### Added
- **Real screen-space hypercube edge width** — Replaced `LineSegments` with quad `Mesh` (2 triangles per edge) for true variable-width lines (0.5–8.0 px); implemented per-edge quad buffers (`_quadEndABuf`, `_quadEndBBuf`, etc.) with zero per-frame allocation; vertex shader performs screen-space extrusion perpendicular to edge direction; added `uResolution` uniform sync and `DoubleSide` rendering.

---

## [0.8.1] — 2026-04-16

### Added
- **Hypercube edge width shader (Session 1)** — Replaced `LineBasicMaterial` with `ShaderMaterial` on hypercube edges; `uEdgeWidth` uniform wired through `_lineMat` and updated per-frame; added `setEdgeWidth()` public setter (0.5–8.0 clamp); `hypercube.edgeWidth` parameter registered and UI slider added.

---

## [0.8.0] — 2026-04-16

### Added
- **N-D Hypercube engine (4D–12D)** — 60fps performance at 12D; vertex/edge generation, Givens projection, morph state machine with 5 easing functions; permanent Float32/Float64 buffers with zero per-frame allocation; `_colorsDirty` GPU gate; `MAX_DIM` draw range; circular points shader; vertex pub/sub
- **Hypercube UI** — dimension pills, collapsible rotation tiers, deferred DOM rebuild on morph

### Fixed
- Color offset and morph doubling issues
- JS heap leaks and redundant GPU uploads
- Missing edges and morph freeze bugs

---

## [Unreleased] — Noise System Overhaul (D1)

### Added
- feat(scene3d): HypercubeInstancer — InstancedMesh at hypercube vertex positions, geo types sphere/box/cone/torus/octahedron, scale, opacity controls
- feat(scene3d): Instancer texture — pipeline output wired to instancer material each frame
- feat(scene3d): render mode 'none' — hides wireframe and points for instancer-only view
- feat(scene3d): SceneManager adopts HypercubeInstancer mesh — unified material pipeline; instancer now receives texture, lights, and material params from existing Material panel without separate wiring

### Fixed
- fix(pipeline): unbind blend uPrev before copyToPrev — eliminates WebGL feedback loop
- fix(scene3d): zeroMatrix was identity — caused ghost planes at origin
- fix(scene3d): hFaces.update moved after projection — was reading stale projBuf
- fix(scene3d): use emissiveMap on instancer — texture now renders without scene light dependency
- fix(scene3d): setVisible() now updates _visible flag — was only setting mesh.visible
- fix(scene3d): removed per-frame setInstancerTexture() call from main.js — SceneManager now owns instancer texture via _adoptMesh
- fix(scene3d): emissive forced white when texture active on adopted mesh
- fix(scene3d): feedback loop guard bypassed for adopted instancer mesh

## [0.61.0] — 2026-04-14

### Added
- **Program > Bank > State Hierarchy:** Completely overhauled the UI and mental model to standard performance software hierarchy. "Presets" are now "Banks", and "Display States" are now "States".
- **Factory Banks JSON:** Engine now fetches default setups from `public/factory-banks.json` instead of relying on hardcoded JavaScript arrays, making them human-readable and easily editable.
- **Auto-Thumbnailing:** Right-clicking a bottom menu dot to save a State now automatically captures the canvas and attaches a thumbnail to the State in the sidebar.
- **Sidebar State Management:** The sidebar now lists all 64 States in the active Bank. Users can click a State name to rename it, or click the `▶` button to load it directly from the list.
- **Bank Selector Dropdown:** The bottom right corner now features a sleek, dark-themed `<select>` dropdown for instantly switching between Banks.
- **AI State Generator Polish:** Renamed from "AI Preset Generator", moved into the Project tab, and added a quick-access `⚙ API Settings` button.

### Changed
- **UI Tab Renamed:** The "Presets" tab is now the "Program" tab.
- **Section Reorganization:** Side panel sections are logically ordered top-to-bottom: `PROGRAM`, `BANKS`, `STATES`, `STATE STEP SEQUENCER`.
- **Randomize Button:** Moved from the Banks section to the States section (as randomizing generates a new State, not a Bank).

### Added
- 38 noise types (up from 8) across 6 categories in NOISE_BFG shader
- Classic: White Noise, Film Grain, Gaussian, TV Static, Scan Lines, Salt-and-Pepper
- Structured: Voronoi F1, Manhattan, Chebyshev, Caustics, Flow Noise, Worley Veins
- Geometric: Truchet, Hex Grid, Gabor, Blue Noise, Poisson Disc
- Signal & Video: Speckle, RGB Shift, Interlace, VCR Noise, Speckle Colour, Pixel Sort
- Fractal & Fluid: fBm, Turbulence, Billowed, Domain Warp 2, Velocity Field, Advection, Marble
- New GLSL helpers: voronoi() with metric selector, h2() vec2 hash, turbulence(), billowed()
- noise.color promoted from TOGGLE to SELECT (Off / Tri-channel / Color Mix)
- Color1/Color2 pickers wired to uColor==2 mix(color1, color2, noiseVal) in shader
- Noise panel separated from Color panel into own "Noise" section

### Fixed
- smoothstep(0.4, 0.15, x) edge-order undefined behaviour — replaced with safe equivalent
- h1(vec2) type errors — all calls wrapped to vec3 for GLSL ES compliance
- floor(hex + 0.5) used instead of round() for WebGL 1 / GLSL ES 2.00 compatibility

---

## [0.7.0] — 2026-04-10

### Added
- **Text animation system** — `text.rate` + `text.autoplay` auto-advance clock (LFO/MIDI/sound-assignable); `text.animMode` (Bounce/Wave/Fade/Typewriter), `text.animSpeed`, `text.animAmt`; `text.contentIdx` indexes multi-line textarea content, MIDI/LFO-driveable
- **Text typography params** — `text.letterspacing`, `text.rotation`, `text.shadowBlur/X/Y`, `text.bgOpacity`, `text.outlineHue/Sat` (independent outline color)
- **3D material types** — `scene3d.mat.type` SELECT: Standard / Toon (3-step gradient) / Normal / Matcap / Lambert / Phong; live switch without losing values
- **3D rim / Fresnel** — `scene3d.mat.rim` (0–1), `scene3d.mat.rimHue` (0–360°); injected into `onBeforeCompile` fragment shader
- **3D material extras** — UV animation (`uvSpeedX/Y`), independent emissive color (`emissiveHue/Sat`), `envIntensity`
- **Vasulka Warp (temporal slit-scan)** — `VasulkaWarp.js`: `DataArrayTexture` ring buffer (30–90 frames, 480p or 960p); each column samples a different moment in time with bilinear blending; params: `vwarp.active`, `strength`, `axis` (H/V), `flip`, `mix`, `depth`, `quality`; routable as source 22 "VWarp"; GLSL3 shader (`sampler2DArray`, `glslVersion: THREE.GLSL3`)
- **Vasulka UV warp** — dual-oscillator scan-line UV distortion effect in pipeline FX chain (`vasulka.*` params)
- **Particle improvements** — FG/BG/DS mask sources (indices 6/7/8); emitter shapes (Box/Ring/LineH/LineV/Point); `scaleby` (Uniform/By-Life/By-Speed); 2 attractor/repulsor nodes with strength and position
- **Responsive layout** — CSS media query breakpoints for 4K (≥2560px), tablet (≤1200px), slide-over panel (≤900px), full-width (≤600px); `@media (pointer: coarse)` 44px touch targets; `overscroll-behavior` + `touch-action` on panels and param rows
- **iPad touch input** — all param row drags use Pointer Events + `setPointerCapture` (replaces mouse events); long-press (500ms, ≤8px movement) opens context menu with haptic; thin 3px range slider under every CONTINUOUS param row for finger adjustment; `touch-action: manipulation` eliminates 300ms tap delay
- **Controller badge popover (all types)** — `_openCtrlPopover` expanded: `midi-cc` (CC#, Chan drag), `midi-note` (Note#, Chan), `key` (click-to-capture), `expr` (live text input); Slew + Table rows now shown for all controller types; tap (touch) or ctrl+click (desktop) opens popover; badge label refreshes immediately via `param.notify()` after assignment
- **LFO popover improvements** — beat-sync LFOs show "Beat ÷N" label instead of "Freq (Hz)"; `lfo-rampdown` (LFO↘) and `lfo-sh` (S+H) added to badge label map
- **Temporal Smear demo preset** (preset 5) — two-state preset: builds VWarp history then switches to temporal slit-scan output

### Fixed
- Keyer breaking on Layer Color changes — `keyer.rawkey` toggle makes keyer use pre-color-correction FG for luma computation
- `_rebuildMaterial` missing `oldMat.dispose()` — GPU resources leaked on every 3D material type switch (fixed)
- GLSL `setCustomShader` false 1281/1282 errors — drain stale error queue before compile; check program link status via `getProgramParameter/getProgramInfoLog`
- VasulkaWarp GLSL3 syntax errors — fixed WARP_FRAG/VERT to use `in/out`, `fragColor`, `texture()`; added `glslVersion: THREE.GLSL3`; `_texInited` properly initialized; added VWarp to `Pipeline._resolveSource`

---

## [0.7.1] — 2026-04-11

### Added
- **SequenceBuffer timewarp mode** — slit-scan temporal buffer, absorbs VasulkaWarp concept. New params: `seq${n}.mode` (Loop/TimeWarp), `tw.axis`, `tw.flip`, `tw.speed`, `tw.mix`, `tw.offset`, `tw.warp`
- **Temporal density control** — `tw.speed` governs columns per frame: speed=1 → 1 col/frame (~21 s range at 60 fps); speed=3600 → 1 col/second (~21 hr range)
- **Strip RT persistence via IndexedDB** — timewarp strip saves automatically on project save, restores on project load; slit-scan state survives page reloads across sessions
- **VasulkaWarp deprecated** — kept in codebase for compatibility, removed from UI and signal path

---

## [0.6.0] — 2026-04-05

### Added
- **Auto-load clips from `_imweb_ready/`** — on startup ImWeb reads `_imweb_ready/manifest.json` and loads all listed clips automatically; `imweb-prep.js` writes/updates the manifest after each conversion run
- **Movie On/Off button** in status bar replaces FIT/FAST/MED/MAX/LOW resolution buttons; shows "Movie On" / "Movie Off"; always starts off regardless of saved preset state
- **MuteMovie parameter** — toggle audio output per movie session; defaults on (muted); turn off to hear clip audio; state applied to all loaded clips
- **Audio in prepped clips** — `imweb-prep.js` now keeps audio track (AAC 192k), re-encoded for browser compatibility; `0:a?` map so audio-less clips still process cleanly
- **q / a / z keyboard shortcuts** — cycle Foreground / Background / DisplaceSrc through all 22 source inputs
- **Settings panel** (was "AI Settings") — renamed ⚙ button; panel now has three sections: AI Provider, Documentation (Quick Reference + Full Manual links), Video Prep (imweb-prep.js command + spec)
- **Video prep guide** in Clips tab — inline hint with format and prep command
- **Improved clip load error message** — explains codec failure and points to `imweb-prep.js`
- **Reef GLSL preset** — ray-marched crystalline structure; float equality bug fixed (range checks replace `w == 1.0` / `w == 9.0`)
- **Tunnel GLSL preset upgraded** — wormhole with Speed, Dir X, Zoom (1–8×), Width parameters; texture visible inside tube

### Fixed
- GLSL shaders with non-ASCII characters in comments (`×`, `–`, `π`) caused WebGL error 1282 on Apple Silicon — replaced with ASCII equivalents
- Movie `video.play()` on startup blocked by browser autoplay policy — movie now starts off; user activates via Movie Off/On button
- Preset restore setting `movie.active = 1` caused button to show "Movie On" on load — explicitly reset to 0 after `presetMgr.init()`

### Planned (Phase 6)
- GLSL editor: resolve remaining WebGL 1281/1282 errors on preset apply
- Mobile-friendly UI — touch targets, responsive layout, mobile gesture support
- Multi-quad projection mapping
- Multi-cam workflow

---

## [0.5.1] — 2026-04-05

### Added
- **Touch-optimised projection mapping** — 64px handles (up from 40px, meets Apple HIG minimum); `<meta viewport user-scalable=no>`; `touch-action:manipulation` on body prevents iOS scroll bounce; handles always visible when projmap active (no hover dependency)
- **Tappable toolbar on output window** — ⊞ Grid and ⛶ Full buttons replace keyboard-only G key and double-click for iPad/phone use
- **Auto-hide handles and toolbar** — fade out after 3 seconds of inactivity; any touch/pointer resets timer; clean projected image during performance; compositor-only opacity transition (zero GPU cost)

---

## [0.5.0] — 2026-04-05

### Added
- **SDF Generator Phase 3** — camera navigation (camX/Y/Z, lookAt matrix), KIFS fractal folding (kifsIter 0–5, kifsAngle), op mode (Soft Union / Soft Cut / Morph), video luma displacement (lumaWarp, lumaThresh), animation speed, triplanar video texturing (texBlend), AO + step-count glow, HSV colour (hue/sat/val), glass refraction + Fresnel, dedicated texture routing (texSrc / refractSrc decoupled from pipeline FG/BG layers)
- **Factory demo presets** — 5 camera-free presets seeded on first launch: SDF Metaballs, Noise Feedback, 3D Orbit, KIFS Fractal, Cloner Wave; each sets layer sources and key effect params for immediate exploration
- **Non-realtime frame capture** — 📷 button in status bar pauses the RAF loop; Step Frame exports `imweb-capture-NNNN.png` at fixed dt; Auto-Run steps N frames sequentially with browser-flush delay between downloads
- **Projection mapping improvements** — calibration grid (G key in output window) draws a 10×10 perspective-correct grid on the projected surface; click a corner handle then use arrow keys to nudge 1px (Shift = 10px); hint bar shows shortcuts
- **GLSL editor reliability** — `applyGLSL()` now auto-injects all standard pipeline uniform declarations (`uTexture`, `uTime`, `uParam1–4`, `vUv`) when absent, so built-in presets compile without error 1282

### Fixed
- Division-by-zero NaN crash in Tunnel GLSL preset — `length(uv)` clamped with `max(..., 0.0001)` to prevent Infinity → NaN → Metal INVALID_OPERATION on Apple Silicon

---

## [0.4.2] — 2026-04-04

### Added
- **3D Cloner / MoGraph** — InstancedMesh clone mode for any 3D geometry; count, spread, wave animation, WaveShape (Sine/Square/Triangle/Sawtooth), WaveAmp, WaveFreq, Twist, Scatter, CloneScale, ScaleStep (progressive taper on positions + wave height); all MIDI/LFO-assignable
- **Blob/Morph vertex displacement** — `onBeforeCompile` shader injection onto `MeshStandardMaterial`; 3D value-noise displacement along surface normals; `USE_INSTANCING` guard offsets noise lookup per clone so each instance morphs independently; BlobAmount, BlobScale, BlobSpeed params
- **SDF Generator Phase 1** — standalone GPU raymarching engine (`SDFGenerator.js`) rendering two orbiting metaballs into a `WebGLRenderTarget`; routable as pipeline source index 21 (SDF) to FG/BG/Displacement layers; params: SDFActive, SDFBlend, SDFDist
- **SDF Generator Phase 2** — upgraded GLSL with: SDFShape selector (Sphere / Box / Torus), Infinite domain repetition (SDFRepeat — tiles scene in all directions), Surface displacement (SDFWarp — sin-product warp with conservative step scaling to compensate Lipschitz inflation); orbit radius auto-scales within repetition cells

---

## [0.4.1] — 2026-04-03

### Added
- **Movie reverse playback** — negative `MovieSpeed` now steps frames backward manually (browser rejects negative `playbackRate`)
- **MovieEnd parameter** — clip end-point moved from `MovieLoop` to new `MovieEnd %` param (0–100%)
- **MovieLoop modes** — `MovieLoop` is now a SELECT: Off / Forward / Backward / Ping-pong
- **MoviePos always scrubs** — position scrub no longer requires a controller assigned; responds to any drag/set of the param
- **Clip right-click menu** — right-clicking a clip card now shows "Assign MIDI controller" and "Remove clip" instead of instant delete

### Fixed
- `movieInput.texture` undefined — corrected to `movieInput.currentTexture` in render loop

---

## [0.4.0] — 2026-03-20

### Fixed (2026-03-30)
- **Duplicate material params** — removed double-append to #material-params in UI.js; bulk sections loop is now the single source of truth
- **3D light parameters expanded** — added Ambient, Point Int., Light X, Light Y, Light Z params; all MIDI/LFO-assignable; wired to AmbientLight, PointLight, and DirectionalLight.position in SceneManager
- **MeshoptDecoder** — GLB files compressed with Meshopt now load correctly

### Added
- **MeshoptDecoder support** — GLB files compressed with Meshopt now load correctly (setMeshoptDecoder wired in SceneManager.js)
- **3D depth pass → DisplaceSrc** — dual mode: Distance (grayscale depth map) and Normals (surface orientation as RGB); auto-activates when 3D Depth routed to any layer
- **WarpMap on 3D UV coordinates** — hand-drawn warp displacement applied to mesh UV skin
- **Live video texture on 3D mesh** — Camera / Movie / Screen / Draw / Buffer / Noise routable as mesh texture across all sub-meshes
- **Robust GLB/GLTF import** — Draco compression support via DRACOLoader; material propagation across sub-meshes
- **High-resolution Tables** — upgraded from 256 to 16,384 points; linear interpolation for smooth response curves
- **Zero-latency second monitor** — replaced cross-window polling with ImageBitmap + postMessage transfer
- **Ghost mode optimisation** — main canvas uses visibility:hidden (not opacity) when outputting to second monitor; saves GPU compositor cycles
- **rand1 / rand2 / rand3** — three independent global noise oscillators added to ControllerManager
- **WarpMap slots** — expanded from 4 to 16 storable slots
- **Resolution buttons renamed** — FAST (540p) / MED (720p) / MAX (1080p) / LOW (half) for clearer performance context
- **AI provider system** — switchable Anthropic / Gemini / OpenAI / Ollama; key management UI; Narrator (N) and Coach (P) features

### Fixed
- 3D models invisible after WarpMap update — added fallback textures and safety guards for UV-less geometry
- Switching from imported models to primitives crashed — safe disposal checks in _replaceMesh
- 3D Depth UI not updating — use ps.set() instead of direct property write for scene3d.depth.active
- Second screen slowdown in Chrome — switched to postMessage frame transfer
- ResizeObserver guard issue in ghost mode resolved

---

## [0.3.0] — 2026-03-19

### Added
- **Sequencer buffers** — 3 independent sequence recorders; variable frame count (4–480 frames), per-seq source selector, VRAM estimate hint
- **Sequence source UI** — dedicated compact button rows (Out / Cam / Mov / FG / BG / Buf / Draw) replacing the generic SELECT param that opened a controller menu
- **Second monitor output** — `⊡` button opens a popup that mirrors the output canvas with letterbox scaling; auto-fits any monitor resolution
- **Ghost mode** — `◫` dims the main output canvas (opacity 0.18) when second screen is active; no layout change, purely visual
- **Movie clip thumbnails** — Clips tab shows card layout with 160×90 JPEG thumbnail (seeks to 10% of duration to avoid black frame), clip name, duration, remove button
- **Signal path float/dock** — `┄` toggle in status bar moves the signal path display to a floating overlay or back into the panel
- **LUT node in signal path** — 3D LUT (.cube) colour grading visible in signal path display
- **Status bar resolution buttons** — Fit / 540 / 720 / 1080 / ½ buttons in status bar replace the non-functional canvas overlay; clears CSS overrides for fixed resolutions
- **Startup defaults** — camera auto-starts, all three layers set to Camera source, all panel sections collapsed except Layers
- **Cmd+S quick-save** — saves current parameter state to the active preset slot
- **3D scene auto-spin** — `spin.x/y/z` parameters for continuous model rotation; speed and axis controllable
- **Audio VU meter** — real-time level meter in status bar derived from audio analyser
- **BPM-synced movie clips** — lock clip playback position to beat phase; configurable beat length (1/2/4/8/16 beats)
- **Step sequencer for presets** — automate preset recall in rhythmic steps; configurable pattern and BPM
- **Parameter lock** — lock any parameter against accidental changes from controllers
- **3D LUT colour grading** — load `.cube` LUT files; applied as post-process pass
- **GLSL param uniform binding** — expose up to 4 custom uniforms (uParam1–uParam4) to the live GLSL editor
- **Audio beat detection** — auto-BPM from onset detection; drives LFO retrigger and BPM sync
- **GPU particle system** — procedural particle field as pipeline source (index 16)
- **Built-in GLSL shader presets** — 10 example shaders selectable from the GLSL editor tab
- **Quad mirror and levels correction** — added to effects chain
- **Vectorscope input** — Lissajous / waveform / FFT visualiser as pipeline source
- **LFO visualiser** — waveform preview in the controller context menu
- **Film grain, scanlines, feedback rotate/zoom** — new effect parameters
- **Video delay line and pixel sort** — new effect passes
- **MIDI clock sync** — playback and BPM locked to incoming MIDI clock
- **Kaleidoscope, bloom, vignette, chroma key, frame blend, per-layer HSB** — all added as effect parameters
- **Parameter slew/smoothing** — right-click → Set Slew → enter time in seconds
- **Ctrl+click to type exact value** — on any parameter knob/slider
- **Automation recorder** — record parameter movements with loop playback
- **Preset morph animation** — smooth crossfade between two preset states over configurable time
- **FFT audio analysis** — sound-bass / sound-mid / sound-high controller types
- **Parameter search overlay** — press `/` to search all parameters by name
- **Drag-and-drop file loading** — drop video or image files directly onto the app
- **Keyboard help overlay** — press `?` for shortcut reference
- **MIDI output feedback** — send CC values back to motorized faders
- **MIDI channel filter** — assign CC/Note on specific channels only
- **MIDI PC → preset recall** — program change messages recall presets by number

### Fixed
- ResizeObserver now guarded: does not fire `renderer.setSize` when ghost mode is active (was incorrectly resizing second monitor popup)
- `applyResolution` clears `style.width/height` for fixed resolutions to prevent Three.js canvas being stretched back to container width
- Seq source right-click no longer opens controller assignment menu (replaced with dedicated buttons)
- Section header text matching uses first text node to avoid including button text in comparison

---

## [0.2.0] — 2026-03-18

### Added
- **Movie clip playback** — load video files; speed, position scrub, loop range, mirror; up to 8 clips; Shift+1–8 to select
- **Stills buffer** — capture up to 16 frames; FrameSelect 1/2/3 to composite
- **Slit scan buffer** — rolling scan effect as pipeline source
- **Text layer** — live text with font, size, colour, position, scroll scripting
- **WebRTC camera input** with auto-start and device selection
- **Preset system** — save/load/morph between parameter states; 128 Display States per preset; IndexedDB persistence
- **WebM recording** — record output to WebM video file
- **Fullscreen output** — double-click canvas or Cmd+F
- **Draw layer** — freehand canvas drawing as pipeline source
- **External MIDI input** — MIDI CC and Note as parameter controllers
- **Output resolution selector** — Display / 720p / 1080p / 540p / Quarter

---

## [0.1.0] — 2026-03-18  *(initial build)*

### Added
- **Core compositing pipeline** — Three.js WebGL render targets; foreground, background, and displace-source layers
- **Full parameter system** — reactive parameters with `onChange`, grouped by namespace
- **Controller mapping** — Mouse X/Y, MIDI CC, LFO ×4, Sound level, Random, Fixed value, Key
- **Luminance keyer** — KeyLevelWhite, KeyLevelBlack, KeySoftness
- **Displacement** — amount, angle, offset, RotateGrey
- **Blend** — frame persistence / motion blur
- **Feedback** — HorOffset, VerOffset, Scale
- **TransferMode** — Copy, XOR, OR, AND
- **ColorShift, Interlace, Fade, Mirror**
- **Color source** — HSV solid colour generator
- **Noise source** — pixel noise generator
- **3D scene as pipeline source** — all geometry types, transforms, material, camera; GLTF/GLB/OBJ/STL import
- **Signal path display** — live visual of the FG/BG/DS routing and effect chain
- **Dark performance UI** — collapsible panel sections, tabbed inputs, parameter rows with knobs/sliders

[0.3.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/haraldurkarlsson/ImWeb/releases/tag/v0.1.0

[0.9.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.9...v0.9.0
[0.8.9]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.7...v0.8.8
[0.4.2]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.3.0...v0.4.0
