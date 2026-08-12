---
title: Image/ine Remake — ImWeb
aliases: [ImWeb, imagine-remake, video-synth-project]
tags:
  - project/active
  - technology/webgl
  - technology/webgpu
  - technology/threejs
  - technology/midi
  - medium/video
  - medium/realtime
  - medium/interactive
  - tool/web
  - context/steim
  - person/tom-demeyer
  - person/steina-vasulka
  - type/technical
created: 2026-03-18
modified: 2026-05-23
status: active-development
phase: v0.8.7
related:
  - "[[Tom Demeyer]]"
  - "[[Steina Vasulka]]"
  - "[[STEIM]]"
  - "[[RAFLOST]]"
  - "[[LHÍ New Media Lab]]"
  - "[[Fréttasían]]"
  - "[[Real-time video systems]]"
  - "[[Data sonification]]"
  - "[[Signal tuning]]"
---

# Image/ine Remake — ImWeb

> *A reimagining of Tom Demeyer's and Steina Vasulka's Image/ine video synthesis environment, rebuilt for the modern web with 3D capabilities and all the features that never made it from ImOs9 into ImX and all the possibilities of the future.*

## What this is

A browser-based real-time video synthesis and compositing instrument. The philosophical successor to Image/ine — [[Tom Demeyer]]'s performance tool developed at [[STEIM]] in Amsterdam, originally for Mac OS 9 (1997) and later ported to OS X as ImX (2008). 

ImWeb is a reimagining of Image/ine — the real-time video synthesis environment created by Tom Demeyer and Steina Vasulka at STEIM Amsterdam. Originally built for Mac OS 9 (1997) and later partially ported to OS X as ImX (2008), Image/ine treated video as a malleable, real-time medium for artistic performance.

Originally built for Mac OS 9 (1997) and later partially ported to OS X as ImX (2008), Image/ine treated video as a malleable, real-time medium for artistic performance. The port was never completed — Tom moved on to pioneering new work at the Waag in Amsterdam, and Image/ine's ideas had by then seeded their way into other tools. None of them are quite like Image/ine. None of them are quite like ImWeb.

This project reclaims those features and adds a 3D layer that neither version ever had.

The core principle stays intact: **the interface is also the performance**. No edit/perform mode split. Everything visible, everything live, everything controllable.

## Personal connection

- Worked with Tom at [[STEIM]] / through the [[LHÍ New Media Lab]] connection
- Invited Tom to LHÍ for an Image/ine workshop (early 2000s)
- Used Image/ine extensively in my own performance and installation practice
- Deep familiarity with both ImOs9 and ImX — two full manuals extracted and cross-referenced March 2026
- Tom responded warmly to outreach in March 2026; offered hosting at imweb.image-ine.org

## Source documents

- `ImOs9Manual.pdf` — Image/ine for Mac OS 9, v1.0, 1997, STEIM Foundation. Program: Tom Demeyer. Manual: Sher Doruff. 108 pages.
- `ImX_user_manual.pdf` — ImX (Image/ine for OSX), ~2008, Tom Demeyer. 12 pages.

