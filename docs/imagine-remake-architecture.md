# Image/ine Remake — Technical Architecture Specification
**Project codename:** `ImWeb`
**Version:** 0.9.0 — Active Development
**Date:** 2026-06-16
**Author:** Haraldur Karlsson
**Based on:** ImOs9 (STEIM, 1997) + ImX (Tom Demeyer and Steina Vasulka, 2008)

---

## 1. Project Philosophy

This is not a port. It is a **reimagining** of Image/ine's ideas — real-time layered video synthesis as a performance instrument — rebuilt on modern web infrastructure with additions that Tom never got to:

1. **3D objects and model import** as first-class input sources, composited into the 2D pipeline
2. **All lost ImOs9 features** that never made it into ImX
3. **A redesigned UX** that retains the performance-first philosophy but is legible to new users
4. **AI integration** as a generative and analytical layer on top of the performance system

The core aesthetic principle from the originals stays intact: **the interface is also the performance**. No edit/performance split. Everything visible, everything controllable, everything live.

---

## 2. Platform Decision

**Target: Web App, Chrome-first**

| Concern | Solution |
|---|---|
| Live video input | `getUserMedia()` + WebRTC |
| 3D rendering + effects | **WebGL** + Three.js r160+ (WebGLRenderTarget ping-pong) |
| MIDI | Web MIDI API (Chrome only) |
| OSC | WebSocket bridge (local Node process) |
| Audio analysis | Web Audio API `AnalyserNode` |
| File loading | File API (drag-and-drop, file picker) |
| Model import | Three.js loaders: GLTFLoader (Draco), OBJLoader, STLLoader |
| Persistence | IndexedDB direct (presets, states, tables, clips); localStorage (AI config, settings) |
| Distribution | Hosted at imweb.image-ine.org; installable as PWA |

**Shaders:** All pixel-level effects are **GLSL fragment shaders** running on WebGL render targets. There is no WebGPU usage — the full pipeline runs on WebGL 2.

**OSC bridge note:** `OSCBridge.js` (Node/WebSocket) bridges UDP OSC ↔ WebSocket. Users run it locally if they need OSC. For MIDI-only setups no companion process is needed.

---

## 3. Signal Path Architecture

```
INPUT SOURCES
─────────────────────────────────────────────────────────────
Camera (WebRTC)    Movies/clips (×8)    Stills Buffer (8×8)
Analog TV/CRT      Sequencer ×3         SDF Raymarcher
3D Scene           GPU Particles        Vectorscope
Draw Layer         Text Layer           Noise (multiple types)
Color (HSV)        Video Delay Line     Teletext

          ↓              ↓              ↓
    ┌─────────────────────────────────────┐
    │         LAYER ASSIGNMENT            │
    │  Foreground │ Background │ DispSrc  │
    └─────────────────────────────────────┘
          ↓
    ┌─────────────────────────────────────┐
    │         EFFECTS CHAIN               │
    │  TransferMode → Displacement →      │
    │  WarpMap → Keyer → Blend →          │
    │  ColorShift → LUT → Interlace →     │
    │  Mirror → Bloom → Vignette →        │
    │  FilmGrain → PixelSort → Fade       │
    └─────────────────────────────────────┘
          ↓
    ┌─────────────────────────────────────┐
    │         OUTPUT                      │
    │  Canvas → fullscreen / second       │
    │  monitor / WebM record / PNG        │
    └─────────────────────────────────────┘
```

All pixel operations run on the GPU via GLSL fragment shaders and Three.js WebGLRenderTargets in a ping-pong compositing chain.

---

## 4. Technology Stack

### Rendering Core
- **Three.js r160+** — scene graph, 3D model loading, WebGLRenderTarget ping-pong
- **WebGL 2** — all GPU compositing and effects
- **GLSL fragment shaders** — all pixel-level effects (keying, displacement, warp, feedback, TransferMode, colorshift, interlace, noise, bloom, kaleidoscope, film grain, pixel sort, etc.) — all in `src/shaders/index.js`
- **WebRTC** — live camera → Three.js `VideoTexture`
- **Web Audio API** — `AnalyserNode` → FFT/VU data → parameter controllers

