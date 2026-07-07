# ImWeb v0.11.0 — Dual-Deck Video Blueprint (A/B Mixing)

*Architectural brainstorm, 2026-07 — no code yet. Structural map for adding a
second real-time video stream for A/B crossfading, texture blending, and
displacement masking.*

---

## 0. The reframe that shapes everything

ImWeb is **already a two-channel video mixer**. The pipeline composites
FG over BG (plus DS displacement) with a keyer and blend modes — `layer.fg`
/ `layer.bg` / `layer.ds` each select from the same source list (Camera,
Movie, SDF, Scene3D, Noise, Particles, …). Camera-over-Movie mixing works
today.

What ImWeb cannot do is put **two different video files** into two slots at
once, because `MovieInput` is a singleton deck: one active `<video>`, one
`VideoTexture`, one `movie.*` param group, one clips playlist.

**Therefore v0.11 is not "add a second video pipeline" — it is "add a second
movie deck (Deck B) as one more source index, plus a dedicated crossfader."**
The compositing machinery already exists. This reframe cuts the work by
roughly half and keeps the signal model coherent.

---

## 1. Pipeline alterations

### 1a. Second deck, not second pipeline
- Instantiate a second `MovieInput` ("Deck B") with its own `<video>`
  element, own `VideoTexture`, own clips array. The class needs an audit for
  singleton leakage (module-level state, hardcoded DOM ids) but is
  instance-shaped already.
- Register Deck B's texture as a **new source index appended to the END** of
  the shared source list (see §3b for why append-only is load-bearing).
  FG=MovieA + BG=MovieB then mixes through the existing compositor for free.

### 1b. The MixBus pass (the actual new pipeline work)
The existing FG/BG blend gives crossfade-adjacent results, but a proper A/B
instrument wants a dedicated **MixBus pass at the head of the chain**,
before the FX ping-pong:

```
deckA ─┐
       ├─ MixBus (xfade / add / mult / screen / displace / luma-mask) ─→ FX chain → out
deckB ─┘
```

- One new fragment shader in `src/shaders/index.js` with `tA`, `tB`,
  `uXfade`, `uMode`, `uDispAmt` uniforms; added via `Pipeline.addPass()`
  following the existing minimal-pass convention.
- **Displacement mode**: B's luma displaces A's UVs (`uv + (lumaB - 0.5) *
  uDispAmt`) — cheap, one texture fetch, and it is the Vasulka move.
- **Luma-mask mode**: `mix(A, B, smoothstep(lo, hi, lumaB))` — reuses keyer
  vocabulary.
- The MixBus OUTPUT should itself be a selectable source ("Mix") in the
  layer lists, so the mixed A/B signal can be FG over a Camera BG, etc.
  This keeps the source-graph model instead of hardcoding a topology.

### 1c. Performance budget (the real constraint)
- **GPU binding is free** — two video textures on two texture units is
  nothing. The tax is elsewhere:
- **Decode**: two simultaneous H.264 sessions. Fine on M-series iPads and
  the AMD 5500M; borderline on old Intel iGPUs. Keep the existing ALL-I
  re-encode discipline (`imweb-prep.js`) — it matters twice as much with
  two decks scrubbing.
- **Upload**: two `texImage2D` uploads per frame ≈ 2×1080p — gate EACH deck
  with the Phase-5 lesson: rVFC never fires for off-DOM file videos, so use
  `currentTime` change detection per deck; never upload a frame that didn't
  change.
- **Idle-deck optimization**: when `mix.xfade` sits at 0 or 1, the hidden
  deck's TEXTURE UPLOAD can stop (keep playback running for cue). This
  makes the worst case (performing on one deck) cost the same as v0.10.
- **Never** synchronously seek/decode on the main thread during a
  crossfade; deck loading stays async exactly like current clip loading.

---

## 2. Global state & parameters

### 2a. Namespace: mirror, don't migrate
- `movie.*` stays EXACTLY as-is and means **Deck A**. Every saved state,
  bank, project, MIDI mapping, and MasterProject on earth references
  `movie.speed` etc. — renaming to `movieA.*` breaks all of them for zero
  functional gain.
