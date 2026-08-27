# Changelog

All notable changes to ImWeb are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
ImWeb uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

---

## [Unreleased]

### Added
- **ClipFade — switching clips on a deck can dissolve instead of cutting.**
  `movie.clipfade` / `movieB.clipfade` set the length in seconds; 0 is a hard
  cut and stays the default. Jump from clip 1 to 3 and the deck crossfades,
  with the outgoing clip still *playing* through the dissolve rather than
  holding a frozen frame. Switching again mid-fade retires whatever was
  fading out and anchors the new dissolve on the clip being left, so chaining
  1→2→3 never leaves three videos decoding.
  The outgoing clip is driven the same way the incoming one is, against its
  own duration — including under a controller on MoviePos, where the deck is
  paused every tick and the outgoing clip would otherwise have nothing driving
  it at all.
  The dissolve is substituted for the deck's texture before any source is
  resolved, so layers, all three mix buses and the TimeDisplace capture path
  get it without knowing it happened — no new source index; a deck mid-fade
  is still that deck. Targets allocate on first use, so a project that never
  sets ClipFade pays no VRAM.
- **MovieLen — the loop window's length as a control instead of an outcome.**
  A two-way view of (MovieEnd − MovieStart): dial it and End moves to
  Start + Len; move either mark and Len re-reads, so it can never drift into
  being a stale second copy. It anchors on MovieStart, so growing the window
  keeps the in-point you just found. Pair it with SlideRange — set the length
  you want, then MoviePos sweeps exactly that length through the clip. Cues
  need no change to carry it: Len is derived, so recalling Start/End restores
  it.
- **SlideRange — MoviePos can drag the whole in/out window through the clip.**
  By default MoviePos is a fraction *within* the Start–End window. With
  `movie.posslide` on it becomes the window's *position*, and MovieStart and
  MovieEnd move with it keeping their length: set a tight in/out — 28.4 % to
  28.6 %, about 60 ms of a 30-second clip — and dragging Pos sweeps that short
  loop through the whole piece. An LFO on MoviePos sweeps it on its own.
  The window keeps its length rather than being squashed, so near the tail it
  stops sliding at 100 % instead of collapsing, and the playhead travels with
  the window by the same offset so a slide never restarts the loop. Default
  off, so every existing project, controller mapping and cue keeps the old
  meaning of MoviePos exactly.
- **Eight cue slots per movie deck.** A cue captures MovieStart, MovieEnd and
  MoviePos together — recalling an in/out pair without the playhead that
  belongs to it lands you outside your own loop, so the three only mean
  anything as a set. The row sits under each deck's rack: clicking an *empty*
  slot stores (there is nothing to recall, so storing is the only thing a
  click can mean), clicking a *filled* one recalls, Shift-click overwrites,
  Alt-click clears. `movie.cueSlot` / `movieB.cueSlot` are real params, so a
  MIDI note recalls a cue by exactly the path a click takes; `cueStore` is a
  mappable trigger.
  Cue contents live in the **`.imweb` project file**, not localStorage — the
  deliberate difference from warp-map slots, whose per-origin contents mean
  different things on 5173 and 4173. The slot *index* is still group `global`
  and uncaptured, for a different reason: a Display State already captures
  start/end/pos directly, and capturing the index too would give those three
  values a second writer whose onChange fires after the restore.

### Changed
- **MovieSpeed now spans −5 – 5** (was −3 – 3), on both decks. Saved projects
  are unaffected: `captureState()` stores raw values, and the widening is
  symmetric so a controller's normalized centre is still 0.

### Fixed
- **Trimming a loop no longer strands the playhead outside it.** MoviePos is a
  fraction *of* the Start–End window, but the seek only fired when Pos itself
  changed, so raising MovieStart past a playing head left it behind the loop
  with nothing to recover it — Loop's wrap test only looks at the *end*.
  Moving a mark now leaves a playing head alone as long as it is still inside
  the window, and steps it back to the nearest edge only when the trim passes
  it. Trim while it plays and it keeps playing; trim past it and it steps in.
  Unchanged when SlideRange is on, where Pos drives the window instead.
- **Shift+0 selects the first clip; Neutral State moved to Cmd+Shift+0.**
  `Shift+0` used to reset the entire patch — no confirmation — from one key
  away from `Shift+1–8` clip select, so reaching for the first clip repainted
  the screen with the neutral palette (red). `Shift+0` is now an alias for
  clip 1, and `Option+0` is the same on Deck B. Note the app already had a
  second, *confirmed* reset on `Shift+Esc`, which additionally clears
  controller assignments; Neutral State is the one that keeps them.
- **Shift+0 says what it did.** It resets every parameter to defaults — which
  paints the neutral red — and it sits one key away from `Shift+1–8` clip
  select while doing something far larger. It used to do it in total silence.
  It now flashes "Neutral State — all parameters reset". The binding is
  unchanged; only the silence is.
- **MovieSpeed 0 threw inside the render loop.** `v.playbackRate =
  Math.max(0.01, speed)` wrote 0.01 whenever speed was 0 — the documented
  "0 = pause" — and Chrome raises `NotSupportedError` for any rate outside
  [0.0625, 16]. `tick()` runs in the render loop with nothing catching it.
  Speed 0 now pauses, which is what holding a frame actually is; anything
  below the browser's floor plays at the floor, and the assignment is guarded
  so an engine with a narrower range can never kill the loop.
- **An inverted MovieStart/MovieEnd froze the clip and killed MoviePos.**
  Nothing stopped End being dragged below Start, and `Math.max(endT - startT,
  0.001)` then collapsed the range to a millisecond: every MoviePos value
  mapped onto startT, and Loop's wrap test was already true on arrival so it
  re-seeked every frame. Both controls still moved, and neither did anything —
  indistinguishable from a broken binding. The pair is now ordered at the one
  read site, so an inverted range simply plays as the window between the marks
  and whatever you typed is left intact.
- **The keyboard help overlay listed 24 of the 34 bound keys.** `Option+1–8`
  (Movie B clip select) was missing entirely and `Shift+1–8` was labelled
  without naming Movie A, so the second deck read as having no keyboard at
  all. Also added `g`, `i`, `u`, `⇧Esc`, `✱ 0–9`, `⌘O`, `⌘F`. The box had no
  height limit, so a long list fell off short windows unreachable; it is now
  three columns with `max-height` and scroll.
- **Clip select on an empty slot said nothing.** `Shift+1–8` and `Option+1–8`
  silently swallowed the key when the rack had no clip there — and Deck B's
  rack is empty on every fresh launch, since only Deck A auto-loads from the
  manifest. Both decks now flash the reason.
- **The recorder writes MP4/H.264 in hardware instead of WebM/VP9 in software.**
  VP9 has no hardware encoder on Intel Macs with AMD graphics — it is libvpx on
  the CPU, and it was the measured limiter on recording frame rate (57.6 fps at
  0.58 MP falling to 19.0 at 4.67). H.264 and HEVC both encode in hardware at
  1080p, 1440p and 4K. The preference order is now
  `mp4;avc1.640033,mp4a.40.2` → `avc1.640032,mp4a.40.2` →
  `webm;vp9,opus` → `webm`, and the saved file's extension follows whatever
  container was actually written rather than always saying `.webm`.
  VP8 is deliberately absent: it is faster than VP9 below ~2 MP and roughly
  **7× slower** at 1440p, so promoting it — as an earlier document
  recommended — would have been a large regression at a resolution this app
  now ships.
- **Recording bitrate scales with the frame size.** A flat 8 Mbit/s starved a
  4K take four times harder than a 1080p one. Now ~0.16 bits per pixel per
  frame, clamped to 8–60 Mbit/s: about 20 Mbit/s at 1080p, 35 at 1440p.
- **The recorder no longer asks for a data chunk every 100 ms.** That was the
  timeslice from the MDN example, carried in with the first recorder in v0.1
  and never revisited; nothing in the app read the chunks before the recording
  stopped, so it was a dead parameter. Removing it changes no behaviour and no
  memory usage.

### Fixed
- **Recording no longer gets slower the longer you use it — and this was the
  frame-rate ceiling.** The object URL created to trigger each download was
  never revoked, so every completed recording stayed resident for the life of
  the page: four 60-second 1080p takes retained 162 → 281 → 391 → 487 MB, and
  the frame rate fell 31 → 21 → 22 → 18 fps with a 120–190 ms stall recurring
  twice a second. With the URL released, **five consecutive 60-second takes
  hold 55.9–58.1 fps** with stalls at 0.02–0.22/s and a flat rate inside every
  take. Every other download path in the app already revoked its URL; the
  recorder, whose blobs are by far the largest, was the one that did not.

### Added
- **Independent record resolution.** The I/O panel's `Record` select used to
  write the *same* parameter as `Display` — its own comment admitted it was
  linked "until an independent REC target is built" — so recording cost tracked
  whatever size the window happened to be, which was the largest variable in
  the frame-rate measurements. It now records through a fixed-size canvas at
  720p/1080p/540p/1440p/4K, or `Disp` to capture the output canvas as before.
  The output is stretched to fill the chosen size, so recordings are always
  standard dimensions with no black bars and nothing cropped; size the window
  16:9, or set `Display` to a 16:9 preset, if a piece needs exact geometry.
- **`tests/audit-recorder.mjs`** — the recorder's codec order, container-correct
  naming, resolution decoupling, absence of a chunk cadence, and post-limiter
  audio tap are all decisions that fail *silently* when undone: the file still
  records, it is just slower, mis-named, window-sized, or not the signal the
  audience heard. 12 mutations, all caught.

### Known
- Recording with the audio engine running costs about **3%** of the frame rate
  — 57.9 fps average without, 55.9 with, measured over five 60-second takes.
  Small, consistent, and not worth trading the sound for.

---

## [0.21.1] — 2026-08-15 — Reaching the Second Screen

v0.21.0 raised the output ceiling to 4K and left the one display that matters
most to a performer still capped at 1080p. Both items here came straight back
from the tester it was built for, within hours of him pulling it.

### Fixed
- **The second screen can receive 1440p and 4K.** `2Display` is a separate list
  from `Display`/`Record` and was never extended: it offered `Same/1080p/720p/540p`
  and **defaulted to 1080p**, so a 4K project was silently downscaled on its way
  to a projector. The picture the audience sees was the one place the new
  resolutions could not reach. The list is now largest-first —
  `Same/4K/1440p/1080p/720p/540p` — and the default is unchanged at 1080p,
  because raising a ceiling is not the same as raising a default: 4K readback on
  every other frame is a real cost, and it should be asked for rather than
  assumed.
- **`2Display` says what it does.** It was a row of resolution-looking values
  with no indication of their meaning, and the first question about it was "what
  exactly does it refer to?". It is not the second screen's resolution — it is
  the size the picture is resized to *before being transferred* to that window,
  a detail/cost dial, with `Same` meaning no resize at all. Both the row and the
  control now carry that explanation.
- **Second-screen fullscreen no longer leaves a white bar at the top** in
  Chromium browsers. The output window called `requestFullscreen()` on `<body>`
  rather than on the document element, which leaves the html element visible
  behind it as a strip. Reported on Brave and Zen; Safari tolerated it, which is
  how a bug like this survives being tested in one browser. The main window has
  always fullscreened the document element — the popup was the only place that
  did not.

---

## [0.21.0] — 2026-08-15 — The Resolution

A beta tester on a 4K monitor reported that the Rutt-Etra was "not convincing"
and asked for higher output resolution. Both halves of that were true, and
neither was the whole story: he had also, separately, been *changing his
monitor's resolution* in order to read the interface at all — which is what made
the picture look soft in the first place. One cause, two symptoms, and the
symptom that got reported was the downstream one.

So this release is about resolution in three senses: the interface at a legible
size on a dense display, the output at 1440p and 4K, and a Rutt-Etra scan that
finally keeps gaining detail across the whole range of its Lines knob.

### Added
- **UI scale, and an interface that survives a 4K monitor.** New `UI Size`
  control in the I/O panel (Auto / 100–200%). On a display the OS is *not*
  scaling — a 4K panel run at native 3840×2160, where `devicePixelRatio` is 1 —
  the panel's 8–10px type was rendering at half its intended physical size, to
  the point that a tester was dropping his monitor's resolution just to read it,
  which is what made the picture look soft in the first place. Auto detects the
  case from pixel density and applies 1.5× or 2×; it is a no-op on every HiDPI
  display, where CSS pixels are already the right size. Stored per-origin in
  localStorage and deliberately *not* a captured parameter — the correct value
  belongs to the monitor, not to the patch.
- **1440p and 4K output resolutions.** `Display`/`Record` in the I/O panel now
  reach 2560×1440 and 3840×2160, appended after `¼` so existing saved states
  keep their indices. These are fixed render sizes, not display-derived — the
  canvas gets a true 4K backing buffer and letterboxes into whatever container
  it is in, so a 4K screen is needed to *see* it 1:1 but not to *produce* it.

### Fixed
- **The output recorder now records the sound too.** `canvas.captureStream()`
  returns video only, so every recording ImWeb has ever made had no audio track
  at all — confirmed on four real files, each of which `ffprobe` reports as a
  single `codec_type=video` stream. Not a silent track: no track. The recorder
  now taps the audio engine post-limiter through a
  `MediaStreamAudioDestinationNode` on the engine's own `AudioContext` (the
  one-context decision from the audio build is what keeps this a second edge on
  an existing graph rather than two clocks to align), adds that track to the same
  `MediaStream`, and records `video/webm;codecs=vp9,opus` at 192 kbit/s audio.
  Monitoring keeps playing while recording. With the audio engine off, the
  recording is video-only as before and the console says so — a track of digital
  silence would look like captured audio that came out empty.

- **A display change no longer quadruples the cost of every frame.**
  `renderer.setPixelRatio(1)` is a deliberate decision — on a Retina display
  DPR 2 doubles every dimension, quadrupling fill cost across 35+ shader passes
  for no perceptible gain on moving video. `_onDPRChange()` then adopted
  `window.devicePixelRatio`, undoing it permanently the first time the window
  met a display of a different density, with nothing to put it back. The picture
  is identical either way, so the only symptom was an instrument that became four
  times more expensive to draw at a moment nothing correlated with. Found by
  reading frame timestamps out of four real recordings: the only DPR-2 file in
  the set ran at 19 fps against 30 for DPR-1 files at half the pixels. The
  handler now re-asserts `1` and keeps doing the two things it is actually for.
- **Floating surfaces land where you click them at any UI scale.** Found in code
  review, not testing — at 100% the bug is invisible by construction. The
  parameter context menu, controller popover, detached panels, the floating
  signal path, the on-screen keyboard, the slot picker and the buffer slot menu
  all wrote a viewport coordinate straight into `style.left`, which a zoomed
  element then multiplies again: at 200% the badge menu opened twice as far from
  the pointer as the click, and a detached panel opened off the right edge of a
  4K screen with its own drag handle out of reach. All now go through one
  conversion helper.
- **Modals fit the screen at any UI scale.** The docs viewer's fixed `80vh`
  became 160vh at 200%, clipping its own titlebar and close button off the top.
  Viewport units and safe-area insets inside scaled chrome now divide out.

### Changed
- **The `≥2560px` breakpoint no longer claims to fix type size.** Its
  `body { font-size: 14px }` was measured to reach zero visible elements — all
  198 `font-size` declarations in `style.css` are set on the elements
  themselves, and a declaration always beats inheritance — so the block was
  growing spacing while leaving every glyph untouched. `--ui-scale` does that
  job now; the wider panel and taller rows remain.
- **Rutt-Etra reaches a real scan density.** `rutt.lines` now goes to 1080
  (was 480), and the horizontal sample count is no longer pinned at 512 — above
  256 lines the scan used to get denser vertically while staying exactly as
  coarse horizontally, so the top half of the Lines knob added nothing. Columns
  now track lines 2:1 up to 2048, and the slew history follows at 2048² so it
  is never the limiting term. The top of the range is heavy on purpose:
  1080 lines is a 1080×2048 lattice, ~4.4M vertices, and re-dragging Lines up
  there stalls while the grid rebuilds. The default stays 120.

### Tests
- `tests/audit-pixel-ratio.mjs` — every `setPixelRatio` call in `src/` must pass
  the literal `1`, and `_onDPRChange` must still re-assert the ratio, re-sync
  through `applyResolution`, and re-arm its own `{ once: true }` listener. Runs
  against sanitized source, because the fix's comment quotes the forbidden call
  while explaining why it is gone. Three mutations registered and 3/3 caught.

### Docs
- `docs/Recorder-Frame-Rate-Investigation.md` — frame-timing measurements from
  five real recordings. **The recorder's low frame rate is the capture/encode
  path, not the render loop**: the loop holds 60 fps with zero jank whether
  recording or not, while the recording itself runs at 57.6 fps at 0.58 MP,
  30.3 at 2.06 MP and 19.0 at 4.67 MP. No frame-rate fix applied yet — the two
  candidates (VP8 instead of VP9, a fixed export resolution through an
  intermediate canvas) are named and left to be measured the same way.

---

## [0.20.0] — 2026-08-15 — The Other Half

ImWeb has been a video instrument that could *listen* — sound-reactive
controllers have driven the picture since early on. This release gives it the
other half: a tape it can record onto, scrub, paint into and play back, with the
picture deciding what it sounds like.

Two things are worth knowing before the list. **The audio engine never starts by
itself** — it takes a deliberate Audio On, because an AudioContext created
without a gesture is silently suspended, and because an instrument should not
seize the sound card merely by being open. And **it will tell you when the room
is a wire**: with a microphone open and monitoring set to speakers, the signal
path draws the closed `mic → tape → speakers → mic` loop rather than leaving you
to discover it at volume.

### Fixed
- **Changing the recording partition while recording now springs back and says
  why, instead of showing a change that did not happen.** `Partition Rec` was
  silently ignored whenever `Run Rec` was on: the button moved, the take went on
  landing in the old partition, and nothing reported it — so recording to P0,
  P1, P2 and P3 in turn put everything in P0. The button now returns to where
  the recording actually is, and the status line says *"recording — stop Run Rec
  to change its partition."* Stop the recorder, move it, start it again.

  Refused rather than applied, because a recorder mid-take has write state a
  playback zone does not: the write head would be reinterpreted against the new
  region and resume in the middle of it, and a dynamic recording's finish line
  would move mid-capture. Punch-in — end this take, start one over there — is a
  real thing to want and will be its own control, not a reinterpretation of this
  one.

  The first attempt at this fix only made the *engine* refuse, which kept the
  audio right and left every visible surface wrong together: the button read P1,
  the tape display drew the REC band over P1 because it reads the parameter, and
  the recording was still in P0. The parameter now goes back too, so there is no
  moment where the interface claims something that did not happen.

- **The master Fade works.** Raising Fade above 0 — by the slider, by **`h`
  (Hold / fade to black)**, by a controller, by a Display State recall or by a
  loaded project — threw `ReferenceError: interlaced is not defined` inside the
  render loop, stopping the picture on its last good frame. The Fade pass was
  still reading a variable that ceased to exist when interlace became
  `_FX.interlace` and moved into the reorderable chain. It went unnoticed
  because Fade defaults to 0, the one value that keeps the branch shut — so the
  most ordinary performance move there is, fading to black, was the trigger.

### Added
- **The spectral writer paints in stereo** (audio §4.5, §8.14). **Audio →
  Spectral Writer → Pan Image** decides where each part of the picture sits
  between the speakers, with **Pan Width** for how far out it goes.

  Four choices. **Colour** reads the red-to-blue balance — the channel the
  writer otherwise throws away — so warm and cool parts of the same frame land
  on opposite sides. **Spread** puts pitch across the image, lowest left. **Sweep**
  travels left to right across the render's own duration. **Off** is the default
  and renders mono, exactly as before, so nothing you have already made changes.

  Colour asks where the *sound* in each cell is rather than where the pixels
  are: a bright stroke keeps its position instead of drifting toward centre
  because it happens to be surrounded by black. The pan law is equal-power, so
  moving a stroke across the stereo field does not change how loud it is.
- **The audio graph is in the signal path display, and the loop is drawn**
  (audio §8.6, §8.13). While the engine runs, a second row appears under the
  video chain: `mic → rec P0 → tape 60s → play P0 → limit → ▶ speakers`. When
  the room closes the path, a bracket is drawn underneath it, returning from the
  monitors to the microphone — the one edge that cannot be a row of nodes,
  because it goes backwards.

  It distinguishes two states the warning line could not. **Dashed and grey**:
  the room is a wire, but nothing is driving it — no recorder writing the mic,
  or no reader reading it back. You are one Run toggle from a howl, and the row
  says which toggle. **Solid and red**: a recorder and a reader on the same
  material, and you are in it. That is the whole point of drawing a loop rather
  than announcing one — you can see *which link to open*.

  The monitoring line stays where it was, beside the switch. The signal path
  strip can be hidden, and is by default; a safety marking whose only surface is
  optional is one that is off for most people.
- **A monitoring switch** (audio §8.6) — **Audio → Monitoring**, Headphones or
  Speakers, sitting directly under Mic because the two are the halves of one
  question. It tells ImWeb whether `mic → tape → speakers → mic` is a real
  acoustic path, and when it is, a persistent line names that whole closed path
  so you can see which link to open. It replaces a warning that used to fire
  unconditionally — "USE HEADPHONES" was advice rather than information, and
  said the same thing whether or not anything was actually looping.

  Speakers is the default deliberately: the instrument assumes the loop is
  closed until told otherwise, so the safe state needs no selection from you.
  The switch changes no level and no routing — only what the instrument knows,
  and therefore what it can tell you.
- **Setup acts can now refuse controllers.** Some controls are part of setting up
  a session rather than of playing it, and assigning an LFO to one is a hazard
  rather than a feature — a monitoring switch swept at 2 Hz is your own feedback
  exposure being modulated. Such parameters now show an inert controller badge
  ("Setup act — takes no controller"), offer no controller menu, and refuse
  assignment from **every** path — the badge, the context menu, the
  controller-of-controller layer, and a loaded project file, which could
  otherwise put back what the UI refuses. A setup act's value does not come from
  a file either: it describes the room you are in today, and a project authored
  on headphones must not silence the loop warning at a venue on a PA. Monitoring
  is the first; the rule was written down in the audio blueprint long before
  anything could enforce it.
