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
import { VasulkaWarp }       from './inputs/VasulkaWarp.js';
import { ParticleSystem }    from './inputs/ParticleSystem.js';
import { SDFGenerator }      from './inputs/SDFGenerator.js';
import { DrawLayer }      from './inputs/DrawLayer.js';
import { TextLayer }      from './inputs/TextLayer.js';
import { buildWarpMaps }  from './inputs/WarpMaps.js';
import { WarpMapEditor } from './inputs/WarpMapEditor.js';
import { SceneManager } from './scene3d/SceneManager.js';
import { Pipeline } from './core/Pipeline.js';
import { PresetManager, openDB } from './state/Preset.js';
import { OSCBridge }    from './io/OSCBridge.js';
import { ProjectFile }  from './io/ProjectFile.js';
import clipLibrary      from './io/ClipLibrary.js';
import { importImX }    from './io/ImXImporter.js';
import { parseCubeFile } from './io/CubeLoader.js';
import {
  AIFeatures,
  getApiKey, setApiKey, clearApiKey,
  generatePreset, narrateState, buildStateSnapshot,
  coachSuggestion, buildActivitySnapshot,
} from './ai/AIFeatures.js';
import {
  initTabs,
  buildParamRow,
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
  Profiler,
  DebugOverlay,
  TablesEditor,
  buildClipLibrary,
} from './ui/UI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

function _applyLayout() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('layout-portrait', portrait);
}
_applyLayout();
window.addEventListener('resize', _applyLayout);

