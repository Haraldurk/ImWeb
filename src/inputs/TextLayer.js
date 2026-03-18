/**
 * ImWeb TextLayer
 *
 * Renders text to a 512×512 canvas texture.
 * text.advance (TRIGGER) steps through chars / words / lines.
 * text.size controls font size (8–255 px).
 * text.x / text.y position the text anchor (0–100).
 * text.mode selects what "advance" steps: Char | Word | Line | All.
 * text.hue sets text colour (0–100 mapped to hue).
 * text.bg toggles transparent-black vs solid background.
 *
 * The layer canvas is also shown in the Text tab as a live preview.
 */

import * as THREE from 'three';

const SIZE = 512;

export class TextLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this._text  = 'ImWeb';
    this._units = ['ImWeb'];       // parsed units for current mode
    this._idx   = 0;
    this._mode  = 0;               // 0=All, 1=Char, 2=Word, 3=Line

    this._size  = 72;
    this._hue   = 0;
    this._x     = 50;
    this._y     = 50;
    this._bg    = 0;

    this._render();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Set the text content and re-parse. */
  setContent(str) {
    this._text = str || '';
    this._parseUnits();
    this._idx = 0;
    this._render();
  }

  /** Advance to the next unit (called by text.advance trigger). */
  advance() {
    if (!this._units.length) return;
    this._idx = (this._idx + 1) % this._units.length;
    this._render();
  }

  /** Called every frame — reads params and redraws if anything changed. */
  tick(ps) {
    let dirty = false;

    const size  = Math.round(ps.get('text.size').value);
    const hue   = ps.get('text.hue').value;
    const x     = ps.get('text.x').value;
    const y     = ps.get('text.y').value;
    const mode  = ps.get('text.mode').value;
    const bg    = ps.get('text.bg').value;

    if (size !== this._size) { this._size = size; dirty = true; }
    if (hue  !== this._hue)  { this._hue  = hue;  dirty = true; }
    if (x    !== this._x)    { this._x    = x;    dirty = true; }
    if (y    !== this._y)    { this._y    = y;    dirty = true; }
    if (bg   !== this._bg)   { this._bg   = bg;   dirty = true; }

    if (mode !== this._mode) {
      this._mode = mode;
      this._parseUnits();
      this._idx = Math.min(this._idx, Math.max(0, this._units.length - 1));
      dirty = true;
    }

    if (dirty) this._render();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _parseUnits() {
    const t = this._text;
    switch (this._mode) {
      case 1: this._units = [...t];                              break; // Char
      case 2: this._units = t.split(/\s+/).filter(Boolean);     break; // Word
      case 3: this._units = t.split('\n').filter(Boolean);      break; // Line
      default: this._units = t ? [t] : [];                      break; // All
    }
    if (!this._units.length) this._units = [' '];
  }

  _render() {
    const ctx  = this.ctx;
    const unit = this._units[this._idx] ?? '';

    // Background
    ctx.clearRect(0, 0, SIZE, SIZE);
    if (this._bg) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    if (!unit.trim()) {
      this.texture.needsUpdate = true;
      return;
    }

    // Colour from hue
    const hDeg = this._hue * 3.6; // 0–100 → 0–360°
    ctx.fillStyle = `hsl(${hDeg}, 90%, 70%)`;

    // Font
    const fs = Math.max(8, Math.min(this._size, SIZE - 4));
    ctx.font         = `bold ${fs}px "IBM Plex Mono", monospace`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = 'center';

    // Position
    const px = (this._x / 100) * SIZE;
    const py = (1 - this._y / 100) * SIZE;

    // Multi-line support (line mode / all mode)
    const lines = unit.split('\n');
    const lineH = fs * 1.2;
    const totalH = lineH * lines.length;
    lines.forEach((line, i) => {
      ctx.fillText(line, px, py - totalH / 2 + lineH * (i + 0.5));
    });

    this.texture.needsUpdate = true;
  }
}
