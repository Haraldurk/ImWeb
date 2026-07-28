// ImWeb — Image/ine in the Browser
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2024–2026 Haraldur Karlsson
//
// Dedicated to Tom Demeyer (Image/ine, STEIM Amsterdam)
// and Steina Vasulka.
//
// This program is free software under the GNU Affero General
// Public License v3 or later. See LICENSE for details.

/**
 * ImWeb — main.js
 * Application bootstrap. Initializes all subsystems and starts the render loop.
 *
 * Startup sequence:
 * 1. Detect WebGPU capability (use WebGL if unavailable)
 * 2. Initialize Three.js renderer
 * 3. Create ParameterSystem and register all parameters
 * 4. Create ControllerManager
 * 5. Create input sources (Camera, Color, Noise, 3D Scene)
 * 6. Create compositing Pipeline
 * 7. Init UI (tabs, param rows, state dots, signal path)
 * 8. Init PresetManager and load saved state
 * 9. Start render loop
 */

import * as THREE from "three";
import { EditorView, basicSetup } from "codemirror";
import { keymap } from "@codemirror/view";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as hlTags } from "@lezer/highlight";
import { cpp } from "@codemirror/lang-cpp";
import {
  ParameterSystem,
  registerCoreParameters,
  setTableManager,
  SOURCE_KEYS,
  MIXBUS_IDX,
} from "./controls/ParameterSystem.js";
import { tableManager } from "./state/TableManager.js";
import { ControllerManager } from "./controls/ControllerManager.js";
import { Automation } from "./controls/Automation.js";
import { StepSequencer } from "./controls/StepSequencer.js";
import { CameraInput } from "./inputs/CameraInput.js";
import { MovieInput } from "./inputs/MovieInput.js";
import { StillsBuffer } from "./inputs/StillsBuffer.js";
import { SequenceBuffer } from "./inputs/SequenceBuffer.js";
import { VideoDelayLine } from "./inputs/VideoDelayLine.js";
import { TimeDisplaceEngine } from "./inputs/TimeDisplaceEngine.js";
import { VectorscopeInput } from "./inputs/VectorscopeInput.js";
import { SlitScanBuffer } from "./inputs/SlitScanBuffer.js";
import { VasulkaWarp } from "./inputs/VasulkaWarp.js";
import { ParticleEngine } from "./particles/ParticleEngine.js";
import { SDFGenerator } from "./inputs/SDFGenerator.js";
import { AnalogTV } from "./inputs/AnalogTV.js";
import { registerAnalogParams } from "./inputs/AnalogParams.js";
import { BUILTIN_PRESETS, captureAnalogState, applyAnalogPreset } from "./inputs/AnalogPresets.js";
import { TeletextSource } from "./inputs/TeletextSource.js";
import { registerTeletextParams } from "./inputs/TeletextParams.js";
import { buildTeletextUI } from "./inputs/TeletextUI.js";
import { DrawLayer } from "./inputs/DrawLayer.js";
import { StrokeLooper, LOOP_SLOTS } from "./inputs/StrokeLooper.js";
import { TextLayer } from "./inputs/TextLayer.js";
import { buildWarpMaps } from "./inputs/WarpMaps.js";
import { WarpMapEditor } from "./inputs/WarpMapEditor.js";
import { SceneManager } from "./scene3d/SceneManager.js";
import { Pipeline } from "./core/Pipeline.js";
import { GestureArbitrator } from "./core/GestureArbitrator.js";
import { MobileStatePad } from "./ui/components/MobileStatePad.js";
import { PresetManager, openDB } from "./state/Preset.js";
import { OSCBridge } from "./io/OSCBridge.js";
import { MontyBridge } from "./io/MontyBridge.js";
import { ProjectFile } from "./io/ProjectFile.js";
import clipLibrary from "./io/ClipLibrary.js";
import { importImX } from "./io/ImXImporter.js";
import { parseCubeFile } from "./io/CubeLoader.js";
import {
  AIFeatures,
  getApiKey,
  setApiKey,
  clearApiKey,
  generatePreset,
  generateShader,
  narrateState,
  buildStateSnapshot,
  coachSuggestion,
  buildActivitySnapshot,
  getNarratorConfig,
  getCoachConfig,
} from "./ai/AIFeatures.js";
import {
  initTabs,
  buildParamRow,
  buildLayerButtons,
  buildMappingPanels,
  buildNoisePanel,
  buildSeqParams,
  buildGeometryButtons,
  buildWarpEditor,
  StateBar,
  SignalPath,
  ContextMenu,
  FeedbackOverlay,
  MemoryPanel,
  Profiler,
  DebugOverlay,
  TablesEditor,
  buildClipLibrary,
  buildPaletteSection,
  buildAnalogPresetBar,
} from "./ui/UI.js";
import { openCtrlPopover } from "./ui/components/CtrlPopover.js";
import { LONG_PRESS_MS } from "./ui/touch.js";
import { perfFrame } from "./perf-logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

// _applyLayout extracted to ui/layout/LayoutManager.js (Phase 2 Task 5)
import { applyLayout as _applyLayout } from "./ui/layout/LayoutManager.js";
import { version as APP_VERSION } from "../package.json";
_applyLayout();
window.addEventListener("resize", _applyLayout);
// Re-sync whenever the status bar's own size changes (font swap-in, button
// wrap) — load/fonts.ready fire too early to catch late reflows
const _sbEl = document.getElementById("status-bar");
if (_sbEl) new ResizeObserver(_applyLayout).observe(_sbEl);

// ── Initial tab activation — fully data-driven ───────────────────────────────
// The section marked data-default-open in index.html decides BOTH which panel
// section is expanded and which tab the app lands on. No `active` class is
// hardcoded in the markup.
//
// Deliberately runs at module scope, before main(): 35 awaits sit between
// main()'s start and the startup _collapseToDefaultOpen() call, and the tab
// panes are display:none until something is marked active. Activating here
// means the panel paints on the first frame and stays usable even if main()
// throws later (WebGL init failure on an unsupported device, say).
export function activateDefaultTab() {
  const pane = document
    .querySelector(".panel-section[data-default-open]")
    ?.closest(".tab-content");
  if (!pane) return; // no marker: leave whatever the markup says
  const name = pane.id.replace(/^tab-/, "");
  document
    .querySelectorAll(".tab")
    .forEach((b) => b.classList.toggle("active", b.dataset.tab === name));
  document
    .querySelectorAll(".tab-content")
    .forEach((c) => c.classList.toggle("active", c === pane));
}
activateDefaultTab();


