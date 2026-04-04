# Changelog

All notable changes to ImWeb are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
ImWeb uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

---

## [0.5.1] — 2026-04-05

### Added
- **Touch-optimised projection mapping** — 64px handles (up from 40px, meets Apple HIG minimum); `<meta viewport user-scalable=no>`; `touch-action:manipulation` on body prevents iOS scroll bounce; handles always visible when projmap active (no hover dependency)
- **Tappable toolbar on output window** — ⊞ Grid and ⛶ Full buttons replace keyboard-only G key and double-click for iPad/phone use
- **Auto-hide handles and toolbar** — fade out after 3 seconds of inactivity; any touch/pointer resets timer; clean projected image during performance; compositor-only opacity transition (zero GPU cost)

---

## [0.5.0] — 2026-04-05

### Added
- **SDF Generator Phase 3** — camera navigation (camX/Y/Z, lookAt matrix), KIFS fractal folding (kifsIter 0–5, kifsAngle), op mode (Soft Union / Soft Cut / Morph), video luma displacement (lumaWarp, lumaThresh), animation speed, triplanar video texturing (texBlend), AO + step-count glow, HSV colour (hue/sat/val), glass refraction + Fresnel, dedicated texture routing (texSrc / refractSrc decoupled from pipeline FG/BG layers)
- **Factory demo presets** — 5 camera-free presets seeded on first launch: SDF Metaballs, Noise Feedback, 3D Orbit, KIFS Fractal, Cloner Wave; each sets layer sources and key effect params for immediate exploration
- **Non-realtime frame capture** — 📷 button in status bar pauses the RAF loop; Step Frame exports `imweb-capture-NNNN.png` at fixed dt; Auto-Run steps N frames sequentially with browser-flush delay between downloads
- **Projection mapping improvements** — calibration grid (G key in output window) draws a 10×10 perspective-correct grid on the projected surface; click a corner handle then use arrow keys to nudge 1px (Shift = 10px); hint bar shows shortcuts
- **GLSL editor reliability** — `applyGLSL()` now auto-injects all standard pipeline uniform declarations (`uTexture`, `uTime`, `uParam1–4`, `vUv`) when absent, so built-in presets compile without error 1282

### Fixed
- Division-by-zero NaN crash in Tunnel GLSL preset — `length(uv)` clamped with `max(..., 0.0001)` to prevent Infinity → NaN → Metal INVALID_OPERATION on Apple Silicon

---

## [0.4.2] — 2026-04-04

### Added
- **3D Cloner / MoGraph** — InstancedMesh clone mode for any 3D geometry; count, spread, wave animation, WaveShape (Sine/Square/Triangle/Sawtooth), WaveAmp, WaveFreq, Twist, Scatter, CloneScale, ScaleStep (progressive taper on positions + wave height); all MIDI/LFO-assignable
- **Blob/Morph vertex displacement** — `onBeforeCompile` shader injection onto `MeshStandardMaterial`; 3D value-noise displacement along surface normals; `USE_INSTANCING` guard offsets noise lookup per clone so each instance morphs independently; BlobAmount, BlobScale, BlobSpeed params
- **SDF Generator Phase 1** — standalone GPU raymarching engine (`SDFGenerator.js`) rendering two orbiting metaballs into a `WebGLRenderTarget`; routable as pipeline source index 21 (SDF) to FG/BG/Displacement layers; params: SDFActive, SDFBlend, SDFDist
- **SDF Generator Phase 2** — upgraded GLSL with: SDFShape selector (Sphere / Box / Torus), Infinite domain repetition (SDFRepeat — tiles scene in all directions), Surface displacement (SDFWarp — sin-product warp with conservative step scaling to compensate Lipschitz inflation); orbit radius auto-scales within repetition cells

---

## [0.4.1] — 2026-04-03

### Added
- **Movie reverse playback** — negative `MovieSpeed` now steps frames backward manually (browser rejects negative `playbackRate`)
- **MovieEnd parameter** — clip end-point moved from `MovieLoop` to new `MovieEnd %` param (0–100%)
- **MovieLoop modes** — `MovieLoop` is now a SELECT: Off / Forward / Backward / Ping-pong
- **MoviePos always scrubs** — position scrub no longer requires a controller assigned; responds to any drag/set of the param
- **Clip right-click menu** — right-clicking a clip card now shows "Assign MIDI controller" and "Remove clip" instead of instant delete

