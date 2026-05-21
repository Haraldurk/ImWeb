# Image/ine Remake — Technical Architecture Specification
**Project codename:** `ImWeb` (working title)
**Version:** 0.4.0 — Active Development
**Date:** 2026-03-20
**Author:** Haraldur Karlsson
**Based on:** ImOs9 (STEIM, 1997) + ImX (Tom Demeyer and Steina Vasulka, 2008)

---

## 1. Project Philosophy

This is not a port. It is a **reimagining** of Image/ine's ideas — real-time layered video synthesis as a performance instrument — rebuilt on modern web infrastructure with three additions that Tom never got to:

1. **3D objects and model import** as first-class input sources, composited into the 2D pipeline
2. **All lost ImOs9 features** that never made it into ImX
3. **A redesigned UX** that retains the performance-first philosophy but is legible to new users

The core aesthetic principle from the originals stays intact: **the interface is also the performance**. No edit/performance split. Everything visible, everything controllable, everything live.

---

## 2. Platform Decision

**Target: Progressive Web App (PWA), Chrome-first**

| Concern | Solution |
|---|---|
| Live video input | `getUserMedia()` + WebRTC |
| 3D rendering + effects | WebGPU + Three.js r160+ |
| MIDI | Web MIDI API (Chrome only, no flag needed since Chrome 43) |
| OSC | WebSocket bridge (tiny local Deno/Node process, ~20 lines) |
| Audio analysis | Web Audio API `AnalyserNode` |
| File system access | File System Access API (Chrome 86+) |
| Model import | Three.js loaders: GLTFLoader (Draco), OBJLoader, FBXLoader |
| Persistence | IndexedDB for presets/states, File System Access for project files |
| Distribution | Hosted at domain, installable as PWA, no App Store |

**Why not Electron:** The overhead (200MB+, Chromium bundled) adds nothing for a tool that will always run on a desktop machine with Chrome available. A PWA installs in one click and updates automatically.

**OSC bridge note:** A companion `osc-bridge.js` script (Deno or Node, < 1KB) bridges UDP OSC → WebSocket. Users run it locally if they need OSC. For MIDI-only setups no companion process is needed.

---

## 3. Signal Path Architecture

The core compositing model follows ImOs9's three-layer architecture, extended with a 3D source layer:

```
INPUT SOURCES
─────────────────────────────────────────────────────────────
Camera (WebRTC)    Movies/clips    Stills Buffer    3D Scene
Text Layer         Draw Layer      Noise (rand1/2/3) Color
Sound (AnalyserNode as image data)

          ↓              ↓              ↓
    ┌─────────────────────────────────────┐
    │         LAYER ASSIGNMENT            │
    │  Foreground │ Background │ DispSrc  │
    └─────────────────────────────────────┘
          ↓
    ┌─────────────────────────────────────┐
    │         EFFECTS CHAIN               │
    │  Keyer → Displace → WarpMap →       │
    │  TransferMode → Feedback → Blend    │
    └─────────────────────────────────────┘
          ↓
    ┌─────────────────────────────────────┐
    │         OUTPUT                      │
    │  Canvas → fullscreen / capture      │
    └─────────────────────────────────────┘
```

All pixel operations run on the GPU via WebGPU compute shaders and Three.js render targets. The compositing pipeline is a sequence of off-screen render passes feeding into each other.

---

## 4. Technology Stack

### Rendering Core
- **Three.js r160+** — scene graph, 3D model loading, render targets
- **WebGPU** — compute shaders for displacement, keying, warp operations
- **GLSL/WGSL shaders** — all pixel-level effects (keying, displacement, noise, warp, feedback, TransferMode bitwise ops)
- **WebRTC** — live camera → Three.js `VideoTexture`
- **Web Audio API** — `AnalyserNode` → Float32Array → GPU texture (sound-as-displacement)

### Control Layer
- **Web MIDI API** — MIDI input, 14-bit resolution (coarse+fine CC), program change
- **WebSocket** — OSC bridge (UDP ↔ WS, companion process)
- **Pointer Events API** — mouse + Wacom pressure/tilt (WacomGSS where available)
- **Gamepad API** — HID joystick/gamepad support
- **Web Audio `AnalyserNode`** — sound level + frequency → controller values

