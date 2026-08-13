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

0. **ANSWERED in §8.6 — the monitoring path, and everything in §8.1.** A Recording Zone capturing the
   mic while a Voice plays to the monitors makes `mic → tape → monitors → mic` the
   *default* state of the instrument. One `AudioContext` or two, whether the
   sound-reactive controller layer hears the instrument's own output, and what the
   monitoring discipline is — these outrank every question below, because by §4.7's
   own test they are the class that ruins a performance rather than merely sounding
   wrong. §8.6 settles all three: one AudioContext owned by the engine, a routable
   analyser tap over *signals* (mic / master out / zone outputs — never a partition,
   which is storage), and the loop drawn in the signal path display. It also narrows
   what this blocks: the recording path and the engine's construction shape, not the
   DSP — tape, playback, spectral writer and corpus index are all buildable deaf.
1. **The UGen set beyond phase one.** §4.10 records the six-item starting hypothesis
   and where quality actually lives; the set beyond it is still to be derived from
   what gets reached for, not designed up front.
2. **ANSWERED in §8.7 — what clocks audio-relevant parameters.** ParameterSystem
   ticks from rAF, which a hidden tab suspends while the worklet keeps running —
   sound continues, modulation freezes (§4.10). **Answered by neither of the two
   options originally listed here.** Running worklet-side LFO/envelope UGens
   duplicates the controller layer, and driving the tick from the audio clock leaves
   the freeze intact because evaluation still happens on a throttled thread. §8.7
   takes the third option: the client describes the controller, the worklet evaluates
   it, and for controllers feeding audio the worklet is authoritative and echoes
   values back.
3. **Sample rate and channel count.** One of each throughout (§4.3). Device output
   rate varies; committing to a fixed internal rate means resampling at the edges.
4. **How many partition slots**, and how many zones per type. RoSa's answer was 128
   zones per type; the partition count has no precedent.
5. **Which descriptors** the corpus index extracts, and whether its 2D navigation
   surface is the existing draw surface or a separate one. They are deliberately two
   instruments sharing a gesture (§4.6); whether they share a *widget* is a UI
   question, not an architectural one.
6. **ANSWERED in §8.8 — the protocol vocabulary itself.** This item said "pending the
   RoSa v2 Implementation manual (§2); do not invent one before reading it." **That
   precondition cannot be met and the item is unblocked by its own impossibility** —
   the manual only ever shipped inside `RoSa v2.zip`, which is gone from steim.org
   and whose single Internet Archive capture (2015-09-20) is a 408 with no body. See
   §8.8's preamble. The waiting was also worth less than it looked: §4.1 asked for
   RoSa's protocol *shape* — buffer, zones, zone types, OSC-style addresses — and
   that shape is stated on RoSa's own public page, which is where the manual would
   have added detail rather than direction. §8.8 drafts the vocabulary, including the
   two items this entry named: envelope refetch on zoom or resize, and render-writer
   progress across quanta (§8.3).
7. **ANSWERED in §8.9 — freeze continuity.** Freezing is a **fork, not a capture**:
   the Voice's state is snapshotted, the render runs forward from that snapshot
   while the live Voice continues from the same instant, uninterrupted. The two
   are the same performance in the only sense available — a shared origin — and
   diverge only where the graph is nondeterministic. §8.9 draws out the three
   consequences, two of which constrain work not yet started: every UGen needs
   copyable state (item 1), the RNG must be explicit and splittable, and
   controller state advances in the render's *virtual* clock.

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

### 8.6 Item 0 answered — the monitoring path

§6 item 0 was the one blocking question. These are its answers, arrived at in
discussion and reviewed against the code before being recorded.

**One `AudioContext`, owned by the engine.** Two contexts mean two clocks, so the
relationship between what the instrument hears and what it plays drifts — and §3's
coupling claim dies with it. `ControllerManager.enableSound()`
(`src/controls/ControllerManager.js:862`) currently constructs its own and becomes a
*consumer* of the engine's instead.