async function main() {
  console.log(
    "%cImWeb v0.6.0",
    "color:#e8c840;font-weight:bold;font-size:14px",
  );

  // ── 1. Canvas & renderer ──────────────────────────────────────────────────

  const canvas = document.getElementById("output-canvas");
  // Logo shows the release version straight from package.json (Vite inlines it)
  const _statusName = document.getElementById("status-name");
  if (_statusName) _statusName.textContent = `ImWeb v${APP_VERSION}`;
  let canvasRect = canvas.getBoundingClientRect();
  window.addEventListener("resize", () => { canvasRect = canvas.getBoundingClientRect(); });

  // Detect WebGPU
  const hasWebGPU = !!navigator.gpu;
  console.info(`[Renderer] WebGPU: ${hasWebGPU ? "✓" : "✗ (using WebGL)"}`);

  // Three.js WebGL renderer (Phase 1 baseline; WebGPU compositor in Phase 2)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false, // off for performance — we do our own AA if needed
    alpha: false,
    powerPreference: "high-performance",
    preserveDrawingBuffer: true, // needed for canvas.toBlob() capture
  });
  renderer.setPixelRatio(1); // Performance: render at logical CSS pixels, not Retina 2×. On a Retina display, DPR=2 silently doubles every dimension (e.g. 905×963 → 1810×1926), quadrupling fill cost across 35+ shader passes with no perceptible quality gain on moving video. DPR=1 aligns the canvas buffer with Pipeline render targets and enables 60fps on display-size canvas.

  // Fix B — WebGL context loss recovery (GPU switch / second display)
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    console.warn('[ImWeb] WebGL context lost');
  }, false);
  renderer.domElement.addEventListener('webglcontextrestored', () => {
    console.warn('[ImWeb] WebGL context restored');
    pipeline.init?.();
    tdEngine.reinit?.();   // reallocate ring + re-run render-to-layer probe
    applyResolution(ps.get('output.resolution').value);
  }, false);

  // Fix A — DPR change detection (window moved to display with different pixel density)
  function _onDPRChange() {
    const newDPR = window.devicePixelRatio;
    renderer.setPixelRatio(newDPR);
    applyResolution(ps.get('output.resolution').value);
    window.matchMedia(`(resolution: ${newDPR}dppx)`)
      .addEventListener('change', _onDPRChange, { once: true });
  }
  window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)
    .addEventListener('change', _onDPRChange, { once: true });

  renderer.autoClear = false;

  // Initial size
  let W = canvas.parentElement.clientWidth;
  let H = canvas.parentElement.clientHeight;
  renderer.setSize(W, H);

  // ── 2. Parameter system ───────────────────────────────────────────────────

  const ps = new ParameterSystem();
  registerCoreParameters(ps);
  registerAnalogParams(ps);
  registerTeletextParams(ps);

  // ── Hypercube parameters ───────────────────────────────────────────────────
  ps.register({ id:'hypercube.dim',           type:'continuous', value:4,    min:4,    max:12,   step:1,     label:'Dimension',    group:'hypercube' });
  ps.register({ id:'hypercube.morphDuration', type:'continuous', value:2000, min:200,  max:8000, step:100,   group:'hypercube' });
  ps.register({ id:'hypercube.wDistance',     type:'continuous', value:3.0,  min:1.1,  max:20,   step:0.1,   group:'hypercube' });
  ps.register({ id:'hypercube.scale',         type:'continuous', value:1.0,  min:0.1,  max:5.0,  step:0.05,  group:'hypercube' });
  ps.register({ id:'hypercube.edgeOpacity',   type:'continuous', value:1.0,  min:0.0,  max:1.0,  step:0.01,  group:'hypercube' });
  ps.register({ id:'hypercube.pointSize',     type:'continuous', value:3.0,  min:0.5,  max:20,   step:0.5,   group:'hypercube' });
  ps.register({ id:'hypercube.rot.xy',        type:'continuous', value:0.30, min:-2.0, max:2.0,  step:0.01,  group:'hypercube' });
  ps.register({ id:'hypercube.rot.xz',        type:'continuous', value:0.20, min:-2.0, max:2.0,  step:0.01,  group:'hypercube' });
  ps.register({ id:'hypercube.rot.yz',        type:'continuous', value:0.15, min:-2.0, max:2.0,  step:0.01,  group:'hypercube' });
  ps.register({ id:'hypercube.rot.xw',        type:'continuous', value:0.40, min:-2.0, max:2.0,  step:0.01,  group:'hypercube' });
  ps.register({ id:'hypercube.edgeWidth',     type:'continuous', value:1.5,  min:0.5,  max:8.0,  step:0.1,   label:'Edge Width',   group:'hypercube' });
  ps.register({ id:'hypercube.renderMode',    type:'select',     options:['wireframe','points','both','none'], value:3, label:'Render Mode', group:'hypercube' });
  ps.register({ id:'hypercube.projMode',      type:'select',     options:['perspective','orthographic'],      value:0, label:'Proj Mode',    group:'hypercube' });
  ps.register({ id:'hypercube.faces.active',  type:'toggle',     value:0,                                    label:'Faces',        group:'hypercube' });
  ps.register({ id:'hypercube.faces.opacity', type:'continuous', value:0.5,  min:0.0,  max:1.0,  step:0.01,  label:'Face opacity', group:'hypercube' });
  ps.register({ id:'hypercube.faces.blend',   type:'select',     options:['Normal','Additive','Multiply','Subtract'], value:0, label:'Face blend', group:'hypercube' });
  ps.register({ id:'hypercube.faces.hue',     type:'continuous', value:0,    min:0,    max:360,  step:1,     label:'Face hue',     group:'hypercube' });
  ps.register({ id:'hypercube.faces.sat',     type:'continuous', value:0,    min:0,    max:100,  step:1,     label:'Face sat',     group:'hypercube' });
  ps.register({ id:'hypercube.faces.texsrc',  type:'select',     options:['None','Camera','Movie','Screen','Draw','Buffer','Noise'], value:0, label:'Face tex',   group:'hypercube' });
  ps.register({ id:'hypercube.faces.masksrc', type:'select',     options:['None','Camera','Movie','Screen','Draw','Buffer','Noise'], value:0, label:'Face mask',  group:'hypercube' });
  ps.register({ id:'hypercube.faces.maskinv', type:'toggle',     value:0,                                    label:'Mask invert', group:'hypercube' });
  ps.register({ id:'hypercube.faces.masklvl', type:'continuous', value:1.0,  min:0.0,  max:4.0,  step:0.01,  label:'Mask level',  group:'hypercube' });
  ps.register({ id:'hypercube.inst.active',   type:'toggle',     value:0,                                    label:'Instancer',    group:'hypercube' });
  ps.register({ id:'hypercube.inst.geo',      type:'select',     options:['Sphere','Torus','Cube','Plane','Cylinder','Capsule','TorusKnot','Cone','Dodecahedron','Icosahedron','Octahedron','Tetrahedron','Ring'], value:0, label:'Inst Geo', group:'hypercube' });
  ps.register({ id:'hypercube.inst.scale',    type:'continuous', value:0.08, min:0.01, max:2.0,  step:0.01,  label:'Inst Scale',   group:'hypercube' });
  ps.register({ id:'hypercube.inst.opacity',  type:'continuous', value:1.0,  min:0.0,  max:1.0,  step:0.01,  label:'Inst Opacity', group:'hypercube' });
  ps.register({ id:'hypercube.inst.texsrc',   type:'select',     options:['None','Camera','Movie','Screen','Draw','Buffer','Noise'], value:0, label:'Inst tex', group:'hypercube' });

  // ── 3. Controllers ────────────────────────────────────────────────────────

  const ctrl = new ControllerManager(ps);
  ctrl._clipLibrary = clipLibrary; // set now; _movieInput set after movieInput is created
  const automation = new Automation(ps);

  // ── 4. Input sources ──────────────────────────────────────────────────────

  const camera3d = new CameraInput();
  await camera3d.init();

  const movieInput = new MovieInput();
  const movieInputB = new MovieInput('movieB');
  // Dev-only console access — Deck B has no UI until v0.12 Step 4
  if (import.meta.env.DEV) window.__decks = { movieInput, movieInputB, ps };
  ctrl._movieInput = movieInput;

  const stillsBuffer = new StillsBuffer(renderer, W, H);
  const seq1 = new SequenceBuffer(renderer, W, H, 60, "seq1");
  const seq2 = new SequenceBuffer(renderer, W, H, 60, "seq2");
  const seq3 = new SequenceBuffer(renderer, W, H, 60, "seq3");
  const videoDelay = new VideoDelayLine(renderer, W, H, 30);
  // Time-Displace buffer resolution (decoupled from display). Index → [w,h];
  // null = Native (live display size). Mirrors RENDER_RESOLUTIONS.
  const TD_BUFFER_RES = [[320, 240], [640, 360], [640, 480], null];
  // td.captureSource → inputs key. Derived from SOURCE_KEYS (the canonical
  // list in ParameterSystem.js) — never hand-copied. The old hardcoded copy
  // had 25 entries against a 27-entry SOURCES, so selecting Movie B (25) or
  // Mix Bus (26) resolved to undefined and captured nothing.
  const _tdResolveBufRes = (idx) => {
    const p = TD_BUFFER_RES[idx];
    if (p) return p;
    // Native: clamp to 1280 wide (aspect preserved). The delay ring is 120
    // frames deep, so VRAM = w×h×4×120 — an unclamped 2000px+ desktop panel
    // allocates >1GB and fails silently. 1280×720×4×120 ≈ 440MB is the
    // proven-working ceiling (matches the iPad's natural CSS size).
    let w = canvas.parentElement.clientWidth || W;
    let h = canvas.parentElement.clientHeight || H;
    const TD_NATIVE_MAX_W = 1280;
    if (w > TD_NATIVE_MAX_W) {
      h = Math.max(1, Math.round(h * (TD_NATIVE_MAX_W / w)));
      w = TD_NATIVE_MAX_W;
    }
    return [w, h];
  };
  const [_tdBW, _tdBH] = _tdResolveBufRes(ps.get("td.bufferResolution").value);
  const tdEngine = new TimeDisplaceEngine(renderer, _tdBW, _tdBH, 120);
  tdEngine.setUpscaleFilter(ps.get("td.upscaleFilter").value);
  ps.get("td.bufferResolution").onChange((v) => {
    const [bw, bh] = _tdResolveBufRes(v);
    tdEngine.setBufferResolution(bw, bh);
  });
  ps.get("td.upscaleFilter").onChange((v) => tdEngine.setUpscaleFilter(v));
  const vectorscope = new VectorscopeInput();
  const slitScan = new SlitScanBuffer(W, H);
  const vasulkaWarp = new VasulkaWarp(renderer, W, H, 960);
  const particles = new ParticleEngine(renderer, ps);
  const sdfGen = new SDFGenerator(renderer, W, H);
  const analogTV      = new AnalogTV(renderer);
  const teletextSource = new TeletextSource();
  teletextSource.setMovieInput(movieInput);
  const warpMaps = buildWarpMaps(); // 8 procedural warp map textures (map1–map8)
  const warpEditor = new WarpMapEditor(); // interactive editor → warpMaps[8] (Custom)
  // Previous displace.warpDrawX/warpDrawY position, in 0..1 UV — the param-driven brush
  // derives its direction from the delta. null until the first tick so a fresh
  // load never brushes from a phantom origin.
  let _warpDrawPrev = null;
  // Brush radius now lives in displace.warpDrawRadius (percent) so it can be
  // dialled and controllered like everything else — see _warpStroke.
  const WARP_CUSTOM_IDX = 9;        // "Custom" in displace.warp options → warpMaps[8]
  const WARP_DRAW_GAIN = 10.0;      // displacement per unit of distance dragged
  const WARP_DRAW_MAX_STEP = 0.4;   // per-event ceiling, so one big step cannot spike
  const WARP_JUMP_MAX = 0.25;       // beyond this in one step it is a teleport

  /**
   * One stroke step on the Custom warp map, shared by the param-driven path
   * and by dragging on the main canvas.
   *
   * Two things make this behave rather than spike:
   *  - Strength is proportional to DISTANCE dragged, capped per event. This is
   *    frame-rate independent for free — more events each moving less sum to
   *    the same stroke — and it matches how the mini-editor calls brush().
   *  - A step larger than WARP_JUMP_MAX is a TELEPORT, not a gesture: a State
   *    recall or preset change snapping drawX from 10 to 90 would otherwise
   *    paint one enormous stroke across the map. Treated as pen-up — the
   *    caller still updates its previous position, so the next real move draws
   *    normally. Same rule a mouse re-entering the canvas needs.
   *
   * @param autoSelect only the param path may flip WarpMode; a canvas drag is
   *   already gated on Custom being selected.
   * @returns {boolean} true if a stroke was applied.
   */
  function _warpStroke(nx, ny, ddx, ddy, autoSelect = false) {
    const mag = Math.hypot(ddx, ddy);
    if (mag <= 1e-4) return false;      // stationary — nothing to draw
    if (mag > WARP_JUMP_MAX) return false; // teleport — pen-up
    if (autoSelect) {
      // Drawing only reaches the screen through the Custom warp map, so switch
      // to it on the first stroke — otherwise the honest experience is "I moved
      // the sliders and nothing happened". Deliberately narrow: only from
      // "off", and never when a controller owns the param, because writing a
      // parameter from the tick loop can fight state recall and morph.
      const wp = ps.get("displace.warp");
      if (wp.value === 0 && !wp.controller) ps.set("displace.warp", WARP_CUSTOM_IDX);
    }
    const amt = (ps.get("displace.warpDrawAmt")?.value ?? 100) / 100;
    // Displacement is proportional to DISTANCE travelled, not to elapsed time.
    // That is how a brush works, it matches how the mini-editor calls brush()
    // (raw delta × strength, no dt), and it is inherently frame-rate
    // independent: more events each moving less sum to the same stroke. The
    // previous rate×dt form capped a stroke at ~0.6×dt ≈ 0.01 per event no
    // matter how fast you moved, which is why it felt weak — and the main
    // canvas is ~4× wider than the editor, so the same hand movement is ~4×
    // less UV distance there.
    const strength = Math.min(mag * WARP_DRAW_GAIN, WARP_DRAW_MAX_STEP) * amt;

    // Direction: motion by default. With warpDrawFixed on, every stroke pushes
    // along warpDrawAngle instead — a steady wind field you can aim, rather
    // than a direction that changes with the way you happen to be moving.
    // Motion still decides WHETHER to draw and how fast, just not which way.
    let ux = ddx / mag, uy = ddy / mag;
    if (ps.get("displace.warpDrawFixed")?.value) {
      const a = ((ps.get("displace.warpDrawAngle")?.value ?? 0) * Math.PI) / 180;
      ux = Math.cos(a);
      uy = Math.sin(a);
    }
    // BOTH axes are negated, for one reason: the shader samples at
    // `vUv + displacement`, so a positive map value pulls content from further
    // along that axis and the picture appears to move the opposite way. To push
    // the image along (ux, uy) the map must store (-ux, -uy).
    // Y was previously left un-negated to cancel out a uv() that handed this
    // function a y-DOWN position. Now that uv() is y-up — matching the map,
    // whose row 0 is the BOTTOM of the screen because DataTexture defaults to
    // flipY:false — that compensation inverted the drag instead, and strokes
    // pushed the image up when you drew down. Position and direction have to
    // share one axis convention; fixing one without the other just moves the
    // mirror from where the stroke lands to which way it smears.
    const radius = (ps.get("displace.warpDrawRadius")?.value ?? 18) / 100;
    warpEditor.brush(nx, ny, radius, strength, -ux, -uy);
    return true;
  }
  // ── Warp slot / preset recall ─────────────────────────────────────────────
  // ONE implementation, reached three ways: the editor's own buttons, the
  // displace.warpSlot / displace.warpPreset SELECT params, and any controller
  // (LFO/MIDI/OSC/random) driving those params. The buttons SET the param
  // rather than recalling directly, so the badge and the grid can never
  // disagree about what was last recalled — the same shape glsl.preset uses.
  //
  // Both honour displace.warpSlotFade for free, because they route through
  // beginMorph/applyPreset, which already crossfade when handed seconds > 0.
  // Derived from the param, never hand-copied: the SELECT options ARE the list,
  // minus the leading "—" no-op. Three copies of these eight names (here, the
  // param, the editor's buttons) is precisely how the source list once drifted
  // into six copies with three of them wrong.
  const WARP_PRESET_NAMES = ps.get("displace.warpPreset").options.slice(1);

  /** Recall saved slot 1–16. Returns false for 0/out-of-range/empty slot. */
  function _recallWarpSlot(i) {
    if (!(i >= 1 && i <= 16)) return false;
    const secs = ps.get("displace.warpSlotFade")?.value ?? 0;
    // beginMorph returns false for an empty slot — don't switch WarpMode or
    // raise WarpAmt for a recall that put nothing on screen.
    if (!warpEditor.beginMorph(String(i), secs)) return false;
    ps.set("displace.warp", WARP_CUSTOM_IDX);
    if (ps.get("displace.warpamt").value === 0) ps.set("displace.warpamt", 80);
    return true;
  }

  /** Fire procedural preset 1–8 (see WARP_PRESET_NAMES). 0 is a no-op. */
  function _recallWarpPreset(i) {
    const name = WARP_PRESET_NAMES[i - 1];
    if (!name) return false;
    const secs = ps.get("displace.warpSlotFade")?.value ?? 0;
    if (name === "Reset") {
      // Reset is the one preset that must NOT force Custom mode on: it clears
      // the map, so activating it would show a flat warp instead of whatever
      // procedural mode was selected.
      if (secs > 0) warpEditor.morphToFlat(secs); else warpEditor.reset();
      return true;
    }
    warpEditor.applyPreset(name, 0.35, secs);
    ps.set("displace.warp", WARP_CUSTOM_IDX);
    if (ps.get("displace.warpamt").value === 0) ps.set("displace.warpamt", 50);
    return true;
  }

  // Attached so buildWarpEditor's buttons can reach the same code without
  // importing main.js — the pattern drawLayer.attachDrawSurface already uses.
  // Safe by construction: this runs at module setup, buildWarpEditor much later.
  warpEditor.recallSlot   = _recallWarpSlot;
  warpEditor.recallPreset = _recallWarpPreset;
  ps.get("displace.warpSlot").onChange((v)   => _recallWarpSlot(Math.round(v)));
  ps.get("displace.warpPreset").onChange((v) => _recallWarpPreset(Math.round(v)));

  warpMaps.push(warpEditor.texture); // index 9 in SELECT = warpMaps[8]
  const drawLayer = new DrawLayer();
  const strokeLooper = new StrokeLooper(drawLayer, ps);
  ctrl.setStrokeLooper(strokeLooper); // stroke→LFO controller driver
  const textLayer = new TextLayer();

  const scene3d = new SceneManager(renderer, W, H);
  await scene3d.createHypercube({ startDim: 4 });

  ps.get('hypercube.faces.active').onChange(v => {
    scene3d.getHypercube()?.setFacesVisible(!!v);
  });
  ps.get('hypercube.faces.opacity').onChange(v => {
    scene3d.getHypercube()?.setFaceOpacity(v);
  });
  ps.get('hypercube.faces.blend').onChange(idx => {
    scene3d.getHypercube()?.setFaceBlending(idx);
  });
  ps.get('hypercube.faces.hue').onChange(v => {
    const s = ps.get('hypercube.faces.sat').value;
    scene3d.getHypercube()?.setFaceHue(v, s);
  });
  ps.get('hypercube.faces.sat').onChange(v => {
    const h = ps.get('hypercube.faces.hue').value;
    scene3d.getHypercube()?.setFaceHue(h, v);
  });
  ps.get('hypercube.faces.maskinv').onChange(v => {
    scene3d.getHypercube()?.setFaceMaskInvert(!!v);
  });
  ps.get('hypercube.faces.masklvl').onChange(v => {
    scene3d.getHypercube()?.setFaceMaskLevel(v);
  });

  // Wire all hypercube ps params → HypercubeObject setters.
  // These fire during restoreState so saved values are pushed into the object on recall/startup.
  const _RENDER_MODES = ['wireframe','points','both','none'];
  const _PROJ_MODES   = ['perspective','orthographic'];
  const _GEO_TYPES    = ['Sphere','Torus','Cube','Plane','Cylinder','Capsule','TorusKnot','Cone','Dodecahedron','Icosahedron','Octahedron','Tetrahedron','Ring'];
  ps.get('hypercube.dim')?.onChange(v    => scene3d.getHypercube()?.morphTo(Math.round(v), { durationMs: 0 }));
  ps.get('hypercube.renderMode')?.onChange(i => scene3d.getHypercube()?.setRenderMode(_RENDER_MODES[i] ?? 'wireframe'));
  ps.get('hypercube.projMode')?.onChange(i   => scene3d.getHypercube()?.setProjectionMode(_PROJ_MODES[i] ?? 'perspective'));
  ps.get('hypercube.wDistance')?.onChange(v  => scene3d.getHypercube()?.setWDistance(v));
  ps.get('hypercube.scale')?.onChange(v      => scene3d.getHypercube()?.setScale(v));
  ps.get('hypercube.edgeOpacity')?.onChange(v => scene3d.getHypercube()?.setEdgeOpacity(v));
  ps.get('hypercube.pointSize')?.onChange(v  => scene3d.getHypercube()?.setPointSize(v));
  ps.get('hypercube.edgeWidth')?.onChange(v  => scene3d.getHypercube()?.setEdgeWidth(v));
  // Rotation plane indices: 0=xy, 1=xz, 2=yz, 3=xw (matches HypercubeGeometry iteration order)
  ps.get('hypercube.rot.xy')?.onChange(v => scene3d.getHypercube()?.setRotationSpeed(0, v));
  ps.get('hypercube.rot.xz')?.onChange(v => scene3d.getHypercube()?.setRotationSpeed(1, v));
  ps.get('hypercube.rot.yz')?.onChange(v => scene3d.getHypercube()?.setRotationSpeed(2, v));
  ps.get('hypercube.rot.xw')?.onChange(v => scene3d.getHypercube()?.setRotationSpeed(3, v));
  // Instancer
  ps.get('hypercube.inst.active')?.onChange(v  => scene3d.getHypercube()?.setInstancerVisible(!!v));
  ps.get('hypercube.inst.geo')?.onChange(idx   => scene3d.getHypercube()?.setInstancerGeoType(_GEO_TYPES[idx] ?? 'Sphere'));
  ps.get('hypercube.inst.scale')?.onChange(v   => scene3d.getHypercube()?.setInstancerScale(v));
  ps.get('hypercube.inst.opacity')?.onChange(v => scene3d.getHypercube()?.setInstancerOpacity(v));

  // Helper to manage sequence buffers for profiler/VRAM estimation
  const sequencerManager = {
    sequencers: [seq1, seq2, seq3],
  };

  // Color input — generates a solid color texture from HSV params
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = colorCanvas.height = 4;
  const colorCtx = colorCanvas.getContext("2d");
  const colorTexture = new THREE.CanvasTexture(colorCanvas);

  function updateColorTexture() {
    const h = ps.get("color1.hue").value / 100;
    const s = ps.get("color1.sat").value / 100;
    const v = ps.get("color1.val").value / 100;
    colorCtx.fillStyle = hsvToHex(h, s, v);
    colorCtx.fillRect(0, 0, 4, 4);
    colorTexture.needsUpdate = true;
  }
  ["color1.hue", "color1.sat", "color1.val"].forEach((id) =>
    ps.get(id).onChange(updateColorTexture),
  );
  updateColorTexture();

  // Color2 input — solid or gradient source (between color1 and color2)
  const color2Canvas = document.createElement("canvas");
  color2Canvas.width = color2Canvas.height = 256;
  const color2Ctx = color2Canvas.getContext("2d");
  const color2Texture = new THREE.CanvasTexture(color2Canvas);

  // Phase accumulator for Color2 gradient animation (driven by color2.speed)
  let _color2Phase = 0;

  function updateColor2Texture() {
    // Only apply phase offset when speed is non-zero (avoid permanent hue shift after stopping)
    const _phaseActive = (ps.get("color2.speed")?.value ?? 0) !== 0;
    const phaseOff = _phaseActive ? ((_color2Phase % 1) + 1) % 1 : 0;
    const h1 = (ps.get("color1.hue").value / 100 + phaseOff + 1) % 1;
    const s1 = ps.get("color1.sat").value / 100;
    const v1 = ps.get("color1.val").value / 100;
    const h2 = (ps.get("color2.hue").value / 100 + phaseOff + 1) % 1;
    const s2 = ps.get("color2.sat").value / 100;
    const v2 = ps.get("color2.val").value / 100;
    const type = ps.get("color2.type").value;
    const c1 = hsvToHex(h1, s1, v1);
    const c2 = hsvToHex(h2, s2, v2);
    const W = color2Canvas.width;
    const H = color2Canvas.height;

    if (type === 0) {
      // Solid
      color2Ctx.fillStyle = c2;
      color2Ctx.fillRect(0, 0, W, H);
    } else if (type === 1) {
      // Horizontal gradient
      const grad = color2Ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    } else if (type === 2) {
      // Vertical gradient
      const grad = color2Ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    } else {
      // Radial gradient
      const grad = color2Ctx.createRadialGradient(
        W / 2,
        H / 2,
        0,
        W / 2,
        H / 2,
        W / 2,
      );
      grad.addColorStop(0, c1);
      grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    }
    color2Texture.needsUpdate = true;
  }
  [
    "color1.hue",
    "color1.sat",
    "color1.val",
    "color2.hue",
    "color2.sat",
    "color2.val",
    "color2.type",
  ].forEach((id) => ps.get(id).onChange(updateColor2Texture));
  updateColor2Texture();

  // Noise texture — generated each frame on GPU via pipeline.generateNoise()
  let noiseTexture = null; // set in render loop after first pipeline call

  // Sound level texture — 1×1 greyscale, used when DS source = Sound
  const soundData = new Uint8Array([0, 0, 0, 255]);
  const soundTexture = new THREE.DataTexture(soundData, 1, 1, THREE.RGBAFormat);
  soundTexture.needsUpdate = true;

  // ── 5. Pipeline ───────────────────────────────────────────────────────────

  const pipeline = new Pipeline(renderer, W, H);
  // Dev-only console access for headless verification (verdict-cli)
  if (import.meta.env.DEV) window.__pipeline = pipeline;
  // VJ contract audio texture (256x2: FFT row + waveform row), lazily
  // created in the tick loop once sound is enabled
  let _vjAudioTex = null;
  let _vjAudioData = null;

  // Default startup state: FG=Color, BG=Color, DS=Noise; movie off until user clicks MovieOn
  ps.set("layer.fg", 3); // Color
  ps.set("layer.bg", 3); // Color
  ps.set("layer.ds", 4); // Noise

  // ── 6. Preset manager + Table manager ────────────────────────────────────

  const presetMgr = new PresetManager(ps, ctrl, pipeline);
  presetMgr.addEventListener('toast', e => showToast(e.detail.msg));

  // Wire pinned ghost node save/restore into the state system
  presetMgr.setPinsCallbacks(
    ()     => particles.ghostNodes.getPins(),
    (pins) => particles.ghostNodes.restorePins(pins),
  );

  // Wire extra non-param state (text content, imported 3D model flag) into state system
  presetMgr.setExtraCallback(() => ({
    textContent:      textLayer._contentList.length > 0
                        ? [...textLayer._contentList]
                        : (textLayer._text ? [textLayer._text] : []),
    scene3dHasImport: !!scene3d.importedModelName,
  }));

  // Populated by the hypercube panel build block (below). Calling it clears and
  // rebuilds the panel DOM so that select/range widgets reflect restored ps values.
  let _hcPanelRebuild = null;

  // Re-sync hypercube object after any state recall (onChange only fires on change,
  // so params that restored to the same value as the object's current state need this explicit push).
  presetMgr.addEventListener('stateRecalled', (e) => {
    const ds    = e.detail.state;
    const extra = ds?.extra;

    // ── Restore text layer content ──────────────────────────────────────────
    if (Array.isArray(extra?.textContent) && extra.textContent.length > 0) {
      const lines = extra.textContent;
      textLayer.setContentList(lines);
      if (lines.length <= 1) textLayer.setContent(lines[0] ?? '');
      const textContentEl = document.getElementById('text-content');
      if (textContentEl) textContentEl.value = lines.join('\n');
    }

    // ── Handle imported 3D model state ────────────────────────────────────
    // If the saved state had an imported model but none is currently loaded,
    // suppress applyParams() geometry overwrite so the user sees a neutral
    // 3D scene rather than the wrong geometry. _checkMediaRefs() will toast
    // the user to reload the model file.
    const mr = ds?.mediaRefs;
    if (mr?.scene3d && mr.scene3d.startsWith('/')) {
      scene3d.loadModelFromUrl(mr.scene3d);
    } else if (mr?.scene3d && !scene3d.importedModelName) {
      scene3d.setImportPending(mr.scene3d);
    } else if (!extra?.scene3dHasImport) {
      // State was saved without an imported model — clear any pending suppression
      scene3d.clearImportPending();
    }

    const hc = scene3d.getHypercube();
    if (!hc) return;
    const g = (id, def) => ps.get(id)?.value ?? def;
    const newDim = Math.round(g('hypercube.dim', 4));
    if (hc.dim !== newDim) hc.morphTo(newDim, { durationMs: 0 });
    hc.setWDistance  (g('hypercube.wDistance',   3.0));
    hc.setScale      (g('hypercube.scale',        1.0));
    hc.setEdgeOpacity(g('hypercube.edgeOpacity',  1.0));
    hc.setPointSize  (g('hypercube.pointSize',    3.0));
    hc.setEdgeWidth  (g('hypercube.edgeWidth',    1.5));
    hc.setRotationSpeed(0, g('hypercube.rot.xy',  0.30));
    hc.setRotationSpeed(1, g('hypercube.rot.xz',  0.20));
    hc.setRotationSpeed(2, g('hypercube.rot.yz',  0.15));
    hc.setRotationSpeed(3, g('hypercube.rot.xw',  0.40));
    hc.setRenderMode     (_RENDER_MODES[g('hypercube.renderMode', 0)] ?? 'wireframe');
    hc.setProjectionMode (_PROJ_MODES[g('hypercube.projMode', 0)]    ?? 'perspective');
    hc.setFacesVisible   (!!(g('hypercube.faces.active',  0)));
    hc.setFaceOpacity    (g('hypercube.faces.opacity', 0.5));
    hc.setFaceBlending   (g('hypercube.faces.blend',   0));
    hc.setFaceHue        (g('hypercube.faces.hue', 0), g('hypercube.faces.sat', 0));
    hc.setFaceMaskInvert (!!(g('hypercube.faces.maskinv', 0)));
    hc.setFaceMaskLevel  (g('hypercube.faces.masklvl', 1.0));
    hc.setInstancerVisible(!!(g('hypercube.inst.active', 0)));
    hc.setInstancerGeoType(_GEO_TYPES[g('hypercube.inst.geo', 0)] ?? 'Sphere');
    hc.setInstancerScale   (g('hypercube.inst.scale',   0.08));
    hc.setInstancerOpacity (g('hypercube.inst.opacity', 1.0));
    // Rebuild hypercube UI panel so all select/range widgets reflect restored ps values
    _hcPanelRebuild?.();
  });

  presetMgr.addEventListener('neutralState', () => {
    const _morphParam = ps.get('global.morphspeed');
    const _savedMorph = _morphParam?._value ?? 0;
    if (_morphParam) _morphParam._value = 0; // TODO: migrate to ps.suspendMorph() if added — suppress morph during reset cascade without firing onChange
    ps.getAll().forEach(p => p.reset());
    if (_morphParam) _morphParam.value = _savedMorph; // intentional: fires onChange → syncDisplay, correct one-time morph readout update after reset
    ps.set('layer.fg', 0);
    ps.set('layer.bg', 0);
    ps.set('layer.ds', 0);
  });
  await presetMgr.init();

  // Track URL-loaded models in preset state so future saveState() captures them
  const _baseLoadModelFromUrl = scene3d.loadModelFromUrl.bind(scene3d);
  scene3d.loadModelFromUrl = async (url) => {
    await _baseLoadModelFromUrl(url);
    if (url && url.startsWith('/')) presetMgr.setMediaRef('scene3d', url);
  };

  // Restore bundled model when activatePreset snaps to a state that saved one
  presetMgr._onStateActivated = (ds) => {
    const url = ds.mediaRefs?.scene3d;
    if (url && url.startsWith('/') && scene3d) scene3d.loadModelFromUrl(url);
  };

  // Force-push all hypercube ps values into the HypercubeObject unconditionally.
  // onChange only fires when a value changes — if the saved value matches the ps default
  // (which happens for states saved before the ps wiring existed) the object never gets updated.
  // This explicit sync guarantees the object matches ps after every startup/bank load.
  (function syncHypercubeFromPs() {
    const hc = scene3d.getHypercube();
    if (!hc) return;
    const g = (id, def) => ps.get(id)?.value ?? def;
    hc.morphTo(Math.round(g('hypercube.dim', 4)),   { durationMs: 0 });
    hc.setWDistance  (g('hypercube.wDistance',   3.0));
    hc.setScale      (g('hypercube.scale',        1.0));
    hc.setEdgeOpacity(g('hypercube.edgeOpacity',  1.0));
    hc.setPointSize  (g('hypercube.pointSize',    3.0));
    hc.setEdgeWidth  (g('hypercube.edgeWidth',    1.5));
    hc.setRotationSpeed(0, g('hypercube.rot.xy',  0.30));
    hc.setRotationSpeed(1, g('hypercube.rot.xz',  0.20));
    hc.setRotationSpeed(2, g('hypercube.rot.yz',  0.15));
    hc.setRotationSpeed(3, g('hypercube.rot.xw',  0.40));
    hc.setRenderMode     (_RENDER_MODES[g('hypercube.renderMode', 0)] ?? 'wireframe');
    hc.setProjectionMode (_PROJ_MODES[g('hypercube.projMode', 0)]    ?? 'perspective');
    hc.setFacesVisible   (!!(g('hypercube.faces.active',  0)));
    hc.setFaceOpacity    (g('hypercube.faces.opacity', 0.5));
    hc.setFaceBlending   (g('hypercube.faces.blend',   0));
    hc.setFaceHue        (g('hypercube.faces.hue', 0), g('hypercube.faces.sat', 0));
    hc.setFaceMaskInvert (!!(g('hypercube.faces.maskinv', 0)));
    hc.setFaceMaskLevel  (g('hypercube.faces.masklvl', 1.0));
    hc.setInstancerVisible(!!(g('hypercube.inst.active', 0)));
    hc.setInstancerGeoType(_GEO_TYPES[g('hypercube.inst.geo', 0)] ?? 'Sphere');
    hc.setInstancerScale   (g('hypercube.inst.scale',   0.08));
    hc.setInstancerOpacity (g('hypercube.inst.opacity', 1.0));
  })();

  ps.set("movie.active", 0); // always start with movie off regardless of saved preset state
  ps.set("movieB.active", 0);
  const stepSequencer = new StepSequencer(presetMgr);

  // MIDI Program Change → preset recall (PC 0–127 maps to preset index)
  ctrl.onMIDIPC = (pcNum) => presetMgr.activatePreset(pcNum);

  // Wire tableManager into ParameterSystem so controller setNormalized() applies curves
  setTableManager(tableManager);
  await tableManager.init(await openDB());

  // ── Morph control (state bar) ─────────────────────────────────────────────
  (function wireMorphCtrl() {
    const morphCtrl   = document.getElementById('morph-ctrl');
    const morphValEl  = document.getElementById('morph-speed-val');
    if (!morphCtrl || !morphValEl) return;

    const morphParam = ps.get('global.morphspeed');
    if (!morphParam) return;

    // Helper: format display value
    function fmtMorph(v) {
      if (v <= 0) return 'OFF';
      return v.toFixed(1) + 's';
    }

    // Reflect param → display
    function syncDisplay() {
      const v = morphParam.value;
      morphValEl.textContent = fmtMorph(v);
      morphCtrl.classList.toggle('morph-active', v > 0);
    }
    morphParam.onChange(() => syncDisplay());
    syncDisplay();

    // Drag interaction — pointer capture so drag works outside the element
    let _dragY = null, _dragStart = null, _dragging = false;
    morphCtrl.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault();
      _dragY     = e.clientY;
      _dragStart = morphParam.value;
      _dragging  = false;
      morphCtrl.setPointerCapture(e.pointerId);
    });
    morphCtrl.addEventListener('pointermove', e => {
      if (_dragY === null) return;
      const delta = (_dragY - e.clientY) * 0.1; // 1px ≈ 0.1 s
      if (Math.abs(delta) > 0.05) _dragging = true;
      const v = Math.max(0, Math.min(20, _dragStart + delta));
      ps.set('global.morphspeed', Math.round(v * 10) / 10);
    });
    morphCtrl.addEventListener('pointerup', () => {
      _dragY    = null;
      _dragStart = null;
    });

    // Double-click → inline edit (only when not a drag)
    morphCtrl.addEventListener('dblclick', e => {
      e.preventDefault();
      const input = document.createElement('input');
      input.type = 'text';
      input.value = morphParam.value <= 0 ? '0' : morphParam.value.toFixed(1);
      input.style.cssText = 'width:38px;font-size:11px;text-align:center;background:var(--bg-1);color:var(--text-1);border:1px solid var(--accent);border-radius:2px;padding:0 2px;';
      morphValEl.replaceWith(input);
      input.focus();
      input.select();
      function commit() {
        const v = parseFloat(input.value);
        if (!isNaN(v)) ps.set('global.morphspeed', Math.max(0, Math.min(20, Math.round(v * 10) / 10)));
        input.replaceWith(morphValEl);
        syncDisplay();
      }
      input.addEventListener('keydown', ev => {
        if (ev.key === 'Enter') { ev.preventDefault(); commit(); }
        if (ev.key === 'Escape') { input.replaceWith(morphValEl); syncDisplay(); }
      });
      input.addEventListener('blur', commit);
    });
  })();

  // ── Cached status bar elements ────────────────────────────────────────────
  const _vuCanvas = document.getElementById("status-vu");
  const _vuCtx = _vuCanvas?.getContext("2d");

  // ── BPM / Tap Tempo ───────────────────────────────────────────────────────
  const bpmEl = document.getElementById("status-bpm");
  ps.get("global.bpm").onChange((bpm) => {
    ctrl.syncBPM(bpm);
    if (bpmEl) bpmEl.textContent = `${Math.round(bpm)} bpm`;
  });
  // Click BPM indicator = tap tempo; right-click = toggle MIDI clock sync
  bpmEl?.addEventListener("click", (e) => {
    if (e.button !== 0) return;
    ps.trigger("global.tap");
  });
  const _enableMidiClock = () => {
    ctrl.enableMIDIClock((bpm) => {
      ps.set("global.bpm", bpm);
    });
    if (bpmEl) {
      bpmEl.title = "MIDI clock sync ON — right-click to disable";
      bpmEl.style.outline = "1px solid var(--accent)";
    }
  };
  const _disableMidiClock = () => {
    ctrl.disableMIDIClock();
    if (bpmEl) {
      bpmEl.title = "Click: tap tempo | Right-click: enable MIDI clock";
      bpmEl.style.outline = "";
    }
  };

  // global.midisync param drives clock enable/disable
  ps.get("global.midisync").onChange((v) => {
    v ? _enableMidiClock() : _disableMidiClock();
  });

  bpmEl?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    ps.set("global.midisync", ctrl._midiClockEnabled ? 0 : 1);
  });

  const _tapTimes = [];
  ps.get("global.tap").onTrigger(() => {
    ctrl.retriggerLFOs(); // sync all LFOs to the beat
    const now = performance.now();
    _tapTimes.push(now);
    if (_tapTimes.length > 5) _tapTimes.shift();
    if (_tapTimes.length >= 2) {
      let sum = 0;
      for (let i = 1; i < _tapTimes.length; i++)
        sum += _tapTimes[i] - _tapTimes[i - 1];
      const avgMs = sum / (_tapTimes.length - 1);
      const newBpm = Math.round(60000 / avgMs);
      ps.set("global.bpm", Math.max(20, Math.min(300, newBpm)));
    }
    // Reset if gap > 3 seconds
    setTimeout(() => {
      if (
        _tapTimes.length &&
        performance.now() - _tapTimes[_tapTimes.length - 1] > 3000
      ) {
        _tapTimes.length = 0;
      }
    }, 3100);
  });

  // ── 7. UI ─────────────────────────────────────────────────────────────────

  initTabs();
  const contextMenu = new ContextMenu(ps, ctrl, presetMgr, tableManager);
  buildLayerButtons(ps, contextMenu);
  buildMappingPanels(ps, contextMenu);

  // ── Palette section (FG/BG HSV pickers + named presets) ───────────────────
  {
    const palContainer = document.getElementById("palette-params");
    if (palContainer) {
      const PALETTE_PRESET_KEY = "imweb-palette-presets";
      let _palettePresets = [];
      try { _palettePresets = JSON.parse(localStorage.getItem(PALETTE_PRESET_KEY) ?? "[]"); }
      catch { _palettePresets = []; }

      const { refreshPresets } = buildPaletteSection(palContainer, ps, contextMenu, {
        presets: _palettePresets,
        onSave: (name) => {
          _palettePresets.push({
            name,
            fgH: ps.get("palette.fg.hue").value,
            fgS: ps.get("palette.fg.sat").value,
            fgV: ps.get("palette.fg.val").value,
            bgH: ps.get("palette.bg.hue").value,
            bgS: ps.get("palette.bg.sat").value,
            bgV: ps.get("palette.bg.val").value,
          });
          try { localStorage.setItem(PALETTE_PRESET_KEY, JSON.stringify(_palettePresets)); }
          catch { /* storage full */ }
          refreshPresets(_palettePresets);
        },
        onDelete: (idx) => {
          _palettePresets.splice(idx, 1);
          try { localStorage.setItem(PALETTE_PRESET_KEY, JSON.stringify(_palettePresets)); }
          catch { /* storage full */ }
          refreshPresets(_palettePresets);
        },
        onLoad: (pr) => {
          ps.set("palette.fg.hue", pr.fgH);
          ps.set("palette.fg.sat", pr.fgS);
          ps.set("palette.fg.val", pr.fgV);
          ps.set("palette.bg.hue", pr.bgH);
          ps.set("palette.bg.sat", pr.bgS);
          ps.set("palette.bg.val", pr.bgV);
        },
      });
    }
  }

  // ── AnalogTV preset system ─────────────────────────────────────────────
  {
    const analogPresetBar = document.getElementById("analog-preset-bar");
    if (analogPresetBar) {
      const PRESET_KEY = "imweb-analogtv-presets";
      let _atvPresets = [];
      try { _atvPresets = JSON.parse(localStorage.getItem(PRESET_KEY) ?? "[]"); }
      catch { _atvPresets = []; }

      const { refreshPresets } = buildAnalogPresetBar(analogPresetBar, ps, {
        builtinPresets: BUILTIN_PRESETS,
        presets: _atvPresets,
        onSave: (name) => {
          _atvPresets.push({ name, values: captureAnalogState(ps) });
          try { localStorage.setItem(PRESET_KEY, JSON.stringify(_atvPresets)); }
          catch { /* storage full */ }
          refreshPresets(_atvPresets);
        },
        onDelete: (idx) => {
          _atvPresets.splice(idx, 1);
          try { localStorage.setItem(PRESET_KEY, JSON.stringify(_atvPresets)); }
          catch { /* storage full */ }
          refreshPresets(_atvPresets);
        },
        onLoad: (pr) => {
          applyAnalogPreset(ps, pr.values);
        },
      });
    }
  }

  // ── Teletext UI — page nav, sub-page arrows, RSS input ──────────────────
  {
    const ttContainer = document.getElementById('teletext-params');
    if (ttContainer) buildTeletextUI(ttContainer, ps, teletextSource, contextMenu);

    // Teletext sub-page triggers — MIDI/LFO/key assignable
    ps.get('teletext.subPageNext')?.onTrigger?.(() => teletextSource.nextSubPage());
    ps.get('teletext.subPagePrev')?.onTrigger?.(() => teletextSource.prevSubPage());
    ps.get('teletext.cursorUp')?.onTrigger?.(() => teletextSource.moveCursor(-1));
    ps.get('teletext.cursorDown')?.onTrigger?.(() => teletextSource.moveCursor(1));
    ps.get('teletext.openItem')?.onTrigger?.(() => teletextSource.openSelected());
    for (let i = 1; i <= 8; i++) {
      const idx = i - 1;
      ps.get(`teletext.openItem${i}`)?.onTrigger?.(() => teletextSource.openItem(idx));
    }
    ps.get('teletext.articleFetch')?.onChange?.(v => teletextSource.setArticleFetch(v));

    // Show teletext section only when sourceType === 'Teletext' (index 14)
    const ttSection = document.getElementById('teletext-section');
    if (ttSection) {
      ttSection.style.display = ps.get('analog.sourceType')?.value === 14 ? '' : 'none';
      ps.get('analog.sourceType')?.onChange?.(v => {
        ttSection.style.display = v === 14 ? '' : 'none';
        if (v === 14) ps.set('analog.crop43', 0);
      });
    }
  }

  buildNoisePanel(ps, contextMenu);
  buildSeqParams(ps, contextMenu);
  buildGeometryButtons(ps, scene3d, contextMenu);

  // ── Hypercube panel — appended as a section inside #tab-scene3d ───────────
  {
    const scene3dTab = document.getElementById('tab-scene3d');
    if (scene3dTab) {
      const hcSection = document.createElement('div');
      hcSection.className = 'panel-section';
      const hcHeader = document.createElement('div');
      hcHeader.className = 'section-header';
      hcHeader.textContent = 'Hypercube';
      const hcContainer = document.createElement('div');
      hcSection.appendChild(hcHeader);
      hcSection.appendChild(hcContainer);
      scene3dTab.appendChild(hcSection);

      const hc = scene3d.getHypercube();
      if (hc) {
        import('./scene3d/HypercubeUI.js').then(({ buildHypercubePanel }) => {
          buildHypercubePanel(hcContainer, hc, ps);
          // Rebuild function: clear container and re-run buildHypercubePanel so that
          // all select/range widgets pick up restored ps values after a state recall.
          _hcPanelRebuild = () => {
            hcContainer.innerHTML = '';
            buildHypercubePanel(hcContainer, hc, ps);
          };
        });
      }
    }
  }

  buildWarpEditor(warpEditor, ps, contextMenu);
  const { refreshClipGrid, setRecording } = buildClipLibrary(
    ps,
    clipLibrary,
    movieInput,
    contextMenu,
    { input: movieInputB, onLoad: refreshClipBStatus },
  );

  /** Deck B status in the Movie B panel: active clip thumbnail + name, above
   *  the rack list. Deck B renders through the same _renderRack() as Deck A —
   *  the original "no duplicated DOM" constraint is met by parameterising that
   *  one renderer, not by leaving Deck B listless. Every existing caller of
   *  this function refreshes the rack too, so no call site had to change. */
  function refreshClipBStatus() {
    const el = document.getElementById("clipB-status");
    refreshClipsBList();
    if (!el) return;
    el.innerHTML = "";
    const n = movieInputB.clips.length;
    if (!n) {
      el.textContent =
        "No clip — ⇧-click a library slot or ⇧-drop a video to load Deck B";
      return;
    }
    const cur = movieInputB.currentClip;
    el.style.display = "flex";
    el.style.alignItems = "center";
    el.style.gap = "8px";
    if (cur?.thumb) {
      const img = document.createElement("img");
      img.src = cur.thumb;
      img.width = 48;
      img.height = 27;
      img.style.cssText =
        "object-fit:cover;border:1px solid var(--border);border-radius:2px;flex:none;";
      el.appendChild(img);
    }
    const label = document.createElement("span");
    const name = cur ? cur.name.replace(/\.[^/.]+$/, "") : "—";
    const on = ps.get("movieB.active").value;
    label.textContent = `${on ? "▶" : "⏸"} ${name} · ${n} clip${n > 1 ? "s" : ""}`;
    label.title = cur?.name ?? "";
    el.appendChild(label);
  }

  // Update model status label after drag-and-drop or button import
  function _refreshModelLabel() {
    const lbl = document.getElementById("model-status-label");
    if (!lbl) return;
    const name = scene3d.importedModelName;
    if (name) {
      lbl.textContent = `✓ ${name}`;
      lbl.style.color = "var(--green)";
    } else {
      lbl.textContent =
        "No model loaded — drop .glb/.obj/.stl here or use button below";
      lbl.style.color = "";
    }
  }

  // modelLoaded event from the import button in buildGeometryButtons
  document
    .getElementById("model-import")
    ?.addEventListener("modelLoaded", (e) => {
      if (ps.get("layer.fg").value === 0) ps.set("layer.fg", 5);
      ps.set("scene3d.active", 1);
      ps.set("scene3d.anim.active", 1);
      _refreshModelLabel();
    });

  // ── Collapsible section headers + Detach + Collapse-all ──────────────────

  // Detached panel drag — pointer events (mouse + touch + pen). Pointer
  // capture keeps the drag even when the finger leaves the title bar;
  // touch-action:none stops the browser claiming the gesture for scroll.
  function _makeDraggable(panel, handle) {
    let ox = 0,
      oy = 0,
      pid = null;
    handle.style.touchAction = "none";
    handle.addEventListener("pointerdown", (e) => {
      if (e.target.tagName === "BUTTON") return;
      handle.setPointerCapture(e.pointerId);
      pid = e.pointerId;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    handle.addEventListener("pointermove", (e) => {
      if (pid !== e.pointerId) return;
      panel.style.left = e.clientX - ox + "px";
      panel.style.top = e.clientY - oy + "px";
    });
    const _endDrag = (e) => {
      if (pid === e.pointerId) pid = null;
    };
    handle.addEventListener("pointerup", _endDrag);
    handle.addEventListener("pointercancel", _endDrag);
  }

  // Detach a panel-section into a floating window
  function _detachSection(section) {
    const title =
      section
        .querySelector(".section-header")
        ?.childNodes[0]?.textContent.trim() ?? "Panel";
    const origParent = section.parentElement;
    const origNext = section.nextSibling;

    // Leave a slim placeholder so layout doesn't jump
    const placeholder = document.createElement("div");
    placeholder.className = "detach-placeholder";
    placeholder.style.cssText =
      "height:28px;border-bottom:1px dashed var(--border);display:flex;align-items:center;padding:0 10px;font-family:var(--mono);font-size:10px;color:var(--text-2);cursor:pointer;";
    placeholder.textContent = `↗ ${title} (detached)`;
    origParent.insertBefore(placeholder, origNext);

    const panel = document.createElement("div");
    panel.className = "detached-panel";
    const rect = section.getBoundingClientRect();
    panel.style.left = Math.min(rect.right + 8, window.innerWidth - 300) + "px";
    panel.style.top = Math.max(4, rect.top) + "px";

    const titleBar = document.createElement("div");
    titleBar.className = "detached-panel-title";
    titleBar.textContent = title;

    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Re-attach";

    const reattach = () => {
      placeholder.replaceWith(section);
      panel.remove();
      section.classList.remove("collapsed");
      section.querySelector(".section-header")?.classList.remove("collapsed");
    };
    closeBtn.addEventListener("click", reattach);
    placeholder.addEventListener("click", reattach);

    titleBar.appendChild(closeBtn);

    const panelBody = document.createElement("div");
    panelBody.className = "detached-panel-body";
    panelBody.appendChild(section);

    panel.appendChild(titleBar);
    panel.appendChild(panelBody);
    document.body.appendChild(panel);
    _makeDraggable(panel, titleBar);
  }

  let _allCollapsed = false;
  document.querySelectorAll(".section-header").forEach((hdr) => {
    // Collapse on click (but not if a button inside was clicked)
    hdr.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return;
      hdr.closest(".panel-section")?.classList.toggle("collapsed");
      hdr.classList.toggle("collapsed");
    });

    // Add action buttons: detach + (collapse-all on first header of each tab)
    const btns = document.createElement("div");
    btns.className = "section-header-btns";

    const detachBtn = document.createElement("button");
    detachBtn.textContent = "⊞";
    detachBtn.title = "Detach panel";
    detachBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      _detachSection(hdr.closest(".panel-section"));
    });
    btns.appendChild(detachBtn);
    hdr.appendChild(btns);
  });

  // ── Contextual workspace router (Phase 24) ────────────────────────────────
  // Large source editors are no longer top-level tabs. Each is opened from its
  // row in Sources (or Effects, for Live GLSL) and appears as a sixth,
  // contextual tab. The taxonomy therefore stays one axis — signal flow —
  // while the editors keep a full-width surface. See
  // docs/ImWeb-UI-Taxonomy-Phase24-Proposal.md §3.
  const WORKSPACES = [
    { key: "scene3d", pane: "tab-scene3d", label: "3D Scene" },
    { key: "analog",  pane: "tab-analog",  label: "Analog TV" },
    { key: "draw",    pane: "tab-draw",    label: "Draw" },
    { key: "glsl",    pane: "tab-glsl",    label: "Live GLSL" },
  ];
  let _openWorkspace = null; // key of the open workspace, or null
  let _wsReturnTab = null;   // data-tab to restore when it closes

  // #tab-glsl is a plain wrapper nested inside #tab-effects. To be shown as a
  // workspace it must be a .tab-content sibling of the other panes, so promote
  // it once at init. Same element throughout, so the existing
  // getElementById("tab-glsl") consumer keeps working.
  {
    const glslPane = document.getElementById("tab-glsl");
    if (glslPane && !glslPane.classList.contains("tab-content")) {
      glslPane.classList.add("tab-content");
      document.getElementById("control-panel")?.appendChild(glslPane);
    }
  }

  const _showPane = (paneId) =>
    document
      .querySelectorAll(".tab-content")
      .forEach((c) => c.classList.toggle("active", c.id === paneId));

  function openWorkspace(key) {
    const ws = WORKSPACES.find((w) => w.key === key);
    const pane = ws && document.getElementById(ws.pane);
    if (!pane) return;
    // Remember where to go back to, but only on the first open — re-opening an
    // already-open workspace must not overwrite the return tab with itself.
    if (_openWorkspace !== key) {
      const cur = document.querySelector(".tab.active")?.dataset.tab;
      if (cur) _wsReturnTab = cur;
    }
    _openWorkspace = key;

    const slot = document.getElementById("tab-workspace-slot");
    if (!slot) return;
    slot.innerHTML = "";
    const btn = document.createElement("button");
    btn.className = "tab tab-workspace active";
    btn.dataset.workspace = key;
    btn.append(ws.label);
    // initTabs() bound its handlers at load, so this button needs its own.
    btn.addEventListener("click", (e) => {
      if (e.target.tagName === "BUTTON") return; // the ✕ handles itself
      document
        .querySelectorAll(".tab")
        .forEach((t) => t.classList.toggle("active", t === btn));
      _showPane(ws.pane);
    });
    const close = document.createElement("button");
    close.className = "ws-close";
    close.textContent = "✕";
    close.title = "Close workspace";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWorkspace();
    });
    btn.appendChild(close);
    slot.appendChild(btn);

    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t === btn));
    _showPane(ws.pane);
  }

  /** Idempotent — safe to call when nothing is open (see _resetAllParams). */
  function closeWorkspace() {
    const slot = document.getElementById("tab-workspace-slot");
    // Was the user actually looking at the workspace? If they had already
    // switched to a fixed tab, closing must not yank them somewhere else.
    const wasActive = !!slot?.querySelector(".tab-workspace.active");
    if (slot) slot.innerHTML = "";
    if (!_openWorkspace) return;
    _openWorkspace = null;
    if (!wasActive) {
      _wsReturnTab = null;
      return;
    }
    // Return to the tab we came from; fall back to Sources, where the source
    // that owns the workspace lives.
    const back =
      _wsReturnTab && document.getElementById(`tab-${_wsReturnTab}`)
        ? _wsReturnTab
        : "sources";
    _wsReturnTab = null;
    document
      .querySelectorAll(".tab")
      .forEach((t) => t.classList.toggle("active", t.dataset.tab === back));
    _showPane(`tab-${back}`);
  }

  document.querySelectorAll("[data-workspace]").forEach((el) => {
    if (el.classList.contains("tab")) return; // the contextual tab itself
    el.addEventListener("click", () => openWorkspace(el.dataset.workspace));
  });

  // Collapse / expand all sections
  const collapseAllBtn = document.getElementById("btn-collapse-all");
  collapseAllBtn?.addEventListener("click", () => {
    _allCollapsed = !_allCollapsed;
    document.querySelectorAll(".panel-section").forEach((sec) => {
      const hdr = sec.querySelector(".section-header");
      sec.classList.toggle("collapsed", _allCollapsed);
      hdr?.classList.toggle("collapsed", _allCollapsed);
    });
    collapseAllBtn.textContent = _allCollapsed ? "⊞" : "⊟";
  });

  // Collapse every section except the one(s) marked data-default-open in
  // index.html. Previously this matched the header text against the literal
  // string "Layers", so renaming or moving that section silently booted the
  // app with everything collapsed. The marker is explicit and greppable:
  // header text is now free to change, and the marker can move to any
  // section on any tab.
  function _collapseToDefaultOpen() {
    document.querySelectorAll(".panel-section").forEach((sec) => {
      const hdr = sec.querySelector(".section-header");
      const keepOpen = sec.hasAttribute("data-default-open");
      sec.classList.toggle("collapsed", !keepOpen);
      hdr?.classList.toggle("collapsed", !keepOpen);
    });
    // Land on the tab that owns the marked section, so reset-all returns to
    // the same place a cold boot does. Same helper the module-scope call uses.
    activateDefaultTab();
  }

  // Reset all params to defaults → clean camera state
  async function _resetAllParams() {
    if (!confirm("Reset all parameters to defaults?")) return;
    const _morphParam = ps.get('global.morphspeed');
    const _savedMorph = _morphParam?._value ?? 0;
    if (_morphParam) _morphParam._value = 0; // TODO: migrate to ps.suspendMorph() if added — suppress morph during reset cascade without firing onChange
    ctrl.clearAllAssignments();
    ps.getAll().forEach((p) => p.reset());
    if (_morphParam) _morphParam.value = _savedMorph; // intentional: fires onChange → syncDisplay, correct one-time morph readout update after reset
    ps.set("layer.fg", 0); // Camera
    ps.set("layer.bg", 0); // Camera
    ps.set("layer.ds", 0); // Camera
    // Global reset is a zero-state return, and that includes the interface:
    // close any open workspace before landing on the default tab, so the user
    // is not left inside a 3D/Analog editor after everything else was reset.
    // closeWorkspace() is idempotent — safe when nothing is open.
    // (Proposal §7. State recall deliberately does NOT do this.)
    closeWorkspace();
    _collapseToDefaultOpen();
    // Start camera if not already running
    if (!camera3d.active) {
      const ok = await camera3d.start(null);
      if (ok) {
        const btnCam = document.getElementById("btn-camera-on");
        if (btnCam) btnCam.textContent = "■ Camera";
        ps.set("camera.active", 1);
      }
    }
  }
  document
    .getElementById("btn-reset-all")
    ?.addEventListener("click", _resetAllParams);

  // ── LUT loader ────────────────────────────────────────────────────────────
  const lutNameEl = document.getElementById("lut-name");
  document.getElementById("btn-load-lut")?.addEventListener("click", () => {
    const inp = document.createElement("input");
    inp.type = "file";
    inp.accept = ".cube";
    inp.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lut = parseCubeFile(text);
        pipeline.setLUT(lut, ps.get("effect.lutamount")?.value / 100 ?? 1);
        if (lutNameEl) lutNameEl.textContent = file.name;
      } catch (err) {
        alert(`LUT load failed: ${err.message}`);
        console.error("[LUT]", err);
      }
    };
    inp.click();
  });
  document.getElementById("btn-clear-lut")?.addEventListener("click", () => {
    pipeline.clearLUT();
    if (lutNameEl) lutNameEl.textContent = "No LUT";
  });
  // LUT amount updates are read directly from ps in pipeline.render()

  const stateBar = new StateBar(presetMgr, scene3d);

  // Quick-save current state to next empty slot with auto-thumbnail —
  // shared by Shift+S and the mobile Save button
  const quickSaveState = () =>
    presetMgr.saveCurrentState(null).then((idx) => {
      if (idx !== null) {
        const bank = presetMgr.current;
        if (stateBar._captureThumbFn && bank?.states[idx]) {
          bank.states[idx].thumbnail = stateBar._captureThumbFn();
          bank.save?.();
          presetMgr.dispatchEvent(new CustomEvent('stateSaved',
            { detail: { presetIndex: presetMgr.currentIdx, stateIndex: idx } }));
        }
        stateBar._flashTile?.(idx);
      }
      return idx;
    });

  // Desktop state-bar ＋ tile — same quick-save as ⇧S / mobile Save button
  document
    .getElementById("state-save-desktop")
    ?.addEventListener("click", quickSaveState);

  // ≤900px / large-touch only (Phase 4)
  const mobileStatePad = new MobileStatePad(presetMgr, { onQuickSave: quickSaveState });
  void mobileStatePad;
  const signalPath = new SignalPath({
    ps,
    pipeline,
    onOrderChange: (order) => {
      pipeline.setFxOrder(order);
      signalPath._fxOrder = [...order];
      signalPath._render();
    },
  });
  const feedbackOl = new FeedbackOverlay(ps);
  const memoryPanel = new MemoryPanel(presetMgr, scene3d);
  const profiler = new Profiler();
  const debugOverlay = new DebugOverlay(ps);
  const tablesEditor = new TablesEditor(tableManager, ps, ctrl, contextMenu);

  // ── Preset save buttons ───────────────────────────────────────────────────

  // ── Signal path float / dock ──────────────────────────────────────────────
  (() => {
    const spEl = document.getElementById("signal-path");
    const btn = document.getElementById("btn-signal-path");
    if (!spEl || !btn) return;

    let _spFloating = false;
    let _spDragOx = 0,
      _spDragOy = 0,
      _spDragging = false;

    function _floatSP() {
      _spFloating = true;
      btn.style.color = "var(--accent)";

      // Remove from fixed-bottom layout: shrink the app area back
      document.documentElement.style.setProperty("--signal-h", "0px");

      // Build title bar
      const titleBar = document.createElement("div");
      titleBar.className = "sp-float-titlebar";
      titleBar.textContent = "Signal Path";

      const closeBtn = document.createElement("button");
      closeBtn.textContent = "✕";
      closeBtn.title = "Dock signal path";
      closeBtn.addEventListener("click", _dockSP);
      titleBar.appendChild(closeBtn);

      // Wrap display in a body div
      const displayEl = document.getElementById("signal-path-display");
      const body = document.createElement("div");
      body.className = "sp-float-body";
      body.appendChild(displayEl);

      spEl.innerHTML = "";
      spEl.appendChild(titleBar);
      spEl.appendChild(body);
      spEl.classList.add("sp-float-panel");

      // Position near top-left of output panel
      const rect = document
        .getElementById("output-panel")
        ?.getBoundingClientRect() ?? { left: 0, top: 40 };
      spEl.style.left = rect.left + 12 + "px";
      spEl.style.top = rect.top + 12 + "px";

      // Drag on title bar — pointer events so it also drags on the iPad
      titleBar.style.touchAction = "none";
      titleBar.addEventListener("pointerdown", (e) => {
        if (e.target.tagName === "BUTTON") return;
        titleBar.setPointerCapture(e.pointerId);
        _spDragging = true;
        _spDragOx = e.clientX - spEl.offsetLeft;
        _spDragOy = e.clientY - spEl.offsetTop;
        e.preventDefault();
      });
      titleBar.addEventListener("pointermove", (e) => {
        if (!_spDragging) return;
        spEl.style.left = e.clientX - _spDragOx + "px";
        spEl.style.top = e.clientY - _spDragOy + "px";
      });
      titleBar.addEventListener("pointerup", () => { _spDragging = false; });
      titleBar.addEventListener("pointercancel", () => { _spDragging = false; });
    }

    function _dockSP() {
      _spFloating = false;
      btn.style.color = "";
      document.documentElement.style.removeProperty("--signal-h");

      // Extract displayEl before clearing innerHTML
      const displayEl = document.getElementById("signal-path-display");
      if (displayEl) document.body.appendChild(displayEl); // temp parking

      spEl.classList.remove("sp-float-panel");
      spEl.style.left = "";
      spEl.style.top = "";
      spEl.innerHTML = "";

      if (displayEl) spEl.appendChild(displayEl);
      signalPath._render();
    }

    // (window mousemove/mouseup fallbacks removed — the title bar owns the
    // drag via pointer capture, which covers mouse, touch and pen)

    // Visibility: hidden by default (the docked band read as clutter over
    // the state bar). The toolbar icon toggles show/hide; float/dock moved
    // to Shift+P only. Preference persists in localStorage.
    let _spHidden = localStorage.getItem("imweb-signalpath-hidden") !== "0";
    const _applySPHidden = () => {
      document.body.classList.toggle("signalpath-hidden", _spHidden);
      btn.classList.toggle("active", !_spHidden);
      localStorage.setItem("imweb-signalpath-hidden", _spHidden ? "1" : "0");
    };
    _applySPHidden();

    btn.addEventListener("click", () => {
      if (_spFloating) { _dockSP(); _spHidden = true; } // floating → hide
      else _spHidden = !_spHidden;
      _applySPHidden();
    });

    // Shift+P = float/dock (floating implies visible)
    window.addEventListener("keydown", (e) => {
      if (e.shiftKey && e.key === "P" && !e.target.closest("input,textarea")) {
        e.preventDefault();
        if (_spFloating) _dockSP();
        else {
          _spHidden = false;
          _applySPHidden();
          _floatSP();
        }
      }
    });
  })();

  // ── Controller assignment map panel ──────────────────────────────────────
  (() => {
    const btn = document.getElementById("btn-ctrl-map");
    if (!btn) return;

    let panel = null;
    let _pollId = null;

    const TYPE_LABEL = {
      "lfo-sine": "LFO ~",
      "lfo-triangle": "LFO △",
      "lfo-sawtooth": "LFO /",
      "lfo-square": "LFO ⊓",
      "midi-cc": "MIDI CC",
      "midi-note": "MIDI Note",
      "mouse-x": "Mouse X",
      "mouse-y": "Mouse Y",
      "sound-vu": "Sound VU",
      "sound-fft": "Sound FFT",
      key: "Key",
      random: "Random",
      expr: "Expr",
      fixed: "Fixed",
    };

    function _ctrlDetail(c) {
      if (!c) return "";
      if (c.type === "midi-cc") return `CH${c.channel ?? "?"} CC${c.cc}`;
      if (c.type === "midi-note") return `CH${c.channel ?? "?"} N${c.note}`;
      if (
        c.type === "lfo-sine" ||
        c.type === "lfo-triangle" ||
        c.type === "lfo-sawtooth" ||
        c.type === "lfo-square"
      ) {
        return c.beatSync
          ? `÷${c.beatDiv ?? 1}`
          : `${(c.hz ?? 1).toFixed(2)}hz`;
      }
      if (c.type === "key") return `[${c.key}]`;
      if (c.type === "expr")
        return c.expr?.slice(0, 16) + (c.expr?.length > 16 ? "…" : "");
      return "";
    }

    function _render() {
      if (!panel) return;
      const assigned = ps.getAll().filter((p) => p.controller);
      const list = panel.querySelector(".cm-list");

      if (!assigned.length) {
        list.innerHTML = '<div class="cm-empty">No active assignments</div>';
        return;
      }

      // Group by controller type
      const groups = {};
      assigned.forEach((p) => {
        const t = p.controller.type;
        (groups[t] ??= []).push(p);
      });

      list.innerHTML = Object.entries(groups)
        .map(([type, params]) => {
          const label = TYPE_LABEL[type] ?? type;
          const rows = params
            .map((p) => {
              const detail = _ctrlDetail(p.controller);
              return `<div class="cm-row" data-id="${p.id}">
            <span class="cm-pid">${p.id}</span>
            <span class="cm-type">${label}</span>
            <span class="cm-detail">${detail}</span>
            <button class="cm-remove" data-id="${p.id}" title="Remove assignment">✕</button>
          </div>`;
            })
            .join("");
          return `<div class="cm-group">${rows}</div>`;
        })
        .join("");

      list.querySelectorAll(".cm-remove").forEach((b) => {
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          ctrl.assign(b.dataset.id, null);
          _render();
        });
      });
    }

    function _open() {
      panel = document.createElement("div");
      panel.id = "ctrl-map-panel";
      panel.innerHTML = `
        <div class="cm-titlebar">
          <span>Active Controllers</span>
          <button id="cm-clear-all" title="Clear all assignments">Clear All</button>
          <button id="cm-close">✕</button>
        </div>
        <div class="cm-list"></div>`;
      document.body.appendChild(panel);

      // Position near the button (below it, clamped to viewport — the button
      // sits in the top status bar, so "above" would render off-screen)
      const r = btn.getBoundingClientRect();
      panel.style.left = Math.max(4, Math.min(r.left - 220, window.innerWidth - panel.offsetWidth - 4)) + "px";
      panel.style.top = Math.min(r.bottom + 4, window.innerHeight - panel.offsetHeight - 4) + "px";

      panel.querySelector("#cm-close").addEventListener("click", _close);
      panel.querySelector("#cm-clear-all").addEventListener("click", () => {
        ctrl.clearAllAssignments();
        _render();
      });

      _render();
      // Reposition now that height is known
      panel.style.left = Math.max(4, Math.min(r.left - 220, window.innerWidth - panel.offsetWidth - 4)) + "px";
      panel.style.top = Math.min(r.bottom + 4, window.innerHeight - panel.offsetHeight - 4) + "px";
      _pollId = setInterval(_render, 1000);
      btn.classList.add("active");
    }

    function _close() {
      panel?.remove();
      panel = null;
      clearInterval(_pollId);
      btn.classList.remove("active");
    }

    btn.addEventListener("click", () => {
      panel ? _close() : _open();
    });
  })();

  // ── MovieOn button (status bar) ───────────────────────────────────────────
  (() => {
    const btn = document.getElementById("btn-movie-on");
    if (!btn) return;
    const update = (v) => {
      btn.classList.toggle("active", !!v);
      btn.textContent = v ? "Movie On" : "Movie Off";
    };
    btn.addEventListener("click", () => ps.toggle("movie.active"));
    ps.get("movie.active").onChange(update);
    update(ps.get("movie.active").value);
  })();

  // ── Camera toggle button (status bar) — mirrors MovieOn pattern ──────────
  (() => {
    const btn = document.getElementById("btn-camera-toggle");
    if (!btn) return;
    const update = (v) => {
      btn.classList.toggle("active", !!v);
      btn.textContent = v ? "Camera On" : "Camera Off";
    };
    btn.addEventListener("click", () => ps.toggle("camera.active"));
    ps.get("camera.active").onChange(update);
    update(ps.get("camera.active").value);
  })();

  // Selfie mirror targets the SLOT the camera currently occupies (mirror
  // params are slot-based: mirror.fg / mirror.bg). No-op if the camera
  // isn't on either layer.
  const setCameraMirror = (on) => {
    if (Math.round(ps.get("layer.fg").value) === 0) ps.set("mirror.fg", on ? 1 : 0);
    else if (Math.round(ps.get("layer.bg").value) === 0) ps.set("mirror.bg", on ? 1 : 0);
  };

  // ── Camera facing flip (mobile-only button, hidden >900px) ───────────────
  document.getElementById("btn-camera-flip")?.addEventListener("click", async () => {
    const facing = await camera3d.switchFacing();
    // Front camera mirrors by default (selfie convention) — drives the
    // regular slot mirror param, so it stays user-overridable in Layers
    setCameraMirror(facing === "user");
    console.info(`[Camera] Facing: ${facing}`);
  });

  // ── Second screen output ──────────────────────────────────────────────────
  let _outWin = null;
  let _outWinReady = false;
  let _outFrameTick = 0;
  (() => {
    const btn = document.getElementById("btn-second-screen");
    if (!btn) return;

    btn.addEventListener("click", () => {
      // Close if already open
      if (_outWin && !_outWin.closed) {
        _outWin.close();
        _outWin = null;
        _outWinReady = false;
        btn.classList.remove("active");
        btn.title = "Send output to second monitor / new window";
        // Auto-exit ghost mode
        document.body.classList.remove("ghost-mode");
        document.getElementById("btn-ghost-mode")?.classList.remove("active");
        return;
      }

      // Open borderless output window
      const w = screen.width;
      const h = screen.height;
      _outWin = window.open(
        "",
        "ImWebOutput",
        `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no,scrollbars=no`,
      );
      if (!_outWin) {
        alert(
          "Popup blocked — allow popups for this page to use second screen output.",
        );
        return;
      }

      btn.classList.add("active");
      btn.title = "Close second screen output (click again)";

      _outWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>ImWeb Output</title>
<meta name="viewport" content="width=device-width,initial-scale=1.0,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#000;overflow:hidden;touch-action:manipulation}
  canvas{display:block;position:absolute;top:0;left:0;transform-origin:0 0}
  #ho{position:fixed;inset:0;pointer-events:none;display:none;transition:opacity 0.4s}
  .h{position:absolute;width:64px;height:64px;margin:-32px 0 0 -32px;border:3px solid #c8a020;border-radius:50%;background:rgba(0,0,0,0.45);cursor:crosshair;pointer-events:all;touch-action:none;box-shadow:0 0 12px rgba(0,0,0,0.9);transition:border-color .1s,background .1s}
  .h:active{border-color:#fff;background:rgba(255,255,255,0.15)}
  .h.sel{border-color:#fff;box-shadow:0 0 0 3px #c8a020,0 0 16px rgba(0,0,0,0.9)}
  #toolbar{position:fixed;bottom:12px;left:50%;transform:translateX(-50%);display:none;gap:10px;align-items:center;pointer-events:all;transition:opacity 0.4s}
  .tb-btn{background:rgba(0,0,0,0.6);border:1px solid rgba(255,255,255,0.25);color:rgba(255,255,255,0.7);font:13px/1 monospace;padding:8px 16px;border-radius:20px;cursor:pointer;touch-action:manipulation;white-space:nowrap;-webkit-tap-highlight-color:transparent}
  .tb-btn:active,.tb-btn.on{border-color:#c8a020;color:#c8a020}
</style>
</head>
<body>
<canvas id="out"></canvas>
<div id="ho">
  <div class="h" id="h-tl"></div>
  <div class="h" id="h-tr"></div>
  <div class="h" id="h-br"></div>
  <div class="h" id="h-bl"></div>
</div>
<div id="toolbar">
  <button class="tb-btn" id="tb-grid">⊞ Grid</button>
  <button class="tb-btn" id="tb-fs">⛶ Full</button>
</div>
<script>
  const c=document.getElementById('out'),ctx=c.getContext('2d');
  const ho=document.getElementById('ho');
  const toolbar=document.getElementById('toolbar');
  const tbGrid=document.getElementById('tb-grid');
  const tbFs=document.getElementById('tb-fs');
  const hs={tl:document.getElementById('h-tl'),tr:document.getElementById('h-tr'),br:document.getElementById('h-br'),bl:document.getElementById('h-bl')};
  let lastBitmap=null,lastCorners=null;
  let gridActive=false,selectedCorner=null;

  function drawGrid(){
    if(!gridActive||!lastCorners)return;
    const W=c.width,H=c.height,DIV=10;
    ctx.save();
    ctx.strokeStyle='rgba(255,255,255,0.55)';
    ctx.lineWidth=1;
    for(let i=0;i<=DIV;i++){
      const x=W*i/DIV,y=H*i/DIV;
      ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();
      ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();
    }
    // centre crosshair
    ctx.strokeStyle='rgba(255,200,0,0.8)';ctx.lineWidth=1.5;
    ctx.beginPath();ctx.moveTo(W*.5-20,H*.5);ctx.lineTo(W*.5+20,H*.5);ctx.stroke();
    ctx.beginPath();ctx.moveTo(W*.5,H*.5-20);ctx.lineTo(W*.5,H*.5+20);ctx.stroke();
    ctx.restore();
  }

  function setSelected(corner){
    selectedCorner=corner;
    for(const[k,h]of Object.entries(hs))h.classList.toggle('sel',k===corner);
  }

  function nudgeCorner(corner,dx,dy){
    if(!lastCorners||!lastCorners[corner])return;
    const x=Math.max(0,Math.min(1,lastCorners[corner].x+dx/window.innerWidth));
    const y=Math.max(0,Math.min(1,lastCorners[corner].y+dy/window.innerHeight));
    lastCorners[corner]={x,y};
    hs[corner].style.left=(x*window.innerWidth)+'px';
    hs[corner].style.top=(y*window.innerHeight)+'px';
    applyTransform();
    window.opener?.postMessage({type:'projmap',corner,x,y},'*');
  }

  function computeProjectiveMatrix(x0,y0,x1,y1,x2,y2,x3,y3){
    const dx1=x1-x2,dy1=y1-y2,dx2=x3-x2,dy2=y3-y2;
    const dx3=x0-x1+x2-x3,dy3=y0-y1+y2-y3;
    const det=dx1*dy2-dx2*dy1;
    if(Math.abs(det)<1e-10)return null;
    const h20=(dx3*dy2-dx2*dy3)/det,h21=(dx1*dy3-dx3*dy1)/det;
    const h00=x1-x0+h20*x1,h01=x3-x0+h21*x3,h02=x0;
    const h10=y1-y0+h20*y1,h11=y3-y0+h21*y3,h12=y0;
    return [h00,h10,0,h20,h01,h11,0,h21,0,0,1,0,h02,h12,0,1].join(',');
  }

  function positionHandles(){
    if(!lastCorners)return;
    const W=window.innerWidth,H=window.innerHeight;
    for(const[k,h]of Object.entries(hs)){
      h.style.left=(lastCorners[k].x*W)+'px';
      h.style.top=(lastCorners[k].y*H)+'px';
    }
  }

  function applyTransform(){
    if(!lastCorners){c.style.transform='none';return;}
    const W=window.innerWidth,H=window.innerHeight;
    const raw=computeProjectiveMatrix(
      lastCorners.tl.x*W,lastCorners.tl.y*H,
      lastCorners.tr.x*W,lastCorners.tr.y*H,
      lastCorners.br.x*W,lastCorners.br.y*H,
      lastCorners.bl.x*W,lastCorners.bl.y*H
    );
    if(!raw){c.style.transform='none';return;}
    // The formula maps from unit square; canvas is W×H, so normalise
    // columns 0 and 1 by 1/W and 1/H to get correct CSS matrix3d.
    const v=raw.split(',').map(Number);
    for(let i=0;i<4;i++)v[i]/=W;
    for(let i=4;i<8;i++)v[i]/=H;
    c.style.transform='matrix3d('+v.join(',')+')';
  }

  function resize(){
    c.width=window.innerWidth;c.height=window.innerHeight;
    applyTransform();positionHandles();draw();
  }

  function draw(){
    if(!lastBitmap)return;
    ctx.clearRect(0,0,c.width,c.height);
    if(lastCorners){
      ctx.drawImage(lastBitmap,0,0,c.width,c.height);
    } else {
      const sw=c.width,sh=c.height,iw=lastBitmap.width,ih=lastBitmap.height;
      const sc=Math.min(sw/iw,sh/ih),dw=iw*sc,dh=ih*sc;
      ctx.drawImage(lastBitmap,0,0,iw,ih,(sw-dw)/2,(sh-dh)/2,dw,dh);
    }
    drawGrid();
  }

  // Drag handles — send corner updates back to main window; click to select for nudge
  for(const[corner,h]of Object.entries(hs)){
    h.addEventListener('pointerdown',e=>{
      e.preventDefault();h.setPointerCapture(e.pointerId);
      setSelected(corner);
      let moved=false;
      const mv=e=>{
        moved=true;
        const x=Math.max(0,Math.min(1,e.clientX/window.innerWidth));
        const y=Math.max(0,Math.min(1,e.clientY/window.innerHeight));
        if(lastCorners)lastCorners[corner]={x,y};
        h.style.left=(x*window.innerWidth)+'px';
        h.style.top=(y*window.innerHeight)+'px';
        applyTransform();
        window.opener?.postMessage({type:'projmap',corner,x,y},'*');
      };
      h.addEventListener('pointermove',mv);
      h.addEventListener('pointerup',()=>h.removeEventListener('pointermove',mv),{once:true});
    });
  }

  // Toolbar buttons (touch-friendly grid + fullscreen)
  function toggleGrid(){
    gridActive=!gridActive;
    tbGrid.classList.toggle('on',gridActive);
    draw();
  }
  tbGrid.addEventListener('click',toggleGrid);
  tbFs.addEventListener('click',()=>{
    if(!document.fullscreenElement)document.body.requestFullscreen?.();
    else document.exitFullscreen?.();
  });

  // Auto-hide handles + toolbar after 3s idle; any pointer activity resets timer
  let _idleTimer=null;
  function _showUI(){
    ho.style.opacity='1';
    toolbar.style.opacity='1';
    clearTimeout(_idleTimer);
    _idleTimer=setTimeout(_hideUI,3000);
  }
  function _hideUI(){
    ho.style.opacity='0';
    toolbar.style.opacity='0';
  }
  window.addEventListener('pointermove',_showUI,{passive:true});
  window.addEventListener('pointerdown',_showUI,{passive:true});
  _hideUI(); // start hidden; message handler calls _showUI on first active frame

  // Arrow-key nudge for selected corner; G = toggle calibration grid (desktop)
  document.addEventListener('keydown',e=>{
    if(e.key==='g'||e.key==='G'){
      toggleGrid();return;
    }
    if(!selectedCorner||!lastCorners)return;
    const step=e.shiftKey?10:1;
    const map={ArrowLeft:[-step,0],ArrowRight:[step,0],ArrowUp:[0,-step],ArrowDown:[0,step]};
    const d=map[e.key];
    if(!d)return;
    e.preventDefault();
    nudgeCorner(selectedCorner,d[0],d[1]);
  });

  window.addEventListener('resize',resize);
  resize();

  window.addEventListener('message',e=>{
    if(!e.data?.bitmap)return;
    if(lastBitmap)lastBitmap.close();
    lastBitmap=e.data.bitmap;
    lastCorners=e.data.corners||null;
    const active=!!lastCorners;
    ho.style.display=active?'block':'none';
    toolbar.style.display=active?'flex':'none';
    applyTransform();positionHandles();draw();
    if(active)_showUI();
  });

  // Fullscreen on double-click (desktop fallback — toolbar ⛶ button used on touch)
  window.addEventListener('dblclick',()=>{
    if(!document.fullscreenElement)document.body.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
<\/script>
</body>
</html>`);
      _outWin.document.close();
      _outWinReady = true;
      _outFrameTick = 0;

      // Detect popup closed by user
      const _checkClosed = setInterval(() => {
        if (_outWin?.closed) {
          clearInterval(_checkClosed);
          _outWin = null;
          _outWinReady = false;
          btn.classList.remove("active");
          btn.title = "Send output to second monitor / new window";
          // Auto-exit ghost mode when second screen closes
          document.body.classList.remove("ghost-mode");
          document.getElementById("btn-ghost-mode")?.classList.remove("active");
        }
      }, 1000);

      // Auto-enter ghost mode when second screen opens
      document.body.classList.add("ghost-mode");
      document.getElementById("btn-ghost-mode")?.classList.add("active");
    });
  })();

  // ── Projection mapping homography (unit square → 4 destination points) ──────
  function computeProjectiveMatrix(x0, y0, x1, y1, x2, y2, x3, y3) {
    const dx1 = x1 - x2,
      dy1 = y1 - y2,
      dx2 = x3 - x2,
      dy2 = y3 - y2;
    const dx3 = x0 - x1 + x2 - x3,
      dy3 = y0 - y1 + y2 - y3;
    const det = dx1 * dy2 - dx2 * dy1;
    if (Math.abs(det) < 1e-10) return null;
    const h20 = (dx3 * dy2 - dx2 * dy3) / det,
      h21 = (dx1 * dy3 - dx3 * dy1) / det;
    const h00 = x1 - x0 + h20 * x1,
      h01 = x3 - x0 + h21 * x3,
      h02 = x0;
    const h10 = y1 - y0 + h20 * y1,
      h11 = y3 - y0 + h21 * y3,
      h12 = y0;
    return [
      h00,
      h10,
      0,
      h20,
      h01,
      h11,
      0,
      h21,
      0,
      0,
      1,
      0,
      h02,
      h12,
      0,
      1,
    ].join(",");
  }

  // ── Ghost mode toggle ─────────────────────────────────────────────────────
  document.getElementById("btn-ghost-mode")?.addEventListener("click", () => {
    document.body.classList.toggle("ghost-mode");
    document
      .getElementById("btn-ghost-mode")
      .classList.toggle(
        "active",
        document.body.classList.contains("ghost-mode"),
      );
  });

  // ── Projection Mapping ────────────────────────────────────────────────────
  // Corner handles live on the second screen. It sends updates back here.
  window.addEventListener("message", (e) => {
    if (e.data?.type === "projmap" && e.data.corner) {
      ps.set(`projmap.${e.data.corner}_x`, e.data.x);
      ps.set(`projmap.${e.data.corner}_y`, e.data.y);
    }
  });
  ps.get("projmap.active").onChange((v) => {
    document.getElementById("btn-projmap")?.classList.toggle("active", !!v);
    if (v && _outWin && !_outWin.closed) _outWin.focus();
  });
  document.getElementById("btn-projmap")?.addEventListener("click", () => {
    ps.set("projmap.active", ps.get("projmap.active").value ? 0 : 1);
  });
  document
    .getElementById("btn-projmap-reset")
    ?.addEventListener("click", () => {
      ps.set("projmap.tl_x", 0);
      ps.set("projmap.tl_y", 0);
      ps.set("projmap.tr_x", 1);
      ps.set("projmap.tr_y", 0);
      ps.set("projmap.br_x", 1);
      ps.set("projmap.br_y", 1);
      ps.set("projmap.bl_x", 0);
      ps.set("projmap.bl_y", 1);
    });

  // ── Video Out Spy ─────────────────────────────────────────────────────────
  const _spyCanvas = document.getElementById("spy-canvas");
  const _spyCtx = _spyCanvas?.getContext("2d") ?? null;

  // Toggle spy panel visibility
  const _toggleSpy = () =>
    document.getElementById("video-spy")?.classList.toggle("hidden");
  document.getElementById("btn-spy")?.addEventListener("click", _toggleSpy);

  // First-visit onboarding overlay
  const _onboarding = document.getElementById("onboarding");
  const _obVersion = document.getElementById("onboarding-version");
  if (_obVersion) _obVersion.textContent = `v${__APP_VERSION__}`;
  if (!localStorage.getItem("imweb-onboarding-dismissed")) {
    _onboarding?.classList.remove("hidden");
  }
  document
    .getElementById("onboarding-dismiss")
    ?.addEventListener("click", () => {
      _onboarding?.classList.add("hidden");
      localStorage.setItem("imweb-onboarding-dismissed", "1");
    });

  // Keyboard lock toggle
  const _keylockBtn = document.getElementById("btn-keylock");
  ps.get("global.keylock").onChange((v) => {
    _keylockBtn?.classList.toggle("active", !!v);
  });
  _keylockBtn?.addEventListener("click", () =>
    ps.set("global.keylock", ps.get("global.keylock").value ? 0 : 1),
  );

  // Keyboard shortcut: Shift+Esc = reset all params
  window.addEventListener("keydown", (e) => {
    if (
      e.shiftKey &&
      e.key === "Escape" &&
      !e.target.closest("input,textarea")
    ) {
      e.preventDefault();
      _resetAllParams();
    }
  });

  // Keyboard shortcut: Shift+V = toggle spy
  window.addEventListener("keydown", (e) => {
    if (e.shiftKey && e.key === "V" && !e.target.closest("input,textarea")) {
      e.preventDefault();
      document.getElementById("video-spy")?.classList.toggle("hidden");
    }
  });

  /** Capture a 160×90 JPEG thumbnail of the current output canvas. */
  function capturePresetThumb() {
    const t = document.createElement("canvas");
    t.width = 160;
    t.height = 90;
    t.getContext("2d").drawImage(canvas, 0, 0, 160, 90);
    return t.toDataURL("image/jpeg", 0.7);
  }

  // Inject thumbnail capture into MemoryPanel (manual thumb click) and StateBar (auto on save)
  memoryPanel._captureThumbFn = capturePresetThumb;
  stateBar._captureThumbFn     = capturePresetThumb;

  // ── OSC bridge ────────────────────────────────────────────────────────────
  const oscBridge   = new OSCBridge(ps, presetMgr);
  const montyBridge = new MontyBridge(ps, stillsBuffer);
  ctrl.setMontySignal(montyBridge._signal);
  const projectFile = new ProjectFile(ps, presetMgr, tableManager, {
    warpEditor,
    drawLayer,
    strokeLooper,
    stillsBuffer,
    scene3d: scene3d,
    seqBuffers: [seq1, seq2, seq3],
  });
  // Dev-only console access for headless verification (verdict-cli)
  if (import.meta.env.DEV) window.__projectFile = projectFile;

  // ── First-ever launch: load MasterProject from server ─────────────────────
  if (presetMgr._firstLaunch) {
    const _mpStatus = document.createElement('div');
    _mpStatus.style.cssText = 'font-size:11px;color:var(--text-2);margin-top:8px;transition:opacity .4s;';
    _mpStatus.textContent = 'Loading MasterProject…';
    document.getElementById('onboarding-box')?.appendChild(_mpStatus);

    const _loadMasterProject = async (attempt = 1) => {
      try {
        // Factory load onto a blank slate, so it replaces rather than merges:
        // init() has already created and SAVED an empty Preset(0), which a merge
        // would collide with — pushing MasterProject's own bank 0 to slot 1 and
        // leaving the blank bank sitting at 0. _firstLaunch means the store held
        // nothing, so the only bank this can destroy is that empty one.
        await projectFile.importFromURL('/Projects/MasterProject.imweb', { replace: true });
        console.info('[ImWeb] First launch — MasterProject.imweb loaded' + (attempt > 1 ? ` (attempt ${attempt})` : ''));
        _mpStatus.style.color = '';
        _mpStatus.textContent = 'MasterProject loaded';
        setTimeout(() => { _mpStatus.style.opacity = '0'; }, 1000);
      } catch (err) {
        if (attempt < 2) {
          console.warn(`[ImWeb] MasterProject load attempt ${attempt} failed, retrying…`, err);
          await new Promise(r => setTimeout(r, 800));
          return _loadMasterProject(attempt + 1);
        }
        console.error('[ImWeb] MasterProject load failed after retries — starting blank:', err);
        _mpStatus.style.opacity = '1';
        _mpStatus.style.color = 'var(--accent)';
        _mpStatus.textContent = '';
        const _mpMsg = document.createElement('span');
        _mpMsg.textContent = 'Could not load default project. ';
        const _mpRetry = document.createElement('a');
        _mpRetry.href = '#';
        _mpRetry.textContent = 'Retry';
        _mpRetry.style.cssText = 'color:var(--accent);text-decoration:underline;cursor:pointer;';
        _mpRetry.addEventListener('click', (e) => {
          e.preventDefault();
          _mpStatus.textContent = 'Loading MasterProject…';
          _mpStatus.style.color = 'var(--text-2)';
          _loadMasterProject(1);
        });
        _mpStatus.appendChild(_mpMsg);
        _mpStatus.appendChild(_mpRetry);
      }
    };
    await _loadMasterProject();
  }

  // Click OSC indicator → prompt for WebSocket URL and connect
  document.getElementById("status-osc")?.addEventListener("click", () => {
    if (oscBridge.active) {
      oscBridge.disconnect();
    } else {
      const url = prompt("OSC relay WebSocket URL:", "ws://localhost:8080");
      if (url) oscBridge.connect(url);
    }
  });

  // MontyBridge status row — injected into #buffer-params in Buffer tab
  (() => {
    const container = document.getElementById('buffer-params');
    if (!container) return;

    const savedUrl = localStorage.getItem('imweb-monty-url') || 'ws://localhost:8765';
    container.innerHTML = `
      <div class="param-row" style="padding:4px 10px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);">
        <span style="font-size:10px;color:var(--text-2);letter-spacing:.05em;flex-shrink:0;">MONTY</span>
        <span class="monty-dot" style="font-size:14px;line-height:1;color:#404050;">●</span>
        <span class="monty-source" style="font-size:9px;color:var(--text-2);flex:1;">—</span>
        <button id="btn-monty-connect" style="
          background:var(--bg-3);border:1px solid var(--border);border-radius:3px;
          color:var(--text-1);font-size:9px;padding:2px 7px;cursor:pointer;">Connect</button>
      </div>`;

    montyBridge.setStatusEl(container.querySelector('.param-row'));

    document.getElementById('btn-monty-connect')?.addEventListener('click', () => {
      if (montyBridge.active) {
        montyBridge.disconnect();
        document.getElementById('btn-monty-connect').textContent = 'Connect';
      } else {
        const url = prompt('Monty WebSocket URL:', savedUrl);
        if (!url) return;
        localStorage.setItem('imweb-monty-url', url);
        montyBridge.connect(url);
        document.getElementById('btn-monty-connect').textContent = 'Disconnect';
      }
    });
  })();

  // MontyBridge: send capture frame on buffer.capture trigger
  ps.get('buffer.capture').onChange(() => {
    if (!montyBridge.active) return;
    montyBridge.sendCaptureFrame(renderer, pipeline.output);
  });

  // Project file UI — #project-file-ui container in Presets tab
  (() => {
    const container = document.getElementById("project-file-ui");
    if (container) {
      container.innerHTML = `
        <div style="padding:8px 10px;display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;gap:5px;">
            <input id="project-name-input" type="text" placeholder="Type your new Project name here"
              style="flex:1;background:var(--bg-3);border:1px solid var(--border);border-radius:3px;
                     color:var(--text-0);font-family:var(--mono);font-size:11px;padding:4px 7px;outline:none;" />
          </div>
          <div style="display:flex;gap:5px;">
            <button id="btn-export-project" class="import-btn" style="flex:1" title="Cmd+S / Cmd+E">⇩ Export .imweb</button>
            <button id="btn-import-project" class="import-btn" style="flex:1" title="Cmd+O">⇧ Import .imweb</button>
          </div>
          <button id="btn-restore-master" class="import-btn"
            style="width:100%;border-color:var(--accent);color:var(--accent);"
            title="Reset everything to the factory MasterProject defaults">⟳ Restore MasterProject</button>
          <button id="btn-save-master" class="import-btn"
            style="width:100%;border-color:var(--text-2);color:var(--text-2);font-size:9px;opacity:0.6;"
            title="[DEV] Download current project as MasterProject.imweb — place in public/Projects/ to update factory defaults">
            📤 Save as MasterProject  [DEV]</button>
          <div id="project-file-status" style="font-family:var(--mono);font-size:10px;color:var(--text-2);min-height:14px;"></div>
          <input id="project-file-input" type="file" accept=".imweb,application/json" style="display:none;" />
        </div>
      `;

      const statusEl = () => document.getElementById("project-file-status");
      const setStatus = (msg, color = "var(--text-2)") => {
        const el = statusEl();
        if (el) {
          el.textContent = msg;
          el.style.color = color;
        }
      };

      document
        .getElementById("btn-export-project")
        ?.addEventListener("click", async () => {
          try {
            const name =
              document.getElementById("project-name-input")?.value.trim() ||
              document.getElementById("status-bank")?.textContent ||
              "imweb-session";
            await projectFile.export(name);
            setStatus(`✓ Exported "${name}"`, "var(--green)");
          } catch (err) {
            setStatus(`✗ ${err.message}`, "var(--red)");
          }
        });

      // Enter key in the name field triggers export
      document.getElementById("project-name-input")
        ?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            document.getElementById("btn-export-project")?.click();
          }
        });

      document
        .getElementById("btn-import-project")
        ?.addEventListener("click", () => {
          document.getElementById("project-file-input")?.click();
        });

      document
        .getElementById("project-file-input")
        ?.addEventListener("change", async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          e.target.value = "";
          try {
            const name = await projectFile.import(file);
            const inp = document.getElementById("project-name-input");
            if (inp) inp.value = name;
            setStatus(`✓ Loaded "${name}"`, "var(--green)");

            // Refresh UI
            memoryPanel?._refresh?.();
            refreshBufferGrid();
            // Update WarpMap UI if active
            if (document.getElementById("warp-slots-list")) {
              const slots = warpEditor.getSavedSlots();
              document.getElementById("warp-slots-list").innerHTML = slots
                .map((s) => `<button class="warp-slot-btn">${s}</button>`)
                .join("");
            }
          } catch (err) {
            setStatus(`✗ ${err.message}`, "var(--red)");
          }
        });

      // ── Restore MasterProject ─────────────────────────────────────────────
      // Build a modal dialog once and reuse it
      const modal = document.createElement("div");
      modal.id = "restore-master-modal";
      modal.style.cssText = [
        "display:none;position:fixed;inset:0;z-index:9999;",
        "background:rgba(0,0,0,0.82);align-items:center;justify-content:center;",
      ].join("");
      modal.innerHTML = `
        <div style="background:var(--bg-2);border:1px solid var(--accent);border-radius:6px;
                    padding:24px 28px;max-width:380px;width:90%;font-family:var(--mono);">
          <div style="color:var(--accent);font-size:13px;font-weight:bold;margin-bottom:12px;">
            ⚠ Restore MasterProject?
          </div>
          <div style="color:var(--text-1);font-size:11px;line-height:1.65;margin-bottom:22px;">
            All current banks, states, and tables will be permanently replaced
            with the factory MasterProject defaults.<br><br>
            <strong style="color:var(--accent);">This cannot be undone.</strong>
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button id="btn-restore-cancel"  class="import-btn" style="padding:5px 16px;">Cancel</button>
            <button id="btn-restore-confirm" class="import-btn"
              style="padding:5px 16px;border-color:var(--accent);color:var(--accent);">
              Yes, Restore
            </button>
          </div>
        </div>
      `;
      document.body.appendChild(modal);

      const showModal  = () => { modal.style.display = "flex"; };
      const hideModal  = () => { modal.style.display = "none"; };

      document.getElementById("btn-restore-master")?.addEventListener("click", showModal);
      document.getElementById("btn-restore-cancel")?.addEventListener("click",  hideModal);
      modal.addEventListener("click", (e) => { if (e.target === modal) hideModal(); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape") hideModal(); });

      document.getElementById("btn-restore-confirm")?.addEventListener("click", async () => {
        hideModal();
        setStatus("⟳ Restoring MasterProject…", "var(--text-2)");
        try {
          // The one destructive import: this is a factory reset, and the
          // confirmation modal above is the gate for it.
          await projectFile.importFromURL("/Projects/MasterProject.imweb", { replace: true });
          memoryPanel?._refresh?.();
          refreshBufferGrid();
          setStatus("✓ MasterProject restored", "var(--green)");
        } catch (err) {
          setStatus(`✗ Restore failed: ${err.message}`, "var(--red)");
        }
      });

      // ── [DEV] Save as MasterProject ───────────────────────────────────────
      document.getElementById("btn-save-master")?.addEventListener("click", async () => {
        try {
          await projectFile.exportAsMasterProject();
          setStatus("📤 MasterProject.imweb downloaded — place in public/Projects/", "var(--accent)");
        } catch (err) {
          setStatus(`✗ ${err.message}`, "var(--red)");
        }
      });

      // 💾 status-bar save button (beside Bank selector)
      document.getElementById("btn-save-project")?.addEventListener("click", () => {
        document.getElementById("btn-export-project")?.click();
      });

      window.addEventListener("keydown", (e) => {
        if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")
          return;
        if ((e.metaKey || e.ctrlKey) && e.key === "s") {
          e.preventDefault();
          document.getElementById("btn-export-project")?.click();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "e" && !e.shiftKey) {
          e.preventDefault();
          document.getElementById("btn-export-project")?.click();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === "o") {
          e.preventDefault();
          document.getElementById("btn-import-project")?.click();
        }
      });
    }
  })();

  (() => {
    // Automation row
    const autoRow2 = document.createElement("div");
    autoRow2.style.cssText =
      "display:flex;gap:4px;padding:4px 10px 8px;flex-wrap:wrap;align-items:center;";

    const autoLabel = document.createElement("span");
    autoLabel.textContent = "Automation:";
    autoLabel.style.cssText = "font-size:11px;color:var(--text-2);";
    autoRow2.appendChild(autoLabel);

    const btnAutoRec = document.createElement("button");
    btnAutoRec.className = "import-btn";
    btnAutoRec.textContent = "⏺ Rec";
    btnAutoRec.title = "Record parameter movements";
    btnAutoRec.addEventListener("click", () => {
      if (automation.recording) {
        automation.stopRecord();
        btnAutoRec.classList.remove("active");
        btnAutoRec.textContent = "⏺ Rec";
        btnAutoPlay.disabled = false;
        btnAutoInfo.textContent = `${automation.duration.toFixed(1)}s / ${automation.eventCount} events`;
      } else {
        automation.startRecord();
        btnAutoRec.classList.add("active");
        btnAutoRec.textContent = "⏹ Stop";
        btnAutoPlay.disabled = true;
        btnAutoInfo.textContent = "Recording…";
      }
    });

    const btnAutoPlay = document.createElement("button");
    btnAutoPlay.className = "import-btn";
    btnAutoPlay.textContent = "▶ Play";
    btnAutoPlay.title = "Loop recorded automation";
    btnAutoPlay.addEventListener("click", () => {
      if (automation.playing) {
        automation.stop();
        btnAutoPlay.classList.remove("active");
        btnAutoPlay.textContent = "▶ Play";
      } else {
        automation.play();
        btnAutoPlay.classList.add("active");
        btnAutoPlay.textContent = "⏹ Stop";
      }
    });

    const btnAutoClear = document.createElement("button");
    btnAutoClear.className = "import-btn";
    btnAutoClear.textContent = "✕ Clear";
    btnAutoClear.addEventListener("click", () => {
      automation.clear();
      btnAutoPlay.classList.remove("active");
      btnAutoPlay.textContent = "▶ Play";
      btnAutoInfo.textContent = "No clip";
    });

    const btnAutoInfo = document.createElement("span");
    btnAutoInfo.textContent = "No clip";
    btnAutoInfo.style.cssText =
      "font-size:10px;color:var(--text-2);margin-left:4px;";

    autoRow2.appendChild(btnAutoRec);
    autoRow2.appendChild(btnAutoPlay);
    autoRow2.appendChild(btnAutoClear);
    autoRow2.appendChild(btnAutoInfo);
    document.getElementById('memory-auto-row')?.appendChild(autoRow2);

    // ── State Step Sequencer ─────────────────────────────────────────────────
    const stateSeqSection = document.getElementById('state-seq-section');

    const seqControlRow = document.createElement("div");
    seqControlRow.style.cssText =
      "display:flex;gap:4px;padding:4px 10px;align-items:center;flex-wrap:wrap;";

    const btnSeqPlay = document.createElement("button");
    btnSeqPlay.className = "import-btn";
    btnSeqPlay.textContent = "▶ Seq";
    btnSeqPlay.title = "Toggle step sequencer";
    btnSeqPlay.addEventListener("click", () => {
      stepSequencer.active = !stepSequencer.active;
      if (stepSequencer.active) stepSequencer.reset();
      btnSeqPlay.classList.toggle("active", stepSequencer.active);
      btnSeqPlay.textContent = stepSequencer.active ? "⏹ Seq" : "▶ Seq";
      refreshSeqGrid();
    });

    const seqRateSel = document.createElement("select");
    seqRateSel.className = "param-select";
    seqRateSel.style.cssText = "font-size:10px;";
    [
      ["1 beat", 1],
      ["2 beats", 2],
      ["4 beats", 4],
      ["8 beats", 8],
      ["16 beats", 16],
    ].forEach(([label, v]) => {
      const opt = document.createElement("option");
      opt.value = v;
      opt.textContent = label;
      if (v === 4) opt.selected = true;
      seqRateSel.appendChild(opt);
    });
    seqRateSel.addEventListener("change", () => {
      stepSequencer.rate = parseFloat(seqRateSel.value);
    });

    const seqStepsSel = document.createElement("select");
    seqStepsSel.className = "param-select";
    seqStepsSel.style.cssText = "font-size:10px;";
    [4, 8, 16].forEach((n) => {
      const opt = document.createElement("option");
      opt.value = n;
      opt.textContent = `${n} steps`;
      if (n === 8) opt.selected = true;
      seqStepsSel.appendChild(opt);
    });
    seqStepsSel.addEventListener("change", () => {
      stepSequencer.setStepCount(parseInt(seqStepsSel.value));
      buildSeqGrid();
    });

    seqControlRow.appendChild(btnSeqPlay);
    seqControlRow.appendChild(seqRateSel);
    seqControlRow.appendChild(seqStepsSel);
    stateSeqSection.appendChild(seqControlRow);

    // Step grid
    const seqGrid = document.createElement("div");
    seqGrid.style.cssText =
      "display:flex;flex-wrap:wrap;gap:3px;padding:4px 10px 8px;";
    stateSeqSection.appendChild(seqGrid);

    function buildSeqGrid() {
      seqGrid.innerHTML = "";
      stepSequencer.steps.forEach((presetIdx, i) => {
        const cell = document.createElement("div");
        cell.dataset.stepIdx = i;
        cell.style.cssText = `width:28px;height:28px;background:var(--bg-4);border:1px solid var(--border);
          border-radius:3px;display:flex;align-items:center;justify-content:center;
          font-size:10px;font-family:var(--mono);cursor:pointer;user-select:none;`;
        cell.textContent = presetIdx >= 0 ? presetIdx : "—";
        cell.title = `Step ${i}: ${presetIdx >= 0 ? "Preset " + presetIdx : "skip"}\nClick to set, right-click to clear`;
        cell.addEventListener("click", () => {
          const v = prompt(
            `Step ${i} — enter preset number (or empty to skip):`,
            presetIdx >= 0 ? presetIdx : "",
          );
          if (v === null) return;
          const n = v.trim() === "" ? -1 : parseInt(v);
          stepSequencer.setStep(i, isNaN(n) ? -1 : n);
          refreshSeqGrid();
        });
        cell.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          stepSequencer.setStep(i, -1);
          refreshSeqGrid();
        });
        seqGrid.appendChild(cell);
      });
    }

    function refreshSeqGrid() {
      seqGrid.querySelectorAll("[data-step-idx]").forEach((cell) => {
        const i = parseInt(cell.dataset.stepIdx);
        const presetIdx = stepSequencer.steps[i];
        const isActive = stepSequencer.active && i === stepSequencer.step;
        cell.textContent = presetIdx >= 0 ? presetIdx : "—";
        cell.style.background = isActive
          ? "var(--accent)"
          : presetIdx >= 0
            ? "var(--bg-3)"
            : "var(--bg-4)";
        cell.style.color = isActive
          ? "#000"
          : presetIdx >= 0
            ? "var(--text-1)"
            : "var(--text-2)";
      });
    }

    buildSeqGrid();

    stepSequencer.onStep = () => refreshSeqGrid();
  })();

  // ── I / O section ────────────────────────────────────────────────────────

  // Row builder: label + flex native controls
  function _ioRow(labelText, ...controls) {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;align-items:center;gap:5px;padding:3px 10px;";
    const lbl = document.createElement("span");
    lbl.style.cssText = "font:10px/1.6 var(--mono);color:var(--text-2);min-width:60px;flex-shrink:0;letter-spacing:.05em;text-transform:uppercase;";
    lbl.textContent = labelText;
    row.appendChild(lbl);
    controls.forEach(c => c && row.appendChild(c));
    return row;
  }

  // Native <select> factory — color-scheme:dark keeps the OS picker dark on Chrome/Brave
  function _ioSel(flexGrow = true) {
    const s = document.createElement("select");
    s.className = "param-select";
    if (flexGrow) s.style.cssText = "flex:1;min-width:0;";
    return s;
  }

  const ioBlock = document.createElement("div");
  ioBlock.className = "panel-section";

  // Phase 24 §2c splits I/O along the signal flow: inputs belong to
  // Sources > Live In, outputs to the Output tab. Built here beside ioBlock
  // so both share the _ioRow/_ioSel helpers.
  const ioOutBlock = document.createElement("div");
  ioOutBlock.className = "panel-section";
  const ioOutHdr = document.createElement("div");
  ioOutHdr.className = "section-header";
  ioOutHdr.textContent = "Display & Record";
  ioOutHdr.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") return;
    ioOutBlock.classList.toggle("collapsed");
    ioOutHdr.classList.toggle("collapsed");
  });
  ioOutBlock.appendChild(ioOutHdr);

  const ioHdr = document.createElement("div");
  ioHdr.className = "section-header";
  ioHdr.textContent = "I / O";
  ioBlock.appendChild(ioHdr);

  ioHdr.addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") return;
    ioBlock.classList.toggle("collapsed");
    ioHdr.classList.toggle("collapsed");
  });

  const ioBtns = document.createElement("div");
  ioBtns.className = "section-header-btns";

  const ioDetach = document.createElement("button");
  ioDetach.textContent = "⊞";
  ioDetach.title = "Detach panel";
  ioDetach.addEventListener("click", (e) => {
    e.stopPropagation();
    _detachSection(ioBlock);
  });

  ioBtns.appendChild(ioDetach);
  ioHdr.appendChild(ioBtns);

  // ── Camera ──
  const btnCameraOn = document.createElement("button");
  btnCameraOn.id = "btn-camera-on";
  btnCameraOn.className = "import-btn";
  btnCameraOn.style.cssText = "flex-shrink:0;";
  btnCameraOn.textContent = "▶ Camera";

  const camDeviceSel = _ioSel();
  camDeviceSel.innerHTML = '<option value="">default</option>';
  // Camera (source 0) sits under LIVE IN in its own panel, parallel to Sound,
  // rather than inside the generic I/O block. Falls back to ioBlock so the
  // control can never be silently dropped.
  (document.getElementById("camera-params") ?? ioBlock)
    .appendChild(_ioRow("Camera", btnCameraOn, camDeviceSel));

  // ── Audio In ──
  const btnAudioIn = document.createElement("button");
  btnAudioIn.className = "import-btn";
  btnAudioIn.style.cssText = "flex-shrink:0;";
  btnAudioIn.textContent = "▶ Audio";
  btnAudioIn.title = "Enable audio input / vectorscope";

  const audioDeviceSel = _ioSel();
  audioDeviceSel.innerHTML = '<option value="">—</option>';
  // Sound (source 12) has no parameters — soundTexture is a 1x1 DataTexture
  // driven straight from the analyser — so the Audio In device row is the
  // panel's real content. Falls back into the I/O block if the container is
  // missing, so this can never silently drop the control.
  (document.getElementById("sound-params") ?? ioBlock)
    .appendChild(_ioRow("Audio In", btnAudioIn, audioDeviceSel));

  // Enumerate all media devices on startup — shows labels immediately if permission
  // already granted from a previous session; falls back to generic names otherwise.
  // Optional-chained: navigator.mediaDevices is undefined in insecure contexts
  // (iOS Safari over http:// LAN) — the whole chain must short-circuit, since
  // the property access itself throws before any .catch() can help.
  // Refreshable camera list: iOS reveals the full device set (front/back,
  // real labels) only AFTER camera permission is granted, so this runs at
  // boot AND again whenever the camera turns on.
  const refreshCameraDevices = (cams) => {
    if (!cams.length) return;
    const prevSel = camDeviceSel.value;
    camDeviceSel.innerHTML = "";
    cams.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      camDeviceSel.appendChild(o);
    });
    if (prevSel) camDeviceSel.value = prevSel;

    // Mirror the list into the camera.device param (rendered next to
    // Mirror Cam in the Layers section). SELECT rows bake their options at
    // build time, so rebuild the row.
    const devParam = ps.get("camera.device");
    if (devParam) {
      devParam.options = ["Default", ...cams.map((d, i) => d.label || `Camera ${i + 1}`)];
      devParam._deviceIds = ["", ...cams.map(d => d.deviceId)];
      const oldRow = document.querySelector('#mirror-params [data-param-id="camera.device"]');
      if (oldRow) {
        oldRow._psUnsub?.();
        oldRow.replaceWith(buildParamRow(devParam, contextMenu));
      }
    }
  };
  ps.get("camera.active")?.onChange((v) => {
    // Re-enumerate shortly after the camera starts — permission is granted
    // by then, so labels and the full front/back list become visible
    if (!v || !camera3d.active) return;
    setTimeout(() => {
      navigator.mediaDevices?.enumerateDevices?.().then(devices => {
        refreshCameraDevices(devices.filter(d => d.kind === "videoinput"));
      }).catch(() => {});
    }, 400);
  });

  navigator.mediaDevices?.enumerateDevices?.().then(devices => {
    const cams = devices.filter(d => d.kind === "videoinput");
    const mics = devices.filter(d => d.kind === "audioinput");
    refreshCameraDevices(cams);
    if (mics.length) {
      audioDeviceSel.innerHTML = "";
      mics.forEach((d, i) => {
        const o = document.createElement("option");
        o.value = d.deviceId;
        o.textContent = d.label || `Mic ${i + 1}`;
        audioDeviceSel.appendChild(o);
      });
    }
  }).catch(() => {});

  // Auto-connect vectorscope when ControllerManager sound is already active
  ctrl.onSoundReady = (sourceNode, audioCtx) => {
    vectorscope.connectSource(sourceNode, audioCtx);
    btnAudioIn.textContent = "■ Audio";
    btnAudioIn.classList.add("active");
  };

  btnAudioIn.addEventListener("click", async () => {
    if (btnAudioIn.classList.contains("active")) {
      if (ctrl.sound) {
        vectorscope.connectSource(
          ctrl.sound.ctx.createMediaStreamSource
            ? (vectorscope._source ?? ctrl.sound.analyser)
            : ctrl.sound.analyser,
          ctrl.sound.ctx,
        );
      } else {
        vectorscope.stop();
      }
      btnAudioIn.textContent = "▶ Audio";
      btnAudioIn.classList.remove("active");
      return;
    }
    const deviceId = audioDeviceSel.options[audioDeviceSel.selectedIndex]?.value || undefined;
    const ok = await vectorscope.initMic(deviceId);
    if (ok) {
      // Re-enumerate with full labels now that permission is granted
      // (optional-chained — mediaDevices is undefined in insecure contexts)
      navigator.mediaDevices?.enumerateDevices?.().then(devices => {
        const mics = devices.filter(d => d.kind === "audioinput");
        if (!mics.length) return;
        const prev = audioDeviceSel.value;
        audioDeviceSel.innerHTML = "";
        mics.forEach((d, i) => {
          const o = document.createElement("option");
          o.value = d.deviceId;
          o.textContent = d.label || `Mic ${i + 1}`;
          audioDeviceSel.appendChild(o);
        });
        if (prev) audioDeviceSel.value = prev;
      }).catch(() => {});
      btnAudioIn.textContent = "■ Audio";
      btnAudioIn.classList.add("active");
    }
  });

  // Device switch while audio is active
  audioDeviceSel.addEventListener("change", async () => {
    if (!btnAudioIn.classList.contains("active")) return;
    const deviceId = audioDeviceSel.value || undefined;
    await vectorscope.initMic(deviceId); // stop() + restart in new initMic
  });

  // ── Display resolution ──
  const dispSel = _ioSel();
  [["Disp",0],["720p",1],["1080p",2],["540p",3],["¼",4]].forEach(([label, val]) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = label;
    dispSel.appendChild(o);
  });
  dispSel.value = ps.get("output.resolution").value;
  dispSel.addEventListener("change", () => ps.set("output.resolution", +dispSel.value));
  ps.get("output.resolution").onChange(v => { dispSel.value = v; recSel.value = v; });
  ioOutBlock.appendChild(_ioRow("Display", dispSel));

  // ── Record resolution (linked to Display until independent REC target is built) ──
  const recSel = _ioSel();
  [["Disp",0],["720p",1],["1080p",2],["540p",3],["¼",4]].forEach(([label, val]) => {
    const o = document.createElement("option");
    o.value = val; o.textContent = label;
    recSel.appendChild(o);
  });
  recSel.value = ps.get("output.resolution").value;
  recSel.addEventListener("change", () => ps.set("output.resolution", +recSel.value));
  ioOutBlock.appendChild(_ioRow("Record", recSel));

  // ── 2Display resolution — controls second screen bitmap resize pre-postMessage ──
  const _outWinResOpts = [
    { label: "Same",  dims: null },
    { label: "1080p", dims: [1920, 1080] },
    { label: "720p",  dims: [1280, 720] },
    { label: "540p",  dims: [960, 540] },
  ];
  let _outWinResIdx = 1; // default 1080p — fast for projection, lower transfer cost
  const outWinSel = _ioSel();
  _outWinResOpts.forEach((opt, i) => {
    const o = document.createElement("option");
    o.value = i; o.textContent = opt.label;
    outWinSel.appendChild(o);
  });
  outWinSel.value = _outWinResIdx;
  outWinSel.addEventListener("change", () => { _outWinResIdx = +outWinSel.value; });
  ioOutBlock.appendChild(_ioRow("2Display", outWinSel));

  // Phase 23 Step 3: the Mapping tab is retired. I/O leads the SOURCES tab —
  // it is mostly input-device selection (Camera, Audio In) and stays the first
  // thing visible on the first tab, as it was at the top of Mapping.
  // Injected at runtime, so it moves in JS rather than by relocating markup.
  // Phase 24: inputs lead the LIVE IN group; outputs lead the Output tab.
  // Both are injected at runtime, so they move in JS rather than markup.
  // Falls back to the old prepend target if the group is absent.
  (document.getElementById("group-live-in") ??
    document.getElementById("tab-sources"))?.appendChild(ioBlock);
  document.getElementById("tab-output")?.prepend(ioOutBlock);

  async function populateCameraDevices() {
    // Re-enumerate after permission grant so labels are fully resolved
    await camera3d.init();
    const list = camera3d.getDeviceList();
    if (!list.length) return;
    const prev = camDeviceSel.value;
    camDeviceSel.innerHTML = "";
    list.forEach((d, i) => {
      const o = document.createElement("option");
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      camDeviceSel.appendChild(o);
    });
    if (prev) camDeviceSel.value = prev; // restore selection if possible
  }

  // camera.device param is the single restart path; the I/O <select> just
  // drives it (and is kept in sync by it), so Layers-row picks, I/O picks,
  // presets, and MIDI all behave identically
  ps.get("camera.device")?.onChange(async (v) => {
    const devParam = ps.get("camera.device");
    const idx = Math.round(v);
    const devId = devParam._deviceIds?.[idx] ?? "";
    if (camDeviceSel.value !== devId) camDeviceSel.value = devId;

    // Facing heuristic from the device label: front-ish names get the
    // selfie mirror, back-ish names clear it, ambiguous names (incl.
    // "Default") leave the user's Mirror Cam setting alone
    const label = devParam.options?.[idx] ?? "";
    if (/front|user|facetime|selfie/i.test(label)) setCameraMirror(true);
    else if (/back|rear|environment/i.test(label)) setCameraMirror(false);

    if (!camera3d.active) return;
    camera3d.stop();
    const ok = await camera3d.start(devId || null);
    if (!ok) {
      btnCameraOn.textContent = "▶ Camera";
      ps.set("camera.active", 0);
    }
  });
  camDeviceSel.addEventListener("change", () => {
    const devParam = ps.get("camera.device");
    const idx = devParam?._deviceIds?.indexOf(camDeviceSel.value) ?? -1;
    if (idx >= 0) ps.set("camera.device", idx);
  });

  btnCameraOn.addEventListener("click", async () => {
    if (!camera3d.active) {
      const ok = await camera3d.start(camDeviceSel.value || null);
      if (ok) {
        btnCameraOn.textContent = "■ Camera";
        ps.set("camera.active", 1);
        ps.set("layer.fg", 0);
        await populateCameraDevices();
        // Select the active device in the dropdown
        const activeId = camera3d._stream
          ?.getVideoTracks()[0]
          ?.getSettings()?.deviceId;
        if (activeId) camDeviceSel.value = activeId;
      } else {
        const errName = camera3d.lastError;
        if (errName === "InsecureContext") {
          btnCameraOn.title =
            "Camera requires HTTPS — serve over https:// or use localhost";
          btnCameraOn.textContent = "✕ HTTPS";
        } else if (errName === "NotAllowedError") {
          btnCameraOn.title = "Camera permission denied";
          btnCameraOn.textContent = "✕ Camera";
        } else {
          btnCameraOn.title = `Camera error: ${errName ?? "unknown"}`;
          btnCameraOn.textContent = "✕ Camera";
        }
      }
    } else {
      camera3d.stop();
      btnCameraOn.textContent = "▶ Camera";
      ps.set("camera.active", 0);
      ps.set("layer.fg", 3);
    }
  });

  // camera.active drives the hardware. Previously only the I/O button's
  // click handler started/stopped the stream, so toggling the param (status
  // bar button, V key, presets, MIDI) changed the display state but left
  // the camera running. Guards keep this a no-op when the I/O button (or
  // any imperative path) already did the work.
  ps.get("camera.active")?.onChange(async (v) => {
    if (v && !camera3d.active) {
      const devParam = ps.get("camera.device");
      const devId = devParam?._deviceIds?.[Math.round(devParam.value)] ?? "";
      const ok = await camera3d.start(devId || camDeviceSel.value || null);
      if (!ok) {
        // Surface WHY — iPad failures were invisible (param just snapped off)
        const why = {
          NotAllowedError: "Camera permission denied — check Settings › Safari › Camera",
          NotReadableError: "Camera is in use by another app",
          NotFoundError: "No camera found",
          InsecureContext: "Camera needs HTTPS — use npm run dev:https",
        }[camera3d.lastError] ?? `Camera failed: ${camera3d.lastError}`;
        showToast(why);
        ps.set("camera.active", 0);
        return;
      }
      btnCameraOn.textContent = "■ Camera";
    } else if (!v && camera3d.active) {
      camera3d.stop();
      btnCameraOn.textContent = "▶ Camera";
    }
  });

  // ── Clip management UI ──────────────────────────────────────────────────

  const clipsList = document.getElementById("clips-list");
  const btnAddClip = document.getElementById("btn-add-clip");

  function _showClipError(msg) {
    const el = document.createElement("div");
    el.className = "clip-error-toast";
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

  function showToast(msg, duration = 5000) {
    const el = document.createElement('div');
    el.className = 'clip-error-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), duration);
  }

  /**
   * Render one deck's 8-slot rack. Deck A and Deck B hold identical MovieInput
   * clip arrays — only the container, the param prefix, the key hint and the
   * ⇧-click behaviour differ, so this stays ONE function rather than two copies
   * of ~130 lines of DOM. (Six hand-copied source lists once drifted apart here;
   * see CLAUDE.md. The Deck B panel was originally left listless for exactly
   * this reason — "no duplicated DOM" — which parameterising honours.)
   *
   * @param {object}   cfg
   * @param {object}   cfg.deck         MovieInput instance
   * @param {Element}  cfg.listEl       container to render into
   * @param {string}   cfg.prefix       param prefix — "movie" | "movieB"
   * @param {string}   cfg.keyHint      modifier glyph shown on the slot key badge
   * @param {?string}  cfg.emptyMsg     empty-state text, or null to render nothing
   * @param {Function} cfg.refresh      this deck's own refresh, for re-render
   * @param {?Function} cfg.onShiftClick ⇧-click handler, or null for plain select
   */
  function _renderRack(cfg) {
    const { deck, listEl, prefix, keyHint, emptyMsg, refresh, onShiftClick } = cfg;
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!deck.clips.length) {
      if (!emptyMsg) return;
      const empty = document.createElement("div");
      empty.className = "clip-empty";
      empty.textContent = emptyMsg;
      listEl.appendChild(empty);
      return;
    }
    deck.clips.forEach((clip, i) => {
      const isActive = i === deck.currentIndex;
      const item = document.createElement("div");
      item.className = `clip-item${isActive ? " active" : ""}`;

      // Thumbnail
      const thumb = document.createElement("div");
      thumb.className = "clip-thumb";
      if (clip.thumb) {
        const img = document.createElement("img");
        img.src = clip.thumb;
        img.width = 80;
        img.height = 45;
        thumb.appendChild(img);
      } else {
        thumb.textContent = "▶";
      }
      if (isActive) {
        const playing = document.createElement("div");
        playing.className = "clip-thumb-playing";
        playing.textContent = "▶";
        thumb.appendChild(playing);
      }

      // Info
      const info = document.createElement("div");
      info.className = "clip-info";

      const nameLine = document.createElement("div");
      nameLine.className = "clip-name";
      nameLine.textContent = clip.name.replace(/\.[^/.]+$/, ""); // strip extension
      nameLine.title = clip.name;

      const metaLine = document.createElement("div");
      metaLine.className = "clip-meta";

      const dur = document.createElement("span");
      dur.textContent =
        clip.duration >= 60
          ? `${Math.floor(clip.duration / 60)}m${Math.round(clip.duration % 60)}s`
          : `${clip.duration.toFixed(1)}s`;

      const key = document.createElement("kbd");
      key.className = "clip-key";
      key.textContent = i < 8 ? `${keyHint}${i + 1}` : "";

      const rmBtn = document.createElement("button");
      rmBtn.className = "clip-remove";
      rmBtn.textContent = "✕";
      rmBtn.title = "Remove clip";
      rmBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        deck.removeClip(i);
        refresh();
      });

      metaLine.appendChild(dur);
      metaLine.appendChild(key);
      metaLine.appendChild(rmBtn);
      info.appendChild(nameLine);
      info.appendChild(metaLine);

      item.appendChild(thumb);
      item.appendChild(info);

      item.addEventListener("click", (e) => {
        // ⇧-click → send this clip to Deck B (this deck's selection unchanged)
        if (e.shiftKey && onShiftClick) {
          onShiftClick(clip);
          return;
        }
        deck.selectClip(i);
        if (ps.get(`${prefix}.active`).value) clip.video.play().catch(() => {});
        refresh();
      });
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        // Remove any existing clip context menu
        document.querySelector(".clip-ctx-menu")?.remove();
        const menu = document.createElement("div");
        menu.className = "clip-ctx-menu ctx-menu";
        menu.innerHTML =
          `<div class="ctx-item" data-action="midi">Assign MIDI controller</div>` +
          `<div class="ctx-item ctx-danger" data-action="remove">Remove clip</div>`;
        menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:999`;
        document.body.appendChild(menu);
        menu
          .querySelector('[data-action="midi"]')
          .addEventListener("click", () => {
            menu.remove();
            // Trigger the controller badge popover for this deck's speed
            const badge = document.querySelector(
              `[data-param-id="${prefix}.speed"] .param-ctrl`,
            );
            if (badge)
              badge.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  cancelable: true,
                }),
              );
          });
        menu
          .querySelector('[data-action="remove"]')
          .addEventListener("click", () => {
            menu.remove();
            deck.removeClip(i);
            refresh();
          });
        const dismiss = (ev) => {
          if (!menu.contains(ev.target)) {
            menu.remove();
            document.removeEventListener("pointerdown", dismiss);
          }
        };
        setTimeout(() => document.addEventListener("pointerdown", dismiss), 0);
      });

      listEl.appendChild(item);
    });
  }

  function refreshClipsList() {
    _renderRack({
      deck: movieInput,
      listEl: clipsList,
      prefix: "movie",
      keyHint: "⇧",
      emptyMsg: "Drop video files here or click + Add Clip",
      refresh: refreshClipsList,
      // ⇧-click sends the clip to Deck B without disturbing Deck A's selection
      onShiftClick: (clip) => {
        movieInputB
          .addClip(clip.url)
          .then((idx) => {
            if (idx < 0) return;
            movieInputB.selectClip(idx);
            ps.set("movieB.active", 1);
            refreshClipBStatus();
          })
          .catch((err) => _showClipError(err.message));
      },
    });
  }

  /** Deck B's rack. Empty state is left to #clipB-status, which already carries
   *  the "how do I load Deck B" hint — rendering it twice would just be noise. */
  function refreshClipsBList() {
    _renderRack({
      deck: movieInputB,
      listEl: document.getElementById("clipsB-list"),
      prefix: "movieB",
      keyHint: "⌥",
      emptyMsg: null,
      // Re-render through the status function, not this one: the status line
      // above the rack carries the clip COUNT, so selecting or removing here
      // has to refresh both or it goes stale. refreshClipBStatus() calls back
      // into this function, so the rack still redraws.
      refresh: refreshClipBStatus,
      onShiftClick: null,
    });
  }

  refreshClipsList(); // show empty state on startup

  document.getElementById("btn-clear-clips")?.addEventListener("click", () => {
    if (!movieInput.clips.length) return;
    if (!confirm("Remove all clips?")) return;
    // removeClip shifts indices — remove from end
    for (let i = movieInput.clips.length - 1; i >= 0; i--)
      movieInput.removeClip(i);
    ps.set("movie.active", 0);
    refreshClipsList();
  });

  btnAddClip?.addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "video/*,.mp4,.webm,.mov,.avi,.mkv";
    input.multiple = true;
    input.onchange = async (e) => {
      for (const file of e.target.files) {
        try {
          await movieInput.addClip(file);
        } catch (err) {
          console.error("[Movie] Failed to load:", err);
          _showClipError(err.message);
        }
      }
      refreshClipsList();
      // Apply current mute state to all clips
      const muted = !!ps.get("movie.mute").value;
      movieInput.clips.forEach((c) => {
        c.video.muted = muted;
      });
      if (movieInput.currentClip) {
        movieInput.currentClip.video.play().catch(() => {});
        ps.set("layer.fg", 1);
      }
    };
    input.click();
  });

  // ── Drag-and-drop: video → clip, image → stills buffer ───────────────────

  async function _doImportImX(file, bufPromise) {
    try {
      const buf = await (bufPromise ?? file.arrayBuffer());
      const presets = await importImX(buf);
      await presetMgr.importAll(presets);
      await presetMgr.activatePreset(0);
      memoryPanel._refresh();
      alert(`Imported ${presets.length} preset(s) from "${file.name}"`);
    } catch (err) {
      alert(`ImX import failed: ${err.message}`);
      console.error("[ImXImporter]", err);
    }
  }

  document.body.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    document.body.classList.add("dnd-active");
  });
  document.body.addEventListener("dragleave", (e) => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      document.body.classList.remove("dnd-active");
    }
  });

  document.body.addEventListener("drop", async (e) => {
    e.preventDefault();
    document.body.classList.remove("dnd-active");
    const dropToDeckB = e.shiftKey; // ⇧-drop routes videos to Deck B
    const files = Array.from(e.dataTransfer.files);
    // Read .imx buffers immediately before any await (DataTransfer expires after first yield)
    const imxBuffers = new Map();
    for (const file of files) {
      if (/\.imx$/i.test(file.name)) imxBuffers.set(file, file.arrayBuffer());
    }
    for (const file of files) {
      if (
        file.type.startsWith("video/") ||
        /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)
      ) {
        try {
          if (dropToDeckB) {
            await movieInputB.addClip(file);
            ps.set("movieB.active", 1);
            movieInputB.currentClip?.video.play().catch(() => {});
            refreshClipBStatus();
          } else {
            await movieInput.addClip(file);
            refreshClipsList();
            if (movieInput.currentClip) {
              movieInput.currentClip.video.play().catch(() => {});
              ps.set("layer.fg", 1);
            }
            presetMgr.setMediaRef('movie', file.name);
          }
        } catch (err) {
          console.error("[DnD] video load failed:", err);
          _showClipError(err.message);
        }
      } else if (/\.(glb|gltf|obj|stl|dae)$/i.test(file.name)) {
        try {
          await scene3d.loadModel(file, ps, files);
          // Auto-activate 3D: if FG is not already a useful source, route it to 3D
          if (ps.get("layer.fg").value === 3 /* Color */) ps.set("layer.fg", 5); // 5 = 3D scene
          ps.set("scene3d.active", 1);
          ps.set("scene3d.anim.active", 1);
          _refreshModelLabel();
          console.info(`[3D] Loaded model: ${file.name}`);
          presetMgr.setMediaRef('scene3d', file.name);
        } catch (err) {
          console.error("[DnD] 3D model load failed:", err);
        }
      } else if (/\.imx$/i.test(file.name)) {
        _doImportImX(file, await imxBuffers.get(file));
      } else if (
        file.type.startsWith("image/") ||
        /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(file.name)
      ) {
        try {
          const bitmap = await createImageBitmap(file);
          const cvs = document.createElement("canvas");
          cvs.width = bitmap.width;
          cvs.height = bitmap.height;
          cvs.getContext("2d").drawImage(bitmap, 0, 0);
          bitmap.close();
          const tex = new THREE.CanvasTexture(cvs);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          stillsBuffer.capture(tex);
          tex.dispose();
        } catch (err) {
          console.error("[DnD] image load failed:", err);
        }
      }
    }
  });

  // Movie toggle
  ps.get("movie.active").onChange((v) => {
    movieInput.active = !!v;
    if (v && movieInput.currentClip) {
      movieInput.currentClip.video.play().catch(() => {});
    } else if (!v && movieInput.currentClip) {
      movieInput.currentClip.video.pause();
    }
  });
  ps.get("movie.mute").onChange((v) => {
    movieInput.clips.forEach((c) => {
      c.video.muted = !!v;
    });
  });
  // Deck B mirrors of the above
  ps.get("movieB.active").onChange((v) => {
    movieInputB.active = !!v;
    if (v && movieInputB.currentClip) {
      movieInputB.currentClip.video.play().catch(() => {});
    } else if (!v && movieInputB.currentClip) {
      movieInputB.currentClip.video.pause();
    }
    refreshClipBStatus();
  });
  ps.get("movieB.mute").onChange((v) => {
    movieInputB.clips.forEach((c) => {
      c.video.muted = !!v;
    });
  });

  // Chrome desktop autoplay policy: play() on an unmuted video rejects until
  // the page has a user gesture. tick() already retries paused decks every
  // frame (and succeeds once engagement exists); these hooks force the
  // recovery on the first interaction of any kind, then remove themselves.
  // NOTE: nothing plays at launch BY DESIGN — main.js forces movie.active=0
  // on startup; a deck only plays after MovieOn is toggled.
  const _resumeDecksOnGesture = () => {
    [
      { deck: movieInput, speedId: "movie.speed" },
      { deck: movieInputB, speedId: "movieB.speed" },
    ].forEach(({ deck, speedId }) => {
      const v = deck.currentClip?.video;
      if (deck.active && v?.paused && ps.get(speedId).value > 0)
        v.play().catch(() => {});
    });
    document.body.removeEventListener("pointerdown", _resumeDecksOnGesture, true);
    document.body.removeEventListener("click", _resumeDecksOnGesture, true);
    window.removeEventListener("keydown", _resumeDecksOnGesture, true);
  };
  document.body.addEventListener("pointerdown", _resumeDecksOnGesture, true);
  document.body.addEventListener("click", _resumeDecksOnGesture, true);
  window.addEventListener("keydown", _resumeDecksOnGesture, true);

  // ── Clip Library wiring ───────────────────────────────────────────────────
  let _clipRecording = false;

  ps.get("clip.record").onChange(async () => {
    if (_clipRecording) return; // debounce: ignore re-trigger while recording
    _clipRecording = true;
    const slotIndex =
      ps.get("clip.bank").value * 16 + ps.get("clip.slot").value;
    const maxSec = ps.get("clip.duration").value;
    const stream = canvas.captureStream(60);
    console.info(`[Clip] Recording slot ${slotIndex} for ${maxSec}s…`);
    setRecording(true);
    try {
      await clipLibrary.record(stream, slotIndex, maxSec, canvas);
      console.info(`[Clip] Slot ${slotIndex} saved (${maxSec}s)`);
      refreshClipGrid();
    } catch (err) {
      console.error("[Clip] Record failed:", err);
    } finally {
      _clipRecording = false;
      setRecording(false);
    }
  });

  ps.get("clip.recall").onChange(async () => {
    const slotIndex =
      ps.get("clip.bank").value * 16 + ps.get("clip.slot").value;
    try {
      const clip = await clipLibrary.recall(slotIndex);
      if (!clip) {
        console.warn(`[Clip] Slot ${slotIndex} is empty`);
        return;
      }
      const idx = await movieInput.addClip(clip.blobUrl);
      if (idx >= 0) {
        movieInput.selectClip(idx);
        ps.set("movie.active", 1);
        console.info(
          `[Clip] Slot ${slotIndex} recalled (${clip.duration.toFixed(1)}s)`,
        );
        refreshClipGrid();
      }
    } catch (err) {
      console.error("[Clip] Recall failed:", err);
    }
  });

  // Auto-activate / deactivate 3D scene based on layer source selection
  function sync3DActive() {
    const fg = ps.get("layer.fg").value;
    const bg = ps.get("layer.bg").value;
    const ds = ps.get("layer.ds").value;
    const SCENE3D_IDX = 6;
    const DEPTH3D_IDX = 20;
    const needs3D =
      fg === SCENE3D_IDX ||
      bg === SCENE3D_IDX ||
      ds === SCENE3D_IDX ||
      fg === DEPTH3D_IDX ||
      bg === DEPTH3D_IDX ||
      ds === DEPTH3D_IDX;
    ps.set("scene3d.active", needs3D ? 1 : 0);
  }
  ps.get("layer.fg").onChange(sync3DActive);
  ps.get("layer.bg").onChange(sync3DActive);
  ps.get("layer.ds").onChange(sync3DActive);

  // ── Buffer capture helpers ────────────────────────────────────────────────

  // Per-capture-button pinned target slots (null = auto-advance write head)
  const captureTargetSlots = {
    screen: null,
    camera: null,
    movie: null,
    draw: null,
    fg: null,
    bg: null,
    "3d": null,
  };

  // Live slots: slot index → source key ('camera'|'movie'|'draw'|'screen'|'fg')
  const liveSlots = new Map();
  let _liveTick = 0; // frame counter for throttled thumbnail updates

  /** Resolve a raw layer-source index to its current texture (matches Pipeline._resolveSource). */
  function _resolveLayerTex(idx) {
    // Derived from the canonical SOURCE_DEFS list — no hand-copy to drift.
    const key = SOURCE_KEYS[idx];
    if (key === "camera")
      return camera3d.active ? camera3d.currentTexture : null;
    if (key === "movie")
      return movieInput.active ? movieInput.currentTexture : null;
    if (key === "movieB")
      return movieInputB.active ? movieInputB.currentTexture : null;
    if (key === "scene3d") return scene3d.texture;
    if (key === "draw") return drawLayer.texture;
    if (key === "buffer") return stillsBuffer.texture;
    if (key === "noise") return noiseTexture;
    if (key === "output") return pipeline.prev.texture;
    if (key === "seq1") return seq1.texture;
    if (key === "seq2") return seq2.texture;
    if (key === "seq3") return seq3.texture;
    if (key === "analog") return analogTV.texture;
    if (key === "tdisp") return tdEngine.texture;
    if (key === "mixbus") return pipeline.mixTextureAt(0);
    if (key === "mixbus2") return pipeline.mixTextureAt(1);
    if (key === "mixbus3") return pipeline.mixTextureAt(2);
    return pipeline.prev.texture;
  }

  /** Resolve texture for source key. */
  function texForSource(src) {
    if (src === "screen") return pipeline.prev.texture;
    if (src === "camera")
      return camera3d.active ? camera3d.currentTexture : null;
    if (src === "movie")
      return movieInput.active ? movieInput.currentTexture : null;
    if (src === "draw") return drawLayer.texture;
    if (src === "fg") return _resolveLayerTex(ps.get("layer.fg").value);
    if (src === "bg") return _resolveLayerTex(ps.get("layer.bg").value);
    if (src === "3d") return scene3d.texture;
    return null;
  }

  /** Capture from src key into its pinned slot (or write head if null). */
  function captureSource(src) {
    const tex = texForSource(src);
    const slot = captureTargetSlots[src];
    if (!tex) return;
    if (slot !== null) stillsBuffer.captureToSlot(tex, slot);
    else stillsBuffer.capture(tex);
    refreshBufferGrid();
  }

  /** Used by auto-capture and keyboard shortcut C — respects buffer.source SELECT. */
  function captureFromSource() {
    const srcIdx = ps.get("buffer.source").value;
    const keys = ["screen", "camera", "movie", "draw", "fg", "bg", "3d"];
    captureSource(keys[srcIdx] ?? "screen");
  }

  // Trigger bindings (MIDI-mappable)
  ps.get("buffer.capture").onTrigger(captureFromSource);
  ps.get("buffer.cap_screen").onTrigger(() => captureSource("screen"));
  ps.get("buffer.cap_video").onTrigger(() => captureSource("camera"));
  ps.get("buffer.cap_movie").onTrigger(() => captureSource("movie"));

  ps.get("screen.bg1").onTrigger(() =>
    stillsBuffer.captureBG(0, pipeline.prev.texture),
  );
  ps.get("screen.bg2").onTrigger(() =>
    stillsBuffer.captureBG(1, pipeline.prev.texture),
  );

  // Buffer rows/cols change — resize slot array, update fs max, rebuild grid
  function _updateBufferSize() {
    const rows = Math.round(ps.get("buffer.rows").value);
    const cols = Math.round(ps.get("buffer.cols").value);
    const n = Math.min(rows * cols, 64);
    stillsBuffer.setFrameCount(n);
    ps.get("buffer.fs1").max = n - 1;
    ps.get("buffer.fs2").max = n - 1;
    rebuildBufferGrid();
  }
  ps.get("buffer.rows").onChange(_updateBufferSize);
  ps.get("buffer.cols").onChange(_updateBufferSize);
  // _updateBufferSize() called below after bufferCanvas is initialised

  // Draw layer triggers
  ps.get("draw.clear").onTrigger(() => drawLayer.clear());

  // Stroke looper transport params (MIDI-pad friendly: rec is a toggle-style
  // trigger — arm/record, press again to stop+play)
  for (let n = 1; n <= LOOP_SLOTS; n++) {
    ps.get(`drawloop${n}.rec`).onTrigger(() => strokeLooper.toggleRecord(n - 1));
    ps.get(`drawloop${n}.clear`).onTrigger(() => strokeLooper.clear(n - 1));
    ps.get(`drawloop${n}.play`).onChange((v) =>
      strokeLooper.setPlaying(n - 1, v > 0.5),
    );
  }
  // Keep the play param in sync when the looper changes state internally
  // (rec-stop auto-plays, clear stops). setPlaying no-ops on equal state,
  // so this cannot loop with the onChange above.
  strokeLooper.onSlotChange = (i) => {
    const slot = strokeLooper.slots[i];
    const p = ps.get(`drawloop${i + 1}.play`);
    if (p && (p.value > 0.5) !== slot.playing) {
      ps.set(`drawloop${i + 1}.play`, slot.playing ? 1 : 0);
    }
  };

  // Text layer triggers
  ps.get("text.advance").onTrigger(() => textLayer.advance());

  // Slit scan clear trigger
  ps.get("slitscan.clear").onTrigger(() => slitScan.clear());

  // Vasulka Warp — reinit on buf size change
  const _vwarpReinit = () => {
    const bufsizeOptions = [480, 960, 1920];
    const bufSize = bufsizeOptions[ps.get("vwarp.bufsize").value] ?? 960;
    const w = vasulkaWarp._fullW,
      h = vasulkaWarp._fullH;
    vasulkaWarp.dispose();
    const fresh = new VasulkaWarp(renderer, w, h, bufSize);
    // Replace internals in-place so existing closure references stay valid
    Object.keys(fresh).forEach((k) => {
      vasulkaWarp[k] = fresh[k];
    });
  };
  ps.get("vwarp.bufsize").onChange(_vwarpReinit);

  // Sequence buffer param listeners
  [1, 2, 3].forEach((n) => {
    const seq = [seq1, seq2, seq3][n - 1];
    ps.get(`seq${n}.speed`).onChange((v) => {
      seq.speed = v / 100;
    });
    ps.get(`seq${n}.size`).onChange((v) => {
      seq.setFrameCount(Math.round(v));
    });
    ps.get(`seq${n}.mode`).onChange((v) => {
      seq.setMode(v === 1 ? "timewarp" : "loop");
    });
    ps.get(`seq${n}.tw.speed`).onChange((v) => {
      seq._twSpeed = Math.max(1, Math.round(v));
    });
  });

  // ── Draw tab UI ───────────────────────────────────────────────────────────

  // Mirror the draw canvas into the preview element (same canvas = live)
  const drawPreviewEl = document.getElementById("draw-preview");
  if (drawPreviewEl && drawPreviewEl.parentNode) {
    drawPreviewEl.replaceWith(drawLayer.canvas);
    drawLayer.canvas.id = "draw-preview";
    drawLayer.canvas.style.cssText =
      "display:block;width:100%;image-rendering:pixelated;border:1px solid var(--border);background:#000;";
    // Pointer drawing on the preview canvas (mouse / pen / touch).
    // Pen pressure flows into the DrawLayer point queue via queuePoint;
    // coalesced events keep fast strokes smooth; a touch contact is rejected
    // while a pen is down (palm rejection).
    let _drawPenBackup = 0;
    let _drawEraseBackup = 0;
    let _activePenId = null; // shared across draw surfaces

    // gate: optional () => bool — when given, new strokes only start while
    // it returns true (used by the main canvas, active only in Draw mode).
    // Move/up stay ungated so a mode change mid-stroke still ends cleanly.
    const attachDrawSurface = (el, gate) => {
      el.style.touchAction = "none";
      let strokeErase = false;
      let activeId = null; // single stroke at a time per surface

      const setDrawPos = (e) => {
        const r = el.getBoundingClientRect();
        ps.set("draw.x", ((e.clientX - r.left) / r.width) * 100);
        ps.set("draw.y", (1 - (e.clientY - r.top) / r.height) * 100);
      };
      const queuePt = (e, start = false) => {
        const r = el.getBoundingClientRect();
        drawLayer.queuePoint({
          x: (e.clientX - r.left) / r.width,
          y: (e.clientY - r.top) / r.height,
          // mouse reports pressure 0.5 while pressed — treat as full
          pressure: e.pointerType === "mouse" ? 1 : e.pressure || 1,
          erase: strokeErase,
          start,
          origin: "live",
        });
      };

      el.addEventListener("pointerdown", (e) => {
        if (gate && !gate()) return;
        if (e.pointerType === "touch" && _activePenId !== null) return; // palm
        if (activeId !== null) return;
        if (e.pointerType === "pen") _activePenId = e.pointerId;
        activeId = e.pointerId;
        el.setPointerCapture(e.pointerId);
        // right mouse button or pen barrel button = erase
        strokeErase = e.button === 2 || (e.buttons & 2) !== 0;
        setDrawPos(e);
        if (strokeErase) {
          _drawEraseBackup = ps.get("draw.erasesize").value;
          if (!_drawEraseBackup) ps.set("draw.erasesize", 20);
          ps.set("draw.pensize", 0);
        } else {
          _drawPenBackup = ps.get("draw.pensize").value;
          if (!_drawPenBackup) ps.set("draw.pensize", 8);
          ps.set("draw.erasesize", 0);
        }
        drawLayer.liveStroke = true;
        queuePt(e, true);
        e.preventDefault();
      });
      el.addEventListener("pointermove", (e) => {
        if (e.pointerId !== activeId || !e.buttons) return;
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) queuePt(ce);
        setDrawPos(e); // keep params coherent for readouts/Automation
      });
      const endStroke = (e) => {
        if (e.pointerType === "pen" && _activePenId === e.pointerId)
          _activePenId = null;
        if (e.pointerId !== activeId) return;
        activeId = null;
        drawLayer.liveStroke = false;
        ps.set("draw.pensize", _drawPenBackup || 0);
        ps.set("draw.erasesize", _drawEraseBackup || 0);
        _drawPenBackup = _drawEraseBackup = 0;
      };
      el.addEventListener("pointerup", endStroke);
      el.addEventListener("pointercancel", endStroke);
      el.addEventListener("contextmenu", (e) => e.preventDefault());
    };

    attachDrawSurface(drawLayer.canvas);
    // Reusable for other draw surfaces (main-canvas draw mode)
    drawLayer.attachDrawSurface = attachDrawSurface;
  }

  // Draw controls — Clear, Pen, Erase, Color picker, Fade toggle
  const drawControls = document.getElementById("draw-controls");
  if (drawControls) {
    // Pen / Erase buttons
    const btnPen = document.createElement("button");
    const btnErase = document.createElement("button");
    const btnClear = document.createElement("button");
    btnPen.className = "import-btn";
    btnErase.className = "import-btn";
    btnClear.className = "import-btn";
    btnPen.textContent = "✏ Pen";
    btnErase.textContent = "◻ Erase";
    btnClear.textContent = "✕ Clear";

    btnPen.addEventListener("click", () => {
      if (!ps.get("draw.pensize").value) ps.set("draw.pensize", 5);
      ps.set("draw.erasesize", 0);
      btnPen.style.borderColor = "var(--accent)";
      btnErase.style.borderColor = "";
    });
    btnErase.addEventListener("click", () => {
      ps.set("draw.pensize", 0);
      if (!ps.get("draw.erasesize").value) ps.set("draw.erasesize", 10);
      btnErase.style.borderColor = "var(--accent)";
      btnPen.style.borderColor = "";
    });
    btnClear.addEventListener("click", () => ps.trigger("draw.clear"));

    drawControls.append(btnPen, btnErase, btnClear);

    // Color picker (native <input type=color> as quick color entry)
    const colorPicker = document.createElement("input");
    colorPicker.type = "color";
    colorPicker.value = "#ffffff";
    colorPicker.title = "Pen color (or use PenHue/PenSat/PenBright params)";
    colorPicker.style.cssText =
      "width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg-3);cursor:pointer;";
    colorPicker.addEventListener("input", () => {
      const hex = colorPicker.value;
      const r = parseInt(hex.slice(1, 3), 16) / 255;
      const g = parseInt(hex.slice(3, 5), 16) / 255;
      const b = parseInt(hex.slice(5, 7), 16) / 255;
      // Convert RGB → HSV
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        d = max - min;
      let h = 0;
      if (d > 0) {
        if (max === r) h = 60 * (((g - b) / d) % 6);
        else if (max === g) h = 60 * ((b - r) / d + 2);
        else h = 60 * ((r - g) / d + 4);
      }
      if (h < 0) h += 360;
      const s = max > 0 ? (d / max) * 100 : 0;
      const v = max * 100;
      ps.set("draw.color.h", h);
      ps.set("draw.color.s", s);
      ps.set("draw.color.v", v);
    });
    drawControls.appendChild(colorPicker);

    // Fade toggle — quick enable/disable of draw fade
    const btnFade = document.createElement("button");
    btnFade.className = "import-btn";
    btnFade.textContent = "〜 Fade";
    btnFade.title = "Toggle draw fade/decay (sets DrawFade to 0.05 or 0)";
    btnFade.addEventListener("click", () => {
      const cur = ps.get("draw.fade").value;
      ps.set("draw.fade", cur > 0 ? 0 : 0.04);
      btnFade.style.borderColor =
        ps.get("draw.fade").value > 0 ? "var(--accent)" : "";
    });
    drawControls.appendChild(btnFade);

    // Canvas draw mode toggle — enters/leaves touch.mode "Draw" (index 3);
    // remembers the previous mode so leaving restores it. The 'g' key and
    // 3-finger tap cycle through Draw too — border syncs on any path.
    const btnCanvas = document.createElement("button");
    btnCanvas.className = "import-btn";
    btnCanvas.textContent = "⊕ Canvas";
    btnCanvas.title =
      "Draw directly on the output canvas (Draw interaction mode; 'g' key cycles modes)";
    let _preDrawMode = 0;
    btnCanvas.addEventListener("click", () => {
      const p = ps.get("touch.mode");
      if (!p) return;
      if (p.value === 3) {
        ps.set("touch.mode", _preDrawMode);
      } else {
        _preDrawMode = p.value;
        ps.set("touch.mode", 3);
      }
      showModeOSD(`MODE: ${p.options?.[p.value] ?? p.value}`);
    });
    ps.get("touch.mode")?.onChange((m) => {
      btnCanvas.style.borderColor =
        Math.round(m) === 3 ? "var(--accent)" : "";
    });
    drawControls.appendChild(btnCanvas);

    // Synthesis crossover shortcuts — the pipeline already routes any
    // source into the displacement pass (uDS) and the keyer's external
    // key (uEK) via layer.ds; these one-shot setters just point it at
    // Draw (SOURCES index 7). They overwrite a previous DisplaceSrc
    // choice by design.
    const btnWarp = document.createElement("button");
    btnWarp.className = "import-btn";
    btnWarp.textContent = "⇢ Warp";
    btnWarp.title =
      "Drawing displaces the video (DisplaceSrc → Draw; nudges Displace amount if 0)";
    btnWarp.addEventListener("click", () => {
      ps.set("layer.ds", 7); // Draw
      if (!(ps.get("displace.amount")?.value > 0)) ps.set("displace.amount", 20);
    });
    const btnKey = document.createElement("button");
    btnKey.className = "import-btn";
    btnKey.textContent = "⇢ Key";
    btnKey.title =
      "Drawing luminance keys FG over BG (DisplaceSrc → Draw; keyer + ext key on)";
    btnKey.addEventListener("click", () => {
      ps.set("layer.ds", 7); // Draw
      ps.set("keyer.active", 1);
      ps.set("keyer.extkey", 1);
    });
    drawControls.append(btnWarp, btnKey);

    // Stroke looper transport — 4 slots × Rec/Play/Clear. Buttons drive the
    // drawloop{n}.* params so MIDI/keyboard paths stay identical. Built via
    // a shared row-factory so the sidebar strip and the floating popup
    // (below) render identical controls without duplicating the wiring.
    const _buildLoopRows = (container) => {
      const rows = [];
      for (let n = 1; n <= LOOP_SLOTS; n++) {
        const row = document.createElement("div");
        row.className = "drawloop-row";
        const lab = document.createElement("span");
        lab.className = "drawloop-label";
        lab.textContent = `L${n}`;
        const bRec = document.createElement("button");
        bRec.className = "import-btn drawloop-rec";
        bRec.textContent = "●";
        bRec.title = `Record loop ${n} (press again to stop & play)`;
        bRec.addEventListener("click", () => ps.trigger(`drawloop${n}.rec`));
        const bPlay = document.createElement("button");
        bPlay.className = "import-btn drawloop-play";
        bPlay.textContent = "▶";
        bPlay.title = `Play / stop loop ${n}`;
        bPlay.addEventListener("click", () => {
          const p = ps.get(`drawloop${n}.play`);
          ps.set(`drawloop${n}.play`, p.value > 0.5 ? 0 : 1);
        });
        const bClear = document.createElement("button");
        bClear.className = "import-btn";
        bClear.textContent = "✕";
        bClear.title = `Clear loop ${n}`;
        bClear.addEventListener("click", () => ps.trigger(`drawloop${n}.clear`));
        row.append(lab, bRec, bPlay, bClear);
        container.appendChild(row);
        rows.push(row);
      }
      return rows;
    };

    const loopStrip = document.createElement("div");
    loopStrip.id = "drawloop-strip";
    drawControls.appendChild(loopStrip);
    const sidebarLoopRows = _buildLoopRows(loopStrip);

    // Floating popup — same rec/play/clear transport, shown only while
    // drawing directly on the main canvas (⊕ Canvas mode), where the side
    // panel's strip is out of reach. Bottom-left keeps it clear of a
    // right-handed pen/mouse working the canvas.
    const loopPopup = document.createElement("div");
    loopPopup.id = "drawloop-popup";
    const loopPopupLabel = document.createElement("div");
    loopPopupLabel.className = "drawloop-popup-label";
    loopPopupLabel.textContent = "LOOP";
    loopPopup.appendChild(loopPopupLabel);
    document.body.appendChild(loopPopup);
    const popupLoopRows = _buildLoopRows(loopPopup);
    ps.get("touch.mode")?.onChange((m) => {
      loopPopup.classList.toggle("show", Math.round(m) === 3);
    });

    // Reflect looper state on both sets of buttons on any path (MIDI, param
    // row, project load) — chain the param-sync hook wired at the trigger
    // block
    const _syncLoopUI = (i) => {
      const slot = strokeLooper.slots[i];
      for (const row of [sidebarLoopRows[i], popupLoopRows[i]]) {
        row
          .querySelector(".drawloop-rec")
          .classList.toggle("recording", slot.recording);
        row.querySelector(".drawloop-play").style.borderColor = slot.playing
          ? "var(--accent)"
          : "";
      }
    };
    const _prevSlotCb = strokeLooper.onSlotChange;
    strokeLooper.onSlotChange = (i) => {
      _prevSlotCb?.(i);
      _syncLoopUI(i);
    };
  }

  // ── Text tab UI ───────────────────────────────────────────────────────────

  const textPreviewEl = document.getElementById("text-preview");
  if (textPreviewEl?.parentNode) {
    textPreviewEl.replaceWith(textLayer.canvas);
    textLayer.canvas.id = "text-preview";
    textLayer.canvas.style.cssText =
      "display:block;width:100%;image-rendering:pixelated;border:1px solid var(--border);background:#000;";
  }

  const textContentEl = document.getElementById("text-content");
  textContentEl?.addEventListener("input", () => {
    const lines = textContentEl.value.split("\n");
    textLayer.setContentList(lines);
    // Also keep setContent for single-line compatibility
    if (lines.filter((l) => l.trim()).length <= 1) {
      textLayer.setContent(textContentEl.value);
    }
  });

  document.getElementById("btn-text-advance")?.addEventListener("click", () => {
    ps.trigger("text.advance");
  });
  document.getElementById("btn-text-reset")?.addEventListener("click", () => {
    textLayer._idx = 0;
    textLayer._render();
  });

  // ── Mobile panel toggle ───────────────────────────────────────────────────
  const _panelEl = document.getElementById("control-panel");
  const _overlayEl = document.getElementById("panel-overlay");
  document.getElementById("btn-panel-toggle")?.addEventListener("click", () => {
    const open = _panelEl?.classList.toggle("panel-open");
    _overlayEl?.classList.toggle("hidden", !open);
  });
  _overlayEl?.addEventListener("click", () => {
    _panelEl?.classList.remove("panel-open");
    _overlayEl?.classList.add("hidden");
  });

  // ── Buffer tab UI ─────────────────────────────────────────────────────────

  let bufferCanvas = document.getElementById("buffer-canvas");
  let bufferCtx = bufferCanvas?.getContext("2d");
  const CANVAS_W = bufferCanvas?.width ?? 320;
  _updateBufferSize();
  // Target cell width ~60px — more frames → more columns → smaller cells
  const CELL_TARGET_W = 60;

  function gridLayout() {
    const n = stillsBuffer.frameCount;
    const cols = Math.round(ps.get("buffer.cols").value);
    const cw = CANVAS_W / cols;
    const ch = Math.round(cw * 0.6); // keep ~5:3 aspect (video-ish)
    const rows = Math.ceil(n / cols);
    return { cols, rows, cw, ch, totalH: rows * ch };
  }

  function refreshBufferGrid() {
    if (!bufferCtx) return;
    const { cols, cw, ch } = gridLayout();
    const n = stillsBuffer.frameCount;
    const canvasH = bufferCanvas.height;

    bufferCtx.clearRect(0, 0, CANVAS_W, canvasH);

    for (let i = 0; i < n; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = col * cw;
      const y = row * ch;
      const isRead = i === stillsBuffer.readIndex;
      const isWrite =
        i === (stillsBuffer.writeIndex - 1 + n) % n &&
        stillsBuffer._hasFrame[i];
      const isProtected = stillsBuffer.isProtected(i);
      const isLive = liveSlots.has(i);

      // Cell background
      bufferCtx.fillStyle = isRead ? "#2a2a3a" : "#111118";
      bufferCtx.fillRect(x, y, cw - 1, ch - 1);

      // Thumbnail — scale proportionally to cell
      if (stillsBuffer._hasFrame[i]) {
        bufferCtx.drawImage(
          stillsBuffer.thumbnailCanvases[i],
          x,
          y,
          cw - 1,
          ch - 1,
        );
      }

      // Protected slot — tint with semi-transparent overlay
      if (isProtected) {
        bufferCtx.fillStyle = "rgba(255,160,0,0.18)";
        bufferCtx.fillRect(x, y, cw - 1, ch - 1);
      }

      // Scatter range overlay — blue tint for slots within ±scatter of fs1
      const _scatter = Math.round(ps.get('buffer.scatter').value);
      if (_scatter > 0) {
        const _center = Math.round(ps.get('buffer.fs1').value);
        const _dist   = Math.abs(i - _center);
        if (_dist > 0 && _dist <= _scatter) {
          bufferCtx.fillStyle = 'rgba(80,140,255,0.12)';
          bufferCtx.fillRect(x, y, cw - 1, ch - 1);
        }
        if (i === stillsBuffer._grainFlashSlot &&
            performance.now() - stillsBuffer._grainFlashTime < 80) {
          bufferCtx.fillStyle = 'rgba(80,140,255,0.40)';
          bufferCtx.fillRect(x, y, cw - 1, ch - 1);
        }
      }

      // Frame index label (only if cell tall enough)
      if (ch >= 12) {
        bufferCtx.fillStyle = isRead
          ? "#e8c840"
          : isWrite
            ? "#60a0e0"
            : isProtected
              ? "#ffa020"
              : "#404050";
        bufferCtx.font = `${Math.max(7, Math.min(9, ch * 0.25))}px monospace`;
        bufferCtx.fillText(
          `${i}${isProtected ? "🔒" : ""}${isLive ? "●" : ""}`,
          x + 2,
          y + Math.max(8, ch * 0.28),
        );
      }

      // Write-head marker (blue for normal, amber for protected)
      if (i === stillsBuffer.writeIndex) {
        bufferCtx.strokeStyle = isProtected ? "#ffa020" : "#60a0e0";
        bufferCtx.lineWidth = 1;
        bufferCtx.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2);
      }
      // Live slot — green border
      if (isLive) {
        bufferCtx.strokeStyle = "#40c060";
        bufferCtx.lineWidth = 1.5;
        bufferCtx.strokeRect(x + 1, y + 1, cw - 3, ch - 3);
      }
    }
  }

  /** Rebuild grid canvas height when slot count changes. */
  function rebuildBufferGrid() {
    if (!bufferCanvas) return;
    bufferCanvas.height = gridLayout().totalH;
    refreshBufferGrid();
  }

  // ── Slot picker popup ─────────────────────────────────────────────────────
  // Shared floating popup used by all capture buttons.

  const slotPickerEl = document.createElement("div");
  slotPickerEl.className = "slot-picker hidden";
  document.body.appendChild(slotPickerEl);

  let _slotPickerCb = null;

  function showSlotPicker(e, currentSlot, onPick) {
    e.preventDefault();
    _slotPickerCb = onPick;
    slotPickerEl.innerHTML = "";

    // "Auto" option — resets to write-head advance
    const autoBtn = document.createElement("button");
    autoBtn.className =
      "slot-picker-auto" + (currentSlot === null ? " active" : "");
    autoBtn.textContent = "Auto →";
    autoBtn.title = "Advance write head (default)";
    autoBtn.addEventListener("click", () => {
      onPick(null);
      hideSlotPicker();
    });
    slotPickerEl.appendChild(autoBtn);

    // Slot grid
    const grid = document.createElement("div");
    grid.className = "slot-picker-grid";
    for (let i = 0; i < stillsBuffer.frameCount; i++) {
      const btn = document.createElement("button");
      btn.className =
        "slot-picker-slot" +
        (stillsBuffer._hasFrame[i] ? " filled" : "") +
        (i === currentSlot ? " active" : "");
      btn.textContent = String(i);
      btn.title = `Capture always → slot ${i}`;
      btn.addEventListener("click", () => {
        onPick(i);
        hideSlotPicker();
      });
      grid.appendChild(btn);
    }
    slotPickerEl.appendChild(grid);

    // Position near the click
    const x = Math.min(e.clientX, window.innerWidth - 180);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    slotPickerEl.style.left = `${x}px`;
    slotPickerEl.style.top = `${y}px`;
    slotPickerEl.classList.remove("hidden");
  }

  function hideSlotPicker() {
    slotPickerEl.classList.add("hidden");
    _slotPickerCb = null;
  }

  document.addEventListener("click", (e) => {
    if (!slotPickerEl.contains(e.target)) hideSlotPicker();
  });

  // ── Buffer controls toolbar ───────────────────────────────────────────────

  const bufferSection = document.querySelector("#tab-buffer .panel-section");

  if (bufferSection) {
    /**
     * Build a capture button that:
     *   left-click  → captureSource(srcKey)
     *   right-click → open slot picker to pin a target slot
     * The button label updates to show the pinned slot.
     */
    function makeCaptureBtn(label, srcKey) {
      const btn = document.createElement("button");
      btn.className = "import-btn cap-btn";

      function updateLabel() {
        const slot = captureTargetSlots[srcKey];
        btn.textContent = slot !== null ? `${label} [${slot}]` : label;
        btn.classList.toggle("pinned", slot !== null);
      }
      updateLabel();

      btn.addEventListener("click", (e) => {
        if (e.ctrlKey || e.metaKey) return; // handled by contextmenu
        captureSource(srcKey);
      });

      btn.addEventListener("contextmenu", (e) => {
        showSlotPicker(e, captureTargetSlots[srcKey], (slot) => {
          captureTargetSlots[srcKey] = slot;
          updateLabel();
        });
      });

      return btn;
    }

    // ── Capture buttons row ───────────────────────────────────────────────
    const capRow = document.createElement("div");
    capRow.style.cssText =
      "display:flex;gap:4px;padding:8px 10px 4px;flex-wrap:wrap;";
    capRow.appendChild(makeCaptureBtn("SCR", "screen"));
    capRow.appendChild(makeCaptureBtn("CAM", "camera"));
    capRow.appendChild(makeCaptureBtn("MOV", "movie"));
    capRow.appendChild(makeCaptureBtn("DRW", "draw"));

    const capHint = document.createElement("span");
    capHint.textContent = "right-click to pin slot";
    capHint.style.cssText =
      "font-size:10px;color:var(--text-2);align-self:center;margin-left:4px;";
    capRow.appendChild(capHint);

    // ── Auto-capture row ──────────────────────────────────────────────────
    const autoRow = document.createElement("div");
    autoRow.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:0 10px 4px;flex-wrap:wrap;";

    // Source selector for auto-capture
    const srcLabel = document.createElement("span");
    srcLabel.textContent = "Auto src:";
    srcLabel.style.cssText = "font-size:11px;color:var(--text-2);";
    autoRow.appendChild(srcLabel);

    const srcParam = ps.get("buffer.source");
    const srcBtns = [];
    srcParam.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "source-btn";
      btn.textContent = opt.slice(0, 3).toUpperCase();
      btn.title = opt;
      btn.classList.toggle("active", i === srcParam.value);
      btn.addEventListener("click", () => {
        srcParam.value = i;
        srcBtns.forEach((b, j) => b.classList.toggle("active", j === i));
      });
      srcBtns.push(btn);
      autoRow.appendChild(btn);
    });

    const btnAuto = document.createElement("button");
    btnAuto.className = "import-btn";
    btnAuto.textContent = "⏺ Auto";
    btnAuto.title = "Auto-capture continuously";
    btnAuto.style.marginLeft = "6px";
    btnAuto.classList.toggle("active", !!ps.get("buffer.auto").value);
    btnAuto.addEventListener("click", () => {
      ps.toggle("buffer.auto");
      btnAuto.classList.toggle("active", !!ps.get("buffer.auto").value);
    });
    autoRow.appendChild(btnAuto);

    const rateInput = document.createElement("input");
    rateInput.type = "number";
    rateInput.min = "0.1";
    rateInput.max = "30";
    rateInput.step = "0.1";
    rateInput.value = ps.get("buffer.rate").value;
    rateInput.title = "Frames per second";
    rateInput.style.cssText =
      "width:40px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;";
    rateInput.addEventListener("input", () => {
      const v = parseFloat(rateInput.value);
      if (!isNaN(v)) ps.set("buffer.rate", v);
    });
    const fpsLbl = document.createElement("span");
    fpsLbl.textContent = "fps";
    fpsLbl.style.cssText = "font-size:11px;color:var(--text-2);";
    autoRow.appendChild(rateInput);
    autoRow.appendChild(fpsLbl);

    // ── Rows × Cols selector ─────────────────────────────────────────────
    const sizeRow = document.createElement("div");
    sizeRow.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:0 10px 6px;flex-wrap:wrap;";

    const sizeLabel = document.createElement("span");
    sizeLabel.textContent = "Grid:";
    sizeLabel.style.cssText =
      "font-size:11px;color:var(--text-2);min-width:36px;";
    sizeRow.appendChild(sizeLabel);

    ["buffer.rows", "buffer.cols"].forEach((paramId, pIdx) => {
      const lbl = document.createElement("span");
      lbl.textContent = pIdx === 0 ? "R" : "C";
      lbl.style.cssText = "font-size:11px;color:var(--text-2);";
      sizeRow.appendChild(lbl);

      const inp = document.createElement("input");
      inp.type = "number";
      inp.min = "1";
      inp.max = "8";
      inp.step = "1";
      inp.value = ps.get(paramId).value;
      inp.style.cssText =
        "width:36px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;";
      inp.addEventListener("input", () => {
        const v = parseInt(inp.value, 10);
        if (!isNaN(v)) ps.set(paramId, v);
      });
      ps.get(paramId).onChange((v) => {
        inp.value = Math.round(v);
      });
      sizeRow.appendChild(inp);
    });

    const slotsLbl = document.createElement("span");
    slotsLbl.style.cssText = "font-size:11px;color:var(--text-2);";
    function _updateSlotsLabel() {
      const r = Math.round(ps.get("buffer.rows").value);
      const c = Math.round(ps.get("buffer.cols").value);
      slotsLbl.textContent = `= ${r * c} slots`;
    }
    _updateSlotsLabel();
    ps.get("buffer.rows").onChange(_updateSlotsLabel);
    ps.get("buffer.cols").onChange(_updateSlotsLabel);
    sizeRow.appendChild(slotsLbl);

    // ── Scan controls ────────────────────────────────────────────────────
    const scanRow = document.createElement("div");
    scanRow.style.cssText =
      "display:flex;align-items:center;gap:6px;padding:0 10px 4px;flex-wrap:wrap;";

    const scanParam = ps.get("buffer.scan");
    const btnScan = document.createElement("button");
    btnScan.className = "import-btn";
    btnScan.textContent = "▶ Scan";
    btnScan.classList.toggle("active", !!scanParam.value);
    btnScan.addEventListener("click", () => {
      ps.toggle("buffer.scan");
      btnScan.classList.toggle("active", !!ps.get("buffer.scan").value);
    });
    scanRow.appendChild(btnScan);

    const scanDirParam = ps.get("buffer.scandir");
    scanDirParam.options.forEach((opt, i) => {
      const btn = document.createElement("button");
      btn.className = "source-btn";
      btn.textContent = opt;
      btn.classList.toggle("active", i === scanDirParam.value);
      btn.addEventListener("click", () => {
        scanDirParam.value = i;
        scanRow
          .querySelectorAll(".source-btn")
          .forEach((b, j) => b.classList.toggle("active", j === i));
      });
      scanRow.appendChild(btn);
    });

    const scanRateInput = document.createElement("input");
    scanRateInput.type = "number";
    scanRateInput.min = "0.1";
    scanRateInput.max = "60";
    scanRateInput.step = "0.5";
    scanRateInput.value = ps.get("buffer.scanrate").value;
    scanRateInput.title = "Scan rate (fps)";
    scanRateInput.style.cssText =
      "width:40px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;";
    scanRateInput.addEventListener("input", () => {
      const v = parseFloat(scanRateInput.value);
      if (!isNaN(v)) ps.set("buffer.scanrate", v);
    });
    const scanFpsLbl = document.createElement("span");
    scanFpsLbl.textContent = "fps";
    scanFpsLbl.style.cssText = "font-size:11px;color:var(--text-2);";
    scanRow.appendChild(scanRateInput);
    scanRow.appendChild(scanFpsLbl);

    // BG freeze buttons
    const bgRow = document.createElement("div");
    bgRow.style.cssText = "display:flex;gap:6px;padding:0 10px 8px;";
    [
      ["Freeze BG1", "screen.bg1"],
      ["Freeze BG2", "screen.bg2"],
    ].forEach(([label, id]) => {
      const btn = document.createElement("button");
      btn.className = "import-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => ps.trigger(id));
      bgRow.appendChild(btn);
    });

    // Insert before the canvas
    bufferSection.insertBefore(bgRow, bufferCanvas ?? null);
    bufferSection.insertBefore(scanRow, bufferCanvas ?? null);
    bufferSection.insertBefore(sizeRow, bufferCanvas ?? null);
    bufferSection.insertBefore(autoRow, bufferCanvas ?? null);
    bufferSection.insertBefore(capRow, bufferCanvas ?? null);
  }

  // Click to select frame
  bufferCanvas?.addEventListener("click", (e) => {
    const rect = bufferCanvas.getBoundingClientRect();
    const { cols, cw, ch } = gridLayout();
    const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (e.clientY - rect.top) * (bufferCanvas.height / rect.height);
    const idx = Math.floor(my / ch) * cols + Math.floor(mx / cw);
    if (idx >= 0 && idx < stillsBuffer.frameCount) {
      ps.set("buffer.fs1", idx);
      refreshBufferGrid();
    }
  });

  // Right-click on buffer cell → protect/PNG menu
  bufferCanvas?.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const rect = bufferCanvas.getBoundingClientRect();
    const { cols, cw, ch } = gridLayout();
    const mx = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my = (e.clientY - rect.top) * (bufferCanvas.height / rect.height);
    const idx = Math.floor(my / ch) * cols + Math.floor(mx / cw);
    if (idx >= 0 && idx < stillsBuffer.frameCount) {
      // Show small context menu for this slot
      _showBufferSlotMenu(idx, e.clientX, e.clientY);
    }
  });

  // ── Buffer slot context menu (protect / save PNG) ─────────────────────────
  const _bufSlotMenu = document.createElement("div");
  _bufSlotMenu.className = "context-menu hidden";
  _bufSlotMenu.style.cssText = "min-width:130px;";
  document.body.appendChild(_bufSlotMenu);
  let _bufSlotMenuIdx = -1;

  function _saveBufSlotPNG(idx) {
    if (!stillsBuffer._hasFrame[idx]) return;
    const rt = stillsBuffer.frames[idx];
    const w = rt.width;
    const h = rt.height;
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    const tmpCanvas = document.createElement("canvas");
    tmpCanvas.width = w;
    tmpCanvas.height = h;
    const tmpCtx = tmpCanvas.getContext("2d");
    const imgData = tmpCtx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const srcRow = (h - 1 - row) * w * 4;
      imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), row * w * 4);
    }
    tmpCtx.putImageData(imgData, 0, 0);
    tmpCanvas.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `imweb-frame-${idx}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  }

  function _showBufferSlotMenu(idx, x, y) {
    _bufSlotMenuIdx = idx;
    _bufSlotMenu.innerHTML = "";

    const header = document.createElement("div");
    header.className = "menu-header";
    header.textContent = `Slot ${idx}`;
    _bufSlotMenu.appendChild(header);

    // Protect/unprotect
    const protBtn = document.createElement("button");
    protBtn.className = "menu-item";
    protBtn.textContent = stillsBuffer.isProtected(idx)
      ? "🔓 Unprotect slot"
      : "🔒 Protect slot";
    protBtn.addEventListener("click", () => {
      stillsBuffer.toggleProtect(idx);
      refreshBufferGrid();
      _bufSlotMenu.classList.add("hidden");
    });
    _bufSlotMenu.appendChild(protBtn);

    // Save PNG (only if frame has content)
    if (stillsBuffer._hasFrame[idx]) {
      const pngBtn = document.createElement("button");
      pngBtn.className = "menu-item";
      pngBtn.textContent = "↓ Save as PNG";
      pngBtn.addEventListener("click", () => {
        _saveBufSlotPNG(idx);
        _bufSlotMenu.classList.add("hidden");
      });
      _bufSlotMenu.appendChild(pngBtn);
    }

    // Live source sub-menu
    const liveDiv = document.createElement("div");
    liveDiv.className = "menu-separator";
    _bufSlotMenu.appendChild(liveDiv);
    const liveHeader = document.createElement("div");
    liveHeader.className = "menu-header";
    liveHeader.style.fontSize = "9px";
    liveHeader.style.color = "var(--accent)";
    liveHeader.textContent = "INSERT VIDEO TO BUFFER (LIVE)";
    _bufSlotMenu.appendChild(liveHeader);
    const currentLive = liveSlots.get(idx);
    const liveSrcs = [
      { key: "camera", label: "📷 Insert Camera" },
      { key: "movie", label: "🎬 Insert Movie" },
      { key: "screen", label: "🖥 Insert Screen" },
      { key: "fg", label: "▲ Insert FG layer" },
    ];
    liveSrcs.forEach(({ key, label }) => {
      const btn = document.createElement("button");
      btn.className = "menu-item" + (currentLive === key ? " active" : "");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        liveSlots.set(idx, key);
        stillsBuffer._protected.add(idx); // protect from overwrite by auto-capture
        refreshBufferGrid();
        _bufSlotMenu.classList.add("hidden");
      });
      _bufSlotMenu.appendChild(btn);
    });
    if (currentLive) {
      const clearBtn = document.createElement("button");
      clearBtn.className = "menu-item";
      clearBtn.textContent = "⏹ Remove live feed";
      clearBtn.addEventListener("click", () => {
        liveSlots.delete(idx);
        refreshBufferGrid();
        _bufSlotMenu.classList.add("hidden");
      });
      _bufSlotMenu.appendChild(clearBtn);
    }

    _bufSlotMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    _bufSlotMenu.style.top = `${Math.min(y, window.innerHeight - 140)}px`;
    _bufSlotMenu.classList.remove("hidden");

    setTimeout(
      () =>
        document.addEventListener("click", _hideBufSlotMenu, { once: true }),
      0,
    );
  }

  function _hideBufSlotMenu() {
    _bufSlotMenu.classList.add("hidden");
  }

  ps.get("buffer.fs1").onChange(refreshBufferGrid);
  rebuildBufferGrid();

  // ── Live GLSL Editor ──────────────────────────────────────────────────────

  const glslEditorHost = document.getElementById("glsl-editor");
  const glslError = document.getElementById("glsl-error");
  const glslApply = document.getElementById("btn-glsl-apply");
  const glslReset = document.getElementById("btn-glsl-reset");
  const glslAuto = document.getElementById("glsl-auto-apply");

  // Default doc (moved here from the old <textarea> markup)
  const GLSL_DEFAULT_DOC = `// VJ uniform contract (auto-declared — just use them):
