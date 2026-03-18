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
import { CameraInput }    from './inputs/CameraInput.js';
import { MovieInput }     from './inputs/MovieInput.js';
import { StillsBuffer }   from './inputs/StillsBuffer.js';
import { DrawLayer }      from './inputs/DrawLayer.js';
import { TextLayer }      from './inputs/TextLayer.js';
import { buildWarpMaps }  from './inputs/WarpMaps.js';
import { SceneManager } from './scene3d/SceneManager.js';
import { Pipeline } from './core/Pipeline.js';
import { PresetManager, openDB } from './state/Preset.js';
import { OSCBridge }    from './io/OSCBridge.js';
import { ProjectFile }  from './io/ProjectFile.js';
import {
  initTabs,
  buildLayerButtons,
  buildMappingPanels,
  buildGeometryButtons,
  StateDots,
  SignalPath,
  ContextMenu,
  FeedbackOverlay,
  PresetsPanel,
  FPSDisplay,
  TablesEditor,
} from './ui/UI.js';

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log('%cImWeb v0.2', 'color:#e8c840;font-weight:bold;font-size:14px');

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

  // ── 4. Input sources ──────────────────────────────────────────────────────

  const camera3d = new CameraInput();
  await camera3d.init();

  const movieInput = new MovieInput();

  const stillsBuffer = new StillsBuffer(renderer, W, H);
  const warpMaps     = buildWarpMaps(); // 8 procedural warp map textures (map1–map8)
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

  // Color2 input — second solid color source
  const color2Canvas = document.createElement('canvas');
  color2Canvas.width = color2Canvas.height = 4;
  const color2Ctx = color2Canvas.getContext('2d');
  const color2Texture = new THREE.CanvasTexture(color2Canvas);

  function updateColor2Texture() {
    const h = ps.get('color2.hue').value / 100;
    const s = ps.get('color2.sat').value / 100;
    const v = ps.get('color2.val').value / 100;
    color2Ctx.fillStyle = hsvToHex(h, s, v);
    color2Ctx.fillRect(0, 0, 4, 4);
    color2Texture.needsUpdate = true;
  }
  ['color2.hue','color2.sat','color2.val'].forEach(id => ps.get(id).onChange(updateColor2Texture));
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

  const presetMgr = new PresetManager(ps, ctrl);
  await presetMgr.init();

  // Wire tableManager into ParameterSystem so controller setNormalized() applies curves
  setTableManager(tableManager);
  await tableManager.init(await openDB());

  // ── BPM / Tap Tempo ───────────────────────────────────────────────────────
  const bpmEl = document.getElementById('status-bpm');
  ps.get('global.bpm').onChange(bpm => {
    ctrl.syncBPM(bpm);
    if (bpmEl) bpmEl.textContent = `${Math.round(bpm)} bpm`;
  });
  // Click BPM indicator = tap tempo
  bpmEl?.addEventListener('click', () => ps.trigger('global.tap'));

  const _tapTimes = [];
  ps.get('global.tap').onTrigger(() => {
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
  buildGeometryButtons(ps, scene3d);

  const stateDots   = new StateDots(presetMgr);
  const signalPath  = new SignalPath(ps);
  const feedbackOl  = new FeedbackOverlay(ps);
  const presetsPanel = new PresetsPanel(presetMgr);
  const fpsDisplay    = new FPSDisplay();
  const tablesEditor  = new TablesEditor(tableManager);

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
      inp.onchange = async e => {
        const file = e.target.files[0];
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

    ioRow.appendChild(btnExport);
    ioRow.appendChild(btnImport);
    presetsSection.appendChild(ioRow);
  })();

  // ── Camera controls ───────────────────────────────────────────────────────

  const cameraRow = document.createElement('div');
  cameraRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:8px 10px;';

  const btnCameraOn = document.createElement('button');
  btnCameraOn.className = 'import-btn';
  btnCameraOn.textContent = '▶ Camera';

  const camDeviceSel = document.createElement('select');
  camDeviceSel.className = 'param-select';
  camDeviceSel.style.cssText = 'flex:1;font-size:11px;';
  camDeviceSel.innerHTML = '<option value="">default</option>';

  cameraRow.appendChild(btnCameraOn);
  cameraRow.appendChild(camDeviceSel);
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
    movieInput.clips.forEach((clip, i) => {
      const item = document.createElement('div');
      item.className = `clip-item ${i === movieInput.currentIndex ? 'active' : ''}`;
      item.innerHTML = `<span>${i}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis">${clip.name}</span><span style="color:var(--text-2)">${clip.duration.toFixed(1)}s</span>`;
      item.addEventListener('click', () => {
        movieInput.selectClip(i);
        if (ps.get('movie.active').value) {
          clip.video.play().catch(() => {});
        }
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

  const BUFFER_SIZES = [4, 8, 16, 32];

  // Per-capture-button pinned target slots (null = auto-advance write head)
  const captureTargetSlots = { screen: null, camera: null, movie: null, draw: null };

  /** Resolve texture for source key. */
  function texForSource(src) {
    if (src === 'screen') return pipeline.prev.texture;
    if (src === 'camera') return camera3d.active  ? camera3d.currentTexture  : null;
    if (src === 'movie')  return movieInput.active ? movieInput.currentTexture : null;
    if (src === 'draw')   return drawLayer.texture;
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
    const keys   = ['screen', 'camera', 'movie', 'draw'];
    captureSource(keys[srcIdx] ?? 'screen');
  }

  // Trigger bindings (MIDI-mappable)
  ps.get('buffer.capture').onTrigger(captureFromSource);
  ps.get('buffer.cap_screen').onTrigger(() => captureSource('screen'));
  ps.get('buffer.cap_video').onTrigger(()  => captureSource('camera'));
  ps.get('buffer.cap_movie').onTrigger(()  => captureSource('movie'));

  ps.get('screen.bg1').onTrigger(() => stillsBuffer.captureBG(0, pipeline.prev.texture));
  ps.get('screen.bg2').onTrigger(() => stillsBuffer.captureBG(1, pipeline.prev.texture));

  // Buffer size change — resize slot array, rebuild grid
  ps.get('buffer.size').onChange(idx => {
    const n = BUFFER_SIZES[idx] ?? 16;
    stillsBuffer.setFrameCount(n);
    // Clamp fs1 max to new size
    const fs1 = ps.get('buffer.fs1');
    fs1.max = n - 1;
    fs1.value = Math.min(fs1.value, n - 1);
    rebuildBufferGrid();
  });

  // Draw layer triggers
  ps.get('draw.clear').onTrigger(() => drawLayer.clear());

  // Text layer triggers
  ps.get('text.advance').onTrigger(() => textLayer.advance());

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

  const bufferCanvas  = document.getElementById('buffer-canvas');
  const bufferCtx     = bufferCanvas?.getContext('2d');
  const CANVAS_W      = bufferCanvas?.width  ?? 320;
  const CANVAS_H      = bufferCanvas?.height ?? 240;
  const BCOLS         = 4; // always 4 columns; rows scale with frame count

  // Computed per refresh based on current frameCount
  function gridCellSize() {
    const rows = Math.ceil(stillsBuffer.frameCount / BCOLS);
    return { cw: CANVAS_W / BCOLS, ch: CANVAS_H / rows };
  }

  function refreshBufferGrid() {
    if (!bufferCtx) return;
    const { cw, ch } = gridCellSize();
    const n = stillsBuffer.frameCount;

    bufferCtx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    for (let i = 0; i < n; i++) {
      const col = i % BCOLS;
      const row = Math.floor(i / BCOLS);
      const x   = col * cw;
      const y   = row * ch;
      const isRead  = i === stillsBuffer.readIndex;
      const isWrite = i === ((stillsBuffer.writeIndex - 1 + n) % n) && stillsBuffer._hasFrame[i];

      // Cell background
      bufferCtx.fillStyle = isRead ? '#2a2a3a' : '#111118';
      bufferCtx.fillRect(x, y, cw - 1, ch - 1);

      // Thumbnail
      if (stillsBuffer._hasFrame[i]) {
        const thumbH = Math.min(ch - 2, 45 * (cw / 80));
        bufferCtx.drawImage(
          stillsBuffer.thumbnailCanvases[i],
          x, y + Math.floor((ch - thumbH) / 2), cw - 1, thumbH,
        );
      }

      // Frame index label
      bufferCtx.fillStyle = isRead ? '#e8c840' : isWrite ? '#60a0e0' : '#404050';
      bufferCtx.font = '9px monospace';
      bufferCtx.fillText(`${i}`, x + 3, y + 10);

      // Write-head marker
      if (i === stillsBuffer.writeIndex) {
        bufferCtx.strokeStyle = '#60a0e0';
        bufferCtx.lineWidth = 1;
        bufferCtx.strokeRect(x + 0.5, y + 0.5, cw - 2, ch - 2);
      }
    }
  }

  /** Rebuild grid canvas size when slot count changes. */
  function rebuildBufferGrid() {
    if (!bufferCanvas) return;
    const rows = Math.ceil(stillsBuffer.frameCount / BCOLS);
    bufferCanvas.height = rows * (CANVAS_W / BCOLS); // keep cell aspect ~4:3
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

    // ── Size selector ────────────────────────────────────────────────────
    const sizeRow = document.createElement('div');
    sizeRow.style.cssText = 'display:flex;align-items:center;gap:6px;padding:0 10px 6px;flex-wrap:wrap;';

    const sizeLabel = document.createElement('span');
    sizeLabel.textContent = 'Slots:';
    sizeLabel.style.cssText = 'font-size:11px;color:var(--text-2);min-width:36px;';
    sizeRow.appendChild(sizeLabel);

    const sizeParam = ps.get('buffer.size');
    const sizeBtns  = [];
    BUFFER_SIZES.forEach((n, i) => {
      const btn = document.createElement('button');
      btn.className = 'source-btn';
      btn.textContent = String(n);
      btn.classList.toggle('active', i === sizeParam.value);
      btn.addEventListener('click', () => {
        sizeParam.value = i;
        sizeBtns.forEach((b, j) => b.classList.toggle('active', j === i));
      });
      sizeBtns.push(btn);
      sizeRow.appendChild(btn);
    });

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
    const { cw, ch } = gridCellSize();
    const mx  = (e.clientX - rect.left) * (CANVAS_W / rect.width);
    const my  = (e.clientY - rect.top)  * (bufferCanvas.height / rect.height);
    const idx = Math.floor(my / ch) * BCOLS + Math.floor(mx / cw);
    if (idx >= 0 && idx < stillsBuffer.frameCount) {
      ps.set('buffer.fs1', idx);
      refreshBufferGrid();
    }
  });

  ps.get('buffer.fs1').onChange(refreshBufferGrid);
  rebuildBufferGrid();

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

  // ── Keyboard shortcuts ────────────────────────────────────────────────────

  window.addEventListener('keydown', e => {
    if (e.metaKey || e.ctrlKey) return;

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
    // Escape = exit fullscreen
    if (e.key === 'Escape') { document.body.classList.remove('fullscreen-output'); }
  });

  // ── Resize handler ────────────────────────────────────────────────────────

  const resizeObserver = new ResizeObserver(() => {
    W = canvas.parentElement.clientWidth;
    H = canvas.parentElement.clientHeight;
    renderer.setSize(W, H);
    pipeline.resize(W, H);
    scene3d.resize(W, H);
    stillsBuffer.resize(W, H);
  });
  resizeObserver.observe(canvas.parentElement);

  // ── Render loop ───────────────────────────────────────────────────────────

  let lastTime = performance.now();
  let frameCount = 0;
  let autoCapTimer = 0;
  let scanTimer = 0;
  let scanDir = 1; // +1 fwd, -1 back (for ping-pong)

  function render(now) {
    requestAnimationFrame(render);

    const dt = Math.min((now - lastTime) / 1000, 0.1); // cap at 100ms
    lastTime = now;
    frameCount++;

    // Tick controllers (LFOs, random, etc.)
    ctrl.tick(dt);

    // Update camera texture
    camera3d.tick();

    // Update movie clip
    movieInput.tick(ps);

    // Tick stills buffer (reads fs1 → readIndex)
    stillsBuffer.tick(ps);

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
    }

    // Generate GPU noise every 2 frames
    if (frameCount % 2 === 0) {
      noiseTexture = pipeline.generateNoise(
        lastTime / 1000,
        ps.get('noise.type').value,
      );
    }

    // Render 3D scene to its render target
    if (ps.get('scene3d.active').value) {
      scene3d.render(ps);
    }

    // Assemble input sources
    const inputs = {
      camera:  camera3d.active ? camera3d.currentTexture : null,
      movie:   movieInput.active ? movieInput.currentTexture : null,
      buffer:  stillsBuffer.texture,
      bg1:     stillsBuffer.bgTexture(0),
      bg2:     stillsBuffer.bgTexture(1),
      scene3d: ps.get('scene3d.active').value ? scene3d.texture : null,
      color:   colorTexture,
      color2:  color2Texture,
      sound:   soundTexture,
      noise:   noiseTexture,
      draw:    drawLayer.texture,
      text:    textLayer.texture,
      warpMaps,
    };

    // Run compositing pipeline
    pipeline.render(inputs, ps, dt);

    // FPS counter
    fpsDisplay.tick();
  }

  requestAnimationFrame(render);

  console.log('%cImWeb ready — press V to start camera, 3D tab for scene', 'color:#9090a8');
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
