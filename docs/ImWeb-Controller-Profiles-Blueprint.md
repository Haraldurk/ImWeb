# ImWeb — Controller Profiles Blueprint

*Architectural proposal, 2026-09-04 — no code yet. Successor to the MIDI
mapping work in PR #111 (map mode, incoming monitor, mapping pages, soft
takeover, note learn). Written while that context was fresh; read §5 before
touching any UI.*

---

## 0. The problem

A binding today is a fact about **one physical controller**:

```js
{ type: 'midi-cc', cc: 17, channel: 1 }        // "CC 17 drives Blend Amt"
```

`CC 17` is not a control anyone can point at. It is whatever knob the Korg
happens to send 17 from, and on a Novation Launchkey Mini it is a different
knob, or nothing. So a mapping built on one desk is worthless on another, and
the owner now has two (nanoKONTROL2, Launchkey Mini) with a third likely
whenever someone else performs with this instrument.

The goal is that a page of mappings says **"Fader 1 → Blend Amt"** and keeps
meaning that when the hardware changes.

---

## 1. The two-layer model

```
Device profile:   "Fader 1..8", "Knob 1..8", "Pad 1..16"  →  (channel, CC|note)
Mapping page:     named control                            →  parameter
```

The mapping page becomes portable. Swap the desk, load its profile, and the
page still works — provided both profiles name the same controls.

**That proviso is the whole design risk.** "Fader 1" on a nanoKONTROL2 and
"Knob 1" on a Launchkey are not the same control, and a page written for eight
faders cannot be honoured by a device with eight knobs and no faders unless
something decides they are interchangeable. Two ways out, and this is
**decision 3** below: a fixed vocabulary every profile must map onto (rigid,
portable), or free-form names with an explicit per-device alias table (flexible,
more setup).

---

## 2. What already exists to build on

All of this shipped in PR #111 and is load-bearing for slice 2.

| Thing | Where | Why it matters here |
|---|---|---|
| Incoming monitor | `ControllerManager._recordMidi`, `buildMidiBindIndex` | **This is the profile-learn tool.** Plug a device in, move everything once, read off `(channel, type, number)` for every control. |
| Map mode | `ControllerManager._mapMode`, `main.js _mapModeGrab` | A latching learn that re-arms. Profile learn is the same loop with a different destination. |
| Sequential option learn | `startMIDILearn(id, opt, cb, sequential)` | Walks a SELECT's options, advancing after each bind. A profile is exactly this shape: walk a list of named controls, bind one physical control to each. |
| Generic map target | `data-param-id` + `data-opt-index` on any element | Lets a custom widget declare itself bindable. A profile editor's rows can reuse it. |
| Per-option maps carry both | `midi-cc-map` `{ ccs[], notes[] }` | Pads send notes, knobs send CC. Any profile format must carry both from day one — see §5. |
| Mapping pages | `param.midiPages[]`, `setPageBinding()` | Composes with profiles, or is replaced by them — **decision 2**. |
| Persistence | `MappingAutosave` (localStorage, per-origin), `Parameter.serialize` | Where a profile would live is open; note the per-origin trap. |

---

## 3. Where the mappable surfaces are

Slice 2 will touch UI. **Not everything that looks like a control is a
parameter row**, and assuming otherwise cost four wrong builds in one session:

| Surface | Kind | Mappable? |
|---|---|---|
| `.param-row[data-param-id]` | real rows | yes, natively |
| `.param-opt-btn` inside a row | SELECT ≤ 8 options | yes, per option |
| `.imw-sel` dropdown | SELECT > 8 options | **no per-option affordance** — this is why `clip.slot` needed the walk |
| Clip Library `.clip-slot` grid | custom widget | only since it was tagged |
| Cue bars `.cue-btn` (`buildCueRow`) | custom widget | only since it was tagged |
| Movie rack `.clip-item` rows | custom widget | only since it was tagged |
| Movie **Library** entries | actions, not params | **no** — clicking loads a file; `movie.clip` exists for the rack, not the library |

Rule of thumb, learned the hard way: **before building against a control, check
whether it has a `data-param-id`.** If it does not, it is a custom widget and
needs tagging, or there is no parameter behind it at all.

---

## 4. The three open decisions

These are the owner's calls and should be settled *before* code.

### Decision 1 — What a profile keys on, and what happens when the device is absent

A profile has to be recognised. Options: the Web MIDI **port name**
(`input.name`), a user-chosen label, or nothing (one active profile at a time,
chosen manually).

Complications that are not hypothetical:

- The **Launchkey Mini's InControl mode changes what it sends**, so one physical
  device can present two control sets. That is either two profiles or one
  profile with a mode switch.
