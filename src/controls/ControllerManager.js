/**
 * ImWeb Controller Manager
 *
 * Manages all controller instances and drives them each frame.
 * Controllers write to ParameterSystem via setNormalized().
 *
 * Supported: Mouse, Keyboard, MIDI, LFO, Sound, Random, Fixed, Nudge
 * Planned:   OSC (WebSocket), HID (Gamepad), Wacom (PointerEvents pressure)
 */

import { LFOController } from './LFO.js';
import { BeatDetector }  from './BeatDetector.js';
import { compileExpression } from './ExprCompiler.js';

/**
 * Default sweep range for an X-map targeting an LFO's rate.
 *
 * The floor is NOT the instrument's slowest rate — an LFO's own Freq field
 * still reaches 0.001 Hz. This is the span an X-map SWEEPS, which is a
 * different job: the source is usually another LFO covering the whole 0–1, so
 * it spends half its time in the bottom half of the range.
 *
 * Shipped at 0.001 first, chosen for a hand on a fader. Measured against a
 * 0.5 Hz sine driving the rate, that put the modulated LFO below 0.1 Hz — over
 * ten seconds a cycle, indistinguishable from stopped — for 48% of every cycle,
 * and the whole feature read as broken. At 0.05 the median lands on 1 Hz and
 * that drops to 23%. Per-mapping minHz still reaches lower when wanted.
 */
export const XMAP_HZ_MIN = 0.05;
export const XMAP_HZ_MAX = 20;

/**
 * Map an X-map controller's 0–1 output to an LFO rate, LOGARITHMICALLY.
 *
 * Rate is perceived in octaves, not in Hz, so a linear map wastes almost all of
 * the travel. Against the old `norm * 20`:
 *
 *     norm   linear      log (0.05–20 Hz)
 *     0.00   0.000 Hz    0.050 Hz      ← linear STOPS the LFO dead at zero
 *     0.25   5.000 Hz    0.224 Hz
 *     0.50  10.000 Hz    1.000 Hz
 *     0.75  15.000 Hz    4.472 Hz
 *     1.00  20.000 Hz   20.000 Hz
 *
 * Everything below 0.5 Hz used to live in the bottom 2.5% of the travel, which
 * is not playable by hand. The floor also matters on its own: norm 0 gave
 * exactly 0 Hz, which freezes the LFO rather than running it slowly, and there
 * is no way back out by pushing the fader a little.
 *
 * Exported and pure so the mapping can be audited without a DOM.
 */
export function xmapHz(norm, minHz = XMAP_HZ_MIN, maxHz = XMAP_HZ_MAX) {
  const lo = Math.max(1e-6, minHz);
  const hi = Math.max(lo, maxHz);
  const n  = Math.max(0, Math.min(1, norm));
  return lo * Math.pow(hi / lo, n);
}

export class ControllerManager {
  constructor(ps) {
    this.ps      = ps;          // ParameterSystem
    this.lfos    = new Map();   // paramId → LFOController (for LFO-assigned params)
    this.randoms = new Map();   // paramId → { hz, lastTick, value }
    this.midi    = null;
    this.sound   = null;
    /**
     * The §8.6 analyser tap provider — `AudioBinding`, injected by main.js.
     * INJECTED, not imported: `AudioBinding` is the one module allowed to see
     * both halves (§4.1), and an `import` here would add a second seam and make
     * the boundary test — *could you delete ImWeb's UI and still drive the
     * engine?* — quietly false. main.js is the integration hub; this is one of
     * the things it integrates.
     */
    this.audioHost = null;
    this.mouse   = { x: 0.5, y: 0.5 };
    // Device motion (iPad tilt/compass) — normalized like mouse.
    // Listener binds lazily: only with permission AND a mapped param.
    this.motion  = { tiltX: 0.5, tiltY: 0.5, compass: 0 };
    this._motionBound = false;
    this._motionPermission = 'unknown'; // 'unknown' | 'granted' | 'denied'
    this.modifiers = { capsLock: false, shift: false, ctrl: false, alt: false, meta: false };

    this._gamepadBtnPrev = []; // tracks button press edges for toggle/trigger params
    this._midiLearnParam = null; // paramId waiting for MIDI learn
    this._midiLearnTimer = null;

    // MIDI clock sync (0xF8 = 24 pulses per quarter note)
    this._midiClockEnabled  = false;
    this._midiClockTimes    = []; // timestamps of recent 0xF8 messages
    this._midiClockCallback = null; // called with derived bpm

    // MIDI Program Change → preset recall
    // Set to a function(pcNumber) to receive PC messages globally
    this.onMIDIPC = null;

    // Expression controllers: paramId → { fn: Function, t: 0 }
    this.exprs = new Map();
    this._exprTime = 0; // cumulative time in seconds

    // Stroke-controller drivers (stroke→LFO): 1 playhead per assignment,
    // reads StrokeLooper slot data, outputs x or y normalized 0-1.
    this.strokes       = new Map();   // paramId → { slot, axis, rate, playhead, _idx }
    this._strokeLooper = null;

    // External Mapping (controller-of-controller)
    // xLFOs keyed by `${paramId}:${xIndex}`
    this._xLFOs = new Map();

    this._montySignal = null;

    // Independent global noise oscillators (rand1, rand2, rand3)
    this.rand = [
      { val: 0.5, target: 0.5, slew: 0.1 },
      { val: 0.5, target: 0.5, slew: 0.05 },
      { val: 0.5, target: 0.5, slew: 0.2 },
    ];

    this._initKeyboard();
    this._initMouse();
    this._initMIDI();
    this._initSound();
    this._initGamepad();
  }

