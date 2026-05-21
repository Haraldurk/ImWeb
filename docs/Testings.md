# ImWeb — Testing Log

---

## Session 1 — Early beta (2026-03-18, pre-development notes)

Issues found at initial prototype stage:

- Scrolling up and down the menu is not working when mouse is over selections → **fixed** (scroll now passes through param panels; Alt+wheel or horizontal scroll adjusts value, vertical scroll scrolls the panel)
- 3D is stuck on sphere and controllers inactive → **fixed** (13 geometry types selectable; all 3D params mapped and controllable; scene3d.spin.x/y/z auto-spin added)
- Would really like to be able to use camera, movie, screen, drawing etc. as texture for 3D → **fixed** (`scene3d.mat.texsrc` SELECT param: None / Camera / Movie / Screen / Draw / Buffer — maps live video to mesh)
- Noise type more than just pixels, with pink, brown, Gaussian, Salt-and-Pepper, Speckle? → **fixed** (8 types: White, Smooth, Pink, Brown, Gaussian, Salt&Pep, Speckle, H-Lines; `noise.scale` param for grain size)
- Scope or vectorscope not responsive → **fixed** (VectorscopeInput: Lissajous / Waveform / FFT modes; connect via Scope button in Mapping tab; gain + decay controls)
- Text — where are the settings and adjustments for text? → **fixed** (full TextLayer: size, x/y position, hue/sat, opacity, align, font, outline, line spacing, advance mode; Text tab with live preview canvas)
- Effects are not active → **fixed** (full pipeline active: Pixelate, Edge, RGBShift, Posterize, Solarize, Kaleidoscope, QuadMirror, Vignette, Bloom, Levels, LUT 3D, WhiteBalance, PixelSort, FilmGrain, Scanlines, Interlace, Fade, ColorShift)

---

## Session 2 — v0.2 development (2026-03-19)

### Features built this session

**Color2 animated gradient**
- `color2.speed` param (±200 %/s) in Color & Noise panel
- Phase-driven hue cycling — all gradient types animate (Solid, Grad H, Grad V, Grad R)
- Phase zeroed when speed = 0: stopping animation doesn't leave a permanent hue shift
- MIDI/LFO-assignable like any other param

**Preset thumbnails**
- 160×90 JPEG thumbnail captured from canvas on "Save Preset"
- Thumbnails visible in Presets panel list (small tile beside preset number/name)
- Grey placeholder for unsaved presets
- Stored in IDB alongside preset data; included in .imweb project export

**Bug fix — PresetsPanel dblclick**
- Double-clicking a preset now correctly activates it without triggering the rename dialog 800ms later

### Known issues to investigate

- [ ] Preset thumbnails only appear after first save — presets loaded from IDB show placeholder until re-saved
- [ ] `color2.speed` phase accumulates across session; if you want a specific hue offset, use `color2.hue` directly and leave speed at 0
- [ ] Scroll behaviour in param panels: verify on different OS/browser scroll delta values

---

## Session 3 — Phase 3 features (2026-03-19)

### Features built this session

**External Mapping (controller-of-controller)**
- Right-click any param → "External Mapping" section in context menu
- X-Map: mod LFO Hz — a second controller (sound, another LFO, mouse) drives the primary LFO's rate
- X-Map: mod Amplitude — VCA-style: xController scales the param's normalized position toward min
- X-Map: direct override — xController writes directly to param value
- Each param can have multiple xControllers (displayed in context menu with × remove buttons)
- Supported xController sources: lfo-*, sound, sound-bass/mid/high, mouse-x/y, random
- Full serialize/deserialize — xControllers saved to preset and restored on load
- BPM sync propagates to beat-synced xLFOs via syncBPM()
- Bug fix: buffer canvas click/contextmenu handlers were using undefined `gridCellSize()` and `BCOLS` — fixed to use `gridLayout()`

**Video Out Spy**
- Output canvas now copied live to the `#spy-canvas` 160×90 preview each render frame
- Toggle: `◧` button in status bar, or `Shift+V` keyboard shortcut
- Panel shows bottom-right of output canvas (absolute positioned, click to dismiss)
- Styling: hover highlight, shadow, border-radius

