# ImWeb — Quick Reference

> Browser-based real-time video synthesis instrument · v0.3.0

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
| **Movie** | Up to 8 clips; drag `.mp4/.webm/.mov` onto canvas; `Shift+1–8` to select |
| **Stills Buffer** | 4–32 captured frames; `C` to capture; scan/blend between slots |
| **Color** | Solid or gradient (H/V/radial); HSV + animated hue |
| **Noise** | GPU fractal (Perlin/Voronoi/Worley/Simplex); 512×512; resolution-independent |
| **3D Scene** | Three.js; built-in shapes + imported `.glb/.gltf/.obj/.stl/.dae`; auto-fits |
| **Slit Scan** | Classic time→space mapping; V/H/centre axes |
| **Draw** | Freehand canvas, 1024×1024; map position to mouse |
| **Text** | Live text, 512×512; Char/Word/Line advance mode |
| **Particles** | GPU particle field; physics (gravity, wind, life) |
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

## Preset System

| Concept | Description |
|---------|-------------|
| **Preset (0–127)** | Full parameter snapshot + thumbnail |
| **Display State (0–9)** | 10 sub-states per preset (recall with `0–9`) |
| **Morph** | Smooth crossfade between presets over N seconds |
| **MIDI PC** | Program Change 0–127 → preset 0–127 |
| **Quick save** | `Cmd+S` |
| **Project file** | `.imweb` = all presets + tables + warp maps |

---

## Keyboard Shortcuts

### Performance

| Key | Action |
|-----|--------|
| `V` | Camera on/off |
| `M` | Movie play/pause |
| `C` | Capture frame |
| `K` | Keyer on/off |
| `B` | Blend on/off |
| `S` | Solo (bypass FX) |
| `H` | Fade to black |
| `X` | External key toggle |
| `T` | Tap tempo |

### Navigation

| Key | Action |
|-----|--------|
| `0–9` | Recall Display State |
| `+` / `−` | Next / previous preset |
| `Shift+1–8` | Select movie clip |
| `/` | Parameter search |
| `?` | Keyboard help |

### Global

| Key | Action |
|-----|--------|
| `Cmd+S` | Quick-save preset |
| `Cmd+E` | Export `.imweb` |
| `Cmd+O` | Import `.imweb` |
| `Cmd+F` | Fullscreen |
| `Shift+P` | Float/dock signal path |
| `Shift+V` | Output spy |
| `Shift+Esc` | Reset all to defaults |
| `N` | AI Narrator |
| `P` | AI Coach |

---

## Status Bar (top)

```
ImWeb  |  fps · CPU · VRAM  |  Preset N  |  BPM ♩  |  MIDI  OSC  VU  |  [FIT][FAST][MED][MAX][LOW]  [⊡][◫][◧][⛶][⏺][𝔸][⬡][⚙]
```

- **BPM**: click = tap tempo · right-click = MIDI clock sync
- **⊡** = second monitor popup (auto-letterbox)
- **◫** = ghost mode (dim main canvas to 18% opacity)
- **⏺** = record WebM

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

**Resolution buttons:** FIT · FAST (540p) · MED (720p) · MAX (1080p) · LOW (½)

---

## File Formats

| Ext | Direction | Type |
|-----|-----------|------|
| `.mp4 .webm .mov` | Import | Video clips |
| `.png .jpg` | Import | Still → buffer |
| `.glb .gltf .obj .stl .dae` | Import | 3D models |
| `.cube` | Import | LUT colour grade |
| `.imweb` | Import / Export | Full session |
| `.imx` | Import | Legacy Image/ine |

Drag any supported file onto the output canvas to load it.

---

## Performance Notes

- Sequencer frames = full-resolution VRAM × frame count — keep counts low when not needed
- Disable `scene3d.depth.active` when not using depth as DisplaceSrc
- FAST/MED resolution drops GPU load significantly
- VRAM shown in **red** in the profiler when above 800 MB

---

*ImWeb v0.3.0 · H. Karlsson · [[ImWeb_Full_Manual|Full manual →]]*
