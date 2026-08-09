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
 * suspended until every finger lifts (fresh gesture required), with the
 * camera values restored to their pre-gesture snapshot so nothing drifts.
 * The only 3-finger binding is a quick TAP (≤300ms, no travel), which
 * cycles touch.mode and reports the new label via onModeCycled — a held
 * or OS-claimed 3-finger gesture still does nothing. Scroll/system-gesture
 * suppression is touch-action:none ONLY — preventDefault on touchmove makes
 * iOS WebKit stop synthesizing pointermove for that touch (learned the
 * hard way).
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
const COAST_FRICTION = 0.92;   // velocity multiplier per 60Hz frame
const COAST_MIN_V = 2;         // deg/s — below this, coasting stops
const FLICK_MAX_AGE_MS = 80;   // finger held still longer than this → no coast

export class GestureArbitrator {
  constructor(canvas, ps, cm, opts = {}) {
    this.canvas = canvas;
    this.ps = ps;
    this.cm = cm;
    this.onDoubleTap2 = opts.onDoubleTap2 ?? null; // 2-finger double-tap hook
    this.onModeCycled = opts.onModeCycled ?? null; // 3-finger tap OSD hook
    this.onPadDrive = opts.onPadDrive ?? null;     // (x, y) canvas fractions, screen-space
    this.onPadRelease = opts.onPadRelease ?? null; // all fingers lifted in Pad mode
    this.sm = opts.sceneManager ?? null; // for spin→rot handover on grab

    this._pointers = new Map(); // pointerId → {x, y, sx, sy}
    this._suspended = false;    // 3+ finger null zone latch

    // Tap detection (2-finger double-tap → onDoubleTap2)
    this._gestureT0 = 0;        // gesture start (first finger down)
    this._gestureMaxCount = 0;  // max simultaneous pointers this gesture
    this._gestureMoved = false; // any finger travelled > TAP_SLOP_PX
    this._lastTap2At = 0;       // end time of the previous 2-finger tap

    // Orbit inertia — drag velocity sampled during 1-finger orbit, handed
    // to tick() on release, damped by COAST_FRICTION each frame
    this._dragVX = 0;  this._dragVY = 0;   // live gesture velocity (deg/s)
    this._coastVX = 0; this._coastVY = 0;  // coasting velocity (deg/s)
    this._lastMoveT = 0;                    // timestamp of last orbit move
    this._lastCX = 0;  this._lastCY = 0;    // centroid at last orbit move

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
    this._dragVX = 0;
    this._dragVY = 0;
    this._lastMoveT = 0; // stale velocity samples never leak across configs
    if (this._pointers.size === 2) {
      const [a, b] = [...this._pointers.values()];
      this._pinchBaseDist = Math.hypot(a.x - b.x, a.y - b.y);
      this._pinchBaseScale = this.ps.get('scene3d.scale')?.value ?? 1;
    } else {
      this._pinchBaseDist = 0;
    }
  }

  /** Grab takes control: if auto-spin is running, SceneManager ignores the
   *  rot params entirely (spin accumulates on the mesh instead), so orbit
   *  writes would be invisible. On grab, freeze the current mesh pose into
   *  the rot params (wrapped to the 0–360 param range — no jump) and zero
   *  the spins. */
  _grabSpinControl() {
    const spinning =
      (this.ps.get('scene3d.spin.x')?.value ?? 0) !== 0 ||
      (this.ps.get('scene3d.spin.y')?.value ?? 0) !== 0 ||
      (this.ps.get('scene3d.spin.z')?.value ?? 0) !== 0;
    if (!spinning) return;
    const mesh = this.sm?.mesh;
    if (mesh) {
      // Degrees only — scene3d.rot.* are declared circular, so ps.set folds them.
      const deg = (rad) => (rad * 180) / Math.PI;
      this.ps.set('scene3d.rot.x', deg(mesh.rotation.x));
      this.ps.set('scene3d.rot.y', deg(mesh.rotation.y));
      this.ps.set('scene3d.rot.z', deg(mesh.rotation.z));
    }
    this.ps.set('scene3d.spin.x', 0);
    this.ps.set('scene3d.spin.y', 0);
    this.ps.set('scene3d.spin.z', 0);
  }

