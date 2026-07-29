# ImWeb — Quick Reference

> Browser-based real-time video synthesis instrument · v0.8.9

---

## Signal Chain

```
FG ──┐
BG ──┼─► TransferMode ─► Displacement ─► WarpMap ─► Keyer ─► Blend ─► ColorShift ─► FX Chain ─► LUT ─► Interlace ─► Fade ─► OUT
DS ──┘
```

FX Chain is **reorderable** by dragging nodes in the Signal Path display.

---

## Input Sources

| Source | Notes |
|--------|-------|
| **Camera** | WebRTC, auto-starts on load (`V` to toggle) |
| **Movie Library** | Every movie you have — unlimited, thumbnails load lazily, filter box. `+ Add Movie`, or drop files on the canvas. Drag a row (or `→A`/`→B`) onto a deck to play it |
| **Movie A / Movie B** | Two decks, 8 loaded slots each. `Shift+1–8` selects on A, `Option+1–8` on B. A full rack evicts its oldest clip, never the one playing. Both decks start off; routing a layer to one switches it on |
| **Analog TV** | Self-contained 720x480 analog signal simulator. Currently supports 4:3 cropping and base signal color grading (hue, saturation, brightness, contrast). Routes as a standard layer source. |
| **Teletext** | Teletext input source simulating classic teletext pages; customizable page data and draw utilities; routes as WebGLRenderTarget. |
| **Stills Buffer** | Up to 64 captured frames (configurable rows×cols grid, 1–8 each, default 4×4=16); `C` to capture; scan/blend between slots |
| **Color** | Solid or gradient (H/V/radial); HSV + animated hue |
| **Noise** | GPU fractal (Perlin/Voronoi/Worley/Simplex); 512×512; resolution-independent |
| **3D Scene** | Three.js; built-in shapes + imported `.glb/.gltf/.obj/.stl/.dae`; auto-fits |
| **Slit Scan** | Classic time→space mapping; V/H/centre axes |
| **Draw** | Freehand canvas, 1024×1024; map position to mouse |
| **Text** | Live text, 512×512; Char/Word/Line advance mode |
| **Particles** | GPU particle field; physics (gravity, wind, life) |
| **SDF Generator** | GPU-raymarched metaballs; Sphere/Box/Torus; KIFS fractal folding; camera nav; luma warp; triplanar texturing; AO/glow; HSV colour; glass refraction; dedicated texture routing |
| **Sequencers ×3** | Record/loop any source; 4–480 frames; independent |
| **Vectorscope** | Audio visualiser (Lissajous / Waveform / FFT) |

---

## Effects Quick Reference

### Core chain (fixed order)

| Effect | Key parameters |
|--------|----------------|
| **Displacement** | amount 0–100%, angle 0–360°, warp map slot |
| **WarpMap** | interactive brush editor; PUSH / SMOOTH / ERASE tools |
| **Keyer** | luma: white/black/softness; chroma: hue/range/soft; ExtKey from DS |
| **Blend** | amount 0–100%; feedback hor/ver/scale/rotate/zoom |
| **ColorShift** | hue rotation 0–100% |
| **Interlace** | scanline intensity 0–1 |
| **Fade** | fade to black 0–100% |

### Post-FX chain (reorderable)

| Effect | Key parameters |
|--------|----------------|
| Kaleidoscope | intensity, rotation |
| Levels | black point, white point, gamma |
| Quad Mirror | strength |
| Pixelate | block size |
| Edge | strength, invert |
| RGB Shift | amount, angle |
| Posterize | colour levels |
| Solarize | inversion strength |
| Film Grain | grain, scanlines |
| Bloom | strength, threshold |
| Vignette | strength, radius |
| White Balance | colour temperature (2000–8000K), tint |
| Pixel Sort | length, threshold, direction, sort mode |
| Video Delay | delay in frames (1–30) |
| **LUT** | `.cube` file; blend amount |

---

## Controller Types

Right-click any parameter row to assign.

| Controller | Notes |
|------------|-------|
| **Mouse X/Y** | Position over canvas; modifier key combos supported |
| **Tilt X/Y** | Device tilt ±90° → 0–1, flat = 0.5 (iPad; https + Enable Motion) |
| **Compass** | Heading 0–360° → 0–1; wraps at north |
| **MIDI CC** | CC 0–127, channel 1–16; MIDI Learn available |
| **MIDI Note** | Velocity → value; on/off → toggle/trigger |
| **LFO** | Sine/Triangle/Saw/Square/S&H; free Hz or BPM-synced |
| **Sound** | Overall / Bass / Mid / High from microphone |
| **Random** | New value at set rate (Hz) |
| **Expression** | JS formula; `t` = time in sec; `sin cos fract clamp mix` etc. |
| **Key** | Any keyboard key; modifier combos |
| **Gamepad** | Axes and buttons via Gamepad API |
| **Wacom** | Stylus pressure 0–1 |
| **Fixed** | Constant value |

### Controller options (right-click again)