- **The corpus index** (audio §4.6) — two new panels under **Audio**. Press
  **Analyse** and the tape is measured grain by grain into four descriptors:
  loudness, brightness, pitch and periodicity. The **Corpus** pad then plots
  every grain as a point in a 2D space whose axes you choose from those four,
  and dragging through the cloud picks the grain nearest your finger.

  The **Grain Player** is what plays it — a bank of overlapping windowed grains
  rather than a single playhead, because a playhead jumping between timestamps
  is a scrub: you hear the jumps, and holding still gives you one short loop
  buzzing at its own length. Grains let a *position* be held and come out as a
  texture. **Spray** scatters where each grain starts, which is what stops a
  held position being a buzz at the grain rate.

  Changing which descriptors are the axes **re-projects the measurements
  already held** — 3 ms on a 1332-grain corpus, against roughly twenty seconds
  to measure it. That is the whole point of an index rather than a second
  buffer. The pad writes ordinary parameters, so a hand, an LFO, a MIDI knob or
  the stroke looper all navigate by the same path.

  The analysis is **paced across audio quanta** like the spectral render, so it
  never interrupts what is playing, reports progress, and can be cancelled.
- **The spectral writer** (audio §4.5) — a new panel under **Audio → Spectral
  Writer** that turns the picture into tape. Whatever the instrument is
  currently showing, with the whole effect chain already in it, is read as a
  frequency-time image and rendered once into a partition, after which it is
  ordinary tape: scrubbed, played backwards, displaced from, like anything else
  you recorded. There is no transform in the playback path.

  The vertical axis is quantized to a **musical scale** — ten of them, including
  the harmonic series, with a Root, a row count and a column count. That
  quantization is the whole difference between this and noise, which is what
  Metasynth and UPIC found forty and fifty years ago. **Contrast** and **Floor**
  decide how much of the picture counts as sound; a camera frame is never
  actually black, and without a floor every pitch is faintly on at once.

  It renders **additively, one oscillator per row, not through an inverse FFT** —
  see §8.10 of the audio blueprint. FFT bins are evenly spaced and a scale is
  not, so an inverse transform rounds every degree onto the nearest bin and
  undoes the quantization the feature exists for. Measured: up to 73 cents off.

  The render is **paced across audio quanta**, so a fifteen-second render never
  interrupts what is already playing, reports progress while it runs, and can be
  cancelled. It cannot clip and it cannot write outside the region it was given.
- `tests/audit-unresolved-identifiers.mjs` — asserts that every free identifier
  in `src/core/` resolves to a declaration in its own file, which is the family
  the Fade bug belonged to rather than the single instance.
- `tests/audit-audio-spectral.mjs` — 50 checks on the spectral writer, every one
  measured on the samples it produced (pitch off interpolated zero crossings,
  energy by Goertzel) rather than asserted about the source. Calibrated by
  mutation: twelve deliberate breakages of the engine, twelve caught.
- `tests/audit-audio-monitoring.mjs` — 39 checks pinning the two rules §8.6 said
  would drift: the switch is not captured, and takes no controller by any path.
  Mutation-calibrated: twenty-one breakages, twenty-one caught.
- `tests/audit-audio-corpus.mjs` — 73 checks on the corpus index. The
  descriptors are checked against synthesized signals whose answers are
  arithmetic (a 220 Hz sine must read 220 Hz), and the nearest-neighbour search
  against brute force over 60 random corpora. Mutation-calibrated: eighteen
  breakages, seventeen caught, and the one that survives is documented in the
  file rather than papered over.
- `tests/audit-audio-pan.mjs` and `tests/audit-audio-signalpath.mjs` — 56 and 84
  checks on the pan image and the drawn loop. Two of the pan mutations found real
  faults rather than confirming absent ones: an even-sized gain table that put
  "centre" 0.15% to the left, and a crossfade check that passed on correct code
  by luck because two beating partials moved its measurement windows more than
  the effect did.

### Changed — for people working on ImWeb

- **`npm run mutate` — the mutation harness is committed.** Every audio audit
  claimed to be "mutation-calibrated", and every one of those numbers came from
  shell one-liners typed once and thrown away. An uncommitted calibration is
  indistinguishable from no calibration. There are now 48 registered defects with
  a stated consequence each; the runner asserts each one turns its audit red,
  restores from bytes held in memory (so uncommitted work in a mutated file
  survives), and proves the tree is green before it starts and after it finishes.
- **CI, a pre-push hook, and promotion pressure on the lessons log.** `npm test`
  runs on every PR, a pre-push hook blocks a red tree from leaving the machine,
  and `docs/LEARNED.md` entries tagged `[advisory]` — the one tag with no
  mechanism behind it — now fail an audit once they reach 90 days. The exits are
  promotion to a mechanism, refinement, or an in-entry explanation of why it must
  stay prose; deleting the lesson is not one of them.
- **`AGENTS.md` and `GEMINI.md` ship with the repo.** They were gitignored, which
  meant the instruction files for non-Claude agents existed on exactly one
  machine. Both now carry a pointer to the live advisory lessons, and an audit
  keeps it there.

---

## [0.19.0] — 2026-08-10 — The Second Pair of Hands

Everything here is the controller layer: being able to *assign* one, and the
shape of how it moves once assigned.

### Added
- **`⌘K` / `Ctrl+K` opens parameter search on any keyboard layout.** `/` is
  unreachable on Nordic layouts — there it is `Shift`+`7`, which clip select
  claims first — and the `þ` alias is something only an Icelandic user would
  ever discover. Matched on the physical key, so it works whatever the keycap
  says. `/` and `þ` are unchanged.
- **The LUT panel heading explains itself** on hover: a look-up table is a
  colour recipe in a `.cube` file that remaps the whole picture at once.

- **Slew curves.** Slew gains a response curve, set in the badge popover
  (*Slew curve*) or by appending a word to Set Slew: `0.4 bounce`. The menu is
  in two groups because the split is structural, not cosmetic.

  ***Any source*** — filters, with no clock and no fixed endpoint. They chase
  whatever the target currently is, so they behave the same on a stepped source
  and a sweeping one.
  - **Lag** (`lag`) — unchanged, still the default. One-pole exponential:
    fastest at the instant the target moves, crawling the last of the way in.
    That opening lunge is what made a change of direction from S+H, Random or
    Square read as a snap.
  - **Ease in/out** (`ease`) — critically damped spring. Carries velocity across
    frames, so movement leaves at zero speed, gathers, and sets down without
    overshoot.
  - **Elastic** (`elastic`) — the same spring underdamped. Sets off from rest,
    overshoots by ~19% of the move and rings into place. Implemented as a spring
    rather than the textbook `easeOutElastic`, which covered **39% of the whole
    move in its first frame** at 60 fps — a snap with a wobble after it, and the
    one curve in the set that did not ease in at all. The spring also halves the
    overshoot (37% → 19%), most of which used to go into the `min`/`max` clamp
    rather than into the picture, and being a filter it now works on swept
    sources as well as stepped ones.

  ***Stepped sources*** — timed curves running a clock from a captured start to
  the target over exactly the slew time. That clock is the only way to overshoot,
  ring or bounce, and it is also the limitation: on a continuously sweeping
  source these add ripple instead of smoothing it (roughly 25–50× the
  frame-to-frame jerk of Lag or Ease against a 0.5 Hz sine). Built for S&H,
  Random, Square and MIDI notes.
  - **Super Ease in/out** (`ease2`) — quintic; a much longer loiter at each end.
  - **Exponential** (`expo`) — barely moves, then rushes through the middle.
  - **Bounce** (`bounce`) — arrives, then settles in four decreasing hops.
  - **Back** (`back`) — pulls backwards first, then overshoots and eases back.

  The timed curves land *exactly* on the target and in exactly the slew time,
  where the filters are asymptotic and arrive a hair short.

- **Back gains Strength** (0–3, default 1), scaling the single constant that
  governs both of its lobes, so its anticipation and overshoot grow together:
  ±3.1% of the move at 0.5, ±10.0% at 1, ±27.0% at 2, ±45.3% at 3, and no
  excursion at all at 0 (a plain in/out ease). It gets **no Damp** by design —
  damping describes how a *ring* decays and Back has no ring, making one
  excursion at each end and stopping. The excursion measurements that drive the
  rail fit are keyed by Strength and memoised, since they are markedly
  non-linear in it and a table computed once would mis-fit every non-default
  setting.

- **Elastic gains Strength and Damp**, the two constants of a spring, shown in
  the badge popover when Elastic is selected (and settable from Set Slew as
  `0.4 elastic 1.5 0.3`). **Strength** (0.25–4, default 1) is stiffness: higher
  is tighter and faster, more rings inside the same slew time. **Damp**
  (0.05–1, default 0.45) is damping: lower throws further past the target and
  rings longer, and at 1.00 the overshoot disappears entirely, which is Ease.
  The two are independent — Damp owns how far, Strength owns how fast.

- **Elastic now bounces off `min` and `max`** instead of pressing flat against
  them. Overshoot is a fraction of the *move*, so a large move landing near a
  rail throws well past it; clipping that silently meant the value parked on the
  limit for around a third of a second and the character disappeared exactly
  where S&H puts it most often. The spring now collides with the rail, reversing
  and keeping part of its speed, so the excursion that cannot be shown outwards
  is shown inwards as a rebound — 21 consecutive frames on the limit becomes 1.
  Restitution follows Damp, so a springier spring rebounds further and a fully
  damped one does not bounce at all. A move that had headroom is unaffected.

### Fixed
- **Ctrl+click can reach the controller menus again.** macOS fires `contextmenu`
  on *mousedown* for Ctrl+click and then still sends a `click` on release, so
  the close-on-outside-click handler shut both the row's assignment menu and the
  badge's settings popover the instant the button came back up. Anyone whose
  pointer has no secondary button — every trackpad at its default settings —
  could see the menu appear and never reach an item in it, which left the whole
  controller-assignment grammar unusable. Both now close on the next
  *pointerdown*, which can only be a new gesture. Reported by a beta tester on an
  M1 MacBook Air.
- **Ctrl+click on a state tile opens its menu instead of recalling the state.**
  The same mousedown/release mismatch, on the surface where it costs most: the
  menu closed on the release *and* the tile's own click handler fired, so
  reaching for Save here / Export / Clear jumped the whole instrument to that
  state mid-performance. Same fix on the Stills Buffer slot menu, where the
  stray click selected a different frame.
- **Ctrl+click on a value still only opens the type-in editor.** Ctrl+click is
  two gestures at once on macOS — `contextmenu` on the press, `click` on the
  release — so with the menus no longer closing themselves, the value column had
  to claim the press for itself. A real right-click on the value still opens the
  assignment menu.
- **Sub-headings in Effects (and LUT, and others) actually collapse now.** The
  arrow flipped ▾→▸ and the rows stayed exactly where they were, because the
  handler styled from a `.panel-subsection` ancestor that those sections do not
  have. A moving arrow that does nothing reads as broken rather than as
  unsupported, so the run of rows under a bare heading is now folded directly.
- **An empty parameter-search filter says why it is empty.** *Active* on a fresh
  session showed a blank box; it now says that no parameter has a controller yet
  and how to give one. Same for every other filter chip.
- **The guided tour's highlight is visible.** The flash was one 1.6 s pulse of
  the same yellow that means "this row has a controller", so it both said the
  wrong thing and disappeared into the rows that are legitimately yellow. It is
  now three pulses of blue over 2.6 s, with an outline and a glow.
- **Back no longer stalls when a move starts on a rail.** Back dips below its
  start before setting off; beginning a move at `min` makes that impossible, and
  letting the clamp absorb it froze the value for **ten frames at 60 fps** — a
  sixth of a second of nothing at the head of every move starting from the
  bottom of the range. Each lobe is now fitted to the room in front of it, and
  the opening dip is scaled in *time* as well, so travel begins on the first
  frame. The fit is gradual (a move from 0.02 gets a small dip, one from 0.20
  the full one) and a move with room at both ends is bit-identical to before.

  Back has no velocity to reverse, so it cannot bounce the way Elastic now does.
  A move that *ends* on a rail still cannot overshoot — nothing can travel past
  a maximum. Use a min/max sub-range if you want that overshoot everywhere; a
  shorter slew does not help, the overshoot being a fraction of the move rather
  than of the time.

  `slewShape` serializes with the parameter and defaults to `lag` on both
  construction and deserialize, so every existing state, bank and `.imweb` file
  recalls exactly as before; an unrecognised name also falls back to `lag`
  rather than breaking the tick.

### Changed
- **LFO and Random rate floor is now 0.001 Hz** (one cycle per ~17 minutes),
  down from a documented 0.01. The LFO field already accepted 0.001 but
  displayed it as `0.00`, so the slowest rates were invisible and read as a
  no-op; rate fields and the badge overlay now show 3 decimals. The free-Hz
  prompt path also gained the 0.001 floor it was missing — it previously
  accepted 0 or a negative rate, which stalled the LFO or ran its phase
  backwards.

- **X-Map onto an LFO's rate is now logarithmic**, over 0.05–20 Hz, and floored.
  Rate is heard as a ratio, so the old linear `travel × 20 Hz` wasted the
  control: everything below 0.5 Hz lived in the bottom 2.5% of the travel, which
  is not playable by hand. Equal moves now give equal frequency ratios — 0.01 Hz
  sits at 23% of travel, 0.1 Hz at 47%, 1 Hz at 70%. The floor matters
  independently: the bottom of the range used to be exactly 0 Hz, which *stops*
  the LFO rather than running it slowly, and nothing about the control tells you
  which of the two you have. Per-mapping `minHz`/`maxHz` override the defaults.

  **This changes existing patches.** An X-map targeting `hz` will play much
  slower than before — mid-travel moves from 10 Hz to 1 Hz. Re-dial affected
  patches.

### Fixed
- **The Phase control did nothing on a free-running LFO.** `phase` is read at
  construction and on retrigger only — a free-running LFO advances its own
  accumulator and never looks at the field again — so dragging Phase moved a
  number nothing consulted until the next Display State recall. It now shifts
  the running waveform immediately, by the delta rather than absolutely, so the
  knob slides the wave under the playhead instead of restarting the cycle.
  Beat-synced LFOs always read it live and are unchanged.
- **The LFO rate prompt could silently stop the LFO.** Its default was built with
  `toFixed(2)`, so opening it on a rate below 0.005 Hz pre-filled `0.00`; pressing
  OK unchanged then parsed to 0. The default now round-trips exactly at any legal
  rate, and the parse floors at 0.001 Hz.
- **Slow modulation no longer stutters.** `step` was doing double duty as both
  the UI drag increment and a hard quantization of the stored value, so a
  controller driving a `step: 0.01` parameter over a 0–1 range had only 100
  places to land. Measured over 10 s at 60 fps, a sine LFO changed the value on
  560/600 frames at 1 Hz but only 30/600 at 0.01 Hz and 4/600 at 0.001 Hz —
  roughly three visible jumps a second while the fps counter read a healthy 60,
  which is why this never looked like a rendering problem. Controller-driven
  writes now run at full float resolution. Integer steps are unaffected and
  still snap: `noise.octaves`, `sdf.count`, `rutt.lines` and friends *are*
  integers, and a controller sweeping them should step.
  Locked in by `tests/audit-modulation-resolution.mjs`.

---

## [0.18.0] — 2026-08-07 — The Way In

### Added
- **Help menu** — a `?` button in the status bar holding Guided Tour, Keyboard
  Shortcuts, the three manuals and About. It is now the only *persistent* route
  into the documentation: the first-run splash offers the tour once and then
  sets `imweb-onboarding-dismissed` forever, and the doc links previously lived
  at the bottom of the AI provider settings panel, where nobody configuring an
  API key is looking for a guided tour. Entries reuse the existing docs viewer
  and the `?` shortcut overlay rather than adding new surfaces.
