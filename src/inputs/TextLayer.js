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

    // Marquee. Phase is in CANVAS PIXELS and accumulates from dt, so the speed
    // is frame-rate independent; it wraps on the line's own width, not the
    // canvas width (see _render).
    this._scrollX   = 0;
    this._scrollY   = 0;
    this._scrollGap = 20;
    this._scrollPX  = 0;
    this._scrollPY  = 0;

    // Path layout
    this._path        = 0;
    this._pathRadius  = 30;
    this._pathAngle   = 0;
    this._pathSpread  = 360;
    this._pathWidth   = 100;
    this._pathTwist   = 0;
    this._pathUpright = 0;
    this._pathFlip    = 0;

    // Output aspect (width/height), for keeping a circle round ON SCREEN.
    this._aspect = 1;

    // Audio reactivity. `_audio` is pushed in from the render loop (see
    // setAudio) — this class never imports the audio half, the same injection
    // rule ControllerManager and VectorscopeInput follow for the §8.6 tap.
    this._audio       = null;
    this._audioTarget = 0;
    this._audioBand   = 0;
    this._audioAmt    = 80;
    this._audioSmooth = 10;
    this._audioLo     = 80;     // Hz — low end of the span across the word
    this._audioHi     = 6000;   // Hz — high end
    this._audioGain   = 50;     // sensitivity
    // Per-glyph envelope followers, indexed by glyph. Grown on demand.
    this._audioEnv    = new Float32Array(0);

    this._render();
    // The bundled faces are not there yet on the first frame; re-render once
    // they are, or the boot texture keeps the fallback face forever.
    document.fonts?.ready?.then(() => this._render()).catch?.(() => {});
  }

  /**
   * The output's width/height, pushed in from the render loop.
   *
   * The text canvas is square and the compositor samples it at plain vUv with
   * no aspect correction anywhere in TRANSFERMODE or KEYER — so a square source
   * is stretched to fill the frame, 1.78x wide at 16:9. That is the house
   * convention (DrawLayer is square too) and is not changed here, but it means
   * a circle authored in canvas space arrives on screen as an ellipse. Path
   * layout divides its x extent by this so a circle is round WHERE IT IS SEEN.
   *
   * Defaults to 1 and is optional: the class must stay constructible with no
   * pipeline at all, which is how the test harness drives it.
   */
  setOutputAspect(a) {
    const v = Number.isFinite(a) && a > 0 ? a : 1;
    if (v !== this._aspect) { this._aspect = v; this._render(); }
  }

  /**
   * The current audio picture, pushed in once a frame by the render loop:
   * `{ freq: Uint8Array, level, bass, mid, high }`, or null when nothing is
   * listening. Injected rather than imported — this class must not learn what
   * an AnalyserNode is, and the test harness has to be able to drive it with a
   * plain object.
   *
   * Held by reference and read at render time. The array is the analyser's own
   * buffer and is refilled in place every frame, which is exactly what we want:
   * no copy, and never a stale frame.
   */
  setAudio(a) { this._audio = a || null; }

  /**
   * Advance the per-glyph envelope followers.
   *
   * Fast attack, slow release — a peak-hold, which is what makes a spectrum
   * read as a bank of meters rather than as jitter. A symmetric filter slow
   * enough to stop the flicker also swallows every transient, and transients
   * are the whole point.
   */
  _tickAudio(dt) {
    const n = (this._units[this._idx] ?? '').length;
    if (!n) return false;
    if (this._audioEnv.length < n) this._audioEnv = new Float32Array(n);

    const a = this._audio;
    const N = a?.freq?.length ?? 0;
    // Spectrum spreads the band across the glyphs; the others drive every
    // glyph from one number, which is still useful and much calmer.
    const uniform = this._audioBand === 0 ? null
      : this._audioBand === 1 ? (a?.level ?? 0)
      : this._audioBand === 2 ? (a?.bass  ?? 0)
      : this._audioBand === 3 ? (a?.mid   ?? 0)
      :                         (a?.high  ?? 0);

    // Glyph → frequency is LOGARITHMIC, because hearing is and music is: every
    // letter gets an equal share of the OCTAVES between Low and High, not an
    // equal share of the hertz. A linear spread put ten of eleven letters above
    // 1 kHz where a microphone has almost nothing, which is why the only usable
    // setting was to squash the whole span into the bass.
    //
    // Low and High are two ends rather than one "range", because that is what
    // tuning this actually needs: you point the word at the part of the
    // spectrum the material lives in, from both sides.
    const nyq   = (a?.rate ?? 48000) / 2;
    const fLo   = Math.max(20, Math.min(this._audioLo, nyq * 0.5));
    const fHi   = Math.max(fLo * 1.5, Math.min(this._audioHi, nyq));
    const hzPer = nyq / Math.max(1, N);
    const fAt   = (t) => fLo * Math.pow(fHi / fLo, t);
    const binAt = (f) => Math.max(0, Math.min(N - 1, Math.round(f / hzPer)));

    // Sensitivity, and the gate that makes it usable.
    //
    // Without a gate the letters never come to rest: a microphone's noise floor
    // is not zero, the spectral tilt below multiplies it, and every glyph sits
    // permanently a little bit ON — which reads as "rotated a bit by default",
    // as movement that looks minimal (the useful travel is squashed above a
    // raised floor), and as a response too broad to tell one letter from
    // another. The gate subtracts the resting floor and re-normalises what is
    // left, so silence is genuinely still and the whole travel is signal.
    const gain = Math.pow(10, (this._audioGain - 50) / 50);   // 0.1x … 10x
    const GATE = 0.08;

    const atkK = 1 - Math.exp(-dt / 0.02);
    const relK = 1 - Math.exp(-dt / (0.02 + (this._audioSmooth / 100) * 0.5));

    let moved = false;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (uniform !== null) {
        v = uniform;
      } else if (N) {
        // Average the glyph's whole slice, not one bin — with 256 bins and a
        // short word, point-sampling picks an arbitrary spike and misses the
        // energy either side of it.
        const b0 = binAt(fAt(i / n));
        const b1 = Math.max(b0 + 1, binAt(fAt((i + 1) / n)));
        let s = 0;
        for (let b = b0; b < b1; b++) s += a.freq[b];
        v = s / ((b1 - b0) * 255);
        // Tilt. Real programme material falls off with frequency, so even on a
        // log axis the treble letters would idle while the bass ones saturate.
        // A gentle rising weight buys the top half of the word back; without
        // it the log mapping alone still leaves the word lopsided.
        const fc = (fAt(i / n) + fAt((i + 1) / n)) * 0.5;
        v = Math.min(1, v * Math.min(4, Math.max(1, Math.sqrt(fc / 250))));
      }
      // Sensitivity, THEN the gate — in that order, so turning sensitivity up
      // lifts the signal above a fixed floor instead of lifting the floor with
      // it. Gating after the tilt matters too: the tilt multiplies hiss as
      // readily as music, and ungated that is what held every letter slightly
      // on at rest.
      v = Math.max(0, Math.min(1, (v * gain - GATE) / (1 - GATE)));

      const e = this._audioEnv[i];
      const k = v > e ? atkK : relK;
      const next = e + (v - e) * k;
      if (Math.abs(next - e) > 0.0005) moved = true;
      this._audioEnv[i] = next;
    }
    return moved;
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

    // Marquee. The phase is an integrator, so it advances on dt and NOT on a
    // change comparison — a scroll that only redrew when its speed changed
    // would sit still.
    this._scrollX   = get('text.scrollX');
    this._scrollY   = get('text.scrollY');
    this._scrollGap = get('text.scrollGap');
    if (this._scrollX !== 0 || this._scrollY !== 0) {
      // %/s of the canvas width, scaled by k so text.res does not change speed.
      this._scrollPX += (this._scrollX / 100) * SIZE * (this._size2d / SIZE) * dt;
      this._scrollPY += (this._scrollY / 100) * SIZE * (this._size2d / SIZE) * dt;
      dirty = true;
    }

    // Audio reactivity
    const audioTarget = Math.round(get('text.audioTarget'));
    const audioBand   = Math.round(get('text.audioBand'));
    const audioAmt    = get('text.audioAmt');
    const audioSmooth = get('text.audioSmooth');
    const audioLo     = get('text.audioLo');
    const audioHi     = get('text.audioHi');
    const audioGain   = get('text.audioGain');
    if (audioTarget !== this._audioTarget) { this._audioTarget = audioTarget; dirty = true; }
    if (audioBand   !== this._audioBand)   { this._audioBand   = audioBand;   dirty = true; }
    if (audioAmt    !== this._audioAmt)    { this._audioAmt    = audioAmt;    dirty = true; }
    this._audioSmooth = audioSmooth;
    this._audioLo     = audioLo;
    this._audioHi     = audioHi;
    if (audioGain !== this._audioGain) { this._audioGain = audioGain; dirty = true; }
    // The envelope is an integrator, so it advances on dt and re-renders while
    // it is still moving — including on the way DOWN, or the text would freeze
    // at its loudest and stay there.
    if (audioTarget > 0 && dt > 0 && this._tickAudio(dt)) dirty = true;

    // Path layout
    const path        = Math.round(get('text.path'));
    const pathRadius  = get('text.pathRadius');
    const pathAngle   = get('text.pathAngle');
    const pathSpread  = get('text.pathSpread');
    const pathWidth   = get('text.pathWidth');
    const pathTwist   = get('text.pathTwist');
    const pathUpright = get('text.pathUpright') ? 1 : 0;
    const pathFlip    = get('text.pathFlip') ? 1 : 0;
    if (path        !== this._path)        { this._path        = path;        dirty = true; }
    if (pathRadius  !== this._pathRadius)  { this._pathRadius  = pathRadius;  dirty = true; }
    if (pathAngle   !== this._pathAngle)   { this._pathAngle   = pathAngle;   dirty = true; }
    if (pathSpread  !== this._pathSpread)  { this._pathSpread  = pathSpread;  dirty = true; }
    if (pathWidth   !== this._pathWidth)   { this._pathWidth   = pathWidth;   dirty = true; }
    if (pathTwist   !== this._pathTwist)   { this._pathTwist   = pathTwist;   dirty = true; }
    if (pathUpright !== this._pathUpright) { this._pathUpright = pathUpright; dirty = true; }
    if (pathFlip    !== this._pathFlip)    { this._pathFlip    = pathFlip;    dirty = true; }
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

    // cx is the running pen and is mutated by the loop, so the line's start
    // has to be captured before it moves.
    const cx0 = cx;

    const savedAlign = ctx.textAlign;
    const savedAlpha = ctx.globalAlpha;
    ctx.textAlign = 'left';

    const n = line.length;
    for (let i = 0; i < n; i++) {
      const src = line[i];
      const adv = ctx.measureText(src).width;
      ctx.save();
      // x0/w let a modifier work in FRACTIONS of the line (path placement needs
      // "how far along am I", not "which pixel am I at").
      const g = perGlyph({ ch: src, i, n, x: cx, adv, ctx, x0: cx0, w });
      if (g !== false) {
        const ch = g?.ch ?? src;
        const gx = cx + (g?.dx ?? 0);
        const gy = baseY + (g?.dy ?? 0);
        if (ch.trim() && ctx.globalAlpha > 0.004) {
          if (this._outline > 0) {
            // Restore the fill the MODIFIERS left, not a freshly rebuilt base
            // colour: recomputing it here would silently discard a per-glyph
            // hue (audio Hue mode) every time an outline was switched on.
            const fill = ctx.fillStyle;
            this._applyOutlineStyle(ctx, satPct, lightPct);
            ctx.lineWidth = this._outline * 2 * k;
            ctx.lineJoin  = 'round';
            ctx.strokeText(ch, gx, gy);
            ctx.fillStyle = fill;
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

  /**
   * Where glyph fraction `t` ∈ (0,1) along a line sits under text.path, and
   * which way it faces. Returns canvas-space coordinates relative to the path
   * centre, plus the rotation to apply.
   *
   * The four shapes are deliberately distinct rather than four presets of one
   * formula — pathTwist has exactly one owner (Spiral) so that turning it has a
   * predictable effect instead of quietly deforming Circle as well:
   *
   *   Circle  starts at pathAngle and runs pathSpread degrees from there
   *   Arc     CENTRES pathSpread on pathAngle, so widening an arc keeps it put
   *   Spiral  Circle, with the radius growing by pathTwist over the sweep
   *   Wave    a sine along the baseline, pathSpread degrees of it per line
   *
   * X is divided by the output aspect so the shape is round ON SCREEN — see
   * setOutputAspect. pathWidth then scales x on top of that, which is how you
   * ask for an ellipse on purpose.
   */
  _pathPoint(t, S) {
    const R    = (this._pathRadius / 100) * (S / 2);
    const rad  = Math.PI / 180;
    const a0   = this._pathAngle * rad;
    const span = this._pathSpread * rad;
    const xs   = (this._pathWidth / 100) / this._aspect;

    if (this._path === 4) {                       // Wave
      const y = R * Math.sin(t * span);
      // Slope of the sine, for the tangent when glyphs are not held upright.
      const slope = R * span * Math.cos(t * span);
      return { x: (t - 0.5) * S * (this._pathWidth / 100), y, rot: Math.atan2(slope, S) };
    }

    // Polar shapes. -90° so t=0 starts at the TOP, which is where anyone
    // laying text around a circle expects it to start.
    const a = -Math.PI / 2 + (this._path === 2 ? a0 + (t - 0.5) * span
                                               : a0 + t * span);
    const r = this._path === 3 ? R * (1 + (this._pathTwist / 100) * t) : R;
    // Flip puts the glyphs on the other side of the curve — this is the control
    // that rights the upside-down text along the bottom of a ring.
    const rot = a + (this._pathFlip ? -Math.PI / 2 : Math.PI / 2);
    return { x: r * Math.cos(a) * xs, y: r * Math.sin(a), rot };
  }

  /**
   * Marquee repetition offsets for one block of text.
   *
   * The period is the LINE's own width plus the gap, not the canvas width:
   * that way a short word repeats across the frame and a long line crawls
   * continuously, which is what each case wants. The count is computed from
   * the period rather than hardcoded — a one-character marquee has a period of
   * a few pixels, and a fixed three repetitions would leave visible holes.
   *
   * The range is solved against the ANCHOR, not just the canvas size. The text
   * sits at text.x/text.y, which can be anywhere, so "one repetition to the
   * left of the anchor" only covers the left edge while the phase is small —
   * as the phase approaches a full period that repetition slides off the
   * anchor and the left of the frame goes empty for part of every cycle. That
   * is a stutter that appears once per wrap and only at some positions, which
   * is exactly the kind of thing that gets shipped.
   */
  _scrollOffsets(lineW, blockH, S, anchorX, anchorY) {
    if (this._scrollX === 0 && this._scrollY === 0) return [[0, 0]];
    const gap = (this._scrollGap / 100) * S;
    const wrap = (p, period) => ((p % period) + period) % period;
    const axis = (moving, extent, phase, anchor) => {
      if (!moving) return [0];
      // Floor the period: a zero or sub-pixel period (empty line, no gap) would
      // otherwise ask for thousands of repetitions and hang the frame.
      const period = Math.max(8, extent + gap);
      const off = wrap(phase, period);
      // Repetitions that cover the whole canvas from wherever the anchor is.
      const first = Math.floor((-extent - anchor - off) / period);
      const last  = Math.ceil((S - anchor - off) / period);
      const n = Math.min(64, last - first + 1);
      return Array.from({ length: n }, (_, i) => off + (first + i) * period);
    };
    const xs = axis(this._scrollX !== 0, lineW,  this._scrollPX, anchorX);
    const ys = axis(this._scrollY !== 0, blockH, this._scrollPY, anchorY);
    const out = [];
    for (const ox of xs) for (const oy of ys) out.push([ox, oy]);
    return out;
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

    // ── Per-glyph modifiers ─────────────────────────────────────────────────
    // Glitch, wave and stagger used to be branches of one `else if` chain, so
    // they were mutually exclusive by accident rather than by intent. They are
    // orthogonal — a scrambling line that also staggers in is a legitimate
    // thing to ask for — so each is a modifier that is null when its feature is
    // off. When they are ALL null there is no per-glyph work and the block draw
    // below runs exactly as it always did.
    //
    // ORDER MATTERS, and it is: substitution → placement → transition →
    // displacement. Canvas composes transforms outermost-first, so anything
    // registered before another lands in the outer frame. Placement (added in
    // the next step: paths) therefore goes BEFORE transition deliberately, on
    // two counts: the entrance transforms' Scale anchor is written in linear
    // draw coordinates, which placement keeps valid by mapping those
    // coordinates onto the path, and a FadeUp along a ring then reads as
    // glyphs arriving along the ring instead of the whole ring sliding up.
    const decodeSpread = Math.max(spread, 0.6);
    const substitution =
      this._animMode === 5
        ? (ch, i) => this._glitchChar(ch, i, this._animAmt / 100)
        : isDecode
          // A decode where every glyph settles on the same frame is a cut, not
          // a decode, so this keeps a floor under the spread even at stagger 0.
          ? (ch, i, n) =>
              this._glyphPhase(this._animPhase, i, n, decodeSpread) >= 1
                ? ch
                : this._glitchChar(ch, i, 1)
          : null;

    const displacement =
      this._animMode === 2
        ? (i) => Math.sin(i * 0.5 + this._animTime * this._animSpeed * Math.PI * 2)
                 * (this._animAmt / 100) * fs * 0.4
        : null;

    // Placement maps the glyph's LINEAR draw position onto the path and turns
    // it to face along the curve. It translates so that drawing at the linear
    // coordinates still addresses the glyph — which is what keeps the entrance
    // transforms' anchor arithmetic (written in those coordinates) valid, and
    // is why transition is composed after this rather than before.
    const placement = this._path > 0
      ? (g, lineY, ox) => {
          // The scroll offset is folded into the ARC-LENGTH fraction, not the
          // x position: on a path, scrolling has to move glyphs AROUND the
          // curve. Adding it to x instead would place every repetition at the
          // same angles, drawing them all on top of each other.
          const t  = (g.x - g.x0 + g.adv / 2 + ox) / Math.max(1, g.w);
          const p  = this._pathPoint(t, S);
          // Concentric: a second line sits further out, not on top.
          const cy = py + (lineY - py);
          g.ctx.translate(alignX + p.x, cy + p.y);
          if (!this._pathUpright) g.ctx.rotate(p.rot);
          g.ctx.translate(-(g.x + g.adv / 2), -lineY);
        }
      : null;

    // Audio drives ONE property per glyph, chosen by text.audioTarget. It runs
    // after transition and inside placement, so a glyph on a ring pulses in
    // place rather than being flung off it.
    //
    // Note on Weight: a heavier face is a WIDER face, but the advance always
    // comes from the base font, so glyphs crowd slightly at high amounts.
    // That is the trade for a stable line — an advance that breathed with the
    // level would read as the whole word twitching, not as letters swelling.
    const audio = this._audioTarget > 0
      ? (g, lineY) => {
          const e = this._audioEnv[g.i] ?? 0;
          const amt = this._audioAmt / 100;
          const cx = g.x + g.adv / 2;
          const c = g.ctx;
          switch (this._audioTarget) {
            case 1: { // Scale
              const s = 1 + e * amt * 2.5;
              c.translate(cx, lineY); c.scale(s, s); c.translate(-cx, -lineY);
              break;
            }
            case 2:   // Rise
              c.translate(0, -e * amt * fs * 0.9);
              break;
            case 3:   // Hue — set here and preserved across the outline pass
              c.fillStyle = `hsl(${(this._hue + e * amt * 180) % 360}, `
                          + `${satPct}%, ${lightPct}%)`;
              break;
            case 4: { // Weight
              const w = Math.max(100, Math.min(900,
                Math.round(this._weight + e * amt * 500)));
              const saved = this._weight;
              this._weight = w;
              c.font = this._fontString(fs);
              this._weight = saved;
              break;
            }
            case 5:   // Rotate
              c.translate(cx, lineY);
              c.rotate(e * amt * 1.2);   // ~69 deg at full
              c.translate(-cx, -lineY);
              break;
            case 6:   // Opacity — quiet glyphs dim rather than loud ones brighten
              c.globalAlpha *= (1 - amt) + amt * e;
              break;
          }
        }
      : null;

    const transition = staggered
      ? (g, lineY) => {
          const local = this._glyphPhase(this._animPhase, g.i, g.n, spread);
          this._applyEntranceTransform(
            g.ctx, this._animInMode, local, g.x + g.adv / 2, lineY, k);
        }
      : null;

    const perGlyphActive = !!(substitution || displacement || transition || placement || audio);

    // Marquee repetition offsets, computed once for the block so every line
    // tiles in step. The widest line sets the horizontal period — using each
    // line's own width would let a multi-line ticker shear apart.
    const widest = Math.max(...lines.map(l => ctx.measureText(l).width), 0);
    const offsets = this._scrollOffsets(widest, totalH, S, alignX, py);

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

      for (const [ox, oy] of offsets) {
        const lx = alignX + ox;
        const ly = baseY + oy;

        if (perGlyphActive) {
          this._drawGlyphs(ctx, line, lx, ly, style, (g) => {
            const ch = substitution ? substitution(g.ch, g.i, g.n) : g.ch;
            if (placement)  placement(g, ly, ox);
            if (transition) transition(g, ly);
            if (audio)      audio(g, ly);
            return { ch, dy: displacement ? displacement(g.i) : 0 };
          });
        } else {
          if (this._outline > 0) {
            this._applyOutlineStyle(ctx, satPct, lightPct);
            ctx.lineWidth = this._outline * 2 * k;
            ctx.lineJoin  = 'round';
            ctx.strokeText(line, lx, ly);
            ctx.fillStyle = `hsl(${this._hue}, ${satPct}%, ${lightPct}%)`;
          }
          ctx.fillText(line, lx, ly);
        }
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
