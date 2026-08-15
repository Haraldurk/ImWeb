# The output recorder's frame rate — what five real recordings say

Investigation. **No frame-rate fix is applied in this PR**, but the question is
now answered: see *The answer*. The capture/encode path is the limiter, not the
render loop, and it is limited by pixel count. One contributing cause — a DPR
regression that quadrupled fill cost after any display change — was found on the
way and *is* fixed here.

Companion to the audio-track change in `src/main.js` (`btn-record`).

**One conclusion in the first draft of this document was wrong and is corrected
in place below**, marked as a correction rather than quietly edited, because the
reasoning that produced it is the reusable part.

---

## What was measured

Four `imweb-*.webm` files the owner recorded between March and August 2026, read
with `ffprobe` — every frame's presentation timestamp, then the gap
distribution. This measures the produced artefact, which is the thing the
complaint is about.

```bash
ffprobe -v error -select_streams v:0 -show_entries frame=pts_time -of csv=p=0 FILE.webm
```

| file | resolution | span | frames | mean fps | gap p50 | gap p95 | gap distribution (multiples of one 60 Hz vsync = 16.67 ms) |
|---|---|---|---|---|---|---|---|
| `imweb-1785918525497` | 1964×1048 | 35.5 s | 1078 | **30.3** | 33 ms | 35 ms | `1×: 25`, `2×: 1052` |
| `imweb-1785917168355` | 1924×1048 | 17.0 s | 388 | **22.7** | 48 ms | 54 ms | `1×: 6`, `2×: 129`, `3×: 251`, `6×: 1` |
| `imweb-1774103888108` | 2646×1766 | 20.3 s | 386 | **19.0** | 52 ms | 63 ms | `1×: 3`, `2×: 1`, `3×: 332`, `4×: 49` |
| `imweb-1785885556943` | 1471×913 | — | — | — | — | — | — |

`ffprobe` also confirms the audio report directly: **every one of the four files
has exactly one stream, `codec_type=video`.** Not a silent track — no track.
That is what this PR's other half fixes — and the fifth file, recorded after it,
carries `codec_name=opus`, 48 kHz, 2 channels, decoding to 12.000 s at
`mean_volume: -27.3 dB` / `max_volume: -12.0 dB`. Real sound, not silence
(silence reads about −91 dB) and not clipping. ffmpeg logs one
`Error parsing Opus packet header` on the first packet and then decodes the whole
stream to the sample; the decoded length is exact.

---

## What the numbers rule out

**It is not jitter.** Every gap is an integer multiple of one 60 Hz vsync, and in
the best file 1052 of 1077 gaps are *exactly* two vsyncs, p95 = 35 ms against a
p50 of 33 ms. Frames are arriving on a clean grid — just a coarse one.

> **Correction (2026-08-15).** The first draft of this document went on to argue
> that "a capture pipeline dropping frames under encoder backpressure does not
> produce a distribution that tight", and used that to rule out the encoder.
> **That was wrong, and it was the load-bearing error here.** A canvas stream
> only ever produces frames on canvas commit, i.e. *on the vsync grid* — so a
> capture path that can only absorb every second frame drops on that grid too,
> and yields exactly the tight 2× distribution above. Tightness distinguishes
> regular from irregular. It says nothing at all about which stage is the
> limiter. See *The answer* below, which is the opposite of what this paragraph
> originally concluded.

**It is not bitrate starvation.** The 8 Mbit/s ceiling is never reached:
19.9 MB / 35.5 s ≈ 4.5 Mbit/s, 16.1 MB / 20.3 s ≈ 6.3 Mbit/s.

**`captureStream(60)` is not the problem, and raising it would change nothing.**
The 60 is a *cap*; a canvas stream emits a frame when the canvas is committed. It
cannot manufacture frames the render loop never drew.

So the honest description is not "stutter" in the sense of uneven pacing at a
high rate. It is **a low but almost perfectly regular rate — 19 to 30 fps — with
one file (`…17168355`) genuinely bimodal**, alternating 33 ms and 50 ms gaps.
That mixture of 30 fps and 20 fps is what actually *looks* like stutter; the other
files just look slow.

---

## The one strong correlation: pixel count

| pixels | fps |
|---|---|
| 2.06 MP (1964×1048) | 30.3 |
| 2.02 MP (1924×1048) | 22.7 |
| 4.67 MP (2646×1766) | 19.0 |

Frame rate tracks resolution, not duration and not bitrate. That points at fill
cost or encode cost per frame, both of which scale with pixels — and away from
anything scheduling-shaped.

### And 2646×1766 should not have been possible — FIXED

