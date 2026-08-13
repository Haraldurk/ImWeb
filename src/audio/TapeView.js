/**
 * The tape, drawn. §4.2's landscape and §8.6's "draw the loop", at the first
 * resolution that is useful: a min/max envelope of the whole tape with the
 * partition layout and the two zone regions marked on it.
 *
 * **This module imports nothing and knows nothing.** Not ParameterSystem, not
 * the engine — it is handed columns and rectangles and it draws them. That is
 * not tidiness: §4.1 keeps the engine ImWeb-free and `AudioBinding` is the one
 * place the halves meet, so a display that reached for `ps` on one side and
 * `engine` on the other would make a second bridge and quietly end the property
 * the whole audio half is built on. The binding fetches; this paints.
 *
 * **Min/max, never an average, and never resampled.** A peak is the thing a
 * performer is looking for — where the transient is, where the recording
 * actually starts — and an average of a column smears exactly that away. Two
 * consequences, both §6 item 6's rule restated: a zoom asks the engine for a new
 * envelope rather than stretching this one, and a column that covers no whole
 * sample draws as a flat line at zero rather than as nothing.
 *
 * Drawing is coalesced onto one animation frame. Dirty notifications arrive at
 * frame cadence already (rule 7), and region params can change several times in
 * a frame under a controller, so painting per event would be several full
 * canvas repaints per frame for one visible result.
 */

/** Region kinds, in draw order — later ones are drawn on top. */
export const REGION_KINDS = Object.freeze(['part', 'rec', 'play']);

const STYLE = {
  bg: '#0a0a0b',
  grid: '#2a2a34',
  wave: '#a6a6c0',
  waveDim: '#4a4a5c',
  part: 'rgba(64, 128, 232, 0.10)',
  partEdge: '#4080e8',
  rec: 'rgba(232, 64, 64, 0.18)',
  recEdge: '#e84040',
  play: 'rgba(64, 200, 120, 0.18)',
  playEdge: '#40c878',
  text: '#a6a6c0',
};

