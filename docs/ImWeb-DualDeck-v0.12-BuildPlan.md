# ImWeb v0.12.0 — Dual-Deck A/B Video: Verified Build Plan

*Execution plan, 2026-07-09. Companion to `ImWeb-DualDeck-v0.12-Blueprint.md`
(the architectural brainstorm). This document grounds that brainstorm in the
**actual current code**, corrects three assumptions that don't hold, and gives
a step-by-step build order where each step ships and is verifiable alone.*

---

## Goal

Add a second real-time movie deck ("Deck B") plus a dedicated A/B crossfader,
so two different video files can play into two source slots at once and be
mixed (crossfade / blend / displace / luma-mask) through the existing
compositor. Old projects must render identically (crossfader defaults to pure
Deck A).

---

## Blueprint corrections (verified against source)

These three points change the plan versus the brainstorm — confirmed by reading
the code:

1. **There is no `Pipeline.addPass()` registry.** `Pipeline.render()`
   (`src/core/Pipeline.js:282`) is one long hand-written straight-line sequence
   of `this._pass(material, uniforms)` calls. Materials are prebuilt once in
   `_buildMaterials()` (~line 837) via a `_mat(GLSL, uniforms)` helper and keyed
   as `this.m.<name>`. The MixBus is therefore **a new material built in
   `_buildMaterials()` and a new `this._pass()` call inserted by hand** into
   `render()` — not a plug-in pass. The one genuinely declarative chain is the
   post-FX loop (`DEFAULT_FX_ORDER` + `_FX` map, lines 29–35, run at 491–493),
   but that's post-processing, not the pre-FX A/B compositing stage we need.

2. **The source list is NOT one shared array — it's several hand-maintained
   copies that must be kept in lockstep.** The append-only rule (blueprint §3b)
   is real but harder than implied:
   - `SOURCES` in `src/controls/ParameterSystem.js:447-473` (25 entries) — feeds
     the `layer.fg/bg/ds` SELECT options **and `td.captureSource`**
     (`ParameterSystem.js:3581`), which mirrors the layer list for full parity.
   - A **separate** `SOURCES` key array in `src/core/Pipeline.js:777` — the
     actual render-time lookup in `_resolveSource()`.
   - A **third** `keys` array in `_resolveLayerTex()` at `src/main.js:3024-3049`
     — and it's already out of sync (missing index 24 `tdisp`). Because
     `td.captureSource` offers the full `SOURCES` list, this desync is live:
     any append here must first restore `tdisp` at index 24 or the new entry
     lands one slot early (see Step 1).
   - Four more **independent, differently-ordered subset arrays** for
     `buffer.source` (`ParameterSystem.js:1224`), `sdf.texSrc`/`refractSrc`
     (`2424`/`2442`), `particle.masksrc` (`3388`), and `SEQ_SOURCES` (`3728`).
   - The live `inputs` object is assembled every frame in
     `src/main.js:5492-5519` and passed to `pipeline.render(inputs, ps, dt)`.
     **There are two `pipeline.render()` call sites**, not one: the main loop
     at `main.js:5540` and `_stepCaptureFrame()` at `main.js:4231`, which
     renders a deterministic frame for PNG capture outside the main tick.

3. **No "declare N params from a shared descriptor loop" precedent exists.** The
   `movie.*` group (`ParameterSystem.js:1403-1483`, 9 params) is hand-written,
   and `seq1/2/3` are also written out longhand three times — the blueprint's
   claim that seq params demonstrate a descriptor loop is wrong for the
   *registration* side. The prefix-loop pattern **does** exist on the *UI* side:
   `buildSeqParams()` (`src/ui/UI.js:400`) internally does `[1,2,3].forEach(...)`
   building ids via `` `seq${n}.active` ``. So: introducing a descriptor loop for
   `movie`/`movieB` registration is new work (fine, but budget it); the UI mirror
   has a clear analog to copy.

