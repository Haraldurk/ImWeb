/**
 * ImWeb Controller Manager
 *
 * Manages all controller instances and drives them each frame.
 * Controllers write to ParameterSystem via setNormalized().
 *
 * Supported: Mouse, Keyboard, MIDI, LFO, Sound, Random, Fixed, Nudge
 * Planned:   OSC (WebSocket), HID (Gamepad), Wacom (PointerEvents pressure)
 */

import { PARAM_TYPE, MIDI_PAGES } from './ParameterSystem.js';
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
 * How many rows the incoming-MIDI monitor keeps. Sixteen is about one screen
 * of the I/O panel and comfortably more than a nanoKONTROL2 sends in one
 * gesture, and consecutive messages from the same control coalesce into one
 * row, so this counts distinct controls touched rather than raw traffic.
 */
export const MIDI_LOG_MAX = 16;

/**
 * How close a control must come to a parameter before soft takeover releases.
 * One MIDI step is 1/127 = 0.0079; half that means a fader landing exactly on
 * the value picks up rather than sitting one step short for ever, which is the
 * failure people report as "pickup never engages".
 */
export const PICKUP_EPS = 0.004;

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

/**
 * Escape a parameter id for use inside a QUOTED attribute selector.
 *
 * Deliberately NOT the browser-only escape helper on the global `CSS` object:
 * reaching for it here threw `ReferenceError` the moment a Node-side audit
 * drove a bind, which took out `audit-midi-buttons` and, because `npm test`
 * chains with `&&`, silently dropped 322 later checks from the run. Inside
 * quotes only the quote and the backslash need escaping, so the dependency
 * bought nothing.
 */
