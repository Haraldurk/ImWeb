# ImWeb v0.21.0 — The Resolution

*Released 2026-08-15*

A beta tester on a 4K monitor said the Rutt-Etra was "not convincing" and asked
for higher output resolution. Both halves of that were true. Neither was the
whole story.

He had also mentioned, separately and never in writing, that he changes his
monitor's resolution in order to use ImWeb at all — because the interface is
drawn in 8 and 10 pixel type, and on a 4K panel addressed at its native
3840×2160 that is about half the physical size it was designed to be. So he
dropped the display to 1080p to read the panel, and *that* is what made the
picture soft: a smaller canvas, then stretched back across a 4K screen.

One cause, two symptoms, and the symptom that got reported was the downstream
one. This release is about resolution in three senses — the interface at a
legible size, the output at the size your screen can actually show, and a
Rutt-Etra scan that keeps gaining detail across the whole range of its Lines
knob instead of quietly stopping a third of the way up.

---

## An interface that survives a dense display

There is a new **UI Size** control in the I/O panel: **Auto**, or 100% through
200%.

**Auto is the interesting setting.** The question it answers is not "is this
screen big?" but "is this screen dense, and is the operating system already
compensating?" — because those have opposite answers on the same monitor. A 4K
panel in macOS's scaled HiDPI mode reports a 1920-pixel-wide screen at device
pixel ratio 2, and every measurement in the interface is already the right
physical size; nothing should happen. The *same panel* run at native 3840×2160
reports ratio 1, and everything is half size. Auto looks at the panel's real
pixel count and at what the OS is already doing, and asks only for the
remainder. On every display where the OS is doing its job, it does nothing at
all.

Your choice is stored per browser, not in your project. The right value is a
property of the monitor in front of you, not of the patch — a scale saved into a
Display State would be wrong the moment the project opened on a different
machine.

## 1440p and 4K output

The **Display** and **Record** resolution menus now reach **2560×1440** and
**3840×2160**.

These are fixed render sizes rather than anything derived from your screen. The
canvas gets a true 4K backing buffer and is letterboxed into whatever space it
has, which means a 4K display is needed to *see* the result at 1:1 but not to
*produce* it — the recorder follows the same setting, so 4K capture works from a
laptop.

They are at the end of the menu rather than in numeric order, deliberately.
These menu values are stored in your saved states as positions in the list, so
inserting anything in the middle would silently repoint every project you have.

## Rutt-Etra, at a density worth looking at

The Lines knob went to 480. It now goes to **1080** — and more importantly, it
now does something across its whole range.

The scan's horizontal sampling was capped at 512 columns. Above 256 lines, then,
the scan got finer vertically and stayed *exactly as coarse horizontally*: the
top half of the knob bought nothing. Columns now follow the line count up to
2048, and the slew history follows them, so nothing else becomes the limit
first. Even at the old 480-line maximum this doubles the horizontal detail.

The top of the range is genuinely heavy — 1080 lines is a 1080×2048 lattice of
about 4.4 million vertices, and dragging Lines around up there will stall while
the geometry rebuilds. That cost is paid only if you ask for it. The default is
still 120.

## The recorder records sound

Every recording ImWeb has ever made had no audio track. Not a silent track — no
track at all: `canvas.captureStream()` returns video only. This was confirmed
against four real recordings, each of which reports a single video stream and
nothing else.

The recorder now taps the audio engine after its limiter and adds that as a real
track on the same stream, writing `video/webm` with VP9 video and Opus audio at
192 kbit/s. Monitoring keeps playing while you record. With the audio engine
switched off you get a video-only file exactly as before, and the console says
so — a track of digital silence would look like captured audio that came out
empty, which is worse than no track.

---

## Fixed

**A display change no longer quadruples the cost of every frame.** ImWeb
deliberately renders at pixel ratio 1: on a Retina display, ratio 2 doubles
every dimension and quadruples the fill cost across more than 35 shader passes
for no visible gain on moving video. But the handler watching for display
changes adopted the new ratio, undoing that decision permanently the first time
the window met a screen of a different density — with nothing to put it back.
The picture is identical either way, so the only symptom was an instrument that
became four times more expensive to draw at a moment that correlated with
nothing. It was found by reading frame timestamps out of real recordings: the
one file made at ratio 2 ran at 19 fps against 30 for files with half the pixels.

**Floating surfaces land where you click them at any UI scale.** The parameter
context menu, the controller popover, detached panels, the floating signal path,
the on-screen keyboard and both slot menus all positioned themselves in screen
coordinates written straight into a scaled element — which multiplies them
again. At 200% the badge menu opened twice as far from the pointer as the click,
and a detached panel opened past the right edge of a 4K screen taking its own
drag handle with it. Found in code review rather than testing, because at 100%
the two coordinate systems are identical and nothing is visibly wrong.

**Modals fit the screen at any UI scale.** The documentation viewer's height was
fixed at 80% of the window, which inside scaled chrome became 160% — clipping
its own titlebar and close button off the top of the screen.

**The large-display breakpoint no longer claims to fix type size.** A stylesheet
rule aimed at exactly this problem set a base font size that was measured to
reach zero elements on screen, because every one of the 198 font sizes in the
interface is set directly and a direct setting always beats an inherited one. It
was growing the spacing while leaving every letter the same size.

---

## Under the hood

Three new invariant audits run on every commit. One pins the pixel-ratio
decision, so the four-times-cost regression cannot come back unnoticed. One
covers UI scale end to end — including a rule that had to be written as a pure
function and unit-tested, because the display it exists for cannot be reproduced
on the machine it was written on.

The third lesson is about the audits themselves. The first version of the UI
scale audit listed the five full-screen overlays it checked. There were seven,
and one of them contained a live instance of the very bug the audit existed to
prevent — and the audit reported all clear. An audit that enumerates its
subjects can only pass while that list is complete, which is the one thing
nothing checks. It now derives them from the stylesheet instead.

---

## Upgrading

Nothing to do. Saved projects, banks and states load unchanged: the new
resolutions were appended rather than inserted, and the Rutt-Etra Lines maximum
is a number rather than a menu position, so a project that saved 240 still means
240.

The service worker cache is now named **`imweb-v0.21.0`**. **If you self-host,
deploy a fresh `npm run build`** — a returning visitor's browser serves the
cached `index.html` until that constant changes, and a stale one points at
bundle hashes that no longer exist on disk.

If your interface suddenly looks larger after updating, that is Auto deciding
your display is dense and unscaled. Set **UI Size** to 100% in the I/O panel if
you preferred it as it was.

## Credits

ImWeb is a reimagining of *Image/ine* by Tom Demeyer and Steina Vasulka
(STEIM Amsterdam, 1997/2008). See [CREDITS.md](CREDITS.md).
