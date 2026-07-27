# ImWeb — UI Taxonomy & Mental Model Rethink (Phase 24 proposal)

*Design document, 2026-07-27. Successor to the Phase 23 signal-flow restructure,
which fixed the tab bar but left the inside of `Sources` unsorted.*

> **Status: design complete — ready for execution.** All open questions are
> resolved (§7, §8). Remaining items are verification tasks, not decisions (§9).
> No code has been written; this document is the input to a build plan.

---

## 0. Diagnosis — there are three root causes, not two

The brief names two problems. Underneath them sits a third that explains both.

### 0a. Two different axes were collapsed into one

The tab bar currently answers two unrelated questions with one control:

| Question | Tabs answering it |
|---|---|
| *Where am I in the signal flow?* | Sources · Mix · Effects · Output · Project |
| *Which source am I editing?* | 3D · Analog · Draw |

3D, Analog and Draw are not a different **kind** of thing from Noise or
Particles — they are sources (indices 6/20, 23, 7). They are top-level only
because they need **space**: 8 and 7 sections respectively, versus 4 lines for
Video Delay.

> **"Needs a lot of space" is a layout property, not a taxonomic one.**
> Encoding it in the taxonomy is precisely what breaks the mental model.

### 0b. One visual weight is doing the work of three semantic levels

Every panel is a `.panel-section` with an identical header. So these read as
peers when they are nothing of the sort:

- **Movie A** — a source
- **Style** — a *property sheet of* the Text source
- **Displacement Map Editor** — a *tool belonging to* Displacement

"Text Layer" and "Style" are not confusing because they are badly named. They
are confusing because the UI has **no way to say "this belongs inside that."**
Fixing the Text case alone would leave the same trap set for the next feature.

### 0c. There is no category for sources derived from the signal itself

Six entries in `Sources` do not generate anything. They take the instrument's
own output and re-present it: **Output** (feedback), **Video Delay**, **Time
Displace**, **Slit Scan**, **Frame Sequences**, **Vectorscope**. Filed beside
Movie A and Noise, they look like unrelated gadgets. Named as a group, they
teach one of the most important ideas in the instrument — that the signal can
be fed back into itself.

### Current inventory (verified)

| Tab | Sections |
|---|---|
| Sources | **16** (+ I/O injected at runtime = 17) |
| Mix | 8 |
| Effects | 4 |
| Output | 3 |
| 3D | 8 (+ Hypercube injected = 9) |
| Analog | 7 |
| Draw | 2 |
| Project | 6 |

Also found: **Sound, BG1 and BG2 have no dedicated panel container at all**
(`sound-params`, `bg1-params`, `bg2-params` do not exist). Three of 29 sources
are absent from the taxonomy. Where — if anywhere — they are currently exposed
needs confirming before this lands.

---

## 1. Principles

1. **One axis per control.** The tab bar means signal flow. Nothing else.
2. **Every source appears exactly once, in `Sources`.** No exceptions, however
   large its editor.
3. **Three levels, three visual weights.** Group → Source → Sub-section. A
   thing that belongs *inside* another must never render as its sibling.
4. **Space is solved by presentation, not by taxonomy.** A big editor gets a
   bigger surface; it does not get promoted to a category.
5. **Group names should teach.** A novice who reads only the group headers
   should learn how the instrument works.

---

## 2. Proposed structure

### 2a. Tab bar — five fixed tabs

```
  Sources    Mix    Effects    Output    Project        [ 3D ✕ ]
  └──────────── signal flow ─────────┘   └ meta ┘       └ contextual ┘
```

Down from eight. The sixth slot is **contextual**: it appears only while a
workspace is open, carries that source's name, and has a close affordance.
At most one workspace is open at a time, so the bar never exceeds six and never
needs horizontal scrolling — a real gain on iPad, where eight tabs currently
overflow.

### 2b. Inside `Sources` — four groups

Group headers are a new, heavier weight; sources sit inside them; each source's
own controls are sub-sections *within it*.

