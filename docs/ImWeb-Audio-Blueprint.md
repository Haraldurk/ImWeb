# ImWeb Audio — Blueprint

**Status: DESIGN ONLY. No code exists.** Nothing in this document is implemented,
branched, or prototyped. It records a design settled in a brainstorming session on
2026-08-12, together with the reasoning and the rejected alternatives. Read the
corrections and rules, not just the headings.

---

## 1. What this is

The audio half of ImWeb: a live sampling and synthesis instrument sharing one
runtime, one parameter system, and one drawing surface with the video half.

It is not a DAW, not a sequencer, and not an audio engine bolted to a video app.
It is the other half of an instrument whose first half already exists.

### The line

**If the audio is *played*, it belongs inside ImWeb. If it is *arranged*, it does
not.** Live sampling, live synthesis and gestural navigation are played. Timeline
editing, arrangement, mixing and plugin hosting are arranged — those stay in
Ableton or Reaper, synced over MIDI clock, and are explicit non-goals here.

---

## 2. Lineage

ImWeb descends from Tom Demeyer and Steina Vasulka's **Image/ine** (STEIM
Amsterdam, 1996–2001). The audio half descends from Image/ine's siblings in the
same building:

- **LiSa** — Michel Waisvisz and Frank Baldé, STEIM, from 1995. Live sampling into
  RAM as a performance act, with playback that abandoned the keyboard-sampler
  paradigm in favour of many directions, speeds and patterns under sensor control.
- **RoSa** — Baldé's successor to LiSa. Client-server: RoSa is the *server*,
  configured and driven entirely by OSC; clients (Lemur, junXion, Max, PD) own the
  UI. One big stereo Sample Buffer accessed through **Zones** — Recording, Playback
  and Load, 128 of each. New material can be recorded into the buffer while other
  zones play from that same region. Engine free of charge; clients sold.
- **SuperCollider** — the synthetic pole. SC3's scsynth/sclang split reached the
  same client-server answer independently. JITLib (Rohrhuber, ~2002) made rewriting
  running code a performance act.

The project owner performed in ~2002 with Image/ine on one machine and
SuperCollider on another — multiple code snippets resident simultaneously, each
with its own fader. Nothing broke. The two machines were a CPU constraint, and the
performer was the only link between the domains.

**That is the design brief: keep the performer as the link, and let the runtime be
a second one.**

### Sources

- `https://steim.org/rosa/` — live as of 2026-08-12. RoSa v2, free engine, and an
  **Implementation manual** documenting the OSC vocabulary for building your own
  client. **Get this before designing the protocol.** Baldé had already solved
  "what is the minimum set of commands that makes a live sampler playable."
- `https://steim.org/software/LiSa/Manual/LiSa%202.56%20OS%209%20Manual.pdf` — live.
- `archive.steim.org` — returned HTTP 502 on 2026-08-12. STEIM dissolved end of 2020
  after Dutch cultural funding cuts; nothing is maintained. Mirror what you need.

---

## 3. The novelty claim

**Claim the coupling, not the components.**

Sound-as-image is old and deep — McLaren's drawn sound, the ANS synthesizer,
Xenakis's UPIC (1977), Metasynth (1998). Corpus-based concatenative synthesis is
CataRT (Schwarz, IRCAM, mid-2000s) and its descendants. Neither is new.

What is new is **one gesture that is simultaneously a video warp and an audio
navigation**, in one runtime, live, on an instrument whose drawing surface already
exists. Nobody has that, because nobody had both domains in one process with a real
drawing instrument already built.

Overclaiming the components weakens a claim that is defensible as stated.

---

## 4. Architecture

### 4.1 Engine and interface

The AudioWorklet is the **server**. ParameterSystem is the **client**. They
communicate by message protocol only.

- **The engine must have zero ImWeb imports.** Test: *could you delete every line of
  ImWeb UI and still drive a working sound engine from a script?* If `ps.get()`
  appears inside the worklet, the boundary is fake.
- The protocol is **transport-agnostic**. Local message port today; a WebSocket or
  WebRTC data channel later is a transport swap, not a rewrite. That keeps the 2002
  two-machine setup available as a *deployment mode* — for large installations, or
  so a WebGL context loss cannot take the sound down mid-set.
