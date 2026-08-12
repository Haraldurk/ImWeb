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
exists. Max/MSP/Jitter has had both domains in one runtime for two decades, with
drawing surfaces — the claim is not "both domains in one process". It is this
particular coupling: one gesture acting on a LiSa-lineage tape and on the picture at
once, on an instrument whose drawing surface, stroke looper and controller layer
already exist and are already played.

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
regions only. The ~16 KB figure is ~2K columns × min/max × float32. It is what makes the whole-session landscape affordable, and it is
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

Display State capture is **opt-out, not opt-in** — `src/controls/ParameterSystem.js:781` captures
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

**Snippet text has the same exposure as snippet selection, and the same answer.**
Marking the *selection* `group: 'global'` keeps a drifting index out of Display
States, but it leaves the code itself origin-bound — a state portable in structure
whose sound-generating text lives only in one browser's localStorage. The precedent
is already in the project and is not the one this section started from: warp slot
*contents* ride in the `.imweb` file (`src/io/ProjectFile.js:72` reads
`localStorage['imweb-warpmaps']` into the project) while the slot *index* stays out
of capture. Snippet texts should travel the same way, as GLSL user presets do.

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
- **Cost is predictable** for a fixed-topology graph — which the phase-one set is.
  A graph whose structure varies at runtime would need a bound rather than a figure.
  A graph's per-sample cost is known before it runs, so the
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

### 4.10 The generator set — phase one

The full UGen set stays deferred per §4.9. What follows is the small fixed set the
pre-text instrument needs, **recorded as a starting hypothesis, not a specification**
— the entire point of the sequencing above is that real use revises it.

#### The dividing rule

**Do not rebuild in UGens what the controller layer already does.** LFOs,
random-with-slew, seven slew curves, response tables, MIDI and device motion are
already mapped to every parameter; a control-rate LFO UGen is a duplicate with worse
ergonomics.

- **Control-rate modulation → ParameterSystem.** Already exists.
- **Audio-rate modulation → UGens.** FM, AM, ring mod cannot come from frame-rate
  parameters. That is the *only* reason they need to be UGens.

> **Hazard attached to that rule.** ParameterSystem ticks from `requestAnimationFrame`.
> A hidden tab suspends rAF and does **not** suspend the AudioWorklet. LEARNED.md
> already records this trap for video, where it means a frozen picture and void
> observations. Here it is worse: the sound keeps playing while every modulation
> freezes. Unresolved — see §6.

#### Quality lives in the tape reader, not the generator count

In a LiSa-lineage instrument the tape reader runs constantly and the oscillators run
occasionally. Two things decide how it sounds, and effort belongs here before it
goes anywhere else:

1. **Interpolation.** Reading between samples at arbitrary rates with linear
   interpolation sounds dull and grainy. Cubic/Hermite is the standard fix and costs
   almost nothing. Highest-value single decision in the set.
2. **Rate-dependent anti-aliasing.** Reading *faster* than 1× shifts content upward,
   and anything crossing Nyquist folds back. This is the classic sampler problem, and
   because this instrument is built on arbitrary-rate scrubbing it is the main path,
   not an edge case. Mip-mapped buffer copies or a rate-tracking lowpass before the
   read.

Get those right and a plain sine sounds good. Get them wrong and no UGen set rescues
it. Oscillators have the same issue in their own form — a naive saw or pulse aliases
badly up high; PolyBLEP is the cheap standard answer.

#### The set

| UGen | Why it earns a slot |
|---|---|
| **Tape reader** | The instrument. Cubic interpolation, rate-aware anti-aliasing. |
| **Noise** | Raw material for the spectral and warp treatments; fastest way to test the whole chain. One colour parameter. |
| **Oscillator** | Waveform select plus a **phase input** — the phase input is what makes FM and phase distortion free instead of needing their own UGens. |
| **State-variable filter** | One structure yields LP/BP/HP/notch with a morphable type. Worth ten mediocre oscillators. |
| **Saturator** | Digital sums are brittle without one. Cheap, and it is most of what "warmth" means. |
| **Gain / mix** | Unglamorous, required. |

**Deliberately absent: envelope generators.** SC needs them because it is note-based.
This instrument has no note-on — the envelope is a hand on a fader or slew on a
parameter, both of which already exist. A real structural difference from SC, and one
not to import out of habit.

**Also not built here: reverb, delay, chorus, compression.** Those are downstream
effects, not voice components, and the instrument already has a pass architecture for
them. If they belong anywhere it is there, and after the tape reader has been heard
unadorned.