### Control Layer
- **Web MIDI API** — MIDI CC/Note/PC/Clock input; MIDI output feedback (motorized faders); per-channel filter
- **WebSocket** — OSC bridge (UDP ↔ WS, `src/io/OSCBridge.js`)
- **Pointer Events API** — mouse + Wacom pressure/tilt
- **Gamepad API** — HID joystick/gamepad support
- **Web Audio `AnalyserNode`** — sound level + frequency bands + beat detection

### State & Persistence
- **IndexedDB direct** (no wrapper) — presets, states, tables, clip library, buffer snapshots
- **localStorage** — AI provider config, UI settings
- **File API** — project save/load as `.imweb` JSON; bank/state as `.imbank`/`.imstate`
- **BroadcastChannel API** — multi-window sync (second monitor support)

### UI
- **Vanilla JS + DOM** — no framework, no Web Components
- **CSS custom properties** — theming, dark performance UI (`src/style.css`)

### 3D / Model Import
- **Three.js GLTFLoader + DRACOLoader** — primary format (GLTF 2.0 / GLB)
- **Three.js OBJLoader** — OBJ support
- **Three.js STLLoader** — STL for fabrication/scan imports
- **Procedural geometry** — 13 built-in generators (see §5.5)

### AI Integration
- **Switchable provider system** — Anthropic, Google Gemini, OpenAI, Ollama (local), OpenRouter
- **API keys** — stored in localStorage, never committed

### Build & Distribution
- **Vite 5.4** — build tool, dev server with HMR
- **Service Worker** (`public/sw.js`) + **Web App Manifest** (`public/manifest.webmanifest`) — installable PWA
- **No bundled framework** — vanilla JS ES modules
- **Three.js** — via npm, tree-shaken

---

## 5. Feature Inventory — v0.9.0

### 5.1 Input Sources

| Source | ImOs9 | ImX | ImWeb | Notes |
|---|---|---|---|---|
| Live camera | ✓ | ✓ | ✓ | WebRTC, auto-start on load |
| Movie clips | ✓ | ✓ | ✓ | Up to 8; speed/loop/BPM sync/mirror/mute; thumbnails |
| Stills Buffer | ✓ | ✓ | ✓ | 8×8 grid = up to 64 frames; FrameSelect 1/2/3 |
| Text layer | ✓ | — | ✓ | **Restored.** Canvas2D text → texture |
| Draw layer | ✓ | — | ✓ | **Restored.** Freehand canvas → texture; Wacom pressure |
| Color (solid HSV) | ✓ | ✓ | ✓ | HSV solid fill |
| Output (feedback) | ✓ | ✓ | ✓ | Previous frame render target |
| Sound/Vectorscope | ✓ | — | ✓ | **Restored + extended.** Lissajous/Waveform/FFT display as source |
| Noise | ✓ | — | ✓ | **Restored + extended.** 14+ noise types across 6 families |
| 3D Scene | — | — | ✓ | **New.** Three.js scene → render target |
| FrameSelect 1/2/3 | ✓ | — | ✓ | **Restored.** Three independent frame selectors (0–63) |
| Slit scan buffer | ✓ | — | ✓ | **Restored.** Rolling slit scan (`SlitScanBuffer.js`) |
| Sequencer ×3 | — | — | ✓ | **New.** Record/loop any source; 4–480 frames |
| SDF Raymarcher | — | — | ✓ | **New.** GPU-raymarched metaballs → render target |
| GPU Particles | — | — | ✓ | **New.** GPU particle field, force fields |
| Analog TV/CRT | — | — | ✓ | **New.** Phase 1 CRT signal simulator (720×480) |
| Teletext | — | — | ✓ | **New.** Teletext input source → render target |
| Video Delay Line | — | — | ✓ | **New.** Frame delay buffer |

### 5.2 Three-Layer Compositing System

**Foreground** — top compositing layer; keying source; displacement target  
**Background** — layer keyed against; shows through foreground transparency  
**DisplaceSrc** — displacement map source; doubles as 2nd background with ExtKey active

Each layer accepts any input source. Assignment via the signal path UI and keyboard shortcuts.

