# ImWeb

![ImWeb Preview](assets/preview.png)

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL%20v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/badge/version-v0.17.0-brightgreen)](CHANGELOG.md)
[![Live Demo](https://img.shields.io/badge/demo-live-orange)](https://imweb.image-ine.org)

**ImWeb is Image/ine — reimagined** — The legendary real-time video synthesis instrument created by Tom Demeyer and Steina Vasulka at STEIM Amsterdam, rebuilt for the modern browser and pointed toward what comes next. Free, open source, no installation required.
→ **[Try it live → imweb.image-ine.org](https://imweb.image-ine.org)**

💖 **[Support ImWeb on Open Collective](https://opencollective.com/imweb)**

---

## Contents

[What This Is](#what-this-is) · [Quick Start](#quick-start) · [Features](#features-v0170) · [Keyboard Reference](#keyboard-reference) · [Architecture](#architecture) · [Roadmap](#roadmap) · [Contributing](#contributing) · [Credits](#credits) · [License](#license) · [Support](#support)

---

## What This Is

Image/ine was a rare instrument. Created at STEIM Amsterdam in the 1990s by Tom Demeyer in close collaboration with Steina Vasulka — one of the founders of video art — it treated video as a malleable, real-time medium for artistic performance. It ran on Mac OS 9 (1997) and later OS X (2008). No equivalent free tool has existed since.

ImWeb is a ground-up reimagining for the modern browser — an instrument rooted in the original's philosophy, extending a signal path that has always pointed toward what comes next.

**Built with** Three.js, Vite, and raw WebGL shaders — no framework dependencies, nothing between the artist and the signal.

**Signal path:**

```
INPUT SOURCES
  Camera · Movie A · Movie B · Stills Buffer · Color · Noise
  3D Scene · Draw · Slit Scan · Sequencer · GPU Particles · SDF Raymarcher
        ↓ any two into ↓
  Mix 1 | Mix 2 | Mix 3   (crossfade / Add / Multiply / Luma Mask / Displace)
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

## Features (v0.17.0)

### Input Sources

- Camera (WebRTC, auto-start on load)
- Movie Library — unlimited catalogue of clips with thumbnail, duration and filter box; auto-loaded from `_imweb_ready/` on startup; drag a row onto a deck or use `→A` / `→B`
- Movie decks A and B — two independent engines, 8 loaded clips each; speed (±3×), loop range, position scrub, BPM sync, mirror, mute; a full rack evicts its oldest clip, never the one playing
- Mix buses ×3 — Mix 1/2/3, each crossfading or combining any two sources (Add, Multiply, Luma Mask, Displace); the mixed signal is itself a source, so it can be composited, captured and time-displaced
- Analog TV — Phase 1 signal simulator (720×480); 4:3 cropping; hue/sat/bright/contrast grading
- Stills buffer — capture up to 64 frames (8×8 grid), FrameSelect 1/2/3
- Color source (HSV solid)
- Noise source (pixel)
- 3D scene — all geometry, transforms, material, camera; GLTF/GLB/OBJ/STL import; auto-spin; Cloner (MoGraph InstancedMesh) with Twist/Scatter/Wave/ScaleStep effectors; Blob/Morph vertex displacement; N-D Hypercube engine (4D–12D) with edge/face/instancer rendering; real-time pipeline texture on instancer geometry
- Slit scan buffer
- Draw layer (freehand canvas)
- Text layer
- GPU particle system
- Sequencer buffers ×3 — record and loop any source; variable frame count (4–480 frames)
- SDF raymarching generator — GPU-raymarched metaballs routable as pipeline source; Sphere/Box/Torus shapes; KIFS fractal folding; camera navigation; domain repetition; surface displacement; luma warp; triplanar video texturing; AO + glow; HSV colour; glass refraction + Fresnel; dedicated texSrc/refractSrc routing
- Rutt-Etra Scan Processor — the 1972 scan processor, scanlines deflected by the luminance of any source and viewed through an orbiting perspective camera; drawn as beams or spherically shaded dots with independent widths; depth transfer function (gamma + pivot); asymmetric temporal slew in seconds, so live video becomes a viscous topography rather than jittery spikes; phosphor persistence with spatial bleed; phosphor tint or the source's own colour; full 360° orbit on both axes and free placement; and the raster wraps onto a Plane, Sphere, Cylinder, Torus, Catenoid, Helicoid or Gyroid
- Drag-and-drop to load video/image files

### Effects Chain

- TransferMode — 22 blend modes (Add, Difference, Multiply, Screen, Overlay, etc.)
- Displacement (amount, angle, offset, RotateGrey)
- WarpMap — draw the displacement map directly on the output canvas, or drive the same brush from LFO/MIDI/OSC via WarpDrawX/Y; shared Radius and Strength; 16 slots and 8 procedural shapes recallable from a controller, with timed crossfade between maps
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
- LFO (Sine/Triangle/Sawtooth/Ramp Down/Square/S&H; BPM sync; beat retrigger)
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
- Output resolution — Display / 720p / 1080p / 540p / Quarter
- WebM recording
- Non-realtime frame capture — 📷 pauses render loop; Step Frame / Auto-Run exports numbered PNG sequence

### Project & State Management

- **Project → Bank → State hierarchy** — standard live performance mental model
- **Project files (.imweb)** — `Cmd+S` or Export button downloads the full session
- **Banks** — named groups of States; bank list in the Project tab; bank dropdown in the bottom-right corner
- **States** — unlimited fully self-contained snapshots per Bank (parameter values + FX order + controller assignments + media refs); thumbnail grid in the bottom bar
- **Neutral State** — resets all parameter values without touching controller assignments
- **Bank export/import (.imbank)** — share a single bank
- **State export/import (.imstate)** — share a single state

### AI

- Multi-provider system — Anthropic, Google Gemini, OpenAI, Ollama (local), OpenRouter; switchable, API keys stored locally
- AI State Generator — LLM-driven parameter patching ("make a slow organic ocean")
- AI shader generation — describe an effect in natural language and the provider writes the GLSL; compile-checked before it reaches the editor, with one automatic repair attempt on compiler errors
- AI Narrator — periodic AI-generated description of the current parameter state, shown as an overlay
- AI Coach — periodic AI-generated performance suggestions
- AI Settings panel — per-provider live model lists, connection status, configurable Narrator/Coach interval & response length

### UI

- Signal path display — hidden by default; ┄ toolbar toggle; float/dock via `Shift+P`
- Live GLSL editor — CodeMirror 6 with GLSL syntax highlighting; built-in and saveable user presets, recallable from MIDI/LFO over a configurable index range; auto-injected VJ uniform contract (audio FFT, previous frame, BPM/beat, level/bass/mid/high); insert routing to Master Output, Foreground, Background or Displace; compile errors fall back to the last good shader instead of dropping the render loop
- First-visit onboarding overlay
- Help menu (status-bar `?`) — guided tour, keyboard shortcuts, the three manuals, About
- Guided tour (`Shift+G`) — 27 steps in three tracks (Basics / Principles / Instruments); it points at controls, it never sets them
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
| `G` | Cycle canvas mode (Camera / Pad / Locked / Draw / Warp) |
| `I` | Toggle parameter OSD |
| `U` | Toggle state bar |
| `?` | Keyboard help overlay |
| `/` | Parameter search overlay |
| `0–9` | Recall State 0–9 |
| `Shift+0` | Neutral State |
| `Shift+G` | Guided tour (resumes where you left off) |
| `Shift+S` | Quick-save State to next empty slot |
| `Shift+1–8` | Select clip 1–8 on Movie Deck A |
| `Option+1–8` | Select clip 1–8 on Movie Deck B |
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
    LFO.js                Sine / Triangle / Sawtooth / Ramp Down / Square / S&H oscillators
  core/
    Pipeline.js           WebGL render-target compositing chain
  shaders/
    index.js              All GLSL effect shaders (keyer, displace, warp,
                          transfermode, colorshift, interlace, noise, blend,
                          LUT, kaleidoscope, bloom, film grain, pixel sort…)
  inputs/
    CameraInput.js        WebRTC getUserMedia → VideoTexture
    MovieInput.js         Video file → VideoTexture; speed/loop/scrub/BPM sync
    StillsBuffer.js       Frame capture store (up to 64 frames, 8×8 grid)
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

As of v0.14.0 this writes **faststart** MP4s (`-movflags +faststart`), moving the
`moov` atom to the front of the file. Without it a browser cannot report a clip's
duration until it has read to EOF — seconds on a large All-Intra clip, or never
under load.

**Clips prepped before v0.14.0 need a one-off remux.** It is lossless — no
re-encode, no quality change:

```bash
ffmpeg -i old.mp4 -c copy -movflags +faststart new.mp4
```

---

## Roadmap

Phases 1–26 complete, through v0.17.0. Recently shipped:

- [x] Touch instrument — gesture arbitration, responsive layout, iPad-sized targets (v0.10–v0.11)
- [x] Dual-deck video and mix buses (v0.12–v0.13)
- [x] Live GLSL editor — CodeMirror, AI shader generation, last-good compile fallback (v0.13)
- [x] Performative warp drawing — draw the displacement map on the output (v0.13)
- [x] Movie Library — unlimited catalogue, two racks (v0.14)
- [x] Spacetime — shared frame history, a source on every temporal engine (v0.15)
- [x] Rutt-Etra Scan Processor — seven surfaces, phosphor decay, temporal slew (v0.15)
- [x] SDF field renderer — thirteen shapes, orbit camera, two-stop glow (v0.15)
- [x] Motion Extraction — a matte of what moves, into the keyer's own key source (v0.16)
- [x] RGB Channel Delay — per-channel time offset over the existing delay ring (v0.16)

Still open:

- [ ] Hypercube instancer texture switching (live source change without reset)
- [ ] Performance profiling / GPU display
- [ ] Multi-quad projection mapping (independent sources per quad)
- [ ] Multi-cam workflow (per-layer camera selector)
- [ ] iPad soak test of the dual-deck engine and the 8-tab bar on real hardware

See [CHANGELOG.md](CHANGELOG.md) for the full history and
`docs/imweb-obsidian.md` for per-phase detail.

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
