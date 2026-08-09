# ImWeb — Full Operation Manual

> **Version:** 0.17.0
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
2. Open the **Mix** tab to see layer routing and the main compositing parameters
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
| ↺ | Shift+Esc | Reset all parameters to defaults — the panic button |
| ⊟ / ⊞ | — | Collapse / expand all sections |
| ┄ | — | Show / hide the signal path display (hidden by default; `Shift+P` floats it) |
| ⇌ | — | Active controller assignments (the X-Map overview) |
| ◎ | I | Parameter OSD on/off |
| ▤ | U | State bar show/hide |
| Movie | M | Movie playback on/off (Deck A) |
| Camera | V | Camera on/off |
| ⇄ | — | Flip camera (front / back) |
| ⊡ | — | Send output to a second monitor / new window |
| ⬡ | — | Projection mapping — drag corner handles to reshape the output |
| ◫ | — | Ghost mode — shrink main output to a thumbnail |
| ⌨ | — | Keyboard lock — block letter/number shortcuts so typing in fields works |
| ◧ | Shift+V | Toggle output spy (small preview) |
| ⛶ | F | Fullscreen (or double-click the canvas) |
| ⏺ | — | Start/stop WebM recording |
| 📷 | — | Frame capture — pause render and export PNG frames |
| 𝔸 | N | AI Narrator |
| ⬡ | P | AI Coach (30s suggestions) |
| ⚙ | — | AI API key settings |

> ⬡ appears twice — projection mapping sits in the left cluster of the toolbar,
> the AI Coach in the group at the far right beside 𝔸 and ⚙.

Output resolution is no longer a row of toolbar buttons. It is the
`output.resolution` parameter in the Output tab — see §8.

### Tabs

Tabs follow the signal's own order — where a picture comes from, how pictures are
combined, what is done to them, where they go — with the large source editors
alongside.

| Tab | Contents |
|-----|----------|
| **Sources** | Live In (camera, sound, I/O), Media (Movie Library, Movie A, Movie B, Clip Library, stills, BG1/BG2), Generators, and taps From the Signal |
| **Mix** | Layer routing, per-layer colour, the three mix buses, keyer, displacement, warp map editor |
| **Effects** | Blend & Feedback, the post-FX chain and its ordering |
| **Output** | Output modes, LUT, interlace, recording |
| **Project** | Project save/load, AI generator, Banks, States, Step Sequencer, response curves, live GLSL |

There are **five** tabs. Phase 24 retired the separate 3D, Analog and Draw tabs:
those three are large source editors, and they are now opened as workspaces from
their own rows inside **Sources**, next to the source they belong to. Their
panels are unchanged — only the way you reach them moved.

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

### 4.3 Clip Library (live recorder)

Records short clips out of ImWeb's own signal and plays them back — a sampler
for the instrument's output, not a media importer. It sits in **Sources ▸ Media**,
below the Movie Library, and the two are easy to confuse: the Movie Library holds
files you brought in, the Clip Library holds material you *made*.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `clip.recordSrc` | SELECT | **RecordSrc** — Out / Cam / Mov / FG / BG / S1 / S2 / S3 |
| `clip.duration` | 1–30 s | Length of the next recording |
| `clip.bank` | SELECT | Bank 0–7 |
| `clip.slot` | SELECT | Slot 0–15 within the bank |
| `clip.record` | TRIGGER | Record into the current bank/slot |
| `clip.recall` | TRIGGER | Play the current bank/slot |

Eight banks of sixteen slots. Because `clip.bank`, `clip.slot`, `clip.record`
and `clip.recall` are all ordinary parameters, the whole recorder is playable
from MIDI: map slot to a knob and Record/Recall to two pads.

---

### 4.4 Stills Buffer

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
| `buffer.scatter` | 0–32 | Randomises which slot the scan reads, for a shuffled buffer |
| `buffer.grainrate` | 0.5–30 Hz | Rate at which Scatter re-rolls |

**Dedicated capture triggers** — each grabs from a specific place rather than
from `buffer.source`, so they can be mapped to separate pads:

| Parameter | Description |
|-----------|-------------|
| `buffer.cap_screen` | **Screen→Buffer** — capture the current output |
| `buffer.cap_video` | **Video→Buffer** — capture the camera |
| `buffer.cap_movie` | **Movie→Buffer** — capture the playing movie |
| `screen.bg1` | **Freeze BG1** — hold the current frame as the BG1 source |
| `screen.bg2` | **Freeze BG2** — same, for BG2 |

`screen.bg1` / `screen.bg2` are what make the **BG1** and **BG2** sources useful:
they freeze a plate you can then key or mix against while the live picture moves.

Slots can be individually **protected** (lock icon in the Stills Buffer panel) to
prevent auto-overwrite. Total slot count is `rows × cols`, capped at 64 (8×8).

---

### 4.5 Color Source

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

### 4.6 Noise (BFG Fractal Noise)

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
| `noise.sharpen` | 0–100% | Hardens the gradient between light and dark, taking the field from cloud toward cell structure |

Rendered to a 512×512 GPU texture. Smooth animation when speed ≠ 0.

---

### 4.7 3D Scene

Full Three.js 3D scene rendered to a WebGL render target.

#### Built-in geometries

Sphere, Cube, Torus, Icosahedron, Cone, Pyramid, Plane, Ring, Octahedron, Dodecahedron, Tetrahedron

#### Importing models

Drop `.glb / .gltf / .obj / .stl / .dae` onto the canvas, or use the import
button in the 3D workspace (opened from its row in **Sources**). Models auto-fit
to a 2×2×2 bounding box on load.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.norm` | 0.1–10 | **Normalization** — multiplies the auto-fit scale. **Imported models only** — it has no effect on built-in geometry, which uses `scene3d.scale` alone. Raise it if a model comes in too small to see |

#### Parameters — Transform

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.active` | TOGGLE | Include in render |
| `scene3d.geo` | SELECT | Built-in geometry |
| `scene3d.rot.x/y/z` | 0–360° | Static rotation |
| `scene3d.spin.x/y/z` | 0–360°/sec | Auto-rotation speed |
| `scene3d.pos.x/y/z` | −5 – 5 | Position offset |
| `scene3d.pos.screenspace` | TOGGLE | **Screen XY** — reinterpret X/Y as normalised screen coordinates, ±1 being the edge of frame. Position converts through the camera FOV and distance, so the object lands where you point it regardless of how the camera is set |
| `scene3d.scale` | 0.1–10 | Scale |
| `scene3d.wireframe` | TOGGLE | Wireframe render |