**Good news confirmed:** `MovieInput` is genuinely instance-shaped
(`src/inputs/MovieInput.js`) — no module state, no fixed DOM ids, detached
`<video>` elements per clip. `new MovieInput()` twice is safe *today*. The only
class-level change is de-hardcoding the `"movie."` param prefix inside `tick()`
(`MovieInput.js:140-242`, 7 read sites at lines 161, 164, 176, 177, 184,
195, 196). And `ClipLibrary` (`src/io/ClipLibrary.js`) is already deck-agnostic
storage — routing lives entirely at one main.js call site (`main.js:2966`).

---

## Where the work actually is

Per the singleton-wiring audit: ~43 direct `movieInput` references in main.js,
heavily concentrated in the clips UI / drag-drop block (`main.js:2668-2933`,
~15 refs), thinner across keyboard shortcuts (`Shift+1–8`, `m` toggle at
`4594`), ClipLibrary recall (`2966`), and the render tick (`5223`). Texture
*consumption* already uses the layer-list pattern (`inputs.movie`) and
generalizes cleanly. **The engine is a day; the main.js integration + UI mirror
is the multi-week cost.** Plan accordingly.

---

## Build order (each step ships and is verifiable alone)

### Step 1 — Deck B engine, headless (no UI)
- Parameterize `MovieInput` by param-prefix: **constructor arg** (`new
  MovieInput('movieB')`, stored as `this.prefix`, default `'movie'`) — not a
  `tick()` arg — so all internal reads use one source of truth and existing
  call sites stay unchanged. Replace the 7 hardcoded `"movie."` reads in
  `tick()`. Deck A defaults to `'movie'` → byte-identical behavior.
- `const movieInputB = new MovieInput('movieB')` in main.js near `movieInput`;
  add `movieInputB.tick(ps, 'movieB', beatPhase, dt)` next to the existing tick
  at `main.js:5223`. Note the **capture path**: `_stepCaptureFrame()`
  (`main.js:4231`) renders outside the main tick — Deck B texture freshness in
  capture mode depends on where its tick runs; if capture stepping must advance
  both decks, tick Deck B alongside Deck A in the same gated block.
- Register `movieB.*` params (mirror the 9 `movie.*`). Introduce a shared
  descriptor table + loop that registers both `movie.*` and `movieB.*` so they
  can't drift (new pattern — see correction 3).
- **First, fix the existing desync:** restore `tdisp` at index 24 in the
  `_resolveLayerTex()` keys array (`main.js:3024`) — appending to an array
  that's missing index 24 would put the new entry one slot early and silently
  mis-route "Movie B" for `td.captureSource`.
- **Append `"Movie B"` as index 25** to all **three** arrays: `SOURCES` in
  `ParameterSystem.js:447`, the key array in `Pipeline.js:777` (+ an
  `if (key==='movieB' && inputs.movieB) return inputs.movieB;` branch), and the
  `_resolveLayerTex()` keys array in `main.js:3024`. Add
  `movieB: movieInputB.active ? movieInputB.currentTexture : null` to the
  `inputs` literal at `main.js:5492-5519`. Add a code comment at each array
  marking it as one of a lockstep set.
- Note: `td.captureSource` inherits "Movie B" automatically (it shares the
  `SOURCES` options array) — time-displace capture of Deck B comes for free;
  include it in verification so it isn't a surprise.
- **Verify:** set `layer.fg = Movie`, `layer.bg = Movie B`, load a clip into
  each deck (temporarily via console), confirm both composite through the
  existing FG/BG blend. Spot-check `td.captureSource = Movie B`. `verdict
  console` for errors. Human visual confirm in real Chrome.

### Step 2 — `mix.*` params + MixBus pass (crossfade only)
- Register `mix.*` group: `mix.xfade` (CONTINUOUS 0–1, **default 0 = pure
  Deck A** for back-compat), `mix.mode` (SELECT, append-only), `mix.dispAmt`,
  `mix.maskLo`, `mix.maskHi`.
- Add a `MIXBUS` shader export to `src/shaders/index.js` (template off
  `TRANSFERMODE` — two `sampler2D` `tA`/`tB` + `uMode`, same shape as
  `uFG`/`uBG`/`uMode`). Crossfade mode only for this step:
  `mix(texA, texB, uXfade)`.
