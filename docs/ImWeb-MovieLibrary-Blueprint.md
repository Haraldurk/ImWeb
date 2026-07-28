# ImWeb — Movie Library Blueprint

*Architectural proposal, 2026-07-28 — no code yet. Successor in spirit to
`ImWeb-MixBus-Rethink-Blueprint.md`: same move, applied to media instead of
routing.*

---

## 0. The reframe that shapes everything

The MixBus blueprint found that the instrument's best idea — *routing is data,
not topology* — was being broken by one node that hardwired its inputs. Media has
the same disease, one level up.

**Today there is no library.** There is a list of clips that happens to live
inside Deck A, a second deck with the same list and no way to see it, and a
recorder misleadingly named "Clip Library". Three things, no shared vocabulary.

The fix is the same shape as the MixBus fix: **separate the catalogue of things
from the players that play them.** A clip is data. A deck is a player. The
recorder is one of three ways a clip comes into existence. Once those three are
named correctly, most of the current awkwardness disappears without new
machinery.

**Compatibility is strict throughout.** Parameter ids stay frozen, `SOURCE_DEFS`
stays append-only and *untouched*, no `movie.*` → `deckA.*` migration. Only
labels, panel grouping, and the loading path change.

---

## 1. What is actually there today

Three concepts, two of them mislabelled.

| Thing | What it really is | Storage | UI |
|---|---|---|---|
| **Movie A** | `MovieInput` instance, up to 8 clips (`MAX_CLIPS`, `MovieInput.js:15`), one active | in-memory `<video>` per clip | full list with thumbnails, `+ Add Clip`, `Clear` |
| **Movie B** | A *second* `MovieInput` instance (`main.js:264`) — same class, same 8-clip array | same | **none** — one status line |
| **Clip Library** | A live-output **recorder**: captures `clip.recordSrc` (Out/Cam/Mov/FG/BG/S1-3) into 8 banks × 16 slots | IndexedDB `imweb-clips`, video blobs | bank grid, REC, Target A/B, Duration |

**The name is the bug.** `src/io/ClipLibrary.js` is a sampler. It does not hold
movies; it holds recordings of the output. Meanwhile the actual library of movies
is a flat 8-slot array buried inside Deck A, with no name at all.

**Deck B is second-class by accident, not design.** `movieInputB.clips` is a full
8-clip array — `refreshClipBStatus()` already reads its `.length` (`main.js:1066`).
The data structure is there; only the UI is missing. Everything else flows to A
alone:

- the preloaded manifest loads into A (`main.js:7644`)
- imported files land in A
- `Shift+1-8` selects A's clips (`main.js:5693`)

B is reachable only through modifier gestures — ⇧-click a library slot
(`main.js:3126`), ⇧-drop a file (`main.js:3257`) — advertised by a single hint
string (`main.js:1069`):

```js
"No clip — ⇧-click a library slot or ⇧-drop a video to load Deck B";
```

That is the whole discovery surface for half the media engine.

**And the media bookkeeping is already broken.** `setMediaRef('movie', …)` is
called from exactly one place — the Deck A drop handler (`main.js:3282`). So a
clip added via `+ Add Clip`, a preloaded clip, anything on Deck B, and *switching
between clips* all record nothing. `_checkMediaRefs` (`Preset.js:443`) then
compares that stale value and, at most, toasts:

```js
`⚠ State was saved with: ${mismatches.join(', ')} — please load manually`
```

It never resolves anything. A library gives us somewhere to resolve *to*, which
is why §5 can turn this advisory toast into an actual reload.

---

## 2. The model — one catalogue, two racks

### 2.1 The constraint that forbids the obvious design

The tempting design is one shared pool of clips both decks point at. **It cannot
work.** Two decks playing the same file need independent `<video>` elements —
independent playheads, `speed`, `start`, `end`. A shared live clip would make
Deck B scrub Deck A.

So the catalogue holds **descriptors**, not players:

```js
// A Library entry — data, no <video>, no texture.
{
  id:        'preload:Dive_Halli_ALL-I.mp4',  // stable, human-readable
  name:      'Dive_Halli_ALL-I',
  origin:    'preload' | 'import' | 'record',
  src:       '/_imweb_ready/Dive_Halli_ALL-I.mp4',  // url, or null if unresolved
  duration:  53.0,
  thumbnail: 'data:image/…',
  slotIndex: null,   // record-origin entries only — index into imweb-clips
}
```

Each deck instantiates its own video from an entry through the **existing**
`MovieInput.addClip()` (`MovieInput.js:32`), which already accepts both a `File`
and a URL string. No new video plumbing is required.

### 2.2 Entry ids are prefixed by origin

`preload:<filename>`, `import:<filename>`, `rec:<slotIndex>`.

