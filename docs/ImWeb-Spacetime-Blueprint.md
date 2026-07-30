# ImWeb — Spacetime Blueprint (Phases 25–27)

*Architectural proposal, 2026-07-29 — no code yet. Output of the post-v0.14
brainstorm session. Successor to `ImWeb-MixBus-Rethink-Blueprint.md`, which
established that ImWeb's best idea is "routing is data, not topology," and
`ImWeb-UI-Taxonomy-Phase24-Proposal.md`, which made the warp map performable.*

*Three phases were chosen from ~25 candidates. §11 records what was rejected and
why, so it is not re-derived. Two claims made early in this document's own
drafting were disproved while writing it; both corrections are marked in place
rather than quietly removed — see §4 and §9c.*

---

## 0. The reframe that shapes everything

ImWeb has five engines that all answer one question — *store recent frames,
sample them oddly* — and each answers it differently:

| File                                                 | Lines | The odd sampling                          |
| ---------------------------------------------------- | ----- | ----------------------------------------- |
| `src/inputs/TimeDisplaceEngine.js`                   | 418   | per-pixel delay from a 7-way mode switch  |
| `src/inputs/SequenceBuffer.js`                       | 326   | ×3, 4–480 frames, plus a `timewarp` mode  |
| `src/inputs/StillsBuffer.js`                         | 304   | 4/8/16/32 addressable stills, FrameSelect |
| `src/inputs/VasulkaWarp.js`                          | 206   | strip ring, `bufSize` 960                 |
| `src/inputs/SlitScanBuffer.js` + `VideoDelayLine.js` | ~200  | column sweep; ring tap by age             |

That is five vocabularies for one operation. The instrument exposes them as five
sources (13 `delay`, 15 `slitscan`, 22 `vwarp`, 24 `tdisp`, 17–19 `seq1/2/3`),
five panels, and five mental models, and a performer has to know which box to
open before they can ask a question about time.

**The reframe:** the frame history is a **volume in (x, y, t)**. Every one of
those five engines is that volume read along a **plane**. Video delay is a plane
parallel to x–y, offset in t. Slit-scan is a plane containing the t axis.
Time-displacement is that plane bent by a control texture. There is one
operation, and its parameter is *the orientation of the plane*.

This is not a new observation — it is Woody and Steina's, stated in the
mid-seventies as the "Time/Energy Object," and it has never been available as a
single continuous real-time control in any tool. Phase 25 makes the orientation
a knob.

**The compatibility rule is strict, as in Phase 23.** `SOURCE_DEFS` is not
touched, no source index moves, every existing `td.*`/`delay.*`/`slitscan.*`/
`vwarp.*` param id survives, and all five panels stay. This is a consolidation
*behind* the UI, not a redesign of it. The chosen level is **adapters** — see
§5 for what that costs and §5e for the one place it changes behaviour.

---

## 1. The engine already exists

The first draft of this document costed Phase 25 as a new engine subsuming
~1250 lines. **That was wrong, and the error is worth recording because it
inverts the phase's risk profile.**

`TimeDisplaceEngine.js` is already a spacetime buffer. It has:

- **A `WebGLArrayRenderTarget` ring with z = time** (`_allocate()`), written one
  layer per frame via `r.setRenderTarget(this._arrayRT, this._head)`.
- **A runtime capability probe** (`_probe()`) that renders a known green into
  layer 1, reads it back with `readRenderTargetPixels(..., 1)`, and falls back to
  N render targets if render-to-layer is broken — the ANGLE/Metal-on-Intel risk
  that bit this project in Chrome 148 is already handled, defensively, in code.
- **Buffer resolution decoupled from display** (`setBufferResolution`,
  `_bufW`/`_bufH`, `setUpscaleFilter`), so the ring's VRAM cost is a parameter
  rather than a consequence of canvas size.
- **A read shader that already computes a per-pixel delay map.**
  `ARRAY_READ_FRAG` derives a scalar `m` per fragment, gammas it by
  `uDelayCurve`, scales by `uMaxDelay`, clamps to real history, and samples
  `tRing` at that layer.
- **Its own header comment (line 15) calling it the "general successor to the
  deprecated VasulkaWarp strip-buffer."** The intent in this document was
  already written down in 2026; it was just never carried through to the other
  four engines.

The only thing standing between that and the sampling plane is how `m` is
produced: a **7-way `uMode` branch**, not a continuous orientation.

```glsl
    if (uMode == 0)      { m = vUv.x; }                    // slitScanX
    else if (uMode == 1) { m = vUv.y; }                    // slitScanY
    else if (uMode == 2) { m = (abs(vUv.x - uScanPos) < uScanWidth*0.5) ? 0.0 : 1.0; }
    else if (uMode == 3 || uMode == 4) { /* symmetric ramp about uScanPos */ }
    else if (uMode == 5) { /* radial from (uScanPos, uScanPosY) */ }
    else                 { m = luminance(texture(uNoiseTex, vUv).rgb); }
```

Every branch is a special case of one expression. **Phase 25 is a shader
generalisation plus a storage/read split — not a new engine.** That is the
single most important fact in this document, and it is why the phase is worth
attempting at all.

---

## 2. One ring, N taps

The expensive thing about a frame history is the **history** (VRAM). The cheap
thing is **reading** it (one fullscreen pass into one small render target).
Today, four engines each own both halves. Split them:

**`SpacetimeRing` — the storage.** One instance. Extracted from the ring half of
`TimeDisplaceEngine`: allocation and strategy choice, `capture(srcTex)`, `_head`
and `_count`, `setBufferResolution`, `resize`, `dispose`.

**`SpacetimeTap` — a plane, an output RT, and one read pass.** Many instances.
Each owns its plane parameters, publishes a `.texture`, and knows nothing about
storage beyond the ring handle it samples.

