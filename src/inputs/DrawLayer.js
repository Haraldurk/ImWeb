/**
 * ImWeb DrawLayer
 *
 * A 512×512 canvas texture the user paints on in real time.
 * Controlled entirely via parameters:
 *
 *   draw.pensize   > 0  → paint white at (draw.x, draw.y)
 *   draw.erasesize > 0  → erase (black) at (draw.x, draw.y)
 *   draw.x / draw.y     → cursor position 0–100 (0=left/bottom, 100=right/top)
 *   draw.clear          → TRIGGER — wipes canvas to black
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
    this._lastX    = null;
    this._lastY    = null;
    this._wasActive = false;
  }

  /**
   * Called every frame. Reads draw.* params and updates canvas.
   */
  tick(ps) {
    const penSize   = ps.get('draw.pensize').value;   // 0–100
    const eraseSize = ps.get('draw.erasesize').value; // 0–100
    const nx = ps.get('draw.x').value / 100;          // 0..1
    // Y: param 0 = bottom, canvas 0 = top → flip
    const ny = 1 - (ps.get('draw.y').value / 100);   // 0..1

    const cx = nx * SIZE;
    const cy = ny * SIZE;

    const isPen    = penSize   > 0;
    const isErase  = eraseSize > 0;
    const isActive = isPen || isErase;

    if (isActive) {
      const ctx = this.ctx;
      const rawSize = isPen ? penSize : eraseSize;
      const lineW   = Math.max(1, rawSize * SIZE / 100);

      ctx.strokeStyle = isPen ? '#ffffff' : '#000000';
      ctx.fillStyle   = isPen ? '#ffffff' : '#000000';
      ctx.lineWidth   = lineW;
      ctx.lineCap     = 'round';
      ctx.lineJoin    = 'round';

      ctx.beginPath();
      // Connect from last position if we were already drawing
      if (this._lastX !== null && this._wasActive) {
        ctx.moveTo(this._lastX, this._lastY);
        ctx.lineTo(cx, cy);
        ctx.stroke();
      } else {
        // First touch — draw a dot
        ctx.arc(cx, cy, lineW / 2, 0, Math.PI * 2);
        ctx.fill();
      }

      this._lastX = cx;
      this._lastY = cy;
    } else {
      // Pen lifted — reset continuity
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
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.texture.needsUpdate = true;
  }
}