- **Guided tour** (`⇧G`, the splash's Guided Tour button, or the `?` menu).
  Twenty-seven steps in three tracks, as a panel rather than a
  modal — it points *at* the control panel, so it must not cover it, and the
  instrument stays playable with the tour open.
  - **Basics** (9) — the panel, the parameter row, what min/max actually mean,
    assigning and editing a controller, response curves, states and morph, the
    performance keys.
  - **Principles** (6) — small patches, three or four moves each, one idea
    apiece: a composite is two layers; any source can drive any other; any
    parameter can be driven; the output is a source; time is an axis you point
    at; then all five in one patch. The examples are deliberately built from
    controls the Basics track has already covered.
  - **Instruments** (12) — the machines, as before.
  - Three tracks rather than one list because they are three different kinds of
    not-knowing: someone who cannot work a parameter row is not helped by a tour
    of the Rutt-Etra, and someone who has used the instrument for a year should
    not have to page through drag directions to reach it. The splash button
    opens Basics from the top; `⇧G` resumes where you left off.
  - **It points; it never sets.** Every step names its targets and gives you a
    chip per name that switches to the owning tab (opening a workspace if the
    target lives in one), expands the collapsed section, scrolls the row into
    view and flashes it. Your hand moves the control. A tour that set values
    would wreck a patch someone was halfway through, and it teaches nothing,
    because the hand that moved the control was not theirs.
  - **The content is one markdown file**, `docs/ImWeb-Guide.md`, parsed at
    runtime — readable on GitHub, sendable as an email, and editable without
    touching JavaScript. Steps are not duplicated into a JS array; that second
    copy is how six copies of the source list once drifted apart.
  - `tests/audit-guide-targets.mjs` fails the build if a step names a parameter
    that does not exist, a selector that is not in `index.html`, an unknown
    track, or if the served copy under `public/docs/` has drifted from the
    edited one. The failure it exists to catch is quiet: the tour still opens
    and the step still reads correctly, and only the chip does nothing.

### Changed
- **`Blend Amt` is a three-stop crossfade**: `0 %` Background alone → `50 %` the
  blend mode at full strength → `100 %` Foreground alone, defaulting to 50 %. It
  was a plain layer opacity (0 → BG, 100 % → the blended result), which is what
  every compositing program means by opacity but left no way to fade the
  Background out at all — with `Screen` at 100 % the Background was still
  plainly there. Only the FG layer takes the new curve, selected per-pass with
  `uCurve`: the BG self-process passes the same texture as both inputs, so its
  "Foreground end" would just be the Background again, and the feedback blend's
  saved amounts have to keep meaning what they meant.
- **Layer blend amounts are percent params** (`0–100 %`, schema 2). They were
  `0–1` while `blend.amount` beside them in the OSD was `0–100 %`. Legacy values
  migrate on every load path, scaling FG by **50** and BG by **100** — the old
  two-stop `mix(BG, blended, v)` is exactly the first *half* of the new FG
  curve, so an old `1.0` is 50 % (full blend), not 100 % (raw Foreground).
  Verified across `MasterProject.imweb` and `FactoryBank.imbank`: every saved
  value lands on the blend detent, so nothing changes appearance.
  `tests/audit-blend-percent.mjs` covers the conversion, the stamp gating, both
  path sets and the curve endpoints.
- **Layers panel** — the blend select sits on its layer's own row under `SOURCE`
  / `BLEND` column captions, and the amounts moved out of Layer Color to follow
  the mode they scale. `layer.bg.blend` is labelled **BG Self-process**, because
  it is one: Pipeline passes the Background as both `uFG` and `uBG`, making it a
  tone treatment of one picture rather than a meeting of two.
- **Documentation is served network-first** by the service worker. Cache-first
  served whatever revision a reader opened once and never refreshed it, so an
  edited manual could not reach anyone who had already read the old one. Falls
  back to cache when offline, which is the case cache-first was for.

### Fixed
- **`layer.bg.blendAmount` did nothing.** The BG self-blend hardcoded
  `uBlendAmount: 1`, so a control that was registered, documented, captured by
  Display States and MIDI-mappable moved nothing. It now drives the pass; its
  default is unchanged, so no existing patch renders differently.
- **A focused slider killed every single-key shortcut.** The keydown guard bailed
  on any `<input>`, and every param slider is an `input type=range` — so touching
  one slider disabled `q`/`a`/`z`/`v`/`m` for the rest of the session until focus
  moved elsewhere. It read as "the keys don't work on this tab", the tab being
  whichever one you touched a slider on. The guard now blocks only real text
  entry, and still yields arrows/space/Home/End to a focused widget.
- **The service worker could turn a storage hiccup into a phantom network
  failure.** Neither `caches.match()` nor `caches.open()` was guarded, and a
  rejection from either rejects the promise passed to `respondWith()` — which
  reaches the page as a bare `Failed to fetch`, with no status behind it and
  indistinguishable from the server being down. Every path is now wrapped, and
  the docs viewer retries once past the cache before reporting an error.
- **Service worker install failed on every built site.** `APP_SHELL` lists
  dev-only paths (`/src/main.js`, `/src/style.css`); `addAll()` is
  all-or-nothing, so one 404 rejected the install and the worker never
  activated. The shell is now cached best-effort, entry by entry.
- **`ImWeb_Quick_Start.md` was served but never synced.** It sat in
  `public/docs/` outside the `sync-docs` list, so the copy readers saw drifted
  from the edited one with nothing to flag it.
- **Guided tour corrections.** Principle 1 claimed `Blend Amt` crossfaded one
  picture into the other, which it did not; it also never mentioned that
  `FG Blend` defaults to `Copy`, which Pipeline skips entirely — so following
  the step exactly left the control inert. `g` was documented as cycling three
  canvas modes when there are five, and the warp-drawing step asked for "Pad or
  Locked" when warp drawing needs `Warp`.
- **The parameter search's ⌖ button did nothing on continuous rows** — every
  row with a slider, i.e. most of them. The row captures the pointer for its
  value drag, which retargets the pointer stream away from any button inside it,
  so the click never arrived. Buttons in a row now own their own gesture, the
  same exemption `.param-slider` already had.
- **⌖ also had nothing to find for four of the most-used controls.** Rows that
  are hand-built rather than produced by `buildParamRow` — Foreground,
  Background, DisplaceSrc, the Camera on/off row and the GLSL Preset row — never
  claimed their `data-param-id`, so search listed them and jumping to them
  silently failed.
- **Jumping to a search result now actually reveals it.** The old path only
  scrolled and drew an outline, so it did nothing whenever the target sat on
  another tab or inside a collapsed section — and sections boot collapsed, so
  that was most of them. It now shares one reveal with the guided tour: tab or
  workspace, expand, scroll, flash.

---

## [0.17.0] — 2026-08-05 — The Chain

*Everything downstream of the layers, gone over end to end. The feedback loop
gets the decay knob it never had — and stops occasionally deleting the live
picture. The effects chain gets five new effects, four more that were already
written and wired to something else, a master bypass, and labels that say what
their numbers mean. Three of the fixes here are the same shape: a control that
was live in the panel and dead in the render, or a chain that quietly dropped
what it did not recognise.*

### Added
- **All FX** — a master bypass for the whole post-FX chain. Not a mute: every
  parameter keeps its value and the chain keeps its order, so switching back on
  returns exactly the look you left. It skips the loop rather than each handler,
  so a bypassed chain costs nothing. A real parameter, not a panel button, so it
  is MIDI-mappable, controller-drivable and captured by Display States.
- **Clear All FX** — resets every effect parameter to its default. It does *not*
  touch the chain order (an arrangement you built on purpose) or the master
  toggle (clearing the effects and leaving them bypassed would look like the
  reset had failed).
- **Five new effects.** All default to off.
  - **Polar** — maps the frame between rectangular and polar coordinates, in
    both directions. It turns every other effect in the chain into a different
    one: a scanline becomes a ring, a horizontal wipe becomes a sweep.
  - **Wave** — sine displacement per axis, with frequency, amplitude and a
    phase made to be driven by an LFO. Each axis is displaced by the *other*
    axis's coordinate, which is what makes it a wave rather than a smear.
  - **Halftone** — ordered dot screen, mono or per-channel. The colour mode
    gives each channel its own screen angle, so the three grids rosette instead
    of beating into moiré.
  - **Duotone** — remaps luminance through a two-colour ramp. Shadows to one
    hue, highlights to the other.
  - **Lens** — barrel and pincushion on one signed control, plus twirl. With
    Scanlines it is a CRT; with Halftone it is a printed page photographed off
    one.
  - Polar, Wave and Lens share one centre and one edge mode (`Warp.Center`,
    `Warp.Edge`) — they are the three that sample outside the frame.
- **Four effects the codebase already had, now in the chain.** No new shader
  code behind any of them: **Sharpen** (`SHARPEN` drove only the noise
  generator), **Out.Hue / Out.Sat / Out.Bright** (`COLOR_CORRECT` drove only the
  per-layer tint, so the composite could never be turned), **Flip** (`MIRROR`
  was per-layer only), and **Interlace**, which moves from a fixed pass after
  the chain into the chain itself — same position, but reorderable.
- **Controls for things that were hardcoded**: Bloom radius, Scanline count,
  Solarize softness, Edge keep-colour, and a centre for both Kaleidoscope and
  Vignette, plus a vignette tint.

### Fixed
- **A saved fxOrder silently dropped effects it had never heard of.** The chain
  order is captured by Display States and written into `.imweb` files, and
  `setFxOrder` filtered to known ids — so every state saved before an effect
  existed recalled with that effect *absent from the chain*: row in the panel,
  slider moves, readout updates, nothing renders. Unknown effects are now
  appended at their default position. This is what makes the rest of this
  release reach existing patches at all.
- **Kaleidoscope worked in raw UV**, so its wedges were sheared on any
  non-square output, and `fract()` wrapped a hard seam through everything
  outside the disc. Aspect-corrected, with a real edge mode. **This changes how
  an existing kaleidoscope patch renders** — it is the one intentional visual
  change in this release.
- **Posterize and Solarize are OFF at their maximum**, the opposite of every
  other row in the panel. The mappings can't move without moving saved patches,
  so the labels now say what the number is: **Post.Levels** and **Sol.Thresh**.
- **Scanlines were pinned to 400 lines** regardless of output resolution, so the
  pitch meant something different on every display.
- **Film grain crawled instead of scintillating** — the seed offset the same
  amount on both axes, sliding one fixed noise field diagonally rather than
  drawing a new one each frame.
- **The signal-flow display claimed a LUT pass with no LUT loaded** — the node
  appeared whenever LUT Amount was above zero, which is true out of the box,
  while `_FX.lut` returns immediately without a `.cube`. It now asks the
  pipeline. The flow also listed every effect while the chain was bypassed;
  it shows a single `fx bypass` node instead.
- **The Effects panel was 29 rows in registration order**, mixing geometry,
  colour, texture and timing. It is five subsections now — Geometry, Optics,
  Quantise, Texture, Time — and Levels / White Balance move to the **LUT /
  Colour Grade** section that had been sitting under them holding a single row.
- **Transforming the feedback could delete the live picture.** The prev-frame
  rotate/zoom and offset/scale passes ping-ponged through the same two render
  targets that held the composited live frame, so whether the second transform
  overwrote it came down to how many passes the keyer/chroma/warp chain had run
  earlier that frame — parity, not intent. When it landed wrong, the blend got
  the transformed prev frame as *both* inputs and the live image vanished from
  the output. The feedback transforms now render to dedicated targets, allocated
  lazily so a project that never transforms its feedback pays no VRAM. The
  identity guard in `_pass()` could not have caught this: nothing is aliased at
  the moment of the write — the clobbered texture is read by a later pass.
- **BlendAmount was dead in XOR, OR and AND.** The bitwise branch of the
  transfer-mode shader returned before the mix, so three of the twenty-one modes
  ignored their own strength control, in the feedback blend and in the FG/BG
  layer blend alike. Copy (mode 0) still returns untouched — it is the identity
  pass, not a blend.
- **The BG self-blend ran at whatever strength another pass set last.** Its
  `uBlendAmount` was never passed, and the material is shared with the FG blend
  and the feedback blend.
- **The signal-flow diagram under-reported feedback** — it asked only about
  offset and scale, so a rig driven by FBZoom or FBRotate alone drew as "no
  feedback", and the Feedback toggle was not consulted at all.
- **Two units were lying.** FBRotate was labelled `°` but is percent of a turn
  (50 = 180°, not 50°), and the offsets were labelled `px` but are ‰ of the
  frame and fully resolution-independent. Labels only — no stored value or
  mapping changed, so every saved state renders exactly as before.

### Added
- **Feedback loop shaping** — seven parameters acting on the *recirculated*
  frame alone. `output.fade` and `output.colorshift` already sat inside the loop
  and could damp or tint a trail, but only by damping or tinting the live
  picture with it.
  - **FBDecay** — the missing knob. Nothing attenuated the recirculating image,
    so Add/Screen/Dodge blew out to white within a few frames and Multiply/Burn
    crushed to black; decay is what makes those modes playable.
  - **FBCenterX / FBCenterY** — FBZoom and FBRotate were pinned to the middle of
    the frame. The difference between one tunnel and a steerable one.
  - **FBEdge** (Clamp / Mirror / Wrap / Black) — what the loop finds outside the
    frame once it is shifted. Clamp is the smear it has always produced.
  - **FBBlur** — softens the trail per generation: the classic glow tunnel, and
    it suppresses the pixel-grid aliasing that builds up over long chains.
  - **FBHue** — hue rotation per generation, compounding around the loop, so a
    trail can walk through the spectrum as it decays.
  - **FBMirror** (Off / H / V / Both) — kaleidoscopic feedback.
  - Every default is the identity — decay 100 %, centre 50/50, Clamp, blur 0,
    hue 0, mirror Off — so existing patches render unchanged.

### Changed
- **Particle luma mask (PMaskSrc) now offers every source.** It had carried an
  eleven-entry hand-written menu since v0.11 — Camera, Movie, Buffer, Output,
  Draw, FG/BG/DS Src, Noise, Vectorscope — while every other selector grew to
  the full list, so masking particles with SDF, Motion, Rutt-Etra, a mix bus or
  Movie B was not expressible. The menu is now derived from `CAPTURE_SOURCES`
  (`PARTICLE_MASK_SRC` in ParameterSystem.js) and the texture resolves through
  the same `_resolveLayerTex()` every other selector uses.
  - Indices 0–10 are **frozen** in their original order, so saved states, banks,
    `.imweb` files and MIDI mappings keep pointing at the same thing. Two labels
    move to the canonical ones: *Movie* → **Movie A**, *Vectorscope* → **Scope**.
  - The mask is now part of the consumption fixpoint: picking a conditionally
    ticked generator (SDF, Rutt-Etra, Noise, 3D) keeps it running instead of
    handing the particles a target nobody updates.

---

## [0.16.0] — 2026-08-05 — The Motion Matte

*Two new sources, and the discovery that the instrument already knew how to make
things transparent — it just had nothing that produced a matte. Also two
verification debts from v0.12 closed on real hardware, and a colour-grade panel
that turned out never to have worked in WebGL2 at all.*

### Added
- **Motion Extraction** (Sources ▸ Warp ▸ Motion Extraction, source index 32) —
  a **matte**, not a picture: white where the source moves, black where it does
  not. Route it to the keyer's new Key src and the moving part of one layer
  shows over another, the rest transparent. That is the whole feature, and the
  reason it is one source rather than a subsystem: layers do not composite by
  alpha in ImWeb (`BLEND` is `mix(curr, prev, amount)`), so transparency only
  ever comes from the keyer — which already knew how to take an external matte.
- **One control spans both classical methods, instead of a mode select.** The
  background is an exponential running average of the source; comparing the live
  frame against it is background subtraction, and shortening the adapt time to
  zero makes the background exactly the previous frame, which is frame
  differencing. Same shader, no branch. This matters for the intended use:
  frame differencing alone shows only the *edges* of change and collapses the
  moment motion stops, so a person who pauses disappears — which reads as the
  effect breaking rather than as a property of the method.
- `motion.source`, `motion.gain`, `motion.bgtime` (background half-life in
  seconds, 0 = frame differencing) and `motion.trail` (seconds until a trail is
  gone). Deliberately **no threshold and no softness** — the keyer already has
  White / Black / Softness and this matte is its input, so a second set would be
  two controls doing one job.
- **`motion.blur` ("Smoothness")** — blurs the source *before* the comparison,
  reusing the bloom kernel rather than growing a second Gaussian. This is the
  control that makes a live camera usable: sensor grain is high-frequency, and
  before the difference is the only place it can be removed cheaply, because
  downstream it has already been multiplied by Sensitivity and accumulated into
  the trail. It also fills interiors — a blurred moving object differs from the
  blurred background across its whole *area* rather than only at its edges, so
  silhouettes come out solid instead of hollow. Its targets are allocated on
  first use, and the default of 0 reproduces the previous picture exactly.

  Both frames must be blurred: the matte, the background update and the priming
  blit all read the same processed frame. Comparing a blurred current against
  an unblurred background is a constant mismatch at every edge in the picture,
  which reads as permanent motion that no setting turns off.

  **Brightness and contrast were considered and rejected as dead controls.**
  Brightness shifts the live frame and the background by the same amount — the
  background is an average of past frames — so it cancels in `|cur - bg|` and
  would do nothing at any setting. Contrast scales both, giving `k·|cur - bg|`,
  which is exactly what Sensitivity already does.
- Trail is `max(motion, trail * decay)`, never `+=`: instant attack, exponential
  release, and bounded by construction, so where two moving things cross the
  matte holds at 1 instead of compounding toward white. Both time constants are
  in seconds against the real `dt`, following `rutt.rise`/`rutt.fall`, and `dt`
  is clamped so a tab regaining focus cannot wipe the trail in one step.

- **RGB Channel Delay** (Sources ▸ Warp ▸ RGB Channel Delay, source index 31) —
  per-channel time offset. Red, green and blue are each read from a different
  frame of history and packed into one picture, so a moving edge separates into
  coloured fringes trailing its own past. Anything still stays exactly itself:
  where three frames agree, taking one channel from each reproduces the pixel,
  which makes equal values on all three a bit-exact passthrough rather than a
  near-miss.
- It owns **no history**. It reads the `VideoDelayLine` ring that is already
  captured every frame for Video Delay, so it costs one render target and one
  pass instead of a second ring — the expensive part of a time effect is the
  buffer, and this one is second-hand. The consequence is deliberate: the
  channels come from `delay.source`, so `Delay src`, `Ring depth` and
  `Buffer res` are its controls too. One ring, two views of it. The design note
  that proposed this as "three `SpacetimeTap`s" was wrong about the mechanism —
  `getTexture(framesAgo)` already returns any frame by age, so no Spacetime
  machinery is involved at all.
- `rgbdelay.r` / `rgbdelay.g` / `rgbdelay.b`, 1–480 frames, defaulting to a
  visible 1 / 5 / 9. **Minimum is 1, not 0**, because `getTexture()` clamps with
  `Math.max(1, framesAgo)` — ages 0 and 1 are the same frame, so a 0-based range
  would alias its bottom two steps and sample two frames while appearing to
  offer three. That is not a theoretical concern: a 0/1/2 test came back grey
  because red and green were identical by construction, and it reads as "the
  effect barely works" rather than as an off-by-one.
- The output target **sizes itself from the ring every frame** rather than from
  the canvas at construction. `setBufferResolution` fires only on *change*, so
  anything sized once at boot inherits `canvas.parentElement.clientWidth` —
  which is 0 in a page that boots hidden, leaving a 0×0 target that draws into
  nothing and never errors.
- **`?soak=1` instrumentation** (`src/soak.js`) — inert without the URL param.
  Installs `window.__dbg` (a one-call readout of every patch precondition) and
  POSTs `window.__perfStats` to a `/__soak` sink on the vite server every 5s,
  appended as NDJSON to a gitignored `soak.log`. This exists because a remote
  Safari Web Inspector is a single point of failure for a 40-minute run: when it
  drops, the phase becomes unreadable even though the page is still sampling
  fine. Registered on the dev **and** preview servers, for the same reason the
  raw-video route is. Gated on a URL param rather than `import.meta.env.DEV`,
  because soak runs are verified against `vite preview` — a production build, so
  a DEV guard would be dead code at the only line that evaluates it.
- **Per-deck upload counters** — `MovieInput.stats` (`ticks`/`gated`/`uploads`),
  carried on every telemetry row as `upA`/`gA`/`upB`/`gB`, cumulative so a
  dropped row costs nothing. Every telemetry row also carries the phase-defining
  parameters, so a run proves its own conditions instead of relying on memory.

### Changed
- **The keyer's external key has its own source selector** (`keyer.keysrc`,
  Mix ▸ Keyer ▸ Key src). ExtKey was hardwired to the DisplaceSrc texture, so
  keying externally *cost* you displacement — one slot doing two unrelated jobs.
  Default is "DS Src", the old wiring, so every saved state, bank and `.imweb`
  project keys exactly as before. Declared against `CAPTURE_SOURCES`, which is
  what enrols it in the capture-base migration: a param declared against a
  hand-written copy of that list would be silently absent from it.

  Worth knowing when keying on a matte — the keyer passes a *band*, so it
  rejects the very bright as well as the very dark. At the default
  KeyLevelWhite of 80% a fully lit matte is keyed **out**, which looks like the
  strongest motion being the one thing that fails to show. Set KeyLevelWhite to
  100% and let KeyLevelBlack do the cutting.

### Verified
- **Dual-deck thermal + decoder budget — PASS.** Four phases, ~55 min on a real
  iPad over LAN, full chain (keyer + 91% displacement + Displace-mode mix bus):
  avg_ms 16.675 / 16.670 / 16.670 / 16.670 for deck-B-empty, loaded-idle,
  both-live and recovered. P2vP1 −0.03% (criterion 15%), P4vP2 0.00%
  (criterion 10%), P3 sustained 60fps at p95 17ms. Zero drift in every phase;
  `worst` frame time *fell* 56 → 26 ms across the run, so there is no thermal
  ceiling here. **Two 1080p ALL-I streams fit this device's budget with headroom.**
- **v0.12 idle-deck upload gating — CONFIRMED, by counting rather than by soak.**
  At `mix.xfade` 0, Deck B logged +3917 gated and +0 uploads over 65s with its
  upload counter frozen; flipped to 0.5, +46616 uploads and +0 gated. A clean
  inversion in both directions, which is what separates a working gate from a
  stuck counter. Deck A independently showed 175 real gated events, so the
  `_uploadA` hidden branch fires too.
- **The tab bar — PASS, on a premise that had already expired.** Phase 24 cut the
  bar from 8 tabs to five fixed ones plus an injected contextual workspace tab,
  so the open "fold Output back to 7" question is moot. Labels never truncate:
  `.tab` is `nowrap` + `flex-shrink: 0`, so the bar scrolls instead and
  "Project" renders as "Proj". All five are hit first time one-handed on device.

### Fixed
- **`Bg adapt` now means what `Trail` means.** The background used a *half-life*
  while the trail used *time until visually gone*, which put two different
  meanings of "seconds" side by side in one panel. At `Bg adapt` 4 a ghost was
  still 50% visible after 4 s and 12.5% after 12 — so the number read as simply
  wrong rather than as a different convention. Both now use the same base:
  after `T` seconds, 2% remains. `tests/audit-halffloat-slew.mjs` reads the
  base out of the engine and asserts the two agree, and it reads it from source
  rather than hardcoding it — the previous version kept passing while modelling
  a curve the engine no longer used.
- **Motion Extraction's background actually adapts now.** It was stored in an
  8-bit buffer, and `mix(bg, cur, adapt)` at `Bg adapt` 4 s gives a per-frame
  step of 2.9e-3 against an 8-bit level of 3.9e-3 — below one representable
  value, so it rounded to no change and the background **froze on the frame it
  was primed with**, permanently. Above ~2.95 s nothing could move it at all,
  for any difference including full black-to-white.

  It did not look like a precision bug. A frozen background is a static
  reference plate, so it produced clean, solid silhouettes and read as the
  feature working — until you noticed it was always the *first* frame, ghosting
  everything that had changed since boot and never fading.

  The background and the trail are now float32. Float rather than a
  guaranteed-progress floor: a floor relinearises the tail and would have made
  the long end of a 0–10 s range a lie. Measured over 10 s of model time, the
  8-bit buffer closed **2%** of a gap where float32 closed the specified
  **82%**. `NearestFilter`, because both are sampled 1:1 and RGBA32F is not
  filterable without `OES_texture_float_linear`.

  This is the half-float slew lesson recurring one buffer coarser;
  `tests/audit-halffloat-slew.mjs` has been widened from "half-float slews" to
  "exponential accumulators", and now asserts the storage *and* the arithmetic
  that decides what storage is sufficient.
- **The Video Delay ring is no longer allocated 0×0 when the page boots before
  layout.** `W`/`H` came straight from `canvas.parentElement.clientWidth`, which
  is 0 in a tab that boots in the background, a `display:none` container, or a
  frame that has not been shown. Most of the instrument survives that, because
  `applyResolution()` runs later and resizes everything that follows the canvas
  — but `VideoDelayLine` and `TimeDisplaceEngine` deliberately make `resize()` a
  no-op so a display change cannot wipe their history, which means they take
  their working size ONCE, here, and only ever reallocate from a
  `bufferResolution` change. That fires on *change*, so it never fires at
  startup. The rings stayed 0×0 for the whole session.

  Nothing errored. `capture()` and `getTexture()` both keep working against
  zero-sized targets, so Delay and RGB Delay simply rendered nothing and the
  only symptom was an effect that looked unimplemented — until you touched
  Buffer res, which reallocated from real numbers and fixed it by accident.

  Fixed by falling back to a plausible size rather than healing later: a heal
  would need a guard that is false on every normal boot plus a realloc that
  throws away history, for a size that was only ever an approximation anyway
  (Native already clamps, and these buffers are decoupled from the canvas by
  design). Now covered by `tests/audit-boot-buffer-size.mjs`, which also fails
  if another engine adopts the no-op resize without being considered here.
- **Loading a `.cube` and raising LUT Amount no longer blanks the image to
  black.** The LUT was uploaded as `RGBFormat + FloatType`. three r168 still
  *defines* `RGBFormat`, so nothing failed loudly — but `getInternalFormat`
  picks no sized internal format for RGB (it only upgrades RGB for
  `UNSIGNED_INT_5_9_9_9_REV`), so the call went out as unsized RGB + FLOAT, a
  combination WebGL2 rejects. `texImage2D` raised `INVALID_OPERATION`, the
  texture stayed incomplete, and every `texture2D()` against it returned
  `(0,0,0,1)` — so the whole picture went black the moment the blend came off
  zero. The colour grade panel had therefore never worked in WebGL2, and looked
  like a shader bug rather than an upload one. **"three still exports the
  constant" is not "three still supports the upload"** — the constant table and
  `getInternalFormat` disagree, and only the second one runs.
- **LUT data is now packed to RGBA half-float.** Half rather than full float
  deliberately: `RGBA16F` is filterable in core WebGL2, while `RGBA32F` needs
  `OES_texture_float_linear` and samples black without it — the same failure
  with a narrower blast radius, which is exactly the kind that reaches the iPad
  and not the desk.
- **The LUT's blue axis was compressed by (N-1)/N.** `LUT3D` derived the slice
  index from the centre-mapped blue (`col.b * scale + offset`) instead of raw
  `col.b`, so blue never reached the last slice — pure blue graded to 247 where
  it should have hit 255. Red and green were authored at texel centres correctly
  and were always right, which is why the error read as a mild cast rather than
  as a broken axis. The upper slice is clamped now too.

### Notes
- **A LUT is hard to verify by eye, and the obvious fixtures all hide it.** An
  R↔B swap is invisible on greyscale noise; an invert of greyscale noise still
  looks like greyscale noise. A **constant-colour `.cube`** (every entry
  magenta) is the fixture that makes a LUT visibly land at all, and a raw
  WebGL2 `gl.getError()` probe is what actually proves the upload — the old
  path reproduces as `INVALID_OPERATION` with every output pixel `0,0,0`, the
  new one as `NO_ERROR` with six test colours exact to 0/255.