- **Invert** · **Lock** · **Feedback** (value overlay on canvas)
- **Slew** (lag, in seconds) · **Assign Table** (response curve)
- **X-Map** — modulate another controller's Hz, amplitude, or value

---

## Project / Bank / State

| Concept | Description |
|---------|-------------|
| **Project** | The full session — all Banks, tables, warp maps, settings |
| **Bank** | A named group of up to 32 States; switch via bottom-right dropdown or `+`/`−` |
| **State** | Full snapshot: parameter values + FX order + controller assignments + media filenames |
| **Neutral State** | Resets all parameter values without touching controller assignments (`Shift+0` or ○ tile) |
| **Morph** | Smooth crossfade when recalling a State; set time in the MORPH control in the bottom bar |
| **MIDI PC** | Program Change 0–127 → Bank 0–127 |
| **Quick-save State** | `Shift+S` — saves to next empty slot with auto-thumbnail |
| **Quick-save Project** | `Cmd+S` — downloads `.imweb` |
| **Open Banks window** | Bottom-right dropdown → "⊞ Open Banks window" — detaches the Banks panel |

---

## Live GLSL (Project tab)

| Control | Action |
|---------|--------|
| **Apply** / Ctrl+Enter | Compile the editor code (errors never kill the running shader) |
| **Auto** | Recompile on every keystroke |
| **✨ Prompt AI** | Natural-language shader generation (needs API key in AI panel) |
| **📄 / 💾 / ✕** | New blank · save as named user preset · delete user preset |
| **Target** | Insert point: Master / Foreground / Background / Displace |
| **uParam1–4** | Performance knobs — controller-assignable, AI names the labels |

Auto-declared uniforms: `uTexture` `tAudio` (FFT+waveform) `tPrev` (feedback) `uResolution` `uTime` `uBPM` `uBeat` `uLevel` `uBass` `uMid` `uHigh` `uParam1..4` `vUv`. GLSL ES 1.00 — `texture2D()`, `gl_FragColor`.

---

## Keyboard Shortcuts

### Performance

| Key | Action |
|-----|--------|
| `V` | Camera on/off |
| `M` | Movie play/pause (Deck A) |
| `Q` | Cycle Foreground source — in LAYERS dropdown order |
| `A` | Cycle Background source — same order |
| `Z` | Cycle DisplaceSrc source — same order |
| `C` | Capture frame |
| `K` | Keyer on/off |
| `B` | Blend on/off |
| `S` | Solo (bypass FX) |
| `H` | Fade to black |
| `X` | External key toggle |
| `T` | Tap tempo |
| `G` | Cycle canvas mode (Camera / Pad / Locked) |
| `I` | Parameter OSD on/off |
| `U` | State bar show/hide |

### Navigation

| Key | Action |
|-----|--------|
| `0–9` | Recall State |
| `Shift+0` | Neutral State (reset params, keep controllers) |
| `Shift+S` | Quick-save State (auto-thumbnail) |
| `+` / `−` | Next / previous Bank |
| `Shift+1–8` | Select clip on Movie **A** rack |
| `Option+1–8` | Select clip on Movie **B** rack |
| `/` | Parameter search |
| `?` | Keyboard help |

### Global

| Key | Action |
|-----|--------|
| `Cmd+S` | Save project → download `.imweb` |
| `Cmd+E` | Export `.imweb` (same as Cmd+S) |
| `Cmd+O` | Import `.imweb` |
| `Cmd+F` | Fullscreen |
| `Shift+P` | Float/dock signal path |
| `Shift+V` | Output spy |
| `N` | AI Narrator |
| `P` | AI Coach |

---

## Touch & iPad

Serve with `npm run dev:https` — camera/mic/motion need a secure origin.
Touch Mode (GLOBAL section) governs the canvas: **Camera / Pad / Locked**.

| Gesture (on canvas) | Action |
|---------------------|--------|
| 1-finger drag | Camera: orbit (endless, flick = momentum) · Pad: drive mouse-X/Y params (crosshair) |
| 2-finger pinch | Camera: zoom |
| 2-finger double-tap | Fullscreen toggle |
| 3-finger tap | Cycle Touch Mode (OSD flash) |
| 3+ fingers held | Clutch — suspends all gesture output |

Mobile bottom bar: `[○ Clear] [＋ Save] [state thumbnails →] [⋯ More]` —
long-press a thumbnail for **Duplicate / Clear**; ⋯ opens the full pad
grid. Panels: double-tap a row = reset · double-tap the **value** or a
**min/max** field = type an exact number (decimal pad; the ⌨ ImWeb
keyboard types into it too) · fast flick on a row = the value glides
with momentum (touch it to stop) · every long-press is 400 ms.
Camera: **⇄** flips front/back (front auto-mirrors via **Mirror FG/BG**
in Layers — slot-based, flips whatever source occupies the layer).

Desktop canvas parity (Camera mode): left-drag orbits with flick
momentum · right-drag pans · wheel / trackpad-pinch zooms (eased;
**Wheel Zoom** toggle + **Zoom Sens** in GLOBAL) · `G` cycles the mode.

