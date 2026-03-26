# ImWeb — Full Operation Manual

> **Version:** 0.3.0
> **Platform:** Browser (Chrome 113+ recommended)
> **Original concept:** Image/ine — Tom Demeyer, STEIM Amsterdam 1997/2008
> **ImWeb:** H. Karlsson

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Interface Layout](#3-interface-layout)
4. [Input Sources](#4-input-sources)
5. [Signal Path & Effects](#5-signal-path--effects)
6. [Controller Mapping System](#6-controller-mapping-system)
7. [Preset & State Management](#7-preset--state-management)
8. [Output & Recording](#8-output--recording)
9. [Advanced Features](#9-advanced-features)
10. [Keyboard Shortcuts Reference](#10-keyboard-shortcuts-reference)
11. [File Formats](#11-file-formats)
12. [Performance & Troubleshooting](#12-performance--troubleshooting)

---

## 1. Overview

ImWeb is a real-time browser-based video synthesis instrument. It composites multiple video sources through a signal chain of effects and renders to a WebGL canvas. Every visual parameter is mappable to a controller — MIDI, LFO, audio, mouse, keyboard, gamepad, or mathematical expression.

The signal chain flows: **Input Sources → Compositing → Keyer → Displacement → Effects → Output**.

All parameters are stored in a unified reactive system. Changes propagate immediately through the rendering pipeline without any compile or reload step.

---

## 2. Getting Started

### Running the app

```bash
npm install
npm run dev     # dev server at localhost:5173
npm run build   # production build
```

Open Chrome at `localhost:5173`. On first load:

- Camera is activated automatically
- FG and BG layers both show camera
- DS (displacement source) defaults to noise
- All effect sections are collapsed
- BPM is set to 120

### First steps

1. The output canvas fills the centre of the screen
2. Open the **Mapping** tab to see all parameters
3. Right-click any parameter row to assign a controller
4. Press `?` for the keyboard shortcut overlay
5. Press `/` to search for any parameter by name

---

## 3. Interface Layout

### Status Bar (top)

| Element | Function |
|---------|----------|
| App name | "ImWeb" — click for version info |
| FPS / CPU / VRAM | Live performance monitor |
| Preset indicator | Current preset number (0–127) |
| State indicator | Current Display State (0–9) |
| BPM display | Current tempo; click = tap tempo, right-click = toggle MIDI clock sync |
| MIDI dot | Flashes on incoming CC/Note |
| OSC dot | WebSocket OSC bridge status |
| VU meter | Audio level bars (bass / mid / high / overall) |

### Status Bar Buttons (right side)

| Button | Key | Function |
|--------|-----|----------|
| ↺ | — | Reset all parameters to defaults |
| ⊟ / ⊞ | — | Collapse / expand all sections |
| ┄ | Shift+P | Float / dock the signal path display |
| FIT | — | Fit canvas to window (responsive) |
| FAST | — | 960×540 rendering |
| MED | — | 1280×720 rendering |
| MAX | — | 1920×1080 rendering |
| LOW | — | Half-resolution (performance) |
| ⊡ | — | Open second monitor popup |
| ◫ | — | Ghost mode (dim main canvas) |
| ◧ | Shift+V | Toggle output spy (small preview) |
| ⛶ | Cmd+F | Fullscreen |
| ⏺ | — | Start/stop WebM recording |
| 𝔸 | N | AI Narrator |
| ⬡ | P | AI Coach (30s suggestions) |
| ⚙ | — | AI API key settings |

### Tabs

| Tab | Contents |
|-----|----------|
| **Mapping** | All parameter rows, organised by section |
| **Buffer** | Stills buffer capture grid and controls |
| **Draw** | Freehand canvas and brush controls |
| **Text** | Text layer content and formatting |
| **3D** | 3D scene, geometry, import, material, camera |
| **Clips** | Movie clip library and playback controls |
| **Presets** | Preset/state list, save/load, automation, step sequencer |
| **Tables** | Response curve editor |
| **GLSL** | Live shader code editor |

### Signal Path Display

Located at the bottom (docked) or floating. Shows the live routing: **FG → BG → DS → TransferMode → Displacement → WarpMap → Keyer → Blend → ColorShift → FX Chain → LUT → Interlace → Fade → Output**. Effects in the FX chain can be dragged to reorder.

### Parameter Rows

Each row shows:
- **Parameter name** (left)
- **Value display** (centre — drag to change)
- **Controller label** (right — shows assigned controller type)

Drag left/right on the value area to change continuous parameters. Click SELECT rows to cycle options.

> [!tip]
> Right-click any parameter row to open the controller assignment menu.

---

## 4. Input Sources

### 4.1 Camera

Live WebRTC camera input.

**Activation:** Toggle with `V` or the camera toggle in the Layers section.
**Auto-start:** Camera activates on app load by default.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `camera.active` | TOGGLE | — | On/off |
| `camera.device` | SELECT | auto | Choose camera device |

The device list is enumerated at startup. Resolution requests 1280×720 ideal, adapts to device capabilities.

---

### 4.2 Movie Clips

Load and play up to 8 independent video files.

**Loading:** Drag `.mp4 / .webm / .mov` onto the canvas, or use the **Clips** tab "Add Clip" button.
**Selection:** Click a clip card, or press `Shift+1` through `Shift+8`.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `movie.active` | TOGGLE | Enable playback |
| `movie.speed` | −1 – 3 | Playback speed; negative = reverse; 0 = pause |
| `movie.pos` | 0–100% | Direct scrub (active only when a controller is assigned) |
| `movie.start` | 0–100% | Loop range start |
| `movie.loop` | 0–100% | Loop range end |
| `movie.mirror` | TOGGLE | Horizontal flip |
| `movie.bpmsync` | TOGGLE | Lock playback to global BPM |
| `movie.bpmbeats` | SELECT | ½ / 1 / 2 / 4 / 8 / 16 beats per loop |

Each clip maintains its own playback state. Thumbnails (160×90) are captured at 10% of the clip duration to avoid black frames.

---

### 4.3 Stills Buffer

Capture and hold up to 16 still frames for compositing.

**Capture:** Press `C`, or use the Buffer tab controls.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `buffer.source` | SELECT | Source to capture from |
| `buffer.fs1` | 0–15 | Primary frame slot |
| `buffer.fs2` | 0–15 | Secondary frame slot |
| `buffer.frameblend` | 0–100% | Crossfade between fs1 and fs2 |
| `buffer.fs3` | 0–15 | Tertiary slot |
| `buffer.scan` | 0–100% | Scan position through frames |
| `buffer.scanrate` | 0.5–60 fps | Scan speed |
| `buffer.scandir` | SELECT | Forward / backward |
| `buffer.panX / panY` | 0–100% | Pan within frame |
| `buffer.scale` | 0.1–3 | Scale within frame |
| `buffer.auto` | TOGGLE | Auto-capture on interval |
| `buffer.rate` | 0.5–60 fps | Auto-capture rate |
| `buffer.capture` | TRIGGER | Capture to next slot |

Slots can be individually **protected** (lock icon in Buffer tab) to prevent auto-overwrite. Frame count can be set to 4 / 8 / 16 / 32 slots.

---

### 4.4 Color Source

Solid colour or gradient texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `color1.hue` | 0–360° | Primary colour hue |
| `color1.sat` | 0–100% | Saturation |
| `color1.val` | 0–100% | Brightness |
| `color2.hue / sat / val` | — | Secondary colour |
| `color2.type` | SELECT | 0=Solid / 1=H-gradient / 2=V-gradient / 3=Radial |
| `color2.speed` | −5 – 5 | Animate hue over time (hue/sec) |

Click the colour swatch in the UI to open a quick colour picker.

---

### 4.5 Noise (BFG Fractal Noise)

Resolution-independent GPU noise field, regenerated each frame.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `noise.type` | SELECT | 0=Perlin / 1=Voronoi / 2=Worley / 3=Simplex |
| `noise.scale` | 0.1–20 | Zoom (higher = smaller features) |
| `noise.octaves` | 1–8 | Layering depth |
| `noise.lacunarity` | 1–4 | Frequency multiplier per octave |
| `noise.gain` | 0.1–1 | Amplitude decay per octave |
| `noise.speed` | −5 – 5 | Time animation rate |
| `noise.offsetX / Y` | −10 – 10 | Pan the noise field |
| `noise.contrast` | 0.1–5 | Contrast adjustment |
| `noise.invert` | TOGGLE | Invert black/white |
| `noise.seed` | 0–100 | Pattern seed |
| `noise.color` | TOGGLE | RGB vs grayscale output |

Rendered to a 512×512 GPU texture. Smooth animation when speed ≠ 0.

---

### 4.6 3D Scene

Full Three.js 3D scene rendered to a WebGL render target.

#### Built-in geometries

Sphere, Cube, Torus, Icosahedron, Cone, Pyramid, Plane, Ring, Octahedron, Dodecahedron, Tetrahedron

#### Importing models

Drop `.glb / .gltf / .obj / .stl / .dae` onto the canvas, or use the **3D tab** import button. Models auto-fit to a 2×2×2 bounding box on load.

#### Parameters — Transform

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.active` | TOGGLE | Include in render |
| `scene3d.geo` | SELECT | Built-in geometry |
| `scene3d.rot.x/y/z` | 0–360° | Static rotation |
| `scene3d.spin.x/y/z` | 0–360°/sec | Auto-rotation speed |
| `scene3d.pos.x/y/z` | −10 – 10 | Position offset |
| `scene3d.scale` | 0.1–10 | Scale |
| `scene3d.wireframe` | TOGGLE | Wireframe render |

#### Parameters — Camera

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.cam.fov` | 20–120° | Field of view |
| `scene3d.cam.x/y/z` | −10 – 10 | Camera position |

#### Parameters — Material

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.mat.hue` | 0–360° | Base colour hue |
| `scene3d.mat.sat` | 0–100% | Saturation (0 = white) |
| `scene3d.mat.roughness` | 0–1 | Surface roughness |
| `scene3d.mat.metalness` | 0–1 | Metallic quality |
| `scene3d.mat.emissive` | 0–1 | Self-illumination |
| `scene3d.mat.opacity` | 0–1 | Transparency |
| `scene3d.mat.texsrc` | SELECT | Live texture source (None / Camera / Movie / Screen / Draw / Buffer / Noise) |

Default material is **white** (hue=0, sat=0). Cranking up saturation enables coloured materials.

#### Parameters — Depth Pass

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.depth.active` | TOGGLE | Render depth map to DisplaceSrc |
| `scene3d.depth.mode` | SELECT | 0=Depth / 1=Normals |

#### Parameters — Lighting

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.light.intensity` | 0–2 | Directional light strength |

Scene has three lights: ambient (0.4 intensity), directional (white, 1.0), point (blue-tinted, 0.6).

---

### 4.7 Slit Scan Buffer

Classic slit-scan effect: reads a thin strip of pixels each frame and accumulates over time.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `slitscan.active` | TOGGLE | Enable |
| `slitscan.pos` | 0–100% | Slit position in source |
| `slitscan.speed` | 0.5–60 fps | Advance rate |
| `slitscan.axis` | SELECT | Vertical / Horizontal / Centre-V / Centre-H |
| `slitscan.width` | 1–16 px | Strip width per tick |
| `slitscan.clear` | TRIGGER | Zero the buffer |

---

### 4.8 Draw Layer

Freehand canvas drawing that becomes a live texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `draw.pensize` | 1–50 px | Brush size |
| `draw.erasesize` | 1–50 px | Eraser size |
| `draw.x / y` | 0–100% | Brush position (for controller mapping) |
| `draw.color.h/s/v` | — | HSV brush colour |
| `draw.opacity` | 0–100% | Brush opacity |
| `draw.fade` | 0–100% | Canvas fade-out over time |
| `draw.clear` | TRIGGER | Clear canvas |

Canvas is 1024×1024 and persists across frames. Map `draw.x` and `draw.y` to mouse for interactive drawing.

---

### 4.9 Text Layer

Renders live text to a 512×512 canvas texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `text.size` | 8–512 px | Font size |
| `text.x / y` | 0–100% | Position |
| `text.hue / sat / opacity` | — | Text colour and transparency |
| `text.align` | SELECT | Centre / Left / Right |
| `text.font` | SELECT | Sans / Serif / Mono / Bold / Italic |
| `text.outline` | 0–10 px | Stroke width |
| `text.spacing` | 0.5–3 | Line height |
| `text.mode` | SELECT | All / Char / Word / Line |
| `text.bg` | TOGGLE | Black background |
| `text.advance` | TRIGGER | Step to next character / word / line |

Enter text content in the Text tab textarea. Assign `text.advance` to a key or MIDI note for live text performance.

---

### 4.10 Particle System

GPU particle field rendered to a 512×512 texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `particle.count` | 100–10000 | Number of particles |
| `particle.speed` | 0–5 | Velocity magnitude |
| `particle.life` | 0.1–10 sec | Lifespan before respawn |
| `particle.gravity` | −5 – 5 | Gravity (negative = upward) |
| `particle.wind` | −5 – 5 | Horizontal drift |
| `particle.size` | 1–50 px | Particle point size |
| `particle.color` | 0–360° | Hue |

Particles respawn at random positions when life expires.

---

### 4.11 Sequencer Buffers (×3)

Record any source to a rolling frame buffer and loop it.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `seq1.active` | TOGGLE | Record / play |
| `seq1.frames` | SELECT | 4 / 8 / 16 / 32 / 64 / 120 / 240 / 480 frames |
| `seq1.source` | SELECT | Source to record |
| `seq1.rate` | 1–60 fps | Record/playback rate |

Three independent sequencers (seq1, seq2, seq3). Each frame is a full-resolution render target; large frame counts consume significant VRAM.

---

### 4.12 Vectorscope (Audio Visualiser)

Real-time audio visualisation as a source texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `vectorscope.mode` | SELECT | Lissajous / Waveform / FFT |
| `vectorscope.gain` | 0.1–5 | Amplitude scaling |
| `vectorscope.decay` | 0–1 sec | Trail decay |
| `vectorscope.color` | 0–360° | Display hue |

---

## 5. Signal Path & Effects

### 5.1 Signal Path Order

```
FG Source → FG Colour Correction
BG Source → BG Colour Correction
DS Source
          ↓
     TransferMode (FG + BG composite)
          ↓
     Displacement (DS as offset map)
          ↓
     WarpMap (UV distortion)
          ↓
     Keyer (luma + chroma alpha)
          ↓
     Blend (motion persistence / feedback)
          ↓
     ColorShift (hue rotation)
          ↓
     Post-FX Chain (reorderable):
       Kaleidoscope → Levels → QuadMirror → Pixelate →
       Edge → RGBShift → Posterize → Solarize →
       Film Grain → Bloom → Vignette → WhiteBal →
       PixelSort → Video Delay
          ↓
     LUT (3D colour grade)
          ↓
     Interlace
          ↓
     Fade
          ↓
     Output Canvas
```

### 5.2 Layer Routing

Three routing layers feed the pipeline:

| Layer | Parameter | Description |
|-------|-----------|-------------|
| **FG** | `layer.fg` | Foreground source |
| **BG** | `layer.bg` | Background source |
| **DS** | `layer.ds` | Displacement source (grayscale) |

Source options for each layer: Camera / Movie / Screen / Draw / Noise / Color / Buffer / 3D / SlitScan / Particles / Sequencer 1–3 / Text / Vectorscope

### 5.3 Per-Layer Colour Correction

Applied to FG and BG independently before compositing.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `fg.hue` | 0–360° | Hue shift |
| `fg.sat` | 0–100% | Saturation (0 = greyscale) |
| `fg.bright` | 0–100% | Brightness |
| `fg.opacity` | 0–100% | Opacity |

(Same parameters exist for `bg.*`)

### 5.4 TransferMode

Composite FG and BG using math operations.

| Mode | Description |
|------|-------------|
| Copy | FG replaces BG directly |
| XOR | Bitwise XOR of RGB channels |
| OR | Bitwise OR |
| AND | Bitwise AND |

---

### 5.5 Displacement

Warp the image using the DS layer as an offset map.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `displace.amount` | 0–100% | Overall strength |
| `displace.angle` | 0–360° | Direction of displacement vector |
| `displace.offset` | 0–100% | Global offset (all pixels shifted) |
| `displace.rotateg` | TOGGLE | Map grayscale value → angle |
| `displace.warp` | SELECT | Warp map slot (0=none, 1–9=procedural/custom) |
| `displace.warpamt` | 0–100% | Warp map strength |

---

### 5.6 WarpMap Editor

An interactive 128×128 displacement texture editor. Access via the Mapping tab WarpMap section.

**Grid:** 24 columns × 18 rows of control points.

**Tools:**

| Tool | Action |
|------|--------|
| PUSH | Drag to deform (Gaussian falloff) |
| SMOOTH | Average with neighbours (Laplacian blur) |
| ERASE | Restore towards zero displacement |

**Presets (algorithmic):** H-Wave, V-Wave, Radial, Pinch, Spiral, Shear, Random

**Save/Load:** Stored to browser localStorage. Slot 9 in the warp selector (Custom) outputs the editor's active texture.

Control point dots are colour-coded by displacement magnitude: displaced points glow cyan-to-warm; undisplaced points are dim.

---

### 5.7 Keyer

Alpha generation from image luminance or colour.

#### Luminance Keyer

| Parameter | Range | Description |
|-----------|-------|-------------|
| `keyer.active` | TOGGLE | Enable |
| `keyer.white` | 0–100% | Upper brightness threshold |
| `keyer.black` | 0–100% | Lower brightness threshold |
| `keyer.softness` | 0–100% | Alpha feathering |
| `keyer.extkey` | TOGGLE | Use DS layer as key instead of FG brightness |
| `keyer.alpha` | 0–1 | Alpha multiplier |
| `keyer.alpha_inv` | TOGGLE | Invert alpha |
| `keyer.and_displace` | TOGGLE | Key after displacement pass |

#### Chroma Keyer

| Parameter | Range | Description |
|-----------|-------|-------------|
| `keyer.chroma` | TOGGLE | Enable chroma key |
| `keyer.chromahue` | 0–360° | Target hue (e.g. 120° for green screen) |
| `keyer.chromarange` | 0–100% | Hue range tolerance |
| `keyer.chromasoft` | 0–100% | Edge softness |

Click the colour swatch in the Keyer section to pick the chroma hue visually.

---

### 5.8 Blend (Motion Persistence & Feedback)

Mix current frame with previous frames, with transform offset before blending.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `blend.active` | TOGGLE | Enable |
| `blend.amount` | 0–100% | Mix with previous frame |
| `feedback.hor` | 0–100% | Horizontal pan of previous frame |
| `feedback.ver` | 0–100% | Vertical pan |
| `feedback.scale` | 0–100% | Scale change (100% = 1.5×) |
| `feedback.rotate` | −180–180° | Rotation of previous frame |
| `feedback.zoom` | 0–100% | Zoom (for infinite zoom effects) |

At 100% blend with `feedback.zoom` > 0 and `feedback.rotate` > 0 you get infinite tunnel / spiral effects.

---

### 5.9 ColorShift

| Parameter | Range | Description |
|-----------|-------|-------------|
| `output.colorshift` | 0–100% | Hue rotation (0=none, 100=full 360° rotation) |

---

### 5.10 Post-FX Chain

The following effects run in sequence after the main composite. Their order can be changed by dragging nodes in the Signal Path display.

#### Kaleidoscope

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.kaleidoscope` | 0–1 | Intensity |
| `effect.kalerot` | 0–360° | Pattern rotation |

#### Levels

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.lvblack` | 0–100% | Black point (lift shadows) |
| `effect.lvwhite` | 0–100% | White point (crush highlights) |
| `effect.lvgamma` | 0–3 | Gamma curve |

#### Quad Mirror

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.quadmirror` | 0–1 | Strength |

#### Pixelate

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.pixelate` | 0–1 | Pixel block size as fraction of image |

#### Edge Detection

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.edge` | 0–1 | Strength |
| `effect.edge_inv` | TOGGLE | Invert (dark edges on light background) |

#### RGB Shift (Chromatic Aberration)

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.rgbshift` | 0–0.1 | Channel offset amount |
| `effect.rgbangle` | 0–360° | Angle of shift |

#### Posterize

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.posterize` | 0–1 | Colour quantisation level |

#### Solarize

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.solarize` | 0–1 | Tone inversion strength |

#### Film Grain & Scanlines

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.grain` | 0–1 | Noise intensity |
| `effect.scanlines` | 0–1 | Horizontal line intensity |

#### Bloom (Glow)

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.bloom` | 0–1 | Bloom strength |
| `effect.bloomthresh` | 0–1 | Brightness threshold |

#### Vignette

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.vignette` | 0–1 | Strength |
| `effect.vigradius` | 0.1–2 | Radius of vignette circle |

#### White Balance

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.wbtemp` | 2000–8000K | Colour temperature (warm ↔ cool) |
| `effect.wbtint` | −1 – 1 | Magenta ↔ green tint |

#### Pixel Sort

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.pixelsort` | 0–1 | Strength |
| `effect.psortlen` | 1–256 px | Sort segment length |
| `effect.psortthresh` | 0–1 | Pixel selection threshold |
| `effect.psortdir` | SELECT | Horizontal / Vertical |
| `effect.psortmode` | SELECT | Sort by Brightness / Hue / Saturation |

#### Video Delay Line

| Parameter | Range | Description |
|-----------|-------|-------------|
| `delay.frames` | 1–30 | Temporal delay in frames |

---

### 5.11 LUT (3D Lookup Table)

Apply professional colour grading using a `.cube` file.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.lutamount` | 0–100% | Blend with original (0=bypass) |

Load a LUT via the LUT section in the Mapping tab (standard `.cube` format, typically 32³ or 64³). Click "Clear LUT" to remove.

---

### 5.12 Interlace

| Parameter | Range | Description |
|-----------|-------|-------------|
| `output.interlace` | 0–1 | Scanline intensity |

Alternates odd/even scanlines for CRT-like effects.

---

### 5.13 Fade

| Parameter | Range | Description |
|-----------|-------|-------------|
| `output.fade` | 0–100% | Fade to black (100% = pure black) |

---

## 6. Controller Mapping System

### Assigning a Controller

**Right-click** any parameter row → select controller type from the context menu.

### Controller Types

#### Mouse

Maps mouse position over the output canvas.

| Type | Description |
|------|-------------|
| Mouse-X | Horizontal position (0=left, 1=right) |
| Mouse-Y | Vertical position (0=bottom, 1=top) |

Modifier keys can restrict activation: hold **CapsLock / Shift / Ctrl / Alt / Cmd**.

---

#### MIDI

| Type | Description |
|------|-------------|
| MIDI CC | CC 0–127 on any channel 1–16 |
| MIDI Note | Note on/off or velocity |
| MIDI PC | Program change → recall preset |

**MIDI Learn:** Right-click parameter → MIDI Learn → move a knob/fader on your controller → auto-assigned.

MIDI Clock Sync: Right-click the BPM indicator in the status bar to toggle. Derives tempo from 0xF8 clock messages (24 pulses per quarter note).

---

#### LFO

| Parameter | Range | Description |
|-----------|-------|-------------|
| Shape | Sine / Triangle / Sawtooth / Sawtooth↓ / Square / S&H | Waveform |
| Frequency | 0.01–20 Hz | Free-running rate |
| Phase | 0–1 | Phase offset |
| Pulse width | 0–1 | Duty cycle (square wave) |
| Mode | norm / shot / xmap | Free / one-shot / externally triggered |
| Beat sync | TOGGLE | Lock to global BPM |
| Beat div | ½/1/2/4/8/16 | Beats per LFO cycle |

When Beat sync is on, the LFO phase locks to the beat grid and retriggers on tap tempo.

---

#### Random

Generates a uniformly random value at a specified rate.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Frequency | 0.1–20 Hz | How often a new random value is picked |

---

#### Sound Level

Audio-reactive controllers from microphone input (requires browser permission on first use).

| Type | Description |
|------|-------------|
| Sound | Overall RMS amplitude |
| Sound-Bass | Energy in bass range (0–1 kHz) |
| Sound-Mid | Energy in mid range (1–6 kHz) |
| Sound-High | Energy in high range (6+ kHz) |

Updated at 60 Hz from the Web Audio API AnalyserNode. The VU meter in the status bar visualises all four bands.

---

#### Expression (Math Formula)

A JavaScript expression evaluated each frame. The variable `t` is time in seconds.

Available functions: `sin cos tan abs floor ceil round mod fract clamp mix pow sqrt noise`

**Examples:**

```
sin(t * 2) * 0.5 + 0.5        → sine wave between 0 and 1
fract(t * 0.5)                 → sawtooth, one cycle every 2 seconds
clamp(t * 0.1, 0, 1)          → linear ramp from 0→1 over 10 seconds
sin(t) * cos(t * 1.3) * 0.5 + 0.5   → Lissajous-like modulation
```

The expression output must fall within the parameter's min–max range. Compile errors are silently ignored.

---

#### Key (Keyboard)

Assign any key. Toggle parameters flip on key press. Trigger parameters fire once. Continuous parameters are 1 while held, 0 when released. Modifier combos supported.

---

#### Gamepad

| Type | Description |
|------|-------------|
| gamepad-axis-0/1/2/3 | Analogue sticks (LX/LY/RX/RY), normalised to 0–1 |
| gamepad-btn-0/1/2/3+ | Digital and analogue buttons |

---

#### Wacom / Stylus Pressure

Type `wacom-pressure`: stylus pressure 0–1 (only active for non-mouse pointer events).

---

#### Fixed Value

Set a parameter to a constant. Useful for pinning values during performance.

---

### Controller Options

After assigning, right-click the parameter again to access options:

| Option | Description |
|--------|-------------|
| **Invert** | Flip output: 1 − value |
| **Feedback** | Show live value overlay on output canvas |
| **Lock** | Disable controller input (freeze the value) |
| **Assign Table** | Apply a response curve (see Tables tab) |
| **Set Slew** | Add exponential lag (enter time in seconds) |

**Slew** adds smooth easing to a controller's output. For example, 0.5 sec slew on Sound makes audio reactivity feel organic rather than jittery.

---

### External Mapping (X-Map)

One controller can modulate parameters of another controller.

| X-Map Target | Description |
|--------------|-------------|
| hz | Modulate LFO frequency |
| amp | VCA-style amplitude scaling |
| value | Direct override of controller output |

| X-Map Source options | |
|----------------------|-|
| LFO (any shape) | Independent LFO for modulation |
| Sound / Bass / Mid / High | Audio-reactive |
| Mouse X / Y | Spatial |
| rand1 / rand2 / rand3 | Global random noise signals |

**Example:** Assign Sound-High as an X-Map to the frequency of a grain LFO → treble content speeds up grain animation.

---

### Response Curves (Tables)

The Tables tab contains a visual curve editor. Draw a custom 16,384-point transformation. Assign it to any parameter via right-click → "Assign Table". The controller's output is passed through the curve before reaching the parameter.

Built-in presets: Linear, Logarithmic, Exponential, S-curve, Step.

---

## 7. Preset & State Management

### Presets (0–127)

A preset stores a complete snapshot of all parameter values.

| Action | How |
|--------|-----|
| Save preset | Presets tab → "Save Preset" button |
| Load preset | Click preset card, or `+` / `−` keys |
| Quick-save | `Cmd+S` |
| Name preset | Click the name field in Presets tab |

Thumbnails (160×90 JPEG) are captured from the output canvas when saving.

MIDI Program Change messages (PC 0–127) recall presets 0–127 automatically.

---

### Display States (0–9)

Each preset has 10 sub-states. Useful for variations within a preset (e.g. different camera speeds, colour variations).

| Action | How |
|--------|-----|
| Save state | "Save State" button in Presets tab |
| Recall state | Keys `0`–`9` |

---

### Preset Morphing

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.morph` | 0–100% | Blend ratio between current and target preset |
| `global.morphspeed` | 0–10 sec | Duration of morph animation |

Smooth crossfade interpolates all continuous parameters simultaneously.

---

### Global Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.bpm` | 20–300 bpm | Global tempo |
| `global.beatdetect` | TOGGLE | Auto-detect BPM from audio onsets |

**Tap Tempo:** Click the BPM indicator in the status bar 2–5 times. Tap interval derives BPM. Retriggers all BPM-synced LFOs.

---

### Project Files (.imweb)

Full session export: all 128 presets, tables, warp maps, settings.

| Action | Key | Description |
|--------|-----|-------------|
| Export | Cmd+E | Save `.imweb` to disk |
| Import | Cmd+O | Restore session from `.imweb` |

Also available via buttons in the Presets tab.

---

### Legacy Import (.imx)

Import preset files from the original Image/ine format. Best-effort parameter mapping. Button in Presets tab.

---

## 8. Output & Recording

### Output Modes

| Mode | How | Description |
|------|-----|-------------|
| Main canvas | Default | In-app WebGL canvas |
| Fullscreen | Cmd+F or double-click | Hides UI, maximises to screen |
| Second monitor | ⊡ button | Opens popup on any display, auto-letterbox |
| Ghost mode | ◫ button | Dims main canvas to 0.18 opacity |
| Output spy | ◧ or Shift+V | Small 160×90 preview |

**Second monitor:** The popup reads the same canvas via `window.opener` (same-origin). It auto-letterboxes to fill the display while preserving aspect ratio.

**Ghost mode** activates automatically when the second screen popup is opened, and deactivates when it is closed.

---

### Resolution

| Button | Resolution | Use case |
|--------|------------|----------|
| FIT | Window size | Responsive default |
| FAST | 960×540 | Low GPU load |
| MED | 1280×720 | Balanced |
| MAX | 1920×1080 | Full HD |
| LOW | ½ scale | Very slow systems |

---

### Recording (WebM)

Click **⏺** to start recording. Click again to stop and download. Format: WebM (VP9). Resolution follows current res setting. Recording adds GPU overhead and may reduce FPS.

---

## 9. Advanced Features

### Automation Recorder

Records all parameter changes in real-time for looped playback.

| Control | Description |
|---------|-------------|
| Rec | Start recording changes |
| Play | Loop playback of recorded clip |
| Clear | Delete recording |

The recording is saved as part of the `.imweb` project file.

---

### Step Sequencer

Rhythmically steps through presets in sync with global BPM.

| Control | Range | Description |
|---------|-------|-------------|
| Seq on/off | TOGGLE | Enable sequencer |
| Rate | ½/1/2/4/8/16 beats | Step advance rate |
| Steps | 4/8/16 | Number of steps |
| Grid | — | Click cells to enable/disable |

Each step recalls a preset. Useful for rhythmic pattern-based switching.

---

### GLSL Shader Editor

Live-edit fragment shaders. Changes compile in real-time. 10 built-in example shaders included (click to load). Errors are shown in the editor panel.

Shaders read from `tDiffuse` (or named uniforms) and write to `gl_FragColor`. Added to the pipeline via the custom shader slot.

---

### AI Narrator (𝔸)

Live text description of the current signal path and active effects. Updates every ~2 seconds. Requires an API key (set via ⚙).

Toggle with `N` key or the 𝔸 button.

---

### AI Coach (⬡)

30-second performance analysis with suggestions for next moves. Analyses recent parameter changes and audio input.

Toggle with `P` key or the ⬡ button.

---

### OSC (Open Sound Control)

Connect external tools (Max/MSP, Pure Data, TouchOSC) via a WebSocket OSC bridge.

- **Address format:** `/param/{paramId}` with a float or int value
- **Status:** OSC dot in status bar (click to toggle/connect)

---

### Parameter Lock

Right-click any parameter → "Toggle Lock". Locked parameters ignore all controller input and appear greyed out. Right-click again to unlock.

---

### Parameter Search

Press `/` to open a search overlay. Type to filter all parameters. Results navigate to the correct tab and highlight the parameter row. Press `Esc` to close.

---

### Detachable Panels

Click the ⊞ button in any section header to detach it as a floating panel. Drag by the title bar to reposition. Click ✕ to re-attach.

---

## 10. Keyboard Shortcuts Reference

### Navigation

| Key | Action |
|-----|--------|
| `?` | Keyboard help overlay |
| `/` | Parameter search |
| `Shift+P` | Float / dock signal path |
| `Cmd+F` | Fullscreen |
| `Shift+V` | Output spy toggle |

### Sources & Playback

| Key | Action |
|-----|--------|
| `V` | Toggle camera |
| `M` | Toggle movie playback |
| `Shift+1–8` | Select movie clip 1–8 |
| `C` | Capture frame to stills buffer |

### Effects & Processing

| Key | Action |
|-----|--------|
| `K` | Toggle keyer |
| `B` | Toggle blend (motion persistence) |
| `S` | Solo (bypass all effects) |
| `X` | Toggle external key |

### Global

| Key | Action |
|-----|--------|
| `T` | Tap tempo |
| `H` | Fade to black (toggle) |
| `0–9` | Recall Display State 0–9 |
| `+` / `−` | Next / previous preset |
| `Cmd+S` | Quick-save current preset |
| `Cmd+E` | Export `.imweb` project |
| `Cmd+O` | Import `.imweb` project |
| `Shift+Esc` | Reset all parameters to defaults |

### AI & Tools

| Key | Action |
|-----|--------|
| `N` | Toggle AI Narrator |
| `P` | Toggle AI Coach |

---

## 11. File Formats

| Format | Direction | Description |
|--------|-----------|-------------|
| `.mp4 .webm .mov .avi` | Import | Video clips |
| `.png .jpg` | Import | Still images → stills buffer |
| `.glb .gltf` | Import | 3D models (with optional Draco compression) |
| `.obj` | Import | 3D mesh |
| `.stl` | Import | 3D mesh (binary or ASCII) |
| `.dae` | Import | Collada 3D model |
| `.cube` | Import | 3D LUT colour grade |
| `.imweb` | Import/Export | Full ImWeb session |
| `.imx` | Import | Legacy Image/ine preset |

---

## 12. Performance & Troubleshooting

### Performance Tips

- Use **FAST** or **MED** resolution on lower-end machines
- Reduce sequencer frame counts (they each consume full-resolution VRAM)
- Turn off the 3D scene depth pass when not using it (`scene3d.depth.active = OFF`)
- Reduce noise octaves for lower GPU load
- Ghost mode has no performance impact — it is purely CSS

### Status Bar Profiler

The FPS / CPU / VRAM display at the top left shows:
- **FPS:** Frames per second
- **CPU:** Average JS time per frame (in ms)
- **VRAM:** Estimated render target memory usage

VRAM shown in red when above 800MB.

### Browser Support

| Browser | Status |
|---------|--------|
| Chrome 113+ | Recommended — full support |
| Firefox | Works; minor WebGL differences |
| Safari | Works with minor WebGL limitations |

### Common Issues

| Symptom | Cause | Fix |
|---------|-------|-----|
| Canvas blank on load | No camera permission | Allow camera access in browser |
| No MIDI input | Browser MIDI not granted | Allow MIDI in browser permissions |
| Very low FPS | High resolution + many effects | Lower resolution or reduce active effects |
| Second screen black | Popup blocked | Allow popups from localhost |
| Audio reactive not working | Mic permission not granted | Allow microphone in browser |

---

*ImWeb v0.3.0 — H. Karlsson*
*Original Image/ine: Tom Demeyer, STEIM Foundation, Amsterdam*