```
                       ┌─────────────────────────────┐
   capture source ────▶ │  SpacetimeRing  (x, y, t)   │
   (td.captureSource)  │  one allocation, one write  │
                       └──┬────┬────┬────┬───────────┘
                          │    │    │    │        one read pass + one small RT each
                    ┌─────▼┐ ┌─▼──┐ ┌▼───┐ ┌▼─────┐
                    │ tap  │ │tap │ │tap │ │ tap  │
                    │delay │ │slit│ │vwar│ │tdisp │
                    └──┬───┘ └─┬──┘ └─┬──┘ └──┬───┘
                       │       │      │       │
                  inputs.delay …slitscan …vwarp …tdisp
```

This is what makes the adapter answer affordable: four sources reading one
history at four different orientations costs **one ring and four small render
targets**, not four rings. Today `videoDelay` alone allocates 30 full-res
targets (`main.js:311`) while `tdEngine` allocates its own N-layer array and
`vasulkaWarp` a third buffer at `bufSize` 960. Phase 25 should *reduce* VRAM
while adding capability — that is testable, and §10 makes it an acceptance
criterion rather than a hope.

**Taps allocate lazily**, following the mix-bus precedent (`Pipeline.js:237`): a
project that routes no temporal source pays for no tap, and the ring itself is
not allocated until something captures.

---

## 3. The plane

### 3a. The continuous form

Replace the `uMode` branch with one expression. The plane is defined by an
**angle**, a **centre**, a **linear↔radial blend**, a **width**, and an optional
**map texture**:

```glsl
  // linear: signed distance along the plane normal, remapped to 0..1
  vec2  n      = vec2(cos(uAngle), sin(uAngle));
  vec2  d      = vUv - uCentre;
  float linear = dot(d, n) + 0.5;
  float radial = length(d) * 1.41421356;      // normalised to half-diagonal
  float m      = mix(linear, radial, uRadial);
  m = mix(m, uSymmetric > 0.5 ? abs(m - 0.5) * 2.0 : m, 1.0);
  if (uMapAmount > 0.0)                        // texture-driven displacement
    m = mix(m, luminance(texture(uMapTex, vUv).rgb), uMapAmount);
  // then: existing uInvert → uDelayCurve gamma → uMaxDelay → clamp to history
```

The tail of the pipeline — invert, curve, max delay, clamp to `uCount` — is
unchanged from `ARRAY_READ_FRAG` and keeps its existing parameters. Only the
production of `m` is generalised.

### 3b. The seven modes become presets

`td.mode` **stays**, as a SELECT that writes plane params rather than switching a
shader branch — the same "one recall implementation, the buttons set the param"
pattern Phase 24 used for `displace.warpPreset`. This table is the proof that
the generalisation loses nothing, and it belongs in the code as a comment:

| `td.mode` | angle | radial | symmetric | width / map |
|---|---|---|---|---|
| 0 slitScanX | 0° | 0 | no | — |
| 1 slitScanY | 90° | 0 | no | — |
| 2 warpLine | 0° | 0 | no | hard band at `scanPosition`, `scanWidth` |
| 3 slitScanXSym | 0° | 0 | yes | about `scanPosition` |
| 4 slitScanYSym | 90° | 0 | yes | about `scanPosition` |
| 5 radial | — | 1 | no | centre (`scanPosition`, `scanPosY`) |
| 6 noise | — | — | — | `uMapAmount` = 1, map = Noise output |
| **—** | **any** | **any** | **any** | **the oblique plane no mode reached** |

### 3c. What is actually new

**The oblique plane.** Time running diagonally across the frame, continuously
rotatable, with the rotation itself assignable to an LFO, MIDI CC or the pad.
Nothing in ImWeb does that today; the seven modes are axis-locked. A slow LFO on
`td.angle` sweeps the direction time flows through the picture, and there is no
mode switch, no discontinuity and no reallocation as it passes through the old
mode positions.

### 3d. CORRECTION — rotation of the coordinate, not one unified expression

*Implemented 2026-07-29. §3a–3c above describe replacing the seven-way `uMode`
branch with a single continuous expression, and `td.mode` becoming a preset
writer. **That design was not built, and should not be.** What shipped rotates
the sampling coordinate and leaves the shape math alone. The reasoning, since it
was not obvious until the exactness audit was actually attempted:*

**Two legacy quirks make a unified expression non-exact.**

1. **Modes 0/1 ignore `scanPosition`; modes 2–5 use it as their origin.**
   `m = uv.x` has no origin term at all. A single plane origin therefore cannot
   reproduce both families — it needs an extra "is the scan position meaningful"
   uniform whose only job is to encode which legacy mode you are in.
2. **The normalisation constant differs and one of them is wrong.** Modes 3/4 use
   `maxDist = max(scanPos, 1−scanPos)`; mode 5 hardcodes `0.70710678` *regardless
   of where the centre is*, so an off-centre radial has never been normalised
   correctly. Generalising to a true corner-maximum would silently change every
   saved off-centre radial state. Preserving both means carrying both constants
   and blending them — a continuous control whose endpoints are two different
   historical mistakes.

**And `td.mode`-as-preset-writer carries a contract nobody asked for.** Once the
plane params are the truth and the mode writes them, you need: a `Custom` mode
state for when the user moves a plane param directly; a re-entrancy guard so the
mode's own writes do not bounce back and set `Custom`; and a restore-order
contract, because a Display State containing both `td.mode` and plane params
gives a different result depending on which is applied last. That is three new
failure modes in the save/load path — the exact area `imweb-debugging` exists
for — bought in exchange for shape morphing.

**Rotation gets the actual prize without any of it.** `td.angle` rotates the
coordinate about the frame centre *before* the existing shape math. Every shape
becomes orientable, the angle is continuous, an LFO on it sweeps the direction
time runs through the picture with no mode switch — which is precisely what §3c
named as the new territory. And it is exact by construction rather than by audit:
`cos(0)` is `1.0`, `sin(0)` is `0.0`, and `x*1.0 − y*0.0` is bit-identical to `x`,
so at the default every one of the seven modes computes what it always did. No
`Custom` state, no guard, no restore-order question, and `td.mode` keeps meaning
exactly what it meant.