### Fixed
- `movieInput.texture` undefined — corrected to `movieInput.currentTexture` in render loop

---

## [0.4.0] — 2026-03-20

### Fixed (2026-03-30)
- **Duplicate material params** — removed double-append to #material-params in UI.js; bulk sections loop is now the single source of truth
- **3D light parameters expanded** — added Ambient, Point Int., Light X, Light Y, Light Z params; all MIDI/LFO-assignable; wired to AmbientLight, PointLight, and DirectionalLight.position in SceneManager
- **MeshoptDecoder** — GLB files compressed with Meshopt now load correctly

### Added
- **MeshoptDecoder support** — GLB files compressed with Meshopt now load correctly (setMeshoptDecoder wired in SceneManager.js)
- **3D depth pass → DisplaceSrc** — dual mode: Distance (grayscale depth map) and Normals (surface orientation as RGB); auto-activates when 3D Depth routed to any layer
- **WarpMap on 3D UV coordinates** — hand-drawn warp displacement applied to mesh UV skin
- **Live video texture on 3D mesh** — Camera / Movie / Screen / Draw / Buffer / Noise routable as mesh texture across all sub-meshes
- **Robust GLB/GLTF import** — Draco compression support via DRACOLoader; material propagation across sub-meshes
- **High-resolution Tables** — upgraded from 256 to 16,384 points; linear interpolation for smooth response curves
- **Zero-latency second monitor** — replaced cross-window polling with ImageBitmap + postMessage transfer
- **Ghost mode optimisation** — main canvas uses visibility:hidden (not opacity) when outputting to second monitor; saves GPU compositor cycles
- **rand1 / rand2 / rand3** — three independent global noise oscillators added to ControllerManager
- **WarpMap slots** — expanded from 4 to 16 storable slots
- **Resolution buttons renamed** — FAST (540p) / MED (720p) / MAX (1080p) / LOW (half) for clearer performance context
- **AI provider system** — switchable Anthropic / Gemini / OpenAI / Ollama; key management UI; Narrator (N) and Coach (P) features

### Fixed
- 3D models invisible after WarpMap update — added fallback textures and safety guards for UV-less geometry
- Switching from imported models to primitives crashed — safe disposal checks in _replaceMesh
- 3D Depth UI not updating — use ps.set() instead of direct property write for scene3d.depth.active
- Second screen slowdown in Chrome — switched to postMessage frame transfer
- ResizeObserver guard issue in ghost mode resolved

---

## [0.3.0] — 2026-03-19

### Added
- **Sequencer buffers** — 3 independent sequence recorders; variable frame count (4–480 frames), per-seq source selector, VRAM estimate hint
- **Sequence source UI** — dedicated compact button rows (Out / Cam / Mov / FG / BG / Buf / Draw) replacing the generic SELECT param that opened a controller menu
- **Second monitor output** — `⊡` button opens a popup that mirrors the output canvas with letterbox scaling; auto-fits any monitor resolution
- **Ghost mode** — `◫` dims the main output canvas (opacity 0.18) when second screen is active; no layout change, purely visual
- **Movie clip thumbnails** — Clips tab shows card layout with 160×90 JPEG thumbnail (seeks to 10% of duration to avoid black frame), clip name, duration, remove button
- **Signal path float/dock** — `┄` toggle in status bar moves the signal path display to a floating overlay or back into the panel
- **LUT node in signal path** — 3D LUT (.cube) colour grading visible in signal path display
- **Status bar resolution buttons** — Fit / 540 / 720 / 1080 / ½ buttons in status bar replace the non-functional canvas overlay; clears CSS overrides for fixed resolutions
- **Startup defaults** — camera auto-starts, all three layers set to Camera source, all panel sections collapsed except Layers
- **Cmd+S quick-save** — saves current parameter state to the active preset slot
- **3D scene auto-spin** — `spin.x/y/z` parameters for continuous model rotation; speed and axis controllable
- **Audio VU meter** — real-time level meter in status bar derived from audio analyser
- **BPM-synced movie clips** — lock clip playback position to beat phase; configurable beat length (1/2/4/8/16 beats)
- **Step sequencer for presets** — automate preset recall in rhythmic steps; configurable pattern and BPM
- **Parameter lock** — lock any parameter against accidental changes from controllers
- **3D LUT colour grading** — load `.cube` LUT files; applied as post-process pass
- **GLSL param uniform binding** — expose up to 4 custom uniforms (uParam1–uParam4) to the live GLSL editor
- **Audio beat detection** — auto-BPM from onset detection; drives LFO retrigger and BPM sync
- **GPU particle system** — procedural particle field as pipeline source (index 16)
- **Built-in GLSL shader presets** — 10 example shaders selectable from the GLSL editor tab
- **Quad mirror and levels correction** — added to effects chain
- **Vectorscope input** — Lissajous / waveform / FFT visualiser as pipeline source
- **LFO visualiser** — waveform preview in the controller context menu
- **Film grain, scanlines, feedback rotate/zoom** — new effect parameters
- **Video delay line and pixel sort** — new effect passes
- **MIDI clock sync** — playback and BPM locked to incoming MIDI clock
- **Kaleidoscope, bloom, vignette, chroma key, frame blend, per-layer HSB** — all added as effect parameters
- **Parameter slew/smoothing** — right-click → Set Slew → enter time in seconds
- **Ctrl+click to type exact value** — on any parameter knob/slider
- **Automation recorder** — record parameter movements with loop playback
- **Preset morph animation** — smooth crossfade between two preset states over configurable time
- **FFT audio analysis** — sound-bass / sound-mid / sound-high controller types
- **Parameter search overlay** — press `/` to search all parameters by name
- **Drag-and-drop file loading** — drop video or image files directly onto the app
- **Keyboard help overlay** — press `?` for shortcut reference
- **MIDI output feedback** — send CC values back to motorized faders
- **MIDI channel filter** — assign CC/Note on specific channels only
- **MIDI PC → preset recall** — program change messages recall presets by number

