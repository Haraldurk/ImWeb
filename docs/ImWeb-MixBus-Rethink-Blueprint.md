# ImWeb — MixBus Rethink & Panel Taxonomy Blueprint

*Architectural proposal, 2026-07-26 — no code yet. Successor to
`ImWeb-DualDeck-v0.12-Blueprint.md`, which shipped the MixBus in its
DJ-metaphor form.*

---

## 0. The reframe that shapes everything

ImWeb is a **source graph**. `layer.fg`, `layer.bg` and `layer.ds` each pick
freely from one shared 27-entry source list, and every generator, buffer and
feedback tap is just another index in it. That model is the instrument's
best idea: routing is data, not topology.

**The MixBus is the one node that breaks it.** Its inputs are hardwired to
Deck A and Deck B:

```js
if (inputs.movie || inputs.movieB) {          // Pipeline.js:330
  this._passTo(this.m.mixbus, {
    uFG: inputs.movie  ?? fb,
    uBG: inputs.movieB ?? fb,
    …
```

That came from the dual-deck framing — two movie decks, one fader. It was the
right call for shipping v0.12 and it is the wrong long-term shape: you cannot
crossfade Camera against Noise, luma-mask Draw against the SDF generator, or
displace the 3D scene by the Analog TV signal, even though all of those
textures already exist as source indices.

**The good news: the shader is already source-agnostic.** `MIXBUS`
(`src/shaders/index.js:1766`) takes two generic `sampler2D`s named `uFG` /
`uBG` and knows nothing about movies. Only the *binding* is hardwired.
Generalizing the MixBus is a params-and-wiring job, not a pipeline rewrite —
the same reframe-cuts-the-work-in-half move the dual-deck blueprint made.

The second thing this document addresses is that the panel taxonomy grew by
accretion and no longer describes the instrument. See §3.

**Compatibility is strict throughout.** Parameter ids stay frozen, the source
options array stays append-only, no `movie.*` → `deckA.*` migration. Only
user-visible labels and panel grouping change.

---

## 1. Pipeline alterations

### 1a. Free source selection

Add two SELECT params to the existing `mix` group, reusing the `SOURCES`
options array already declared at `src/controls/ParameterSystem.js:466`:

| Param | Type | Default | Notes |
|---|---|---|---|
| `mix.srcA` | SELECT | 1 (`Movie`) | |
| `mix.srcB` | SELECT | 25 (`Movie B`) | |

Those defaults are load-bearing: they reproduce the current hardwiring
exactly, so **every existing project renders identically** — the same
discipline that made `mix.xfade` default to 0.

In `Pipeline.render()`, resolve both through the existing
`_resolveSource(processedInputs, idx)` (`src/core/Pipeline.js:876`) instead
of reading `inputs.movie` / `inputs.movieB` literally. Because `mix.srcA/B`
are ordinary Parameters, they compose for free with states, morph,
automation, MIDI and the step sequencer — including *modulating the routing
itself*, which is a genuinely new gesture.

### 1b. The guard at Pipeline.js:330 becomes wrong, not merely stale

```js
if (inputs.movie || inputs.movieB) { …mixbus pass… }
```

Today this is a correct optimisation. The moment inputs are free it is a
**bug**: mixing Camera against Noise with no movie loaded would silently skip
the pass and the bus would output a stale target.

Apply the CLAUDE.md guard rules literally — state what the condition holds at
the line where it is evaluated. The replacement is a *consumption* test, not
an input-presence test: render the bus when something downstream reads it.
That analysis already exists in main.js (§2c); do not write a second one.

### 1c. Conditionally-ticked sources must learn about the bus

Four sources are only rendered when a layer actually uses them this frame.
`scene3dNeeded` (`src/main.js:6472-6477`) is computed from `scene3d.active`,
`layer.fg/bg/ds`, `depthUsed`, the Analog source index and
`td.captureSource` — **and nothing else**. The same pattern gates 3D Depth,
SDF and Analog.

Select 3D Scene as `mix.srcA` without extending those predicates and the bus
samples a null or stale texture. The same applies to the idle-deck upload
gate at `src/main.js:6147-6180`: `_uploadA` / `_uploadB` assume the bus
consumes exactly decks A and B, so a deck feeding the bus by any other route
would have its `texImage2D` upload skipped and its texture would freeze —
precisely the Phase 5 lesson the gate's own comment cites.