- **Message port, not `SharedArrayBuffer`.** The worklet owns the tape exclusively;
  nothing else touches it. Per-frame traffic is the envelope (§4.2), ~16 KB, which
  `postMessage` carries without strain. One-off transfers — a spectral render in, a
  tape dump out for saving — use transferables at zero copy.
  This is not a compromise, it is the better design: it avoids COOP/COEP
  cross-origin isolation, under which *every* cross-origin resource must opt in via
  CORP or fail to load — a real load-in hazard for an instrument that loads media
  and is hosted on someone else's domain. It also makes the tearing and
  synchronisation problem of concurrent buffer access **stop existing** rather than
  needing to be managed.
- Adopt RoSa's protocol *shape* (buffer, zones, zone types, OSC-style addresses)
  rather than inventing one.

AudioWorklet runs on its own thread. Heavy shader passes do not consume its budget,
and heavy DSP does not consume the frame budget. Reasoning that conflates the two
is wrong.

### 4.2 The tape

**One buffer. Time-domain waveform. Never spectral.**

Rationale: arbitrary-rate, reversible, skipping playhead reads must be index
arithmetic on a float array and nothing else. That *is* the LiSa paradigm, and any
design that makes scrubbing expensive has already killed the instrument. A spectral
tape would require phase-vocoder resynthesis on every read — smearing transients,
adding latency, and trading the tactile immediacy that is the entire point.

It also gives amplitude→geometry coupling for free, which is the authentic
Rutt-Etra / Paik-Abe / Vasulka relationship: raw signal to raster displacement.

**Budget.** Stereo float32 at 48 kHz costs ~0.375 MB/s — roughly 23 MB for 60 s,
115 MB for 5 min, 230 MB for 10 min. Default 60 s, user-settable, sized by assigned
memory in RoSa's manner rather than fixed as an architectural constant.

### Two representations

"Video displaces from the tape" is not literally true and must not be implemented
that way — 23 MB cannot be uploaded to a texture every frame.

| | owner | size | role |
|---|---|---|---|
| **Tape** | audio worklet, exclusively | tens of MB | audio truth |
| **Envelope** | main thread, rebuilt from messages | ~16 KB | the video view |

The envelope is a downsampled min/max summary, one column per screen pixel — the
standard waveform-display representation — regenerated incrementally for dirty
regions only. It is what makes the whole-session landscape affordable, and it is
what makes the message-port transport (§4.1) sufficient.

### 4.3 Partitions

**One allocation, fixed indexed partition slots, bounds-checked, opt-in `unsafe`
flag.**

Zones belong to a partition and are clamped to its bounds.

Three rules that travel together:

- **Partitions are fixed slots addressed by index**, in RoSa's manner (it fixed 128
  zones per type). Names are labels only. If partitions were a user-created,
  user-named list, a captured index would mean a *different* partition on another
  machine — precisely the `displace.warpSlot` and `glsl.preset` failure. Fixed slots
  make the index safe and keep layout capturable (§4.8).
- **Zone positions are partition-relative**, never absolute. This is what lets a
  layout differ between machines without every zone landing in the wrong material,
  and it is the same choice that makes save work.
- **Layout is fixed at session start; contents are freely mutable.** Changing what is
  *inside* a partition is the instrument. Changing the *set* of partitions and their
  bounds is a setup act — LiSa and RoSa both sized at startup — and mid-set resizing
  would mean relocating live material for a gesture nobody performs. Clearing and
  reassigning need no relayout and stay live.

A partition may be configured as a **ring** — always recording the last N seconds.
That gives the capture-what-just-happened gesture without the whole tape shifting
under everything else, so rolling versus static is not a choice to make: a rolling
partition sits beside static ones holding committed material.

Why one allocation rather than several tapes: because video displaces from the
whole tape, a single buffer means **the entire session is one visible landscape** —
camera capture, drawn spectra and synth renders all adjacent as continuous terrain.
That image is the artistically distinctive thing here and it is not obtainable any
other way. It also keeps memory a single number, save a single blob, and position
parameters a single coordinate system, with no per-coupling tape selector.

Why bounds-checked: the one failure mode in a shared buffer that *ruins a
performance* rather than merely sounding wrong is a recording zone with wrong bounds
overwriting material you are currently playing — silent until it is loud.

Why an unsafe flag rather than no crossing: a playback zone reading across the seam
between a drawn spectral render and a live recording produces material nobody
composed. That accident is productive. The flag makes it **opt-in** — the best
accident becomes a feature, the worst failure becomes something you have to ask for.

Accepted costs: one sample rate and channel count throughout; unsafe cross-partition
zones need absolute coordinates by definition, so they are the one thing that cannot
survive a relayout — which is fine, unsafe means unsafe; and "partition" is a concept
neither RoSa nor SC had, so there is no prior art to crib ergonomics from.