**Deferred, with no current plan to build:** the continuous linear↔radial and
symmetric blends. They are shape morphing, a different and lesser axis than
orientation, and the two quirks above are the price of entry. Revisit only if
playing the angle makes the shape boundaries feel like a limitation.

**What shipped** (group `td`, appended — the group already held 12):

| Param | Type | Range | Default | Note |
|---|---|---|---|---|
| `td.angle` | CONTINUOUS | 0–360° | 0 | rotates the map coordinate about the frame centre |
| `td.mapSource` | SELECT | `SOURCES` | 5 (Noise) | *any* source drives the map |
| `td.mapAmount` | CONTINUOUS | 0–1 | 0 | blends the map into modes 0–5 (mode 6 is already pure map) |

Two consequences of rotating about the frame centre rather than about
`scanPosition`, both deliberate: the field spins around the middle of the image
instead of pivoting on a moving origin, and for mode 5 an angle sweep *orbits* an
off-centre radial focus around the frame — a usable gesture rather than a bug.
The rotated coordinate also leaves `[0,1]` near the corners, so a ramp saturates
sooner there; the existing final `clamp` absorbs it, and the result is a rotated
field cropped to the frame, which is what a rotated scan physically is.

`td.mapSource` is the sleeper: mode 6 hardwires the map to the Noise generator,
but resolved through `_resolveLayerTex` the way `mix.srcA` is, **any source can
become the delay field** — the camera's luminance, the SDF's distance, a movie.
That is one SELECT param and it is the single largest expressive gain in the
phase.

All are group `td` and therefore captured by Display States, correctly: they are
continuous quantities with fixed meaning, not indices into a user-editable list
(contrast `displace.warpSlot`, and see §9d).

---

## 4. Storage strategy — the blocking constraint

**This section corrects the plan this document was written from.** The plan
asserted the ring/tap split was clean because the strategy probe already handles
backend variation. Reading `tick()` disproves that:

```js
    } else {
      // Fallback: fixed 1-frame delay; gradient modes unavailable here.
      if (!this._fallbackGradientWarned) {
        console.warn('[TimeDisplace] gradient modes are array-texture only; …');
```

**On the fallback path there is no per-pixel delay at all.** The ring is N
separate `WebGLRenderTarget`s, each a `sampler2D`, and a per-fragment *variable*
layer index is not expressible against N distinct bindings. The fallback shows a
fixed 1-frame delay and warns once.

That is survivable while only `tdisp` depends on it. It is **not** survivable
once `delay`, `slitscan` and `vwarp` are taps, because those three work on every
backend today: `VideoDelayLine` just picks a whole render target by age,
`SlitScanBuffer` is CPU canvas work, and only `vwarp` already needs array
textures. Routing them through the ring as-is would regress three working
features on any backend where the probe fails — precisely the class of mistake
the Guard Logic Rules in CLAUDE.md exist to prevent.

### 4a. A tiled atlas — the mechanism

Store the frames **tiled into one 2D texture** — a grid of `cols × rows` tiles in
a single `sampler2D`. Per-pixel delay becomes tile arithmetic:

```glsl
  float layer = floor(d);                      // desired frame, 0 = newest
  float idx   = mod(uHead - 1.0 - layer + uN, uN);
  vec2  tile  = vec2(mod(idx, uCols), floor(idx / uCols));
  vec2  uv    = (tile + clamp(vUv, uInset, 1.0 - uInset)) * uTileScale;
  outColor    = texture2D(tRing, uv);
```

This works on every backend, in GLSL1, with no array-texture support required.

**Costs:**

- **A max-texture-size ceiling on frame count** (see 4b — this turns out to be
  decisive).
- **Bilinear filtering bleeds across tile seams.** Hence the `uInset` clamp
  above — inset sampling by half a texel per tile. This is the one genuinely
  fiddly part and it must be tested at tile boundaries specifically, because the
  error is a thin wrong-coloured line that is easy to miss in motion.
- **Writing a frame is a viewport-scissored blit** rather than a layer render.
  Straightforward, but `capture()` must set and restore the scissor state, and
  Three.js's renderer state cache has to be respected.

### 4b. CORRECTION — the atlas replaces the fallback, not the array path

*An earlier version of this section recommended the atlas as the **only**
strategy, on the grounds that it deletes the probe, the dual read path, the
`strategy` getter and the fallback warning. **That recommendation was wrong.**
The tile arithmetic was not carried through to real numbers before the
recommendation was made; doing so at the start of implementation killed it.*

The engine requests **120 frames** (`main.js:336`) and `td.bufferResolution`
offers 320×240 / 640×360 / 640×480 / Native. Achievable atlas capacity:

| `MAX_TEXTURE_SIZE` | 320×240 | 640×360 | 640×480 | Native 1920×1080 |
|---|---|---|---|---|
| 4096 (spec floor) | 204 ✓ | 66 | 48 | **6** |
| 8192 (typical) | 850 ✓ | 264 ✓ | 204 ✓ | **28** |
| 16384 (desktop) | 3468 ✓ | 1125 ✓ | 850 ✓ | 120 ✓ |

**At Native buffer resolution the atlas holds 6 frames on the spec floor and 28
on typical hardware, against the array path's 120 at any resolution** — array
layers are limited by `MAX_ARRAY_TEXTURE_LAYERS` (typically 2048), which the
frame count never approaches. Making the atlas universal would be a severe
capability regression on *good* hardware to fix a path that only *broken*
hardware takes. That is backwards.

**The design, therefore:**

- **The array path stays primary and is not touched.** Every real user's code
  path is unchanged, which also collapses the reference-set risk in §10.1 — the
  working path cannot regress if it is not modified.
- **The atlas replaces the N-render-target fallback.** Per-pixel delay starts
  working on backends where it previously degraded to a fixed 1-frame delay, so
  §5's adapters become safe everywhere. That was the whole point of §4.