### State & Persistence
- **IndexedDB** (via `idb` wrapper) — presets, states, tables, buffer snapshots
- **File System Access API** — project save/load as `.imweb` JSON bundle
- **BroadcastChannel API** — multi-window sync (second monitor support)

### UI Framework
- **Vanilla JS + CSS custom properties** — no framework overhead for the performance-critical control layer
- **Custom elements (Web Components)** — reusable UI panels without framework coupling
- **CSS Grid + custom layout** — dark, dense, information-rich UI aesthetic

### 3D / Model Import
- **Three.js GLTFLoader + DRACOLoader** — primary format (GLTF 2.0 / GLB)
- **Three.js OBJLoader + MTLLoader** — legacy OBJ support
- **Three.js FBXLoader** — FBX support
- **Three.js STLLoader** — STL for fabrication/scan imports
- **Procedural geometry** — built-in generators: sphere, torus, cube, plane, custom parametric

---

## 5. Feature Inventory — Complete Specification

### 5.1 Input Sources

| Source | ImOs9 | ImX | ImWeb | Notes |
|---|---|---|---|---|
| Live camera | ✓ | ✓ | ✓ | WebRTC, multi-camera select |
| QuickTime/movie | ✓ | ✓ | ✓ | `<video>` element → VideoTexture |
| Stills Buffer | ✓ | ✓ | ✓ | IndexedDB + WebGL texture atlas |
| Text layer | ✓ | — | ✓ | **Restored.** Canvas2D text → texture |
| Draw layer | ✓ | — | ✓ | **Restored.** OffscreenCanvas → texture |
| Color (solid HSV) | ✓ | ✓ | ✓ | Two independent color channels |
| Output (feedback) | ✓ | ✓ | ✓ | Previous frame render target |
| Sound | ✓ | — | ✓ | **Restored.** AnalyserNode → texture |
| Noise rand1/2/3 | ✓ | — | ✓ | **Restored.** Independent oscillators |
| 3D Scene | — | — | ✓ | **New.** Three.js scene → render target |
| FrameSelect 1/2/3 | ✓ | — | ✓ | **Restored.** See §5.3 |

### 5.2 Three-Layer Compositing System

Restoring ImOs9's named-layer model with semantic roles:

**Foreground** — top compositing layer; keying source; displacement target; drawing target  
**Background** — layer keyed to; what shows through foreground transparency  
**DisplaceSrc** — displacement map source; doubles as 2nd background with ExtKey active

Each layer accepts any input source. Assignment via keyboard shortcuts (F1–F10 mapping) and the layer assignment panel.

### 5.3 Stills Buffer System (Full ImOs9 model)

- **Grid:** n×n up to 20×20 cells, each cell = output resolution (default 1280×720)
- **FrameSelect 1/2/3:** Three independent frame selectors with distinct buffer zone assignments, each mappable to any controller
- **Zone protection:** Loaded stills marked as protected from capture overwrite
- **Capture sources:** Video→Buffer, Movie→Buffer, Screen→Buffer — all independently triggerable
- **CaptBuffer:** Captures buffer sequence as video clip, auto-loads as movie source
- **Insert Video:** Live camera feed placed as resizable/pannable buffer cell
- **Noise sources:** rand1 (pixel), rand2 (horizontal), rand3 (vertical) — GPU-generated
- **Pan/Scale:** PanX, PanY, Scale — full range, independently mappable
- **Buffer → movie:** Frame sequence export as WebM

### 5.4 Effects Chain

All effects implemented as WGSL/GLSL shader passes on GPU render targets.

#### Keying
- **Luminance keying** — KeyLevelWhite, KeyLevelBlack, KeySoftness
- **Alpha channel keying** — RGBA texture support with alpha toggle/invert
- **ExtKey** — 3-layer external keying (FG cuts between BG and DispSrc)
- **KeyAndDisplace** — keying pass applied after displacement

#### Displacement
- **Displace** — strength 0–100, uses DispSrc luminance to shift FG pixels
- **DisplaceAngle** — angle of displacement (0 = horizontal)
- **DisplaceOffset** — offset the displacement values
- **RotateGrey** — **Restored.** Circular displacement: white = −180°, black = +180°
- **WarpMode** — **Restored + Extended.** See §5.5