#### Parameters — Camera

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.cam.fov` | 20–120° | Field of view |
| `scene3d.cam.x/y/z` | −10 – 10 | Camera position |

#### Parameters — Material

`scene3d.mat.type` (**Material Shader**) chooses the lighting model, and it
governs which of the parameters below do anything:

| Shader | Character | Reads |
|--------|-----------|-------|
| **Standard** | PBR default | roughness, metalness |
| **Physical** | Standard plus glass and coatings | + clearcoat, transmit, IOR |
| **Toon** | Banded cel shading | toonSteps |
| **Normal** | Surface normals as RGB — unlit | nothing else |
| **Matcap** | Baked-lighting look; ignores scene lights | base colour |
| **Lambert** | Cheap diffuse | — |
| **Phong** | Classic specular | — |

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.mat.type` | SELECT | Material shader — see above |
| `scene3d.mat.hue` | 0–360° | Base colour hue |
| `scene3d.mat.sat` | 0–100% | Saturation (0 = white) |
| `scene3d.mat.roughness` | 0–1 | Surface roughness |
| `scene3d.mat.metalness` | 0–1 | Metallic quality |
| `scene3d.mat.opacity` | 0–1 | Transparency |
| `scene3d.mat.clearcoat` | 0–1 | **Physical only** — a lacquer layer over the base |
| `scene3d.mat.transmit` | 0–1 | **Physical only** — light transmission. This is what makes glass |
| `scene3d.mat.ior` | 1–3 | **Physical only** — index of refraction (1.5 ≈ glass, 2.4 ≈ diamond) |
| `scene3d.mat.toonSteps` | 2–10 | **Toon only** — number of shading bands |

**Glow and rim**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.mat.emissive` | 0–1 | Self-illumination |
| `scene3d.mat.emissiveHue` | 0–360° | **Glow Hue** |
| `scene3d.mat.emissiveSat` | 0–100% | **Glow Sat** — 0 gives a white glow |
| `scene3d.mat.rim` | 0–1 | **Rim Intensity** — brightens grazing angles, separating the silhouette from the background |
| `scene3d.mat.rimHue` | 0–360° | **Rim Hue** (default 180°) |
| `scene3d.mat.envIntensity` | 0–2 | **EnvInt** — how strongly the environment is reflected |

Default material is **white** (hue=0, sat=0). Cranking up saturation enables
coloured materials. Rim is the cheapest way to keep a dark object readable over a
dark composite — reach for it before adding lights.

**Texturing and UV motion**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.mat.texsrc` | SELECT | Live texture source (None / Camera / Movie / Screen / Draw / Buffer / Noise) |
| `scene3d.mat.uvSpeedX` | −2 – 2 | **UVSpeedX** — scrolls the texture across the surface |
| `scene3d.mat.uvSpeedY` | −2 – 2 | **UVSpeedY** |

**Geometry displacement** — pushes vertices, so it changes the silhouette rather
than just the shading. Two independent sources, which sum:

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.mat.displace` | 0–2 | **Math Displace** — procedural noise displacement |
| `scene3d.mat.dispScale` | 0.1–10 | **DispScale** — spatial frequency of that noise |
| `scene3d.mat.dispSpeed` | −5 – 5 | **Disp. Speed** — how fast it evolves |
| `scene3d.mat.tDisplace` | 0–2 | **T-Displace** — displacement driven by the *texture* instead, so the live picture becomes relief |
| `scene3d.mat.dispTexScale` | 0.1–10 | **Disp. Tex Scale** |
| `scene3d.mat.dispTexProj` | SELECT | **Disp. Projection** — *UV (Skin)* wraps with the model, *Screen (Projector)* stays fixed in frame while the object turns under it |

Displacement needs vertices to move: a low-poly geometry will show faceting
rather than a smooth deformation.

#### Parameters — Cloner

Repeats the object into an array. `scene3d.clone.mode` **Off** disables the
whole system, so none of the rest costs anything until you turn it on.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.clone.mode` | SELECT | **Cloner** — Off / Grid / Ring / Line |
| `scene3d.clone.count` | 2–200 | **CloneN** — number of copies |
| `scene3d.clone.spread` | 0–10 | **Spread** — spacing between them |
| `scene3d.clone.scale` | 0.1–10 | **CloneScale** — uniform scale of the clones |
| `scene3d.clone.scalestep` | −2 – 2 | **ScaleStep** — progressive scaling along the array, for a taper |
| `scene3d.clone.twist` | −360–360° | **Twist** — progressive rotation along the array |
| `scene3d.clone.scatter` | 0–10 u | **Scatter** — random displacement per clone |

**Wave** — a travelling offset through the array, which is what makes a cloner
read as motion rather than as a static pattern:

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.clone.wave` | −5 – 5 Hz | **Wave** — travel speed. 0 holds the wave still |
| `scene3d.clone.waveshape` | SELECT | Sine / Square / Triangle / Sawtooth |
| `scene3d.clone.waveamp` | 0–10 u | **WaveAmp** — displacement depth |
| `scene3d.clone.wavefreq` | 0.1–10 | **WaveFreq** — how many wavelengths span the array |

#### Parameters — Metaballs

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.blob.amount` | 0–5 u | **Metaball Amount** — 0 is off |
| `scene3d.blob.scale` | 0.1–10 | **Metaball Scale** |
| `scene3d.blob.speed` | −5 – 5 Hz | **Metaball Speed** |

#### Parameters — Animation (imported models)

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.anim.active` | TOGGLE | **Anim On** |
| `scene3d.anim.select` | SELECT | **Animation** — clips found in the loaded file. Reads *None* until a model with animation is imported |
| `scene3d.anim.speed` | −2 – 2 | **Anim Speed**. Negative runs the clip backwards |

Dropping a `.glb` with animation switches the scene and its animation on
automatically.

#### Parameters — Depth Pass

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.depth.active` | TOGGLE | Render depth map to DisplaceSrc |
| `scene3d.depth.mode` | SELECT | 0=Depth / 1=Normals |

#### Parameters — Lighting