- **A soak cannot answer the gating question it was written to answer.** All four
  phases sat pinned at the 16.67 ms vsync ceiling, where "the gate fires" and
  "the deck uploads and there is headroom to absorb it" produce identical frame
  times — so the phase-2-vs-phase-1 comparison passes either way. Three integer
  counters settled in 65 seconds what 55 minutes could not. Recorded in
  `docs/LEARNED.md` alongside a second entry on verifying preconditions
  programmatically rather than by eye.
- Service worker cache bumped (v0.7 → v0.10) with a comment at the constant:
  the handler is cache-first and every build emits a new content hash, so a
  stale cached `index.html` points at an asset that no longer exists — which
  fails as a blank app on device, not as a change that quietly did not land.

---

## [0.15.0] — 2026-08-02 — The Scan Processor (Phase 26)

*Rutt-Etra (1972) sat beside the Sandin Image Processor and the Paik/Abe
synthesiser in the lineage this project claims, and was the only one of the three
with no representation in the instrument — it existed as a bare `pre-rutt-etra`
git tag and nothing else. Design doc: `docs/ImWeb-Spacetime-Blueprint.md` §6.*

### Added
- **Rutt-Etra Scan Processor** (Sources ▸ Rutt-Etra, source index 29) —
  horizontal scanlines deflected by the luminance of any source and viewed
  through an orbiting perspective camera. Faithful before general, deliberately:
  the machine is beautiful *because it lies about depth*, and generalising to
  "any channel displaces any primitive" before living with the historical
  instrument produces something configurable that nobody plays.
- Controls: `rutt.source` (any source, including FG/BG/DS Src), `rutt.lines`,
  `rutt.zgain` (signed — negative inverts the relief), `rutt.thickness`,
  `rutt.angle`, `rutt.elev`, `rutt.dist`, `rutt.decay` (phosphor persistence).
- Scanning its own output is legal and frame-delayed rather than a feedback
  conflict, because the tap resolves to the front buffer while the back one is
  being written.
- **`rutt.zcurve` / `rutt.zpivot`** — the depth transfer function. Curve is a
  gamma on luminance before it is scaled (the `td.delayCurve` pattern), which is
  what stops midtones flattening into a slab and makes a face read as a face.
  Pivot moves the zero plane so the relief sits *around* the sheet rather than
  only in front of it — valleys as well as ridges. Both act on geometry alone:
  the beam stays as bright as the signal that deflected it. Defaults (1.0 / 0)
  are a bit-exact identity.
- **`rutt.bleed` ("Spread")** — spatial phosphor decay. The trail now diffuses as
  it fades instead of dimming in place, which is the difference between a ghost
  image and a glow. The kernel's weights sum to exactly 1, so it redistributes
  energy and cannot add any — necessary, because the lattice is drawn additively
  on top of this buffer every frame and a kernel with gain above 1 would compound
  into a runaway to white. Does nothing at Persist 0, having no trail to spread.
- **`rutt.hue` / `rutt.sat` / `rutt.colorAmt`** — colour. Tint is a lerp from
  white toward a pure hue, so saturation 0 is exactly the original monochrome and
  hue is inert there. Src Color carries the source's own chroma through per
  vertex instead. The machine was monochrome but its output was routinely run
  through colourisers, so the tint is period-plausible; Src Color is the one
  frank departure. Tinting is per line, before accumulation, so densely
  overlapped regions climb toward white — what an over-driven CRT does when the
  beam retraces the same phosphor.
- **`rutt.rise` / `rutt.fall`** — asymmetric temporal slew, `jit.slide` semantics.
  The lattice glides toward the signal instead of snapping to it, so live video
  becomes a viscous topography rather than a field of jittery spikes. Times are
  in **seconds**, not frames: each step multiplies the remaining distance by
  `exp(-dt/tau)`, so the feel is identical at 30 and 60 fps (measured 76.11 vs
  76.16). Both at 0 bypasses the history buffer entirely rather than passing
  through it at coefficient 1, so the default costs neither a pass nor any
  resampling softness.
- **`rutt.shape`** — Plane · Sphere · Cylinder · Torus · Catenoid · Helicoid ·
  Gyroid. The raster wraps onto a surface instead of only a plane, and
  displacement runs along the surface NORMAL rather than +z. Every surface has a
  natural family of curves at constant v — latitude rings, stacked rings, loops,
  nested helices — so the SCAN survives the shape change, which is what keeps
  this Rutt-Etra rather than the 3D Scene (which already displaces solids by a
  texture). Plane is the identity case: its normal is (0,0,1), so it renders
  bit-identically to before. Gyroid is honest about being the exception — a
  triply periodic minimal surface has no closed-form parameterisation, so it is
  solved as a height field by root-finding per grid point, giving one sheet
  rather than the full labyrinth. Aspect stretch stays a plane affordance; it
  would turn a sphere into an ellipsoid.
- **`rutt.drawMode` / `rutt.pointSize`** — Lines · Points · Both, with its own
  Dot width. The same lattice drawn as a dot cloud, which scan processors of the
  period also did. Dot is separate from Beam rather than derived from it, because
  the useful setting in Both mode is a thin ribbon under prominent dots; it
  defaults larger (3px against 1.5) since a discrete dot lattice reads fainter
  than a continuous line one at equal width. Dots are round and spherically
  shaded — bright at the centre, falling to nothing at the rim — via a separate
  fragment shader, because `gl_PointCoord` is undefined during a triangle draw
  and the ribbon shares the vertex stage. One additive target for both.

### Changed
- **Every project, bank and Display State now records the capture-index base it
  was written at.** `SOURCE_DEFS` is append-only so source indices are stable,
  but the "FG Src / BG Src / DS Src" entries `CAPTURE_SOURCES` appends *after*
  the source list are pinned to `SOURCES.length` — so adding Rutt-Etra at index
  29 would have slid them to 30/31/32 and silently re-pointed every saved
  `td.captureSource`, `td.mapSource`, `slitscan.source`, `vwarp.source` and
  `delay.source` in the old tail at the new source. Load now shifts them back
  into register; files written before the stamp are read at base 29, which is
  the only base those entries have ever had. No file on disk was affected — the
  exposure was banks live in IndexedDB.

### Known limitation
- A controller mapped to a capture selector stores a *normalised* value, which
  re-scales when the options list grows. Pre-existing, and identical for every
  source append; the base stamp does not address it.

### UI
- **Rutt-Etra's 23 controls sit in four collapsible groups** — Scan · Depth ·
  Camera · Phosphor — one panel section with four subsections, the shape the Warp
  section already uses.
- **Subsections collapse anywhere in the app** (Color/Gradient, Text, Warp, Video
  Delay, Performative Draw and the rest). They still do not detach or stick;
  main.js sweeps the two header classes separately so a subsection cannot become
  a detach target inside its own parent. Default expanded.
- Subsection headings are legible — a four-way split was reported as "the
  sections are not there" while all four headings were on screen at 9px in
  `--text-2`.
- `.param-row` uses `min-height` rather than a fixed height: `.param-btn-group`
  wraps, and against a fixed height a wrapped group silently painted over the
  rows beneath it.

### SDF (formerly "Metaballs")

*Renamed. A metaball is specifically a blobby sum-of-falloff surface — one of
eight shapes, under one of four combine modes. The name also collided with the
3D Scene tab's own, different metaball system, while the source dropdown and
the whole `sdf.*` namespace already said SDF.*

#### Fixed
- **Source routing had drifted three ways.** `_sdfSrcToLayerIdx` mapped the
  Texture/Refract source menus onto `SOURCE_DEFS` by bare number, against an
  ordering that has since changed: "Draw" fetched 3D Scene, "3D" fetched Noise,
  and **"Noise" fetched Color2** — a solid cyan, which is where the blue cast on
  a glass-styled SDF came from. Now mapped by key, so an append cannot rotate it.
- **A sphere rendered as a wide ellipse.** The ray setup had no aspect
  correction; `uv` spanned [-1,1] on both axes whatever the target's shape.
  `sdf.fov` is now the vertical field of view and `uv.x` is scaled by aspect.
- **Looking straight up or down returned a black frame.** The camera basis came
  from `lookAt` with a fixed world up, so at ±90° elevation `cross(f, up)` was
  the zero vector and `normalize()` gave NaN. Replaced with the Euler
  construction RuttEtra.js already uses for exactly this reason.
- **Refraction flattened the object.** Specular was baked into the albedo, so
  the glass mix lerped it away and "clear glass" lost every highlight. Diffuse
  and video now form the body the background replaces; specular and Fresnel are
  added on top of it.
- `sdfGen.resize()` was missing from `applyResolution()` — the only engine
  absent — so changing output resolution left the render target at its startup
  size and `uResolution` stale, which is what the screen-space refraction lookup
  is built from.
- Texture source "None" froze the last texture instead of clearing it. Both
  slots now fall back to a shared 1×1 black texture (with `needsUpdate` set —
  the originals were created at version 0 and never uploaded at all).

#### Added
- **Size** — uniform scale on every primitive. The radii were literals in the
  shader, so there was previously no way to change how big the shapes are.
- **Orbit X / Orbit Y / Distance + Move X/Y/Z**, the Rutt-Etra camera grammar.
  Move translates the field rather than the camera, which is what makes Tile
  usable: an infinite lattice you cannot travel through is wallpaper.
- **FOV**, **Glow Hue**, **Light Az / Light El** — all previously hardcoded.
  Defaults reproduce the old constants exactly (74°, hue 274°, az 27° / el 34°).

#### Changed
- **Repeat is now Tile + Tile Size.** One number used to be both spacing and
  on/off, gated at `> 0.1`: the bottom of the slider was dead, the range just
  above it was solid mush (cells narrower than a shape), and turning it on
  silently overrode Separation, which then did nothing with no indication.
- Glow defaults to 0. Panel is seven subsections — Shape · Space · Camera ·
  Material · Light · Glass · Video.
- `sdf.camX/camY/camZ` are retired. Saved projects, banks, states and the live
  overlay are migrated on load by an exact Cartesian→spherical conversion, so
  the eye lands on the identical point; verified against all 45 camera maps in
  MasterProject.imweb at zero error. Recall bounds on the retired params are
  reset rather than carried — a box in world units is not a box in
  azimuth/elevation/distance. `tests/audit-sdf-migration.mjs` guards it.

#### Shapes
- **Five appended from Rutt-Etra's parametric list** — Cylinder, Cone, Gyroid,
  Helicoid, Catenoid, bringing sdf.shape to 13. Append-only: a SELECT persists
  as an integer index. The last three are implicit *shells* rather than exact
  distance fields, so they return a bound and the march slows for them, taking
  the minimum across both shape slots so one in Shape B cannot tunnel.
- All five are sized to the family envelope (bounding radius 0.60–0.64, against
  the original eight's 0.50–0.73). They shipped at 0.64/0.71/0.75/**2.06** and
  **unbounded**, and two were wrong in kind rather than degree: a gyroid is
  triply-periodic and has no size of its own, so it ignored Size, Separation and
  Count and read as a background; a catenoid's flare is exponential, so its y
  clamp *is* its size control.
- **Shape B** and **Count** (1–8). Count rounds — a controller landing on a
  fraction spaced the instances unevenly and popped one in and out.

#### Glass and light
- **Env Mirror** — the Fresnel rim looked up in Refract Src as an
  equirectangular surround. It used to add flat white, which is why glass read
  as *glowing* rather than *reflective*: a rim that is one colour all the way
  round carries no information about the surroundings, and that information is
  what a reflection is. 0 restores the white rim.
- **Self Reflect** — one traced bounce, so the shapes appear in each other. The
  surround tap cannot do this at any setting: by construction it only shows what
  is *outside* the field. 0 by default; it is a second march plus a 6-sample
  normal per surface pixel, on a uniform branch so 0 costs nothing.
- **Aura from closest approach**, not step count. Step count also rises with
  distance travelled and field complexity, and a ray grazing the silhouette
  through empty space takes big strides and scores *low* — so the rays that
  should have glowed brightest scored lowest, and it drifted whenever Steps
  changed. **Glow Size** sets the reach in world units.
- **Glow Hue 2 / Sat / Val per stop**, with two colour pickers. Sat and Val were
  frozen at the decomposition of one hardcoded violet, so the aura could only be
  a fully saturated hue at one brightness. Params stay HSV — a hue sweep is not
  expressible as one fader over three RGB params — and the pickers are views
  onto them, so a state recall or MIDI-driven hue keeps them in sync.
- **Glow Env** tints the aura by the surround. Normalised by the brightest
  channel, so it takes hue and leaves level alone; as a raw multiply it took the
  aura to luma 0.004 over dark regions.

#### Quality
- **Detail** (internal render scale, was pinned at 0.5) and **Steps** (march
  budget, was 96, ceiling 256). Raise Steps when Warp is high: Warp shrinks
  every step, so a fixed budget reaches proportionally less far and distant
  geometry silently disappears. Measured, these buy sharpness and reach, **not**
  frame rate — the raymarcher is ~0.3 ms of an 18.8 ms frame.
- **Depth Range** for the SDF Depth source, centred on the field. Normalised
  over the whole marched distance the object occupied 6–12% of 0–1 — as few as
  15 of 255 levels — and drifted with camera distance, so a depth map driving
  Displace changed meaning whenever you dollied.

#### Compositing
- **Alpha carries coverage**, and `.depthTexture` is a second march of the same
  material with `uDepthPass` set. Depth rode in alpha for one commit, which cost
  nothing but spent the one channel a compositor needs to know where the source
  *is*. With coverage, the keyer's existing **Alpha** mode composites the SDF
  properly: the object opaque, the aura soft-edged, empty space transparent.
- **Keyer ▸ Alpha Emissive** — composites `bg*(1-a) + fg` instead of
  `mix(bg, fg, a)`. The matte form is correct for a cutout and backwards for a
  glow, which adds light rather than occluding, so the background's dark areas
  showed *through* the aura as shadows in it. Identical at alpha 1, so an opaque
  subject is unaffected; defaults off.
- `blending: THREE.NoBlending` on the raymarch material. `ShaderMaterial`
  defaults to `NormalBlending` and the target clears to `(0,0,0,0)`, so once
  alpha stopped being a constant 1.0 every hit was multiplied by its own depth
  and every miss by zero — which killed the background aura outright.
- The aura's brightness falls off **linearly**. Squared, it extinguished the
  glow exactly where the gradient's outer colour lives (at 76% of the way to
  Hue 2, luma 0.010), so the second colour of a two-colour gradient was
  unreachable by construction.
- The aura is applied to hits too, weighted by a rim term. Dropped entirely it
  left the object's own unlit edge exposed with the halo starting outside it;
  applied flat it washed across the whole surface, since `minD` is ~0 on a hit.

#### Also fixed
- `sdf.speed` is a real freeze. It was `time * speed` over a clock that never
  stopped, so 0 snapped to the pose at angle 0 rather than holding, and nudging
  it off zero teleported. Now an integrated phase.
- Refraction uses the **view-space** normal. A world-space normal in a
  screen-space lookup pinned the smear to world axes while the picture turned
  under it — invisible until there was an orbit control.
- The AO probe scales with Size. Fixed at 0.16 world units it sat outside a
  Size 0.1 shape entirely, and was 9% of the radius at Size 3.
- The luma-warp texture fetch and `calcAO` are skipped when their amounts are 0.
  `scene()` runs up to 96 times per ray, so an unconditional fetch was ~107
  dependent samples per pixel; `mix()` evaluates both arguments, so AO ran in
  full at Occlusion 0.

---

## [0.15.0] — 2026-08-02 — Spacetime & the Warp Family (Phase 25)

*Four temporal engines had grown up separately, each owning both halves of the
same idea: a history of frames, and a way to read across it. The history is VRAM
and there should be exactly one of it; a read is one fullscreen pass into a small
target and there can be several. This phase separates those halves, then gives
every engine the two things they were all missing — a source of its own, and
controls over where in time it reads. Design doc:
`docs/ImWeb-Spacetime-Blueprint.md`, corrected in place where it was wrong.*

### Added
- **A source selector on every temporal engine.** Slit Scan, Warp Tape and the
  Video Delay Line each read whatever they were hardwired to; all three now take
  any source. Warp Tape in particular was camera-only by heuristic rather than by
  design (`slitscan.source`, `vwarp.source`, `delay.source`).
- **FG Src / BG Src / DS Src on every capture selector** — "whatever that layer
  is currently showing" rather than a fixed source, so an engine follows your
  routing instead of being pinned to a decision made once. Available on
  `td.captureSource`, `td.mapSource`, `slitscan.source`, `vwarp.source` and
  `delay.source`.
- **Time Displace gains an angle and a map source** — `td.angle` (0–360°, rotates
  the delay map about the frame centre), `td.mapSource` (any source drives the
  map) and `td.mapAmount` (blends that map into the analytic shapes). Defaults
  are a bit-exact identity with the previous behaviour.
- **Warp Tape scrubbing** — `vwarp.pos` (which moment sits at which column),
  `vwarp.span` (how much of the tape covers the frame), `vwarp.anchor` and
  `vwarp.clear`. The tape stopped being a fixed mapping and became something you
  can play across.
- **Video Delay Line depth** — `delay.size` (30 / 60 / 120 / 240 / 480 frames),
  `delay.bufferResolution` decoupled from the canvas, and `delay.frames` raised
  from 30 to 480. Long echoes are now a setting rather than a rebuild.

### Changed
- **The ring is split from the tap.** Four engines each held a private history of
  the same frames. One shared history now feeds many reads — no behaviour change,
  a large VRAM change.
- **One delay map, two dialects.** `DELAY_MAP_CHUNK` holds the map function and
  its uniforms; both read shaders include it and differ only in how they sample
  (GLSL3 `texture()` vs GLSL1 `texture2D()`), so mode semantics cannot drift
  between the two paths.
- **"Warp" is now the family name**, with Time Displace and Tape under it, and
  Slit X/Y renamed to Shear X/Y. **Labels and markup only** — no parameter id,
  source index or container id changed, so saved states, Display States, `.imweb`
  projects and MIDI mappings are untouched.

### Fixed
- **`_resolveLayerTex()` handled 16 of 29 sources.** Thirteen — Color, Color2,
  BG1, BG2, Text, Sound, Delay, Scope, SlitScan, Particles, 3D Depth, SDF and
  Warp Tape — fell through to the composited output instead of the thing named in
  the dropdown. No error and no warning: the failure mode is a plausible-looking
  picture, which is why it survived so long. Now covered by
  `tests/audit-source-resolution.mjs`, which checks both resolvers.
- **Appending a source no longer breaks saved captures.** `CAPTURE_SOURCES`
  appends FG/BG/DS Src *after* the source list, so adding one source slid that
  tail up by one and every saved capture selector silently re-read as the new
  source. Files now carry the base they were written at and migrate on load.
- **Warp Tape: Buf Size finally means something.** The strip target was allocated
  at canvas width while the write head wrapped at `bufSize`, and the read used
  the target's full width — so anything under 1920 covered only part of the frame.
- **Warp Tape: the sweeping tear is the effect, not a bug.** An earlier fix
  anchored the read to the write head, which removed it; that was a misreading of
  one report as two. Anchoring is now a control (`vwarp.anchor`, default 0) and
  the sweep is back as the default.
- **Video Delay Line saturates past the history** instead of vanishing. Requesting
  a frame beyond what the ring holds returned null, so pushing the knob up dropped
  the source to black rather than giving a long echo.

### Tooling & docs
- **The Full Manual covers every source.** It described an older instrument —
  22 of 31 sources, with none of Phases 23–26 present. SDF, Rutt-Etra, Warp Tape,
  Time Displace, the three mix buses and the depth companions now have sections,
  as does warp drawing. Every parameter id cited was verified against the live
  registry.
- **`docs/LEARNED.md` entries carry an enforcement tag** — `[audit]`, `[hook]`,
  `[skill]` or `[advisory]` — so the lessons still carried only in prose are
  greppable as a risk register, and `npm test` grew from 4 invariant audits to 9.
  One of the new audits found a live hole on its first run: exported `.imstate`
  files had no gitignore protection at all.

---

## [0.14.0] — 2026-07-29 — The Movie Library

*Movies had no home. There was a list of clips inside Deck A, a second deck with
the same list and no way to see it, and a recorder confusingly named "Clip
Library". Now there is one **Movie Library** — everything you have, unlimited,
thumbnails loading as you scroll — and two decks that load from it. Design doc:
`docs/ImWeb-MovieLibrary-Blueprint.md`.*

### Added
- **Movie Library panel** (Sources ▸ Media) — every clip that exists, with
  thumbnail, duration, origin badge, a filter box, and `→A` / `→B` to load. It
  holds *descriptors*, not players, so its size is unlimited; duration and
  thumbnail are read only when a row scrolls into view.
- **Drag a Library row onto the Movie A or Movie B panel** to rack it. The whole
  panel is the target, because an empty Deck B renders no list to aim at.
- **Deck B finally has a rack UI** — it always had the 8-clip array, just nothing
  to show it. Both decks now render through one parameterised `_renderRack()`.
- **`Option+1-8`** selects on Deck B's rack, mirroring `Shift+1-8` on Deck A.
  Matched on `e.code`, since macOS Option+digit emits `¡™£¢∞§¶•`.
- **A full rack evicts its oldest clip** instead of refusing, so loading never
  interrupts a set — never the clip that is *playing*, which would drop the live
  output at the worst possible moment.
- **`✕` on a Library row** removes the catalogue entry; a racked clip keeps
  playing and nothing on disk is touched. The mirror of Clear, which unloads a
  rack without deleting entries.
- **`✕ Clear` for Deck B**, and `+ Add Clip` becomes **`+ Add Movie`** in the
  Library — adding a movie says "this exists", clearing a rack says "unload
  these".