`src/main.js` sets `renderer.setPixelRatio(1)` with a comment explaining the
decision at length: on a Retina display DPR = 2 quadruples fill cost across 35+
shader passes for no perceptible gain on moving video, and DPR = 1 is what buys
60 fps.

`_onDPRChange()` — the handler that exists to notice a window moving to a display
of a different pixel density — then called
`renderer.setPixelRatio(window.devicePixelRatio)`, restoring Retina 2× and
permanently undoing that decision on the first display change of the session,
with nothing to put it back.

2646 × 1766 is 1323 × 883 CSS pixels at DPR 2. The other three files are all
DPR 1. **The slowest recording in the set is the one that had been through a DPR
change.**

The handler now re-asserts `setPixelRatio(1)` rather than adopting the display's.
Re-asserting rather than deleting the call: the ratio is a decision, and a
decision restated at the one place that used to break it is worth the line. The
handler's other two statements are what it is actually for — `applyResolution`
re-syncs every engine's targets after a display move, and its matchMedia listener
is `{ once: true }`, so re-arming it there is the only reason a *second* display
change is ever noticed.

`tests/audit-pixel-ratio.mjs` makes it permanent: every `setPixelRatio` call in
`src/` must pass the literal `1`, and `_onDPRChange` must still do all three
things. The census runs against sanitized source, because the fix's own comment
quotes the forbidden call while explaining why it is gone. Three mutations in
`tests/mutations.mjs` — the original bug verbatim, a variable ratio that reads
correct on a non-Retina machine, and "pinning" the ratio by deleting the handler
body — all caught, 3/3.

**It does not explain the other three.** They were DPR 1 and still ran at
19–30 fps.

---

## The answer (measured 2026-08-15)

Two measurements settled it, and neither matched the prediction I wrote down.

**1. The render loop is not the limiter, and recording costs it nothing
measurable.** `window.__perfStats` on the owner's machine, sampled before and
during a recording:

```
idle:   { fps: 60, avg_ms: 16.67, p95_ms: 17.6, worst_ms: 17.7, jank: 0 }
during: { fps: 60, avg_ms: 16.67, p95_ms: 17.4, worst_ms: 17.7, jank: 0 }
```

Not 30 idle, not 60 dropping to 30 — **60 both times, with zero jank and a worst
frame of 17.7 ms.** All three predicted outcomes were wrong. Chrome encodes off
the page's main thread, so the encoder can be saturated without the render loop
noticing at all, which is exactly what a page-side fps probe is blind to.

**2. A recording made at a smaller output keeps up.** `imweb-1786791723965.webm`,
the first ImWeb recording ever made with sound:

| resolution | span | frames | mean fps | gap p50 | gap p95 | vsync multiples |
|---|---|---|---|---|---|---|
| 683×846 (0.58 MP) | 11.9 s | 689 | **57.6** | 17 ms | 19 ms | `1×: 657`, `2×: 15`, `3×: 9`, `4×: 1` |

657 of 688 gaps are exactly **one** vsync. Same instrument, same recorder, same
machine — a third of the pixels, and double the frame rate.

**So the capture/encode path is the limiter, and it is limited by pixel count:**

| pixels | fps |
|---|---|
| 0.58 MP | 57.6 |
| 2.06 MP | 30.3 |
| 4.67 MP | 19.0 |

VP9 at 8 Mbit/s has no hardware encoder on this machine's AMD 5500M, so this is
libvpx on the CPU, and the canvas capture is copying every frame out at full
output resolution before it gets there.

### What that makes the fix, when someone takes it

Not render performance — the loop is already at 60. In the recorder:

1. **A cheaper codec.** `video/webm;codecs=vp8,opus` is already in the fallback
   list the audio change added; promoting it to first choice is a one-line
   experiment with a measurable answer.
2. **A fixed export resolution**, capturing through an intermediate canvas rather
   than the live output, so the recording's cost stops depending on how large the
   user happened to leave the window.

Neither is done here. Both should be measured the same way this was — by reading
the PTS distribution out of the produced file, not by asking the page how it
feels.

### Still unexplained

Three 0-byte `.webm` files, all from runs of the `__perfStats` snippet above.
Manual recording immediately before and after works and produces good files, so
this is specific to driving `btn-record` programmatically and is not a property
of the recorder in normal use. Recorded here rather than guessed at.

### The standing tax the fps numbers cannot see

`preserveDrawingBuffer: true` (`src/main.js`) is on permanently for `toBlob()`
capture, and it forces a copy rather than a swap on every frame. It is constant
across both samples above, so it could never have shown up as a *difference*
between them — and at 60 fps with zero jank there is currently no evidence it is
costing anything that matters.
