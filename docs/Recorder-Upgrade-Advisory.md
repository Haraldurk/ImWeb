# Recorder Upgrade — Senior Advisory (for Claude Opus)

Date: 2026-08-16. Author: recon pass (Kimi). Audience: the agent implementing
this. **Read `docs/Recorder-Frame-Rate-Investigation.md` first** — it holds the
measurements this advisory stands on, and its method (ffprobe PTS gap
distributions, not page-side fps) is the acceptance test for everything below.

Companion probe: `tests/rec-capability-probe.html` — open it in the owner's real
Chrome to re-verify the capability table in §2 (see the headless caveat there).

**Correction 2026-08-16 (same day, post-review):** the first revision of this
advisory ranked VP8 above VP9 in the fallback order, repeating the
investigation doc's pre-1440p recommendation. PR #72 measured that
recommendation and rejected it — VP8 falls off a cliff above ~2048 px wide.
§3, §4-phase-1 and §6 are corrected; the investigation doc itself carries the
strike-through.

---

## 0. The three questions, answered

**1. How do we maximize framerate and quality?**
Stop encoding VP9 in software. On the owner's machine the recorder's measured
limiter is the capture/encode path, and it scales with pixel count
(0.58 MP → 57.6 fps, 2.06 MP → 30.3 fps, 4.67 MP → 19.0 fps — investigation
doc, "The answer"). The render loop already runs at 60 fps with zero jank
during recording. The fix is in the recorder, not the renderer:
hardware-encoded H.264/HEVC instead of CPU libvpx, and a record resolution
decoupled from however large the window happens to be.

**2. What is the absolute best format?**
For this instrument, on this machine: **MP4 containing H.264 (High profile) or
HEVC + AAC, encoded in hardware (VideoToolbox) via WebCodecs, muxed with
Mediabunny, streamed to disk.** That is the real-time ceiling — every frame the
render loop draws, at up to 4K60, at bitrates (20–80 Mbps) that make the
current 8 Mbps VP9 look starved, at a fraction of the CPU cost.
Honest footnote: "absolute best" beyond that is *not* a real-time format at
all — visually-lossless masters (ProRes-class) require an offline pass. The
app's existing PNG Frame Capture panel is already the seed of that path; see
§5, phase 3.

**3. Should there be two modes?**
Yes. They have genuinely different design constraints, and one mode cannot
serve both:

- **LIVE** — records while performing. Hard requirement: never add main-thread
  or GPU cost that could drop the instrument below 60 fps. Output must be
  "good enough to post" without further work.
- **MASTER** — records for keeps/editing. Allowed to cost more per frame
  (higher bitrate, bigger resolution, optional offline finishing), as long as
  the render loop still holds 60 — which the measurements say it does.

Both modes should share one code path where possible (§4); the mode is a
settings bundle, not two recorders.

---

## 1. Current state (verified 2026-08-16)

Two independent recorders, no shared code:

**Output recorder** — `src/main.js:6065-6149` (button `#btn-record`):
- `canvas.captureStream(60)` — the 60 is a cap; frames emit on canvas commit.
- Mime preference (`_recMimeType`, `src/main.js:6107-6112`):
  `video/webm;codecs=vp9,opus` → `vp8,opus` → `video/webm`.
- `MediaRecorder` at `videoBitsPerSecond: 8_000_000`,
  `audioBitsPerSecond: 192_000`, timeslice 100 ms.
- Audio tap: `_attachRecordAudio` (`src/main.js:6080-6094`) connects
  `engine.node` (post-limiter master, inside the tape worklet) to a
  `MediaStreamAudioDestinationNode` and adds that track. **This tap is correct
  — keep it.** Engine off → video-only with a console notice, deliberate.
- Save: Blob → `<a download="imweb-<ts>.webm">` → browser download dir.

**Clip Library recorder** — `src/io/ClipLibrary.js:41-104`: same captureStream
pattern, VP9 only, **no audio, no vp8 fallback**, stores to IndexedDB.
`clip.recordSrc` (Out/Cam/Mov/…) is registered and visible in the UI but the
record path ignores it — always captures the main canvas
(`src/main.js:3966-3985`). Unwired param; either wire it or hide it.

