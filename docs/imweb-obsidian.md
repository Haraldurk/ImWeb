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

## Current status (2026-05-17)

## ImWeb — Chrome 148 Metal Fix Needed

Root cause: Chrome 148 ANGLE/Metal backend regression on macOS.
Breaks: Hypercube wireframe edges + Harabara GLB model.
Confirmed: production URL imweb.image-ine.org also broken.
Workaround: launch Chrome with --use-angle=gl flag.
Chromium bug filed: May 16 2026.

Next session task:
Fix code so it works on Chrome Metal without the flag.
Two fixes needed:
1. HypercubeObject.js — aTB attribute clean (gl_VertexID eliminated)
2. SceneManager.js loadGLTF() — SkinnedMesh → plain Mesh conversion
3. Add startup detector: if Chrome + Metal backend → show user notice
   with workaround instructions

Test method: run Chrome normally (Metal, broken) after each fix.
Use --use-angle=gl Chrome to verify logic is correct if needed.

(2026-05-02)

**v0.8.7 — Phase 7 complete + Hypercube & Analog TV.** Codebase at `/Users/haraldurkarlsson/Documents/GitHub/ImWeb`, built with Vite 5.4. Hosted at imweb.image-ine.org (Tom Demeyer).

### What's running today

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
INPUT SOURCES (22+)
Camera · Movies · Stills Buffer · Color · Color2 (gradient, animated)
Text · Draw · Noise (38 types) · 3D Scene · 3D Depth · Sound · SlitScan
Particles · Vectorscope · Delay · BG1/BG2 stills · Output (feedback)
SDF Generator · Analog TV (CRT simulation)

        ↓ assigned to ↓

Foreground | Background | DisplaceSrc

        ↓ 20-pass effects chain ↓

FG/BG CC → TransferMode → Displace → Keyer → ChromaKey → WarpMap
→ Blend/Feedback (Refactored) → ColorShift → Pixelate → Edge → RGBShift
→ Kaleidoscope → QuadMirror → Posterize → Solarize → Vignette → Bloom
→ Levels → LUT3D → WhiteBalance → PixelSort → FilmGrain → Interlace
→ Fade → Custom GLSL → Output

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
- ✓ **Parameter search overlay** — `/` key
- ✓ **Parameter lock** — prevent controller from overwriting value
- ✓ **Slew/lag** — per-parameter smoothing time
- ✓ **Drag-and-drop** — video files → clips, images → buffer, models → 3D scene
- ✓ **N-D Hypercube** — 4D to 12D projection engine; face rendering; vertex instancer
- ✓ **Analog TV & CRT** — 720x480 stable internal RT; signal grading
- ✓ **Responsive & Touch Layout** — iPad optimized targets; 4K/Tablet/Mobile breakpoints
- ✓ **Program > Bank > State** — Professional performance hierarchy UI
- ✓ **38 Noise Types** — Classic, Structured, Geometric, Signal, Fractal, Fluid categories
- ✓ **Text Animation** — Typewriter/Wave/Fade/Bounce modes; auto-advance clock
- ✓ **Per-layer Blend refactor** — FG.blend composites over BG; feedback.mode TransferMode

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
| Build | Vite 5.4 · no framework · vanilla JS modules |

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

## Files & references

| File | Location | Notes |
|---|---|---|
| Architecture spec | `imagine-remake-architecture.md` | Technical spec, updated v0.4 |
| Testing log | `Testings.md` | Session 5 — Phase 4 development |
| Codebase | `~/Documents/GitHub/ImWeb` | Vite 5.4, vanilla JS + Three.js |
| ImOs9 source manual | Archive | 108pp, 1997, STEIM |
| ImX source manual | Archive | 12pp, ~2008, Tom Demeyer |

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