### 5.3 Stills Buffer System

- **Grid:** rows × cols, each 1–8, giving up to 8×8 = **64 frames**
- **Frame dimensions:** output resolution (configurable)
- **FrameSelect 1/2/3:** Three independent frame selectors, each with range 0–63, each assignable to any controller
- **Zone protection:** Right-click buffer slot → protect/unprotect from capture overwrite
- **Pan/Scale:** PanX, PanY, Scale — full range, independently mappable
- **Capture sources:** Live camera, movie, screen — independently triggerable
- **Buffer → movie:** Frame sequence export as WebM

### 5.4 Noise Sources

14+ noise implementations across 6 families in `src/shaders/index.js`:

| Family | Types |
|---|---|
| Gradient | Value Noise, Perlin Noise, Simplex Noise |
| Cellular | Worley Noise |
| Fractal | fBm (basis-selectable) |
| Warp | Curl Noise, PsrdWarp |
| Periodic | psrdnoise2 |
| Analog | White, Blue, VCR, Flow, Ridge, Billow |

### 5.5 3D Scene (§ SceneManager.js)

Renders into a WebGLRenderTarget, flows into the compositing pipeline like any other source.

**Geometry generators (13):** Sphere, Torus, Cube, Plane, Cylinder, Capsule, TorusKnot, Cone, Dodecahedron, Icosahedron, Octahedron, Tetrahedron, Ring

**Model import:** GLTF/GLB (Draco), OBJ, STL

**Mappable parameters:** rotation X/Y/Z, position X/Y/Z, scale, camera FOV/position/rotation, light intensity/color/position, material roughness/metalness/emissive/opacity/hue/sat, wireframe toggle, UV offset/tiling

**Hypercube engine (4D–12D):** N-dimensional vertex/edge generation; edge, face, and InstancedMesh rendering modes; real-time pipeline texture on instancer geometry

**3D as DisplaceSrc:** Depth or normal pass fed into displacement creates geometry-driven image distortion.

### 5.6 SDF Raymarcher (§ SDFGenerator.js)

GPU-raymarched metaballs routable as a pipeline source:
- Sphere/Box/Torus shapes
- KIFS fractal folding
- Camera navigation
- Domain repetition
- Surface displacement
- Luma warp
- Triplanar video texturing
- AO + glow
- HSV colour
- Glass refraction + Fresnel
- Dedicated texSrc/refractSrc routing

### 5.7 GPU Particle System (§ particles/)

GPU-accelerated particle field:
- `ParticleGPU.js` — simulation on GPU
- `ForceField.js` — attractors/repulsors
- `ForceFormulas.js` — force calculation library
- `GhostNodes.js` — ghost node effects
- `VideoAnalysis.js` — video-reactive particle input

---

## 6. Effects Chain

All effects are GLSL fragment shader passes applied to WebGLRenderTargets in sequence.

### Keying
- **Luminance keyer** — KeyLevelWhite, KeyLevelBlack, KeySoftness
- **Chroma keyer** — HSV hue-based, range + softness (colour picker UI)
- **ExtKey** — 3-layer external keying (FG cuts between BG and DispSrc)

### Displacement
- **Displace** — strength, uses DispSrc luminance to shift FG pixels
- **DisplaceAngle** — angle of displacement
- **DisplaceOffset** — offset the displacement values
- **RotateGrey** — **Restored.** Circular displacement: white = −180°, black = +180°

### WarpMap
- Procedural generators (8 maps: H-Wave, V-Wave, Radial, Spiral, Shear, Pinch, Turbulence, Rings)
- Interactive WarpMap brush editor (`WarpMapEditor.js`)
- 16 storable WarpMap slots (IndexedDB)

### Compositing
- **TransferMode** — 22 blend modes: Copy, XOR, OR, AND, Multiply, Screen, Add, Difference, Exclude, Overlay, Hardlight, Softlight, Dodge, Burn, Subtract, Divide, PinLight, VividLight, Hue, Saturation, Color, Luminosity
- **Blend** — frame persistence / motion blur
- **Feedback** — HorFeedbackOffs, VerFeedbackOffs, FeedbackScale, FeedbackRotate, FeedbackZoom
- **ColorShift** — **Restored.** Global phase shift of color values
- **Fade** — global fade in/out, automatable