  _pointerDown(e) {
    if (e.pointerType === 'mouse') return;
    // Locked mode still TRACKS pointers (taps must work so 3-finger
    // mode-cycle can unlock) — it just never drives params: _pointerMove
    // routes only for Camera/Pad.
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* pointer already released */ }
    // Tactile clutch: touching the canvas while coasting kills the inertia
    // instantly — the finger owns the rotation again
    this._coastVX = 0;
    this._coastVY = 0;
    if (this._pointers.size === 0) {
      this._gestureT0 = performance.now();
      this._gestureMaxCount = 0;
      this._gestureMoved = false;
      if (this._mode === MODE_CAMERA) this._grabSpinControl();
      // Snapshot camera values so a 3-finger tap can undo the micro-drive
      // from the first fingers landing a few ms apart
      this._gestureStartVals = {
        rotX: this.ps.get('scene3d.rot.x')?.value,
        rotY: this.ps.get('scene3d.rot.y')?.value,
        scale: this.ps.get('scene3d.scale')?.value,
      };
    }
    this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    this._gestureMaxCount = Math.max(this._gestureMaxCount, this._pointers.size);
    if (this._pointers.size >= 3 && !this._suspended) {
      this._suspended = true; // null-zone clutch
      // Gesture isolation: undo whatever the first 1–2 fingers drove in the
      // milliseconds before the 3rd landed, so a 3-finger tap is a net no-op
      if (this._mode === MODE_CAMERA && this._gestureStartVals) {
        const s = this._gestureStartVals;
        if (s.rotX !== undefined) this.ps.set('scene3d.rot.x', s.rotX);
        if (s.rotY !== undefined) this.ps.set('scene3d.rot.y', s.rotY);
        if (s.scale !== undefined) this.ps.set('scene3d.scale', s.scale);
      }
    }
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
      // Flick → coast: only a moved 1-finger camera drag whose last motion
      // was recent (a finger held still before lifting flicks nothing)
      if (
        this._mode === MODE_CAMERA &&
        this._gestureMaxCount === 1 &&
        this._gestureMoved &&
        performance.now() - this._lastMoveT < FLICK_MAX_AGE_MS
      ) {
        this._coastVX = this._dragVX;
        this._coastVY = this._dragVY;
      }
      if (this._mode === MODE_PAD) this.onPadRelease?.(); // crosshair → parked
      this._evalTap();
    } else if (!this._suspended) {
      this._rebaseline();
    }
  }

  /** Per-frame inertia — called from the render loop with dt in seconds.
   *  Coasts the orbit after a flick, damped by COAST_FRICTION per 60Hz
   *  frame (frame-rate independent). Any new touch, a mode change, or
   *  dropping below COAST_MIN_V stops it. */
  tick(dt) {
    if (!this._coastVX && !this._coastVY) return;
    if (this._mode !== MODE_CAMERA || this._pointers.size > 0) {
      this._coastVX = 0;
      this._coastVY = 0;
      return;
    }
    const ry = this.ps.get('scene3d.rot.y');
    const rx = this.ps.get('scene3d.rot.x');
    if (ry) this.ps.set('scene3d.rot.y', ry.value + this._coastVX * dt);
    if (rx) this.ps.set('scene3d.rot.x', rx.value + this._coastVY * dt);
    const f = Math.pow(COAST_FRICTION, dt * 60);
    this._coastVX *= f;
    this._coastVY *= f;
    if (Math.abs(this._coastVX) < COAST_MIN_V && Math.abs(this._coastVY) < COAST_MIN_V) {
      this._coastVX = 0;
      this._coastVY = 0;
    }
  }

  /** Gesture just ended (all fingers up) — 2-finger double-tap fires
   *  onDoubleTap2 (fullscreen); a single 3-finger tap cycles touch.mode. */
  _evalTap() {
    const now = performance.now();
    const isTap = !this._gestureMoved && now - this._gestureT0 <= TAP_MAX_MS;

    if (isTap && this._gestureMaxCount === 3) {
      this._lastTap2At = 0;
      this._cycleMode();
      return;
    }

    const isTap2 = isTap && this._gestureMaxCount === 2;
    if (!isTap2) { this._lastTap2At = 0; return; }
    if (now - this._lastTap2At <= DOUBLE_TAP_MS) {
      this._lastTap2At = 0; // consume — a third tap starts fresh
      this.onDoubleTap2?.();
    } else {
      this._lastTap2At = now;
    }
  }

  /** 3-finger tap: advance touch.mode (Camera → Pad → Locked → Camera) and
   *  report the new mode's label for the on-screen flash. */
  _cycleMode() {
    const p = this.ps.get('touch.mode');
    if (!p) return;
    const count = p.options?.length ?? 3;
    const next = (Math.round(p.value) + 1) % count;
    this.ps.set('touch.mode', next);
    this.onModeCycled?.(p.options?.[next] ?? String(next));
  }

  // ── Camera mode ──────────────────────────────────────────────────────────

  _driveCamera() {
    const n = this._pointers.size;
    if (n === 1) {
      const [cx, cy] = this._centroid();
      // Wrap, don't clamp: rotation is periodic, so folding the value back
      // into the 0–360 param range gives endless orbit instead of hitting
      // the param bounds and stopping. That folding now lives on the parameter
      // itself (CIRCULAR_PARAM_IDS), so controller-driven writes get it too —
      // they used to clamp while these gesture paths wrapped.
      this.ps.set('scene3d.rot.y', this._baseRotY + (cx - this._startCX) * ORBIT_DEG_PER_PX);
      this.ps.set('scene3d.rot.x', this._baseRotX + (cy - this._startCY) * ORBIT_DEG_PER_PX);

      // Sample flick velocity (deg/s), lightly smoothed against jitter
      const now = performance.now();
      const mdt = (now - this._lastMoveT) / 1000;
      if (this._lastMoveT && mdt > 0 && mdt < 0.1) {
        const ivx = ((cx - this._lastCX) * ORBIT_DEG_PER_PX) / mdt;
        const ivy = ((cy - this._lastCY) * ORBIT_DEG_PER_PX) / mdt;
        this._dragVX = this._dragVX * 0.6 + ivx * 0.4;
        this._dragVY = this._dragVY * 0.6 + ivy * 0.4;
      }
      this._lastCX = cx;
      this._lastCY = cy;
      this._lastMoveT = now;
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

    // Crosshair overlay: screen-space fraction of the touch point — NOT the
    // ImOs9 y-inverted param value; the crosshair sits under the finger
    this.onPadDrive?.(nx, 1 - ny);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onEnd);
    this.canvas.removeEventListener('pointercancel', this._onEnd);
    this._pointers.clear();
  }
}