  setMontySignal(signal) { this._montySignal = signal; }
  setStrokeLooper(looper) { this._strokeLooper = looper; }

  // ── Frame tick ────────────────────────────────────────────────────────────

  tick(dt, beatPhase = 0) {
    // Tick all LFO controllers.
    //
    // §8.7: a parameter the AUDIO WORKLET drives is evaluated there, at audio
    // rate, on the thread a hidden tab cannot suspend — and it echoes its value
    // back, so ticking it here as well would fight that echo with a value one
    // frame stale. This early-out is the whole client half of the hand-off, and
    // the fallback it leaves behind (audio off ⇒ every LFO evaluated here, as
    // always) is the second code path §8.7 warns bugs will live in.
    this.lfos.forEach((lfo, paramId) => {
      if (this.audioHost?.ownsParam?.(paramId)) return;
      const v = lfo.tick(dt, beatPhase);
      this.ps.setNormalized(paramId, v);
    });

    // Tick expression controllers
    this._exprTime += dt;
    const t = this._exprTime;
    this.exprs.forEach((expr, paramId) => {
      try {
        const raw = expr.fn(t);
        if (typeof raw === 'number' && isFinite(raw)) {
          const p = this.ps.get(paramId);
          if (p) p.value = raw; // raw is in param's natural range
        }
      } catch (_) { /* silent */ }
    });

    // Tick random controllers
    const now = performance.now() / 1000;
    this.randoms.forEach((r, paramId) => {
      if (now - r.lastTick > 1 / r.hz) {
        r.value = Math.random();
        r.lastTick = now;
        this.ps.setNormalized(paramId, r.value);
      }
    });

    // Tick global rand oscillators (Phase 3)
    this.rand.forEach(r => {
      if (Math.random() < 0.05) r.target = Math.random();
      r.val += (r.target - r.val) * r.slew;
    });

    // Drive rand1/2/3 params AND tick xControllers in a single pass.
    // Within each param: primary (rand) applied first, xController override after —
    // preserving the original execution order guarantee.
    this.ps.getAll().forEach(p => {
      if (p.controller) {
        const ct = p.controller.type;
        if (ct === 'rand1') p.setNormalized(this.rand[0].val);
        else if (ct === 'rand2') p.setNormalized(this.rand[1].val);
        else if (ct === 'rand3') p.setNormalized(this.rand[2].val);
        else if (this._montySignal) {
          if (ct === 'monty-saccade-x')  p.setNormalized(this._montySignal.sx);
          else if (ct === 'monty-saccade-y')  p.setNormalized(this._montySignal.sy);
          else if (ct === 'monty-confidence') p.setNormalized(this._montySignal.confidence);
          else if (ct === 'monty-pe')         p.setNormalized(this._montySignal.pe);
        }
      }
      if (p.xControllers?.length) {
        for (let idx = 0; idx < p.xControllers.length; idx++) {
          const xc = p.xControllers[idx];
          if (!xc) continue;
          const norm = this._evalXNorm(xc, `${p.id}:${idx}`, dt, beatPhase);
          if (norm !== null) this._applyX(p, xc, norm);
        }
      }
    });

    // Tick stroke controllers (independent playhead per assignment,
    // reading StrokeLooper slot points, outputting x or y 0-1).
    if (this._strokeLooper) {
      this.strokes.forEach((s, paramId) => {
        const slot = this._strokeLooper.slots[s.slot];
        if (!slot || !slot.length || !slot.points.length) return;
        s.playhead += dt * s.rate;
        // wrap at slot length; reset idx when wrapped
        if (s.playhead >= slot.length) {
          s.playhead = s.playhead % slot.length;
          s._idx = 0;
        }
        // scan forward to find the last point ≤ playhead
        let val = null;
        while (s._idx < slot.points.length && slot.points[s._idx].t <= s.playhead) {
          val = slot.points[s._idx][s.axis];
          s._idx++;
        }
        // hold last known value; no points yet → neutral 0.5
        if (val !== null) this.ps.setNormalized(paramId, val);
      });
    }

    // Update sound controller if active
    if (this.sound) this.sound.tick();

    // Poll gamepads
    this._tickGamepad();
  }

