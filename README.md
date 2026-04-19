# ImWeb

![ImWeb Preview](assets/preview.png)

**A browser-based reimagining of Tom Demeyer's and Steina Vasulka's Image/ine video synthesis instrument (STEIM, Amsterdam)**

Real-time video compositing, 3D scene integration, and a complete parameter/controller mapping system — all in a Progressive Web App.

Current version: **v0.8.4** — [Changelog](CHANGELOG.md)

💖 **[Support ImWeb's development on Patreon!](https://www.patreon.com/ImWeb)**

---

## Quick Start

```bash
npm install
npm run dev
# → open http://localhost:5173
```

Chrome 113+ recommended (best WebGL performance).
Works on Firefox and Safari in WebGL mode with minor limitations.

---

## What This Is

Image/ine was a real-time video synthesis environment created by Tom Demeyer and Steina Vasulka at STEIM Amsterdam. It ran on Mac OS 9 (1997) and later OS X (2008). ImWeb is a ground-up reimplementation for the modern browser, restoring features lost between versions and adding a full 3D scene pipeline.

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
| `Q` | Cycle Foreground source |
| `A` | Cycle Background source |
| `Z` | Cycle DisplaceSrc source |
| `T` | Tap tempo |
| `?` | Keyboard help overlay |
| `/` | Parameter search overlay |
| `0–9` | Recall State 0–9 |
| `Shift+0` | Neutral State (reset all params, keep controllers) |
| `Shift+S` | Quick-save State to next empty slot (auto-thumbnail) |
| `Shift+1–8` | Select movie clip 1–8 |
| `Cmd/Ctrl+S` | Save project → downloads `.imweb` |
| `Cmd/Ctrl+F` | Fullscreen output |
| `NumPad +/-` | Next / previous Bank |

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
    SDFGenerator.js       GPU raymarched SDF metaballs → WebGLRenderTarget

  scene3d/
    SceneManager.js       Three.js 3D scene → RenderTarget; auto-spin, model import
    GeometryFactory.js    All procedural geometry generators

  state/
    Preset.js             Banks + States, persisted to IndexedDB

  ui/
    UI.js                 Parameter rows, tabs, StateBar (bottom-bar state grid),
                          MemoryPanel (bank list + state list), signal path,
                          context menus, seq cards
```

---

## Features (v0.8.4)

### Input sources
- [x] Camera (WebRTC, auto-start on load)
- [x] Movie clips — up to 8; auto-loaded from `_imweb_ready/` on startup; speed, loop range, position scrub, BPM sync, mirror, mute; thumbnails in UI
- [x] Stills buffer — capture up to 16 frames, FrameSelect 1/2/3
- [x] Color source (HSV solid)
- [x] Noise source (pixel)
- [x] 3D scene — all geometry, transforms, material, camera; GLTF/GLB/OBJ/STL import; auto-spin; Cloner (MoGraph InstancedMesh) with Twist/Scatter/Wave/ScaleStep effectors; Blob/Morph vertex displacement; N-D Hypercube engine (4D–12D) with edge/face/instancer rendering; real-time pipeline texture on instancer geometry via unified material pipeline
- [x] Slit scan buffer
- [x] Draw layer (freehand canvas)
- [x] Text layer
- [x] GPU particle system
- [x] Sequencer buffers ×3 — record and loop any source; variable frame count (4–480 frames)
- [x] SDF raymarching generator — GPU-raymarched metaballs routable as pipeline source; Sphere/Box/Torus shapes; KIFS fractal folding; camera navigation; domain repetition; surface displacement; luma warp; triplanar video texturing; AO + glow; HSV colour; glass refraction + Fresnel; dedicated texSrc/refractSrc routing
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
- [x] Non-realtime frame capture — 📷 pauses render loop; Step Frame / Auto-Run exports numbered PNG sequence

### Project & State Management
- [x] **Project → Bank → State hierarchy** — standard live performance mental model
- [x] **Project files (.imweb)** — `Cmd+S` or Export button downloads the full session
- [x] **Banks** — named groups of States; bank list in the Project tab; bank dropdown in the bottom-right corner; ⊞ "Open Banks window" from dropdown detaches the panel
- [x] **States** — up to 32 fully self-contained snapshots per Bank (parameter values + FX order + controller assignments + media refs); thumbnail grid in the bottom bar; `Shift+S` = quick-save; `0–9` = recall; `Shift+0` = Neutral State; right-click a tile for Save / Import / Export / Clear
- [x] **Neutral State** — resets all parameter values without touching controller assignments
- [x] **Bank export/import (.imbank)** — share a single bank
- [x] **State export/import (.imstate)** — share a single state
- [x] **AI State Generator** — LLM-driven parameter patching ("make a slow organic ocean")

### UI
- [x] Signal path display — float or dock
- [x] Live GLSL editor — 10 built-in presets; auto-injects standard uniforms (uTexture, uTime, uParam1–4, vUv)
- [x] First-visit onboarding overlay (localStorage dismissed)
- [x] LFO visualiser in context menu
- [x] Vectorscope (Lissajous / waveform / FFT) as source
- [x] Parameter search overlay (`/`)
- [x] Keyboard help overlay (`?`)
- [x] Audio VU meter in status bar
- [x] Projection mapping — CSS homography corner-pin on second screen; calibration grid (G key); corner nudge (arrow keys)

---

## Planned

### Phase 6
- [ ] **Mobile-friendly UI** — touch targets, responsive layout, swipe gestures
- [ ] **GLSL editor fixes** — resolve WebGL 1281/1282 on preset apply
- [ ] Hypercube instancer texture switching (live source change without reset)
- [ ] Hypercube instancer default off; geometry controls in Geometry section
- [ ] Performance profiling / GPU display
- [ ] Multi-quad projection mapping (independent sources per quad)
- [ ] Multi-cam workflow (per-layer camera selector)

### Video prep
```bash
# Convert raw clips to ImWeb-optimised format (H.264 All-Intra, AAC audio)
node imweb-prep.js    # drop source files in _raw_videos/, output to _imweb_ready/
```

---

## Credits

Original Image/ine software: **Tom Demeyer**, STEIM Foundation, Amsterdam
Co-conspirator: **Steina Vasulka** (without her, Image/ine would not exist)
ImOs9 manual: Sher Doruff
ImWeb: H. Karlsson

This project is a personal reimplementation and artistic continuation.
It is not affiliated with or endorsed by STEIM.
