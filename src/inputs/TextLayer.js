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

// Default render resolution. text.res selects among RES_OPTS at runtime; this
// is only the size the canvas is born at, before the first tick() reads the
// param. 512 was the historical fixed size and is kept as the floor.
const SIZE = 512;
const RES_OPTS = [512, 1024, 2048];
// APPEND-ONLY, forever. text.font is a SELECT persisted as an integer index
// into this list by every .imweb, .imbank, .imstate and MIDI mapping — the
// same rule that governs SOURCE_DEFS. Indices 0–4 are the original five and
// must keep their exact meaning; indices 3 and 4 are weight/style masquerading
// as families, which is why text.weight/text.italic exist from index 5 on and
// why _fontString() still honours the old two as special cases.
const FONTS = [
  'sans-serif',
  'serif',
  '"IBM Plex Mono", monospace',
  'bold sans-serif',
  'italic serif',
  // Bundled faces (public/fonts, @font-face in style.css). The generic after
  // each is a real fallback, not decoration: font-display:block plus the load
  // guarantee should prevent it ever being used, but a corrupt cache must
  // still draw letters.
  '"IW Inter", sans-serif',
  '"IW Grotesk", sans-serif',
  '"IW Archivo", sans-serif',
  '"IW Oswald", sans-serif',
  '"IW Playfair", serif',
  '"IW JetBrains", monospace',
  '"IW Bebas", sans-serif',
  '"IW Anton", sans-serif',
  '"IW Orbitron", sans-serif',
  '"IW Monoton", cursive',
  '"IW MajorMono", monospace',
  '"IW VT323", monospace',
  '"IW DotGothic", monospace',
  '"IW Silkscreen", monospace',
];
const ALIGNS = ['center', 'left', 'right'];

// Glitch substitution charsets, indexed by text.glitchSet. Katakana is not in
// the bundled Latin subsets — the browser falls back per glyph to a system CJK
// face, which is what makes the look work on a normal machine and what makes
// it degrade to tofu on one with no CJK font installed. That is the trade the
// option is offering; the other three are safe everywhere.
const GLITCH_SETS = [
  '!<>-_\\/[]{}=+*^?#$%&@~|',                                  // Symbols
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', // ASCII
  '░▒▓█▄▀▐▌■□▪▫◆◇○●',                                          // Blocks
  'ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜﾝ',              // Katakana
];

/**
 * Integer hash → [0,1). Deterministic on purpose: the glitch substitution has
 * to be stable for the whole of one scramble STEP. Math.random() per frame
 * would re-roll every glyph at 60 Hz no matter what text.animSpeed said, so
 * the speed control would do nothing and the result would be white noise.
 */
const hash01 = (n) => {
  n = Math.imul(n ^ (n >>> 15), 0x2c1b3c6d);
  n = Math.imul(n ^ (n >>> 12), 0x297a2d39);
  return ((n ^ (n >>> 15)) >>> 0) / 4294967296;
};

export class TextLayer {
  constructor() {
    this._size2d = SIZE;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = this._size2d;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    // Canvas 2D keeps its backing store PREMULTIPLIED. With the default
    // UNPACK_PREMULTIPLY_ALPHA=false the browser has to UN-premultiply on
    // upload, which divides every antialiased edge pixel's RGB by a small
    // alpha and quantizes it into a dark, blocky fringe — and TRANSFERMODE
    // blends RGB only (blendMix takes a vec3), so that fringe is exactly what
    // reached the screen. Turning text.bg on hid it by making alpha 1
    // everywhere; that was a workaround, not the fix. Uploading premultiplied
    // gives RGB = colour × coverage, the form the RGB-only blend modes want,
    // and leaves fg.a intact for the keyer's Alpha mode.
    this.texture.premultiplyAlpha = true;

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
    this._weight  = 400;
    this._italic  = 0;
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

    // Entrance/exit transition animation
    this._animPhase   = 1;    // 0→1 over _animDur after index change; 1 = fully shown
    this._exitPhase   = 1;    // 0→1 for prev unit exit; 1 = exit done
    this._prevUnit    = '';   // unit string being exited
    this._animInMode  = 0;    // text.anim.in index
    this._animOutMode = 0;    // text.anim.out index
    this._animDur     = 0.3;  // text.anim.dur seconds
    this._animEase    = 2;    // text.anim.ease index
    this._autoAccum   = 0;    // accumulator for text.auto Hz

    // Content list
    this._contentList = [];
    this._contentIdx  = 0;

    // Render resolution (index into RES_OPTS)
    this._resIdx = RES_OPTS.indexOf(SIZE);

    // Per-glyph stagger + glitch
    this._stagger     = 0;   // % of anim.dur spread across the glyphs
    this._staggerFrom = 0;   // 0 Start · 1 Center · 2 End · 3 Random
    this._glitchSet   = 0;
    this._animSeed    = 0;   // bumped on every unit change — reseeds Random
    this._permCache   = null;

    this._render();
    // The bundled faces are not there yet on the first frame; re-render once
    // they are, or the boot texture keeps the fallback face forever.
    document.fonts?.ready?.then(() => this._render()).catch?.(() => {});
  }