- Add `movieB.*` as a structural mirror (speed, loop, in/out, bpmSync,
  active, …) — same declarations, different id prefix; a loop over a shared
  descriptor table keeps them from drifting.

### 2b. New `mix.*` group (not `global.*` — global is settings/meta)
| Param | Type | Notes |
|---|---|---|
| `mix.xfade` | CONTINUOUS 0–1 | THE crossfader. Controller-assignable ⇒ MIDI fader, LFO auto-fade, tilt-to-fade for free |
| `mix.mode` | SELECT | Crossfade / Add / Multiply / Screen / Displace / LumaMask (append-only forever) |
| `mix.dispAmt` | CONTINUOUS | displacement depth |
| `mix.maskLo` / `mix.maskHi` | CONTINUOUS | luma-mask thresholds |

- Because these are ordinary Parameters, everything composes for free:
  states snapshot the fader, state MORPH sweeps it (state-morph + xfade is
  a genuinely new performance gesture), Automation records it, the
  StepSequencer steps it.

### 2c. Clip library / UI routing
- `ClipLibrary` (8 banks × 16, MIDI-note mapped) needs a **target-deck
  concept**: load-to-A vs load-to-B. Cleanest: a deck toggle in the Clips
  tab + "send to B" in the clip context menu; MIDI-wise, dedicate banks to
  decks rather than doubling the note map.
- New `movieB` UI section mirrors the movie tab (build both from one
  builder function, parameterized by prefix — same discipline as the param
  mirror).

### 2d. Persistence
- Project/state schema: `movieB.*` and `mix.*` params serialize exactly like
  every other param — old files simply lack them and inherit defaults
  (xfade=0 ⇒ pure Deck A ⇒ **old projects render identically**). Deck B's
  clip/asset refs need a new project-file field; follow the Save/Load
  debugging protocol — design the serialized shape FIRST, then the code.

---

## 3. The biggest structural gotcha

### 3a. #1: The singleton movie wiring in main.js
Not `MovieInput` the class — `movieInput` the **integration web**. main.js
(~6k lines) wires the one deck into: the clips list UI + drag-drop, keyboard
shortcuts (`m` toggle, `Shift+1–8` clip select), BPM sync, thumbnails,
ClipLibrary, project save/load, and the render-loop tick. Dozens of call
sites assume THE movie. The engine won't fight this feature — **the
integration hub will**. Budget the majority of v0.11 for main.js wiring and
UI mirroring, not for pipeline work (the MixBus shader is a day; the wiring
is weeks).

### 3b. #2 (sleeper, data-destroying): index-persisted SELECT options
`layer.fg/bg/ds` (and every SELECT) persist their value as an **integer
index into the options array**. Inserting "Movie B" or "Mix" anywhere but
the true end of the source list silently re-routes every saved state in
every user's IndexedDB and every .imweb file (a state saved as "Scene3D"
recalls as whatever shifted into its index). Append-only is an iron rule
for this feature — and worth a code comment at the options arrays because
nothing else enforces it.

### 3c. Honorable mentions
- iPad thermal/decoder budget with two 1080p streams + WebGL chain — needs
  a real device soak test, not a bench guess.
- `movie.*`-hardcoded controller mappings in existing projects will all
  target Deck A — correct behavior, but document it.
- The GestureArbitrator/canvas grammar has no concept of deck focus; if
  touch gestures should ever address "the B deck," that's a mode question
  to resolve in design, not code.

---

## Suggested build order (each step ships alone)

1. `MovieInput` singleton audit → instantiate Deck B headless (no UI), tick
   it in the render loop, expose as appended source index. Verify FG=A/BG=B
   mixing through the EXISTING compositor.
2. `mix.*` params + MixBus pass + "Mix" as a source. Crossfade mode only.
3. Blend/displace/luma modes in the MixBus shader.
4. Deck B UI section + ClipLibrary deck routing + project-file field.
5. Idle-deck upload gating + iPad soak test.