### Fixed
- **`imweb-prep.js` now writes faststart MP4s.** Without `-movflags +faststart`
  the `moov` atom lands at the *end* of the file, so a browser cannot report a
  duration until it has read to EOF — seconds on a 237 MB All-Intra clip, or
  never under load. This is why the movie rack had always hung on its eighth
  clip. **Clips prepped earlier need a one-off lossless remux** — see the manual.
- **Only the clip being played buffers ahead.** `preload='auto'` on every racked
  clip spends the media byte budget (~837 MB here) on clips nobody is watching,
  and the clip you switch to then holds its first frame forever. Loading uses
  `preload='metadata'`; `selectClip()` promotes the incoming clip and demotes the
  outgoing one.
- **`removeClip()` kept the playhead on its own clip.** It only corrected
  `_current` when the playhead ran off the end of the array, so removing any clip
  *below* it silently switched the output to a different movie.
- **Routing a layer to a movie deck switches that deck on.** Both decks are
  forced off at launch so a project never starts blasting video, but Deck B's
  toggle is buried in its panel — selecting Movie B as a Background showed
  nothing, with no visible cause.
- **`q`/`a`/`z` cycle layer sources in the LAYERS dropdown's order** rather than
  raw index order, walking the same `SOURCE_DISPLAY_ORDER` the menus are built
  from. Presentation only — the stored value is still the true source index.
- **The clip list appears as clips load**, instead of after the whole manifest
  finishes; one stalled file no longer hides every clip behind it.
- **Percent-encoded clip names are decoded** — a file with a space showed as
  `mirror%20clip`.
- **The startup console banner reads the real version**, having announced v0.6.0
  through seven releases.

### Fixed — project import no longer destroys banks

*`importAll()` pruned every bank in IndexedDB whose index the incoming file did
not claim — no prompt, no undo — and it sat behind three call sites, including a
drag-dropped `.imx`. The local MasterProject went from six banks to two before
anyone noticed. Import is now additive; the only thing that still destroys banks
is the button whose job is destroying banks.*

- **Project import no longer deletes local banks.** The prune is gone.
  `PresetManager.importAll()` merges: banks already in the store are left alone,
  and the project's own banks are written alongside them.
- **Nor does it silently overwrite them.** Banks are keyed by `index` and
  `dbPut` overwrites by key, so deletion was only half the blast radius — an
  incoming bank at index 8 destroyed a local bank 8 just as thoroughly. A
  colliding incoming bank is now **reindexed** to the lowest free slot. The
  free-index set is seeded from IndexedDB *and* from memory, because a bank can
  exist in the store without being in `presets` (an import before `init()`, or a
  second tab).
- **`activePreset` follows the reindexing.** `ProjectFile` takes the index map
  `importAll()` returns and translates the saved id through it; without that, a
  merge that moved a bank would silently restore a different one.
- **The hidden `#bank-select` proxy tracks the bank set.** Its `<option>`
  elements were rebuilt only when the bank dropdown was opened, so any bank
  added since then had no option and the select read `""`. Extracted into
  `_syncBankSelect()` and called from `_refresh()`, which already listens for
  bank activation, saving, recall and rename.

---

### Changed
- **Detached, the Movie Library fills its window.** Its list was capped at 240px,
  so a floating panel showed ~6 rows however large you made it.
- **Destructive import is now opt-in**, via `importAll(data, { replace: true })`.
  Two callers pass it: "Restore MasterProject", which already warns that the
  action cannot be undone, and the first-ever launch — `init()` saves a blank
  `Preset(0)` before MasterProject loads, so a merge there would collide with it
  and shift every factory bank one slot. `_firstLaunch` means the store was
  empty, so the only bank replace can destroy is that empty one.
- **Loading the same project twice now duplicates its banks** rather than
  replacing them. This is the deliberate trade: duplicate banks can be deleted,
  deleted banks cannot be recovered.

---

## [0.13.0] — 2026-07-28 — Performative Warp Drawing (Phase 24)

*The displacement map had an editor but no performance. You could sculpt a warp
in a 288×200 panel, or pick one of eight procedural shapes, and that was the
instrument. Phase 24 makes the warp map something you play: draw it on the
output itself, drive it from LFO/MIDI/OSC, recall it from a controller, and
crossfade between saved maps. Design doc:
`docs/ImWeb-UI-Taxonomy-Phase24-Proposal.md`.*

### Added
- **Draw the warp on the main canvas** — Touch Mode `Warp` (index 4) claims the
  output surface, so dragging smears the displacement map under the pointer.
  Claims its own mode index for the same reason the Draw surface does: camera
  orbit and the pad gate on theirs, so a bare listener would have made every
  orbit drag also smear the map.
- **`displace.warpDrawX` / `warpDrawY`** — the same brush driven by parameters
  instead of a pointer, so an LFO pair produces an orbiting drag and MIDI can
  sculpt the map live. Direction comes from motion between frames, which is why
  a stationary pair of sliders does nothing and no on/off switch is needed.
- **`displace.warpDrawRadius`** (2–50%) and **`displace.warpDrawAmt`**
  ("Strength", 0–200%) — brush width and bite, now real parameters. Both are
  shared by all three drawing surfaces: the mini editor, the main-canvas drag
  and the WarpDrawX/Y path. The mini editor's Radius and Strength sliders are
  *views* of these params, not private variables, so a controller visibly moves
  them and dialling them changes what the main canvas draws.
- **`displace.warpSlot` (1–16) and `displace.warpPreset` (8 shapes)** — slot and
  preset recall as SELECT params with a leading "—" no-op, so LFO/MIDI/OSC can
  fire them. One recall implementation in main.js; the editor's buttons set the
  param rather than recalling directly, so button, MIDI and LFO share a path.
  Capture semantics differ on purpose: `warpPreset` is captured by Display
  States (the eight shapes live in code, so an index means the same thing
  everywhere) while `warpSlot` is not (slot *contents* live in per-origin
  localStorage, so a captured index would recall a different map elsewhere).
- **`displace.warpSlotFade`** — slot and preset recall crossfades the control
  grid over N seconds instead of snapping, on a smoothstep that eases in *and*
  out and lands on the target exactly. Interruptible: re-targeting mid-fade
  snapshots wherever it reached.
- **`displace.warpDrawFixed` / `warpDrawAngle`** — a steady wind field you can
  aim, instead of a direction that changes with the way you happen to be moving.
  Motion still decides *whether* to draw and how hard, just not which way.
- **Controller assignment on controls that are not param rows** — the mini
  editor's Radius/Strength sliders and the preset buttons take right-click or
  Ctrl+click; slot buttons take Ctrl+click only, because plain right-click
  already saves to the slot.

### Changed
- **WarpAmt ceiling raised from 100% to 200%.** The shader displaces by
  `(map − 0.5) × uStrength × 0.3` and control points clamp at ±0.49, so 100%
  capped every warp at ~15% of the frame. Raising the *param* ceiling rather
  than the shader's `0.3` keeps every saved map, preset, Display State and
  `.imweb` project rendering byte-for-byte as before.
- Warp param labels shortened (`Strength`, `Radius`, `Fixed Dir`, `Angle`,
  `Slot Fade`) — five of them overflowed the panel's label column and rendered
  as an identical `WarpDraw…`, which made the new Radius param unfindable. IDs
  are unchanged, so saved states and MIDI mappings are unaffected.

### Fixed
- **Warp drawing was mirrored vertically, twice.** `DataTexture` defaults to
  `flipY: false`, so map row 0 is the *bottom* of the screen while pointer
  coordinates are y-down. Fixing the stroke position without the drag direction
  then simply moved the mirror from where a stroke landed to which way it
  smeared — position and direction have to share one axis convention.
- **Half-texel register error in the warp map.** `_rebuild()` stored the field
  at `n/(TEX_SIZE−1)` — texel *corners* — while the shader samples texel
  *centres* at `(n+0.5)/TEX_SIZE`. The whole map was squeezed toward the centre
  by 127/128: exact in the middle, ~0.4% of the canvas off at the edges, which
  is why a brush stroke drifted the further out you drew.
- **The grid overlay drew an upside-down picture of the warp** it claims to
  show. The flip wraps `(nj + dy)`, not just `nj` — flipping the node but not
  its displacement would put the lines in the right places while bulging them
  the wrong way.
- **The mini editor barely drew.** Its mousemove passed the raw per-event delta
  as the brush *direction*, but `brush()` already scales by `strength`, so the
  movement was multiplied in twice — roughly 30× weaker than the main canvas.
  Now a unit direction with distance-proportional strength, matching
  `_warpStroke`.
- **The mini editor's mesh was 2.5× exaggerated**, drawing nodes up to 1.2
  canvas-widths from home for warps the video renders calmly, and disagreeing
  with the unscaled main-canvas overlay. Now 1:1.
- **Fast strokes on the main canvas drew nothing.** The browser batches motion
  into one `pointermove`, and a single large step trips the teleport guard —
  the faster you moved, the less happened. Now replays `getCoalescedEvents()`,
  guarding on the list being *empty* rather than absent (it exists and returns
  `[]` for untrusted events, so `?? [e]` never fired).

---

## [0.13.0] — 2026-07-28 — MixBus Rethink (Phase 23)

*The MixBus shipped in v0.12 as a crossfader hardwired to the two movie decks.
ImWeb's actual model is a source graph — `layer.fg/bg/ds` pick freely from one
shared list — so the bus was the only node in the instrument with fixed inputs.
Phase 23 makes it a real graph node, adds two more, and rebuilds the panel
taxonomy around signal flow. Blueprint: `docs/ImWeb-MixBus-Rethink-Blueprint.md`.*

### Added
- **Free source selection on every mix bus** — `mix.srcA` / `mix.srcB` (and the
  `mix2.*` / `mix3.*` mirrors) select any of the 29 sources, resolved through
  the same `_resolveSource()` the layers use. Camera against Noise, Draw against
  the SDF generator, the 3D scene displaced by the Analog TV signal — all
  reachable. The MIXBUS shader was already source-agnostic and is unchanged;
  only the binding was hardwired. Defaults (1 = Movie, 25 = Movie B) reproduce
  the old wiring exactly, so existing projects render identically.
- **Three mix buses** — sources 26/27/28 ("Mix 1/2/3"), built from one
  `MIX_BUS_PARAMS` descriptor registered for prefixes `mix` / `mix2` / `mix3`,
  the same shape as `MOVIE_DECK_PARAMS`. Bus 1 keeps the bare `mix.` prefix and
  its exact v0.12 ids and labels — renaming to `mix1.` would break every saved
  state, bank, `.imweb` file and MIDI mapping for zero gain.
- **One-frame-behind feedback** — each bus is double-buffered, writing its back
  buffer and flipping only after the draw. One rule covers every case with no
  feedback flag: a later bus reading an earlier one sees *this* frame, an
  earlier bus reading a later one sees *last* frame, and a bus reading itself
  sees *last* frame — safe because the sampled texture is physically a different
  target from the one being written. Targets allocate lazily, so a project that
  routes no bus pays no VRAM.

### Changed
- **Panel taxonomy follows signal flow** — the tab bar is now
  `Sources · Mix · Effects · Output | 3D · Analog · Draw · Project`. "Mapping"
  held 23 sections (essentially the whole instrument) and was named after one
  section inside it; 3D/Analog/Draw stay top-level because they are large
  *source editors*, not a different taxonomic kind. Renames: Movie Clips →
  Movie A, ColorSrc 1&2 → Color / Gradient, Sequences → Frame Sequences,
  Particles / GPU Engine → Particles, SDF / Metaballs → Metaballs, Camera (3D
  tab) → 3D Camera, Response Curves "Tables" → Response Curves. No parameter
  ids and no source indices changed.
- **Consumption analysis is a fixpoint** — a bus renders only when something
  reads it, and that is transitive in both directions (an earlier bus reading a
  later one is still a real consumer). A bus feeding only itself never becomes
  needed and costs nothing. The seven duplicated "is source *i* used" tests
  collapsed into one `_srcUsed(i)` covering layers, TimeDisplace capture and
  live mix inputs.
- **Initial tab activation is data-driven** — the `.panel-section` carrying
  `data-default-open` decides both which section is expanded and which tab the
  app opens on. The `active` classes remaining in `index.html` are a documented
  first-paint hint, not the source of truth.

### Fixed
- **TimeDisplace could not capture Movie B or Mix Bus** — `TD_CAPTURE_KEYS` had
  25 entries against a 27-entry source list, so those indices resolved to
  `undefined` and `tdEngine.capture()` silently no-oped. The `_gTdCap === 26`
  branch in the idle-deck upload gate was therefore dead code.
- **AI Narrator reported '?' for the newest sources** — `SOURCE_NAMES` in
  `AIFeatures.js` was a stale 25-entry hand-copy, the exact recurrence its own
  comment warned about.
- **Six hand-synced copies of the source list, three drifted** — replaced by a
  single exported origin (`SOURCE_DEFS` → `SOURCES` / `SOURCE_KEYS`). Dead,
  mis-ordered `SOURCE_ABBREV` in `UI.js` deleted.
- **Auto-expand no longer depends on header text** — `_collapseToLayers()`
  matched the literal string `"Layers"`, so moving that section (as the
  taxonomy restructure did) silently booted the app fully collapsed.

---

## [0.13.0] — 2026-07-28 — The Live GLSL Overhaul (Phases 13–20)

### Added
- **Pen-ready drawing (Pointer Events + pressure)** — the Draw preview
  canvas now uses Pointer Events: Apple Pencil / stylus pressure
  modulates brush size and opacity via two new params (`PressSize`,
  default 100%, and `PressOpacity`, default 0%; set to 0 to ignore
  pressure). Fast strokes stay smooth via coalesced events (no more
  dot quantization), palm touches are rejected while a pen is in
  contact, and the pen barrel button (or right mouse button) erases.
  Param-driven drawing (LFO/MIDI/Automation on DrawX/DrawY) is
  unchanged. DrawLayer gains a shared point-queue/`drawSegment` path
  that live input, param drawing, and future stroke playback all
  render through.
- **Draw on the output canvas** — a new "Draw" canvas interaction
  mode (Touch Mode index 3, joining Camera/Pad/Locked) routes canvas
  pointers straight to the draw layer: paint at full scale over the
  live composite with the same pressure/palm-rejection grammar as the
  panel preview. Toggle via the ⊕ Canvas button in the Draw tab, the
  `g` key, or a 3-finger tap; a crosshair cursor marks the mode, and
  leaving it restores the previous mode. Camera orbit/pan and pad
  gestures are untouched in their own modes.
- **Stroke looper** — a 4-slot looper pedal for drawing. Record
  strokes (pointer or LFO/MIDI-driven alike) into a slot, stop to
  loop them back as ghost strokes while drawing new ones live; slots
  free-run at independent lengths and speeds (10–400%), so loops
  polyrhythm against each other. Rec/Play/Clear/Speed are params
  (`Loop1Rec` … `Loop4Speed`) — assign MIDI pads for hands-on
  looping; a compact transport strip lives in the Draw tab. Brush
  size/color/opacity (and pen pressure) are baked into each recorded
  point, so playback ignores later pen changes. Combine with DrawFade
  for drawings that animate as they decay and repaint each cycle.
  Loop data saves/loads with `.imweb` project files.
- **Draw ↔ synthesis crossovers** — `StrokeEmit` toggle makes the pen
  drive the particle emitter while drawing (strokes trail particles);
  ⇢ Warp and ⇢ Key buttons in the Draw tab route the drawing into
  the existing displacement pass and external-key input (one-click
  `DisplaceSrc → Draw` setups — the pipeline already supported any
  source there, including Draw).
- **Stroke→LFO controller driver** — recorded stroke loops can now
  drive any continuous parameter as an LFO-like modulation source. Assign
  via the controller context menu: `Stroke L1 X` … `Stroke L4 Y` read the
  X or Y position from the corresponding Stroke Looper slot at an
  independent playhead with configurable rate (0.1–10×). The same slot
  can drive multiple params at different rates and axes — four draw loops
  become four freely-routable modulation lanes. Edit slot, axis, and rate
  in the controller popover (right-click the badge).
- **Video-as-ink drawing** — `InkSource` SELECT (Color / Camera / Movie /
  MovieB / Noise / Output) lets you paint with live source pixels instead
  of a solid colour. Camera and Movie stamp video frames through the
  brush shape; Noise generates random greyscale static each frame; Output
  snapshots the previous composite (any source routed through FG) — paint
  with the whole pipeline. A per-frame cache canvas avoids expensive
  per-point video decodes. Works on iPad via HTTPS.
- **GLSL preset MIDI recall (`glsl.preset`)** — the Live GLSL preset
  list (built-ins + saved user presets) is now a SELECT parameter with
  a standard controller badge next to the preset dropdown. Assign
  MIDI CC/Note, LFO, Random, Key, or OSC via right-click (ctrl+click /
  touch long-press) to recall shaders live; controller-driven recalls
  always compile, regardless of the Auto checkbox. Options stay in
  sync as user presets are saved/deleted. Excluded from Display State
  capture (the index would drift as the user preset list changes).
- **Recall range for GLSL presets (and all SELECT params)** — SELECT
  parameters now honor `ctrlMin`/`ctrlMax`, clamping the controller
  sweep to an index sub-range. The GLSL preset row gains min/max
  fields (drag or double-click to edit, same grammar as param rows;
  tooltip shows the preset name at each index) so MIDI/LFO recall can
  cycle just a chosen slice of the preset list.
- **AI shader generation (✨ Prompt AI)** — describe an effect in
  natural language and the configured AI provider (AI panel) writes
  the GLSL. The system prompt embeds the full VJ uniform contract;
  the result is compile-checked before it reaches the editor, with
  one automatic AI repair attempt on compiler errors. Generated
  shaders name their own uParam1–4 knob labels via metadata.
  Touch-friendly modal with pulsing progress and inline errors;
  no-key errors offer a 🔑 button that opens AI Settings with the
  key field focused.
- **VJ uniform contract for Live GLSL** — custom shaders now receive
  `tAudio` (256×2 FFT + waveform DataTexture), `tPrev` (previous
  output frame for feedback/trails), `uBPM`/`uBeat` (beat phase 0..1
  from the BeatDetector), and `uLevel`/`uBass`/`uMid`/`uHigh` audio
  bands. The full contract is auto-injected as a header (including
  the previously missing `uResolution`) and degrades gracefully when
  Sound is off. New built-in preset **Audio React** demonstrates
  bass zoom, beat flash, FFT bars, and trails.
- **GLSL insert routing** — new Target selector routes the custom
  shader to Master Output (default), Foreground, Background, or
  Displace Layer. FG/BG inserts run on the resolved layer source
  before color correction, so blends and the keyer see the shader
  output. `glsl.target` is a normal SELECT param — state-recallable
  and saved in `.imweb` automatically.
- **Live GLSL persistence** — editor source, auto-apply state, and
  active flag are saved in `.imweb` projects (additive `glsl` key;
  old files load unchanged) and restored on import.
- **User shader presets** — 💾 saves the current editor code as a
  named preset (localStorage, "— User —" group), 📄 clears to a
  blank boilerplate with a hidden "Custom" dropdown state, ✕ deletes
  the selected user preset and falls back to Passthrough.
- **CodeMirror 6 editor** — the Live GLSL `<textarea>` is replaced
  with a CodeMirror instance (lang-cpp grammar, custom dark highlight
  style, line numbers, proper iPad touch editing, vertical resize
  handle). Tab indents, Ctrl/Cmd+Enter applies, auto-apply fires on
  document changes.

### Fixed
- **Response tables now apply to every controller type** — MIDI CC,
  MIDI note velocity, mouse, tilt/compass, Wacom pressure, sound
  bands, gamepad, key, and fixed controllers wrote parameters through
  a path that skipped the assigned table entirely; only LFO and
  Random were shaped. Table resolution (including the "global" slot)
  now lives inside `Parameter.setNormalized`, so all write paths
  behave identically.
- **Live GLSL compile errors no longer kill the running shader** —
  last-good fallback keeps the previous shader rendering while the
  error panel reports the real GLSL info log (the old link-status
  introspection never matched in three r160, letting broken shaders
  slip through as "success").
- **AI response handling hardened end-to-end** — thinking-first
  responses from adaptive-thinking models (claude-sonnet-5, Opus
  4.7+) are parsed correctly (the text block is found, not assumed
  at position 0); fenced/unfenced/split/truncated model output is
  extracted robustly (quoted excerpts never win over the real
  shader); empty provider responses abort with a clear message
  instead of feeding the compiler a phantom "Missing main()"; the
  CRITICAL RULES system prompt forbids uniform redeclaration and
  WebGL 2.0 syntax; DEV-only `[glsl-ai]` console logging records raw
  response → extraction → compile errors for ground-truth debugging.
- **GLSL header injection is qualifier-proof** — regex probes
  (tolerating `lowp`/`mediump`/`highp` and extra whitespace, tested
  against comment-stripped source) replace the brittle substring
  checks, so pasted ShaderToy-style declarations are no longer
  double-injected.
- **MovieInput NaN crash** — seeks no longer write a non-finite
  `currentTime` (and kill the render loop) when a clip's metadata
  hasn't loaded or its source failed.
- **AI connection test names what it tested** — "✓ Connected —
  <model> @ <provider>", exposing saved-config mismatches; Anthropic
  model list updated to current IDs (claude-sonnet-5 default,
  claude-opus-4-8, claude-haiku-4-5).
- **GLSL preset-row buttons pushed off-panel** — the preset select
  now shrinks properly (`min-width:0`) so 📄/💾/✕ stay visible.

## [0.12.0] — 2026-07-10 — Dual-Deck & Touch Polish

### Fixed
- **iPad context-menu taps** — prompt-based assignments (LFO, Fixed, MIDI,
  Key, Expr) silently failed on iOS: `preventDefault()` on touchend killed
  the native click, and `window.prompt()` is only authorized by an
  untampered activation. Valid taps now let the native click through;
  direct-assign items (Sound/Gamepad/Tilt/Compass) keep a 350ms synthetic
  fallback in case the native click never arrives. 10px drag-guard retained
  so a scroll release never assigns.
