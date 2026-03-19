# ImWeb

**A browser-based reimagining of Tom Demeyer's Image/ine video synthesis instrument (STEIM, Amsterdam)**

Real-time video compositing, 3D scene integration, and a complete parameter/controller mapping system — all in a Progressive Web App.

Current version: **v0.3.0**

---

## Quick Start

```bash
npm install
npm run dev
# → open http://localhost:3000
```

Chrome 113+ recommended (best WebGL performance).
Works on Firefox and Safari in WebGL mode with minor limitations.

---

## What This Is

Image/ine was a real-time video synthesis environment created by Tom Demeyer at STEIM Amsterdam. It ran on Mac OS 9 (1997) and later OS X (2008). ImWeb is a ground-up reimplementation for the modern browser, restoring features lost between versions and adding a full 3D scene pipeline.

**Signal path:**
```
INPUT SOURCES
  Camera · Movie · Stills Buffer · Color · Noise
  3D Scene · Draw · Slit Scan · Sequencer · GPU Particles
        ↓ assigned to ↓
  Foreground | Background | DisplaceSrc
        ↓ effects chain ↓
  TransferMode → Displacement → WarpMap → Keyer → Blend
  → ColorShift → LUT → Interlace → Fade
        ↓
  Output canvas → fullscreen / second monitor / WebM record
```

---

## Controls

| Key | Action |
|-----|--------|
| `V` | Toggle camera on/off |
| `K` | Toggle keyer |
| `B` | Toggle blend (motion persistence) |
| `S` | Solo (bypass all effects) |
| `C` | Capture frame to stills buffer |
| `M` | Toggle movie playback |
| `H` | Fade to black |
| `T` / `F` | Transparency / Fade shortcuts |
| `?` | Keyboard help overlay |
| `/` | Parameter search overlay |
| `0–9` | Recall Display States 0–9 |
| `Shift+1–8` | Select movie clip 1–8 |
| `Cmd/Ctrl+F` | Fullscreen output |
| `Cmd/Ctrl+S` | Quick-save current preset |
| `NumPad +/-` | Next / previous preset |

**Right-click any parameter** to assign a controller:
Mouse X/Y · MIDI CC · LFO (4 waveforms) · Sound level · Random · Fixed value · Key · Expression

---

## Architecture

```
src/
  main.js                 Application bootstrap + render loop + feature wiring
  style.css               Dark performance UI

  controls/
    ParameterSystem.js    All controllable parameters + reactivity
    ControllerManager.js  Mouse, MIDI, LFO, Sound, Key, Random, Expression drivers
    LFO.js                Sine / Triangle / Sawtooth / Square oscillators

  core/
    Pipeline.js           WebGL render-target compositing chain

  shaders/
    index.js              All GLSL effect shaders (keyer, displace, warp,
                          transfermode, colorshift, interlace, noise, blend,
                          LUT, kaleidoscope, bloom, film grain, pixel sort…)

  inputs/
    CameraInput.js        WebRTC getUserMedia → VideoTexture
    MovieInput.js         Video file → VideoTexture; speed/loop/scrub/BPM sync
    StillsBuffer.js       Frame capture store (up to 16 frames)
    SlitScanBuffer.js     Rolling slit scan effect
    TextLayer.js          Canvas 2D text → Texture

  scene3d/
    SceneManager.js       Three.js 3D scene → RenderTarget; auto-spin, model import
    GeometryFactory.js    All procedural geometry generators

  state/
    Preset.js             Presets + Display States, persisted to IndexedDB

  ui/
    UI.js                 Parameter rows, tabs, state dots, signal path,
                          context menu, seq cards, buildSeqParams()
```

---

## Features (v0.3.0)