This is the real cost of the feature, and it is the dual-deck blueprint's
lesson repeating: the engine does not fight it, the integration hub does.
Every "is source *i* needed this frame?" predicate in main.js becomes "…by a
layer, by TimeDisp capture, **or by any mix bus**". Find them all before
writing any of them; a single generalised helper (§2c) is the only
maintainable answer.

### 1d. Self-feedback

`mixbus` is source index 26, so `mix.srcA = Mix Bus` is reachable from the UI
the day this ships. Guard with the identity pattern the project already
mandates:

```js
tex === this._mixTarget.texture → substitute fallback
```

Never a "have we rendered yet" flag. Flags depend on call order; identity
checks depend on values.

Note that self-feedback through a *persistent* target is not automatically
wrong — it is how `Output` (index 8) works, and a mix bus reading its own
previous frame is a legitimate instrument behaviour. The decision to make
deliberately is whether bus N reading itself means **last frame** (allow, and
document) or **fallback** (forbid). Recommendation: forbid on the same-frame
target, allow via the general one-frame-behind rule in §2b, so the behaviour
is one rule rather than two special cases.

---

## 2. Multiple mix buses

### 2a. Three buses, mirrored not migrated

Bus 1 stays `mix.*` with its ids frozen. Buses 2 and 3 become `mix2.*` and
`mix3.*`, generated from one shared descriptor loop so they cannot drift —
the same structural mirror, and the same accepted prefix asymmetry, as
`movie.*` vs `movieB.*`.

The precedent is already in the file: `MOVIE_DECK_PARAMS`
(`src/controls/ParameterSystem.js:1427-1450`) is a descriptor table
registered twice with prefixes `movie` / `movieB`. Copy that shape exactly
rather than inventing a second convention.

Each bus appends one source index at the **true end** of the list (27, 28).
This is the sleeper data-destroying rule from the dual-deck blueprint and it
has not gotten less true: SELECT values persist as integer indices into the
options array, so inserting anywhere but the end silently re-routes every
saved state in every `.imweb` file on earth.

Each bus needs its own persistent render target alongside `_mixTarget`
(`Pipeline.js:227`) — they must survive the ping-pong pool, which is exactly
why the current one is allocated separately.

### 2b. Evaluation order is a design decision, not an implementation detail

Buses render 1 → 2 → 3, before layer resolution. Therefore:

- Bus 2 reading Bus 1 sees **this frame**.
- Bus 1 reading Bus 2 sees **last frame** — a one-frame feedback.

That asymmetry is fine and even useful, but it must be *documented at the UI*,
not discovered by a performer mid-set. A single sentence in the Mix panel
("a bus reads later buses one frame behind") is cheaper than any amount of
cleverness trying to hide it.

### 2c. Cost control

Each bus costs one full-resolution render target plus one pass. Render a bus
only when something consumes it. **The consumption analysis already exists**
— `_gUses(i)` at `src/main.js:6149`, written for idle-deck upload gating.
Generalise that helper; do not add a parallel one. A bus is consumed if any
of `layer.fg/bg/ds`, `td.captureSource`, or another bus's `srcA/srcB`
references its index.

Three buses is the recommendation, not a limit discovered from need. Two is
defensible; more than three starts to want a real node editor, which is a
different and much larger instrument.

---

## 3. The panel taxonomy

### 3a. What is actually wrong

The tab bar (`index.html:190-199`) reads:

> **Mapping · Movies · 3D · Analog · Draw · Project**

These are not the same kind of thing.

- **"Mapping" holds 23 sections** — Layers, Keyer, Displacement, Projection
  Mapping, Displacement Map Editor, Blend & Feedback, ColorSrc 1&2, Palette,
  Noise, Layer Color, Effects, LUT/Colour Grade, Output, Global/BPM/Morph,
  Particles, SDF/Metaballs, Video Delay, Time Displace, Vectorscope, Slit
  Scan, Sequences. That is essentially the whole instrument, and the tab is
  named after *one section inside it*.
- **Movies / 3D / Analog / Draw are sources** — but only 4 of 27 sources got
  a tab. The other 23 are scattered inside "Mapping" with no principle
  distinguishing them.
- **"Project" holds Live GLSL**, which is an effect in the chain, not
  project metadata.