#### WarpMode (Restored & Extended)
- Interactive push/pull distortion editor on a mesh grid
- **Wave V** — vertical wave distortion
- **Wave H** — horizontal wave distortion
- **Randomize** — global random warp field
- **Reset** — restore undistorted state
- 16 storable WarpMap states (IndexedDB)
- **New:** GPU mesh deformation via WebGPU compute shader — real-time, no frame rate penalty
- **New:** Warp maps applicable to 3D mesh UV coordinates as well as 2D video

#### Compositing Modes
- **Blend** — 50/50 mix with previous frame (motion blur / ghosting)
- **TransferMode** — **Restored.** copy / xor / or / and bitwise pixel operations
- **Feedback system** — HorFeedbackOffs, VerFeedbackOffs, FeedbackScale (all mappable)
- **ColorShift** — **Restored.** Global phase shift of color values
- **Fade** — global fade in/out, automatable

#### Draw Layer (Restored)
- Draw to Foreground or DisplaceSrc via mouse, touch, or Wacom
- DrawX, DrawY, DrawPenSize, ErasePenSize, ClearDraw parameters
- LFOs draw their own waveforms as strokes when assigned to DrawX/DrawY
- **New:** Pressure-sensitive drawing via Pointer Events pressure property

#### Color System
- Hue1/Sat1/Val1 — Background color channel (16,384 hue steps)
- Hue2/Sat2/Val2 — DisplaceSrc color channel (with ExtKey active)
- All 6 parameters fully mappable, cyclable, LFO-assignable

#### Other Effects
- **Mirror** — Video, Movie, Buffer, FrameSelect1/2/3 (horizontal flip)
- **Solo** — FG layer without effects (optimal frame rate reference)
- **Interpolation** — bicubic / linear / none for buffer scaling
- **Interlace** — **Restored.** Scan line skip effect (also aesthetic, not just performance)
- **Alpha/InvertAlpha** — alpha channel keying for RGBA stills and video

### 5.5 3D Scene Integration (New)

The 3D scene is an additional input source that renders into a WebGL texture, which then flows into the compositing pipeline exactly like video or buffer input.

**Scene object types:**
- Primitive generators: Sphere, Torus, Cube, Plane, Cylinder, Capsule, TorusKnot, Parametric, + 5 more
- Imported models: GLTF/GLB (Draco), OBJ, STL
- Lights: Ambient, Directional, Point, Spot — all mappable parameters
- Camera: Perspective / Orthographic, position/rotation/FOV all mappable

**3D-specific mappable parameters:**
- Object rotation X/Y/Z (continuous)
- Object position X/Y/Z (continuous)
- Object scale (continuous)
- Camera position/rotation (continuous)
- Camera FOV / zoom (continuous)
- Light intensity, color, position (continuous)
- Material properties: roughness, metalness, emissive, opacity (continuous)
- Wireframe toggle (toggle)
- Morph targets (continuous, for GLTF models with morph data)
- UV offset / tiling (continuous — enables texture animation on 3D surfaces)

**3D as DisplaceSrc:**  
The 3D render (especially depth pass or normal pass) fed into the displacement pipeline creates dynamic, geometrically-driven image distortion — moving 3D objects literally distort the video behind them.

---

## 6. Control System

Full restoration of ImOs9's controller model, extended with ImX additions.

### 6.1 Controller Types