Both manuals fully extracted and cross-referenced. See [[#Feature delta summary]] below.

## Current status (2026-08-12)

**v0.19.0 — "The Second Pair of Hands"**, released 2026-08-10. Build is Vite 8.
Tom hosts the live instrument at `imweb.image-ine.org`; that deploy is his, not the
repo's, so a release here does not update it.

### Where the instrument stands

The signal path is complete and coherent end to end: a single append-only source
list (`SOURCE_DEFS`) feeding three free-routing mix buses, a reorderable effects
chain, and three layers with per-layer blend and feedback. Every routable source has
visible UI. The large source editors — 3D, Analog, Draw — sit at top level because
they are editors, not a taxonomic kind.

Around that sit the control and authoring layers: a Live GLSL editor with
last-good-compile fallback and AI generation, performative warp drawing across three
surfaces, a 4-slot stroke looper, device motion controllers, MIDI with response
tables, and seven slew curves. Program → Bank → State persistence throughout.

### The arc just completed

The v0.16–v0.19 run was about **reach** rather than new signal: getting the
instrument's existing power under the hands.

- **v0.16–v0.17** — Motion Extraction and RGB Channel Delay as sources; the effects
  chain opened up with five new effects and four the codebase already had but had
  never routed.
- **v0.18** — the way in. A help menu and guided tour that *points and never sets*,
  built from one markdown file.
- **v0.19** — a second pair of hands. `⌘K` parameter search, seven slew curves,
  LFO rates down to 0.001 Hz. The slow-LFO "stutter" turned out to be step
  quantization at a healthy 60fps, not a frame-rate problem — the diagnosis mattered
  more than the fix.

### The audio half — designed today, not built

`docs/ImWeb-Audio-Blueprint.md` settles the architecture for the audio side:
AudioWorklet as server, RoSa's zone model, a time-domain waveform tape in fixed
indexed partitions, the spectrogram as a *writer* rather than the tape, corpus
synthesis as an index, and graphs rather than text executed in the worklet.
**No code exists.** Six open questions remain, all sizing rather than architecture.

The lineage is deliberate: LiSa and RoSa were Image/ine's siblings at STEIM, so this
is the other half of the pair rather than an audio feature bolted to a video app.

### Known issues

Active, from `KNOWN-ISSUES.md`:
- One preload clip times out racking, but scans fine
- `xController` override re-applies the response table (double-shaping)
- Period values above ~Scale have no visible effect
- PsrdWarp gradient discontinuity seams at small period values with Gain > 0
- Textured 3D objects render darker than the 2D background pipeline

Open beyond that: **SDF edge aliasing (#24)** — diagnosis done, fix outstanding —
an unprofiled stutter in the SDF rework, three unreproduced beta-tester reports
awaiting follow-up questions, and circular params parked at tag
`circular-params-parked`.

### Note on this file

On 2026-08-12 this file was destroyed by a stale editor buffer and recovered only
partially — it had been gitignored and untracked since 2026-06-16, with no backup of
any kind. It is **now tracked in git**. Do not re-add it to `.gitignore`. The Session
log and Implementation roadmap sections below were reconstructed from `git log` and
`CHANGELOG.md`; their facts are accurate but the original prose is gone.

## ImWeb — Chrome 148 Metal Fix — RESOLVED (2026-06-10)

Root cause: Chrome 148 ANGLE/Metal backend regression on macOS.
Broke: Hypercube wireframe edges + Harabara GLB model.
Confirmed: production URL imweb.image-ine.org also broken.
Chromium bug filed: May 16 2026.

**Status: fixed upstream by Google in a Chrome update.** The
`--use-angle=gl` workaround is no longer required — Hypercube wireframe
and GLB models render correctly on Chrome with the default Metal backend.
The defensive code fixes from commit `379d694` (aTB attribute, highp
sampler2D/textureLod, SkinnedMesh→Mesh) remain in place and are harmless/
beneficial regardless.

Test method (historical): run Chrome normally (Metal, broken) after each
fix. Use --use-angle=gl Chrome to verify logic is correct if needed.

(2026-05-02)

**v0.8.7 — Phase 7 complete + Hypercube & Analog TV.** *Historical snapshot, accurate as of 2026-05-02 — for current state see [[#Current status (2026-08-12)]]. The build has since moved to Vite 8 and the source list below has grown well past 22.* Codebase at `/Users/haraldurkarlsson/Documents/GitHub/ImWeb`, built with Vite 5.4 at the time. Hosted at imweb.image-ine.org (Tom Demeyer).

### What was running then (2026-05-02)

**Input sources (22+):** Camera · Movie/clips (×8, thumbnails) · Stills Buffer · Color (solid HSV) · Color2 (gradient: solid/H/V/radial, animated) · Noise (38 types: Classic, Structured, Geometric, Signal, Fractal, Fluid) · Draw layer · Text layer · 3D Scene · 3D Depth (Distance/Normals) · Output (feedback) · Sound · SlitScan · Sequencer buffers ×3 · Particles · Vectorscope · Video Delay · BG1/BG2 stills · SDF Generator (GPU-raymarched metaballs) · **Analog TV Source** (720x480 CRT simulation with signal grading)

**Pipeline effects (full chain):** FG/BG color correction (HSB) → TransferMode (22 modes) → Displacement (angle, offset, RotateGrey) → Luma Keyer → Chroma Keyer → WarpMap (16 slots, procedural + interactive) → Blend/Feedback (rotate, zoom, offset, **feedback.mode TransferMode**) → ColorShift → LUT 3D → Pixelate → Edge → RGBShift → Kaleidoscope → QuadMirror → Posterize → Solarize → Vignette → Bloom → Levels → White Balance → PixelSort → FilmGrain/Scanlines → Interlace → Fade → GLSL custom pass → Output

**Controllers:** Mouse X/Y · MIDI CC/Note (with learn mode, channel filter) · LFO (8 shapes, beat-sync, S+H) · Sound level/bass/mid/high · Random · rand1/rand2/rand3 · Fixed · Key · Expression (JS) · Gamepad (axes + buttons) · Wacom pressure · OSC (WebSocket) · Nudge · Movie position · BPM tap tempo · External Mapping (controller-of-controller) · **Expression Popover** (live text input)

**State system:** 64 States per Bank · Bank morph animation · Step sequencer · Automation record/play · Parameter search (/ key) · Parameter lock · Slew/lag · Response curve tables (16,384 points) · **Auto-thumbnails** (captured on save) · **Sidebar State Management** (rename/load list)

**3D scene:** 13 geometry types · Robust GLB/GLTF/OBJ import (Draco + Meshopt supported) · Live video texture mapping on any mesh · WarpMap UV distortion on models · Dual-mode depth pass · Auto-spin X/Y/Z · Full material params (Standard/Toon/Matcap/etc.) · Light system (Ambient, Directional, Point — all MIDI/LFO-assignable) · Cloner (MoGraph InstancedMesh) · Blob/Morph vertex displacement · **N-D Hypercube Engine** (4D–12D; N-cell faces, Vertex Instancer, real edge width)

**Output:** Second monitor (ImageBitmap/postMessage; zero-latency) · Ghost mode (visibility optimization) · Resolution selector (FAST/MED/MAX/LOW) · Cmd+S quick-save · WebRTC camera auto-start on load · **Non-realtime frame capture** (PNG sequence export) · **Touch-optimised projection mapping** (64px handles, tappable toolbar)

**I/O:** MIDI in/out (motorized fader feedback) · MIDI clock sync · OSC bridge · Drag-and-drop video/image/models · LUT (.cube) import · Canvas capture (PNG) · WebM recording · **Open Collective application (milestone)**

## Platform decision

**Progressive Web App, Chrome-first.** No install beyond browser. WebGL (Three.js) for GPU compositing. WebRTC for live camera. Web MIDI API. WebSocket bridge for OSC. Three.js for 3D.

Reasons: zero-install distribution, shareable URL, modern GPU pipeline access, familiarity with this stack.

## Architecture summary

```
INPUT SOURCES (33 — canonical list is SOURCE_DEFS, append-only)
Buffer source is pre-processed first: pan/scale transform, then frame
blend of fs1/fs2 when buffer.frameblend > 0.
Camera · Movie A · Movie B · Buffer · Color · Color2 (gradient, animated)
Noise (38 types) · Draw · Text · 3D Scene · 3D Depth · SDF · SDF Depth
Output (feedback) · BG1 · BG2 · Sound · Delay · Scope · SlitScan
Particles · Seq1/2/3 · Warp Tape · TimeDisp · Analog · Rutt-Etra
RGB Delay · Motion · Mix 1 · Mix 2 · Mix 3

        ↓ any source routable into ↓

Mix 1 | Mix 2 | Mix 3      (free srcA/srcB per bus — a bus is a graph
                            node, not a hardwired crossfader, and buses
                            are themselves sources)

        ↓ assigned to ↓

Foreground | Background | DisplaceSrc

        ↓ GLSL insert (glsl.target 1/2/3 — one slot at a time,
          before per-layer colour correction) ↓

        ↓ fixed pre-chain, per Pipeline.render() ↓

FG: ColorCorrect → Fade      BG: ColorCorrect → Fade
→ TransferMode → Displace → Keyer → ChromaKey → WarpMap
→ Feedback (rotate, then offset/scale) → TransferMode → ColorShift

        ↓ 23-effect reorderable chain (DEFAULT_FX_ORDER, Pipeline.js)
          effect.enable skips the whole loop — a master bypass, not a
          mute, and it does NOT touch Feedback or ColorShift ↓

pixelate → edge → sharpen → rgbshift → wave → lens → polar
→ kaleidoscope → quadmirror → flip → posterize → solarize → halftone
→ duotone → vignette → bloom → outhsv → levels → lut → whitebal
→ pixelsort → grain → interlace

        ↓ fixed post-chain ↓

Fade → Custom GLSL (glsl.target 0 = Master, post-fade)
→ final blit (optional bicubic) → Output

        ↓

Output canvas → fullscreen / capture / second monitor
```

All pixel operations run as GLSL shaders on GPU render targets via Three.js WebGL.

## Feature delta summary

*What ImOs9 had that ImX lost — and that ImWeb restores.*

### High priority restorations — status

| Feature | Status |
|---|---|
| **WarpMode** (interactive mesh editor) | ✓ Done — 16 slots, procedural + brushed displacement |
| **FrameSelect 1/2/3** | ✓ Done — fs1/fs2/fs3 params + zone protection |
| **Tables** (16,384-step response curves) | ✓ Done — 16k resolution, linear interpolation |
| **Sound → DisplaceSrc** | ✓ Done — Sound source routable as DispSrc layer |
| **External Mapping** (controller-of-controller) | ✓ Done — mod LFO Hz, mod amplitude, direct override |
| **Second monitor** | ✓ Done — Zero-latency postMessage transfer |
| **Sequencer buffers** | ✓ Done — ×3, variable frame count 4–480, per-seq source |

### Other restorations

| Feature | Status |
|---|---|
| TransferMode (XOR/OR/AND + 18 blend modes) | ✓ Done — 22 transfer modes |
| Draw layer | ✓ Done — with pen/erase, Wacom pressure, mouse drawing |
| RotateGrey circular displacement | ✓ Done |
| ColorShift | ✓ Done |
| Text layer | ✓ Done |
| Interlace effect | ✓ Done |
| Noise sources rand1/2/3 | ✓ Done — Three independent oscillators added to ControllerMgr |
| Feedback system | ✓ Done — Hor/VerOffset, Scale, Rotate, Zoom |
| MidiSync / AutoSync | ✓ Done — 0xF8 clock gate wired in render loop |
| Insert Video into Buffer | ✓ Done — Available via slot context menu |

### New additions (ImWeb only)

- ✓ **3D scene input source** — Three.js → render target → compositing pipeline
- ✓ **Live video texture on 3D mesh** — camera/movie/screen/draw/buffer/noise as mesh texture
- ✓ **Procedural geometry** — 13 shapes
- ✓ **Import 3D models** — GLB/GLTF/OBJ with Draco + Meshopt support
- ✓ **Dual-mode depth pass** — Distance and Normals displacement modes
- ✓ **WarpMap on 3D UVs** — Hand-drawn displacement applied to model skins
- ✓ **Auto-spin** — continuous rotation on X/Y/Z axes
- ✓ **3D light system** — Ambient, Directional (position X/Y/Z), Point — all MIDI/LFO-assignable
- ✓ **All 3D parameters mappable** — rotation, position, scale, FOV, material, lights
- ✓ **Kaleidoscope** — N-segment mirror with rotation param
- ✓ **QuadMirror** — 4-way and diagonal symmetry
- ✓ **Chroma keyer** — HSV hue-based with range + softness
- ✓ **Bloom** — multi-pass Gaussian with threshold
- ✓ **Vignette** — with radius param
- ✓ **Levels** — black/white/gamma
- ✓ **LUT 3D** — .cube file import, blend amount param
- ✓ **White Balance** — temperature + tint
- ✓ **Pixel Sort** — threshold/length/direction/mode params
- ✓ **Film grain + scanlines**
- ✓ **Vectorscope** — Lissajous / Waveform / FFT display modes
- ✓ **Slit Scan** — 4 axis modes with width control
- ✓ **Particles** — count/speed/life/gravity/wind/size/color
- ✓ **Video Delay** — ring buffer with frame depth param
- ✓ **Beat detection** — auto-BPM from audio
- ✓ **Step sequencer** — 4/8/16 steps, BPM-synced preset recall
- ✓ **Automation** — record/play parameter movements
- ✓ **Preset morph** — smooth crossfade between display states
- ✓ **Preset thumbnails** — 160×90 JPEG captured on save
- ✓ **Color2 animated gradient** — `color2.speed` param drives continuous hue cycling
- ✓ **MIDI output** — CC feedback to motorized faders
- ✓ **MIDI clock sync** — derive BPM from incoming 0xF8 timing clock
- ✓ **Expression controller** — arbitrary JS math formula
- ✓ **OSC bridge** — WebSocket relay with auto-reconnect
- ✓ **Project file format** — `.imweb` JSON export/import
- ✓ **PWA manifest + service worker** — installable, offline-capable
- ✓ **AI provider system** — Anthropic/Gemini/OpenAI/Ollama switchable; Narrator + Coach features
- ✓ **3D Cloner (MoGraph)** — InstancedMesh single draw call; 10+ effectors
- ✓ **Blob/Morph vertex displacement** — shader-injected 3D noise displacement
- ✓ **SDF Generator** — GPU raymarching engine; KIFS fractals; dedicated routing
- ✓ **Movie reverse playback** — negative MovieSpeed seeks frames backward
- ✓ **Live GLSL editor** — custom shader pass with uParam1–4 bindings
- ✓ **BPM tap tempo** — click status bar, or `t` key
- ✓ **Parameter search overlay** — `/` key, and `⌘K` / `Ctrl+K` on any keyboard layout (v0.19)
- ✓ **Parameter lock** — prevent controller from overwriting value
- ✓ **Slew/lag** — per-parameter smoothing time; seven curves as of v0.19 (see below)
- ✓ **Drag-and-drop** — video files → clips, images → buffer, models → 3D scene
- ✓ **N-D Hypercube** — 4D to 12D projection engine; face rendering; vertex instancer
- ✓ **Analog TV & CRT** — 720x480 stable internal RT; signal grading
- ✓ **Responsive & Touch Layout** — iPad optimized targets; 4K/Tablet/Mobile breakpoints
- ✓ **Program > Bank > State** — Professional performance hierarchy UI
- ✓ **38 Noise Types** — Classic, Structured, Geometric, Signal, Fractal, Fluid categories
- ✓ **Text Animation** — Typewriter/Wave/Fade/Bounce modes; auto-advance clock
- ✓ **Per-layer Blend refactor** — FG.blend composites over BG; feedback.mode TransferMode

### Added since v0.9 (2026-06 → 2026-08)

*The list above was written at v0.8.7. Everything below arrived in the v0.9–v0.19
arc; see the Implementation roadmap and Session log for detail.*

- ✓ **Three mix buses** — free srcA/srcB selection, double-buffered so a bus reading a later bus sees last frame
- ✓ **Dual movie decks** — Movie A/B engines, Deck B rack UI, idle-deck upload gating
- ✓ **Movie Library** — drag a row onto either deck; a rack is bounded by bytes (~837 MB), not slots
- ✓ **Performative warp drawing** — draw the warp on the main canvas; 16 slots, 8 presets, slot fade
- ✓ **Live GLSL overhaul** — persistence, user presets, insert routing, VJ uniform contract, AI shader generation, `glsl.preset` MIDI recall
- ✓ **Draw arc** — Pointer Events with pressure, draw on the output canvas, 4-slot stroke looper, Stroke→LFO driver, video-as-ink
- ✓ **Rutt-Etra scan processor** — 23 controls; the Vasulka scan-processor lineage made routable
- ✓ **Spacetime / the Warp family** — a source selector on every temporal engine; Time Displace angle + map source; Warp Tape scrubbing; Video Delay Line depth
- ✓ **Motion Extraction** and **RGB Channel Delay** — one control spanning both classical motion methods
- ✓ **Effects chain opened up** — Polar, Wave, Halftone, Duotone, Lens added; four the codebase already had, now routed; All FX / Clear All FX
- ✓ **Device motion controllers** — orientation and acceleration as controller sources
- ✓ **Seven slew curves** — Lag, Ease in/out, Elastic (spring, bounces off min/max), Super Ease in/out, Exponential, Bounce, Back (with Strength)
- ✓ **LFO rates to 0.001 Hz** — the slow-LFO "stutter" was step quantization at 60fps, not frame rate
- ✓ **Help menu and guided tour** — one markdown file; the tour points, it never sets
- ✓ **Touch & ergonomics** — flick momentum, touch value entry, unified long-press, mobile state pad, live-performance safety
- ◻ **Audio half** — designed 2026-08-12, `ImWeb-Audio-Blueprint.md`. **No code exists.**

## Technology stack

| Layer | Technology |
|---|---|
| Rendering | Three.js r160+ · WebGL · GLSL shaders |
| Video in | WebRTC `getUserMedia()` → `VideoTexture` |
| Audio | Web Audio API `AnalyserNode` → FFT bands |
| MIDI | Web MIDI API (CC, Note, Clock, PC, output feedback) |
| OSC | WebSocket bridge (local Deno/Node companion) |
| Pointer/Wacom | Pointer Events API (pressure) |
| HID | Gamepad API |
| State | IndexedDB (presets, states, tables, assets) |
| Files | `.imweb` JSON project format |
| Build | Vite 8 · no framework · vanilla JS modules |

## Control system

**Controller types implemented:** Mouse X/Y · MIDI CC (with learn) · MIDI Note · LFO (beat-sync, S+H) · Sound level/bands · Random · rand1/2/3 · Fixed · Key · Expression (JS) · Gamepad · Wacom pressure · OSC · Nudge · Movie position

**Modifiers:** invert · table (response curve routing) · slew/lag · lock

## Parameter count

ImOs9: 63 parameters. ImX: ~50. **ImWeb current: ~240+ parameters**, all MIDI/LFO-assignable via right-click context menu.

## Program / Bank / State

- **Banks:** Full mapping state (controller assignments) + thumbnail (160×90 JPEG)
- **States:** 64 snapshots per Bank — live performance cue system
- **State recall:** dot row, digits 0–9, MIDI program change, OSC
- **LFO retrigger** on state recall
- **Bank morph:** smooth parameter interpolation between States (speed param)
- **Step sequencer:** 4/8/16 BPM-synced Bank recall steps
- **Automation:** record/loop parameter movements

## Implementation roadmap

### Phase 1 — Core engine `v0.1` ✓ Complete
Core WebGL pipeline · Camera · Basic keying · Displacement · Mouse + keyboard · Basic Banks

### Phase 2 — ImX parity `v0.2` ✓ Complete + exceeded
Three-layer system · ExtKey · All displacement modes · MIDI · LFOs · Sound · Movies · Buffer · States · OSC · (plus many additional features)

### Phase 3 — ImOs9 restoration `v0.3` ✓ Complete
- ✓ Noise sources (8 types) · Draw layer · TransferMode · RotateGrey · Tables (16k res) · Text layer · ColorShift · Feedback · Interlace
- ✓ FrameSelect zone protection · External mapping · Sequencer buffers ×3 · rand1/2/3
- ✓ Second monitor (Zero-latency) · Ghost mode · Movie clip thumbnails · Signal path float/dock

### Phase 4 — 3D Integration `v0.4` ✓ Complete + extended
- ✓ 3D scene as input source · 13 shapes · Draco/Meshopt import
- ✓ Live video texture · WarpMap on UV · Depth pass → DisplaceSrc
- ✓ Light system · High-res Tables · Zero-latency monitor · AI system

### Phase 5 — Public Release Polish `v0.5` ✓ Complete
- ✓ SDF Generator Phase 3 · Factory demo Banks · Onboarding overlay
- ✓ KeyLock · MidiSync · Non-realtime frame capture · ProjMap improvements

### Phase 6 — Performance & Touch `v0.6 - v0.7` ✓ Complete
- ✓ Program > Bank > State hierarchy UI overhaul
- ✓ 38 Noise types across 6 categories
- ✓ Text animation system · 3D material types & rim/Fresnel
- ✓ Responsive layout · iPad touch targets (Pointer Events)
- ✓ SequenceBuffer timewarp mode (slit-scan)

### Phase 7 — Hypercube & Architecture `v0.8` ✓ Complete
- ✓ N-D Hypercube engine (4D–12D) · Face masks · Instancer material
- ✓ Analog TV & CRT simulation
- ✓ Per-layer blend architecture refactor
- ✓ Feedback loop TransferMode integration

> **Reconstructed 2026-08-12** from `CHANGELOG.md`, release tags and `git log`,
> after the original was destroyed by a stale-buffer overwrite. Entries from `v0.9`
> onward are version-titled rather than phase-numbered — see the note on numbering
> above. Phases 1–7 above are original.

### v0.9 — The Noise Family ✓ Complete
- ✓ PsrdWarp gradient domain warp (uType 40) · psrdnoise2 (uType 39) with parameters wired
- ✓ Noise panel family→type selector · noise UI wiring simplified
- ✓ Noise animation stutter from wall-clock time fixed · speed slider phase jump · `noisePhase` render-gate bypass

### v0.10 – v0.11 — The Touch Instrument ✓ Complete
- ✓ Device motion controllers · mobile state pad · hybrid mobile state bar
- ✓ Long-press to clear · long-press action menu · touch double-tap on param rows
- ✓ Slot-based mirror: Mirror FG / Mirror BG (**breaking**) · pad-mode crosshair · orbit inertia · 3-finger tap mode cycle
- ✓ Movie texture upload gating · canvas grab takes control from auto-spin
- ✓ Flick momentum on param drags · touch value entry · unified long-press · desktop canvas parity · UI chrome toggles
- ✓ Live-performance safety (Grill Report P1) · coarse-pointer param rows rebuilt · rAF-batched param→DOM sync

### v0.12 — Dual-Deck ✓ Complete
- ✓ Deck B movie engine (headless first) · Deck B UI and clip routing · deck target toggle for touch
- ✓ MixBus A/B engine · Movie B status header
- ✓ Idle-deck upload gating · autoplay recovery · menu restructure · desktop state-bar ＋ tile

### v0.13 — Live GLSL, Draw & the Signal Graph ✓ Complete
*CHANGELOG Phases 13–22 (Live GLSL + Draw), Phase 23 (MixBus), Phase 24 (Warp Drawing).*
- ✓ Live GLSL editor (CodeMirror 6) with last-good-compile fallback · persistence · user shader presets · GLSL insert routing · VJ uniform contract
- ✓ AI shader generation (✨ Prompt AI) · `glsl.preset` MIDI recall · recall range for all SELECT params
- ✓ Draw arc: Pointer Events + pressure · draw on the output canvas · 4-slot stroke looper · draw↔synthesis crossovers · Stroke→LFO driver · video-as-ink
- ✓ **Three mix buses with free source selection** — a bus becomes a real graph node, not a crossfader hardwired to the two decks
- ✓ One-frame-behind feedback via double buffering rather than an identity guard
- ✓ **Consumption analysis is a fixpoint** (`_srcUsed`), replacing seven near-duplicates
- ✓ **Source list consolidated to one origin** (`SOURCE_DEFS`) — six hand-synced copies existed and three had drifted
- ✓ Panel taxonomy follows signal flow · data-driven initial tab activation
- ✓ Performative warp drawing on the main canvas · `warpSlot` (1–16) · `warpPreset` (8 shapes) · controller assignment on non-param-row controls

### v0.14 — The Movie Library ✓ Complete
- ✓ Movie Library panel · drag a row onto Movie A or B · Deck B rack UI · `Option+1-8` · per-row `✕` and `✕ Clear`
- ✓ **A rack is bounded by bytes, not slots** — the ~837 MB media budget, not the slot count, was the real ceiling; `preload='metadata'` with only the playing clip promoted
- ✓ `imweb-prep.js` writes faststart MP4s (the `moov` position was a second, independent bug)
- ✓ **Project import no longer destroys banks** — `importAll()` is additive, destruction gated behind `{ replace: true }`

### v0.15 — Spacetime & the Scan Processor ✓ Complete
*CHANGELOG Phase 25 (Spacetime), Phase 26 (Rutt-Etra).*
- ✓ A source selector on every temporal engine — FG/BG/DS Src on every capture selector
- ✓ Time Displace gains angle and map source · Warp Tape scrubbing · Video Delay Line depth, ring split from tap
- ✓ "Warp" becomes the family name · `_resolveLayerTex()` extended from 16 of 29 sources to all
- ✓ **Appending a source no longer breaks saved captures** — the capture-base stamp now gates every future source append
- ✓ Rutt-Etra scan processor with 23 controls in four collapsible groups · subsections collapse app-wide
- ✓ SDF (formerly "Metaballs") rework — sphere-as-ellipse, black frame looking straight up/down, flattening refraction

### v0.16 – v0.17 — The Motion Matte & The Chain ✓ Complete
- ✓ Motion Extraction and RGB Channel Delay as sources · one control spans both classical motion methods · `motion.blur` ("Smoothness")
- ✓ The keyer's external key gains its own source selector · LUT data packed to RGBA half-float
- ✓ `?soak=1` instrumentation · per-deck upload counters
- ✓ **Verified rather than assumed** — dual-deck thermal/decoder budget PASS; v0.12 upload gating confirmed by counting rather than by soak
- ✓ All FX / Clear All FX · five new effects (Polar, Wave, Halftone, Duotone, Lens) · four the codebase already had, now routed
- ✓ A saved `fxOrder` no longer silently drops effects it has never heard of

### v0.18 — The Way In ✓ Complete
- ✓ Help menu and guided tour — Basics · Principles · Instruments
- ✓ **The tour points; it never sets** · content is one markdown file · docs served network-first
- ✓ `Blend Amt` becomes a three-stop crossfade · layer blend amounts become percent params

### v0.19 — The Second Pair of Hands ✓ Complete
- ✓ `⌘K` / `Ctrl+K` parameter search on any keyboard layout
- ✓ Seven slew curves — Lag · Ease in/out · Elastic · Super Ease in/out · Exponential · Bounce · Back
- ✓ Back gains Strength · Elastic gains Strength and Damp and bounces off `min`/`max`
- ✓ Slow LFOs down to 0.001 Hz — the "stutter" was step quantization at a healthy 60fps, not a frame-rate problem
- ✓ Ctrl+click reaches the controller menus (on macOS it arrives as a right-click)
- ✓ Guided tour rewritten from beta-tester notes
- ✓ Post-release: an audit so a version bump cannot ship without a service worker cache bump; every release back to 0.1.0 titled

### Next — Audio ◻ Designed, not started
*Blueprint: `docs/ImWeb-Audio-Blueprint.md`. **No code exists.***
- ◻ AudioWorklet as server, ParameterSystem as client, message protocol between them
- ◻ RoSa zone model — writers (Recording / Load / Spectral / Synth), readers (Playback)
- ◻ Time-domain waveform tape · fixed indexed partition slots with opt-in `unsafe` flag
- ◻ Spectrogram as a **writer** (inverse-transformed once at write time), scale-quantized
- ◻ Corpus synthesis as an index into the tape, navigated by drawing
- ◻ Graphs, never text, executed in the worklet — the audio thread has no watchdog
- ◻ Phase-one generator set: tape reader, noise, oscillator, SVF, saturator, gain

### Open ◻
- ◻ SDF edge aliasing (#24) — diagnosis done, fix outstanding
- ◻ An unprofiled stutter in the SDF rework
- ◻ Three unreproduced beta-tester reports still awaiting follow-up questions
- ◻ Circular params parked at tag `circular-params-parked`

## Files & references

| File | Location | Notes |
|---|---|---|
| Architecture spec | `imagine-remake-architecture.md` | Technical spec, updated v0.9.0 |
| Testing log | `Testings.md` | Session 6 — v0.9.0 |
| Codebase | `~/Documents/GitHub/ImWeb` | Vite 8, vanilla JS + Three.js |
| ImOs9 source manual | Archive | 108pp, 1997, STEIM |
| ImX source manual | Archive | 12pp, ~2008, Tom Demeyer |
| Audio blueprint | `ImWeb-Audio-Blueprint.md` | DESIGN ONLY, no code — LiSa/RoSa lineage, waveform tape, partitions |

## Connections to other work

- **[[Signal tuning]]** — this project is signal tuning made literal: finding coherence in noise, making invisible processes visible, real-time
- **[[Fréttasían]]** — shares the same web-native philosophy
- **[[Data sonification]]** — Sound→DisplaceSrc inverts this: instead of data becoming sound, sound becomes spatial image distortion
- **[[Real-time video systems]]** — permanent continuation of work started at [[LHÍ New Media Lab]] 1999–2008
- **[[RAFLOST]]** — festival context where tools like this were central to the programme

## Questions / open decisions

- Codename: ImWeb is the name. ✓
- License model: MIT. ✓ changed.
- Relationship to Tom Demeyer: Tom is hosting at imweb.image-ine.org. ✓
- Non-realtime capture: Implemented (Auto-Run exports PNG sequence) ✓

## Development workflow

Multi-tool workflow across all sessions:

- **Claude Chat / Cowork (claude.ai)** — architecture decisions, planning, CLAUDE.md 
  review, Obsidian updates, tasks requiring direct file access
- **Claude Code (Ghostty terminal)** — surgical JS/CSS edits, multi-file wiring, 
  complex logic, Pipeline/shader work, recon
- **Gemini CLI (Ghostty terminal)** — CHANGELOG.md, documentation, markdown only. 
  Never JS
- **OpenCode + DeepSeek v4 (Ghostty terminal)** — grep-heavy recon, exploration, 
  reading large files. Never edits

**Tool selection principle:** one agent per task. Claude Chat for thinking, 
Claude Code for editing, Gemini for docs, OpenCode for cheap recon.

**Editor:** Zed (alongside Claude Code — avoid simultaneous edits to same file)  
**Knowledge base:** Obsidian vault → `imweb-obsidian.md` in project root for AI access  
**Context management:** context-mode MCP plugin (session continuity, token savings)

## Session log

> **Entries from 2026-06-15 onward were reconstructed on 2026-08-12** from
> `git log`, `CHANGELOG.md` and release tags, after the original ~199 lines were
> destroyed by a stale-buffer overwrite. The facts, dates, versions and hashes are
> accurate. **The original prose is gone** — these entries are summaries, not the
> notes that were written at the time. Entries below 2026-06-10 are original.

## 2026-08-12 — Audio blueprint; knowledge base lost and re-tracked

**Commits:** e89f85a (#27), 17f13a2 (#28)
**Version:** v0.19.0 (no app change — docs only)

### The audio half, designed
- Blueprint written for the audio side of the instrument: `docs/ImWeb-Audio-Blueprint.md`.
  **Design only — no code exists.** Lineage is STEIM's LiSa (Waisvisz/Baldé) and its
  successor RoSa, the audio siblings of Image/ine, plus SuperCollider as the synthetic pole.
- **AudioWorklet is the server, ParameterSystem the client**, message protocol between
  them, engine carrying zero ImWeb imports. Same split RoSa and SC3 both arrived at.
- **The tape is a time-domain waveform.** Scrubbing must stay index arithmetic; a
  spectral tape would need phase-vocoder reads and kill the tactility that is the whole
  LiSa paradigm.
- **The spectrogram is a writer, not the tape** — inverse-transformed once at write
  time, never in the playback path, vertical axis quantized to a scale. This is the
  Metasynth/UPIC path, and it is what makes drawn spectra musical rather than noise.
- **One allocation, fixed indexed partition slots, opt-in `unsafe` flag.** Fixed slots
  because a user-named list would make a captured index resolve to different material on
  another machine — the `warpSlot` / `glsl.preset` failure.
- **`SharedArrayBuffer` rejected.** Video reads a downsampled ~16 KB envelope, never the
  23 MB tape, so `postMessage` suffices — which avoids COOP/COEP cross-origin isolation
  and makes concurrent-access tearing stop existing.
- **The worklet executes graphs, never text.** The audio thread has no watchdog: an
  infinite loop is silence for the rest of the set, an inner-loop allocation is GC
  crackle, and both compile cleanly, so the GLSL editor's last-good-compile fallback
  catches neither. This is what SC actually does — sclang builds a SynthDef, scsynth
  executes pre-compiled UGens.

### Knowledge base destroyed and recovered
- `docs/imweb-obsidian.md` was overwritten by a stale Zed buffer, replacing an 852-line
  version (status 2026-07-29) with a 379-line one (status 2026-05-02). ~322 lines lost.
- **No backup existed** — the file was gitignored and untracked (`bd8ed23`, 2026-06-16),
  was never in an Obsidian vault, and was not in Time Machine.
- Restored to `bd8ed23^` (530 lines, status 2026-05-17), the last version git ever saw,
  and **the file is now tracked** so a repeat is a `git checkout` rather than a loss.
- All 21 headings survived; the loss was confined to Session log, Implementation roadmap
  and Current status.

## 2026-08-10 — v0.19.0 The Second Pair of Hands

**Commits:** b06fa0f (tag), 7be272a (#21), 5f4369b (#23), 4cb0582 (#25)
**Version:** v0.19.0

- `⌘K` / `Ctrl+K` opens parameter search on any keyboard layout.
- Seven slew curves land: Lag, Ease in/out, Elastic, Super Ease in/out, Exponential,
  Bounce, Back. Back gains Strength; Elastic gains Strength and Damp and now bounces off
  `min` and `max` rather than passing through them.
- The LUT panel heading explains itself.
- Post-release: an audit added so a version bump cannot ship without a service worker
  cache bump (#23), and every release back to 0.1.0 was given a title, with three
  history defects corrected (#25).

## 2026-08-09 — Slew refinements; Ctrl+click reaches the menus

**Commits:** 8afcae2 (#18), 7bb6dfe (#19), f35b5f0 (#20), dbcff7e (tag `circular-params-parked`)

- Elastic reworked as a spring; Back's stall behaviour and Strength; X-map floor; Phase fix.
- **Ctrl+click now reaches the controller menus** — the blind spot was that Ctrl+click on
  macOS is a right-click, so the handler never saw it.
- Guided tour rewritten from beta-tester notes.
- Verification lessons recorded: the Ctrl+click blind spot and the stale-preview-bundle
  trap (#20).
- Circular params parked at tag `circular-params-parked`.

## 2026-08-08 — Slow LFOs that don't stutter

**Commits:** 1b197d6 (#16)

- The slow-LFO "stutter" was **step quantization at a healthy 60fps**, not a frame-rate
  problem — the diagnosis that mattered.
- Rates down to 0.001 Hz, seven slew curves, logarithmic X-map taper.

## 2026-08-07 — v0.18.0 The Way In

**Commits:** f18ceb9 (tag), 0e6276b (#15)
**Version:** v0.18.0

- **Help menu and guided tour** — Basics, Principles, Instruments. The tour *points; it
  never sets*, and its content is one markdown file. Documentation is served
  network-first.
- `Blend Amt` becomes a three-stop crossfade; layer blend amounts become percent params.
- Fixed: `layer.bg.blendAmount` did nothing, and a focused slider killed every single-key
  shortcut — the two bugs behind a tour step nobody could follow.

## 2026-08-06 — Git history purge

**Tags:** `pre-history-purge-2026-08-06`, `pre-history-purge-guide-branch-2026-08-06`,
`pre-history-purge-quickstart-branch-2026-08-06`

- Repository history rewritten. Three `pre-history-purge-*` tags mark the prior state of
  main and two branches before the rewrite. Keep them.

## 2026-08-05 — v0.16.0 The Motion Matte, then v0.17.0 The Chain

**Commits:** c6f2145 / a089000 (v0.16.0), 57dc99b / ab0a4af (v0.17.0)
**Version:** v0.16.0 → v0.17.0 (same day)

### v0.16.0 — The Motion Matte
- **Motion Extraction** and **RGB Channel Delay** added as sources. One control spans
  both classical motion methods instead of a mode select. `motion.blur` ("Smoothness").
- The keyer's external key gains its own source selector.
- `?soak=1` instrumentation and per-deck upload counters.
- **Verified rather than assumed:** dual-deck thermal and decoder budget PASS; v0.12
  idle-deck upload gating confirmed *by counting rather than by soak*; the tab bar passed
  on a premise that had already expired.
- LUT data packed to RGBA half-float.

### v0.17.0 — The Chain
- **All FX / Clear All FX**, and the effect chain gains five new effects — Polar, Wave,
  Halftone, Duotone, Lens — plus four the codebase already had but had never routed.
- Fixed: a saved `fxOrder` silently dropped effects it had never heard of; Kaleidoscope
  worked in raw UV; Posterize and Solarize were OFF at their maximum.

## 2026-08-02 — v0.15.0 Spacetime (Phase 25) and the Scan Processor (Phase 26)

**Commits:** 8cc5e0f (tag), c627aba, 48b759d (tag `pre-rutt-etra-phase26`)
**Version:** v0.15.0 (two CHANGELOG entries, same version)

### Phase 25 — Spacetime & the Warp Family
- **A source selector on every temporal engine** — FG/BG/DS Src on every capture
  selector. Time Displace gains an angle and a map source; Warp Tape gains scrubbing;
  Video Delay Line gains depth, with the ring split from the tap.
- "Warp" becomes the family name.
- **`_resolveLayerTex()` handled only 16 of 29 sources** — the drift that appending a
  source kept re-introducing. Appending a source no longer breaks saved captures.

### Phase 26 — Rutt-Etra Scan Processor
- **Rutt-Etra scan processor** added as a source, with 23 controls in four collapsible
  groups: `zcurve`/`zpivot`, `bleed` ("Spread"), `hue`/`sat`/`colorAmt`, `rise`/`fall`,
  `shape`, `drawMode`/`pointSize`.
- Subsections now collapse anywhere in the app.
- **Source routing had drifted three ways** — the capture-base stamp introduced here now
  gates every future source append.
- SDF (formerly "Metaballs") fixes: a sphere rendered as a wide ellipse; looking straight
  up or down returned a black frame; refraction flattened the object.

## 2026-07-29 — v0.14.0 The Movie Library

**Commits:** 924ea46 (tag), 5b22a66
**Version:** v0.14.0

- **Movie Library panel**; drag a Library row onto Movie A or Movie B; Deck B finally
  gets a rack UI; `Option+1-8`; `✕` per row and `✕ Clear` for Deck B; a full rack evicts
  its oldest clip.
- **A rack is bounded by bytes, not slots** — `preload='auto'` buffers a clip in full and
  exhausts the media budget around **837 MB**, which was the real cause of the rack
  hanging on its eighth clip. Loading now uses `preload='metadata'` and only the clip
  actually playing is promoted. Reasoning recorded in
  `ImWeb-MovieLibrary-Blueprint.md` §2.4, which corrects its own §2.3 advice.
- `imweb-prep.js` now writes faststart MP4s — the `moov` position was a second,
  independent bug wearing the same costume as the byte ceiling.
- **Project import no longer destroys banks** — `importAll()` is additive, and
  destruction is gated behind an explicit `{ replace: true }`.
- `removeClip()` kept the playhead on its own clip; routing a layer to a deck now
  switches that deck on; `q`/`a`/`z` cycle sources in the LAYERS dropdown's order.

## 2026-07-28 — v0.13.0: Live GLSL (13–20), MixBus Rethink (23), Warp Drawing (24)

**Commits:** 9810808 (tag), 3830bf0, 8a2345d (tag `pre-rutt-etra`)
**Version:** v0.13.0 (three CHANGELOG entries, same version)

### Phases 13–20 — The Live GLSL Overhaul
- Live GLSL editor with persistence, user shader presets, GLSL insert routing, and a VJ
  uniform contract.
- **AI shader generation** (✨ Prompt AI), `glsl.preset` MIDI recall, and recall range for
  all SELECT params.
- Draw arc: pen-ready drawing (Pointer Events + pressure), draw on the output canvas,
  stroke looper, draw↔synthesis crossovers, Stroke→LFO controller driver, video-as-ink.

### Phase 23 — MixBus Rethink
- **Three mix buses with free source selection** — a bus becomes a real graph node rather
  than a crossfader hardwired to the two movie decks.
- **One-frame-behind feedback** via double buffering rather than an identity guard.
- **Consumption analysis is a fixpoint** (`_srcUsed`), replacing seven near-duplicates.
- Panel taxonomy follows signal flow; initial tab activation becomes data-driven.
- **Six hand-synced copies of the source list existed and three had drifted** — breaking
  TimeDisplace capture of Movie B and Mix Bus, and making the AI Narrator report `?` for
  the newest sources. Consolidated to one origin, `SOURCE_DEFS`.

### Phase 24 — Performative Warp Drawing
- Draw the warp on the main canvas. `warpDrawX`/`Y`, `warpDrawRadius`, `warpSlot` (1–16),
  `warpPreset` (8 shapes), `warpSlotFade`, `warpDrawFixed`/`warpDrawAngle`.
- Controller assignment on controls that are not param rows. WarpAmt ceiling 100% → 200%.
- **Warp drawing was mirrored vertically, twice** — position and direction both needed
  flipping; fixing one alone just moved the mirror. Plus a half-texel register error, an
  upside-down grid overlay, and a mini editor that barely drew and whose mesh was 2.5×
  exaggerated.

## 2026-07-10 — v0.12.0 Dual-Deck & Touch Polish

**Commits:** 7815724 (tag), d8fedbb, 1ec5673 (tag `pre-dualdeck`)
**Version:** v0.12.0

- **Deck B movie engine** (headless first), Deck B UI and clip routing, and the
  **MixBus A/B engine**. Deck target toggle for touch; Movie B status header.
- **Idle-deck upload gating** — the perf work that later got confirmed by counting rather
  than by soak.
- Menu restructure; desktop state-bar ＋ tile; autoplay recovery.
- Fixed: iPad context-menu taps; TimeDisplace "Native" on large desktops; repo hygiene.

## 2026-07-07 — v0.10.0 The Touch Instrument, then v0.11.0 Ergonomics

**Commits:** fd911a9 (v0.10.0), 0f170a2; 5b50f67 (v0.11.0), 2a58906
**Version:** v0.10.0 → v0.11.0 (same day)

### v0.10.0 — The Touch Instrument
- **Device motion controllers (Phase 6)**; mobile state pad and hybrid state bar
  (Phase 4); long-press to clear, long-press action menu, touch double-tap on param rows.
- Slot-based mirror: Mirror FG / Mirror BG (Phase 5, **breaking**); pad-mode crosshair;
  orbit inertia; 3-finger tap mode cycle; **movie texture upload gating (Phase 5)**.
- Canvas grab takes control from auto-spin.

### v0.11.0 — Touch & Ergonomics Overhaul
- Flick momentum on param drags; touch value entry; unified long-press; desktop canvas
  parity; UI chrome toggles.
- **Live-performance safety (Grill Report P1)**.
- Coarse-pointer param rows rebuilt; rAF-batched param→DOM sync.
- Fixed: rotation slider stutter; context menu scroll safety; coach notification;
  detached panels and floated signal path drag on touch.

## 2026-07-05 — UI componentization closed

**Tags:** `pre-ui-componentization` (16852fb), `ui-componentization-done` (916d435)

- Phase 2 UI extraction completed and tagged at both ends.

## 2026-06-15 — v0.9.0 The Noise Family

**Commits:** d6fa520 (tag), acef99a
**Version:** v0.9.0

- **PsrdWarp gradient domain warp as uType 40**; psrdnoise2 as uType 39 (Phase 2), with
  its parameters wired.
- Noise panel gains a family→type selector (Phase 1); noise UI wiring simplified.
- Fixed: **noise animation stutter from wall-clock time**; speed slider phase jump;
  `noisePhase` render-gate bypass; alpha cycling in non-periodic mode; PsrdWarp `mod()`
  wrapping; PsrdWarp/Psrd2D asymmetric period response; HyperCube wireframe framerate;
  period step reverted to 1.

## 2026-06-10 — Chrome 148 Metal/ANGLE bug fixed upstream
- **Chromium bug resolved by Google** — the ANGLE/Metal backend regression
  (filed May 16 2026, see [[#ImWeb — Chrome 148 Metal Fix — RESOLVED (2026-06-10)]])
  has been fixed in a Chrome update. Hypercube wireframe edges and the
  Harabara GLB model now render correctly on Chrome with the default Metal
  backend — the `--use-angle=gl` workaround / `chrome-gl` alias is no
  longer needed.
- **Noise: Sharpen relocated + strengthened** — `noise.sharpen` lives in
  the Noise panel (not a global Effects pass), applied via a dedicated
  512×512 `_noiseSharpTarget` unsharp-mask pass. Widened kernel radius to
  2px and raised max effect to 8x so it's visible on smooth procedural
  noise. Commits `f2cecb4`, `fff4bfa`.
- **Noise: Value/Gradient speed-pulsing fixed** — `vNoise`'s quintic ease
  curve had zero z-derivative at integer time-cell boundaries with random
  per-cell amplitude, producing a periodic "speed up/slow down" pulse.
  Fixed with a two-phase time crossfade (sample at `t` and `t+0.5`,
  blend toward whichever has the stronger derivative). Isolated to
  Gradient/Value (uType==1). Commit `c079d4b`.

## 2026-05-26 — Chrome perf investigation + reset cascade fix

**Commits:** 0bfdfe9, 83118ba
**Version:** v0.8.9

### Investigation (Claude in Chrome)
- Confirmed --use-angle=gl flag active: ANGLE / AMD Radeon Pro 5500M
  OpenGL 4.1, not Metal
- 7 simultaneous WebGL2 contexts identified as GPU overhead — 4
  anonymous 300×150 preview canvases render every frame regardless of
  panel visibility. Deferred.
- 3D Scene pipeline: ~22–30fps GPU-bound. Movie/Camera pipeline: 60fps.
  CPU 3–4ms throughout — bottleneck is GPU not CPU.
- Identified two separate reset code paths: ↺ button (_resetAllParams)
  and ○ button (neutralState listener, Shift+0). User was pressing ○.
- Root cause of "shifting loop": ps.getAll().forEach(p => p.reset())
  with MORPH active (2.0s) fired ~80+ onChange events through the morph
  interpolation system — looked like cycling through all states.

### Fixes
- 0bfdfe9: suspend morphspeed during _resetAllParams cascade
- 83118ba: same fix applied to neutralState listener (the actual trigger)
- Both: _morphParam._value = 0 before loop, restore via .value setter
  after — one clean syncDisplay update on restore. TODO comment for
  future ps.suspendMorph() migration left in both locations.

### New issue found
After neutral reset, layer.fg lands on Movie (1) instead of Camera (0)
despite explicit ps.set('layer.fg', 0). Accompanied by MovieInput.tick
NaN currentTime error. Logged in KNOWN-ISSUES.md. Under investigation.

### Deferred
- 7 WebGL2 contexts: preview canvases should lazy-render only when panel
  visible (IntersectionObserver gate on rAF loops)
- 3D pipeline fps: same root cause — no fix this session

### 2026-05-23 — uRidge parameter (v0.8.9+)

Added uRidge uniform to PsrdWarp (uType 40) accumulation loop.
Continuous 0→1 blend: standard noise (0) → abs() ridge/tendril mode (1).
ridgeN = 1.0 - 2.0 * abs(r.n) per octave, mixed with uRidge.
Orthogonal to uSwirl — both work simultaneously.
4 files: shaders/index.js, ParameterSystem.js, Pipeline.js, main.js.

### 2026-05-23 — uSwirl parameter (v0.8.9+)

Added uSwirl uniform to PsrdWarp (uType 40) domain warp loop.
Blends gradient warp (uSwirl=0, clouds/smoke) vs curl warp (uSwirl=1,
vortex/cyclone). Single mix() line in octave loop. 4 files: shaders/index.js,
ParameterSystem.js, Pipeline.js, main.js. Commit 3f4ce77.

### 2026-05-23 — PsrdNoise phase investigation (v0.8.9+)

Extended multi-agent debugging session tracing PsrdWarp (uType 40)
and Psrd2D (uType 39) rendering artifacts. Agents: Claude Chat
(architecture), Claude Code (surgical edits), Codex GPT-5.5 High
(diagnosis), Kimi K2.6 (full-file tracing).

Root causes diagnosed and resolved:
- PsrdWarp tearing: manual mod() on warped coordinates removed
- Asymmetric period response: periodicP centering applied to both types
- Animation stutter: wall-clock time replaced with capped-dt accumulator
- Speed phase jump: uPhase uniform with noisePhase += speed * dt in JS
- noisePhase render-gate bypass fixed
- Alpha cycling: unbounded in non-periodic mode, bounded only when tiling

Gustavson psrdnoise2 source paper and full interactive tutorial reviewed.
Key insight: original reference uses alpha = time (unbounded, non-periodic).
The cyclical/mechanical feel was caused by mod() bounding alpha always,
and by pow(sc, 0.33) suppressing high-frequency rotation (vs tutorial's
s * alpha linear scaling).

Deferred:
- Period tile-count semantics redesign
- psrdnoise_grad integer lattice index wrapping (gradient discontinuity)
- Swirl and Ridge extensions (see Todo)

### 2026-05-22 — Noise panel Phase 1
- **Noise family→type selector** — added `noise.family` with six top-level
  families: Gradient, Fractal, Cellular, Warp, Pattern, and Analog.
- **Noise panel rebuilt** — `buildNoisePanel()` now renders the family row,
  type grid, shared noise params, and Fractal-only controls.
- **Main wiring simplified** — removed legacy noise visibility/optgroup patch
  helpers from `main.js`; `generateNoise()` now receives `p.family`.
- **Commit:** `d2b7fe2` — `feat(ui): noise panel family→type two-level selector
  (Phase 1)`.
- **Next:** fix noise scale-from-center shader behavior; Phase 2 adds
  psrdnoise / Periodic family.

### 2026-05-16 (v0.8.9+)
- **Chrome 148 Metal bug diagnosed** — Root cause identified: Chrome 148 
  ANGLE/Metal backend regression on macOS breaks Hypercube wireframe edges 
  and Harabara GLB model. Safari and Firefox unaffected. Not a code bug — 
  confirmed by testing across multiple git commits back to v0.8.7, all broken.
- **Workaround:** launch Chrome with `--use-angle=gl` flag. Alias added to 
  `~/.zshrc`: `chrome-gl`
- **Chromium bug filed:** May 16 2026 at issues.chromium.org — ANGLE Metal 
  backend regression, live reproduction at imweb.image-ine.org included.
- **Debug session committed** — aTB attribute replaces gl_VertexID in edge 
  shader; highp sampler2D + textureLod hardening; SkinnedMesh→Mesh in 
  loadGLTF. Commit `379d694`. Repo synced, origin/main current.
- **Pending:** fix code to work on Chrome Metal without flag (see Chrome 148 
  Metal Fix Needed note above).

### 2026-05-23 — PsrdNoise extensions + 3D material noise fixes (v0.8.9+)
uSwirl and uRidge added to PsrdWarp, wired to UI. Six 3D material noise
fixes: animation, seamless period, triplanar UV seam elimination, T-Displace
noise routing and triplanar matching. material.color fixed to always white;
MatHue/MatSat moved to emissive tinting. Default white 3D object appearance
still not resolved visually — parked for next session first task.


### 2026-05-05 — 2026-05-13 (v0.8.8 → v0.8.9)
- **Bundled Models** — URL-based asset loading list in 3D tab; SceneManager 
  closure fix for click handler.
- **3D model URL persistence** — `currentModelUrl` saved to `.imweb` project 
  files, `.imbank` bank files, and per-state via `mediaRefs.scene3d`.
- **Second display WebGL recovery** — DPR change listener + 
  `webglcontextlost`/`restored` handlers; canvas stays live when window 
  moves to external display.
- **MasterProject system** — `npm run push-master` script + post-commit hook; 
  MasterProject.imweb auto-pushed on commit. Load status shown in splash.
- **Pipeline fixes** — blend and feedback gated on active toggles; 
  BG blend labelled as self-process to clarify asymmetry with FG blend.
- **Bank lookup fix** — active bank resolved by index field not array position.
- **Version bumped to v0.8.9.**

### 2026-05-02
- **Obsidian Update** — Note updated to v0.8.7; includes Hypercube engine, Analog TV simulation, and per-layer blend refactor.
- **Open Collective application** — milestone: Applied for Open Collective hosting.

### 2026-04-29 (v0.8.7)
- **Per-layer blend architecture** — FG.blend now composites FG over BG using TRANSFERMODE; feedback.mode now uses TransferMode for creative feedback trails.
- **Hypercube Face Masks** — luminance-based alpha masking on face quads.
- **Hypercube Instancer** — InstancedMesh at each hypercube vertex position; 13 geometry types.

### 2026-04-16 (v0.8.0 - v0.8.5)
- **N-D Hypercube engine** — 4D–12D performance engine; vertex/edge generation; Givens projection.
- **Analog TV & CRT Simulation** — Dedicated 720x480 internal RT; signal color grading (H/S/B/C).
- **HypercubeFaces & Instancer** — real-time centroids/normals; InstancedMesh face rendering.

### 2026-04-14 (v0.61.0)
- **Program > Bank > State Hierarchy** — UI and mental model overhaul to professional performance hierarchy.
- **38 noise types** — Classic, Structured, Geometric, Signal, Fractal, Fluid categories in NOISE_BFG shader.
- **Auto-Thumbnailing** — right-click save now captures canvas automatically.

### 2026-04-10 (v0.7.0)
- **Text animation system** — Bounce/Wave/Fade/Typewriter modes; auto-advance clock.
- **iPad touch input** — Pointer Events + setPointerCapture; 44px touch targets; long-press context menu.
- **Vasulka Warp** — temporal slit-scan ring buffer (DataArrayTexture); routable as "VWarp".

### 2026-04-05 (v0.5.0)
- **SDF Phase 3** — camera nav, KIFS folding, op modes, luma warp, triplanar texturing, AO/glow, HSV colour, glass refraction, dedicated texture routing.
- **Factory demo presets** — 5 rich camera-free presets; SDF Metaballs loads on startup.

### 2026-04-04 (v0.4.2)
- **3D Cloner** — InstancedMesh clone mode; 11+ effectors.
- **Blob/Morph** — vertex displacement shader injection.
- **SDF Generator Phase 1+2** — standalone GPU raymarching engine.

### 2026-03-30
- MeshoptDecoder support added; Harabara.glb optimized 50MB → 1.9MB.

### 2026-03-20 (v0.4.0)
- Phase 4 complete: 3D depth pass, WarpMap on UV, Draco import, zero-latency second monitor, high-res Tables, rand1/2/3, AI provider system.

### 2026-03-18 — 2026-03-19
- Phases 1–3 built: full signal chain, all ImOs9 features restored, preset system, MIDI, second monitor, sequencers.

*Development with Claude Sonnet 4.6, sessions starting 2026-03-18. v0.8.9+ current 2026-05-16.*
