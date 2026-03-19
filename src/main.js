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

import * as THREE from 'three';
import { ParameterSystem, registerCoreParameters, setTableManager } from './controls/ParameterSystem.js';
import { tableManager } from './state/TableManager.js';
import { ControllerManager } from './controls/ControllerManager.js';
import { Automation }      from './controls/Automation.js';
import { StepSequencer }   from './controls/StepSequencer.js';
import { CameraInput }    from './inputs/CameraInput.js';
import { MovieInput }     from './inputs/MovieInput.js';
import { StillsBuffer }   from './inputs/StillsBuffer.js';
import { SequenceBuffer } from './inputs/SequenceBuffer.js';
import { VideoDelayLine }    from './inputs/VideoDelayLine.js';
import { VectorscopeInput }  from './inputs/VectorscopeInput.js';
import { SlitScanBuffer }    from './inputs/SlitScanBuffer.js';
import { ParticleSystem }    from './inputs/ParticleSystem.js';
import { DrawLayer }      from './inputs/DrawLayer.js';
import { TextLayer }      from './inputs/TextLayer.js';
import { buildWarpMaps }  from './inputs/WarpMaps.js';
import { WarpMapEditor } from './inputs/WarpMapEditor.js';
import { SceneManager } from './scene3d/SceneManager.js';
import { Pipeline } from './core/Pipeline.js';
import { PresetManager, openDB } from './state/Preset.js';
import { OSCBridge }    from './io/OSCBridge.js';
import { ProjectFile }  from './io/ProjectFile.js';
import { importImX }    from './io/ImXImporter.js';
import { parseCubeFile } from './io/CubeLoader.js';
import {
  initTabs,
  buildLayerButtons,
  buildMappingPanels,
  buildSeqParams,
  buildGeometryButtons,
  buildWarpEditor,
  StateDots,
  SignalPath,
  ContextMenu,
  FeedbackOverlay,
  PresetsPanel,
  FPSDisplay,
  DebugOverlay,
  TablesEditor,
} from './ui/UI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('%cImWeb v0.3.0', 'color:#e8c840;font-weight:bold;font-size:14px');

  // ── 1. Canvas & renderer ──────────────────────────────────────────────────

  const canvas = document.getElementById('output-canvas');

  // Detect WebGPU
  const hasWebGPU = !!navigator.gpu;
  console.info(`[Renderer] WebGPU: ${hasWebGPU ? '✓' : '✗ (using WebGL)'}`);

  // Three.js WebGL renderer (Phase 1 baseline; WebGPU compositor in Phase 2)
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,    // off for performance — we do our own AA if needed
    alpha: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true, // needed for canvas.toBlob() capture
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.autoClear = false;

  // Initial size
  let W = canvas.parentElement.clientWidth;
  let H = canvas.parentElement.clientHeight;
  renderer.setSize(W, H);

  // ── 2. Parameter system ───────────────────────────────────────────────────

  const ps = new ParameterSystem();
  registerCoreParameters(ps);

  // ── 3. Controllers ────────────────────────────────────────────────────────

  const ctrl = new ControllerManager(ps);
  const automation    = new Automation(ps);

  // ── 4. Input sources ──────────────────────────────────────────────────────

  const camera3d = new CameraInput();
  await camera3d.init();

  const movieInput = new MovieInput();

  const stillsBuffer  = new StillsBuffer(renderer, W, H);
  const seq1 = new SequenceBuffer(renderer, W, H, 60);
  const seq2 = new SequenceBuffer(renderer, W, H, 60);
  const seq3 = new SequenceBuffer(renderer, W, H, 60);
  const videoDelay    = new VideoDelayLine(renderer, W, H, 30);
  const vectorscope   = new VectorscopeInput();
  const slitScan      = new SlitScanBuffer(W, H);
  const particles     = new ParticleSystem(renderer, W, H);
  const warpMaps     = buildWarpMaps(); // 8 procedural warp map textures (map1–map8)
  const warpEditor   = new WarpMapEditor(); // interactive editor → warpMaps[8] (Custom)
  warpMaps.push(warpEditor.texture);        // index 9 in SELECT = warpMaps[8]
  const drawLayer    = new DrawLayer();
  const textLayer    = new TextLayer();

  const scene3d = new SceneManager(renderer, W, H);

  // Color input — generates a solid color texture from HSV params
  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = colorCanvas.height = 4;
  const colorCtx = colorCanvas.getContext('2d');
  const colorTexture = new THREE.CanvasTexture(colorCanvas);

  function updateColorTexture() {
    const h = ps.get('color1.hue').value / 100;
    const s = ps.get('color1.sat').value / 100;
    const v = ps.get('color1.val').value / 100;
    colorCtx.fillStyle = hsvToHex(h, s, v);
    colorCtx.fillRect(0, 0, 4, 4);
    colorTexture.needsUpdate = true;
  }
  ['color1.hue','color1.sat','color1.val'].forEach(id => ps.get(id).onChange(updateColorTexture));
  updateColorTexture();

  // Color2 input — solid or gradient source (between color1 and color2)
  const color2Canvas = document.createElement('canvas');
  color2Canvas.width = color2Canvas.height = 256;
  const color2Ctx = color2Canvas.getContext('2d');
  const color2Texture = new THREE.CanvasTexture(color2Canvas);

  // Phase accumulator for Color2 gradient animation (driven by color2.speed)
  let _color2Phase = 0;

  function updateColor2Texture() {
    // Only apply phase offset when speed is non-zero (avoid permanent hue shift after stopping)
    const _phaseActive = (ps.get('color2.speed')?.value ?? 0) !== 0;
    const phaseOff = _phaseActive ? ((_color2Phase % 1) + 1) % 1 : 0;
    const h1 = ((ps.get('color1.hue').value / 100) + phaseOff + 1) % 1;
    const s1 = ps.get('color1.sat').value / 100;
    const v1 = ps.get('color1.val').value / 100;
    const h2 = ((ps.get('color2.hue').value / 100) + phaseOff + 1) % 1;
    const s2 = ps.get('color2.sat').value / 100;
    const v2 = ps.get('color2.val').value / 100;
    const type = ps.get('color2.type').value;
    const c1   = hsvToHex(h1, s1, v1);
    const c2   = hsvToHex(h2, s2, v2);
    const W    = color2Canvas.width;
    const H    = color2Canvas.height;

    if (type === 0) { // Solid
      color2Ctx.fillStyle = c2;
      color2Ctx.fillRect(0, 0, W, H);
    } else if (type === 1) { // Horizontal gradient
      const grad = color2Ctx.createLinearGradient(0, 0, W, 0);
      grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    } else if (type === 2) { // Vertical gradient
      const grad = color2Ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    } else { // Radial gradient
      const grad = color2Ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, W/2);
      grad.addColorStop(0, c1); grad.addColorStop(1, c2);
      color2Ctx.fillStyle = grad;
      color2Ctx.fillRect(0, 0, W, H);
    }
    color2Texture.needsUpdate = true;
  }
  ['color1.hue','color1.sat','color1.val','color2.hue','color2.sat','color2.val','color2.type'].forEach(id =>
    ps.get(id).onChange(updateColor2Texture)
  );
  updateColor2Texture();

  // Noise texture — generated each frame on GPU via pipeline.generateNoise()
  let noiseTexture = null; // set in render loop after first pipeline call

  // Sound level texture — 1×1 greyscale, used when DS source = Sound
  const soundData    = new Uint8Array([0, 0, 0, 255]);
  const soundTexture = new THREE.DataTexture(soundData, 1, 1, THREE.RGBAFormat);
  soundTexture.needsUpdate = true;

  // ── 5. Pipeline ───────────────────────────────────────────────────────────

  const pipeline = new Pipeline(renderer, W, H);

  // Default startup state: FG=Color, BG=Color, DS=Noise
  // Camera (index 0) is only routed when actually started
  ps.set('layer.fg', 3); // Color
  ps.set('layer.bg', 3); // Color
  ps.set('layer.ds', 4); // Noise

  // ── 6. Preset manager + Table manager ────────────────────────────────────

  const presetMgr = new PresetManager(ps, ctrl, pipeline);
  await presetMgr.init();
  const stepSequencer = new StepSequencer(presetMgr);

  // MIDI Program Change → preset recall (PC 0–127 maps to preset index)
  ctrl.onMIDIPC = pcNum => presetMgr.activatePreset(pcNum);

  // Wire tableManager into ParameterSystem so controller setNormalized() applies curves
  setTableManager(tableManager);
  await tableManager.init(await openDB());

  // ── BPM / Tap Tempo ───────────────────────────────────────────────────────
  const bpmEl = document.getElementById('status-bpm');
  ps.get('global.bpm').onChange(bpm => {
    ctrl.syncBPM(bpm);
    if (bpmEl) bpmEl.textContent = `${Math.round(bpm)} bpm`;
  });
  // Click BPM indicator = tap tempo; right-click = toggle MIDI clock sync
  bpmEl?.addEventListener('click', e => {
    if (e.button !== 0) return;
    ps.trigger('global.tap');
  });
  bpmEl?.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (ctrl._midiClockEnabled) {
      ctrl.disableMIDIClock();
      bpmEl.title = 'Click: tap tempo | Right-click: enable MIDI clock';
      bpmEl.style.outline = '';
    } else {
      ctrl.enableMIDIClock(bpm => {
        ps.set('global.bpm', bpm);
      });
      bpmEl.title = 'MIDI clock sync ON — right-click to disable';
      bpmEl.style.outline = '1px solid var(--accent)';
    }
  });

  const _tapTimes = [];
  ps.get('global.tap').onTrigger(() => {
    ctrl.retriggerLFOs(); // sync all LFOs to the beat
    const now = performance.now();
    _tapTimes.push(now);
    if (_tapTimes.length > 5) _tapTimes.shift();
    if (_tapTimes.length >= 2) {
      let sum = 0;
      for (let i = 1; i < _tapTimes.length; i++) sum += _tapTimes[i] - _tapTimes[i - 1];
      const avgMs  = sum / (_tapTimes.length - 1);
      const newBpm = Math.round(60000 / avgMs);
      ps.set('global.bpm', Math.max(20, Math.min(300, newBpm)));
    }
    // Reset if gap > 3 seconds
    setTimeout(() => {
      if (_tapTimes.length && performance.now() - _tapTimes[_tapTimes.length - 1] > 3000) {
        _tapTimes.length = 0;
      }
    }, 3100);
  });

  // ── 7. UI ─────────────────────────────────────────────────────────────────

  initTabs();
  const contextMenu = new ContextMenu(ps, ctrl, presetMgr, tableManager);
  buildLayerButtons(ps, contextMenu);
  buildMappingPanels(ps, contextMenu);
  buildSeqParams(ps, contextMenu);
  buildGeometryButtons(ps, scene3d);
  buildWarpEditor(warpEditor, ps);

  // Update model status label after drag-and-drop or button import
  function _refreshModelLabel() {
    const lbl = document.getElementById('model-status-label');
    if (!lbl) return;
    const name = scene3d.importedModelName;
    if (name) {
      lbl.textContent = `✓ ${name}`;
      lbl.style.color = 'var(--green)';
    } else {
      lbl.textContent = 'No model loaded — drop .glb/.obj/.stl here or use button below';
      lbl.style.color = '';
    }
  }

  // modelLoaded event from the import button in buildGeometryButtons
  document.getElementById('model-import')?.addEventListener('modelLoaded', e => {
    if (ps.get('layer.fg').value === 0) ps.set('layer.fg', 5);
    ps.set('scene3d.active', 1);
    _refreshModelLabel();
  });

  // ── Collapsible section headers + Detach + Collapse-all ──────────────────

  // Detached panel drag
  function _makeDraggable(panel, handle) {
    let ox = 0, oy = 0, dragging = false;
    handle.addEventListener('mousedown', e => {
      if (e.target.tagName === 'BUTTON') return;
      dragging = true;
      ox = e.clientX - panel.offsetLeft;
      oy = e.clientY - panel.offsetTop;
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      panel.style.left = (e.clientX - ox) + 'px';
      panel.style.top  = (e.clientY - oy) + 'px';
    });
    window.addEventListener('mouseup', () => { dragging = false; });
  }

  // Detach a panel-section into a floating window
  function _detachSection(section) {
    const title    = section.querySelector('.section-header')?.childNodes[0]?.textContent.trim() ?? 'Panel';
    const origParent = section.parentElement;
    const origNext   = section.nextSibling;

    // Leave a slim placeholder so layout doesn't jump
    const placeholder = document.createElement('div');
    placeholder.className = 'detach-placeholder';
    placeholder.style.cssText = 'height:28px;border-bottom:1px dashed var(--border);display:flex;align-items:center;padding:0 10px;font-family:var(--mono);font-size:10px;color:var(--text-2);cursor:pointer;';
    placeholder.textContent = `↗ ${title} (detached)`;
    origParent.insertBefore(placeholder, origNext);

    const panel = document.createElement('div');
    panel.className = 'detached-panel';
    const rect = section.getBoundingClientRect();
    panel.style.left = Math.min(rect.right + 8, window.innerWidth - 300) + 'px';
    panel.style.top  = Math.max(4, rect.top) + 'px';

    const titleBar = document.createElement('div');
    titleBar.className = 'detached-panel-title';
    titleBar.textContent = title;

    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Re-attach';

    const reattach = () => {
      placeholder.replaceWith(section);
      panel.remove();
      section.classList.remove('collapsed');
      section.querySelector('.section-header')?.classList.remove('collapsed');
    };
    closeBtn.addEventListener('click', reattach);
    placeholder.addEventListener('click', reattach);

    titleBar.appendChild(closeBtn);

    const panelBody = document.createElement('div');
    panelBody.className = 'detached-panel-body';
    panelBody.appendChild(section);

    panel.appendChild(titleBar);
    panel.appendChild(panelBody);
    document.body.appendChild(panel);
    _makeDraggable(panel, titleBar);
  }

  let _allCollapsed = false;
  document.querySelectorAll('.section-header').forEach(hdr => {
    // Collapse on click (but not if a button inside was clicked)
    hdr.addEventListener('click', e => {
      if (e.target.tagName === 'BUTTON') return;
      hdr.closest('.panel-section')?.classList.toggle('collapsed');
      hdr.classList.toggle('collapsed');
    });

    // Add action buttons: detach + (collapse-all on first header of each tab)
    const btns = document.createElement('div');
    btns.className = 'section-header-btns';

    const detachBtn = document.createElement('button');
    detachBtn.textContent = '⊞';
    detachBtn.title = 'Detach panel';
    detachBtn.addEventListener('click', e => {
      e.stopPropagation();
      _detachSection(hdr.closest('.panel-section'));
    });
    btns.appendChild(detachBtn);
    hdr.appendChild(btns);
  });

  // Collapse / expand all sections
  const collapseAllBtn = document.getElementById('btn-collapse-all');
  collapseAllBtn?.addEventListener('click', () => {
    _allCollapsed = !_allCollapsed;
    document.querySelectorAll('.panel-section').forEach(sec => {
      const hdr = sec.querySelector('.section-header');
      sec.classList.toggle('collapsed', _allCollapsed);
      hdr?.classList.toggle('collapsed', _allCollapsed);
    });
    collapseAllBtn.textContent = _allCollapsed ? '⊞' : '⊟';
  });

  // Collapse all sections except Layers
  function _collapseToLayers() {
    document.querySelectorAll('.panel-section').forEach(sec => {
      const hdr = sec.querySelector('.section-header');
      // Use the first text node to get the section title (ignoring child button elements)
      const title = [...(hdr?.childNodes ?? [])].find(n => n.nodeType === 3)?.textContent.trim() ?? '';
      const isLayers = title === 'Layers';
      sec.classList.toggle('collapsed', !isLayers);
      hdr?.classList.toggle('collapsed', !isLayers);
    });
  }

  // Reset all params to defaults → clean camera state
  async function _resetAllParams() {
    if (!confirm('Reset all parameters to defaults?')) return;
    ps.getAll().forEach(p => p.reset());
    ps.set('layer.fg', 0);  // Camera
    ps.set('layer.bg', 0);  // Camera
    ps.set('layer.ds', 0);  // Camera
    _collapseToLayers();
    // Start camera if not already running
    if (!camera3d.active) {
      const ok = await camera3d.start(null);
      if (ok) {
        const btnCam = document.getElementById('btn-camera-on');
        if (btnCam) btnCam.textContent = '■ Camera';
        ps.set('camera.active', 1);
      }
    }
  }
  document.getElementById('btn-reset-all')?.addEventListener('click', _resetAllParams);


  // ── LUT loader ────────────────────────────────────────────────────────────
  const lutNameEl = document.getElementById('lut-name');
  document.getElementById('btn-load-lut')?.addEventListener('click', () => {
    const inp = document.createElement('input');
    inp.type   = 'file';
    inp.accept = '.cube';
    inp.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const lut  = parseCubeFile(text);
        pipeline.setLUT(lut, ps.get('effect.lutamount')?.value / 100 ?? 1);
        if (lutNameEl) lutNameEl.textContent = file.name;
      } catch (err) {
        alert(`LUT load failed: ${err.message}`);
        console.error('[LUT]', err);
      }
    };
    inp.click();
  });
  document.getElementById('btn-clear-lut')?.addEventListener('click', () => {
    pipeline.clearLUT();
    if (lutNameEl) lutNameEl.textContent = 'No LUT';
  });
  // LUT amount updates are read directly from ps in pipeline.render()

  const stateDots   = new StateDots(presetMgr);
  const signalPath  = new SignalPath({
    ps,
    pipeline,
    onOrderChange: (order) => {
      pipeline.setFxOrder(order);
      signalPath._fxOrder = [...order];
      signalPath._render();
    },
  });
  const feedbackOl  = new FeedbackOverlay(ps);
  const presetsPanel = new PresetsPanel(presetMgr);
  const fpsDisplay    = new FPSDisplay();
  const debugOverlay  = new DebugOverlay(ps);
  const tablesEditor  = new TablesEditor(tableManager);

  // ── Preset save buttons ───────────────────────────────────────────────────

  // ── Signal path float / dock ──────────────────────────────────────────────
  (() => {
    const spEl  = document.getElementById('signal-path');
    const btn   = document.getElementById('btn-signal-path');
    if (!spEl || !btn) return;

    let _spFloating = false;
    let _spDragOx = 0, _spDragOy = 0, _spDragging = false;

    function _floatSP() {
      _spFloating = true;
      btn.style.color = 'var(--accent)';

      // Remove from fixed-bottom layout: shrink the app area back
      document.documentElement.style.setProperty('--signal-h', '0px');

      // Build title bar
      const titleBar = document.createElement('div');
      titleBar.className = 'sp-float-titlebar';
      titleBar.textContent = 'Signal Path';

      const closeBtn = document.createElement('button');
      closeBtn.textContent = '✕';
      closeBtn.title = 'Dock signal path';
      closeBtn.addEventListener('click', _dockSP);
      titleBar.appendChild(closeBtn);

      // Wrap display in a body div
      const displayEl = document.getElementById('signal-path-display');
      const body = document.createElement('div');
      body.className = 'sp-float-body';
      body.appendChild(displayEl);

      spEl.innerHTML = '';
      spEl.appendChild(titleBar);
      spEl.appendChild(body);
      spEl.classList.add('sp-float-panel');

      // Position near top-left of output panel
      const rect = document.getElementById('output-panel')?.getBoundingClientRect() ?? { left: 0, top: 40 };
      spEl.style.left = (rect.left + 12) + 'px';
      spEl.style.top  = (rect.top  + 12) + 'px';

      // Drag on title bar
      titleBar.addEventListener('mousedown', e => {
        if (e.target.tagName === 'BUTTON') return;
        _spDragging = true;
        _spDragOx = e.clientX - spEl.offsetLeft;
        _spDragOy = e.clientY - spEl.offsetTop;
        e.preventDefault();
      });
    }

    function _dockSP() {
      _spFloating = false;
      btn.style.color = '';
      document.documentElement.style.removeProperty('--signal-h');

      // Extract displayEl before clearing innerHTML
      const displayEl = document.getElementById('signal-path-display');
      if (displayEl) document.body.appendChild(displayEl); // temp parking

      spEl.classList.remove('sp-float-panel');
      spEl.style.left = '';
      spEl.style.top  = '';
      spEl.innerHTML = '';

      if (displayEl) spEl.appendChild(displayEl);
      signalPath._render();
    }

    window.addEventListener('mousemove', e => {
      if (!_spDragging) return;
      spEl.style.left = (e.clientX - _spDragOx) + 'px';
      spEl.style.top  = (e.clientY - _spDragOy) + 'px';
    });
    window.addEventListener('mouseup', () => { _spDragging = false; });

    btn.addEventListener('click', () => {
      if (_spFloating) _dockSP(); else _floatSP();
    });

    // Shift+P shortcut
    window.addEventListener('keydown', e => {
      if (e.shiftKey && e.key === 'P' && !e.target.closest('input,textarea')) {
        e.preventDefault();
        if (_spFloating) _dockSP(); else _floatSP();
      }
    });
  })();

  // ── Resolution buttons (status bar) ──────────────────────────────────────
  (() => {
    const resBtns = document.querySelectorAll('.res-btn');
    const updateActive = (idx) => {
      resBtns.forEach(btn => btn.classList.toggle('active', parseInt(btn.dataset.res) === idx));
    };
    resBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.res);
        ps.set('output.resolution', idx);
      });
    });
    ps.get('output.resolution').onChange(updateActive);
    updateActive(ps.get('output.resolution').value);
  })();

  // ── Second screen output ──────────────────────────────────────────────────
  (() => {
    const btn = document.getElementById('btn-second-screen');
    if (!btn) return;
    let _outWin = null;

    btn.addEventListener('click', () => {
      // Close if already open
      if (_outWin && !_outWin.closed) {
        _outWin.close();
        _outWin = null;
        btn.classList.remove('active');
        btn.title = 'Send output to second monitor / new window';
        return;
      }

      // Open borderless output window
      const w = screen.width;
      const h = screen.height;
      _outWin = window.open(
        '', 'ImWebOutput',
        `width=${w},height=${h},menubar=no,toolbar=no,location=no,status=no,scrollbars=no`
      );
      if (!_outWin) {
        alert('Popup blocked — allow popups for this page to use second screen output.');
        return;
      }

      btn.classList.add('active');
      btn.title = 'Close second screen output (click again)';

      _outWin.document.write(`<!DOCTYPE html>
<html>
<head>
<title>ImWeb Output</title>
<style>
  * { margin:0;padding:0;box-sizing:border-box; }
  html,body { width:100%;height:100%;background:#000;overflow:hidden; }
  canvas { display:block;position:absolute;top:0;left:0; }
</style>
</head>
<body>
<canvas id="out"></canvas>
<script>
  const canvas = document.getElementById('out');
  const ctx = canvas.getContext('2d');
  let running = true;

  function resize() {
    canvas.width  = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    if (!running) return;
    try {
      const src = window.opener && window.opener.document.getElementById('output-canvas');
      if (src && src.width > 0) {
        // Letterbox / pillarbox: scale to fill screen while keeping aspect ratio
        const sw = canvas.width, sh = canvas.height;
        const iw = src.width,   ih = src.height;
        const scale = Math.min(sw / iw, sh / ih);
        const dw = iw * scale, dh = ih * scale;
        const dx = (sw - dw) / 2, dy = (sh - dh) / 2;
        ctx.clearRect(0, 0, sw, sh);
        ctx.drawImage(src, 0, 0, iw, ih, dx, dy, dw, dh);
      }
    } catch(e) { running = false; }
    requestAnimationFrame(draw);
  }
  draw();

  window.addEventListener('beforeunload', () => { running = false; });
  // Fullscreen on double-click
  canvas.addEventListener('dblclick', () => {
    if (!document.fullscreenElement) canvas.requestFullscreen?.();
    else document.exitFullscreen?.();
  });
<\/script>
</body>
</html>`);
      _outWin.document.close();

      // Detect popup closed by user
      const _checkClosed = setInterval(() => {
        if (_outWin?.closed) {
          clearInterval(_checkClosed);
          _outWin = null;
          btn.classList.remove('active');
          btn.title = 'Send output to second monitor / new window';
          // Auto-exit ghost mode when second screen closes
          document.body.classList.remove('ghost-mode');
          document.getElementById('btn-ghost-mode')?.classList.remove('active');
        }
      }, 1000);

      // Auto-enter ghost mode when second screen opens
      document.body.classList.add('ghost-mode');
      document.getElementById('btn-ghost-mode')?.classList.add('active');
    });
  })();

  // ── Ghost mode toggle ─────────────────────────────────────────────────────
  document.getElementById('btn-ghost-mode')?.addEventListener('click', () => {
    document.body.classList.toggle('ghost-mode');
    document.getElementById('btn-ghost-mode').classList.toggle('active',
      document.body.classList.contains('ghost-mode'));
  });

  // ── Video Out Spy ─────────────────────────────────────────────────────────
  const _spyCanvas = document.getElementById('spy-canvas');
  const _spyCtx    = _spyCanvas?.getContext('2d') ?? null;

  // Toggle spy panel visibility
  const _toggleSpy = () => document.getElementById('video-spy')?.classList.toggle('hidden');
  document.getElementById('btn-spy')?.addEventListener('click', _toggleSpy);

  // Keyboard shortcut: Shift+Esc = reset all params
  window.addEventListener('keydown', e => {
    if (e.shiftKey && e.key === 'Escape' && !e.target.closest('input,textarea')) {
      e.preventDefault();
      _resetAllParams();
    }
  });

  // Keyboard shortcut: Shift+V = toggle spy
  window.addEventListener('keydown', e => {
    if (e.shiftKey && e.key === 'V' && !e.target.closest('input,textarea')) {
      e.preventDefault();
      document.getElementById('video-spy')?.classList.toggle('hidden');
    }
  });

  /** Capture a 160×90 JPEG thumbnail of the current output canvas. */
  function capturePresetThumb() {
    const t = document.createElement('canvas');
    t.width = 160; t.height = 90;
    t.getContext('2d').drawImage(canvas, 0, 0, 160, 90);
    return t.toDataURL('image/jpeg', 0.7);
  }

  document.getElementById('btn-save-preset')?.addEventListener('click', async () => {
    if (presetMgr.current) presetMgr.current.thumbnail = capturePresetThumb();
    await presetMgr.saveCurrentPreset();
    presetsPanel._refresh();
    const btn = document.getElementById('btn-save-preset');
    const orig = btn.textContent;
    btn.textContent = '✓ Saved';
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });
  document.getElementById('btn-save-state')?.addEventListener('click', async () => {
    const idx = await presetMgr.saveCurrentState();
    const btn = document.getElementById('btn-save-state');
    const orig = btn.textContent;
    btn.textContent = `✓ State ${idx}`;
    setTimeout(() => { btn.textContent = orig; }, 1200);
  });

  // ── OSC bridge ────────────────────────────────────────────────────────────
  const oscBridge  = new OSCBridge(ps, presetMgr);
  const projectFile = new ProjectFile(ps, presetMgr, tableManager);

  // Click OSC indicator → prompt for WebSocket URL and connect
  document.getElementById('status-osc')?.addEventListener('click', () => {
    if (oscBridge.active) {
      oscBridge.disconnect();
    } else {
      const url = prompt('OSC relay WebSocket URL:', 'ws://localhost:8080');
      if (url) oscBridge.connect(url);
    }
  });

  // Export / Import project file buttons in Presets tab
  (() => {
    const presetsSection = document.querySelector('#tab-presets .panel-section');
    if (!presetsSection) return;

    const ioRow = document.createElement('div');
    ioRow.style.cssText = 'display:flex;gap:6px;padding:8px 10px 4px;flex-wrap:wrap;';

    const btnExport = document.createElement('button');
    btnExport.className = 'import-btn';
    btnExport.textContent = '⬇ Export .imweb';
    btnExport.addEventListener('click', async () => {
      const name = prompt('Project name:', 'ImWeb Project') ?? 'ImWeb Project';
      await projectFile.export(name);
    });

    const btnImport = document.createElement('button');
    btnImport.className = 'import-btn';
    btnImport.textContent = '⬆ Import .imweb';
    btnImport.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.imweb,application/json';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async e => {
        const file = e.target.files[0];
        document.body.removeChild(inp);
        if (!file) return;
        try {
          const name = await projectFile.import(file);
          alert(`Loaded: ${name}`);
        } catch (err) {
          alert(`Import failed: ${err.message}`);
        }
      };
      inp.click();
    });

    const btnRandomize = document.createElement('button');
    btnRandomize.className = 'import-btn';
    btnRandomize.textContent = '🎲 Randomize';
    btnRandomize.title = 'Randomize all continuous parameters';
    btnRandomize.addEventListener('click', () => {
      const SKIP = new Set(['buffer.fs1','buffer.fs2','buffer.fs3','buffer.rate','buffer.scanrate',
        'global.bpm','output.interlace','movie.pos','movie.start','movie.loop']);
      ps.getAll().forEach(p => {
        if (p.type !== 'continuous') return;
        if (SKIP.has(p.id)) return;
        if (p.controller) return; // don't override active controllers
        p.value = p.min + Math.random() * (p.max - p.min);
      });
    });

    // ImX import
    const btnImportImX = document.createElement('button');
    btnImportImX.className = 'import-btn';
    btnImportImX.textContent = '⬆ Import .imx';
    btnImportImX.title = 'Import ImX preset file (.imx)';
    btnImportImX.addEventListener('click', () => {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.imx';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      inp.onchange = async e => {
        const file = e.target.files[0];
        document.body.removeChild(inp);
        if (!file) return;
        _doImportImX(file);
      };
      inp.click();
    });

    ioRow.appendChild(btnExport);
    ioRow.appendChild(btnImport);
    ioRow.appendChild(btnImportImX);
    ioRow.appendChild(btnRandomize);
    presetsSection.appendChild(ioRow);

    // Automation row
    const autoRow2 = document.createElement('div');
    autoRow2.style.cssText = 'display:flex;gap:4px;padding:4px 10px 8px;flex-wrap:wrap;align-items:center;';

    const autoLabel = document.createElement('span');
    autoLabel.textContent = 'Automation:';
    autoLabel.style.cssText = 'font-size:11px;color:var(--text-2);';
    autoRow2.appendChild(autoLabel);

    const btnAutoRec = document.createElement('button');
    btnAutoRec.className = 'import-btn';
    btnAutoRec.textContent = '⏺ Rec';
    btnAutoRec.title = 'Record parameter movements';
    btnAutoRec.addEventListener('click', () => {
      if (automation.recording) {
        automation.stopRecord();
        btnAutoRec.classList.remove('active');
        btnAutoRec.textContent = '⏺ Rec';
        btnAutoPlay.disabled = false;
        btnAutoInfo.textContent = `${automation.duration.toFixed(1)}s / ${automation.eventCount} events`;
      } else {
        automation.startRecord();
        btnAutoRec.classList.add('active');
        btnAutoRec.textContent = '⏹ Stop';
        btnAutoPlay.disabled = true;
        btnAutoInfo.textContent = 'Recording…';
      }
    });

    const btnAutoPlay = document.createElement('button');
    btnAutoPlay.className = 'import-btn';
    btnAutoPlay.textContent = '▶ Play';
    btnAutoPlay.title = 'Loop recorded automation';
    btnAutoPlay.addEventListener('click', () => {
      if (automation.playing) {
        automation.stop();
        btnAutoPlay.classList.remove('active');
        btnAutoPlay.textContent = '▶ Play';
      } else {
        automation.play();
        btnAutoPlay.classList.add('active');
        btnAutoPlay.textContent = '⏹ Stop';
      }
    });

    const btnAutoClear = document.createElement('button');
    btnAutoClear.className = 'import-btn';
    btnAutoClear.textContent = '✕ Clear';
    btnAutoClear.addEventListener('click', () => {
      automation.clear();
      btnAutoPlay.classList.remove('active');
      btnAutoPlay.textContent = '▶ Play';
      btnAutoInfo.textContent = 'No clip';
    });

    const btnAutoInfo = document.createElement('span');
    btnAutoInfo.textContent = 'No clip';
    btnAutoInfo.style.cssText = 'font-size:10px;color:var(--text-2);margin-left:4px;';

    autoRow2.appendChild(btnAutoRec);
    autoRow2.appendChild(btnAutoPlay);
    autoRow2.appendChild(btnAutoClear);
    autoRow2.appendChild(btnAutoInfo);
    presetsSection.appendChild(autoRow2);

    // ── Step Sequencer ──────────────────────────────────────────────────────
    const seqHeader = document.createElement('div');
    seqHeader.style.cssText = 'font-family:var(--mono);font-size:10px;color:var(--text-2);padding:8px 10px 4px;text-transform:uppercase;letter-spacing:0.1em;';
    seqHeader.textContent = 'Step Sequencer';
    presetsSection.appendChild(seqHeader);

    const seqControlRow = document.createElement('div');
    seqControlRow.style.cssText = 'display:flex;gap:4px;padding:0 10px 4px;align-items:center;flex-wrap:wrap;';

    const btnSeqPlay = document.createElement('button');
    btnSeqPlay.className = 'import-btn';
    btnSeqPlay.textContent = '▶ Seq';
    btnSeqPlay.title = 'Toggle step sequencer';
    btnSeqPlay.addEventListener('click', () => {
      stepSequencer.active = !stepSequencer.active;
      if (stepSequencer.active) stepSequencer.reset();
      btnSeqPlay.classList.toggle('active', stepSequencer.active);
      btnSeqPlay.textContent = stepSequencer.active ? '⏹ Seq' : '▶ Seq';
      refreshSeqGrid();
    });

    const seqRateSel = document.createElement('select');
    seqRateSel.className = 'param-select';
    seqRateSel.style.cssText = 'font-size:10px;';
    [['1 beat',1],['2 beats',2],['4 beats',4],['8 beats',8],['16 beats',16]].forEach(([label, v]) => {
      const opt = document.createElement('option');
      opt.value = v; opt.textContent = label;
      if (v === 4) opt.selected = true;
      seqRateSel.appendChild(opt);
    });
    seqRateSel.addEventListener('change', () => {
      stepSequencer.rate = parseFloat(seqRateSel.value);
    });

    const seqStepsSel = document.createElement('select');
    seqStepsSel.className = 'param-select';
    seqStepsSel.style.cssText = 'font-size:10px;';
    [4,8,16].forEach(n => {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = `${n} steps`;
      if (n === 8) opt.selected = true;
      seqStepsSel.appendChild(opt);
    });
    seqStepsSel.addEventListener('change', () => {
      stepSequencer.setStepCount(parseInt(seqStepsSel.value));
      buildSeqGrid();
    });

    seqControlRow.appendChild(btnSeqPlay);
    seqControlRow.appendChild(seqRateSel);
    seqControlRow.appendChild(seqStepsSel);
    presetsSection.appendChild(seqControlRow);

    // Step grid
    const seqGrid = document.createElement('div');
    seqGrid.style.cssText = 'display:flex;flex-wrap:wrap;gap:3px;padding:4px 10px 8px;';
    presetsSection.appendChild(seqGrid);

    function buildSeqGrid() {
      seqGrid.innerHTML = '';
      stepSequencer.steps.forEach((presetIdx, i) => {
        const cell = document.createElement('div');
        cell.dataset.stepIdx = i;
        cell.style.cssText = `width:28px;height:28px;background:var(--bg-4);border:1px solid var(--border);
          border-radius:3px;display:flex;align-items:center;justify-content:center;
          font-size:10px;font-family:var(--mono);cursor:pointer;user-select:none;`;
        cell.textContent = presetIdx >= 0 ? presetIdx : '—';
        cell.title = `Step ${i}: ${presetIdx >= 0 ? 'Preset ' + presetIdx : 'skip'}\nClick to set, right-click to clear`;
        cell.addEventListener('click', () => {
          const v = prompt(`Step ${i} — enter preset number (or empty to skip):`, presetIdx >= 0 ? presetIdx : '');
          if (v === null) return;
          const n = v.trim() === '' ? -1 : parseInt(v);
          stepSequencer.setStep(i, isNaN(n) ? -1 : n);
          refreshSeqGrid();
        });
        cell.addEventListener('contextmenu', e => {
          e.preventDefault();
          stepSequencer.setStep(i, -1);
          refreshSeqGrid();
        });
        seqGrid.appendChild(cell);
      });
    }

    function refreshSeqGrid() {
      seqGrid.querySelectorAll('[data-step-idx]').forEach(cell => {
        const i = parseInt(cell.dataset.stepIdx);
        const presetIdx = stepSequencer.steps[i];
        const isActive  = stepSequencer.active && i === stepSequencer.step;
        cell.textContent = presetIdx >= 0 ? presetIdx : '—';
        cell.style.background = isActive ? 'var(--accent)' : presetIdx >= 0 ? 'var(--bg-3)' : 'var(--bg-4)';
        cell.style.color = isActive ? '#000' : presetIdx >= 0 ? 'var(--text-1)' : 'var(--text-2)';
      });
    }

    buildSeqGrid();

    stepSequencer.onStep = () => refreshSeqGrid();
  })();

  // ── Camera controls ───────────────────────────────────────────────────────

  const cameraRow = document.createElement('div');
  cameraRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;';

  const btnCameraOn = document.createElement('button');
  btnCameraOn.id = 'btn-camera-on';
  btnCameraOn.className = 'import-btn';
  btnCameraOn.textContent = '▶ Camera';

  const camDeviceSel = document.createElement('select');
  camDeviceSel.className = 'param-select';
  camDeviceSel.style.cssText = 'flex:1;font-size:11px;';
  camDeviceSel.innerHTML = '<option value="">default</option>';

  cameraRow.appendChild(btnCameraOn);
  cameraRow.appendChild(camDeviceSel);

  // Vectorscope — auto-connect to ctrl.sound when audio is ready
  ctrl.onSoundReady = (sourceNode, audioCtx) => {
    vectorscope.connectSource(sourceNode, audioCtx);
    btnScope.textContent = '⌖ Scope ✓';
    btnScope.classList.add('active');
  };

  // Manual scope button — also enables sound (which triggers onSoundReady above)
  const btnScope = document.createElement('button');
  btnScope.className = 'import-btn';
  btnScope.textContent = '⌖ Scope';
  btnScope.title = 'Enable vectorscope (uses microphone or shared sound input)';
  btnScope.addEventListener('click', async () => {
    if (ctrl.sound) {
      // Sound already running — just connect scope directly
      vectorscope.connectSource(ctrl.sound.ctx.createMediaStreamSource
        ? vectorscope._source ?? ctrl.sound.analyser // fallback
        : ctrl.sound.analyser, ctrl.sound.ctx);
    } else {
      const ok = await vectorscope.initMic();
      if (ok) { btnScope.textContent = '⌖ Scope ✓'; btnScope.classList.add('active'); }
    }
  });
  cameraRow.appendChild(btnScope);

  document.getElementById('tab-mapping')?.prepend(cameraRow);

  async function populateCameraDevices() {
    const devices = camera3d.getDeviceList();
    // Re-enumerate after permission grant (labels now available)
    await camera3d.init();
    const list = camera3d.getDeviceList();
    if (!list.length) return;
    camDeviceSel.innerHTML = '';
    list.forEach((d, i) => {
      const o = document.createElement('option');
      o.value = d.deviceId;
      o.textContent = d.label || `Camera ${i + 1}`;
      camDeviceSel.appendChild(o);
    });
  }

  camDeviceSel.addEventListener('change', async () => {
    if (!camera3d.active) return;
    camera3d.stop();
    const ok = await camera3d.start(camDeviceSel.value || null);
    if (!ok) { btnCameraOn.textContent = '▶ Camera'; ps.set('camera.active', 0); }
  });

  btnCameraOn.addEventListener('click', async () => {
    if (!camera3d.active) {
      const ok = await camera3d.start(camDeviceSel.value || null);
      if (ok) {
        btnCameraOn.textContent = '■ Camera';
        ps.set('camera.active', 1);
        ps.set('layer.fg', 0);
        await populateCameraDevices();
        // Select the active device in the dropdown
        const activeId = camera3d._stream?.getVideoTracks()[0]?.getSettings()?.deviceId;
        if (activeId) camDeviceSel.value = activeId;
      }
    } else {
      camera3d.stop();
      btnCameraOn.textContent = '▶ Camera';
      ps.set('camera.active', 0);
      ps.set('layer.fg', 3);
    }
  });

  // ── Clip management UI ──────────────────────────────────────────────────

  const clipsList = document.getElementById('clips-list');
  const btnAddClip = document.getElementById('btn-add-clip');

  function refreshClipsList() {
    if (!clipsList) return;
    clipsList.innerHTML = '';
    if (!movieInput.clips.length) {
      const empty = document.createElement('div');
      empty.className = 'clip-empty';
      empty.textContent = 'Drop video files here or click + Add Clip';
      clipsList.appendChild(empty);
      return;
    }
    movieInput.clips.forEach((clip, i) => {
      const isActive = i === movieInput.currentIndex;
      const item = document.createElement('div');
      item.className = `clip-item${isActive ? ' active' : ''}`;

      // Thumbnail
      const thumb = document.createElement('div');
      thumb.className = 'clip-thumb';
      if (clip.thumb) {
        const img = document.createElement('img');
        img.src = clip.thumb;
        img.width = 80; img.height = 45;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '▶';
      }
      if (isActive) {
        const playing = document.createElement('div');
        playing.className = 'clip-thumb-playing';
        playing.textContent = '▶';
        thumb.appendChild(playing);
      }

      // Info
      const info = document.createElement('div');
      info.className = 'clip-info';

      const nameLine = document.createElement('div');
      nameLine.className = 'clip-name';
      nameLine.textContent = clip.name.replace(/\.[^/.]+$/, ''); // strip extension
      nameLine.title = clip.name;

      const metaLine = document.createElement('div');
      metaLine.className = 'clip-meta';

      const dur = document.createElement('span');
      dur.textContent = clip.duration >= 60
        ? `${Math.floor(clip.duration/60)}m${Math.round(clip.duration%60)}s`
        : `${clip.duration.toFixed(1)}s`;

      const key = document.createElement('kbd');
      key.className = 'clip-key';
      key.textContent = i < 8 ? `⇧${i+1}` : '';

      const rmBtn = document.createElement('button');
      rmBtn.className = 'clip-remove';
      rmBtn.textContent = '✕';
      rmBtn.title = 'Remove clip';
      rmBtn.addEventListener('click', e => {
        e.stopPropagation();
        movieInput.removeClip(i);
        refreshClipsList();
      });

      metaLine.appendChild(dur);
      metaLine.appendChild(key);
      metaLine.appendChild(rmBtn);
      info.appendChild(nameLine);
      info.appendChild(metaLine);

      item.appendChild(thumb);
      item.appendChild(info);

      item.addEventListener('click', () => {
        movieInput.selectClip(i);
        if (ps.get('movie.active').value) clip.video.play().catch(() => {});
        refreshClipsList();
      });
      item.addEventListener('contextmenu', e => {
        e.preventDefault();
        movieInput.removeClip(i);
        refreshClipsList();
      });

      clipsList.appendChild(item);
    });
  }

  refreshClipsList(); // show empty state on startup

  document.getElementById('btn-clear-clips')?.addEventListener('click', () => {
    if (!movieInput.clips.length) return;
    if (!confirm('Remove all clips?')) return;
    // removeClip shifts indices — remove from end
    for (let i = movieInput.clips.length - 1; i >= 0; i--) movieInput.removeClip(i);
    ps.set('movie.active', 0);
    refreshClipsList();
  });

  btnAddClip?.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*,.mp4,.webm,.mov,.avi,.mkv';
    input.multiple = true;
    input.onchange = async e => {
      for (const file of e.target.files) {
        try {
          await movieInput.addClip(file);
        } catch (err) {
          console.error('[Movie] Failed to load:', err);
        }
      }
      refreshClipsList();
      // Auto-activate movie if a clip was loaded
      if (movieInput.clips.length > 0 && !ps.get('movie.active').value) {
        ps.set('movie.active', 1);
      }
    };
    input.click();
  });

  // ── Drag-and-drop: video → clip, image → stills buffer ───────────────────

  async function _doImportImX(file, bufPromise) {
    try {
      const buf     = await (bufPromise ?? file.arrayBuffer());
      const presets = await importImX(buf);
      await presetMgr.importAll(presets);
      await presetMgr.activatePreset(0);
      presetsPanel._refresh();
      alert(`Imported ${presets.length} preset(s) from "${file.name}"`);
    } catch (err) {
      alert(`ImX import failed: ${err.message}`);
      console.error('[ImXImporter]', err);
    }
  }

  document.body.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    document.body.classList.add('dnd-active');
  });
  document.body.addEventListener('dragleave', e => {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      document.body.classList.remove('dnd-active');
    }
  });

  document.body.addEventListener('drop', async e => {
    e.preventDefault();
    document.body.classList.remove('dnd-active');
    const files = Array.from(e.dataTransfer.files);
    // Read .imx buffers immediately before any await (DataTransfer expires after first yield)
    const imxBuffers = new Map();
    for (const file of files) {
      if (/\.imx$/i.test(file.name)) imxBuffers.set(file, file.arrayBuffer());
    }
    for (const file of files) {
      if (file.type.startsWith('video/') || /\.(mp4|webm|mov|avi|mkv)$/i.test(file.name)) {
        try {
          await movieInput.addClip(file);
          refreshClipsList();
          if (!ps.get('movie.active').value) ps.set('movie.active', 1);
        } catch (err) { console.error('[DnD] video load failed:', err); }
      } else if (/\.(glb|gltf|obj|stl)$/i.test(file.name)) {
        try {
          await scene3d.loadModel(file);
          // Auto-activate 3D: if FG is not already a useful source, route it to 3D
          if (ps.get('layer.fg').value === 0 /* Color */) ps.set('layer.fg', 5); // 5 = 3D scene
          ps.set('scene3d.active', 1);
          _refreshModelLabel();
          console.info(`[3D] Loaded model: ${file.name}`);
        } catch (err) { console.error('[DnD] 3D model load failed:', err); }
      } else if (/\.imx$/i.test(file.name)) {
        _doImportImX(file, await imxBuffers.get(file));
      } else if (file.type.startsWith('image/') || /\.(png|jpg|jpeg|gif|bmp|webp)$/i.test(file.name)) {
        try {
          const bitmap = await createImageBitmap(file);
          const cvs    = document.createElement('canvas');
          cvs.width    = bitmap.width;
          cvs.height   = bitmap.height;
          cvs.getContext('2d').drawImage(bitmap, 0, 0);
          bitmap.close();
          const tex = new THREE.CanvasTexture(cvs);
          tex.minFilter = THREE.LinearFilter;
          tex.magFilter = THREE.LinearFilter;
          stillsBuffer.capture(tex);
          tex.dispose();
        } catch (err) { console.error('[DnD] image load failed:', err); }
      }
    }
  });

  // Movie toggle
  ps.get('movie.active').onChange(v => {
    movieInput.active = !!v;
    if (v && movieInput.currentClip) {
      movieInput.currentClip.video.play().catch(() => {});
      ps.set('layer.fg', 1); // 1 = Movie
    } else if (!v && movieInput.currentClip) {
      movieInput.currentClip.video.pause();
    }
  });

  // Auto-activate / deactivate 3D scene based on layer source selection
  function sync3DActive() {
    const fg = ps.get('layer.fg').value;
    const bg = ps.get('layer.bg').value;
    const needs3D = fg === 5 || bg === 5;
    ps.set('scene3d.active', needs3D ? 1 : 0);
  }
  ps.get('layer.fg').onChange(sync3DActive);
  ps.get('layer.bg').onChange(sync3DActive);

  // ── Buffer capture helpers ────────────────────────────────────────────────

  // Per-capture-button pinned target slots (null = auto-advance write head)
  const captureTargetSlots = { screen: null, camera: null, movie: null, draw: null, fg: null, bg: null, '3d': null };

  // Live slots: slot index → source key ('camera'|'movie'|'draw'|'screen'|'fg')
  const liveSlots = new Map();
  let _liveTick = 0; // frame counter for throttled thumbnail updates

  /** Resolve a raw layer-source index to its current texture (matches Pipeline._resolveSource). */
  function _resolveLayerTex(idx) {
    const keys = ['camera','movie','buffer','color','noise','scene3d','draw','output',
                  'bg1','bg2','color2','text','sound','delay','scope','slitscan','particles',
                  'seq1','seq2','seq3'];
    const key = keys[idx];
    if (key === 'camera')   return camera3d.active   ? camera3d.currentTexture   : null;
    if (key === 'movie')    return movieInput.active  ? movieInput.currentTexture : null;
    if (key === 'scene3d')  return scene3d.texture;
    if (key === 'draw')     return drawLayer.texture;
    if (key === 'buffer')   return stillsBuffer.texture;
    if (key === 'output')   return pipeline.prev.texture;
    if (key === 'seq1')     return seq1.texture;
    if (key === 'seq2')     return seq2.texture;
    if (key === 'seq3')     return seq3.texture;
    return pipeline.prev.texture;
  }

  /** Resolve texture for source key. */
  function texForSource(src) {
    if (src === 'screen')   return pipeline.prev.texture;
    if (src === 'camera')   return camera3d.active   ? camera3d.currentTexture   : null;
    if (src === 'movie')    return movieInput.active  ? movieInput.currentTexture : null;
    if (src === 'draw')     return drawLayer.texture;
    if (src === 'fg')       return _resolveLayerTex(ps.get('layer.fg').value);
    if (src === 'bg')       return _resolveLayerTex(ps.get('layer.bg').value);
    if (src === '3d')       return scene3d.texture;
    return null;
  }

  /** Capture from src key into its pinned slot (or write head if null). */
  function captureSource(src) {
    const tex  = texForSource(src);
    const slot = captureTargetSlots[src];
    if (!tex) return;
    if (slot !== null) stillsBuffer.captureToSlot(tex, slot);
    else               stillsBuffer.capture(tex);
    refreshBufferGrid();
  }

  /** Used by auto-capture and keyboard shortcut C — respects buffer.source SELECT. */
  function captureFromSource() {
    const srcIdx = ps.get('buffer.source').value;
    const keys   = ['screen', 'camera', 'movie', 'draw', 'fg', 'bg', '3d'];
    captureSource(keys[srcIdx] ?? 'screen');
  }

  // Trigger bindings (MIDI-mappable)
  ps.get('buffer.capture').onTrigger(captureFromSource);
  ps.get('buffer.cap_screen').onTrigger(() => captureSource('screen'));
  ps.get('buffer.cap_video').onTrigger(()  => captureSource('camera'));
  ps.get('buffer.cap_movie').onTrigger(()  => captureSource('movie'));

  ps.get('screen.bg1').onTrigger(() => stillsBuffer.captureBG(0, pipeline.prev.texture));
  ps.get('screen.bg2').onTrigger(() => stillsBuffer.captureBG(1, pipeline.prev.texture));

  // Buffer rows/cols change — resize slot array, update fs max, rebuild grid
  function _updateBufferSize() {
    const rows = Math.round(ps.get('buffer.rows').value);
    const cols = Math.round(ps.get('buffer.cols').value);
    const n = Math.min(rows * cols, 64);
    stillsBuffer.setFrameCount(n);
    ps.get('buffer.fs1').max = n - 1;
    ps.get('buffer.fs2').max = n - 1;
    rebuildBufferGrid();
  }
  ps.get('buffer.rows').onChange(_updateBufferSize);
  ps.get('buffer.cols').onChange(_updateBufferSize);
  // _updateBufferSize() called below after bufferCanvas is initialised

  // Draw layer triggers
  ps.get('draw.clear').onTrigger(() => drawLayer.clear());

  // Text layer triggers
  ps.get('text.advance').onTrigger(() => textLayer.advance());

  // Slit scan clear trigger
  ps.get('slitscan.clear').onTrigger(() => slitScan.clear());

  // Sequence buffer param listeners
  [1, 2, 3].forEach(n => {
    const seq = [seq1, seq2, seq3][n - 1];
    ps.get(`seq${n}.speed`).onChange(v => { seq.speed = v / 100; });
    ps.get(`seq${n}.size`).onChange(v => { seq.setFrameCount(Math.round(v)); });
  });

  // ── Draw tab UI ───────────────────────────────────────────────────────────

  // Mirror the draw canvas into the preview element (same canvas = live)
  const drawPreviewEl = document.getElementById('draw-preview');
  if (drawPreviewEl && drawPreviewEl.parentNode) {
    drawPreviewEl.replaceWith(drawLayer.canvas);
    drawLayer.canvas.id = 'draw-preview';
    drawLayer.canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated;border:1px solid var(--border);background:#000;';
    // Allow mouse drawing directly on the preview canvas
    const setDrawPos = e => {
      const r  = drawLayer.canvas.getBoundingClientRect();
      ps.set('draw.x', ((e.clientX - r.left) / r.width)  * 100);
      ps.set('draw.y', (1 - (e.clientY - r.top) / r.height) * 100);
    };

    let _drawPenBackup = 0;
    let _drawEraseBackup = 0;

    drawLayer.canvas.addEventListener('mousedown', e => {
      setDrawPos(e);
      if (e.button === 0) {          // left = pen
        _drawPenBackup = ps.get('draw.pensize').value;
        if (!_drawPenBackup) ps.set('draw.pensize', 8);
        ps.set('draw.erasesize', 0);
      } else if (e.button === 2) {   // right = erase
        _drawEraseBackup = ps.get('draw.erasesize').value;
        if (!_drawEraseBackup) ps.set('draw.erasesize', 20);
        ps.set('draw.pensize', 0);
      }
    });
    drawLayer.canvas.addEventListener('mousemove', e => {
      if (e.buttons) setDrawPos(e);
    });
    drawLayer.canvas.addEventListener('mouseup', () => {
      ps.set('draw.pensize',   _drawPenBackup   || 0);
      ps.set('draw.erasesize', _drawEraseBackup || 0);
      _drawPenBackup = _drawEraseBackup = 0;
    });
    drawLayer.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  // Draw controls — Clear button and params
  const drawControls = document.getElementById('draw-controls');
  if (drawControls) {
    const btnClear = document.createElement('button');
    btnClear.className = 'import-btn';
    btnClear.textContent = '✕ Clear';
    btnClear.addEventListener('click', () => ps.trigger('draw.clear'));
    drawControls.appendChild(btnClear);

    // Pen/Erase mode indicator buttons
    const btnPen   = document.createElement('button');
    const btnErase = document.createElement('button');
    btnPen.className   = 'import-btn';
    btnErase.className = 'import-btn';
    btnPen.textContent   = '✏ Pen';
    btnErase.textContent = '◻ Erase';
    btnPen.addEventListener('click', () => {
      if (!ps.get('draw.pensize').value) ps.set('draw.pensize', 5);
      ps.set('draw.erasesize', 0);
    });
    btnErase.addEventListener('click', () => {
      ps.set('draw.pensize', 0);
      if (!ps.get('draw.erasesize').value) ps.set('draw.erasesize', 10);
    });
    drawControls.appendChild(btnPen);
    drawControls.appendChild(btnErase);
  }

  // ── Text tab UI ───────────────────────────────────────────────────────────

  const textPreviewEl = document.getElementById('text-preview');
  if (textPreviewEl?.parentNode) {
    textPreviewEl.replaceWith(textLayer.canvas);
    textLayer.canvas.id = 'text-preview';
    textLayer.canvas.style.cssText = 'display:block;width:100%;image-rendering:pixelated;border:1px solid var(--border);background:#000;';
  }

  const textContentEl = document.getElementById('text-content');
  textContentEl?.addEventListener('input', () => {
    textLayer.setContent(textContentEl.value);
  });

  document.getElementById('btn-text-advance')?.addEventListener('click', () => {
    ps.trigger('text.advance');
  });
  document.getElementById('btn-text-reset')?.addEventListener('click', () => {
    textLayer._idx = 0;
    textLayer._render();
  });

  // ── Buffer tab UI ─────────────────────────────────────────────────────────

  let bufferCanvas  = document.getElementById('buffer-canvas');
  let bufferCtx     = bufferCanvas?.getContext('2d');
  const CANVAS_W    = bufferCanvas?.width ?? 320;
  _updateBufferSize();
  // Target cell width ~60px — more frames → more columns → smaller cells
  const CELL_TARGET_W = 60;

  function gridLayout() {
    const n    = stillsBuffer.frameCount;
    const cols = Math.round(ps.get('buffer.cols').value);
    const cw   = CANVAS_W / cols;
    const ch   = Math.round(cw * 0.6); // keep ~5:3 aspect (video-ish)
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
      const x   = col * cw;
      const y   = row * ch;
      const isRead      = i === stillsBuffer.readIndex;
      const isWrite     = i === ((stillsBuffer.writeIndex - 1 + n) % n) && stillsBuffer._hasFrame[i];
      const isProtected = stillsBuffer.isProtected(i);
      const isLive      = liveSlots.has(i);

      // Cell background
      bufferCtx.fillStyle = isRead ? '#2a2a3a' : '#111118';
      bufferCtx.fillRect(x, y, cw - 1, ch - 1);

      // Thumbnail — scale proportionally to cell
      if (stillsBuffer._hasFrame[i]) {
        bufferCtx.drawImage(stillsBuffer.thumbnailCanvases[i], x, y, cw - 1, ch - 1);
      }

      // Protected slot — tint with semi-transparent overlay
      if (isProtected) {
        bufferCtx.fillStyle = 'rgba(255,160,0,0.18)';
        bufferCtx.fillRect(x, y, cw - 1, ch - 1);
      }

      // Frame index label (only if cell tall enough)
      if (ch >= 12) {
        bufferCtx.fillStyle = isRead ? '#e8c840' : isWrite ? '#60a0e0' : isProtected ? '#ffa020' : '#404050';
        bufferCtx.font = `${Math.max(7, Math.min(9, ch * 0.25))}px monospace`;
        bufferCtx.fillText(`${i}${isProtected ? '🔒' : ''}${isLive ? '●' : ''}`, x + 2, y + Math.max(8, ch * 0.28));
      }

      // Write-head marker (blue for normal, amber for protected)
      if (i === stillsBuffer.writeIndex) {
        bufferCtx.strokeStyle = isProtected ? '#ffa020' : '#60a0e0';
        bufferCtx.lineWidth = 1;
        bufferCtx.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2);
      }
      // Live slot — green border
      if (isLive) {
        bufferCtx.strokeStyle = '#40c060';
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

  const slotPickerEl = document.createElement('div');
  slotPickerEl.className = 'slot-picker hidden';
  document.body.appendChild(slotPickerEl);

  let _slotPickerCb = null;

  function showSlotPicker(e, currentSlot, onPick) {
    e.preventDefault();
    _slotPickerCb = onPick;
    slotPickerEl.innerHTML = '';

    // "Auto" option — resets to write-head advance
    const autoBtn = document.createElement('button');
    autoBtn.className = 'slot-picker-auto' + (currentSlot === null ? ' active' : '');
    autoBtn.textContent = 'Auto →';
    autoBtn.title = 'Advance write head (default)';
    autoBtn.addEventListener('click', () => { onPick(null); hideSlotPicker(); });
    slotPickerEl.appendChild(autoBtn);

    // Slot grid
    const grid = document.createElement('div');
    grid.className = 'slot-picker-grid';
    for (let i = 0; i < stillsBuffer.frameCount; i++) {
      const btn = document.createElement('button');
      btn.className = 'slot-picker-slot'
        + (stillsBuffer._hasFrame[i] ? ' filled' : '')
        + (i === currentSlot        ? ' active'  : '');
      btn.textContent = String(i);
      btn.title = `Capture always → slot ${i}`;
      btn.addEventListener('click', () => { onPick(i); hideSlotPicker(); });
      grid.appendChild(btn);
    }
    slotPickerEl.appendChild(grid);

    // Position near the click
    const x = Math.min(e.clientX, window.innerWidth  - 180);
    const y = Math.min(e.clientY, window.innerHeight - 200);
    slotPickerEl.style.left = `${x}px`;
    slotPickerEl.style.top  = `${y}px`;
    slotPickerEl.classList.remove('hidden');
  }

  function hideSlotPicker() {
    slotPickerEl.classList.add('hidden');
    _slotPickerCb = null;
  }

  document.addEventListener('click', e => {
    if (!slotPickerEl.contains(e.target)) hideSlotPicker();
  });

  // ── Buffer controls toolbar ───────────────────────────────────────────────

  const bufferSection = document.querySelector('#tab-buffer .panel-section');

  if (bufferSection) {

    /**
     * Build a capture button that:
     *   left-click  → captureSource(srcKey)
     *   right-click → open slot picker to pin a target slot
     * The button label updates to show the pinned slot.
     */
    function makeCaptureBtn(label, srcKey) {
      const btn = document.createElement('button');
      btn.className = 'import-btn cap-btn';

      function updateLabel() {
        const slot = captureTargetSlots[srcKey];
        btn.textContent = slot !== null ? `${label} [${slot}]` : label;
        btn.classList.toggle('pinned', slot !== null);
      }
      updateLabel();

      btn.addEventListener('click', e => {
        if (e.ctrlKey || e.metaKey) return; // handled by contextmenu
        captureSource(srcKey);
      });

      btn.addEventListener('contextmenu', e => {
        showSlotPicker(e, captureTargetSlots[srcKey], slot => {
          captureTargetSlots[srcKey] = slot;
          updateLabel();
        });
      });

      return btn;
    }

    // ── Capture buttons row ───────────────────────────────────────────────
    const capRow = document.createElement('div');
    capRow.style.cssText = 'display:flex;gap:4px;padding:8px 10px 4px;flex-wrap:wrap;';
    capRow.appendChild(makeCaptureBtn('SCR', 'screen'));
    capRow.appendChild(makeCaptureBtn('CAM', 'camera'));
    capRow.appendChild(makeCaptureBtn('MOV', 'movie'));
    capRow.appendChild(makeCaptureBtn('DRW', 'draw'));

    const capHint = document.createElement('span');
    capHint.textContent = 'right-click to pin slot';
    capHint.style.cssText = 'font-size:10px;color:var(--text-2);align-self:center;margin-left:4px;';
    capRow.appendChild(capHint);

    // ── Auto-capture row ──────────────────────────────────────────────────
    const autoRow = document.createElement('div');
    autoRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 10px 4px;flex-wrap:wrap;';

    // Source selector for auto-capture
    const srcLabel = document.createElement('span');
    srcLabel.textContent = 'Auto src:';
    srcLabel.style.cssText = 'font-size:11px;color:var(--text-2);';
    autoRow.appendChild(srcLabel);

    const srcParam = ps.get('buffer.source');
    const srcBtns  = [];
    srcParam.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'source-btn';
      btn.textContent = opt.slice(0, 3).toUpperCase();
      btn.title = opt;
      btn.classList.toggle('active', i === srcParam.value);
      btn.addEventListener('click', () => {
        srcParam.value = i;
        srcBtns.forEach((b, j) => b.classList.toggle('active', j === i));
      });
      srcBtns.push(btn);
      autoRow.appendChild(btn);
    });

    const btnAuto = document.createElement('button');
    btnAuto.className = 'import-btn';
    btnAuto.textContent = '⏺ Auto';
    btnAuto.title = 'Auto-capture continuously';
    btnAuto.style.marginLeft = '6px';
    btnAuto.classList.toggle('active', !!ps.get('buffer.auto').value);
    btnAuto.addEventListener('click', () => {
      ps.toggle('buffer.auto');
      btnAuto.classList.toggle('active', !!ps.get('buffer.auto').value);
    });
    autoRow.appendChild(btnAuto);

    const rateInput = document.createElement('input');
    rateInput.type = 'number';
    rateInput.min = '0.1'; rateInput.max = '30'; rateInput.step = '0.1';
    rateInput.value = ps.get('buffer.rate').value;
    rateInput.title = 'Frames per second';
    rateInput.style.cssText = 'width:40px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;';
    rateInput.addEventListener('input', () => {
      const v = parseFloat(rateInput.value);
      if (!isNaN(v)) ps.set('buffer.rate', v);
    });
    const fpsLbl = document.createElement('span');
    fpsLbl.textContent = 'fps';
    fpsLbl.style.cssText = 'font-size:11px;color:var(--text-2);';
    autoRow.appendChild(rateInput);
    autoRow.appendChild(fpsLbl);

    // ── Rows × Cols selector ─────────────────────────────────────────────
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 10px 6px;flex-wrap:wrap;';

    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = 'Grid:';
    sizeLabel.style.cssText = 'font-size:11px;color:var(--text-2);min-width:36px;';
    sizeRow.appendChild(sizeLabel);

    ['buffer.rows', 'buffer.cols'].forEach((paramId, pIdx) => {
      const lbl = document.createElement('span');
      lbl.textContent = pIdx === 0 ? 'R' : 'C';
      lbl.style.cssText = 'font-size:11px;color:var(--text-2);';
      sizeRow.appendChild(lbl);

      const inp = document.createElement('input');
      inp.type = 'number';
      inp.min = '1'; inp.max = '8'; inp.step = '1';
      inp.value = ps.get(paramId).value;
      inp.style.cssText = 'width:36px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;';
      inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10);
        if (!isNaN(v)) ps.set(paramId, v);
      });
      ps.get(paramId).onChange(v => { inp.value = Math.round(v); });
      sizeRow.appendChild(inp);
    });

    const slotsLbl = document.createElement('span');
    slotsLbl.style.cssText = 'font-size:11px;color:var(--text-2);';
    function _updateSlotsLabel() {
      const r = Math.round(ps.get('buffer.rows').value);
      const c = Math.round(ps.get('buffer.cols').value);
      slotsLbl.textContent = `= ${r * c} slots`;
    }
    _updateSlotsLabel();
    ps.get('buffer.rows').onChange(_updateSlotsLabel);
    ps.get('buffer.cols').onChange(_updateSlotsLabel);
    sizeRow.appendChild(slotsLbl);

    // ── Scan controls ────────────────────────────────────────────────────
    const scanRow = document.createElement('div');
    scanRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 10px 4px;flex-wrap:wrap;';

    const scanParam = ps.get('buffer.scan');
    const btnScan = document.createElement('button');
    btnScan.className = 'import-btn';
    btnScan.textContent = '▶ Scan';
    btnScan.classList.toggle('active', !!scanParam.value);
    btnScan.addEventListener('click', () => {
      ps.toggle('buffer.scan');
      btnScan.classList.toggle('active', !!ps.get('buffer.scan').value);
    });
    scanRow.appendChild(btnScan);

    const scanDirParam = ps.get('buffer.scandir');
    scanDirParam.options.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'source-btn';
      btn.textContent = opt;
      btn.classList.toggle('active', i === scanDirParam.value);
      btn.addEventListener('click', () => {
        scanDirParam.value = i;
        scanRow.querySelectorAll('.source-btn').forEach((b, j) => b.classList.toggle('active', j === i));
      });
      scanRow.appendChild(btn);
    });

    const scanRateInput = document.createElement('input');
    scanRateInput.type = 'number';
    scanRateInput.min = '0.1'; scanRateInput.max = '60'; scanRateInput.step = '0.5';
    scanRateInput.value = ps.get('buffer.scanrate').value;
    scanRateInput.title = 'Scan rate (fps)';
    scanRateInput.style.cssText = 'width:40px;font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;border-radius:3px;';
    scanRateInput.addEventListener('input', () => {
      const v = parseFloat(scanRateInput.value);
      if (!isNaN(v)) ps.set('buffer.scanrate', v);
    });
    const scanFpsLbl = document.createElement('span');
    scanFpsLbl.textContent = 'fps';
    scanFpsLbl.style.cssText = 'font-size:11px;color:var(--text-2);';
    scanRow.appendChild(scanRateInput);
    scanRow.appendChild(scanFpsLbl);

    // BG freeze buttons
    const bgRow = document.createElement('div');
    bgRow.style.cssText = 'display:flex;gap:6px;padding:0 10px 8px;';
    [['Freeze BG1','screen.bg1'],['Freeze BG2','screen.bg2']].forEach(([label, id]) => {
      const btn = document.createElement('button');
      btn.className = 'import-btn';
      btn.textContent = label;
      btn.addEventListener('click', () => ps.trigger(id));
      bgRow.appendChild(btn);
    });

    // Insert before the canvas
    bufferSection.insertBefore(bgRow,    bufferCanvas ?? null);
    bufferSection.insertBefore(scanRow,  bufferCanvas ?? null);
    bufferSection.insertBefore(sizeRow,  bufferCanvas ?? null);
    bufferSection.insertBefore(autoRow,  bufferCanvas ?? null);
    bufferSection.insertBefore(capRow,   bufferCanvas ?? null);
  }

  // Click to select frame
  bufferCanvas?.addEventListener('click', e => {
    const rect = bufferCanvas.getBoundingClientRect();
    const { cols, cw, ch } = gridLayout();
    const mx  = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my  = (e.clientY - rect.top)  * (bufferCanvas.height / rect.height);
    const idx = Math.floor(my / ch) * cols + Math.floor(mx / cw);
    if (idx >= 0 && idx < stillsBuffer.frameCount) {
      ps.set('buffer.fs1', idx);
      refreshBufferGrid();
    }
  });

  // Right-click on buffer cell → protect/PNG menu
  bufferCanvas?.addEventListener('contextmenu', e => {
    e.preventDefault();
    const rect = bufferCanvas.getBoundingClientRect();
    const { cols, cw, ch } = gridLayout();
    const mx  = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my  = (e.clientY - rect.top)  * (bufferCanvas.height / rect.height);
    const idx = Math.floor(my / ch) * cols + Math.floor(mx / cw);
    if (idx >= 0 && idx < stillsBuffer.frameCount) {
      // Show small context menu for this slot
      _showBufferSlotMenu(idx, e.clientX, e.clientY);
    }
  });

  // ── Buffer slot context menu (protect / save PNG) ─────────────────────────
  const _bufSlotMenu    = document.createElement('div');
  _bufSlotMenu.className = 'context-menu hidden';
  _bufSlotMenu.style.cssText = 'min-width:130px;';
  document.body.appendChild(_bufSlotMenu);
  let _bufSlotMenuIdx = -1;

  function _saveBufSlotPNG(idx) {
    if (!stillsBuffer._hasFrame[idx]) return;
    const rt     = stillsBuffer.frames[idx];
    const w      = rt.width;
    const h      = rt.height;
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    const tmpCanvas = document.createElement('canvas');
    tmpCanvas.width = w; tmpCanvas.height = h;
    const tmpCtx  = tmpCanvas.getContext('2d');
    const imgData = tmpCtx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const srcRow = (h - 1 - row) * w * 4;
      imgData.data.set(pixels.subarray(srcRow, srcRow + w * 4), row * w * 4);
    }
    tmpCtx.putImageData(imgData, 0, 0);
    tmpCanvas.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `imweb-frame-${idx}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');
  }

  function _showBufferSlotMenu(idx, x, y) {
    _bufSlotMenuIdx = idx;
    _bufSlotMenu.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'menu-header';
    header.textContent = `Slot ${idx}`;
    _bufSlotMenu.appendChild(header);

    // Protect/unprotect
    const protBtn = document.createElement('button');
    protBtn.className = 'menu-item';
    protBtn.textContent = stillsBuffer.isProtected(idx) ? '🔓 Unprotect slot' : '🔒 Protect slot';
    protBtn.addEventListener('click', () => {
      stillsBuffer.toggleProtect(idx);
      refreshBufferGrid();
      _bufSlotMenu.classList.add('hidden');
    });
    _bufSlotMenu.appendChild(protBtn);

    // Save PNG (only if frame has content)
    if (stillsBuffer._hasFrame[idx]) {
      const pngBtn = document.createElement('button');
      pngBtn.className = 'menu-item';
      pngBtn.textContent = '↓ Save as PNG';
      pngBtn.addEventListener('click', () => {
        _saveBufSlotPNG(idx);
        _bufSlotMenu.classList.add('hidden');
      });
      _bufSlotMenu.appendChild(pngBtn);
    }

    // Live source sub-menu
    const liveDiv = document.createElement('div');
    liveDiv.className = 'menu-separator';
    _bufSlotMenu.appendChild(liveDiv);
    const liveHeader = document.createElement('div');
    liveHeader.className = 'menu-header';
    liveHeader.style.fontSize = '9px';
    liveHeader.textContent = 'Insert live feed';
    _bufSlotMenu.appendChild(liveHeader);
    const currentLive = liveSlots.get(idx);
    const liveSrcs = [
      { key: 'camera', label: '📷 Camera' },
      { key: 'movie',  label: '🎬 Movie'  },
      { key: 'screen', label: '🖥 Screen' },
      { key: 'fg',     label: '▲ FG layer' },
    ];
    liveSrcs.forEach(({ key, label }) => {
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (currentLive === key ? ' active' : '');
      btn.textContent = label;
      btn.addEventListener('click', () => {
        liveSlots.set(idx, key);
        stillsBuffer._protected.add(idx); // protect from overwrite by auto-capture
        refreshBufferGrid();
        _bufSlotMenu.classList.add('hidden');
      });
      _bufSlotMenu.appendChild(btn);
    });
    if (currentLive) {
      const clearBtn = document.createElement('button');
      clearBtn.className = 'menu-item';
      clearBtn.textContent = '⏹ Remove live feed';
      clearBtn.addEventListener('click', () => {
        liveSlots.delete(idx);
        refreshBufferGrid();
        _bufSlotMenu.classList.add('hidden');
      });
      _bufSlotMenu.appendChild(clearBtn);
    }

    _bufSlotMenu.style.left = `${Math.min(x, window.innerWidth - 160)}px`;
    _bufSlotMenu.style.top  = `${Math.min(y, window.innerHeight - 140)}px`;
    _bufSlotMenu.classList.remove('hidden');

    setTimeout(() => document.addEventListener('click', _hideBufSlotMenu, { once: true }), 0);
  }

  function _hideBufSlotMenu() { _bufSlotMenu.classList.add('hidden'); }

  ps.get('buffer.fs1').onChange(refreshBufferGrid);
  rebuildBufferGrid();

  // ── Live GLSL Editor ──────────────────────────────────────────────────────

  const glslEditor  = document.getElementById('glsl-editor');
  const glslError   = document.getElementById('glsl-error');
  const glslApply   = document.getElementById('btn-glsl-apply');
  const glslReset   = document.getElementById('btn-glsl-reset');
  const glslAuto    = document.getElementById('glsl-auto-apply');

  // ── GLSL param uniform slots (uParam1..uParam4) ───────────────────────────
  const glslParamBindings = ['', '', '', '']; // paramId strings
  const uniformsEl = document.getElementById('glsl-uniforms');
  if (uniformsEl) {
    for (let i = 0; i < 4; i++) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:4px;margin:2px 0;';
      const lbl = document.createElement('span');
      lbl.textContent = `uParam${i + 1}:`;
      lbl.style.cssText = 'min-width:60px;color:var(--text-2);';
      const inp = document.createElement('input');
      inp.type  = 'text';
      inp.placeholder = 'param id (e.g. effect.bloom)';
      inp.style.cssText = 'flex:1;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);font-family:monospace;font-size:10px;padding:2px 4px;';
      inp.addEventListener('change', () => { glslParamBindings[i] = inp.value.trim(); });
      row.appendChild(lbl);
      row.appendChild(inp);
      uniformsEl.appendChild(row);
    }
  }

  function applyGLSL() {
    const src = glslEditor?.value;
    if (!src) return;
    // Inject the varying declaration if missing (for user convenience)
    const needsVarying = !src.includes('varying vec2 vUv');
    const fullSrc = needsVarying
      ? `varying vec2 vUv;\n${src}`
      : src;
    const err = pipeline.setCustomShader(fullSrc);
    if (glslError) {
      glslError.style.display = err ? 'block' : 'none';
      glslError.textContent   = err ?? '';
    }
  }

  glslApply?.addEventListener('click', applyGLSL);

  glslReset?.addEventListener('click', () => {
    pipeline.disableCustomShader();
    if (glslError) glslError.style.display = 'none';
    if (glslAuto) glslAuto.checked = false;
  });

  glslEditor?.addEventListener('input', () => {
    if (glslAuto?.checked) applyGLSL();
  });

  // Tab key inserts two spaces in the editor
  glslEditor?.addEventListener('keydown', e => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const s = glslEditor.selectionStart;
      const v = glslEditor.value;
      glslEditor.value = v.slice(0, s) + '  ' + v.slice(glslEditor.selectionEnd);
      glslEditor.selectionStart = glslEditor.selectionEnd = s + 2;
      if (glslAuto?.checked) applyGLSL();
    }
    // Ctrl+Enter / Cmd+Enter = apply
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      applyGLSL();
    }
  });

  // Built-in GLSL shader presets
  const GLSL_PRESETS = {
    'Passthrough': `void main() {
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = col;
}`,
    'Invert': `void main() {
  vec4 col = texture2D(uTexture, vUv);
  gl_FragColor = vec4(1.0 - col.rgb, col.a);
}`,
    'Hue Cycle': `void main() {
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
    'Ripple': `void main() {
  vec2 uv = vUv;
  float d = length(uv - 0.5);
  uv.y += sin(d * 40.0 - uTime * 5.0) * 0.015;
  uv.x += cos(d * 40.0 - uTime * 5.0) * 0.015;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    'Tunnel': `void main() {
  vec2 uv = vUv - 0.5;
  float a = atan(uv.y, uv.x);
  float r = length(uv);
  vec2 tuv = vec2(a / 6.283 + 0.5, 0.5 / r + uTime * 0.2);
  gl_FragColor = texture2D(uTexture, fract(tuv));
}`,
    'Luma Displace': `void main() {
  vec4 c = texture2D(uTexture, vUv);
  float l = dot(c.rgb, vec3(0.299,0.587,0.114));
  vec2 uv = vUv + vec2(cos(l*20.0+uTime),sin(l*20.0+uTime))*0.01;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    'Glitch Bands': `float hash(float n){ return fract(sin(n)*43758.5453123); }
void main() {
  vec2 uv = vUv;
  float t = floor(uTime * 8.0);
  float band = floor(uv.y * 24.0);
  float r = hash(band + t * 71.3);
  if(r > 0.92) uv.x += (hash(band*3.7+t)-0.5)*0.15;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    'RGB Split': `void main() {
  float a = uTime * 0.5;
  vec2 off = vec2(cos(a),sin(a)) * 0.015;
  float r = texture2D(uTexture, vUv + off).r;
  float g = texture2D(uTexture, vUv).g;
  float b = texture2D(uTexture, vUv - off).b;
  gl_FragColor = vec4(r,g,b,1.0);
}`,
    'Mosaic': `void main() {
  vec2 sz = vec2(32.0, 18.0);
  vec2 uv = floor(vUv * sz) / sz;
  gl_FragColor = texture2D(uTexture, uv);
}`,
    'Old TV': `float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5);}
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
  };

  const glslPresetSel = document.createElement('select');
  glslPresetSel.style.cssText = 'font-size:11px;background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:2px 4px;flex:1;';
  Object.keys(GLSL_PRESETS).forEach(name => {
    const o = document.createElement('option');
    o.value = name; o.textContent = name;
    glslPresetSel.appendChild(o);
  });
  glslPresetSel.addEventListener('change', () => {
    const code = GLSL_PRESETS[glslPresetSel.value];
    if (code && glslEditor) {
      glslEditor.value = code;
      if (glslAuto?.checked) applyGLSL();
    }
  });

  // Insert preset selector above the apply buttons
  const glslTab = document.getElementById('tab-glsl');
  const glslSection = glslTab?.querySelector('.panel-section');
  if (glslSection) {
    const selRow = document.createElement('div');
    selRow.style.cssText = 'display:flex;gap:4px;padding:4px 8px 0;align-items:center;';
    const lbl = document.createElement('span');
    lbl.textContent = 'Preset:';
    lbl.style.cssText = 'font-size:11px;color:var(--text-2);white-space:nowrap;';
    selRow.appendChild(lbl);
    selRow.appendChild(glslPresetSel);
    glslSection.insertBefore(selRow, glslSection.querySelector('div'));
  }

  // ── Record button ─────────────────────────────────────────────────────────

  let mediaRecorder = null;
  let recordChunks  = [];

  document.getElementById('btn-record')?.addEventListener('click', async () => {
    const btn = document.getElementById('btn-record');
    if (!mediaRecorder) {
      const stream = canvas.captureStream(60);
      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 8_000_000,
      });
      recordChunks = [];
      mediaRecorder.ondataavailable = e => recordChunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(recordChunks, { type: 'video/webm' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `imweb-${Date.now()}.webm`;
        a.click();
        mediaRecorder = null;
      };
      mediaRecorder.start(100);
      btn.classList.add('recording');
      btn.textContent = '⏹';
    } else {
      mediaRecorder.stop();
      btn.classList.remove('recording');
      btn.textContent = '⏺';
    }
  });

  // ── Parameter search overlay (/ key) ─────────────────────────────────────

  const searchEl  = document.getElementById('param-search');
  const searchInp = document.getElementById('param-search-input');
  const searchRes = document.getElementById('param-search-results');
  let _searchSel  = 0;

  function openParamSearch() {
    if (!searchEl) return;
    searchEl.classList.remove('hidden');
    searchInp.value = '';
    _searchSel = 0;
    renderSearchResults('');
    searchInp.focus();
  }

  function closeParamSearch() {
    searchEl?.classList.add('hidden');
    searchInp?.blur();
  }

  function renderSearchResults(query) {
    if (!searchRes) return;
    const q = query.toLowerCase();
    const all = ps.getAll().filter(p => {
      if (!q) return true;
      return p.id.toLowerCase().includes(q) || p.label.toLowerCase().includes(q);
    }).slice(0, 20);

    searchRes.innerHTML = '';
    all.forEach((p, i) => {
      const item = document.createElement('div');
      item.className = `psearch-item${i === _searchSel ? ' selected' : ''}`;
      item.innerHTML = `
        <span class="pi-id">${p.id}</span>
        <span class="pi-ctrl">${p.controllerLabel}</span>
        <span class="pi-val">${p.displayValue}</span>
      `;
      item.addEventListener('click', () => { activateSearchResult(p); });
      item.addEventListener('mouseenter', () => {
        _searchSel = i;
        searchRes.querySelectorAll('.psearch-item').forEach((el, j) =>
          el.classList.toggle('selected', j === i));
      });
      searchRes.appendChild(item);
    });

    return all;
  }

  function activateSearchResult(p) {
    // Scroll to the param row and flash it
    const row = document.querySelector(`.param-row[data-param-id="${p.id}"]`);
    if (row) {
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      row.style.outline = '1px solid var(--accent)';
      setTimeout(() => { row.style.outline = ''; }, 1500);
    }
    closeParamSearch();
  }

  searchInp?.addEventListener('input', () => {
    _searchSel = 0;
    renderSearchResults(searchInp.value);
  });

  searchInp?.addEventListener('keydown', e => {
    const items = searchRes?.querySelectorAll('.psearch-item');
    if (!items?.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      _searchSel = Math.min(_searchSel + 1, items.length - 1);
      items.forEach((el, j) => el.classList.toggle('selected', j === _searchSel));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      _searchSel = Math.max(_searchSel - 1, 0);
      items.forEach((el, j) => el.classList.toggle('selected', j === _searchSel));
    } else if (e.key === 'Enter') {
      items[_searchSel]?.click();
    } else if (e.key === 'Escape') {
      closeParamSearch();
    }
  });

  document.addEventListener('click', e => {
    if (searchEl && !searchEl.contains(e.target)) closeParamSearch();
  });

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return;

    // / = open parameter search
    if (e.key === '/' && !e.target.closest('input, textarea')) {
      e.preventDefault();
      openParamSearch();
      return;
    }

    // Numpad shortcuts (ImOs9 style)
    if (e.code === 'NumpadAdd')      { e.preventDefault(); presetMgr.nextPreset(); }
    if (e.code === 'NumpadSubtract') { e.preventDefault(); presetMgr.prevPreset(); }

    // Number keys 0–9 recall Display States
    if (!e.altKey && /^Digit[0-9]$/.test(e.code)) {
      const idx = parseInt(e.code.replace('Digit', ''));
      presetMgr.recallState(idx);
    }

    // * + digit stores Display State
    if (e.code === 'NumpadMultiply') {
      window._nextKeyStoresState = true;
    }
    if (window._nextKeyStoresState && /^Digit[0-9]$/.test(e.code)) {
      const idx = parseInt(e.code.replace('Digit', ''));
      presetMgr.saveCurrentState(idx);
      window._nextKeyStoresState = false;
    }

    // b = Blend toggle
    if (e.key === 'b' && !e.metaKey) { e.preventDefault(); ps.toggle('blend.active'); }
    // s = Solo
    if (e.key === 's' && !e.metaKey) { e.preventDefault(); ps.toggle('output.solo'); }
    // d = Debug overlay
    if (e.key === 'd' && !e.metaKey) { e.preventDefault(); ps.toggle('global.debug'); }
    // k = Keyer
    if (e.key === 'k' && !e.metaKey) { e.preventDefault(); ps.toggle('keyer.active'); }
    // x = ExtKey
    if (e.key === 'x' && !e.metaKey) { e.preventDefault(); ps.toggle('keyer.extkey'); }
    // c = Capture buffer
    if (e.key === 'c' && !e.metaKey) { e.preventDefault(); ps.trigger('buffer.cap_screen'); }
    // v = Camera on/off
    if (e.key === 'v' && !e.metaKey) { e.preventDefault(); ps.toggle('camera.active'); }
    // m = Movie on/off
    if (e.key === 'm' && !e.metaKey) { e.preventDefault(); ps.toggle('movie.active'); }
    // t = Tap tempo
    if (e.key === 't' && !e.metaKey) { e.preventDefault(); ps.trigger('global.tap'); }
    // h = Hold / Fade to black (toggle output.fade between 0 and 100)
    if (e.key === 'h' && !e.metaKey) {
      e.preventDefault();
      const fadeP = ps.get('output.fade');
      fadeP.value = fadeP.value > 0 ? 0 : 100;
    }
    // 1–8 = Select clip (when Shift is held, select clip N-1)
    if (e.shiftKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
      const idx = parseInt(e.code.replace('Digit', '')) - 1;
      if (idx < movieInput.clips.length) {
        movieInput.selectClip(idx);
        if (ps.get('movie.active').value) movieInput.clips[idx]?.video.play().catch(() => {});
        refreshClipsList();
        e.preventDefault();
      }
    }
    // f = Fullscreen
    if (e.key === 'f' && !e.metaKey) { e.preventDefault(); toggleFullscreen(); }
    // Cmd/Ctrl+S = quick-save current state to active preset
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.target.closest('textarea,input')) {
      e.preventDefault();
      presetMgr.saveCurrentPreset().then(() => {
        const btn = document.getElementById('btn-save-preset');
        if (btn) {
          const orig = btn.textContent;
          btn.textContent = '✓ Saved';
          setTimeout(() => { btn.textContent = orig; }, 1000);
        }
      });
    }
    // ? = Keyboard help
    if (e.key === '?') { e.preventDefault(); toggleHelpOverlay(); }
    // Escape = exit fullscreen / close overlays
    if (e.key === 'Escape') {
      document.body.classList.remove('fullscreen-output');
      document.getElementById('kb-help')?.classList.add('hidden');
    }
  });

  // ── Color pickers (native input[type=color] for Color1/Color2) ───────────

  function hexToHsv(hex) {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
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

  document.getElementById('color1-picker')?.addEventListener('input', e => {
    const { h, s, v } = hexToHsv(e.target.value);
    ps.set('color1.hue', h);
    ps.set('color1.sat', s);
    ps.set('color1.val', v);
  });
  document.getElementById('color2-picker')?.addEventListener('input', e => {
    const { h, s, v } = hexToHsv(e.target.value);
    ps.set('color2.hue', h);
    ps.set('color2.sat', s);
    ps.set('color2.val', v);
  });

  // Chroma key colour picker → sets keyer.chromahue
  document.getElementById('chroma-picker')?.addEventListener('input', e => {
    const { h } = hexToHsv(e.target.value);
    ps.set('keyer.chromahue', h * 3.6); // h is 0–100, chromahue is 0–360
  });

  // ── Fullscreen button and double-click toggle ─────────────────────────────

  const toggleFullscreen = () => {
    document.body.classList.toggle('fullscreen-output');
  };

  document.getElementById('btn-fullscreen')?.addEventListener('click', toggleFullscreen);
  canvas.addEventListener('dblclick', toggleFullscreen);

  // ── Keyboard help overlay ─────────────────────────────────────────────────

  const toggleHelpOverlay = () => {
    document.getElementById('kb-help')?.classList.toggle('hidden');
  };
  document.getElementById('kb-help')?.addEventListener('click', e => {
    if (e.target.id === 'kb-help') document.getElementById('kb-help').classList.add('hidden');
  });

  // ── Resolution control ────────────────────────────────────────────────────

  const RENDER_RESOLUTIONS = {
    0: null,             // Display size (tracks container)
    1: [1280, 720],      // 720p
    2: [1920, 1080],     // 1080p
    3: [960, 540],       // 540p
    4: null,             // Quarter (½ of display)
  };

  function applyResolution(idx) {
    const preset = RENDER_RESOLUTIONS[idx];
    let rW, rH;
    if (idx === 4) {
      rW = Math.max(320, Math.round(canvas.parentElement.clientWidth  / 2));
      rH = Math.max(180, Math.round(canvas.parentElement.clientHeight / 2));
    } else if (preset) {
      [rW, rH] = preset;
    } else {
      rW = canvas.parentElement.clientWidth;
      rH = canvas.parentElement.clientHeight;
    }
    W = rW; H = rH;
    renderer.setSize(rW, rH);
    // "fit" and "½" fill the container; fixed resolutions display at natural size (letterboxed/pillarboxed)
    const fills = (idx === 0 || idx === 4);
    renderer.domElement.style.width    = fills ? '100%' : '';
    renderer.domElement.style.height   = fills ? '100%' : '';
    renderer.domElement.style.maxWidth = fills ? '' : '100%';
    pipeline.resize(rW, rH);
    scene3d.resize(rW, rH);
    stillsBuffer.resize(rW, rH);
    videoDelay.resize(rW, rH);
    slitScan.resize(rW, rH);
    particles.resize(rW, rH);
    seq1.resize(rW, rH);
    seq2.resize(rW, rH);
    seq3.resize(rW, rH);
  }

  ps.get('output.resolution').onChange(idx => applyResolution(idx));

  // ── Resize handler ────────────────────────────────────────────────────────

  const resizeObserver = new ResizeObserver(() => {
    if (document.body.classList.contains('ghost-mode')) return; // ghost mode: keep render res fixed
    const idx = ps.get('output.resolution').value;
    if (idx === 0 || idx === 4) {
      applyResolution(idx);
    }
    // Fixed resolutions don't change with container size
  });
  resizeObserver.observe(canvas.parentElement);

  // ── Startup: collapse sections + auto-start camera ───────────────────────

  // Always collapse all sections except Layers for clean first impression
  _collapseToLayers();

  // Auto-start camera on first load (silently; user can stop it)
  camera3d.start(null).then(ok => {
    if (!ok) return;
    const btnCam = document.getElementById('btn-camera-on');
    if (btnCam) btnCam.textContent = '■ Camera';
    ps.set('camera.active', 1);
    // Only route to layers if no preset restored a different source
    const fg = ps.get('layer.fg').value;
    const bg = ps.get('layer.bg').value;
    const ds = ps.get('layer.ds').value;
    // 3=Color, 4=Noise → default untouched states; route to camera
    if (fg === 3 || fg === 4) ps.set('layer.fg', 0);
    if (bg === 3 || bg === 4) ps.set('layer.bg', 0);
    if (ds === 3 || ds === 4) ps.set('layer.ds', 0);
  });

  // ── Render loop ───────────────────────────────────────────────────────────

  let lastTime = performance.now();
  let frameCount = 0;
  let autoCapTimer = 0;
  let scanTimer = 0;
  let scanDir = 1; // +1 fwd, -1 back (for ping-pong)
  let strobePhase = 0; // 0–1 phase within one strobe cycle
  let beatPhase = 0;   // accumulated beat counter (beats, increases at BPM rate)

  function render(now) {
    requestAnimationFrame(render);

    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;
    frameCount++;

    // Tick slew (parameter lag/smoothing)
    ps.tickSlew(dt);

    // Advance beat phase first so LFOs get current beat position
    const bpm = ps.get('global.bpm')?.value ?? 120;
    beatPhase += dt * (bpm / 60);

    // Beat detection: auto-update global.bpm from audio when opted in
    if (ps.get('global.beatdetect')?.value && ctrl.sound?.beatDetector?.beat) {
      const detectedBpm = ctrl.sound.beatDetector.bpm;
      if (detectedBpm > 0) {
        const cur = ps.get('global.bpm')?.value ?? 120;
        const smoothed = Math.round(cur * 0.7 + detectedBpm * 0.3);
        ps.set('global.bpm', smoothed);
        ctrl.retriggerLFOs();
      }
    }

    // Tick controllers (LFOs with beat phase, random, expression, etc.)
    ctrl.tick(dt, beatPhase);

    // Tick preset morph animation
    presetMgr.tickMorph(dt);

    // Tick automation playback
    automation.tick(dt);

    // Tick step sequencer
    stepSequencer.tick(beatPhase);

    // Update camera texture
    camera3d.tick();

    // Update movie clip
    movieInput.tick(ps, beatPhase);

    // Tick stills buffer (reads fs1 → readIndex)
    stillsBuffer.tick(ps);

    // Tick and capture sequence buffers
    const _seqSrcTex = idx => [
      pipeline.prev.texture,       // 0 Output
      camera3d.currentTexture,     // 1 Camera
      movieInput.texture,          // 2 Movie
      _resolveLayerTex(ps.get('layer.fg').value), // 3 FG
      _resolveLayerTex(ps.get('layer.bg').value), // 4 BG
      stillsBuffer.texture,        // 5 Buffer
      drawLayer.texture,           // 6 Draw
    ][idx] ?? pipeline.prev.texture;

    [seq1, seq2, seq3].forEach((seq, i) => {
      seq.tick();
      if (ps.get(`seq${i + 1}.active`).value) {
        seq.capture(_seqSrcTex(ps.get(`seq${i + 1}.source`).value));
      }
    });

    // Buffer frame scan
    if (ps.get('buffer.scan').value) {
      scanTimer += dt;
      const rate = Math.max(0.01, ps.get('buffer.scanrate').value);
      if (scanTimer >= 1 / rate) {
        scanTimer = 0;
        const n   = stillsBuffer.frameCount;
        const dir = ps.get('buffer.scandir').value;
        const cur = ps.get('buffer.fs1').value;
        if (dir === 0) { // forward
          ps.set('buffer.fs1', (cur + 1) % n);
        } else if (dir === 1) { // backward
          ps.set('buffer.fs1', (cur - 1 + n) % n);
        } else { // ping-pong
          const next = cur + scanDir;
          if (next >= n - 1 || next <= 0) scanDir = -scanDir;
          ps.set('buffer.fs1', Math.max(0, Math.min(n - 1, next)));
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
    if (ps.get('buffer.auto').value) {
      autoCapTimer += dt;
      const rate = Math.max(0.01, ps.get('buffer.rate').value);
      if (autoCapTimer >= 1 / rate) {
        autoCapTimer = 0;
        captureFromSource();
      }
    } else {
      autoCapTimer = 0;
    }

    // Tick draw layer (paints to canvas texture based on draw.* params)
    drawLayer.tick(ps);

    // Tick text layer (updates text rendering based on text.* params)
    textLayer.tick(ps);

    // Update sound level texture
    if (ctrl.sound) {
      const lvl = Math.round(Math.min(1, ctrl.sound.level * 4) * 255);
      soundData[0] = soundData[1] = soundData[2] = lvl;
      soundTexture.needsUpdate = true;

      // VU meter in status bar
      const vuCanvas = document.getElementById('status-vu');
      if (vuCanvas) {
        vuCanvas.style.display = 'inline-block';
        const vCtx = vuCanvas.getContext('2d');
        const W = vuCanvas.width, H = vuCanvas.height;
        vCtx.clearRect(0, 0, W, H);
        const bars = 4;
        const barW = W / bars - 1;
        const levels = [ctrl.sound.bass, ctrl.sound.mid, ctrl.sound.high, ctrl.sound.level];
        const colors = ['#4080ff', '#40c040', '#c0c040', '#e84040'];
        levels.forEach((lv, i) => {
          const h = Math.round(Math.min(1, lv) * H);
          vCtx.fillStyle = colors[i];
          vCtx.fillRect(i * (barW + 1), H - h, barW, h);
        });
      }
    }

    // Tick vectorscope
    vectorscope.tick(ps);

    // Tick slit scan (reads from pipeline.prev render target)
    slitScan.tick(renderer, pipeline.prev, ps, dt);

    // Tick particle system
    particles.tick(ps, dt);

    // Animate Color2 gradient when speed is non-zero
    const _c2speed = ps.get('color2.speed')?.value ?? 0;
    if (_c2speed !== 0) {
      _color2Phase += dt * _c2speed * 0.005; // 200 = 1 full cycle/sec
      updateColor2Texture();
    }

    // Generate GPU noise every 2 frames
    if (frameCount % 2 === 0) {
      noiseTexture = pipeline.generateNoise(
        lastTime / 1000,
        ps.get('noise.type').value,
        ps.get('noise.scale')?.value ?? 1,
        ps.get('noise.color')?.value ?? 0,
      );
    }

    // Render 3D scene if active OR used as a layer source
    const SCENE3D_IDX = 5; // index in SOURCES array
    const scene3dNeeded = ps.get('scene3d.active').value
      || ps.get('layer.fg').value === SCENE3D_IDX
      || ps.get('layer.bg').value === SCENE3D_IDX
      || ps.get('layer.ds').value === SCENE3D_IDX;
    if (scene3dNeeded) scene3d.render(ps, dt, {
      camera: camera3d.active ? camera3d.currentTexture : null,
      movie:  movieInput.active ? movieInput.currentTexture : null,
      screen: pipeline.prev.texture,
      draw:   drawLayer.texture,
      buffer: stillsBuffer.texture,
    });

    // Assemble input sources
    const inputs = {
      camera:  camera3d.active ? camera3d.currentTexture : null,
      movie:   movieInput.active ? movieInput.currentTexture : null,
      buffer:  stillsBuffer.texture,
      buffer2: stillsBuffer.texture2,
      bg1:     stillsBuffer.bgTexture(0),
      bg2:     stillsBuffer.bgTexture(1),
      scene3d: scene3dNeeded ? scene3d.texture : null,
      color:   colorTexture,
      color2:  color2Texture,
      sound:   soundTexture,
      noise:   noiseTexture,
      draw:    drawLayer.texture,
      text:    textLayer.texture,
      delay:   videoDelay.getTexture(ps.get('delay.frames').value),
      scope:    vectorscope.texture,
      slitscan:  slitScan.texture,
      particles: particles.texture,
      seq1:      seq1.texture,
      seq2:      seq2.texture,
      seq3:      seq3.texture,
      warpMaps,
    };

    // Stroboscope: on "off" phase, freeze output (skip pipeline, blit prev)
    const strobeOn   = ps.get('effect.strobe').value;
    const strobeRate = ps.get('effect.stroberate').value;
    const strobeDuty = ps.get('effect.strobeduty').value / 100;
    if (strobeOn && strobeRate > 0) {
      strobePhase = (strobePhase + dt * strobeRate) % 1;
    }
    const strobeFreeze = strobeOn && strobePhase >= strobeDuty;

    // Update GLSL param uniforms
    pipeline.setCustomUniforms(glslParamBindings.map(id => {
      const p = id ? ps.get(id) : null;
      return p ? p.normalized : 0;
    }));

    // Run compositing pipeline
    if (!strobeFreeze) {
      pipeline.render(inputs, ps, dt);
    }

    // Capture output into video delay ring buffer
    videoDelay.capture(pipeline.prev.texture);

    // FPS counter + debug overlay
    fpsDisplay.tick();
    debugOverlay.tick(fpsDisplay._fps);

    // Video Out Spy — copy output canvas to spy preview (when visible)
    if (_spyCanvas && !document.getElementById('video-spy')?.classList.contains('hidden')) {
      _spyCtx.drawImage(canvas, 0, 0, 160, 90);
    }
  }

  requestAnimationFrame(render);

  console.log('%cImWeb ready — press V to start camera, 3D tab for scene', 'color:#9090a8');

  // Register service worker for PWA / offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
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

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────

main().catch(err => {
  console.error('[ImWeb] Fatal startup error:', err);
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
