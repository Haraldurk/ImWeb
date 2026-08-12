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

### 4.3 Partitions

**One allocation, named bounds-checked partitions, opt-in `unsafe` flag.**

Zones belong to a named partition and are clamped to its bounds.

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

Accepted costs: one sample rate and channel count throughout; resizing partitions
mid-session implies relocation (mitigate by fixing layout at session start);
"partition" is a concept neither RoSa nor SC had, so there is no prior art to crib
ergonomics from.

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

---

## 6. Open questions

None blocking; all still at the prose stage.

1. **Partition layout — fixed at session start or mutable?** Mutable implies
   relocation of live material.
2. **Tape duration and memory budget.** RoSa sized its buffer by *assigned memory*
   specifically so this would not become an architectural constant. Follows from the
   partition design, not the other way round.
3. **`SharedArrayBuffer` vs message port.** SAB requires cross-origin isolation
   (COOP/COEP headers), which constrains embedding and hosting — a real load-in
   risk for an instrument that travels as a URL. Message-port designs avoid it at
   some latency cost.
4. **Capture and save.** Partition *layout* looks like it should be captured by
   Display States (structural, means the same thing across machines). Tape *contents*
   look like they should not (megabytes of live material, and a captured index into
   them would mean something different elsewhere — the same reasoning that keeps
   `displace.warpSlot` out of capture while `displace.warpPreset` stays in). Getting
   this wrong is silent until someone reloads a saved state on another machine and
   the material is gone. Decide while it is still prose, and run the
   `state-capture-auditor` before shipping.

---

## 7. Non-goals

Waveform editing. A timeline. Arrangement. A mixer. Plugin hosting. Undo.

LiSa refused all of these, and the refusal is what made it an instrument. If a
region editor starts appearing, the design has drifted into a DAW and the argument
for living inside ImWeb collapses.