  // ── External Mapping helpers ──────────────────────────────────────────────

  /** Evaluate an xController config to a 0-1 normalized value. */
  _evalXNorm(xc, key, dt, beatPhase) {
    const t = xc.type;
    if (t?.startsWith('lfo-')) {
      const lfo = this._xLFOs.get(key);
      return lfo ? lfo.tick(dt, beatPhase) : null;
    }
    if (t === 'sound'      && this.sound) return Math.min(1, this.sound.level * 4);
    if (t === 'sound-bass' && this.sound) return this.sound.bass;
    if (t === 'sound-mid'  && this.sound) return this.sound.mid;
    if (t === 'sound-high' && this.sound) return this.sound.high;
    if (t === 'mouse-x') return this.mouse.x;
    if (t === 'mouse-y') return this.mouse.y;
    if (t === 'tilt-x') return this.motion.tiltX;
    if (t === 'tilt-y') return this.motion.tiltY;
    if (t === 'compass') return this.motion.compass;
    if (t === 'rand1') return this.rand[0].val;
    if (t === 'rand2') return this.rand[1].val;
    if (t === 'rand3') return this.rand[2].val;
    if (t === 'random') {
      if (!xc._rState) xc._rState = { lastTick: 0, val: Math.random() };
      const now = performance.now() / 1000;
      if (now - xc._rState.lastTick > 1 / (xc.hz ?? 1)) {
        xc._rState.val = Math.random();
        xc._rState.lastTick = now;
      }
      return xc._rState.val;
    }
    return null;
  }

  /** Apply a normalized xController output to the appropriate target. */
  _applyX(p, xc, norm) {
    const target = xc.target ?? 'value';
    if (target === 'hz') {
      // Modulate primary LFO rate, logarithmically over minHz–maxHz. See xmapHz
      // for why linear was unplayable and why the floor is not optional.
      const lfo = this.lfos.get(p.id);
      if (lfo && p.controller?.bpmDiv == null) {
        lfo.lfo.hz = xmapHz(norm, xc.minHz ?? XMAP_HZ_MIN, xc.maxHz ?? XMAP_HZ_MAX);
        if (p.controller) p.controller.hz = lfo.lfo.hz;
      }
    } else if (target === 'value') {
      // Direct override: write normalized value to param
      p.setNormalized(norm);
    } else if (target === 'amp') {
      // VCA-style: scale current normalized position toward min when norm is low
      if (!p.locked) p.setNormalized(p.normalized * norm);
    }
  }

  // ── External Mapping management ──────────────────────────────────────────

  /**
   * Assign an xController to a param at a given index.
   * xConfig: { type, hz, phase, width, beatSync, beatDiv, target, maxHz }
   */
  assignX(paramId, xIndex, xConfig) {
    const p = this.ps.get(paramId);
    if (!p) return;
    while (p.xControllers.length <= xIndex) p.xControllers.push(null);

    const key = `${paramId}:${xIndex}`;
    this._xLFOs.delete(key);
    p.xControllers[xIndex] = xConfig ? { ...xConfig } : null;

    if (['tilt-x', 'tilt-y', 'compass'].includes(xConfig?.type)) {
      this.requestMotionPermission(); // gesture context — see assign()
    } else {
      this.armMotion();
    }

    if (!xConfig?.type?.startsWith('lfo-')) return;
    const lfo = new LFOController({
      shape:    xConfig.type.replace('lfo-', ''),
      hz:       xConfig.hz       ?? 0.5,
      phase:    xConfig.phase    ?? 0,
      width:    xConfig.width    ?? 0.5,
      beatSync: xConfig.beatSync ?? false,
      beatDiv:  xConfig.beatDiv  ?? 1,
    });
    lfo.bpmDiv = xConfig.bpmDiv ?? null;
    this._xLFOs.set(key, lfo);
  }

  removeX(paramId, xIndex) {
    const p = this.ps.get(paramId);
    if (!p) return;
    if (xIndex < p.xControllers.length) p.xControllers[xIndex] = null;
    this._xLFOs.delete(`${paramId}:${xIndex}`);
    // Trim trailing nulls
    while (p.xControllers.length && !p.xControllers[p.xControllers.length - 1]) {
      p.xControllers.pop();
    }
  }