- Build it as `this.m.mixbus` in `_buildMaterials()`; insert one
  `this._pass(this.m.mixbus, {...})` in `render()`.
- **Defer "Mix as a selectable source" to Step 3+.** Exposing the MixBus output
  as source index 26 allows Mix→FG→Mix feedback cycles. When it is added, the
  resolve site must use the identity-check pattern
  (`tex === this.target.texture` — Guard Logic rule 3 in CLAUDE.md), copying
  whichever guard the existing self-feedback sources (`output`, `bg1`, `bg2`)
  already use — never a timing flag. Keeping Step 2 to the crossfader alone is
  the smaller, safer ship.
- **Verify:** assign a MIDI fader / LFO to `mix.xfade`, confirm A↔B crossfade;
  confirm state morph sweeps it (free, since it's an ordinary Param).

### Step 3 — Blend / displace / luma-mask modes (+ optional "Mix" source)
- Extend the MixBus shader `uMode` switch: Add, Multiply, Screen, Displace
  (`uv + (lumaB-0.5)*uDispAmt`), LumaMask (`mix(A,B,smoothstep(lo,hi,lumaB))`).
- If exposing "Mix" as appended source index 26: same three-array lockstep
  append as Step 1, plus the identity-check feedback guard from Step 2's note.
- **Verify:** cycle `mix.mode`, confirm each mode; check displacement uses
  `mix.dispAmt`, luma-mask uses `mix.maskLo/Hi`.

### Step 4 — Deck B UI + ClipLibrary deck routing + persistence
- Refactor the single movie-tab builder into a prefix-parameterized function
  (analog to `buildSeqParams`), call it for `'movie'` and `'movieB'`.
- Add a target-deck concept to clip loading: a deck toggle in the Clips tab +
  route `clipLibrary.recall()` (the one call site, `main.js:2966`) to the
  selected deck. Dedicate MIDI note banks to decks rather than doubling the map.
- Persistence: `movieB.*` and `mix.*` serialize as ordinary params —
  `ps.captureState()`/`tickMorph()` iterate `ps.getAll()` with no whitelist,
  so states, morphing, and `.imweb` save pick them up automatically (old files
  lack them → inherit defaults → **identical render**). Deck B's loaded clip
  needs **no new project-file field**: Deck A's clip is already excluded from
  `.imweb` (`ProjectFile.js:14-18`, blob URLs not portable); clips persist
  only via ClipLibrary's own IndexedDB. Deck B matches Deck A — session-only.
  Clip-ref persistence, if ever wanted, is a separate feature for both decks.
- **Verify:** save a project with both decks loaded + a mid-crossfade state;
  confirm round-trip. Load an old pre-v0.12 project, confirm it renders
  unchanged.

### Step 5 — Idle-deck upload gating + iPad soak test
- When `mix.xfade` sits at 0 or 1, stop the hidden deck's `texImage2D` upload
  (keep playback for cue) — worst case (performing on one deck) the cost is the
  same as v0.11. Reuse the Phase-5 lesson: gate each deck's upload with
  `currentTime` change detection (rVFC never fires for off-DOM file videos).
- **Verify:** real iPad soak test with two 1080p ALL-I clips — thermal +
  decoder budget is a device-measured question, not a bench guess.

---

## Hard rules carried from the blueprint / CLAUDE.md

- **Append-only, everywhere.** `layer.*` SELECT values are persisted as raw
  indices; inserting a source anywhere but the true end silently re-routes every
  saved state in every user's IndexedDB and `.imweb` file. Three arrays must
  stay in sync (correction 2) — comment each.
- **`movie.*` stays Deck A.** Never rename to `movieA.*` — every saved state,
  MIDI mapping, and MasterProject references `movie.speed` etc.
- **One task per prompt, one agent per task.** Each step above is its own
  session; do not stack.
- Update `CHANGELOG.md` and move any issues through `KNOWN-ISSUES.md` per
  normal-session rules.