//   varying vec2 vUv        — 0..1 UV coords
//   sampler2D uTexture      — input at the routed insert point
//   sampler2D tAudio        — 256x2: y<0.5 FFT bins, y>0.5 waveform; .r = 0..1
//   sampler2D tPrev         — previous output frame (feedback/trails)
//   vec2  uResolution       — canvas size in px
//   float uTime             — seconds
//   float uBPM              — detected tempo (0 = unknown; enable Sound)
//   float uBeat             — beat phase 0..1 (0 = on the beat)
//   float uLevel/uBass/uMid/uHigh — audio levels 0..1
//   float uParam1..uParam4  — performance knobs (bind any controller below)

void main() {
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = col;
}`;

  // Explicit dark highlight style — defaultHighlightStyle is tuned for
  // light backgrounds and rendered unreadably on the #0a0a0e editor.
  const glslHighlight = HighlightStyle.define([
    { tag: hlTags.keyword, color: "#c586c0" },
    { tag: [hlTags.typeName, hlTags.standard(hlTags.typeName)], color: "#4ec9b0" },
    { tag: hlTags.number, color: "#b5cea8" },
    { tag: hlTags.comment, color: "#6a9955", fontStyle: "italic" },
    { tag: hlTags.string, color: "#ce9178" },
    { tag: [hlTags.operator, hlTags.punctuation], color: "#d4d4d4" },
    { tag: hlTags.variableName, color: "#9cdcfe" },
    { tag: hlTags.definition(hlTags.variableName), color: "#9cdcfe" },
    { tag: hlTags.function(hlTags.variableName), color: "#dcdcaa" },
    { tag: hlTags.processingInstruction, color: "#c586c0" },
  ]);

  // CodeMirror 6 editor — replaces the old <textarea> (iPad-friendly)
  const glslTheme = EditorView.theme(
    {
      // Fill the host div — its inline height + resize:vertical handle
      // (index.html) let the user drag the editor taller/shorter.
      "&": {
        backgroundColor: "#0a0a0e",
        color: "#c8c8d8",
        fontSize: "11px",
        height: "100%",
      },
      ".cm-scroller": { fontFamily: "monospace", overflow: "auto" },
      "&.cm-focused": { outline: "none" },
      ".cm-gutters": {
        backgroundColor: "var(--bg-2)",
        color: "var(--text-2)",
        border: "none",
      },
      ".cm-activeLine": { backgroundColor: "rgba(200,160,32,0.06)" },
      ".cm-activeLineGutter": { backgroundColor: "rgba(200,160,32,0.10)" },
      ".cm-cursor": { borderLeftColor: "var(--accent)" },
    },
    { dark: true },
  );

  const glslView = glslEditorHost
    ? new EditorView({
        doc: GLSL_DEFAULT_DOC,
        parent: glslEditorHost,
        extensions: [
          // Custom keymap first — earlier extensions win, and basicSetup's
          // default keymap also binds Mod-Enter (insertBlankLine).
          keymap.of([
            indentWithTab,
            { key: "Mod-Enter", run: () => (applyGLSL(), true) },
          ]),
          basicSetup,
          cpp(),
          syntaxHighlighting(glslHighlight),
          glslTheme,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && glslAuto?.checked) applyGLSL();
          }),
        ],
      })
    : null;

  const getGlslSource = () => (glslView ? glslView.state.doc.toString() : "");
  const setGlslSource = (text) =>
    glslView?.dispatch({
      changes: { from: 0, to: glslView.state.doc.length, insert: text },
    });

  // ── GLSL routing target + param uniform slots (uParam1..uParam4) ──────────
  const uniformsEl = document.getElementById("glsl-uniforms");
  if (uniformsEl) {
    ["glsl.target", "glsl.param1", "glsl.param2", "glsl.param3", "glsl.param4"].forEach(
      (id) => {
        const p = ps.get(id);
        if (p) uniformsEl.appendChild(buildParamRow(p, contextMenu));
      },
    );
  }

  // Build the standardized VJ uniform header for a shader source —
  // declarations already present in the source are skipped. Probes are
  // regexes tolerant of extra whitespace and precision qualifiers
  // (lowp/mediump/highp), so pasted ShaderToy-style declarations don't
  // end up duplicated. Comments are stripped before probing so a
  // commented-out declaration can't suppress the injection.
  function buildGlslHeader(src) {
    const code = src.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const u = (type, name) =>
      new RegExp(
        `uniform\\s+(?:lowp\\s+|mediump\\s+|highp\\s+)?${type}\\s+${name}\\b`,
      );
    return [
      [/varying\s+(?:lowp\s+|mediump\s+|highp\s+)?vec2\s+vUv\b/, "varying vec2 vUv;"],
      [u("sampler2D", "uTexture"), "uniform sampler2D uTexture;"],
      [u("sampler2D", "tAudio"), "uniform sampler2D tAudio;"],
      [u("sampler2D", "tPrev"), "uniform sampler2D tPrev;"],
      [u("vec2", "uResolution"), "uniform vec2 uResolution;"],
      [u("float", "uTime"), "uniform float uTime;"],
      [u("float", "uBPM"), "uniform float uBPM;"],
      [u("float", "uBeat"), "uniform float uBeat;"],
      [u("float", "uLevel"), "uniform float uLevel;"],
      [u("float", "uBass"), "uniform float uBass;"],
      [u("float", "uMid"), "uniform float uMid;"],
      [u("float", "uHigh"), "uniform float uHigh;"],
      [u("float", "uParam1"), "uniform float uParam1;"],
      [u("float", "uParam2"), "uniform float uParam2;"],
      [u("float", "uParam3"), "uniform float uParam3;"],
      [u("float", "uParam4"), "uniform float uParam4;"],
    ]
      .map(([probe, decl]) => (probe.test(code) ? "" : decl))
      .filter(Boolean)
      .join("\n");
  }

  function applyGLSL() {
    const src = getGlslSource();
    if (!src) return;
    const header = buildGlslHeader(src);
    const fullSrc = header ? `${header}\n${src}` : src;
    const err = pipeline.setCustomShader(fullSrc);
    if (glslError) {
      glslError.style.display = err ? "block" : "none";
      glslError.textContent = err
        ? pipeline._customActive
          ? `${err} — previous shader still running`
          : err
        : "";
    }
  }

  glslApply?.addEventListener("click", applyGLSL);

  glslReset?.addEventListener("click", () => {
    pipeline.disableCustomShader();
    if (glslError) glslError.style.display = "none";
    if (glslAuto) glslAuto.checked = false;
  });

  // Tab / Ctrl+Enter / auto-apply are handled by CodeMirror extensions
  // (indentWithTab, Mod-Enter keymap, updateListener) — see glslView above.

  // ── Project persistence hook (.imweb `glsl` key) ──────────────────────────
  projectFile.extras.glsl = {
    capture: () => ({
      source: getGlslSource(),
      autoApply: !!glslAuto?.checked,
      active: !!pipeline._customActive,
    }),
    restore: (d) => {
      if (typeof d.source === "string") setGlslSource(d.source);
      if (glslAuto) glslAuto.checked = !!d.autoApply;
      if (d.active && d.source) applyGLSL();
      else if (!d.active) pipeline.disableCustomShader();
    },
  };
  // First-launch MasterProject import runs before this hook registers
  if (projectFile.pendingGlsl) {
    projectFile.extras.glsl.restore(projectFile.pendingGlsl);
    projectFile.pendingGlsl = null;
  }

  // Built-in GLSL shader presets
  // Per-preset parameter label metadata — 4 labels matching uParam1..4 slots.
  // Presets not listed here show generic uParam1–4 labels.
  const GLSL_PRESET_META = {
    Reef: ["Speed ×2", "WaveAmp ×0.8", "Density ×2", "ColorShift ×2π"],
    Tunnel: ["Speed (-1..+1)", "Dir X", "Zoom (1–8×)", "Width"],
    "Audio React": ["Bass Zoom", "Beat Flash", "FFT Bars", "Trails"],
  };

  const GLSL_PARAM_DEFAULT_LABELS = [
    "uParam1",
    "uParam2",
    "uParam3",
    "uParam4",
  ];

  // Accepts a preset name (META lookup) or a labels array (AI-generated)
  function _updateGlslParamLabels(presetName) {
    const labels = Array.isArray(presetName)
      ? [...presetName, ...GLSL_PARAM_DEFAULT_LABELS].slice(0, 4)
      : (GLSL_PRESET_META[presetName] ?? GLSL_PARAM_DEFAULT_LABELS);
    labels.forEach((lbl, i) => {
      const el = uniformsEl?.querySelector(
        `[data-param-id="glsl.param${i + 1}"] .param-label`,
      );
      if (el) el.textContent = lbl;
    });
  }

  const GLSL_PRESETS = {
    Passthrough: `void main() {
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = col;
}`,
    Invert: `void main() {
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = vec4(1.0 - col.rgb, col.a);
}`,
    "Hue Cycle": `void main() {
  vec4 col = texture2D(uTexture, vUv);
  // RGB → HSV rotation
  float r=col.r,g=col.g,b=col.b;
  float ma=max(r,max(g,b)), mi=min(r,min(g,b)), d=ma-mi;
  float h=0.0;
  if(d>0.0){
    if(ma==r) h=mod((g-b)/d,6.0);
    else if(ma==g) h=(b-r)/d+2.0;
    else h=(r-g)/d+4.0;
    h/=6.0;
  }
  h=mod(h+uTime*0.1,1.0);
  float s=ma>0.0?d/ma:0.0, v=ma;
  // HSV → RGB
  float C=v*s, X=C*(1.0-abs(mod(h*6.0,2.0)-1.0)), m=v-C;
  vec3 rgb;
  float hi=floor(h*6.0);
  if(hi<1.0) rgb=vec3(C,X,0);
  else if(hi<2.0) rgb=vec3(X,C,0);
  else if(hi<3.0) rgb=vec3(0,C,X);
  else if(hi<4.0) rgb=vec3(0,X,C);
  else if(hi<5.0) rgb=vec3(X,0,C);
  else rgb=vec3(C,0,X);
  gl_FragColor=vec4(rgb+m,col.a);
}`,
    Ripple: `void main() {
  vec2 uv = vUv;
  float d = length(uv - 0.5);
  uv.y += sin(d * 40.0 - uTime * 5.0) * 0.015;
  uv.x += cos(d * 40.0 - uTime * 5.0) * 0.015;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    Tunnel: `// uParam1=Speed(-1..+1, 0.5=stop)  uParam2=DirX  uParam3=Zoom(1-8x)  uParam4=Width
void main() {
  float spd   = uParam1 * 2.0 - 1.0;               // -1..+1 travel speed
  float width = 0.05 + uParam4 * 0.55;             // tube tightness / depth scale
  float zoom  = 1.0 + uParam3 * 7.0;               // texture tiling: 1-8x around tube
  float dscale = 0.05 + uParam3 * 0.45;            // depth tiling follows zoom
  vec2  dir   = vec2(uParam2 - 0.5, 0.0) * 0.3;   // horizontal look offset

  vec2 uv = vUv - 0.5 - dir;
  float a = atan(uv.y, uv.x);
  float r = max(length(uv), 0.0001);
  float depth = width / r;                          // depth into tunnel

  // Tube UV: zoom-controlled tiling around circumference + scaled depth
  vec2 tuv = vec2(
    a / 6.2832 * zoom + depth * 0.08 + sin(uTime * 0.25) * 0.04,
    depth * dscale - uTime * spd * 0.1
  );
  vec4 col = texture2D(uTexture, fract(tuv));

  // Vignette: circular tube wall — sharp cutoff at r=0.48
  float vign = smoothstep(0.48, 0.20, r);
  // Depth atmosphere: gentler fade, full texture brightness preserved
  float atmo = 1.0 / (1.0 + depth * 0.06);
  col.rgb *= vign * atmo;

  gl_FragColor = col;
}`,
    "Luma Displace": `void main() {
  vec4 c = texture2D(uTexture, vUv);
  float l = dot(c.rgb, vec3(0.299,0.587,0.114));
  vec2 uv = vUv + vec2(cos(l*20.0+uTime),sin(l*20.0+uTime))*0.01;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    "Glitch Bands": `float hash(float n){ return fract(sin(n)*43758.5453123); }
void main() {
  vec2 uv = vUv;
  float t = floor(uTime * 8.0);
  float band = floor(uv.y * 24.0);
  float r = hash(band + t * 71.3);
  if(r > 0.92) uv.x += (hash(band*3.7+t)-0.5)*0.15;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    "RGB Split": `void main() {
  float a = uTime * 0.5;
  vec2 off = vec2(cos(a),sin(a)) * 0.015;
  float r = texture2D(uTexture, vUv + off).r;
  float g = texture2D(uTexture, vUv).g;
  float b = texture2D(uTexture, vUv - off).b;
  gl_FragColor = vec4(r,g,b,1.0);
}`,
    Mosaic: `void main() {
  vec2 sz = vec2(32.0, 18.0);
  vec2 uv = floor(vUv * sz) / sz;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    "Old TV": `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
void main() {
  vec2 uv = vUv;
  // Barrel distortion
  vec2 d = uv - 0.5;
  uv = 0.5 + d * (1.0 + dot(d,d)*0.15);
  // Scanlines
  float scan = sin(uv.y * 400.0) * 0.04;
  // Noise
  float n = (hash(uv + fract(uTime*0.017)) - 0.5)*0.06;
  vec4 col = texture2D(uTexture, uv);
  col.rgb = col.rgb * (1.0 - scan) + n;
  col.rgb = mix(col.rgb, vec3(dot(col.rgb,vec3(0.3,0.6,0.1))), 0.4);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0) col=vec4(0);
  gl_FragColor = col;
}`,
    Reef: `// uParam1=Speed(x2)  uParam2=WaveAmp(x0.8)  uParam3=Density(x2)  uParam4=ColorShift(x2pi)
uniform vec2 uResolution;
void main() {
  float t       = uTime   * uParam1 * 2.0;
  float waveAmp = uParam2 * 0.8;
  float density = uParam3 * 2.0;
  float colorSh = uParam4 * 6.2832;

  float aspect = uResolution.x / uResolution.y;
  vec2 uv = (vUv * 2.0 - 1.0) * vec2(aspect, 1.0);
  vec3 ray = normalize(vec3(uv, -aspect));

  vec3 o = vec3(0.0);
  float z = 0.0, dist = 0.0;
  vec3 p = vec3(0.0);

  // Flattened 20×9 — range checks instead of float equality (mod() precision fix)
  for (float step = 0.0; step < 180.0; step += 1.0) {
    float i = floor(step / 9.0);
    float w = mod(step, 9.0) + 1.0;
    if (w < 1.5) p = z * ray;                                 // outer reset (w≈1)
    p += waveAmp * sin(vec3(p.y, p.z, p.x) * w + vec3(-z + t + i)) / w + vec3(0.5);
    if (w > 8.5) {                                             // outer accumulate (w≈9)
      vec3 sp  = sin(p - vec3(z)) / 7.0;
      dist = length(vec4(abs(p.y + p.z * 0.5), sp.x, sp.y, sp.z)) / (4.0 + z * z / 100.0);
      z += dist;
      float denom = max(dist * dist * z, 0.001);
      vec3 base = vec3(0.9) + sin(vec3(i * 0.1 + colorSh) - vec3(6.0, 1.0, 2.0));
      o += base / denom * density + vec3(dist * z) / vec3(4.0, 2.0, 1.0);
    }
  }

  vec3 c = max(o, 0.0);
  gl_FragColor = vec4(c / (c + 50.0), 1.0);
}`,
    "Audio React": `// Needs Sound enabled (Ctrl panel) — demonstrates the VJ contract
void main() {
  // bass-driven zoom pump
  vec2 c = (vUv - 0.5) / (1.0 + uBass * 0.2 * uParam1) + 0.5;
  vec4 col = texture2D(uTexture, c);

  // FFT bars along the bottom edge
  float fft = texture2D(tAudio, vec2(vUv.x, 0.25)).r;
  float bars = step(vUv.y, fft * 0.3) * uParam3;

  // flash decaying over each beat
  float flash = (1.0 - uBeat) * (uBPM > 0.0 ? 1.0 : 0.0) * uParam2;

  vec3 rgb = col.rgb
    + flash * vec3(0.9, 0.7, 0.2)
    + bars * vec3(0.2, 0.9, 0.4);

  // feedback trails from the previous frame
  vec3 prev = texture2D(tPrev, vUv).rgb;
  rgb = mix(rgb, max(rgb, prev * 0.955), uParam4);

  gl_FragColor = vec4(rgb, col.a);
}`,
  };

  const glslPresetSel = document.createElement("select");
  // min-width:0 lets flex shrink the select below its content width —
  // without it the New/Save/Delete buttons get pushed past the panel edge
  glslPresetSel.style.cssText =
    "font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;flex:1;min-width:0;";
  // Hidden 'Custom' entry — selected when the editor holds unsaved/blank/
  // AI-generated code that matches no preset
  const glslCustomOpt = document.createElement("option");
  glslCustomOpt.value = "__custom";
  glslCustomOpt.textContent = "Custom";
  glslCustomOpt.disabled = true;
  glslCustomOpt.hidden = true;
  glslPresetSel.appendChild(glslCustomOpt);
  Object.keys(GLSL_PRESETS).forEach((name) => {
    const o = document.createElement("option");
    o.value = name;
    o.textContent = name;
    glslPresetSel.appendChild(o);
  });
  glslPresetSel.value = "Passthrough";

  // User shader presets — localStorage, appended after built-ins.
  // Option values are prefixed "user:" so they can never shadow a built-in.
  const GLSL_USER_KEY = "imweb.glslUserPresets";
  const _loadUserGlsl = () => {
    try {
      return JSON.parse(localStorage.getItem(GLSL_USER_KEY) ?? "{}");
    } catch {
      return {};
    }
  };
  // glsl.preset param mirror — flat ordered list of dropdown option values
  // (built-ins then "user:"-prefixed, __custom excluded) so the SELECT index
  // maps 1:1 onto the dropdown. Kept in sync wherever the dropdown is rebuilt.
  const glslPresetParam = ps.get("glsl.preset");
  let glslPresetIndex = [];
  function _syncGlslPresetParam() {
    glslPresetIndex = [
      ...Object.keys(GLSL_PRESETS),
      ...Object.keys(_loadUserGlsl()).map((n) => `user:${n}`),
    ];
    if (!glslPresetParam) return;
    glslPresetParam.options = glslPresetIndex.map((v) =>
      v.startsWith("user:") ? v.slice(5) : v,
    );
    // Re-run the setter so a value beyond the shrunk list re-clamps
    glslPresetParam.value = glslPresetParam.value;
  }

  let _glslUserGroup = null;
  function _rebuildUserGlslOptions() {
    _syncGlslPresetParam();
    _glslUserGroup?.remove();
    _glslUserGroup = null;
    const names = Object.keys(_loadUserGlsl());
    if (!names.length) return;
    _glslUserGroup = document.createElement("optgroup");
    _glslUserGroup.label = "— User —";
    names.forEach((n) => {
      const o = document.createElement("option");
      o.value = `user:${n}`;
      o.textContent = n;
      _glslUserGroup.appendChild(o);
    });
    glslPresetSel.appendChild(_glslUserGroup);
  }
  _rebuildUserGlslOptions();

  glslPresetSel.addEventListener("change", () => {
    const v = glslPresetSel.value;
    const code = v.startsWith("user:")
      ? _loadUserGlsl()[v.slice(5)]
      : GLSL_PRESETS[v];
    if (code) {
      setGlslSource(code);
      if (glslAuto?.checked) applyGLSL();
    }
    _updateGlslParamLabels(v);
    // Mirror into glsl.preset so badge/controller state stays consistent.
    // __custom → -1 → skipped; equal values are a no-op in the param setter,
    // so the param→dropdown→param round trip can't loop.
    const idx = glslPresetIndex.indexOf(v);
    if (idx >= 0) ps.set("glsl.preset", idx);
  });

  // Controller-driven preset recall (MIDI CC/Note, LFO, Random, OSC…).
  // Reuses the manual dropdown path via a synthetic change event, then
  // compiles unconditionally — a performance recall that silently doesn't
  // take effect would read as broken. (Manual path keeps its Auto gate;
  // Auto ON means applyGLSL runs twice here, a harmless recompile.)
  glslPresetParam?.onChange((v) => {
    const name = glslPresetIndex[Math.round(v)];
    if (!name || glslPresetSel.value === name) return; // dropdown-originated set
    glslPresetSel.value = name;
    glslPresetSel.dispatchEvent(new Event("change"));
    applyGLSL();
  });

  // Apply labels for the initially-selected preset
  _updateGlslParamLabels(glslPresetSel.value);

  // Insert preset selector above the apply buttons
  const glslTab = document.getElementById("tab-glsl");
  const glslSection = glslTab?.querySelector(".panel-section");
  if (glslSection) {
    const selRow = document.createElement("div");
    selRow.style.cssText =
      "display:flex;gap:4px;padding:4px 8px 0;align-items:center;";
    const lbl = document.createElement("span");
    lbl.textContent = "Preset:";
    lbl.style.cssText =
      "font-size:11px;color:var(--text-2);white-space:nowrap;";
    // Row-level assignment menu (badge popover can only EDIT a controller,
    // not change/remove its type — same split as ParamRow's row contextmenu)
    if (ps.get("glsl.preset")) {
      lbl.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        contextMenu?.show(ps.get("glsl.preset"), e.clientX, e.clientY);
      });
    }
    selRow.appendChild(lbl);

    // Controller badge for glsl.preset — same interaction grammar as the
    // ParamRow badge: right-click / ctrl+click / touch long-press. With no
    // controller it opens the assignment context menu; with one assigned it
    // opens the settings popover.
    if (glslPresetParam) {
      const glslCtrlBadge = document.createElement("span");
      glslCtrlBadge.style.flex = "0 0 auto";
      const _refreshGlslBadge = () => {
        glslCtrlBadge.className = `param-ctrl ${glslPresetParam.controllerClass}`;
        glslCtrlBadge.textContent = glslPresetParam.controllerLabel;
      };
      const _openGlslBadgeMenu = (x, y) => {
        if (glslPresetParam.controller)
          openCtrlPopover(
            glslPresetParam,
            glslCtrlBadge,
            contextMenu?.ctrl,
            contextMenu?.tables,
          );
        else contextMenu?.show(glslPresetParam, x, y);
      };
      glslCtrlBadge.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        _openGlslBadgeMenu(e.clientX, e.clientY);
      });
      glslCtrlBadge.addEventListener("click", (e) => {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        e.stopPropagation();
        _openGlslBadgeMenu(e.clientX, e.clientY);
      });
      let _glslBadgeLp = null;
      glslCtrlBadge.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch") return;
        const { clientX: x, clientY: y } = e;
        _glslBadgeLp = setTimeout(() => _openGlslBadgeMenu(x, y), LONG_PRESS_MS);
      });
      ["pointerup", "pointercancel", "pointermove"].forEach((ev) =>
        glslCtrlBadge.addEventListener(ev, () => clearTimeout(_glslBadgeLp)),
      );
      // Value writes AND ContextMenu's post-assign notify() land here,
      // keeping the badge label/class current (same channel ParamRow uses)
      glslPresetParam.onChange(_refreshGlslBadge);
      _refreshGlslBadge();
      selRow.appendChild(glslCtrlBadge);

      // Min / Max recall-range fields — clamp the controller sweep to an
      // index sub-range of the preset list (ctrlMin/ctrlMax, same contract
      // and drag/dblclick grammar as ParamRow range fields; persisted via
      // serializeControllers). Tooltip shows the preset name at the index.
      const _mkGlslRange = (which) => {
        const p = glslPresetParam;
        const el = document.createElement("span");
        el.className = "param-range";
        el.style.cssText =
          "cursor:ns-resize;user-select:none;font-size:10px;flex:0 0 auto;";
        const last = () => (p.options?.length ?? 1) - 1;
        const cur = () =>
          which === "min"
            ? Math.round(p.ctrlMin ?? 0)
            : Math.round(p.ctrlMax ?? last());
        const refresh = () => {
          el.textContent = cur();
          el.title = `Recall ${which}: ${p.options?.[Math.min(cur(), last())] ?? ""}`;
          el.classList.toggle(
            "overridden",
            (which === "min" ? p.ctrlMin : p.ctrlMax) !== null,
          );
        };
        const commit = (v) => {
          if (isNaN(v)) return refresh();
          v = Math.max(0, Math.min(last(), Math.round(v)));
          const other =
            which === "min"
              ? Math.round(p.ctrlMax ?? last())
              : Math.round(p.ctrlMin ?? 0);
          if (which === "min") p.ctrlMin = Math.min(v, other);
          else p.ctrlMax = Math.max(v, other);
          refresh();
        };
        let _startY = 0, _startVal = 0, _startRaw = null, _pid = null;
        el.addEventListener("pointerdown", (e) => {
          if (e.button !== 0) return;
          el.setPointerCapture(e.pointerId);
          _pid = e.pointerId;
          _startY = e.clientY;
          _startVal = cur();
          _startRaw = which === "min" ? p.ctrlMin : p.ctrlMax; // null = unset
          e.preventDefault();
          e.stopPropagation();
        });
        el.addEventListener("pointermove", (e) => {
          if (!el.hasPointerCapture(e.pointerId)) return;
          // ~10px per index; Shift = 1px per index for fast sweeps
          const step = e.shiftKey ? 1 : 0.1;
          commit(_startVal + (_startY - e.clientY) * step);
        });
        el.addEventListener("pointerup", () => { _pid = null; });
        el.addEventListener("pointercancel", (e) => {
          if (_pid !== e.pointerId) return;
          _pid = null;
          if (which === "min") p.ctrlMin = _startRaw;
          else p.ctrlMax = _startRaw;
          refresh();
        });
        el.addEventListener("dblclick", (e) => {
          e.stopPropagation();
          e.preventDefault();
          const input = document.createElement("input");
          input.type = "text";
          input.inputMode = "numeric";
          input.value = cur();
          input.style.cssText =
            "width:32px;font:inherit;font-size:inherit;background:#1f1f25;color:#e0e0f0;border:1px solid #c8a020;border-radius:3px;padding:1px 4px;outline:none;";
          el.innerHTML = "";
          el.appendChild(input);
          input.addEventListener("pointerdown", (e2) => e2.stopPropagation());
          input.focus();
          input.select();
          input.addEventListener("blur", () => commit(parseFloat(input.value)));
          input.addEventListener("keydown", (e2) => {
            if (e2.key === "Enter") { commit(parseFloat(input.value)); e2.stopPropagation(); }
            if (e2.key === "Escape") { refresh(); e2.stopPropagation(); }
          });
        });
        // Options rebuilds change the list length — keep display clamped
        glslPresetParam.onChange(refresh);
        refresh();
        return el;
      };
      selRow.appendChild(_mkGlslRange("min"));
      selRow.appendChild(_mkGlslRange("max"));
    }

    selRow.appendChild(glslPresetSel);

    // Blank-slate boilerplate for the 📄 New button
    const GLSL_BLANK_DOC = `// uParams: uParam1 | uParam2 | uParam3 | uParam4

void main() {
  gl_FragColor = texture2D(uTexture, vUv);
}`;
    const glslNewBtn = document.createElement("button");
    glslNewBtn.className = "import-btn";
    glslNewBtn.textContent = "📄";
    glslNewBtn.title = "New blank shader";
    glslNewBtn.style.cssText = "min-width:32px;min-height:28px;";
    glslNewBtn.addEventListener("click", () => {
      setGlslSource(GLSL_BLANK_DOC);
      glslPresetSel.value = "__custom";
      // change handler resets knob labels + delete-button visibility
      glslPresetSel.dispatchEvent(new Event("change"));
    });
    selRow.appendChild(glslNewBtn);

    // Save current editor code as a recallable user preset
    const glslSaveBtn = document.createElement("button");
    glslSaveBtn.className = "import-btn";
    glslSaveBtn.textContent = "💾";
    glslSaveBtn.title = "Save current code as user preset";
    glslSaveBtn.addEventListener("click", () => {
      const src = getGlslSource();
      if (!src) return;
      const name = prompt("Preset name:");
      if (!name) return;
      const user = _loadUserGlsl();
      user[name] = src;
      localStorage.setItem(GLSL_USER_KEY, JSON.stringify(user));
      _rebuildUserGlslOptions();
      glslPresetSel.value = `user:${name}`;
      // Refills the editor with the identical just-saved source (harmless)
      // and keeps the delete button's visibility in sync.
      glslPresetSel.dispatchEvent(new Event("change"));
    });
    selRow.appendChild(glslSaveBtn);

    // Delete the selected user preset — only visible for '— User —' entries
    const glslDelBtn = document.createElement("button");
    glslDelBtn.className = "import-btn";
    glslDelBtn.textContent = "✕";
    glslDelBtn.title = "Delete selected user preset";
    glslDelBtn.style.cssText = "min-width:32px;min-height:28px;display:none;";
    glslDelBtn.addEventListener("click", () => {
      const v = glslPresetSel.value;
      if (!v.startsWith("user:")) return;
      const user = _loadUserGlsl();
      delete user[v.slice(5)];
      localStorage.setItem(GLSL_USER_KEY, JSON.stringify(user));
      _rebuildUserGlslOptions();
      glslPresetSel.value = "Passthrough";
      glslPresetSel.dispatchEvent(new Event("change"));
    });
    selRow.appendChild(glslDelBtn);

    const _updateGlslDelVis = () => {
      glslDelBtn.style.display = glslPresetSel.value.startsWith("user:")
        ? ""
        : "none";
    };
    glslPresetSel.addEventListener("change", _updateGlslDelVis);
    _updateGlslDelVis();
    glslSection.insertBefore(selRow, glslSection.querySelector("div"));

    // ── AI shader generation — button + modal (Phase 16) ───────────────────
    const aiRow = document.createElement("div");
    aiRow.style.cssText = "display:flex;gap:4px;padding:2px 8px 4px;";
    const aiBtn = document.createElement("button");
    aiBtn.id = "btn-glsl-ai";
    aiBtn.className = "import-btn";
    aiBtn.textContent = "✨ Prompt AI";
    aiBtn.style.cssText = "flex:1;min-height:32px;";
    aiRow.appendChild(aiBtn);
    if (uniformsEl) glslSection.insertBefore(aiRow, uniformsEl);
    else glslSection.appendChild(aiRow);

    const aiModal = document.createElement("div");
    aiModal.id = "glsl-ai-modal";
    aiModal.className = "hidden";
    aiModal.innerHTML = `
      <div id="glsl-ai-box">
        <div id="glsl-ai-title">✨ AI Shader</div>
        <textarea id="glsl-ai-prompt" placeholder="Describe the effect… e.g. 'kaleidoscope that pulses with the bass, trails on the beat'"></textarea>
        <div id="glsl-ai-status" class="hidden"></div>
        <div id="glsl-ai-actions">
          <button id="glsl-ai-cancel" class="import-btn">Cancel</button>
          <button id="glsl-ai-generate" class="import-btn">Generate</button>
        </div>
      </div>`;
    document.body.appendChild(aiModal);

    const aiPromptEl = aiModal.querySelector("#glsl-ai-prompt");
    const aiStatusEl = aiModal.querySelector("#glsl-ai-status");
    const aiGenBtn = aiModal.querySelector("#glsl-ai-generate");
    const aiCancelBtn = aiModal.querySelector("#glsl-ai-cancel");

    function _aiSetBusy(busy, msg) {
      aiPromptEl.classList.toggle("hidden", busy);
      aiGenBtn.disabled = busy;
      aiStatusEl.className = busy ? "busy" : "hidden";
      aiStatusEl.textContent = msg ?? "";
    }
    function _aiShowError(msg) {
      aiPromptEl.classList.remove("hidden");
      aiGenBtn.disabled = false;
      aiStatusEl.className = "error";
      aiStatusEl.textContent = msg;
    }
    function openAiModal() {
      _aiSetBusy(false, "");
      aiStatusEl.className = "hidden";
      aiModal.classList.remove("hidden");
      aiPromptEl.focus();
    }
    function closeAiModal() {
      aiModal.classList.add("hidden");
    }
    // '// uParams: A | B | C | D' metadata line → knob labels
    function _parseAiLabels(code) {
      const m = code.match(/^\s*\/\/\s*uParams:\s*(.+)$/m);
      if (!m) return null;
      const labels = m[1].split("|").map((s) => s.trim()).filter(Boolean);
      return labels.length ? labels.slice(0, 4) : null;
    }

    // Generate → validate (standalone compile) → ONE auto-retry with the
    // compiler error → inject. DEV hook __glslAIGenerate lets headless
    // tests stub the provider call.
    async function _runAiGeneration(promptText) {
      const gen =
        (import.meta.env.DEV && window.__glslAIGenerate) || generateShader;
      let code = await gen(promptText);
      let hdr = buildGlslHeader(code);
      let err = pipeline.validateShaderSource(hdr ? `${hdr}\n${code}` : code);
      if (err) {
        if (import.meta.env.DEV)
          console.log(`[glsl-ai] validation error (attempt 1):\n${err}`);
        _aiSetBusy(true, "Shader failed to compile — asking AI to fix it…");
        code = await gen(promptText, code, err);
        hdr = buildGlslHeader(code);
        err = pipeline.validateShaderSource(hdr ? `${hdr}\n${code}` : code);
        if (err && import.meta.env.DEV)
          console.log(`[glsl-ai] validation error (after retry):\n${err}`);
      }
      return { code, err };
    }

    aiGenBtn.addEventListener("click", async () => {
      const promptText = aiPromptEl.value.trim();
      if (!promptText) return;
      _aiSetBusy(true, "Generating shader…");
      try {
        const { code } = await _runAiGeneration(promptText);
        // Inject even if the retry still errors — the editor error panel
        // and last-good fallback handle it non-destructively.
        setGlslSource(code);
        glslPresetSel.value = "__custom"; // generated code is unsaved
        const labels = _parseAiLabels(code);
        if (labels) _updateGlslParamLabels(labels);
        closeAiModal();
        applyGLSL();
      } catch (e) {
        if (e?.message === "no-key") {
          _aiShowError(
            "No API key configured for the active AI provider.\n",
          );
          const fixBtn = document.createElement("button");
          fixBtn.className = "import-btn";
          fixBtn.textContent = "🔑 Open AI Settings";
          fixBtn.style.cssText = "margin-top:8px;min-height:40px;";
          fixBtn.addEventListener("click", (ev) => {
            // the panel has a document-level click-outside close
            ev.stopPropagation();
            closeAiModal();
            const aiPanel = document.getElementById("ai-settings-panel");
            aiPanel?.classList.remove("hidden");
            aiPanel?.querySelector(".ai-key-input")?.focus();
          });
          aiStatusEl.appendChild(fixBtn);
        } else {
          _aiShowError(`Generation failed: ${e?.message ?? e}`);
        }
      }
    });

    aiBtn.addEventListener("click", openAiModal);
    aiCancelBtn.addEventListener("click", closeAiModal);
    aiModal.addEventListener("click", (e) => {
      if (e.target === aiModal) closeAiModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !aiModal.classList.contains("hidden"))
        closeAiModal();
    });
  }

  // ── Record button ─────────────────────────────────────────────────────────

  let mediaRecorder = null;
  let recordChunks = [];

  document.getElementById("btn-record")?.addEventListener("click", async () => {
    const btn = document.getElementById("btn-record");
    if (!mediaRecorder) {
      const stream = canvas.captureStream(60);
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: "video/webm;codecs=vp9",
        videoBitsPerSecond: 8_000_000,
      });
      recordChunks = [];
      mediaRecorder.ondataavailable = (e) => recordChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordChunks, { type: "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `imweb-${Date.now()}.webm`;
        a.click();
        mediaRecorder = null;
      };
      mediaRecorder.start(100);
      btn.classList.add("recording");
      btn.textContent = "⏹";
    } else {
      mediaRecorder.stop();
      btn.classList.remove("recording");
      btn.textContent = "⏺";
    }
  });

  // ── Frame Capture (non-realtime export) ──────────────────────────────────
  let _captureMode = false;
  let _captureFrame = 0;
  let _captureRunning = false;

  const _capPanel = document.getElementById("capture-panel");
  const _capFrameLabel = document.getElementById("cap-frame-label");

  function _enterCaptureMode() {
    _captureMode = true;
    _captureFrame = 0;
    _capPanel?.classList.remove("hidden");
    document.getElementById("btn-capture")?.classList.add("active");
  }

  function _exitCaptureMode() {
    _captureMode = false;
    _captureRunning = false;
    _capPanel?.classList.add("hidden");
    document.getElementById("btn-capture")?.classList.remove("active");
  }

  function _stepCaptureFrame() {
    const fps = parseFloat(document.getElementById("cap-fps")?.value) || 30;
    const fixedDt = 1 / fps;
    // Temporarily un-gate, render one deterministic frame, then re-gate
    _captureMode = false;
    pipeline.render(inputs, ps, fixedDt);
    _captureMode = true;

    // Read back pipeline.prev (last composited frame) and download as PNG
    const rt = pipeline.prev;
    const w = rt.width,
      h = rt.height;
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    const tmp = document.createElement("canvas");
    tmp.width = w;
    tmp.height = h;
    const ctx = tmp.getContext("2d");
    const img = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const src = (h - 1 - row) * w * 4;
      img.data.set(pixels.subarray(src, src + w * 4), row * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    const frameNum = String(_captureFrame).padStart(4, "0");
    tmp.toBlob((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `imweb-capture-${frameNum}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");

    _captureFrame++;
    if (_capFrameLabel)
      _capFrameLabel.textContent = `Frame ${String(_captureFrame).padStart(4, "0")}`;
  }

  async function _autoCapture() {
    if (_captureRunning) {
      _captureRunning = false;
      return;
    }
    _captureRunning = true;
    const count = parseInt(document.getElementById("cap-count")?.value) || 1;
    const btn = document.getElementById("cap-run");
    for (let i = 0; i < count && _captureRunning; i++) {
      _stepCaptureFrame();
      if (btn) btn.textContent = `Stop (${i + 1}/${count})`;
      await new Promise((r) => setTimeout(r, 80)); // let browser flush download
    }
    _captureRunning = false;
    if (btn) btn.textContent = "Auto-Run";
  }

  document.getElementById("btn-capture")?.addEventListener("click", () => {
    _captureMode ? _exitCaptureMode() : _enterCaptureMode();
  });
  document
    .getElementById("cap-step")
    ?.addEventListener("click", _stepCaptureFrame);
  document.getElementById("cap-run")?.addEventListener("click", _autoCapture);
  document
    .getElementById("cap-close")
    ?.addEventListener("click", _exitCaptureMode);

  // ── Parameter search overlay (/ key) ─────────────────────────────────────

  const searchEl = document.getElementById("param-search");
  const searchInp = document.getElementById("param-search-input");
  const searchRes = document.getElementById("param-search-results");
  const searchFilters = document.getElementById("param-search-filters");
  let _searchSel = 0;
  let _searchFilter = "all";

  function openParamSearch() {
    if (!searchEl) return;
    searchEl.classList.remove("hidden");
    searchInp.value = "";
    _searchSel = 0;
    _searchFilter = "all";
    searchFilters
      ?.querySelectorAll(".psearch-chip")
      .forEach((el) => el.classList.toggle("active", el.dataset.filter === "all"));
    renderSearchResults("");
    searchInp.focus();
  }

  function closeParamSearch() {
    searchEl?.classList.add("hidden");
    searchInp?.blur();
  }

  function renderSearchResults(query) {
    if (!searchRes) return;
    const q = query.toLowerCase();
    const all = ps
      .getAll()
      .filter((p) => {
        if (_searchFilter === "active") {
          if (!p.controller) return false;
        } else if (_searchFilter === "modified") {
          if (p.value === p.defaultValue) return false;
        } else if (_searchFilter !== "all") {
          if (p.controllerClass !== _searchFilter) return false;
        }
        if (!q) return true;
        return (
          p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q)
        );
      })
      .slice(0, _searchFilter === "all" && !q ? 20 : 60);

    // Drop onChange listeners from the previous render before discarding rows
    searchRes
      .querySelectorAll(".psearch-item")
      .forEach((el) => el._psUnsub?.());
    searchRes.innerHTML = "";
    all.forEach((p, i) => {
      // Reuse the same row builder as the main param panels — gives inline
      // drag/toggle/select/dblclick-reset editing directly in the results.
      const item = buildParamRow(p, contextMenu);
      item.classList.add("psearch-item");
      item.classList.toggle("selected", i === _searchSel);

      const locateBtn = document.createElement("button");
      locateBtn.className = "psearch-locate";
      locateBtn.title = "Scroll to this parameter";
      locateBtn.textContent = "⌖";
      locateBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        activateSearchResult(p);
      });
      item.appendChild(locateBtn);

      item.addEventListener("mouseenter", () => {
        _searchSel = i;
        searchRes
          .querySelectorAll(".psearch-item")
          .forEach((el, j) => el.classList.toggle("selected", j === i));
      });
      searchRes.appendChild(item);
    });

    return all;
  }

  function activateSearchResult(p) {
    // Scroll to the param row and flash it (skip the search-results copy of
    // the row, which now also carries .param-row + data-param-id)
    const row = Array.from(
      document.querySelectorAll(`.param-row[data-param-id="${p.id}"]`),
    ).find((el) => !el.closest("#param-search-results"));
    if (row) {
      row.scrollIntoView({ behavior: "smooth", block: "center" });
      row.style.outline = "1px solid var(--accent)";
      setTimeout(() => {
        row.style.outline = "";
      }, 1500);
    }
    closeParamSearch();
  }

  searchInp?.addEventListener("input", () => {
    _searchSel = 0;
    renderSearchResults(searchInp.value);
  });

  searchFilters?.addEventListener("click", (e) => {
    const chip = e.target.closest(".psearch-chip");
    if (!chip) return;
    _searchFilter = chip.dataset.filter;
    searchFilters
      .querySelectorAll(".psearch-chip")
      .forEach((el) => el.classList.toggle("active", el === chip));
    _searchSel = 0;
    renderSearchResults(searchInp.value);
  });

  searchInp?.addEventListener("keydown", (e) => {
    const items = searchRes?.querySelectorAll(".psearch-item");
    if (!items?.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      _searchSel = Math.min(_searchSel + 1, items.length - 1);
      items.forEach((el, j) =>
        el.classList.toggle("selected", j === _searchSel),
      );
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      _searchSel = Math.max(_searchSel - 1, 0);
      items.forEach((el, j) =>
        el.classList.toggle("selected", j === _searchSel),
      );
    } else if (e.key === "Enter") {
      items[_searchSel]?.querySelector(".psearch-locate")?.click();
    } else if (e.key === "Escape") {
      closeParamSearch();
    }
  });

  document.addEventListener("click", (e) => {
    if (searchEl && !searchEl.contains(e.target)) closeParamSearch();
  });

  // ── UI chrome toggles — OSD (param: persists, MIDI-assignable) and
  //    state bar (plain UI preference: localStorage, never state-recalled).
  //    Wired BEFORE the shortcut listener below: the i/u handlers reference
  //    these, and main() awaits slow init later — keys must work the moment
  //    the listener exists.
  const _osdBtn = document.getElementById("btn-osd");
  const _applyOsd = (on) => {
    const overlay = document.getElementById("feedback-overlay");
    if (overlay) overlay.style.display = on > 0.5 ? "" : "none";
    _osdBtn?.classList.toggle("active", on > 0.5);
  };
  ps.get("global.osd")?.onChange(_applyOsd);
  _applyOsd(ps.get("global.osd")?.value ?? 1);
  _osdBtn?.addEventListener("click", () => ps.toggle("global.osd"));

  const _stateBtn = document.getElementById("btn-statebar");
  const _applyStatebar = (hidden) => {
    document.body.classList.toggle("statebar-hidden", hidden);
    _stateBtn?.classList.toggle("active", !hidden);
    localStorage.setItem("imweb-statebar-hidden", hidden ? "1" : "0");
  };
  _applyStatebar(localStorage.getItem("imweb-statebar-hidden") === "1");
  const _toggleStatebar = () =>
    _applyStatebar(!document.body.classList.contains("statebar-hidden"));
  _stateBtn?.addEventListener("click", _toggleStatebar);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) return;

    // Teletext sub-page navigation — before focus guard so arrows work when UI inputs have focus
    if (ps.get('analog.sourceType')?.value === 14) {

      // Reader mode — takes priority over all other P150 keys
      if (teletextSource._readerMode) {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { teletextSource.readerNextPage(); e.preventDefault(); return; }
        if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { teletextSource.readerPrevPage(); e.preventDefault(); return; }
        if (e.key === 'Escape')                               { teletextSource.exitReader();     e.preventDefault(); return; }
        if (e.key === 'Enter') {
          if (teletextSource._readerItem?.link) window.open(teletextSource._readerItem.link, '_blank', 'noopener');
          e.preventDefault(); return;
        }
        return; // swallow all other keys in reader mode
      }

      if (e.key === 'ArrowLeft')  { teletextSource.prevSubPage(); e.preventDefault(); return; }
      if (e.key === 'ArrowRight') { teletextSource.nextSubPage(); e.preventDefault(); return; }
      if (teletextSource.pageId === 'P150') {
        if (e.key === 'ArrowUp')   { teletextSource.moveCursor(-1); e.preventDefault(); return; }
        if (e.key === 'ArrowDown') { teletextSource.moveCursor(1);  e.preventDefault(); return; }
        if (e.key === 'Enter')     { teletextSource.openSelected(); e.preventDefault(); return; }
      }
    }

    if (
      (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") &&
      e.key !== "Escape"
    )
      return;
    const isLocked = ps.get("global.keylock").value > 0.5;
    if (
      isLocked &&
      (/^[vmcbskdxhtfqazgiu]$/i.test(e.key) || /^Digit[0-9]$/.test(e.code))
    )
      return;

    // Shift+S = quick-save State to next empty slot (with auto-thumbnail)
    if (e.shiftKey && e.key === 'S' && !e.target.closest('input,textarea')) {
      e.preventDefault();
      quickSaveState();
      return;
    }

    // Shift+0 = Neutral State (reset all params, leave controllers intact)
    if (e.shiftKey && e.code === 'Digit0' && !e.target.closest('input,textarea')) {
      e.preventDefault();
      presetMgr.dispatchEvent(new CustomEvent('neutralState'));
      return;
    }

    // Shift+1–8 = Select movie clip (check first so Nordic /=Shift+7 doesn't bleed into search)
    if (e.shiftKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
      const idx = parseInt(e.code.replace("Digit", "")) - 1;
      if (idx < movieInput.clips.length) {
        movieInput.selectClip(idx);
        if (ps.get("movie.active").value)
          movieInput.clips[idx]?.video.play().catch(() => {});
        refreshClipsList();
      }
      e.preventDefault();
      return; // prevent other shortcuts (e.g. / on Nordic layout) from also firing
    }

    // Option/Alt+1–8 = Select Deck B clip. Matches on e.code, never e.key:
    // on macOS Option+digit emits ¡™£¢∞§¶• rather than a digit, but the code
    // stays DigitN. Guarded off Shift so ⇧⌥N doesn't drive both decks at once.
    if (e.altKey && !e.shiftKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
      const idx = parseInt(e.code.replace("Digit", "")) - 1;
      if (idx < movieInputB.clips.length) {
        movieInputB.selectClip(idx);
        if (ps.get("movieB.active").value)
          movieInputB.clips[idx]?.video.play().catch(() => {});
        refreshClipBStatus();
      }
      e.preventDefault();
      return;
    }

    // / (or þ/Þ on Icelandic, where Shift+7=/ is intercepted by the clip-select shortcut above)
    if ((e.key === "/" || e.key === "þ" || e.key === "Þ") && !e.target.closest("input, textarea")) {
      e.preventDefault();
      openParamSearch();
      return;
    }

    // Numpad shortcuts (ImOs9 style)
    if (e.code === "NumpadAdd") {
      e.preventDefault();
      presetMgr.nextPreset();
    }
    if (e.code === "NumpadSubtract") {
      e.preventDefault();
      presetMgr.prevPreset();
    }

    // Number keys 0–9 recall Display States (not when Shift is held — that selects movie clips)
    if (!e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) {
      const idx = parseInt(e.code.replace("Digit", ""));
      presetMgr.recallState(idx);
    }

    // * + digit stores Display State
    if (e.code === "NumpadMultiply") {
      window._nextKeyStoresState = true;
    }
    if (window._nextKeyStoresState && /^Digit[0-9]$/.test(e.code)) {
      const idx = parseInt(e.code.replace("Digit", ""));
      presetMgr.saveCurrentState(idx);
      window._nextKeyStoresState = false;
    }

    // b = Blend toggle
    if (e.key === "b" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("blend.active");
    }
    // s = Solo
    if (e.key === "s" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("output.solo");
    }
    // d = Debug overlay
    if (e.key === "d" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("global.debug");
    }
    // k = Keyer
    if (e.key === "k" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("keyer.active");
    }
    // x = ExtKey
    if (e.key === "x" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("keyer.extkey");
    }
    // c = Capture buffer
    if (e.key === "c" && !e.metaKey) {
      e.preventDefault();
      ps.trigger("buffer.cap_screen");
    }
    // v = Camera on/off
    if (e.key === "v" && !e.metaKey) {
      e.preventDefault();
      ps.set("camera.active", ps.get("camera.active").value > 0.5 ? 0 : 1);
    }
    // m = Movie on/off
    if (e.key === "m" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("movie.active");
    }
    // i = parameter OSD on/off (the yellow feedback text over the canvas)
    if (e.key === "i" && !e.metaKey) {
      e.preventDefault();
      ps.toggle("global.osd");
    }
    // u = state bar show/hide (UI preference, not part of any state)
    if (e.key === "u" && !e.metaKey) {
      e.preventDefault();
      _toggleStatebar();
    }
    // g = cycle canvas interaction mode (Camera → Pad → Locked). Desktop
    // equivalent of the 3-finger tap: trackpads never deliver 3-finger
    // gestures to the browser (macOS consumes them), so a key is the only
    // desktop path. Same OSD flash as the touch cycle.
    if (e.key === "g" && !e.metaKey) {
      e.preventDefault();
      const p = ps.get("touch.mode");
      if (p) {
        const next = (p.value + 1) % (p.options?.length ?? 3);
        ps.set("touch.mode", next);
        showModeOSD(`MODE: ${p.options?.[next] ?? next}`);
      }
    }
    // q/a/z = cycle FG / BG / DS source
    if (e.key === "q" && !e.metaKey) {
      e.preventDefault();
      const p = ps.get("layer.fg");
      const n = p.options.length;
      ps.set("layer.fg", (p.value + 1) % n);
    }
    if (e.key === "a" && !e.metaKey) {
      e.preventDefault();
      const p = ps.get("layer.bg");
      const n = p.options.length;
      ps.set("layer.bg", (p.value + 1) % n);
    }
    if (e.key === "z" && !e.metaKey) {
      e.preventDefault();
      const p = ps.get("layer.ds");
      const n = p.options.length;
      ps.set("layer.ds", (p.value + 1) % n);
    }
    // t = Tap tempo
    if (e.key === "t" && !e.metaKey) {
      e.preventDefault();
      ps.trigger("global.tap");
    }
    // h = Hold / Fade to black (toggle output.fade between 0 and 100)
    if (e.key === "h" && !e.metaKey) {
      e.preventDefault();
      const fadeP = ps.get("output.fade");
      fadeP.value = fadeP.value > 0 ? 0 : 100;
    }
    // f = Fullscreen
    if (e.key === "f" && !e.metaKey) {
      e.preventDefault();
      toggleFullscreen();
    }
    // Cmd/Ctrl+S = quick-save current state to active preset
    if (
      (e.metaKey || e.ctrlKey) &&
      e.key === "s" &&
      !e.target.closest("textarea,input")
    ) {
      e.preventDefault();
      presetMgr.saveCurrentPreset(capturePresetThumb()).then(() => {
        memoryPanel._refresh();
        const btn = document.getElementById("btn-save-preset");
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = "✓ Saved";
          setTimeout(() => {
            btn.textContent = orig;
          }, 1000);
        }
      });
    }
    // ? = Keyboard help
    if (e.key === "?") {
      e.preventDefault();
      toggleHelpOverlay();
    }
    // Escape = exit fullscreen / close overlays
    if (e.key === "Escape") {
      document.body.classList.remove("fullscreen-output");
      document.getElementById("kb-help")?.classList.add("hidden");
    }
  });

  // ── Color pickers (native input[type=color] for Color1/Color2) ───────────

  function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    let h = 0;
    if (d > 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: h * 100, s: max > 0 ? (d / max) * 100 : 0, v: max * 100 };
  }

  document.getElementById("color1-picker")?.addEventListener("input", (e) => {
    const { h, s, v } = hexToHsv(e.target.value);
    ps.set("color1.hue", h);
    ps.set("color1.sat", s);
    ps.set("color1.val", v);
  });
  document.getElementById("color2-picker")?.addEventListener("input", (e) => {
    const { h, s, v } = hexToHsv(e.target.value);
    ps.set("color2.hue", h);
    ps.set("color2.sat", s);
    ps.set("color2.val", v);
  });

  let _noiseColor1 = new THREE.Vector3(1, 1, 1);
  let _noiseColor2 = new THREE.Vector3(0, 0, 0);

  function _hexToVec3(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    return new THREE.Vector3(r, g, b);
  }

  function _vec3ToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(1, v));
    const toHex = (v) => Math.round(clamp(v) * 255).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }

  // ── Color picker ↔ ParameterSystem bidirectional wiring ──────────────────
  // Each native <input type="color"> also writes to backing r/g/b params so
  // states save and restore the colors correctly.

  function _wireColorPicker(pickerId, rId, gId, bId, onApply) {
    const el = document.getElementById(pickerId);
    // DOM → params + Vec3
    el?.addEventListener('input', (e) => {
      const v = _hexToVec3(e.target.value);
      ps.set(rId, v.x); ps.set(gId, v.y); ps.set(bId, v.z);
      onApply(v.x, v.y, v.z);
    });
    // params → Vec3 + DOM (fires on restoreState)
    const sync = () => {
      const r = ps.get(rId)?.value ?? 0;
      const g = ps.get(gId)?.value ?? 0;
      const b = ps.get(bId)?.value ?? 0;
      onApply(r, g, b);
      if (el) el.value = _vec3ToHex(r, g, b);
    };
    ps.get(rId)?.onChange(sync);
    ps.get(gId)?.onChange(sync);
    ps.get(bId)?.onChange(sync);
  }

  _wireColorPicker('noise-color1-picker',
    'noise.col1.r','noise.col1.g','noise.col1.b',
    (r,g,b) => { _noiseColor1.set(r,g,b); });

  _wireColorPicker('noise-color2-picker',
    'noise.col2.r','noise.col2.g','noise.col2.b',
    (r,g,b) => { _noiseColor2.set(r,g,b); });

  _wireColorPicker('particle-col1-picker',
    'particle.col1.r','particle.col1.g','particle.col1.b',
    (r,g,b) => { particles.color1.set(r,g,b); });

  _wireColorPicker('particle-col2-picker',
    'particle.col2.r','particle.col2.g','particle.col2.b',
    (r,g,b) => { particles.color2.set(r,g,b); });

  // Chroma key colour picker → sets keyer.chromahue
  document.getElementById("chroma-picker")?.addEventListener("input", (e) => {
    const { h } = hexToHsv(e.target.value);
    ps.set("keyer.chromahue", h * 3.6); // h is 0–100, chromahue is 0–360
  });

  // ── Fullscreen button and double-click toggle ─────────────────────────────

  const toggleFullscreen = () => {
    const on = document.body.classList.toggle("fullscreen-output");
    // True device fullscreen alongside the layout class — webkit-prefixed
    // fallback for iPadOS Safari. Promise rejection (user gesture rules,
    // iPhone unsupported) is swallowed: the layout fullscreen still applies.
    const de = document.documentElement;
    const fsEl = document.fullscreenElement ?? document.webkitFullscreenElement;
    if (on && !fsEl) {
      const req = de.requestFullscreen ?? de.webkitRequestFullscreen;
      try { req?.call(de)?.catch?.(() => {}); } catch { /* unsupported */ }
    } else if (!on && fsEl) {
      const exit = document.exitFullscreen ?? document.webkitExitFullscreen;
      try { exit?.call(document)?.catch?.(() => {}); } catch { /* noop */ }
    }
  };

  // pointerup (not click) so a touch tap grants the user-activation the
  // Fullscreen API requires on iOS Safari
  document
    .getElementById("btn-fullscreen")
    ?.addEventListener("pointerup", toggleFullscreen);
  canvas.addEventListener("dblclick", toggleFullscreen);

  // Browser-initiated exit (Esc in native fullscreen, iOS swipe) → drop the
  // layout class so in-page and device fullscreen never desync
  const _fsSync = () => {
    const fsEl = document.fullscreenElement ?? document.webkitFullscreenElement;
    if (!fsEl) document.body.classList.remove("fullscreen-output");
  };
  document.addEventListener("fullscreenchange", _fsSync);
  document.addEventListener("webkitfullscreenchange", _fsSync);

  // ── Keyboard help overlay ─────────────────────────────────────────────────

  const toggleHelpOverlay = () => {
    document.getElementById("kb-help")?.classList.toggle("hidden");
  };
  document.getElementById("kb-help")?.addEventListener("click", (e) => {
    if (e.target.id === "kb-help")
      document.getElementById("kb-help").classList.add("hidden");
  });

  // ── Resolution control ────────────────────────────────────────────────────

  const RENDER_RESOLUTIONS = {
    0: null, // Display size (tracks container)
    1: [1280, 720], // 720p
    2: [1920, 1080], // 1080p
    3: [960, 540], // 540p
    4: null, // Quarter (½ of display)
  };

  function applyResolution(idx) {
    const preset = RENDER_RESOLUTIONS[idx];
    let rW, rH;
    if (idx === 4) {
      rW = Math.max(320, Math.round(canvas.parentElement.clientWidth / 2));
      rH = Math.max(180, Math.round(canvas.parentElement.clientHeight / 2));
    } else if (preset) {
      [rW, rH] = preset;
    } else {
      rW = canvas.parentElement.clientWidth;
      rH = canvas.parentElement.clientHeight;
    }
    W = rW;
    H = rH;
    renderer.setSize(rW, rH);
    // "fit" and "½" fill the container; fixed resolutions display at natural size (letterboxed/pillarboxed)
    const fills = idx === 0 || idx === 4;
    renderer.domElement.style.width = fills ? "100%" : "";
    renderer.domElement.style.height = fills ? "100%" : "";
    renderer.domElement.style.maxWidth = fills ? "" : "100%";
    pipeline.resize(rW, rH);
    scene3d.resize(rW, rH);
    stillsBuffer.resize(rW, rH);
    videoDelay.resize(rW, rH);
    tdEngine.resize(rW, rH);
    slitScan.resize(rW, rH);
    vasulkaWarp.resize(rW, rH);
    particles.resize(rW, rH);
    seq1.resize(rW, rH);
    seq2.resize(rW, rH);
    seq3.resize(rW, rH);
  }

  ps.get("output.resolution").onChange((idx) => applyResolution(idx));

  // ── Resize handler ────────────────────────────────────────────────────────

  const resizeObserver = new ResizeObserver(() => {
    // If in ghost mode, the main canvas is hidden and should NOT be resized
    // as it's not the primary focus and might trigger unnecessary re-renders
    if (document.body.classList.contains("ghost-mode")) return;

    const idx = ps.get("output.resolution").value;
    if (idx === 0 || idx === 4) {
      applyResolution(idx);
    }
  });
  resizeObserver.observe(canvas.parentElement);

  // ── Startup: collapse sections + auto-start camera ───────────────────────

  // Always collapse all sections except Layers for clean first impression
  _collapseToDefaultOpen();

  // Auto-start camera on first load (silently; user can stop it)
  camera3d.start(null).then((ok) => {
    if (!ok) return;
    const btnCam = document.getElementById("btn-camera-on");
    if (btnCam) btnCam.textContent = "■ Camera";
    ps.set("camera.active", 1);
    // Only route to layers if no preset restored a different source
    const fg = ps.get("layer.fg").value;
    const bg = ps.get("layer.bg").value;
    const ds = ps.get("layer.ds").value;
    // 3=Color, 4=Noise → default untouched states; route to camera
    if (fg === 3 || fg === 4) ps.set("layer.fg", 0);
    if (bg === 3 || bg === 4) ps.set("layer.bg", 0);
    if (ds === 3 || ds === 4) ps.set("layer.ds", 0);
  });

  // ── Canvas touch grammar — GestureArbitrator (Camera/Pad/Locked via
  //    touch.mode; absorbs the former always-on two-finger pinch zoom) ──────
  //    2-finger double-tap on the canvas = same fullscreen toggle as the
  //    status-bar button
  // Mode OSD — big centered flash for blind performance gestures
  let _modeOsdEl = null;
  let _modeOsdTimer = null;
  const showModeOSD = (label) => {
    if (!_modeOsdEl) {
      _modeOsdEl = document.createElement("div");
      _modeOsdEl.id = "touch-mode-osd";
      document.body.appendChild(_modeOsdEl);
    }
    _modeOsdEl.textContent = String(label).toUpperCase();
    _modeOsdEl.classList.add("show");
    clearTimeout(_modeOsdTimer);
    _modeOsdTimer = setTimeout(() => _modeOsdEl.classList.remove("show"), 800);
  };

  // Pad-mode crosshair — absolute X/Y reference over the canvas.
  // Active while a pad drive is happening, parked (ghost) on release,
  // hidden the moment touch.mode leaves Pad (any path: 3-finger tap,
  // param row, preset recall, MIDI).
  let _padXhair = null;
  const _ensurePadXhair = () => {
    if (_padXhair) return _padXhair;
    // #output-panel is the canvas's positioned parent (position:relative);
    // note there is no #canvas-wrap in the DOM (DebugOverlay's target)
    const wrap = document.getElementById("output-panel");
    if (!wrap) return null;
    const box = document.createElement("div");
    box.id = "pad-crosshair-container";
    const h = document.createElement("div");
    h.className = "pad-xhair-h";
    const v = document.createElement("div");
    v.className = "pad-xhair-v";
    box.appendChild(h);
    box.appendChild(v);
    wrap.appendChild(box);
    _padXhair = { box, h, v };
    return _padXhair;
  };
  const padDrive = (x, y) => {
    const xh = _ensurePadXhair();
    if (!xh) return;
    xh.v.style.left = (x * 100).toFixed(2) + "%";
    xh.h.style.top = (y * 100).toFixed(2) + "%";
    xh.box.classList.remove("hidden");
    xh.box.classList.add("active");
  };
  const padRelease = () => _padXhair?.box.classList.remove("active"); // → parked ghost
  ps.get("touch.mode")?.onChange((m) => {
    if (Math.round(m) !== 1 && _padXhair) {
      _padXhair.box.classList.add("hidden");
      _padXhair.box.classList.remove("active");
    }
    // Draw mode gets a crosshair so it's obvious the canvas is a brush
    canvas.style.cursor = Math.round(m) === 3 ? "crosshair" : "";
  });

  // Device motion (tilt/compass controllers). The Global 'Enable Motion'
  // trigger is the gesture-context fallback for iOS permission when tilt
  // controllers arrive via preset recall (no assignment gesture available).
  ps.get("motion.enable")?.onTrigger(() => ctrl.requestMotionPermission());
  // Permission outcome is otherwise invisible — flash it in the OSD so
  // on-device debugging isn't blind (fires for Enable Motion AND inline
  // assignment requests)
  ctrl.onMotionPermission = (state) => showModeOSD(`MOTION: ${state}`);
  // Recalled states can restore tilt controllers wholesale — re-arm the
  // sensor listener. CRITICAL: never call requestMotionPermission here on
  // iOS — a no-gesture call at boot burns the one prompt Safari allows per
  // page load, so the user's later Enable Motion tap resolves 'denied'
  // instantly with no permission sheet. iOS waits for a real gesture.
  const _rearmMotion = () => {
    if (ctrl._motionPermission === "granted") {
      ctrl.armMotion();
    } else if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof DeviceOrientationEvent.requestPermission !== "function"
    ) {
      ctrl.requestMotionPermission(); // non-iOS: no gesture needed, safe
    }
  };
  presetMgr.addEventListener("stateRecalled", _rearmMotion);
  presetMgr.addEventListener("presetActivated", _rearmMotion);

  const gestureArb = new GestureArbitrator(canvas, ps, ctrl, {
    onDoubleTap2: toggleFullscreen,
    onModeCycled: (label) => showModeOSD(`MODE: ${label}`), // 3-finger tap OSD
    onPadDrive: padDrive,
    onPadRelease: padRelease,
    sceneManager: scene3d, // spin→rot handover when a grab takes control
  });
  void gestureArb; // referenced by the render loop's inertia tick

  // ── Desktop canvas zoom — wheel / trackpad pinch → scene3d.scale, the
  //    same param the touch pinch drives. Chrome/Firefox deliver macOS
  //    trackpad pinch as wheel events with ctrlKey set and fine-grained
  //    deltas; preventDefault stops the browser page-zooming. Toggle and
  //    sensitivity live in the Global params section. When the toggle is
  //    off the event is left alone so native browser behaviour returns.
  // Discrete wheel notches ease toward a target scale so mouse zoom feels
  // like the continuous touch pinch. The loop yields the instant anything
  // else writes scene3d.scale (controller, state recall, touch pinch).
  let _zoomTarget = null, _zoomRaf = 0, _zoomExpected = null;
  const _zoomStop = () => {
    if (_zoomRaf) { cancelAnimationFrame(_zoomRaf); _zoomRaf = 0; }
    _zoomTarget = null;
    _zoomExpected = null;
  };
  const _zoomTick = () => {
    _zoomRaf = 0;
    const p = ps.get("scene3d.scale");
    if (!p || _zoomTarget === null) return;
    if (_zoomExpected !== null && p.value !== _zoomExpected) { _zoomStop(); return; }
    ps.set("scene3d.scale", p.value + (_zoomTarget - p.value) * 0.25);
    _zoomExpected = p.value; // read back (setter clamps)
    if (Math.abs(_zoomTarget - p.value) > Math.max(0.001, p.value * 0.002)) {
      _zoomRaf = requestAnimationFrame(_zoomTick);
    } else {
      _zoomStop();
    }
  };
  canvas.addEventListener(
    "wheel",
    (e) => {
      if (!(ps.get("canvas.wheelZoom")?.value > 0.5)) return;
      e.preventDefault();
      const p = ps.get("scene3d.scale");
      if (!p) return;
      const sens = ps.get("canvas.wheelSens")?.value ?? 1;
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY; // lines → px
      const k = e.ctrlKey ? 0.01 : 0.0015; // pinch deltas are much smaller
      // Exponential zoom: equal wheel travel = equal zoom ratio, and the
      // scale can never cross zero; clamp the target to the param range
      const base = _zoomTarget ?? p.value;
      _zoomTarget = Math.max(p.min, Math.min(p.max, base * Math.exp(-dy * k * sens)));
      _zoomExpected = p.value;
      if (!_zoomRaf) _zoomRaf = requestAnimationFrame(_zoomTick);
    },
    { passive: false },
  );

  // ── Desktop mouse canvas grammar — Camera mode only (same gate as the
  //    touch grammar): left-drag orbits (scene3d.rot, same deg/px as the
  //    touch orbit), right-drag pans (scene3d.pos.x/y). Mouse-x/y
  //    controllers keep working — they listen elsewhere.
  {
    const ORBIT = 0.35; // deg/px — matches GestureArbitrator's touch orbit
    const PAN = 0.01; // pos-units/px
    const FLICK_MAX_AGE_MS = 80; // same freshness rule as the touch flick
    const wrap = (v) => ((v % 360) + 360) % 360;
    let drag = null;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.pointerType !== "mouse") return;
      if ((ps.get("touch.mode")?.value ?? 2) !== 0) return; // Camera only
      if (e.button !== 0 && e.button !== 2) return;
      canvas.setPointerCapture(e.pointerId);
      // Tactile clutch, same as touch: grabbing the canvas kills a coast
      gestureArb._coastVX = 0;
      gestureArb._coastVY = 0;
      // Same spin handover as a touch grab: orbiting takes control from
      // auto-spin (freezes current orientation into rot, zeroes spin)
      if (e.button === 0) gestureArb._grabSpinControl();
      drag = {
        btn: e.button,
        x: e.clientX,
        y: e.clientY,
        rotX: ps.get("scene3d.rot.x")?.value ?? 0,
        rotY: ps.get("scene3d.rot.y")?.value ?? 0,
        posX: ps.get("scene3d.pos.x")?.value ?? 0,
        posY: ps.get("scene3d.pos.y")?.value ?? 0,
        vx: 0, vy: 0, lastX: e.clientX, lastY: e.clientY,
        lastT: performance.now(),
      };
      e.preventDefault();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!drag || !canvas.hasPointerCapture(e.pointerId)) return;
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (drag.btn === 0) {
        ps.set("scene3d.rot.y", wrap(drag.rotY + dx * ORBIT));
        ps.set("scene3d.rot.x", wrap(drag.rotX + dy * ORBIT));
        // Flick velocity (deg/s), same EMA smoothing as the touch orbit
        const now = performance.now();
        const mdt = (now - drag.lastT) / 1000;
        if (mdt > 0 && mdt < 0.1) {
          drag.vx = drag.vx * 0.6 + (((e.clientX - drag.lastX) * ORBIT) / mdt) * 0.4;
          drag.vy = drag.vy * 0.6 + (((e.clientY - drag.lastY) * ORBIT) / mdt) * 0.4;
        }
        drag.lastX = e.clientX; drag.lastY = e.clientY; drag.lastT = now;
      } else {
        ps.set("scene3d.pos.x", drag.posX + dx * PAN);
        ps.set("scene3d.pos.y", drag.posY - dy * PAN); // screen up = +y
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (!drag) return;
      // Release flick → hand the velocity to the arbitrator's coast state;
      // the render loop's gestureArb.tick(dt) applies the SAME friction
      // physics as a touch flick (mouse never populates _pointers, so the
      // tick's touch guard cannot cancel a mouse-initiated coast).
      if (
        drag.btn === 0 &&
        e.pointerType === "mouse" &&
        performance.now() - drag.lastT < FLICK_MAX_AGE_MS
      ) {
        gestureArb._coastVX = drag.vx;
        gestureArb._coastVY = drag.vy;
      }
      drag = null;
    });
    canvas.addEventListener("pointercancel", () => { drag = null; });
    // Right-drag pan needs the context menu suppressed on the canvas
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ── Draw-on-canvas (touch.mode 3 "Draw") — paint directly on the output.
  //    Same pointer grammar as the Draw panel preview (pressure, coalesced
  //    events, palm rejection); straight rect mapping — the draw texture is
  //    sampled stretched over the output, so strokes land under the pointer.
  //    Camera/pad grammars gate on their own indices, so mode 3 is theirs
  //    to ignore and ours to claim.
  drawLayer.attachDrawSurface?.(
    canvas,
    () => (ps.get("touch.mode")?.value ?? 2) === 3,
  );

  // ── Warp-on-canvas (touch.mode 4 "Warp") — smear the displacement map by
  //    dragging the output. Claims its own mode index for the same reason the
  //    Draw surface above does: camera orbit (0) and the pad (1) gate on theirs,
  //    so a bare listener would have made every orbit drag also smear the map.
  //    Y is flipped (1 - v): the warp map is sampled y-up like the param path
  //    (displace.warpDrawY), while pointer coords are y-down — without the flip
  //    a stroke at the top of the output smears the bottom of the image.
  {
    let wdrag = null;
    const uv = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width, y: 1 - (e.clientY - r.top) / r.height };
    };
    const active = () => (ps.get("touch.mode")?.value ?? 2) === 4;
    canvas.addEventListener("pointerdown", (e) => {
      if (!active()) return;
      canvas.setPointerCapture(e.pointerId);
      // Match the mini-editor: entering Warp mode and pressing is unambiguous
      // intent, so make sure the result is actually visible. Custom is the only
      // slot drawing reaches, and a WarpAmt of 0 renders nothing at all.
      ps.set("displace.warp", WARP_CUSTOM_IDX);
      if (ps.get("displace.warpamt").value === 0) ps.set("displace.warpamt", 80);
      wdrag = uv(e); // `t` used to be stamped here and never read
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!wdrag || !active()) return;
      // Coalesced events, the same way the Draw surface consumes them. The
      // browser batches motion between frames into ONE pointermove, so a fast
      // flick arrives as a single large step — and _warpStroke reads a step
      // over WARP_JUMP_MAX as a teleport and draws nothing at all. The faster
      // you moved, the less happened. Replaying the sub-events keeps every
      // delta small, so the guard goes back to catching only real teleports
      // (state recalls, a pointer re-entering the canvas).
      // autoSelect: entering Warp mode and dragging is unambiguous intent, so
      // the same narrow off→Custom switch applies. A deliberately chosen mode
      // (H-Wave, say) is still left alone, and the drag is then a no-op.
      // `?? [e]` is not enough: getCoalescedEvents() EXISTS but returns an
      // empty array for untrusted events, and `[] ?? x` is `[]`, so the loop
      // body would never run and the drag would draw nothing at all. Fall back
      // on emptiness, not just on absence.
      const coalesced = e.getCoalescedEvents?.() ?? [];
      for (const ce of (coalesced.length ? coalesced : [e])) {
        const p = uv(ce);
        _warpStroke(p.x, p.y, p.x - wdrag.x, p.y - wdrag.y, true);
        wdrag = p;
      }
    });
    const endWarp = (e) => {
      if (!wdrag) return;
      wdrag = null;
      if (e?.pointerId != null && canvas.hasPointerCapture?.(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };
    canvas.addEventListener("pointerup", endWarp);
    canvas.addEventListener("pointercancel", endWarp);
  }


  // ── Render loop ───────────────────────────────────────────────────────────

  let lastTime = performance.now();
  let noiseTime = 0;
  let noisePhase = 0;
  let frameCount = 0;
  let autoCapTimer = 0;
  let scanTimer = 0;
  let scanDir = 1; // +1 fwd, -1 back (for ping-pong)
  let strobePhase = 0; // 0–1 phase within one strobe cycle
  let beatPhase = 0; // accumulated beat counter (beats, increases at BPM rate)

  let _midiClockTickCount = 0;
  let _pendingMidiFrame = false;
  ctrl.onMidiTick = () => {
    _midiClockTickCount++;
    const res = Math.max(1, Math.round(ps.get("global.midisyncres").value));
    if (_midiClockTickCount % res === 0) {
      _pendingMidiFrame = true;
    }
  };

  function render(now) {
    requestAnimationFrame(render);
    perfFrame(now);

    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;

    // 1. Render Gating (MidiSync / AutoSync) — True Engine Lock
    // ────────────────────────────────────────────────────────────────────────
    let shouldRender = true;

    // MidiSync: wait for external MIDI clock trigger (0xF8)
    const midiSyncActive = ps.get("global.midisync").value;
    if (midiSyncActive) {
      if (!_pendingMidiFrame) shouldRender = false;
    }

    // AutoSync: divisor-based frame skipping (1 = realtime, 2 = half speed, etc)
    const autoSyncDiv = Math.max(
      1,
      Math.round(ps.get("global.autosync").value),
    );
    if (autoSyncDiv > 1) {
      if (frameCount % autoSyncDiv !== 0) shouldRender = false;
    }

    noisePhase += ps.get('noise.speed').value * dt;
    if (_captureMode) return; // capture mode: render only on explicit step
    if (!shouldRender) return;

    // From here on, we are rendering a frame
    _pendingMidiFrame = false;
    noiseTime += dt;
    frameCount++;
    profiler.begin();

    // 2. Logic Tick (Engine simulation advances only when rendering)
    // ────────────────────────────────────────────────────────────────────────

    // Tick slew (parameter lag/smoothing)
    ps.tickSlew(dt);

    // Advance beat phase
    const bpm = ps.get("global.bpm")?.value ?? 120;
    beatPhase += dt * (bpm / 60);

    // Beat detection: auto-update global.bpm from audio when opted in
    if (ps.get("global.beatdetect")?.value && ctrl.sound?.beatDetector?.beat) {
      const detectedBpm = ctrl.sound.beatDetector.bpm;
      if (detectedBpm > 0) {
        const cur = ps.get("global.bpm")?.value ?? 120;
        const smoothed = Math.round(cur * 0.7 + detectedBpm * 0.3);
        ps.set("global.bpm", smoothed);
        ctrl.retriggerLFOs();
      }
    }

    // Tick controllers (LFOs with beat phase, random, expression, etc.)
    ctrl.tick(dt, beatPhase);

    // Tick preset morph animation
    presetMgr.tickMorph(dt);

    // Tick automation playback
    automation.tick(dt);

    // 3. Main Render Pass
    // ────────────────────────────────────────────────────────────────────────

    // Tick step sequencer
    stepSequencer.tick(beatPhase);
    // Update camera texture
    camera3d.tick();

    // Orbit inertia — coast + damp after a touch flick
    gestureArb.tick(dt);

    // ── Source consumption analysis (Phase 23 Steps 2 & 4) ──────────────────
    // THE single "is source index i consumed this frame?" test. Every
    // on-demand tick gate and upload gate below uses it. A source is consumed
    // when a layer routes it, TimeDisplace captures it, or a LIVE mix bus
    // input selects it. Adding a new consumer means extending THIS function,
    // not copying the pattern again.
    const _cFg = ps.get("layer.fg").value;
    const _cBg = ps.get("layer.bg").value;
    const _cDs = ps.get("layer.ds")?.value ?? 0;
    const _cTd = ps.get("td.enabled").value
      ? ps.get("td.captureSource").value
      : -1;
    const _direct = (i) => _cFg === i || _cBg === i || _cDs === i || _cTd === i;

    // Per-bus inputs. Which one can actually reach the bus output? MIXBUS
    // computes mix(a, modeResult, xfade): xfade=0 is pure srcA (srcB hidden),
    // and Crossfade pinned at 1 is pure srcB (srcA hidden) — every other mode
    // still reads srcA. Same reasoning as the v0.12 deck gate, generalized off
    // the deck identities.
    const _bus = MIXBUS_IDX.map((idx, k) => {
      const pfx = ["mix", "mix2", "mix3"][k];
      const xf = ps.get(`${pfx}.xfade`).value;
      const md = ps.get(`${pfx}.mode`).value;
      return {
        idx,
        srcA: ps.get(`${pfx}.srcA`).value,
        srcB: ps.get(`${pfx}.srcB`).value,
        aReaches: !(md === 0 && xf >= 1),
        bReaches: xf > 0,
        needed: false,
      };
    });
    // A bus is needed if a layer/TimeDisplace reads it, OR if a bus that is
    // itself needed reads it. That is transitive in both directions (a later
    // bus reads an earlier one this frame; an earlier bus reads a later one
    // one frame behind — both are real consumers), so iterate to a fixpoint.
    // Three nodes ⇒ three passes is provably enough. A bus feeding only
    // itself never becomes needed, which is what we want: it costs nothing.
    _bus.forEach((b) => { b.needed = _direct(b.idx); });
    for (let pass = 0; pass < _bus.length; pass++) {
      _bus.forEach((b) => {
        if (!b.needed) return;
        _bus.forEach((t) => {
          if ((b.aReaches && b.srcA === t.idx) || (b.bReaches && b.srcB === t.idx)) t.needed = true;
        });
      });
    }
    const _mixbusNeeded = _bus.map((b) => b.needed);

    const _srcUsed = (i) =>
      _direct(i) ||
      _bus.some((b) => b.needed && ((b.aReaches && b.srcA === i) || (b.bReaches && b.srcB === i)));

    // ── Idle-deck upload gating (v0.12 Step 5) ──────────────────────────────
    // Skip the texImage2D upload for a deck that cannot contribute to this
    // frame; playback keeps running so the deck stays cued.
    // Deck A has legacy per-frame readers outside the layer system. If any
    // subsystem that CAN sample the Movie texture is live, keep uploading —
    // gating must never freeze a texture someone is reading (Phase 5 lesson).
    const _gLegacyReaders =
      ps.get("seq1.active").value ||           // seq capture (source may be Movie)
      ps.get("seq2.active").value ||
      ps.get("seq3.active").value ||
      ps.get("scene3d.active").value ||        // 3D materials / hypercube tex
      _srcUsed(6) || _srcUsed(20) ||
      _srcUsed(16) ||                          // particles (masksrc may be Movie)
      _srcUsed(23) ||                          // analog TV (source may be Movie)
      _srcUsed(21) ||                          // SDF (texSrc may be Movie)
      _clipRecording;                          // ClipLib REC (source may be Mov)
    // Deck A keeps exact v0.11 behavior (always upload while active) EXCEPT
    // the provably-hidden case: a mix bus is the only consumer and no live bus
    // can show Movie this frame. The `|| no bus live` term preserves that
    // conservatism verbatim — when nothing routes a bus, Deck A always
    // uploads, exactly as before.
    const _anyBusLive = _mixbusNeeded.some(Boolean);
    const _uploadA = _srcUsed(1) || _gLegacyReaders || !_anyBusLive;
    // Deck B is only reachable via source 25, TimeDisp capture, or a MixBus
    // input (no legacy subset list includes "Movie B" — keep it that way, or
    // extend _gLegacyReaders when appending it to one).
    const _uploadB = _srcUsed(25);

    // Update movie clips (both decks)
    movieInput.tick(ps, beatPhase, dt, _uploadA);
    movieInputB.tick(ps, beatPhase, dt, _uploadB);

    // Tick stills buffer (reads fs1 → readIndex)
    stillsBuffer.tick(ps, dt);

    // Tick and capture sequence buffers
    const _seqSrcTex = (idx) =>
      [
        pipeline.prev.texture, // 0 Output
        camera3d.currentTexture, // 1 Camera
        movieInput.currentTexture, // 2 Movie
        _resolveLayerTex(ps.get("layer.fg").value), // 3 FG
        _resolveLayerTex(ps.get("layer.bg").value), // 4 BG
        stillsBuffer.texture, // 5 Buffer
        drawLayer.texture, // 6 Draw
      ][idx] ?? pipeline.prev.texture;

    [seq1, seq2, seq3].forEach((seq, i) => {
      seq.tick();
      if (ps.get(`seq${i + 1}.active`).value) {
        seq.capture(_seqSrcTex(ps.get(`seq${i + 1}.source`).value));
      }
    });

    // Buffer frame scan
    if (ps.get("buffer.scan").value) {
      scanTimer += dt;
      const rate = Math.max(0.01, ps.get("buffer.scanrate").value);
      if (scanTimer >= 1 / rate) {
        scanTimer = 0;
        const n = stillsBuffer.frameCount;
        const dir = ps.get("buffer.scandir").value;
        const cur = ps.get("buffer.fs1").value;
        if (dir === 0) {
          // forward
          ps.set("buffer.fs1", (cur + 1) % n);
        } else if (dir === 1) {
          // backward
          ps.set("buffer.fs1", (cur - 1 + n) % n);
        } else {
          // ping-pong
          const next = cur + scanDir;
          if (next >= n - 1 || next <= 0) scanDir = -scanDir;
          ps.set("buffer.fs1", Math.max(0, Math.min(n - 1, next)));
        }
      }
    } else {
      scanTimer = 0;
    }

    // Live slots — blit each live source to its slot every frame
    if (liveSlots.size > 0) {
      _liveTick++;
      for (const [slot, srcKey] of liveSlots.entries()) {
        const tex = texForSource(srcKey);
        if (tex) {
          stillsBuffer.liveCapture(tex, slot);
          if (_liveTick % 60 === 0) stillsBuffer.updateLiveThumbnail(slot); // refresh thumb ~1/s
        }
      }
      if (_liveTick % 30 === 0) refreshBufferGrid();
    }

    // Auto-capture into buffer at buffer.rate fps
    if (ps.get("buffer.auto").value) {
      autoCapTimer += dt;
      const rate = Math.max(0.01, ps.get("buffer.rate").value);
      if (autoCapTimer >= 1 / rate) {
        autoCapTimer = 0;
        captureFromSource();
      }
    } else {
      autoCapTimer = 0;
    }

    // Tick stroke looper first so due loop points land in the draw layer's
    // point queue and render this same frame
    strokeLooper.tick(dt);

    // ── Ink source routing ──────────────────────────────────────────────
    // 0=Color  1=Camera  2=Movie  3=MovieB  4=Noise (in DrawLayer)
    // 5=Output (snapshot Three.js canvas from previous frame)
    const inkSrc = ps.get("draw.inkSource")?.value ?? 0;
    drawLayer.inkSource = inkSrc;
    if (inkSrc === 1) {
      drawLayer.inkVideo = camera3d.video;
    } else if (inkSrc === 2) {
      drawLayer.inkVideo = movieInput.currentClip?.video ?? null;
    } else if (inkSrc === 3) {
      drawLayer.inkVideo = movieInputB.currentClip?.video ?? null;
    } else {
      drawLayer.inkVideo = null;
    }

    // Output ink: snapshot the Three.js canvas from the PREVIOUS frame
    // into the draw layer's ink cache. This avoids a feedback loop (the
    // current draw texture hasn't been composited yet). preserveDrawing-
    // Buffer is true so the canvas content survives frame to frame.
    if (inkSrc === 5 && drawLayer._inkCache) {
      const c = drawLayer._inkCache;
      if (c.width > 0) {
        const cc = drawLayer._inkCacheCtx;
        cc.drawImage(canvas, 0, 0, c.width, c.height);
      }
    }

    // Tick draw layer (paints to canvas texture based on draw.* params)
    drawLayer.tick(ps);

    // Strokes → particles: while ink lands (live/param strokes, not loop
    // playback) the pen drives the particle emitter. Both axes are y-up
    // 0–100, so it's a straight copy; last writer wins if a controller is
    // also assigned to the emit params.
    if ((ps.get("draw.toParticles")?.value ?? 0) > 0.5 && drawLayer.strokeActive) {
      ps.set("particle.emitx", ps.get("draw.x").value);
      ps.set("particle.emity", ps.get("draw.y").value);
    }

    // ── Performative displacement drawing ───────────────────────────────────
    // Drives the Custom warp map from displace.warpDrawX/warpDrawY, so MIDI/LFO/OSC can
    // sculpt it live instead of only the editor window.
    //
    // WarpMapEditor.brush() is a push/pull that needs a DIRECTION, not just a
    // position, so the direction comes from the motion of the point between
    // frames — the same thing a mouse drag expresses. A stationary pair of
    // sliders therefore does nothing, which is what makes an explicit on/off
    // switch unnecessary. Speed sets the strength, so fast sweeps bite harder.
    {
      const nx = ps.get("displace.warpDrawX").value / 100;
      const ny = ps.get("displace.warpDrawY").value / 100;
      if (_warpDrawPrev) {
        _warpStroke(nx, ny, nx - _warpDrawPrev.x, ny - _warpDrawPrev.y, true);
      }
      _warpDrawPrev = { x: nx, y: ny };

      // Advance an in-flight slot crossfade (displace.warpSlotFade > 0).
      warpEditor.tickMorph(dt);

      // Temporal decay — heals toward FLAT (zero displacement), not toward
      // black; zero is the neutral state of a displacement field. decay()
      // returns false once the map is flat, so an idle map costs one early-out
      // instead of a texture rebuild every frame.
      const fade = ps.get("displace.warpFade").value;
      if (fade > 0) warpEditor.decay(fade * dt * 4);
    }

    // Tick text layer (updates text rendering based on text.* params)
    textLayer.tick(ps, dt);

    // Update sound level texture
    if (ctrl.sound) {
      const lvl = Math.round(Math.min(1, ctrl.sound.level * 4) * 255);
      soundData[0] = soundData[1] = soundData[2] = lvl;
      soundTexture.needsUpdate = true;

      // VU meter in status bar
      if (_vuCanvas) {
        _vuCanvas.style.display = "inline-block";
        const W = _vuCanvas.width,
          H = _vuCanvas.height;
        _vuCtx.clearRect(0, 0, W, H);
        const bars = 4;
        const barW = W / bars - 1;
        const levels = [
          ctrl.sound.bass,
          ctrl.sound.mid,
          ctrl.sound.high,
          ctrl.sound.level,
        ];
        const colors = ["#4080ff", "#40c040", "#c0c040", "#e84040"];
        levels.forEach((lv, i) => {
          const h = Math.round(Math.min(1, lv) * H);
          _vuCtx.fillStyle = colors[i];
          _vuCtx.fillRect(i * (barW + 1), H - h, barW, h);
        });
      }
    }

    // Tick vectorscope
    vectorscope.tick(ps);

    // Tick slit scan (reads from pipeline.prev render target)
    slitScan.tick(renderer, pipeline.prev, ps, dt);

    // td.captureSource may point at a conditionally-ticked generator (Noise, 3D Scene,
    // 3D Depth, SDF, Analog, Particles) that would otherwise stay null/stale unless a
    // layer also displays it. A MixBus input can now do the same. Both cases are
    // folded into _srcUsed() above — the local _tdCap copy it replaced is gone.
    // td.mode === "Noise" (6) drives the per-pixel delay map from the Noise
    // generator's output — force Noise to tick even if no layer uses it.
    const TD_MODE_NOISE = 6;
    const _tdModeNoise = ps.get("td.enabled").value && ps.get("td.mode").value === TD_MODE_NOISE;

    // Tick particle system — resolve luma mask source (only pre-ticked textures are safe)
    const _pmSrcMap = [
      null, // 0 None
      camera3d.active ? camera3d.currentTexture : null, // 1 Camera
      movieInput.active ? movieInput.currentTexture : null, // 2 Movie
      stillsBuffer.texture, // 3 Buffer
      pipeline.prev.texture, // 4 Output (prev frame)
      drawLayer.texture, // 5 Draw
      _resolveLayerTex(ps.get("layer.fg").value), // 6 FG Src
      _resolveLayerTex(ps.get("layer.bg").value), // 7 BG Src
      _resolveLayerTex(ps.get("layer.ds")?.value ?? 0), // 8 DS Src
      noiseTexture, // 9 Noise
      vectorscope.texture, // 10 Vectorscope
    ];
    const PARTICLE_IDX = 16;
    const _particlesUsed = _srcUsed(PARTICLE_IDX);
    if (_particlesUsed) {
      particles.tick(ps, dt, _pmSrcMap[ps.get("particle.masksrc").value] ?? null);
    }
    // SDF dedicated texture source routing (decouples from layer.fg / layer.bg).
    // SELECT index 0 = follow the pipeline FG/BG layer (default, preserves old behaviour).
    // Indices 1–7 map to _resolveLayerTex's internal keys: Camera=0,Movie=1,Buffer=2,Color=3,Noise=4,3D=5,Draw=6
    // Index 8 = None → null (no texture update this frame).
    const _sdfSrcToLayerIdx = [null, 0, 1, 6, 4, 3, 2, 5, null];
    const _sdfTexIdx = ps.get("sdf.texSrc").value;
    const _sdfRefIdx = ps.get("sdf.refractSrc").value;
    const _sdfTex =
      _sdfTexIdx === 0
        ? _resolveLayerTex(ps.get("layer.fg").value)
        : _sdfSrcToLayerIdx[_sdfTexIdx] != null
          ? _resolveLayerTex(_sdfSrcToLayerIdx[_sdfTexIdx])
          : null;
    const _sdfRef =
      _sdfRefIdx === 0
        ? _resolveLayerTex(ps.get("layer.bg").value)
        : _sdfSrcToLayerIdx[_sdfRefIdx] != null
          ? _resolveLayerTex(_sdfSrcToLayerIdx[_sdfRefIdx])
          : null;
    const SDF_IDX = 21;
    const _sdfUsed = _srcUsed(SDF_IDX);
    if (_sdfUsed) sdfGen.tick(ps, dt, _sdfTex, _sdfRef);

    // Analog TV — on-demand rendering (source index 23)
    const ANALOG_IDX = 23;
    const _analogUsed = _srcUsed(ANALOG_IDX);
    const _analogSrcIdx = _analogUsed ? ps.get("analog.sourceType").value : -1;
    if (_analogUsed) {
      const ANALOG_SRC_MAP    = [0, 1, 2, 5, 6, 7, 8]; // Camera=0, Movie=1, Buffer=2, Noise=5, 3D=6, Draw=7, Output=8
      const TELETEXT_SRC_IDX  = 14;
      let _analogSrc;
      if (_analogSrcIdx === TELETEXT_SRC_IDX) {
        teletextSource.tick(ps, dt);         // handles clock repaint + page switching
        _analogSrc = teletextSource.texture; // THREE.CanvasTexture → CRT shader
      } else if (_analogSrcIdx >= 7) {
        _analogSrc = null;                   // test patterns — generated in shader
      } else {
        _analogSrc = _resolveLayerTex(ANALOG_SRC_MAP[_analogSrcIdx] ?? 0);
      }
      analogTV.tick(ps, dt, _analogSrc);
    }

    // Animate Color2 gradient when speed is non-zero
    const _c2speed = ps.get("color2.speed")?.value ?? 0;
    if (_c2speed !== 0) {
      _color2Phase += dt * _c2speed * 0.005; // 200 = 1 full cycle/sec
      updateColor2Texture();
    }

    // Generate noise only when a layer is using it as a source (512×512 dedicated target)
    const NOISE_IDX = 5;
    const _noiseUsed = _srcUsed(NOISE_IDX) || _analogSrcIdx === 3 || ps.get('scene3d.mat.texsrc')?.value === 6 || _tdModeNoise;
    const _scene3dNoise = ps.get('scene3d.mat.texsrc')?.value === 6;
    const _noiseScale = ps.get('noise.scale')?.value ?? 8;
    const _seamlessPeriod = _scene3dNoise
      ? Math.max(2, Math.floor(_noiseScale / 2) * 2)
      : undefined;
    if (_noiseUsed) noiseTexture = pipeline.generateNoise({
      time: noiseTime,
      phase: noisePhase,
      type: ps.get("noise.type").value,
      family: ps.get("noise.family").value,
      scale: ps.get("noise.scale").value,
      octaves: ps.get("noise.octaves").value,
      lacunarity: ps.get("noise.lacunarity").value,
      gain: ps.get("noise.gain").value,
      swirl: ps.get('noise.swirl').value,
      ridge: ps.get('noise.ridge').value,
      speed: ps.get("noise.speed").value,
      offsetX: ps.get("noise.offsetX").value,
      offsetY: ps.get("noise.offsetY").value,
      contrast: ps.get("noise.contrast").value,
      sharpen: ps.get("noise.sharpen")?.value ?? 0,
      invert: ps.get("noise.invert").value,
      seed: ps.get("noise.seed").value,
      color: ps.get("noise.color").value,
      color1: _noiseColor1,
      color2: _noiseColor2,
      periodX: _seamlessPeriod ?? ps.get('noise.period.x').value,
      periodY: _seamlessPeriod ?? ps.get('noise.period.y').value,
      alpha:   ps.get('noise.alpha').value,
    });

    // Time-Displacement Engine — READ + PUBLISH before pipeline.render so
    // inputs.tdisp is consumable this frame. Ring WRITE happens after render
    // (beside videoDelay.capture). Engine gates internally on td.enabled.
    // Runs after noise generation so td.mode === "Noise" can sample this
    // frame's noiseTexture (non-null when _tdModeNoise forces _noiseUsed).
    tdEngine.tick(ps, dt, noiseTexture);

    // Render 3D scene if active OR used as a layer source
    const SCENE3D_IDX = 6; // index in SOURCES array
    const DEPTH3D_IDX = 20; // index in SOURCES array
    const depthUsed = _srcUsed(DEPTH3D_IDX);
    // Auto-enable depth pass when the depth3d source is routed
    if (depthUsed && !ps.get("scene3d.depth.active").value) {
      ps.set("scene3d.depth.active", 1);
    }
    const scene3dNeeded =
      ps.get("scene3d.active").value ||
      _srcUsed(SCENE3D_IDX) ||
      depthUsed || _analogSrcIdx === 4;
    // scene3d.getHypercube()?.setInstancerTexture(pipeline.prev.texture); — removed: SceneManager now owns instancer texture via _adoptMesh
    renderer.info.autoReset = false;
    renderer.info.reset();
    if (scene3dNeeded)
      scene3d.render(ps, dt, {
        camera: camera3d.active ? camera3d.currentTexture : null,
        movie: movieInput.active ? movieInput.currentTexture : null,
        screen: pipeline.prev.texture,
        draw: drawLayer.texture,
        buffer: stillsBuffer.texture,
        noise: noiseTexture,
        warpMaps,
        dispTex: _resolveLayerTex(ps.get('layer.ds')?.value ?? 0),
      });

    // Assemble input sources
    const inputs = {
      camera: camera3d.active ? camera3d.currentTexture : null,
      movie: movieInput.active ? movieInput.currentTexture : null,
      movieB: movieInputB.active ? movieInputB.currentTexture : null,
      buffer: stillsBuffer.texture,
      buffer2: stillsBuffer.texture2,
      bg1: stillsBuffer.bgTexture(0),
      bg2: stillsBuffer.bgTexture(1),
      scene3d: scene3dNeeded ? scene3d.texture : null,
      depth3d: depthUsed ? scene3d.depthTexture : null,
      color: colorTexture,
      color2: color2Texture,
      sound: soundTexture,
      noise: noiseTexture,
      draw: drawLayer.texture,
      text: textLayer.texture,
      delay: videoDelay.getTexture(ps.get("delay.frames").value),
      scope: vectorscope.texture,
      slitscan: slitScan.texture,
      vwarp: vasulkaWarp.outputRT.texture,
      particles: particles.texture,
      sdf: sdfGen.texture,
      analog: analogTV.texture,
      tdisp: tdEngine.texture,
      seq1: seq1.texture,
      seq2: seq2.texture,
      seq3: seq3.texture,
      warpMaps,
      // Not a texture — the MixBus render gate. Computed here because the
      // consumption analysis (layers + TimeDisplace) lives in main.js.
      mixbusNeeded: _mixbusNeeded,
    };

    // Stroboscope: on "off" phase, freeze output (skip pipeline, blit prev)
    const strobeOn = ps.get("effect.strobe").value;
    const strobeRate = ps.get("effect.stroberate").value;
    const strobeDuty = ps.get("effect.strobeduty").value / 100;
    if (strobeOn && strobeRate > 0) {
      strobePhase = (strobePhase + dt * strobeRate) % 1;
    }
    const strobeFreeze = strobeOn && strobePhase >= strobeDuty;

    // Update GLSL param uniforms
    pipeline.setCustomUniforms([
      ps.get("glsl.param1")?.normalized ?? 0,
      ps.get("glsl.param2")?.normalized ?? 0,
      ps.get("glsl.param3")?.normalized ?? 0,
      ps.get("glsl.param4")?.normalized ?? 0,
    ]);

    // VJ uniform contract — fill tAudio + beat/levels for the custom shader.
    // Gated on an active shader so it costs nothing otherwise; sound buffers
    // are refreshed by ctrl.tick() each frame (ControllerManager:133).
    if (pipeline._customActive) {
      const snd = ctrl.sound;
      if (snd) {
        if (!_vjAudioData) {
          _vjAudioData = new Uint8Array(256 * 2);
          _vjAudioTex = new THREE.DataTexture(
            _vjAudioData, 256, 2, THREE.RedFormat, THREE.UnsignedByteType,
          );
        }
        for (let i = 0; i < 256; i++) {
          _vjAudioData[i] = snd.freqBuf[i]; // row 0: FFT bins
          // row 1: waveform, 512 float samples decimated to 256 bytes
          const w = (snd.timeBuf[i * 2] * 0.5 + 0.5) * 255;
          _vjAudioData[256 + i] = w < 0 ? 0 : w > 255 ? 255 : w;
        }
        _vjAudioTex.needsUpdate = true;
        const bd = snd.beatDetector;
        const bpm = bd?.bpm ?? 0;
        const beat = bpm > 0 && bd._lastBeat > 0
          ? ((snd.ctx.currentTime - bd._lastBeat) * bpm / 60) % 1
          : 0;
        pipeline.setCustomVJ({
          audio: _vjAudioTex, bpm, beat,
          level: Math.min(1, snd.level * 4),
          bass: snd.bass, mid: snd.mid, high: snd.high,
        });
      } else {
        pipeline.setCustomVJ(null);
      }
    }

    // Run compositing pipeline
    if (!strobeFreeze) {
      pipeline.render(inputs, ps, dt);
    }

    // Capture output into video delay ring buffer
    videoDelay.capture(pipeline.prev.texture);

    // Time-Displacement Engine — ring WRITE. captureSource indexes the
    // canonical SOURCE_KEYS list. Most sources resolve via `inputs` (already
    // built above for pipeline.render this frame); "Output" reads
    // pipeline.prev.texture (post-composite feedback); "Mix Bus" reads the
    // MixBus target; "TimeDisp" reads TD's own output (recursive echo) — all
    // deliberate self-feedback. Write runs here (after render) so
    // Output/inputs reflect this frame's composite.
    // Conditionally-ticked sources (3D Scene, 3D Depth, SDF, Analog) are null
    // unless a layer also uses them this frame — capture() no-ops on null.
    const _tdKey = SOURCE_KEYS[ps.get("td.captureSource").value];
    const _tdSrc =
      _tdKey === "output" ? pipeline.prev.texture :
      _tdKey === "mixbus" ? pipeline.mixTexture   :
      (inputs[_tdKey] ?? null);
    if (ps.get('td.enabled').value) tdEngine.capture(_tdSrc);

    // Vasulka Warp — DEPRECATED: superseded by SequenceBuffer timewarp mode.
    // Kept for backward compatibility. Do not remove until timewarp mode is stable.
    if (ps.get("vwarp.active").value) {
      const speed = Math.round(ps.get("vwarp.speed").value) || 1;
      vasulkaWarp.applyParams(ps);
      vasulkaWarp.capture(
        camera3d.active ? camera3d.currentTexture : pipeline.prev.texture,
        speed,
      );
      vasulkaWarp.render(pipeline.prev.texture);
    }

    // Sequence timewarp render — updates outputRT for each seq in timewarp mode.
    // Runs after pipeline so pipeline.prev.texture contains this frame's output.
    // Follows VasulkaWarp.render() pattern: direct render, not Pipeline FX chain.
    [seq1, seq2, seq3].forEach((seq, i) => {
      if (seq.mode === "timewarp") {
        seq.renderTimewarp(pipeline.prev.texture, ps, i + 1);
      }
    });

    if (frameCount % 60 === 0) console.log('DC:', renderer.info.render.calls, 'Tri:', renderer.info.render.triangles);
    renderer.info.autoReset = true;

    // Profiler + debug overlay
    profiler.end();
    profiler.tick(pipeline, sequencerManager);
    debugOverlay.tick(profiler._fps);

    // Video Out Spy + Second Screen — createImageBitmap shared path
    const spyVisible =
      _spyCanvas &&
      !document.getElementById("video-spy")?.classList.contains("hidden");
    const outWinOpen = _outWin && !_outWin.closed && _outWinReady;
    // Second screen throttled to every 2nd frame (~30fps) to reduce GPU readback pressure
    const outWinDue = outWinOpen && ++_outFrameTick % 2 === 0;

    if (spyVisible || outWinDue) {
      // 2Display: resize bitmap before postMessage to reduce transfer cost
      const _owDims = _outWinResOpts[_outWinResIdx]?.dims;
      const _bitmapOpts = _owDims
        ? { resizeWidth: _owDims[0], resizeHeight: _owDims[1], resizeQuality: "medium" }
        : {};
      createImageBitmap(canvas, _bitmapOpts).then((bitmap) => {
        if (spyVisible) _spyCtx.drawImage(bitmap, 0, 0, 160, 90);
        if (outWinDue && !_outWin?.closed) {
          const _pmActive = ps.get("projmap.active").value;
          const _pmCorners = _pmActive
            ? {
                tl: {
                  x: ps.get("projmap.tl_x").value,
                  y: ps.get("projmap.tl_y").value,
                },
                tr: {
                  x: ps.get("projmap.tr_x").value,
                  y: ps.get("projmap.tr_y").value,
                },
                br: {
                  x: ps.get("projmap.br_x").value,
                  y: ps.get("projmap.br_y").value,
                },
                bl: {
                  x: ps.get("projmap.bl_x").value,
                  y: ps.get("projmap.bl_y").value,
                },
              }
            : null;
          _outWin.postMessage({ bitmap, corners: _pmCorners }, "*", [bitmap]);
        } else {
          bitmap.close();
        }
      });
    }

    // ── Warp Grid Overlay ───────────────────────────────────────────────────
    const warpGridOn = ps.get("global.showwarpgrid").value;
    const overlayCvs = document.getElementById("warp-grid-overlay");
    const overlayCtx = overlayCvs?.getContext("2d");
    if (overlayCtx) {
      if (!warpGridOn) {
        overlayCtx.clearRect(0, 0, overlayCvs.width, overlayCvs.height);
      } else {
        if (
          overlayCvs.width !== canvasRect.width ||
          overlayCvs.height !== canvasRect.height
        ) {
          overlayCvs.width = canvasRect.width;
          overlayCvs.height = canvasRect.height;
        }
        const w = overlayCvs.width,
          h = overlayCvs.height;
        overlayCtx.clearRect(0, 0, w, h);
        overlayCtx.strokeStyle = "rgba(0, 255, 255, 0.35)";
        overlayCtx.lineWidth = 1;
        const cols = warpEditor.cols,
          rows = warpEditor.rows;
        // Y is flipped (1 - v) to match the map: DataTexture defaults to
        // flipY:false, so control row 0 renders at the BOTTOM of the output.
        // Drawn y-down, this overlay was an upside-down picture of the warp it
        // claims to show. The flip has to wrap (nj + dy), not just nj — flipping
        // the node but not its displacement would put the lines in the right
        // places while bulging them the wrong way.
        // Horizontal lines
        for (let j = 0; j < rows; j++) {
          overlayCtx.beginPath();
          for (let i = 0; i < cols; i++) {
            const ni = i / (cols - 1),
              nj = j / (rows - 1);
            const { dx, dy } = warpEditor.dispAt(ni, nj);
            overlayCtx.lineTo((ni + dx) * w, (1 - (nj + dy)) * h);
          }
          overlayCtx.stroke();
        }
        // Vertical lines
        for (let i = 0; i < cols; i++) {
          overlayCtx.beginPath();
          for (let j = 0; j < rows; j++) {
            const ni = i / (cols - 1),
              nj = j / (rows - 1);
            const { dx, dy } = warpEditor.dispAt(ni, nj);
            overlayCtx.lineTo((ni + dx) * w, (1 - (nj + dy)) * h);
          }
          overlayCtx.stroke();
        }
      }
    }

    // FrameDonePulse — send MIDI CC pulse on frame completion (Phase 5)
    if (ps.get("global.framedone").value && ctrl.midi) {
      // Send CC 120 (unassigned) pulse on channel 16
      ctrl.sendCC(16, 120, 127);
      setTimeout(() => ctrl.sendCC(16, 120, 0), 5); // short 5ms pulse
    }
  }

  requestAnimationFrame(render);

  // ── AI Features ───────────────────────────────────────────────────────────

  // ── AI Settings panel ─────────────────────────────────────────────────────
  (() => {
    const panel = document.createElement("div");
    panel.id = "ai-settings-panel";
    panel.className = "ai-settings-panel hidden";
    document.body.appendChild(panel);

    const aiFeatures = new AIFeatures(ps, null); // UI.js handles its own building

    import("./ui/UI.js").then((UI) => {
      UI.buildAISettingsPanel(aiFeatures, panel);
    });

    document
      .getElementById("btn-ai-settings")
      ?.addEventListener("click", (e) => {
        panel.classList.toggle("hidden");
        e.stopPropagation();
      });

    document.addEventListener("click", (e) => {
      if (!panel.contains(e.target) && e.target.id !== "btn-ai-settings" && e.target.id !== "ai-settings-btn-inline") {
        panel.classList.add("hidden");
      }
    });
  })();

  // ── Feature 1: AI State Generator ─────────────────────────────────────────
  (() => {
    const container = document.getElementById("ai-preset-ui");
    if (!container) return;

    container.innerHTML = `
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:10px;color:var(--text-2);font-family:var(--mono);">
          AI State Generator — describe a visual mood or look:
        </div>
        <textarea id="ai-preset-input" class="ai-text-input"
          placeholder="e.g. slow organic ocean, aggressive glitch rhythm, dreamy feedback vortex…"
          rows="2"></textarea>
        <div style="display:flex;gap:4px;">
          <button id="ai-preset-btn" class="import-btn" style="flex:1;">✦ Generate State</button>
          <button id="ai-settings-btn-inline" class="import-btn" title="API Settings">⚙ API</button>
        </div>
        <div id="ai-preset-result" class="ai-result hidden"></div>
      </div>
    `;

    document
      .getElementById("ai-preset-btn")
      ?.addEventListener("click", async () => {
        const input = document.getElementById("ai-preset-input");
        const result = document.getElementById("ai-preset-result");
        const btn = document.getElementById("ai-preset-btn");
        const desc = input.value.trim();
        if (!desc) return;

        if (!getApiKey()) {
          result.textContent = "⚠ No API key set — click ⚙ in the status bar.";
          result.classList.remove("hidden");
          return;
        }

        btn.textContent = "⏳ Generating…";
        btn.disabled = true;
        result.classList.add("hidden");

        try {
          const { params, explanation } = await generatePreset(desc);
          // Apply parameters
          let applied = 0;
          for (const [id, val] of Object.entries(params)) {
            const p = ps.get(id);
            if (p) {
              ps.set(id, val);
              applied++;
            }
          }
          result.textContent = `✦ ${explanation} (${applied} params set)`;
          result.classList.remove("hidden");
          result.style.color = "";
        } catch (err) {
          result.textContent =
            err.message === "no-key"
              ? "⚠ No API key — click ⚙ in the status bar."
              : `✗ ${err.message}`;
          result.classList.remove("hidden");
          result.style.color = "var(--red, #e05)";
        } finally {
          btn.textContent = "✦ Generate State";
          btn.disabled = false;
        }
      });

    document.getElementById("ai-settings-btn-inline")?.addEventListener("click", (e) => {
      document.getElementById("ai-settings-panel")?.classList.toggle("hidden");
      e.stopPropagation();
    });
  })();

  // ── Feature 2: Parameter Narrator ─────────────────────────────────────────
  let _narratorActive = false;
  let _narratorTimer = null;
  const _narratorOverlay = document.getElementById("ai-narrator-overlay");

  async function _runNarrator() {
    if (!_narratorActive) return;
    try {
      const snapshot = buildStateSnapshot(ps);
      const text = await narrateState(snapshot, getNarratorConfig().length);
      if (_narratorOverlay && _narratorActive) {
        _narratorOverlay.textContent = text;
      }
    } catch (err) {
      /* silent — narrator is non-critical */
    }
    if (_narratorActive) {
      _narratorTimer = setTimeout(_runNarrator, getNarratorConfig().interval);
    }
  }

  function _toggleNarrator() {
    _narratorActive = !_narratorActive;
    const btn = document.getElementById("btn-ai-narrator");
    btn?.classList.toggle("active", _narratorActive);
    if (_narratorOverlay)
      _narratorOverlay.classList.toggle("hidden", !_narratorActive);
    if (_narratorActive) {
      if (!getApiKey()) {
        _narratorOverlay &&
          (_narratorOverlay.textContent = "⚠ No API key — click ⚙");
      } else {
        _runNarrator();
      }
    } else {
      clearTimeout(_narratorTimer);
    }
  }

  document
    .getElementById("btn-ai-narrator")
    ?.addEventListener("click", _toggleNarrator);

  // ── Feature 3: Performance Coach ──────────────────────────────────────────
  let _coachActive = false;
  let _coachTimer = null;
  const _recentChanges = []; // { id, t } — last 30 seconds of param changes
  let _coachNotif = null;

  // Track parameter changes for coach — register per-param listeners on all params
  {
    const _trackChange = (id) => {
      const now = Date.now();
      _recentChanges.push({ id, t: now });
      const cutoff = now - 30000;
      while (_recentChanges.length > 0 && _recentChanges[0].t < cutoff)
        _recentChanges.shift();
    };
    for (const param of ps.getAll()) {
      param.onChange(() => _trackChange(param.id));
    }
  }

  let _coachNotifFadeTimer = null;
  function _showCoachNotif(text) {
    if (!_coachNotif) {
      _coachNotif = document.createElement("div");
      _coachNotif.id = "ai-coach-notif";
      _coachNotif.className = "ai-coach-notif";
      document.body.appendChild(_coachNotif);
    }
    _coachNotif.textContent = `⬡ ${text}`;
    _coachNotif.style.opacity = "1";
    // Crisp transient flash (was 10s — lingered over the UI). Clear any
    // pending fade so a fresh message isn't hidden by a stale timer.
    clearTimeout(_coachNotifFadeTimer);
    _coachNotifFadeTimer = setTimeout(() => {
      _coachNotif.style.opacity = "0";
    }, 2500);
  }

  async function _runCoach() {
    if (!_coachActive) return;
    try {
      const snapshot = buildActivitySnapshot(_recentChanges, ps);
      const text = await coachSuggestion(snapshot);
      if (_coachActive) {
        _showCoachNotif(text || '⚠ Coach: empty response from AI — try a different model');
      }
    } catch (err) {
      console.error('[Coach] error:', err);
      if (_coachActive) _showCoachNotif(`⚠ Coach error: ${err.message}`);
    }
    if (_coachActive) {
      _coachTimer = setTimeout(_runCoach, getCoachConfig().interval);
    }
  }

  function _toggleCoach() {
    _coachActive = !_coachActive;
    const btn = document.getElementById("btn-ai-coach");
    btn?.classList.toggle("active", _coachActive);
    if (_coachActive) {
      if (!getApiKey()) {
        _showCoachNotif("⚠ No API key — click ⚙ in status bar");
      } else {
        const interval = getCoachConfig().interval;
        _showCoachNotif(`Performance Coach active — watching for ${Math.round(interval / 1000)}s…`);
        _coachTimer = setTimeout(_runCoach, interval);
      }
    } else {
      clearTimeout(_coachTimer);
    }
  }

  document
    .getElementById("btn-ai-coach")
    ?.addEventListener("click", _toggleCoach);

  // Keyboard shortcuts for narrator (n) and coach (p)
  // Lowercase only — ⇧P is already bound to the Signal Path panel toggle,
  // and matching that with the Coach shortcut fired both at once.
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    if (e.metaKey || e.ctrlKey || e.shiftKey) return;
    if (e.key === "n") _toggleNarrator();
    if (e.key === "p") _toggleCoach();
  });

  console.log(
    "%cImWeb ready — press V to start camera, 3D tab for scene",
    "color:#9090a8",
  );

  // Register service worker for PWA / offline support — PRODUCTION ONLY.
  // sw.js is cache-first for the app shell (style.css, main.js); in dev its
  // install fetch gets Vite's JS-module rendition of style.css and serves it
  // to the <link> tag on later loads → unstyled app, stale code on devices.
  if ("serviceWorker" in navigator) {
    if (import.meta.env.PROD) {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    } else {
      // Dev: actively remove any previously-installed worker and its caches
      // so cache-first app-shell copies can't shadow the dev server
      navigator.serviceWorker
        .getRegistrations()
        .then((rs) => rs.forEach((r) => r.unregister()))
        .catch(() => {});
      caches?.keys?.().then((ks) => ks.forEach((k) => caches.delete(k))).catch(() => {});
    }
  }

  // ── Dev Capture Modal (Ctrl+Cmd+C) ───────────────────────────────────────
  // Sends screenshot + audio + state JSON to dev-catcher.js on :5174.
  // Only active during development; harmless if :5174 is not running.

  let _dcRecorder = null;
  let _dcChunks = [];
  let _dcStream = null;
  let _dcVisible = false;

  const _dcModal = document.createElement("div");
  _dcModal.id = "dev-capture-modal";
  Object.assign(_dcModal.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(18,18,26,0.92)",
    border: "1px solid #3a3a50",
    borderRadius: "8px",
    padding: "12px 18px",
    display: "none",
    flexDirection: "column",
    gap: "8px",
    width: "340px",
    zIndex: "99999",
    fontFamily: "monospace",
    fontSize: "12px",
    color: "var(--text-1, #e0e0f0)",
    backdropFilter: "blur(6px)",
    boxShadow: "0 4px 24px rgba(0,0,0,0.6)",
    userSelect: "none",
  });

  const _dcLabel = document.createElement("span");
  _dcLabel.textContent = "Dev Capture";
  _dcLabel.style.cssText = "color:var(--text-2,#8888a0);font-size:11px;";

  const _dcBtn = document.createElement("button");
  _dcBtn.textContent = "Start Recording";
  Object.assign(_dcBtn.style, {
    background: "var(--accent,#c8a020)",
    color: "#12121a",
    border: "none",
    borderRadius: "4px",
    padding: "4px 12px",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "12px",
    fontWeight: "700",
  });

  const _dcStatus = document.createElement("span");
  _dcStatus.style.cssText =
    "color:var(--accent,#c8a020);font-size:11px;min-width:60px;";

  const _dcClose = document.createElement("button");
  _dcClose.textContent = "✕";
  Object.assign(_dcClose.style, {
    background: "transparent",
    border: "none",
    color: "var(--text-2,#8888a0)",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "14px",
    padding: "0 2px",
  });

  const _dcNotes = document.createElement("textarea");
  _dcNotes.placeholder = "Quick notes…";
  Object.assign(_dcNotes.style, {
    width: "100%",
    height: "64px",
    background: "rgba(255,255,255,0.05)",
    border: "1px solid #3a3a50",
    borderRadius: "4px",
    color: "var(--text-1,#e0e0f0)",
    fontFamily: "monospace",
    fontSize: "11px",
    padding: "6px 8px",
    resize: "vertical",
    boxSizing: "border-box",
  });

  const _dcSendBtn = document.createElement("button");
  _dcSendBtn.textContent = "Send Note";
  Object.assign(_dcSendBtn.style, {
    background: "transparent",
    color: "var(--accent,#c8a020)",
    border: "1px solid var(--accent,#c8a020)",
    borderRadius: "4px",
    padding: "4px 10px",
    cursor: "pointer",
    fontFamily: "monospace",
    fontSize: "12px",
    fontWeight: "700",
  });

  const _dcRow = document.createElement("div");
  Object.assign(_dcRow.style, {
    display: "flex",
    alignItems: "center",
    gap: "12px",
  });
  _dcRow.append(_dcLabel, _dcBtn, _dcSendBtn, _dcStatus, _dcClose);

  _dcModal.append(_dcNotes, _dcRow);
  document.body.appendChild(_dcModal);

  function _dcOpen() {
    if (_dcVisible) return;
    _dcVisible = true;
    _dcModal.style.display = "flex";
    _dcBtn.textContent = "Start Recording";
    _dcStatus.textContent = "";
  }

  function _dcClose2() {
    _dcVisible = false;
    _dcModal.style.display = "none";
    if (_dcRecorder && _dcRecorder.state !== "inactive") _dcRecorder.stop();
    _dcStream?.getTracks().forEach((t) => t.stop());
    _dcRecorder = null;
    _dcStream = null;
    _dcChunks = [];
    _dcBtn.textContent = "Start Recording";
    _dcBtn.disabled = false;
    _dcSendBtn.disabled = false;
    _dcStatus.textContent = "";
    _dcStatus.style.color = "var(--accent,#c8a020)";
    _dcNotes.value = "";
  }

  _dcClose.addEventListener("click", _dcClose2);

  _dcBtn.addEventListener("click", async () => {
    if (_dcBtn.textContent === "Start Recording") {
      // — Grab canvas snapshot immediately
      const cvs = document.getElementById("output-canvas");
      const imgDataUrl = cvs.toDataURL("image/png");

      // — Capture current parameter state
      const stateObj = {};
      ps.getAll().forEach((p) => {
        stateObj[p.id] = p.value;
      });

      // — Start audio recording
      try {
        _dcStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        _dcChunks = [];
        _dcRecorder = new MediaRecorder(_dcStream);
        _dcRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) _dcChunks.push(e.data);
        };

        // Store snapshot + state on the recorder for use in onstop
        _dcRecorder._imgDataUrl = imgDataUrl;
        _dcRecorder._stateObj = stateObj;

        _dcRecorder.onstop = async () => {
          _dcStatus.textContent = "Sending…";
          try {
            const audioBlob = new Blob(_dcChunks, { type: "audio/webm" });
            const imgBlob = await fetch(_dcRecorder._imgDataUrl).then((r) =>
              r.blob(),
            );
            const stateBlob = new Blob(
              [JSON.stringify(_dcRecorder._stateObj, null, 2)],
              { type: "application/json" },
            );

            const fd = new FormData();
            const notesBlob = new Blob([_dcNotes.value], {
              type: "text/plain",
            });
            fd.append("files", imgBlob, "screenshot.png");
            fd.append("files", audioBlob, "audio.webm");
            fd.append("files", stateBlob, "state.json");
            fd.append("files", notesBlob, "notes.txt");

            await fetch("http://localhost:5174/capture", {
              method: "POST",
              body: fd,
            });
            _dcStatus.textContent = "Saved!";
            setTimeout(_dcClose2, 1500);
          } catch (err) {
            console.error("Capture delivery failed:", err);
            _dcStatus.textContent = "Error :(";
          }
        };

        _dcRecorder.start();
        _dcBtn.textContent = "Stop & Save";
        _dcStatus.textContent = "● REC";
        _dcStatus.style.color = "#e84040";
      } catch (err) {
        console.warn("[DevCapture] mic denied:", err);
        _dcStatus.textContent = "No mic";
      }
    } else {
      // Stop recording — onstop handler fires async and sends
      _dcStatus.style.color = "var(--accent,#c8a020)";
      _dcBtn.disabled = true;
      _dcRecorder?.stop();
      _dcStream?.getTracks().forEach((t) => t.stop());
    }
  });

  _dcSendBtn.addEventListener("click", async () => {
    _dcSendBtn.disabled = true;
    _dcStatus.textContent = "Sending…";
    _dcStatus.style.color = "var(--accent,#c8a020)";
    try {
      const cvs = document.getElementById("output-canvas");
      const imgBlob = await fetch(cvs.toDataURL("image/png")).then((r) =>
        r.blob(),
      );
      const stateObj = {};
      ps.getAll().forEach((p) => {
        stateObj[p.id] = p.value;
      });
      const stateBlob = new Blob([JSON.stringify(stateObj, null, 2)], {
        type: "application/json",
      });
      const notesBlob = new Blob([_dcNotes.value], { type: "text/plain" });

      const fd = new FormData();
      fd.append("files", imgBlob, "screenshot.png");
      fd.append("files", stateBlob, "state.json");
      fd.append("files", notesBlob, "notes.txt");

      await fetch("http://localhost:5174/capture", {
        method: "POST",
        body: fd,
      });
      _dcStatus.textContent = "Saved!";
      setTimeout(_dcClose2, 1500);
    } catch (err) {
      console.error("Capture delivery failed:", err);
      _dcStatus.textContent = "Error :(";
      _dcSendBtn.disabled = false;
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
      e.preventDefault();
      _dcVisible ? _dcClose2() : _dcOpen();
    }
  });

  // Auto-load all clips from _imweb_ready/manifest.json on startup
  try {
    const res = await fetch("/_imweb_ready/manifest.json");
    if (res.ok) {
      const { clips } = await res.json();
      for (const name of clips) {
        try {
          await movieInput.addClip(`/_imweb_ready/${encodeURIComponent(name)}`);
        } catch (e) {
          console.warn(`[ImWeb] Could not load clip "${name}":`, e.message);
        }
      }
      refreshClipsList();
      console.info(
        `[ImWeb] Loaded ${movieInput.clips.length} clip(s) from _imweb_ready/`,
      );
    }
  } catch (e) {
    console.warn(
      "[ImWeb] No _imweb_ready manifest found — add clips manually.",
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities
// ─────────────────────────────────────────────────────────────────────────────

function hsvToHex(h, s, v) {
  const f = (n, k = (n + h * 6) % 6) =>
    v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
  const r = Math.round(f(5) * 255);
  const g = Math.round(f(3) * 255);
  const b = Math.round(f(1) * 255);
  return `rgb(${r},${g},${b})`;
}

// ── Virtual keyboard (iPad key-controller input) ───────────────────────────
function buildVirtualKeyboard() {
  const panel = document.createElement("div");
  panel.id = "vkbd-panel";
  panel.classList.add("hidden");

  const handle = document.createElement("div");
  handle.className = "vkbd-handle";
  handle.textContent = "⌨ Virtual Keyboard — drag to move";
  panel.appendChild(handle);

  const rows = [
    [
      ["Esc", "Escape"],
      ["F1", "F1"],
      ["F2", "F2"],
      ["F3", "F3"],
      ["F4", "F4"],
      ["F5", "F5"],
      ["F6", "F6"],
      ["F7", "F7"],
      ["F8", "F8"],
    ],
    [
      ["`", "`"],
      ["1", "1"],
      ["2", "2"],
      ["3", "3"],
      ["4", "4"],
      ["5", "5"],
      ["6", "6"],
      ["7", "7"],
      ["8", "8"],
      ["9", "9"],
      ["0", "0"],
      ["-", "-"],
      ["=", "="],
      ["⌫", "Backspace"],
    ],
    [
      ["Tab", "Tab"],
      ["q", "q"],
      ["w", "w"],
      ["e", "e"],
      ["r", "r"],
      ["t", "t"],
      ["y", "y"],
      ["u", "u"],
      ["i", "i"],
      ["o", "o"],
      ["p", "p"],
      ["[", "["],
      ["]", "]"],
      ["↵", "Enter"],
    ],
    [
      ["Caps", "CapsLock"],
      ["a", "a"],
      ["s", "s"],
      ["d", "d"],
      ["f", "f"],
      ["g", "g"],
      ["h", "h"],
      ["j", "j"],
      ["k", "k"],
      ["l", "l"],
      [";", ";"],
      ["'", "'"],
    ],
    [
      ["⇧", "Shift"],
      ["z", "z"],
      ["x", "x"],
      ["c", "c"],
      ["v", "v"],
      ["b", "b"],
      ["n", "n"],
      ["m", "m"],
      [",", ","],
      [".", "."],
      ["/", "/"],
    ],
    [
      ["Ctrl", "Control"],
      ["Alt", "Alt"],
      ["⎵", " "],
      ["←", "ArrowLeft"],
      ["↓", "ArrowDown"],
      ["↑", "ArrowUp"],
      ["→", "ArrowRight"],
    ],
  ];

  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "vkbd-row";
    row.forEach(([label, key]) => {
      const btn = document.createElement("button");
      btn.className = "vkbd-key";
      btn.textContent = label;
      if (label.length > 2) btn.classList.add("vkbd-key-wide");
      if (key === " ") btn.classList.add("vkbd-key-xl");
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault(); // never steal focus from a field being edited
        btn.classList.add("pressed");
        // When a text field has focus (e.g. the param value editor), TYPE
        // into it: synthetic KeyboardEvents on document never insert text
        // into inputs, so digits vanished and app shortcuts could fire.
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
          if (key === "Enter" || key === "Escape") {
            // route to the field's own handlers (commit / cancel)
            el.dispatchEvent(
              new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
            );
          } else if (key === "Backspace") {
            const s = el.selectionStart ?? el.value.length;
            const en = el.selectionEnd ?? el.value.length;
            if (s !== en) el.setRangeText("", s, en, "end");
            else if (s > 0) el.setRangeText("", s - 1, s, "end");
            el.dispatchEvent(new Event("input", { bubbles: true }));
          } else if (key.length === 1) {
            // replaces the selection (the editors open with value selected)
            el.setRangeText(
              key,
              el.selectionStart ?? el.value.length,
              el.selectionEnd ?? el.value.length,
              "end",
            );
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
          return;
        }
        document.dispatchEvent(
          new KeyboardEvent("keydown", {
            key,
            bubbles: true,
            cancelable: true,
          }),
        );
      });
      btn.addEventListener("pointerup", () => {
        btn.classList.remove("pressed");
        // Typed into a focused field on pointerdown — no app-level keyup
        const el = document.activeElement;
        if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
        document.dispatchEvent(
          new KeyboardEvent("keyup", { key, bubbles: true, cancelable: true }),
        );
      });
      btn.addEventListener("pointercancel", () =>
        btn.classList.remove("pressed"),
      );
      rowEl.appendChild(btn);
    });
    panel.appendChild(rowEl);
  });

  // Drag to reposition
  let _dragX = 0,
    _dragY = 0,
    _panelX = 0,
    _panelY = 0,
    _dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    _dragging = true;
    _dragX = e.clientX;
    _dragY = e.clientY;
    const r = panel.getBoundingClientRect();
    _panelX = r.left;
    _panelY = r.top;
    handle.setPointerCapture(e.pointerId);
    panel.style.transform = "none";
    panel.style.left = _panelX + "px";
    panel.style.top = _panelY + "px";
    panel.style.bottom = "auto";
  });
  handle.addEventListener("pointermove", (e) => {
    if (!_dragging) return;
    panel.style.left = _panelX + e.clientX - _dragX + "px";
    panel.style.top = _panelY + e.clientY - _dragY + "px";
  });
  handle.addEventListener("pointerup", () => {
    _dragging = false;
  });

  document.body.appendChild(panel);
  return panel;
}