State the cost rather than let it be discovered: **the audio half is not purely
additive.** It reaches back into shipped code.

It also takes on the context's lifecycle. A context starts suspended and must be
resumed from a user gesture (§8.1); `enableSound()` works today only because it is
itself called from a user act — the first sound-controller assignment. Once the
engine owns construction, the boot sequence has to survive *engine constructed
before any gesture, `ControllerManager` handed a context that exists but is
suspended*. A boot-ordering detail, not a threat to the decision.

**The analyser input is a routable source — of signals, not storage.** Mic-only
deafens the instrument to itself, which is a poor trade for an AV instrument whose
whole claim is coupling; output-only deafens it to the room. So it is selected, in
the grammar the project already speaks: free `srcA`/`srcB` on the mix buses,
`_resolveSource()` in `Pipeline.js`, `_resolveLayerTex()` in `main.js:3831`.

> **Correction to an earlier phrasing of this idea, which said "mic, output bus, or a
> specific partition".** That mixes two categories. **A partition is a region of tape
> — storage. Nothing flows out of it until a Playback Zone reads it.** You cannot tap
> a partition; you tap a zone's output. Per §4.4, zones are region-plus-role and it is
> the *readers* that produce signal. The tap list is therefore **mic / master out /
> zone or voice outputs** — equally enumerable, and it stays in the signal domain,
> which is what keeps it consistent with `srcA`/`srcB` selecting things that produce
> frames rather than buffers that store them.

Three consequences:

- **The master tap is post-limiter**, chosen rather than inherited. The video
  response then visibly flattens when the ceiling of §4.11 engages — the picture
  tells you the limiter is working, which is a feature in a feedback instrument.
- **The default is mic-only**, so the safe state requires no selection.
- **Tap selection is capturable as a normal group.** It is an enumerated fixed set,
  not a user-editable list, so it does not inherit the snippet-index portability
  problem of §4.8.

**Monitoring discipline: draw the loop.** Of the available mitigations this is the
one worth building, because it is the only one that turns the hazard into an object
the performer can reason about, and it reuses a surface that already exists — the
signal path display. With the audio graph in it, a closed `mic → tape → monitors →
mic` path is something you can *see* rather than something you discover at volume.

Alongside it: Recording Zone input is a *selected* source rather than implicitly the
mic, so recording the room is a deliberate act; and the non-bypassable output limiter
of §4.11 bounds what a loop can do.

**The headphones/speakers monitoring mode is a setup act, not performance state.**
In §4.3's sense it belongs with partition layout: fixed at session start, excluded
from Display State capture, and **never a controller target**. Written down
explicitly because "a switch that changes defaults" is exactly the kind of control
that drifts into being controller-assignable when nobody records that it must not
be — and the thing it changes is the performer's feedback exposure.

**What item 0 actually blocks.** An earlier wording said nothing should be built
until these were answered. Too strong: the tape, playback zones, the spectral writer
and the corpus index are all buildable deaf, and the loop only closes when a
Recording Zone meets a live input. But the narrower wording must not create a new
trap — the one-context decision constrains the engine's **construction shape** from
day one, because the engine has to be written as the context owner before the
`ControllerManager` rewiring lands. So item 0 blocks the recording path and the
engine's boot structure. It does not block the DSP.

### 8.7 Item 2 answered — what clocks audio-relevant parameters

§6 item 2 framed this as a hidden-tab problem. It is three problems, and only the
first is about hidden tabs.

1. **The freeze.** `ctrl.tick(dt, beatPhase)` (`src/main.js:7083`) runs inside the
   rAF loop (`main.js:7026`). A hidden tab suspends rAF; the worklet keeps running.
   Sound continues, every modulation stops.
2. **Jitter.** Even in a healthy foreground tab, every modulation carries up to a
   frame of quantization (§8.4).
