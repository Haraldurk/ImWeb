/**
 * ImWeb TableManager — Response Curves
 *
 * A "table" maps controller input (0–1) to parameter output (0–1) through
 * a custom drawn curve. Tables are stored as 256-point float arrays.
 *
 * Built-in curves: linear, log, exp, s-curve, step, invert, gate
 * User curves: editable via the Tables tab canvas, persisted to IndexedDB
 *
 * Usage:
 *   tableManager.get('s-curve').apply(0.3) → mapped value
 *   param.table = 's-curve'  (set via context menu)
 *   ParameterSystem.setNormalized() automatically applies param.table
 */

const DB_STORE = 'tables';
const N        = 16384; // High resolution LUT (matches ImOs9 specification)

// ── ResponseCurve ─────────────────────────────────────────────────────────────

export class ResponseCurve {
  constructor(points, controlPoints = null) {
    // points: Float32Array or regular Array of N values in [0,1]
    this.points = Float32Array.from(points);
    // controlPoints: Bézier anchor array (stored for editor round-trips), or null
    this.controlPoints = controlPoints ? JSON.parse(JSON.stringify(controlPoints)) : null;
  }

  /** Map input 0..1 to output 0..1 via LUT with linear interpolation. */
  apply(n) {
    const clamped = Math.max(0, Math.min(1, n));
    const findex  = clamped * (N - 1);
    const i0      = Math.floor(findex);
    const i1      = Math.min(i0 + 1, N - 1);
    const t       = findex - i0;
    return this.points[i0] + (this.points[i1] - this.points[i0]) * t;
  }

  clone() { return new ResponseCurve(this.points, this.controlPoints); }

  // ── Bézier factory ────────────────────────────────────────────────────────

  /** Create a ResponseCurve by baking cubic Bézier anchor points to a 16k LUT. */
  static fromBezier(anchors) {
    return new ResponseCurve(ResponseCurve._bake(anchors), anchors);
  }

  /** Two-point linear anchor set (identity mapping). */
  static linearAnchors() {
    return [
      { x: 0, y: 0, rx: 1/3, ry: 1/3, smooth: true },
      { x: 1, y: 1, lx: 2/3, ly: 2/3, smooth: true },
    ];
  }

  // ── Internal baking ───────────────────────────────────────────────────────

  static _bake(anchors) {
    const sorted = [...anchors].sort((a, b) => a.x - b.x);
    const pts = new Float32Array(N);
    for (let i = 0; i < N; i++) pts[i] = ResponseCurve._sampleAt(sorted, i / (N - 1));
    return pts;
  }

  static _sampleAt(anchors, x) {
    if (anchors.length < 2) return 0;
    if (x <= anchors[0].x) return Math.max(0, Math.min(1, anchors[0].y));
    const last = anchors[anchors.length - 1];
    if (x >= last.x) return Math.max(0, Math.min(1, last.y));

    // Find segment containing x
    let si = 0;
    for (let i = 0; i < anchors.length - 1; i++) {
      if (x < anchors[i + 1].x) { si = i; break; }
    }

    const a0 = anchors[si], a1 = anchors[si + 1];
    const span = a1.x - a0.x;
    if (span <= 0) return Math.max(0, Math.min(1, a0.y));

    // Cubic Bézier control points (absolute coords)
    const p0x = a0.x,  p0y = a0.y;
    const p1x = a0.rx ?? (a0.x + span / 3), p1y = a0.ry ?? a0.y;
    const p2x = a1.lx ?? (a1.x - span / 3), p2y = a1.ly ?? a1.y;
    const p3x = a1.x,  p3y = a1.y;

    // Binary search for t such that Bx(t) = x
    let lo = 0, hi = 1, t = (x - p0x) / span;
    for (let iter = 0; iter < 24; iter++) {
      const bx = ResponseCurve._bez(t, p0x, p1x, p2x, p3x);
      if (Math.abs(bx - x) < 1e-7) break;
      if (bx < x) lo = t; else hi = t;
      t = (lo + hi) * 0.5;
    }

    return Math.max(0, Math.min(1, ResponseCurve._bez(t, p0y, p1y, p2y, p3y)));
  }

  static _bez(t, p0, p1, p2, p3) {
    const m = 1 - t;
    return m*m*m*p0 + 3*m*m*t*p1 + 3*m*t*t*p2 + t*t*t*p3;
  }
}

// ── Built-in curve definitions ────────────────────────────────────────────────

const BUILTINS = {
  linear:   i => i / (N - 1),
  log:      i => Math.pow(i / (N - 1), 0.35),
  exp:      i => Math.pow(i / (N - 1), 2.8),
  'S-curve':i => { const x = i / (N - 1); return x < 0.5 ? 2*x*x : 1 - Math.pow(-2*x+2,2)/2; },
  step:     i => i < (N / 2) ? 0 : 1,
  invert:   i => 1 - i / (N - 1),
  gate:     i => { const x = i / (N - 1); return (x > 0.15 && x < 0.85) ? 1 : 0; },
};

function makeBuiltin(fn) {
  return new ResponseCurve(Array.from({ length: N }, (_, i) => fn(i)));
}

// ── TableManager ─────────────────────────────────────────────────────────────

export class TableManager extends EventTarget {
  constructor() {
    super();
    this.tables  = new Map();  // name → ResponseCurve
    this.builtins = new Set(); // names that ship with the app (not deletable)
    this._db = null;

    // Register built-ins
    for (const [name, fn] of Object.entries(BUILTINS)) {
      this.tables.set(name, makeBuiltin(fn));
      this.builtins.add(name);
    }
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  get(name)      { return this.tables.get(name) ?? null; }
  has(name)      { return this.tables.has(name); }
  isBuiltin(name){ return this.builtins.has(name); }

  getNames() {
    const builtinNames = [...this.builtins];
    const userNames    = [...this.tables.keys()].filter(n => !this.builtins.has(n));
    return [...builtinNames, ...userNames];
  }

  // ── Mutate ────────────────────────────────────────────────────────────────

  /** Save or overwrite a curve. Fires 'change'. Persists to IDB if name is user-defined. */
  set(name, curve) {
    this.tables.set(name, curve instanceof ResponseCurve ? curve : new ResponseCurve(curve));
    this._dispatchChange();
    if (!this.builtins.has(name)) this._persist(name);
  }

  delete(name) {
    if (this.builtins.has(name)) return; // cannot delete built-ins
    this.tables.delete(name);
    this._dispatchChange();
    this._idbDelete(name);
  }

  _dispatchChange() {
    this.dispatchEvent(new CustomEvent('change'));
  }

  // ── IndexedDB persistence ─────────────────────────────────────────────────

  async init(db) {
    this._db = db;
    // Load all user tables from IDB
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(DB_STORE, 'readonly');
      const store = tx.objectStore(DB_STORE);
      const req   = store.getAll();
      req.onsuccess = () => {
        (req.result ?? []).forEach(({ name, points, controlPoints }) => {
          if (!this.builtins.has(name)) {
            this.tables.set(name, new ResponseCurve(points, controlPoints ?? null));
          }
        });
        resolve();
      };
      req.onerror = reject;
    });
  }

  _persist(name) {
    if (!this._db) return;
    const curve = this.tables.get(name);
    if (!curve) return;
    const tx = this._db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).put({
      name,
      points:        Array.from(curve.points),
      controlPoints: curve.controlPoints ?? null,
    });
  }

  _idbDelete(name) {
    if (!this._db) return;
    const tx = this._db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(name);
  }
}

export const tableManager = new TableManager();
