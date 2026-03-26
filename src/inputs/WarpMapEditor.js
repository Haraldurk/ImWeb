/**
 * ImWeb — Interactive WarpMap Editor
 *
 * Maintains a deformable control-point grid that generates a 128×128
 * displacement texture. R = horizontal offset (0.5 = none), G = vertical.
 *
 * Usage:
 *   const editor = new WarpMapEditor();
 *   // ... append editor.texture to warpMaps[]
 *   editor.brush(nx, ny, radius, strength, ddx, ddy);  // on mouse drag
 *   editor.reset();
 *   editor.save('slot1');  editor.load('slot1');
 */

import * as THREE from 'three';

const TEX_SIZE = 128;  // output displacement texture resolution
const COLS     = 24;   // control point columns
const ROWS     = 18;   // control point rows
const STORAGE_KEY = 'imweb-warpmaps';

export class WarpMapEditor {
  constructor() {
    this.cols = COLS;
    this.rows = ROWS;
    // Displacement at each control point (-0.49 .. 0.49 in UV space)
    this.dx = new Float32Array(COLS * ROWS);
    this.dy = new Float32Array(COLS * ROWS);

    const data = new Uint8Array(TEX_SIZE * TEX_SIZE * 4);
    this._data    = data;
    this.texture  = new THREE.DataTexture(data, TEX_SIZE, TEX_SIZE, THREE.RGBAFormat);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.needsUpdate = true;

    this._rebuild();
  }

  // ── Brush ─────────────────────────────────────────────────────────────────