So the tab bar mixes two axes (signal stage vs. source identity) and one tab
absorbed everything that fit neither.

### 3b. Proposed structure — follow the signal flow

The instrument already teaches users a flow through the Layers panel:
sources → combine → process → out. The tabs should say the same thing.

| Tab | Sections |
|---|---|
| **Sources** | Movie A · Movie B · Clip Library · Stills Buffer · Color / Gradient · Palette · Noise · Text · Video Delay · Time Displace · Slit Scan · Vectorscope · Frame Sequences · Particles · SDF / Metaballs |
| **Mix** | Layers (FG/BG/DS) · Mix 1–3 · Luma Keyer · Chroma Keyer · Displacement · Displacement Map Editor |
| **Effects** | Blend & Feedback · Effects · LUT / Colour Grade · Live GLSL |
| **Output** | Output · Projection Mapping · Global / BPM / Morph |
| **3D** | unchanged |
| **Analog** | unchanged |
| **Draw** | unchanged (Draw Layer · Brush · Text Layer · Style) |
| **Project** | Project · AI · Banks · States · State Step Sequencer · Tables |

One wrinkle on the **Output** tab: the existing "Output" section is
deliberately `display: none` (`index.html:346`) — its comment records that
Resolution moved to the camera header row and Interpolation is param-only —
while `#output-params` is still populated at `src/ui/UI.js:109`, and
`output.*` params additionally leak into the `blend` group. So an Output tab
would be built from Projection Mapping, Global/BPM and the *relocated*
resolution control, not by un-hiding that section. Decide deliberately
whether to resurrect it or delete it; do not un-hide it by accident while
moving blocks.

**3D, Analog and Draw stay top-level because they are large source editors,
not because they are a different taxonomic kind.** Writing that down is the
point of this paragraph — otherwise the next person "fixes" it by folding
them into Sources, and three genuinely deep editors get buried.

### 3c. Tab count

This is 8 tabs, up from 6. `#tab-bar` is already `overflow-x: auto` with
`white-space: nowrap; flex-shrink: 0` tabs (`src/style.css:351-372`), and
coarse pointers get `padding: 10px 12px` (`:3087`), so the bar **already
scrolls** and 8 will not break the mobile layout — it will push the last
tabs off-screen on a phone.

Mitigation: a visual separator in the tab bar between the flow tabs
(Sources · Mix · Effects · Output) and the editor tabs (3D · Analog · Draw ·
Project), rather than a second row. If the off-screen scroll proves bad in
hand-held use, fold **Output** into **Project** for 7.

There is no mobile-specific section list to keep in sync: the panel content
is identical on both, and mobile differs only in that `#control-panel`
becomes a slide-over drawer (`src/style.css:2953-2998`) and the state bar
swaps to `MobileStatePad`. One restructure covers both.

### 3d. What a restructure actually costs — less than it looks

**Section labels and order live entirely in hand-written HTML.** JS only
*fills* pre-existing containers by id. `buildMappingPanels()`
(`src/ui/UI.js:99-146`) is a container-id → parameter-list map with **no
labels and no ordering in it at all**:

```js
'mix-params':      ps.getGroup('mix'),
'delay-params':    ps.getGroup('delay'),
'tdisp-params':    ps.getGroup('td'),
```

So regrouping tabs is mostly moving `.panel-section` blocks between
`.tab-content` divs in `index.html`, and renaming is editing
`.section-header` text. The JS map only needs touching if container ids
change — and they need not.

Two landmines make it less free than that:

**1. `_collapseToLayers()` matches the section title by literal string.**
`src/main.js:1099`:

```js
const isLayers = title === "Layers";
```

On startup (`:5794`) and on reset-all (`:1117`) every section is collapsed
*except* the one whose first text node is exactly `"Layers"`. Rename that
header and the app boots with everything collapsed, silently. The proposal
in §3b keeps "Layers" as a section name, so it survives — but this must be
stated, because a restructure is exactly when someone decides "Layers"
should become "Routing".

The accordion wiring itself is safe: it is a DOM sweep over
`.section-header` (`src/main.js:1055-1076`), not a registry, so moved and
renamed sections keep working. Sections created *after* that sweep wire
their own handler — the runtime-injected **"I / O"** block
(`src/main.js:2411-2431`, prepended at `:2615`) and the **Hypercube** panel
(`src/main.js:879-893`) are built in JS, not HTML, so they must be moved in
JS if their tab changes.