export class TapeView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    /** Envelope columns, interleaved [min, max] per column. */
    this._env = null;
    /** The span the envelope covers, in samples. */
    this._envStart = 0;
    this._envEnd = 0;
    /** The span being VIEWED, in samples. Whole tape for now — zoom is later. */
    this._viewStart = 0;
    this._viewEnd = 0;
    /** Overlay rectangles in SAMPLES: { kind, start, end, label }. */
    this._regions = [];
    this._pending = false;
    this._empty = 'no tape';
    /** Device pixels per CSS pixel, refreshed on every resize. */
    this._dpr = 1;
    this.resize();
  }

  /**
   * Match the backing store to the element's CSS size. Returns the column count
   * a full-width envelope should have — ONE COLUMN PER DEVICE PIXEL, which is
   * the resolution at which min/max is exactly what the screen can show: fewer
   * loses peaks the display could have drawn, more asks the audio thread for
   * detail that cannot be painted.
   */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(1, Math.round(rect.width));
    const h = Math.max(1, Math.round(rect.height));
    this._dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(w * this._dpr);
    const bh = Math.round(h * this._dpr);
    if (this.canvas.width !== bw || this.canvas.height !== bh) {
      this.canvas.width = bw;
      this.canvas.height = bh;
    }
    return bw;
  }

  /** @returns {number} the column count a full-width request should ask for. */
  get columns() { return this.canvas.width; }

  setSpan(start, end) {
    this._viewStart = start;
    this._viewEnd = end;
    this.invalidate();
  }

  /** @param {{start:number,end:number,columns:number,data:Float32Array}} r */
  setEnvelope(r) {
    this._env = r.data;
    this._envStart = r.start;
    this._envEnd = r.end;
    this.invalidate();
  }

  /** Drop the envelope but keep the frame — the tape is gone, the view is not. */
  clearEnvelope(message = 'no tape') {
    this._env = null;
    this._empty = message;
    this.invalidate();
  }

  /**
   * What an empty frame says, without discarding an envelope it may already
   * hold. "No tape", "reading the tape" and "audio off" are three different
   * situations and only one of them is a reason to stop waiting — an engine
   * whose audio callback never runs (no output device) sits in the second one
   * forever, and saying "no tape" there sends the reader after the wrong fault.
   */
  setEmptyMessage(message) {
    if (this._empty === message) return;
    this._empty = message;
    if (!this._env) this.invalidate();
  }

  /** @param {{kind:string,start:number,end:number,label?:string}[]} regions */
  setRegions(regions) {
    this._regions = regions;
    this.invalidate();
  }

  invalidate() {
    if (this._pending) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.draw(); });
  }

  /** Sample position → device-pixel x, against the VIEW span. */
  _x(sample) {
    const span = this._viewEnd - this._viewStart;
    if (!(span > 0)) return 0;
    return ((sample - this._viewStart) / span) * this.canvas.width;
  }

  draw() {
    const { ctx } = this;
    const w = this.canvas.width, h = this.canvas.height;
    ctx.fillStyle = STYLE.bg;
    ctx.fillRect(0, 0, w, h);

    // Partitions under the waveform, zones over it: the layout is the ground the
    // material sits on, and a region is a thing you are doing TO that material.
    for (const r of this._regions) if (r.kind === 'part') this._fill(r, STYLE.part, STYLE.partEdge);

    if (this._env) this._drawEnvelope();
    else {
      ctx.fillStyle = STYLE.text;
      ctx.font = `${Math.round(11 * this._dpr)}px "IBM Plex Mono", monospace`;
      ctx.fillText(this._empty, 8 * this._dpr, h / 2);
    }

    // Zero line last among the ground layers, so it reads through the waveform.
    ctx.strokeStyle = STYLE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, Math.round(h / 2) + 0.5);
    ctx.lineTo(w, Math.round(h / 2) + 0.5);
    ctx.stroke();

    for (const r of this._regions) {
      if (r.kind === 'rec') this._fill(r, STYLE.rec, STYLE.recEdge);
      else if (r.kind === 'play') this._fill(r, STYLE.play, STYLE.playEdge);
    }
  }

  _drawEnvelope() {
    const { ctx } = this;
    const h = this.canvas.height;
    const mid = h / 2;
    const cols = this._env.length / 2;
    const span = this._envEnd - this._envStart;
    if (!(span > 0) || !cols) return;
    ctx.fillStyle = STYLE.wave;
    for (let c = 0; c < cols; c++) {
      const lo = this._env[c * 2], hi = this._env[c * 2 + 1];
      // The envelope's own span may differ from the view's — a reply can arrive
      // for a span the user has already left — so columns are placed by SAMPLE
      // POSITION rather than by index. A stale envelope then draws in the right
      // place at the wrong resolution instead of in the wrong place.
      const x0 = this._x(this._envStart + (c * span) / cols);
      const x1 = this._x(this._envStart + ((c + 1) * span) / cols);
      const wpx = Math.max(1, x1 - x0);
      const yTop = mid - hi * mid;
      const yBot = mid - lo * mid;
      // A silent column is a hairline, not nothing: "there is tape here and it
      // is silent" and "there is no tape here" must not look the same.
      ctx.fillRect(x0, yTop, wpx, Math.max(1, yBot - yTop));
    }
  }

  _fill(r, fill, edge) {
    const { ctx } = this;
    const h = this.canvas.height;
    const x0 = this._x(r.start);
    const x1 = this._x(r.end);
    const w = Math.max(1, x1 - x0);
    ctx.fillStyle = fill;
    ctx.fillRect(x0, 0, w, h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x0) + 0.5, 0);
    ctx.lineTo(Math.round(x0) + 0.5, h);
    ctx.moveTo(Math.round(x1) - 0.5, 0);
    ctx.lineTo(Math.round(x1) - 0.5, h);
    ctx.stroke();
    if (r.label) {
      ctx.fillStyle = edge;
      ctx.font = `${Math.round(9 * this._dpr)}px "IBM Plex Mono", monospace`;
      ctx.fillText(r.label, x0 + 3 * this._dpr, 10 * this._dpr);
    }
  }
}