- **Capacity is clamped and reported** on the atlas path: `_slots` becomes
  `min(frames, cols × rows)` and `td.maxDelay` clamps against it (§9f). A
  fallback backend at Native resolution gets a short history and a console line
  saying so, rather than a knob that silently stops responding.
- The probe, the `strategy` getter and the bifurcation **stay**. They are
  load-bearing, not vestigial. `strategy` now reads `'array' | 'atlas'`.

The consolation prize: because the atlas is GLSL1 and needs no array support, the
per-pixel delay map now has to exist in two dialects — which forces the map
computation into **one shared GLSL chunk** rather than two copies. That is a
strictly better structure for §3's generalisation, and it is the reason
`ARRAY_READ_FRAG`'s `m` block gets extracted before the plane is introduced
rather than after.

**One way §4 still fails:** the atlas's seam handling interacts with
`setUpscaleFilter`. The tap reads the ring at buffer resolution and the
compositor upscales; if the *upscale* filter is linear and the tap output already
contains a seam artefact, the artefact spreads. Test the two filters against tile
boundaries together, not separately.

---

## 5. Adapters

`SOURCE_DEFS` is append-only forever, so all indices survive. All five panels and
every param id stay. Behind them:

### 5a. `tdisp` (24) — the free tap
Gains the plane params of §3c. Its panel becomes the place the plane is played;
`td.mode` remains at the top as the preset row.

### 5b. CORRECTION — `delay` (13) is not a tap either. It needed the ring's
### *other* feature.

*This section said `delay` becomes a flat-plane tap and that "this is where the
VRAM comes back". **Both wrong**, established 2026-07-30 by costing it. With §5c
and §5d that makes **three of the four adapters retracted**; only the ring/tap
split itself (§2) survived contact.*

Two reasons it must not become a tap:

1. **A tap adds a fullscreen pass for nothing.** `getTexture(n)` already returns a
   ring texture *directly*, at zero cost, because a uniform delay needs no
   per-pixel map. Routing it through a tap would be strictly more expensive for
   the one case that does not need the machinery.
2. **Taps share the ring and therefore its capture source** (§5e). Delay wants its
   *own* source — an echo of the camera while `tdisp` works on the output — which
   a shared ring cannot give it.

**The real defect was the ring's other feature: resolution decoupled from the
canvas.** `VideoDelayLine` ran at full canvas size, so **30 frames at 1920×1080 is
237 MB for HALF A SECOND** — the most expensive buffer in the instrument, buying
almost nothing. Decoupled, the same VRAM buys **240 frames (4 s) at 640×480**, or
**8 s at 320×240 for less**. Resolution, not frame count, is the lever.

**What shipped:** `delay.source` (default 8 = Output, the old wiring),
`delay.size` (30–480 frames), `delay.bufferResolution` (Native / 640×480 /
640×360 / 320×240), `delay.frames` ceiling 30 → 480, a 768 MB budget clamp, and
`resize()` demoted to a no-op so a display change no longer wipes the echo. The
softness/depth trade is exposed rather than chosen: the delay composites at full
canvas size, and the default stays Native/30 so the existing picture is unchanged.

**Two things found only by testing**, both recorded because they are the kind that
survive review:

- **The controls did not commute.** Asking for 120 frames at Native clamps to 97,
  and lowering the resolution afterwards left you stuck at 97 rather than granting
  the 120 that now fits — so the result depended on which knob you touched first.
  `VideoDelayLine` now stores the *requested* depth and re-derives on every
  realloc.
- **A request past the history returned `null`**, dropping the source entirely
  rather than reaching the oldest frame — so raising the new 480 ceiling made the
  control stop working instead of stop deepening. It now saturates.

### 5c. CORRECTION — `slitscan` (15) is NOT a tap, and must not become one

*An earlier version of this section said SlitScan becomes "a tap with a linear
plane," deleting its `readPixels` and buying frame time. **That was wrong on both
counts, and implementing it would have degraded the feature.** Established
2026-07-30, before writing any code. What shipped instead is a source selector.*

**A tap preserves spatial position; a slit-scan remaps it.** A tap computes
`out(uv) = ring[age(uv)](uv)` — the same coordinate at a different time.
SlitScan computes `out(x, y) = frame_at_tick(x)(scanPos, y)` — output column *x*
shows **source column `scanPos`**, from a different time. One fixed source column
spread across every output column. Those are different operations. `td.mode`'s
"Slit X" is a time-displacement *gradient* (each column shows its own pixels at
its own age), which resembles a slit-scan on some material but is not one — and
that resemblance, with both things named "slit", is exactly the confusion the
owner reported from the panel.

**The time depths differ by an order of magnitude, in the canvas's favour.**
SlitScan's canvas holds `W / stripW` time steps — 1280 wide with 2 px strips is
**640 ticks**, ~30 s at 21 fps. The ring holds `slots` = **120** frames. Matching
that depth needs 640 frames, which at 640×480 is ~786 MB. The canvas reaches it
because it stores **one column per tick** — `1/W` of the memory per time step.
Storing whole frames in order to read a single column from each is precisely the
waste the canvas avoids. **The canvas is the correct data structure for a
slit-scan**, and the `readPixels` is the price of a 5× longer window at 1/W the
memory. That is a good trade, not a defect.

**The real defect was narrower: no source.** SlitScan's input was hardwired to
`pipeline.prev`, the composite — so routing a layer to SlitScan made it sample its
own already-scrolled canvas. Self-referential, and unable to bootstrap from black:
black in, black out, permanently. It was the only temporal engine without a source
selector (`td.captureSource` picks freely; sequence buffers have a per-seq source).

**What shipped:** `slitscan.source`, SELECT over `SOURCES`, default **8
("Output")** — byte-identical to the old wiring. Resolved through the same
`_resolveLayerTex()` the layers use. `SlitScanBuffer.tick()` now accepts either a
`WebGLRenderTarget` (passed straight through — the Output path stays
allocation-free) or a `Texture`, which it blits into a lazily-allocated scratch RT
because `readRenderTargetPixels` needs a target. The blit runs after the rate
gate, so it costs one pass per *tick* rather than per frame.