### Input sources
- [x] Camera (WebRTC, auto-start on load)
- [x] Movie clips — up to 8; speed, loop range, position scrub, BPM sync, mirror; thumbnails in UI
- [x] Stills buffer — capture up to 16 frames, FrameSelect 1/2/3
- [x] Color source (HSV solid)
- [x] Noise source (pixel)
- [x] 3D scene — all geometry, transforms, material, camera; GLTF/GLB/OBJ/STL import; auto-spin
- [x] Slit scan buffer
- [x] Draw layer (freehand canvas)
- [x] Text layer
- [x] GPU particle system
- [x] Sequencer buffers ×3 — record and loop any source; variable frame count (4–480 frames)
- [x] Drag-and-drop to load video/image files

### Effects chain
- [x] TransferMode (Copy, XOR, OR, AND)
- [x] Displacement (amount, angle, offset, RotateGrey)
- [x] WarpMap
- [x] Luminance keyer (White, Black, Softness)
- [x] Blend / frame persistence / motion blur
- [x] ColorShift
- [x] 3D LUT colour grading (.cube files)
- [x] Interlace
- [x] Fade
- [x] Mirror / Quad mirror
- [x] Kaleidoscope
- [x] Bloom
- [x] Vignette
- [x] Chroma key (colour picker)
- [x] Film grain, scanlines
- [x] Video delay line
- [x] Pixel sort
- [x] Levels correction
- [x] Stroboscope

### Controller mapping
- [x] Mouse X/Y
- [x] MIDI CC (with channel filter)
- [x] LFO ×4 (Sine/Triangle/Sawtooth/Square; BPM sync; beat retrigger)
- [x] Audio FFT (bass / mid / high)
- [x] Audio beat detection + auto-BPM
- [x] Random
- [x] Fixed value
- [x] Key (keyboard trigger)
- [x] Expression (math formula)
- [x] Parameter lock
- [x] Slew/smoothing (configurable lag time)

### Automation & sequencing
- [x] Automation recorder — record parameter movements, loop playback
- [x] Step sequencer — rhythmic preset recall; configurable pattern
- [x] Preset morph — smooth crossfade between two preset states

### MIDI
- [x] MIDI CC input (per-channel filter)
- [x] MIDI Note input
- [x] MIDI Program Change → preset recall
- [x] MIDI Clock sync (BPM lock)
- [x] MIDI output feedback (motorized faders)

### Output
- [x] Fullscreen (double-click canvas or Cmd+F)
- [x] Second monitor — `⊡` opens letterboxed popup on any connected display
- [x] Ghost mode — dims main canvas when second screen is active
- [x] Output resolution — Fit / 540p / 720p / 1080p / Half
- [x] WebM recording
- [x] Cmd+S quick-save preset
- [x] Presets + 128 Display States per preset (IndexedDB)

### UI
- [x] Signal path display — float or dock
- [x] Live GLSL editor tab with 10 built-in examples
- [x] LFO visualiser in context menu
- [x] Vectorscope (Lissajous / waveform / FFT) as source
- [x] Parameter search overlay (`/`)
- [x] Keyboard help overlay (`?`)
- [x] Audio VU meter in status bar

---

## Planned

### Phase 3 (remaining)
- [ ] WarpMode editor (32 storable warp maps, Wave V/H/Randomize)
- [ ] Tables (16,384-point response curve editor)
- [ ] External Mapping (controller-of-controller)
- [ ] rand1/rand2/rand3 noise sources

### Phase 4 (3D depth)
- [ ] Depth pass → DisplaceSrc (3D geometry distorts video)
- [ ] WarpMap on 3D UV coordinates
- [ ] 3D material: video texture from input sources
- [ ] Post-processing on 3D output (bloom, chromatic aberration)

### Phase 5
- [ ] `.imweb` project file format (save/load full session)
- [ ] PWA manifest + service worker
- [ ] Non-realtime capture (frame-by-frame export)
- [ ] OSC via WebSocket bridge

---

## Credits

Original Image/ine software: **Tom Demeyer**, STEIM Foundation, Amsterdam
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson

This project is a personal reimplementation and artistic continuation.
It is not affiliated with or endorsed by STEIM.