function attrEsc(s) {
  return String(s).replace(/(["\\])/g, '\\$1');
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
    /**
     * Last value seen per `channel:cc`, for rising-edge detection.
     *
     * Keyed by the PHYSICAL control, not by the parameter: "was this button
     * already down" is a fact about the button, and two params driven by one CC
     * must agree about it. Updated once per message, after the dispatch loop —
     * updating inside the loop would let the first param see the edge and every
     * later one see a level.
     *
     * A hardware button is momentary: a Korg nanoKONTROL2 sends 127 on press
     * and 0 on RELEASE. Without this, `setNormalized(0)` on release turned the
     * toggle straight back off (so Run Rec only recorded while held) and fired
     * a TRIGGER a second time, because the value setter fires trigger listeners
     * on every set regardless of `changed`. Notes and gamepad buttons were
     * already edge-guarded; MIDI CC was the one input path that never was.
     */
    this._ccPrev = new Map();
    this._midiLearnParam = null; // paramId waiting for MIDI learn
    this._midiLearnTimer = null;
    this._midiLearnSeq = false;
    /**
     * Map Mode — a LATCHING learn, as against the one-shot `startMIDILearn`
     * fired from the context menu. Mapping a desk with 8 knobs, 8 faders and
     * 24 buttons meant 40 trips through that menu, because a bind is followed
     * immediately by `cancelMIDILearn()`. In map mode the bind re-arms instead,
     * so the loop is click-a-row, move-a-control, repeat.
     *
     * Three live states, all reachable:
     *   _mapMode && !_midiLearnParam  armed, waiting for a row to be picked
     *   _mapMode &&  _midiLearnParam  row picked, waiting for a control to move
     *  !_mapMode &&  _midiLearnParam  the old one-shot learn, unchanged
     */
    this._mapMode = false;

    /**
     * Incoming-MIDI monitor. A nanoKONTROL2 has no display: its SCENE button
     * changes which CCs the controls send and nothing on the device says which
     * scene is live, so "which track is selected" is unanswerable from the
     * hardware. The app has to be the display.
     *
     * Recording is DOM-free on purpose — a swept fader sends dozens of messages
     * a second, and a DOM write per message would put MIDI traffic on the
     * render thread. The views read this buffer once per frame instead.
     */
    this._midiLog = [];          // oldest first; newest is the tail
    this._midiLogDirty = false;

    /**
     * Mapping pages. `param.midiPages[i]` is the binding for page i and is the
     * SOURCE OF TRUTH; `param.controller` is the live projection of the current
     * page. One writer (`setPageBinding`) keeps them from drifting — two writers
     * is how the six copies of the source list happened.
     */
    this._mapPage = 0;
    /**
     * Params awaiting soft takeover: paramId -> { prev }. Armed on a page
     * switch, cleared when the incoming value passes through the parameter's
     * own. Continuous only — a button has no position to pick up.
     */
    this._pickup = new Map();

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

  /** Newest message seen, or null. */
  get midiLast() { return this._midiLog[this._midiLog.length - 1] ?? null; }

  /** The monitor buffer, newest FIRST for display. */
  get midiLog() { return this._midiLog.slice().reverse(); }

  /** True at most once per change — lets a per-frame painter skip idle frames. */
  consumeMidiDirty() {
    const d = this._midiLogDirty;
    this._midiLogDirty = false;
    return d;
  }

  /**
   * Record one message for the monitor.
   *
   * Two filters, both load-bearing. **System Real-Time is dropped**: the clock
   * branch above returns early only when clock sync is ENABLED, so with it off
   * 0xF8 falls straight through at 24 pulses per quarter — 48 messages a second
   * at 120 bpm — and active sensing (0xFE) arrives every ~300 ms besides. Either
   * one alone scrolls a 16-row monitor into uselessness in under a second, and
   * the monitor would look broken rather than flooded.
   *
   * **Consecutive messages from the SAME control coalesce** into one row whose
   * value updates and whose count rises. Without it a single fader sweep evicts
   * every other row, which is exactly when you are looking at the monitor to
   * find out what else is mapped.
   */
  _recordMidi(status, data1, data2) {
    if (status >= 0xF0) return;            // system common + real-time: never shown
    const type = status & 0xF0;
    if (type === 0xA0 || type === 0xD0) return; // aftertouch: continuous, no identity
    const channel = (status & 0x0F) + 1;
    const label = { 0x80: 'Note', 0x90: 'Note', 0xB0: 'CC', 0xC0: 'Prog', 0xE0: 'Bend' }[type];
    if (!label) return;

    const num = data1;
    const val = type === 0xC0 ? 0 : data2;
    const tail = this._midiLog[this._midiLog.length - 1];
    if (tail && tail.type === type && tail.channel === channel && tail.num === num) {
      tail.val = val;
      tail.count++;
      tail.t = performance.now();
    } else {
      this._midiLog.push({ type, label, channel, num, val, count: 1, t: performance.now() });
      if (this._midiLog.length > MIDI_LOG_MAX) this._midiLog.shift();
    }
    this._midiLogDirty = true;
  }

  /**
   * Reverse index of every live MIDI binding: "type:ch:num" -> [labels].
   *
   * Built FRESH by the painter, once per repaint, and deliberately not cached
   * across frames. A cache would need invalidating, and `assign()` is not the
   * only writer — `Parameter.deserialize` sets `controller` directly, which is
   * how MappingAutosave restores a whole rig on boot — so a cached index would
   * be silently stale after every reload and would need an invalidation call at
   * each load site, i.e. a rule someone must remember. The cost of not caching
   * is one pass over the registry per repaint, and only while MIDI is actually
   * moving; what it buys is that the index cannot disagree with the parameters.
   *
   * The expensive shape was O(params x rows) per frame — this is O(params) once.
   */
  buildMidiBindIndex() {
    const ix = new Map();
    const add = (k, label) => { if (!ix.has(k)) ix.set(k, []); ix.get(k).push(label); };
    for (const p of this.ps.getAll()) {
      const c = p.controller;
      if (!c) continue;
      const ch = c.channel ?? 0;
      if (c.type === 'midi-cc' && c.cc != null) add(`176:${ch}:${c.cc}`, p.label);
      else if (c.type === 'midi-note' && c.note != null) add(`144:${ch}:${c.note}`, p.label);
      else if (c.type === 'midi-cc-map') {
        (c.ccs ?? []).forEach((cc, i) => {
          if (cc != null) add(`176:${ch}:${cc}`, `${p.label}[${p.options?.[i] ?? i}]`);
        });
        (c.notes ?? []).forEach((nt, i) => {
          if (nt != null) add(`144:${ch}:${nt}`, `${p.label}[${p.options?.[i] ?? i}]`);
        });
      }
    }
    return ix;
  }

  /** Look one monitor entry up in an index from `buildMidiBindIndex()`. */
  midiBindingsFor(entry, ix) {
    if (!ix) return [];
    // Note-off (0x80) shares an identity with note-on; channel 0 on the
    // controller means "any channel", so both keys are tried.
    const t = entry.type === 0x80 ? 144 : entry.type;
    return ix.get(`${t}:${entry.channel}:${entry.num}`)
        ?? ix.get(`${t}:0:${entry.num}`)
        ?? [];
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
    /**
     * A setup act takes no controller OF ANY KIND (§8.6), and an xController is
     * one — it drives the parameter just as surely for arriving through the
     * controller-of-controller layer rather than the primary slot.
     *
     * Guarded here rather than left to the UI. The context menu already refuses
     * to open for a setup act, so no user can reach this today, and that is
     * exactly the argument step 10 made against UI-only gating before making the
     * same mistake one layer down: `assign()` is NOT the only attachment path,
     * and a claim that it is was wrong.
     */
    if (p.setup) {
      console.warn(`[ControllerManager] ${paramId} is a setup act and takes no xController`);
      return;
    }
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

  /**
   * Rebuild xLFO instances from param.xControllers after preset load.
   *
   * **Deliberately no `p.setup` guard here**, and the reason is CLAUDE.md's rule
   * about guards: at this line, can a setup act have a non-null entry in
   * `xControllers`? Only two things write one — `assignX()` and
   * `Parameter.deserialize()` — and both refuse for setup acts, so the answer is
   * no and a guard would be dead code. Covering the writers is what makes this
   * reader safe; adding a third check that cannot fire would read as belt-and-
   * braces while actually making the invariant harder to locate.
   */
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
     * A setup act takes no controller (audio blueprint §8.6).
     *
     * **This is not the only attachment path, and step 10 shipped claiming it
     * was.** The claim was that `assign()` is "the one function every path
     * reaches"; it is not. Two others write a controller onto a parameter
     * without coming through here, and both are now guarded at their own sites:
     *
     *   1. `assignX()` below — the controller-of-controller layer;
     *   2. `Parameter.deserialize()` — a file, which writes `controller` and
     *      `xControllers` straight onto the param.
     *
     * There is no choke point to find, so the invariant is held by covering
     * every WRITER instead. `tests/audit-audio-monitoring.mjs` enumerates them
     * and fails if a fourth appears unguarded — which is the only version of
     * this that stays true, since the next writer will be added by someone who
     * never read this comment.
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
      /**
       * Pages too. This function claims to clear everything, and since mapping
       * pages arrived `controller` is only the CURRENT page's projection —
       * nulling it alone leaves `midiPages` intact, so every binding returns on
       * the next page switch. Preset.js calls this when loading a bank for
       * exactly the "no leftovers from the previous bank" reason, which the
       * page array would silently defeat.
       */
      p.midiPages = [];
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

  /**
   * @param {string} paramId
   * @param {number|null} optionIndex - when given, the next CC binds to THAT
   *   option of a SELECT rather than to the whole parameter, building a
   *   `midi-cc-map`. This is how a controller with no pads (a nanoKONTROL2 has
   *   buttons that send CC, not notes) gets one button per partition.
   */
  startMIDILearn(paramId, optionIndex = null, onLearned = null, sequential = false) {
    this._midiLearnParam = paramId;
    this._midiLearnOption = optionIndex;
    /**
     * Sequential: after each bind, advance to the next option rather than
     * disarming. True only while walking a SELECT's options in map mode; every
     * other learn leaves it false, including a single option right-clicked from
     * its own button, which must still bind exactly one thing.
     */
    this._midiLearnSeq = !!sequential;
    /**
     * Called after a successful bind, so the row that asked can repaint.
     *
     * A callback rather than an event on `ps`: nothing notifies the UI when a
     * controller is assigned, and learning an option that is ALREADY selected
     * changes no value, so `binding.sync` never fires and the button would show
     * no confirmation at all. A closure dies with the row that made it, which
     * an event listener on a long-lived object would not — rows are rebuilt
     * constantly (see ParamBinding.dispose).
     */
    this._midiLearnDone = onLearned;

    // Flash the MIDI indicator
    const el = document.getElementById('status-midi');
    if (el) el.classList.add('learning');
    clearTimeout(this._midiLearnTimer);
    // Auto-cancel after 10s — but NOT in map mode. Ten seconds is right for a
    // one-shot fired from a menu and wrong for a mode: reaching across a desk
    // to the far end of a fader bank routinely takes longer, and having the
    // arm expire mid-reach reads as the mode being broken.
    if (!this._mapMode) {
      this._midiLearnTimer = setTimeout(() => this.cancelMIDILearn(), 10000);
    }
    this._paintMapTarget();
  }

  // ── Mapping pages ─────────────────────────────────────────────────────────

  /**
   * Controls that switch pages must not themselves be paged, or you can land on
   * a page with no way back and the desk is unusable until you reach for the
   * mouse. Same escape-hatch reasoning as Esc leaving map mode. Pickup is here
   * too: a preference about how bindings behave cannot sensibly differ per page.
   */
  static PAGE_EXEMPT = new Set([
    'midi.page', 'midi.pagePrev', 'midi.pageNext', 'midi.pickup',
  ]);

  get mapPage() { return this._mapPage; }

  /**
   * Write a MIDI binding into the CURRENT page and project it live. The single
   * writer for paged bindings: learn, unmap and any future path must come
   * through here, or `midiPages` and `controller` drift apart and the drift is
   * invisible until a page switch reveals it.
   */
  setPageBinding(paramId, cfg) {
    const p = this.ps.get(paramId);
    if (!p) return;
    if (ControllerManager.PAGE_EXEMPT.has(paramId)) {
      this.assign(paramId, cfg);          // unpaged: lives only in `controller`
      return;
    }
    if (!Array.isArray(p.midiPages)) p.midiPages = [];
    p.midiPages.length = Math.max(p.midiPages.length, MIDI_PAGES);
    p.midiPages[this._mapPage] = cfg ? { ...cfg } : null;
    this.assign(paramId, cfg);
    this._applyLearnSlew(p, cfg);
  }

  /**
   * Give a freshly-learned CONTINUOUS parameter a default slew.
   *
   * Both learn paths reach this through `setPageBinding`, which is the single
   * writer for learned bindings — page PROJECTION goes through `assign()`
   * instead, so switching pages never re-applies it.
   *
   * Two guards, both live: a switch has nothing to smooth between two states,
   * and a parameter whose slew is already non-zero was set deliberately, by
   * hand or by a saved file, and must not be overwritten by the act of mapping
   * a control onto it.
   */
  _applyLearnSlew(p, cfg) {
    if (!cfg || !String(cfg.type ?? '').startsWith('midi')) return;
    if (p.type !== PARAM_TYPE.CONTINUOUS) return;
    if (p.slew > 0) return;
    const s = this.ps.get('midi.slew')?.value ?? 0;
    if (s > 0) p.slew = s;
  }

  /** True when any page holds a binding for this param — i.e. paging owns it. */
  _isPaged(p) { return Array.isArray(p.midiPages) && p.midiPages.some(Boolean); }

  /**
   * Switch pages: project every paged parameter's binding for the new page and
   * arm soft takeover.
   *
   * Only parameters that paging OWNS are touched. A param with an LFO and no
   * page binding anywhere is left completely alone, so switching pages never
   * silently deletes a non-MIDI controller.
   */
  setMapPage(i) {
    const n = ((i % MIDI_PAGES) + MIDI_PAGES) % MIDI_PAGES;   // wraps both ways
    if (n === this._mapPage) return;
    this._mapPage = n;
    this._pickup.clear();
    for (const p of this.ps.getAll()) {
      if (ControllerManager.PAGE_EXEMPT.has(p.id) || !this._isPaged(p)) continue;
      // Optional-chained: `_isPaged` already guarantees the array exists, but a
      // future caller that skips that guard should get a null binding, not a
      // TypeError thrown inside the page switch with half the params projected.
      const cfg = p.midiPages?.[n] ?? null;
      this.assign(p.id, cfg);
      this._repaintCtrlBadge(p.id);
      // Arm pickup for anything continuous that now has a binding: the fader is
      // wherever the last page left it, which is not where this parameter is.
      if (cfg && p.type !== PARAM_TYPE.TOGGLE && p.type !== PARAM_TYPE.TRIGGER
              && p.type !== PARAM_TYPE.SELECT) {
        this._pickup.set(p.id, { prev: null });
      }
    }
    if (this.ps.get('midi.page')?.value !== n) this.ps.set('midi.page', n);
    return n;
  }

  nextMapPage() { return this.setMapPage(this._mapPage + 1); }
  prevMapPage() { return this.setMapPage(this._mapPage - 1); }

  /**
   * Soft takeover. Returns true when this message must be SWALLOWED because the
   * control has not yet passed through the parameter's current value.
   *
   * The first message after arming only records a position — a single reading
   * cannot say which side of the target the fader is on, and guessing gives a
   * jump half the time, which is the whole thing pickup exists to prevent.
   */
  _pickupBlocks(p, norm) {
    const st = this._pickup.get(p.id);
    if (!st) return false;
    if (!this.ps.get('midi.pickup')?.value) { this._pickup.delete(p.id); return false; }
    const cur = p.normalized;
    if (Math.abs(norm - cur) <= PICKUP_EPS) { this._pickup.delete(p.id); return false; }
    if (st.prev === null) { st.prev = norm; return true; }
    const crossed = (st.prev < cur && norm >= cur) || (st.prev > cur && norm <= cur);
    st.prev = norm;
    if (crossed) { this._pickup.delete(p.id); return false; }
    return true;
  }

  // ── Map Mode ──────────────────────────────────────────────────────────────

  /**
   * Latch learn on or off. Leaving the mode cancels any half-finished arm, so
   * a stray CC after exit cannot bind to whatever was last clicked.
   */
  setMapMode(on) {
    this._mapMode = !!on;
    document.body.classList.toggle('midi-map-mode', this._mapMode);
    document.getElementById('status-midi')?.classList.toggle('mapping', this._mapMode);
    if (!this._mapMode) this.cancelMIDILearn();
    this._paintMapTarget();
  }

  toggleMapMode() { this.setMapMode(!this._mapMode); }

  get mapMode() { return this._mapMode; }

  /**
   * Drop one parameter's MIDI binding. Exposed so the map-mode click handler
   * never has to reach into `_paintMapTarget` or `assign` itself — unmapping
   * and repainting the highlight are one act, and splitting them across two
   * call sites is how the second one gets forgotten.
   */
  unmapMIDI(paramId) {
    const p = this.ps.get(paramId);
    if (!p?.controller?.type?.startsWith('midi')) return false;
    this.setPageBinding(paramId, null);
    this._paintMapTarget();
    return true;
  }

  /**
   * Repaint one row's controller badge after a bind.
   *
   * The one-shot learn gets this free: the context menu passes an `onLearned`
   * closure that calls the row's own `updateDisplay()`. Map mode has no such
   * closure — it is driven from a document-level handler that never saw the
   * row builder — so without this the badge still reads "—" after a successful
   * bind and the only confirmation you get is the value moving, which for a
   * TOGGLE mapped to a button you have not pressed yet is no confirmation at
   * all. In a mode whose whole purpose is mapping forty controls in one pass,
   * "did that land?" has to be answerable at a glance.
   *
   * Writes `className` from `controllerClass` rather than adding a class,
   * because `updateDisplay()` rewrites it wholesale from that same getter — an
   * added class would survive only until the row's next refresh.
   */
  _repaintCtrlBadge(paramId) {
    const p = this.ps.get(paramId);
    if (!p) return;
    /**
     * Optional-chained because this is COSMETIC and runs inside the MIDI
     * message handler: if it throws, it takes the whole dispatch down with it,
     * so a badge that failed to repaint would stop every mapped control from
     * working. A repaint is never worth that. (It threw for real once, on a
     * partial `document` stub, and killed a sibling audit mid-run.)
     */
    const el = document.querySelector?.(
      `.param-row[data-param-id="${attrEsc(paramId)}"] .param-ctrl`);
    if (!el) return;
    el.textContent = p.controllerLabel;
    el.className = `param-ctrl ${p.controllerClass}`;
  }

  /** Highlight the row currently waiting for a control to move. */
  _paintMapTarget() {
    document.querySelectorAll('.param-row.map-target, .map-opt-target')
      .forEach(el => el.classList.remove('map-target', 'map-opt-target'));
    if (!this._mapMode || !this._midiLearnParam) return;
    /**
     * A tagged custom widget (the Clip Library's slot grid) is not a param row,
     * so the row highlight below cannot reach it — and walking sixteen options
     * with no indication of which one is armed means pressing sixteen pads
     * blind. Mark the armed cell itself.
     */
    if (this._midiLearnOption != null) {
      document.querySelector(
        `[data-param-id="${attrEsc(this._midiLearnParam)}"]` +
        `[data-opt-index="${this._midiLearnOption}"]`)?.classList.add('map-opt-target');
    }
    const row = document
      .querySelector(`.param-row[data-param-id="${attrEsc(this._midiLearnParam)}"]`);
    if (!row) return;
    row.classList.add('map-target');
    // Which option is armed, for a SELECT being walked. Rendered by CSS from the
    // attribute so it survives the row's own repaints.
    const n = this.ps.get(this._midiLearnParam)?.options?.length ?? 0;
    if (this._midiLearnSeq && this._midiLearnOption != null && n) {
      row.dataset.seq = `${this._midiLearnOption + 1}/${n}`;
    } else {
      delete row.dataset.seq;
    }
  }

  /**
   * Drop every MIDI binding. Bulk mapping is only safe if there is a way back
   * out of a bad pass — without this, a run down the wrong panel is 40 manual
   * unassigns. Returns how many were cleared so the caller can confirm.
   */
  clearAllMIDI() {
    let n = 0;
    for (const p of this.ps.getAll()) {
      /**
       * Count and clear PAGES, not just the live projection. Clearing only
       * `controller` leaves `midiPages` holding the bindings, so they come back
       * the moment you switch pages — and a param bound on page 3 would not even
       * be counted while page 1 is live, so the confirmation would under-report
       * what it left behind.
       */
      // Read BEFORE clearing: emptying the array first destroys the very fact
      // the second branch needs, and a param holding both pages and a live
      // binding then counts twice.
      const hadPages = Array.isArray(p.midiPages) && p.midiPages.some(Boolean);
      if (Array.isArray(p.midiPages)) {
        n += p.midiPages.filter(Boolean).length;
        p.midiPages = [];
      }
      if (p.controller?.type?.startsWith('midi')) {
        // Only page-EXEMPT params reach this without having been counted above;
        // their binding lives in `controller` alone and is still one binding.
        if (!hadPages) n++;
        this.assign(p.id, null);
      }
    }
    return n;
  }

  cancelMIDILearn() {
    this._midiLearnParam = null;
    this._midiLearnOption = null;
    this._midiLearnSeq = false;
    this._midiLearnDone = null;
    document.querySelectorAll('.param-opt-btn.learning')
      .forEach(el => el.classList.remove('learning'));
    clearTimeout(this._midiLearnTimer);
    const el = document.getElementById('status-midi');
    el?.classList.remove('learning');
    /**
     * Deliberately does NOT touch `_mapMode`. That is what makes a bind re-arm
     * instead of exiting: the handler calls this after every successful learn,
     * the target clears, the mode survives, and the next row click arms again.
     * Map mode is left only through `setMapMode(false)`.
     */
    this._paintMapTarget();
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
      // Before every early return below — the clock branch returns only when
      // clock sync is ON, and learn returns as soon as it binds, so recording
      // any later would drop exactly the messages worth watching.
      this._recordMidi(status, data1, data2);

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
      /**
       * Learn accepts NOTES as well as CC. It used to gate on `type === 0xB0`
       * alone, which meant a keyboard or pad controller could learn NOTHING —
       * the arm simply sat there while every key press went unheard. The
       * `midi-note` type already existed and dispatched; nothing could create
       * one. Note-ON only (`data2 > 0`): binding on the release would either
       * double-bind or bind to the wrong control on the way up.
       */
      const isCC   = type === 0xB0;
      const isNote = type === 0x90 && data2 > 0;
      if (this._midiLearnParam && (isCC || isNote)) {
        const learned = this._midiLearnParam;   // cancel clears it below
        const opt     = this._midiLearnOption;
        if (opt != null) {
          // Learn ONE option of a SELECT. Merge into the existing map rather
          // than replacing it, or learning P2 would forget P0 and P1.
          const p = this.ps.get(learned);
          const n = p?.options?.length ?? 0;
          const isMap = p?.controller?.type === 'midi-cc-map';
          const prevC = isMap ? p.controller.ccs   : null;
          const prevN = isMap ? p.controller.notes : null;
          const ccs   = Array.from({ length: n }, (_, i) => prevC?.[i] ?? null);
          /**
           * Notes live in their own array beside `ccs` rather than sharing it.
           * A number in `ccs` has always meant a CC, in every saved file, so
           * overloading it would need a migration and a way to tell 60-the-note
           * from 60-the-CC. A new optional key needs neither: its absence says
           * "CC only", which is exactly what an older file meant.
           */
          const notes = Array.from({ length: n }, (_, i) => prevN?.[i] ?? null);
          // One control drives one option: clear this control from every slot
          // in BOTH arrays, so re-learning moves it instead of firing two.
          for (let i = 0; i < n; i++) {
            if (isCC   && ccs[i]   === data1) ccs[i]   = null;
            if (isNote && notes[i] === data1) notes[i] = null;
          }
          // Claim the target slot in one array and release it in the other, or
          // an option re-learned from CC to note would answer to both.
          ccs[opt]   = isCC   ? data1 : null;
          notes[opt] = isNote ? data1 : null;
          this.setPageBinding(learned, { type: 'midi-cc-map', ccs, notes, channel });
        } else {
          this.setPageBinding(learned, isNote
            ? { type: 'midi-note', note: data1, channel }
            : { type: 'midi-cc',   cc:   data1, channel });
        }
        // Before cancel, which clears it.
        this._midiLearnDone?.();
        // Map mode has no per-row callback to repaint the badge; the context
        // menu's one-shot learn does. Harmless there — it writes the same
        // values the callback already wrote.
        this._repaintCtrlBadge(learned);
        const flash = () => {
          const el = document.getElementById('status-midi');
          if (el) { el.classList.add('active'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('active'), 200); }
        };
        /**
         * Sequential option learn: advance to the next option instead of
         * disarming, so sixteen pads map to sixteen slots in one pass. The
         * alternative for a SELECT too long to render as a button group was
         * right-clicking sixteen dropdown items, reopening the menu each time.
         */
        if (opt != null && this._midiLearnSeq) {
          const n = this.ps.get(learned)?.options?.length ?? 0;
          if (opt + 1 < n) {
            this._midiLearnOption = opt + 1;
            this._paintMapTarget();
            flash();
            return;
          }
        }
        this.cancelMIDILearn();
        flash();
        return;
      }

      // Rising edge for this physical control, read BEFORE the loop so every
      // param sees the same answer. Threshold at half scale so a knob swept
      // across the middle reads as one press, not one per message.
      const ccKey  = `${channel}:${data1}`;
      const ccWas  = (this._ccPrev.get(ccKey) ?? 0) / 127;
      const ccRise = norm > 0.5 && ccWas <= 0.5;

      this.ps.getAll().forEach(p => {
        if (!p.controller) return;
        const c = p.controller;
        if (c.channel && c.channel !== channel) return;

        if (type === 0xB0 && c.type === 'midi-cc' && c.cc === data1) {
          // A button is not a fader. Toggle and trigger take the PRESS and
          // ignore the release, matching what midi-note and the gamepad have
          // always done; anything continuous still follows the value, so a
          // knob or slider is unaffected.
          if (p.type === PARAM_TYPE.TOGGLE) { if (ccRise) p.toggle(); }
          else if (p.type === PARAM_TYPE.TRIGGER) { if (ccRise) p.trigger(); }
          // Buttons are deliberately ABOVE the pickup gate: a button has no
          // position to pick up, and blocking one after a page switch would
          // make it look dead until it had been pressed twice.
          else if (!this._pickupBlocks(p, norm)) p.setNormalized(norm);
        } else if (type === 0xB0 && c.type === 'midi-cc-map' && Array.isArray(c.ccs)) {
          // One CC per option (§ SELECT banks). The index is chosen by WHICH
          // control spoke, not by its value — so four buttons pick four
          // options, and a release (0) selects nothing.
          const idx = c.ccs.indexOf(data1);
          if (idx >= 0 && ccRise) p.value = idx;
        } else if (type === 0x90 && c.type === 'midi-cc-map' && Array.isArray(c.notes)) {
          // The note twin of the CC branch above: which KEY spoke picks the
          // option, so sixteen pads select sixteen slots and a release selects
          // nothing.
          const idx = c.notes.indexOf(data1);
          if (idx >= 0 && data2 > 0) p.value = idx;
        } else if (type === 0x90 && c.type === 'midi-note' && c.note === data1) {
          if (p.type === 'toggle') { if (data2 > 0) p.toggle(); }
          else if (p.type === 'trigger') { if (data2 > 0) p.trigger(); }
          else {
            const nv = data2 > 0 ? data2 / 127 : 0;
            if (!this._pickupBlocks(p, nv)) p.setNormalized(nv);
          }
        } else if (type === 0xC0 && c.type === 'midi-pc') {
          if (this.onMIDIPC) this.onMIDIPC(data1); // global PC callback (preset recall)
          p.value = data1;
        }
      });

      // AFTER the dispatch loop, so every param above saw the same edge.
      if (type === 0xB0) this._ccPrev.set(ccKey, data2);

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
