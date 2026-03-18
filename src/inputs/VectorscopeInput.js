/**
 * ImWeb Vectorscope / Oscilloscope Input
 *
 * Generates a Lissajous-style display from Web Audio input.
 * Left channel → X axis, Right channel → Y axis (vectorscope mode).
 * Or single channel → time-domain waveform on a horizontal scan.
 *
 * The output is a 256×256 CanvasTexture updated each frame.
 *
 * Modes (vectorscope.mode SELECT):
 *   0 = Lissajous  (L→X, R→Y)
 *   1 = Waveform   (mono, horizontal scroll)
 *   2 = FFT bars   (frequency spectrum, vertical bars)
 *
 * Parameters read: vectorscope.mode, vectorscope.gain, vectorscope.decay, vectorscope.color
 */

import * as THREE from 'three';

const SIZE = 256;

export class VectorscopeInput {
  constructor() {
    this.canvas  = document.createElement('canvas');
    this.canvas.width  = SIZE;
    this.canvas.height = SIZE;
    this.ctx     = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);

    this._audioCtx    = null;
    this._analyserL   = null; // left / mono
    this._analyserR   = null; // right channel
    this._splitter    = null;
    this._source      = null;
    this._bufL        = null;
    this._bufR        = null;
    this._freqBuf     = null;
    this._active      = false;

    // Pre-draw black background
    this.ctx.fillStyle = '#000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
  }

  // ── Init audio from microphone ─────────────────────────────────────────────

  async initMic() {
    if (this._active) return true;
    try {
      const stream   = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
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

  /** Connect an existing Web Audio source node (e.g. from ControllerManager.sound). */
  connectSource(sourceNode, audioCtx) {
    if (this._active) return;
    this._audioCtx = audioCtx;
    this._source   = sourceNode;
    this._setup();
    this._active   = true;
  }

  _setup() {
    const ctx  = this._audioCtx;
    const opts = { fftSize: 512, smoothingTimeConstant: 0.5 };

    this._splitter = ctx.createChannelSplitter(2);
    this._analyserL = ctx.createAnalyser();
    this._analyserR = ctx.createAnalyser();
    Object.assign(this._analyserL, opts);
    Object.assign(this._analyserR, opts);

    this._source.connect(this._splitter);
    this._splitter.connect(this._analyserL, 0);
    this._splitter.connect(this._analyserR, 1);

    const n = this._analyserL.fftSize;
    this._bufL    = new Float32Array(n);
    this._bufR    = new Float32Array(n);
    this._freqBuf = new Uint8Array(this._analyserL.frequencyBinCount);
  }

  // ── Tick (called each frame) ───────────────────────────────────────────────

  tick(ps) {
    if (!this._active) return;

    const mode  = ps.get('vectorscope.mode').value;
    const gain  = ps.get('vectorscope.gain').value / 50;  // 0–4x
    const decay = 1 - ps.get('vectorscope.decay').value / 100; // 0=instant,1=hold
    const colV  = Math.round(ps.get('vectorscope.color').value); // 0-3

    const COLORS = ['#00ff44', '#00ccff', '#ff6030', '#e8c840'];
    const lineCol = COLORS[colV] ?? '#00ff44';

    const ctx  = this.ctx;

    // Decay: fill with semi-transparent black
    ctx.fillStyle = `rgba(0,0,0,${0.3 + decay * 0.65})`;
    ctx.fillRect(0, 0, SIZE, SIZE);

    ctx.strokeStyle = lineCol;
    ctx.lineWidth   = 1;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();

    if (mode === 0) {
      // Lissajous
      this._analyserL.getFloatTimeDomainData(this._bufL);
      this._analyserR.getFloatTimeDomainData(this._bufR);
      const half = SIZE / 2;
      for (let i = 0; i < this._bufL.length; i++) {
        const px = half + this._bufL[i] * gain * half;
        const py = half - this._bufR[i] * gain * half;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
    } else if (mode === 1) {
      // Waveform
      this._analyserL.getFloatTimeDomainData(this._bufL);
      const half = SIZE / 2;
      const step = SIZE / this._bufL.length;
      for (let i = 0; i < this._bufL.length; i++) {
        const px = i * step;
        const py = half - this._bufL[i] * gain * half;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
    } else {
      // FFT bars
      this._analyserL.getByteFrequencyData(this._freqBuf);
      const barW = SIZE / this._freqBuf.length;
      for (let i = 0; i < this._freqBuf.length; i++) {
        const h  = (this._freqBuf[i] / 255) * SIZE * gain;
        const x  = i * barW;
        ctx.rect(x, SIZE - h, Math.max(1, barW - 1), h);
      }
    }

    ctx.stroke();
    ctx.globalAlpha = 1;

    // Draw centre crosshair (faint)
    ctx.strokeStyle = '#333';
    ctx.lineWidth   = 0.5;
    ctx.beginPath();
    ctx.moveTo(SIZE / 2, 0); ctx.lineTo(SIZE / 2, SIZE);
    ctx.moveTo(0, SIZE / 2); ctx.lineTo(SIZE, SIZE / 2);
    ctx.stroke();

    this.texture.needsUpdate = true;
  }

  dispose() {
    this._audioCtx?.close();
    this._active = false;
  }
}