```
SOURCES
│
├─ LIVE IN                          "signal from the outside world"
│   ├─ Camera                       device · flip · resolution
│   └─ Audio In                     device · level
│
├─ MEDIA                            "material you loaded"
│   ├─ Movie A                      transport · speed · loop · in/out · BPM sync
│   ├─ Movie B
│   ├─ Clip Library                 8 banks × 16
│   └─ Stills Buffer                8×8 grid · BG1 · BG2
│
├─ GENERATORS                       "the instrument making images from nothing"
│   ├─ Colour / Gradient            ├ Solid  ├ Gradient  └ Palette
│   ├─ Noise                        ├ Family ├ Shape     └ Colour
│   ├─ Particles                    ├ Emitter ├ Forces   └ Look
│   ├─ Metaballs                    (SDF)
│   ├─ Text            ⤢            ├ Content └ Style
│   ├─ Draw            ⤢            ├ Canvas  └ Brush
│   ├─ 3D Scene        ⤢            ├ Geometry ├ Transform ├ Camera ├ Material
│   │                               ├ Lights   ├ Cloner    ├ Metaballs
│   │                               ├ Import   └ Hypercube
│   └─ Analog TV       ⤢            ├ Source & Crop ├ Signal ├ CRT ├ RF
│                                   ├ Composite ├ Tuner └ Teletext
│
└─ FROM THE SIGNAL                  "the instrument listening to itself"
    ├─ Output (feedback)
    ├─ Video Delay
    ├─ Time Displace
    ├─ Slit Scan
    ├─ Frame Sequences              (seq 1–3)
    └─ Vectorscope
```

`⤢` marks a source with a **workspace** (§3). Everything else expands in place.

**Why these four.** They are ordered by *distance from the outside world*:
what comes in → what you loaded → what the machine invents → what it makes of
its own output. That is a story, and it is true.

### 2c. `Mix`, `Effects`, `Output`, `Project`

```
MIX                                 EFFECTS
├─ Layers                           ├─ Blend & Feedback
│   ├─ FG / BG / Displace           ├─ Effect Chain
│   ├─ Layer Colour                 ├─ LUT / Colour Grade
│   └─ Mirror                       └─ Live GLSL          ⤢
├─ Mix 1  ├ A/B sources ├ Mode
├─ Mix 2  └ Crossfade              OUTPUT
├─ Mix 3                            ├─ Display & Record   ← from I/O
├─ Keyer                            │   └ resolution · 2nd screen · capture
│   ├─ Luma                         ├─ Projection Mapping
│   └─ Chroma                       └─ Transport          ← BPM half of Global
└─ Displacement
    ├─ Amount & Angle              PROJECT
    └─ Map Editor                   ├─ Project file
                                    ├─ Banks
                                    ├─ States  ├ Step Sequencer └ Morph
                                    ├─ Response Curves
                                    ├─ AI
                                    └─ Settings           ← rest of Global
```

Six existing panels stop being top-level and become sub-sections: Layer Colour,
Displacement Map Editor, Palette, Style, Brush, Hypercube. The current
**"Global / BPM / Morph"** — three unrelated things in one panel — splits three
ways along the lines above, and the runtime **I/O** block finally splits
correctly: its input half to `Sources ▸ Live In`, its output half to `Output`.

---

## 3. The workspace pattern — solving 3D / Analog / Draw

**Recommendation: keep the full-width editing surface, remove the top-level
tab.** A large source is opened *from its row in `Sources`*:

```
GENERATORS
  ▸ Noise
  ▸ Particles
  ▾ 3D Scene                                   [ ⤢ Open workspace ]
      Active  ●     Geometry  Sphere ▾         ← a few vital controls stay here
  ▸ Analog TV
```

Pressing `⤢` opens the workspace as the contextual sixth tab. Closing it
returns you to `Sources` with that row still expanded.

**Why this and not the alternatives:**

| Option | Verdict |
|---|---|
| Master–detail inside `Sources` | ✗ The panel is 280–320 px. No room for a detail pane. |
| Keep them as tabs, just visually demoted | ✗ Honest but changes nothing — the paradox is structural. |
| Reuse the existing **detach** (`⊞`) mechanism as the only route | ✗ Good affordance, wrong default: 3D editing wants sustained space, not a floating window. Keep detach as an *option*, not the mechanism. |
| **Contextual workspace tab** | ✓ One taxonomy, full space, shorter tab bar, and the route through `Sources` teaches that 3D *is* a source. |