**FrameSelect zone protection**
- Right-click any buffer slot → context menu with "🔒 Protect slot" / "🔓 Unprotect slot" and "↓ Save as PNG"
- Protected slots skipped by auto-capture write head (capture advances past them)
- Visual indicator: amber overlay tint + slot number shown in amber
- `stillsBuffer.toggleProtect(idx)` / `isProtected(idx)` API
- PNG save moved into the new slot context menu (was previously the only right-click action)

### Not yet implemented (moved to backlog)

- [ ] Insert Video to Buffer (live camera as pannable buffer cell)
- [ ] WarpMode interactive mesh editor (currently 8 fixed procedural warp maps only)
- [ ] GLTF/GLB/OBJ model import for 3D scene
- [ ] MidiSync / AutoSync (frame rate locked to MIDI clock)
- [ ] WebM recording (MediaRecorder)
- [ ] PWA manifest + service worker

---

## Session 4 — v0.3.0 release (2026-03-19)

### Features built this session

**Sequencer buffers ×3 — variable frame count**
- Frame count changed from fixed 60 to CONTINUOUS param (4–480 frames, adjustable while running)
- VRAM estimate shown in seq card (≈ N MB, red if > 800 MB)
- Per-seq source selector replaced generic SELECT param (was opening controller context menu on right-click) with dedicated compact button row: Out / Cam / Mov / FG / BG / Buf / Draw
- `buildSeqParams()` added to UI.js; called from main.js after buildMappingPanels

**Second monitor output**
- `⊡` button in status bar opens `window.open()` popup on second display
- Popup reads `window.opener.document.getElementById('output-canvas')` directly (same-origin canvas sharing; `preserveDrawingBuffer: true`)
- Letterbox scaling: `Math.min(sw/iw, sh/ih)` → `ctx.drawImage` fills any monitor resolution
- Auto-engages ghost mode when popup opens; auto-disengages when popup closes

**Ghost mode**
- `◫` button dims main `#output-canvas` to opacity 0.18, shows overlay "output on second screen"
- Purely visual — no layout changes; prevents ResizeObserver from mis-resizing renderer
- Bug fix: ResizeObserver now guarded with `if (ghost-mode) return` to prevent second monitor from being affected by main-window resize events

**Movie clip thumbnails**
- Clips tab redesigned with card layout: 160×90 JPEG thumbnail, clip name, duration, remove button
- Thumbnail captured on load: seeks to `min(duration * 0.1, 0.5)` seconds (avoids black frame at t=0)
- `thumb` field stored in clip object in MovieInput.js
- `✕ Clear` button added to Clips tab to remove all loaded clips

**Signal path float/dock**
- `┄` button in status bar toggles signal path between docked (bottom of panel) and floating overlay
- Bug fix: floating mode parks `#signal-path-display` to `document.body` before clearing innerHTML, preventing destruction of the live DOM element

**Status bar output resolution buttons**
- Fit / 540 / 720 / 1080 / ½ buttons moved to status bar (previous canvas overlay had pointer-events issues)
- Bug fix: `applyResolution` now clears `style.width/height` for fixed resolutions; only sets `width:100%` for Fit mode; prevents Three.js canvas being stretched back to container size by CSS

**Startup defaults**
- Camera auto-starts on page load
- All three layers (FG / BG / DS) default to Camera source
- All panel sections collapsed except Layers
- Same behaviour triggered by Reset All

---

## Session 5 — Phase 4 development (2026-03-20)

### Features built this session

**Second Monitor Performance (Zero-latency)**
- Replaced cross-window polling with `ImageBitmap` + `postMessage` transfer.
- Near-zero latency and high FPS on the second screen.
- **Ghost Mode optimization**: Main canvas now uses `visibility: hidden` instead of opacity, saving significant GPU compositor cycles while outputting to second monitor.
- **ResizeObserver fix**: Resolved guard issue so resizing the interface no longer breaks rendering logic in ghost mode.

**High-Resolution Tables (16,384 points)**
- Upgraded Table resolution from 256 to 16,384 points (ImOs9 spec).
- Implemented **linear interpolation** for table application, ensuring buttery smooth response curves even for extremely slow modulations.
- All built-in curves (Log, Exp, S-Curve, etc.) recalculated for high resolution.