async function main() {
  console.log('%cImWeb v0.6.0', 'color:#e8c840;font-weight:bold;font-size:14px');

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
  ctrl._clipLibrary = clipLibrary; // set now; _movieInput set after movieInput is created
  const automation    = new Automation(ps);

  // ── 4. Input sources ──────────────────────────────────────────────────────

  const camera3d = new CameraInput();
  await camera3d.init();

  const movieInput = new MovieInput();
  ctrl._movieInput = movieInput;

  const stillsBuffer  = new StillsBuffer(renderer, W, H);
  const seq1 = new SequenceBuffer(renderer, W, H, 60, 'seq1');
  const seq2 = new SequenceBuffer(renderer, W, H, 60, 'seq2');
  const seq3 = new SequenceBuffer(renderer, W, H, 60, 'seq3');
  const videoDelay    = new VideoDelayLine(renderer, W, H, 30);
  const vectorscope   = new VectorscopeInput();
  const slitScan      = new SlitScanBuffer(W, H);
  const vasulkaWarp   = new VasulkaWarp(renderer, W, H, 960);
  const particles     = new ParticleSystem(renderer, W, H);
  const sdfGen        = new SDFGenerator(renderer, W, H);
  const warpMaps     = buildWarpMaps(); // 8 procedural warp map textures (map1–map8)
  const warpEditor   = new WarpMapEditor(); // interactive editor → warpMaps[8] (Custom)
  warpMaps.push(warpEditor.texture);        // index 9 in SELECT = warpMaps[8]
  const drawLayer    = new DrawLayer();
  const textLayer    = new TextLayer();

  const scene3d = new SceneManager(renderer, W, H);

  // Helper to manage sequence buffers for profiler/VRAM estimation
  const sequencerManager = {
    sequencers: [seq1, seq2, seq3]
  };

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

  // Default startup state: FG=Color, BG=Color, DS=Noise; movie off until user clicks MovieOn
  ps.set('layer.fg', 3); // Color
  ps.set('layer.bg', 3); // Color
  ps.set('layer.ds', 4); // Noise

  // ── 6. Preset manager + Table manager ────────────────────────────────────

  const presetMgr = new PresetManager(ps, ctrl, pipeline);
  await presetMgr.init();
  ps.set('movie.active', 0); // always start with movie off regardless of saved preset state
  const stepSequencer = new StepSequencer(presetMgr);

  // MIDI Program Change → preset recall (PC 0–127 maps to preset index)
  ctrl.onMIDIPC = pcNum => presetMgr.activatePreset(pcNum);

  // Wire tableManager into ParameterSystem so controller setNormalized() applies curves
  setTableManager(tableManager);
  await tableManager.init(await openDB());

  // ── Cached status bar elements ────────────────────────────────────────────
  const _vuCanvas = document.getElementById('status-vu');
  const _vuCtx    = _vuCanvas?.getContext('2d');

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
  const _enableMidiClock = () => {
    ctrl.enableMIDIClock(bpm => { ps.set('global.bpm', bpm); });
    if (bpmEl) { bpmEl.title = 'MIDI clock sync ON — right-click to disable'; bpmEl.style.outline = '1px solid var(--accent)'; }
  };
  const _disableMidiClock = () => {
    ctrl.disableMIDIClock();
    if (bpmEl) { bpmEl.title = 'Click: tap tempo | Right-click: enable MIDI clock'; bpmEl.style.outline = ''; }
  };

  // global.midisync param drives clock enable/disable
  ps.get('global.midisync').onChange(v => { v ? _enableMidiClock() : _disableMidiClock(); });

  bpmEl?.addEventListener('contextmenu', e => {
    e.preventDefault();
    ps.set('global.midisync', ctrl._midiClockEnabled ? 0 : 1);
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
  _patchNoiseTypeOptgroups();
  buildSeqParams(ps, contextMenu);
  buildGeometryButtons(ps, scene3d, contextMenu);
  buildWarpEditor(warpEditor, ps, contextMenu);
  const { refreshClipGrid, setRecording } = buildClipLibrary(ps, clipLibrary, movieInput, contextMenu);

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
    ps.set('scene3d.anim.active', 1);
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
    ctrl.clearAllAssignments();
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
  const profiler     = new Profiler();
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

  // ── Controller assignment map panel ──────────────────────────────────────
  (() => {
    const btn = document.getElementById('btn-ctrl-map');
    if (!btn) return;

    let panel = null;
    let _pollId = null;

    const TYPE_LABEL = {
      'lfo-sine':     'LFO ~',
      'lfo-triangle': 'LFO △',
      'lfo-sawtooth': 'LFO /',
      'lfo-square':   'LFO ⊓',
      'midi-cc':      'MIDI CC',
      'midi-note':    'MIDI Note',
      'mouse-x':      'Mouse X',
      'mouse-y':      'Mouse Y',
      'sound-vu':     'Sound VU',
      'sound-fft':    'Sound FFT',
      'key':          'Key',
      'random':       'Random',
      'expr':         'Expr',
      'fixed':        'Fixed',
    };

    function _ctrlDetail(c) {
      if (!c) return '';
      if (c.type === 'midi-cc')   return `CH${c.channel ?? '?'} CC${c.cc}`;
      if (c.type === 'midi-note') return `CH${c.channel ?? '?'} N${c.note}`;
      if (c.type === 'lfo-sine' || c.type === 'lfo-triangle' ||
          c.type === 'lfo-sawtooth' || c.type === 'lfo-square') {
        return c.beatSync ? `÷${c.beatDiv ?? 1}` : `${(c.hz ?? 1).toFixed(2)}hz`;
      }
      if (c.type === 'key') return `[${c.key}]`;
      if (c.type === 'expr') return c.expr?.slice(0, 16) + (c.expr?.length > 16 ? '…' : '');
      return '';
    }

    function _render() {
      if (!panel) return;
      const assigned = ps.getAll().filter(p => p.controller);
      const list = panel.querySelector('.cm-list');

      if (!assigned.length) {
        list.innerHTML = '<div class="cm-empty">No active assignments</div>';
        return;
      }

      // Group by controller type
      const groups = {};
      assigned.forEach(p => {
        const t = p.controller.type;
        (groups[t] ??= []).push(p);
      });

      list.innerHTML = Object.entries(groups).map(([type, params]) => {
        const label = TYPE_LABEL[type] ?? type;
        const rows = params.map(p => {
          const detail = _ctrlDetail(p.controller);
          return `<div class="cm-row" data-id="${p.id}">
            <span class="cm-pid">${p.id}</span>
            <span class="cm-type">${label}</span>
            <span class="cm-detail">${detail}</span>
            <button class="cm-remove" data-id="${p.id}" title="Remove assignment">✕</button>
          </div>`;
        }).join('');
        return `<div class="cm-group">${rows}</div>`;
      }).join('');

      list.querySelectorAll('.cm-remove').forEach(b => {
        b.addEventListener('click', e => {
          e.stopPropagation();
          ctrl.assign(b.dataset.id, null);
          _render();
        });
      });
    }

    function _open() {
      panel = document.createElement('div');
      panel.id = 'ctrl-map-panel';
      panel.innerHTML = `
        <div class="cm-titlebar">
          <span>Active Controllers</span>
          <button id="cm-clear-all" title="Clear all assignments">Clear All</button>
          <button id="cm-close">✕</button>
        </div>
        <div class="cm-list"></div>`;
      document.body.appendChild(panel);

      // Position near the button
      const r = btn.getBoundingClientRect();
      panel.style.left = Math.max(4, r.left - 220) + 'px';
      panel.style.top  = (r.top - panel.offsetHeight - 4) + 'px';

      panel.querySelector('#cm-close').addEventListener('click', _close);
      panel.querySelector('#cm-clear-all').addEventListener('click', () => {
        ctrl.clearAllAssignments();
        _render();
      });

      _render();
      // Reposition now that height is known
      panel.style.top = (r.top - panel.offsetHeight - 4) + 'px';
      _pollId = setInterval(_render, 1000);
      btn.classList.add('active');
    }

    function _close() {
      panel?.remove();
      panel = null;
      clearInterval(_pollId);
      btn.classList.remove('active');
    }

    btn.addEventListener('click', () => { panel ? _close() : _open(); });
  })();

  // ── MovieOn button (status bar) ───────────────────────────────────────────
  (() => {
    const btn = document.getElementById('btn-movie-on');
    if (!btn) return;
    const update = v => {
      btn.classList.toggle('active', !!v);
      btn.textContent = v ? 'Movie On' : 'Movie Off';
    };
    btn.addEventListener('click', () => ps.toggle('movie.active'));
    ps.get('movie.active').onChange(update);
    update(ps.get('movie.active').value);
  })();

  // ── Second screen output ──────────────────────────────────────────────────
  let _outWin = null;
  let _outWinReady = false;
  let _outFrameTick = 0;
  (() => {
    const btn = document.getElementById('btn-second-screen');
    if (!btn) return;

    btn.addEventListener('click', () => {
      // Close if already open
      if (_outWin && !_outWin.closed) {
        _outWin.close();
        _outWin = null;
        _outWinReady = false;
        btn.classList.remove('active');
        btn.title = 'Send output to second monitor / new window';
        // Auto-exit ghost mode
        document.body.classList.remove('ghost-mode');
        document.getElementById('btn-ghost-mode')?.classList.remove('active');
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

  // ── Projection mapping homography (unit square → 4 destination points) ──────
  function computeProjectiveMatrix(x0,y0, x1,y1, x2,y2, x3,y3) {
    const dx1=x1-x2, dy1=y1-y2, dx2=x3-x2, dy2=y3-y2;
    const dx3=x0-x1+x2-x3, dy3=y0-y1+y2-y3;
    const det = dx1*dy2 - dx2*dy1;
    if (Math.abs(det) < 1e-10) return null;
    const h20=(dx3*dy2-dx2*dy3)/det, h21=(dx1*dy3-dx3*dy1)/det;
    const h00=x1-x0+h20*x1, h01=x3-x0+h21*x3, h02=x0;
    const h10=y1-y0+h20*y1, h11=y3-y0+h21*y3, h12=y0;
    return [h00,h10,0,h20, h01,h11,0,h21, 0,0,1,0, h02,h12,0,1].join(',');
  }

  // ── Ghost mode toggle ─────────────────────────────────────────────────────
  document.getElementById('btn-ghost-mode')?.addEventListener('click', () => {
    document.body.classList.toggle('ghost-mode');
    document.getElementById('btn-ghost-mode').classList.toggle('active',
      document.body.classList.contains('ghost-mode'));
  });

  // ── Projection Mapping ────────────────────────────────────────────────────
  // Corner handles live on the second screen. It sends updates back here.
  window.addEventListener('message', e => {
    if (e.data?.type === 'projmap' && e.data.corner) {
      ps.set(`projmap.${e.data.corner}_x`, e.data.x);
      ps.set(`projmap.${e.data.corner}_y`, e.data.y);
    }
  });
  ps.get('projmap.active').onChange(v => {
    document.getElementById('btn-projmap')?.classList.toggle('active', !!v);
    if (v && _outWin && !_outWin.closed) _outWin.focus();
  });
  document.getElementById('btn-projmap')?.addEventListener('click', () => {
    ps.set('projmap.active', ps.get('projmap.active').value ? 0 : 1);
  });
  document.getElementById('btn-projmap-reset')?.addEventListener('click', () => {
    ps.set('projmap.tl_x', 0); ps.set('projmap.tl_y', 0);
    ps.set('projmap.tr_x', 1); ps.set('projmap.tr_y', 0);
    ps.set('projmap.br_x', 1); ps.set('projmap.br_y', 1);
    ps.set('projmap.bl_x', 0); ps.set('projmap.bl_y', 1);
  });

  // ── Video Out Spy ─────────────────────────────────────────────────────────
  const _spyCanvas = document.getElementById('spy-canvas');
  const _spyCtx    = _spyCanvas?.getContext('2d') ?? null;

  // Toggle spy panel visibility
  const _toggleSpy = () => document.getElementById('video-spy')?.classList.toggle('hidden');
  document.getElementById('btn-spy')?.addEventListener('click', _toggleSpy);

  // First-visit onboarding overlay
  const _onboarding = document.getElementById('onboarding');
  if (!localStorage.getItem('imweb-onboarding-dismissed')) {
    _onboarding?.classList.remove('hidden');
  }
  document.getElementById('onboarding-dismiss')?.addEventListener('click', () => {
    _onboarding?.classList.add('hidden');
    localStorage.setItem('imweb-onboarding-dismissed', '1');
  });

  // Keyboard lock toggle
  const _keylockBtn = document.getElementById('btn-keylock');
  ps.get('global.keylock').onChange(v => {
    _keylockBtn?.classList.toggle('active', !!v);
  });
  _keylockBtn?.addEventListener('click', () => ps.set('global.keylock', ps.get('global.keylock').value ? 0 : 1));

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
    await presetMgr.saveCurrentPreset(capturePresetThumb());
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
  const projectFile = new ProjectFile(ps, presetMgr, tableManager, {
    warpEditor,
    drawLayer,
    stillsBuffer,
    scene3d:     scene3d,
    seqBuffers:  [seq1, seq2, seq3],
  });

  // Click OSC indicator → prompt for WebSocket URL and connect
  document.getElementById('status-osc')?.addEventListener('click', () => {
    if (oscBridge.active) {
      oscBridge.disconnect();
    } else {
      const url = prompt('OSC relay WebSocket URL:', 'ws://localhost:8080');
      if (url) oscBridge.connect(url);
    }
  });

  // Project file UI — #project-file-ui container in Presets tab
  (() => {
    const container = document.getElementById('project-file-ui');
    if (container) {
      container.innerHTML = `
        <div style="padding:8px 10px;display:flex;flex-direction:column;gap:5px;">
          <div style="display:flex;gap:5px;">
            <input id="project-name-input" type="text" placeholder="Session name…"
              style="flex:1;background:var(--bg-3);border:1px solid var(--border);border-radius:3px;
                     color:var(--text-0);font-family:var(--mono);font-size:11px;padding:4px 7px;outline:none;" />
          </div>
          <div style="display:flex;gap:5px;">
            <button id="btn-export-project" class="import-btn" style="flex:1" title="Cmd+E">⇩ Export .imweb</button>
            <button id="btn-import-project" class="import-btn" style="flex:1" title="Cmd+O">⇧ Import .imweb</button>
          </div>
          <div id="project-file-status" style="font-family:var(--mono);font-size:10px;color:var(--text-2);min-height:14px;"></div>
          <input id="project-file-input" type="file" accept=".imweb,application/json" style="display:none;" />
        </div>
      `;

      const statusEl = () => document.getElementById('project-file-status');
      const setStatus = (msg, color = 'var(--text-2)') => {
        const el = statusEl(); if (el) { el.textContent = msg; el.style.color = color; }
      };

      document.getElementById('btn-export-project')?.addEventListener('click', async () => {
        try {
          const name = document.getElementById('project-name-input')?.value.trim()
            || document.getElementById('status-preset')?.textContent
            || 'imweb-session';
          await projectFile.export(name);
          setStatus(`✓ Exported "${name}"`, 'var(--green)');
        } catch (err) {
          setStatus(`✗ ${err.message}`, 'var(--red)');
        }
      });

      document.getElementById('btn-import-project')?.addEventListener('click', () => {
        document.getElementById('project-file-input')?.click();
      });

      document.getElementById('project-file-input')?.addEventListener('change', async e => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        try {
          const name = await projectFile.import(file);
          const inp = document.getElementById('project-name-input');
          if (inp) inp.value = name;
          setStatus(`✓ Loaded "${name}"`, 'var(--green)');

          // Refresh UI
          presetsPanel?._refresh?.();
          refreshBufferGrid();
          // Update WarpMap UI if active
          if (document.getElementById('warp-slots-list')) {
             const slots = warpEditor.getSavedSlots();
             document.getElementById('warp-slots-list').innerHTML = slots.map(s => `<button class="warp-slot-btn">${s}</button>`).join('');
          }
        } catch (err) {
          setStatus(`✗ ${err.message}`, 'var(--red)');
        }
      });

      window.addEventListener('keydown', e => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if ((e.metaKey || e.ctrlKey) && e.key === 'e' && !e.shiftKey) {
          e.preventDefault(); document.getElementById('btn-export-project')?.click();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'o') {
          e.preventDefault(); document.getElementById('btn-import-project')?.click();
        }
      });
    }
  })();

  (() => {
    const presetsSection = document.querySelector('#tab-presets .panel-section:last-of-type');
    if (!presetsSection) return;

    const ioRow = document.createElement('div');
    ioRow.style.cssText = 'display:flex;gap:6px;padding:8px 10px 4px;flex-wrap:wrap;';

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
      } else {
        const errName = camera3d.lastError;
        if (errName === 'InsecureContext') {
          btnCameraOn.title = 'Camera requires HTTPS — serve over https:// or use localhost';
          btnCameraOn.textContent = '✕ HTTPS';
        } else if (errName === 'NotAllowedError') {
          btnCameraOn.title = 'Camera permission denied';
          btnCameraOn.textContent = '✕ Camera';
        } else {
          btnCameraOn.title = `Camera error: ${errName ?? 'unknown'}`;
          btnCameraOn.textContent = '✕ Camera';
        }
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

  function _showClipError(msg) {
    const el = document.createElement('div');
    el.className = 'clip-error-toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 4000);
  }

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
        // Remove any existing clip context menu
        document.querySelector('.clip-ctx-menu')?.remove();
        const menu = document.createElement('div');
        menu.className = 'clip-ctx-menu ctx-menu';
        menu.innerHTML =
          `<div class="ctx-item" data-action="midi">Assign MIDI controller</div>` +
          `<div class="ctx-item ctx-danger" data-action="remove">Remove clip</div>`;
        menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:999`;
        document.body.appendChild(menu);
        menu.querySelector('[data-action="midi"]').addEventListener('click', () => {
          menu.remove();
          // Trigger the controller badge popover for movie.speed
          const badge = document.querySelector('[data-param-id="movie.speed"] .param-ctrl');
          if (badge) badge.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
        });
        menu.querySelector('[data-action="remove"]').addEventListener('click', () => {
          menu.remove();
          movieInput.removeClip(i);
          refreshClipsList();
        });
        const dismiss = ev => {
          if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('pointerdown', dismiss); }
        };
        setTimeout(() => document.addEventListener('pointerdown', dismiss), 0);
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
          _showClipError(err.message);
        }
      }
      refreshClipsList();
      // Apply current mute state to all clips
      const muted = !!ps.get('movie.mute').value;
      movieInput.clips.forEach(c => { c.video.muted = muted; });
      if (movieInput.currentClip) {
        movieInput.currentClip.video.play().catch(() => {});
        ps.set('layer.fg', 1);
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
          if (movieInput.currentClip) {
            movieInput.currentClip.video.play().catch(() => {});
            ps.set('layer.fg', 1);
          }
        } catch (err) { console.error('[DnD] video load failed:', err); _showClipError(err.message); }
      } else if (/\.(glb|gltf|obj|stl|dae)$/i.test(file.name)) {
        try {
          await scene3d.loadModel(file, ps, files);
          // Auto-activate 3D: if FG is not already a useful source, route it to 3D
          if (ps.get('layer.fg').value === 3 /* Color */) ps.set('layer.fg', 5); // 5 = 3D scene
          ps.set('scene3d.active', 1);
          ps.set('scene3d.anim.active', 1);
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
  ps.get('movie.mute').onChange(v => {
    movieInput.clips.forEach(c => { c.video.muted = !!v; });
  });

  // ── Clip Library wiring ───────────────────────────────────────────────────
  let _clipRecording = false;

  ps.get('clip.record').onChange(async () => {
    if (_clipRecording) return; // debounce: ignore re-trigger while recording
    _clipRecording = true;
    const slotIndex = ps.get('clip.bank').value * 16 + ps.get('clip.slot').value;
    const maxSec    = ps.get('clip.duration').value;
    const stream    = canvas.captureStream(60);
    console.info(`[Clip] Recording slot ${slotIndex} for ${maxSec}s…`);
    setRecording(true);
    try {
      await clipLibrary.record(stream, slotIndex, maxSec, canvas);
      console.info(`[Clip] Slot ${slotIndex} saved (${maxSec}s)`);
      refreshClipGrid();
    } catch (err) {
      console.error('[Clip] Record failed:', err);
    } finally {
      _clipRecording = false;
      setRecording(false);
    }
  });

  ps.get('clip.recall').onChange(async () => {
    const slotIndex = ps.get('clip.bank').value * 16 + ps.get('clip.slot').value;
    try {
      const clip = await clipLibrary.recall(slotIndex);
      if (!clip) { console.warn(`[Clip] Slot ${slotIndex} is empty`); return; }
      const idx = await movieInput.addClip(clip.blobUrl);
      if (idx >= 0) {
        movieInput.selectClip(idx);
        ps.set('movie.active', 1);
        console.info(`[Clip] Slot ${slotIndex} recalled (${clip.duration.toFixed(1)}s)`);
        refreshClipGrid();
      }
    } catch (err) {
      console.error('[Clip] Recall failed:', err);
    }
  });

  // Auto-activate / deactivate 3D scene based on layer source selection
  function sync3DActive() {
    const fg = ps.get('layer.fg').value;
    const bg = ps.get('layer.bg').value;
    const ds = ps.get('layer.ds').value;
    const SCENE3D_IDX = 5;
    const DEPTH3D_IDX = 20;
    const needs3D = fg === SCENE3D_IDX || bg === SCENE3D_IDX || ds === SCENE3D_IDX ||
                    fg === DEPTH3D_IDX || bg === DEPTH3D_IDX || ds === DEPTH3D_IDX;
    ps.set('scene3d.active', needs3D ? 1 : 0);
  }
  ps.get('layer.fg').onChange(sync3DActive);
  ps.get('layer.bg').onChange(sync3DActive);
  ps.get('layer.ds').onChange(sync3DActive);

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
                  'seq1','seq2','seq3','depth3d','sdf','vwarp'];
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

  // Vasulka Warp — reinit on buf size change
  const _vwarpReinit = () => {
    const bufsizeOptions = [480, 960, 1920];
    const bufSize = bufsizeOptions[ps.get('vwarp.bufsize').value] ?? 960;
    const w = vasulkaWarp._fullW, h = vasulkaWarp._fullH;
    vasulkaWarp.dispose();
    const fresh = new VasulkaWarp(renderer, w, h, bufSize);
    // Replace internals in-place so existing closure references stay valid
    Object.keys(fresh).forEach(k => { vasulkaWarp[k] = fresh[k]; });
  };
  ps.get('vwarp.bufsize').onChange(_vwarpReinit);

  // Sequence buffer param listeners
  [1, 2, 3].forEach(n => {
    const seq = [seq1, seq2, seq3][n - 1];
    ps.get(`seq${n}.speed`).onChange(v => { seq.speed = v / 100; });
    ps.get(`seq${n}.size`).onChange(v => { seq.setFrameCount(Math.round(v)); });
    ps.get(`seq${n}.mode`).onChange(v => { seq.setMode(v === 1 ? 'timewarp' : 'loop'); });
    ps.get(`seq${n}.tw.speed`).onChange(v => { seq._twSpeed = Math.max(1, Math.round(v)); });
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

  // Draw controls — Clear, Pen, Erase, Color picker, Fade toggle
  const drawControls = document.getElementById('draw-controls');
  if (drawControls) {
    // Pen / Erase buttons
    const btnPen   = document.createElement('button');
    const btnErase = document.createElement('button');
    const btnClear = document.createElement('button');
    btnPen.className   = 'import-btn';
    btnErase.className = 'import-btn';
    btnClear.className = 'import-btn';
    btnPen.textContent   = '✏ Pen';
    btnErase.textContent = '◻ Erase';
    btnClear.textContent = '✕ Clear';

    btnPen.addEventListener('click', () => {
      if (!ps.get('draw.pensize').value) ps.set('draw.pensize', 5);
      ps.set('draw.erasesize', 0);
      btnPen.style.borderColor = 'var(--accent)';
      btnErase.style.borderColor = '';
    });
    btnErase.addEventListener('click', () => {
      ps.set('draw.pensize', 0);
      if (!ps.get('draw.erasesize').value) ps.set('draw.erasesize', 10);
      btnErase.style.borderColor = 'var(--accent)';
      btnPen.style.borderColor = '';
    });
    btnClear.addEventListener('click', () => ps.trigger('draw.clear'));

    drawControls.append(btnPen, btnErase, btnClear);

    // Color picker (native <input type=color> as quick color entry)
    const colorPicker = document.createElement('input');
    colorPicker.type  = 'color';
    colorPicker.value = '#ffffff';
    colorPicker.title = 'Pen color (or use PenHue/PenSat/PenBright params)';
    colorPicker.style.cssText = 'width:28px;height:22px;padding:1px;border:1px solid var(--border);border-radius:3px;background:var(--bg-3);cursor:pointer;';
    colorPicker.addEventListener('input', () => {
      const hex = colorPicker.value;
      const r = parseInt(hex.slice(1,3),16)/255;
      const g = parseInt(hex.slice(3,5),16)/255;
      const b = parseInt(hex.slice(5,7),16)/255;
      // Convert RGB → HSV
      const max = Math.max(r,g,b), min = Math.min(r,g,b), d = max - min;
      let h = 0;
      if (d > 0) {
        if (max===r) h = 60*(((g-b)/d)%6);
        else if (max===g) h = 60*((b-r)/d+2);
        else h = 60*((r-g)/d+4);
      }
      if (h < 0) h += 360;
      const s = max > 0 ? d/max * 100 : 0;
      const v = max * 100;
      ps.set('draw.color.h', h);
      ps.set('draw.color.s', s);
      ps.set('draw.color.v', v);
    });
    drawControls.appendChild(colorPicker);

    // Fade toggle — quick enable/disable of draw fade
    const btnFade = document.createElement('button');
    btnFade.className = 'import-btn';
    btnFade.textContent = '〜 Fade';
    btnFade.title = 'Toggle draw fade/decay (sets DrawFade to 0.05 or 0)';
    btnFade.addEventListener('click', () => {
      const cur = ps.get('draw.fade').value;
      ps.set('draw.fade', cur > 0 ? 0 : 0.04);
      btnFade.style.borderColor = ps.get('draw.fade').value > 0 ? 'var(--accent)' : '';
    });
    drawControls.appendChild(btnFade);
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
    const lines = textContentEl.value.split('\n');
    textLayer.setContentList(lines);
    // Also keep setContent for single-line compatibility
    if (lines.filter(l => l.trim()).length <= 1) {
      textLayer.setContent(textContentEl.value);
    }
  });

  document.getElementById('btn-text-advance')?.addEventListener('click', () => {
    ps.trigger('text.advance');
  });
  document.getElementById('btn-text-reset')?.addEventListener('click', () => {
    textLayer._idx = 0;
    textLayer._render();
  });

  // ── Mobile panel toggle ───────────────────────────────────────────────────
  const _panelEl   = document.getElementById('control-panel');
  const _overlayEl = document.getElementById('panel-overlay');
  document.getElementById('btn-panel-toggle')?.addEventListener('click', () => {
    const open = _panelEl?.classList.toggle('panel-open');
    _overlayEl?.classList.toggle('hidden', !open);
  });
  _overlayEl?.addEventListener('click', () => {
    _panelEl?.classList.remove('panel-open');
    _overlayEl?.classList.add('hidden');
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
    liveHeader.style.color = 'var(--accent)';
    liveHeader.textContent = 'INSERT VIDEO TO BUFFER (LIVE)';
    _bufSlotMenu.appendChild(liveHeader);
    const currentLive = liveSlots.get(idx);
    const liveSrcs = [
      { key: 'camera', label: '📷 Insert Camera' },
      { key: 'movie',  label: '🎬 Insert Movie'  },
      { key: 'screen', label: '🖥 Insert Screen' },
      { key: 'fg',     label: '▲ Insert FG layer' },
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
  const uniformsEl = document.getElementById('glsl-uniforms');
  if (uniformsEl) {
    ['glsl.param1','glsl.param2','glsl.param3','glsl.param4'].forEach(id => {
      const p = ps.get(id);
      if (p) uniformsEl.appendChild(buildParamRow(p, contextMenu));
    });
  }

  function applyGLSL() {
    const src = glslEditor?.value;
    if (!src) return;
    // Prepend all standard pipeline uniform declarations if absent,
    // so preset shaders don't need to redeclare them.
    const header = [
      src.includes('varying vec2 vUv')            ? '' : 'varying vec2 vUv;',
      src.includes('uniform sampler2D uTexture')  ? '' : 'uniform sampler2D uTexture;',
      src.includes('uniform float uTime')         ? '' : 'uniform float uTime;',
      src.includes('uniform float uParam1')       ? '' : 'uniform float uParam1;',
      src.includes('uniform float uParam2')       ? '' : 'uniform float uParam2;',
      src.includes('uniform float uParam3')       ? '' : 'uniform float uParam3;',
      src.includes('uniform float uParam4')       ? '' : 'uniform float uParam4;',
    ].filter(Boolean).join('\n');
    const fullSrc = header ? `${header}\n${src}` : src;
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
  // Per-preset parameter label metadata — 4 labels matching uParam1..4 slots.
  // Presets not listed here show generic uParam1–4 labels.
  const GLSL_PRESET_META = {
    'Reef':   ['Speed ×2', 'WaveAmp ×0.8', 'Density ×2', 'ColorShift ×2π'],
    'Tunnel': ['Speed (-1..+1)', 'Dir X', 'Zoom (1–8×)', 'Width'],
  };

  const GLSL_PARAM_DEFAULT_LABELS = ['uParam1', 'uParam2', 'uParam3', 'uParam4'];

  function _updateGlslParamLabels(presetName) {
    const labels = GLSL_PRESET_META[presetName] ?? GLSL_PARAM_DEFAULT_LABELS;
    labels.forEach((lbl, i) => {
      const el = uniformsEl?.querySelector(`[data-param-id="glsl.param${i + 1}"] .param-label`);
      if (el) el.textContent = lbl;
    });
  }

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
    'Tunnel': `// uParam1=Speed(-1..+1, 0.5=stop)  uParam2=DirX  uParam3=Zoom(1-8x)  uParam4=Width
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
    'Reef': `// uParam1=Speed(x2)  uParam2=WaveAmp(x0.8)  uParam3=Density(x2)  uParam4=ColorShift(x2pi)
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
    _updateGlslParamLabels(glslPresetSel.value);
  });

  // Apply labels for the initially-selected preset
  _updateGlslParamLabels(glslPresetSel.value);

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

  // ── Frame Capture (non-realtime export) ──────────────────────────────────
  let _captureMode    = false;
  let _captureFrame   = 0;
  let _captureRunning = false;

  const _capPanel      = document.getElementById('capture-panel');
  const _capFrameLabel = document.getElementById('cap-frame-label');

  function _enterCaptureMode() {
    _captureMode  = true;
    _captureFrame = 0;
    _capPanel?.classList.remove('hidden');
    document.getElementById('btn-capture')?.classList.add('active');
  }

  function _exitCaptureMode() {
    _captureMode    = false;
    _captureRunning = false;
    _capPanel?.classList.add('hidden');
    document.getElementById('btn-capture')?.classList.remove('active');
  }

  function _stepCaptureFrame() {
    const fps      = parseFloat(document.getElementById('cap-fps')?.value) || 30;
    const fixedDt  = 1 / fps;
    // Temporarily un-gate, render one deterministic frame, then re-gate
    _captureMode = false;
    pipeline.render(inputs, ps, fixedDt);
    _captureMode = true;

    // Read back pipeline.prev (last composited frame) and download as PNG
    const rt = pipeline.prev;
    const w = rt.width, h = rt.height;
    const pixels = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, pixels);
    const tmp = document.createElement('canvas');
    tmp.width = w; tmp.height = h;
    const ctx = tmp.getContext('2d');
    const img = ctx.createImageData(w, h);
    for (let row = 0; row < h; row++) {
      const src = (h - 1 - row) * w * 4;
      img.data.set(pixels.subarray(src, src + w * 4), row * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    const frameNum = String(_captureFrame).padStart(4, '0');
    tmp.toBlob(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `imweb-capture-${frameNum}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, 'image/png');

    _captureFrame++;
    if (_capFrameLabel) _capFrameLabel.textContent = `Frame ${String(_captureFrame).padStart(4, '0')}`;
  }

  async function _autoCapture() {
    if (_captureRunning) { _captureRunning = false; return; }
    _captureRunning = true;
    const count = parseInt(document.getElementById('cap-count')?.value) || 1;
    const btn   = document.getElementById('cap-run');
    for (let i = 0; i < count && _captureRunning; i++) {
      _stepCaptureFrame();
      if (btn) btn.textContent = `Stop (${i + 1}/${count})`;
      await new Promise(r => setTimeout(r, 80)); // let browser flush download
    }
    _captureRunning = false;
    if (btn) btn.textContent = 'Auto-Run';
  }

  document.getElementById('btn-capture')?.addEventListener('click', () => {
    _captureMode ? _exitCaptureMode() : _enterCaptureMode();
  });
  document.getElementById('cap-step')?.addEventListener('click', _stepCaptureFrame);
  document.getElementById('cap-run')?.addEventListener('click',  _autoCapture);
  document.getElementById('cap-close')?.addEventListener('click', _exitCaptureMode);

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
    if ((e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') && e.key !== 'Escape') return;
    const isLocked = ps.get('global.keylock').value > 0.5;
    if (isLocked && (/^[vmcbskdxhtfqaz]$/i.test(e.key) || /^Digit[0-9]$/.test(e.code))) return;

    // Shift+1–8 = Select movie clip (check first so Nordic /=Shift+7 doesn't bleed into search)
    if (e.shiftKey && !e.metaKey && /^Digit[1-8]$/.test(e.code)) {
      const idx = parseInt(e.code.replace('Digit', '')) - 1;
      if (idx < movieInput.clips.length) {
        movieInput.selectClip(idx);
        if (ps.get('movie.active').value) movieInput.clips[idx]?.video.play().catch(() => {});
        refreshClipsList();
      }
      e.preventDefault();
      return; // prevent other shortcuts (e.g. / on Nordic layout) from also firing
    }

    // / = open parameter search
    if (e.key === '/' && !e.target.closest('input, textarea')) {
      e.preventDefault();
      openParamSearch();
      return;
    }

    // Numpad shortcuts (ImOs9 style)
    if (e.code === 'NumpadAdd')      { e.preventDefault(); presetMgr.nextPreset(); }
    if (e.code === 'NumpadSubtract') { e.preventDefault(); presetMgr.prevPreset(); }

    // Number keys 0–9 recall Display States (not when Shift is held — that selects movie clips)
    if (!e.altKey && !e.shiftKey && /^Digit[0-9]$/.test(e.code)) {
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
    if (e.key === 'v' && !e.metaKey) { e.preventDefault(); ps.set('camera.active', ps.get('camera.active').value > 0.5 ? 0 : 1); }
    // m = Movie on/off
    if (e.key === 'm' && !e.metaKey) { e.preventDefault(); ps.toggle('movie.active'); }
    // q/a/z = cycle FG / BG / DS source
    if (e.key === 'q' && !e.metaKey) {
      e.preventDefault();
      const p = ps.get('layer.fg'); const n = p.options.length;
      ps.set('layer.fg', (p.value + 1) % n);
    }
    if (e.key === 'a' && !e.metaKey) {
      e.preventDefault();
      const p = ps.get('layer.bg'); const n = p.options.length;
      ps.set('layer.bg', (p.value + 1) % n);
    }
    if (e.key === 'z' && !e.metaKey) {
      e.preventDefault();
      const p = ps.get('layer.ds'); const n = p.options.length;
      ps.set('layer.ds', (p.value + 1) % n);
    }
    // t = Tap tempo
    if (e.key === 't' && !e.metaKey) { e.preventDefault(); ps.trigger('global.tap'); }
    // h = Hold / Fade to black (toggle output.fade between 0 and 100)
    if (e.key === 'h' && !e.metaKey) {
      e.preventDefault();
      const fadeP = ps.get('output.fade');
      fadeP.value = fadeP.value > 0 ? 0 : 100;
    }
    // f = Fullscreen
    if (e.key === 'f' && !e.metaKey) { e.preventDefault(); toggleFullscreen(); }
    // Cmd/Ctrl+S = quick-save current state to active preset
    if ((e.metaKey || e.ctrlKey) && e.key === 's' && !e.target.closest('textarea,input')) {
      e.preventDefault();
      presetMgr.saveCurrentPreset(capturePresetThumb()).then(() => {
        presetsPanel._refresh();
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

  let _noiseColor1 = new THREE.Vector3(1, 1, 1);
  let _noiseColor2 = new THREE.Vector3(0, 0, 0);

  function _hexToVec3(hex) {
    const r = parseInt(hex.slice(1,3),16)/255;
    const g = parseInt(hex.slice(3,5),16)/255;
    const b = parseInt(hex.slice(5,7),16)/255;
    return new THREE.Vector3(r, g, b);
  }

  document.getElementById('color1-picker')?.addEventListener('input', e => {
    _noiseColor1 = _hexToVec3(e.target.value);
  });
  document.getElementById('color2-picker')?.addEventListener('input', e => {
    _noiseColor2 = _hexToVec3(e.target.value);
  });

  const HASH_ONLY_NOISE = new Set([8,9,10,11,12,13,23,24]);
  function _syncNoiseParamVisibility(typeIndex) {
    const hide = HASH_ONLY_NOISE.has(typeIndex);
    ['noise.octaves','noise.lacunarity','noise.gain'].forEach(id => {
      const row = document.querySelector(`.param-row[data-param-id="${id}"]`);
      if (row) row.style.display = hide ? 'none' : '';
    });
  }
  ps.get('noise.type').onChange(_syncNoiseParamVisibility);
  _syncNoiseParamVisibility(ps.get('noise.type').value);

  function _patchNoiseTypeOptgroups() {
    const sel = document.querySelector('.param-row[data-param-id="noise.type"] select');
    if (!sel) return;
    const optMap = new Map();
    sel.querySelectorAll('option').forEach(o => optMap.set(Number(o.value), o.textContent));
    const current = sel.value;
    sel.innerHTML = '';
    [
      { label: 'Classic',      indices: [0,1,2] },
      { label: 'Cellular',     indices: [3,4,14,15,16] },
      { label: 'Fractal',      indices: [5,6,7,31,32,33,34,35,36,37] },
      { label: 'Geometric',    indices: [17,18,19,20,21,22] },
      { label: 'Analog',       indices: [9,11,12,26,27,28,30,29,25] },
      { label: 'Hash/Digital', indices: [8,10,13,23,24] },
    ].forEach(({ label, indices }) => {
      const grp = document.createElement('optgroup');
      grp.label = label;
      indices.forEach(i => {
        const o = document.createElement('option');
        o.value = i; o.textContent = optMap.get(i) ?? String(i);
        grp.appendChild(o);
      });
      sel.appendChild(grp);
    });
    sel.value = current;
  }

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
    vasulkaWarp.resize(rW, rH);
    particles.resize(rW, rH);
    seq1.resize(rW, rH);
    seq2.resize(rW, rH);
    seq3.resize(rW, rH);
  }

  ps.get('output.resolution').onChange(idx => applyResolution(idx));

  // ── Resize handler ────────────────────────────────────────────────────────

  const resizeObserver = new ResizeObserver(() => {
    // If in ghost mode, the main canvas is hidden and should NOT be resized
    // as it's not the primary focus and might trigger unnecessary re-renders
    if (document.body.classList.contains('ghost-mode')) return;

    const idx = ps.get('output.resolution').value;
    if (idx === 0 || idx === 4) {
      applyResolution(idx);
    }
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

  // ── Pinch zoom on canvas (two-finger → scene3d.scale) ────────────────────
  {
    const _pinch = new Map();
    let _pinchBaseDist  = 0;
    let _pinchBaseScale = 0;

    canvas.addEventListener('pointerdown', e => {
      _pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    canvas.addEventListener('pointermove', e => {
      if (!_pinch.has(e.pointerId)) return;
      _pinch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (_pinch.size === 2) {
        const [a, b] = [..._pinch.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (_pinchBaseDist === 0) {
          _pinchBaseDist  = dist;
          _pinchBaseScale = ps.get('scene3d.scale')?.value ?? 1;
        } else {
          const ratio = dist / _pinchBaseDist;
          ps.set('scene3d.scale', Math.max(0.01, Math.min(50, _pinchBaseScale * ratio)));
        }
      }
    });
    const _pinchEnd = e => {
      _pinch.delete(e.pointerId);
      if (_pinch.size < 2) _pinchBaseDist = 0;
    };
    canvas.addEventListener('pointerup',     _pinchEnd);
    canvas.addEventListener('pointercancel', _pinchEnd);
  }

  // ── Render loop ───────────────────────────────────────────────────────────

  let lastTime = performance.now();
  let frameCount = 0;
  let autoCapTimer = 0;
  let scanTimer = 0;
  let scanDir = 1; // +1 fwd, -1 back (for ping-pong)
  let strobePhase = 0; // 0–1 phase within one strobe cycle
  let beatPhase = 0;   // accumulated beat counter (beats, increases at BPM rate)

  let _midiClockTickCount = 0;
  let _pendingMidiFrame = false;
  ctrl.onMidiTick = () => {
    _midiClockTickCount++;
    const res = Math.max(1, Math.round(ps.get('global.midisyncres').value));
    if (_midiClockTickCount % res === 0) {
      _pendingMidiFrame = true;
    }
  };

  function render(now) {
    requestAnimationFrame(render);

    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;

    // 1. Render Gating (MidiSync / AutoSync) — True Engine Lock
    // ────────────────────────────────────────────────────────────────────────
    let shouldRender = true;

    // MidiSync: wait for external MIDI clock trigger (0xF8)
    const midiSyncActive = ps.get('global.midisync').value;
    if (midiSyncActive) {
      if (!_pendingMidiFrame) shouldRender = false;
    }

    // AutoSync: divisor-based frame skipping (1 = realtime, 2 = half speed, etc)
    const autoSyncDiv = Math.max(1, Math.round(ps.get('global.autosync').value));
    if (autoSyncDiv > 1) {
      if (frameCount % autoSyncDiv !== 0) shouldRender = false;
    }

    if (_captureMode)   return; // capture mode: render only on explicit step
    if (!shouldRender)  return;

    // From here on, we are rendering a frame
    _pendingMidiFrame = false;
    frameCount++;
    profiler.begin();

    // 2. Logic Tick (Engine simulation advances only when rendering)
    // ────────────────────────────────────────────────────────────────────────

    // Tick slew (parameter lag/smoothing)
    ps.tickSlew(dt);

    // Advance beat phase
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

    // 3. Main Render Pass
    // ────────────────────────────────────────────────────────────────────────

    // Tick step sequencer
    stepSequencer.tick(beatPhase);
    // Update camera texture
    camera3d.tick();

    // Update movie clip
    movieInput.tick(ps, beatPhase, dt);

    // Tick stills buffer (reads fs1 → readIndex)
    stillsBuffer.tick(ps);

    // Tick and capture sequence buffers
    const _seqSrcTex = idx => [
      pipeline.prev.texture,       // 0 Output
      camera3d.currentTexture,     // 1 Camera
      movieInput.currentTexture,   // 2 Movie
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
    textLayer.tick(ps, dt);

    // Update sound level texture
    if (ctrl.sound) {
      const lvl = Math.round(Math.min(1, ctrl.sound.level * 4) * 255);
      soundData[0] = soundData[1] = soundData[2] = lvl;
      soundTexture.needsUpdate = true;

      // VU meter in status bar
      if (_vuCanvas) {
        _vuCanvas.style.display = 'inline-block';
        const W = _vuCanvas.width, H = _vuCanvas.height;
        _vuCtx.clearRect(0, 0, W, H);
        const bars = 4;
        const barW = W / bars - 1;
        const levels = [ctrl.sound.bass, ctrl.sound.mid, ctrl.sound.high, ctrl.sound.level];
        const colors = ['#4080ff', '#40c040', '#c0c040', '#e84040'];
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

    // Tick particle system — resolve luma mask source (only pre-ticked textures are safe)
    const _pmSrcMap = [
      null,                                                          // 0 None
      camera3d.active ? camera3d.currentTexture : null,             // 1 Camera
      movieInput.active ? movieInput.currentTexture : null,         // 2 Movie
      stillsBuffer.texture,                                         // 3 Buffer
      pipeline.prev.texture,                                        // 4 Output (prev frame)
      drawLayer.texture,                                            // 5 Draw
      _resolveLayerTex(ps.get('layer.fg').value),                   // 6 FG Src
      _resolveLayerTex(ps.get('layer.bg').value),                   // 7 BG Src
      _resolveLayerTex(ps.get('layer.ds')?.value ?? 0),             // 8 DS Src
    ];
    particles.tick(ps, dt, _pmSrcMap[ps.get('particle.masksrc').value] ?? null);
    // SDF dedicated texture source routing (decouples from layer.fg / layer.bg).
    // SELECT index 0 = follow the pipeline FG/BG layer (default, preserves old behaviour).
    // Indices 1–7 map to _resolveLayerTex's internal keys: Camera=0,Movie=1,Buffer=2,Color=3,Noise=4,3D=5,Draw=6
    // Index 8 = None → null (no texture update this frame).
    const _sdfSrcToLayerIdx = [null, 0, 1, 6, 4, 3, 2, 5, null];
    const _sdfTexIdx = ps.get('sdf.texSrc').value;
    const _sdfRefIdx = ps.get('sdf.refractSrc').value;
    const _sdfTex = _sdfTexIdx === 0
      ? _resolveLayerTex(ps.get('layer.fg').value)
      : (_sdfSrcToLayerIdx[_sdfTexIdx] != null ? _resolveLayerTex(_sdfSrcToLayerIdx[_sdfTexIdx]) : null);
    const _sdfRef = _sdfRefIdx === 0
      ? _resolveLayerTex(ps.get('layer.bg').value)
      : (_sdfSrcToLayerIdx[_sdfRefIdx] != null ? _resolveLayerTex(_sdfSrcToLayerIdx[_sdfRefIdx]) : null);
    sdfGen.tick(ps, dt, _sdfTex, _sdfRef);

    // Animate Color2 gradient when speed is non-zero
    const _c2speed = ps.get('color2.speed')?.value ?? 0;
    if (_c2speed !== 0) {
      _color2Phase += dt * _c2speed * 0.005; // 200 = 1 full cycle/sec
      updateColor2Texture();
    }

    // Generate BFG noise every frame (dedicated 512×512 target, always live)
    noiseTexture = pipeline.generateNoise({
      time:       lastTime / 1000,
      type:       ps.get('noise.type').value,
      scale:      ps.get('noise.scale').value,
      octaves:    ps.get('noise.octaves').value,
      lacunarity: ps.get('noise.lacunarity').value,
      gain:       ps.get('noise.gain').value,
      speed:      ps.get('noise.speed').value,
      offsetX:    ps.get('noise.offsetX').value,
      offsetY:    ps.get('noise.offsetY').value,
      contrast:   ps.get('noise.contrast').value,
      invert:     ps.get('noise.invert').value,
      seed:       ps.get('noise.seed').value,
      color:      ps.get('noise.color').value,
      color1:     _noiseColor1,
      color2:     _noiseColor2,
    });

    // Render 3D scene if active OR used as a layer source
    const SCENE3D_IDX  = 5;  // index in SOURCES array
    const DEPTH3D_IDX  = 20; // index in SOURCES array
    const depthUsed = ps.get('layer.fg').value === DEPTH3D_IDX
      || ps.get('layer.bg').value === DEPTH3D_IDX
      || ps.get('layer.ds').value === DEPTH3D_IDX;
    // Auto-enable depth pass when the depth3d source is routed
    if (depthUsed && !ps.get('scene3d.depth.active').value) {
      ps.set('scene3d.depth.active', 1);
    }
    const scene3dNeeded = ps.get('scene3d.active').value
      || ps.get('layer.fg').value === SCENE3D_IDX
      || ps.get('layer.bg').value === SCENE3D_IDX
      || ps.get('layer.ds').value === SCENE3D_IDX
      || depthUsed;
    if (scene3dNeeded) scene3d.render(ps, dt, {
      camera: camera3d.active ? camera3d.currentTexture : null,
      movie:  movieInput.active ? movieInput.currentTexture : null,
      screen: pipeline.prev.texture,
      draw:   drawLayer.texture,
      buffer: stillsBuffer.texture,
      warpMaps,
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
      depth3d: depthUsed ? scene3d.depthTexture : null,
      color:   colorTexture,
      color2:  color2Texture,
      sound:   soundTexture,
      noise:   noiseTexture,
      draw:    drawLayer.texture,
      text:    textLayer.texture,
      delay:   videoDelay.getTexture(ps.get('delay.frames').value),
      scope:    vectorscope.texture,
      slitscan:  slitScan.texture,
      vwarp:     vasulkaWarp.outputRT.texture,
      particles: particles.texture,
      sdf:       sdfGen.texture,
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
    pipeline.setCustomUniforms([
      ps.get('glsl.param1')?.normalized ?? 0,
      ps.get('glsl.param2')?.normalized ?? 0,
      ps.get('glsl.param3')?.normalized ?? 0,
      ps.get('glsl.param4')?.normalized ?? 0,
    ]);

    // Run compositing pipeline
    if (!strobeFreeze) {
      pipeline.render(inputs, ps, dt);
    }

    // Capture output into video delay ring buffer
    videoDelay.capture(pipeline.prev.texture);

    // Vasulka Warp — DEPRECATED: superseded by SequenceBuffer timewarp mode.
    // Kept for backward compatibility. Do not remove until timewarp mode is stable.
    if (ps.get('vwarp.active').value) {
      const speed = Math.round(ps.get('vwarp.speed').value) || 1;
      vasulkaWarp.applyParams(ps);
      vasulkaWarp.capture(camera3d.active ? camera3d.currentTexture : pipeline.prev.texture, speed);
      vasulkaWarp.render(pipeline.prev.texture);
    }

    // Sequence timewarp render — updates outputRT for each seq in timewarp mode.
    // Runs after pipeline so pipeline.prev.texture contains this frame's output.
    // Follows VasulkaWarp.render() pattern: direct render, not Pipeline FX chain.
    [seq1, seq2, seq3].forEach((seq, i) => {
      if (seq.mode === 'timewarp') {
        seq.renderTimewarp(pipeline.prev.texture, ps, i + 1);
      }
    });

    // Profiler + debug overlay
    profiler.end();
    profiler.tick(pipeline, sequencerManager);
    debugOverlay.tick(profiler._fps);

    // Video Out Spy + Second Screen — createImageBitmap shared path
    const spyVisible = _spyCanvas && !document.getElementById('video-spy')?.classList.contains('hidden');
    const outWinOpen = _outWin && !_outWin.closed && _outWinReady;
    // Second screen throttled to every 2nd frame (~30fps) to reduce GPU readback pressure
    const outWinDue  = outWinOpen && (++_outFrameTick % 2 === 0);

    if (spyVisible || outWinDue) {
      createImageBitmap(canvas).then(bitmap => {
        if (spyVisible) _spyCtx.drawImage(bitmap, 0, 0, 160, 90);
        if (outWinDue && !_outWin?.closed) {
          const _pmActive = ps.get('projmap.active').value;
          const _pmCorners = _pmActive ? {
            tl: { x: ps.get('projmap.tl_x').value, y: ps.get('projmap.tl_y').value },
            tr: { x: ps.get('projmap.tr_x').value, y: ps.get('projmap.tr_y').value },
            br: { x: ps.get('projmap.br_x').value, y: ps.get('projmap.br_y').value },
            bl: { x: ps.get('projmap.bl_x').value, y: ps.get('projmap.bl_y').value },
          } : null;
          _outWin.postMessage({ bitmap, corners: _pmCorners }, '*', [bitmap]);
        } else {
          bitmap.close();
        }
      });
    }

    // ── Warp Grid Overlay ───────────────────────────────────────────────────
    const warpGridOn = ps.get('global.showwarpgrid').value;
    const overlayCvs = document.getElementById('warp-grid-overlay');
    const overlayCtx = overlayCvs?.getContext('2d');
    if (overlayCtx) {
      if (!warpGridOn) {
        overlayCtx.clearRect(0, 0, overlayCvs.width, overlayCvs.height);
      } else {
        const rect = canvas.getBoundingClientRect();
        if (overlayCvs.width !== rect.width || overlayCvs.height !== rect.height) {
          overlayCvs.width = rect.width;
          overlayCvs.height = rect.height;
        }
        const w = overlayCvs.width, h = overlayCvs.height;
        overlayCtx.clearRect(0, 0, w, h);
        overlayCtx.strokeStyle = 'rgba(0, 255, 255, 0.35)';
        overlayCtx.lineWidth = 1;
        const cols = warpEditor.cols, rows = warpEditor.rows;
        // Horizontal lines
        for (let j = 0; j < rows; j++) {
          overlayCtx.beginPath();
          for (let i = 0; i < cols; i++) {
            const ni = i / (cols - 1), nj = j / (rows - 1);
            const { dx, dy } = warpEditor.dispAt(ni, nj);
            overlayCtx.lineTo((ni + dx) * w, (nj + dy) * h);
          }
          overlayCtx.stroke();
        }
        // Vertical lines
        for (let i = 0; i < cols; i++) {
          overlayCtx.beginPath();
          for (let j = 0; j < rows; j++) {
            const ni = i / (cols - 1), nj = j / (rows - 1);
            const { dx, dy } = warpEditor.dispAt(ni, nj);
            overlayCtx.lineTo((ni + dx) * w, (nj + dy) * h);
          }
          overlayCtx.stroke();
        }
      }
    }

    // FrameDonePulse — send MIDI CC pulse on frame completion (Phase 5)
    if (ps.get('global.framedone').value && ctrl.midi) {
      // Send CC 120 (unassigned) pulse on channel 16
      ctrl.sendCC(16, 120, 127);
      setTimeout(() => ctrl.sendCC(16, 120, 0), 5); // short 5ms pulse
    }
  }

  requestAnimationFrame(render);

  // ── AI Features ───────────────────────────────────────────────────────────

  // ── AI Settings panel ─────────────────────────────────────────────────────
  (() => {
    const panel = document.createElement('div');
    panel.id = 'ai-settings-panel';
    panel.className = 'ai-settings-panel hidden';
    document.body.appendChild(panel);

    const aiFeatures = new AIFeatures(ps, null); // UI.js handles its own building

    import('./ui/UI.js').then(UI => {
      UI.buildAISettingsPanel(aiFeatures, panel);
    });

    document.getElementById('btn-ai-settings')?.addEventListener('click', e => {
      panel.classList.toggle('hidden');
      e.stopPropagation();
    });

    document.addEventListener('click', e => {
      if (!panel.contains(e.target) && e.target.id !== 'btn-ai-settings') {
        panel.classList.add('hidden');
      }
    });
  })();

  // ── Feature 1: AI Preset Generator ────────────────────────────────────────
  (() => {
    const container = document.getElementById('ai-preset-ui');
    if (!container) return;

    container.innerHTML = `
      <div style="padding:8px 10px;display:flex;flex-direction:column;gap:6px;">
        <div style="font-size:10px;color:var(--text-2);font-family:var(--mono);">
          Describe a visual mood or look:
        </div>
        <textarea id="ai-preset-input" class="ai-text-input"
          placeholder="e.g. slow organic ocean, aggressive glitch rhythm, dreamy feedback vortex…"
          rows="2"></textarea>
        <button id="ai-preset-btn" class="import-btn">✦ Generate Preset</button>
        <div id="ai-preset-result" class="ai-result hidden"></div>
      </div>
    `;

    document.getElementById('ai-preset-btn')?.addEventListener('click', async () => {
      const input = document.getElementById('ai-preset-input');
      const result = document.getElementById('ai-preset-result');
      const btn    = document.getElementById('ai-preset-btn');
      const desc   = input.value.trim();
      if (!desc) return;

      if (!getApiKey()) {
        result.textContent = '⚠ No API key set — click ⚙ in the status bar.';
        result.classList.remove('hidden');
        return;
      }

      btn.textContent = '⏳ Generating…';
      btn.disabled = true;
      result.classList.add('hidden');

      try {
        const { params, explanation } = await generatePreset(desc);
        // Apply parameters
        let applied = 0;
        for (const [id, val] of Object.entries(params)) {
          const p = ps.get(id);
          if (p) { ps.set(id, val); applied++; }
        }
        result.textContent = `✦ ${explanation} (${applied} params set)`;
        result.classList.remove('hidden');
        result.style.color = '';
      } catch (err) {
        result.textContent = err.message === 'no-key'
          ? '⚠ No API key — click ⚙ in the status bar.'
          : `✗ ${err.message}`;
        result.classList.remove('hidden');
        result.style.color = 'var(--red, #e05)';
      } finally {
        btn.textContent = '✦ Generate Preset';
        btn.disabled = false;
      }
    });
  })();

  // ── Feature 2: Parameter Narrator ─────────────────────────────────────────
  let _narratorActive  = false;
  let _narratorTimer   = null;
  const _narratorOverlay = document.getElementById('ai-narrator-overlay');

  async function _runNarrator() {
    if (!_narratorActive) return;
    try {
      const snapshot = buildStateSnapshot(ps);
      const text     = await narrateState(snapshot);
      if (_narratorOverlay && _narratorActive) {
        _narratorOverlay.textContent = text;
      }
    } catch (err) { /* silent — narrator is non-critical */ }
    if (_narratorActive) _narratorTimer = setTimeout(_runNarrator, 2500);
  }

  function _toggleNarrator() {
    _narratorActive = !_narratorActive;
    const btn = document.getElementById('btn-ai-narrator');
    btn?.classList.toggle('active', _narratorActive);
    if (_narratorOverlay) _narratorOverlay.classList.toggle('hidden', !_narratorActive);
    if (_narratorActive) {
      if (!getApiKey()) {
        _narratorOverlay && (_narratorOverlay.textContent = '⚠ No API key — click ⚙');
      } else {
        _runNarrator();
      }
    } else {
      clearTimeout(_narratorTimer);
    }
  }

  document.getElementById('btn-ai-narrator')?.addEventListener('click', _toggleNarrator);

  // ── Feature 3: Performance Coach ──────────────────────────────────────────
  let _coachActive    = false;
  let _coachTimer     = null;
  const _recentChanges = []; // { id, t } — last 30 seconds of param changes
  let _coachNotif     = null;

  // Track parameter changes for coach — register per-param listeners on all params
  {
    const _trackChange = (id) => {
      const now = Date.now();
      _recentChanges.push({ id, t: now });
      const cutoff = now - 30000;
      while (_recentChanges.length > 0 && _recentChanges[0].t < cutoff) _recentChanges.shift();
    };
    for (const param of ps.getAll()) {
      param.onChange(() => _trackChange(param.id));
    }
  }

  function _showCoachNotif(text) {
    if (!_coachNotif) {
      _coachNotif = document.createElement('div');
      _coachNotif.id = 'ai-coach-notif';
      _coachNotif.className = 'ai-coach-notif';
      document.body.appendChild(_coachNotif);
    }
    _coachNotif.textContent = `⬡ ${text}`;
    _coachNotif.classList.remove('fadeout');
    _coachNotif.style.opacity = '1';
    // Fade out after 10s
    setTimeout(() => {
      _coachNotif.style.opacity = '0';
    }, 10000);
  }

  async function _runCoach() {
    if (!_coachActive) return;
    try {
      const snapshot = buildActivitySnapshot(_recentChanges, ps);
      const text     = await coachSuggestion(snapshot);
      if (text && _coachActive) _showCoachNotif(text);
    } catch (err) { /* silent */ }
    if (_coachActive) _coachTimer = setTimeout(_runCoach, 30000);
  }

  function _toggleCoach() {
    _coachActive = !_coachActive;
    const btn = document.getElementById('btn-ai-coach');
    btn?.classList.toggle('active', _coachActive);
    if (_coachActive) {
      if (!getApiKey()) {
        _showCoachNotif('⚠ No API key — click ⚙ in status bar');
      } else {
        _showCoachNotif('Performance Coach active — watching for 30s…');
        _coachTimer = setTimeout(_runCoach, 30000);
      }
    } else {
      clearTimeout(_coachTimer);
    }
  }

  document.getElementById('btn-ai-coach')?.addEventListener('click', _toggleCoach);

  // Keyboard shortcuts for narrator (N) and coach (P)
  // (added to existing keydown handler via additional listener)
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if (e.key === 'n' || e.key === 'N') _toggleNarrator();
    if (e.key === 'p' || e.key === 'P') _toggleCoach();
  });

  console.log('%cImWeb ready — press V to start camera, 3D tab for scene', 'color:#9090a8');

  // Register service worker for PWA / offline support
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ── Dev Capture Modal (Ctrl+Cmd+C) ───────────────────────────────────────
  // Sends screenshot + audio + state JSON to dev-catcher.js on :5174.
  // Only active during development; harmless if :5174 is not running.

  let _dcRecorder   = null;
  let _dcChunks     = [];
  let _dcStream     = null;
  let _dcVisible    = false;

  const _dcModal = document.createElement('div');
  _dcModal.id = 'dev-capture-modal';
  Object.assign(_dcModal.style, {
    position:       'fixed',
    bottom:         '24px',
    left:           '50%',
    transform:      'translateX(-50%)',
    background:     'rgba(18,18,26,0.92)',
    border:         '1px solid #3a3a50',
    borderRadius:   '8px',
    padding:        '12px 18px',
    display:        'none',
    alignItems:     'center',
    gap:            '12px',
    zIndex:         '99999',
    fontFamily:     'monospace',
    fontSize:       '12px',
    color:          'var(--text-1, #e0e0f0)',
    backdropFilter: 'blur(6px)',
    boxShadow:      '0 4px 24px rgba(0,0,0,0.6)',
    userSelect:     'none',
  });

  const _dcLabel  = document.createElement('span');
  _dcLabel.textContent = 'Dev Capture';
  _dcLabel.style.cssText = 'color:var(--text-2,#8888a0);font-size:11px;';

  const _dcBtn    = document.createElement('button');
  _dcBtn.textContent = 'Start Recording';
  Object.assign(_dcBtn.style, {
    background:   'var(--accent,#c8a020)',
    color:        '#12121a',
    border:       'none',
    borderRadius: '4px',
    padding:      '4px 12px',
    cursor:       'pointer',
    fontFamily:   'monospace',
    fontSize:     '12px',
    fontWeight:   '700',
  });

  const _dcStatus = document.createElement('span');
  _dcStatus.style.cssText = 'color:var(--accent,#c8a020);font-size:11px;min-width:60px;';

  const _dcClose  = document.createElement('button');
  _dcClose.textContent = '✕';
  Object.assign(_dcClose.style, {
    background: 'transparent',
    border:     'none',
    color:      'var(--text-2,#8888a0)',
    cursor:     'pointer',
    fontFamily: 'monospace',
    fontSize:   '14px',
    padding:    '0 2px',
  });

  _dcModal.append(_dcLabel, _dcBtn, _dcStatus, _dcClose);
  document.body.appendChild(_dcModal);

  function _dcOpen() {
    if (_dcVisible) return;
    _dcVisible = true;
    _dcModal.style.display = 'flex';
    _dcBtn.textContent = 'Start Recording';
    _dcStatus.textContent = '';
  }

  function _dcClose2() {
    _dcVisible = false;
    _dcModal.style.display = 'none';
    if (_dcRecorder && _dcRecorder.state !== 'inactive') _dcRecorder.stop();
    _dcStream?.getTracks().forEach(t => t.stop());
    _dcRecorder = null;
    _dcStream   = null;
    _dcChunks   = [];
    _dcBtn.textContent = 'Start Recording';
    _dcStatus.textContent = '';
  }

  _dcClose.addEventListener('click', _dcClose2);

  _dcBtn.addEventListener('click', async () => {
    if (_dcBtn.textContent === 'Start Recording') {
      // — Grab canvas snapshot immediately
      const cvs = document.getElementById('output-canvas');
      const imgDataUrl = cvs.toDataURL('image/png');

      // — Capture current parameter state
      const stateObj = {};
      ps.getAll().forEach(p => { stateObj[p.id] = p.value; });

      // — Start audio recording
      try {
        _dcStream  = await navigator.mediaDevices.getUserMedia({ audio: true });
        _dcChunks  = [];
        _dcRecorder = new MediaRecorder(_dcStream);
        _dcRecorder.ondataavailable = e => { if (e.data.size > 0) _dcChunks.push(e.data); };

        // Store snapshot + state on the recorder for use in onstop
        _dcRecorder._imgDataUrl = imgDataUrl;
        _dcRecorder._stateObj   = stateObj;

        _dcRecorder.onstop = async () => {
          _dcStatus.textContent = 'Sending…';
          try {
            const audioBlob = new Blob(_dcChunks, { type: 'audio/webm' });
            const imgBlob   = await fetch(_dcRecorder._imgDataUrl).then(r => r.blob());
            const stateBlob = new Blob(
              [JSON.stringify(_dcRecorder._stateObj, null, 2)],
              { type: 'application/json' }
            );

            const fd = new FormData();
            fd.append('files', imgBlob,   'screenshot.png');
            fd.append('files', audioBlob, 'audio.webm');
            fd.append('files', stateBlob, 'state.json');

            await fetch('http://localhost:5174/capture', { method: 'POST', body: fd });
            _dcStatus.textContent = 'Saved!';
            setTimeout(_dcClose2, 1500);
          } catch (err) {
            console.warn('[DevCapture] send failed:', err);
            _dcStatus.textContent = 'Error :(';
          }
        };

        _dcRecorder.start();
        _dcBtn.textContent = 'Stop & Save';
        _dcStatus.textContent = '● REC';
        _dcStatus.style.color = '#e84040';
      } catch (err) {
        console.warn('[DevCapture] mic denied:', err);
        _dcStatus.textContent = 'No mic';
      }
    } else {
      // Stop recording — onstop handler fires async and sends
      _dcStatus.style.color = 'var(--accent,#c8a020)';
      _dcBtn.disabled = true;
      _dcRecorder?.stop();
      _dcStream?.getTracks().forEach(t => t.stop());
    }
  });

  window.addEventListener('keydown', e => {
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'd') {
      e.preventDefault();
      _dcVisible ? _dcClose2() : _dcOpen();
    }
  });

  // Auto-load all clips from _imweb_ready/manifest.json on startup
  try {
    const res = await fetch('/_imweb_ready/manifest.json');
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
      console.info(`[ImWeb] Loaded ${movieInput.clips.length} clip(s) from _imweb_ready/`);
    }
  } catch (e) {
    console.warn('[ImWeb] No _imweb_ready manifest found — add clips manually.');
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
  const panel = document.createElement('div');
  panel.id = 'vkbd-panel';
  panel.classList.add('hidden');

  const handle = document.createElement('div');
  handle.className = 'vkbd-handle';
  handle.textContent = '⌨ Virtual Keyboard — drag to move';
  panel.appendChild(handle);

  const rows = [
    [['Esc','Escape'],['F1','F1'],['F2','F2'],['F3','F3'],['F4','F4'],['F5','F5'],['F6','F6'],['F7','F7'],['F8','F8']],
    [['`','`'],['1','1'],['2','2'],['3','3'],['4','4'],['5','5'],['6','6'],['7','7'],['8','8'],['9','9'],['0','0'],['-','-'],['=','='],['⌫','Backspace']],
    [['Tab','Tab'],['q','q'],['w','w'],['e','e'],['r','r'],['t','t'],['y','y'],['u','u'],['i','i'],['o','o'],['p','p'],['[','['],[ ']',']'],['↵','Enter']],
    [['Caps','CapsLock'],['a','a'],['s','s'],['d','d'],['f','f'],['g','g'],['h','h'],['j','j'],['k','k'],['l','l'],[';',';'],["'","'"]],
    [['⇧','Shift'],['z','z'],['x','x'],['c','c'],['v','v'],['b','b'],['n','n'],['m','m'],[',',','],['.','.'],['/','/']],
    [['Ctrl','Control'],['Alt','Alt'],['⎵',' '],['←','ArrowLeft'],['↓','ArrowDown'],['↑','ArrowUp'],['→','ArrowRight']],
  ];

  rows.forEach(row => {
    const rowEl = document.createElement('div');
    rowEl.className = 'vkbd-row';
    row.forEach(([label, key]) => {
      const btn = document.createElement('button');
      btn.className = 'vkbd-key';
      btn.textContent = label;
      if (label.length > 2) btn.classList.add('vkbd-key-wide');
      if (key === ' ')      btn.classList.add('vkbd-key-xl');
      btn.addEventListener('pointerdown', e => {
        e.preventDefault();
        btn.classList.add('pressed');
        document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      });
      btn.addEventListener('pointerup', () => {
        btn.classList.remove('pressed');
        document.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true }));
      });
      btn.addEventListener('pointercancel', () => btn.classList.remove('pressed'));
      rowEl.appendChild(btn);
    });
    panel.appendChild(rowEl);
  });

  // Drag to reposition
  let _dragX = 0, _dragY = 0, _panelX = 0, _panelY = 0, _dragging = false;
  handle.addEventListener('pointerdown', e => {
    _dragging = true;
    _dragX = e.clientX; _dragY = e.clientY;
    const r = panel.getBoundingClientRect();
    _panelX = r.left; _panelY = r.top;
    handle.setPointerCapture(e.pointerId);
    panel.style.transform = 'none';
    panel.style.left = _panelX + 'px';
    panel.style.top  = _panelY + 'px';
    panel.style.bottom = 'auto';
  });
  handle.addEventListener('pointermove', e => {
    if (!_dragging) return;
    panel.style.left = (_panelX + e.clientX - _dragX) + 'px';
    panel.style.top  = (_panelY + e.clientY - _dragY) + 'px';
  });
  handle.addEventListener('pointerup', () => { _dragging = false; });

  document.body.appendChild(panel);
  return panel;
}

// Show virtual keyboard button only on touch-capable devices
if (window.matchMedia('(pointer: coarse)').matches) {
  const btnVkbd = document.getElementById('btn-vkbd');
  if (btnVkbd) {
    btnVkbd.style.display = '';
    let _vkbdPanel = null;
    btnVkbd.addEventListener('click', () => {
      if (!_vkbdPanel) _vkbdPanel = buildVirtualKeyboard();
      _vkbdPanel.classList.toggle('hidden');
      btnVkbd.classList.toggle('active', !_vkbdPanel.classList.contains('hidden'));
    });
  }
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