  /** Rebuild xLFO instances from param.xControllers after preset load. */
  rebuildXControllers() {
    this._xLFOs.clear();
    this.ps.getAll().forEach(p => {
      (p.xControllers ?? []).forEach((xc, idx) => {
        if (!xc?.type?.startsWith('lfo-')) return;
        const key = `${p.id}:${idx}`;
        const lfo = new LFOController({
          shape:    xc.type.replace('lfo-', ''),
          hz:       xc.hz       ?? 0.5,
          phase:    xc.phase    ?? 0,
          width:    xc.width    ?? 0.5,
          beatSync: xc.beatSync ?? false,
          beatDiv:  xc.beatDiv  ?? 1,
        });
        lfo.bpmDiv = xc.bpmDiv ?? null;
        this._xLFOs.set(key, lfo);
      });
    });
  }

  // ── Assign controller to parameter ───────────────────────────────────────

  assign(paramId, controllerConfig) {
    const p = this.ps.get(paramId);
    if (!p) { console.warn(`[ControllerManager] Unknown param: ${paramId}`); return; }
    /**
     * A setup act takes no controller (audio blueprint §8.6). Enforced HERE
     * because this is the one function every assignment path reaches — the
     * badge popover, the context menu, MIDI learn, a loaded project, a preset
     * recall. Gating only the UI would leave a saved file able to reintroduce
     * what the UI refuses, which is the shape of bug that survives a fix.
     *
     * Placed before `_removeController` rather than after: there is never
     * anything to remove from a parameter nothing could attach to, so an early
     * return is the whole behaviour rather than a shortcut past cleanup.
     */
    if (p.setup) {
      console.warn(`[ControllerManager] ${paramId} is a setup act and takes no controller`);
      return;
    }

    // Clean up old controller
    this._removeController(paramId);

    if (!controllerConfig || controllerConfig.type === 'none') {
      p.controller = null;
      this.armMotion(); // last motion mapping removed → unbind sensor
      return;
    }

    p.controller = { ...controllerConfig };
    const t = controllerConfig.type;

    // Motion assignment happens inside a user gesture (menu click), which
    // is exactly when iOS allows requestPermission — ask inline, then arm
    if (t === 'tilt-x' || t === 'tilt-y' || t === 'compass') {
      this.requestMotionPermission();
    }
    this.armMotion(); // also unbinds when a motion controller was replaced

    if (t.startsWith('lfo-')) {
      const lfo = new LFOController({
        shape:    t.replace('lfo-', ''),
        hz:       controllerConfig.hz       ?? 0.5,
        phase:    controllerConfig.phase    ?? 0,
        mode:     controllerConfig.mode     ?? 'norm',
        width:    controllerConfig.width    ?? 0.5,
        beatSync: controllerConfig.beatSync ?? false,
        beatDiv:  controllerConfig.beatDiv  ?? 1,
      });
      lfo.bpmDiv = controllerConfig.bpmDiv ?? null; // null = free Hz mode
      this.lfos.set(paramId, lfo);

    } else if (t === 'random') {
      this.randoms.set(paramId, {
        hz: controllerConfig.hz ?? 1,
        lastTick: 0,
        value: Math.random(),
      });

    } else if (t === 'fixed') {
      p.setNormalized(controllerConfig.value ?? 0);
    } else if (t === 'expr') {
      const src = controllerConfig.expr ?? '0';
      try {
        // Compile to a bounded instruction list — no `new Function`, so loops,
        // statements and allocation literals are rejected HERE, at compile
        // time, instead of wedging the render loop at evaluation time (#33).
        // On failure the previous expression stays live (last-good, same
        // discipline as the GLSL editor).
        const fn = compileExpression(src);
        this.exprs.set(paramId, { fn });
      } catch (e) {
        console.warn(`[Expr] Compile error for ${paramId}: ${e.message}`);
      }
    } else if (t.startsWith('stroke-')) {
      // stroke-{slot}-{axis}  e.g. stroke-1-x, stroke-4-y
      const parts = t.split('-');
      const slot  = Math.max(0, Math.min(3, (parseInt(parts[1]) || 1) - 1));
      const axis  = parts[2] === 'y' ? 'y' : 'x';
      const prev  = this.strokes.get(paramId);
      this.strokes.set(paramId, {
        slot,
        axis,
        rate:     prev?.rate ?? 1,
        playhead: 0,
        _idx:     0,
      });
    } else if (t === 'sound' || t === 'sound-bass' || t === 'sound-mid' || t === 'sound-high') {
      this.enableSound(); // lazy-init audio input on first assignment
    }
    // mouse, midi, key are handled reactively in their event handlers
  }

  _removeController(paramId) {
    this.lfos.delete(paramId);
    this.randoms.delete(paramId);
    this.exprs.delete(paramId);
    this.strokes.delete(paramId);
  }

  /** Remove every controller assignment from every parameter. Called on reset. */
  clearAllAssignments() {
    this.ps.getAll().forEach(p => {
      this._removeController(p.id);
      // Clear xLFOs for this param
      (p.xControllers ?? []).forEach((_, i) => this._xLFOs.delete(`${p.id}:${i}`));
      p.controller   = null;
      p.xControllers = [];
    });
  }

