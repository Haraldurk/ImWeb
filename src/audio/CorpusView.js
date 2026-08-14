/**
 * The corpus pad (§4.6) — the grain cloud, and a cursor you drag through it.
 *
 * **Imports nothing**, like `TapeView` beside it, and for the same reason: it
 * paints what it is handed and reports where it was touched. It knows nothing
 * about the audio engine, the parameter system, or what the axes mean — the
 * index does the naming and `AudioBinding` does the fetching.
 *
 * §4.6 says navigating a descriptor space is a drawing gesture, and this is
 * where that either becomes true or stays a claim. It is a separate widget from
 * the draw surface deliberately: §4.6's own note is that descriptor space is
 * NOT the image plane, that (0.3, 0.7) here means "bright and quiet" and has no
 * relationship to the pixel at (0.3, 0.7), and that sharing one WIDGET would
 * invite exactly the coincidence it warns against. They share a gesture, which
 * is the part that was ever the point.
 */
export class CorpusView {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    /** Called with (x, y) in 0..1 as the pointer moves. */
    this.onNavigate = null;
    this.index = null;
    this.cursor = { x: 0.5, y: 0.5, on: false };
    this.labels = { x: '', y: '' };
    this._dpr = 1;
    this._dragging = false;

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this._dragging = true;
      // NAVIGATE FIRST, capture second, and the order is the whole point.
      // `setPointerCapture` throws for any pointer id the browser does not have
      // active — a synthetic event, a pointer already released, an id from a
      // device that has gone away — and with the capture first that throw
      // propagates out of the handler before the gesture is ever read. The pad
      // then looks completely dead while every other control still works.
      // Capture only buys tracking outside the element's bounds; losing it
      // costs a drag that stops at the edge, not a pad that does nothing.
      this._point(e);
      try { canvas.setPointerCapture(e.pointerId); } catch { /* not required */ }
    });
    canvas.addEventListener('pointermove', (e) => { if (this._dragging) this._point(e); });
    const up = (e) => {
      this._dragging = false;
      try { canvas.releasePointerCapture(e.pointerId); } catch { /* already gone */ }
    };
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
  }

  _point(e) {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
    // Screen y runs down and the axis runs up: a louder grain belongs at the
    // TOP of the pad, which is where a hand expects to find it.
    const y = Math.min(1, Math.max(0, 1 - (e.clientY - r.top) / r.height));
    this.cursor.x = x;
    this.cursor.y = y;
    this.cursor.on = true;
    this.onNavigate?.(x, y);
    this.draw();
  }

  setIndex(index, xLabel, yLabel) {
    this.index = index;
    this.labels = { x: xLabel, y: yLabel };
    this.draw();
  }

  setCursor(x, y) {
    // Ignored mid-drag: the hand is authoritative while it is down, and a
    // parameter echo arriving a frame later would otherwise fight it.
    if (this._dragging) return;
    this.cursor.x = x;
    this.cursor.y = y;
    this.draw();
  }

  /** Size the backing store to the element. Cheap, and idempotent. */
  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this._dpr = dpr;
  }

  draw() {
    this._resize();
    const g = this.ctx;
    const { width: w, height: h } = this.canvas;
    if (!w || !h) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#0a0a0a';
    g.fillRect(0, 0, w, h);

    g.strokeStyle = 'rgba(255,255,255,0.06)';
    g.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const t = (i / 4) * w;
      const u = (i / 4) * h;
      g.beginPath(); g.moveTo(t, 0); g.lineTo(t, h); g.stroke();
      g.beginPath(); g.moveTo(0, u); g.lineTo(w, u); g.stroke();
    }

    const idx = this.index;
    if (idx && idx.count) {
      // One pass, one fill style. A corpus is up to 16384 points and this
      // repaints on every pointer move, so per-point state changes on the 2D
      // context are the whole cost — a fillRect per grain is fine, a
      // save/restore or a colour change per grain is not.
      g.fillStyle = 'rgba(255, 209, 102, 0.55)';
      const s = Math.max(1.5, 2 * this._dpr);
      for (let i = 0; i < idx.count; i++) {
        g.fillRect(idx.x[i] * w - s / 2, (1 - idx.y[i]) * h - s / 2, s, s);
      }
    } else {
      g.fillStyle = 'rgba(255,255,255,0.35)';
      g.font = `${12 * this._dpr}px monospace`;
      g.textAlign = 'center';
      g.fillText('no corpus — press Analyse', w / 2, h / 2);
    }

    const cx = this.cursor.x * w;
    const cy = (1 - this.cursor.y) * h;
    g.strokeStyle = 'rgba(255,255,255,0.28)';
    g.beginPath(); g.moveTo(cx, 0); g.lineTo(cx, h); g.stroke();
    g.beginPath(); g.moveTo(0, cy); g.lineTo(w, cy); g.stroke();
    g.strokeStyle = '#ffd166';
    g.lineWidth = 1.5 * this._dpr;
    g.beginPath();
    g.arc(cx, cy, 5 * this._dpr, 0, Math.PI * 2);
    g.stroke();

    if (this.labels.x || this.labels.y) {
      g.fillStyle = 'rgba(255,255,255,0.4)';
      g.font = `${10 * this._dpr}px monospace`;
      g.textAlign = 'right';
      g.fillText(this.labels.x, w - 4 * this._dpr, h - 4 * this._dpr);
      g.textAlign = 'left';
      g.save();
      g.translate(4 * this._dpr, 4 * this._dpr);
      g.textBaseline = 'top';
      g.fillText(this.labels.y, 0, 0);
      g.restore();
    }
  }
}