This is not cosmetic. A prefixed id is stable across sessions, readable in a
saved `.imweb`, and — because the suffix *is* the filename — gives filename
fallback matching for free (§5). It also means recorded clips need no id
allocator: their slot index already is one.

### 2.3 Racks stay at 8

Each deck keeps its 8-slot rack (`MAX_CLIPS = 8`), holding references to
catalogue entries. This is deliberate:

- `Shift+1-8` / `Option+1-8` map to a rack one-for-one; a rack larger than the
  keypad is a rack you cannot play
- a rack slot holds a *loaded, decoded* video — instant switching is the point.
  Loading straight from a catalogue of hundreds would make every switch a stall
- per-deck `start` / `end` / `speed` stay meaningful per slot

**The catalogue is uncapped.** It is metadata; hundreds of entries cost
thumbnails, not VRAM.

### 2.4 Three feeds, one catalogue

Everything that produces a clip registers an entry:

| Feed | Today | After |
|---|---|---|
| Preloaded (`_imweb_ready/manifest.json`, `main.js:7644`) | straight into Deck A | catalogue entries, `origin: 'preload'` |
| Imported (`+ Add Clip`, drop) | straight into Deck A (or B via ⇧) | catalogue entry, then loaded into the target rack |
| Recorded (`ClipLibrary.record()`) | its own parallel grid | catalogue entries, `origin: 'record'` |

Loading is then one verb everywhere: **load entry → rack slot of deck X.**
⇧-click and ⇧-drop stop being secret handshakes and become shortcuts for it.

---

## 3. The recorder

**Rename `Clip Library` → `Recorder`.** The rule that settles the confusion, and
the one line to put in the UI:

> The **Library** is where clips live. The **Recorder** is one of three ways
> clips get there.

Its bank grid, `REC`, `Duration` and `RecordSrc` stay exactly as they are — it is
a good sampler and nothing about it needs redesigning. What changes is where its
output goes: a completed recording registers a catalogue entry instead of living
in a parallel space. `Target: A / B` remains as a convenience (record straight
into a deck), now expressed as "register entry, then load into that deck's rack".

**Its parameter ids do not change.** `clip.recordSrc`, `clip.bank`, `clip.slot`
keep those exact ids despite the relabel — see §5.

**No data migration is needed for existing recordings.** `getManifest()`
(`ClipLibrary.js:131`) already returns `[{ slotIndex, duration, thumbnail }, …]`
— precisely the fields a catalogue entry needs. The 128 existing slots surface as
`rec:` entries on first read, with nothing rewritten and nothing to undo if the
design is reverted.

---

## 4. Keys

`Shift+1-8` keeps selecting **Deck A**'s rack (`main.js:5693`) — unchanged muscle
memory. `Option+1-8` selects **Deck B**'s rack.

Option+digit is genuinely free: the plain-digit state-recall handler explicitly
excludes it (`main.js:5723`):

```js
if (!e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) {
```

Two hazards, both already solved once in this file:

- **macOS Option+digit emits `¡™£¢∞§¶•`,** not digits. Match on `e.code`
  (`Digit1`…`Digit8`), exactly as the Shift handler does. Never `e.key`.
- **Nordic layouts** put `/` on Shift+7, which is why the existing handler runs
  before the param-search shortcut and returns early. The Option branch must sit
  in the same block and follow the same early-return discipline.

---

## 5. Migration and compatibility

This is the section that decides whether the change is safe. Each rule below has
already bitten this project once.

### 5.1 Source indices are untouched

Movie A is source `1`; Movie B is source `25` (`ParameterSystem.js:477,501`).
**A catalogue is not a routable source.** It is never a layer input, never a
displacement source, never a mix input — the *decks* remain the sources, exactly
as today.

`SOURCE_DEFS` therefore gains no entry and is not reordered. Stated explicitly so
nobody later "tidies" a Library source into it: SELECT values persist as integer
indices into that list, and the list is append-only forever.

### 5.2 Parameter ids stay frozen

- `clip.recordSrc`, `clip.bank`, `clip.slot` keep their ids through the Recorder
  rename. The panel label changes; the ids do not.
- `movie.*` and `movieB.*` are untouched. `MOVIE_DECK_PARAMS`
  (`ParameterSystem.js:1615`) stays registered for both prefixes as-is — the rack
  is a *loading mechanism*, not a new parameter surface.

The reason is recorded in the source itself (`ParameterSystem.js:1651`): renaming
ids "would break every saved state, bank, `.imweb` file and MIDI mapping on
earth". This is the same rule that kept mix bus 1 on the bare `mix.` prefix.

### 5.3 What a saved `.imweb` carries

A project stores **rack references**, not the catalogue:

```js
racks: { movie: ['preload:Dive…', 'import:foo.mp4', null, …],
         movieB: ['rec:12', null, …] }
```