- **TimeDisplace "Native" on large desktops** — Native buffer resolution is
  clamped to 1280 wide (aspect preserved): the 120-frame delay ring
  multiplies resolution by ~500 bytes/px, so unclamped 2000px+ panels
  silently failed WebGL allocation.
- **Repo hygiene** — user bank saves (`public/Projects/*.imweb` except
  MasterProject) untracked and ignored; the broad `!public/**` gitignore
  negation had let them slip into commits.

### Changed
- **Menu restructure** — tab bar is now Mapping | Movies | 3D | Analog |
  Draw | Project. Clips renamed Movies; Buffer content merged into Movies,
  Text into Draw, Tables + GLSL into Project (wrapper element ids kept so
  all existing JS keeps working).
- **Movie B status header** — now shows the active Deck B clip's thumbnail
  and name (▶/⏸ + clip count) instead of plain text.

### Added
- **Desktop state-bar ＋ tile** — quick-save state to next empty slot from
  the desktop bottom bar (same action as ⇧S / the mobile ＋ button).
- **Autoplay recovery** — one-time first-gesture hook resumes both decks if
  Chrome's engagement policy rejected play(); videos remain strictly
  muted + playsinline with caught play() rejections.
- **Deck target toggle (touch)** — "Target: A / B" segmented control in the
  Clip Library header routes tapped clips to the chosen deck, making Deck B
  loading possible on iPad without a keyboard. UI-local state (never flipped
  by state recall/morph), defaults to A each launch; ⇧-click remains a
  hardware override that always routes to Deck B.
- **Idle-deck upload gating** — a deck that provably cannot contribute to
  the frame skips its texImage2D upload (playback keeps running for cue;
  the currentTime change-detector re-uploads instantly on wake). Deck B
  gates whenever nothing routes to it (source 25, TimeDisp capture, or a
  live MixBus with xfade > 0). Deck A keeps exact v0.11 always-upload
  behavior except the one provably-hidden case: MixBus routed, Crossfade
  pinned at xfade = 1, no direct route, and no legacy reader live (seq
  capture, 3D scene, particles, analog, SDF, ClipLib REC all veto the
  gate). Single-deck performance cost returns to pre-dual-deck levels.
- **Deck B UI + clip routing** — "Movie B" and "Mix Bus" collapsible panels
  in the Clips tab (movieB.* and mix.* param rows via the standard mapping
  system). ⇧-click a Clip Library slot or a Deck A clip, or ⇧-drop a video
  file anywhere, to route it to Deck B; plain click/drop keeps loading
  Deck A as before. Deck B panel shows a live status line (▶/⏸ + active
  clip name + count).
- **MixBus A/B engine** — new `mix.*` param group (`xfade` 0–1 default 0 =
  pure Deck A, `mode` [Crossfade/Add/Multiply/Luma Mask/Displace], `dispAmt`,
  `maskLo`, `maskHi`) driving a MIXBUS shader pass that mixes the two movie
  decks into a dedicated render target ahead of layer resolution. "Mix Bus"
  appended as source index 26 — selectable as FG/BG/DS. Pass is skipped when
  neither deck is live; it reads only the deck textures, so no feedback
  hazard. No UI yet (Step 4).
- **Deck B movie engine (headless)** — second `MovieInput` instance driven by
  `movieB.*` params (registered from a shared descriptor table with Deck A so
  the two can never drift); "Movie B" appended as source index 25, selectable
  as FG/BG/DS and everywhere the shared source list is offered. No UI yet —
  dev console access via `window.__decks` (dev builds only). Build plan:
  `docs/ImWeb-DualDeck-v0.12-BuildPlan.md`.

### Fixed
- `_resolveLayerTex()` source-key list was missing `tdisp` (index 24), so
  "TimeDisp" fell through to the Output fallback in secondary lookups
  (e.g. `td.captureSource`).

---

## [0.11.0] — 2026-07-07 — Touch & Ergonomics Overhaul

A ruthless UX audit of the touch layout ("the Grill Report") followed by
systematic fixes: live-performance safety, main-thread performance,
finger-sized ergonomics, touch physics, desktop canvas parity, and
iOS-hardened precision value entry.

### Added
- **Flick momentum on param drags** — fast touch/pen drags hand residual
  velocity to a friction glide on clean pointerup; never on pointercancel
  (reverts), never on controller-owned params, and the loop yields the
  instant anything else writes the value. `e218857`
- **Touch value entry** — double-tap any continuous value field (and the
  min/max fields) for an inline type-in editor; iOS-hardened: synchronous
  focus inside the gesture, `type=text inputmode=decimal` for the numeric
  pad, explicit min/max clamping, and the ImWeb virtual keyboard now types
  directly into focused fields. `16938d8`, `dc40305`, `d53c2f6`
- **Desktop canvas parity** — 'g' cycles Camera/Pad/Locked (3-finger-tap
  equivalent; macOS eats trackpad 3-finger gestures); wheel/trackpad-pinch
  zoom eases toward `scene3d.scale` with a Wheel Zoom toggle + sensitivity
  in Global params; left-drag orbits with the same coast inertia as a touch
  flick (shared physics via GestureArbitrator), right-drag pans.
  `647db84`, `47aa1bd`, `c99cafa`
- **UI chrome toggles** — version in the logo (from package.json), ◎ OSD
  toggle ('i'), ▤ state bar toggle ('u', localStorage, auto-hidden in
  fullscreen incl. the mobile bar), signal path hidden by default with the
  ┄ button as show/hide (float/dock moved to Shift+P). `47aa1bd`, `b952999`
- **Unified long-press** — one `LONG_PRESS_MS` (400ms) constant replaces
  the fractured 220/500/600ms timings across badges, rows, and state
  tiles. `4a384a2`

### Fixed
- **Live-performance safety (Grill Report P1)** — `overscroll-behavior:
  none` lockdown + beforeunload guard against swipe-back killing the show;
  `viewport-fit=cover` + safe-area insets so the mobile state bar clears
  the iOS home indicator; pointercancel recovery reverts browser-hijacked
  drags instead of leaving corrupted values; the virtual keyboard no longer
  rests on top of the state tiles. `7469337`
- **Rotation slider stutter** — a touch on the slider had three writers
  fighting (row relative drag, native absolute slider, rAF thumb
  write-back); slider gestures are now single-writer, and `scene3d.rot.*`
  re-bases the mesh while auto-spin runs, so rotation is live during spin
  (root cause of "rotation slider dead" — MasterProject states carry
  non-zero spin). `3b2455f`, `7b10cc7`
- **Context menu scroll safety** — a tap that stops iOS momentum scroll
  can no longer trigger a controller assignment (150ms capture-phase click
  guard); menu overscroll is contained. `4a384a2`
- **Coach notification** — centered over the canvas (was on top of the
  status bar) and transient (2.5s, was 10s). `b952999`
- **Detached panels & floated signal path drag on touch** — mouse-only
  drag handlers migrated to pointer events with capture and
  `touch-action:none`. `c88b890`

### Changed
- **Coarse-pointer param rows rebuilt** — 44px min/max fields, full-height
  badge/value hit areas (no dead stripes), 22px slider lane with a 20px
  thumb on a slim visual track, touch-sized option button groups; labels
  keep room ("Rotation X" fits the 300px slide-over). Desktop rules
  untouched. `a37b0c9`, `3b2455f`, `f3e5cd8`

### Performance
- **rAF-batched param→DOM sync** — controller writes (LFO/Random/Sound at
  60Hz) no longer fan out synchronous DOM writes per change; all bindings
  flush once per frame. **Targeted MobileStatePad refresh** — persistent
  index-keyed tiles replace the full innerHTML rebuild per sequencer tick;
  hidden modal grid skipped. `e3302fc`

---

## [0.10.0] — 2026-07-07 — The Touch Instrument

ImWeb becomes a full touch instrument on the iPad: mode-based canvas
gestures, a mobile performance layout, camera over trusted HTTPS, and
the device itself as a controller.

### Added
- **Device motion controllers (Phase 6)** — Tilt X, Tilt Y (±90° → 0–1,
  flat = 0.5, screen-orientation compensated) and Compass (0–360° → 0–1,
  wraps at north) join the assignable controller list, behaving like any
  MIDI fader or LFO (slew/tables apply). iOS sensor permission is
  requested inline when a motion controller is assigned; the Global
  "Enable Motion" trigger covers preset-recall cases. The
  `deviceorientation` listener binds only while a motion mapping exists.
  Requires HTTPS (`npm run dev:https`) — sensors are dead on plain http.
  Commits `b2fd9b3`, `4bce2d0` (scrollable controller menu on small
  screens; permission outcome flashed in the OSD with sensor-event
  logging for on-device diagnosis).
- **Slot-based mirror: Mirror FG / Mirror BG (Phase 5, breaking)** — the
  three source toggles (Mirror Cam/Movie/Buffer) are replaced by two slot
  toggles that flip whatever occupies the Foreground/Background layer —
  any source, not just camera/movie/buffer. The flip is folded into the
  per-layer colorcorrect pass (`uFlipH`), so mirroring costs no extra
  render pass, cannot collide in the two-target ping-pong pool (the
  `b36851b` regression that blanked mirrored layers), and now composes
  with hue/sat/brightness instead of bypassing them. Selfie heuristic
  targets whichever slot the camera occupies. Legacy mirror params stay
  registered so old presets load, but no longer have any effect
  (discovery: the Layers "Mirror Movie" row never worked — it was a
  different param than the one the pipeline read). Commits `b36851b`,
  `bbbcc9a`.
- **Pad-mode crosshair (Phase 5)** — a thin accent crosshair over the
  canvas tracks the pad X/Y touch point (1-finger or 2-finger centroid):
  full visibility while driving, 0.25-opacity parked ghost on release,
  hidden whenever the touch mode leaves Pad by any path. Touch devices
  only. Commit `480b83d`.
- **Orbit inertia (Phase 5)** — flicking a 1-finger orbit lets the scene
  coast with friction (0.92/frame, frame-rate independent) until it stops;
  holding still before lifting doesn't coast; touching the canvas while
  coasting kills the momentum instantly (tactile clutch). Commit `d7284b1`.
- **3-finger tap mode cycle (Phase 5)** — a quick 3-finger tap on the
  canvas advances the touch mode (Camera → Pad → Locked → …) and flashes
  a large "MODE: <NAME>" OSD that fades after 800ms. Works in Locked mode
  (so it can unlock); camera values are restored on clutch engage so the
  tap is a net no-op on the image; held/moved 3-finger contact remains an
  unbound null zone. Commit `e9d91b6`.
- **Movie texture upload gating (Phase 5)** — movie textures upload to the
  GPU only when the decoded position actually moves (plus a `seeked`
  refresh for async seek completion); paused or held frames are no longer
  re-uploaded every render tick. Note: rVFC gating à la the camera fix
  does NOT work for file playback — `requestVideoFrameCallback` never
  fires for these non-DOM `<video>` elements — so `currentTime` change is
  the gate. Commit `ea35381`.
- **Mobile state pad (Phase 4)** — on ≤900px screens the 32-tile state bar
  is replaced by a single touch button showing the active state's thumbnail
  and name; tapping opens a full-screen modal with a 4-column grid of large
  pads for the current bank. Pad taps use the exact desktop code path
  (`pm.recallState`) and auto-close the modal; button and grid subscribe to
  the same PresetManager events as the desktop StateBar, so MIDI/sequencer
  recalls never leave a stale thumbnail. New `src/ui/components/
  MobileStatePad.js`; elements mount as direct `<body>` children (modal
  z-index 300). Desktop layout untouched. Commit `9b78bf8`.
- **Mobile ergonomics (Phase 4 Task 2)** — mobile media queries now also
  match large touch devices (`(max-width: 1366px) and (hover: none) and
  (pointer: coarse)`), so iPad landscape gets the mobile layout; [＋Save]
  and [○Clear] quick actions flank the mobile state button and appear in
  the modal head (Save = exact Shift+S quick-save path, extracted into a
  shared `quickSaveState()`; Clear = the desktop ○ `neutralState` event);
  virtual keyboard keys enlarged 26×30→40×44px. Commit `dd28177`.
- **Hybrid mobile state bar (Phase 4 Task 3)** — the wide Current State
  button is replaced by `[○Clear] [＋Save] [scrolling thumbnail strip]
  [⋯More]`; the strip shows every stored state as a tappable mini-tile
  (same `pm.recallState` path), active tile ringed and kept in view, new
  saves appear live; ⋯More opens the modal pad grid. Also reverts
  `resize: both`/`overflow: auto` on the virtual keyboard panel — iOS
  doesn't support `resize`, and `overflow: auto` made iOS eat key taps
  (async-scroll region pointercancel); key size increases kept.
  Commit `9e14dd2`.
- **Long-press to clear + callout suppression (Phase 4 Task 4)** —
  long-pressing a state thumbnail (strip or modal grid, 600ms / <10px
  travel) clears that slot through the identical code path as the desktop
  tile menu's Clear, with a red-ring shrink flash as feedback; movement,
  lift, or cancel aborts the timer so scrolling never deletes.
  `-webkit-touch-callout: none` (+ selection/drag lockdown) applied to the
  mobile bar and modal subtrees, killing iOS's native Save Image/Share
  menu on long-press. Desktop right-click menu unaffected.
  Commit `4975ebc`.
- **Long-press action menu** — long-press on a state thumbnail now opens
  a Duplicate / Clear menu instead of instantly deleting; Duplicate copies
  the state into the next empty slot (export/import path, " copy" name
  suffix); outside tap dismisses (capture-phase listener). Commit `a9add76`.
- **Touch double-tap on param rows** — double-tap resets a continuous
  param (same as desktop double-click); double-tap on a min/max range
  field opens the inline number editor. Touch pointers only — desktop
  dblclick behavior unchanged. Commit `cc71cdc`.
- **Canvas grab takes control from auto-spin** — while spin is active the
  rot params are ignored by SceneManager, which made 1-finger orbit
  invisible; a Camera-mode gesture start now freezes the live mesh pose
  into `scene3d.rot.*` (0–360-wrapped, no jump) and zeroes the spins.
  Commit `d439457`.
- **Opt-in HTTPS dev server** — `npm run dev:https` serves over TLS
  (basic-ssl) so iPad Safari allows camera/mic (`getUserMedia` requires a
  secure origin); plain `npm run dev` stays http to keep the Dev Capture
  catcher (:5174) reachable. Commit `3020a35`.
- **Endless 1-finger orbit** — touch orbit wraps rotation modulo 360
  instead of clamping at the rot param bounds, so a drag keeps spinning
  past full turns. Commit `613af0b`.
- **Front/back camera flip (mobile)** — new ⇄ status-bar button (mobile
  media query only) toggles `facingMode` user/environment;
  `CameraInput.switchFacing()` restarts the live stream after stopping
  all previous tracks so device hardware is cleanly released. Trusted
  mkcert dev certificate added for `dev:https` (iPad Safari has no
  self-signed bypass) — `certs/` gitignored, root CA install documented.
  Commits `fc646a5`, `eac52a3`.
- **Camera device select in Layers + selfie mirror** — the `camera.device`
  param (previously registered but orphaned) now renders next to Mirror
  Cam in the Layers section, populated from device enumeration, and is
  the single camera-restart path (the I/O dropdown drives and follows
  it); flipping to the front camera auto-sets Mirror Cam, back camera
  clears it. Rendered as a true dropdown (`select: true`) with the device
  list re-enumerated after camera permission (iOS hides front cameras
  until granted), and a label heuristic (front/facetime vs back/rear)
  drives Mirror Cam on manual device picks too. Commits `e324bf9`,
  `f03a52a`, `ce8434d`.
- **Canvas touch grammar — GestureArbitrator (Phase 3)** — new
  `src/core/GestureArbitrator.js` routes touch/pen gestures on the output
  canvas by pointer count and the new `touch.mode` SELECT param
  (Camera / Pad / Locked, global group — preset/MIDI/sequencer-capable):
  Camera = 1-finger orbit (`scene3d.rot.x/y`, 0.35°/px) + 2-finger pinch
  zoom (`scene3d.scale`); Pad = normalized canvas X/Y (finger or 2-finger
  centroid) fed into the ControllerManager mouse channel, driving every
  mouse-x/mouse-y-assigned param; Locked = touch ignored. 3+ fingers is a
  null-zone clutch: output suspends until all fingers lift — nothing is
  bound to 3+ fingers so iOS system gestures (three-finger undo/redo)
  can never corrupt state; `touch-action: none` + non-passive touchstart
  preventDefault suppress the OS recognizers. Desktop mouse grammar
  untouched (mouse pointers ignored). Replaces the always-on two-finger
  pinch block in main.js, which is now Camera-mode-gated.

- **Touch refinements (Phase 3)** — 1-finger orbit on iPad: scroll
  suppression is `touch-action: none` ONLY (stylesheet + inline in the
  arbitrator constructor); a touchmove-preventDefault approach was tried
  and reverted (`a9edf05`) because iOS WebKit stops synthesizing
  pointermove events for cancelled touches; new status-bar **Camera** toggle
  (`btn-camera-toggle`, wired to `camera.active`, mirrors the MovieOn
  pattern); fullscreen button now enters true device fullscreen
  (`requestFullscreen` + webkit fallback, `pointerup` for iOS activation)
  with a `fullscreenchange` sync so browser-initiated exits drop the
  layout class. Commit `4e7bef7`.
- **2-finger double-tap fullscreen + video touch hardening** — a 2-finger
  double-tap on the canvas (taps ≤300ms / ≤12px travel, ≤300ms apart)
  triggers the same fullscreen toggle as the status-bar button
  (GestureArbitrator `onDoubleTap2` hook); all texture video elements
  (MovieInput, CameraInput, ClipLibrary probe) carry `playsinline` +
  `webkit-playsinline` attributes and `pointer-events: none` so iOS
  media-session heuristics can't pause/play them during touch
  interaction. Commit `ed68d2f`.

### Changed
- **Phase 2 UI componentization complete** (tag `ui-componentization-done`) —
  five verbatim extractions from the UI.js / main.js monoliths, zero visual
  change; every moved function is re-imported under its original alias so all
  call sites and the main.js import block are untouched:
  - `mkSelect` → `src/ui/components/Select.js`. Commit `bb0b2c7`.
  - `openCtrlPopover` → `src/ui/components/CtrlPopover.js`. Commit `0d9af03`.
  - New `src/ui/bindings/ParamBinding.js` — `createBinding(param)` with
    immediate-fire `sync(fn)` and idempotent `dispose()`. Commit `66215f5`.
  - `buildParamRow` → `src/ui/components/ParamRow.js`; all 5 `param.onChange`
    call sites routed through `binding.sync()`. Commit `d2f1001`.
  - `initTabs` (UI.js) + `_applyLayout` (main.js) →
    `src/ui/layout/LayoutManager.js`. Commit `5076e22`.

### Fixed
- **camera.active now drives the hardware** — toggling the param (status
  bar, V key, presets, MIDI) previously changed display state only; the
  stream and camera LED kept running because start/stop lived solely in
  the I/O button's click handler. Commit `5409d01`. Also `c34bc2a`:
  camera texture no longer force-re-uploads every render frame (three's
  VideoTexture rVFC gating now applies). Note: desktop low-fps reports on
  the MacBook were ultimately macOS automatic graphics switching parking
  Chrome on the Intel iGPU — disable switching (Battery → Options) for
  performance sessions; not a code issue.
- **iPad boot crash: mediaDevices in insecure contexts** — `navigator.
  mediaDevices` is undefined on iOS Safari over http:// (LAN dev server),
  so the I/O section's `enumerateDevices()` property access threw a
  TypeError seconds after first paint (the call sits late in main()'s
  async boot flow — no polling loop involved). Both main.js call sites now
  optional-chain the full expression; all other mediaDevices callers were
  already try/catch-wrapped. Camera/audio remain unavailable over http on
  iOS (WebKit policy) — the app now degrades gracefully instead of dying.
  Commit `5bbc934`.
- **Param-row listener leak on search rebuild** — `row._psUnsub` released only
  the `updateDisplay` subscription; the range-field, button-group/dropdown, and
  slider subscriptions leaked on every param-search rerender. `_psUnsub` now
  disposes the row's full ParamBinding (all subscriptions), with no change to
  the consumer in main.js. Commit `d2f1001`.

- **Mobile slide-over panel unclickable / grayed out** — `#panel-overlay`
  (z 199) painted on top of `#control-panel` (z 200), so panel taps hit the
  overlay's tap-to-close handler and dismissed the menu. Root cause: `#app`
  was `position: fixed`; Chromium promotes fixed elements to composited
  layers, forcing a stacking context that trapped the panel's z-index below
  the body-level overlay. Fix: `#app` is now `position: absolute` — pixel-
  identical since body never scrolls, but the panel's z-index resolves in
  the root stacking context again. Pre-existing bug (present at `bdbe955`),
  diagnosed via DevTools + headless hit-testing.

- **Status bar buttons clipped on narrow windows** — `#status-bar` was a
  fixed-height flex row without wrap; buttons overflowed off the right edge.
  Now `flex-wrap: wrap` with `min-height` and a 4px row gap; `applyLayout()`
  syncs `--status-h` to the measured bar height on init/resize so `#app` and
  the slide-over panel start below the wrapped bar (with anti-ratchet reset
  and a fullscreen zero-height guard). Pre-existing (present at `bdbe955`).
  Commit `ae1e661`.

## [0.9.0] — 2026-06-15 — The Noise Family

### Added
- feat(shaders): uSwirl added to PsrdWarp — gradient vs curl warp blend;
  mix(gsum, vec2(-gsum.y, gsum.x), uSwirl) in octave loop
- feat(shaders): uRidge added to PsrdWarp — abs() accumulation blend;
  orthogonal to uSwirl