Three lights: ambient, one directional, one point.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `scene3d.light.ambient` | 0–2 | **Ambient** — fills the shadows. Default 0.4 |
| `scene3d.light.intensity` | 0–2 | **Light Int.** — directional strength |
| `scene3d.light.dirX` | −10 – 10 | **Light X** — direction of the key light |
| `scene3d.light.dirY` | −10 – 10 | **Light Y** |
| `scene3d.light.dirZ` | −10 – 10 | **Light Z** |
| `scene3d.light.point` | 0–5 | **Point Int.** — blue-tinted point light. Default 0.6 |

The light direction params are worth assigning controllers to: an LFO on
`dirX` swings the key light across the object, which reads as far more motion
than rotating the object itself.

---

### 4.8 Slit Scan Buffer

Classic slit-scan effect: reads a thin strip of pixels each frame and accumulates over time.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `slitscan.active` | TOGGLE | Enable |
| `slitscan.source` | SELECT | **Slit src** — source the strip is read from |
| `slitscan.pos` | 0–100% | Slit position in source |
| `slitscan.speed` | 0.5–60 fps | Advance rate |
| `slitscan.axis` | SELECT | Vertical / Horizontal / Centre-V / Centre-H |
| `slitscan.width` | 1–16 px | Strip width per tick |
| `slitscan.clear` | TRIGGER | Zero the buffer |

---

### 4.9 Draw Layer

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
| `draw.inkSource` | SELECT | **InkSource** — Color / Camera / Movie / MovieB / Noise / Output. The brush paints *with a live source* instead of a flat colour, so a stroke reveals video through its own shape |
| `draw.pressure.size` | 0–100% | **PressSize** — how much stylus pressure drives brush size. Default 100% |
| `draw.pressure.opacity` | 0–100% | **PressOpacity** — pressure to opacity. Default 0 |
| `draw.toParticles` | TOGGLE | **StrokeEmit** — strokes emit particles as you draw |

Canvas is 1024×1024 and persists across frames. Map `draw.x` and `draw.y` to
mouse for interactive drawing.

`draw.inkSource` is the one worth trying first: set it to Camera and the drawing
is not a mark on top of the picture, it *is* the picture, appearing only where
you have drawn.

Pressure needs a stylus that reports it — the pressure params do nothing under a
mouse or a plain finger.

#### Stroke loopers (×3)

Record a gesture and let it replay itself, so a drawn mark becomes an animation.

| Parameter | Type | Description |
|-----------|------|-------------|
| `drawloop1.rec` | TRIGGER | **Loop1Rec** — start/stop recording strokes |
| `drawloop1.play` | TOGGLE | **Loop1Play** — replay the recorded gesture |
| `drawloop1.speed` | — | **Loop1Speed** — replay rate |
| `drawloop1.clear` | TRIGGER | **Loop1Clear** |

Three independent loopers (`drawloop1`, `drawloop2`, `drawloop3`).

---

### 4.10 Text Layer

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
| `text.bgOpacity` | 0–100% | Background opacity |
| `text.letterspacing` | −20–50 | **LetterSpc** — tracking |
| `text.rotation` | −180–180° | **TextRot** |
| `text.outlineHue` | 0–360° | Outline colour |
| `text.outlineSat` | 0–100% | Outline saturation |
| `text.shadowX` | −50–50 | Drop shadow offset |
| `text.shadowY` | −50–50 | Drop shadow offset |
| `text.shadowBlur` | 0–40 px | Drop shadow blur |
| `text.advance` | TRIGGER | Step to next character / word / line |

Enter text content in the Text panel's textarea. Assign `text.advance` to a key
or MIDI note for live text performance.

#### Advancing and content slots

| Parameter | Range | Description |
|-----------|-------|-------------|
| `text.autoplay` | TOGGLE | **AutoPlay** — advance on a clock instead of by trigger |
| `text.rate` | 0–20 Hz | **AdvRate** — that clock's speed |
| `text.contentIdx` | 0–63 | **ContentIdx** — which stored text block is showing |
| `text.auto` | 0–10 Hz | **AutoHz** — auto-cycle through content slots |
| `text.progress` | 0–100% | Position through the current text, as a scrubbable value |

`text.contentIdx` is the performance control: store up to 64 blocks of text and
drive the index from a controller, a MIDI note or the step sequencer.

#### Animation

Two independent layers of motion — a continuous one and a per-advance transition.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `text.animMode` | SELECT | **AnimMode** — None / Bounce / Wave / Fade / Typewriter. Runs continuously |
| `text.animSpeed` | 0–10 | **AnimSpeed** |
| `text.animAmt` | 0–100 | **AnimAmt** — depth of the effect |
| `text.anim.in` | SELECT | **AnimIn** — None / Fade / FadeUp / FadeDown / Scale / Blur / TypeOn |
| `text.anim.out` | SELECT | **AnimOut** — None / Fade / FadeDown / FadeUp / Scale / Blur / Vanish |
| `text.anim.dur` | 0.05–2 s | **AnimDur** — transition length |
| `text.anim.ease` | SELECT | **AnimEase** — Linear / EaseIn / EaseOut / EaseInOut / Bounce / Spring |

`animMode` is an idle behaviour; `anim.in` / `anim.out` fire on each advance.
They compose — a Wave that types on and fades out.

---

### 4.11 Particle System

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
| `particle.spread` | 0–100% | **PSpread** — angular spread of initial velocity |
| `particle.emitter` | SELECT | **PEmitter** — Box / Ring / LineH / LineV / Point |
| `particle.emitx` | 0–100% | **PEmitX** — emitter position |
| `particle.emity` | 0–100% | **PEmitY** |
| `particle.masksrc` | SELECT | **PMaskSrc** — a source whose brightness masks where particles may live |

`particle.masksrc` offers the **full source list**, not a short hardwired set —
mask the field with the camera, a mix bus, Motion Extraction or a depth
companion. Particles respawn at a position drawn from the emitter shape when
their life expires.

---

### 4.12 Sequencer Buffers (×3)

Record any source to a rolling frame buffer and loop it.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `seq1.active` | TOGGLE | **Seq1 Rec** — record / play |
| `seq1.source` | SELECT | Source to record |
| `seq1.size` | 4–480 frames | **Seq1 Frames** — loop length |
| `seq1.speed` | −300–300% | **Seq1 Speed** — playback rate. Negative plays the loop backwards |