  /**
   * Resize the render canvas. Setting canvas.width/height RESETS every piece
   * of 2D context state (font, alpha, transform, letterSpacing), so this may
   * only be called from tick() immediately before a _render() that rebuilds
   * all of it — never mid-draw.
   */
  _setRes(idx) {
    const n = RES_OPTS[idx] ?? SIZE;
    if (n === this._size2d) return;
    this._size2d = n;
    this.canvas.width = this.canvas.height = n;
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
    this._prevUnit  = this._units[this._idx] ?? '';
    this._exitPhase = 0;
    this._animPhase = 0;
    this._idx = (this._idx + 1) % this._units.length;
    this._typerChars = 0;
    this._animSeed = (this._animSeed + 1) | 0;  // reseed Random stagger/glitch
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
    const weight  = Math.round(get('text.weight')) || 400;
    const italic  = get('text.italic') ? 1 : 0;
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

    // Render resolution — _setRes wipes the 2D context, so it is applied here
    // and the render that rebuilds the state follows at the end of tick().
    const resIdx = Math.max(0, Math.min(RES_OPTS.length - 1, Math.round(get('text.res'))));
    if (resIdx !== this._resIdx) { this._resIdx = resIdx; this._setRes(resIdx); dirty = true; }

    if (size    !== this._size)    { this._size    = size;    dirty = true; }
    if (hue     !== this._hue)     { this._hue     = hue;     dirty = true; }
    if (sat     !== this._sat)     { this._sat     = sat;     dirty = true; }
    if (opacity !== this._opacity) { this._opacity = opacity; dirty = true; }
    if (x       !== this._x)       { this._x       = x;       dirty = true; }
    if (y       !== this._y)       { this._y       = y;       dirty = true; }
    if (bg      !== this._bg)      { this._bg      = bg;      dirty = true; }
    if (align   !== this._align)   { this._align   = align;   dirty = true; }
    if (font    !== this._font)    { this._font    = font;    dirty = true; this._ensureFont(); }
    if (weight  !== this._weight)  { this._weight  = weight;  dirty = true; this._ensureFont(); }
    if (italic  !== this._italic)  { this._italic  = italic;  dirty = true; this._ensureFont(); }
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

    // Per-glyph stagger + glitch
    const stagger     = get('text.stagger');
    const staggerFrom = Math.round(get('text.staggerFrom'));
    const glitchSet   = Math.round(get('text.glitchSet'));
    if (stagger     !== this._stagger)     { this._stagger     = stagger;     dirty = true; }
    if (staggerFrom !== this._staggerFrom) { this._staggerFrom = staggerFrom; dirty = true; }
    if (glitchSet   !== this._glitchSet)   { this._glitchSet   = glitchSet;   dirty = true; }
    if (animSpeed !== this._animSpeed) { this._animSpeed = animSpeed; }
    if (animAmt   !== this._animAmt)   { this._animAmt   = animAmt;   dirty = true; }

    this._autoplay = autoplay;
    this._rate     = rate;

    // Entrance/exit animation params
    const animInMode  = Math.round(get('text.anim.in'));
    const animOutMode = Math.round(get('text.anim.out'));
    const animDur     = Math.max(0.05, get('text.anim.dur') || 0.3);
    const animEase    = Math.round(get('text.anim.ease'));
    this._animInMode  = animInMode;
    this._animOutMode = animOutMode;
    this._animDur     = animDur;
    this._animEase    = animEase;

    // text.progress (0–100) → unit index
    if (this._units.length > 1) {
      const progress = get('text.progress');
      const targetIdx = Math.round((progress / 100) * (this._units.length - 1));
      if (targetIdx !== this._idx) {
        this._prevUnit  = this._units[this._idx] ?? '';
        this._exitPhase = 0;
        this._animPhase = 0;
        this._idx       = targetIdx;
        this._typerChars = 0;
        this._animSeed  = (this._animSeed + 1) | 0;
        dirty = true;
      }
    }

    // text.auto: Hz-based auto-advance (independent of text.autoplay)
    const autoHz = get('text.auto');
    if (autoHz > 0) {
      this._autoAccum += dt;
      if (this._autoAccum >= 1 / autoHz) {
        this._autoAccum = 0;
        this.advance();
        dirty = true;
      }
    } else {
      this._autoAccum = 0;
    }

    // Advance entrance/exit phases
    if (dt > 0 && animDur > 0) {
      if (this._animPhase < 1) {
        this._animPhase = Math.min(1, this._animPhase + dt / animDur);
        dirty = true;
      }
      if (this._exitPhase < 1) {
        this._exitPhase = Math.min(1, this._exitPhase + dt / animDur);
        dirty = true;
      }
    }

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

  _easePhase(t) {
    const c = Math.max(0, Math.min(1, t));
    switch (this._animEase) {
      case 1: return c * c;                                         // EaseIn
      case 2: return 1 - (1 - c) * (1 - c);                        // EaseOut
      case 3: return c < 0.5 ? 2*c*c : 1 - Math.pow(-2*c+2,2)/2;  // EaseInOut
      case 4: { // Bounce
        const n1 = 7.5625, d1 = 2.75;
        let x = c;
        if (x < 1/d1) return n1*x*x;
        else if (x < 2/d1) return n1*(x-=1.5/d1)*x+0.75;
        else if (x < 2.5/d1) return n1*(x-=2.25/d1)*x+0.9375;
        else return n1*(x-=2.625/d1)*x+0.984375;
      }
      case 5: return 1 - Math.pow(2,-10*c) * Math.cos(c*Math.PI*2*1.5); // Spring
      default: return c;                                            // Linear
    }
  }

  /**
   * Order key for glyph i of n under text.staggerFrom, normalized to [0,1].
   * Random draws from a permutation that is regenerated ONLY when the unit
   * changes (_animSeed) — re-rolling it per frame makes the glyphs reshuffle
   * every 16 ms, which does not read as a stagger, it reads as noise.
   */
  _staggerOrder(i, n) {
    if (n <= 1) return 0;
    switch (this._staggerFrom) {
      case 1: { // Center — outward from the middle
        const mid = (n - 1) / 2;
        return Math.abs(i - mid) / mid;
      }
      case 2: return (n - 1 - i) / (n - 1);                    // End
      case 3: {                                                // Random
        if (!this._permCache || this._permCache.n !== n ||
            this._permCache.seed !== this._animSeed) {
          const perm = [...Array(n).keys()];
          for (let j = n - 1; j > 0; j--) {
            const r = Math.floor(hash01(this._animSeed * 7919 + j) * (j + 1));
            [perm[j], perm[r]] = [perm[r], perm[j]];
          }
          this._permCache = { n, seed: this._animSeed, perm };
        }
        return this._permCache.perm[i] / (n - 1);
      }
      default: return i / (n - 1);                             // Start
    }
  }

  /**
   * Map the whole-block transition phase to glyph i's own phase.
   * `spread` is the fraction of anim.dur handed over to the delay ramp, so the
   * transition still finishes in exactly anim.dur however wide the stagger is:
   * the last glyph starts at `spread` and runs over the remaining (1-spread).
   */
  _glyphPhase(phase, i, n, spread) {
    if (spread <= 0) return phase;
    const delay = spread * this._staggerOrder(i, n);
    return Math.max(0, Math.min(1, (phase - delay) / (1 - spread)));
  }

  /** The substituted glyph for a continuous scramble, or the original. */
  _glitchChar(ch, i, amt) {
    if (!ch.trim()) return ch;
    const set  = GLITCH_SETS[this._glitchSet] ?? GLITCH_SETS[0];
    const step = Math.floor(this._animTime * Math.max(0.01, this._animSpeed));
    const pick = i * 7919 + step * 104729 + this._animSeed * 31;
    if (hash01(pick) >= amt) return ch;
    return set[Math.floor(hash01(pick * 3 + 1) * set.length)] ?? ch;
  }

  /**
   * Per-character draw with the align compensation and advance loop that used
   * to live inline in the Wave branch. Wave, stagger and glitch all render
   * through here.
   *
   * The advance is ALWAYS taken from the original character, never the drawn
   * one — a substituted glyph of a different width would make the whole line
   * breathe, which reads as the text wobbling rather than as glyphs changing.
   *
   * `perGlyph({ch, i, n, x, adv, ctx})` returns `{ch, dx, dy}` (any field
   * optional) or `false` to skip the glyph. It is called inside a save/restore
   * pair, so it may transform ctx freely — which is how the entrance/exit
   * transforms get applied per glyph rather than per block.
   */
  _drawGlyphs(ctx, line, alignX, baseY, style, perGlyph) {
    const { satPct, lightPct, k } = style;
    let cx = alignX;
    const w = ctx.measureText(line).width;
    if (this._align === 0)      cx -= w / 2;
    else if (this._align === 2) cx -= w;

    const savedAlign = ctx.textAlign;
    const savedAlpha = ctx.globalAlpha;
    ctx.textAlign = 'left';

    const n = line.length;
    for (let i = 0; i < n; i++) {
      const src = line[i];
      const adv = ctx.measureText(src).width;
      ctx.save();
      const g = perGlyph({ ch: src, i, n, x: cx, adv, ctx });
      if (g !== false) {
        const ch = g?.ch ?? src;
        const gx = cx + (g?.dx ?? 0);
        const gy = baseY + (g?.dy ?? 0);
        if (ch.trim() && ctx.globalAlpha > 0.004) {
          if (this._outline > 0) {
            this._applyOutlineStyle(ctx, satPct, lightPct);
            ctx.lineWidth = this._outline * 2 * k;
            ctx.lineJoin  = 'round';
            ctx.strokeText(ch, gx, gy);
            ctx.fillStyle = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
          }
          ctx.fillText(ch, gx, gy);
        }
      }
      ctx.restore();
      cx += adv;
    }

    ctx.textAlign   = savedAlign;
    ctx.globalAlpha = savedAlpha;
  }

  _applyEntranceTransform(ctx, mode, phase, alignX, py, k = 1) {
    const e = this._easePhase(phase);
    switch (mode) {
      case 1: ctx.globalAlpha *= e; break;                                  // Fade
      case 2: ctx.globalAlpha *= e; ctx.translate(0, (1-e)*40*k); break;    // FadeUp
      case 3: ctx.globalAlpha *= e; ctx.translate(0, -(1-e)*40*k); break;   // FadeDown
      case 4: // Scale
        ctx.translate(alignX, py);
        ctx.scale(Math.max(0.001, e), Math.max(0.001, e));
        ctx.translate(-alignX, -py);
        break;
      case 5: ctx.filter = `blur(${(1-e)*12*k}px)`; break;                  // Blur
      // TypeOn handled in caller by slicing chars
    }
  }

  _applyExitTransform(ctx, mode, phase, alignX, py, k = 1) {
    const e = this._easePhase(phase); // phase 0→1 means going away
    switch (mode) {
      case 1: ctx.globalAlpha *= (1 - e); break;                            // Fade
      case 2: ctx.globalAlpha *= (1-e); ctx.translate(0, -(e*40*k)); break; // FadeDown
      case 3: ctx.globalAlpha *= (1-e); ctx.translate(0, e*40*k); break;    // FadeUp
      case 4:
        ctx.translate(alignX, py);
        ctx.scale(Math.max(0.001, 1-e*0.5), Math.max(0.001, 1-e*0.5));
        ctx.translate(-alignX, -py);
        break;
      case 5: ctx.filter = `blur(${e*12*k}px)`; break;
      case 6: ctx.globalAlpha = 0; break;                                   // Vanish
    }
  }

  _render() {
    const ctx  = this.ctx;
    let unit = this._units[this._idx] ?? '';

    // TypeOn entrance mode clips chars based on phase
    if (this._animInMode === 6 && this._animPhase < 1) {
      unit = unit.slice(0, Math.floor(this._animPhase * unit.length));
    }

    // Typewriter mode clips the visible characters (existing animMode 4)
    if (this._animMode === 4) {
      unit = unit.slice(0, Math.floor(this._typerChars));
    }

    const S = this._size2d;

    ctx.clearRect(0, 0, S, S);
    if (this._bg) {
      ctx.globalAlpha = this._bgOpacity / 100;
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, S, S);
      ctx.globalAlpha = 1;
    }

    if (!unit.trim()) { this.texture.needsUpdate = true; return; }

    // Every pixel-valued param (size, letterspacing, shadow, outline, the
    // animation offsets) is authored against the historical 512 grid and
    // scaled by k. Without this, raising text.res would SHRINK the text
    // relative to the frame instead of sharpening it — a resolution knob that
    // silently rescales every saved project is not a resolution knob.
    const k        = S / SIZE;
    const fs       = Math.max(8, Math.min(this._size * k, S - 4));
    const satPct   = Math.round(this._sat);
    const lightPct = 70 - Math.round(this._sat * 0.2);
    ctx.fillStyle   = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
    ctx.globalAlpha = this._opacity / 100;

    ctx.font         = this._fontString(fs);
    ctx.textBaseline = 'middle';
    ctx.textAlign    = ALIGNS[this._align] ?? 'center';

    // Letter spacing (Canvas API, Chrome 99+ / Safari 17+; gracefully ignored on older)
    if ('letterSpacing' in ctx) ctx.letterSpacing = (this._letterspacing * k) + 'px';

    const alignX = (this._x / 100) * S;
    const py     = (1 - this._y / 100) * S;

    const exitSpread = Math.min(0.95, Math.max(0, this._stagger / 100));

    // Draw exit animation of previous unit (behind current)
    if (this._animOutMode > 0 && this._exitPhase < 1 && this._prevUnit) {
      const prevLines = this._prevUnit.split('\n');
      const lineH2 = fs * this._spacing;
      const totalH2 = lineH2 * prevLines.length;

      if (exitSpread > 0) {
        // Per-glyph exit: the transform runs inside the glyph loop, so there is
        // no block-level save/transform to wrap it in.
        prevLines.forEach((line, i) => {
          const baseY2 = py - totalH2 / 2 + lineH2 * (i + 0.5);
          this._drawGlyphs(ctx, line, alignX, baseY2, { satPct, lightPct, k },
            ({ i: gi, n, x, adv, ctx: g }) => {
              g.globalAlpha = this._opacity / 100;
              const local = this._glyphPhase(this._exitPhase, gi, n, exitSpread);
              this._applyExitTransform(g, this._animOutMode, local, x + adv / 2, baseY2, k);
              return {};
            });
        });
      } else {
        ctx.save();
        ctx.globalAlpha = this._opacity / 100;
        this._applyExitTransform(ctx, this._animOutMode, this._exitPhase, alignX, py, k);
        if (ctx.globalAlpha > 0.01) {
          prevLines.forEach((line, i) => {
            const baseY2 = py - totalH2 / 2 + lineH2 * (i + 0.5);
            ctx.fillText(line, alignX, baseY2);
          });
        }
        ctx.restore();
      }
      ctx.filter = 'none';
    }

    const lines  = unit.split('\n');
    const lineH  = fs * this._spacing;
    const totalH = lineH * lines.length;

    // Shadow
    if (this._shadowBlur > 0 || this._shadowX !== 0 || this._shadowY !== 0) {
      ctx.shadowBlur    = this._shadowBlur * k;
      ctx.shadowOffsetX = this._shadowX * k;
      ctx.shadowOffsetY = -this._shadowY * k;
      ctx.shadowColor   = ctx.fillStyle;
    }

    const style = { satPct, lightPct, k };

    // Entrance animation. With stagger the transform runs per glyph inside
    // _drawGlyphs instead, so the block-level transform must NOT also apply —
    // it would move the whole line on top of the per-glyph motion.
    const spread     = Math.min(0.95, Math.max(0, this._stagger / 100));
    const isDecode   = this._animInMode === 7 && this._animPhase < 1;
    const staggered  = this._animInMode > 0 && this._animInMode !== 6 && !isDecode &&
                       this._animPhase < 1 && spread > 0;
    const doEntrance = this._animInMode > 0 && this._animPhase < 1 &&
                       !staggered && !isDecode;
    if (doEntrance) {
      ctx.save();
      this._applyEntranceTransform(ctx, this._animInMode, this._animPhase, alignX, py, k);
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
        // Wave — per-character sin Y offset
        this._drawGlyphs(ctx, line, alignX, baseY, style, ({ i }) => ({
          dy: Math.sin(i * 0.5 + this._animTime * this._animSpeed * Math.PI * 2)
              * (this._animAmt / 100) * fs * 0.4,
        }));
      } else if (this._animMode === 5) {
        // Glitch — continuous scramble, animAmt = fraction of glyphs replaced
        const amt = this._animAmt / 100;
        this._drawGlyphs(ctx, line, alignX, baseY, style, ({ ch, i }) => ({
          ch: this._glitchChar(ch, i, amt),
        }));
      } else if (isDecode) {
        // Decode entrance — each glyph scrambles until its own phase resolves.
        // A decode where every glyph settles on the same frame is a cut, not a
        // decode, so this keeps a floor under the spread even at stagger 0.
        const dSpread = Math.max(spread, 0.6);
        this._drawGlyphs(ctx, line, alignX, baseY, style, ({ ch, i, n }) => {
          const local = this._glyphPhase(this._animPhase, i, n, dSpread);
          return { ch: local >= 1 ? ch : this._glitchChar(ch, i, 1) };
        });
      } else if (staggered) {
        // Per-glyph entrance — the same in-transform, run once per glyph and
        // anchored on the glyph's own centre so Scale grows each letter in
        // place rather than the block as a whole.
        this._drawGlyphs(ctx, line, alignX, baseY, style, ({ i, n, x, adv, ctx: g }) => {
          const local = this._glyphPhase(this._animPhase, i, n, spread);
          this._applyEntranceTransform(g, this._animInMode, local, x + adv / 2, baseY, k);
          return {};
        });
      } else {
        if (this._outline > 0) {
          this._applyOutlineStyle(ctx, satPct, lightPct);
          ctx.lineWidth = this._outline * 2 * k;
          ctx.lineJoin  = 'round';
          ctx.strokeText(line, alignX, baseY);
          ctx.fillStyle = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
        }
        ctx.fillText(line, alignX, baseY);
      }
    });

    if (doRotate) ctx.restore();
    if (doEntrance) { ctx.restore(); ctx.filter = 'none'; }

    // Reset shadow and alpha
    ctx.shadowBlur = ctx.shadowOffsetX = ctx.shadowOffsetY = 0;
    ctx.globalAlpha = 1;
    this.texture.needsUpdate = true;
  }

  /**
   * Build the CSS font shorthand. Indices 3 and 4 keep their legacy baked-in
   * bold/italic so states saved before text.weight existed still look the way
   * they did; every other index takes its weight and slant from the params.
   */
  _fontString(fs) {
    const family = FONTS[this._font] ?? 'sans-serif';
    const legacyBold   = this._font === 3;
    const legacyItalic = this._font === 4;
    const italic = legacyItalic || this._italic ? 'italic ' : '';
    const weight = legacyBold ? 'bold ' : `${Math.round(this._weight)} `;
    return `${italic}${weight}${fs}px ${family}`;
  }

  /**
   * ctx.font with a family the browser has not loaded yet fails SILENTLY —
   * Canvas 2D substitutes the default face, and because _render() only runs
   * when something is dirty, that wrong face stays rasterised into the texture
   * for good. So every font/weight/italic change schedules a re-render for
   * when the face actually arrives. document.fonts.load() resolves immediately
   * for an already-loaded face, so the common path costs one microtask.
   */
  _ensureFont() {
    if (!document.fonts?.load) return;
    const spec = this._fontString(64);
    document.fonts.load(spec).then(() => this._render()).catch(() => {});
  }

  _applyOutlineStyle(ctx, satPct, lightPct) {
    if (this._outlineSat > 0) {
      ctx.strokeStyle = `hsl(${this._outlineHue}, ${this._outlineSat}%, ${lightPct}%)`;
    } else {
      ctx.strokeStyle = `hsl(${this._hue}, ${satPct}%, ${Math.max(0, lightPct - 40)}%)`;
    }
  }
}
