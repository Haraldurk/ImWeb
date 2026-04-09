/**
 * ImWeb TextLayer
 *
 * Renders text to a 512×512 canvas texture.
 * text.advance (TRIGGER) steps through chars / words / lines.
 * text.rate + text.autoplay: clock-based auto-advance (LFO/MIDI/sound-assignable).
 * text.animMode: per-unit animation (Bounce/Wave/Fade/Typewriter).
 * text.contentIdx: index into multi-line content list.
 * Full param set: size, x, y, hue, sat, opacity, align, font, outline, spacing,
 *   mode, bg, letterspacing, rotation, shadow, bgOpacity, outlineHue/Sat,
 *   animMode/Speed/Amt, rate, autoplay, contentIdx.
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

    // New typography params
    this._letterspacing = 0;
    this._rotation      = 0;
    this._shadowBlur    = 0;
    this._shadowX       = 0;
    this._shadowY       = 0;
    this._bgOpacity     = 100;
    this._outlineHue    = 0;
    this._outlineSat    = 0;

    // Animation params
    this._animMode  = 0;
    this._animSpeed = 2;
    this._animAmt   = 30;
    this._animTime  = 0;
    this._typerChars = 0;
    this._prevIdx    = -1;

    // Auto-advance clock
    this._autoplay  = 0;
    this._rate      = 0;
    this._advTimer  = 0;

    // Content list
    this._contentList = [];
    this._contentIdx  = 0;

    this._render();
  }

  setContent(str) {
    this._text = str || '';
    this._parseUnits();
    this._idx = 0;
    this._render();
  }

  setContentList(lines) {
    this._contentList = lines.filter(s => s.trim());
    const idx = Math.min(Math.round(this._contentIdx), Math.max(0, this._contentList.length - 1));
    if (this._contentList.length) {
      this._text = this._contentList[idx];
      this._parseUnits();
      this._render();
    }
  }

  advance() {
    if (!this._units.length) return;
    this._idx = (this._idx + 1) % this._units.length;
    this._typerChars = 0;
    this._render();
  }

  tick(ps, dt = 0) {
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

    // New typography
    const letterspacing = get('text.letterspacing');
    const rotation      = get('text.rotation');
    const shadowBlur    = get('text.shadowBlur');
    const shadowX       = get('text.shadowX');
    const shadowY       = get('text.shadowY');
    const bgOpacity     = get('text.bgOpacity');
    const outlineHue    = get('text.outlineHue');
    const outlineSat    = get('text.outlineSat');

    // Animation
    const animMode  = Math.round(get('text.animMode'));
    const animSpeed = get('text.animSpeed');
    const animAmt   = get('text.animAmt');

    // Auto-advance
    const autoplay  = get('text.autoplay');
    const rate      = get('text.rate');

    // Content list index
    const contentIdx = Math.max(0, Math.min(63, Math.round(get('text.contentIdx'))));

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

    if (letterspacing !== this._letterspacing) { this._letterspacing = letterspacing; dirty = true; }
    if (rotation      !== this._rotation)      { this._rotation      = rotation;      dirty = true; }
    if (shadowBlur    !== this._shadowBlur)    { this._shadowBlur    = shadowBlur;    dirty = true; }
    if (shadowX       !== this._shadowX)       { this._shadowX       = shadowX;       dirty = true; }
    if (shadowY       !== this._shadowY)       { this._shadowY       = shadowY;       dirty = true; }
    if (bgOpacity     !== this._bgOpacity)     { this._bgOpacity     = bgOpacity;     dirty = true; }
    if (outlineHue    !== this._outlineHue)    { this._outlineHue    = outlineHue;    dirty = true; }
    if (outlineSat    !== this._outlineSat)    { this._outlineSat    = outlineSat;    dirty = true; }

    if (animMode  !== this._animMode)  { this._animMode  = animMode;  dirty = true; }
    if (animSpeed !== this._animSpeed) { this._animSpeed = animSpeed; }
    if (animAmt   !== this._animAmt)   { this._animAmt   = animAmt;   dirty = true; }

    this._autoplay = autoplay;
    this._rate     = rate;

    if (mode !== this._mode) {
      this._mode = mode;
      this._parseUnits();
      this._idx = Math.min(this._idx, Math.max(0, this._units.length - 1));
      dirty = true;
    }

    // Content list index change
    if (contentIdx !== this._contentIdx) {
      this._contentIdx = contentIdx;
      if (this._contentList.length > 1) {
        const i = Math.min(contentIdx, this._contentList.length - 1);
        this._text = this._contentList[i];
        this._parseUnits();
        this._idx = 0;
        this._typerChars = 0;
        dirty = true;
      }
    }

    // Auto-advance clock
    if (autoplay && rate > 0) {
      this._advTimer += dt;
      const interval = 1 / rate;
      if (this._advTimer >= interval) {
        this._advTimer = 0;
        this.advance();
        dirty = true;
      }
    } else {
      this._advTimer = 0;
    }

    // Force re-render every frame for animated modes
    if (animMode > 0 && animSpeed > 0) {
      this._animTime += dt;
      dirty = true;
    }

    // Typewriter: advance char reveal each frame
    if (animMode === 4) {
      if (this._idx !== this._prevIdx) {
        this._typerChars = 0;
        this._prevIdx = this._idx;
      }
      const unit = this._units[this._idx] ?? '';
      if (this._typerChars < unit.length) {
        this._typerChars = Math.min(unit.length, this._typerChars + animSpeed * dt * 10);
        dirty = true;
      }
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
    let unit = this._units[this._idx] ?? '';

    // Typewriter mode clips the visible characters
    if (this._animMode === 4) {
      unit = unit.slice(0, Math.floor(this._typerChars));
    }

    ctx.clearRect(0, 0, SIZE, SIZE);
    if (this._bg) {
      ctx.globalAlpha = this._bgOpacity / 100;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.globalAlpha = 1;
    }

    if (!unit.trim()) { this.texture.needsUpdate = true; return; }

    const fs       = Math.max(8, Math.min(this._size, SIZE - 4));
    const satPct   = Math.round(this._sat);
    const lightPct = 70 - Math.round(this._sat * 0.2);
    ctx.fillStyle   = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
    ctx.globalAlpha = this._opacity / 100;

    const fontStr  = FONTS[this._font] ?? 'sans-serif';
    const isBold   = this._font === 3;
    const isItalic = this._font === 4;
    ctx.font         = `${isItalic ? 'italic ' : ''}${isBold ? 'bold ' : ''}${fs}px ${fontStr}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign    = ALIGNS[this._align] ?? 'center';

    // Letter spacing (Canvas API, Chrome 99+ / Safari 17+; gracefully ignored on older)
    if ('letterSpacing' in ctx) ctx.letterSpacing = this._letterspacing + 'px';

    const alignX = (this._x / 100) * SIZE;
    const py     = (1 - this._y / 100) * SIZE;

    const lines  = unit.split('\n');
    const lineH  = fs * this._spacing;
    const totalH = lineH * lines.length;

    // Shadow
    if (this._shadowBlur > 0 || this._shadowX !== 0 || this._shadowY !== 0) {
      ctx.shadowBlur    = this._shadowBlur;
      ctx.shadowOffsetX = this._shadowX;
      ctx.shadowOffsetY = -this._shadowY;
      ctx.shadowColor   = ctx.fillStyle;
    }

    // Apply rotation around text anchor
    const doRotate = this._rotation !== 0;
    if (doRotate) {
      ctx.save();
      ctx.translate(alignX, py);
      ctx.rotate(this._rotation * Math.PI / 180);
      ctx.translate(-alignX, -py);
    }

    lines.forEach((line, i) => {
      let baseY = py - totalH / 2 + lineH * (i + 0.5);

      // Animation modes
      if (this._animMode === 1) {
        // Bounce — whole block oscillates vertically
        baseY += Math.sin(this._animTime * this._animSpeed * Math.PI * 2) * (this._animAmt / 100) * fs * 0.3;
      } else if (this._animMode === 3) {
        // Fade — modulate globalAlpha
        const fade = (Math.sin(this._animTime * this._animSpeed * Math.PI * 2) * 0.5 + 0.5);
        ctx.globalAlpha = (this._opacity / 100) * fade;
      }

      if (this._animMode === 2) {
        // Wave — per-character rendering with sin Y offset
        let cx = alignX;
        if (this._align === 0) {
          cx -= ctx.measureText(line).width / 2;
        } else if (this._align === 2) {
          cx -= ctx.measureText(line).width;
        }
        const savedAlign = ctx.textAlign;
        ctx.textAlign = 'left';
        for (let ci = 0; ci < line.length; ci++) {
          const ch = line[ci];
          const charY = baseY + Math.sin(ci * 0.5 + this._animTime * this._animSpeed * Math.PI * 2) * (this._animAmt / 100) * fs * 0.4;

          if (this._outline > 0) {
            this._applyOutlineStyle(ctx, satPct, lightPct);
            ctx.lineWidth = this._outline * 2;
            ctx.lineJoin  = 'round';
            ctx.strokeText(ch, cx, charY);
            ctx.fillStyle = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
          }
          ctx.fillText(ch, cx, charY);
          cx += ctx.measureText(ch).width;
        }
        ctx.textAlign = savedAlign;
      } else {
        if (this._outline > 0) {
          this._applyOutlineStyle(ctx, satPct, lightPct);
          ctx.lineWidth = this._outline * 2;
          ctx.lineJoin  = 'round';
          ctx.strokeText(line, alignX, baseY);
          ctx.fillStyle = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
        }
        ctx.fillText(line, alignX, baseY);
      }
    });

    if (doRotate) ctx.restore();

    // Reset shadow and alpha
    ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  _applyOutlineStyle(ctx, satPct, lightPct) {
    if (this._outlineSat > 0) {
      ctx.strokeStyle = `hsl(${this._outlineHue}, ${this._outlineSat}%, ${lightPct}%)`;
    } else {
      ctx.strokeStyle = `hsl(${this._hue}, ${satPct}%, ${Math.max(0, lightPct - 40)}%)`;
    }
  }
}