`_direct()` gains a `_cSlit` term so the chosen source is part of the consumption
fixpoint. The call site stays where it is, ahead of the SDF/Analog/Noise ticks, so
those sources are sampled one frame late — deliberate, since slitscan is
rate-limited and accumulative, and leaving it in place keeps the change additive
rather than reordering the render loop.

**One way this still fails:** a source whose texture is a different size from the
canvas is blitted to canvas dimensions, so a non-matching aspect ratio is
stretched rather than letterboxed before the strip is cut. Acceptable for a
strip-sampler, but it will look wrong to anyone slit-scanning a 4:3 source on a
16:9 canvas.

**Owner-confirmed working 2026-07-30**, in a visible window at 60 fps. This
closes the verification debt `766afc3` declared: every automated in-app check of
that commit ran in a backgrounded tab (`document.hidden`, measured 0 fps), so
`slitScan.tick()` never executed and the absence of GL errors there was worth
nothing. The direct-driven harness (`tests/slitscan-source.html`) covered the
read/blit/orientation logic; the owner covered the runtime.

### 5d. CORRECTION — `vwarp` (22) is not a tap either. It is the fast path.

*This section previously said vwarp becomes a tap on the shared ring, closing the
KNOWN-ISSUES architecture question. **Wrong, for the same reason as §5c**, and
established 2026-07-30 by reading the engine rather than its reputation. Owner's
decision the same day: keep both engines, document the overlap.*

**What vwarp actually is.** A tape whose horizontal axis is time. One column of
video per frame at a moving write head; the output reads the whole tape, so
`out(x, y) = src(x, y)` captured `(writeIdx − x)` frames ago. Static content is
untouched; motion shears horizontally.

**It is not a slit-scan**, despite the name and despite sitting next to one. A
slit-scan spreads ONE FIXED source column across every output column (space
remap). This offsets each column in time *at its own position* — a
time-displacement gradient, i.e. functionally identical to
`td.mode = "Slit X"`.

**Why it must not be folded into the ring.** It stores **one column per time
step**: 1920×1080×4 ≈ 8.3 MB buys **1920** time steps at full resolution.
TimeDisplaceEngine stores a **whole frame** per time step, because its map is
arbitrary per-pixel and any pixel of a stored frame may be needed — 120 frames at
640×480 is ~147 MB for **120** steps. For an axis-aligned monotonic gradient
vwarp is roughly **18× cheaper and sharper**; for anything else it cannot express
the map at all.

So the relationship is fast-path / general-case, not duplication:

| | stores | time steps | expresses |
|---|---|---|---|
| `vwarp` | 1 column / step | ~1920 | axis-aligned monotonic gradient only |
| `tdisp` | 1 frame / step | 120 | any per-pixel map — radial, noise, any angle |
| `slitscan` | 1 column / step | ~640 | a different operation (space remap) |

**Net effect on Phase 25: only `delay` is a genuine tap.** Two of the four
adapters this document originally promised would have been regressions. The
consolidation that survives is the ring/tap split (§2) plus `delay`, and that is
the honest scope.

**The KNOWN-ISSUES entry should still be rewritten, but not as "resolved by
consolidation".** Its "treat as a Sequence slot backed by IndexedDB" candidate is
wrong and should be struck; the real answer is that the strip buffer is the
correct structure and the entry's premise — that it "conflicts with the pipeline
source model" — is not a defect. Its stale "hidden from UI" status is also wrong
(restored Phase 24, `index.html:548`). The `vasulka` entry commented out of
`DEFAULT_FX_ORDER` (`Pipeline.js:35`) stays commented out — a separate, genuinely
deprecated FX-chain pass, not the source.

### 5d-bis. The bug found while reading it

`Buf Size` did nothing useful below `1920 cols`, which is why the feature read as
inscrutable. The strip target was allocated at **canvas width** while the write
head wrapped at **bufSize**, and the output shader read the target's *full*
width — so every column past `bufSize` was never written. The sweep ran from the
left edge to column `bufSize` and restarted, black beyond. Only "1920 cols" on a
1920-wide canvas happened to line up.

Fixed by deleting the split: the tape is allocated at `bufSize`, the head wraps at
`bufSize`, and the read resamples it across the frame — so `bufSize` means the
time depth its label always claimed (`480 cols (8s)`). A short tape is now softer
horizontally rather than partially black, which is the correct trade and has no
prior behaviour worth preserving.

Two adjacent defects fixed with it: `resize()` overwrote `_bufSize` with the
canvas width, silently retuning the time depth on every resolution change; and
the boot construction hardcoded 960, ignoring the saved `vwarp.bufsize`, so a
project stored at 480 ran a 960-column tape until the param happened to change.
The `[480, 960, 1920]` table now has one copy in `main.js` instead of two.

### 5e. The one behaviour change, stated up front
**Taps share one ring, therefore one capture source and one buffer resolution.**
Today the four engines differ:

| Engine | Captures | Where |
|---|---|---|
| `videoDelay` | `pipeline.prev.texture` | `main.js:7225` |
| `slitScan` | `pipeline.prev` | `main.js:6987` |
| `tdEngine` | selectable via `td.captureSource` | `main.js:7235–7241` |
| `vasulkaWarp` | `camera3d.active ? camera : pipeline.prev` | `main.js:7248` |

Three of four already capture the composite output, so a shared ring on
`td.captureSource` **defaulting to Output is behaviour-identical for delay,
slitscan and tdisp**. Only vwarp changes: its hardcoded camera preference goes
away. That quirk is undocumented, unreachable from any parameter, and sits
directly under a `DEPRECATED` comment — but it is a real change to what a saved
project renders, and it goes in the changelog as one.

The upside of the same constraint: **delay and slit-scan gain a source
selector** they never had. A slit-scan of the SDF generator, or a video delay of
Deck B alone, is newly reachable.

