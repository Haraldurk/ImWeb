/**
 * GestureArbitrator — mode-based touch grammar for the output canvas.
 *
 * Routes touch/pen pointer gestures by active pointer count and the
 * user-selectable `touch.mode` SELECT param (Camera / Pad / Locked):
 *
 *   mode 0 Camera — 1 finger: orbit (scene3d.rot.x/y), 2 fingers: pinch
 *                   zoom (scene3d.scale; absorbs the former main.js
 *                   always-on pinch block)
 *   mode 1 Pad    — 1 finger (or 2-finger centroid): normalized canvas
 *                   X/Y fed into ControllerManager.mouse, driving every
 *                   param with a mouse-x / mouse-y controller assigned
 *   mode 2 Locked — all touch ignored
 *
 * 3+ fingers = null-zone clutch: all gesture output suspends and stays
 * suspended until every finger lifts (fresh gesture required). Nothing is
 * ever bound to 3+ fingers so an OS-claimed gesture (iOS three-finger
 * undo/redo) can never corrupt state. Scroll/system-gesture suppression is
 * touch-action:none ONLY — preventDefault on touchmove makes iOS WebKit
 * stop synthesizing pointermove for that touch (learned the hard way).
 *
 * A 2-finger double-tap (≤300ms taps, ≤12px travel, ≤300ms apart) fires
 * the onDoubleTap2 hook — wired to the fullscreen toggle in main.js.
 *
 * Mouse pointers are ignored entirely — the desktop mouse grammar
 * (mouse-x/y controllers in ControllerManager) is untouched.
 */

const MODE_CAMERA = 0;
const MODE_PAD = 1;
const MODE_LOCKED = 2;

const ORBIT_DEG_PER_PX = 0.35;
const TAP_MAX_MS = 300;     // max contact duration to count as a tap
const TAP_SLOP_PX = 12;     // max finger travel to count as a tap
const DOUBLE_TAP_MS = 300;  // window between two taps

