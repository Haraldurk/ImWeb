# ImWeb — Quick Reference

> Browser-based real-time video synthesis instrument · v0.17.0

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
| **Analog TV** | Self-contained 720×480 analog signal simulator: 4:3 cropping and base signal colour grading (hue, saturation, brightness, contrast). Routes as a standard layer source. **Teletext** is one of its signal types (`analog.sourceType` → Teletext), not a source of its own — selecting it reveals the page-navigation panel |
| **Stills Buffer** | Up to 64 captured frames (configurable rows×cols grid, 1–8 each, default 4×4=16); `C` to capture; scan/blend between slots |
| **Color** | Solid or gradient (H/V/radial); HSV + animated hue |
| **Noise** | GPU fractal (Perlin/Voronoi/Worley/Simplex); 512×512; resolution-independent |
| **3D Scene** | Three.js; built-in shapes + imported `.glb/.gltf/.obj/.stl/.dae`; auto-fits. 7 material shaders (Standard/Physical/Toon/Normal/Matcap/Lambert/Phong); glass via Physical's Transmit+IOR; rim light; live texture with UV scroll; geometry displacement from noise or from the texture; Cloner (Grid/Ring/Line, up to 200, with twist/scatter/travelling wave); metaballs; glTF animation clips |
| **Slit Scan** | Classic time→space mapping; V/H/centre axes |
| **Draw** | Freehand canvas, 1024×1024; map position to mouse |
| **Text** | Live text, 512×512; Char/Word/Line advance mode |
| **Particles** | GPU particle field; physics (gravity, wind, life) |
| **SDF Generator** | GPU-raymarched field; 13 shapes + second shape w/ Union/Subtract/Intersect; KIFS folding; orbit camera (Orbit X/Y + Distance) + FOV; luma warp; triplanar texturing; AO; two-stop glow; self-reflection; glass refraction; dedicated texture + refraction routing |
| **Rutt-Etra** | Scanline Z-displacement in 3D; 7 lattice shapes; Lines/Points/Both; per-line rise/fall follower; persistence + spread |
| **Mix Buses ×3** | Two free source inputs each; Crossfade/Add/Multiply/Luma Mask/Displace. Double-buffered — a later bus reading an earlier one sees this frame, otherwise last frame. Self-routing is legal (1-frame loop) |
| **Warp Tape** | Rolling time buffer (8/16/32 s); scrub or smear along Time (X) or Picture (Y). One *column* per time step — ~18× cheaper than Time Displace for an axis-aligned gradient, and cannot express anything else. Params are `vwarp.*`; the old `vasulka.*` namespace is deprecated and unreachable |
| **Time Displace** | Per-pixel delay from a map image; 7 modes; up to 119 frames deep. Buffer res is the memory cost — drop from Native first |
| **3D Depth / SDF Depth** | Depth outputs of the 3D Scene and SDF field, routable like any source |
| **Sequencers ×3** | Record/loop any source; 4–480 frames; ±300% speed (negative = reverse); independent |
| **Vectorscope** | Audio visualiser (Lissajous / Waveform / FFT) |
| **Motion Extraction** | A **matte**, not a picture — white where the source moves. Route it to the keyer's **Key src**. `Bg adapt` spans background subtraction (long) to frame differencing (0); `Smoothness` is what makes a live camera usable |
| **Delay** | Frame ring; 0.5–8 s depth, resolution-capped for VRAM |
| **RGB Delay** | Reads the *same* ring three times, one per channel — moving edges separate into coloured fringes. Equal values = bit-exact passthrough |
| **Sound** | Microphone / audio input as a routable texture |
| **Color / Color2** | Two independent solid-or-gradient generators |
| **BG1 / BG2** | Two frozen background stills held by the Stills Buffer. `Freeze BG1` / `Freeze BG2` (triggers) grab the current frame into them — a held plate to key or mix against |
| **Output** | The finished frame, fed back in as a source (`pipeline.prev`) — the raw material for feedback routing |

---

## Effects Quick Reference

### Core chain (fixed order)

| Effect | Key parameters |
|--------|----------------|
| **Displacement** | amount 0–100%, angle 0–360°, warp map slot |
| **WarpMap** | interactive brush editor; PUSH / SMOOTH / ERASE tools |
| **Keyer** | luma: white/black/softness; chroma: hue/range/soft; **ExtKey + Key src** — key from *any* source, not just DS |
| **Blend** | amount 0–100%; feedback hor/ver/scale/rotate/zoom + centre; loop shaping: **FBDecay** (reach for this first when feedback runs away), FBBlur, FBHue, FBEdge, FBMirror, and 21 Feedback Modes |
| **ColorShift** | hue rotation 0–100% |
| **Interlace** | scanline intensity 0–1 |
| **Fade** | fade to black 0–100% |

### Post-FX chain (reorderable)

**All FX** (`effect.enable`) bypasses the whole chain without losing a single
value or the chain order — a real parameter, so it is MIDI-mappable and captured
by States. **Clear All FX** resets every effect parameter to default, leaving the
order and the master toggle alone.

| Effect | Key parameters |
|--------|----------------|
| Kaleidoscope | intensity, rotation, centre X/Y, edge mode |
| Levels | black point, white point, gamma |
| Quad Mirror | strength |
| Pixelate | block size |
| Edge | strength, invert, keep colour |
| RGB Shift | amount, angle |
| Posterize | colour levels |
| Solarize | inversion strength, softness |
| Film Grain | grain, scanlines, scanline count |
| Bloom | strength, threshold, radius |
| Vignette | strength, radius, centre X/Y, hue + tint |
| White Balance | colour temperature (2000–8000K), tint |
| Pixel Sort | length, threshold, direction, sort mode |
| **Polar** | amount, Wrap/Unroll, rotation — turns every effect after it into a different one |
| **Wave** | amp X/Y, freq X/Y, phase (drive phase with an LFO) |
| **Halftone** | amount, dot size, screen angle, Mono/Colour (Colour rosettes instead of moiré) |
| **Duotone** | amount, dark hue, light hue |
| **Lens / Twirl** | barrel↔pincushion, twirl, shared centre + edge mode |
| Strobe | on/off, rate 0.5–60 Hz, duty — ⚠ photosensitivity |
| Sharpen / Flip | unsharp amount; Off/H/V/Both |
| Output grade | Out.Hue, Out.Sat, Out.Bright — the tail of the chain |
| Video Delay | delay in frames (1–480), ring depth, buffer res |
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
| `G` | Cycle canvas mode (Camera / Pad / Locked / Draw / Warp) |
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
| `F` | Fullscreen (or double-click the canvas) |
| `Shift+Esc` | **Panic** — reset all parameters to defaults |
| `D` | Debug overlay |
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
| Fullscreen | `F` or double-click |
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