### 4.11 The output bus — limiting and de-clicking

Two things §4.7 implies and never assigns. Both are cheap now and painful to
retrofit.

**A master limiter is not a detail here, it is load-bearing.** §4.7 names runaway as
the audio failure that ruins a performance, §8.1 establishes that
`mic → tape → monitors → mic` is the instrument's default state, and §4.10 puts a
saturator in the *per-voice* set with nothing at the output. A feedback instrument
without an output ceiling is one dialled coupling away from damaging monitors and
ears in a room. **A hard ceiling and limiter sit at the output bus, after everything,
and are not bypassable** — not by `effect.enable`, not by a Display State, not by a
loaded project. The one control that must never be a controller target.

**De-clicking belongs to the worklet, not the protocol.** Parameter changes arrive at
control rate as messages; playback rate, zone bounds and levels all produce
discontinuities if applied instantly, and §4.7's asymmetry is that audio does not
forgive them. Smoothing them in the protocol would mean the transport carrying
per-sample detail, which defeats §4.1. So **every zone and voice parameter is slewed
inside the worklet at audio rate**, on arrival. The protocol carries targets; the
worklet decides how it gets there. This is deliberately *not* the ParameterSystem
slew of §4.10 — that runs at frame rate on the client and cannot prevent a
per-sample discontinuity.

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

What genuinely remains. **The first item IS blocking** — an earlier version of this
list said nothing here was, which was wrong once §8.1 landed:

0. **The monitoring path, and everything in §8.1.** A Recording Zone capturing the
   mic while a Voice plays to the monitors makes `mic → tape → monitors → mic` the
   *default* state of the instrument. One `AudioContext` or two, whether the
   sound-reactive controller layer hears the instrument's own output, and what the
   monitoring discipline is — these outrank every question below, because by §4.7's
   own test they are the class that ruins a performance rather than merely sounding
   wrong. Nothing should be built until they are answered.
1. **The UGen set beyond phase one.** §4.10 records the six-item starting hypothesis
   and where quality actually lives; the set beyond it is still to be derived from
   what gets reached for, not designed up front.
2. **What clocks audio-relevant parameters.** ParameterSystem ticks from rAF, which a
   hidden tab suspends while the worklet keeps running — sound continues, modulation
   freezes (§4.10). Either minimal LFO/envelope UGens run in the worklet, accepting
   the duplication, or the parameter tick is driven from the audio clock when audio
   is active. The latter is better architecturally — the audio thread never suspends
   and is sample-accurate — but it changes how ParameterSystem ticks, which is not a
   small claim.
3. **Sample rate and channel count.** One of each throughout (§4.3). Device output
   rate varies; committing to a fixed internal rate means resampling at the edges.
4. **How many partition slots**, and how many zones per type. RoSa's answer was 128
   zones per type; the partition count has no precedent.
5. **Which descriptors** the corpus index extracts, and whether its 2D navigation
   surface is the existing draw surface or a separate one. They are deliberately two
   instruments sharing a gesture (§4.6); whether they share a *widget* is a UI
   question, not an architectural one.
6. **The protocol vocabulary itself** — pending the RoSa v2 Implementation manual
   (§2). Do not invent one before reading it. Note that §4.9 already fixes part of
   its shape: graphs travel over it. Two more items belong in it: how the envelope
   (§4.2) is refetched on zoom or resize — resampling a fixed-resolution min/max view
   is lossy, so a zoomed view probably has to ask the worklet for that span — and how
   a render writer reports progress while chunking across quanta (§8.3).
7. **Freeze continuity.** §4.4 makes freezing a running Voice into a partition an
   instrumental move, and §8.3 makes the render chunked. So while the graph renders
   across quanta, does the live Voice keep sounding from its own state, and are the
   two phases the same performance? Musically this is the whole point — you freeze
   *this* moment, not a re-rendered one — and the answer is not obvious.

---

## 7. Non-goals

Waveform editing. A timeline. Arrangement. A mixer. Plugin hosting. Undo.

LiSa refused all of these, and the refusal is what made it an instrument. If a
region editor starts appearing, the design has drifted into a DAW and the argument
for living inside ImWeb collapses.


---

## 8. Corrections from review (2026-08-12)

Findings from a review of §1–§7, verified against the codebase before being
recorded here. None require redesign. §8.1–§8.4 are things §4 asserts or assumes that
are wrong or incomplete; §8.5 records claims that did not survive checking.