  // ── Retrigger all LFOs (on DisplayState recall) ───────────────────────────

  retriggerLFOs() {
    this.lfos.forEach(lfo => lfo.retrigger());
    // Worklet-resident controllers retrigger through their own explicit verb
    // (§8.7 rule 4). Their descriptions are re-sent by a Display State recall
    // too, and a re-send is an UPDATE — so without this line a recall would
    // silently stop retriggering exactly the LFOs that moved to the worklet,
    // which is behaviour the instrument has today.
    this.audioHost?.retriggerOwned?.();
  }

  // ── BPM sync ──────────────────────────────────────────────────────────────

  /**
   * Update hz for all BPM-synced LFOs.
   * Called whenever global.bpm changes.
   */
  syncBPM(bpm) {
    this.lfos.forEach(lfo => {
      if (lfo.bpmDiv != null) {
        lfo.lfo.hz = (bpm / 60) * lfo.bpmDiv;
        // Persist to controller config so it serializes correctly
        const paramId = [...this.lfos.entries()].find(([, v]) => v === lfo)?.[0];
        if (paramId) {
          const p = this.ps.get(paramId);
          if (p?.controller) p.controller.hz = lfo.lfo.hz;
        }
      }
    });
    // Sync xLFOs that are beat-synced
    this._xLFOs.forEach((lfo, key) => {
      if (lfo.bpmDiv != null) {
        lfo.lfo.hz = (bpm / 60) * lfo.bpmDiv;
        const [paramId, idxStr] = key.split(':');
        const xc = this.ps.get(paramId)?.xControllers?.[parseInt(idxStr)];
        if (xc) xc.hz = lfo.lfo.hz;
      }
    });
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────

  // ── Device motion (tilt-x / tilt-y / compass) ─────────────────────────────

  /** True if any main or X-map controller uses a motion source. */
  _motionInUse() {
    const M = ['tilt-x', 'tilt-y', 'compass'];
    return this.ps.getAll().some(p =>
      (p.controller && M.includes(p.controller.type)) ||
      (p.xControllers ?? []).some(xc => M.includes(xc.type)));
  }

  /** iOS 13+ gate. Resolves true when sensors may be read. Must be called
   *  from a user gesture on iOS the first time; on other platforms it
   *  resolves immediately. Safe to call speculatively (rejections are
   *  swallowed → 'denied' until a real gesture retries). */
  async requestMotionPermission() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      this.onMotionPermission?.('no sensors');
      return false;
    }
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      try {
        const r = await DeviceOrientationEvent.requestPermission();
        this._motionPermission = r === 'granted' ? 'granted' : 'denied';
      } catch {
        this._motionPermission = 'denied'; // no gesture / user dismissed
      }
    } else {
      this._motionPermission = 'granted'; // non-iOS: no permission gate
    }
    this.armMotion();
    console.info(`[Motion] permission: ${this._motionPermission}, listener bound: ${this._motionBound}`);
    this.onMotionPermission?.(this._motionPermission);
    return this._motionPermission === 'granted';
  }

  /** Bind/unbind the deviceorientation listener to match current mappings —
   *  no mapped param means no listener (battery/CPU). Called after every
   *  assignment and after preset/state recalls. */
  armMotion() {
    const used = this._motionInUse();
    if (used && !this._motionBound && this._motionPermission === 'granted') {
      window.addEventListener('deviceorientation', this._onDeviceOrientation);
      this._motionBound = true;
    } else if (!used && this._motionBound) {
      window.removeEventListener('deviceorientation', this._onDeviceOrientation);
      this._motionBound = false;
    }
  }

  _onDeviceOrientation = (e) => {
    if (!this._motionFirstEvent) {
      this._motionFirstEvent = true;
      console.info(`[Motion] first sensor event: beta=${e.beta?.toFixed(1)} gamma=${e.gamma?.toFixed(1)} alpha=${e.alpha?.toFixed(1)}`);
    }
    // Compensate for screen orientation so Tilt X is always "toward/away
    // from me" relative to the screen being looked at — beta/gamma are
    // device-frame axes and swap when the iPad rotates to landscape.
    const angle = (screen.orientation?.angle ?? window.orientation ?? 0);
    const beta = e.beta ?? 0;   // device X tilt, -180..180
    const gamma = e.gamma ?? 0; // device Y tilt, -90..90
    let sx, sy;
    switch (((angle % 360) + 360) % 360) {
      case 90:  sx = -gamma; sy = beta;   break;
      case 180: sx = -beta;  sy = -gamma; break;
      case 270: sx = gamma;  sy = -beta;  break;
      default:  sx = beta;   sy = gamma;  break;
    }
    // Performance range ±90° → 0..1 (flat = 0.5); compass 0-360° → 0..1
    // (note: compass wraps at north — a mapped param jumps 1→0 there)
    const clamp01 = (v) => Math.max(0, Math.min(1, v));
    this.motion.tiltX = clamp01((sx + 90) / 180);
    this.motion.tiltY = clamp01((sy + 90) / 180);
    this.motion.compass = (((e.alpha ?? 0) % 360) + 360) % 360 / 360;

    // Drive assigned params reactively (same pattern as mouse-x/y)
    this.ps.getAll().forEach(p => {
      if (!p.controller) return;
      const { type, modifiers } = p.controller;
      if (!this._checkModifiers(modifiers)) return;
      if (type === 'tilt-x') p.setNormalized(this.motion.tiltX);
      if (type === 'tilt-y') p.setNormalized(this.motion.tiltY);
      if (type === 'compass') p.setNormalized(this.motion.compass);
    });
  };

  _initMouse() {
    const canvas = document.getElementById('output-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = 1 - (e.clientY - r.top) / r.height; // y=0 at bottom (ImOs9 convention)

      // Drive all mouse-X/Y assigned params
      this.ps.getAll().forEach(p => {
        if (!p.controller) return;
        const { type, modifiers } = p.controller;
        if (!this._checkModifiers(modifiers)) return;
        if (type === 'mouse-x') p.setNormalized(this.mouse.x);
        if (type === 'mouse-y') p.setNormalized(this.mouse.y);
      });
    });

    // Pointer pressure (Wacom / stylus)
    canvas.addEventListener('pointermove', e => {
      const pressure = e.pressure ?? 0;
      if (pressure === 0 || e.pointerType === 'mouse') return;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type === 'wacom-pressure' || p.controller?.type === 'pen-pressure') p.setNormalized(pressure);
      });
    });
  }

  _checkModifiers(combo) {
    if (!combo) return true; // no modifier needed
    const m = this.modifiers;
    if (combo.includes('l') && !m.capsLock) return false;
    if (combo.includes('s') && !m.shift)    return false;
    if (combo.includes('c') && !m.ctrl)     return false;
    if (combo.includes('o') && !m.alt)      return false;
    if (combo.includes('d') && !m.meta)     return false;
    return true;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  _initKeyboard() {
    window.addEventListener('keydown', e => {
      this._updateModifiers(e);

      // Global keybindings
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'f') { e.preventDefault(); document.body.classList.toggle('fullscreen-output'); }
        return;
      }

      // Drive key-assigned params
      const key = e.key;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type !== 'key') return;
        if (p.controller.key !== key) return;
        if (p.type === 'toggle') p.toggle();
        else if (p.type === 'trigger') p.trigger();
        else p.setNormalized(1);
      });
    });

    window.addEventListener('keyup', e => {
      this._updateModifiers(e);
      const key = e.key;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type === 'key' && p.controller.key === key) {
          if (p.type === 'continuous') p.setNormalized(0);
        }
      });
    });
  }

  _updateModifiers(e) {
    this.modifiers.capsLock = e.getModifierState?.('CapsLock') ?? false;
    this.modifiers.shift    = e.shiftKey;
    this.modifiers.ctrl     = e.ctrlKey;
    this.modifiers.alt      = e.altKey;
    this.modifiers.meta     = e.metaKey;
  }

  // ── MIDI ──────────────────────────────────────────────────────────────────

  async _initMIDI() {
    if (!navigator.requestMIDIAccess) return;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.midi = access;
      access.inputs.forEach(input => this._attachMIDIInput(input));
      access.onstatechange = e => {
        if (e.port.type === 'input' && e.port.state === 'connected') {
          this._attachMIDIInput(e.port);
        }
      };
      document.getElementById('status-midi')?.classList.add('active');
    } catch (err) {
      console.info('[MIDI] Not available:', err.message);
    }
  }

  // ── MIDI Output ───────────────────────────────────────────────────────────

  /**
   * Send a MIDI CC to all connected output ports.
   * channel: 1–16, cc: 0–127, value: 0–127
   */
  sendCC(channel, cc, value) {
    if (!this.midi) return;
    const status = 0xB0 | ((channel - 1) & 0x0F);
    const data   = [status, cc & 0x7F, Math.round(value) & 0x7F];
    this.midi.outputs.forEach(port => {
      try { port.send(data); } catch (_) { /* ignore disconnected */ }
    });
  }

  /**
   * Send the current normalized value of a MIDI-CC-mapped parameter back
   * to its assigned CC (for motorized faders / LED feedback).
   */
  sendParamFeedback(param) {
    if (!param.controller || param.controller.type !== 'midi-cc') return;
    const cc      = param.controller.cc;
    const channel = param.controller.channel ?? 1;
    const val127  = Math.round(param.normalized * 127);
    this.sendCC(channel, cc, val127);
  }

  // ── MIDI Learn ────────────────────────────────────────────────────────────

  startMIDILearn(paramId) {
    this._midiLearnParam = paramId;

    // Flash the MIDI indicator
    const el = document.getElementById('status-midi');
    if (el) {
      el.classList.add('learning');
      clearTimeout(this._midiLearnTimer);
      // Auto-cancel after 10s
      this._midiLearnTimer = setTimeout(() => this.cancelMIDILearn(), 10000);
    }
  }

  cancelMIDILearn() {
    this._midiLearnParam = null;
    clearTimeout(this._midiLearnTimer);
    const el = document.getElementById('status-midi');
    el?.classList.remove('learning');
  }

  /**
   * Enable MIDI clock sync. `callback(bpm)` is called whenever BPM is derived
   * from incoming 0xF8 timing clock messages (24 pulses/quarter note).
   */
  enableMIDIClock(callback) {
    this._midiClockEnabled  = true;
    this._midiClockCallback = callback;
    this._midiClockTimes    = [];
  }

  disableMIDIClock() {
    this._midiClockEnabled  = false;
    this._midiClockCallback = null;
    this._midiClockTimes    = [];
  }

  _attachMIDIInput(input) {
    input.onmidimessage = e => {
      const [status, data1, data2] = e.data;

      // MIDI clock: 0xF8 = timing tick (24 per quarter note)
      if (status === 0xF8 && this._midiClockEnabled) {
        if (typeof this.onMidiTick === 'function') this.onMidiTick();
        const now = performance.now();
        this._midiClockTimes.push(now);
        if (this._midiClockTimes.length > 24) this._midiClockTimes.shift();
        if (this._midiClockTimes.length >= 4) {
          // Average interval of last N ticks
          const n   = this._midiClockTimes.length;
          const avg = (this._midiClockTimes[n - 1] - this._midiClockTimes[0]) / (n - 1);
          const bpm = 60000 / (avg * 24); // 24 ticks per quarter note
          if (bpm > 20 && bpm < 300) this._midiClockCallback?.(Math.round(bpm * 10) / 10);
        }
        return;
      }

      const type    = status & 0xF0;
      const channel = (status & 0x0F) + 1;
      const norm    = data2 / 127;

      // MIDI Learn: intercept next CC
      if (this._midiLearnParam && type === 0xB0) {
        this.assign(this._midiLearnParam, { type: 'midi-cc', cc: data1, channel });
        this.cancelMIDILearn();
        // Activity flash
        const el = document.getElementById('status-midi');
        if (el) { el.classList.add('active'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('active'), 200); }
        return;
      }

      this.ps.getAll().forEach(p => {
        if (!p.controller) return;
        const c = p.controller;
        if (c.channel && c.channel !== channel) return;

        if (type === 0xB0 && c.type === 'midi-cc' && c.cc === data1) {
          p.setNormalized(norm);
        } else if (type === 0x90 && c.type === 'midi-note' && c.note === data1) {
          if (p.type === 'toggle') { if (data2 > 0) p.toggle(); }
          else if (p.type === 'trigger') { if (data2 > 0) p.trigger(); }
          else p.setNormalized(data2 > 0 ? data2 / 127 : 0);
        } else if (type === 0xC0 && c.type === 'midi-pc') {
          if (this.onMIDIPC) this.onMIDIPC(data1); // global PC callback (preset recall)
          p.value = data1;
        }
      });

      // Global MIDI PC callback (fires for any PC message regardless of param mapping)
      if (type === 0xC0 && this.onMIDIPC) {
        this.onMIDIPC(data1);
      }

      // Clip Library MIDI recall: note-on (0x90) note 0–127 → slot 0–127
      if (type === 0x90 && data2 > 0 && this._clipLibrary && this._movieInput) {
        this._clipLibrary.recall(data1).then(result => {
          if (!result) return;
          this._movieInput.addClip(result.blobUrl).then(idx => {
            if (idx < 0) return;
            this._movieInput.selectClip(idx);
            this.ps.set('movie.active', 1);
            this.ps.set('clip.bank', Math.floor(data1 / 16));
            this.ps.set('clip.slot', data1 % 16);
          });
        }).catch(() => {}); // silent fail on empty slot
      }

      // Show MIDI activity
      const el = document.getElementById('status-midi');
      if (el) {
        el.classList.add('active');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('active'), 100);
      }
    };
  }

  // ── Gamepad ───────────────────────────────────────────────────────────────

  _initGamepad() {
    window.addEventListener('gamepadconnected', e => {
      console.info(`[Gamepad] Connected: ${e.gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', e => {
      console.info(`[Gamepad] Disconnected: ${e.gamepad.id}`);
    });
  }

  _tickGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    // Use the first connected gamepad
    let gp = null;
    for (const g of gamepads) { if (g) { gp = g; break; } }
    if (!gp) return;

    this.ps.getAll().forEach(p => {
      if (!p.controller) return;
      const c = p.controller;
      const t = c.type;

      if (t?.startsWith('gamepad-axis-')) {
        const idx  = parseInt(t.replace('gamepad-axis-', ''));
        const raw  = gp.axes[idx] ?? 0;
        const norm = (raw + 1) / 2; // -1..1  →  0..1
        p.setNormalized(norm);

      } else if (t?.startsWith('gamepad-btn-')) {
        const idx = parseInt(t.replace('gamepad-btn-', ''));
        const btn = gp.buttons[idx];
        if (!btn) return;

        const prev    = this._gamepadBtnPrev[idx] ?? false;
        const pressed = btn.pressed;

        if (p.type === 'toggle') {
          if (pressed && !prev) p.toggle();     // rising edge only
        } else if (p.type === 'trigger') {
          if (pressed && !prev) p.trigger();    // rising edge only
        } else {
          p.setNormalized(btn.value);           // analog (0 or 1 for digital)
        }

        this._gamepadBtnPrev[idx] = pressed;
      }
    });
  }

  // ── Sound ─────────────────────────────────────────────────────────────────

  async _initSound() {
    // Sound controller initialized lazily when a sound-controlled param exists
    // or when explicitly enabled
  }

  /**
   * Attach the sound-reactive controllers to the engine's analyser tap.
   *
   * **This layer used to own an `AudioContext` and a `getUserMedia` call of its
   * own** (§6 item 5b). It no longer does: §8.6 settled that there is one
   * context, owned by the engine, because two contexts are two clocks and the
   * relationship between what the instrument hears and what it plays drifts
   * apart between them — which is the coupling claim in §3, lost to a detail.
   *
   * The consequence worth knowing: this layer now hears whatever the tap is
   * pointed at, not just the mic. Tap the master bus and the sound controllers
   * hear the instrument itself, which is the point — an AV instrument deaf to
   * its own output can only be driven from the room.
   */
  async enableSound() {
    if (this.sound) return;
    if (!this.audioHost) {
      // Not a fallback to a private context: that is the bug this replaced.
      console.warn('[Sound] no audio host attached — sound controllers inactive');
      return;
    }
    try {
      const { ctx, tap } = await this.audioHost.ensureTap();
      const source = tap;
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512; // 256 bins
      source.connect(analyser);
      const timeBuf = new Float32Array(analyser.fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount); // 256 bins

      const beatDetector = new BeatDetector(analyser, ctx);

      this.sound = {
        ctx, analyser, timeBuf, freqBuf,
        beatDetector,
        level: 0, bass: 0, mid: 0, high: 0,
        tick() {
          analyser.getFloatTimeDomainData(timeBuf);
          let rms = 0;
          for (let i = 0; i < timeBuf.length; i++) rms += timeBuf[i] * timeBuf[i];
          this.level = Math.sqrt(rms / timeBuf.length);

          analyser.getByteFrequencyData(freqBuf);
          const N = freqBuf.length;
          // Bass: 0-10% of bins (~0-1kHz for 44kHz sample rate)
          const bassEnd = Math.floor(N * 0.04);
          const midEnd  = Math.floor(N * 0.25);
          let b = 0, m = 0, h = 0;
          for (let i = 0; i < bassEnd; i++) b += freqBuf[i];
          for (let i = bassEnd; i < midEnd; i++) m += freqBuf[i];
          for (let i = midEnd; i < N; i++) h += freqBuf[i];
          this.bass = Math.min(1, (b / bassEnd) / 200);
          this.mid  = Math.min(1, (m / (midEnd - bassEnd)) / 160);
          this.high = Math.min(1, (h / (N - midEnd)) / 120);

          // Beat detection
          beatDetector.tick();
        }
      };

      // Notify any listener that sound is ready (e.g. vectorscope)
      if (typeof this.onSoundReady === 'function') this.onSoundReady(source, ctx);

      // Wire sound-assigned params
      setInterval(() => {
        if (!this.sound) return;
        const s = this.sound;
        const level = Math.min(1, s.level * 4);
        this.ps.getAll().forEach(p => {
          if (!p.controller) return;
          const t = p.controller.type;
          if (t === 'sound')      p.setNormalized(level);
          if (t === 'sound-bass') p.setNormalized(s.bass);
          if (t === 'sound-mid')  p.setNormalized(s.mid);
          if (t === 'sound-high') p.setNormalized(s.high);
        });
      }, 16);

    } catch (err) {
      console.warn('[Sound] Could not init audio input:', err.message);
    }
  }
}