The lesson generalises: **Live GLSL** is a code editor sitting in a 300 px
column today — it deserves the same treatment, opened from `Effects`.

---

## 4. Text / Style, generalised

The fix is not to rename `Style`. It is to make the container able to hold it:

- **Text** becomes one source with two sub-sections: **Content** and **Style**.
- The same move retires five other orphans (§2c).
- **The rule going forward:** a panel earns top-level placement only if it is
  something you can *route* — i.e. it appears in the source list, or it is a
  stage of the chain. Everything else is a sub-section of the thing it
  configures.

That rule is checkable at review time, which is the point — it prevents the
next "Style" rather than fixing this one.

---

## 5. What a novice learns from the structure alone

Reading only headers, top to bottom:

> Signal comes from **outside** (Live In), or from **material I loaded**
> (Media), or the instrument **generates** it. It can also **feed back on
> itself** (From the Signal). Sources are **mixed** into layers, then
> **processed** by effects, then sent to **output**. Everything else is
> **project** housekeeping.

That is the instrument's actual architecture, learned without documentation.

---

## 6. Constraints this must respect

- **No parameter ids change. No source indices change.** SELECT values persist
  as integer indices; the list is append-only. This is a pure
  labels-and-grouping exercise, as Phase 23 was.
- **`data-default-open` stays authoritative** for the landing tab and the
  expanded section; the `active` classes in `index.html` remain a first-paint
  hint. If the marked section moves to `Sources`, the hint must move with it.
- **Runtime-injected panels move in JS, not markup** — I/O, Hypercube, and now
  anything the workspace router creates.
- **`#tab-buffer` and `#tab-glsl` ids are queried by `main.js`.** Keep them.
- Group headers are a genuinely new UI level — `buildMappingPanels()` maps
  container ids to param lists and carries no notion of nesting. This is the
  one part of Phase 24 that is real work rather than markup rearrangement.

---

## 7. Resolved: workspace lifetime vs. state recall and global reset

*Investigated 2026-07-27, serialized files read before code per the
`imweb-debugging` protocol.*

**State recall does not touch the UI.** A `.imstate`, a bank state and a
`.imweb` project store parameter values and content only:

| Key | Contents |
|---|---|
| `values` | parameter values (511 in the sample state) |
| `controllers` | controller assignments |
| `fxOrder` | effect-chain order |
| `mediaRefs` | movie / scene3d / text / buffer asset references |
| `pins` | **not** UI pins — particle *ghost nodes* (`particles.ghostNodes.restorePins`) |
| `extra` | Text layer *content* strings |
| `thumbnail`, `name`, `created` | metadata |

A project adds `params`, `presets`, `tables`, `scene3d`, `stills`, `drawData`,
`warpMap`, `warpSlots`, `glsl`, `activePreset` — all content, assets and
parameters (`activePreset` is the active *state* index, not a tab). Confirmed
in code: `activeTab`, `openSections`, `collapsedSections` and `currentTab`
appear nowhere in `src/`, and no save path touches `.collapsed`. Restore is
`ps.restoreState(ds.values)` plus pins, fxOrder and controllers.

**⇒ Recalling a State can never close an open workspace.** Performers can drive
States hard — via MIDI, the step sequencer, morph — while a workspace stays
open. This is the behaviour we want and it needs no new code.

**Global reset is the one thing that does close a workspace, by design.**
`_resetAllParams()` (the ↺ button, Shift+Esc) calls `_collapseToDefaultOpen()`,
which collapses every section and calls `activateDefaultTab()` — returning to
the tab owning the `data-default-open` marker.

**Design decision: global reset is a zero-state return, and closing active
workspaces is part of that contract.** Reset already discards every parameter
value; leaving the user inside a 3D or Analog workspace afterwards would be a
half-reset, and the one gesture whose whole purpose is "put the instrument back
to a known state" should put the *interface* back too. So Phase 24 should
close any open contextual workspace on reset rather than special-casing around
it.

Two consequences to honour when building the workspace router:

- Closing a workspace must be idempotent and safe from `_resetAllParams()`,
  which is `async` — the router cannot assume a workspace is open.
- Reset is the **only** sanctioned programmatic tab change. Nothing else should
  move the user; the tab bar otherwise belongs to them.

*History, so the difference is not mistaken for a regression:* before `cae5460`
the equivalent function only toggled collapse classes and left the active tab
alone. Tab switching arrived with the `data-default-open` decoupling and is
ratified here as intended behaviour rather than a side effect.

---

## 8. Resolved: final design decisions

All three outstanding *design* questions are decided. One item — a mobile
device test — was never a design question and moves to the verification
checklist (§9).

### 8.1 Sound, BG1 and BG2 get minimal panels

**Decision.** Build small panels: **Sound** under `Live In`, **BG1 / BG2**
under `Media` (alongside Stills Buffer, which already owns their textures).

**Justification.** This is the Phase 24 rule made concrete: **if a source is
routable, it must have a visible UI footprint**, so a user can always see where
a signal originates. A source reachable from the `layer.fg` dropdown but absent
from `Sources` is a hole in the mental model — the user meets it as an
unexplained option rather than as a thing they placed.

*Implementation note:* verified there are no `sound-params`, `bg1-params` or
`bg2-params` containers today, so these are small new builds, not moves. Scope
them to what the *source* needs; audio level/FFT already reaches parameters
through the controller system and should not be re-exposed here.

### 8.2 Vectorscope stays a routable source

**Decision.** Keep it in the source tree, under `From the Signal`.

**Justification.** It reads as a meter conceptually, but it **emits a video
stream that can be mixed, keyed and processed like any other source**. Its
mechanical behaviour decides its home, not its intent — the same criterion as
§8.1, applied in the opposite direction. Placement follows routability, which
keeps the rule falsifiable rather than a matter of taste.

*Non-blocking follow-up:* a small persistent readout elsewhere in the UI is
compatible with this and can be considered separately; it does not change the
source-tree placement.

### 8.3 Time Displace and Slit Scan merge into one "Time FX" panel

**Decision.** One `Time FX` panel replacing the two separate entries.

**Justification.** The overlap is literal, not approximate: `td.mode`'s options
are `["Slit X", "Slit Y", "Warp Line", "Slit X Sym", "Slit Y Sym", "Radial",
"Noise"]` — modes 0 and 1 *are* slit-scan, by name. Two top-level panels for
one idea is exactly the redundancy Phase 24 exists to remove.

**Constraint the merge must respect — this is a panel merge, not an engine
merge.** Verified:

| | Time Displace | Slit Scan |
|---|---|---|
| Engine | `TimeDisplaceEngine` (120-frame ring) | `SlitScanBuffer` |
| Params | 12 × `td.*` | 6 × `slitscan.*` |
| **Source index** | **24** | **15** |

They are two separate engines with two separate buffers, and — decisively —
**two separate routable source indices**. Indices are persisted as integers in
every saved state, bank and `.imweb` file, and the list is append-only, so
neither may be removed or reordered by a UI change.

Therefore `Time FX` is **one panel containing two sub-sections**, using exactly
the level-3 mechanism from §2b, with both outputs still selectable. Collapsing
them into a single engine and retiring one source index is a genuine
deprecation — it needs a migration for existing states and is explicitly *not*
part of Phase 24.

---

## 9. Status — design complete, ready for execution

Every design question is resolved. The proposal is ready to be turned into a
build plan.

**Carried into execution as verification tasks, not open design:**

1. **Mobile device test.** Five tabs fit without scrolling where eight did not,
   but whether the three-level hierarchy (Group → Source → Sub-section) reads
   well in a 100 vw drawer needs a real device, not a desk opinion. This was
   never answerable at design time.
2. **Confirm the three new panels** (§8.1) render and route once built.
3. **Confirm both `Time FX` outputs stay independently routable** (§8.3) —
   source indices 15 and 24 must survive the panel merge intact.

**The one piece of real engineering** remains as noted in §6: the group header
is a new UI level, and `buildMappingPanels()` maps container ids to parameter
lists with no notion of nesting. Everything else is markup rearrangement,
labels, and the workspace router from §3.