// Show virtual keyboard button only on touch-capable devices
if (window.matchMedia("(pointer: coarse)").matches) {
  const btnVkbd = document.getElementById("btn-vkbd");
  if (btnVkbd) {
    btnVkbd.style.display = "";
    let _vkbdPanel = null;
    btnVkbd.addEventListener("click", () => {
      if (!_vkbdPanel) _vkbdPanel = buildVirtualKeyboard();
      _vkbdPanel.classList.toggle("hidden");
      btnVkbd.classList.toggle(
        "active",
        !_vkbdPanel.classList.contains("hidden"),
      );
    });
  }
}

// Live-performance guard: an accidental swipe-back / Cmd+W / reload mid-gig
// kills the WebGL context and the output. Ask before leaving. Browsers only
// show the dialog after user interaction (sticky activation), so automated
// dev reloads before any click are unaffected. iOS Safari/WebKit ignores
// beforeunload entirely — there the CSS overscroll-behavior lockdown is the
// only in-page defense against gesture navigation.
window.addEventListener("beforeunload", (e) => {
  e.preventDefault();
  e.returnValue = ""; // legacy Chrome requires returnValue to show the prompt
});

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("[ImWeb] Fatal startup error:", err);
  document.body.innerHTML = `
    <div style="position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
                background:#0a0a0b;color:#e84040;font-family:monospace;padding:40px;text-align:center">
      <div>
        <h1 style="font-size:20px;margin-bottom:16px">ImWeb — Startup Error</h1>
        <pre style="font-size:13px;color:#9090a8;text-align:left;background:#111114;padding:16px;border-radius:4px">
${err.stack ?? err.message}</pre>
        <p style="margin-top:16px;color:#585868;font-size:12px">
          Check the browser console for details.<br>
          Ensure you are running on localhost with a modern browser (Chrome recommended).
        </p>
      </div>
    </div>
  `;
});