3. **Resolution.** 60 Hz control rate *steps*. This is already known in the video
   domain — the slow-LFO "stutter" investigated for v0.19 turned out to be step
   quantization at a healthy 60fps, not a frame-rate problem. In audio a stepped
   parameter is not a stutter, it is zipper noise on every fader move.

**Driving the tick from the audio clock does not fix this.** If evaluation still
happens on the main thread, a hidden tab throttles it regardless — background
`setTimeout` is clamped to ~1s, and messages arriving from the worklet are consumed
by a deprioritised thread. That addresses jitter and leaves the freeze.

#### The answer is §4.9's move, one level down

**The client describes the controller; the worklet evaluates it.** Shape, rate,
phase, slew curve and table travel over the protocol once, as data. Evaluation
happens at audio rate on the thread that never suspends. The badge popover, MIDI
mapping, range fields and every other authoring surface stay exactly where they are.

This **refines §4.10's dividing rule rather than contradicting it.** That rule says
do not rebuild the controller layer in UGens, and it is right — do not duplicate the
*authoring*. Moving the *evaluation* is the entire point, and shipping a description
rather than a reimplementation is what keeps one canonical definition of each curve.

**Curves become tables.** Response tables are already 16,384-step data. Sample the
seven slew curves the same way and transfer them as buffers, so there is one
definition of "Elastic" rather than a client one and a worklet one that drift.

#### The inversion, stated plainly

If one LFO drives both a shader uniform and a zone rate, two oscillators in two
clocks is the wrong answer. So **for any controller feeding audio, the worklet is
authoritative and echoes its value back** for the video side and the UI to read each
frame.

ParameterSystem therefore stops being the sole source of truth for modulated values.
That is a real change, and it is also what makes §3's claim literally true: the two
domains are in phase *by construction* rather than by luck, which is the difference
between a coupling and a coincidence. Display may lag a frame; display is allowed to.

#### Costs

- **Two code paths.** With audio off entirely, modulation falls back to rAF. This is
  where bugs will live, and there is no way around it short of running the audio
  thread always.
- **A per-parameter audio-relevance question** — which parameters does the worklet
  consume? Same shape as the `_srcUsed` consumption fixpoint, and subject to the same
  warning: extend one canonical function, do not copy the pattern.

#### Expression controllers

The awkward case, and smaller than its description. `ControllerManager.js:378-396`
compiles **one expression, one variable, fourteen helpers** — `t` plus sin, cos, tan,
abs, floor, ceil, round, mod, fract, clamp, mix, pow, sqrt, noise. The `return (…)`
wrap forces expression context. That is a scalar expression tree, not a language, and
it parses into a flat instruction list evaluated in the worklet zero-alloc and
guaranteed-terminating. No text crosses the boundary, so §4.9 holds without an
exception.

**This makes expression controllers safer than they are today.** The grammar is not
actually closed now: `new Function` accepts any JS expression, including
`(() => { while (true) {} })()`, and the tick's `catch` sees throws but not hangs. A
text field can wedge the render loop today, with no audio involved — filed as **#33**,
which should ship first and independently, because the audio work is not its release
vehicle.

Three costs specific to this:

- **The grammar closes, which is breaking.** Accept a *superset* of the documented
  vocabulary — ternaries, comparisons, `Math.*` constants — and reject only
  statements, loops and object/array literals. Saved projects are where a
  too-narrow grammar would bite.
- **`noise()` is `Math.random()`** and needs its own RNG in the worklet, so
  expressions using it do not reproduce across the move.
- **`t` changes meaning.** `_exprTime` accumulates `dt` from rAF, so today it is
  *time the tab was visible*; from the audio clock it becomes real elapsed time. An
  improvement, and still a behaviour change for a project left running through a
  hidden-tab period.

**Rejected: compile when possible, fall back to `new Function` when not.** Two
evaluation paths for one feature is exactly where the costs above say bugs live, and
the fallback would keep the wedge alive.

#### Controller phase, capture, and the re-send trap

Moving evaluation to the worklet makes running controller phase worklet-resident
state, which §4.8's capture story does not cover. Two separate things, and only one
of them is new.