### Fixed
- ResizeObserver now guarded: does not fire `renderer.setSize` when ghost mode is active (was incorrectly resizing second monitor popup)
- `applyResolution` clears `style.width/height` for fixed resolutions to prevent Three.js canvas being stretched back to container width
- Seq source right-click no longer opens controller assignment menu (replaced with dedicated buttons)
- Section header text matching uses first text node to avoid including button text in comparison

---

## [0.2.0] — 2026-03-18

### Added
- **Movie clip playback** — load video files; speed, position scrub, loop range, mirror; up to 8 clips; Shift+1–8 to select
- **Stills buffer** — capture up to 16 frames; FrameSelect 1/2/3 to composite
- **Slit scan buffer** — rolling scan effect as pipeline source
- **Text layer** — live text with font, size, colour, position, scroll scripting
- **WebRTC camera input** with auto-start and device selection
- **Preset system** — save/load/morph between parameter states; 128 Display States per preset; IndexedDB persistence
- **WebM recording** — record output to WebM video file
- **Fullscreen output** — double-click canvas or Cmd+F
- **Draw layer** — freehand canvas drawing as pipeline source
- **External MIDI input** — MIDI CC and Note as parameter controllers
- **Output resolution selector** — Display / 720p / 1080p / 540p / Quarter

---

## [0.1.0] — 2026-03-18  *(initial build)*

### Added
- **Core compositing pipeline** — Three.js WebGL render targets; foreground, background, and displace-source layers
- **Full parameter system** — reactive parameters with `onChange`, grouped by namespace
- **Controller mapping** — Mouse X/Y, MIDI CC, LFO ×4, Sound level, Random, Fixed value, Key
- **Luminance keyer** — KeyLevelWhite, KeyLevelBlack, KeySoftness
- **Displacement** — amount, angle, offset, RotateGrey
- **Blend** — frame persistence / motion blur
- **Feedback** — HorOffset, VerOffset, Scale
- **TransferMode** — Copy, XOR, OR, AND
- **ColorShift, Interlace, Fade, Mirror**
- **Color source** — HSV solid colour generator
- **Noise source** — pixel noise generator
- **3D scene as pipeline source** — all geometry types, transforms, material, camera; GLTF/GLB/OBJ/STL import
- **Signal path display** — live visual of the FG/BG/DS routing and effect chain
- **Dark performance UI** — collapsible panel sections, tabbed inputs, parameter rows with knobs/sliders

[0.3.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/haraldurkarlsson/ImWeb/releases/tag/v0.1.0

[0.4.2]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/haraldurkarlsson/ImWeb/compare/v0.3.0...v0.4.0