- The nanoKONTROL2 has **no SCENE button** (verified — that was the nK1); its
  alternate assignment sets are flashed with Korg's Kontrol Editor, so the same
  port can send different CCs on different days with no way to tell from the
  app.
- Two identical devices share a port name.

**What happens with no device attached matters most**, because it is the common
case when opening a project on a laptop: the page must still be editable and
must not silently drop bindings it cannot resolve.

### Decision 2 — Do profiles and pages compose, or does one replace the other?

Four pages × a profile is a two-dimensional space, and it may be one dimension
too many to hold in your head mid-performance. Three shapes:

- **Compose** — a profile names controls, pages remap them. 4 × 8 = 32 as now.
- **Profile replaces pages** — switching profile switches the whole mapping;
  pages disappear.
- **Pages become per-profile** — each profile carries its own four pages.

The third is probably what a performer wants and is the most work.

### Decision 3 — What happens to the mappings that already exist

The owner now has **real mappings bound to raw CC numbers**, made with the
tooling in #111. Introducing a profile layer means one of:

- **Migrate** — guess which named control each CC was. Unsound: nothing in the
  data says CC 17 was "Knob 1", and a wrong guess silently repoints a mapping.
- **Keep both models** — a binding is either raw (`midi-cc`) or named
  (`profile:Fader 1`). Safer, uglier, and every read path must handle both.
- **Start over** — profiles supersede raw bindings; existing ones are cleared
  with a warning.

The middle option is the honest one, and it is the same shape as `midiPages`
arriving beside `controller`: a new optional form, with absence meaning "the
old form". That migration worked and needed no version stamp.

---

## 5. Traps banked from the #111 session

Do not rediscover these.

1. **A write path without its read path fails silently and looks like the
   feature not working.** This happened twice: `midiPages` was written but not
   cleared (bindings returned after a page switch), and per-option `notes` were
   written but not counted by the badge (a working mapping displayed `CC×0`).
   **When adding a field to a persisted structure, enumerate what reads it
   before shipping.**

2. **`CueBank.restore()` coerces every key to Number**, which drops anything
   else. Non-numeric cue data needs `extraKeys` — a profile reference stored on
   a cue would hit this immediately.

3. **A SELECT's per-option learn only exists on the button group**, which
   `ParamRow` builds for `options.length <= 8`. Above that it is a dropdown with
   no per-option affordance. A profile with more than 8 named controls will hit
   this.

4. **Verify headlessly.** `--headless=new` with CDP; a visible automation window
   on `:4173` is indistinguishable from the owner's own tab and caused repeated
   confusion. Inject a fake MIDI device with
   `Page.addScriptToEvaluateOnNewDocument` overriding `navigator.requestMIDIAccess`
   — that drives the *real* `onmidimessage` handler end to end.

5. **Bump `CACHE` in `public/sw.js` after every rebuild** the owner needs to
   see, using the mid-cycle `-N` suffix. The service worker is cache-first for
   the app shell, so without a bump a rebuild never reaches a returning tab and
   reads as "the app reverted". `audit-sw-cache-bump`'s STRICT mode requires the
   name to track `package.json`'s version, so `-N` is the only free suffix.

6. **Mutation-calibrate every new audit, and check the mutation FAILED an
   assertion rather than threw.** Two mutations in #111 "passed" by crashing a
   downstream check that dereferenced a null — they had calibrated nothing. One
   audit check also passed vacuously (a helper that sent no message), and one
   credited a guard for work the strict path was doing.

7. **Ask which control the owner is actually clicking.** Four builds in one
   session went against the wrong widget because "Movie A clips" was read as the
   Clip Library, then the Movie Library, then cues, before it turned out to mean
   the deck's clip rack. A screenshot settles it in one exchange.

---

## 6. Suggested first slice

Smallest thing that proves the model, assuming decisions 1–3 land on
*port name / compose / keep both*:

1. A profile is `{ id, name, port, controls: [{ name, kind, channel, number }] }`
   where `kind` is `cc` | `note`. Stored per-origin beside the mappings.
2. **Learn a profile** with the existing sequential walk: show a list of control
   names, arm the first, move a physical control, advance. The monitor already
   supplies everything needed.
3. A binding gains an optional named form. Absence means the old raw form —
   the `midiPages` migration pattern.
4. Resolution at dispatch: named binding → active profile → `(channel, number)`.
   No profile, or the control is absent from it, means the binding is inert and
   **says so in the UI** rather than failing silently.

Step 4 is where this feature will live or die: an unresolvable binding must be
*visible*, because the whole class of bug in §5.1 is a mapping that exists and
does nothing.