### 5f. Out of scope: `seq1/2/3` (17/18/19)
`SequenceBuffer` also does frame-count-addressed playback, its own capture loop
and `setNormPos` scrubbing; only its `timewarp` mode overlaps with the plane.
Folding it in is a later question. Claiming otherwise here would be exactly the
"blueprints go stale mid-implementation" failure `ImWeb-MovieLibrary-Blueprint.md`
§2.4 already had to correct in itself. `StillsBuffer` is likewise out of scope —
it is an *addressable stills* instrument with thumbnails and slot protection,
not a continuous history.

---

## 6. Phase 26 — Rutt-Etra, historical first

The Rutt-Etra Scan Processor (1972) sits directly beside the Sandin Image
Processor and the Paik/Abe synthesiser in the lineage this project claims, and
it is the only one of the three with no representation in the instrument. There
is a `pre-rutt-etra` tag in the repo and no code, docs or changelog entry
anywhere — the idea has existed only as a tag name.

**The model:** N horizontal scanlines × M vertices, z displaced by luminance,
perspective camera with orbit, monochrome phosphor with decay. Controls: line
count, z-gain, line thickness, camera angle/distance, decay, and a free source
selector.

**Why faithful before general:** Rutt-Etra is beautiful *because it lies about
depth*. Luminance is not distance, and the entire character of the machine comes
from that error — faces become ridges, shadows become holes. Generalising to "any
channel displaces any primitive" before living with the historical instrument
risks building something configurable that nobody plays. Generalise in a later
release, along the axes actually reached for. (This is also the argument against
monocular-depth ML — §11.)

**Cost: low. It is the shape this codebase has accepted five times.** New
`src/inputs/RuttEtra.js` (~250 lines) following `src/inputs/SDFGenerator.js` —
own scene, own camera, own render target, `.texture` getter, one
`tick(ps, dt, srcTex)` gated on use (`main.js:7038` is the pattern). Then:

- append to `SOURCE_DEFS` (index 29) **and** `SOURCE_DISPLAY_ORDER` — the
  assertion at `ParameterSystem.js:538` throws at boot if the second is
  forgotten, which makes a passing boot the test
- one line in the inputs bag (`main.js:7135`)
- source selection reuses `_resolveLayerTex`, exactly as `mix.srcA` does
- one container id in `index.html` + one entry in `buildMappingPanels()`
  (`UI.js:171`) — no ordering or label code, per the Phase 23 design
- **extend `_srcUsed(i)`** for the render gate rather than copying the pattern;
  that function exists specifically because seven near-duplicates once accrued

**Technical note, recorded so a later session does not "fix" it:** this needs a
**vertex-stage texture fetch** to displace by luminance. That is fine under
WebGL2, which is three r168's default. It does **not** violate the CLAUDE.md
"strict WebGL 1.0 / GLSL ES 1.00" rule — that rule constrains *AI-generated*
shaders in the Live GLSL pass, where a user's browser and an LLM's habits are
both unknown. The pipeline's own materials are not bound by it.

**Second increment, same file, later:** each vertex becomes an oriented
anisotropic splat whose covariance follows the local image gradient — smooth
regions smear along the gradient, detail stays tight. Roughly 80 lines and a
different draw call. This is where Gaussian splatting genuinely lands in a
performance instrument: the splat as a **live-video render primitive**, with none
of the reconstruction, training, feature distillation or uncertainty machinery
(§11).

---

## 7. Phase 27 — State terrain

Saved states already *are* feature vectors. `Preset.states[i].values` is a flat
`{ paramId: value }` map (`src/state/Preset.js:86–99`), and `ps.captureState()` /
`ps.restoreState(values)` already round-trip it. No model, no embedding, no
training.

**What it feels like:** an XY pad where a bank's states are scattered landmarks
under their existing thumbnails, and you move continuously between them —
including through territory between states you never saved. A bank stops being an
ordered cue list and becomes a terrain.

**Mechanism:**
1. Build a matrix from `states[].values` over the union of param ids, normalised
   per-param by each `Parameter`'s min/max, so a 0–360 hue cannot dominate a 0–1
   toggle.
2. PCA to two dimensions — power iteration on the covariance matrix is enough for
   two components, ~60 lines of plain arithmetic.
3. On pad move, inverse-distance-weight the *k* nearest states and write the
   blend through `ps.restoreState()`.

**Do not route this through morph.** `PresetManager`'s morph is A→B over time
(`_morphFrom`/`_morphTo`/`_morphT`, `tick()` at `Preset.js:288`). The pad needs an
*instantaneous weighted blend of k states*, which is a different operation.
Reuse `restoreState`; leave morph alone. Reset-cascade history (`0bfdfe9`,
`83118ba`) shows what happens when bulk parameter writes meet an active morph.

**Reuses:** the existing state thumbnails, and the normalised XY pad channel
`GestureArbitrator`'s Pad mode already feeds into `ControllerManager`'s mouse
channel — so the terrain is playable by finger, mouse, MIDI or LFO with no new
controller plumbing at all.

**This phase may die, and that is a valid result.** Whether the space between
states is meaningful is a property of *the owner's banks*, not of the code. If a
bank's states are topologically heterogeneous — different sources, different
active effects — the territory between them is garbage and the pad is a
random-preset generator. **The first task of Phase 27 is therefore an
inspection, not an implementation:** open `public/Projects/MasterProject.imweb`
and, per bank, count how many params actually vary across states, and check
whether `layer.fg`/`layer.bg` differ between them. Interpolating a source *index*
is meaningless — SELECT and TOGGLE params must snap to the nearest landmark
rather than blend, and if most of the variance in a bank lives in SELECTs then
there is no terrain to walk.

---

## 8. Suggested build order (each step ships alone)

**Phase 25**
1. **Extract the delay map into one shared GLSL chunk**, used by the existing
   array read shader. Pure refactor, no behaviour change — and the precondition
   for both step 2 and step 5 (§4b, last paragraph).
2. **Atlas storage replacing the N-render-target fallback.** The array path is
   not touched. `_slots` becomes capacity-aware and `td.maxDelay` clamps to it.