**Phase is already ephemeral across captures, and stays that way.**
`captureState()` (`src/controls/ParameterSystem.js:778`) stores `p.value` and
nothing else; controller *configs* are serialized separately (`src/state/Preset.js:89`,
`:101`). Running LFO phase is stored nowhere today. So a Display State recalled
mid-set has never restored the phase the performer was hearing, and the move to the
worklet inherits that rather than causing it.

**Decision: controller phase remains ephemeral across captures.** Recorded as a
decision rather than left implicit, because §4.8 exists precisely to catch state that
silently differs after reload. Capturing phase would mean a Display State that
restores *where an oscillator was*, which sounds desirable and is not: recalling a
state would then rewind every modulation to a stored moment rather than continuing
from the present, and morph between states would have to interpolate a wrapping
quantity. The `phase` field in a controller config is an **offset**, is config, and
is captured; the running value is not.

**The new hazard is the re-send, not the capture — and it runs the other way.**
Today's semantics are: recall retriggers, capture stores no phase. `restoreState()`
writes param values, and `Preset.js:293` immediately follows it with
`retriggerLFOs()` (again at `:352`, `:445` and `:460` — morph completion and
value-set paths), so a Display State recall deliberately resets every running LFO
to phase zero. After the move, restoring a state re-sends controller descriptions
to the worklet; if the worklet treated *receiving a description* as *restarting
that controller* the behavior would be preserved only by accident, and if it
treated every re-send as a restart, unrelated description updates would start
resetting LFOs that today only recall resets.

**Rule: a re-sent controller description is an update, not a restart — and recall
sends the retrigger explicitly.** Phase survives a description that changes rate,
shape, table or slew. Retriggering stays a separate explicit message, mirroring
`ControllerManager.retriggerLFOs()` (`src/controls/ControllerManager.js:439`),
which exists as the deliberate path and is already what tap tempo and the
beat-detect branch call. So Display State recall must emit that message alongside
the re-sent descriptions — otherwise the update-not-restart rule silently drops
the recall-retriggers-LFOs behavior the instrument has today.

### 8.8 Item 6 answered — the protocol vocabulary

#### The manual is not coming

§6 item 6 said *do not invent one before reading the RoSa v2 Implementation manual*.
That instruction is now void, and it is worth recording why so nobody spends another
session looking.

`www.steim.org/software/RoSa/` was an Apache autoindex holding **exactly one file** —
`RoSa v2.zip`, 1.5 MB, 04-May-2015. There was never a standalone manual URL; both the
reference and implementation manuals shipped inside that archive, which is what the
page means by "using the download link." The zip is 404 on every live host and scheme
variant today, and the Internet Archive holds a single capture of it —
`20150920051100`, status **408**, 418 bytes — a crawler timeout that stored no
content. Wayback successfully archived nearly every other STEIM binary (junXion
v4.1/v5.2/v5.38, LiSa X v1.25, LiSa 2.56, BigEye, the junXion boX and Spider
manuals); RoSa v2.zip is the one that failed. The remaining routes are social, not
technical: STEIM's contact page, or Frank Baldé, LiSa's developer and almost
certainly RoSa's — RoSa replaces LiSa's engine, and junXion, named on RoSa's page as
a client, is also his. *(Not Tom Demeyer — his STEIM work was Big Eye and Image/ine,
the video side. Worth stating because the ImWeb lineage makes him the obvious guess
and he is the wrong one.)*

**The blocker was less load-bearing than it looked.** §4.1 asked to adopt RoSa's
protocol *shape* — buffer, zones, zone types, OSC-style addresses — and all four are
stated on RoSa's public page. A manual would have supplied argument-level detail for
an engine we are not building; the direction was never in doubt. What follows is
therefore an ImWeb vocabulary in RoSa's shape, not a reconstruction of RoSa's.

#### Seven rules, then the addresses

The addresses matter less than the rules. Address lists get extended by whoever needs
a message; the rules are what keep the extension from quietly voiding §4.1.