Three independent sequencers (seq1, seq2, seq3). Each frame is a full-resolution render target; large frame counts consume significant VRAM.

---

### 4.13 Vectorscope (Audio Visualiser)

Real-time audio visualisation as a source texture.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `vectorscope.mode` | SELECT | Lissajous / Waveform / FFT |
| `vectorscope.gain` | 0.1–5 | Amplitude scaling |
| `vectorscope.decay` | 0–1 sec | Trail decay |
| `vectorscope.color` | 0–360° | Display hue |
| `vectorscope.linewidth` | 0.5–15 px | **VScope Width** — trace thickness |
| `vectorscope.glow` | 0–50 px | **VScope Glow** — bloom around the trace |

---

### 4.14 Analog TV

Self-contained 720x480 analog signal simulator.

| Parameter | Type | Range | Description |
|-----------|------|-------|-------------|
| `analog.sourceType` | SELECT | — | Base input to the analog pipeline — see below. |
| `analog.crop43` | TOGGLE | — | Applies hard 4:3 letterboxing to the signal. Defaults on |
| `analog.brightness` | SLIDER | -100–100% | Base signal brightness lift. |
| `analog.contrast` | SLIDER | 0–200% | Signal contrast multiplier. |
| `analog.saturation` | SLIDER | 0–200% | Color burst saturation. |
| `analog.hueOffset` | SLIDER | -180–180° | Signal phase/hue shift. |

#### Signal types (`analog.sourceType`)

Live pictures — **Camera**, **Movie**, **Buffer**, **Noise**, **3D Scene**,
**Draw**, **Output** — feed a real source through the analog pipeline.

Generated test signals — **Snow**, **SMPTE 75%**, **SMPTE 100%**, **Rainbow**,
**Gray Steps**, **Multiburst**, **Crosshatch** — synthesise the classic bars and
patterns.

**Teletext** is the last entry. It is a *signal type of this source*, not a
routable source in its own right: selecting it reveals the **Teletext ▸ page
navigation** panel and forces `analog.crop43` off. Pages are drawn from the
built-in page set, with cursor, sub-page and item-open triggers exposed as
parameters so a page can be navigated from MIDI or the step sequencer. In reader
mode the arrow keys page through and Escape exits.

---

### 4.15 SDF (Signed Distance Field Raymarcher)

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

### 4.16 Rutt-Etra Scan Processor

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

### 4.17 Warp Tape

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

**It is not a slit-scan**, despite the historical name. A slit-scan takes one
fixed source column and spreads it across every output column — that is the Slit
Scan Buffer (§4.8), which remaps *space*. The Warp Tape writes one column of
video per frame at a moving head and reads the whole tape as a frame, so output
column X shows source column X as it was *(writeIdx − X)* frames ago. Static
content passes through untouched; moving content shears.

**Why it coexists with Time Displace (§4.18).** They overlap, and neither should
absorb the other. The Warp Tape stores one *column* per time step, so ~8 MB buys
1920 time steps at full resolution. Time Displace stores a whole *frame* per step
because its delay map is arbitrary per-pixel, so 120 frames at 640×480 costs
~147 MB. For an axis-aligned monotonic gradient the tape is ~18× cheaper and
sharper; for a radial or noise-driven map it cannot express the map at all. The
tape is the fast path, the ring is the general case.

> **The retired `vasulka.*` parameters.** An older, unrelated shader effect used
> the `vasulka.` namespace (`vasulka.active`, `freqh`, `freqv`, `amph`, `ampv`,
> `phase`, `freq2`, `amp2`, `color`). It is **deprecated and not reachable**: it
> is commented out of `DEFAULT_FX_ORDER` and has no panel, so the parameters
> exist but nothing in the running app sets them or renders them. The handler is
> kept only so a saved preset that references it does not crash on load. Its job
> — temporal slit-scan — is done by the Warp Tape and by Time Displace. Do not
> map controllers to `vasulka.*`; the namespace to use is `vwarp.*` above.

---

### 4.18 Time Displace

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

### 4.19 Mix Buses (×3)

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

### 4.20 Depth Companions

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

#### Mirroring

| Parameter | Type | Description |
|-----------|------|-------------|
| `mirror.fg` | TOGGLE | **Mirror FG** — horizontally flip the Foreground layer |
| `mirror.bg` | TOGGLE | **Mirror BG** — same for Background |

Mirroring per *layer* means it applies to whatever that layer is routed to. The
older per-source toggles — `mirror.camera`, `mirror.movie`, `mirror.buffer` — are
labelled **(legacy)** in the panel and kept only so pre-existing states keep
rendering as they did. Use the layer toggles for new work.

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

Composite FG over BG using a blend mode.

| Parameter | Type | Description |
|-----------|------|-------------|
| `layer.fg.blend` | SELECT | **FG Blend** — how FG combines with BG. `Copy` bypasses the blend entirely (FG replaces BG) and ignores Blend Amt |
| `layer.fg.blendAmount` | 0–100 % | **Blend Amt** — three-stop crossfade: 0 % = BG alone, 50 % = the blend at full strength (default), 100 % = FG alone |
| `layer.bg.blend` | SELECT | **BG Self-process** — blends BG against *itself*, not against FG |
| `layer.bg.blendAmount` | 0–100 % | **Self-proc Amt** — depth of the self-process |

All four take the same 22 modes:

**Copy** · **XOR** · **OR** · **AND** — the bit-level operations, and the ones
that give the instrument its Image/ine character.

**Multiply** · **Screen** · **Add** · **Subtract** · **Difference** ·
**Exclude** · **Divide** — arithmetic.

**Overlay** · **Hardlight** · **Softlight** · **Dodge** · **Burn** ·
**PinLight** · **VividLight** — contrast blends.

**Hue** · **Saturation** · **Color** · **Luminosity** — component blends, which
take one attribute from FG and the rest from BG.