3. Split into `SpacetimeRing` + `SpacetimeTap`. `tdisp` is the only tap. No
   behaviour change.
4. **Orientation.** `td.angle` rotates the map coordinate in the shared chunk
   from step 1; `td.mapSource` frees the delay map from the Noise generator;
   `td.mapAmount` blends it into the analytic shapes. `td.mode` keeps its
   meaning — see §3d for why the "one continuous expression, mode as preset
   writer" design in §3a–3c was dropped.
5. `delay` becomes a tap — `delay.frames` is an **offset into the deeper shared
   ring**, not its own depth (owner's decision, 2026-07-29; §12.2 resolved).
   Then `slitscan`. Then `vwarp`. One commit each.
6. `td.mapSource` — the free map selector (§3c).

*The original step 1 was "capture a reference set of PNGs." **That is not a
usable acceptance test for these engines** and it was dropped at the start of
implementation: a temporal engine's output is a function of the exact frame
sequence that preceded it, and neither a playing movie nor a wall-clock-driven
noise source reproduces a frame sequence across runs. Exact image comparison
would fail on correct code. §10.1 replaces it with a deterministic ring-content
assertion, which is both reproducible and a sharper test of the thing that
actually breaks.*
7. `td.mapSource` — the free map selector (§3c).

**Phase 26** — the source, then the panel, then the gate, then persistence.
**Phase 27** — the `MasterProject.imweb` inspection, and only then the pad.

Tag before step 4: `git tag -a pre-spacetime -m 'working state before ring/tap split'`.

---

## 9. Gotchas found while writing this

### 9a. Two files each claim to have superseded VasulkaWarp, and they disagree
`main.js:7243` — *"DEPRECATED: superseded by SequenceBuffer timewarp mode."*
`TimeDisplaceEngine.js:15` — TD is the *"general successor to the deprecated
VasulkaWarp strip-buffer."* Meanwhile Phase 24 Step 4 restored the vwarp panel
(`index.html:536`) and `KNOWN-ISSUES.md` still describes the feature as "hidden
from UI." Three documents, three stories, and the source is live in the inputs
bag the whole time (`main.js:7154`). Phase 25 settles it in code rather than in
prose: vwarp becomes a tap, and both comments get corrected to say so.

### 9b. `KNOWN-ISSUES.md` is stale on vwarp's UI status
It has been wrong since 2026-07-27. Fix it in the same commit that touches vwarp,
and strike the "Sequence slot backed by IndexedDB" candidate direction (§5d).

### 9c. `StillsBuffer` is not an atlas — an assumption corrected mid-draft
An earlier draft of §4a argued the tiled atlas was "already proven in this
codebase, in `StillsBuffer`'s 8×8 grid." It is not. `StillsBuffer` holds N
separate render targets in `frames[]` plus an array of 80×45 *thumbnail
canvases*; the 8×8 grid is a UI layout, not a texture atlas. The atlas is new
work and must be costed as new work. Recorded because the wrong version of this
claim is very easy to re-derive from the panel screenshot.

### 9d. Capture semantics for the new params
The five plane params are group `td` and **are** captured by Display States —
they are continuous quantities with fixed meaning. `td.mapSource` is a SELECT,
but into `SOURCES`, which is append-only and not user-editable, so an index means
the same thing on every machine and it is captured too. This follows the
`mix.srcA` precedent exactly, and is the opposite of `displace.warpSlot` /
`glsl.preset`, whose contents live in per-origin localStorage. The distinction is
*whether the list the index points into is user-editable* — not whether it is a
SELECT.

### 9e. Frame ordering is load-bearing and already documented
`TimeDisplaceEngine`'s header pins it: `tick()` reads **before**
`pipeline.render()`; `capture()` writes **after**, beside `videoDelay.capture`.
The taps inherit this — all reads before the pipeline, one write after. Getting
it backwards costs one frame of latency and is invisible in a still screenshot,
which is exactly how it would survive review. The `videoDelay.getTexture(1)`
equivalence check named in that same comment is the cheapest available test.

### 9f. `td.maxDelay` must clamp to the achievable count
It currently clamps to `this.frames - 1`. Under the atlas, the achievable frame
count depends on `MAX_TEXTURE_SIZE` and buffer resolution, so it becomes a
runtime value. A silent clamp here reads as "the knob stops working past 40%,"
which is the hardest class of bug to report.

---

## 10. Verification

Build and verify against `npx vite preview` — **never** the https dev server;
automation rejects its self-signed cert. Use the `verify` skill. Occluded tabs
freeze rAF, so a backgrounded tab reports 0 fps and invalidates any timing test.

**Phase 25**
1. **A deterministic ring-content assertion is the acceptance test**, replacing
   the PNG reference set (§8). Drive `capture()` by hand with N synthetic frames
   whose content *encodes their own index* — frame *k* a solid
   `rgb(k, k, k)` — then read at a known delay and assert the sampled value is
   the frame that was asked for. This is exact, reproducible, needs no clip or
   camera, and it catches the two failure modes that actually occur: an
   off-by-one in the head/age arithmetic, and a tile index that disagrees between
   `capture()` and the read shader. Run it against **both** strategies: force the
   atlas path and confirm identical answers to the array path.
2. Tile-seam inspection: a high-contrast source, a delay that lands the read on a
   tile boundary, and both upscale filters together (§4a, §4b last paragraph).
3. Confirm the atlas capacity clamp reports itself — force Native buffer
   resolution on the atlas path and check `td.maxDelay` cannot be driven past the
   achievable count, with a console line stating the ceiling (§9f).
4. Load a pre-Phase-25 `.imweb` and a saved Display State using each of the seven
   `td.mode` values.
5. **VRAM must go down.** Route all four temporal sources simultaneously and
   compare `renderer.info.memory` against the pre-refactor baseline. One ring
   plus four small RTs against 30 delay targets + an N-layer array + a 960 strip
   buffer should be a clear win; if it is not, the tap output targets are
   oversized.
6. **Frame time with slitscan active must improve**, not merely hold — the
   `readPixels` is gone (§5c).

**Phase 26**
1. A passing boot is the `SOURCE_DISPLAY_ORDER` test (`ParameterSystem.js:538`).
2. Route Rutt-Etra to FG, BG and DS in turn; into a mix bus; as
   `td.captureSource`. All must work, because all resolve through the same
   `_resolveSource`.
3. Unrouted, `_srcUsed(29)` is false and no pass runs — check
   `renderer.info.render.calls`.
4. Save, reload, re-import a `.imweb` carrying a Rutt-Etra patch.

**Phase 27**
1. The `MasterProject.imweb` inspection (§7) — it may end the phase.
2. A pad sweep must never land `layer.fg` on a fractional source index.
3. Start a pad sweep during an active bank morph; neither may corrupt the other.

---

## 11. Rejected, and why

Recorded so these are not re-derived. Several are good ideas for a different
instrument.

**WebGPU / TSL migration.** The blocker is concrete, not vague: **WebGL and
WebGPU contexts cannot share GPU textures.** A WebGPU sub-engine feeding the
WebGL pipeline costs a full-frame copy through a canvas element every frame, so
"add WebGPU for one source" is not incremental — it is a whole-renderer
migration that breaks every hand-written shader in `src/shaders/index.js` and the
Live GLSL editor's entire contract with users' saved presets. Revisit only when
three's TSL is stable *and* iPadOS WebGPU is solid, because touch is half this
instrument.

**3D Gaussian Splatting as scene reconstruction.** Needs multi-view capture and
per-scene training; it is a capture-and-optimise pipeline, not a performance
instrument, and it has no live-input story. The *primitive* is kept (§6,
increment 2); the reconstruction, adaptive density control, feature distillation
and uncertainty mapping are not.

**Monocular depth ML for the Rutt-Etra z channel.** 50–200 MB of weights and a
per-frame inference budget, spent to remove the very error that makes the
instrument beautiful (§6).

**A full patchable node graph.** `Pipeline.render()` is ~500 lines of
straight-line passes over a **two-target ping-pong pool** with hand-computed flip
parity — the bloom handler (`Pipeline.js:118–136`) literally reasons about parity
and inserts a manual flip to dodge a feedback conflict. A general scheduler
replaces that hand-reasoning with liveness analysis and cycle detection, in the
most load-bearing file in the project. **The cheaper 60% is already there:** the
FX chain is reorderable (`fxOrder`, drag-reorder at `UI.js:1304`) and mix buses
are free-input nodes with a proven cycle rule. Give each bus an effect insert —
the pattern `glsl.target` already uses — and ImWeb is a video modular with no
scheduler. Candidate for Phase 28.

**Node-based shader editor.** Strictly worse than a CodeMirror editor with
last-good fallback plus an AI that writes GLSL from a sentence, both of which
ship today.

**Timeline / NLE mode.** Violates "the interface is also the performance — no
edit/perform mode split," the one principle in `imweb-obsidian.md` worth
defending hardest. Gesture-tape overdubbing (record the parameter stream, loop
it, record over it) gives the same capability without a timeline.

**WebXR output, plugin API, audience-phone control surfaces.** Each is a good
demo and permanent maintenance weight in a repo already carrying ~38.5k lines.

**Cross-modal neural ingestion, Thousand-Brains reference frames, conformal
prediction.** From a different brief. A video synthesiser with distribution-free
coverage guarantees is a category error: the instrument's job is making images
that were never true, and the line between observed reality and algorithmic
ignorance is the material, not the risk. The one real rhyme — *explicit editable
primitives over implicit learned fields* — is already ImWeb's constitution:
`ParameterSystem` as the state, ~240 named editable values, no bundled state
management, no weights anywhere.

**Long-term direction, recorded but not scheduled: the LLM as a blind
performer.** A new `'ai'` controller type in `ControllerManager.js`'s type
switch that sees **parameter state and its recent history, never the image**, and
writes *targets* which the existing slew system renders as continuous motion — so
a 1–3 s round trip never appears as a jump. It plays the instrument the way a
musician who cannot see the projection would. `AIFeatures.js` already routes
everything through `_call(systemPrompt, userPrompt)` with provider config and key
persistence, so the plumbing exists; the work is the temperament, not the
transport. This retires the Narrator and Coach, on the argument that
commentating on a performance is the least interesting job available to a model
sitting inside the instrument.

---

## 12. Open questions

1. ~~**Atlas-only, or atlas-plus-array-fast-path?**~~ **RESOLVED 2026-07-29,
   before any code:** array path primary, atlas replaces the fallback. Decided on
   arithmetic rather than measurement — the atlas caps at 6 frames (4096) / 28
   (8192) at Native buffer resolution against the array's 120. See §4b for the
   table and the reasoning.
2. ~~**Does `delay` keep its own frame-count parameter, or read `td`'s?**~~
   **RESOLVED 2026-07-29 (owner):** `delay.frames` becomes an **offset into the
   deeper shared ring**. It currently maxes at 30 (`main.js:311`) while `td`
   allocates 120, so delay's usable depth rises 4× — welcome, and a changelog
   line. Note the offset must clamp to `_slots − 1`, which on the atlas path is
   a runtime value (§9f), so a fallback backend at Native resolution can offer
   *fewer* than the present 30. That is the one case where this decision is a
   regression, and it needs the same console report as `td.maxDelay`.
3. **How many taps before the read passes cost more than the rings saved?** Four
   is clearly fine. If `seq1/2/3` ever join (§5f) it is seven, and that is the
   point at which to measure rather than assume.
4. ~~**Should `td.angle` be degrees or turns?**~~ **RESOLVED 2026-07-29:**
   degrees, 0–360, `unit: "°"` — identical to `displace.warpDrawAngle`. Radians
   are computed in `TimeDisplaceEngine.tick()`, and 0 survives the conversion
   exactly, which is what keeps the rotation a bit-exact identity by default.
5. **Phase 27's viability is an empirical question about the owner's banks**, and
   the inspection in §7 answers it before any code is written.