### Color & Grading
- **3D LUT** — `.cube` file import, full pipeline colour grading
- **Levels correction** — input/output black-white point

### Spatial & Temporal
- **Mirror / Quad mirror** — horizontal flip variants
- **Kaleidoscope** — symmetry fold
- **Interlace** — **Restored.** Scan line skip
- **Video delay line** — frame delay buffer (routable as source)
- **Stroboscope** — frame rate division effect
- **Pixel sort** — luminance-sorted pixel displacement
- **Slit scan** — rolling temporal slit effect

### Atmosphere
- **Bloom** — luminance-threshold glow
- **Vignette** — edge darkening
- **Film grain** — per-frame noise overlay
- **Scanlines** — CRT scanline overlay

---

## 7. Control System

### 7.1 Controller Types

| Controller | ImOs9 | ImX | ImWeb |
|---|---|---|---|
| MIDI CC | ✓ | ✓ | ✓ |
| MIDI Note | ✓ | ✓ | ✓ |
| MIDI Pitch Bend | ✓ | ✓ | ✓ |
| MIDI Pressure / Aftertouch | ✓ | ✓ | ✓ |
| MIDI Program Change | ✓ | ✓ | ✓ |
| MIDI Clock sync (BPM) | — | ✓ | ✓ |
| MIDI output feedback | — | — | ✓ |
| LFO (6 shapes) | ✓ | ✓ | ✓ |
| Mouse X/Y | ✓ | ✓ | ✓ |
| Sound level (bass/mid/high) | ✓ | ✓ | ✓ |
| Beat detection / auto-BPM | — | — | ✓ |
| Wacom pressure/tilt | ✓ | ✓ | ✓ |
| Key (keyboard trigger) | ✓ | ✓ | ✓ |
| Fixed value | ✓ | ✓ | ✓ |
| Random | ✓ | ✓ | ✓ |
| Expression (math formula) | — | — | ✓ |
| OSC | — | ✓ | ✓ |
| Gamepad | — | ✓ | ✓ |
| Tables (response curves) | ✓ | — | ✓ |
| External Mapping (controller-of-controller) | ✓ | — | ✓ |
| Parameter lock | — | — | ✓ |
| Slew / lag smoothing | — | — | ✓ |

### 7.2 LFO Details

6 waveform shapes: **Sine, Triangle, Sawtooth, Ramp Down, Square** (pulse width settable), **S&H** (sample & hold)

- BPM sync + beat retrigger
- Phase offset settable
- Frequency: 0–50 Hz (type-in for very low values)
- Negative frequency inverts waveform
- LFOs retrigger on State recall
- LFO-of-LFO via External Mapping (FM-style control chains)
- LFO visualiser in controller popover

### 7.3 Tables (Response Curves)

16,384-entry response curve editor (`src/state/TableManager.js`):
- Spline editor with draggable control points, live curve preview
- Freehand drawing on curve canvas
- Named tables, stored in IndexedDB, referenceable across presets
- Any parameter can route through a table

### 7.4 External Mapping (Controller Modulation)

Secondary mapping layer where controllers modulate other controllers' parameters. Enables FM-style control chains: LFO Hz modulated by another LFO, velocity-sensitive displacement amounts, etc.

### 7.5 MIDI

- CC input with per-channel filter
- Note input → clip library recall (MIDI note → slot index)
- Program Change → preset recall
- Clock sync → derive BPM from 0xF8 pulses
- MIDI output → feedback for motorized faders

---

## 8. Text Layer

Text as a full compositing input source, rendered via Canvas2D → WebGL texture, participating in displacement, keying, and warp like any video source.

Scripting language (ImOs9 compatible):
```
{pos 0}          Screen position (0=TL, 1=TR, 2=BL, 3=BR)
{font helvetica} Font family
{size 255}       Font size (0–255)
{fcolor r,g,b}   Foreground color
{bcolor r,g,b}   Background color
{clear}          Clear text layer
```

