/**
 * ImWeb Vectorscope v2 — 12 display modes
 *
 * Outputs a 512×512 THREE.CanvasTexture updated each frame.
 * Additive blending (globalCompositeOperation = 'lighter'),
 * trail/decay system, bloom via shadowBlur.
 *
 * Modes (vectorscope.mode SELECT):
 *   0  Lissajous      L→X, R→Y line trace
 *   1  Waveform       time-domain, L+R overlay
 *   2  Goniometer     Mid(L+R) vs Side(L-R), 45° rotated
 *   3  Polar          amplitude→radius, time→angle
 *   4  FFT            frequency bars
 *   5  Radial FFT     FFT bins mapped around a circle
 *   6  Spectrogram    scrolling 2D FFT history
 *   7  Scatter Cloud  Lissajous rendered as point cloud
 *   8  Phase Space    amplitude (X) vs its derivative (Y)
 *   9  3D Waterfall   isometric FFT time-history mesh
 *  10  Warp Starfield FFT-driven z-fly particle field
 *  11  Oscilloscope   waveform + CRT graticule overlay
 *
 * Parameters read:
 *   vectorscope.mode      SELECT 0–11
 *   vectorscope.gain      0–200 (%)
 *   vectorscope.decay     0–99  (% trail length)
 *   vectorscope.linewidth 1–15
 *   vectorscope.glow      0–50
 *   vectorscope.color     SELECT 0–7
 */

import * as THREE from 'three';

const SIZE        = 512;
const HALF        = SIZE / 2;
const FFT_SIZE    = 1024;   // analyser fftSize → 512 frequency bins
const SPECT_ROWS  = SIZE;   // spectrogram offscreen canvas height
const WFALL_ROWS  = 80;     // 3D waterfall: depth history rows
const WFALL_BINS  = 128;    // frequency bins sampled for waterfall
const STAR_COUNT  = 256;    // warp starfield particle count

/**
 * 8 colour presets: [stroke/fill hex, shadow/glow hex]
 * Values must be 6-digit hex so hexToRGB() works correctly.
 */
const PALETTES = [
  ['#00ff44', '#00ff44'],  // 0 Green
  ['#00ccff', '#00aaff'],  // 1 Cyan
  ['#ff6030', '#ff4000'],  // 2 Orange/Red
  ['#e8c840', '#d0a000'],  // 3 Gold
  ['#cc44ff', '#aa00ff'],  // 4 Violet
  ['#ff2266', '#ff0044'],  // 5 Hot Pink
  ['#ffffff', '#8888ff'],  // 6 White/Blue
  ['#44ffee', '#00ddcc'],  // 7 Aqua
];

/** Parse '#rrggbb' → [r, g, b] integers (0–255). */
function hexToRGB(h) {
  return [
    parseInt(h.slice(1, 3), 16),
    parseInt(h.slice(3, 5), 16),
    parseInt(h.slice(5, 7), 16),
  ];
}