`layer.bg.blend` is worth singling out: it is a *self-process*, so it operates on
the Background layer alone. It is how you get a layer to chew on itself without
spending the FG slot on a copy of it.

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
| `keyer.extkey` | TOGGLE | Key from an external source instead of FG brightness |
| `keyer.keysrc` | SELECT | **Which** source supplies that external key. Defaults to `DS Src`, which is the old `extkey` behaviour; any source in the list can be chosen instead |
| `keyer.rawkey` | TOGGLE | Key the raw FG, before per-layer colour correction |
| `keyer.alpha` | 0–1 | Alpha multiplier |
| `keyer.alpha_inv` | TOGGLE | Invert alpha |
| `keyer.alpha_emissive` | TOGGLE | Treat alpha as emissive — keyed-out areas add light rather than cutting a hole |
| `keyer.and_displace` | TOGGLE | Key after displacement pass |

**The keyer is where transparency comes from.** Layers in ImWeb do not composite
by alpha — `BLEND` is `mix(curr, prev, amount)` — so the keyer is the only stage
that can make part of a picture disappear. `keyer.keysrc` is what makes that
useful: point it at **Motion Extraction** (§5.10) and only the moving part of a
layer survives; point it at Noise, a mix bus, or a depth companion for anything
else.

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

Mix the current frame with previous frames, with a transform applied to the
recirculated frame before blending. Lives in the **Effects** tab, in the
**Blend & Feedback** section.

#### Blend and loop transform

| Parameter | Range | Description |
|-----------|-------|-------------|
| `blend.active` | TOGGLE | Enable |
| `blend.amount` | 0–100% | Mix with previous frame |
| `feedback.active` | TOGGLE | Enable the loop transform |
| `feedback.hor` | 0–100% | Horizontal pan of previous frame |
| `feedback.ver` | 0–100% | Vertical pan |
| `feedback.scale` | 0–100% | Scale change (100% = 1.5×) |
| `feedback.rotate` | −180–180° | Rotation of previous frame |
| `feedback.zoom` | 0–100% | Zoom (for infinite zoom effects) |
| `feedback.centerx` | 0–100% | **FBCenterX** — origin the zoom/rotate turn about |
| `feedback.centery` | 0–100% | **FBCenterY** — same, vertically |

At 100% blend with `feedback.zoom` > 0 and `feedback.rotate` > 0 you get
infinite tunnel / spiral effects. Moving the centre off 50/50 makes the tunnel
run into a corner instead of the middle of frame.

#### Loop shaping

Everything below acts on the **recirculated frame only**, before it is blended
with the live one. That distinction is the whole point: `output.fade` and
`output.colorshift` already sit inside the loop, so they can damp or tint a
trail — but only by damping or tinting the live picture along with it. These
do it to the trail alone.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `feedback.decay` | 0–100% | **FBDecay** — attenuation per pass. 100% is ×1, no attenuation. Below 100% the trail dies out on its own instead of accumulating until it eats the picture |
| `feedback.blur` | 0–100% | **FBBlur** — softens the trail each pass, so it diffuses as it ages |
| `feedback.hue` | −180–180° | **FBHue** — rotates the trail's hue per pass, giving rainbow decay |
| `feedback.edge` | SELECT | **FBEdge** — Clamp / Mirror / Wrap / Black. What the transform samples when it reaches off-frame |
| `feedback.mirror` | SELECT | **FBMirror** — Off / H / V / Both, applied to the recirculated frame |
| `feedback.mode` | SELECT | **Feedback Mode** — how the trail combines with the live frame: Off, XOR, OR, AND, Multiply, Screen, Add, Difference, Exclude, Overlay, Hardlight, Softlight, Dodge, Burn, Subtract, Divide, PinLight, VividLight, Hue, Saturation, Color, Luminosity |

**`feedback.decay` is the control to reach for first** when feedback runs away.
Every default in this group is the identity — decay 100%, centre 50/50, Clamp,
blur 0, hue 0, mirror Off — so old states, banks and `.imweb` files render
pixel-identically to before these existed.

---

### 5.9 ColorShift

| Parameter | Range | Description |
|-----------|-------|-------------|
| `output.colorshift` | 0–100% | Hue rotation (0=none, 100=full 360° rotation) |

---

### 5.10 Post-FX Chain

The following effects run in sequence after the main composite. Their order can be changed by dragging nodes in the Signal Path display.

#### Chain-wide controls

| Parameter | Type | Description |
|-----------|------|-------------|
| `effect.enable` | TOGGLE | **All FX** — master bypass for the whole chain. Default on |
| `effect.clearall` | TRIGGER | **Clear All FX** — reset every effect parameter to its default |

**All FX is a bypass, not a mute.** Every parameter keeps its value and the chain
keeps its order, so switching it back on returns exactly the look you left. It
skips the loop rather than each handler, so a bypassed chain costs nothing. It is
a real parameter, not a panel button — MIDI-mappable, controller-drivable, and
captured by Display States.

**Clear All FX** deliberately does *not* touch the chain order (an arrangement you
built on purpose) or the master toggle — clearing the effects and leaving them
bypassed would look like the reset had failed.

#### Kaleidoscope

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.kaleidoscope` | 0–1 | Intensity |
| `effect.kalerot` | 0–360° | Pattern rotation |
| `effect.kalecx` | 0–100% | **Kale.CenterX** — mirror origin |
| `effect.kalecy` | 0–100% | **Kale.CenterY** |
| `effect.kaleedge` | SELECT | **Kale.Edge** — Clamp / Mirror / Wrap / Black. Defaults to Mirror (seamless); Wrap reproduces the old behaviour |

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
| `effect.edge_color` | TOGGLE | **EdgeColor** — keep the source colour in the edges instead of grey |

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
| `effect.solarsoft` | 0–50% | **Sol.Soft** — softens the inversion knee |

#### Film Grain & Scanlines

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.grain` | 0–1 | Noise intensity |
| `effect.scanlines` | 0–1 | Horizontal line intensity |
| `effect.scancount` | 20–1200 | **Scan.Count** — number of scanlines across the frame (400 was the old hardcoded value) |

#### Bloom (Glow)

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.bloom` | 0–1 | Bloom strength |
| `effect.bloomthresh` | 0–1 | Brightness threshold |
| `effect.bloomradius` | 0.25–4× | **BloomRadius** — kernel spacing. 1× is the original fixed kernel |

#### Vignette

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.vignette` | 0–1 | Strength |
| `effect.vigradius` | 0.1–2 | Radius of vignette circle |
| `effect.vigcx` | 0–100% | **Vign.CenterX** — off-centre vignettes |
| `effect.vigcy` | 0–100% | **Vign.CenterY** |
| `effect.vighue` | 0–360° | **Vign.Hue** — hue of the vignette itself |
| `effect.vigtint` | 0–100% | **Vign.Tint** — how much of that hue to apply, instead of plain black |

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