TextAdvance and TextSize parameters are fully mappable (LFO, MIDI, key, sound).

---

## 9. Automation & Sequencing

- **Automation recorder** — record parameter movements, loop playback (`src/controls/Automation.js`)
- **Step sequencer** — rhythmic preset recall; configurable step count and rate (`src/controls/StepSequencer.js`)
- **Preset morph** — smooth crossfade between two preset states
- **Sequencer buffers ×3** — record and loop any source; 4–480 frames per buffer (`src/inputs/SequenceBuffer.js`)
- **BPM tap tempo** + beat detection (`src/controls/BeatDetector.js`)

---

## 10. AI Integration

Multi-provider AI system (`src/ai/AIFeatures.js`):

| Provider | Mode |
|---|---|
| Anthropic (Claude) | Cloud API |
| Google Gemini | Cloud API |
| OpenAI | Cloud API |
| Ollama | Local (no API key) |
| OpenRouter | Cloud API (multi-model) |

**AI State Generator** — LLM-driven parameter patching ("make a slow organic ocean")  
**AI Narrator** — periodic AI description of current parameter state, shown as canvas overlay  
**AI Coach** — periodic AI-generated performance suggestions  
**AI Settings panel** — live model lists, connection status, configurable interval & response length  
API keys stored in localStorage, never transmitted anywhere except the chosen provider.

---

## 11. Clip Library

128-slot video clip library (`src/io/ClipLibrary.js`):
- 8 banks × 16 slots
- MIDI note mapping (note-on → slot recall)
- Stored in IndexedDB

---

## 12. Project / Bank / State

### Banks
Named groups of States. Created dynamically, no hard cap.  
Navigation: `NumPad +/-`, MIDI Program Change, OSC.

### States
Snapshots of all current parameter **values**.
- **Unlimited per Bank** — dynamically allocated, no cap
- Store: click state dot, `Shift+S` (quick-save), or MIDI PC
- Recall: click dot, digits `0–9`, MIDI note, OSC `/imweb/state/<n>`
- All LFOs retrigger on State recall
- Thumbnail grid in bottom bar

### Neutral State
Resets all parameter values without touching controller assignments.

### Export formats
- `.imweb` — full project (Banks, States, tables, warp maps, scene refs, mapping data)
- `.imbank` — single bank
- `.imstate` — single state

---

## 13. Output

- **Fullscreen** — `Cmd+F` or double-click canvas
- **Second monitor** — borderless popup window; `ImageBitmap` via `postMessage` (zero-latency); letterbox scaling
- **Ghost mode** — dims main canvas when second screen active
- **Output resolution** — Display / 720p / 1080p / 540p / Quarter
- **WebM recording** — `MediaRecorder` API
- **Non-realtime frame capture** — pauses render loop; Step Frame / Auto-Run exports numbered PNG sequence
- **Projection mapping** — CSS homography corner-pin on second screen; calibration grid (`G`); corner nudge (arrow keys)

---

## 14. UI Architecture

### Philosophy
Performance-first. Every value visible. No mode switch.

### Layout

```
┌─────────────────────────────────────────────────────────┐
│  STATUS BAR: fps · preset name · state · VU · MIDI in   │
├────────────────────┬────────────────────────────────────┤
│                    │                                    │
│   OUTPUT CANVAS    │   CONTROL PANELS (tabbed)          │
│   (main preview)   │   · Sources / Layers               │
│                    │   · Effects chain                  │
│                    │   · Controllers                    │
│                    │   · 3D Scene / Hypercube           │
│                    │   · Sequencers                     │
│                    │   · Tables                         │
│                    │   · Project / AI                   │
│                    │   · Clip Library                   │
├────────────────────┴────────────────────────────────────┤
│  SIGNAL PATH DISPLAY (float or dock)                    │
│  [src] → [keyer] → [displace] → [warp] → [blend] →[out]│
├─────────────────────────────────────────────────────────┤
│  STATE DOTS ● ● ○ ○ ● ○ ○ ● ○ ○ ○ ● ○ ○ ○ ○           │
└─────────────────────────────────────────────────────────┘
```