- feat(ui): Swirl and Ridge sliders wired into noise panel fractalSection
- **PsrdWarp gradient domain warp as uType 40** — added `psrdnoise_grad()` helper returning a `PsrdResult` struct for WebGL ES 1.00 compatibility, mapped `PsrdWarp` at parameter index 40, and wired it under the `Periodic` noise family in `UI.js`. Commit `09fb511`.
- **psrdnoise2 support as uType 39 (Phase 2)** — implemented Stefan Gustavson's 2D periodic simplex noise (`psrdnoise2`) as noise type 39 under a new `Periodic` noise family. Commit `9fcde26`.
- **Wired psrdnoise2 parameters** — registered `noise.period.x`, `noise.period.y`, and `noise.alpha` in `ParameterSystem.js`, wired them in the Pipeline rendering path, and integrated them into the Noise panel in `UI.js`. Commit `6d40b20`.
- **Noise panel family→type selector, Phase 1** — added `noise.family`
  with Gradient, Fractal, Cellular, Warp, Pattern, and Analog families; rebuilt
  the Noise panel as `buildNoisePanel()` with a family row, type grid, shared
  params, and a Fractal-only section.

### Changed
- **Noise UI wiring simplified** — `main.js` now calls exported
  `buildNoisePanel()` and passes `p.family` into `generateNoise`; legacy
  `_syncNoiseParamVisibility()` and `_patchNoiseTypeOptgroups()` code was
  removed. Commit `d2b7fe2`.

### Fixed
- **HyperCube wireframe framerate** — wireframe was dropping from 60 fps
  to 30–40 fps while Points mode held 60 fps. Root cause: `_updateBuffers()`
  unconditionally uploaded full MAX_DIM-sized GPU buffers (~1.1 MB each for
  `aEndA`/`aEndB`) every frame and drew all 24,576 edges regardless of active
  dimension. For a 4D cube only 32 edges are active. Fix: `_computeLastActiveEdge()`
  scans the edge list once per dimension change and stores the buffer index of
  the last active edge; per-frame `setDrawRange` and `addUpdateRange` are scoped
  to that ceiling, cutting GPU upload from ~2.2 MB to ~14 KB and draw calls from
  147,456 to ~1,000 triangles for 4D. Commits 30530de, 853ab66.
- `_resetAllParams` (↺ button, Shift+Esc): suspend `global.morphspeed`
  during `ps.getAll()` reset cascade to prevent interpolated transitions
  when MORPH is active. Commit 0bfdfe9.
- `neutralState` listener (○ button, Shift+0): same morph suspension fix
  applied — was the actual button causing the reported "shifting loop"
  on reset. Commit 83118ba.
- fix(scene3d): white default material when no texture assigned
  (emissive floor 0.35, preserves directional lighting and shadows)
- fix(scene3d): _noiseUsed flag includes scene3d.mat.texsrc=Noise
- fix(scene3d): auto-seamless noise period matched to uScale
- fix(scene3d): triplanar sampling eliminates UV seam — vObjPos + USE_OBJ_NOISE
- fix(scene3d): T-Displace uses noise texture when texsrc=Noise
- fix(scene3d): T-Displace triplanar sampling matches visual texture
- fix(scene3d): material.color always 0xffffff; MatHue/MatSat route to
  emissive tinting only; stale hue fallback 240 fixed to 0
- **PsrdWarp mod() wrapping removed** — eliminated manual `mod()` on
  `warped` coordinates in uType 40 branch; `psrdnoise` handles periodic
  lattice boundaries internally and requires continuous input coordinates.
  Commit 1b2ed0a.
- **PsrdWarp/Psrd2D asymmetric period response fixed** — introduced
  `periodicP = p.xy + vec2(floor(uScale * 0.5) + 1.0)` in both uType 39
  and uType 40 so all canvas coordinates are positive, eliminating the
  left-side/lower-side-only effect when period sliders change.
  Commits 3d5f6da, a56cdb7.
- **Noise animation stutter from wall-clock time** — replaced
  `time: lastTime / 1000` with a capped-dt `noiseTime` accumulator;
  frame hitches no longer cause large shader time jumps. Commit 386b7fb.
- **Speed slider phase jump** — added `uPhase` uniform driven by
  `noisePhase += speed * dt` accumulated in JS before render-gate guards;
  shader now uses `t = uPhase + uSeed`, eliminating phase discontinuity
  when Speed is changed mid-session.
- **noisePhase render-gate bypass** — moved `noisePhase` accumulator
  before `_captureMode` / `shouldRender` early returns so phase advances
  every RAF tick regardless of frame skipping.
- **Alpha cycling in non-periodic mode** — `alphaPhase` mod() bounding
  now only applies when period > 0; period = 0 (organic mode) uses
  unbounded `alpha = time` as in the original Gustavson reference,
  restoring continuously evolving non-repeating animation.
- **Period step reverted to 1** — `step: 2` even-integer enforcement on
  `noise.period.x` and `noise.period.y` was based on an incorrect lattice
  alignment diagnosis and unnecessarily excluded odd values; reverted
  to `step: 1`.
- **Pipeline._noiseTime initialized** — added `this._noiseTime = 0` in
  Pipeline constructor to prevent NaN accumulation affecting film grain,
  interlace, and custom shader time uniforms.
- **psrdnoise GLSL ES compatibility** — rewrote the `psrdnoise` implementation in `src/shaders/index.js` to remove the `out vec2 gradient` parameter and replaced the `any(greaterThan(period, vec2(0.0)))` check with a float step comparison to ensure compatibility with WebGL 1 / GLSL ES 1.00.
- **psrdnoise animation flow** — changed animation drive from `uAlpha` to `t + uAlpha` in `src/shaders/index.js` so that the noise pattern animates/flows naturally according to the main Speed slider.
- **Chrome 148 ANGLE/Metal regression diagnosed** — vertex shader rendering 
  broken on macOS Chrome 148 for Hypercube wireframe edges (LineSegments) and 
  Harabara GLB model (SkinnedMesh). Root cause: Chrome 148 ANGLE/Metal backend 
  regression. Confirmed across multiple GPU types (Intel UHD 630, AMD RX 590). 
  Safari and Firefox unaffected. Chromium bug filed May 16 2026.
- **Workaround:** launch Chrome with --use-angle=gl flag
- **aTB attribute** replaces gl_VertexID in HypercubeObject edge shader
- **highp sampler2D** precision declared on vertex-stage samplers in 
  SceneManager displacement shader injection
- **textureLod** replaces texture() in vertex shader displacement and warp paths
- **SkinnedMesh → plain Mesh** conversion in loadGLTF() to eliminate 
  USE_SKINNING / texelFetch bone texture in vertex stage
- **Noise scale from center** — fixed scale calculation in `NOISE_BFG` 
  (`vUv * uScale` → `(vUv - 0.5) * uScale + 0.5`) in `src/shaders/index.js` to keep scaling centered
- **Chrome 148 ANGLE/Metal regression — resolved upstream (2026-06-10)**:
  Google fixed the Chromium bug filed above. Hypercube wireframe edges and
  the Harabara GLB model now render correctly on Chrome with the default
  Metal backend; the `--use-angle=gl` workaround is no longer required.
- **Noise: Sharpen relocated into Noise panel** — `noise.sharpen` is now a
  per-noise-texture unsharp-mask pass (dedicated `_noiseSharpTarget`,
  2px kernel radius, up to 8x amount) instead of a global Effects pass.
  Commits `f2cecb4`, `fff4bfa`.
- **Noise: Value/Gradient speed-pulsing fixed** — `vNoise` blends a second
  sample at a half-cell time offset so the quintic ease curve's
  zero-derivative point on one phase is covered by the other's peak,
  removing the periodic "speed up/slow down" breathing. Isolated to
  Gradient/Value (uType==1). Commit `c079d4b`.

### Added

- **OpenRouter AI provider** — added as a fifth provider (chat completions +
  model list), giving access to many vendors' models through a single API
  key. Commit `1ee3b17`.
- **In-app Markdown docs viewer** — new `#docs-viewer` modal renders Quick
  Reference / Full Manual from the Settings panel without leaving the app
  (lazy-loads `marked`, ~35KB); "Quick Reference" / "Full Manual" links open
  this modal instead of downloading the raw `.md`. Added a "Keyboard
  Shortcuts" link that opens the existing `#kb-help` overlay. Commit
  `6794b23`.
- **Param search overlay filter chips** — All / Active / LFO / MIDI / Sound /
  Mouse / Other / **Modified** chips filter the 385 params by controller type
  or by whether the value differs from its default, composing with text
  search. Panel enlarged (560px, 60vh results), result cap raised 20 → 60.
  Commits `2eb4e02` and this release's "Modified" chip.
- **AI Settings: live model lists + persistent connection status** — "⟳
  Refresh models" fetches each provider's live model list (Anthropic, Gemini,
  OpenAI, Ollama); "✕ Clear key" per provider; connection status now shows the
  last test result with a relative timestamp ("✓ Connected (5m ago)") that
  survives panel rebuilds and reloads. Commit `f9a6860`.
- **AI Performance settings** — Narrator/Coach poll intervals (5–60s / 15–120s)
  and Narrator description length (Short/Medium/Long) are now configurable in
  AI Settings. Commit `85a9d27`.
- **SDF Generator** now raymarches at half resolution and bilinear-upscales on
  composite — the 96-step raymarch + 6-sample normals + AO was too expensive
  per-pixel at full canvas resolution.

### Changed

- **Narrator/Coach defaults** — Narrator default interval raised from 2.5s to
  10s (was issuing ~24 calls/min, burning API cost in minutes); Coach default
  45s. Commit `85a9d27`.
- **Search Parameters results** now reuse `buildParamRow` for inline
  drag/toggle/select/dblclick-reset editing directly in the results list, with
  a ⌖ button to scroll-to/highlight the live row. Commit `b024db6`.
- **MasterProject factory default** updated to 8 banks (was 5), `activePreset`
  reset to 0.

### Fixed

- **Narrator source-name mapping** — `SOURCE_NAMES` now mirrors
  `ParameterSystem.js` exactly (25 sources including 3D Depth/SDF/VWarp/
  Analog/TimeDisp), fixing misreported active sources (e.g. an active Noise
  source reported as "3D"); added `describeSourceDetail()` so the Narrator
  describes the active noise type / 3D geometry / SDF shape / analog source /
  sequence detail. Commit `1ee3b17`.
- **AI Coach empty-response / error handling** — shows a visible hint when a
  model resolves successfully with an empty string (e.g. a "thinking" model
  consumes its budget on reasoning), and surfaces errors (rate limit, bad key,
  etc.) instead of silently fading the placeholder; `.ai-coach-notif` now wraps
  and centers longer text. Commits `a1412b5`, `85a9d27`.
- **Shift+P no longer also toggles AI Coach** — Narrator/Coach `n`/`p` keydown
  handler restricted to plain keys (no modifiers), since Shift+P is also bound
  to the Signal Path panel toggle; documented previously-missing shortcuts
  (q/a/z, d, n/p, Shift+P, Shift+V) in `#kb-help` and updated button tooltips.
  Commit `7ced27b`.
- **Active Controller assignments panel position** — was anchored off-screen
  above its toolbar button; now positions below the button, clamped to the
  viewport. Commit `b024db6`.
- **þ/Þ as alternate Search Parameters shortcut** — `/` didn't fire on
  Icelandic keyboards (Shift+7=/ intercepted by the clip-select shortcut).
  Commit `b024db6`.
- **Assign-controller context menu z-index** — raised above the param search
  overlay (`.context-menu` was below `#param-search`, opening the menu behind
  the overlay). Commit `9950db0`.
- **Stills Buffer slot count docs corrected** — 1–64 via a configurable 8×8
  grid (default 4×4=16), not 4–32 as previously documented. Commit `003240c`.

## [0.8.9] — 2026-05-12 — Banks That Remember

### Fixed

- **Active bank lookup** now uses bank `.index` field, not array position
- **3D model (Harabara-optimized.glb)** now loads correctly from MasterProject on first launch
- **Model URL persisted in state mediaRefs** — survives bank switches and state recalls
- **blend.active and feedback.active** now gate their pipeline passes correctly
- **feedback.active registration** — was not registered as a parameter; added to ParameterSystem
- **Bundled Models button** click handler used wrong SceneManager reference

### Changed

- **feedback.mode** option 0 renamed Copy → Off
- **BG blend mode** labelled "Self-process mode" to clarify asymmetry with FG blend
- **Splash screen** shows MasterProject load status on first launch only
- **Bundled Models section** added to 3D tab for URL-based public asset loading

## [0.8.8] — 2026-05-06 — Second Screen & Save Repairs

### Fixed

- **Splash version missing** — `__APP_VERSION__` now injected via Vite `define`; value written into `#onboarding-version` span on load (98fecac)
- **3D models lost on save/load** — `currentModelUrl` persisted as `modelAsset` in `.imweb` and `.imbank` project files; restored on import via `SceneManager` (1175e44)
- **Second screen → black output** — DPR change handled with `matchMedia` listener re-registration; added `webglcontextlost` / `webglcontextrestored` handlers to recover gracefully from GPU context loss (45fbaa04)
- **MasterProject not auto-pushed** — `npm run push-master` script added; optional post-commit hook available via `npm run install-hooks`; workflow documented in CLAUDE.md (726e0c0)

## [0.8.7] — 2026-04-29 — Per-Layer Blend & Feedback

### Changed

**Per-layer blend architecture refactor**
- FG.blend now composites FG over BG (was self-blend — blending a texture against itself), using the full 22-mode TRANSFERMODE shader
- FG.blendAmount slider (0–1) controls blend opacity; defaults to 1.0 for backward compatibility
- BG.blend remains a self-process tone treatment (Screen/Multiply/etc.)
- Removed `layer.ds.blend` — DS is a displacement source, not a visual layer

**Feedback loop improvements**
- `output.transfer` renamed to `feedback.mode` — drives blend mode for the temporal feedback loop (22 modes: Add, Difference, Multiply, etc.) instead of simple `mix()`
- Feedback loop now uses TRANSFERMODE shader; blend mode + blend.amount enable creative feedback trails (Add-feedback, Difference-feedback)

**uBlendAmount uniform**
- Added `uBlendAmount` (0–1) to TRANSFERMODE shader; defaults to 1.0 in material constructor so all existing call sites preserve current behavior

### Fixed

**WebGL feedback loop (GL_INVALID_OPERATION)**
- Guard moved into `_pass()` itself — checks every texture uniform against the render target texture before rendering, substituting fallback if they collide
- Covers all call sites (feedback, FG-on-BG, displacement, keyer, chromakey, warp, all effects) regardless of upstream pass count
- Rate-limited console warning fires up to 10 times for regression detection

**Migration**
- `output.transfer` → `feedback.mode` in `importState()` for backward-compatible preset/project loading
- DemoPresets and ImXImporter updated

### Added

**Hypercube Face Masks**
- Luminance-based alpha masking on face quads — route any pipeline source (Camera, Movie, Screen, Draw, Buffer, Noise) as a mask; bright areas reveal the face, dark areas cut it
- Mask invert toggle and Mask level gain (0–4×) for fine control
- Mask texture goes through the same isolated copy-blit path as the face texture — no WebGL feedback loop

**Hypercube Face & Instancer Material Controls**
- Blend mode dropdown per face layer: Normal / Additive / Multiply / Subtract
- Hue and Saturation controls for face tint (white by default = no tint)
- Texture source dropdown for both Faces and Instancer — route Camera / Movie / Screen / Draw / Buffer / Noise directly onto face quads or instancer geometry

**Hypercube Instancer**
- InstancedMesh at each hypercube vertex position; 13 geometry types via GeometryFactory (Sphere, Torus, Cube, Plane, Cylinder, Capsule, TorusKnot, Cone, Dodecahedron, Icosahedron, Octahedron, Tetrahedron, Ring)
- Scale, opacity, and texture source controls; all parameters MIDI/LFO-assignable
- Render mode `none` hides wireframe and points for instancer-only view
- SceneManager adopts instancer mesh — unified material pipeline; receives lights and material params from the existing Material panel

### Fixed
- Faces invisible in 3D Scene (visible only in 3D Depth): missing `instanceMatrix` application in ShaderMaterial vertex shader
- `depthTest: true` caused faces to occlude/be occluded by 3D geometry — set to `false` (faces are transparent overlays)
- Black plane visible in scene when renderMode=`none`: `_updateVisibility()` now explicitly hides faces and instancer mesh
- State save/restore: all hypercube parameters now correctly save and restore including instancer, faces, blend, hue, tex source
- Hypercube UI selects showing defaults after state recall: deferred panel rebuild via `_hcPanelRebuild` callback
- WebGL feedback loop when pipeline output routed to face/mask texture: isolated copy-blit render target

---

## [0.8.5] — 2026-04-16 — Analog TV & CRT (Phase 1)

### Added
- **Analog TV & CRT Simulation (Phase 1)** — Dedicated 720x480 internal render target for stable performance; includes 4:3 cropping and base signal color grading (hue, saturation, brightness, contrast); routed as a standard Layer Source.
- HypercubeInstancer — InstancedMesh at hypercube vertex positions, 13 geometry types, scale, opacity controls
- Instancer texture — pipeline output wired to instancer material each frame
- Render mode `none` — hides wireframe and points for instancer-only view
- SceneManager adopts HypercubeInstancer mesh — unified material pipeline

### Fixed
- Unbind blend uPrev before copyToPrev — eliminates WebGL feedback loop
- zeroMatrix was identity — caused ghost planes at origin
- hFaces.update moved after projection — was reading stale projBuf
- Use emissiveMap on instancer — texture now renders without scene light dependency
- setVisible() now updates `_visible` flag — was only setting mesh.visible
- Removed per-frame setInstancerTexture() call from main.js — SceneManager now owns instancer texture via _adoptMesh
- Emissive forced white when texture active on adopted mesh
- Feedback loop guard bypassed for adopted instancer mesh

---

## [0.8.4] — 2026-04-16 — Hypercube Faces

### Added
- **Hypercube pipeline texture on faces (Session 2)** — `HypercubeFaces.js` now uses `ShaderMaterial` with `uFaceTexture` to sample the real-time pipeline texture onto hypercube faces; added `hypercube.faces.active` and `hypercube.faces.opacity` parameters with UI controls; corrected all hypercube parameter registrations in `main.js` to use the valid single-object `ps.register({})` form, fixing a critical bug where parameters were stored under `undefined`.

### Fixed
- fix(scene3d): null face texture before render pass to break WebGL feedback loop (97e88e8 — actually committed earlier)
- fix(scene3d): null mesh material.map before render pass to break pipeline feedback loop (97e88e8)

### Known Issues
- WebGL feedback loop (GL_INVALID_OPERATION) fires on startup in SDF/Metaballs pipeline. Source not yet identified — SceneManager.js confirmed not involved. Investigation deferred to next session.

---

## [0.8.3] — 2026-04-16 — Hypercube 2-Cell Faces

### Added
- **Hypercube 2-cell face rendering (Session 1)** — Added `generate2CellFaces(dim)` to `HypercubeGeometry.js` returning corners and axes for all $C(dim,2) \cdot 2^{dim-2}$ faces; introduced `HypercubeFaces.js` using `InstancedMesh` of `PlaneGeometry` with zero-allocation optimizations; wired into `HypercubeObject.js` for real-time centroid/normal/size computation; 4D hypercube now correctly renders 24 rotating faces.

---

## [0.8.2] — 2026-04-16 — Screen-Space Edge Width

### Added
- **Real screen-space hypercube edge width** — Replaced `LineSegments` with quad `Mesh` (2 triangles per edge) for true variable-width lines (0.5–8.0 px); implemented per-edge quad buffers (`_quadEndABuf`, `_quadEndBBuf`, etc.) with zero per-frame allocation; vertex shader performs screen-space extrusion perpendicular to edge direction; added `uResolution` uniform sync and `DoubleSide` rendering.

---

## [0.8.1] — 2026-04-16 — Hypercube Edge Width

### Added
- **Hypercube edge width shader (Session 1)** — Replaced `LineBasicMaterial` with `ShaderMaterial` on hypercube edges; `uEdgeWidth` uniform wired through `_lineMat` and updated per-frame; added `setEdgeWidth()` public setter (0.5–8.0 clamp); `hypercube.edgeWidth` parameter registered and UI slider added.

---

## [0.8.0] — 2026-04-16 — The Hypercube Engine

### Added
- **N-D Hypercube engine (4D–12D)** — 60fps performance at 12D; vertex/edge generation, Givens projection, morph state machine with 5 easing functions; permanent Float32/Float64 buffers with zero per-frame allocation; `_colorsDirty` GPU gate; `MAX_DIM` draw range; circular points shader; vertex pub/sub
- **Hypercube UI** — dimension pills, collapsible rotation tiers, deferred DOM rebuild on morph

### Fixed
- Color offset and morph doubling issues
- JS heap leaks and redundant GPU uploads
- Missing edges and morph freeze bugs

---

## Unversioned — Noise System Overhaul (D1)

*Shipped somewhere in the 0.8.x–0.9.0 window; never attached to a release.*

### Added
- feat(scene3d): HypercubeInstancer — InstancedMesh at hypercube vertex positions, geo types sphere/box/cone/torus/octahedron, scale, opacity controls
- feat(scene3d): Instancer texture — pipeline output wired to instancer material each frame
- feat(scene3d): render mode 'none' — hides wireframe and points for instancer-only view
- feat(scene3d): SceneManager adopts HypercubeInstancer mesh — unified material pipeline; instancer now receives texture, lights, and material params from existing Material panel without separate wiring

### Fixed
- fix(pipeline): unbind blend uPrev before copyToPrev — eliminates WebGL feedback loop
- fix(scene3d): zeroMatrix was identity — caused ghost planes at origin
- fix(scene3d): hFaces.update moved after projection — was reading stale projBuf
- fix(scene3d): use emissiveMap on instancer — texture now renders without scene light dependency
- fix(scene3d): setVisible() now updates _visible flag — was only setting mesh.visible
- fix(scene3d): removed per-frame setInstancerTexture() call from main.js — SceneManager now owns instancer texture via _adoptMesh
- fix(scene3d): emissive forced white when texture active on adopted mesh
- fix(scene3d): feedback loop guard bypassed for adopted instancer mesh

## [0.6.1] — 2026-04-14 — Banks & States

