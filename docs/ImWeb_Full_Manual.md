# ImWeb — Full Operation Manual

> **Version:** 0.8.5
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
7. [Project / Bank / State](#7-project--bank--state)
8. [Output & Recording](#8-output--recording)
9. [Advanced Features](#9-advanced-features)
10. [Keyboard Shortcuts Reference](#10-keyboard-shortcuts-reference)
11. [File Formats](#11-file-formats)
12. [Performance & Troubleshooting](#12-performance--troubleshooting)
13. [Touch & Mobile Performance](#13-touch--mobile-performance)

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
| Bank indicator | Current Bank number |
| State indicator | Current State |
| BPM display | Current tempo; click = tap tempo, right-click = toggle MIDI clock sync |
| MIDI dot | Flashes on incoming CC/Note |
| OSC dot | WebSocket OSC bridge status |
| VU meter | Audio level bars (bass / mid / high / overall) |

### Status Bar Buttons (right side)

| Button | Key | Function |
|--------|-----|----------|
| ↺ | — | Reset all parameters to defaults |
| ⊟ / ⊞ | — | Collapse / expand all sections |
| ┄ | — | Show / hide the signal path display (hidden by default; `Shift+P` floats it) |
| ◎ | I | Parameter OSD on/off |
| ▤ | U | State bar show/hide |
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

Tabs follow the signal's own order — where a picture comes from, how pictures are
combined, what is done to them, where they go — with the large source editors
alongside.

| Tab | Contents |
|-----|----------|
| **Sources** | Live In (camera, sound, I/O), Media (Movie Library, Movie A, Movie B, Clip Library, stills, BG1/BG2), Generators, and taps From the Signal |
| **Mix** | Layer routing, per-layer colour, the three mix buses, keyer, displacement |
| **Effects** | Post-FX chain and its ordering |
| **Output** | Output modes, LUT, interlace, recording |
| **3D** | 3D scene, geometry, import, material, camera, Hypercube |
| **Analog** | Analog signal simulator and CRT formatting |
| **Draw** | Freehand canvas, brush controls, stroke looper |
| **Project** | Project save/load, AI generator, Banks, States, Step Sequencer, response curves, live GLSL |

Any panel can be **detached** into a floating, resizable window with the ⊞ button
in its section header — useful for the Movie Library, which then shows as many rows
as the window is tall.

### Bottom Bar

The bottom bar runs across the full width of the app and contains three zones:

**State grid** — 32 thumbnail tiles arranged in two rows of 16. Tiles show auto-captured thumbnails for saved states and appear dark for empty slots.

| Action | Result |
|--------|--------|
| Left-click an empty tile | Save current state to that slot |
| Left-click a saved tile | Recall that state |
| Right-click any tile | Context menu: Save here / Import .imstate / Export .imstate / Clear |
| ○ (leftmost tile) | Neutral State — resets all parameter values without touching controller assignments |

**Bank dropdown** (bottom-right) — shows the current Bank name followed by ▼. Clicking it opens a menu:
- Bank list — click any Bank to switch to it
- **+ New Bank** — create a new empty Bank
- **⬆ Import Bank…** — load a `.imbank` file as a new Bank
- **⊞ Open Banks window** — detaches the Banks panel as a floating window

---

### Signal Path Display

**Hidden by default** — the ┄ toolbar button shows/hides the docked band
(the canvas reclaims the space while hidden); `Shift+P` floats it as a
draggable window. When visible it shows the live routing: **FG → BG → DS → TransferMode → Displacement → WarpMap → Keyer → Blend → ColorShift → FX Chain → LUT → Interlace → Fade → Output**. Effects in the FX chain can be dragged to reorder.

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

### 4.2 Movie Library & Decks

Movies live in one place — the **Movie Library** — and play on one of **two decks**,
Movie A and Movie B. Keeping those separate is the whole design:

| | Movie Library | Deck rack (A / B) |
|---|---|---|
| Holds | every movie that exists | the handful loaded and ready |
| Size | **no limit** | 8 slots per deck |
| Cost | a name, a duration, a thumbnail | a decoded video, buffered |
| Answers | "what have I got?" | "what can I cut to right now?" |

A library entry is only a *description* of a movie. It becomes playable when you
load it into a deck's rack — that is the moment a video is decoded. Two decks
playing the same file need independent playheads, so each rack slot holds its own
video, which is why a rack is small and the Library is not.

#### Getting movies into the Library

- **`+ Add Movie`** (top of the Movie Library panel) — pick one or more files.
  They join the Library but are **not** racked; load them to a deck when you want them.
- **Drop a file on the canvas** — joins the Library *and* racks it on Deck A.
  Hold `Shift` while dropping to rack it on Deck B instead.
- Anything in `_imweb_ready/` is added automatically at startup (see *Video prep* below).

Rows show a thumbnail, duration and origin. Duration and thumbnail are read only
when a row scrolls into view, so a Library of a hundred movies still starts instantly.
Use the **filter box** to narrow a long list.

#### Loading a movie onto a deck

- **Drag a Library row onto the Movie A or Movie B panel** — the panel highlights as you hover.
- Or click the row's **`→A`** / **`→B`** button.
- `Shift`-click a Deck A rack entry to copy it to Deck B.

**When a rack is full, the oldest clip is evicted** to make room, so loading never
interrupts a set. The clip currently *playing* is never evicted — if it happens to
be the oldest, the next oldest goes instead.

#### Selecting a clip on a deck

| Keys | Deck |
|------|------|
| `Shift+1` … `Shift+8` | Movie **A** rack, slots 1–8 |
| `Option+1` … `Option+8` | Movie **B** rack, slots 1–8 |

Each rack row shows its own key badge (`⇧3`, `⌥2`) so the mapping is visible.
Clicking a rack row selects it too.

#### Removing things

- **`✕ Clear`** in a deck panel empties *that deck's* rack. It unloads only — the
  Library keeps every entry, so anything cleared can be racked again.
- **`✕`** on a Library row removes the *entry*. Nothing on disk is touched, and a
  clip already racked keeps playing. Startup entries return on the next reload.

#### Both decks start switched off

A project never begins blasting video: `movie.active` and `movieB.active` are both
forced off at launch regardless of what a saved state says. **Routing a layer to
Movie A or Movie B switches that deck on for you**, so selecting Movie B as a
Background just works. Deck A also has the **Movie On/Off** button in the status bar.

#### Parameters

Deck B mirrors every parameter below under the `movieB.` prefix
(`movieB.speed`, `movieB.loop`, …).

| Parameter | Range | Description |
|-----------|-------|-------------|
| `movie.active` | TOGGLE | Enable playback |
| `movie.speed` | −1 – 3 | Playback speed; negative = reverse (manual frame stepping); 0 = pause |
| `movie.pos` | 0–100% | Frame scrub — drag to seek; assign LFO/MIDI to scan through frames (overrides MovieSpeed when a controller is active) |
| `movie.start` | 0–100% | Loop range start |
| `movie.end` | 0–100% | Loop range end |
| `movie.loop` | SELECT | Off / Loop / Ping-pong — Loop wraps in whichever direction MovieSpeed points |
| `movie.mirror` | TOGGLE | Horizontal flip |
| `movie.bpmsync` | TOGGLE | Lock playback to global BPM |
| `movie.bpmbeats` | SELECT | ½ / 1 / 2 / 4 / 8 / 16 beats per loop |

**Clip context menu:** Right-click a rack row to assign a MIDI controller to `movie.speed` or remove the clip.

Each clip maintains its own playback state. Thumbnails (160×90) are captured at 10% of the clip duration to avoid black frames.

**Only the clip you are playing buffers ahead.** The others hold their position at
metadata only. This is what allows a full 8-slot rack: the limit on racked clips is
not their number but their total *bytes*, and All-Intra files are large. Switching
to a slot that has been idle can therefore take a moment to start on the very first
play — after that it is instant.

#### Recommended video formats

| Format | Codec | Notes |
|--------|-------|-------|
| `.mp4` | H.264 | Best compatibility; hardware-accelerated decode in all browsers |
| `.webm` | VP9 | Smaller files; slightly slower random-seek |
| `.mov` | ProRes 422 | High quality; large files; Chrome/Chromium only |

Avoid interlaced sources, HEVC `.mov`, and very high bitrates (>20 Mbps) — they stress the JS decode path and cause seek jitter.

#### Handbrake settings for real-time performance

```
Container:   MP4
Video codec: H.264 (x264)
Quality:     RF 20–23  (lower number = better quality, larger file)
Framerate:   Same as source  (or cap at 30 fps if source is higher)
Audio:       Remove  (saves decode overhead)
Filters:     Deinterlace if source is interlaced
x264 tune:   Film  (or Grain for textured/analog material)
```

Target bitrate: **4–10 Mbps** for smooth scrubbing and seek. Above 15 Mbps, Chrome's MediaElement seek latency becomes noticeable.

---

### 4.3 Stills Buffer

Capture and hold still frames for compositing, arranged as a grid of up to
8×8 = 64 slots (default 4×4 = 16).

**Capture:** Press `C`, or use the Buffer tab controls.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `buffer.source` | SELECT | Source to capture from |
| `buffer.rows` | 1–8 | Grid rows |
| `buffer.cols` | 1–8 | Grid columns |
| `buffer.fs1` | 0–63 | Primary frame slot |
| `buffer.fs2` | 0–63 | Secondary frame slot |
| `buffer.frameblend` | 0–100% | Crossfade between fs1 and fs2 |
| `buffer.fs3` | 0–63 | Tertiary slot |
| `buffer.scan` | 0–100% | Scan position through frames |
| `buffer.scanrate` | 0.5–60 fps | Scan speed |
| `buffer.scandir` | SELECT | Forward / backward |
| `buffer.panX / panY` | 0–100% | Pan within frame |
| `buffer.scale` | 0.1–3 | Scale within frame |
| `buffer.auto` | TOGGLE | Auto-capture on interval |
| `buffer.rate` | 0.5–60 fps | Auto-capture rate |
| `buffer.capture` | TRIGGER | Capture to next slot |

Slots can be individually **protected** (lock icon in Buffer tab) to prevent
auto-overwrite. Total slot count is `rows × cols`, capped at 64 (8×8).

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

### 4.13 Analog TV

Self-contained 720x480 analog signal simulator.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `analog.sourceType` | SELECT | — | Base input source for the analog pipeline. |
| `analog.crop43` | TOGGLE | — | Applies hard 4:3 letterboxing to the signal. |
| `analog.brightness` | SLIDER | -100–100% | Base signal brightness lift. |
| `analog.contrast` | SLIDER | 0–200% | Signal contrast multiplier. |
| `analog.saturation` | SLIDER | 0–200% | Color burst saturation. |
| `analog.hueOffset` | SLIDER | -180–180° | Signal phase/hue shift. |

---

### 4.14 SDF (Signed Distance Field Raymarcher)

A raymarched 3D field rendered as a source. Shapes are described mathematically
rather than as meshes, so they combine, repeat and deform continuously.

**Geometry**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.active` | TOGGLE | Enable |
| `sdf.shape` | SELECT (13) | Primary shape — Sphere, Box, Torus, Capsule, Hexagonal Prism, Octahedron, Link, Mandelbulb, … |
| `sdf.shapeB` | SELECT (14) | Second shape; "Same as A" mirrors the primary |
| `sdf.opMode` | SELECT | Union / Smooth Union / Subtraction / Intersection |
| `sdf.opAmount` | 0–1 | Blend radius for Smooth Union |
| `sdf.count` | 1–8 | Number of instances |
| `sdf.distance` | 0–5 | Separation between instances |
| `sdf.size` | 0.1–3 | Shape scale |
| `sdf.tile` | TOGGLE | Infinite domain repetition on/off |
| `sdf.repeat` | 1.2–10 | Tile spacing (only meaningful when Tile is on) |
| `sdf.warp` | 0–2 | Domain warp amount |
| `sdf.lumaWarp` | 0–2 | Warp driven by source luminance |
| `sdf.speed` | 0–5 | Animation rate |

> **Shape sizing note.** Most shapes sit at a bounding radius between 0.50 and
> 0.73, so they respond comparably to Size, Separation and Count. Two do not:
> **Gyroid** is triply-periodic and has no size of its own — it ignores those
> three controls and reads as a background field rather than an object.
> **Catenoid** flares exponentially, so its y clamp *is* its size control.

**Camera**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.orbitX` | 0–360° | Orbit azimuth |
| `sdf.orbitY` | -180–180° | Orbit elevation |
| `sdf.camDist` | 0.5–20 | Camera distance from origin |
| `sdf.moveX` / `moveY` / `moveZ` | -5–5 | Translate the field |
| `sdf.fov` | 20–120° | Vertical field of view (default 74° reproduces the original fixed framing) |
| `sdf.depthRange` | 0.25–8 | Depth normalisation range for the SDF Depth output |

> Replaces the older Cartesian `sdf.camX/camY/camZ` eye. Projects saved before
> the change are migrated on load.

**Fractal folds (KIFS)**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.kifsIter` | SELECT 0–5 | Fold iterations; 0 disables |
| `sdf.kifsAngle` | 0–360° | Fold rotation |
| `sdf.kifsScale` | 0.5–2 | Per-iteration scale |
| `sdf.kifsOffset` | 0–2 | Per-iteration offset |

**Surface & texture**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.texSrc` | SELECT (16) | Texture source; "FG Layer" follows the foreground |
| `sdf.texBlend` | 0–1 | Texture vs. shaded surface mix |
| `sdf.refractSrc` | SELECT (16) | Refraction source; "BG Layer" follows the background |
| `sdf.refract` | 0–1 | Refraction amount |
| `sdf.fresnel` | 0–1 | Edge-facing reflectivity |
| `sdf.hue` / `sat` / `val` | 0–360° / 0–1 / 0–1 | Surface colour |
| `sdf.lumaThresh` | 0–1 | Luminance threshold for source-driven effects |
| `sdf.ao` | 0–1 | Ambient occlusion strength |

> **Hue, Sat and Val tint the shaded surface, not the texture.** At the default
> `texBlend` of 0.8 the texture dominates and the tint is nearly invisible —
> lower Tex Blend to see them.

**Glow & reflection**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.glow` | 0–1 | Aura strength |
| `sdf.glowSize` | 0.02–2 | Aura falloff distance |
| `sdf.glowHue` / `glowSat` / `glowVal` | 0–360° / 0–1 / 0–1 | Aura colour stop 1 |
| `sdf.glowHue2` / `glowSat2` / `glowVal2` | 0–360° / 0–1 / 0–1 | Aura colour stop 2 |
| `sdf.glowEnv` | 0–1 | Modulate the aura by the surrounding image |
| `sdf.envAmt` | 0–1 | Environment mirror amount |
| `sdf.selfReflect` | 0–1 | Second-bounce self-reflection |
| `sdf.reflectAmt` | 0–1 | Reflection strength |
| `sdf.reflectRange` | 1–20 | Reflection march distance |
| `sdf.reflectDetail` | 0.1–1 | Reflection step resolution |

**Lighting & quality**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `sdf.lightAz` | 0–360° | Key light azimuth |
| `sdf.lightEl` | -90–90° | Key light elevation |
| `sdf.rscale` | 0.25–1 | Render scale — the main performance control |
| `sdf.steps` | 32–256 | Raymarch step budget |

---

### 4.15 Rutt-Etra Scan Processor

A modern reading of the Rutt/Etra scan processor: each scanline of the source is
displaced in Z by its brightness and drawn as a beam in 3D.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `rutt.active` | TOGGLE | Enable |
| `rutt.source` | SELECT | Input source |
| `rutt.shape` | SELECT | Plane / Sphere / Cylinder / Torus / Catenoid / Helicoid / Gyroid |
| `rutt.lines` | 16–480 | Scanline count |
| `rutt.zgain` | -2–2 | Brightness → Z displacement; negative inverts |
| `rutt.zcurve` | 0.1–4 | Gamma on the displacement response |
| `rutt.zpivot` | 0–1 | Brightness value that maps to zero displacement |
| `rutt.drawMode` | SELECT | Lines / Points / Both |
| `rutt.thickness` | 0.5–8 | Beam width |
| `rutt.pointSize` | 0.5–16 | Dot size in Points mode |
| `rutt.hue` | 0–360° | Tint hue |
| `rutt.sat` | 0–1 | Tint amount |
| `rutt.colorAmt` | 0–1 | How much source colour survives the tint |
| `rutt.angle` | 0–360° | Orbit azimuth |
| `rutt.elev` | -180–180° | Orbit elevation |
| `rutt.moveX` / `moveY` / `moveZ` | -2–2 | Translate the lattice |
| `rutt.dist` | 1–10 | Camera distance |
| `rutt.rise` | 0–2 | Attack time of the per-line follower |
| `rutt.fall` | 0–2 | Release time of the per-line follower |
| `rutt.decay` | 0–0.98 | Frame persistence |
| `rutt.bleed` | 0–4 | Horizontal spread between neighbouring lines |

> Beam width saturates at high line counts — at 120 lines the lattice already
> fills the frame, so Beam reads as a small change. Its effect is close to
> linear around 8–16 lines.

---

### 4.16 Warp Tape

A rolling buffer that records the source over time and lets you scrub or smear
across the recorded axis — a tape head over a time-image.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `vwarp.active` | TOGGLE | Enable |
| `vwarp.source` | SELECT | Input source |
| `vwarp.axis` | SELECT | Time (X) / Picture (Y) |
| `vwarp.flip` | TOGGLE | Reverse the read direction |
| `vwarp.mix` | 0–1 | Dry/wet against the source |
| `vwarp.bufsize` | SELECT | 480 cols (8 s) / 960 cols (16 s) / 1920 cols (32 s) |
| `vwarp.speed` | 1–8 | Write rate |
| `vwarp.anchor` | 0–1 | Fixed point of the read window |
| `vwarp.pos` | 0–1 | Read position along the tape |
| `vwarp.span` | 0.01–1 | Width of the read window |
| `vwarp.clear` | TRIGGER | Zero the tape |

---

### 4.17 Time Displace

Listed in source menus as **TimeDisp**. Displaces each pixel *in time* rather than in space: a map image selects how far
back into a captured frame buffer each pixel reads.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `td.enabled` | TOGGLE | Enable |
| `td.captureSource` | SELECT | Source recorded into the delay buffer |
| `td.mode` | SELECT | Shear X / Shear Y / Warp Line / Shear X Sym / Shear Y Sym / Radial / Noise |
| `td.bufferResolution` | SELECT | 320×240 / 640×360 / 640×480 / Native |
| `td.upscaleFilter` | SELECT | Nearest / Linear |
| `td.maxDelay` | 1–119 | Deepest reachable frame |
| `td.delayCurve` | 0.1–4 | Gamma mapping map value → delay |
| `td.direction` | SELECT | Forward / Backward |
| `td.scanPosition` | 0–1 | Scan line position (X) |
| `td.scanPosY` | 0–1 | Scan line position (Y) |
| `td.scanWidth` | 0–1 | Scan band width |
| `td.invertMap` | TOGGLE | Invert the delay map |
| `td.angle` | 0–360° | Scan angle |
| `td.mapSource` | SELECT | Image used as the delay map |
| `td.mapAmount` | 0–1 | Map influence |

> Buffer resolution is the dominant memory cost here — Native holds 120 full-size
> frames. Drop to 640×360 first if you are tight on VRAM.

---

### 4.18 Mix Buses (×3)

Three independent mixers, available as sources **Mix 1**, **Mix 2** and **Mix 3**.
Each takes two freely chosen sources and combines them. A bus is a real node in
the graph, not a deck crossfader — either input can be any source, including
another bus.

Bus 1 uses the bare `mix.` prefix; buses 2 and 3 use `mix2.` and `mix3.` with
identical controls.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `mix.srcA` | SELECT | First input — any source |
| `mix.srcB` | SELECT | Second input — any source |
| `mix.mode` | SELECT | Crossfade / Add / Multiply / Luma Mask / Displace |
| `mix.xfade` | 0–1 | A↔B blend position |
| `mix.dispAmt` | 0–1 | Displacement strength in Displace mode |
| `mix.maskLo` | 0–1 | Luma Mask lower threshold |
| `mix.maskHi` | 0–1 | Luma Mask upper threshold |

**Ordering.** Each bus is double-buffered, which gives one consistent rule: a
later bus reading an earlier one sees **this** frame; an earlier bus reading a
later one — or a bus reading itself — sees **last** frame. Self-routing is
therefore legal and produces a one-frame feedback loop rather than an error.

Buses allocate their render targets lazily, so a project that routes no bus
costs no VRAM.

---

### 4.19 Depth Companions

Two sources expose depth rather than colour, for routing into displacement,
keying or the mix buses:

| Source | Description |
|--------|-------------|
| **3D Depth** | Depth buffer of the 3D Scene |
| **SDF Depth** | Depth of the SDF field, normalised by `sdf.depthRange` |

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

Source options for each layer: Camera / Movie / Screen / Draw / Noise / Color / Buffer / 3D / SlitScan / Particles / Sequencer 1–3 / Text / Vectorscope / Analog

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
| `displace.warp` | SELECT | Warp mode — off / H-Wave / V-Wave / Radial / Spiral / Shear / Pinch / Turb / Rings / Custom |
| `displace.warpamt` | 0–200% | Warp map strength |
| `displace.warpFade` | 0–1 | Fade the warp field towards flat |

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

#### Warp drawing

The warp field can be drawn directly, on three surfaces that share one brush:
the mini editor, dragging on the main canvas, and the `warpDrawX`/`warpDrawY`
parameters under controller automation.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `displace.warpDrawRadius` | 2–50 | Brush radius, shared by all three surfaces |
| `displace.warpDrawAmt` | 0–200% | Brush strength, shared by all three surfaces |
| `displace.warpDrawX` | 0–100% | Brush X position — drive from a controller to draw automatically |
| `displace.warpDrawY` | 0–100% | Brush Y position |
| `displace.warpDrawFixed` | TOGGLE | Lock the stroke direction instead of following movement |
| `displace.warpDrawAngle` | 0–360° | Direction used when Fixed Dir is on |
| `displace.warpSlot` | SELECT (17) | Custom map slot, — plus 1–16 |
| `displace.warpSlotFade` | 0–10 | Seconds for a drawn slot to decay back to flat; 0 holds indefinitely |
| `displace.warpPreset` | SELECT | — / H-Wave / V-Wave / Radial / Pinch / Spiral / Shear / Random / Reset |

Radius and Strength are single shared parameters — the editor's sliders are
views onto them, so changing radius in the mini editor also changes the brush on
the main canvas.

> **Slot vs. Preset in saved states.** `warpPreset` **is** captured by Display
> States: the eight shapes live in code, so an index means the same thing on any
> machine. `warpSlot` is **not** captured — slot *contents* live in per-origin
> browser storage, so a saved index would recall a different map on another
> machine, or even on another port. Save a drawn map you want to keep as part of
> the project rather than relying on the slot number.

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

#### RGB Channel Delay (source 31)

Per-channel time offset. Red, green and blue are each read from a different
frame of history and packed into one picture, so a moving edge separates into
coloured fringes trailing its own past. Anything still stays exactly itself —
where three frames agree, taking one channel from each reproduces the pixel, so
**equal values on all three are a bit-exact passthrough**.

Select it as a source (Foreground / Background / DisplaceSrc → *From the
Signal* → **RGB Delay**); the controls are in **Sources ▸ Warp ▸ RGB Channel
Delay**.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `rgbdelay.r` | 1–480 | Red channel age, in frames |
| `rgbdelay.g` | 1–480 | Green channel age, in frames |
| `rgbdelay.b` | 1–480 | Blue channel age, in frames |

It owns no history — it reads the **Video Delay ring**, so `Delay src`,
`Ring depth` and `Buffer res` above are its controls too. One ring, two views of
it: re-pointing Video Delay re-points this. Depth is limited by `Ring depth`,
and a channel asking for more frames than the ring has captured holds at the
oldest available frame rather than dropping to black.

Minimum is 1, not 0, because age 0 and age 1 are the same frame.

#### Motion Extraction (source 32)

Produces a **matte**, not a picture: white where the source is moving, black
where it is not. Its destination is the keyer's **Key src**, not a layer —
select the thing you want to reveal as Foreground, the thing behind it as
Background, then key the Foreground by Motion. Only the moving part shows.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `motion.source` | SELECT | What is watched for movement |
| `motion.gain` | 1–20 | Sensitivity — a raw frame difference is only a few percent |
| `motion.bgtime` | 0–10 s | Time for the background to absorb a change. **0 = frame differencing** |
| `motion.trail` | 0–10 s | How long a trail survives after the movement passes |
| `motion.blur` | 0–4 | Smoothness — blurs the source before comparing. 0 = off |

**`Bg adapt` is the important control, and it spans two classical methods.**
The background is a running average of the source. A long adapt time gives a
stable background, so a subject who stops moving *stays* in the matte — that is
background subtraction. At 0 the background is simply the previous frame, which
is frame differencing: only edges of change register, and anything that stops
vanishes. The useful settings are usually in between.

Both `Bg adapt` and `Trail` are **time until ~gone**, not half-lives — set
`Bg adapt` to 4 and something that leaves the frame has faded from the
background by about 4 seconds, not half-faded. The two dials use the same
convention deliberately, so a number means the same kind of thing in both.

**Smoothness** blurs the source *before* the comparison, and it is the control
that cleans up a live camera. Sensor grain is high-frequency, and this is the
only place it can be removed cheaply: downstream it has already been multiplied
by Sensitivity and accumulated into the trail, and neither is reversible. It
also fills interiors — a blurred moving object differs from the blurred
background across its whole area rather than only at its edges, so silhouettes
come out solid instead of hollow. 1–2 is the useful range on a camera; 0 is off
and costs nothing.

> There is deliberately no brightness or contrast here. Brightness shifts the
> live frame and the background by the same amount — the background *is* an
> average of past frames — so it cancels in the difference and would do nothing
> at any setting. Contrast scales both, which gives exactly what Sensitivity
> already gives; the two would multiply.

**Trail** rides on the matte, so the streak reveals whatever the Foreground
shows *now* along that path, rather than a frozen copy of what passed through.
It uses instant attack and exponential release, and cannot blow out where two
moving things cross.

> **Setting up the key:** the keyer passes a *band* between KeyLevelBlack and
> KeyLevelWhite, so it rejects the very bright as well as the very dark. At the
> default KeyLevelWhite of 80% a fully lit matte is keyed **out** — which looks
> like the strongest motion being the one thing that fails to show. Set
> **KeyLevelWhite to 100%** and let KeyLevelBlack do the cutting.
>
> For glowing trails, turn **Alpha Emissive** on: a fading trail is light
> *added*, not an object occluding. Leave it off for a hard cutout of a person.

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

#### Device Motion (iPad / mobile)

The device's orientation sensors are assignable controllers — the iPad
itself becomes a physical fader.

| Type | Badge | Description |
|------|-------|-------------|
| Tilt X | TLX | Tilt toward/away from you; ±90° → 0–1, flat = 0.5 |
| Tilt Y | TLY | Tilt left/right; ±90° → 0–1, flat = 0.5 |
| Compass | CMP | Heading 0–360° → 0–1 (wraps at north — mapped value jumps there) |

Axes are compensated for screen orientation, so Tilt X always means
"toward/away" whether the device is in portrait or landscape.

**iOS permission:** the first assignment (or a tap on **Enable Motion**
in the GLOBAL section) triggers Apple's motion-access prompt — it must
come from a touch, so if a recalled preset contains tilt controllers,
tap **Enable Motion** once to activate them. The result is flashed
on-screen (`MOTION: GRANTED / DENIED`). If no prompt appears, fully
close the browser tab and reopen — iOS caches a denial per page load.
Sensors require a **secure (https) origin**.

Slew and response tables apply as with any controller — use Slew
(~0.1 s) to tame sensor jitter.

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

## 7. Project / Bank / State

ImWeb uses a three-level memory hierarchy. Understanding it makes saving and recalling work feel natural in performance.

```
Project (.imweb)
  └── Bank 1 — SDF Metaballs
  │     └── State 1 · State 2 · … · State 32
  └── Bank 2 — Noise Feedback
        └── State 1 · State 2 · …
```

---

### Project

A Project is a complete session: all Banks, Tables, Warp Map slots, and settings. It is saved as a `.imweb` JSON file.

| Action | Key / Button |
|--------|-------------|
| Save (download) | `Cmd+S` or Project tab → **⇩ Export .imweb** |
| Load | `Cmd+O` or Project tab → **⇧ Import .imweb** |

There is no server-side auto-save. Use `Cmd+S` whenever you want a checkpoint.

---

### Banks

A Bank is a named group of up to 32 States. Banks also carry the current controller assignments as a reference baseline (though each State stores its own controller snapshot too).

#### Switching Banks

- **Bottom-right dropdown** ("Bank 1 ▼") — click to open, then click any Bank name
- **Numpad `+` / `−`** — step forward/backward through Banks
- **MIDI Program Change (PC 0–127)** — recalls Bank at the same index

#### Managing Banks (Project tab → Banks section)

| Button | Action |
|--------|--------|
| 💾 Save | Write the current state of this Bank to IndexedDB |
| 💾 Save As | Deep-copy the current Bank to a new slot, activate it |
| + New | Create a blank Bank |
| ⬇ Export | Download the Bank as a `.imbank` file |
| ⬆ Import | Load a `.imbank` file as a new Bank |
| ✕ Delete | Remove the Bank (with confirmation) |

The **bank list** below the buttons shows all Banks. Click any name to switch. The active Bank is highlighted in yellow. Click a name again to rename it inline.

#### Opening Banks as a floating window

Bottom-right dropdown → **⊞ Open Banks window** — detaches the Banks panel so it floats over the canvas for quick access during performance.

---

### States

A State is a complete, self-contained snapshot of the instrument at a moment in time. It captures:

- All **parameter values**
- The **FX chain order**
- All **controller assignments** (LFO shapes, rates, MIDI CC numbers, etc.)
- **Media filenames** (the names of the movie clip and 3D model that were loaded — as a reminder, since the File API prevents auto-reloading files)

Each Bank holds up to **32 States**, displayed as a thumbnail grid in the bottom bar.

#### Saving a State

| Method | Action |
|--------|--------|
| **Shift+S** | Quick-save to the next empty slot; generates an auto-thumbnail |
| Left-click an empty tile | Save to that specific slot |
| Right-click any tile → "Save here" | Save to that specific slot |

#### Recalling a State

| Method | Action |
|--------|--------|
| **`0–9`** (number row) | Recall State at that index |
| Left-click a saved tile | Recall that State |

When `global.morphspeed` > 0, recalling a State triggers a smooth morph animation instead of a snap. All continuous parameters (not toggles or triggers) interpolate using smooth-step easing.

#### Neutral State

Press **`Shift+0`** or click the **○** tile at the far left of the bottom bar to trigger a Neutral State. This resets all parameter values to their defaults without touching any controller assignments. Useful as a clean starting point or a "panic" reset.

#### Per-State operations (right-click a tile)

| Option | Description |
|--------|-------------|
| Save here | Overwrite this slot with current state |
| Import .imstate | Load a `.imstate` file into this slot |
| Export .imstate | Download this State as a `.imstate` file |
| Clear | Delete this State |

#### Media reference warnings

If a State was saved with a specific movie clip or 3D model loaded, and those files are not currently loaded, ImWeb shows a toast warning: `⚠ State was saved with: Movie: "filename.mp4"`. Reload the file manually and re-save the State if needed.

---

### State Morphing

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.morph` | 0–100% | Live blend ratio between source and target state |
| `global.morphspeed` | 0–10 sec | Duration of the morph animation (0 = snap) |

When morphspeed > 0, recalling a State starts a morph animation that interpolates all continuous parameters (not toggles or selects). The `global.morph` parameter tracks progress from 0→100% and can be assigned a controller or read by the automation recorder.

---

### Global Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.bpm` | 20–300 bpm | Global tempo |
| `global.beatdetect` | TOGGLE | Auto-detect BPM from audio onsets |

**Tap Tempo:** Click the BPM indicator in the status bar 2–5 times. The tap interval derives BPM. All BPM-synced LFOs retrigger.

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

### Live GLSL Effect

Live-code fragment shaders in a CodeMirror editor (syntax highlighting, line numbers, iPad-friendly, resizable via the drag handle). **Apply** (or Ctrl/Cmd+Enter) compiles; **Auto** recompiles on every keystroke. A compile error never interrupts the output — the previous working shader keeps running and the error (with line numbers) shows above the editor.

**✨ Prompt AI** — describe an effect in natural language ("kaleidoscope that pulses with the bass") and the configured AI provider (AI panel, ⚙) writes the shader. Generated code is compile-checked before it reaches the editor, with one automatic repair round-trip on errors, and names its own knob labels.

**Presets** — the dropdown holds the built-ins plus your saved shaders. **📄** clears to a blank boilerplate, **💾** saves the current code under a custom name (browser localStorage, listed under "— User —"), **✕** deletes the selected user preset. The loaded shader, Auto state, and routing target are also saved in `.imweb` project files.

**Target routing** — run the shader as an insert on **Master** output (default), **Foreground**, **Background**, or the **Displace** layer source. Routing is a normal parameter: state-recallable and controller-assignable.

**The VJ uniform contract** — auto-declared, just use them:

| Uniform | Meaning |
|---|---|
| `vec2 vUv` | 0..1 UV coordinates (varying) |
| `sampler2D uTexture` | input frame at the routed insert point |
| `sampler2D tAudio` | 256×2 texture: y<0.5 FFT bins, y>0.5 waveform; read `.r` |
| `sampler2D tPrev` | previous output frame — feedback and trails |
| `vec2 uResolution` | canvas size in pixels |
| `float uTime` | seconds |
| `float uBPM` / `uBeat` | detected tempo / beat phase 0..1 (0 = on the beat) |
| `float uLevel` `uBass` `uMid` `uHigh` | audio levels 0..1 (enable Sound) |
| `float uParam1..4` | performance knobs — bind any controller to the sliders below the editor |

Write GLSL ES 1.00 (`texture2D()`, `gl_FragColor`). Pasted ShaderToy-style declarations with precision qualifiers are detected and not double-injected. The **Audio React** built-in preset demonstrates bass zoom, beat flash, FFT bars, and tPrev trails.

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
| `Shift+P` | Float / dock signal path (floating always shows it) |
| `I` | Parameter OSD on/off (feedback text over the canvas) |
| `U` | State bar show/hide (canvas reclaims the strip) |
| `G` | Cycle canvas interaction mode (Camera / Pad / Locked) |
| `Cmd+F` | Fullscreen |
| `Shift+V` | Output spy toggle |

### Sources & Playback

| Key | Action |
|-----|--------|
| `V` | Toggle camera |
| `M` | Toggle movie playback (Deck A) |
| `Q` | Cycle Foreground source — in the LAYERS dropdown's order |
| `A` | Cycle Background source — same order |
| `Z` | Cycle DisplaceSrc — same order |
| `Shift+1–8` | Select clip 1–8 on the **Movie A** rack |
| `Option+1–8` | Select clip 1–8 on the **Movie B** rack |
| `C` | Capture frame to stills buffer |

`Q` / `A` / `Z` step through sources in exactly the order the Mix ▸ LAYERS
dropdowns list them (Live In → Media → Generators → From the Signal → Mix), not in
internal index order, so the keyboard and the menu always agree.

### Effects & Processing

| Key | Action |
|-----|--------|
| `K` | Toggle keyer |
| `B` | Toggle blend (motion persistence) |
| `S` | Solo (bypass all effects) |
| `X` | Toggle external key |

### Memory

| Key | Action |
|-----|--------|
| `0–9` | Recall State at index |
| `Shift+0` | Neutral State (reset all params, keep controllers) |
| `Shift+S` | Quick-save State to next empty slot (auto-thumbnail) |
| `+` / `−` | Next / previous Bank (Numpad) |

### Global

| Key | Action |
|-----|--------|
| `T` | Tap tempo |
| `H` | Fade to black (toggle) |
| `Cmd+S` | Save project → download `.imweb` |
| `Cmd+E` | Export `.imweb` (same as Cmd+S) |
| `Cmd+O` | Import `.imweb` project |

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
| `.imweb` | Import/Export | Full session — all Banks, Tables, Warp Maps, settings |
| `.imbank` | Import/Export | Single Bank — share a performance patch |
| `.imstate` | Import/Export | Single State — share one snapshot |

### Video Format Guide

Most video files from phones and cameras play without any conversion. For **frame-accurate `MoviePos` scrubbing**, clips should be All-Intra encoded.

| Format | Browser playback | Scrubbing |
|--------|-----------------|-----------|
| H.264 MP4 (phone/camera) | Yes | Approximate |
| H.264 MP4 All-Intra | Yes | Frame-accurate |
| WebM VP8 / VP9 | Yes | Approximate |
| H.265 / HEVC | Safari only | — |
| ProRes, DNxHD, RAW | No | — |

### imweb-prep.js — Video Converter

The companion script `imweb-prep.js` converts any supported video to the optimal ImWeb format automatically.

**Requirements:** Node.js + FFmpeg

```bash
# Install FFmpeg (macOS)
brew install ffmpeg

# Install FFmpeg (Linux)
apt install ffmpeg

# Run the converter
node imweb-prep.js
```

**Workflow:**

1. Drop raw video files into `_raw_videos/`
2. Run `node imweb-prep.js`
3. Converted files appear in `_imweb_ready/` with suffix `_ALL-I.mp4`
4. Files in `_imweb_ready/` are added to the Movie Library at startup

#### Clips prepped before v0.14 need a one-off remux

The converter now writes a **faststart** MP4 — the `moov` atom is placed at the
*front* of the file. Without it a browser cannot report a clip's duration until it
has read to the *end* of the file, which on a 200 MB+ All-Intra clip means metadata
takes seconds to arrive or never arrives under load. That was the cause of clips
loading only up to the eighth slot and of Library rows sitting at "…".

To fix existing files without re-encoding (lossless, seconds per file):

```bash
cd _imweb_ready
for f in *.mp4; do
  ffmpeg -v error -i "$f" -c copy -movflags +faststart "fs_$f" && mv "fs_$f" "$f"
done
```

Back up first. To check whether a file is already faststart, list the first two
top-level atoms — `moov` must come *before* `mdat`:

```bash
ffmpeg -v trace -i file.mp4 -f null - 2>&1 | grep -m2 -E "type:'(moov|mdat)'"
```

**Output specification:**

| Parameter | Value |
|-----------|-------|
| Codec | H.264 (libx264) |
| Profile | Main |
| GOP | 1 (All-Intra — every frame is a keyframe) |
| Quality | CRF 18 (high quality, visually lossless) |
| Pixel format | yuv420p (required for WebGL) |
| Dimensions | Forced even (prevents WebGL texture errors) |
| Audio | Stripped (saves CPU decoding overhead) |
| Preset | fast + tune fastdecode |

---

## 12. Performance & Troubleshooting

### Performance Tips

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
| Very low FPS | Many effects active | Reduce active effects |
| Second screen black | Popup blocked | Allow popups from localhost |
| Audio reactive not working | Mic permission not granted | Allow microphone in browser |
| Movie clip won't load | Unsupported codec | Convert with `node imweb-prep.js` |
| MoviePos scrubbing jumpy | Non-All-Intra encoding | Convert with `node imweb-prep.js` |
| Only the first 7–8 clips load; the rest time out | Clips prepped without faststart — `moov` at end of file, so duration cannot be read | One-off remux with `-movflags +faststart` (see §*Clips prepped before v0.14*) |
| Library rows stay at "…" and never show a duration | Same cause | Same fix |
| Newly selected clip shows a still frame that never moves | Clip is still fetching its first data | Expected briefly on an idle slot's first play; if permanent, the clips are not faststart |
| Movie B selected as a layer but nothing appears | Deck B switched off | Routing a layer to it now switches it on; otherwise use `MovieOn B` in the Movie B panel |
| Camera won't start on iPad | Insecure (http) origin | Serve with `npm run dev:https`; trust the mkcert CA on the device |
| Tilt/Compass give no values | iOS motion permission not granted | Tap **Enable Motion** (GLOBAL); if no prompt appears, fully close the tab and reopen |
| Desktop framerate low on MacBook | macOS routed the browser to the integrated GPU | Disable "Automatic graphics switching" (Battery → Options), relaunch browser |

---

## 13. Touch & Mobile Performance

ImWeb runs as a full touch instrument on the iPad (and other tablets).
Screens ≤900 px wide — or any large touch device up to 1366 px with no
mouse — get a dedicated mobile layout; desktop is unchanged.

### Serving to an iPad

Run the dev server with `npm run dev:https` and open
`https://<your-mac-ip>:5173` on the iPad. HTTPS is required for the
camera, microphone, and motion sensors (install the mkcert root CA
profile on the iPad once — no certificate warnings after that).
Plain `npm run dev` stays http for desktop work.

### Canvas touch grammar

Touch behaviour on the output canvas is governed by **Touch Mode**
(GLOBAL section: Camera / Pad / Locked):

| Gesture | Camera mode | Pad mode | Locked |
|---------|-------------|----------|--------|
| 1-finger drag | Orbit 3D scene (endless — wraps past 360°) | Drive all mouse-X/Y-mapped params (crosshair shows the point) | — |
| 1-finger flick | Orbit coasts with momentum; touch again to stop it | — | — |
| 2-finger pinch | Zoom (scene scale) | Centroid drives pad | — |
| 2-finger double-tap | Toggle fullscreen | Toggle fullscreen | Toggle fullscreen |
| 3-finger tap | Cycle Touch Mode (flashes `MODE: …` on screen) | same | same |
| 3+ fingers held | Clutch — all gesture output suspends | same | — |

Grabbing the canvas in Camera mode takes control from auto-spin: the
current pose freezes into the rotation params and the spins zero, so
your finger owns the object. In Pad mode a crosshair marks the active
X/Y point — full brightness while touching, a faint ghost where the
values rest after release, hidden outside Pad mode.

### Mobile state bar

On mobile the 32-tile state bar becomes a hybrid row:

`[○ Clear] [＋ Save] [ scrolling state thumbnails ] [⋯ More]`

- **＋ Save** — quick-saves the current state to the next empty slot
  (same as `Shift+S`), with auto-thumbnail
- **○ Clear** — neutral state (same as the desktop ○ tile)
- **Thumbnail strip** — tap to recall; the active state is ringed and
  kept in view; **long-press a thumbnail** for Duplicate / Clear
- **⋯ More** — opens a full-screen pad grid of all 32 states with the
  same Save/Clear actions and long-press menu

### Touch editing in the panels

- **Double-tap** a parameter row → reset to default (as desktop
  double-click)
- **Double-tap** the value field or a min/max range field → inline
  numeric entry (iOS decimal pad; the ⌨ ImWeb virtual keyboard also
  types directly into the focused field — use it for negative numbers,
  which the iOS decimal pad cannot enter)
- **Fast flick** on a parameter row → the value glides with momentum
  and friction; touching the row again, or any controller writing the
  parameter, stops the glide instantly. Slider drags position
  absolutely and never glide.
- **Long-press** a controller badge → controller settings popover;
  long-press a row → full context menu. Every long-press in ImWeb is
  the same 400 ms.

### Desktop canvas controls (mouse / trackpad)

The same grammar reaches the desktop, gated on the same Touch Mode
(Camera mode):

| Input | Action |
|-------|--------|
| Left-drag on canvas | Orbit the 3D scene — release with speed and it coasts with the same momentum as a touch flick |
| Right-drag on canvas | Pan (`scene3d.pos.x/y`) |
| Wheel / trackpad pinch | Zoom (`scene3d.scale`) — eased so notches feel continuous; **Wheel Zoom** toggle and **Zoom Sens** live in the GLOBAL section |
| `G` key | Cycle Camera / Pad / Locked (trackpads never see 3-finger taps — macOS consumes them) |

### Camera on mobile

The status bar gains a **⇄ flip** button (front/back camera). The front
camera mirrors automatically (selfie convention) via the slot-based
**Mirror FG / Mirror BG** toggles in the Layers section — mirror flips
whatever source occupies that layer and composes with the layer's
colour correction. The **Cam Device** dropdown (Layers section) lists
all cameras once permission is granted.

---

*ImWeb v0.11 — H. Karlsson*
*Original Image/ine: Tom Demeyer, STEIM Foundation, Amsterdam*