**1. Every message must be representable as OSC 1.0.** Addresses are OSC-legal paths;
arguments are `i` `f` `s` `b` `T` `F` and nothing else. No JS objects, no `Map`, no
closures, no structured-clone-only shapes. *Test: could this message go over UDP to
another machine, unchanged?* This is the only thing that keeps §4.1's
transport-agnosticism honest. A protocol that is "transport-agnostic" but passes an
object graph `postMessage` happens to accept is not transport-agnostic, it is a local
API with an aspiration attached — and the 2002 two-machine deployment mode is the
thing that stops being available.

**2. Two channels: control and bulk.** Control messages are small and OSC-shaped.
Bulk payloads — a spectral render in, a tape dump out, an envelope span, a table —
travel as transferables at zero copy (§4.1), each announced by a control message that
carries its correlation id. Over a network transport bulk degrades to an OSC blob and
a copy. That cost is real and is stated here rather than discovered later.

**3. No ImWeb identifier ever crosses the boundary.** This is §4.1's zero-imports test
applied to the wire. The tempting design is a general `/param/set <name> <value>`
backdoor, and it makes the boundary fake: the engine would then have to know ImWeb's
namespace, and `ps.get()` inside the worklet becomes a refactor away rather than a
rule away. Instead the client allocates an **opaque integer slot** for each
audio-relevant controller and binds it to an engine-side target address once. The
engine knows the integer and the target; `displace.warpDrawAmt` never travels. Echoes
(§8.7) come back keyed by that integer.

**4. A re-sent description is an update, not a restart.** §8.7 establishes this for
controllers; it is promoted here to a protocol-wide invariant covering zones, graphs,
partitions and taps. Restart, retrigger, reset and clear are always separate explicit
verbs. The reason generalizes as cleanly as the rule: any receiver that infers "start
over" from "received a description" makes every unrelated field update a hidden
retrigger, and the bug is inaudible until the one recall where it matters.

**5. Addresses carry indices and fixed type tokens — never names.** §4.3 fixed
partitions to indexed slots because a captured user-named index means a different
partition on another machine, the `displace.warpSlot` and `glsl.preset` failure. The
same reasoning applies to every address segment. Labels are client-side presentation
and do not travel.

**6. Client→engine is imperative; engine→client is observational.** The engine never
initiates a request. It answers, echoes, and reports progress. The one request/reply
pair (envelope spans, below) is client-initiated and correlated by id.

**7. Engine→client traffic is rate-limited and aggregated to frame cadence.** One
echo message per frame carrying all slots, not one per slot; one progress message per
frame per job, not one per quantum. The failure this prevents is a render that
finishes in 200 ms flooding the port with progress nobody displays.

#### The address space

```
/engine/hello        <proto:i>                        → /engine/ready | /engine/refuse
/engine/tape/alloc   <seconds:f>
/engine/panic

/tape/env/req        <start:i> <end:i> <cols:i> <reqId:i>
/tape/env/data       <reqId:i> <start:i> <end:i> <cols:i> <b>      [engine→client]
/tape/env/dirty      <start:i> <end:i>                             [engine→client]

/part/<slot>/bounds  <start:i> <len:i>
/part/<slot>/ring    <T|F>
/part/<slot>/clear

/zone/<type>/<i>/part    <slot:i>
/zone/<type>/<i>/region  <startRel:f> <lenRel:f>
/zone/<type>/<i>/unsafe  <T|F>
/zone/<type>/<i>/on | /off
/zone/play/<i>/rate      <f>            (negative = reverse)
/zone/rec/<i>/dynamic    <T|F>
/zone/synth/<i>/render   <graph:i> <startRel:f> <len:i> <job:i>

/graph/def   <graph:i> <b>              flat topologically-sorted node list
/graph/free  <graph:i>
/voice/<i>/graph <graph:i>

/ctrl/<slot>/target    <address:s>      bind once
/ctrl/<slot>/desc      <type:s> <...> <table:i>
/ctrl/<slot>/retrigger
/ctrl/<slot>/clear
/ctrl/echo   <b>                        packed [slot:u16, value:f32]  [engine→client]
/table/<id>/data <b>                    16384 × f32
/expr/<id>/code  <b>                    compiled instruction list

/job/<id>/progress <done:i> <total:i>                              [engine→client]
/job/<id>/done | /job/<id>/error <code:i> <msg:s>                  [engine→client]
/job/<id>/cancel

/tap/src     <mic | master | zone/<type>/<i>>
/bus/out/gain <f>   /bus/out/limit <thresh:f> <release:f>
```