### 4.4 Zones and Voices

**Rule: anything with a buffer region is a Zone. Anything without is a Voice.**

Zones are *region plus role*, not voices in the synthesiser sense. Writers and
readers are the same kind of object differing only in the direction of data flow —
the same principle as mix buses being real graph nodes rather than hardwired
crossfaders.

| Kind | Class | Fills / reads a region by |
|---|---|---|
| Recording Zone | realtime writer | capturing a live signal at 1× |
| Load Zone | render writer | loading a sound file, on the fly |
| Spectral Zone | render writer | inverse-transforming a painted/imported spectrum |
| Synth Zone | render writer | evaluating code, potentially faster than realtime |
| Playback Zone | reader | forwards, backwards, spiralling, skipping |
| **Voice** | **neither** | live code straight to output; touches no region |

**Render writers are the genuinely new capability.** A Synth Zone can produce ten
seconds of material in a fraction of a second; you then scrub it. Write a snippet,
render it, immediately play it backwards. SuperCollider in 2002 could not do this —
it could only play forward at 1×, because its output was a signal, not material.

This is also where AI stops being decorative: a generated snippet becomes *playable
material* in under a second. The authoring latency, not the generation quality, was
always what kept it out of performance.

**Voices reach the tape through the existing Recording Zone.** Do not build a
bridging mechanism. A Recording Zone captures a live signal; a Voice *is* a live
signal. In this instrument your own synthesis is just another thing in the world you
can sample.

**One snippet, two destinations, switchable live.** A snippet is a program with a
routing choice, not two kinds of program. Running a Voice and committing — rendering
the next four seconds into a partition — is *freezing*, and it is a real
instrumental move.

How a snippet is authored, and why the worklet never sees text: §4.9.

### 4.5 The spectrogram is a writer, not the tape

Painted or imported frequency-time image → **inverse-transformed once, at write
time** → ordinary waveform in a partition, scrubbed freely forever after. There is
**no transform in the realtime read path**.

- The vertical axis is **quantized to a musical scale**. This is not decoration.
  Continuous vertical mapping yields noise; scale quantization is precisely what made
  Metasynth and UPIC feel like instruments rather than curiosities.
- Because the transform is a write-time render, cost arguments against it do not
  apply. (For the record they were weak anyway: a 2048-point FFT costs tens of
  microseconds, and in a spectral design voices sum into one frame before a single
  inverse transform — the cost is O(1) in voice count, not O(N).)
- The video side may render a spectrogram **view** of the tape for the drawing
  surface. A view is cheap and non-authoritative; nothing plays from it.

### 4.6 Corpus synthesis is an index, not a buffer

A background analysis extracts descriptors (brightness, noisiness, pitch, loudness)
from the tape and plots grains in a 2D feature space. Navigating that space yields
**timestamps into the waveform**, which trigger playback. The corpus is a map; the
tape is the territory.

This is synthetic control over sampled material — the category that appeared just
after 2002 and made the synthetic-vs-sampled opposition obsolete. It lands here
because **navigating a 2D descriptor space is a drawing gesture**, and the draw
surface, pointer/pressure handling and stroke looper already exist.

> **Descriptor space is not the image plane.** Position (0.3, 0.7) in descriptor
> space means "bright and noisy." It has no spatial relationship to the pixel at
> (0.3, 0.7) on the canvas. Wiring one pointer coordinate to both is a coincidence,
> not a coupling, and would take a long time to make feel non-arbitrary. These are
> two instruments sharing a surface, deliberately.

### 4.7 Cross-modal coupling

- **Coupling depth is a fader**, per coupling. Not chaos by default.
- Rationale: the 2002 rig sounded good because of faders on running snippets. An
  instrument where every gesture does three coupled things is spectacular for ninety
  seconds and un-rehearsable for a set — you cannot build a phrase whose second half
  you cannot predict.
- Asymmetry to design with, not around: video forgives tearing and discontinuity (an
  artifact); audio does not (clicks, DC offset, runaway — in a room, on monitors,
  near ears). Audio→video is nearly free; video→audio costs a GPU readback, fine at
  control rate, painful at sample rate.
- **The tape is what is seen; Voices are what is unseen.** Committed material is
  visible terrain, live voices are audible but invisible until frozen. This fell out
  of the architecture rather than being imposed on it.
- **Couplings should be first-class** — nameable, saveable, morphable, fadeable.
  Display States capture constellations of *values*; a coupling is a *relationship*.
  Making relationships playable is a thing neither STEIM nor SC could do, because
  neither had both domains in one runtime.