export class GestureArbitrator {
  constructor(canvas, ps, cm, opts = {}) {
    this.canvas = canvas;
    this.ps = ps;
    this.cm = cm;
    this.onDoubleTap2 = opts.onDoubleTap2 ?? null; // 2-finger double-tap hook

    this._pointers = new Map(); // pointerId → {x, y, sx, sy}
    this._suspended = false;    // 3+ finger null zone latch

    // Tap detection (2-finger double-tap → onDoubleTap2)
    this._gestureT0 = 0;        // gesture start (first finger down)
    this._gestureMaxCount = 0;  // max simultaneous pointers this gesture
    this._gestureMoved = false; // any finger travelled > TAP_SLOP_PX
    this._lastTap2At = 0;       // end time of the previous 2-finger tap

    // Gesture baselines (captured whenever the pointer count changes)
    this._baseRotX = 0;
    this._baseRotY = 0;
    this._startCX = 0;          // gesture-start centroid
    this._startCY = 0;
    this._pinchBaseDist = 0;
    this._pinchBaseScale = 0;

    this._onDown = (e) => this._pointerDown(e);
    this._onMove = (e) => this._pointerMove(e);
    this._onEnd = (e) => this._pointerEnd(e);

    // Scroll/system-gesture prevention is CSS-only (touch-action: none) —
    // enforced inline here so the arbitrator works regardless of stylesheet.
    // Do NOT preventDefault touchstart/touchmove: iOS WebKit stops
    // synthesizing pointermove events for touches whose touchmove is
    // cancelled, which blinds the arbitrator to 1-finger motion.
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onEnd);
    canvas.addEventListener('pointercancel', this._onEnd);
  }

  get _mode() {
    return this.ps.get('touch.mode')?.value ?? MODE_LOCKED;
  }

  _centroid() {
    let cx = 0, cy = 0;
    for (const p of this._pointers.values()) { cx += p.x; cy += p.y; }
    const n = this._pointers.size || 1;
    return [cx / n, cy / n];
  }

  /** Capture fresh baselines for the current pointer configuration so
   *  finger count changes never cause value jumps. */
  _rebaseline() {
    [this._startCX, this._startCY] = this._centroid();
    this._baseRotX = this.ps.get('scene3d.rot.x')?.value ?? 0;
    this._baseRotY = this.ps.get('scene3d.rot.y')?.value ?? 0;
    if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._pinchBaseDist = Math.hypot(a.x - b.x, a.y - b.y);
      this._pinchBaseScale = this.ps.get('scene3d.scale')?.value ?? 1;
    } else {
      this._pinchBaseDist = 0;
    }
  }

  _pointerDown(e) {
    if (e.pointerType === 'mouse') return;
    if (this._mode === MODE_LOCKED) return;
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    if (this._pointers.size === 0) {
      this._gestureT0 = performance.now();
      this._gestureMaxCount = 0;
      this._gestureMoved = false;
    }
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this._gestureMaxCount = Math.max(this._gestureMaxCount, this._pointers.size);
    if (this._pointers.size >= 3) this._suspended = true; // null-zone clutch
    this._rebaseline();
  }

  _pointerMove(e) {
    const rec = this._pointers.get(e.pointerId);
    if (!rec) return;
    rec.x = e.clientX;
    rec.y = e.clientY;
    if (Math.hypot(rec.x - rec.sx, rec.y - rec.sy) > TAP_SLOP_PX) this._gestureMoved = true;
    if (this._suspended) return;

    const mode = this._mode;
    if (mode === MODE_CAMERA) this._driveCamera();
    else if (mode === MODE_PAD) this._drivePad();
  }

  _pointerEnd(e) {
    if (!this._pointers.has(e.pointerId)) return;
    this._pointers.delete(e.pointerId);
    // Null zone releases only when ALL fingers lift — a fresh gesture is
    // required after a 3+ finger contact
    if (this._pointers.size === 0) {
      this._suspended = false;
      this._evalTap();
    } else if (!this._suspended) {
      this._rebaseline();
    }
  }

  /** Gesture just ended (all fingers up) — was it a 2-finger tap, and if so
   *  the second within the double-tap window? */
  _evalTap() {
    const now = performance.now();
    const isTap2 =
      this._gestureMaxCount === 2 &&
      !this._gestureMoved &&
      now - this._gestureT0 <= TAP_MAX_MS;
    if (!isTap2) { this._lastTap2At = 0; return; }
    if (now - this._lastTap2At <= DOUBLE_TAP_MS) {
      this._lastTap2At = 0; // consume — a third tap starts fresh
      this.onDoubleTap2?.();
    } else {
      this._lastTap2At = now;
    }
  }

  // ── Camera mode ──────────────────────────────────────────────────────────

  _driveCamera() {
    const n = this._pointers.size;
    if (n === 1) {
      const [cx, cy] = this._centroid();
      this.ps.set('scene3d.rot.y', this._baseRotY + (cx - this._startCX) * ORBIT_DEG_PER_PX);
      this.ps.set('scene3d.rot.x', this._baseRotX + (cy - this._startCY) * ORBIT_DEG_PER_PX);
    } else if (n === 2 && this._pinchBaseDist > 0) {
      const [a, b] = [...this._pointers.values()];
      const ratio = Math.hypot(a.x - b.x, a.y - b.y) / this._pinchBaseDist;
      this.ps.set('scene3d.scale',
        Math.max(0.01, Math.min(50, this._pinchBaseScale * ratio)));
    }
  }

  // ── Performance Pad mode ─────────────────────────────────────────────────

  _drivePad() {
    const r = this.canvas.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const [cx, cy] = this._centroid();
    const nx = Math.max(0, Math.min(1, (cx - r.left) / r.width));
    const ny = Math.max(0, Math.min(1, 1 - (cy - r.top) / r.height)); // y=0 at bottom (ImOs9)

    // Same channel + drive loop as ControllerManager._initMouse so every
    // mouse-x / mouse-y assignment is touch-performable
    this.cm.mouse.x = nx;
    this.cm.mouse.y = ny;
    this.ps.getAll().forEach((p) => {
      if (!p.controller) return;
      const { type, modifiers } = p.controller;
      if (!this.cm._checkModifiers(modifiers)) return;
      if (type === 'mouse-x') p.setNormalized(nx);
      if (type === 'mouse-y') p.setNormalized(ny);
    });
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onEnd);
    this.canvas.removeEventListener('pointercancel', this._onEnd);
    this._pointers.clear();
  }
}