### Added
- **Program > Bank > State Hierarchy:** Completely overhauled the UI and mental model to standard performance software hierarchy. "Presets" are now "Banks", and "Display States" are now "States".
- **Factory Banks JSON:** Engine now fetches default setups from `public/factory-banks.json` instead of relying on hardcoded JavaScript arrays, making them human-readable and easily editable.
- **Auto-Thumbnailing:** Right-clicking a bottom menu dot to save a State now automatically captures the canvas and attaches a thumbnail to the State in the sidebar.
- **Sidebar State Management:** The sidebar now lists all 64 States in the active Bank. Users can click a State name to rename it, or click the `▶` button to load it directly from the list.
- **Bank Selector Dropdown:** The bottom right corner now features a sleek, dark-themed `<select>` dropdown for instantly switching between Banks.
- **AI State Generator Polish:** Renamed from "AI Preset Generator", moved into the Project tab, and added a quick-access `⚙ API Settings` button.

### Changed
- **UI Tab Renamed:** The "Presets" tab is now the "Program" tab.
- **Section Reorganization:** Side panel sections are logically ordered top-to-bottom: `PROGRAM`, `BANKS`, `STATES`, `STATE STEP SEQUENCER`.
- **Randomize Button:** Moved from the Banks section to the States section (as randomizing generates a new State, not a Bank).

### Added
- 38 noise types (up from 8) across 6 categories in NOISE_BFG shader
- Classic: White Noise, Film Grain, Gaussian, TV Static, Scan Lines, Salt-and-Pepper
- Structured: Voronoi F1, Manhattan, Chebyshev, Caustics, Flow Noise, Worley Veins
- Geometric: Truchet, Hex Grid, Gabor, Blue Noise, Poisson Disc
- Signal & Video: Speckle, RGB Shift, Interlace, VCR Noise, Speckle Colour, Pixel Sort
- Fractal & Fluid: fBm, Turbulence, Billowed, Domain Warp 2, Velocity Field, Advection, Marble
- New GLSL helpers: voronoi() with metric selector, h2() vec2 hash, turbulence(), billowed()
- noise.color promoted from TOGGLE to SELECT (Off / Tri-channel / Color Mix)
- Color1/Color2 pickers wired to uColor==2 mix(color1, color2, noiseVal) in shader
- Noise panel separated from Color panel into own "Noise" section

### Fixed
- smoothstep(0.4, 0.15, x) edge-order undefined behaviour — replaced with safe equivalent
- h1(vec2) type errors — all calls wrapped to vec3 for GLSL ES compliance
- floor(hex + 0.5) used instead of round() for WebGL 1 / GLSL ES 2.00 compatibility

---

## [0.7.1] — 2026-04-11 — The Timewarp Buffer

### Added
- **SequenceBuffer timewarp mode** — slit-scan temporal buffer, absorbs VasulkaWarp concept. New params: `seq${n}.mode` (Loop/TimeWarp), `tw.axis`, `tw.flip`, `tw.speed`, `tw.mix`, `tw.offset`, `tw.warp`
- **Temporal density control** — `tw.speed` governs columns per frame: speed=1 → 1 col/frame (~21 s range at 60 fps); speed=3600 → 1 col/second (~21 hr range)
- **Strip RT persistence via IndexedDB** — timewarp strip saves automatically on project save, restores on project load; slit-scan state survives page reloads across sessions
- **VasulkaWarp deprecated** — kept in codebase for compatibility, removed from UI and signal path

---

## [0.7.0] — 2026-04-10 — Text, Materials & the Vasulka Warp

### Added
- **Text animation system** — `text.rate` + `text.autoplay` auto-advance clock (LFO/MIDI/sound-assignable); `text.animMode` (Bounce/Wave/Fade/Typewriter), `text.animSpeed`, `text.animAmt`; `text.contentIdx` indexes multi-line textarea content, MIDI/LFO-driveable
- **Text typography params** — `text.letterspacing`, `text.rotation`, `text.shadowBlur/X/Y`, `text.bgOpacity`, `text.outlineHue/Sat` (independent outline color)
- **3D material types** — `scene3d.mat.type` SELECT: Standard / Toon (3-step gradient) / Normal / Matcap / Lambert / Phong; live switch without losing values
- **3D rim / Fresnel** — `scene3d.mat.rim` (0–1), `scene3d.mat.rimHue` (0–360°); injected into `onBeforeCompile` fragment shader
- **3D material extras** — UV animation (`uvSpeedX/Y`), independent emissive color (`emissiveHue/Sat`), `envIntensity`
- **Vasulka Warp (temporal slit-scan)** — `VasulkaWarp.js`: `DataArrayTexture` ring buffer (30–90 frames, 480p or 960p); each column samples a different moment in time with bilinear blending; params: `vwarp.active`, `strength`, `axis` (H/V), `flip`, `mix`, `depth`, `quality`; routable as source 22 "VWarp"; GLSL3 shader (`sampler2DArray`, `glslVersion: THREE.GLSL3`)
- **Vasulka UV warp** — dual-oscillator scan-line UV distortion effect in pipeline FX chain (`vasulka.*` params)
- **Particle improvements** — FG/BG/DS mask sources (indices 6/7/8); emitter shapes (Box/Ring/LineH/LineV/Point); `scaleby` (Uniform/By-Life/By-Speed); 2 attractor/repulsor nodes with strength and position
- **Responsive layout** — CSS media query breakpoints for 4K (≥2560px), tablet (≤1200px), slide-over panel (≤900px), full-width (≤600px); `@media (pointer: coarse)` 44px touch targets; `overscroll-behavior` + `touch-action` on panels and param rows
- **iPad touch input** — all param row drags use Pointer Events + `setPointerCapture` (replaces mouse events); long-press (500ms, ≤8px movement) opens context menu with haptic; thin 3px range slider under every CONTINUOUS param row for finger adjustment; `touch-action: manipulation` eliminates 300ms tap delay
- **Controller badge popover (all types)** — `_openCtrlPopover` expanded: `midi-cc` (CC#, Chan drag), `midi-note` (Note#, Chan), `key` (click-to-capture), `expr` (live text input); Slew + Table rows now shown for all controller types; tap (touch) or ctrl+click (desktop) opens popover; badge label refreshes immediately via `param.notify()` after assignment
- **LFO popover improvements** — beat-sync LFOs show "Beat ÷N" label instead of "Freq (Hz)"; `lfo-rampdown` (LFO↘) and `lfo-sh` (S+H) added to badge label map
- **Temporal Smear demo preset** (preset 5) — two-state preset: builds VWarp history then switches to temporal slit-scan output

### Fixed
- Keyer breaking on Layer Color changes — `keyer.rawkey` toggle makes keyer use pre-color-correction FG for luma computation
- `_rebuildMaterial` missing `oldMat.dispose()` — GPU resources leaked on every 3D material type switch (fixed)
- GLSL `setCustomShader` false 1281/1282 errors — drain stale error queue before compile; check program link status via `getProgramParameter/getProgramInfoLog`
- VasulkaWarp GLSL3 syntax errors — fixed WARP_FRAG/VERT to use `in/out`, `fragColor`, `texture()`; added `glslVersion: THREE.GLSL3`; `_texInited` properly initialized; added VWarp to `Pipeline._resolveSource`

---

## [0.6.0] — 2026-04-05 — The Movie Rack

### Added
- **Auto-load clips from `_imweb_ready/`** — on startup ImWeb reads `_imweb_ready/manifest.json` and loads all listed clips automatically; `imweb-prep.js` writes/updates the manifest after each conversion run
- **Movie On/Off button** in status bar replaces FIT/FAST/MED/MAX/LOW resolution buttons; shows "Movie On" / "Movie Off"; always starts off regardless of saved preset state
- **MuteMovie parameter** — toggle audio output per movie session; defaults on (muted); turn off to hear clip audio; state applied to all loaded clips
- **Audio in prepped clips** — `imweb-prep.js` now keeps audio track (AAC 192k), re-encoded for browser compatibility; `0:a?` map so audio-less clips still process cleanly
- **q / a / z keyboard shortcuts** — cycle Foreground / Background / DisplaceSrc through all 22 source inputs
- **Settings panel** (was "AI Settings") — renamed ⚙ button; panel now has three sections: AI Provider, Documentation (Quick Reference + Full Manual links), Video Prep (imweb-prep.js command + spec)
- **Video prep guide** in Clips tab — inline hint with format and prep command
- **Improved clip load error message** — explains codec failure and points to `imweb-prep.js`
- **Reef GLSL preset** — ray-marched crystalline structure; float equality bug fixed (range checks replace `w == 1.0` / `w == 9.0`)
- **Tunnel GLSL preset upgraded** — wormhole with Speed, Dir X, Zoom (1–8×), Width parameters; texture visible inside tube

### Fixed
- GLSL shaders with non-ASCII characters in comments (`×`, `–`, `π`) caused WebGL error 1282 on Apple Silicon — replaced with ASCII equivalents
- Movie `video.play()` on startup blocked by browser autoplay policy — movie now starts off; user activates via Movie Off/On button
- Preset restore setting `movie.active = 1` caused button to show "Movie On" on load — explicitly reset to 0 after `presetMgr.init()`

### Planned (Phase 6)
- GLSL editor: resolve remaining WebGL 1281/1282 errors on preset apply
- Mobile-friendly UI — touch targets, responsive layout, mobile gesture support
- Multi-quad projection mapping
- Multi-cam workflow

---

## [0.5.1] — 2026-04-05 — Touch Projection Mapping

### Added
- **Touch-optimised projection mapping** — 64px handles (up from 40px, meets Apple HIG minimum); `<meta viewport user-scalable=no>`; `touch-action:manipulation` on body prevents iOS scroll bounce; handles always visible when projmap active (no hover dependency)
- **Tappable toolbar on output window** — ⊞ Grid and ⛶ Full buttons replace keyboard-only G key and double-click for iPad/phone use
- **Auto-hide handles and toolbar** — fade out after 3 seconds of inactivity; any touch/pointer resets timer; clean projected image during performance; compositor-only opacity transition (zero GPU cost)

---

## [0.5.0] — 2026-04-05 — The SDF Generator

### Added
- **SDF Generator Phase 3** — camera navigation (camX/Y/Z, lookAt matrix), KIFS fractal folding (kifsIter 0–5, kifsAngle), op mode (Soft Union / Soft Cut / Morph), video luma displacement (lumaWarp, lumaThresh), animation speed, triplanar video texturing (texBlend), AO + step-count glow, HSV colour (hue/sat/val), glass refraction + Fresnel, dedicated texture routing (texSrc / refractSrc decoupled from pipeline FG/BG layers)
- **Factory demo presets** — 5 camera-free presets seeded on first launch: SDF Metaballs, Noise Feedback, 3D Orbit, KIFS Fractal, Cloner Wave; each sets layer sources and key effect params for immediate exploration
- **Non-realtime frame capture** — 📷 button in status bar pauses the RAF loop; Step Frame exports `imweb-capture-NNNN.png` at fixed dt; Auto-Run steps N frames sequentially with browser-flush delay between downloads
- **Projection mapping improvements** — calibration grid (G key in output window) draws a 10×10 perspective-correct grid on the projected surface; click a corner handle then use arrow keys to nudge 1px (Shift = 10px); hint bar shows shortcuts
- **GLSL editor reliability** — `applyGLSL()` now auto-injects all standard pipeline uniform declarations (`uTexture`, `uTime`, `uParam1–4`, `vUv`) when absent, so built-in presets compile without error 1282

### Fixed
- Division-by-zero NaN crash in Tunnel GLSL preset — `length(uv)` clamped with `max(..., 0.0001)` to prevent Infinity → NaN → Metal INVALID_OPERATION on Apple Silicon

---

## [0.4.2] — 2026-04-04 — Cloner & SDF Beginnings

### Added
- **3D Cloner / MoGraph** — InstancedMesh clone mode for any 3D geometry; count, spread, wave animation, WaveShape (Sine/Square/Triangle/Sawtooth), WaveAmp, WaveFreq, Twist, Scatter, CloneScale, ScaleStep (progressive taper on positions + wave height); all MIDI/LFO-assignable
- **Blob/Morph vertex displacement** — `onBeforeCompile` shader injection onto `MeshStandardMaterial`; 3D value-noise displacement along surface normals; `USE_INSTANCING` guard offsets noise lookup per clone so each instance morphs independently; BlobAmount, BlobScale, BlobSpeed params
- **SDF Generator Phase 1** — standalone GPU raymarching engine (`SDFGenerator.js`) rendering two orbiting metaballs into a `WebGLRenderTarget`; routable as pipeline source index 21 (SDF) to FG/BG/Displacement layers; params: SDFActive, SDFBlend, SDFDist
- **SDF Generator Phase 2** — upgraded GLSL with: SDFShape selector (Sphere / Box / Torus), Infinite domain repetition (SDFRepeat — tiles scene in all directions), Surface displacement (SDFWarp — sin-product warp with conservative step scaling to compensate Lipschitz inflation); orbit radius auto-scales within repetition cells

---

## [0.4.1] — 2026-04-03 — Movie Transport

### Added
- **Movie reverse playback** — negative `MovieSpeed` now steps frames backward manually (browser rejects negative `playbackRate`)
- **MovieEnd parameter** — clip end-point moved from `MovieLoop` to new `MovieEnd %` param (0–100%)
- **MovieLoop modes** — `MovieLoop` is now a SELECT: Off / Forward / Backward / Ping-pong
- **MoviePos always scrubs** — position scrub no longer requires a controller assigned; responds to any drag/set of the param
- **Clip right-click menu** — right-clicking a clip card now shows "Assign MIDI controller" and "Remove clip" instead of instant delete

### Fixed
- `movieInput.texture` undefined — corrected to `movieInput.currentTexture` in render loop

---

## [0.4.0] — 2026-03-20 — 3D Depth as a Source

### Fixed (2026-03-30)
- **Duplicate material params** — removed double-append to #material-params in UI.js; bulk sections loop is now the single source of truth
- **3D light parameters expanded** — added Ambient, Point Int., Light X, Light Y, Light Z params; all MIDI/LFO-assignable; wired to AmbientLight, PointLight, and DirectionalLight.position in SceneManager
- **MeshoptDecoder** — GLB files compressed with Meshopt now load correctly

### Added
- **MeshoptDecoder support** — GLB files compressed with Meshopt now load correctly (setMeshoptDecoder wired in SceneManager.js)
- **3D depth pass → DisplaceSrc** — dual mode: Distance (grayscale depth map) and Normals (surface orientation as RGB); auto-activates when 3D Depth routed to any layer
- **WarpMap on 3D UV coordinates** — hand-drawn warp displacement applied to mesh UV skin
- **Live video texture on 3D mesh** — Camera / Movie / Screen / Draw / Buffer / Noise routable as mesh texture across all sub-meshes
- **Robust GLB/GLTF import** — Draco compression support via DRACOLoader; material propagation across sub-meshes
- **High-resolution Tables** — upgraded from 256 to 16,384 points; linear interpolation for smooth response curves
- **Zero-latency second monitor** — replaced cross-window polling with ImageBitmap + postMessage transfer
- **Ghost mode optimisation** — main canvas uses visibility:hidden (not opacity) when outputting to second monitor; saves GPU compositor cycles
- **rand1 / rand2 / rand3** — three independent global noise oscillators added to ControllerManager
- **WarpMap slots** — expanded from 4 to 16 storable slots
- **Resolution buttons renamed** — FAST (540p) / MED (720p) / MAX (1080p) / LOW (half) for clearer performance context
- **AI provider system** — switchable Anthropic / Gemini / OpenAI / Ollama; key management UI; Narrator (N) and Coach (P) features

### Fixed
- 3D models invisible after WarpMap update — added fallback textures and safety guards for UV-less geometry
- Switching from imported models to primitives crashed — safe disposal checks in _replaceMesh
- 3D Depth UI not updating — use ps.set() instead of direct property write for scene3d.depth.active
- Second screen slowdown in Chrome — switched to postMessage frame transfer
- ResizeObserver guard issue in ghost mode resolved

---

## [0.3.0] — 2026-03-19 — Sequencers & Second Monitor

### Added
- **Sequencer buffers** — 3 independent sequence recorders; variable frame count (4–480 frames), per-seq source selector, VRAM estimate hint
- **Sequence source UI** — dedicated compact button rows (Out / Cam / Mov / FG / BG / Buf / Draw) replacing the generic SELECT param that opened a controller menu
- **Second monitor output** — `⊡` button opens a popup that mirrors the output canvas with letterbox scaling; auto-fits any monitor resolution
- **Ghost mode** — `◫` dims the main output canvas (opacity 0.18) when second screen is active; no layout change, purely visual
- **Movie clip thumbnails** — Clips tab shows card layout with 160×90 JPEG thumbnail (seeks to 10% of duration to avoid black frame), clip name, duration, remove button
- **Signal path float/dock** — `┄` toggle in status bar moves the signal path display to a floating overlay or back into the panel
- **LUT node in signal path** — 3D LUT (.cube) colour grading visible in signal path display
- **Status bar resolution buttons** — Fit / 540 / 720 / 1080 / ½ buttons in status bar replace the non-functional canvas overlay; clears CSS overrides for fixed resolutions
- **Startup defaults** — camera auto-starts, all three layers set to Camera source, all panel sections collapsed except Layers
- **Cmd+S quick-save** — saves current parameter state to the active preset slot
- **3D scene auto-spin** — `spin.x/y/z` parameters for continuous model rotation; speed and axis controllable
- **Audio VU meter** — real-time level meter in status bar derived from audio analyser
- **BPM-synced movie clips** — lock clip playback position to beat phase; configurable beat length (1/2/4/8/16 beats)
- **Step sequencer for presets** — automate preset recall in rhythmic steps; configurable pattern and BPM
- **Parameter lock** — lock any parameter against accidental changes from controllers
- **3D LUT colour grading** — load `.cube` LUT files; applied as post-process pass
- **GLSL param uniform binding** — expose up to 4 custom uniforms (uParam1–uParam4) to the live GLSL editor
- **Audio beat detection** — auto-BPM from onset detection; drives LFO retrigger and BPM sync
- **GPU particle system** — procedural particle field as pipeline source (index 16)
- **Built-in GLSL shader presets** — 10 example shaders selectable from the GLSL editor tab
- **Quad mirror and levels correction** — added to effects chain
- **Vectorscope input** — Lissajous / waveform / FFT visualiser as pipeline source
- **LFO visualiser** — waveform preview in the controller context menu
- **Film grain, scanlines, feedback rotate/zoom** — new effect parameters
- **Video delay line and pixel sort** — new effect passes
- **MIDI clock sync** — playback and BPM locked to incoming MIDI clock
- **Kaleidoscope, bloom, vignette, chroma key, frame blend, per-layer HSB** — all added as effect parameters
- **Parameter slew/smoothing** — right-click → Set Slew → enter time in seconds
- **Ctrl+click to type exact value** — on any parameter knob/slider
- **Automation recorder** — record parameter movements with loop playback
- **Preset morph animation** — smooth crossfade between two preset states over configurable time
- **FFT audio analysis** — sound-bass / sound-mid / sound-high controller types
- **Parameter search overlay** — press `/` to search all parameters by name
- **Drag-and-drop file loading** — drop video or image files directly onto the app
- **Keyboard help overlay** — press `?` for shortcut reference
- **MIDI output feedback** — send CC values back to motorized faders
- **MIDI channel filter** — assign CC/Note on specific channels only
- **MIDI PC → preset recall** — program change messages recall presets by number

### Fixed
- ResizeObserver now guarded: does not fire `renderer.setSize` when ghost mode is active (was incorrectly resizing second monitor popup)
- `applyResolution` clears `style.width/height` for fixed resolutions to prevent Three.js canvas being stretched back to container width
- Seq source right-click no longer opens controller assignment menu (replaced with dedicated buttons)
- Section header text matching uses first text node to avoid including button text in comparison

---

## [0.2.0] — 2026-03-18 — Camera, Movies & Buffers

### Added
- **Movie clip playback** — load video files; speed, position scrub, loop range, mirror; up to 8 clips; Shift+1–8 to select
- **Stills buffer** — capture up to 16 frames; FrameSelect 1/2/3 to composite
- **Slit scan buffer** — rolling scan effect as pipeline source
- **Text layer** — live text with font, size, colour, position, scroll scripting
- **WebRTC camera input** with auto-start and device selection
- **Preset system** — save/load/morph between parameter states; 128 Display States per preset; IndexedDB persistence
- **WebM recording** — record output to WebM video file
- **Fullscreen output** — double-click canvas or Cmd+F
- **Draw layer** — freehand canvas drawing as pipeline source
- **External MIDI input** — MIDI CC and Note as parameter controllers
- **Output resolution selector** — Display / 720p / 1080p / 540p / Quarter

---

## [0.1.0] — 2026-03-18 — Initial Build

### Added
- **Core compositing pipeline** — Three.js WebGL render targets; foreground, background, and displace-source layers
- **Full parameter system** — reactive parameters with `onChange`, grouped by namespace
- **Controller mapping** — Mouse X/Y, MIDI CC, LFO ×4, Sound level, Random, Fixed value, Key
- **Luminance keyer** — KeyLevelWhite, KeyLevelBlack, KeySoftness
- **Displacement** — amount, angle, offset, RotateGrey
- **Blend** — frame persistence / motion blur
- **Feedback** — HorOffset, VerOffset, Scale
- **TransferMode** — Copy, XOR, OR, AND
- **ColorShift, Interlace, Fade, Mirror**
- **Color source** — HSV solid colour generator
- **Noise source** — pixel noise generator
- **3D scene as pipeline source** — all geometry types, transforms, material, camera; GLTF/GLB/OBJ/STL import
- **Signal path display** — live visual of the FG/BG/DS routing and effect chain
- **Dark performance UI** — collapsible panel sections, tabbed inputs, parameter rows with knobs/sliders

[0.3.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/haraldurkarlsson/ImWeb/releases/tag/v0.1.0

[0.9.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.9...v0.9.0
[0.8.9]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.8...v0.8.9
[0.8.8]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.8.7...v0.8.8
[0.4.2]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.3.0...v0.4.0