Four things in that list are doing more work than their one line suggests.

**`/tap/src` cannot name a partition.** §8.6 routes the analyser over *signals* and
never over a partition, which is storage. Rather than validate that at runtime, the
address grammar makes it unrepresentable — there is no production for `/part/` in a
tap source. A rule the vocabulary cannot express is a rule that cannot rot.

**`/part/<slot>/bounds` is a setup act with teeth.** §4.3 fixes layout at session
start. The engine therefore *rejects* a bounds change while any zone bound to that
slot is active, and replies `/engine/refuse`. The protocol enforces the document's
rule instead of trusting the client to remember it.

**Zone regions are partition-relative floats** (§4.3), so a layout can differ between
machines without every zone landing in the wrong material. `unsafe` zones are the
stated exception and take absolute coordinates by definition.

**`/expr/<id>/code` already exists.** The compiled instruction list is
`src/controls/ExprCompiler.js`, shipped in c3b5b12 for #33 — a flat array, no
callable references, no backward jumps. §8.7 anticipated needing this format for the
audio move; closing the grammar for a video-side security bug produced it early. The
blob is that array, and nothing else needs designing.

#### The two items §6 item 6 named

**Envelope refetch on zoom or resize.** The rule is one sentence: **the client never
resamples an envelope it already has into a different resolution — it asks.**
Resampling a fixed-resolution min/max view is lossy in the direction that matters,
because min/max is not an average and a zoomed-in view reconstructed from a coarse
one invents peaks it never saw and loses the ones between columns. `/tape/env/req`
takes an explicit sample span and a column count — one column per screen pixel — and
the engine answers from the tape.

Two operational rules come with it. **One outstanding request per view**, coalesced:
a zoom drag emits a request per frame otherwise, and the engine is not the place to
absorb that. And **`reqId` exists so stale replies can be dropped** — during a drag,
replies will arrive for spans the user has already left, and applying them makes the
display flicker backwards through zoom levels. The engine also pushes
`/tape/env/dirty` for regions a writer has touched, so the client re-requests only
what changed rather than polling; that is what keeps the incremental rebuild in §4.2
incremental.

**Render-writer progress across quanta.** A render writer (§4.4) chunks its work
across quanta (§8.3) and reports against a **`job` id assigned by the client**, not by
the engine — client-assigned ids mean a cancel can be sent before the first progress
message arrives, which matters because the whole point of faster-than-realtime render
is that some jobs finish before the UI has drawn anything. `/job/<id>/progress`
carries frames done and frames total, aggregated to frame cadence per rule 7.
Terminal states are `done` or `error`; `cancel` is client-initiated and must still
produce a terminal message, so a cancelled job cannot leak a progress indicator.

Partial output is kept, not rolled back. A cancelled or failed render leaves whatever
it wrote in the partition — this is an instrument, the half-rendered material is
playable, and a rollback would need a shadow buffer for a gesture whose failure mode
is "interesting" rather than "wrong."

#### What this vocabulary deliberately cannot say

- **Text.** No address takes a string that gets evaluated. `/graph/def` takes a node
  list, `/expr/<id>/code` takes an instruction list. The one `s` argument in the whole
  space that is not a fixed token is `/job/<id>/error`'s message, which travels
  engine→client and is displayed, never parsed. §4.9 holds without an exception.