### 8.1 The audio field is not green — and the mic closes a feedback loop

§1–§7 are written as though audio is unbuilt. It is not. There is already:

- a **live mic input path** — `ControllerManager.enableSound()`
  (`src/controls/ControllerManager.js:862`) opens an `AudioContext`, takes
  `getUserMedia({ audio: true })`, and runs a 512-point analyser (256 bins)
- **`BeatDetector`** (`src/controls/BeatDetector.js`), fed from that analyser
- **`tAudio`** — a 256×2 texture exposed to Live GLSL (`src/main.js:5008`),
  y<0.5 FFT bins, y>0.5 waveform

So the engine arrives into an app that already listens.

**The consequence the rest of this document should have caught: the moment a
Recording Zone captures the mic while a Voice plays to the monitors, the default
state of the instrument is mic → tape → monitors → mic.** That is acoustic
feedback with a tape delay in it, and by §4.7's own test it belongs to the class
that ruins a performance rather than merely sounding wrong. It cannot be left to
be discovered at load-in.

Three things follow, none of them decided yet:

- **One `AudioContext` or two.** The controller path creates its own. A second
  context for the engine means two clocks and no sample-accurate relationship
  between what the instrument hears and what it plays.
- **Does the sound-reactive controller layer hear the instrument's own output?**
  If yes, every audio-driven video parameter becomes part of the feedback path.
  If no, the two halves are deaf to each other, which is a strange thing for a
  coupling instrument.
- **Monitoring discipline.** Some combination of an input-mute-while-armed rule,
  an explicit output-to-input tap rather than an ambient one, and a visible
  indication of when the loop is closed.

Also to state as a boot step: an `AudioContext` starts suspended and must be
resumed from a user gesture. The engine has to survive being constructed before
that gesture arrives.

### 8.2 Tape contents do not belong in `.imweb`

§4.8 says tape audio can ride in the `.imweb` file as an opt-in payload. That
contradicts the precedent already set in `src/io/ProjectFile.js`, which
deliberately keeps large binary out: full-res stills are excluded with the
comment *"too large (>100MB)"*, and timewarp strips are written to **IndexedDB**
instead.

`.imweb` is pretty-printed JSON. Sixty seconds of stereo float32 tape is ~23 MB
raw, roughly **31 MB base64** once encoded, inside indented JSON.

Portability may still justify an export that carries audio, but it should be an
explicit override of an existing project decision rather than an unnoticed
contradiction of it — and it should be a binary container, not base64 in JSON.
The default should follow the strips: IndexedDB, with the project file holding a
reference.

### 8.3 "Faster than realtime" has to be chunked

§4.4 says a Synth Zone can render ten seconds of material "in a fraction of a
second". True in aggregate, misleading in scheduling: a worklet processes 128
samples per quantum, about **2.67 ms at 48 kHz**, and a render writer cannot
block one without dropping live audio.

Render writers must therefore fill spare budget **across** quanta — render a
slice, yield, resume — with the zone unreadable until complete, or readable
progressively if that turns out to be musically useful. Implementable, but it is
the one realtime-scheduling detail in the design and §4.4's phrasing hides it.

### 8.4 The rAF-tick hazard is worse than "hidden tabs"

§4.10 and §6 record that a hidden tab suspends rAF while the worklet keeps
running. The sharper statement: **even in a healthy foreground tab, every
parameter-driven modulation carries up to a frame plus a quantum of jitter**, so
§3's "one gesture that is simultaneously a video warp and an audio navigation"
should expect a few milliseconds of audio-to-video skew by construction.

That raises the priority of the fix already named in §6 item 2. Driving the
parameter tick from the audio clock is not just hidden-tab insurance — it is
what makes the coupling sample-accurate rather than frame-accurate, which is the
difference between the two halves being in time and merely being close.

### 8.5 Checked and not adopted

- **"OSC is unwired."** It is not. `OSCBridge` is imported at `src/main.js:111`
  and instantiated at `src/main.js:2444` as `new OSCBridge(ps, presetMgr)`.
  Whether it is *useful* without a relay running is a separate question, and the
  controller list marking OSC "Planned" may reflect that — but the transport
  named in §4.1 is not vapour.
- **"128 partitions is too many."** §6 item 3 already leaves the partition count
  open and notes that RoSa's 128 was *zones per type*, not partitions. 16–32 is a
  plausible answer to that open question rather than a correction to a claim this
  document makes.