**2. The tab *buttons* and the tab *content divs* are in different DOM
order.** Buttons read Mapping · Movies · 3D · Analog · Draw · Project;
the divs are ordered mapping, draw, scene3d, clips, presets, analog
(`index.html:202, 432, 514, 550, 651, 816`). Harmless — `.active` class
toggling does not care — but it makes the file misleading to read, and a
restructure is the moment to make the two agree.

Also worth cleaning while in there: `.tab-merged` (`index.html:462, 636,
728, 742`) has **zero CSS rules and zero JS references**. Only the wrapper
`id`s are still used (`src/main.js:3849, 4721`). It is a scar from four
former tabs that were merged; the class can go.

### 3e. Naming fixes

| Now | Proposed | Why |
|---|---|---|
| "Mapping" (tab) | retire | the name belongs to the Projection Mapping section inside it |
| "Movie Clips" / "Movie B" | "Movie A" / "Movie B" | mirrors the `movie` / `movieB` prefixes; introduces no new metaphor |
| "Mix Bus" (source idx 26) | "Mix 1" | labels are free to change; order is not |
| "ColorSrc 1&2" | "Color / Gradient" | says what it is |
| "Sequences" | "Frame Sequences" | it is the seq1/2/3 buffers, not a step sequencer — and "State Step Sequencer" exists elsewhere |
| "Global / BPM / Morph" | split | three unrelated things: BPM belongs with transport, Morph with States |
| "SDF / Metaballs" | "Metaballs" | "SDF" is a rendering technique, not a function — and it collides with the 3D tab's own "Metaballs" section (`#blob-params`), which is a *different* subsystem. Disambiguate both. |
| "Particles / GPU Engine" | "Particles" | "GPU Engine" is implementation detail |
| `Response Curves "Tables"` | "Response Curves" | the label literally contains scare-quotes (`index.html:730-732`) |
| "Camera" (3D tab) | "3D Camera" | "Camera" already means the webcam in the toolbar and in Layers (`camera.device`). Two different things, same word, two tabs. |
| "LUT / Colour Grade" | pick one spelling | four colour-related sections exist ("Layer Color", "Palette", "ColorSrc 1&2", "LUT / Colour Grade") across two spellings |

Also unresolved, and larger than a rename: **"Time Displace" mode 0/1 *is*
slit-scan** (`src/ui/UI.js:164-171`), yet a separate "Slit Scan" section
exists with its own `slitscan.*` namespace. Two sections, overlapping
function. Not in scope here — flagging it so the Sources tab does not
enshrine the duplication.

**Avoid "Deck A / Deck B."** DJ vocabulary is the framing that produced the
hardwired mixer in the first place. ImWeb's lineage is Image/ine, not CDJs.

---

## 4. Gotchas found while writing this

### 4a. The lockstep comment names three consumers. There are six, and three are stale.

`src/controls/ParameterSystem.js:463` asserts the SOURCES array (declared at
`:466`) must match `Pipeline._resolveSource()` and `main.js
_resolveLayerTex()`. Verified: those three are in lockstep at 27 entries.

Three further copies exist that the comment does not name:

| Copy | Entries | State |
|---|---|---|
| `TD_CAPTURE_KEYS` — `src/main.js:252` | 25 | **stale — live bug**, see below |
| `SOURCE_NAMES` — `src/ai/AIFeatures.js:588` | 25 | **stale** — missing Movie B, Mix Bus |
| `SOURCE_ABBREV` — `src/ui/UI.js:33` | 13 | stale *and* mis-ordered — but **dead code**, declared and never referenced |

`SOURCE_NAMES` is the sharpest one, because the comment directly above it
says: *"a stale copy here previously caused the Narrator to describe the
wrong source entirely (e.g. 'Noise' reported as '3D')."* The exact failure
that comment was written to prevent has recurred — the Narrator will report
`'?'` for any layer routed to Movie B or Mix Bus.

`SOURCE_ABBREV` is harmless today (nothing reads it) but is a loaded gun: its
order diverges from SOURCES at index 4 onward, so the first person to wire it
into the layer buttons mislabels two-thirds of the source list. Delete it or
fix it; do not leave it.