**Resolution:** recording resolution == render resolution, always. The I/O
panel "Record" select writes the *same* `output.resolution` param as "Display"
(`src/main.js:3334-3343`, comment: "linked to Display until independent REC
target is built"). Render resolutions go up to 4K since PR #66
(`RENDER_RESOLUTIONS`, `src/main.js:6899-6912`). `setPixelRatio(1)` is forced
and now audit-protected (`tests/audit-pixel-ratio.mjs`).

**No test coverage of the recorder itself.** Only the pixel-ratio audit exists.

## 2. Machine capability probe (owner's machine, Chrome 151)

Probed with `tests/rec-capability-probe.html` in headless Chrome 151
(Intel Mac, AMD 5500M, 8 cores, 32 GB):

- `MediaRecorder.isTypeSupported`: **all true** for `webm;vp9/vp8/av01+opus`,
  and for **`mp4;avc1.640032+mp4a.40.2` (H.264+AAC)**, `mp4;avc1+opus`,
  **`mp4;hvc1/hev1+mp4a` (HEVC!)**, `mp4;av01`, bare `video/mp4`.
- WebCodecs `VideoEncoder.isConfigSupported` at 1080p / 1440p / 4K:
  - **H.264 High and HEVC Main: `prefer-hardware: true` at all three
    resolutions** (4K needs level 5.1 — `avc1.640033`; L5.0 is refused at 4K).
  - VP9, VP8, AV1: `prefer-hardware: false` everywhere. Software only.
    *This is the measurement the current VP9-first preference order ignores.*
  - AVC `bitrateMode: 'quantizer'`: supported (per-frame QP control, the
    closest browser equivalent of a constant-quality master).
- `AudioEncoder`: `opus` and `mp4a.40.2` (AAC) both supported.

**Caveat — re-verify headed.** Headless Chrome shares the platform codec
stack, and these results match what VideoToolbox on this hardware should
report, but the house rule (LEARNED 2026-08-13: automation panes lie about
media) applies: step one of implementation is opening
`tests/rec-capability-probe.html` in the owner's real Chrome and confirming
the table is identical. If MediaRecorder-MP4 differs headed, the WebCodecs
path (§4) is unaffected — it does not depend on MediaRecorder at all.

## 3. Codec verdict

| candidate | verdict |
|---|---|
| VP9/WebM (current) | **Retire as first choice.** Software libvpx on this GPU; measured fps limiter. Best remaining *software* fallback (see VP8 row). |
| ~~VP8/WebM~~ | **Do not use — corrected by PR #72's measurement.** The investigation doc's "promote VP8" recommendation predates the 1440p/4K presets and inverts above ~2 MP: VP8 falls off a cliff between 1964 and 2048 px wide (WebCodecs, 8 Mbps, 60 fps target: 117.5 vs 67.1 fps at 0.58 MP — VP8 wins; **7.7 vs 26.8 at 2048×1280 and 3.2 vs 21.6 at 1440p — VP9 wins**). Promoting VP8 would have been a 7× regression at a headline resolution sold as a performance fix. VP9-first is the correct software order at every resolution this app now ships. |
| **H.264/MP4 hardware** | **The workhorse.** VideoToolbox, all resolutions to 4K60, universal playback/edit compatibility. Default for both modes. |
| **HEVC/MP4 hardware** | ~30–40% better quality-per-bit than H.264 at master bitrates. Default for MASTER if the edit chain accepts HEVC; make it a setting, not a fork. |
| AV1 | Hardware decode exists; **encode is software** here. Slower than VP9 to encode. Not for recording. |
| AAC vs Opus audio | AAC (`mp4a.40.2`, 256 kbps) in MP4 for compatibility; Opus is fine inside WebM fallbacks. The tap point doesn't change. |

## 4. Recommended architecture

One recorder module (new: `src/io/OutputRecorder.js`), two settings bundles.
The current `btn-record` code in `main.js` moves into it; Clip Library is left
for phase 3.

### Phase 1 — same MediaRecorder, fixed priorities (small diff, big win)

1. Reorder `_recMimeType` to probe in this order:
   `video/mp4;codecs=avc1.640033,mp4a.40.2` → `avc1.640032,mp4a.40.2` →
   `video/webm;codecs=vp9,opus` → `video/webm`.
   **No VP8 entry at all** — PR #72 measured it falling off a cliff above
   ~2048 px wide (3.2 fps at 1440p vs VP9's 21.6); see §3. VP9 is the correct
   software fallback at every shipped resolution.
   Filename extension must follow the chosen container (`.mp4`/`.webm`).
2. Raise `videoBitsPerSecond`: 1080p ≈ 20 Mbps, 1440p ≈ 35 Mbps, 4K ≈ 60 Mbps,
   scaled from the actual capture size. The 8 Mbps ceiling is a quality cap
   that current files already brush against (measured 6.3 Mbps at 2 MP).
3. **Independent REC resolution.** Add a dedicated record canvas at a fixed
   size (default 1920×1080), fed by `drawImage(outputCanvas)` once per rAF,
   and `captureStream` *that*. This is the "fixed export resolution through an
   intermediate canvas" fix the investigation doc names, and it severs
   recording cost from window size — the single biggest fps variable in the
   measurements. Measure the drawImage cost with `__perfStats` before/after;
   if it shows, use a second WebGL context with a blit instead of 2D canvas.
4. Measure every step with the PTS-gap protocol from the investigation doc.
   Prediction to falsify: 1920×1080 H.264 hardware holds ≥58 fps mean with
   p95 gap ≤ 2 vsyncs.

### Phase 2 — MASTER mode: WebCodecs + Mediabunny, streamed to disk

MediaRecorder gives no keyframe control, no quantizer mode, no
hardware-acceleration hint, and buffers the whole take in RAM before the Blob.
Phase 2 replaces it for the master path:

- **`VideoEncoder`** (`hardwareAcceleration: 'prefer-hardware'`, H.264 High or
  HEVC, `bitrateMode: 'quantizer'` if quality-first, else VBR at the phase-1
  bitrates, explicit keyframe every 2 s via `encode(frame, {keyFrame})`).
- **`AudioEncoder`**: AAC 256 kbps, fed from the *same* post-limiter tap —
  but via the Web Audio side: the worklet already has the samples; add a
  ring-buffer port read (the audio engine already has this pattern for
  monitoring) rather than a second MediaStreamDestination.
- **Mediabunny** (`npm i mediabunny`, ~17 kB gz tree-shaken for MP4 write):
  `Mp4OutputFormat` + `CanvasSource`/raw `VideoFrame` source +
  `AudioBufferSource`, target = `StreamTarget` over a
  `showSaveFilePicker` writable — long masters never accumulate in RAM.
- **Frame pacing:** `captureStream(0)` + `track.requestFrame()` — or skip the
  stream entirely and construct `new VideoFrame(canvas, {timestamp})` in the
  render loop — so the file contains exactly one frame per rendered frame with
  true timestamps, instead of MediaRecorder's on-change capture. Guard: only
  emit when the loop actually drew (respect the existing midisync/autosync
  gating at `src/main.js:7310-7329`).
- LIVE keeps the phase-1 MediaRecorder path. It is simpler, streams fine, and
  needs no dependency; MASTER is where WebCodecs earns its complexity.

### Phase 3 — optional, only if wanted

- HEVC toggle, quantizer UI, bitrate/CRF presets.
- Offline "finish": transcode a master to ProRes/H.264-all-intra via ffmpeg
  *outside* the app — document the command, don't build it in.
- Clip Library recorder: share the module, add audio, wire or remove
  `clip.recordSrc`.
- The unexplained 0-byte `.webm` files when `btn-record` is driven
  programmatically (investigation doc, "Still unexplained") — worth one look
  while the code is open; not a blocker for normal use.

## 5. Acceptance tests (house style)

1. **The PTS protocol is the test.** Record 20 s of a busy scene at 1080p
   LIVE and MASTER; `ffprobe` the PTS gaps. Pass: mean ≥ 58 fps, p95 gap ≤
   33.4 ms, no bimodal distribution. The investigation doc has the exact
   commands.
2. Audio present and correct: ffprobe shows the audio stream; decode to WAV
   and check RMS ≠ silence, duration == video duration (the e86fdf6 commit
   message has the reference method: 12.000 s exact, mean −27 dB).
3. New audit: `tests/audit-recorder.mjs` — codec preference order, extension
   follows container, REC resolution decoupled from `output.resolution`, and
   the audio tap still lands post-limiter. Add mutations to
   `tests/mutations.mjs` for each check (house rule: an audit without a
   mutation is uncalibrated).
4. Verify in the owner's real Chrome, headed, foreground window — the pane
   gives 0 rAF callbacks and `--disable-audio` kills worklets
   (LEARNED 2026-08-04, 2026-08-13). Node-level maths tests are necessary,
   not sufficient, for anything UI-adjacent (LEARNED 2026-08-09).
5. Service worker: `public/sw.js` precaches the shell entry-by-entry; a new
   npm dependency needs no sw change under Vite's hashed assets, but verify
   the built `dist/` recording end-to-end with `vite preview`, not only dev.

## 6. What NOT to do

- Do not raise `captureStream(60)` — it's a cap, not a pacer; the doc proved
  raising it changes nothing.
- Do not touch the render loop, shader passes, or `setPixelRatio(1)` — the
  loop is measured clean at 60 fps and the ratio is audit-protected.
- Do not pick AV1 for recording — software encode, slower than the VP9 path
  being replaced.
- Do not promote VP8 anywhere in the preference order — PR #72 measured the
  cliff: 7.7 fps at 2048×1280, 3.2 fps at 1440p (VP9: 26.8 / 21.6). The
  investigation doc's original VP8 recommendation predates the 1440p/4K
  presets and is struck there.
- Do not buffer masters in memory (Blob-at-end) — stream to disk from the
  start; a 10-min 4K master at 60 Mbps is ~4.5 GB.
- Do not "fix" the bimodal 20/30 fps file by smoothing timestamps — that file
  was honest reporting of an encoder that couldn't keep up; fix the encoder.
- Do not remove `preserveDrawingBuffer: true` without measuring — it's a
  standing tax with currently no measured cost (doc §"The standing tax").
  If phase 1 shows the intermediate-canvas blit is cheap, the PNG capture
  panel is the only consumer left; consider `grabFrame()` for it later.

## 7. Suggested order of work for the implementing agent

1. Open `tests/rec-capability-probe.html` in real Chrome; confirm §2's table.
2. Phase 1, one commit per numbered item, PTS-measured after each (the doc's
   method caught a wrong conclusion in its own first draft — trust artifacts,
   not plausibility).
3. `npm i mediabunny`; phase 2 behind a `rec.mode` param (`live` default).
4. Audit + mutations; CHANGELOG; update this doc's status line.
