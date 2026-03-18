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
import { ParameterSystem, registerCoreParameters } from './controls/ParameterSystem.js';
import { ControllerManager } from './controls/ControllerManager.js';
import { CameraInput }    from './inputs/CameraInput.js';
import { MovieInput }     from './inputs/MovieInput.js';
import { StillsBuffer }   from './inputs/StillsBuffer.js';
import { SceneManager } from './scene3d/SceneManager.js';
import { Pipeline } from './core/Pipeline.js';
import { PresetManager } from './state/Preset.js';
import {
  initTabs,
  buildMappingPanels,
  buildGeometryButtons,
  StateDots,
  SignalPath,
  ContextMenu,
  FeedbackOverlay,
  PresetsPanel,
  FPSDisplay,
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

  // Noise texture (updated each frame via shader — using canvas for now)
  const noiseCanvas = document.createElement('canvas');
  noiseCanvas.width = noiseCanvas.height = 256;
  const noiseCtx = noiseCanvas.getContext('2d');
  const noiseTexture = new THREE.CanvasTexture(noiseCanvas);

  function updateNoise() {
    const img = noiseCtx.createImageData(256, 256);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = Math.random() * 255;
      img.data[i] = img.data[i+1] = img.data[i+2] = v;
      img.data[i+3] = 255;
    }
    noiseCtx.putImageData(img, 0, 0);
    noiseTexture.needsUpdate = true;
  }

  // ── 5. Pipeline ───────────────────────────────────────────────────────────

  const pipeline = new Pipeline(renderer, W, H);

  // Default startup state: FG=Color, BG=Color, DS=Noise
  // Camera (index 0) is only routed when actually started
  ps.set('layer.fg', 3); // Color
  ps.set('layer.bg', 3); // Color
  ps.set('layer.ds', 4); // Noise

  // ── 6. Preset manager ─────────────────────────────────────────────────────

  const presetMgr = new PresetManager(ps, ctrl);
  await presetMgr.init();

  // ── 7. UI ─────────────────────────────────────────────────────────────────

  initTabs();
  const contextMenu = new ContextMenu(ps, ctrl);
  buildMappingPanels(ps, contextMenu);
  buildGeometryButtons(ps, scene3d);

  const stateDots   = new StateDots(presetMgr);
  const signalPath  = new SignalPath(ps);
  const feedbackOl  = new FeedbackOverlay(ps);
  const presetsPanel = new PresetsPanel(presetMgr);
  const fpsDisplay  = new FPSDisplay();

  // ── Camera controls ───────────────────────────────────────────────────────

  const btnCameraOn = document.createElement('button');
  btnCameraOn.className = 'import-btn';
  btnCameraOn.textContent = '▶ Start Camera';
  btnCameraOn.style.margin = '8px 10px';
  document.getElementById('tab-mapping')?.prepend(btnCameraOn);

  btnCameraOn.addEventListener('click', async () => {
    if (!camera3d.active) {
      const ok = await camera3d.start();
      if (ok) {
        btnCameraOn.textContent = '■ Stop Camera';
        ps.set('camera.active', 1);
        // Route camera to FG automatically
        ps.set('layer.fg', 0); // 0 = Camera
      }
    } else {
      camera3d.stop();
      btnCameraOn.textContent = '▶ Start Camera';
      ps.set('camera.active', 0);
      // Fall back to color when camera stops
      ps.set('layer.fg', 3); // 3 = Color
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

  // 3D scene toggle
  ps.get('scene3d.active').onChange(v => {
    if (v && !ps.get('camera.active').value) {
      ps.set('layer.fg', 5); // 5 = '3D Scene'
    }
  });

  // ── Buffer capture triggers ───────────────────────────────────────────────

  ps.get('buffer.cap_screen').onTrigger(() => {
    stillsBuffer.capture(pipeline.prev.texture);
    refreshBufferGrid();
  });

  ps.get('buffer.cap_video').onTrigger(() => {
    if (camera3d.active && camera3d.currentTexture) {
      stillsBuffer.capture(camera3d.currentTexture);
      refreshBufferGrid();
    }
  });

  ps.get('buffer.cap_movie').onTrigger(() => {
    if (movieInput.active && movieInput.currentTexture) {
      stillsBuffer.capture(movieInput.currentTexture);
      refreshBufferGrid();
    }
  });

  ps.get('buffer.capture').onTrigger(() => {
    stillsBuffer.capture(pipeline.prev.texture);
    refreshBufferGrid();
  });

  // ── Buffer tab UI ─────────────────────────────────────────────────────────

  const FRAME_COUNT  = 16; // mirrors StillsBuffer constant
  const bufferCanvas = document.getElementById('buffer-canvas');
  const bufferCtx    = bufferCanvas?.getContext('2d');
  const BCOLS = 4;
  const CELL_W = bufferCanvas ? bufferCanvas.width  / BCOLS : 80;
  const CELL_H = bufferCanvas ? bufferCanvas.height / BCOLS : 60;

  function refreshBufferGrid() {
    if (!bufferCtx) return;
    bufferCtx.clearRect(0, 0, bufferCanvas.width, bufferCanvas.height);
    for (let i = 0; i < FRAME_COUNT; i++) {
      const col = i % BCOLS;
      const row = Math.floor(i / BCOLS);
      const x   = col * CELL_W;
      const y   = row * CELL_H;
      const isRead  = i === stillsBuffer.readIndex;
      const isWrite = i === ((stillsBuffer.writeIndex - 1 + FRAME_COUNT) % FRAME_COUNT) &&
                      stillsBuffer._hasFrame[i];

      // Cell background
      bufferCtx.fillStyle = isRead ? '#2a2a3a' : '#111118';
      bufferCtx.fillRect(x, y, CELL_W - 1, CELL_H - 1);

      // Thumbnail
      if (stillsBuffer._hasFrame[i]) {
        bufferCtx.drawImage(
          stillsBuffer.thumbnailCanvases[i],
          x, y + Math.floor((CELL_H - 45) / 2), CELL_W - 1, 45,
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
        bufferCtx.strokeRect(x + 0.5, y + 0.5, CELL_W - 2, CELL_H - 2);
      }
    }
  }

  // Capture buttons
  const bufCapRow = document.createElement('div');
  bufCapRow.style.cssText = 'display:flex;gap:6px;padding:8px 10px 0;flex-wrap:wrap;';
  [
    ['Screen→Buf', 'buffer.cap_screen'],
    ['Video→Buf',  'buffer.cap_video'],
    ['Movie→Buf',  'buffer.cap_movie'],
  ].forEach(([label, id]) => {
    const btn = document.createElement('button');
    btn.className = 'import-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => ps.trigger(id));
    bufCapRow.appendChild(btn);
  });

  const bufferSection = document.querySelector('#tab-buffer .panel-section');
  if (bufferSection) {
    bufferSection.insertBefore(bufCapRow, bufferCanvas?.nextSibling ?? null);
  }

  // Click to select frame
  bufferCanvas?.addEventListener('click', e => {
    const rect = bufferCanvas.getBoundingClientRect();
    const mx   = (e.clientX - rect.left) * (bufferCanvas.width  / rect.width);
    const my   = (e.clientY - rect.top)  * (bufferCanvas.height / rect.height);
    const idx  = Math.floor(my / CELL_H) * BCOLS + Math.floor(mx / CELL_W);
    if (idx >= 0 && idx < 16) {
      ps.set('buffer.fs1', idx);
      refreshBufferGrid();
    }
  });

  ps.get('buffer.fs1').onChange(refreshBufferGrid);
  refreshBufferGrid();

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

    // Update noise every 2 frames
    if (frameCount % 2 === 0) updateNoise();

    // Render 3D scene to its render target
    if (ps.get('scene3d.active').value) {
      scene3d.render(ps);
    }

    // Assemble input sources
    const inputs = {
      camera:  camera3d.active ? camera3d.currentTexture : null,
      movie:   movieInput.active ? movieInput.currentTexture : null,
      buffer:  stillsBuffer.texture,
      scene3d: ps.get('scene3d.active').value ? scene3d.texture : null,
      color:   colorTexture,
      noise:   noiseTexture,
      draw:    null, // DrawLayer wired in Phase 3
      warpMaps: [], // 32 warp map textures, wired in Phase 3
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