| Controller | ImOs9 | ImX | ImWeb | Notes |
|---|---|---|---|---|
| MIDI Controllers | ✓ | ✓ | ✓ | 14-bit resolution, all 16 channels |
| MIDI Velocity | ✓ | ✓ | ✓ | |
| MIDI Key Velocity | ✓ | ✓ | ✓ | |
| MIDI Pitch Bend | ✓ | ✓ | ✓ | |
| MIDI Pressure | ✓ | ✓ | ✓ | |
| MIDI Note Nr | ✓ | ✓ | ✓ | |
| MIDI Key Pressure | ✓ | ✓ | ✓ | Aftertouch |
| LFO — Sine | ✓ | ✓ | ✓ | |
| LFO — Triangle | ✓ | ✓ | ✓ | |
| LFO — Sawtooth | ✓ | ✓ | ✓ | |
| LFO — Square | ✓ | ✓ | ✓ | Pulse width settable |
| Mouse X/Y | ✓ | ✓ | ✓ | 32 modifier combinations |
| Mouse Button | ✓ | ✓ | ✓ | |
| Nudge (MIDI) | ✓ | ✓ | ✓ | Note duration → increment |
| Nudge (Key) | ✓ | ✓ | ✓ | Key duration → increment |
| Sound Level | ✓ | ✓ | ✓ | LogRMS, L+R channels |
| Sound Frequency | ✓ | ✓ | ✓ | Band-limited freq detection |
| Wacom Pen Pressure | ✓ | ✓ | ✓ | Via Pointer Events pressure |
| Wacom Eraser | ✓ | ✓ | ✓ | |
| Wacom X/Y | ✓ | ✓ | ✓ | |
| Wacom Tilt X/Y | ✓ | ✓ | ✓ | |
| Movie Position | ✓ | ✓ | ✓ | Absolute + Relative |
| Key (keyboard toggle) | ✓ | ✓ | ✓ | Case-sensitive |
| Fixed | ✓ | ✓ | ✓ | |
| Random | ✓ | ✓ | ✓ | Frequency + range |
| OSC | — | ✓ | ✓ | Via WebSocket bridge |
| HID (Gamepad) | — | ✓ | ✓ | Gamepad API |
| **Tables** | ✓ | — | ✓ | **Restored.** 16,384-point resolution |
| **External Mapping** | ✓ | — | ✓ | **Restored.** See §6.3 |

### 6.2 Tables (Restored)

16,384-entry response curve editor, routing parameter output through a custom curve before it reaches its target parameter.

- **Segment types:** linear, exponential, logarithmic, random, noise
- **UI:** Spline editor with draggable control points, live curve preview
- **Freehand drawing** on the curve canvas with mouse
- Coordinate display: 0–16383 (internal) + 0–127 (MIDI reference)
- Named tables, stored in IndexedDB, referenceable across presets
- Any parameter can reference a table by name

### 6.3 External Mapping / Controller Modulation (Restored)

A secondary mapping layer where controllers modulate other controllers' parameters. Each controller slot has an `X` (external) expansion that opens 20 additional global mapping slots.

**Classic use:** Sine LFO on PanX frequency → the panning speed breathes in and out.  
**Extended:** Any controller output can modulate any other controller's parameter — enabling FM-style control chains, velocity-sensitive LFO rates, pressure-controlled displacement amounts.

This is implemented as a directed modulation graph, rendered as a small patch panel in the UI.

### 6.4 LFO Details

- Sine, Triangle, Sawtooth, Square (with pulse width)
- **Modes:** `norm` (free-running, retriggered on state recall), `shot` (one cycle), `x-mapping` (triggered by external mapping)
- Phase offset settable
- Frequency: 0–50 Hz (fine control for very low frequencies via type-in)
- Negative frequency values invert waveform
- LFOs retrigger on DisplayState recall (same as ImOs9)
- **New:** LFO-of-LFO via External Mapping gives FM modulation without additional UI complexity

### 6.5 MIDI Synchronization (Restored)

- **MidiSync:** Frame update rate locked to incoming MIDI clock pulses (relative to 50fps base)
- **AutoSync:** Internal clock divisor — 1=realtime, 2=half speed, 50=1fps, 1000=1 frame/20sec
- **FrameDoneSync:** Send MIDI message on frame completion (for syncing external devices)
- Use case: non-realtime high-quality capture, single-frame advance, controlled slow motion

---

## 7. Text Layer (Restored & Extended)

Text as a full compositing input source, not just an overlay.

### Scripting Language (ImOs9 compatible + extensions)

```
{pos 0}          Screen position 0 (top-left)
{pos 1}          Screen position 1 (top-right)
{pos 2}          Screen position 2 (bottom-left)
{pos 3}          Screen position 3 (bottom-right)
{font helvetica} Font family
{size 255}       Font size (0–255)
{fcolor r,g,b}   Foreground color (0–255 per channel, or 'r' = random)
{bcolor r,g,b}   Background color
{clear}          Clear text layer
```

