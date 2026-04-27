/**
 * ColorPicker — Figma-style HSV color picker
 *
 * h: 0–360 (hue degrees)
 * s: 0–100 (saturation %)
 * v: 0–100 (value / brightness %)
 *
 * Usage:
 *   const picker = new ColorPicker(containerEl, {
 *     h: 0, s: 100, v: 100,
 *     onChange: (h, s, v) => { ... }
 *   });
 *   picker.setHSV(h, s, v);   // external update (from ps / preset load)
 *   const { h, s, v } = picker.getHSV();
 */

export class ColorPicker {
  constructor(container, { h = 0, s = 100, v = 100, onChange = null } = {}) {
    this._h = Math.max(0, Math.min(360, +h || 0));
    this._s = Math.max(0, Math.min(100, +s || 0));
    this._v = Math.max(0, Math.min(100, +v || 0));
    this._cb = onChange;
    this._dragging = null; // 'sv' | 'hue' | null
    this._build(container);
    // Defer first render so CSS layout has run and offsetWidth is valid
    requestAnimationFrame(() => this._render());
  }

  /** Update picker state without firing onChange (used by external sync). */
  setHSV(h, s, v) {
    this._h = Math.max(0, Math.min(360, +h || 0));
    this._s = Math.max(0, Math.min(100, +s || 0));
    this._v = Math.max(0, Math.min(100, +v || 0));
    this._syncInputs();
    this._render();
  }

  getHSV() { return { h: this._h, s: this._s, v: this._v }; }

  // ── Build DOM ──────────────────────────────────────────────────────────────

  _build(container) {
    // SV gradient box
    this._svCv = document.createElement('canvas');
    this._svCv.className = 'cp-sv';
    container.appendChild(this._svCv);

    // Hue bar
    this._hueCv = document.createElement('canvas');
    this._hueCv.className = 'cp-hue';
    container.appendChild(this._hueCv);

    // H / S / V number inputs
    const inputRow = document.createElement('div');
    inputRow.className = 'cp-inputs';
    this._hInp = this._mkInput(inputRow, 'H', 0, 360, () => this._h, v => { this._h = v; });
    this._sInp = this._mkInput(inputRow, 'S', 0, 100, () => this._s, v => { this._s = v; });
    this._vInp = this._mkInput(inputRow, 'V', 0, 100, () => this._v, v => { this._v = v; });
    container.appendChild(inputRow);

    // ── SV box interaction ────────────────────────────────────────────────────
    const svDrag = (e) => {
      const r = this._svCv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      this._s = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width)  * 100));
      this._v = Math.max(0, Math.min(100, (1 - (e.clientY - r.top) / r.height) * 100));
      this._render();
      this._syncInputs();
      this._emit();
    };
    this._svCv.addEventListener('pointerdown', e => {
      this._dragging = 'sv';
      this._svCv.setPointerCapture(e.pointerId);
      svDrag(e);
    });
    this._svCv.addEventListener('pointermove', e => {
      if (this._dragging === 'sv') svDrag(e);
    });
    this._svCv.addEventListener('pointerup', () => { this._dragging = null; });
    this._svCv.addEventListener('pointercancel', () => { this._dragging = null; });

    // ── Hue bar interaction ────────────────────────────────────────────────────
    const hueDrag = (e) => {
      const r = this._hueCv.getBoundingClientRect();
      if (!r.width) return;
      this._h = Math.max(0, Math.min(360, ((e.clientX - r.left) / r.width) * 360));
      this._render();
      this._syncInputs();
      this._emit();
    };
    this._hueCv.addEventListener('pointerdown', e => {
      this._dragging = 'hue';
      this._hueCv.setPointerCapture(e.pointerId);
      hueDrag(e);
    });
    this._hueCv.addEventListener('pointermove', e => {
      if (this._dragging === 'hue') hueDrag(e);
    });
    this._hueCv.addEventListener('pointerup', () => { this._dragging = null; });
    this._hueCv.addEventListener('pointercancel', () => { this._dragging = null; });

    // Re-render when the container resizes (panel open/close, window resize)
    const ro = new ResizeObserver(() => this._render());
    ro.observe(container);
  }

  _mkInput(row, label, min, max, get, set) {
    const g = document.createElement('div');
    g.className = 'cp-input-group';
    const l = document.createElement('label');
    l.textContent = label;
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.min = min;
    inp.max = max;
    inp.step = 1;
    inp.value = Math.round(get());
    inp.addEventListener('change', () => {
      let n = parseFloat(inp.value);
      if (isNaN(n)) { inp.value = Math.round(get()); return; }
      n = Math.max(min, Math.min(max, n));
      set(n);
      this._render();
      this._syncInputs();
      this._emit();
    });
    g.append(l, inp);
    row.appendChild(g);
    return inp;
  }

  // ── State helpers ──────────────────────────────────────────────────────────

  _syncInputs() {
    this._hInp.value = Math.round(this._h);
    this._sInp.value = Math.round(this._s);
    this._vInp.value = Math.round(this._v);
  }

  _emit() {
    if (this._cb) this._cb(this._h, this._s, this._v);
  }

  // ── Rendering ──────────────────────────────────────────────────────────────

  _render() {
    this._drawSV();
    this._drawHue();
  }

  _drawSV() {
    const cv = this._svCv;
    const W = cv.offsetWidth  || 192;
    const H = cv.offsetHeight || 128;
    // Only resize buffer when dimensions change (avoids flicker)
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d');

    // 1. Fill with pure hue
    ctx.fillStyle = `hsl(${this._h},100%,50%)`;
    ctx.fillRect(0, 0, W, H);

    // 2. White → transparent (left = white / desaturated, right = full hue)
    const wg = ctx.createLinearGradient(0, 0, W, 0);
    wg.addColorStop(0, 'rgba(255,255,255,1)');
    wg.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = wg;
    ctx.fillRect(0, 0, W, H);

    // 3. Transparent → black (top = bright, bottom = dark)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, 'rgba(0,0,0,0)');
    bg.addColorStop(1, 'rgba(0,0,0,1)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // 4. Crosshair at current (s, v) position
    const cx = (this._s / 100) * W;
    const cy = (1 - this._v / 100) * H;

    // Outer dark ring
    ctx.beginPath();
    ctx.arc(cx, cy, 7, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Inner white ring
    ctx.beginPath();
    ctx.arc(cx, cy, 5.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  _drawHue() {
    const cv = this._hueCv;
    const W = cv.offsetWidth  || 192;
    const H = cv.offsetHeight || 14;
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext('2d');

    // Full-spectrum rainbow
    const grad = ctx.createLinearGradient(0, 0, W, 0);
    for (let i = 0; i <= 6; i++) grad.addColorStop(i / 6, `hsl(${i * 60},100%,50%)`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Indicator: shadow line + white line
    const x = Math.round((this._h / 360) * W);
    ctx.strokeStyle = 'rgba(0,0,0,0.55)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,255,255,0.88)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
}
