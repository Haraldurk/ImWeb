/**
 * ImWeb Slit Scan Buffer
 *
 * Classic video synthesis technique: each frame, one strip (row or column)
 * of pixels is sampled from a WebGLRenderTarget and written into a canvas.
 * Existing content shifts in the perpendicular direction.
 * The result maps time → space.
 *
 * Usage:
 *   slitScan.tick(renderer, renderTarget, ps, dt)
 *   inputs.slitscan = slitScan.texture
 *
 * Parameters:
 *   slitscan.active  TOGGLE
 *   slitscan.pos     0–100%  position of the slit within the source frame
 *   slitscan.speed   0.5–60  fps advance rate
 *   slitscan.axis    SELECT  0=Vertical, 1=Horizontal, 2=Center-V, 3=Center-H
 *   slitscan.width   1–16    strip pixel width per tick
 */

import * as THREE from 'three';

export class SlitScanBuffer {
  constructor(width, height) {
    this.width  = width;
    this.height = height;

    this._canvas = document.createElement('canvas');
    this._canvas.width  = width;
    this._canvas.height = height;
    this._ctx = this._canvas.getContext('2d');
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, width, height);

    this.texture = new THREE.CanvasTexture(this._canvas);
    this._timer  = 0;
    this._pixBuf = null; // allocated lazily
  }

  /**
   * Main tick — reads a strip from the render target and shifts the canvas.
   * @param {THREE.WebGLRenderer} renderer
   * @param {THREE.WebGLRenderTarget} rt  — the source render target
   * @param {ParameterSystem} ps
   * @param {number} dt
   */
  tick(renderer, rt, ps, dt) {
    if (!ps.get('slitscan.active').value) return;

    const rate = Math.max(0.01, ps.get('slitscan.speed').value);
    this._timer += dt;
    if (this._timer < 1 / rate) return;
    this._timer = 0;

    const axis   = ps.get('slitscan.axis').value;     // 0=vert, 1=horiz
    const pos01  = ps.get('slitscan.pos').value / 100;
    const stripW = Math.max(1, Math.round(ps.get('slitscan.width').value));

    const W = this.width;
    const H = this.height;
    const ctx = this._ctx;

    if (axis === 0) {
      // Vertical slit: sample a column, scroll canvas left, paste at right
      const srcX = Math.max(0, Math.min(W - stripW, Math.round(pos01 * W)));
      const pix  = this._read(renderer, rt, srcX, 0, stripW, H);
      ctx.drawImage(this._canvas, -stripW, 0);
      const imgData = ctx.createImageData(stripW, H);
      this._flipY(pix, stripW, H);
      imgData.data.set(pix);
      ctx.putImageData(imgData, W - stripW, 0);

    } else if (axis === 1) {
      // Horizontal slit: sample a row, scroll canvas down, paste at top
      const srcY = Math.max(0, Math.min(H - stripW, Math.round(pos01 * H)));
      const pix  = this._read(renderer, rt, 0, srcY, W, stripW);
      ctx.drawImage(this._canvas, 0, stripW);
      const imgData = ctx.createImageData(W, stripW);
      this._flipY(pix, W, stripW);
      imgData.data.set(pix);
      ctx.putImageData(imgData, 0, 0);

    } else if (axis === 2) {
      // Center-V: sample a column, expand outward left+right from canvas center
      const srcX = Math.max(0, Math.min(W - stripW, Math.round(pos01 * W)));
      const pix  = this._read(renderer, rt, srcX, 0, stripW, H);
      const half = Math.floor(W / 2);
      const hw   = Math.ceil(stripW / 2);
      // Left half slides left, right half slides right
      ctx.drawImage(this._canvas, 0, 0, half, H, -hw, 0, half, H);
      ctx.drawImage(this._canvas, half, 0, half, H, half + hw, 0, half, H);
      const imgData = ctx.createImageData(stripW, H);
      this._flipY(pix, stripW, H);
      imgData.data.set(pix);
      ctx.putImageData(imgData, half - hw, 0);

    } else {
      // Center-H: sample a row, expand outward up+down from canvas center
      const srcY = Math.max(0, Math.min(H - stripW, Math.round(pos01 * H)));
      const pix  = this._read(renderer, rt, 0, srcY, W, stripW);
      const half = Math.floor(H / 2);
      const hw   = Math.ceil(stripW / 2);
      // Top half slides up, bottom half slides down
      ctx.drawImage(this._canvas, 0, 0, W, half, 0, -hw, W, half);
      ctx.drawImage(this._canvas, 0, half, W, half, 0, half + hw, W, half);
      const imgData = ctx.createImageData(W, stripW);
      this._flipY(pix, W, stripW);
      imgData.data.set(pix);
      ctx.putImageData(imgData, 0, half - hw);
    }

    this.texture.needsUpdate = true;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this._canvas.width  = w;
    this._canvas.height = h;
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, w, h);
    this._pixBuf = null;
    this.texture.needsUpdate = true;
  }

  clear() {
    this._ctx.fillStyle = '#000';
    this._ctx.fillRect(0, 0, this.width, this.height);
    this.texture.needsUpdate = true;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _read(renderer, rt, x, y, w, h) {
    const len = w * h * 4;
    if (!this._pixBuf || this._pixBuf.length < len) {
      this._pixBuf = new Uint8Array(len);
    }
    const buf = this._pixBuf.length === len ? this._pixBuf : new Uint8Array(len);
    try {
      renderer.readRenderTargetPixels(rt, x, y, w, h, buf);
    } catch (e) {
      buf.fill(0);
    }
    return buf;
  }

  _flipY(pixels, w, h) {
    const row = new Uint8Array(w * 4);
    for (let y = 0; y < Math.floor(h / 2); y++) {
      const top = y * w * 4;
      const bot = (h - 1 - y) * w * 4;
      row.set(pixels.subarray(top, top + w * 4));
      pixels.copyWithin(top, bot, bot + w * 4);
      pixels.set(row, bot);
    }
  }
}