**Robust 3D Model Import (Phase 4)**
- **DRACO Support**: Added `DRACOLoader` for high-performance compressed GLB/GLTF model loading.
- **Material Propagation**: Imported models now correctly receive video-as-texture skins (Camera, Movie, etc.) across all sub-meshes automatically.
- **WarpMap on 3D UVs**: The WarpMap editor now distorts the UV coordinates of 3D objects, allowing hand-drawn deformations of the "skin" of 3D models.
- **Noise as 3D Texture**: Added GPU Noise to the `TexSrc` list for 3D materials.

**Dual-mode Depth Pass → DisplaceSrc**
- **Distance mode**: Standard grayscale depth map.
- **Normals mode**: Surface orientation encoded as RGB → gives high-detail "liquified" displacement based on object tilt.
- DepthPass is auto-activated when `3D Depth` is routed to any layer.

**Phase 3 completion items**
- **rand1 / rand2 / rand3**: Three independent global noise oscillators added to `ControllerManager`.
- **WarpMap Slots**: Expanded from 4 to 16 storable slots in the editor.
- **Resolution Buttons**: Renamed to FAST (540p), MED (720p), MAX (1080p), LOW (Half) for better performance context.
- **Steina Vasulka**: Added to README credits as co-conspirator.

### Bugs fixed

| Bug | Fix |
|---|---|
| 3D models invisible after WarpMap update | Added fallback textures and safety guards for UV-less geometry in shader injection |
| switching from models to primitives crashed | Added safe disposal checks in `_replaceMesh` |
| 3D Depth UI not updating | Used `ps.set()` instead of direct property write for `scene3d.depth.active` |
| second screen slowdown in Chrome | Switched to `postMessage` frame transfer |

### Backlog update

- [ ] Interactive WarpMode mesh editor (currently 8 procedural + 1 custom brushed)
- [ ] Insert Video to Buffer (Context menu exists, but needs explicit 'Insert' label)
- [ ] `.imweb` project file format (Session persistence for 3D model refs)
- [ ] MidiSync / AutoSync (frame rate locked to MIDI clock)
- [ ] PWA manifest + service worker
- [ ] Make a button in top menu that activates/deactivates keystrokes so you can add fe. numbers without changing presets.
- [ ] Add to manual best praxtis preparing vido clips (.mp4 etc.)
- [ ] How to not get stuck in effects ?
- [ ] How to deal with multicams

---

## Retrospective — v0.5.0 through v0.8.9 (2026-05-21)

### Features built in these releases

**SDF Generator (Phases 1–3)**
- Built raymarching engine for metaballs and 3D shapes (Sphere/Box/Torus) with KIFS fractal folding.
- Added camera navigation, video luma displacement (lumaWarp), and glass refraction.

**Hypercube Engine (4D–12D) & Instancer**
- Designed high-performance N-D hypercube projection with morphing and circular points shader.
- Implemented real screen-space variable edge width (0.5–8.0 px) and 2-cell face rendering with alpha masking.
- Created `HypercubeInstancer` to render 13 geometry types at vertex positions.

**Analog TV & Teletext Source**
- Added Analog TV simulation (720x480 RT) with 4:3 cropping and color grading.
- Integrated Teletext input source with drawing utilities and page data files.

**Compositing & Program Hierarchy Refactors**
- Standardized hierarchy to Program > Bank > State with auto-thumbnailing and sidebar list.
- Refactored `FG.blend` to composite FG over BG using the 22-mode TRANSFERMODE shader.
- Upgraded Table resolution to 16,384 points.

**SequenceBuffer Timewarp Mode**
- Merged slit-scan temporal buffer (TimeWarp mode) with IndexedDB persistence across sessions.

### Bugs fixed

| Bug | Fix |
|---|---|
| Non-ASCII character WebGL errors | Replaced comments containing characters like `×`, `–`, `π` with ASCII |
| WebGL feedback loop errors (GL_INVALID_OPERATION) | Added automated uniform texture collision checks in `_pass()` and unbind guards |
| 3D models lost on save/load / model URL refs | Persisted model URL as `modelAsset` in project JSON and `mediaRefs` |
| Second screen black output on layout/DPR changes | Re-registered DPR listener and added context recovery handlers |
| Chrome 148 ANGLE/Metal backend crashes/rendering bugs | Hardened vertex shaders: replaced gl_VertexID with aTB, forced highp sampler2D, textureLod, and SkinnedMesh→Mesh |