#### Polar

Maps the frame between rectangular and polar coordinates, in both directions.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.polar` | 0–100% | Amount |
| `effect.polarmode` | SELECT | **Wrap** (rectangular → polar) or **Unroll** (polar → rectangular) |
| `effect.polarrot` | 0–100% turn | Rotation of the mapping |

Polar turns every other effect in the chain into a different one: put it before
Scanlines and the lines become rings; before a horizontal wipe and the wipe
becomes a sweep. Its position in the chain order matters more than its amount.

#### Wave

Sine displacement per axis.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.wavex` | 0–100‰ | **Wave.AmpX** — horizontal amplitude |
| `effect.wavey` | 0–100‰ | **Wave.AmpY** — vertical amplitude |
| `effect.wavefx` | 0–60 | **Wave.FreqX** |
| `effect.wavefy` | 0–60 | **Wave.FreqY** |
| `effect.wavephase` | 0–100% turn | **Wave.Phase** — made to be driven by an LFO |

Each axis is displaced by the *other* axis's coordinate, which is what makes
this a wave rather than a smear. Assign an LFO to `effect.wavephase` to set it
travelling.

#### Halftone

Ordered dot screen.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.halftone` | 0–100% | Amount |
| `effect.halfsize` | 2–40 px | **Half.Size** — dot pitch |
| `effect.halfangle` | 0–90° | **Half.Angle** — screen angle |
| `effect.halfmode` | SELECT | **Mono** or **Colour** |

In Colour mode each channel gets its own screen angle, so the three grids
rosette instead of beating into moiré.

#### Duotone

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.duotone` | 0–100% | Amount |
| `effect.duohue1` | 0–360° | **Duo.Dark** — hue the shadows map to |
| `effect.duohue2` | 0–360° | **Duo.Light** — hue the highlights map to |

Remaps luminance through a two-colour ramp.

#### Lens & Twirl

Two geometric warps sharing a centre and an edge mode.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.lens` | −100–100% | **Lens** — barrel (positive) / pincushion (negative) distortion |
| `effect.twirl` | −100–100% turn | **Twirl** — rotation strongest at the centre, falling to zero by half-radius, so the middle winds up and the rim stays put |
| `effect.warpcx` | 0–100% | **Warp.CenterX** |
| `effect.warpcy` | 0–100% | **Warp.CenterY** |
| `effect.warpedge` | SELECT | **Warp.Edge** — Clamp / Mirror / Wrap / Black. Defaults to Mirror, which is seamless and the least like a mistake at the corners |

#### Strobe

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.strobe` | TOGGLE | Enable |
| `effect.stroberate` | 0.5–60 Hz | **StrobeRate** |
| `effect.strobeduty` | 1–99% | **StrobeDuty** — proportion of each cycle that is lit |

> Photosensitivity: flash rates of roughly 3–30 Hz carry the highest seizure
> risk, which is most of this control's range. Worth a warning before pointing
> it at an audience.

#### Sharpen, Flip & Output Grade

The tail of the chain — small global adjustments rather than looks.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `effect.sharpen` | 0–100% | Unsharp mask |
| `effect.flip` | SELECT | Off / H / V / Both |
| `effect.outhue` | −180–180° | **Out.Hue** |
| `effect.outsat` | 0–200% | **Out.Sat** (100% = unchanged) |
| `effect.outbright` | 0–200% | **Out.Bright** (100% = unchanged) |

#### Video Delay Line

Replays a source some number of frames late, out of a ring buffer.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `delay.source` | SELECT | **Delay src** — what is recorded into the ring. Defaults to Output |
| `delay.frames` | 1–480 fr | **Delay** — how far back to read |
| `delay.size` | SELECT | **Ring depth** — 30 (0.5s) / 60 (1s) / 120 (2s) / 240 (4s) / 480 (8s) |
| `delay.bufferResolution` | SELECT | **Buffer res** — Native / 640×480 / 640×360 / 320×240. The main VRAM control |

The ceiling on `delay.frames` is a request, not a promise: the achievable depth
is lower whenever the ring is shorter or VRAM clamped it, and asking for more
frames than have been captured holds at the oldest available frame rather than
dropping to black.

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

**Moving the camera is a gesture, not a malfunction.** The background model
assumes a fixed camera: it is a picture of the scene, and only things that move
against it register. Pan, tilt or handhold and every pixel is suddenly looking
at a different part of the world than the background holds, so the matte opens
across the whole frame rather than isolating a subject. At `Bg adapt` 0 this
reads as an edge-detector on the whole image and recovers the instant you stop;
at longer settings it floods, and takes the adapt time to settle afterwards.

That is worth playing with rather than avoiding — whip the camera and the frame
ignites, hold still and it resolves back to bodies. What it is *not* is a way to
key a clean silhouette while the camera moves; nothing in this engine tracks the
camera, so if you need a stable subject matte, lock the camera off.

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
| Frequency | 0.001–20 Hz | Free-running rate (0.001 Hz = one cycle per ~17 minutes) |
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
| Frequency | 0.001–20 Hz | How often a new random value is picked |

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
| **Set Slew** | Add lag (enter time in seconds, optionally `ease` or `lag`) |

**Slew** adds smooth easing to a controller's output. For example, 0.5 sec slew on Sound makes audio reactivity feel organic rather than jittery.

**Slew curve** — the badge popover has a *Slew curve* selector, and the Set Slew
prompt accepts a curve word after the time (`0.4 bounce`). The menu is in two
groups, and the split is real rather than cosmetic.

***Any source*** — filters. No clock, no fixed endpoint: they simply chase
whatever the target is right now, so they behave the same whether the source
steps or sweeps.

| Curve | Word | Motion | Use for |
|-------|------|--------|---------|
| **Lag** (default) | `lag` | One-pole exponential. Fastest at the instant the target moves, then crawls the last of the way in. | Taming jitter — Sound, tilt, MIDI faders. |
| **Ease in/out** | `ease` | Critically damped spring. Leaves and arrives at zero velocity, so movement gathers speed and then sets down. | Almost anything. The safe default when Lag snaps too hard. |
| **Elastic (springs)** | `elastic` | The same spring *underdamped*. Sets off from rest, overshoots by about a fifth of the move, and rings into place over roughly one and a half times the slew time. | Anywhere you want the movement to feel sprung rather than driven. |

