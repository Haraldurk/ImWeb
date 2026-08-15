# ImWeb v0.20.0 — The Other Half

*Released 2026-08-15*

ImWeb has been a video instrument that could *listen*. Sound-reactive controllers
have driven the picture for a long time — a kick drum opening a keyer, a room
tone bending a warp. What it could not do was make a sound of its own.

This release gives it the other half: a tape it can record onto, scrub, paint
into and play back, with the picture deciding what it sounds like.

Two things to know before the rest. **The audio engine never starts by itself** —
it takes a deliberate **Audio On**, because a browser audio context created
without a gesture comes up silently suspended and looks identical to a working
one, and because an instrument should not seize the sound card merely by being
open. And **it tells you when the room is a wire**: with a microphone open and
monitoring set to speakers, the signal path draws the closed
`mic → tape → speakers → mic` loop instead of leaving you to discover it at
volume.

---

## A tape, with regions that mean something

The **Audio** tab holds a length of tape — sixty seconds by default — divided
into four partitions. A **Recording Zone** writes into one, a **Playback Zone**
reads from one, at any rate including negative, and both are ordinary parameters
that a controller can drive.

Positions are stored as fractions of a partition rather than as sample counts, so
a saved state means the same thing on a machine with a different tape length.
Partition layout is a setup act: it is fixed while a zone on it is running, and
the instrument says so rather than quietly ignoring you.

## Painting sound — the spectral writer

**Audio → Spectral Writer** takes whatever ImWeb is showing and renders it into
the tape as sound: brightness becomes amplitude, height becomes pitch, and the
horizontal axis becomes time. The whole effect chain is already in the picture,
so what you hear is what you built.

The vertical axis is quantized to a **musical scale** — chromatic through
pentatonic, whole tone, octatonic, and the harmonic series, which is not
octave-repeating and turns a vertical brush stroke into a timbre rather than a
chord. That quantization is the difference between an instrument and a noise
generator, and it is why this is not an inverse FFT: FFT bins are evenly spaced
in frequency and scales are not, so a transform would re-quantize the one axis
the feature exists for.

The render is paced across audio frames rather than done in one blocking pass. It
does not interrupt what is already playing, reports progress while it runs, can
be cancelled, cannot clip, and cannot write outside the region it was given.

### And now in stereo

**Pan Image** decides where each part of the picture sits between the speakers.
**Colour** reads the red-to-blue balance — the channel the writer otherwise
throws away — so warm and cool parts of one frame land on opposite sides.
**Spread** puts pitch across the field, lowest to the left. **Sweep** travels
left to right across the render's own duration. **Off** is the default and
renders mono, so nothing you have already made changes.

Colour asks where the *sound* in each cell is rather than where the pixels are: a
bright stroke keeps its position instead of drifting toward centre because it
happens to sit on a black background. The pan law is equal-power, so moving a
stroke across the field does not change how loud it is.

## Finding sounds instead of scrubbing for them

**Audio → Corpus** measures the tape in short grains and plots them on a pad by
two of four descriptors — loudness, brightness, pitch, periodicity. Touching the
pad finds the nearest grain and plays it. A **Grain Player** reads from that
position with size, density, pitch and spray of its own.

The map only shows what the reader can actually reach. An earlier draft analysed
the whole tape while the player read a single partition, so the pad plotted
grains that would silently play as something else; the fix was to filter the map
rather than to widen the reader.

## Monitoring, and seeing the loop

**Audio → Monitoring** — Headphones or Speakers — is how you tell ImWeb whether
the room closes the circuit. It changes no gain and no routing. What it changes
is what the instrument knows, and therefore what it can tell you.

Speakers is the default, because the safe state should require no selection.
Guessing headphones would suppress the one warning that matters on exactly the
setup where it matters.

When the loop is real, the **signal path display** grows a row for the audio
graph and draws the return edge — the one connection that cannot be a row of
arrows, because it goes backwards:

```
mic → rec P0 → tape 60s → play P0 → limit → ▶ speakers   ⚠ room
└────────────────────────────────────────────────┘
```

**Dashed and grey** means the room is a wire with nothing driving it: you are one
Run toggle from a howl, and the row names the toggle. **Solid and red** means a
recorder and a reader are on the same material and you are in it. A warning line
can say "closed"; only a drawing can say *which link to open*.

The monitoring switch also takes no controller — a control that changes your
exposure to feedback should not be sweepable — and that rule is now enforceable
rather than merely written down.

---

## Fixed

**The master Fade works.** Raising Fade above zero — by the slider, by `h`, by a
controller, by a state recall or a loaded project — threw an error inside the
render loop and stopped the picture on its last good frame. It went unnoticed
because Fade defaults to 0, the one value that keeps the branch shut, so the most
ordinary move there is — fading to black — was the trigger.

**Changing the recording partition while recording** no longer looks like it
worked when it did not. The button moved, the take went on landing in the old
partition, and nothing said so. It now springs back and explains: stop the
recorder, move it, start it again.

---

## Under the hood

The audio engine is an AudioWorklet with **zero imports by construction**, which
is what lets it be instantiated in Node and driven quantum by quantum. Every
claim this release makes about sound is measured on the samples it produced — a
row lands on the pitch the scale says it does, a hard-panned image puts nothing
in the other channel, centre sits at 1/√2 and not at a 3 dB dip — rather than
asserted about the source.

**`npm run mutate`** commits that discipline. Forty-eight registered defects, each
with a stated consequence, each asserted to turn its audit red. Two of them found
real faults rather than confirming absent ones, which is the argument for keeping
them.

The stereo placement and the loop marking were both checked by ear and eye on
real hardware before this shipped, not only in Node.

---

## Upgrading

**No project or state file changes.** `.imweb`, `.imbank` and `.imstate` files
from v0.19.0 load unchanged. Audio parameters are new, so older files simply have
none — the engine stays off until you turn it on.

The service worker cache is now named after the app version: **`imweb-v0.20.0`**.
**If you self-host, deploy a fresh `npm run build`** — a returning visitor's
browser serves the cached `index.html` until that constant changes, and a stale
one points at a bundle hash that no longer exists on disk. Naming the cache after
the version also means the staleness is now visible in the literal itself, and
the audit checks it exactly rather than inferring it from the last release tag.

## Credits

ImWeb is a reimagining of *Image/ine* by Tom Demeyer and Steina Vasulka
(STEIM Amsterdam, 1997/2008). See [CREDITS.md](CREDITS.md).