export class VectorscopeInput {
  constructor() {
    // Output canvas + THREE texture
    this.canvas        = document.createElement('canvas');
    this.canvas.width  = SIZE;
    this.canvas.height = SIZE;
    this.ctx           = this.canvas.getContext('2d');
    this.texture       = new THREE.CanvasTexture(this.canvas);

    // Audio graph state
    this._audioCtx  = null;
    this._analyserL = null;  // left / mono
    this._analyserR = null;  // right channel
    this._splitter  = null;
    this._source    = null;
    this._stream    = null;
    this._active    = false;

    // Audio data buffers (allocated by _setup once audio is connected)
    this._bufL       = null;   // Float32Array — time domain L
    this._bufR       = null;   // Float32Array — time domain R
    this._freqBufL   = null;   // Uint8Array   — freq magnitude L (0–255)
    this._freqBufR   = null;   // Uint8Array   — freq magnitude R (0–255)
    this._freqFloatL = null;   // Float32Array — freq magnitude L (dB)

    // Spectrogram: offscreen canvas for scrolling history
    this._spectCvs         = document.createElement('canvas');
    this._spectCvs.width   = SIZE;
    this._spectCvs.height  = SPECT_ROWS;
    this._spectCtx         = this._spectCvs.getContext('2d');
    this._spectCtx.fillStyle = '#000';
    this._spectCtx.fillRect(0, 0, SIZE, SPECT_ROWS);

    // 3D Waterfall: ring buffer of FFT amplitude snapshots
    this._wfallBuf  = Array.from({ length: WFALL_ROWS }, () => new Float32Array(WFALL_BINS));
    this._wfallHead = 0;

    // Warp Starfield: particle pool
    this._stars    = Array.from({ length: STAR_COUNT }, (_, i) => this._newStar(i, true));
    this._lastTime = performance.now();

    // Initial black fill
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // ── Audio init ──────────────────────────────────────────────────────────────

  async initMic(deviceId) {
    if (this._active) this.stop();
    try {
      const audioConstraints = deviceId ? { deviceId: { exact: deviceId } } : true;
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: false });
      this._stream   = stream;
      this._audioCtx = new AudioContext();
      this._source   = this._audioCtx.createMediaStreamSource(stream);
      this._setup();
      this._active   = true;
      return true;
    } catch (e) {
      console.warn('[Vectorscope] Mic access denied:', e.message);
      return false;
    }
  }

  stop() {
    if (!this._active) return;
    this._stream?.getTracks().forEach(t => t.stop());
    this._source?.disconnect();
    try { this._audioCtx?.close(); } catch (_) {}
    this._active   = false;
    this._stream   = null;
    this._source   = null;
    this._audioCtx = null;
  }

  /** Connect an existing Web Audio source node (e.g. from ControllerManager.sound). */
  connectSource(sourceNode, audioCtx) {
    if (this._active) return;
    this._audioCtx = audioCtx;
    this._source   = sourceNode;
    this._setup();
    this._active   = true;
  }

  _setup() {
    const actx = this._audioCtx;
    const opts  = { fftSize: FFT_SIZE, smoothingTimeConstant: 0.65 };

    this._splitter  = actx.createChannelSplitter(2);
    this._analyserL = actx.createAnalyser();
    this._analyserR = actx.createAnalyser();
    Object.assign(this._analyserL, opts);
    Object.assign(this._analyserR, opts);

    this._source.connect(this._splitter);
    this._splitter.connect(this._analyserL, 0);
    this._splitter.connect(this._analyserR, 1);

    const n = this._analyserL.fftSize;
    const m = this._analyserL.frequencyBinCount;
    this._bufL       = new Float32Array(n);
    this._bufR       = new Float32Array(n);
    this._freqBufL   = new Uint8Array(m);
    this._freqBufR   = new Uint8Array(m);
    this._freqFloatL = new Float32Array(m);
  }

  // ── Star factory ─────────────────────────────────────────────────────────────

  _newStar(idx, spreadZ = false) {
    return {
      x:   (Math.random() - 0.5) * 2,
      y:   (Math.random() - 0.5) * 2,
      z:   spreadZ ? Math.random() * 0.9 + 0.05 : 1.0,
      bin: Math.floor(idx * (FFT_SIZE / 2) / STAR_COUNT),
    };
  }

  // ── Main tick (called every animation frame) ───────────────────────────────

  tick(ps) {
    if (!this._active) return;

    const now = performance.now();
    const dt  = Math.min((now - this._lastTime) / 1000, 0.1); // cap at 100 ms
    this._lastTime = now;

    const mode  = Math.round(ps.get('vectorscope.mode').value);
    const gain  = ps.get('vectorscope.gain').value / 100 * 4;   // 0–4×
    const decay = ps.get('vectorscope.decay').value / 100;       // 0=instant, 1=hold
    const lw    = ps.get('vectorscope.linewidth')?.value ?? 1.5;
    const glow  = ps.get('vectorscope.glow')?.value ?? 0;
    const colV  = Math.round(ps.get('vectorscope.color').value);

    const [lineCol, glowCol] = PALETTES[Math.min(colV, PALETTES.length - 1)];
    const ctx = this.ctx;

    // Modes 6 (Spectrogram) and 9 (Waterfall) manage their own background.
    const selfManaged = (mode === 6 || mode === 9);

    if (!selfManaged) {
      // Trail decay — higher decay value = slower fade (longer trail)
      const decayAlpha = 0.08 + (1 - decay) * 0.87;
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
      ctx.fillStyle   = `rgba(0,0,0,${decayAlpha})`;
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    // Fetch fresh audio data
    if (this._bufL) {
      this._analyserL.getFloatTimeDomainData(this._bufL);
      this._analyserR.getFloatTimeDomainData(this._bufR);
      this._analyserL.getByteFrequencyData(this._freqBufL);
      this._analyserR.getByteFrequencyData(this._freqBufR);
      this._analyserL.getFloatFrequencyData(this._freqFloatL);
    }

    // Base stroke context shared by line-drawing modes
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = lineCol;
    ctx.fillStyle   = lineCol;
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = glow;
    ctx.shadowColor = glowCol;
    ctx.globalAlpha = 0.9;

    switch (mode) {
      case  0: this._drawLissajous(ctx, gain); break;
      case  1: this._drawWaveform(ctx, gain); break;
      case  2: this._drawGoniometer(ctx, gain); break;
      case  3: this._drawPolar(ctx, gain); break;
      case  4: this._drawFFT(ctx, gain); break;
      case  5: this._drawRadialFFT(ctx, gain); break;
      case  6: this._drawSpectrogram(ctx, lineCol, glow, glowCol); break;
      case  7: this._drawScatterCloud(ctx, gain, lw); break;
      case  8: this._drawPhaseSpace(ctx, gain); break;
      case  9: this._drawWaterfall(ctx, gain, lineCol, lw, glow, glowCol); break;
      case 10: this._drawStarfield(ctx, dt, gain, lw); break;
      case 11: this._drawOscilloscope(ctx, gain, lineCol, lw, glow, glowCol); break;
    }

    // Reset context to clean state
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    this.texture.needsUpdate = true;
  }

  // ── Mode 0: Lissajous (L→X, R→Y) ──────────────────────────────────────────

  _drawLissajous(ctx, gain) {
    if (!this._bufL) return;
    ctx.beginPath();
    const len = this._bufL.length;
    for (let i = 0; i < len; i++) {
      const px = HALF + this._bufL[i] * gain * HALF;
      const py = HALF - this._bufR[i] * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ── Mode 1: Waveform (L + R overlay) ───────────────────────────────────────

  _drawWaveform(ctx, gain) {
    if (!this._bufL) return;
    const len  = this._bufL.length;
    const step = SIZE / len;

    // Left channel
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const px = i * step;
      const py = HALF - this._bufL[i] * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Right channel at half alpha (additive overlap brightens shared regions)
    ctx.globalAlpha = 0.45;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const px = i * step;
      const py = HALF - this._bufR[i] * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 2: Goniometer (Mid/Side at 45°) ───────────────────────────────────

  _drawGoniometer(ctx, gain) {
    if (!this._bufL) return;
    const sq2 = Math.SQRT1_2;
    ctx.beginPath();
    const len = this._bufL.length;
    for (let i = 0; i < len; i++) {
      const m  = (this._bufL[i] + this._bufR[i]) * sq2;  // mid
      const s  = (this._bufL[i] - this._bufR[i]) * sq2;  // side
      const px = HALF + s * gain * HALF;
      const py = HALF - m * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // 45° M/S axis guides (very faint)
    ctx.globalAlpha = 0.10;
    ctx.beginPath();
    ctx.moveTo(0, SIZE); ctx.lineTo(SIZE, 0);   // M axis (diagonal)
    ctx.moveTo(0, 0);    ctx.lineTo(SIZE, SIZE); // S axis (diagonal)
    ctx.stroke();
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 3: Polar (amplitude→radius, sample index→angle) ───────────────────

  _drawPolar(ctx, gain) {
    if (!this._bufL) return;
    const len = this._bufL.length;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const angle = (i / len) * Math.PI * 2 - Math.PI / 2;
      const amp   = (Math.abs(this._bufL[i]) + Math.abs(this._bufR[i])) * 0.5;
      const r     = amp * gain * (HALF - 4);
      const px    = HALF + Math.cos(angle) * r;
      const py    = HALF + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();
  }

  // ── Mode 4: FFT bars ───────────────────────────────────────────────────────

  _drawFFT(ctx, gain) {
    if (!this._freqBufL) return;
    const bins = Math.min(this._freqBufL.length, 256);
    const barW = SIZE / bins;
    for (let i = 0; i < bins; i++) {
      const amp = (this._freqBufL[i] / 255) * gain;
      if (amp < 0.002) continue;
      const h = Math.min(amp * SIZE, SIZE);
      ctx.globalAlpha = 0.25 + amp * 0.75;
      ctx.fillRect(i * barW, SIZE - h, Math.max(1, barW - 1), h);
    }
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 5: Radial FFT ─────────────────────────────────────────────────────

  _drawRadialFFT(ctx, gain) {
    if (!this._freqBufL) return;
    const bins  = Math.min(this._freqBufL.length, 256);
    const baseR = SIZE * 0.12;
    const maxR  = HALF - 6;

    ctx.beginPath();
    for (let i = 0; i < bins; i++) {
      const angle = (i / bins) * Math.PI * 2 - Math.PI / 2;
      const amp   = (this._freqBufL[i] / 255) * gain;
      const r     = baseR + amp * (maxR - baseR);
      const px    = HALF + Math.cos(angle) * r;
      const py    = HALF + Math.sin(angle) * r;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.stroke();

    // Inner reference ring (faint)
    ctx.globalAlpha = 0.11;
    ctx.beginPath();
    ctx.arc(HALF, HALF, baseR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 6: Spectrogram (scrolling 2D FFT history) ─────────────────────────
  // Self-managed background — skips global trail fade.

  _drawSpectrogram(ctx, lineCol, glow, glowCol) {
    if (!this._freqBufL) return;
    const sc   = this._spectCtx;
    const bins = this._freqBufL.length;
    const [r0, g0, b0] = hexToRGB(lineCol);

    // Scroll existing history up 1 pixel
    sc.drawImage(this._spectCvs, 0, -1);

    // Write new frequency row at the bottom
    const imgData = sc.createImageData(SIZE, 1);
    const d = imgData.data;
    const step = bins / SIZE;
    for (let x = 0; x < SIZE; x++) {
      const bi  = Math.min(Math.floor(x * step), bins - 1);
      const amp = this._freqBufL[bi] / 255;
      const i4  = x * 4;
      d[i4]     = Math.floor(r0 * amp);
      d[i4 + 1] = Math.floor(g0 * amp);
      d[i4 + 2] = Math.floor(b0 * amp);
      d[i4 + 3] = 255;
    }
    sc.putImageData(imgData, 0, SPECT_ROWS - 1);

    // Blit full history to main canvas
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.shadowBlur  = 0;
    ctx.drawImage(this._spectCvs, 0, 0, SIZE, SIZE);

    // Restore additive context for consistency
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowBlur  = glow;
    ctx.shadowColor = glowCol;
  }

  // ── Mode 7: Scatter Cloud (Lissajous as filled dots) ───────────────────────

  _drawScatterCloud(ctx, gain, lw) {
    if (!this._bufL) return;
    const r    = Math.max(0.8, lw * 0.8);
    const len  = this._bufL.length;
    // Sample every 2nd point for performance (still 512 points at FFT_SIZE=1024)
    for (let i = 0; i < len; i += 2) {
      const px = HALF + this._bufL[i] * gain * HALF;
      const py = HALF - this._bufR[i] * gain * HALF;
      ctx.globalAlpha = Math.min(0.95, 0.3 + Math.abs(this._bufL[i]) * gain * 0.65);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 8: Phase Space (amplitude X vs its derivative Y) ──────────────────

  _drawPhaseSpace(ctx, gain) {
    if (!this._bufL) return;
    const len = this._bufL.length;
    ctx.beginPath();
    for (let i = 1; i < len; i++) {
      const x  = this._bufL[i];
      const dx = (this._bufL[i] - this._bufL[i - 1]) * 8;  // derivative (scale up — it's tiny)
      const px = HALF + x  * gain * HALF;
      const py = HALF - dx * gain * HALF;
      i === 1 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ── Mode 9: 3D Waterfall Terrain (isometric projection) ────────────────────
  // Self-managed background — skips global trail fade.

  _drawWaterfall(ctx, gain, lineCol, lw, glow, glowCol) {
    if (!this._freqBufL) return;

    // Insert new FFT snapshot at ring-buffer head
    const row = this._wfallBuf[this._wfallHead];
    for (let b = 0; b < WFALL_BINS; b++) {
      const bi = Math.min(Math.floor(b * this._freqBufL.length / WFALL_BINS), this._freqBufL.length - 1);
      row[b]   = (this._freqBufL[bi] / 255) * gain;
    }
    this._wfallHead = (this._wfallHead + 1) % WFALL_ROWS;

    // Black background
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    ctx.fillStyle   = '#000';
    ctx.fillRect(0, 0, SIZE, SIZE);

    // Isometric projection constants
    const cellW    = (SIZE * 0.62) / WFALL_BINS;
    const depthX   = 1.5;        // x advance per depth step
    const depthY   = 2.2;        // y advance per depth step
    const ampScale = SIZE * 0.30;
    const originX  = SIZE * 0.05;
    const originY  = SIZE * 0.82;

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = glow;
    ctx.shadowColor = glowCol;
    ctx.strokeStyle = lineCol;

    // Render back-to-front so front rows naturally occlude rear rows
    for (let d = WFALL_ROWS - 1; d >= 0; d--) {
      const rowIdx  = (this._wfallHead + d) % WFALL_ROWS;
      const rowData = this._wfallBuf[rowIdx];
      ctx.globalAlpha = 0.10 + (1 - d / WFALL_ROWS) * 0.90;
      ctx.beginPath();
      for (let b = 0; b < WFALL_BINS; b++) {
        const px = originX + b * cellW + d * depthX;
        const py = originY - rowData[b] * ampScale - d * depthY;
        b === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 10: Warp Starfield (FFT-amplitude z-velocity particles) ────────────

  _drawStarfield(ctx, dt, gain, lw) {
    if (!this._freqBufL || !this._stars) return;
    const bins    = this._freqBufL.length;
    const baseSpd = 0.35;

    for (const s of this._stars) {
      const binAmp = this._freqBufL[Math.min(s.bin, bins - 1)] / 255;
      s.z -= dt * (baseSpd + binAmp * gain * 1.2);

      // Respawn at far plane
      if (s.z <= 0.005) {
        s.x = (Math.random() - 0.5) * 2;
        s.y = (Math.random() - 0.5) * 2;
        s.z = 1.0;
        continue;
      }

      // Perspective project
      const px = HALF + (s.x / s.z) * HALF;
      const py = HALF + (s.y / s.z) * HALF;

      if (px < 0 || px >= SIZE || py < 0 || py >= SIZE) {
        s.z = 1.0;
        continue;
      }

      const brightness = 1 - s.z;
      const r          = Math.max(0.4, lw * brightness * 1.8);
      ctx.globalAlpha  = brightness * 0.9;
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 0.9;
  }

  // ── Mode 11: Oscilloscope with CRT graticule ────────────────────────────────

  _drawOscilloscope(ctx, gain, lineCol, lw, glow, glowCol) {
    if (!this._bufL) return;

    // ── Graticule (source-over, dimly drawn under the waveform) ──
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowBlur  = 0;
    ctx.globalAlpha = 1;

    // Major grid (10 × 8 divisions)
    ctx.strokeStyle = '#1d3a1d';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    for (let i = 0; i <= 10; i++) {
      const x = Math.round(i * SIZE / 10) + 0.5;
      ctx.moveTo(x, 0); ctx.lineTo(x, SIZE);
    }
    for (let i = 0; i <= 8; i++) {
      const y = Math.round(i * SIZE / 8) + 0.5;
      ctx.moveTo(0, y); ctx.lineTo(SIZE, y);
    }
    ctx.stroke();

    // Minor tick marks along centre axes (5 per major division)
    ctx.strokeStyle = '#1a301a';
    ctx.globalAlpha = 0.6;
    ctx.beginPath();
    const tickLen = 4;
    for (let i = 0; i <= 50; i++) {
      const x = i * SIZE / 50;
      ctx.moveTo(x, HALF - tickLen); ctx.lineTo(x, HALF + tickLen);
    }
    for (let i = 0; i <= 40; i++) {
      const y = i * SIZE / 40;
      ctx.moveTo(HALF - tickLen, y); ctx.lineTo(HALF + tickLen, y);
    }
    ctx.stroke();

    // Brighter centre cross
    ctx.strokeStyle = '#2a5a2a';
    ctx.lineWidth   = 0.75;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    ctx.moveTo(HALF + 0.5, 0);   ctx.lineTo(HALF + 0.5, SIZE);
    ctx.moveTo(0, HALF + 0.5);   ctx.lineTo(SIZE, HALF + 0.5);
    ctx.stroke();

    // ── Waveform (additive, over the graticule) ──
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = lineCol;
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.shadowBlur  = glow;
    ctx.shadowColor = glowCol;
    ctx.globalAlpha = 0.95;

    const len  = this._bufL.length;
    const step = SIZE / len;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const px = i * step;
      const py = HALF - this._bufL[i] * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Right channel (dimmer — additive overlap region brightens)
    ctx.globalAlpha = 0.38;
    ctx.beginPath();
    for (let i = 0; i < len; i++) {
      const px = i * step;
      const py = HALF - this._bufR[i] * gain * HALF;
      i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  // ── Cleanup ─────────────────────────────────────────────────────────────────

  dispose() {
    this.stop();
  }
}