***Stepped sources*** — timed curves. These run a clock from a captured start
value to the target over exactly the slew time, which is the only way to
overshoot, ring or bounce. Built for **S&H, Random, Square and MIDI notes**.

| Curve | Word | Motion |
|-------|------|--------|
| **Super Ease in/out** | `ease2` | Quintic. Ease's shape with a much flatter start and finish — a long loiter at each end. |
| **Exponential** | `expo` | Barely moves, then rushes through the middle and pins. The most dramatic non-overshooting curve. |
| **Bounce** | `bounce` | Arrives, then settles in four decreasing hops. |
| **Back (overshoot)** | `back` | Pulls *backwards* first (anticipation), then overshoots past the target and eases back. |

Three things worth knowing about the stepped group:

- **On a continuously sweeping source they add ripple rather than smoothing it.**
  Measured against a 0.5 Hz sine at 0.3 s slew, Lag and Ease smooth it to a
  clean trail; the timed curves pass the full swing through with roughly 25–50×
  the frame-to-frame jerk. They are not broken there, they are simply the wrong
  tool — use Lag or Ease for LFO sweeps.
- **They land exactly on the target**, and in exactly the slew time. The filters
  are asymptotic and arrive a hair short, which you can see if you drive four
  quick S&H steps: Lag reaches 0.209 when asked for 0.2, `bounce` reaches 0.200.
- **Back needs headroom.** It travels outside the move at both ends, so near the
  top or bottom of a parameter's range the `min`/`max` clamp flattens the
  anticipation or the overshoot and it looks like an ordinary ease.

### Strength and Damp

The two curves that travel past their target get extra rows in the popover.

**Elastic** gets both. They are the two constants of a spring and they are
independent of each other:

| Field | Range | What it does |
|-------|-------|--------------|
| **Strength** | 0.25–4, default 1 | Stiffness. Higher is tighter and faster: more rings packed into the same Slew time, and a quicker settle. |
| **Damp** | 0.05–1, default 0.45 | Damping. Lower throws further past the target and rings longer. **At 1.00 the overshoot disappears entirely** — Elastic becomes Ease in/out. |

Slew still sets the overall time base. Damp owns how *far* it throws, Strength
owns how *fast* it gets there.

**Back** gets **Strength** only, 0–3, default 1. It scales the single constant
governing both of Back's lobes, so the anticipation and the overshoot grow and
shrink together:

| Strength | Anticipation / overshoot |
|----------|--------------------------|
| 0 | none at all — a plain in/out ease |
| 0.5 | ±3.1% of the move |
| 1 (default) | ±10.0% |
| 2 | ±27.0% |
| 3 | ±45.3% |

Back has **no Damp**, and that is deliberate rather than an omission: damping
describes how a *ring* decays, and Back has no ring. It makes one excursion at
each end and stops.

### What overshoot does at the ends of the scale

Elastic and Back deliberately travel past the target. A parameter cannot.

**Elastic bounces off `min` and `max` rather than pressing against them.** The
overshoot is a fraction of the *move*, so a large move landing near a rail
throws well past it — with nothing done about that, the value simply parks flat
on the limit for a third of a second and the character vanishes exactly where
S&H puts it most often. Instead the spring collides with the rail, reversing and
keeping part of its speed, so the excursion that cannot be shown outwards is
shown inwards as a rebound:

```
0.05 → 1.0 (into the ceiling):  0.076 0.354 0.719 1.000 0.918 0.903 0.929 0.966 0.997 0.993 …
0.95 → 0.0 (into the floor)  :  0.924 0.646 0.281 0.000 0.082 0.097 0.071 0.034 0.003 0.007 …
```

One frame on the limit, then a clear rebound. How lively that bounce is follows
**Damp** — a springier spring rebounds further, and at Damp 1.00 it does not
bounce at all, which is correct because at that setting it never overshoots.

A move that had headroom to begin with is completely unaffected; the rail
logic only engages on contact.

**Back** is a timed curve rather than a spring, so it has no velocity to
reverse and cannot bounce. Instead each of its two lobes is **fitted to the room
in front of it**:

- A move that **starts** on a rail cannot dip backwards first. The dip is scaled
  to whatever room exists — and squeezed in *time* as well, so the value leaves
  immediately rather than waiting out a dip it cannot make. Without that it sat
  frozen for about a sixth of a second at the top of every move beginning at the
  bottom of the range.
- A move that **ends** on a rail cannot overshoot. The overshoot is scaled to the
  room beyond the target, shrinking to nothing when the target is the rail
  itself.

The fit is gradual, so a move starting at 0.02 gets a small dip and one starting
at 0.20 gets the full one. A move with room at both ends is completely
unaffected.

There is no way around the second case: if a controller drives a parameter to
exactly its maximum, nothing can travel past it. Give the controller a
**min/max sub-range** on the parameter row if you want Back's overshoot
everywhere. Reducing the slew time does not help — the overshoot is a fraction
of the move, not of the time.

Note that a **response table is not a slew curve**. Tables reshape *what value*
a controller produces (amplitude); slew shapes *how the value travels in time*.
Putting an S-curve table on an S&H changes which random values come out, not how
abruptly the picture arrives at them — that is what the Slew curve is for.

---

### External Mapping (X-Map)

One controller can modulate parameters of another controller.

| X-Map Target | Description |
|--------------|-------------|
| hz | Modulate LFO frequency, 0.001–20 Hz **logarithmically** |
| amp | VCA-style amplitude scaling |
| value | Direct override of controller output |

**The `hz` target sweeps in octaves, not in Hz.** Rate is heard as a ratio, so
an equal move anywhere on the controller's travel gives an equal *multiplication*
of the rate. Where the useful rates sit:

| Rate | Controller travel |
|------|-------------------|
| 0.001 Hz | 0% |
| 0.01 Hz | 23% |
| 0.1 Hz | 47% |
| 0.5 Hz | 63% |
| 1 Hz | 70% |
| 5 Hz | 86% |
| 20 Hz | 100% |