The catalogue itself is rebuilt each launch: `preload:` entries from the
manifest, `rec:` entries from `getManifest()`. Only `import:` entries cannot be
rebuilt — a browser cannot re-open a local file by path. Those resolve to an
**unresolved entry**: name and thumbnail preserved, greyed, with a *relink*
affordance. That is strictly better than today, where the clip simply vanishes.

### 5.4 The concrete migration case

*A `.imweb` saved today, loaded after the change.* It has no `racks` key. Deck A
has clips; `mediaRefs.movie` may hold a filename (or, more likely, nothing —
§1).

1. No `racks` key → the loader takes the legacy path: clips named in the project
   load into Deck A's rack in order, exactly as today. Nothing is lost.
2. Each becomes a catalogue entry as it loads, keyed `preload:` or `import:` by
   whether the manifest claims it.
3. `mediaRefs.movie`, if present, is matched against catalogue entries **by
   filename suffix** — which is free, because ids end in the filename (§2.2).
   On a hit, the clip is actually loaded rather than toasted about.
4. On a miss, the existing advisory toast (`Preset.js:449`) still fires. Behaviour
   degrades to exactly what happens now.

No saved project can be made worse by this change; the failure mode is "behaves
like today".

### 5.5 Fix the bookkeeping while we are here

`setMediaRef('movie', …)` should fire wherever a rack slot changes — not only on
Deck A drop (`main.js:3282`) — and should record the catalogue entry id. It
should be per-deck. This is a small change that makes Display States actually
recall the right clip, which they currently cannot.

---

## 6. UI

**Movie A, Movie B and the Recorder already exist as detachable floating
panels** (`Movie A (detached)`, `Movie B (detached)`, `Clip Library (detached)`
in the Sources tab). The Library becomes a fourth panel of the same kind — no new
windowing idiom.

- **Library panel** — the browsable catalogue: thumbnail, name, duration, origin
  badge. Actions: load into A, load into B, delete, relink. Reuse the grid built
  by `buildClipLibrary()` (`src/ui/UI.js:3491`) rather than inventing a second
  grid idiom; it already renders thumbnails from a manifest.
- **Deck A panel** — its list becomes explicitly *"A's rack"* (8 slots, numbered
  1-8 to match the keys) instead of an unnamed clip list.
- **Deck B panel** — gets the identical rack UI. This is the single highest-value
  change in the document and it needs no new data structures: `movieInputB.clips`
  already exists and `refreshClipBStatus()` (`main.js:1066`) is already the
  refresh hook. The hint string at `main.js:1069` goes away.
- **Recorder panel** — unchanged but relabelled, plus one line of explanatory
  text (§3).

`+ Add Clip` and drag-drop keep working; they now add to the Library and load into
the target rack in one motion, so the common case is still one gesture.

---

## 7. Open questions, answered

**Does the catalogue persist?** Partially, and deliberately: `preload:` rebuilds
from the manifest, `rec:` from IndexedDB, `import:` cannot rebuild and degrades to
an unresolved entry (§5.3). Persisting a full catalogue would mean persisting
handles the browser will not honour.

**Does a `.imweb` carry catalogue membership?** No — rack refs only (§5.3).
Membership is derivable for two of three origins, and carrying it would embed
machine-specific state in a portable file. This is the same reasoning that keeps
`displace.warpSlot` out of Display State capture.

**Is the rack still 8?** Yes (§2.3). The catalogue is uncapped.

**What happens to the 128 recorded slots?** Nothing. They surface as entries via
the existing `getManifest()` with no rewrite (§3).

---

## 8. Implementation order

Each step leaves the app working and is independently revertible.

1. **Deck B rack UI.** Pure win, no model change — give B the list it already has
   data for. Ships value even if the rest is deferred.
2. **`Option+1-8`** for Deck B's rack.
3. **Library module + panel**, populated from the three feeds; loading routed
   through it. Decks unchanged underneath.
4. **Recorder rename**, labels only, ids frozen.
5. **Rack refs in `.imweb`** plus the legacy-load path (§5.4).
6. **`setMediaRef` correctness** (§5.5).

Steps 1-2 are worth doing regardless of whether 3-6 are ever approved.

---

## 9. Risks

**The clip-switch stall.** Loading a catalogue entry into a rack slot decodes a
video. If the Library panel makes loading feel as cheap as switching, users will
hit decode stalls mid-performance. The rack/catalogue split exists precisely to
keep these distinct — the UI must not blur them.

**`import:` entries are a promise the browser cannot keep.** An unresolved entry
must look obviously unresolved, or a performer will build a set on clips that
evaporate on reload.

**Scope creep into the Recorder.** It works. This document renames it and
redirects its output; it does not redesign sampling.
