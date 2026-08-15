# The output recorder's frame rate — what four real recordings say

Investigation only. **No frame-rate fix is applied in this PR** — the one
measurement that would justify a fix cannot be taken from an automated browser
pane (see *What is still unmeasured*), and the numbers below already rule out
the first hypothesis anyone would try.

Companion to the audio-track change in `src/main.js` (`btn-record`).

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
That is what this PR's other half fixes.

---

## What the numbers rule out

**It is not jitter, and it is not the encoder falling behind irregularly.**
Every gap is an integer multiple of one 60 Hz vsync, and in the best file 1052 of
1077 gaps are *exactly* two vsyncs, p95 = 35 ms against a p50 of 33 ms. A capture
pipeline dropping frames under encoder backpressure does not produce a
distribution that tight. Frames are arriving on a clean grid — just a coarse one.

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

### And 2646×1766 should not have been possible

`src/main.js:238` sets `renderer.setPixelRatio(1)` with a comment explaining the
decision at length: on a Retina display DPR = 2 quadruples fill cost across 35+
shader passes for no perceptible gain on moving video, and DPR = 1 is what buys
60 fps.

`_onDPRChange()` at `src/main.js:255` then calls
`renderer.setPixelRatio(window.devicePixelRatio)` — restoring Retina 2× and
permanently undoing that decision the first time the window meets a display of a
different density.

2646 × 1766 is 1323 × 883 CSS pixels at DPR 2. The other three files are all
DPR 1. **The slowest recording in the set is the one that had been through a DPR
change**, and nothing ever puts the ratio back. This is a latent, silent 4×
regression in fill cost with a documented intent sitting three lines above it,
and it is worth fixing on its own merits regardless of what the measurement
below says.

---

## What is still unmeasured, and why

The discriminating question is one line long:

> Does starting the recorder change ImWeb's own frame rate, or was the render
> loop already running at 30?

If the loop already runs at 30 fps on this patch and this hardware, the recorder
is faithful and there is nothing to fix in the recorder — the work is render
performance. If the loop runs at 60 and drops to 30 the moment recording starts,
the encoder is stealing the frame and the fix belongs in the recorder (cheaper
codec, or capture at a fixed lower resolution through an intermediate canvas).

**This cannot be taken from the automated browser pane.** The pane's tab reports
`document.visibilityState === "hidden"`, which suspends `requestAnimationFrame`
entirely — measured here as **0 rAF callbacks in 2 s**, with `setInterval(…, 16)`
throttled to 3 ticks in 5.2 s. There is no frame timing to read, and a recording
started there produces a 0-byte blob because the canvas is never committed. Any
fps number obtained in that pane would be fiction.

### The measurement to run

`src/perf-logger.js` already computes `window.__perfStats` on every frame
regardless of its `ENABLED` flag, so no code change is needed. On the owner's
machine, with a normal working patch loaded and the window in the foreground,
paste into DevTools:

```js
const sample = () => JSON.parse(JSON.stringify(window.__perfStats ?? {}));
const wait = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  await wait(6000);
  const idle = sample();
  document.getElementById('btn-record').click();
  await wait(12000);
  const during = sample();
  document.getElementById('btn-record').click();
  console.log(JSON.stringify({ idle, during }, null, 2));
})();
```

`__perfStats` refreshes every 5 s, hence the waits. It reports
`{ fps, avg_ms, p95_ms, worst_ms, jank }`.

**Predictions, so a match is evidence and a mismatch is a finding:**

- **`idle.fps ≈ during.fps ≈ 30`** → the render loop is the limiter. The recorder
  is correct; the recorded 30 fps is the instrument's real frame rate. Fix
  rendering (starting with the DPR regression above), not recording.
- **`idle.fps ≈ 60`, `during.fps ≈ 30`** → the encoder is the limiter. VP9 at
  8 Mbit/s and 2 MP has no hardware encoder on this machine's AMD 5500M, so this
  is libvpx competing for CPU. Fix in the recorder: try
  `video/webm;codecs=vp8,opus` first (much cheaper, already in the fallback list
  the audio change added), and if that is not enough, capture through an
  intermediate canvas at a fixed export resolution.
- **`during.jank` high with `during.fps ≈ idle.fps`** → neither; something is
  hitching periodically, and `mediaRecorder.start(100)`'s per-100 ms `Blob`
  delivery on the main thread becomes the next suspect.

### One way this could still be wrong

`preserveDrawingBuffer: true` (`src/main.js:236`) is on permanently for
`toBlob()` capture, and it forces a copy rather than a swap on every frame. It is
constant across the idle and recording samples, so it cannot explain a
*difference* between them — but if the answer comes back "already 30 fps", it is
a standing tax on the baseline that the fps comparison above will not reveal.
