/**
 * ImWeb TextLayer
 *
 * Renders text to a 512×512 canvas texture.
 * text.advance (TRIGGER) steps through chars / words / lines.
 * Full param set: size, x, y, hue, sat, opacity, align, font, outline, spacing, mode, bg.
 */

import * as THREE from 'three';

const SIZE = 512;
const FONTS = [
  'sans-serif',
  'serif',
  '"IBM Plex Mono", monospace',
  'bold sans-serif',
  'italic serif',
];
const ALIGNS = ['center', 'left', 'right'];

export class TextLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this._text    = 'ImWeb';
    this._units   = ['ImWeb'];
    this._idx     = 0;
    this._mode    = 0;
    this._size    = 72;
    this._hue     = 0;
    this._sat     = 0;
    this._opacity = 100;
    this._x       = 50;
    this._y       = 50;
    this._bg      = 0;
    this._align   = 0;
    this._font    = 0;
    this._outline = 0;
    this._spacing = 1.2;

    this._render();
  }

  setContent(str) {
    this._text = str || '';
    this._parseUnits();
    this._idx = 0;
    this._render();
  }

  advance() {
    if (!this._units.length) return;
    this._idx = (this._idx + 1) % this._units.length;
    this._render();
  }

  tick(ps) {
    let dirty = false;
    const get = id => ps.get(id)?.value ?? 0;

    const size    = Math.round(get('text.size'));
    const hue     = get('text.hue');
    const sat     = get('text.sat');
    const opacity = get('text.opacity');
    const x       = get('text.x');
    const y       = get('text.y');
    const mode    = Math.round(get('text.mode'));
    const bg      = get('text.bg');
    const align   = Math.round(get('text.align'));
    const font    = Math.round(get('text.font'));
    const outline = get('text.outline');
    const spacing = get('text.spacing') || 1.2;

    if (size    !== this._size)    { this._size    = size;    dirty = true; }
    if (hue     !== this._hue)     { this._hue     = hue;     dirty = true; }
    if (sat     !== this._sat)     { this._sat     = sat;     dirty = true; }
    if (opacity !== this._opacity) { this._opacity = opacity; dirty = true; }
    if (x       !== this._x)       { this._x       = x;       dirty = true; }
    if (y       !== this._y)       { this._y       = y;       dirty = true; }
    if (bg      !== this._bg)      { this._bg      = bg;      dirty = true; }
    if (align   !== this._align)   { this._align   = align;   dirty = true; }
    if (font    !== this._font)    { this._font    = font;    dirty = true; }
    if (outline !== this._outline) { this._outline = outline; dirty = true; }
    if (spacing !== this._spacing) { this._spacing = spacing; dirty = true; }

    if (mode !== this._mode) {
      this._mode = mode;
      this._parseUnits();
      this._idx = Math.min(this._idx, Math.max(0, this._units.length - 1));
      dirty = true;
    }

    if (dirty) this._render();
  }

  _parseUnits() {
    const t = this._text;
    switch (this._mode) {
      case 1: this._units = [...t];                          break; // Char
      case 2: this._units = t.split(/\s+/).filter(Boolean); break; // Word
      case 3: this._units = t.split('\n').filter(Boolean);  break; // Line
      default: this._units = t ? [t] : [];                  break; // All
    }
    if (!this._units.length) this._units = [' '];
  }

  _render() {
    const ctx  = this.ctx;
    const unit = this._units[this._idx] ?? '';

    ctx.clearRect(0, 0, SIZE, SIZE);
    if (this._bg) {
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, SIZE, SIZE);
    }

    if (!unit.trim()) { this.texture.needsUpdate = true; return; }

    const fs       = Math.max(8, Math.min(this._size, SIZE - 4));
    const satPct   = Math.round(this._sat);
    const lightPct = 70 - Math.round(this._sat * 0.2); // desaturate → lighter
    ctx.fillStyle   = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
    ctx.globalAlpha = this._opacity / 100;

    const fontStr     = FONTS[this._font] ?? 'sans-serif';
    const isBold      = this._font === 3;
    const isItalic    = this._font === 4;
    ctx.font          = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fs}px ${fontStr}`;
    ctx.textBaseline  = 'middle';
    ctx.textAlign     = ALIGNS[this._align] ?? 'center';

    const alignX = this._align === 0 ? (this._x / 100) * SIZE
                 : this._align === 1 ? (this._x / 100) * SIZE
                 : (this._x / 100) * SIZE;
    const py     = (1 - this._y / 100) * SIZE;

    const lines  = unit.split('\n');
    const lineH  = fs * this._spacing;
    const totalH = lineH * lines.length;

    lines.forEach((line, i) => {
      const ly = py - totalH / 2 + lineH * (i + 0.5);

      if (this._outline > 0) {
        ctx.strokeStyle = `hsl(${this._hue}, ${satPct}%, ${Math.max(0, lightPct - 40)}%)`;
        ctx.lineWidth   = this._outline * 2;
        ctx.lineJoin    = 'round';
        ctx.strokeText(line, alignX, ly);
      }
      ctx.fillText(line, alignX, ly);
    });

    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }
}