The bottom of the travel is 0.001 Hz, never 0 — a stopped LFO is not a slow one,
and there is no way to tell them apart while playing.

> **Changed behaviour.** This mapping used to be linear (`travel × 20 Hz`), which
> put everything below 0.5 Hz in the bottom 2.5% of the range and produced a dead
> stop at zero. An X-map on `hz` saved before this change will play much slower:
> mid-travel moves from 10 Hz to 0.14 Hz. Re-dial affected patches.

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
| `global.tap` | TRIGGER | **Tap Tempo** (`T`) |
| `global.morph` | — | State morph time |

**Tap Tempo:** Click the BPM indicator in the status bar 2–5 times, or press `T`.
The tap interval derives BPM. All BPM-synced LFOs retrigger.

#### Clock sync

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.midisync` | TOGGLE | **MidiSync** — follow incoming MIDI clock instead of the internal BPM |
| `global.midisyncres` | 1–120 | **MidiSyncRes** — clock divisions per beat |
| `global.autosync` | 1–1000 | **AutoSync** — realign BPM-synced controllers every N beats, correcting drift |
| `global.framedone` | TOGGLE | **FrameDonePulse** — emit a pulse on each completed frame, for external sync |

#### Interface toggles

| Parameter | Range | Description |
|-----------|-------|-------------|
| `global.osd` | TOGGLE | **Param OSD** (`I`) — parameter feedback text over the canvas. Default on |
| `global.keylock` | TOGGLE | **KeyLock** (⌨) — block letter/number shortcuts so typing in fields works |
| `global.showwarpgrid` | TOGGLE | **WarpGrid** — overlay the warp map's grid on the canvas while editing |
| `global.debug` | TOGGLE | **Debug** (`D`) — diagnostic overlay |
| `global.tableSlot` | SELECT | **Table Slot** — the global response table, selectable per parameter as `'global'` |

`global.keylock` is the one to reach for before typing into a text field during
a show: without it, letters land as shortcuts. The ⌨ toolbar button toggles it.

---

## 8. Output & Recording

### Output Modes

| Mode | How | Description |
|------|-----|-------------|
| Main canvas | Default | In-app WebGL canvas |
| Fullscreen | `F` or double-click the canvas | Hides UI, maximises to screen |
| Second monitor | ⊡ button | Opens popup on any display, auto-letterbox |
| Ghost mode | ◫ button | Shrinks main output to a thumbnail |
| Output spy | ◧ or Shift+V | Small 160×90 preview |
| Projection mapping | ⬡ button | Corner-pin the output onto an off-axis surface |

**Second monitor:** The popup reads the same canvas via `window.opener` (same-origin). It auto-letterboxes to fill the display while preserving aspect ratio.

**Ghost mode** activates automatically when the second screen popup is opened, and deactivates when it is closed.

---

### Projection Mapping

Corner-pin the output so a projector hitting a surface off-axis still lands
square on it. Press **⬡** to show the corner handles and drag them; click a
handle and use the arrow keys to nudge it a pixel at a time.

| Parameter | Range | Description |
|-----------|-------|-------------|
| `projmap.active` | TOGGLE | **ProjMap On** |
| `projmap.tl_x` / `tl_y` | 0–1 | Top-left corner |
| `projmap.tr_x` / `tr_y` | 0–1 | Top-right corner |
| `projmap.bl_x` / `bl_y` | 0–1 | Bottom-left corner |
| `projmap.br_x` / `br_y` | 0–1 | Bottom-right corner |

The corners are ordinary parameters, so a mapping is saved with the project and
can be recalled per State — useful when one show plays to two surfaces.

---

### Resolution

Resolution is the `output.resolution` parameter, not a toolbar button.

| Parameter | Options | Description |
|-----------|---------|-------------|
| `output.resolution` | Display / 720p / 1080p / 540p / Quarter | Render resolution. **Display** follows the window |
| `output.interp` | none / linear / bicubic | Upscaling filter when rendering below display resolution |
| `output.solo` | TOGGLE | **Solo** (`S`) — bypass effects and show the raw composite |

Dropping to 540p or Quarter is the first thing to try when frame rate suffers;
`output.interp` set to bicubic keeps a low render resolution from looking blocky.

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

**Parameters**

| Parameter | Range | Description |
|-----------|-------|-------------|
| `glsl.target` | SELECT | Master / Foreground / Background / Displace |
| `glsl.preset` | SELECT | Mirrors the preset dropdown — built-ins plus your `user:` shaders |
| `glsl.param1`…`4` | 0–1 | The `uParam1..4` performance knobs |

> **`glsl.preset` is deliberately not captured by Display States.** Its value is
> an index into a list you can edit, so a saved state would drift the moment you
> added or deleted a user preset — and user presets are stored per browser
> origin, so the same index means different things on `:5173` and `:4173`. It is
> in group `global` for exactly that reason. Recalling it from a *controller*
> always compiles; the **Auto** checkbox only gates the manual dropdown path.
>
> If your saved shaders seem to have vanished, check the port before assuming
> data loss — "lost presets" is almost always "different origin".

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
| `G` | Cycle canvas interaction mode (Camera / Pad / Locked / Draw / Warp) |
| `F` | Fullscreen (double-clicking the canvas does the same) |
| `Shift+V` | Output spy toggle |
| `D` | Debug overlay |

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
| `Shift+Esc` | Reset all parameters to defaults — the panic button |

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
(`touch.mode`, GLOBAL section). It has five settings, and `G` cycles all of them:

| Mode | Canvas does |
|------|-------------|
| **Camera** | Orbits, pans and zooms the 3D scene |
| **Pad** | Drives every mouse-X/Y-mapped parameter |
| **Locked** | Nothing — the safe setting mid-performance |
| **Draw** | Draws into the Draw Layer (§4.9) |
| **Warp** | Draws into the warp map (§5.6) |

The gesture table below describes the first three:

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
| Wheel / trackpad pinch | Zoom (`scene3d.scale`) — eased so notches feel continuous. `canvas.wheelZoom` (**Wheel Zoom**, default on) disables it; `canvas.wheelSens` (**Zoom Sens**, 0.1–3) scales it. Both in the GLOBAL section |
| `G` key | Cycle Touch Mode — all five (trackpads never see 3-finger taps, macOS consumes them) |

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