**New commands:**
```
{speed 0.5}      Text advance speed multiplier
{opacity 0.8}    Layer opacity
{shadow r,g,b}   Drop shadow color
{tracking 2.0}   Letter spacing
{lfo freq}       Attach size to LFO at given frequency
```

**TextAdvance** parameter — triggers next word/line, fully mappable (LFO, MIDI, key, sound).  
**TextSize** parameter — overrides current size, mappable.

Text renders via Canvas2D → WebGL texture, so it participates in displacement, keying, and warp exactly like video.

---

## 8. Program / Bank / State

### Banks
Each Bank stores:
- All parameter controller assignments (full mapping)
- Movie/clip reference
- Text file reference  
- Buffer contents (as IndexedDB references)
- 3D scene description (object list, camera, lights)
- All table references used
- UI layout snapshot

Navigation: `+` / `−` keys, MIDI program change, OSC `/imweb/bank/<n>`

### States (64 per Bank)
Snapshots of all current parameter **values** (not assignments — those are the Bank).

- Store: click state dot, or `* + digit`, or `* + MIDI PC`
- Recall: click dot, digits 0–9, MIDI note, OSC `/imweb/state/<n>`
- Colour labels for grouping
- **State dot row** visible at all times in performance mode
- All LFOs retrigger on state recall

### Fade System
- `Fade Banks` option: outgoing Bank crossfades to black before incoming loads
- `Spacebar hold` = delay fade-in (hold tension, release to reveal)
- Fade rate: mappable parameter

---

## 9. UI Architecture

### Philosophy
Performance-first. Every value visible. No mode switch. The interface IS the feedback display — every active parameter value shown as a live number on the main canvas in adjustable positions (the ImOs9 feedback indicator system).

### Layout Zones

```
┌─────────────────────────────────────────────────────────┐
│  STATUS BAR: fps · preset name · state · MIDI/OSC in    │
├────────────────────┬────────────────────────────────────┤
│                    │                                    │
│   OUTPUT CANVAS    │   CONTROL PANELS (tabbed)          │
│   (main preview)   │   · Mapping                        │
│                    │   · Buffer                         │
│                    │   · Clips                          │
│                    │   · 3D Scene                       │
│                    │   · Sequences                      │
│                    │   · Tables                         │
│                    │   · Presets                        │
├────────────────────┴────────────────────────────────────┤
│  SIGNAL PATH DISPLAY (bottom bar)                       │
│  [src1] [src2] → [keyer] → [displace] → [blend] →[out] │
├─────────────────────────────────────────────────────────┤
│  STATE DOTS ● ● ○ ○ ● ○ ○ ● ○ ○ ○ ● ○ ○ ○ ○           │
└─────────────────────────────────────────────────────────┘
```

**Fullscreen mode:** `Cmd+F` → canvas fills window, panels hidden. Second monitor sends output canvas via `BroadcastChannel` + `window.open`.