The one that is actually broken in production is **`TD_CAPTURE_KEYS`** at
`src/main.js:252`, whose own comment says it mirrors "the Layers SOURCES list
(index-aligned)". It has **25 entries** — it stops at `tdisp` (24) and is
missing `movieB` (25) and `mixbus` (26).

`td.captureSource` (`ParameterSystem.js:3665`) is declared with
`options: SOURCES` — the full 27. So selecting "Movie B" or "Mix Bus" as the
Time Displace capture source yields `TD_CAPTURE_KEYS[25] === undefined`,
which is not `null`, so it falls to `inputs[undefined] ?? null` → `null` →
`tdEngine.capture(null)` no-ops. **Time Displace silently cannot capture
either of the v0.12 sources.**

Worse, the idle-deck gating at `src/main.js:6153` explicitly tests
`_gTdCap === 26` ("Mix Bus routed?"), so the code reasons about a
configuration the capture path cannot deliver. That branch is dead.

This is a live bug independent of everything proposed here. It should be
fixed on its own commit, and the lockstep comment updated to name **all six**
consumers — plus a note that `mixbus` is not in `inputs` and must resolve via
the existing `pipeline.mixTexture` getter (`Pipeline.js:872`), which was added
"for consumers outside render()" and is currently used only by
`_resolveLayerTex()`.

The deeper point: six hand-synced copies of one list, with three already
drifted, is a structural failure that comments cannot fix. Export SOURCES
once from ParameterSystem.js and derive the key array from it (labels →
keys is a pure mapping); the append-only rule then has exactly one place to
be violated instead of six.

Adding buses 2 and 3 makes this worse if unfixed: two more indices the
capture path silently drops.

### 4b. The duplicate "Vasulka Warp" headers are dead markup

`index.html:406-410` and `:419-423` both contain a `Vasulka Warp` section —
but **both are inside HTML comments**, with different ids
(`vasulka-params` and `vwarp-params`). Nothing renders; there is no visible
duplicate. It is leftover commented-out markup from two eras of the
experiment, consistent with CLAUDE.md's note that VasulkaWarp is deliberately
hidden.

Low priority, but while restructuring the panels: delete one, keep the other
with a dated note, and leave the live `vwarp.*` render path
(`src/main.js:6596`) alone — it is marked deprecated-but-load-bearing until
SequenceBuffer timewarp is stable.

### 4c. Persistence

`mix.srcA/srcB`, `mix2.*`, `mix3.*` serialize like any other param; old files
lack them and inherit defaults, which reproduce today's routing. No project
schema change is needed — the one genuine advantage of doing this as
parameters rather than as a routing structure.

---

## Suggested build order (each step ships alone)

1. **Consolidate the source list** (§4a) — export SOURCES once, derive the
   key arrays, fix `TD_CAPTURE_KEYS` and `SOURCE_NAMES`, delete or fix
   `SOURCE_ABBREV`. Independent live bugs; unblocks everything else and
   removes the main hazard in every later step.
2. **`mix.srcA` / `mix.srcB`** + replace the Pipeline.js:330 guard with a
   consumption test + self-feedback identity check + extend the
   conditionally-ticked predicates (§1c). Verify `MasterProject.imweb`
   renders identically.
3. **Panel restructure and renames** (§3). Pure HTML/labels — no param ids,
   no source reordering, and `buildMappingPanels()` needs no edit if
   container ids are preserved. Ships independently of 2. Keep the "Layers"
   header string, or fix `_collapseToLayers()` in the same commit.
4. **Buses 2 and 3** — descriptor loop, two appended source indices, two
   targets, generalised `_gUses`. Document the evaluation-order rule in the
   Mix panel.
5. **Mobile soak** of the 8-tab bar on a real device; fold Output into
   Project if it reads badly in hand.

---

## Open questions

- Does a bus reading itself mean last-frame or fallback? (§1d recommends one
  general rule over two special cases.)
- Three buses, or two? Three is a guess at a performing shape, not a measured
  need.
- Should `mix.srcA/srcB` be excluded from Display State capture, the way
  `glsl.preset` is (`group: 'global'`)? Argument for: routing-as-state is
  powerful. Argument against: it is exactly the drift problem that motivated
  the `glsl.preset` exclusion. **Recommendation: include them** — unlike
  `glsl.preset`, the source list is append-only and not user-editable, so
  indices do not drift.
