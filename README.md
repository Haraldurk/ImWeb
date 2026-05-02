# ImWeb

![ImWeb Preview](assets/preview.png)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/badge/version-v0.8.7-brightgreen)](CHANGELOG.md)
[![Live Demo](https://img.shields.io/badge/demo-live-orange)](https://imweb.image-ine.org)

**ImWeb is Image/ine — reimagined** — The legendary real-time video synthesis instrument created by Tom Demeyer and Steina Vasulka at STEIM Amsterdam, rebuilt for the modern browser and pointed toward what comes next. Free, open source, no installation required.
→ **[Try it live → imweb.image-ine.org](https://imweb.image-ine.org)**

💖 **[Support ImWeb on Open Collective](https://opencollective.com/imweb)**

---

## Contents

[What This Is](#what-this-is) · [Quick Start](#quick-start) · [Features](#features-v085) · [Keyboard Reference](#keyboard-reference) · [Architecture](#architecture) · [Roadmap](#roadmap) · [Contributing](#contributing) · [Credits](#credits) · [License](#license) · [Support](#support)

---

## What This Is

Image/ine was a rare instrument. Created at STEIM Amsterdam in the 1990s by Tom Demeyer in close collaboration with Steina Vasulka — one of the founders of video art — it treated video as a malleable, real-time medium for artistic performance. It ran on Mac OS 9 (1997) and later OS X (2008). No equivalent free tool has existed since.

ImWeb is a ground-up reimagining for the modern browser — an instrument rooted in the original's philosophy, extending a signal path that has always pointed toward what comes next.

**Built with** Three.js, Vite, and raw WebGL shaders — no framework dependencies, nothing between the artist and the signal.

**Signal path:**

```
INPUT SOURCES
  Camera · Movie · Stills Buffer · Color · Noise
  3D Scene · Draw · Slit Scan · Sequencer · GPU Particles · SDF Raymarcher
        ↓ assigned to ↓
  Foreground | Background | DisplaceSrc
        ↓ effects chain ↓
  TransferMode → Displacement → WarpMap → Keyer → Blend
  → ColorShift → LUT → Interlace → Fade
        ↓
  Output canvas → fullscreen / second monitor / WebM record
```

---

## Quick Start

**Requires Node 18+**

```bash
npm install
npm run dev
# → open http://localhost:5173
```

Chrome 113+ recommended for best WebGL performance.
Firefox and Safari supported in WebGL mode with minor limitations.

---

## Features (v0.8.5)

### Input Sources

- Camera (WebRTC, auto-start on load)
- Movie clips — up to 8; auto-loaded from `_imweb_ready/` on startup; speed, loop range, position scrub, BPM sync, mirror, mute; thumbnails in UI
- Analog TV — Phase 1 signal simulator (720×480); 4:3 cropping; hue/sat/bright/contrast grading
- Stills buffer — capture up to 16 frames, FrameSelect 1/2/3
- Color source (HSV solid)
- Noise source (pixel)
- 3D scene — all geometry, transforms, material, camera; GLTF/GLB/OBJ/STL import; auto-spin; Cloner (MoGraph InstancedMesh) with Twist/Scatter/Wave/ScaleStep effectors; Blob/Morph vertex displacement; N-D Hypercube engine (4D–12D) with edge/face/instancer rendering; real-time pipeline texture on instancer geometry
- Slit scan buffer
- Draw layer (freehand canvas)
- Text layer
- GPU particle system
- Sequencer buffers ×3 — record and loop any source; variable frame count (4–480 frames)
- SDF raymarching generator — GPU-raymarched metaballs routable as pipeline source; Sphere/Box/Torus shapes; KIFS fractal folding; camera navigation; domain repetition; surface displacement; luma warp; triplanar video texturing; AO + glow; HSV colour; glass refraction + Fresnel; dedicated texSrc/refractSrc routing
- Drag-and-drop to load video/image files

### Effects Chain

- TransferMode (Copy, XOR, OR, AND)
- Displacement (amount, angle, offset, RotateGrey)
- WarpMap
- Luminance keyer (White, Black, Softness)
- Blend / frame persistence / motion blur
- ColorShift
- 3D LUT colour grading (.cube files)
- Interlace
- Fade
- Mirror / Quad mirror
- Kaleidoscope
- Bloom
- Vignette
- Chroma key (colour picker)
- Film grain, scanlines
- Video delay line
- Pixel sort
- Levels correction
- Stroboscope

### Controller Mapping

Right-click any parameter to assign:

- Mouse X/Y
- MIDI CC (with channel filter)
- LFO ×4 (Sine/Triangle/Sawtooth/Square; BPM sync; beat retrigger)
- Audio FFT (bass / mid / high)
- Audio beat detection + auto-BPM
- Random
- Fixed value
- Key (keyboard trigger)
- Expression (math formula)
- Parameter lock
- Slew/smoothing (configurable lag time)

### Automation & Sequencing

- Automation recorder — record parameter movements, loop playback
- Step sequencer — rhythmic preset recall; configurable pattern
- Preset morph — smooth crossfade between two preset states

### MIDI

- MIDI CC input (per-channel filter)
- MIDI Note input
- MIDI Program Change → preset recall
- MIDI Clock sync (BPM lock)
- MIDI output feedback (motorized faders)

### Output

- Fullscreen (double-click canvas or `Cmd+F`)
- Second monitor — `⊡` opens letterboxed popup on any connected display
- Ghost mode — dims main canvas when second screen is active
- Output resolution — Fit / 540p / 720p / 1080p / Half
- WebM recording
- Non-realtime frame capture — 📷 pauses render loop; Step Frame / Auto-Run exports numbered PNG sequence

### Project & State Management

- **Project → Bank → State hierarchy** — standard live performance mental model
- **Project files (.imweb)** — `Cmd+S` or Export button downloads the full session
- **Banks** — named groups of States; bank list in the Project tab; bank dropdown in the bottom-right corner
- **States** — up to 32 fully self-contained snapshots per Bank (parameter values + FX order + controller assignments + media refs); thumbnail grid in the bottom bar
- **Neutral State** — resets all parameter values without touching controller assignments
- **Bank export/import (.imbank)** — share a single bank
- **State export/import (.imstate)** — share a single state
- **AI State Generator** — LLM-driven parameter patching ("make a slow organic ocean")

### UI

- Signal path display — float or dock
- Live GLSL editor — 10 built-in presets; auto-injects standard uniforms
- First-visit onboarding overlay
- LFO visualiser in context menu
- Vectorscope (Lissajous / waveform / FFT) as source
- Parameter search overlay (`/`)
- Keyboard help overlay (`?`)
- Audio VU meter in status bar
- Projection mapping — CSS homography corner-pin on second screen; calibration grid (`G`); corner nudge (arrow keys)

---

## Keyboard Reference

| Key | Action |
|-----|--------|
| `V` | Toggle camera |
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
| `Shift+0` | Neutral State |
| `Shift+S` | Quick-save State to next empty slot |
| `Shift+1–8` | Select movie clip 1–8 |
| `Cmd/Ctrl+S` | Save project → downloads `.imweb` |
| `Cmd/Ctrl+F` | Fullscreen output |
| `NumPad +/-` | Next / previous Bank |

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
    UI.js                 Parameter rows, tabs, StateBar, MemoryPanel,
                          signal path, context menus, seq cards
```

---

## Video Preparation

```bash
# Convert raw clips to ImWeb-optimised format (H.264 All-Intra, AAC audio)
node imweb-prep.js
# Drop source files in _raw_videos/, output goes to _imweb_ready/
```

---

## Roadmap

Phases 1–5 complete. Phase 6 in progress:

- [ ] Mobile-friendly UI — touch targets, responsive layout, swipe gestures
- [ ] GLSL editor fixes — resolve WebGL 1281/1282 on preset apply
- [ ] Hypercube instancer texture switching (live source change without reset)
- [ ] Performance profiling / GPU display
- [ ] Multi-quad projection mapping (independent sources per quad)
- [ ] Multi-cam workflow (per-layer camera selector)

---

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines on bug reports, feature requests, and the development workflow.

---

## Credits

Original Image/ine software: **Tom Demeyer**, STEIM Foundation, Amsterdam
Co-conspirator: **Steina Vasulka** — without her, Image/ine would not exist
ImOs9 manual: Sher Doruff
ImWeb: **[Haraldur Karlsson](https://haraldur.net)**

This project is a personal reimagining and artistic continuation. It is not affiliated with or endorsed by the STEIM Foundation (1959–2019).

---

## License

GNU Affero General Public License v3.0 — see [LICENSE](LICENSE) for full text.

The AGPL v3 was chosen deliberately: any hosted derivative of ImWeb must remain open source. The license file includes a dedication to Tom Demeyer and Steina Vasulka.

---

## Support

ImWeb is free for every artist on this planet, forever.

If it's useful to your practice, consider supporting its development:

💖 [Open Collective](https://opencollective.com/imweb) — one-time or recurring donations, fully transparent