- **A generic parameter setter.** See rule 3.
- **Anything about ImWeb's UI.** No tab, panel, badge or Display State concept
  appears. The engine does not know Display States exist; recall is a client-side act
  that emits ordinary descriptions plus an explicit retrigger (§8.7).

#### Honest costs

**Rule 1 costs convenience continuously.** Every message needs flattening to OSC
types, and the natural JS shape is usually a nested object. This will feel like
bureaucracy on every message written for a two-machine mode nobody is currently
running. It is still right — the alternative is discovering at deployment that the
protocol was never portable — but the cost is paid every day and the benefit is paid
once, which is exactly the shape of a rule that gets quietly abandoned. Worth an
audit that greps the message constructors for non-OSC argument types.

**Rule 3 adds a slot allocator** — one more piece of client bookkeeping, with
lifecycle bugs available when a controller is deleted and its slot reused while an
echo is in flight. Sequence the slot table so a reused slot is a new integer.

**Rule 7's aggregation makes the engine hold a dirty set** and flush on a cadence,
which is state the naive design does not have.

**The `job` id space and the `reqId` space are both client-allocated** and both need
to survive an engine restart after a WebGL context loss or an `/engine/panic`. Neither
is hard; both are the kind of thing that is not designed and then leaks.

#### One hole left open on purpose

§6 item 7 — freeze continuity — is unresolved, and the vocabulary above does not
prejudge it. `/zone/synth/<i>/render` currently says *render this graph into this
region*, which is silent on whether a live Voice running the same graph keeps
sounding from its own state during the chunked render, and whether the two are the
same performance. Whatever item 7 concludes will add an argument or a sibling verb
here (a phase-snapshot reference, or a `freeze` that is distinct from `render`). It is
noted rather than guessed because the musical answer determines the message, not the
other way round.

### 8.9 Item 7 answered — freeze continuity

**Freezing is a fork, not a capture. The live Voice never stops.**

At the freeze instant the Voice's state is snapshotted. The render runs forward
*from that snapshot*, filling spare budget across quanta (§8.3), while the live
Voice continues from the same instant, uninterrupted, on the audio clock. Two
timelines from one origin.

#### Why a fork, and not the obvious alternative

The tempting reading of "freeze *this* moment" is *record what I just heard* — but
that mechanism already exists and is not new: a Recording Zone capturing a Voice is
§4.4's stated route, it runs at 1×, and it is retrospective. If freezing meant
capture, §4.4 would have named a synonym for something already built, and
faster-than-realtime would buy nothing — you cannot record four seconds of the past
in a fraction of a second.

§4.4's own phrasing settles it: *"rendering the **next** four seconds into a
partition"*. Forward-looking. So freeze is **render seeded by a live state**, and
the material it produces is what the Voice *is about to play*, made scrubbable
before it has played it. That is the move worth having: the sound you are hearing
becomes material without you having to wait out its duration or stop making it.

The two phases are the same performance in the only sense that is actually
available — a shared origin. They are bit-identical wherever the graph is
deterministic, and they diverge exactly where it is not. Which turns out to be the
whole of the interesting content of this question.

#### Three consequences, two of them constraints on work not yet started

**1. Every UGen must have copyable state, and no hidden state.** A fork is a state
copy. Any UGen holding state the snapshot cannot see — a module-level variable, a
lazily-built table, a value closed over at construction — produces a frozen render
that quietly does not match the live Voice. **This is a design constraint on §6
item 1 that item 7 discovers**: it is nearly free if the UGen set is built under it
and structural surgery if retrofitted, so it belongs in the set's definition rather
than in a later bug report. State must be enumerable, not merely present.

**2. The RNG must be explicit and splittable.** §8.7 already ruled that `noise()`
cannot stay `Math.random()` once evaluation moves to the worklet. Freeze makes that
doubly binding for a different reason: **a fork cannot share a stream.** The render
runs *ahead* of the live Voice and both draw from the generator, so a shared stream
would interleave two consumers at different points in time and make both
irreproducible. The fork therefore derives a child seed deterministically from the
parent's state at the fork instant. A welcome side effect: **freezing the same
Voice state twice yields identical material**, which makes freeze a repeatable act
rather than a lucky one.

