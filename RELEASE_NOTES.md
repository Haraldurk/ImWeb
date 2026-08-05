# ImWeb v0.17.0 — The Chain

*Released 2026-08-05*

Everything downstream of the layers, gone over end to end.

The feedback loop gets the one control it never had, and stops occasionally
deleting the live picture. The effects chain gets five new effects, four more
that turned out to be already written and wired to something else, a master
bypass, and labels that say what their numbers actually mean. The particle luma
mask can finally point at any source in the instrument.

Three of the fixes below are the same shape, and it is worth naming: a control
that was live in the panel and dead in the render. A slider that moves, a
readout that updates, and nothing on screen. That failure never announces
itself — it reads as the effect being subtle, or as the feature being broken.

## Shaping the feedback loop

Seven new controls act on the **recirculated frame alone**. `Fade` and
`ColorShift` already sat inside the loop and could damp or tint a trail, but
only by damping or tinting the live picture along with it.

**FBDecay** is the one that was missing. Nothing attenuated the recirculating
image, so Add, Screen and Dodge blew out to white within a few frames and
Multiply and Burn crushed to black. Decay is what makes those modes playable.

**FBCenterX / FBCenterY** unpin the zoom and rotation from the middle of the
frame — the difference between one tunnel and a steerable one. **FBEdge**
(Clamp / Mirror / Wrap / Black) decides what the loop finds outside the frame
once it has been shifted; clamp is the smear it has always produced, and the
other three are genuinely different characters. **FBBlur** softens the trail
per generation, for the classic glow tunnel. **FBHue** rotates the hue once per
generation, compounding around the loop, so a trail can walk through the
spectrum as it decays. **FBMirror** flips it.

## Five new effects

**Polar** maps the frame between rectangular and polar coordinates, in both
directions. It turns every other effect in the chain into a different one: a
scanline becomes a ring, a horizontal wipe becomes a sweep.

**Wave** is sine displacement per axis, with a phase built to be driven by an
LFO. **Halftone** is an ordered dot screen, mono or per-channel — the colour
mode gives each channel its own screen angle, so the three grids rosette
instead of beating into moiré. **Duotone** remaps luminance through a
two-colour ramp, shadows to one hue and highlights to the other. **Lens**
carries barrel and pincushion on one signed control, plus twirl; with Scanlines
it is a CRT, and with Halftone it is a printed page photographed off one.

## Four effects that were already there

No new shader code behind any of these. Each had been written and wired to
exactly one place, and never offered as an effect:

- **Sharpen** drove only the noise generator.
- **Out.Hue / Out.Sat / Out.Bright** existed per layer, so you could turn the
  foreground and the background separately but never the composite.
- **Flip** was per-layer only.
- **Interlace** ran as a fixed pass after the chain; it is in the chain now, so
  it can be dragged in front of bloom or grain.

## Master controls

**All FX** bypasses the whole post-FX chain. Not a mute: every value and the
chain order are kept, so switching back on returns exactly the look you left,
and it skips the loop rather than each effect, so a bypassed chain costs
nothing. **Clear All FX** resets every effect parameter to its default — but
not the chain order, which is an arrangement you built on purpose.

Both are real parameters, so both are MIDI-mappable and captured by Display
States.

## The particle luma mask sees the whole instrument

PMaskSrc had carried an eleven-entry hand-written menu since v0.11 while every
other selector grew to the full source list, so masking particles with SDF,
Motion, Rutt-Etra, a mix bus or Movie B was simply not expressible. It offers
all 36 sources now, and the mask joined the consumption fixpoint — pointing it
at a generator that only runs when something needs it now keeps that generator
running.

## Fixes

**Transforming the feedback could delete the live picture.** The prev-frame
rotate/zoom and offset/scale passes shared the two render targets that also
held the composited live frame, and whether the second transform overwrote it
came down to how many passes the keyer, chroma key and warp chain had run
earlier in the same frame — parity, not intent. When it landed wrong, the blend
received the transformed previous frame as *both* of its inputs and the live
image vanished from the output. It comes and goes as unrelated effects are
switched on and off, which is exactly why it survived this long.

**A saved effects order silently dropped effects it had never heard of.** The
chain order is captured by Display States and written into every `.imweb` file,
and unknown ids were filtered out — so every state saved before an effect
existed would have recalled with that effect missing from the chain. Every new
effect in this release would have failed to appear for any saved patch.

**BlendAmount was dead in XOR, OR and AND** — three of the twenty-one blend
modes ignored their own strength control, in the feedback blend and the layer
blend alike. **The BG self-blend ran at whatever strength another pass had set
last**, because the three blends share one material.

**Kaleidoscope worked in raw UV**, so its wedges were sheared on any non-square
output and the area outside the disc had a hard seam wrapped through it. It is
aspect-corrected now, with a centre and a real edge mode. This changes how an
existing kaleidoscope patch renders — the fix *is* the change.

**Posterize and Solarize are off at their maximum**, the opposite of every
other row in the panel. The mappings cannot move without moving saved patches,
so the labels now say what the number is: **Post.Levels** and **Sol.Thresh**.
For the same reason, FBRotate is labelled percent of a turn rather than degrees
(50 was always 180°, not 50°), and the feedback offsets are ‰ of the frame
rather than the pixels they never were.

**Scanlines were pinned to 400 lines** regardless of output resolution, and
**film grain crawled instead of scintillating** — its seed moved the same
amount on both axes, sliding one fixed noise field diagonally rather than
drawing a new one.

**The signal-flow display claimed passes it was not running**: a `lut` node
whenever LUT Amount was above zero even with no `.cube` loaded, feedback shown
as inactive when driven by zoom or rotation alone, and the whole effects chain
listed while it was bypassed.

**The Effects panel was twenty-nine rows in registration order**, mixing
geometry, colour, texture and timing. It is five subsections now — Geometry,
Optics, Quantise, Texture, Time — and Levels and White Balance have moved into
the LUT / Colour Grade section that had been sitting underneath them holding a
single row.

## Under the hood

**`npm test` grew from eleven invariant audits to twelve**, and an existing one
gained a second check. Both were written from a bug in this release and both
were verified to fail when that bug is put back: feedback transforms may not
share the ping-pong render targets, and every effect in the chain must have a
node in the signal-flow display — which is also the reorder UI, so an effect
missing from it can never be moved.

---

Full detail in
[CHANGELOG.md](https://github.com/imweb-project/ImWeb/blob/main/CHANGELOG.md).