**Performance feedback indicators:** Active parameter values float on the canvas as repositionable text overlays (matching ImOs9's yellow-on-black aesthetic, colour-customisable).

### Visual Design Direction
Dark. Dense. Instrument-like. Inspired by modular synthesizer interfaces and broadcast video mixers. Monospace readouts for numerical values. Color used only for status (green=active, amber=assigned, red=recording). Not decorative.

Font: `IBM Plex Mono` for values and labels. `IBM Plex Sans` for UI text.

---

## 10. Second Monitor Support ✓ Implemented

- **`window.open()` popup** — opens a borderless canvas window on the connected second display
- Popup reads `ImageBitmap` via `postMessage` (Zero-latency transfer)
- **Letterbox scaling** — popup draws `ctx.drawImage(src, …)` with `Math.min(sw/iw, sh/ih)` scale to fill any monitor resolution
- **Ghost mode** — main canvas hidden with `visibility: hidden` via `◫` button; overlay label shows "output on second screen"
- Ghost mode is purely visual (no layout change); saves significant GPU cycles.
- Auto-engages ghost mode when popup opens; auto-disengages when popup is closed

---

## 11. Recording & Export

- **Record output:** `MediaRecorder` API → WebM (VP9) saved via File System Access API
- **Single frame capture:** Canvas `toBlob()` → PNG download
- **Buffer capture:** Frame sequence → WebM via `MediaRecorder`
- **Non-realtime capture:** AutoSync slowdown + `MediaRecorder` at reduced frame rate for higher quality output
- **FrameDoneSync:** MIDI pulse on each completed frame for VCR/external device sync

---

## 12. Project File Format

`.imweb` — a JSON bundle (optionally zipped) containing:

```json
{
  "version": "1.0",
  "metadata": { "title": "", "created": "", "modified": "" },
  "presets": [ ... ],
  "tables": [ ... ],
  "buffer": {
    "size": 4,
    "cells": [ { "type": "still|video|noise|empty", "dataRef": "..." } ]
  },
  "assets": {
    "movies": [ { "name": "", "dataRef": "..." } ],
    "stills": [ { "name": "", "data": "base64..." } ],
    "models": [ { "name": "", "format": "gltf", "dataRef": "..." } ],
    "texts": [ { "name": "", "content": "..." } ]
  },
  "mapping": {
    "active": false,
    "quads": [
      {
        "id": 0,
        "label": "Surface 1",
        "corners": {
          "tl": [0.0, 0.0],
          "tr": [1.0, 0.0],
          "bl": [0.0, 1.0],
          "br": [1.0, 1.0]
        },
        "source": "output",
        "presetOpacity": [1.0]
      }
    ]
  }
}
```

Asset data stored in IndexedDB, referenced by hash. `.imweb` file contains metadata + references; assets cached separately.

**Mapping data note:** Corner points are per-project (physical projection setup does not change between presets). Per-quad `source` and `presetOpacity` are arrays indexed by preset number, allowing different sources and opacity per preset while keeping the physical surface geometry fixed.

---

## 13. Build Toolchain

- **Vite** — build tool, dev server with HMR
- **No bundled framework** — vanilla JS modules
- **Three.js** — via npm, tree-shaken
- **idb** — tiny IndexedDB wrapper
- **WGSL shaders** — inline strings, compiled at runtime
- **Service Worker** — offline capability, asset caching
- **Web App Manifest** — PWA installability

Development environment: Node.js 20+, Vite 5+.

---

## 14. Implementation Roadmap

### Phase 1 — Core Engine (v0.1) ✓ Complete
- [x] WebGL/Three.js render pipeline with render targets (ping-pong)
- [x] WebRTC camera input → texture
- [x] Basic two-layer compositing (FG + BG)
- [x] Luminance keying shader
- [x] Displacement shader (angle, offset, RotateGrey)
- [x] Mouse controller (X/Y, 32 modifier combinations)
- [x] Keyboard controller
- [x] Basic preset save/load (IndexedDB)
- [x] Output canvas + fullscreen

### Phase 2 — Full ImX Feature Parity (v0.2) ✓ Complete + exceeded
- [x] Three-layer system (FG / BG / DispSrc)
- [x] All displacement modes (angle, offset, RotateGrey)
- [x] ExtKey (3-layer external keying)
- [x] Blend, Mirror, Solo, Fade
- [x] MIDI CC + Note (Web MIDI API, learn mode, output feedback for motorized faders)
- [x] LFO system (6 waveforms: sine, triangle, saw up/down, square, S&H; beat-sync; all modes)
- [x] Sound controller (AnalyserNode: level, bass, mid, high bands; beat detection)
- [x] Movie/clip playback (VideoTexture, multi-clip, BPM sync)
- [x] Buffer system (4–64 slots, pan/scale, frame scan, auto-capture, frameblend)
- [x] States (64 per Bank, morph animation)
- [x] OSC bridge (WebSocket JSON relay, auto-reconnect)
- [x] MIDI clock sync (derive BPM from 0xF8 timing clock)
- [x] Expression controller (arbitrary JS math formula)
- [x] Gamepad controller (axes + buttons)
- [x] Wacom pressure (Pointer Events)
- [x] BPM tap tempo + step sequencer + automation record/play
- [x] Bank morph animation (smooth crossfade between States)
- [x] Bank thumbnails (160×90 JPEG captured on save)
- [x] Project file format (.imweb JSON export/import)
- [x] Parameter search overlay (/ key)
- [x] Parameter lock + slew/lag

### Phase 3 — Restored ImOs9 Features (v0.3) ✓ Complete
- [x] Noise sources (8 types: White, Smooth, Pink, Brown, Gaussian, Salt&Pep, Speckle, H-Lines)
- [x] WarpMap procedural (8 maps: H-Wave, V-Wave, Radial, Spiral, Shear, Pinch, Turbulence, Rings)
- [x] Draw layer (canvas drawing → texture; Wacom pressure; pen/erase; LFO-drawable)
- [x] TransferMode (22 modes: copy, XOR, OR, AND, Multiply, Screen, Add, Difference, Exclude, Overlay, Hardlight, Softlight, Dodge, Burn, Subtract, Divide, PinLight, VividLight, Hue, Saturation, Color, Luminosity)
- [x] RotateGrey circular displacement
- [x] Tables / response curves (16,384 points, linear interpolation, IDB persistence)
- [x] Text layer (size, x/y, hue/sat/opacity, font, outline, spacing, advance modes)
- [x] ColorShift
- [x] Feedback system (Hor/VerOffset, Scale, Rotate, Zoom)
- [x] Interlace effect
- [x] Sound → DisplaceSrc pipeline (Sound source routable to any layer)
- [x] Chroma keyer (HSV hue-based, range + softness) — new addition
- [x] Sequencer buffers ×3 — record/loop any source; variable frame count (4–480); VRAM hint; per-seq source select
- [x] Second monitor output (ImageBitmap/postMessage; zero-latency)
- [x] Ghost mode (hides main canvas when second screen active)
- [x] Movie clip thumbnails (card layout, 160×90 JPEG, seek to 10%)
- [x] Signal path float/dock toggle
- [x] LUT node visible in signal path display
- [x] Status bar resolution buttons (FAST/MED/MAX/LOW)
- [x] Startup defaults (camera auto-on, layers→Camera, sections collapsed to Layers)
- [x] Cmd+S quick-save Bank
- [x] External mapping / controller modulation (controller-of-controller) — mod LFO Hz, mod amplitude, direct override
- [x] FrameSelect zone protection (right-click buffer slot → protect/unprotect)
- [x] Video Out Spy (◧ button, Shift+V)
- [x] Independent global noise oscillators (rand1, rand2, rand3)
- [ ] Insert Video into Buffer (UI labeling improvements needed)
- [ ] WarpMode interactive mesh editor (currently 16 slots, procedural + brushed)
- [ ] MidiSync / AutoSync (frame rate locked to MIDI clock)

### Phase 4 — 3D Integration (v0.4) ✓ Substantially Complete
- [x] 3D scene as input source (Three.js → render target → texture)
- [x] Procedural geometry generators (13 shapes)
- [x] 3D camera parameters (FOV, position — all mappable)
- [x] Object transform parameters (position/rotation/scale, all mappable)
- [x] Material parameter mapping (roughness, metalness, emissive, opacity, hue/sat)
- [x] Live video texture mapping on 3D mesh (camera/movie/screen/draw/buffer/noise)
- [x] Auto-spin (continuous rotation X/Y/Z, °/s param)
- [x] GLTF/GLB model import (Draco compression support)
- [x] OBJ, STL import
- [x] 3D depth pass → DisplaceSrc (Distance and Normals modes)
- [x] WarpMap applied to 3D mesh UVs

### Phase 5 — Public Release Polish (v0.5)
- [ ] Factory demo Banks (4–6 Banks: noise/3D/LFO-driven, no camera required; default startup loads Bank 0)
- [ ] Responsive layout / mobile UI (iPhone: bottom sheet panel, collapsed status bar; iPad: collapsible sidebar; touch targets sized for finger use)
- [ ] `.imweb` project file format — full round-trip (Banks, tables, warp maps, 3D scene refs, mapping corner points)
- [ ] PWA manifest + service worker (installable, offline-capable)
- [ ] First-visit onboarding overlay (what this is, 3 gestures, link to manual; localStorage dismiss flag)
- [ ] Keyboard shortcut lock toggle (button in status bar; blocks number/letter keys from triggering Bank/State changes when typing in fields)
- [ ] WebM recording (MediaRecorder — working, needs non-realtime sync)
- [ ] Non-realtime capture mode (AutoSync + high-quality codec)
- [ ] WarpMode interactive mesh editor (refine grid brushing)
- [ ] Wacom tilt support (Pointer Events tiltX/tiltY)
- [ ] Performance profiling + GPU usage display
- [ ] MidiSync / AutoSync (frame rate locked to MIDI clock)

### Phase 6 — Projection Mapping (v0.6)

A MadMapper/Resolume-style output mapping layer. Implemented as a **final output pass** after the existing pipeline — the signal chain is untouched; mapping warps the composed output to physical surfaces. Does not affect any existing logic.

#### Architecture

The mapping system lives entirely in the **output path**, between the final pipeline render target and the second monitor display. The main canvas always shows the unmapped output (for control/preview). The second monitor receives the mapped, warped output.

```
Pipeline output (render target)
        ↓
[ Mapping Pass — homography warp per quad ]
        ↓
Second monitor canvas (full projection surface)
```

#### Core components

**ProjectionMapper.js** (new module, `src/io/`)
- Manages N quad surfaces, each with 4 corner points (normalized 0–1 coords)
- Computes homography matrix from corner points using standard 4-point DLT algorithm
- Applies as a final Three.js shader pass (ShaderMaterial, reads from pipeline render target)
- Each quad can map to: full output, a horizontal/vertical slice, or an independent source

**Mapping mode UI**
- Toggle via button in status bar (or `Shift+M`)
- Enters setup overlay on the **second monitor window** — corner handles draggable directly on the projection surface
- Main window shows a miniature surface editor with quad list
- Corner handles: large touch-friendly drag targets (important for iPad use)
- Per-quad: source selector, opacity, blend mode

**Multi-surface support**
- Start with single quad (corner-pin of full output) — the MadMapper v1 model
- Extend to multiple quads, each independently sourced
- Quads rendered in order (painter's algorithm); overlap handled by blend mode

#### Mappable parameters (all MIDI/LFO-assignable)
- `map.quad[n].tl/tr/bl/br` — corner positions X/Y (0–1 normalized)
- `map.quad[n].opacity` — surface opacity
- `map.quad[n].active` — toggle surface on/off
- `map.quad[n].source` — source selector (output / fg / bg / movie / noise / color)

#### .imweb integration
Mapping state saved alongside Banks — see §12 for updated format. Corner points are per-project, not per-Bank (physical setup doesn't change between Banks). Per-quad source and opacity are per-Bank.

#### Implementation sequence
1. Single quad corner-pin — homography math, final shader pass, second monitor output
2. Mapping mode UI — draggable corner handles on second monitor, miniature editor on main
3. `.imweb` save/load for corner points
4. Multi-quad support — quad list, independent sources per quad
5. Touch-optimised handles (iPad performance use)

---

## 15. Key Design Decisions & Rationale

**Why restore Tables?**  
A linear slider controlling a parameter linearly is a blunt instrument. A table-routed slider controlling an exponential zoom is a performance gesture. Tables are what separate a sequencer from a synthesizer.

**Why restore External Mapping?**  
LFO frequency modulated by another LFO is FM synthesis applied to visual control. This is where ImOs9 became genuinely generative rather than just effects-driven.

**Why restore Sound → DisplaceSrc?**  
Audio feeding the spatial displacement pipeline (not just controlling a parameter) creates a live, reactive coupling between sound and image structure that is fundamentally different from audio-reactive parameter control. This is sonification operating in reverse.

**Why WebGPU over WebGL?**  
WarpMode (mesh deformation), multiple simultaneous displacement passes, and the 3D-to-2D pipeline all benefit from compute shader access. WebGPU is available in Chrome 113+ (2023). Fallback to WebGL for older browsers is acceptable for Phase 1.

---

*Specification updated to v0.4.0 — 2026-03-20*
*Phase 1-3 complete. Phase 4 substantially complete. ~180+ parameters implemented.*