**3. Controller state advances in the render's VIRTUAL clock.** A Voice's
parameters are driven by controllers that, per §8.7, are worklet-resident and
evaluated at audio rate. A render running at 30× realtime must advance them at 30×
too — against rendered sample position, not against `currentTime`. Freezing them at
their snapshot values instead would mean **a Voice with an LFO freezes into material
with no LFO movement**, which is obviously wrong and is the kind of thing that is
only obvious once written down. This is also the clearest retrospective argument for
§8.7's decision: a client-side, frame-rate controller could not be advanced at 30×
at all, so the alternative design would have made freeze impossible rather than
merely awkward.

#### Determinism becomes testable, and should be tested

Consequence 1 is an architectural rule, and this document's own standard is that
such rules rot unless they are mechanical. This one has a real check available:

> Freeze a noise-free graph into partition A. Record the live Voice into partition
> B over the same span, at 1×. **The two must be sample-identical.**

Any difference means some UGen holds state the snapshot did not copy — consequence 1
violated, located, and named, without anyone having to reason about which UGen. It
costs one harness page and it should be written the same day the first stateful
UGen lands, not after the set is finished.

#### Scheduling: the live signal has absolute priority

§8.3 established that render writers fill spare budget across quanta. Item 7
sharpens why that matters here specifically: during a freeze **the same graph is
running twice** — once live at 1×, once ahead of itself as fast as budget allows.

The rule: **a freeze that takes three seconds instead of one is a slower freeze; a
freeze that drops a live buffer is a ruined take.** Never trade the second for the
first. The render gets a per-quantum budget expressed as a fraction of the quantum
and yields when it is spent.

And the budget should be *computed*, not attempted-and-hoped: §4.9 already commits
to a fixed-topology graph whose per-sample cost is known before it runs, so the
engine can work out how many samples fit in the leftover rather than rendering until
it overruns. That is the same property §4.9 used to justify refusing a snippet that
would blow the budget, applied to the other end of the problem.

#### Two smaller decisions, recorded rather than left implicit

**A graph edit during a render does not affect that render.** The snapshot was taken
at freeze time; a `/graph/def` update or a parameter change while the job runs
applies to the live Voice only. Otherwise "what did I just freeze?" has no answer.
Consistent with §8.8 rule 4 and with jobs being immutable once started.

**Freeze does not stop the Voice.** It is additive. Freeze-and-stop is two explicit
messages, for the same reason a re-sent controller description is not a restart: a
compound gesture that one message performs silently is a gesture you cannot decline.

#### The protocol consequence: a new verb, not an argument

§8.8 left this hole open on purpose. It closes as a sibling verb:

```
/voice/<n>/freeze  <part:i> <startRel:f> <len:i> <job:i>
```

alongside the existing `/zone/<type>/<n>/render <graph:i> <startRel:f> <len:i>
<job:i>`. Two verbs, because they are different musical acts:

- **`render`** — *make material from this program.* Cold state, reproducible from
  the graph alone.
- **`freeze`** — *make material from this moment.* Warm state, reproducible only
  from the state snapshot.

Collapsing them into one verb with an optional voice argument would frame the cold
case as a degenerate freeze. It is the other way round: **freeze is render plus a
state seed**, and the seed is the entire content of the feature.

#### What this deliberately does not settle

Whether a partition is readable *while* a freeze fills it. §8.3 offered "unreadable
until complete, or readable progressively if that turns out to be musically useful",
and item 7 does not need to choose: it is a per-job flag, not a structural
commitment. Progressive read is the more interesting default — it makes the freeze
audible as it lands, which is very much this instrument's temperament — but it
interacts with the `unsafe` flag and with a playback zone already reading the
region, so it is a thing to try rather than a thing to specify. Left to use.