  /**
   * Push/pull brush. nx,ny = normalized 0..1. ddx,ddy = direction in UV space.
   * @param {number} nx
   * @param {number} ny
   * @param {number} radius  brush radius in UV space (0..1)
   * @param {number} strength displacement per call (0..1)
   * @param {number} ddx     x direction (-1..1, normalized)
   * @param {number} ddy     y direction (-1..1, normalized)
   */
  brush(nx, ny, radius, strength, ddx, ddy) {
    const r2 = radius * radius;
    const invR2 = 1 / (r2 * 0.4); // Tightened Gaussian denominator
    
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const px = i / (this.cols - 1);
        const py = j / (this.rows - 1);
        const dx = px - nx;
        const dy = py - ny;
        const dist2 = dx * dx + dy * dy;
        if (dist2 >= r2) continue;

        // Tighter Gaussian falloff for more "liquid" precision
        const w = Math.exp(-dist2 * invR2); 
        
        const idx = j * this.cols + i;
        this.dx[idx] = Math.max(-0.49, Math.min(0.49, this.dx[idx] + ddx * strength * w));
        this.dy[idx] = Math.max(-0.49, Math.min(0.49, this.dy[idx] + ddy * strength * w));

        // Liquid Auto-Smooth: small Laplacian-like relaxation during brush to keep mesh clean
        if (i > 0 && i < this.cols - 1 && j > 0 && j < this.rows - 1) {
          const l = idx - 1, r = idx + 1, u = idx - this.cols, d = idx + this.cols;
          const avgX = (this.dx[l] + this.dx[r] + this.dx[u] + this.dx[d]) / 4;
          const avgY = (this.dy[l] + this.dy[r] + this.dy[u] + this.dy[d]) / 4;
          this.dx[idx] += (avgX - this.dx[idx]) * (w * 0.05);
          this.dy[idx] += (avgY - this.dy[idx]) * (w * 0.05);
        }
      }
    }
    this._rebuild();
  }

  /** Restore control points to zero displacement within radius. */
  erase(nx, ny, radius, strength) {
    const r2 = radius * radius;
    for (let j = 0; j < this.rows; j++) {
      for (let i = 0; i < this.cols; i++) {
        const px = i / (this.cols - 1);
        const py = j / (this.rows - 1);
        const dist2 = (px - nx) ** 2 + (py - ny) ** 2;
        if (dist2 >= r2) continue;
        const w = Math.exp(-dist2 / (r2 * 0.5)) * strength;
        const idx = j * this.cols + i;
        this.dx[idx] *= (1 - w);
        this.dy[idx] *= (1 - w);
      }
    }
    this._rebuild();
  }

  /** Average displacements with neighbors to smooth out sharp spikes. */
  smooth(nx, ny, radius, strength) {
    const r2 = radius * radius;
    const nextDx = new Float32Array(this.dx);
    const nextDy = new Float32Array(this.dy);

    for (let j = 1; j < this.rows - 1; j++) {
      for (let i = 1; i < this.cols - 1; i++) {
        const px = i / (this.cols - 1);
        const py = j / (this.rows - 1);
        const dist2 = (px - nx) ** 2 + (py - ny) ** 2;
        if (dist2 >= r2) continue;

        const w = Math.exp(-dist2 / (r2 * 0.5)) * strength;
        const idx = j * this.cols + i;
        
        // Simple 4-neighbor average
        const avgX = (this.dx[idx-1] + this.dx[idx+1] + this.dx[idx-this.cols] + this.dx[idx+this.cols]) / 4;
        const avgY = (this.dy[idx-1] + this.dy[idx+1] + this.dy[idx-this.cols] + this.dy[idx+this.cols]) / 4;
        
        nextDx[idx] = this.dx[idx] + (avgX - this.dx[idx]) * w;
        nextDy[idx] = this.dy[idx] + (avgY - this.dy[idx]) * w;
      }
    }
    this.dx = nextDx;
    this.dy = nextDy;
    this._rebuild();
  }

  // ── Presets ───────────────────────────────────────────────────────────────

  reset() {
    this.dx.fill(0);
    this.dy.fill(0);
    this._rebuild();
  }

  applyPreset(name, amount = 0.35) {
    this.reset();
    const c = this.cols, r = this.rows;
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < c; i++) {
        const x = i / (c - 1), y = j / (r - 1);
        const idx = j * c + i;
        let dx = 0, dy = 0;
        switch (name) {
          case 'H-Wave':  dx = Math.sin(y * Math.PI * 4) * amount; break;
          case 'V-Wave':  dy = Math.sin(x * Math.PI * 4) * amount; break;
          case 'Radial': {
            const ax = x - 0.5, ay = y - 0.5;
            const len = Math.sqrt(ax*ax + ay*ay) || 0.0001;
            dx = ax / len * amount * 0.6; dy = ay / len * amount * 0.6; break;
          }
          case 'Pinch': {
            const ax = x - 0.5, ay = y - 0.5;
            dx = -ax * amount * 1.2; dy = -ay * amount * 1.2; break;
          }
          case 'Spiral': {
            const ax = x - 0.5, ay = y - 0.5;
            const rr = Math.sqrt(ax*ax + ay*ay);
            const angle = Math.atan2(ay, ax) + rr * Math.PI * 3;
            dx = Math.cos(angle) * rr * amount * 1.4 - ax * 0.6;
            dy = Math.sin(angle) * rr * amount * 1.4 - ay * 0.6;
            break;
          }
          case 'Shear':   dx = (y - 0.5) * amount * 1.2; dy = (x - 0.5) * amount * 1.2; break;
          case 'Random':  dx = (Math.random() - 0.5) * amount; dy = (Math.random() - 0.5) * amount; break;
        }
        this.dx[idx] = Math.max(-0.49, Math.min(0.49, dx));
        this.dy[idx] = Math.max(-0.49, Math.min(0.49, dy));
      }
    }
    this._rebuild();
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  save(slot) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      all[slot] = { dx: Array.from(this.dx), dy: Array.from(this.dy) };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
    } catch (e) { console.warn('[WarpEditor] save failed', e); }
  }

  load(slot) {
    try {
      const all = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
      const data = all[slot];
      if (!data) return false;
      this.dx = new Float32Array(data.dx);
      this.dy = new Float32Array(data.dy);
      this._rebuild();
      return true;
    } catch (e) { return false; }
  }

  getSavedSlots() {
    try {
      return Object.keys(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'));
    } catch (e) { return []; }
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  _rebuild() {
    const d = this._data;
    const c = this.cols, r = this.rows;
    for (let py = 0; py < TEX_SIZE; py++) {
      const ny = py / (TEX_SIZE - 1);
      const gj = ny * (r - 1);
      const j0 = Math.min(Math.floor(gj), r - 2);
      const t  = gj - j0;
      for (let px = 0; px < TEX_SIZE; px++) {
        const nx  = px / (TEX_SIZE - 1);
        const gi  = nx * (c - 1);
        const i0  = Math.min(Math.floor(gi), c - 2);
        const s   = gi - i0;
        const tl  = j0 * c + i0,       tr  = j0 * c + i0 + 1;
        const bl  = (j0+1) * c + i0,   br  = (j0+1) * c + i0 + 1;
        const dx = lerp(lerp(this.dx[tl], this.dx[tr], s), lerp(this.dx[bl], this.dx[br], s), t);
        const dy = lerp(lerp(this.dy[tl], this.dy[tr], s), lerp(this.dy[bl], this.dy[br], s), t);
        const off = (py * TEX_SIZE + px) * 4;
        d[off]   = (0.5 + dx) * 255 | 0;
        d[off+1] = (0.5 + dy) * 255 | 0;
        d[off+2] = 0;
        d[off+3] = 255;
      }
    }
    this.texture.needsUpdate = true;
  }

  /** Interpolated displacement at normalized position (for canvas preview). */
  dispAt(nx, ny) {
    const c = this.cols, r = this.rows;
    const gi = nx * (c - 1), gj = ny * (r - 1);
    const i0 = Math.min(Math.floor(gi), c - 2);
    const j0 = Math.min(Math.floor(gj), r - 2);
    const s  = gi - i0, t = gj - j0;
    const tl = j0*c+i0, tr = j0*c+i0+1, bl = (j0+1)*c+i0, br = (j0+1)*c+i0+1;
    return {
      dx: lerp(lerp(this.dx[tl], this.dx[tr], s), lerp(this.dx[bl], this.dx[br], s), t),
      dy: lerp(lerp(this.dy[tl], this.dy[tr], s), lerp(this.dy[bl], this.dy[br], s), t),
    };
  }
}

function lerp(a, b, t) { return a + (b - a) * t; }