Division of labour: **the performer keeps timing, intensity, and which couplings are
true right now. The machine holds more relationships live than a person can.**

### 4.8 Capture and save

Display State capture is **opt-out, not opt-in** — `ParameterSystem.js:781` captures
every parameter whose group is not `'global'`. Any parameter added without thinking
about this is therefore captured by default.

| Thing | Decision | Why |
|---|---|---|
| Partition layout | captured, normal group | structural; means the same thing on any machine |
| Zone positions | captured, partition-relative | relative positions survive layout differences |
| Zone → partition binding | captured, **by index** | safe only because slots are fixed (§4.3) |
| Zone/Voice levels, coupling faders | captured | this is performance state |
| Snippet selection | **`group: 'global'`** | snippets live in per-origin localStorage, so an index drifts across ports and machines — the exact `glsl.preset` precedent |
| Tape contents | **not a parameter at all** | tens of MB; belongs in the `.imweb` payload or nowhere |

Structural consequence: a captured state that references tape material assumes that
material is loaded. Same class as `warpSlot`. **States capture structure and
settings; tape audio rides in the `.imweb` file as an explicit, opt-in payload** — it
is far too large to be the default.

Run the `state-capture-auditor` agent before any of this ships. This is the bug class
that fails silently on reload, on another machine, and on another origin.

### 4.9 Voice authoring — the worklet executes graphs, never text

**Text → graph on the client. Graph → message → executed by the worklet.**

This is the one structural decision in Voice authoring. Everything else can arrive
later; this cannot be retrofitted.

#### Why the GLSL safety model does not transfer

**There is no watchdog on the audio thread.** The last-good-compile fallback protects
against *syntax* errors, and both failure modes that actually matter here compile
fine:

- An **infinite loop** in `process()` kills the audio thread permanently — not a
  glitch, but silence for the rest of the set, unrecoverable without a reload.
- An **allocation in the inner loop** — one array literal, one string concat — puts
  GC on the audio thread. This is the real source of granular crackle, and it is
  invisible until it is loud.

On the video side neither matters: a pathological shader is killed by the driver
watchdog and costs a frame. There is no audio equivalent. Any design that evaluates
user text inside the worklet inherits a hazard with no counterpart in the half of
the instrument that already exists.

Mechanically, `addModule()` is also one-way — registered processors cannot be
unregistered, so compiling each snippet edit into a new processor accumulates across
a set. That route is unavailable for live coding regardless of the safety argument.

#### The SuperCollider precedent

**SuperCollider does not run user code in the audio thread.** sclang evaluates on the
language side and what evaluation *produces* is a SynthDef — a graph of unit
generators. That graph goes to scsynth, which executes pre-compiled UGens. User code
runs once, at graph-build time, never per sample.

That is why SC survives three hours of live coding. The safety is not bolted on; it
falls out of the same client-server split already committed to in §4.1.

#### What this buys

- **The editor is CodeMirror, reused**, with the same last-good-compile discipline.
  Evaluating text is a main-thread act: it may be slow, it may throw, it may loop
  forever, and it hangs only the UI.
- **The fallback becomes total rather than partial.** Bad text never reaches the audio
  thread at all; the previous graph keeps running. Strictly stronger than the GLSL
  case.
- **Cost is predictable.** A graph's per-sample cost is known before it runs, so the
  instrument can *refuse* to fade in a snippet that would blow the budget, instead of
  dropping out mid-phrase.
- **Both destinations fall out.** A graph has no notion of realtime: drive it at 1×
  to the output and it is a Voice; drive it as fast as possible into a partition and
  it is a Synth Zone (§4.4).
- **It answers part of the protocol question.** A graph is exactly what the message
  vocabulary should carry — text in, graph across, execute there.

#### Honest costs

Defining the UGen set is the real work, and it is where the sound actually lives — a
mediocre oscillator and filter set will sound mediocre under any architecture. Graphs
are awkward for sample-accurate feedback, conditional structure and recursion; SC has
exactly this awkwardness and it would be inherited. And even a small language is a
project; a bad one is worse than raw JS.

An escape hatch is possible — a `Custom` node taking a bounded, loop-free expression
compiled to a closure — but leave it out initially. SC users live inside UGens
without experiencing it as a cage.

#### Sequencing

**Voices do not need text authoring on day one, and arguably should not have it.**

The zone model is already an instrument with no user code: recording, load, spectral
render, playback with direction and skip patterns, corpus navigation by drawing. Add
a small fixed set of parameterized generators — noise, an oscillator bank, a granular
reader — exposed as ordinary parameters, and every existing controller (LFO, random
with slew, MIDI, response tables, device motion) drives them for free.

