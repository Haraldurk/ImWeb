# Changelog

All notable changes to ImWeb are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
ImWeb uses [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`

---

## [0.8.4] — 2026-04-16

### Added
- **Hypercube pipeline texture on faces (Session 2)** — `HypercubeFaces.js` now uses `ShaderMaterial` with `uFaceTexture` to sample the real-time pipeline texture onto hypercube faces; added `hypercube.faces.active` and `hypercube.faces.opacity` parameters with UI controls; corrected all hypercube parameter registrations in `main.js` to use the valid single-object `ps.register({})` form, fixing a critical bug where parameters were stored under `undefined`.

### Fixed
- fix(scene3d): null face texture before render pass to break WebGL feedback loop (97e88e8 — actually committed earlier)
- fix(scene3d): null mesh material.map before render pass to break pipeline feedback loop (97e88e8)

---

## [0.8.3] — 2026-04-16

### Added
- **Hypercube 2-cell face rendering (Session 1)** — Added `generate2CellFaces(dim)` to `HypercubeGeometry.js` returning corners and axes for all $C(dim,2) \cdot 2^{dim-2}$ faces; introduced `HypercubeFaces.js` using `InstancedMesh` of `PlaneGeometry` with zero-allocation optimizations; wired into `HypercubeObject.js` for real-time centroid/normal/size computation; 4D hypercube now correctly renders 24 rotating faces.

---

## [0.8.2] — 2026-04-16

### Added
- **Real screen-space hypercube edge width** — Replaced `LineSegments` with quad `Mesh` (2 triangles per edge) for true variable-width lines (0.5–8.0 px); implemented per-edge quad buffers (`_quadEndABuf`, `_quadEndBBuf`, etc.) with zero per-frame allocation; vertex shader performs screen-space extrusion perpendicular to edge direction; added `uResolution` uniform sync and `DoubleSide` rendering.

---

## [0.8.1] — 2026-04-16

### Added
- **Hypercube edge width shader (Session 1)** — Replaced `LineBasicMaterial` with `ShaderMaterial` on hypercube edges; `uEdgeWidth` uniform wired through `_lineMat` and updated per-frame; added `setEdgeWidth()` public setter (0.5–8.0 clamp); `hypercube.edgeWidth` parameter registered and UI slider added.

---

## [0.8.0] — 2026-04-16

### Added
- **N-D Hypercube engine (4D–12D)** — 60fps performance at 12D; vertex/edge generation, Givens projection, morph state machine with 5 easing functions; permanent Float32/Float64 buffers with zero per-frame allocation; `_colorsDirty` GPU gate; `MAX_DIM` draw range; circular points shader; vertex pub/sub
- **Hypercube UI** — dimension pills, collapsible rotation tiers, deferred DOM rebuild on morph

### Fixed
- Color offset and morph doubling issues
- JS heap leaks and redundant GPU uploads
- Missing edges and morph freeze bugs

---

## [Unreleased] — Noise System Overhaul (D1)

## [0.61.0] — 2026-04-14

### Added
- **Program > Bank > State Hierarchy:** Completely overhauled the UI and mental model to standard performance software hierarchy. "Presets" are now "Banks", and "Display States" are now "States".
- **Factory Banks JSON:** Engine now fetches default setups from `public/factory-banks.json` instead of relying on hardcoded JavaScript arrays, making them human-readable and easily editable.
- **Auto-Thumbnailing:** Right-clicking a bottom menu dot to save a State now automatically captures the canvas and attaches a thumbnail to the State in the sidebar.
- **Sidebar State Management:** The sidebar now lists all 64 States in the active Bank. Users can click a State name to rename it, or click the `▶` button to load it directly from the list.
- **Bank Selector Dropdown:** The bottom right corner now features a sleek, dark-themed `<select>` dropdown for instantly switching between Banks.
- **AI State Generator Polish:** Renamed from "AI Preset Generator", moved into the Project tab, and added a quick-access `⚙ API Settings` button.

### Changed
- **UI Tab Renamed:** The "Presets" tab is now the "Program" tab.
- **Section Reorganization:** Side panel sections are logically ordered top-to-bottom: `PROGRAM`, `BANKS`, `STATES`, `STATE STEP SEQUENCER`.
- **Randomize Button:** Moved from the Banks section to the States section (as randomizing generates a new State, not a Bank).

### Added
- 38 noise types (up from 8) across 6 categories in NOISE_BFG shader
- Classic: White Noise, Film Grain, Gaussian, TV Static, Scan Lines, Salt-and-Pepper
- Structured: Voronoi F1, Manhattan, Chebyshev, Caustics, Flow Noise, Worley Veins
- Geometric: Truchet, Hex Grid, Gabor, Blue Noise, Poisson Disc
- Signal & Video: Speckle, RGB Shift, Interlace, VCR Noise, Speckle Colour, Pixel Sort
- Fractal & Fluid: fBm, Turbulence, Billowed, Domain Warp 2, Velocity Field, Advection, Marble
- New GLSL helpers: voronoi() with metric selector, h2() vec2 hash, turbulence(), billowed()
- noise.color promoted from TOGGLE to SELECT (Off / Tri-channel / Color Mix)
- Color1/Color2 pickers wired to uColor==2 mix(color1, color2, noiseVal) in shader
- Noise panel separated from Color panel into own "Noise" section

### Fixed
- smoothstep(0.4, 0.15, x) edge-order undefined behaviour — replaced with safe equivalent
- h1(vec2) type errors — all calls wrapped to vec3 for GLSL ES compliance
- floor(hex + 0.5) used instead of round() for WebGL 1 / GLSL ES 2.00 compatibility

---

## [0.7.0] — 2026-04-10

### Added
- **Text animation system** — `text.rate` + `text.autoplay` auto-advance clock (LFO/MIDI/sound-assignable); `text.animMode` (Bounce/Wave/Fade/Typewriter), `text.animSpeed`, `text.animAmt`; `text.contentIdx` indexes multi-line textarea content, MIDI/LFO-driveable
- **Text typography params** — `text.letterspacing`, `text.rotation`, `text.shadowBlur/X/Y`, `text.bgOpacity`, `text.outlineHue/Sat` (independent outline color)
- **3D material types** — `scene3d.mat.type` SELECT: Standard / Toon (3-step gradient) / Normal / Matcap / Lambert / Phong; live switch without losing values
- **3D rim / Fresnel** — `scene3d.mat.rim` (0–1), `scene3d.mat.rimHue` (0–360°); injected into `onBeforeCompile` fragment shader
- **3D material extras** — UV animation (`uvSpeedX/Y`), independent emissive color (`emissiveHue/Sat`), `envIntensity`
- **Vasulka Warp (temporal slit-scan)** — `VasulkaWarp.js`: `DataArrayTexture` ring buffer (30–90 frames, 480p or 960p); each column samples a different moment in time with bilinear blending; params: `vwarp.active`, `strength`, `axis` (H/V), `flip`, `mix`, `depth`, `quality`; routable as source 22 "VWarp"; GLSL3 shader (`sampler2DArray`, `glslVersion: THREE.GLSL3`)
- **Vasulka UV warp** — dual-oscillator scan-line UV distortion effect in pipeline FX chain (`vasulka.*` params)
- **Particle improvements** — FG/BG/DS mask sources (indices 6/7/8); emitter shapes (Box/Ring/LineH/LineV/Point); `scaleby` (Uniform/By-Life/By-Speed); 2 attractor/repulsor nodes with strength and position
- **Responsive layout** — CSS media query breakpoints for 4K (≥2560px), tablet (≤1200px), slide-over panel (≤900px), full-width (≤600px); `@media (pointer: coarse)` 44px touch targets; `overscroll-behavior` + `touch-action` on panels and param rows
- **iPad touch input** — all param row drags use Pointer Events + `setPointerCapture` (replaces mouse events); long-press (500ms, ≤8px movement) opens context menu with haptic; thin 3px range slider under every CONTINUOUS param row for finger adjustment; `touch-action: manipulation` eliminates 300ms tap delay
- **Controller badge popover (all types)** — `_openCtrlPopover` expanded: `midi-cc` (CC#, Chan drag), `midi-note` (Note#, Chan), `key` (click-to-capture), `expr` (live text input); Slew + Table rows now shown for all controller types; tap (touch) or ctrl+click (desktop) opens popover; badge label refreshes immediately via `param.notify()` after assignment
- **LFO popover improvements** — beat-sync LFOs show "Beat ÷N" label instead of "Freq (Hz)"; `lfo-rampdown` (LFO↘) and `lfo-sh` (S+H) added to badge label map
- **Temporal Smear demo preset** (preset 5) — two-state preset: builds VWarp history then switches to temporal slit-scan output

### Fixed
- Keyer breaking on Layer Color changes — `keyer.rawkey` toggle makes keyer use pre-color-correction FG for luma computation
- `_rebuildMaterial` missing `oldMat.dispose()` — GPU resources leaked on every 3D material type switch (fixed)
- GLSL `setCustomShader` false 1281/1282 errors — drain stale error queue before compile; check program link status via `getProgramParameter/getProgramInfoLog`
- VasulkaWarp GLSL3 syntax errors — fixed WARP_FRAG/VERT to use `in/out`, `fragColor`, `texture()`; added `glslVersion: THREE.GLSL3`; `_texInited` properly initialized; added VWarp to `Pipeline._resolveSource`

---

## [0.7.1] — 2026-04-11

### Added
- **SequenceBuffer timewarp mode** — slit-scan temporal buffer, absorbs VasulkaWarp concept. New params: `seq${n}.mode` (Loop/TimeWarp), `tw.axis`, `tw.flip`, `tw.speed`, `tw.mix`, `tw.offset`, `tw.warp`
- **Temporal density control** — `tw.speed` governs columns per frame: speed=1 → 1 col/frame (~21 s range at 60 fps); speed=3600 → 1 col/second (~21 hr range)
- **Strip RT persistence via IndexedDB** — timewarp strip saves automatically on project save, restores on project load; slit-scan state survives page reloads across sessions
- **VasulkaWarp deprecated** — kept in codebase for compatibility, removed from UI and signal path

---

## [0.6.0] — 2026-04-05

### Added
- **Auto-load clips from `_imweb_ready/`** — on startup ImWeb reads `_imweb_ready/manifest.json` and loads all listed clips automatically; `imweb-prep.js` writes/updates the manifest after each conversion run
- **Movie On/Off button** in status bar replaces FIT/FAST/MED/MAX/LOW resolution buttons; shows "Movie On" / "Movie Off"; always starts off regardless of saved preset state
- **MuteMovie parameter** — toggle audio output per movie session; defaults on (muted); turn off to hear clip audio; state applied to all loaded clips
- **Audio in prepped clips** — `imweb-prep.js` now keeps audio track (AAC 192k), re-encoded for browser compatibility; `0:a?` map so audio-less clips still process cleanly
- **q / a / z keyboard shortcuts** — cycle Foreground / Background / DisplaceSrc through all 22 source inputs
- **Settings panel** (was "AI Settings") — renamed ⚙ button; panel now has three sections: AI Provider, Documentation (Quick Reference + Full Manual links), Video Prep (imweb-prep.js command + spec)
- **Video prep guide** in Clips tab — inline hint with format and prep command
- **Improved clip load error message** — explains codec failure and points to `imweb-prep.js`
- **Reef GLSL preset** — ray-marched crystalline structure; float equality bug fixed (range checks replace `w == 1.0` / `w == 9.0`)
- **Tunnel GLSL preset upgraded** — wormhole with Speed, Dir X, Zoom (1–8×), Width parameters; texture visible inside tube

### Fixed
- GLSL shaders with non-ASCII characters in comments (`×`, `–`, `π`) caused WebGL error 1282 on Apple Silicon — replaced with ASCII equivalents
- Movie `video.play()` on startup blocked by browser autoplay policy — movie now starts off; user activates via Movie Off/On button
- Preset restore setting `movie.active = 1` caused button to show "Movie On" on load — explicitly reset to 0 after `presetMgr.init()`

### Planned (Phase 6)
- GLSL editor: resolve remaining WebGL 1281/1282 errors on preset apply
- Mobile-friendly UI — touch targets, responsive layout, mobile gesture support
- Multi-quad projection mapping
- Multi-cam workflow

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
