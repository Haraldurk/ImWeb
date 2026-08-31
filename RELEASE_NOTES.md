# ImWeb v0.22.1 — The Mapping You Had

*Released 2026-08-31*

A startup crash in v0.22.0, and Bokeh getting most of its frame rate back.

## Fixed: ImWeb would not start if you had saved MIDI mappings

v0.22.0 introduced remembering learned MIDI mappings across a reload. The code
that reports what it restored called a function that was not in scope where it
was called — `ReferenceError: setStatus is not defined`, thrown during startup,
so the app came up blank.

The bad reference was always there. The crash was not always reached: restoring
only announces itself when it actually restored something, so a fresh install
started perfectly, the suite passed, and every automated check was clean. It
broke only for people who had already learned a mapping — which is to say, only
for the people using the feature it shipped with.

No mappings were lost. They were being restored correctly; it was the message
about them that failed.

## Changed: Bokeh is much cheaper at large radii

Past about a third of the Radius range, the effect now works at quarter
resolution off a downsampled copy of the picture. Nothing visible changes —
detail finer than a few pixels cannot survive a blur that wide, and anything
still in focus is taken from the full-resolution original either way. But there
are four times fewer pixels to compute, and the sampling stops thrashing the
GPU's texture cache, which at a wide radius was costing more than the arithmetic
suggested.

Measured on the development machine: **21 fps back to 60**, at Max quality with
a wide radius.

## Changed: Bokeh.Discs now does something

Its two shader inputs were never connected, so the control had no effect
whatsoever — while still running a highlight extract and a second full gather
every frame and throwing the result away. That waste was most of the cost above.

It was invisible because the effect still produced discs: **Bokeh.Ring** makes
them too, from the main pass. So the picture looked plausible and the control
that appeared to be responsible was not the one doing the work.

With it connected, settings carried over from v0.22.0 will read stronger than
they did. If it is too much, pull **Discs** down rather than **Ring** — Ring is
what shapes the disc, Discs is how hard the extracted highlights are added back.
