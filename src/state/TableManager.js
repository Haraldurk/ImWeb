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
  constructor(points) {
    // points: Float32Array or regular Array of N values in [0,1]
    this.points = Float32Array.from(points);
  }

  /** Map input 0..1 to output 0..1 via LUT with linear interpolation. */
  apply(n) {
    const findex = n * (N - 1);
    const i0     = Math.floor(findex);
    const i1     = Math.min(i0 + 1, N - 1);
    const t      = findex - i0;
    return this.points[i0] + (this.points[i1] - this.points[i0]) * t;
  }

  clone() { return new ResponseCurve(this.points); }
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
        (req.result ?? []).forEach(({ name, points }) => {
          if (!this.builtins.has(name)) {
            this.tables.set(name, new ResponseCurve(points));
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
    tx.objectStore(DB_STORE).put({ name, points: Array.from(curve.points) });
  }

  _idbDelete(name) {
    if (!this._db) return;
    const tx = this._db.transaction(DB_STORE, 'readwrite');
    tx.objectStore(DB_STORE).delete(name);
  }
}

export const tableManager = new TableManager();
