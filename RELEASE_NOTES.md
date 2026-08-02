# ImWeb v0.15.0 — The Scan Processor

*Released 2026-08-02*

Rutt/Etra (1972) sat beside the Sandin Image Processor and the Paik/Abe
synthesiser in the lineage this project claims, and was the only one of the three
with no representation in the instrument. It existed as a bare `pre-rutt-etra`
git tag and nothing else. Now it is a source you can route — and the temporal
engines that were already here have grown up around it.

## The Rutt-Etra Scan Processor

Horizontal scanlines deflected by the luminance of any source, viewed through an
orbiting perspective camera. Faithful before general, deliberately: the machine
is beautiful *because it lies about depth*, and generalising to "any channel
displaces any primitive" before living with the historical instrument produces
something configurable that nobody plays.

- **Any source drives it**, including "whatever the Foreground is showing".
  Scanning its own output is legal and frame-delayed rather than a feedback
  conflict.
- **Z Curve and Z Pivot** — the depth transfer function. Curve is a gamma on
  luminance before it is scaled, which stops midtones flattening into a slab and
  makes a face read as a face. Pivot moves the zero plane so the relief sits
  *around* the sheet rather than only in front of it — valleys as well as ridges.
- **Rise and Fall** — asymmetric temporal slew. The lattice glides toward the
  signal instead of snapping to it, so live video becomes a viscous topography
  rather than a field of jittery spikes. Times are in seconds, so the feel is
  identical at 30 and 60 fps.
- **Spread** — spatial phosphor decay. The trail diffuses as it fades instead of
  dimming in place, which is the difference between a ghost image and a glow.
- **Seven surfaces** — Plane, Sphere, Cylinder, Torus, Catenoid, Helicoid,
  Gyroid. The raster wraps onto a surface and displacement runs along its
  *normal* rather than +z.
- **Lines, Points or Both**, with beam width and dot size as independent
  controls, plus phosphor tint and source chroma.

## Spacetime — the warp family grows up

Four temporal engines had each grown their own copy of the same idea: a history
of frames, and a way to read across it. The history is VRAM and there should be
exactly one of it.

- **The ring is split from the tap.** One shared frame history now feeds many
  reads. No behaviour change, a large VRAM change.
- **Every temporal engine takes a source.** Slit Scan, Warp Tape and the Delay
  Line each read whatever they were hardwired to; Warp Tape was camera-only by
  heuristic rather than by design.
- **FG Src / BG Src / DS Src on every capture selector** — "whatever that layer
  is currently showing", so an engine follows your routing instead of being
  pinned to a decision made once.
- **Time Displace gains an angle and a map source**, so any source can drive the
  delay map and the whole field can rotate.
- **Warp Tape becomes playable** — Position, Span, Anchor and Clear. It was a
  fixed mapping; it is now something you scrub.
- **The Delay Line goes deep** — up to 480 frames, with its buffer resolution
  decoupled from the canvas.

## SDF — no longer "Metaballs"

The raymarcher was a metaball toy with three shapes and a fixed camera. It is now
a field renderer.

- **Thirteen shapes**, a second shape with Union / Smooth Union / Subtraction /
  Intersection, and KIFS fractal folding.
- **An orbit camera** — Orbit X/Y and Distance, with field of view exposed.
- **A two-stop glow gradient** with saturation and value per stop, an environment
  tap for Fresnel, and self-reflection with its own range and detail controls.
- **Alpha carries coverage**, so the compositor knows where the source *is* and
  the keyer's Alpha mode works against it; depth moved to a second march and is
  routable as its own source.
- **Free when unused** — the luminance fetch and ambient occlusion are skipped
  entirely at zero rather than computed and multiplied away.

## Also fixed

- **`_resolveLayerTex()` handled 16 of 29 sources.** Thirteen fell through to the
  composited output instead of the thing named in the dropdown — no error, no
  warning, just a plausible-looking picture, which is why it survived so long.
- **Appending a source no longer breaks saved captures.** Files now carry the
  capture-index base they were written at and migrate on load.
- **Warp Tape's Buf Size finally means something** — the strip was allocated at
  canvas width while the write head wrapped at the buffer size, so anything under
  1920 covered only part of the frame.
- **The Delay Line saturates past its history** instead of dropping to black.

## Under the hood

- **The manual describes this instrument again.** It covered 22 of 31 sources
  with none of the last four phases present; it now covers all 31, plus warp
  drawing. Every parameter id in it was verified against the live registry.
- **`npm test` grew from four invariant audits to nine**, and the lessons log now
  tags each entry with whether it is mechanically enforced or still carried in
  prose. One new audit found a live hole on its first run: exported `.imstate`
  files had no gitignore protection at all.

---

Design doc: `docs/ImWeb-Spacetime-Blueprint.md`. Full detail in
[CHANGELOG.md](https://github.com/imweb-project/ImWeb/blob/main/CHANGELOG.md).