That yields a playable instrument, and it reveals which UGens are actually reached
for before a language is designed around guesses.

---

## 5. Rejected paths

Recorded so they are not rediscovered.

| Rejected | Why |
|---|---|
| Audio as a separate application | Forfeits ParameterSystem, controllers, response tables, MIDI mapping, Display States and one-document save — all of which already exist and are not worth rebuilding. |
| Spectral tape | Kills scrubbing. Phase-vocoder reads smear transients and add latency; tactile immediacy is the instrument. |
| Image read as raw waveform | Broadband noise with strong DC and a discontinuity at every row boundary. It is the same buzz regardless of the image. Rejected on sound quality, not performance. |
| Separate tapes per material type | Fragments the landscape, adds a tape selector to every coupling, and creates a new resolution fixpoint of exactly the kind that has already accreted near-duplicates elsewhere in this codebase. |
| "Raw chaotic flexibility" as a design goal | Chaos is easy and is not what made the 2002 setup sound good. Faders did. |
| Granular as a separate engine | It is a read pattern over a short zone — one member of the "forwards, backwards, spiralling, skipping" family, not a second subsystem. |
| ImWeb as a client of the real RoSa | Viable as a *prototype* to validate mappings without writing DSP. Rejected as a foundation: an unmaintained Intel-Mac binary from a dissolved foundation, and it reintroduces every cross-process problem the browser had already solved. |
| `SharedArrayBuffer` for the tape | Solved a problem the envelope representation (§4.2) eliminates. Costs COOP/COEP cross-origin isolation, under which every cross-origin resource must opt in via CORP or fail to load, and reintroduces concurrent-access tearing that exclusive worklet ownership avoids entirely. |
| User-created, user-named partitions | A captured index would resolve to a different partition on another machine — the `warpSlot` / `glsl.preset` failure. Fixed indexed slots, names as labels. |
| Mid-set partition resizing | Relocates live material for a gesture nobody performs. Clearing and reassigning cover the real need and need no relayout. |
| Choosing rolling *or* static tape | False choice. A ring-configured partition sits beside static ones. |
| User text evaluated inside the worklet | No watchdog on the audio thread. An infinite loop is silence for the rest of the set; an inner-loop allocation is GC crackle. Both compile cleanly, so the last-good-compile fallback does not catch either. See §4.9. |
| `addModule()` per snippet edit | Registered processors cannot be unregistered; definitions accumulate across a set. |
| Text authoring for Voices in the first pass | The zone model plus a few parameterized generators is already playable. Designing a UGen set before knowing which ones get reached for is designing around guesses. |

---

## 6. Open questions

The four questions this document opened on 2026-08-12 were resolved the same day and
have moved into the sections above: partition mutability → §4.3, tape duration →
§4.2, transport → §4.1, capture and save → §4.8. Two of them changed the design
rather than merely settling it — the envelope representation removed the case for
`SharedArrayBuffer` entirely, and fixed indexed partition slots replaced the
user-named list.

Voice authoring, opened and resolved the same day, moved to §4.9 — the worklet
executes graphs and never sees text, because the audio thread has no watchdog and the
last-good-compile fallback cannot catch an infinite loop or an inner-loop allocation.

What genuinely remains, none of it blocking, all still at the prose stage:

1. **The UGen set** — the real work, and where the sound actually lives (§4.9). To be
   derived from which generators get reached for in the pre-text instrument, not
   designed up front.
2. **Sample rate and channel count.** One of each throughout (§4.3). Device output
   rate varies; committing to a fixed internal rate means resampling at the edges.
3. **How many partition slots**, and how many zones per type. RoSa's answer was 128
   zones per type; the partition count has no precedent.
4. **Which descriptors** the corpus index extracts, and whether its 2D navigation
   surface is the existing draw surface or a separate one. They are deliberately two
   instruments sharing a gesture (§4.6); whether they share a *widget* is a UI
   question, not an architectural one.
5. **The protocol vocabulary itself** — pending the RoSa v2 Implementation manual
   (§2). Do not invent one before reading it. Note that §4.9 already fixes part of
   its shape: graphs travel over it.

---

## 7. Non-goals

Waveform editing. A timeline. Arrangement. A mixer. Plugin hosting. Undo.

LiSa refused all of these, and the refusal is what made it an instrument. If a
region editor starts appearing, the design has drifted into a DAW and the argument
for living inside ImWeb collapses.
