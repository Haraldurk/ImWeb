# ImWeb v0.16.0 — The Motion Matte

*Released 2026-08-05*

Motion extraction started as four candidate techniques borrowed from computer
vision, and the useful part of building it was watching most of them dissolve.
ImWeb already knew how to make things transparent — the keyer had taken an
external matte for years. What it had never had was anything that *produced*
one. So the feature is a single source rather than a subsystem, and the rest of
the work was finding out which controls were real.

## Motion Extraction

A **matte**, not a picture: white where the source moves, black where it does
not. Route it to the keyer's new Key src and the moving part of one layer shows
over another, the rest transparent.

That shape is forced by the architecture rather than chosen. Layers do not
composite by alpha — `BLEND` is a `mix(curr, prev, amount)` — so transparency
has only ever come from the keyer. Once that is true, "show only what moves" is
one new source plus a selector, and nothing else needs inventing.

- **One control spans both classical methods.** The background is an exponential
  running average of the source. Comparing the live frame against it is
  background subtraction; shorten the adapt time to zero and the background
  becomes exactly the previous frame, which is frame differencing. Same shader,
  no branch — two ends of one knob, and the settings worth playing are in
  between. Frame differencing alone shows only the *edges* of change and
  collapses the moment motion stops, so a person who pauses disappears. That is
  a property of the method, and it is why this is not a mode select.
- **Trail** is `max(motion, trail × decay)`, never `+=`. Instant attack,
  exponential release, bounded by construction — where two moving things cross,
  the matte holds instead of compounding toward white. It rides on the matte, so
  a streak reveals what the foreground shows *now* along that path rather than a
  frozen copy of what passed through.
- **Smoothness** blurs the source *before* the comparison, and it is what makes
  a live camera usable. Sensor grain is high-frequency, and this is the only
  place it can be removed cheaply: further down it has already been multiplied
  by Sensitivity and accumulated into the trail. It also fills interiors, so
  silhouettes come out solid instead of hollow.
- **Brightness and contrast are deliberately absent.** Brightness shifts the live
  frame and the background by the same amount — the background *is* an average
  of past frames — so it cancels in the difference and would do nothing at any
  setting. Contrast scales both, which is exactly what Sensitivity already does.
- **Moving the camera is a gesture, not a malfunction.** The background model
  assumes a fixed camera, so a pan makes every pixel disagree with what is
  stored and the matte opens across the whole frame. Whip the camera and the
  frame ignites; hold still and it resolves back to bodies. What it is not is a
  way to key a clean silhouette while the camera moves — nothing here tracks the
  camera, so a stable subject matte still wants a locked-off one.

## The keyer's external key is free again

`ExtKey` was hardwired to the DisplaceSrc texture, which meant keying externally
*cost* you displacement — one slot doing two unrelated jobs. It now has its own
**Key src** selector, defaulting to `DS Src` so every saved state, bank and
project keys exactly as before.

One thing to know when keying on a matte: the keyer passes a *band*, so it
rejects the very bright as well as the very dark. At the default KeyLevelWhite
of 80% a fully lit matte is keyed **out**, which looks like the strongest motion
being the one thing that fails to show. Set it to 100% and let KeyLevelBlack do
the cutting.

## RGB Channel Delay

Per-channel time offset: red, green and blue each read from a different frame of
history and packed into one picture. A moving edge separates into coloured
fringes trailing its own past, while anything still stays exactly itself — where
three frames agree, taking one channel from each reproduces the pixel, so equal
values are a bit-exact passthrough rather than a near-miss.

It owns no history. It reads the Video Delay ring that is already captured every
frame, so it costs one render target and one pass instead of a second ring — the
expensive part of a time effect is the buffer, and this one is second-hand. The
consequence is deliberate: the channels come from `Delay src`, so Ring depth and
Buffer res are its controls too. One ring, two views of it.

## Colour grading works in WebGL2 now

Loading a `.cube` and raising LUT Amount blanked the image to black, and had done
since the move to WebGL2 — meaning the colour grade panel had never worked there
at all. The LUT was uploaded as `RGBFormat + FloatType`; three still *defines*
that constant, so nothing was undefined and nothing warned, but it picks no
sized internal format for RGB. The upload went out as unsized RGB + FLOAT, which
WebGL2 rejects: the texture stayed incomplete and every sample returned black.

The lesson generalises past the incident — **"the library still exports the
constant" is not "the library still supports the upload"**. Now packed to RGBA
half-float, and half rather than full deliberately: `RGBA16F` is filterable in
core WebGL2 while `RGBA32F` needs an extension and samples black without it,
which is the same failure hiding one device further away. The LUT's blue axis
was also compressed by (N-1)/N, so pure blue never reached the last slice.

## Two v0.12 debts closed on real hardware

- **Dual-deck thermal and decoder budget — PASS.** Four phases, ~55 minutes on a
  real iPad over LAN with the full chain live: 16.675 / 16.670 / 16.670 / 16.670
  ms. Zero drift, and the worst frame time *fell* across the run, so there is no
  thermal ceiling here. Two 1080p ALL-I streams fit the device's budget with
  headroom.
- **Idle-deck upload gating — CONFIRMED, by counting rather than by soaking.**
  All four soak phases sat pinned at the vsync ceiling, where "the gate fires"
  and "the deck uploads and there is headroom to absorb it" produce identical
  frame times — so the comparison the protocol is built around could only ever
  pass. Three integer counters settled it in 65 seconds. A metric already at its
  limit cannot answer a question about cost.

## Also fixed

- **Buffers allocated 0×0 when the page boots before layout.** `clientWidth` is
  0 in a background tab or a hidden container, and Video Delay and TimeDisplace
  deliberately make `resize()` a no-op so a display change cannot wipe their
  history — so they took that zero once and never recovered. No error: capture
  and read both keep working against zero-sized targets, and the effect simply
  looked unimplemented.
- **The motion background froze above ~2.95 s of adapt time.** It lived in an
  8-bit buffer, and at `Bg adapt` 4 the per-frame step falls below one
  representable level, so it rounded to no change and stayed on the frame it was
  primed with. It did not look like a precision bug — a frozen background is a
  static reference plate, so it produced *better* silhouettes than the working
  one. Accumulators are float32 now.
- **`Bg adapt` and `Trail` agree on what a second means.** One was a half-life
  and the other time-until-gone, so at `Bg adapt` 4 a ghost was still half
  visible after four seconds. Both are now time-until-gone.

## Under the hood

- **`npm test` grew from nine invariant audits to eleven**, and two of the new
  checks exist because a test passed for the wrong reason: one audit restated a
  constant instead of reading it from the source, and kept passing while
  modelling a curve the engine no longer used. Audits now read their constants
  out of the code.
- Every fix in this release was verified to make its own audit fail against the
  pre-fix tree. An audit never seen to fail is not evidence.

---

Full detail in
[CHANGELOG.md](https://github.com/imweb-project/ImWeb/blob/main/CHANGELOG.md).