---

## Status Bar (top)

```
ImWeb  |  fps · CPU · VRAM  |  Bank name  |  State name  |  BPM ♩  |  MIDI  OSC  VU  |  [FIT][FAST][MED][MAX][LOW]  [⊡][◫][⌨][◧][⛶][⏺][📷][𝔸][⬡][⚙]
```

## Bottom Bar

```
[○ neutral]  [ state 1 ][ state 2 ][ ... ][ state 32 ]   MORPH  Bank 1 ▼
```

The state grid holds 32 thumbnail tiles (2 rows × 16 columns). Tiles show auto-captured thumbnails for saved states and are dim/empty for unsaved slots.

- **Left-click** an empty tile: save current state there. Left-click a saved tile: recall it.
- **Right-click** a tile: Save here / Import .imstate / Export .imstate / Clear.
- **○** (leftmost): Neutral State — reset all parameter values, leave controllers intact.
- **MORPH** (right of state grid): morph time in seconds for crossfading between states. Drag up/down to adjust; double-click to type. `0` / `OFF` = instant snap. Highlighted (gold) when active.
- **Bank 1 ▼** (bottom-right): opens the Bank dropdown — switch bank, + New Bank, ⬆ Import Bank…, ⊞ Open Banks window.

- **BPM**: click = tap tempo · right-click = MIDI clock sync
- **⊡** = second monitor popup (auto-letterbox)
- **◫** = ghost mode (dim main canvas to 18% opacity)
- **⌨** = keyboard lock (suppress shortcuts while typing)
- **⏺** = record WebM
- **📷** = frame capture mode — pause render, export PNG sequence

---

## Output Modes

| Mode | How |
|------|-----|
| Main canvas | default |
| Fullscreen | `Cmd+F` or double-click |
| Second screen | ⊡ button → popup on any display |
| Ghost mode | ◫ — dims main; second screen stays bright |
| Output spy | ◧ / `Shift+V` — small 160×90 preview |
| WebM recording | ⏺ button |
| Frame capture | 📷 button — pauses render; Step Frame exports PNG; Auto-Run exports N frames |
| Projection mapping | ⬡ button — corner-pin second screen; G=calibration grid; click handle + arrows to nudge |

**Resolution buttons:** FIT · FAST (540p) · MED (720p) · MAX (1080p) · LOW (½)

---

## File Formats

| Ext | Direction | Type |
|-----|-----------|------|
| `.mp4 .webm .mov` | Import | Video clips |
| `.png .jpg` | Import | Still → buffer |
| `.glb .gltf .obj .stl .dae` | Import | 3D models |
| `.cube` | Import | LUT colour grade |
| `.imweb` | Import / Export | Full session (all Banks + tables + warp maps) |
| `.imbank` | Import / Export | Single Bank |
| `.imstate` | Import / Export | Single State |

Drag any supported file onto the output canvas to load it.

---

## Video Format & Prep

Most H.264 MP4 and WebM files play without conversion. For **frame-accurate scrubbing** (`MoviePos`) use the companion prep script:

```bash
# 1. Drop raw clips into _raw_videos/
# 2. Run:
node imweb-prep.js
# 3. Load the converted files from _imweb_ready/ into ImWeb
```

**Output spec:** H.264 All-Intra · yuv420p · faststart · even dimensions · CRF 18

**Clips prepped before v0.14 need a one-off faststart remux** — without `moov` at the
front of the file a browser cannot read a large clip's duration promptly, which stalls
rack loading and leaves Library rows at "…". Lossless, no re-encode:

```bash
cd _imweb_ready
for f in *.mp4; do ffmpeg -v error -i "$f" -c copy -movflags +faststart "fs_$f" && mv "fs_$f" "$f"; done
```

| Format | Works without prep? | Notes |
|--------|---------------------|-------|
| H.264 MP4 (phone/camera) | Yes | May have imprecise scrubbing |
| WebM VP8/VP9 | Yes | Good for screen recordings |
| H.264 MP4 (All-Intra) | Yes + scrubbing | Use imweb-prep.js output |
| H.265 / HEVC | No (Chrome) | Must convert |
| ProRes / DNxHD | No | Must convert |

Requires: **Node.js** + **FFmpeg** (`brew install ffmpeg` / `apt install ffmpeg`)

---

## Performance Notes

- Sequencer frames = full-resolution VRAM × frame count — keep counts low when not needed
- Disable `scene3d.depth.active` when not using depth as DisplaceSrc
- VRAM shown in **red** in the profiler when above 800 MB

---

## Known Issues

- **Chrome 148 ANGLE/Metal backend regression (macOS)**: Vertex shader rendering is broken for Hypercube wireframe edges (`LineSegments`) and Harabara GLB model (`SkinnedMesh`).
  - *Workaround*: Launch Chrome from the terminal with the `--use-angle=gl` flag.

---

*ImWeb v0.8.9 · H. Karlsson · [Full manual →](ImWeb_Full_Manual.md)*