**Fullscreen mode:** `Cmd+F` → canvas fills window. Second monitor receives output via `postMessage`.

### Visual Design
Dark. Dense. Instrument-like. CSS variables for theming (`--bg-1` through `--bg-4`, `--accent`, `--text-1`/`--text-2`).

### Parameter Row Pattern
```
[label]  [ctrlBadge]  [minField]  [maxField]  [valueDisplay]
```
Right-click badge → controller popover. Drag min/max fields to resize range. Double-click to type.

---

## 15. Project File Format

`.imweb` — JSON file containing:

```json
{
  "version": "1.0",
  "metadata": { "title": "", "created": "", "modified": "" },
  "presets": [ ... ],
  "tables": [ ... ],
  "scene3d": { ... },
  "mapping": {
    "active": false,
    "quads": [
      {
        "id": 0,
        "corners": { "tl": [0,0], "tr": [1,0], "bl": [0,1], "br": [1,1] },
        "source": "output"
      }
    ]
  }
}
```

Asset data (stills, models) referenced by content hash; stored in IndexedDB separately.  
Corner points are per-project (physical projection setup doesn't change between presets).

**Factory default:** `public/Projects/MasterProject.imweb` — auto-loaded on first launch when IndexedDB is empty. Saved via Project tab → "Save as MasterProject [DEV]".

---

## 16. Implementation Roadmap

### Phases 1–5 — Complete (v0.1–0.9)

| Phase | Scope | Status |
|---|---|---|
| 1 | Core WebGL engine, camera, keying, displacement, mouse/key controller, basic presets | ✓ |
| 2 | Full ImX feature parity — MIDI, LFO, Sound, Movie, Buffer, States, OSC, Expression, Gamepad | ✓ |
| 3 | Restored ImOs9 features — Noise, WarpMap, Draw, TransferMode, Tables, Text, ColorShift, Feedback, Interlace, Sequencers, second monitor, external mapping | ✓ |
| 4 | 3D integration — Three.js scene, 13 geometry types, GLTF/OBJ/STL import, Hypercube engine, material mapping, SDF raymarcher | ✓ |
| 5 | Public release polish — MasterProject, first-visit onboarding, AI system, Clip Library, Analog TV, Teletext, GPU particles, projection mapping, GLSL editor, extended effects (bloom, vignette, grain, pixel sort, stroboscope, levels, delay), Narrator/Coach | ✓ |

### Phase 6 — In Progress (v0.9+)

- [ ] Mobile-friendly UI — touch targets, responsive layout, swipe gestures
- [ ] GLSL editor fixes — resolve WebGL 1281/1282 on preset apply
- [ ] Hypercube instancer texture switching (live source change without reset)
- [ ] Performance profiling / GPU usage display
- [ ] Multi-quad projection mapping (independent sources per quad)
- [ ] Multi-cam workflow (per-layer camera selector)

---

## 17. Key Design Decisions & Rationale

**Why WebGL instead of WebGPU?**
WebGPU support was incomplete across browsers when the rendering pipeline was built. WebGL 2 covers all required use cases (ping-pong render targets, GLSL fragment shaders, multi-pass compositing) with universal support. WebGPU remains a candidate for a future compute-heavy pass (e.g. particle physics) but is not currently used.

**Why restore Tables?**
A linear slider controlling a parameter linearly is a blunt instrument. A table-routed slider controlling an exponential zoom is a performance gesture. Tables are what separate a sequencer from a synthesizer.

**Why restore External Mapping?**
LFO frequency modulated by another LFO is FM synthesis applied to visual control. This is where ImOs9 became genuinely generative rather than just effects-driven.

**Why restore Sound → DisplaceSrc?**
Audio feeding the spatial displacement pipeline creates a live, reactive coupling between sound and image structure that is fundamentally different from audio-reactive parameter control. This is sonification in reverse.

**Why unlimited States per Bank?**
The original 64-state cap was an implementation constraint, not a design decision. Removing it costs nothing and gains compositional freedom during long performance sessions.

---

*Specification updated to v0.9.0 — 2026-06-16*
*Phases 1–5 complete. Phase 6 in progress. ~200+ parameters implemented.*
