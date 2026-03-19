/**
 * ImWeb DrawLayer
 *
 * A 512×512 canvas texture the user paints on in real time.
 * Controlled entirely via parameters:
 *
 *   draw.pensize      > 0  → paint at (draw.x, draw.y)
 *   draw.erasesize    > 0  → erase at (draw.x, draw.y)
 *   draw.x / draw.y        → cursor position 0–100
 *   draw.color.h/s/v       → pen color (HSV, defaults to white when sat=0)
 *   draw.opacity           → stroke alpha 1–100 %
 *   draw.fade              → per-frame decay 0 (none) → 1 (instant clear)
 *   draw.clear             → TRIGGER — wipes canvas to black
 *
 * The canvas is exposed as `drawLayer.texture` (THREE.CanvasTexture)
 * and `drawLayer.canvas` for direct DOM embedding (live preview in UI).
 */

import * as THREE from 'three';

const SIZE = 512;

export class DrawLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;

    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    // Start with opaque black
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Stroke state
    this._lastX     = null;
    this._lastY     = null;
    this._wasActive = false;

    // Pre-allocated fade rect (avoid per-frame object creation)
    this._fadeTick  = 0;
  }

  /**
   * Called every frame. Reads draw.* params and updates canvas.
   */
  tick(ps) {
    const penSize   = ps.get('draw.pensize').value;
    const eraseSize = ps.get('draw.erasesize').value;
    const nx = ps.get('draw.x').value / 100;
    const ny = 1 - (ps.get('draw.y').value / 100); // flip Y

    const cx = nx * SIZE;
    const cy = ny * SIZE;

    // ── Fade / decay ──────────────────────────────────────────────────────
    const fade = ps.get('draw.fade')?.value ?? 0;
    if (fade > 0) {
      // Apply fade every frame: draw a semi-transparent black rectangle
      // fade=1 → opacity 1 (instant clear), fade=0.01 → very slow decay
      const alpha = Math.min(1, fade * 0.5); // scale so small values feel gentle
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, SIZE, SIZE);
      this.ctx.globalAlpha = 1;
    }

    // ── Brush stroke ─────────────────────────────────────────────────────
    const isPen    = penSize   > 0;
    const isErase  = eraseSize > 0;
    const isActive = isPen || isErase;

    if (isActive) {
      const ctx = this.ctx;
      const rawSize = isPen ? penSize : eraseSize;
      const lineW   = Math.max(1, rawSize * SIZE / 100);

      ctx.globalCompositeOperation = isErase ? 'destination-out' : 'source-over';
      ctx.globalAlpha = isPen ? (ps.get('draw.opacity')?.value ?? 100) / 100 : 1;

      if (isPen) {
        // Build HSL color from draw.color params
        const h = ps.get('draw.color.h')?.value ?? 0;
        const s = ps.get('draw.color.s')?.value ?? 0;
        const v = ps.get('draw.color.v')?.value ?? 100;
        ctx.strokeStyle = _hsvToHsl(h, s, v);
        ctx.fillStyle   = ctx.strokeStyle;
      } else {
        ctx.strokeStyle = 'rgba(0,0,0,1)';
        ctx.fillStyle   = 'rgba(0,0,0,1)';
      }

      ctx.lineWidth = lineW;
      ctx.lineCap   = 'round';
      ctx.lineJoin  = 'round';

      ctx.beginPath();
      if (this._lastX !== null && this._wasActive) {
        ctx.moveTo(this._lastX, this._lastY);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      } else {
        ctx.arc(cx, cy, lineW / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      this._lastX = cx;
      this._lastY = cy;
    } else {
      this._lastX = null;
      this._lastY = null;
    }

    this._wasActive = isActive;
    this.texture.needsUpdate = true;
  }

  /**
   * Wipe canvas to black.
   */
  clear() {
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.texture.needsUpdate = true;
  }
}

/**
 * Convert HSV (0-360, 0-100, 0-100) to CSS hsl() string.
 * Canvas uses HSL natively; this converts so saturation=0 → grey, not HSL grey.
 */
function _hsvToHsl(h, s, v) {
  // Normalise
  const sv = s / 100, vv = v / 100;
  const l  = vv * (1 - sv / 2);
  const sl = (l === 0 || l === 1) ? 0 : (vv - l) / Math.min(l, 1 - l);
  return `hsl(${h},${(sl * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%)`;
}
