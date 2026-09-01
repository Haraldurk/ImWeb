/**
 * ImWeb Parameter System
 *
 * Every controllable value in the system is a Parameter.
 * Controllers write normalized (0–1) values to parameters.
 * Effects and inputs read from parameters via reactive callbacks.
 *
 * Flow:
 *   Controller → normalize(0–1) → [Invert] → [Table curve] → [min/max remap]
 *   → Parameter.value → onChange callbacks → render update
 */

// The scale list for `aspec.scale`, imported rather than retyped. A SELECT
// stores an INDEX into its options, so a second copy that drifted in ORDER
// would leave the label reading "Major" while the writer rendered something
// else — silently, and only on the degrees where the two scales differ. This is
// the SOURCE_DEFS lesson (CLAUDE.md) applied before there is a second copy to
// regret. `spectral-image.js` imports nothing itself, so this adds no weight.
import { SCALE_NAMES, PAN_MODES } from '../audio/spectral-image.js';
// Same rule, same reason: a SELECT stores an INDEX, so the axis menus must be
// built from the one list the index itself reads, never retyped beside it.
import { DESCRIPTOR_LABELS } from '../audio/corpus-index.js';

/**
 * How the performer is listening (§8.6). ONE list, read twice: the labels are
 * `audio.monitor`'s options and the indices are what `AudioBinding` compares
 * against, so a SELECT index cannot come to mean the other mode.
 *
 * Exported from here rather than from the audio half because `AudioBinding`
 * already imports this file and the reverse would be a cycle. The audit
 * cross-checks that the names and the indices still agree.
 */
export const MONITOR_MODES = Object.freeze(['Headphones', 'Speakers']);
export const MONITOR = Object.freeze({ HEADPHONES: 0, SPEAKERS: 1 });

// Set by main.js after TableManager is initialised
let _tableManager = null;
let _ps           = null;   // set by registerCoreParameters; used by setTableManager
export function setTableManager(tm) {
  _tableManager = tm;
  // Keep global.tableSlot options in sync with the table list
  const syncSlot = () => {
    const p = _ps?.params.get('global.tableSlot');
    if (p) p.options = tm.getNames();
  };
  syncSlot();
  tm.addEventListener('change', syncSlot);
}

// Resolve a param's assigned response table (by name, or via the shared
// global.tableSlot index for 'global'). Lives at module level so BOTH write
// paths shape values identically: ParameterSystem.setNormalized and direct
// p.setNormalized() calls (MIDI, mouse, sound, tilt, gamepad, fixed…) —
// the latter used to skip tables entirely.
// Exported for ONE other caller, and for a use that is not application:
// AudioBinding resolves the same curve in order to UPLOAD it to the worklet
// (§8.7), which then applies it at audio rate. Resolving it there by hand would
// be a second copy of the 'global' slot indirection — the thing this function
// exists to prevent — while calling `.apply()` there would shape the value
// twice. The audit in tests/audit-table-write-paths.mjs pins both halves of
// that: one applier, and no `.apply(` anywhere in the binding.
export function resolveTable(param) { return _resolveTable(param); }

function _resolveTable(param) {
  if (!param.table || !_tableManager) return null;
  if (param.table === 'global') {
    const slotP = _ps?.params.get('global.tableSlot');
    const idx   = slotP ? Math.round(slotP.value) : 0;
    const names = _tableManager.getNames();
    const name  = names[Math.max(0, Math.min(idx, names.length - 1))];
    return name ? _tableManager.get(name) : null;
  }
  return _tableManager.get(param.table);
}

export const PARAM_TYPE = {
  CONTINUOUS: "continuous", // floating point in [min, max]
  TOGGLE: "toggle", // 0 | 1
  TRIGGER: "trigger", // fires event on set; value resets to 0 next frame
  SELECT: "select", // integer index into options[]
};

// ── Slew curves ──────────────────────────────────────────────────────────────
//
// TWO FAMILIES, and the difference is structural rather than cosmetic.
//
//   FILTERS ('lag', 'ease') have no clock and no endpoint. They chase whatever
//   the target currently is, so they behave identically whether the source
//   steps or sweeps. They are handled inline in tickSlew, not from this table.
//
//   SEGMENT CURVES (everything below) are functions of normalized time k∈[0,1]
//   between a captured start value and the target. A curve that overshoots,
//   rings or bounces CANNOT be expressed as a filter — it has to know how far
//   through the move it is. That clock is the whole reason these are a separate
//   family, and it is also their limitation: see _slewK in tickSlew for how a
//   segment is re-aimed rather than restarted when the target moves in flight.
//
// f(0) must be 0 and f(1) must be 1 for every entry, or the value will not land
// on the target. Values in between may leave [0,1] — that IS the overshoot —
// and the [min,max] clamp in tickSlew is what keeps that safe.

/** Robert Penner's bounce-out: four decreasing parabolic arcs. */
function _bounceOut(k) {
  const n = 7.5625, d = 2.75;
  if (k < 1 / d) return n * k * k;
  if (k < 2 / d) return n * (k -= 1.5 / d) * k + 0.75;
  if (k < 2.5 / d) return n * (k -= 2.25 / d) * k + 0.9375;
  return n * (k -= 2.625 / d) * k + 0.984375;
}

export const SLEW_CURVES = {
  // Quintic smootherstep. Same shape as 'ease' in spirit but with a flatter
  // start and finish — the "super" is a longer loiter at each end.
  ease2: (k) => k * k * k * (k * (k * 6 - 15) + 10),

  // Exponential in/out. Very slow off the mark, then a hard rush through the
  // middle. The most dramatic of the non-overshooting curves.
  expo: (k) =>
    k <= 0 ? 0
      : k >= 1 ? 1
      : k < 0.5
        ? Math.pow(2, 20 * k - 10) / 2
        : (2 - Math.pow(2, -20 * k + 10)) / 2,

  // Bounce out: arrives, then settles in four decreasing hops.
  bounce: _bounceOut,

  // Back in/out: pulls BACKWARDS before setting off (anticipation), then
  // overshoots past the target and eases back. The only curve here that leaves
  // the [0,1] band at both ends.
  //
  // `strength` scales the single constant that governs both lobes — 1 is the
  // textbook shape (±10% of the move), 0 degenerates to a plain cubic in/out
  // with no excursion at all, and the endpoints stay exact at every value.
  back: (k, strength = 1) => {
    const c = 1.70158 * 1.525 * strength;
    return k < 0.5
      ? (Math.pow(2 * k, 2) * ((c + 1) * 2 * k - c)) / 2
      : (Math.pow(2 * k - 2, 2) * ((c + 1) * (2 * k - 2) + c) + 2) / 2;
  },
};

/** Which segment curves read the Strength knob. */
export const SLEW_CURVE_HAS_STRENGTH = { back: true };

/**
 * How far each segment curve leaves the [0,1] band, and when.
 *
 *   under — deepest dip below 0 (the anticipation lobe)
 *   over  — highest rise above 1 (the overshoot lobe)
 *   k0    — the k at which the initial dip returns to 0; 0 for curves that
 *           never go negative
 *
 * Sampled once at load rather than hand-copied, so editing a curve cannot
 * leave a stale constant behind.
 */
const _exCache = new Map();

/**
 * Measured, not hand-copied, so editing a curve cannot leave a stale constant
 * behind. Strength reshapes Back, and NOT linearly — the excursion runs 3.1%,
 * 10.0%, 27.0%, 45.3% at Strength 0.5, 1, 2, 3, and the k at which the opening
 * dip returns to zero moves with it too. So this is keyed by strength and
 * memoised rather than computed once: the sampling loop is far too expensive
 * to run per frame, and the values are far too curved to scale by hand.
 */
export function slewExcursion(shape, strength = 1) {
  const f = SLEW_CURVES[shape];
  if (!f) return { under: 0, over: 0, k0: 0 };
  // Quantise the key: a drag through Strength would otherwise mint an entry per
  // frame. 0.01 is finer than the UI can express and the fit is insensitive
  // to it — and the [min,max] clamp is still there as the backstop.
  const s = SLEW_CURVE_HAS_STRENGTH[shape] ? Math.round(strength * 100) / 100 : 1;
  const key = `${shape}:${s}`;
  let e = _exCache.get(key);
  if (e) return e;
  const N = 4000;
  let lo = 0, hi = 1, k0 = 0;
  for (let i = 0; i <= N; i++) {
    const y = f(i / N, s);
    if (y < lo) lo = y;
    if (y > hi) hi = y;
    if (y < 0) k0 = (i + 1) / N; // last k still inside the opening dip
  }
  e = { under: -lo, over: hi - 1, k0: lo < 0 ? k0 : 0 };
  if (_exCache.size > 512) _exCache.clear(); // bounded; it refills in one frame
  _exCache.set(key, e);
  return e;
}

/**
 * Damping ratio and stiffness for the 'elastic' spring.
 *
 * zeta < 1 is underdamped: it overshoots and rings where 'ease' (critically
 * damped) does not. 0.45 gives a ~19% first overshoot and two clearly visible
 * rings. The textbook easeOutElastic this replaced overshot 37%, which on a
 * bounded parameter mostly went to the clamp rather than to the picture.
 *
 * omega is 5/slew rather than 'ease's 2/slew because a ringing spring needs the
 * rings inside the time the user asked for. It settles in roughly 1.5x slew —
 * for a curve whose whole point is to keep moving after it arrives, slew is a
 * characteristic time, not a deadline.
 */
export const ELASTIC_ZETA  = 0.45;  // default Damp
export const ELASTIC_OMEGA = 5;     // stiffness at Strength 1
export const ELASTIC_DAMP_MIN = 0.05;
export const ELASTIC_DAMP_MAX = 1;
export const ELASTIC_STRENGTH_MIN = 0.25;
export const ELASTIC_STRENGTH_MAX = 4;

/** Shapes driven by a stateful filter rather than a timed segment. */
export const SLEW_FILTERS = ["lag", "ease", "elastic"];

/** Every legal slewShape, in menu order. */
export const SLEW_SHAPES = [...SLEW_FILTERS, ...Object.keys(SLEW_CURVES)];

// ─────────────────────────────────────────────────────────────────────────────
// Parameter
// ─────────────────────────────────────────────────────────────────────────────

export class Parameter {
  constructor(config) {
    this.id = config.id;
    this.label = config.label ?? config.id;
    this.type = config.type ?? PARAM_TYPE.CONTINUOUS;
    this.group = config.group ?? null;
    this.min = config.min ?? 0;
    this.max = config.max ?? 100;
    this.options = config.options ?? null; // for SELECT
    this.unit = config.unit ?? ""; // display unit string e.g. '°', '%'
    this.step = config.step ?? null; // optional snap step
    // 'exp' taper for CONTINUOUS params — see toNorm/fromNorm. Anything else,
    // including the default, is linear.
    this.curve = config.curve ?? null;
    /**
     * Whether `step` also QUANTIZES the stored value, or is only the UI
     * drag/arrow increment. Default true, because for most params the two are
     * the same number and snapping is what you want.
     *
     * `snap: false` exists for params whose writer resolves a position more
     * finely than any sensible drag increment. `agrain.pos` is the case: the
     * corpus pad resolves a click to one grain — a sample-accurate offset into
     * the tape — and a step of 0.001 buckets the whole partition into 1000
     * positions. Two adjacent grains land in the same bucket, `changed` comes
     * out false, and the listener that writes `/zone/grain/0/pos` never runs,
     * so the second click does nothing at all. Dropping `step` entirely would
     * fix the snap but hand shift-drag `param.step ?? 1` — a full-range jump —
     * so the increment has to stay and only the quantization goes.
     */
    this.snap = config.snap !== false;

    this._value = config.value ?? this.min;
    this._target = this._value; // slew target
    this.defaultValue = this._value;

    // Controller assignment — set by ControllerManager
    this.controller = null; // { type, ...config } — primary controller
    this.xControllers = []; // external mapping controllers (controller-of-controller)
    this.table = null; // response curve table name (string)

    // Flags
    /**
     * A SETUP ACT, not performance state — and therefore **never a controller
     * target** (audio blueprint §8.6).
     *
     * §8.6 wrote that rule down for the monitoring switch and said exactly why:
     * *"a switch that changes defaults is exactly the kind of control that
     * drifts into being controller-assignable when nobody records that it must
     * not be."* Recording it in prose is not enough — nothing in this file made
     * it possible to express, so the rule had no way to be true. This flag is
     * the rule, enforced at `ControllerManager.assign()`, which is the single
     * choke point every assignment path goes through.
     *
     * `group: 'global'` and `setup: true` answer different questions and a param
     * can need both: 'global' keeps a value out of a Display State, while this
     * keeps a CONTROLLER off the parameter. `audio.tapeSec` is global because
     * recalling it would discard a tape; it is not marked setup, because sweeping
     * it with an LFO is merely useless rather than a hazard to the performer.
     * The distinction is what stops this flag becoming a synonym for 'global'
     * and getting applied by habit.
     */
    this.setup = config.setup ?? false;
    this.select = config.select ?? false; // force native <select> dropdown regardless of option count
    this.invert = false;
    this.cycle = false; // for SELECT: cycle on trigger
    this.slew = 0; // 0=instant, 0.001–1.0 seconds (lag time)
    // Slew response curve. 'lag' = one-pole exponential (fast start, asymptotic
    // finish — the historical behaviour, kept as the default so saved states
    // recall identically). 'ease' = critically damped spring: velocity starts
    // at zero and returns to zero, so a stepped source (S+H, Random, Square)
    // accelerates into each move and decelerates out of it.
    this.slewShape = "lag";
    this._slewVel = 0; // spring velocity, 'ease' shape only
    this._slewFrom = this._value; // segment start value, SLEW_CURVES shapes only
    this._slewK = 1; // segment progress 0–1; 1 = settled, no segment in flight
    // TRUE spring position, which may sit outside [min,max] while an overshoot
    // is being clipped. Reading the published (clamped) value back into the
    // integrator instead feeds it a position it never reached: at the top of
    // the range the spring is told it is at max with the velocity it had at
    // 1.19, so it keeps pushing outward, is clipped again, and the ring never
    // comes back — measured as 78 frames pinned flat against the limit.
    this._slewX = this._value;
    // 'elastic' spring shape. Stiffness and damping ratio are THE two constants
    // of a spring and they are orthogonal: Damp alone sets how far it throws
    // past the target and how many times it rings, Strength alone sets how
    // tight and fast that ringing is inside the time `slew` asks for.
    this.slewStrength = 1;
    this.slewDamp = ELASTIC_ZETA;
    this.ctrlMin = null; // controller output range override (null = param.min)
    this.ctrlMax = null; // controller output range override (null = param.max)
    this.feedbackVisible = config.feedbackVisible ?? false;
    this.feedbackPos = config.feedbackPos ?? { x: 20, y: 60 };

    // Modifier combos for mouse controller (ImOs9 style: up to 32 combos)
    this.mouseModifiers = config.mouseModifiers ?? "";

    this._listeners = new Set();
    this._triggerListeners = new Set();
    this.locked = false; // when true, value cannot be changed by UI/controllers
  }

  // ── Value access ────────────────────────────────────────────────────────

  get value() {
    return this._value;
  }

  set value(v) {
    if (this.locked) return;
    let clamped;
    if (this.type === PARAM_TYPE.TOGGLE) {
      clamped = v ? 1 : 0;
    } else if (this.type === PARAM_TYPE.SELECT) {
      clamped = Math.max(
        0,
        Math.min((this.options?.length ?? 1) - 1, Math.round(v)),
      );
    } else {
      clamped = Math.max(this.min, Math.min(this.max, v));
      if (this.step && this.snap) clamped = Math.round(clamped / this.step) * this.step;
    }

    const changed = clamped !== this._value;
    this._value = clamped;
    // Keep _target in sync so slew doesn't fight manual UI / direct .value writes
    if (this.type === PARAM_TYPE.CONTINUOUS) {
      this._target = clamped;
      // A manual write is a teleport, not a glide: kill the spring and retire
      // any segment in flight so the next controller move starts from here.
      this._slewVel = 0;
      this._slewFrom = clamped;
      this._slewX = clamped;
      this._slewK = 1;
    }

    if (changed || this.type === PARAM_TYPE.TRIGGER) {
      this._listeners.forEach((fn) => fn(clamped, this));
    }
    if (this.type === PARAM_TYPE.TRIGGER && changed) {
      this._triggerListeners.forEach((fn) => fn(this));
    }
  }

  /**
   * Snap quantum for controller-driven writes.
   *
   * `step` does double duty: it is the UI drag/arrow increment AND, via the
   * `value` setter, a hard quantization of the stored value. For a param with
   * step 0.01 over a 0–1 range that is only 100 distinct positions, and a slow
   * LFO crosses them slowly. Measured over 10 s at 60 fps on such a param, a
   * sine LFO used to change the value on:
   *
   *     1 Hz → 560/600 frames      0.1 Hz → 200/600
   *     0.01 Hz → 30/600           0.001 Hz → 4/600
   *
   * So at 0.01 Hz the picture advanced ~3 times a second and read as a stutter,
   * while the frame rate sat at a healthy 60 the entire time — which is exactly
   * why the fps counter never showed the problem. The parameter was stepping,
   * not the renderer.
   *
   * Integer steps are different in kind: octaves, line counts, sdf.count and
   * friends ARE integers, and a controller sweeping them SHOULD step. So a
   * step of 1 or more still snaps; anything finer is treated as a UI increment
   * only and modulation runs at full float resolution.
   */
  get _modStep() {
    return this.step >= 1 ? this.step : 0;
  }

  /**
   * Write from a controller. Same clamping as the `value` setter but obeying
   * `_modStep` instead of `step`, so slow modulation stays smooth.
   */
  _setModulated(v) {
    if (this.locked) return;
    let clamped = Math.max(this.min, Math.min(this.max, v));
    const q = this._modStep;
    if (q) clamped = Math.round(clamped / q) * q;
    this._target = clamped;
    this._slewVel = 0;
    this._slewFrom = clamped;
    this._slewX = clamped;
    this._slewK = 1;
    if (clamped === this._value) return;
    this._value = clamped;
    this._listeners.forEach((fn) => fn(clamped, this));
  }

  /**
   * Value ↔ 0–1 mapping for CONTINUOUS params. Linear unless the param declares
   * `curve: 'exp'`, which makes equal travel give equal RATIO rather than equal
   * difference — the way distance, rate and scale are actually perceived, where
   * 1→2 is the same move as 10→20. Without it, a 0.1–100 control spends 90% of
   * its throw above 10 and cannot be placed at all down where the work happens.
   *
   * Needs a positive low bound: a ratio mapping cannot reach or cross zero. Any
   * param that fails that falls back to linear rather than producing NaN, so a
   * mis-declared curve degrades instead of breaking.
   *
   * These two MUST stay exact inverses — the slider reads one and writes the
   * other, so a mismatch shows up as the thumb drifting on release.
   */
  toNorm(v, lo = this.min, hi = this.max) {
    if (this.curve !== 'exp' || lo <= 0 || hi <= lo) return (v - lo) / (hi - lo);
    return Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo);
  }
  fromNorm(n, lo = this.min, hi = this.max) {
    if (this.curve !== 'exp' || lo <= 0 || hi <= lo) return lo + n * (hi - lo);
    return lo * Math.pow(hi / lo, n);
  }

  // Normalized value in [0, 1]
  get normalized() {
    if (this.type === PARAM_TYPE.TOGGLE) return this._value;
    if (this.type === PARAM_TYPE.SELECT)
      return this._value / Math.max(1, (this.options?.length ?? 1) - 1);
    return this.toNorm(this._value);
  }

  /**
   * Called by controllers. n is normalized 0–1.
   * Applies invert and table before remapping to [min, max].
   */
  setNormalized(n, table = null) {
    let applied = this.invert ? 1 - n : n;
    // No explicit table from the caller → self-resolve the assigned one
    const t = table ?? _resolveTable(this);
    if (t) applied = t.apply(applied);
    if (this.type === PARAM_TYPE.TOGGLE) {
      this.value = applied > 0.5 ? 1 : 0;
    } else if (this.type === PARAM_TYPE.SELECT) {
      // ctrlMin/ctrlMax clamp the controller sweep to an index sub-range
      // (re-clamped to the live list length — options can shrink at runtime)
      const last = (this.options?.length ?? 1) - 1;
      const lo = Math.max(0, Math.min(last, Math.round(this.ctrlMin ?? 0)));
      const hi = Math.max(lo, Math.min(last, Math.round(this.ctrlMax ?? last)));
      this.value = lo + Math.round(applied * (hi - lo));
    } else {
      const lo = this.ctrlMin ?? this.min;
      const hi = this.ctrlMax ?? this.max;
      // Honours `curve` so a controller sweeps the same taper the fader does —
      // otherwise an LFO on a curved param moves differently from a hand on it.
      const target = this.fromNorm(applied, lo, hi);
      if (this.slew > 0) {
        // Arm a new segment ONLY when the previous one has landed. While a
        // segment is in flight the target may move freely — tickSlew re-aims at
        // it without touching the clock. Restarting the clock on every target
        // change instead is the trap documented in
        // tests/audit-modulation-resolution.mjs: a sine retargets every frame,
        // so the segment would restart every frame and the value would freeze
        // at k=0 forever.
        // Filters have no segment to arm — leaving _slewK at 0 for them would
        // block the early-out in tickSlew and fire listeners forever.
        if (SLEW_CURVES[this.slewShape] && this._slewK >= 1 && target !== this._target) {
          this._slewFrom = this._value;
          this._slewK = 0;
        }
        this._target = target; // defer to tickSlew
      } else {
        this._setModulated(target);
      }
    }
  }

  /** Called each frame with dt in seconds. Advances slewed params. */
  tickSlew(dt) {
    if (this.slew <= 0 || this.type !== PARAM_TYPE.CONTINUOUS) return;
    // _slewK < 1 keeps a segment alive even when value momentarily equals the
    // target — which happens mid-flight on every curve that overshoots.
    if (this._target === this._value && this._slewVel === 0 && this._slewK >= 1) return;

    // Bypass the value setter so _target is preserved during the glide.
    let next;
    const curve = SLEW_CURVES[this.slewShape];
    if (curve) {
      // Segment curve: advance the clock, then interpolate from the captured
      // start to the LIVE target. Re-aiming rather than restarting is what lets
      // a bounce survive a target that drifts while the bounce is happening.
      this._slewK = Math.min(1, this._slewK + dt / Math.max(0.001, this.slew));

      // Fit the excursions to the headroom that actually exists.
      //
      // Back dips below its start before setting off and rises past its target
      // on arrival, each by about a tenth of the move. Neither is possible when
      // the move begins or ends on a rail, and simply letting the [min,max]
      // clamp eat it costs more than the shape: a move starting at min sat
      // FROZEN for ten frames at 60fps while the curve tried to travel below
      // zero. "Nothing happens for a sixth of a second" is not a subtler
      // anticipation, it is a stall.
      //
      // So each lobe is scaled to the room in front of it, and the opening dip
      // is scaled in TIME as well — squeezed into proportionally less of the
      // segment, vanishing entirely when there is no room at all. The value
      // then leaves immediately instead of waiting out a dip it cannot make.
      // The time warp is piecewise linear and pinned at both ends, so k=0 still
      // maps to the start value and k=1 still lands exactly on the target.
      const curveStrength = SLEW_CURVE_HAS_STRENGTH[this.slewShape]
        ? Math.max(0, Math.min(3, this.slewStrength ?? 1))
        : 1;
      const ex = slewExcursion(this.slewShape, curveStrength);
      const d = this._target - this._slewFrom;
      const mag = Math.abs(d);
      let k = this._slewK;
      let sUnder = 1;

      if (ex.under > 0 && mag > 0) {
        // Room on the far side of the start, i.e. against the direction of travel.
        const room = d > 0 ? this._slewFrom - this.min : this.max - this._slewFrom;
        sUnder = Math.min(1, Math.max(0, room) / (mag * ex.under));
        const kA = ex.k0 * sUnder;
        k = k < kA
          ? (k / kA) * ex.k0                              // dip, compressed in time
          : ex.k0 + ((k - kA) / (1 - kA)) * (1 - ex.k0);  // the rest, stretched back out
      }

      let f = curve(k, curveStrength);
      if (f < 0) {
        f *= sUnder;
      } else if (f > 1 && ex.over > 0 && mag > 0) {
        // Room beyond the target, in the direction of travel.
        const room = d > 0 ? this.max - this._target : this._target - this.min;
        const sOver = Math.min(1, Math.max(0, room) / (mag * ex.over));
        f = 1 + (f - 1) * sOver;
      }
      next = this._slewFrom + d * f;
    } else if (this.slewShape === "elastic") {
      // UNDERDAMPED spring — the same physics as 'ease' with the damping ratio
      // taken below 1, so it overshoots and rings instead of settling straight
      // in. Being a spring rather than a timed curve is the point:
      //
      //   * it starts from REST. The textbook easeOutElastic this replaced
      //     covered 39% of the whole move in its first frame at 60fps, against
      //     under 1% for every other curve here. It was a snap with a wobble
      //     after it, which is the opposite of what a slew curve is for.
      //   * ~19% first overshoot instead of 37%. On a bounded parameter the old
      //     figure mostly went into the min/max clamp rather than the picture.
      //   * it tracks a moving target, so it belongs with the filters and works
      //     on a swept LFO, not only on stepped sources.
      //
      // Semi-implicit Euler, substepped so stiffness cannot outrun the frame:
      // the closed form used for 'ease' is a critically-damped-only identity
      // and does not generalise to zeta < 1.
      const zeta = Math.max(ELASTIC_DAMP_MIN,
        Math.min(ELASTIC_DAMP_MAX, this.slewDamp ?? ELASTIC_ZETA));
      const strength = Math.max(ELASTIC_STRENGTH_MIN,
        Math.min(ELASTIC_STRENGTH_MAX, this.slewStrength ?? 1));
      const dtc = Math.min(dt, 0.05);
      const omega = (ELASTIC_OMEGA * strength) / Math.max(0.001, this.slew);
      const sub = Math.max(1, Math.ceil((dtc * omega) / 0.3));
      const h = dtc / sub;
      // The spring COLLIDES with min/max rather than being quietly clipped
      // against them. Overshoot is a fraction of the MOVE, so a big move
      // landing near a rail throws far past it — measured 21 straight frames
      // parked flat on the limit, which is where "elastic does nothing at the
      // extremes" comes from. A collision that reverses the velocity and keeps
      // some of it turns that into a visible bounce off the end stop: 1 frame.
      // Restitution follows Damp, so a springier spring bounces more springily
      // and a fully damped one (Damp 1) does not bounce at all.
      const rest = Math.max(0, 1 - zeta);
      const lo = this.min;
      const hi = this.max;
      let x = this._slewX;
      let v = this._slewVel;
      for (let i = 0; i < sub; i++) {
        v += (-2 * zeta * omega * v - omega * omega * (x - this._target)) * h;
        x += v * h;
        if (x > hi) { x = hi; if (v > 0) v = -v * rest; }
        else if (x < lo) { x = lo; if (v < 0) v = -v * rest; }
      }
      this._slewVel = v;
      this._slewX = x;
      next = x; // the caller clamps for display; the spring keeps the truth
      // Park it, same as 'ease', so the early-out can fire and the ring does
      // not idle forever a hair off the target.
      const span = this.max - this.min;
      if (Math.abs(next - this._target) < span * 1e-5 &&
          Math.abs(this._slewVel) < span * 1e-3) {
        next = this._target;
        this._slewVel = 0;
        this._slewX = this._target;
      }
    } else if (this.slewShape === "ease") {
      // Critically damped spring. Carrying VELOCITY across frames is what buys
      // the ease-in: at the instant a stepped source jumps, velocity is still
      // zero, so the move starts slowly, builds, then settles without
      // overshoot. A one-pole lag cannot do this — its velocity is largest at
      // the very first frame, which is exactly the hard snap S+H suffers from.
      // Tracking a smoothly-moving target (a sine) still works: the spring
      // simply trails it, so this is not a stepped-source-only mode.
      const dtc = Math.min(dt, 0.05); // frame hitches must not blow up the filter
      const omega = 2 / Math.max(0.001, this.slew); // ≈ settle time = slew
      const x = this._value - this._target;
      const od = omega * dtc;
      const exp =
        1 / (1 + od + 0.48 * od * od + 0.235 * od * od * od);
      const temp = (this._slewVel + omega * x) * dtc;
      this._slewVel = (this._slewVel - omega * temp) * exp;
      next = this._target + (x + temp) * exp;
      // Park the spring once it is inside float noise of the target, so the
      // early-out above can fire and we stop burning listeners forever.
      if (Math.abs(next - this._target) < (this.max - this.min) * 1e-5 &&
          Math.abs(this._slewVel) < (this.max - this.min) * 1e-3) {
        next = this._target;
        this._slewVel = 0;
      }
    } else {
      // Exponential lag: approach target at rate 1/slew per second.
      const alpha = Math.min(1, dt / Math.max(0.001, this.slew));
      next = this._value + (this._target - this._value) * alpha;
    }
    const clamped = Math.max(this.min, Math.min(this.max, next));
    if (clamped !== this._value) {
      this._value = clamped;
      this._listeners.forEach((fn) => fn(clamped, this));
    }
  }

  toggle() {
    if (this.type === PARAM_TYPE.TOGGLE) this.value = this._value ? 0 : 1;
  }

  trigger() {
    if (this.type !== PARAM_TYPE.TRIGGER) return;
    this._value = 0; // ensure changed=true so listeners always fire
    this.value = 1;
  }

  cycleNext() {
    if (this.type === PARAM_TYPE.SELECT && this.options) {
      this.value = (this._value + 1) % this.options.length;
    }
  }

  // ── Subscriptions ────────────────────────────────────────────────────────

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  onTrigger(fn) {
    this._triggerListeners.add(fn);
    return () => this._triggerListeners.delete(fn);
  }

  /** Fire onChange listeners immediately (e.g. after badge assignment). */
  notify() {
    this._listeners.forEach((fn) => fn(this._value, this));
  }

  // ── Display ──────────────────────────────────────────────────────────────

  get displayValue() {
    const v = this._value;
    if (this.type === PARAM_TYPE.TOGGLE) return v ? "●" : "○";
    if (this.type === PARAM_TYPE.TRIGGER) return "▶";
    if (this.type === PARAM_TYPE.SELECT) return this.options?.[v] ?? v;
    // Decimals must resolve the STEP, not only the range. Picking from the
    // range alone means a param quantised finer than its row can print shows a
    // column of identical numbers while the value genuinely moves — which is
    // indistinguishable from a dead control, and makes the readout useless as
    // a verification instrument (agrain.pos, step 0.001 on a 0–1 range, is the
    // case this was learned on). Take whichever is finer; capped at 4 so a
    // tiny step cannot stretch the row, and floored at the old result so no
    // existing readout ever loses precision.
    const rangeDec = this.max - this.min > 10 ? 1 : 2;
    const stepDec  = this.step > 0 ? Math.ceil(-Math.log10(this.step)) : 0;
    const decimals = Math.min(4, Math.max(rangeDec, stepDec));
    return v.toFixed(decimals) + (this.unit ? " " + this.unit : "");
  }

  get controllerLabel() {
    if (!this.controller) return "—";
    const c = this.controller;
    const labels = {
      "mouse-x": "MX",
      "mouse-y": "MY",
      "tilt-x": "TLX",
      "tilt-y": "TLY",
      "compass": "CMP",
      "midi-cc": c.channel
        ? `${c.channel}:CC${c.cc ?? "?"}`
        : `CC${c.cc ?? "?"}`,
      "midi-note": c.channel
        ? `${c.channel}:N${c.note ?? "?"}`
        : `N${c.note ?? "?"}`,
      // One CC per option. The badge reports how many options are BOUND, not
      // how many exist — a half-mapped bank is a normal intermediate state
      // while you are learning buttons one at a time, and it should look
      // different from a finished one.
      "midi-cc-map": (() => {
        const n = (c.ccs ?? []).filter((x) => x != null).length;
        return c.channel ? `${c.channel}:CC×${n}` : `CC×${n}`;
      })(),
      "lfo-sine": "LFO~",
      "lfo-triangle": "LFO△",
      "lfo-sawtooth": "LFO⊿",
      "lfo-rampdown": "LFO↘",
      "lfo-square": "LFO▭",
      "lfo-sh": "S+H",
      sound: "SND",
      "sound-bass": "BAS",
      "sound-mid": "MID",
      "sound-high": "HIG",
      random: "RND",
      fixed: "FXD",
      key: `KEY:${c.key ?? "?"}`,
      nudge: "NDG",
      "movie-pos": "MVP",
      osc: "OSC",
      expr: `ƒ(t)`,
      "monty-saccade-x": "MX",
      "monty-saccade-y": "MY",
      "monty-confidence": "MC",
      "monty-pe": "MP",
    };
    if (c.type.startsWith('stroke-')) {
      const parts = c.type.split('-');
      return `S${parts[1] ?? '?'}${(parts[2] ?? 'x').toUpperCase()}`;
    }
    return labels[c.type] ?? c.type.toUpperCase().slice(0, 4);
  }

  get controllerClass() {
    // A setup act (§8.6) can never have a controller, so its badge is inert
    // rather than merely unassigned. Returned from HERE rather than added to the
    // element by the row builder: `updateDisplay()` rewrites `className`
    // wholesale from this getter, so a `classList.add` outside it survives until
    // the first refresh and then silently vanishes. Making it part of the source
    // of truth is the only version that stays true.
    if (this.setup) return "param-ctrl-setup";
    if (!this.controller) return "";
    const t = this.controller.type;
    if (t.startsWith("lfo")) return "lfo";
    if (t.startsWith("midi")) return "midi";
    if (t.startsWith("mouse")) return "mouse";
    if (t.startsWith("sound")) return "sound";
    if (t.startsWith("monty")) return "monty";
    if (t.startsWith("stroke")) return "stroke";
    return "assigned";
  }

  // ── Serialization ────────────────────────────────────────────────────────

  reset() {
    this.value = this.defaultValue;
  }

  serialize() {
    return {
      id: this.id,
      value: this._value,
      controller: this.controller ? { ...this.controller } : null,
      xControllers: this.xControllers.length
        ? this.xControllers.map((xc) =>
            xc ? { ...xc, _fn: undefined, _rState: undefined } : null,
          )
        : undefined,
      table: this.table,
      ctrlMin: this.ctrlMin,
      ctrlMax: this.ctrlMax,
      invert: this.invert,
      cycle: this.cycle,
      slew: this.slew,
      slewShape: this.slewShape,
      slewStrength: this.slewStrength,
      slewDamp: this.slewDamp,
      feedbackVisible: this.feedbackVisible,
      feedbackPos: { ...this.feedbackPos },
    };
  }

  deserialize(data) {
    /**
     * **Nothing in a file may set a setup act — not even its value.**
     *
     * The narrow reason is a hole: this method writes `this.controller` and
     * `this.xControllers` DIRECTLY, so it is an attachment path that never goes
     * near `ControllerManager.assign()`. Guarding only `assign()` — which step 10
     * did, while claiming it was "the one function every path reaches" — left a
     * saved or hand-edited project able to reattach exactly what the UI refuses.
     * That is verbatim the failure the flag exists to prevent.
     *
     * The broader reason is why the VALUE is dropped too, which is not merely
     * caution. A setup act describes the physical situation the session is
     * running in, and a file cannot know that: a project authored in a studio on
     * headphones, opened at a venue on a PA, would restore "Headphones" and
     * silently suppress the one warning that matters there. §8.6 says fixed at
     * SESSION start, and a session is not a project. Combined with `group:
     * 'global'` keeping it out of Display States, nothing persisted can move it.
     */
    if (this.setup) return;
    if (data.value !== undefined) this.value = data.value;
    if (data.controller !== undefined) this.controller = data.controller;
    if (data.xControllers !== undefined) {
      this.xControllers = (data.xControllers ?? []).map((xc) =>
        xc ? { ...xc } : null,
      );
    }
    if (data.table !== undefined) this.table = data.table;
    if (data.ctrlMin !== undefined) this.ctrlMin = data.ctrlMin;
    if (data.ctrlMax !== undefined) this.ctrlMax = data.ctrlMax;
    if (data.invert !== undefined) this.invert = data.invert;
    if (data.cycle !== undefined) this.cycle = data.cycle;
    if (data.slew !== undefined) this.slew = data.slew;
    // Files written before eased slew existed have no slewShape — 'lag' is the
    // historical curve, so an old state recalls exactly as it did. An unknown
    // name (a state from a newer build) also falls back rather than throwing.
    // Absent in files written before the spring was adjustable — the defaults
    // reproduce exactly what those files sounded like.
    if (Number.isFinite(data.slewStrength)) this.slewStrength = data.slewStrength;
    if (Number.isFinite(data.slewDamp)) this.slewDamp = data.slewDamp;
    this.slewShape = SLEW_SHAPES.includes(data.slewShape)
      ? data.slewShape
      : "lag";
    if (data.feedbackVisible !== undefined)
      this.feedbackVisible = data.feedbackVisible;
    if (data.feedbackPos !== undefined) this.feedbackPos = data.feedbackPos;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ParameterSystem
// ─────────────────────────────────────────────────────────────────────────────

export class ParameterSystem extends EventTarget {
  constructor() {
    super();
    this.params = new Map(); // id → Parameter
    this.groups = new Map(); // groupName → [paramId, ...]
    this._allParams = [];
    this._allParamsDirty = true;
  }

  /**
   * Register a parameter. Returns the Parameter instance.
   */
  register(config) {
    const p = new Parameter(config);
    this.params.set(p.id, p);
    this._allParamsDirty = true;
    // Identity, not a name test: only the shared CAPTURE_SOURCES array carries
    // the indirect tail that migrateCaptureBase() has to keep in register.
    if (config.options === CAPTURE_SOURCES) CAPTURE_PARAM_IDS.push(p.id);
    if (p.group) {
      if (!this.groups.has(p.group)) this.groups.set(p.group, []);
      this.groups.get(p.group).push(p.id);
    }
    return p;
  }

  get(id) {
    return this.params.get(id);
  }
  has(id) {
    return this.params.has(id);
  }
  getAll() {
    if (this._allParamsDirty) {
      this._allParams = [...this.params.values()];
      this._allParamsDirty = false;
    }
    return this._allParams;
  }

  getGroup(name) {
    return (this.groups.get(name) ?? [])
      .map((id) => this.params.get(id))
      .filter(Boolean);
  }

  set(id, value) {
    const p = this.params.get(id);
    if (p) p.value = value;
    else console.warn(`[ParameterSystem] Unknown param: ${id}`);
  }

  setNormalized(id, n, table = null) {
    const p = this.params.get(id);
    if (!p) return;
    // Table resolution happens inside Parameter.setNormalized (_resolveTable)
    p.setNormalized(n, table);
  }

  toggle(id) {
    this.params.get(id)?.toggle();
  }
  trigger(id) {
    this.params.get(id)?.trigger();
  }

  /** Advance all slewed parameters. Call once per frame. */
  tickSlew(dt) {
    this.params.forEach((p) => p.tickSlew(dt));
  }

  // ── State snapshots ──────────────────────────────────────────────────────

  captureState() {
    const s = {};
    this.params.forEach((p, id) => {
      // Skip 'global' group — BPM, morph speed etc. are session-level settings,
      // not per-State snapshots.
      if (p.group !== 'global') s[id] = p.value;
    });
    return s;
  }

  restoreState(state) {
    Object.entries(state).forEach(([id, v]) => {
      const p = this.params.get(id);
      // Guard: skip global params even if present in old saved states
      if (p && p.group !== 'global') this.set(id, v);
    });
    this.dispatchEvent(new CustomEvent("stateRestored", { detail: state }));
  }

  // ── Preset serialization ─────────────────────────────────────────────────

  serializeControllers() {
    const r = {};
    this.params.forEach((p, id) => {
      if (
        p.controller ||
        p.table ||
        p.invert ||
        p.xControllers.length ||
        p.ctrlMin !== null ||
        p.ctrlMax !== null
      ) {
        const s = p.serialize();
        // Fixed controllers store a normalized value that can drift out of sync
        // if the param is later dragged manually. Sync it to the actual value
        // before saving so recall always restores the correct position.
        if (s.controller?.type === 'fixed' && p.max !== p.min) {
          const norm = (p._value - p.min) / (p.max - p.min);
          s.controller = { ...s.controller, value: norm };
        }
        r[id] = s;
      }
    });
    return r;
  }

  /**
   * Controller records with the VALUE removed — what a session autosave wants.
   *
   * `serialize()` carries `value`, and `deserialize()` applies it, so persisting
   * the controller bag persists the current value of every mapped parameter
   * too. That is right for a preset, a bank and a project, which are all
   * snapshots of a performance. It is wrong for "remember my MIDI", which
   * should restore what the hardware is wired to and nothing else — see
   * src/state/MappingAutosave.js.
   */
  serializeMappings() {
    const r = this.serializeControllers();
    for (const id of Object.keys(r)) {
      const { value, ...rest } = r[id];
      r[id] = rest;
    }
    return r;
  }

  deserializeControllers(data) {
    Object.entries(data).forEach(([id, d]) => {
      const p = this.params.get(id);
      if (p) p.deserialize(d);
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Canonical source list — THE single origin (Phase 23 Step 1)
// ─────────────────────────────────────────────────────────────────────────────
// Every layer/capture source in the instrument, in index order.
//
// APPEND-ONLY, FOREVER: SELECT values persist as integer indices into this
// array (layer.fg/bg/ds, td.captureSource, and every saved state, bank and
// .imweb file). Inserting anywhere but the true end silently re-routes every
// saved state on earth. Append at the end; never reorder; never delete.
//
// `label` is what the user sees. `key` is the inputs-bag key used by
// Pipeline._resolveSource() and main.js _resolveLayerTex(). Two keys are NOT
// in the inputs bag and resolve specially at each call site:
//   'output' → pipeline.prev.texture   (post-composite feedback)
//   'mixbus' → pipeline.mixTexture     (dedicated MixBus target)
//
// Derive from this — do NOT hand-copy it. Six hand-synced copies existed
// before this consolidation and three had drifted, silently breaking
// TimeDisplace capture and the AI Narrator for sources 25/26.
export const SOURCE_DEFS = [
  { key: "camera",    label: "Camera"    }, //  0
  { key: "movie",     label: "Movie A"   }, //  1
  { key: "buffer",    label: "Buffer"    }, //  2
  { key: "color",     label: "Color"     }, //  3
  { key: "color2",    label: "Color2"    }, //  4
  { key: "noise",     label: "Noise"     }, //  5
  { key: "scene3d",   label: "3D Scene"  }, //  6
  { key: "draw",      label: "Draw"      }, //  7
  { key: "output",    label: "Output"    }, //  8  — not in inputs bag
  { key: "bg1",       label: "BG1"       }, //  9
  { key: "bg2",       label: "BG2"       }, // 10
  { key: "text",      label: "Text"      }, // 11
  { key: "sound",     label: "Sound"     }, // 12
  { key: "delay",     label: "Delay"     }, // 13
  { key: "scope",     label: "Scope"     }, // 14
  { key: "slitscan",  label: "SlitScan"  }, // 15
  { key: "particles", label: "Particles" }, // 16
  { key: "seq1",      label: "Seq1"      }, // 17
  { key: "seq2",      label: "Seq2"      }, // 18
  { key: "seq3",      label: "Seq3"      }, // 19
  { key: "depth3d",   label: "3D Depth"  }, // 20
  { key: "sdf",       label: "SDF"       }, // 21
  // 22 — "Warp Tape", not "Vasulka Warp": the honorific moved to the panel
  // FAMILY (Sources ▸ From the Signal ▸ Warp), which holds all four engines that
  // invert time into space. Labels may change freely; indices may not.
  // Longer than the "Tape" subsection header on purpose — this one has to stand
  // alone in a flat source dropdown next to Camera, Movie, Noise, SDF.
  { key: "vwarp",     label: "Warp Tape" },    // 22
  { key: "analog",    label: "Analog"    }, // 23
  { key: "tdisp",     label: "TimeDisp"  }, // 24
  { key: "movieB",    label: "Movie B"   }, // 25
  { key: "mixbus",    label: "Mix 1"     }, // 26 — not in inputs bag
  { key: "mixbus2",   label: "Mix 2"     }, // 27 — not in inputs bag
  { key: "mixbus3",   label: "Mix 3"     }, // 28 — not in inputs bag
  // 29 — the Rutt-Etra Scan Processor (1972). Appended at the true end, and the
  // indirect capture entries that used to sit at 29 moved with it, kept in
  // register by the base stamp in migrateCaptureBase().
  { key: "rutt",      label: "Rutt-Etra" }, // 29
  // 30 — the raymarcher's depth, packed into its colour target's alpha and
  // expanded by a blit. Not a second raymarch: WebGL 1 has no MRT here.
  { key: "sdfdepth",  label: "SDF Depth" }, // 30
  // 31 — per-channel time offset over the Video Delay ring. Appended at the
  // true end; the indirect capture entries that sat at 31 move with it, kept in
  // register by the base stamp in migrateCaptureBase().
  { key: "rgbdelay",  label: "RGB Delay" }, // 31
  // 32 — the motion matte. White where the picture moves, black where it does
  // not; meant for the keyer's key source rather than for looking at directly.
  { key: "motion",    label: "Motion"    }, // 32
];

/** Source indices of the three mix buses, in evaluation order (1 → 2 → 3). */
export const MIXBUS_IDX = [26, 27, 28];

/**
 * Display sequence for every source dropdown (layer.fg/bg/ds,
 * td.captureSource, mix*.srcA/srcB) — Phase 24 taxonomy order, so the menu
 * reads like the Sources tab instead of like the raw array.
 *
 * PRESENTATION ONLY. These are indices INTO SOURCE_DEFS; the value a SELECT
 * stores and persists is still the true index, so reordering here can never
 * re-route a saved state. Entries are an index, or { header } for a
 * non-clickable group label. Any source omitted here simply would not be
 * listed — the assertion below keeps that from happening silently.
 */
export const SOURCE_DISPLAY_ORDER = [
  { header: "Live In" },        0 /* Camera */, 12 /* Sound */,
  { header: "Media" },          1 /* Movie A */, 25 /* Movie B */, 2 /* Buffer */,
                                9 /* BG1 */, 10 /* BG2 */,
  { header: "Generators" },     3 /* Color */, 4 /* Color2 */, 5 /* Noise */,
                                16 /* Particles */, 21 /* SDF */, 30 /* SDF Depth */,
                                11 /* Text */,
                                7 /* Draw */, 6 /* 3D Scene */, 20 /* 3D Depth */,
                                23 /* Analog */, 29 /* Rutt-Etra */,
  { header: "From the Signal" }, 8 /* Output */, 13 /* Delay */, 31 /* RGB Delay */,
                                32 /* Motion */, 24 /* TimeDisp */,
                                15 /* SlitScan */, 17 /* Seq1 */, 18 /* Seq2 */,
                                19 /* Seq3 */, 14 /* Scope */, 22 /* VWarp */,
  { header: "Mix" },            26 /* Mix 1 */, 27 /* Mix 2 */, 28 /* Mix 3 */,
];

// Fail loudly at load if a source is missing from the display order, rather
// than quietly vanishing from every dropdown.
{
  const listed = SOURCE_DISPLAY_ORDER.filter((e) => typeof e === "number");
  const missing = SOURCE_DEFS.map((_, i) => i).filter((i) => !listed.includes(i));
  if (missing.length || new Set(listed).size !== listed.length) {
    throw new Error(
      `SOURCE_DISPLAY_ORDER must list every source exactly once — missing: [${missing}]`,
    );
  }
}

/** Display labels, index-aligned to SOURCE_DEFS. SELECT options array. */
export const SOURCES = SOURCE_DEFS.map((s) => s.label);

/** inputs-bag keys, index-aligned to SOURCE_DEFS. */
export const SOURCE_KEYS = SOURCE_DEFS.map((s) => s.key);

/**
 * Indirect entries appended to the capture-source lists: "whatever that layer is
 * currently showing" rather than a fixed source.
 *
 * They are NOT sources and must never enter SOURCE_DEFS — `layer.fg = "FG Src"`
 * would be self-referential nonsense, and SOURCE_DEFS is what the layer selectors
 * are built from. They live only in CAPTURE_SOURCES below.
 *
 * Precedent: the particle luma mask has offered "FG Src / BG Src / DS Src" all
 * along (`_pmSrcMap` in main.js), and the SDF's texture source uses FG at index 0.
 * The idea existed; the newer capture selectors just did not expose it.
 */
export const CAPTURE_INDIRECT = ["FG Src", "BG Src", "DS Src"];

/**
 * Options for selectors that choose what an ENGINE records or samples —
 * td.captureSource, td.mapSource, slitscan.source, vwarp.source, delay.source.
 *
 * APPEND-ONLY, and appended AFTER the full source list, so every index 0..28
 * keeps the meaning it has in every saved state, bank, .imweb file and MIDI
 * mapping. Indices 29-31 are the indirect entries, resolved through the layer
 * they name at read time.
 */
export const CAPTURE_SOURCES = [...SOURCES, ...CAPTURE_INDIRECT];

/** First indirect index — anything >= this is a layer reference, not a source. */
export const CAPTURE_INDIRECT_BASE = SOURCES.length;

/**
 * particle.masksrc option index → CAPTURE_SOURCES index (null = "None").
 *
 * The luma mask carried an eleven-entry hand-written menu (None, Camera, Movie,
 * Buffer, Output, Draw, FG/BG/DS Src, Noise, Vectorscope) while every other
 * selector grew to the full source list — so masking particles with SDF, Motion,
 * a mix bus or Movie B was simply not expressible.
 *
 * Indices 0..10 are FROZEN in their v0.11 order: they persist as integers in
 * every saved state, bank and .imweb file, and in MIDI mappings. Everything new
 * is APPENDED, in SOURCE_DISPLAY_ORDER sequence so the menu reads like the
 * Sources tab. Labels come from CAPTURE_SOURCES, so the two legacy labels move
 * to the canonical ones ("Movie" → "Movie A", "Vectorscope" → "Scope") — labels
 * may change freely, indices may not.
 *
 * Particles itself is deliberately absent: it is the consumer, so the entry
 * could only ever resolve to null through _notSelf(). Reach it through
 * FG/BG/DS Src if you ever want that.
 */
export const PARTICLE_MASK_SRC = [
  // ── frozen v0.11 head ──
  null,                        //  0  None
  0,                           //  1  Camera
  1,                           //  2  Movie   → Movie A
  2,                           //  3  Buffer
  8,                           //  4  Output
  7,                           //  5  Draw
  CAPTURE_INDIRECT_BASE + 0,   //  6  FG Src
  CAPTURE_INDIRECT_BASE + 1,   //  7  BG Src
  CAPTURE_INDIRECT_BASE + 2,   //  8  DS Src
  5,                           //  9  Noise
  14,                          // 10  Vectorscope → Scope
  // ── appended, SOURCE_DISPLAY_ORDER sequence ──
  12, 25, 9, 10, 3, 4, 21, 30, 11, 6, 20, 23, 29,
  13, 31, 32, 24, 15, 17, 18, 19, 22, 26, 27, 28,
];

// Same shape as the SOURCE_DISPLAY_ORDER assertion: fail at load rather than
// silently offering the same texture twice or pointing past the list.
{
  const real = PARTICLE_MASK_SRC.filter((v) => v != null);
  if (
    new Set(real).size !== real.length ||
    real.some((v) => v < 0 || v >= CAPTURE_SOURCES.length)
  ) {
    throw new Error("PARTICLE_MASK_SRC must hold unique, in-range capture indices");
  }
}

/** particle.masksrc SELECT options, index-aligned to PARTICLE_MASK_SRC. */
export const PARTICLE_MASK_LABELS = PARTICLE_MASK_SRC.map((v) =>
  v == null ? "None" : CAPTURE_SOURCES[v],
);

// ─────────────────────────────────────────────────────────────────────────────
// Capture-base migration (Phase 26 Step 0)
// ─────────────────────────────────────────────────────────────────────────────
// SOURCE_DEFS is append-only, so indices 0..N-1 are stable forever. The indirect
// tail is NOT: it is pinned to SOURCES.length, so appending one source slides
// "FG Src / BG Src / DS Src" up by one and every saved capture value in the old
// tail silently re-reads as the newly appended source.
//
// The fix is a stamp, not a frozen constant: every file, bank and state records
// the base it was written at, and load shifts the tail back into register. That
// keeps CAPTURE_SOURCES dense — a sparse array with a high fixed base would put
// holes in five dropdowns and in the controller travel of every SELECT over it.
//
// Written 2026-07-30, BEFORE the first source append, so it ships as an identity
// transform (29 → 29) and can be verified without a new source confusing it.

/** SOURCES.length when the indirect entries shipped (c606479). Never changes. */
export const LEGACY_CAPTURE_BASE = 29;

/**
 * Ids of every param whose options are CAPTURE_SOURCES, collected at
 * registration by identity on the shared array — the same `options === SOURCES`
 * test UI.js and ParamRow.js already use to pick a display order.
 *
 * Self-maintaining ON PURPOSE. A new selector declared `options:
 * CAPTURE_SOURCES` joins the migration by existing; a hand-written list here is
 * exactly how six copies of SOURCE_DEFS once drifted apart.
 */
export const CAPTURE_PARAM_IDS = [];

/**
 * Shift a `{ paramId: value }` map's capture indices from the base it was saved
 * at onto the current one. Mutates and returns `values`.
 *
 * Absent stamp ⇒ LEGACY_CAPTURE_BASE: the indirect entries have never existed at
 * any other base, so every file written before this stamp was written at 29.
 * Idempotent — a re-saved bank carries the current base and shifts by zero.
 */
export function migrateCaptureBase(values, savedBase) {
  if (!values) return values;
  const base = savedBase ?? LEGACY_CAPTURE_BASE;
  const shift = CAPTURE_INDIRECT_BASE - base;
  if (shift === 0) return values;
  for (const id of CAPTURE_PARAM_IDS) {
    const v = values[id];
    // `>= base` and not `> base`: the first indirect entry is AT the base.
    if (typeof v === 'number' && v >= base) values[id] = v + shift;
  }
  return values;
}

/** migrateCaptureBase over a Display State array. Mutates and returns `states`. */
export function migrateStatesCaptureBase(states, savedBase) {
  if (Array.isArray(states)) {
    for (const s of states) if (s?.values) migrateCaptureBase(s.values, savedBase);
  }
  return states;
}

// ─────────────────────────────────────────────────────────────────────────────
// SDF v2 migration — Cartesian camera → orbit, and Repeat → Tile + Tile Size
//
// NO VERSION STAMP, deliberately. The capture-base migration needs one because
// it shifts numbers in place and cannot tell a shifted value from an unshifted
// one. This migration RENAMES keys and deletes the originals, so "has it run?"
// is answerable from the data itself: if sdf.camX is gone there is nothing to
// do. That makes it idempotent by construction and safe on a file written by
// any version, including one that has already been through it.
// ─────────────────────────────────────────────────────────────────────────────

/** Old defaults, used when a file carries only some of the three axes. */
const SDF_CAM_LEGACY = { 'sdf.camX': 0, 'sdf.camY': 0, 'sdf.camZ': 5 };

/** camX/camY/camZ → orbitX/orbitY/camDist, and the new params' own ranges. */
const SDF_CAM_RENAME = { 'sdf.camX': 'sdf.orbitX', 'sdf.camY': 'sdf.orbitY', 'sdf.camZ': 'sdf.camDist' };
const SDF_CAM_RANGE  = {
  'sdf.orbitX':  { min: 0,   max: 360 },
  'sdf.orbitY':  { min: -180, max: 180 },
  'sdf.camDist': { min: 0.5, max: 20 },
};

/**
 * Cartesian eye position → the spherical triple the shader now takes.
 *
 * Exact inverse of the shader's own placement
 * (d·cos(el)·sin(az), d·sin(el), d·cos(el)·cos(az)), so a migrated project
 * puts the camera on the identical point and the frame does not move.
 * Negative camZ is handled by atan2 — it simply comes out as azimuth 180°.
 */
export function sdfCartesianToOrbit(x, y, z) {
  const d = Math.hypot(x, y, z);
  // Degenerate: the eye is at the origin. The old shader nudged z by an epsilon
  // here; the orbit form has no such singularity, so just sit at the near clip.
  if (d < 1e-6) return { orbitX: 0, orbitY: 0, camDist: SDF_CAM_RANGE['sdf.camDist'].min };
  let az = Math.atan2(x, z) * 180 / Math.PI;
  if (az < 0) az += 360;
  const el = Math.asin(Math.max(-1, Math.min(1, y / d))) * 180 / Math.PI;
  // Clamp is the one lossy step: an eye closer than 0.5 was inside the shapes.
  return { orbitX: az, orbitY: el, camDist: Math.max(SDF_CAM_RANGE['sdf.camDist'].min, d) };
}

/** Read the legacy eye out of a values map or a controller-record bag. */
function _sdfLegacyEye(values, recs) {
  const read = (id) => {
    if (values && id in values) return +values[id] || 0;
    if (recs && recs[id] && typeof recs[id].value === 'number') return recs[id].value;
    return SDF_CAM_LEGACY[id];
  };
  const present = (id) => (values && id in values) || (recs && !!recs[id]);
  if (!['sdf.camX', 'sdf.camY', 'sdf.camZ'].some(present)) return null;
  return { x: read('sdf.camX'), y: read('sdf.camY'), z: read('sdf.camZ') };
}

/** Rewrite a plain id → value map in place. */
export function migrateSdfCamera(values, recs, eye = _sdfLegacyEye(values, recs)) {
  if (!eye) return values;
  const o = sdfCartesianToOrbit(eye.x, eye.y, eye.z);
  if (values) {
    // Never clobber a value already expressed in the new form.
    if (!('sdf.orbitX'  in values)) values['sdf.orbitX']  = o.orbitX;
    if (!('sdf.orbitY'  in values)) values['sdf.orbitY']  = o.orbitY;
    if (!('sdf.camDist' in values)) values['sdf.camDist'] = o.camDist;
    delete values['sdf.camX']; delete values['sdf.camY']; delete values['sdf.camZ'];
  }
  return values;
}

/**
 * Rewrite a controller-record bag in place.
 *
 * Carries the settings that still mean the same thing on the new axis — table,
 * invert, cycle, slew, the live controller, feedback placement — and RESETS
 * ctrlMin/ctrlMax to the new param's full range. Recall bounds cannot be
 * converted: they are a box in world units, and a box in XYZ is not a box in
 * azimuth/elevation/distance. Carrying the numbers across would silently give
 * a ±1.4 sweep on a parameter that now runs to 360.
 */
export function migrateSdfCameraRecords(recs, values, eye = _sdfLegacyEye(values, recs)) {
  if (!recs || !eye) return recs;
  const o = sdfCartesianToOrbit(eye.x, eye.y, eye.z);
  for (const [oldId, newId] of Object.entries(SDF_CAM_RENAME)) {
    const rec = recs[oldId];
    delete recs[oldId];
    if (!rec || recs[newId]) continue;
    const range = SDF_CAM_RANGE[newId];
    // 'sdf.orbitX'.slice(4) === 'orbitX' — the key sdfCartesianToOrbit returns.
    recs[newId] = { ...rec, id: newId, value: o[newId.slice(4)],
                    ctrlMin: range.min, ctrlMax: range.max };
  }
  return recs;
}

/**
 * sdf.repeat used to be spacing AND on/off in one number, with the shader
 * gating on `> 0.1`. Anything at or below that threshold was off, so it maps
 * to Tile off; anything above was on, and is floored at the new minimum
 * because a cell narrower than a shape was solid mush rather than a lattice.
 */
export function migrateSdfTile(values) {
  if (!values || 'sdf.tile' in values || !('sdf.repeat' in values)) return values;
  const r = +values['sdf.repeat'] || 0;
  const on = r > 0.1;
  values['sdf.tile']   = on ? 1 : 0;
  values['sdf.repeat'] = on ? Math.max(1.2, r) : 3.0;
  return values;
}

/** Every SDF v2 migration, for one values map and its optional record bag. */
export function migrateSdfParams(values, recs) {
  // Read the legacy eye ONCE, before either call starts deleting the keys it
  // was read from — otherwise the second call sees a half-migrated bag and the
  // result depends on the order of the two lines.
  const eye = _sdfLegacyEye(values, recs);
  migrateSdfCamera(values, recs, eye);
  migrateSdfCameraRecords(recs, values, eye);
  migrateSdfTile(values);
  return values;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3D scene camera → orbit. Same shape as the SDF migration above, and no
// version stamp for the same reason: it renames keys and deletes the originals,
// so the data answers "has this run?" by itself.
//
// This one is a pure reparameterisation. SceneManager has always called
// lookAt(0,0,0), so the Cartesian triple was already nothing but a point on a
// sphere around the target — the conversion loses nothing except an eye sitting
// exactly at the origin, which rendered nothing anyway.
// ─────────────────────────────────────────────────────────────────────────────

const S3D_CAM_LEGACY = { 'scene3d.cam.x': 0, 'scene3d.cam.y': 0, 'scene3d.cam.z': 5 };
const S3D_CAM_RENAME = {
  'scene3d.cam.x': 'scene3d.cam.orbit',
  'scene3d.cam.y': 'scene3d.cam.elev',
  'scene3d.cam.z': 'scene3d.cam.dist',
};
// Must track the registered ranges above — these are what migrated recall
// bounds are reset to, so a stale copy silently hands a controller a sweep the
// parameter cannot express.
const S3D_CAM_RANGE = {
  'scene3d.cam.orbit': { min: 0,   max: 360 },
  'scene3d.cam.elev':  { min: -180, max: 180 },
  'scene3d.cam.dist':  { min: 0.1, max: 100 },
};

/**
 * Cartesian eye → orbit/elevation/distance, for a camera that looks at the
 * origin. The exact inverse of SceneManager's placement, so a migrated project
 * opens on the identical frame. Negative z falls out of atan2 as azimuth 180°.
 */
export function scene3dCartesianToOrbit(x, y, z) {
  const d = Math.hypot(x, y, z);
  if (d < 1e-6) {
    return { orbit: 0, elev: 0, dist: S3D_CAM_RANGE['scene3d.cam.dist'].min };
  }
  let az = Math.atan2(x, z) * 180 / Math.PI;
  if (az < 0) az += 360;
  const el = Math.asin(Math.max(-1, Math.min(1, y / d))) * 180 / Math.PI;
  return { orbit: az, elev: el, dist: Math.max(S3D_CAM_RANGE['scene3d.cam.dist'].min, d) };
}

/** Read the legacy eye from a values map or a controller-record bag. */
function _scene3dLegacyEye(values, recs) {
  const read = (id) => {
    if (values && id in values) return +values[id] || 0;
    if (recs && recs[id] && typeof recs[id].value === 'number') return recs[id].value;
    return S3D_CAM_LEGACY[id];
  };
  const present = (id) => (values && id in values) || (recs && !!recs[id]);
  if (!Object.keys(S3D_CAM_LEGACY).some(present)) return null;
  return { x: read('scene3d.cam.x'), y: read('scene3d.cam.y'), z: read('scene3d.cam.z') };
}

/** Rewrite a plain id → value map in place. */
export function migrateScene3dCamera(values, recs, eye = _scene3dLegacyEye(values, recs)) {
  if (!eye) return values;
  const o = scene3dCartesianToOrbit(eye.x, eye.y, eye.z);
  if (values) {
    // Never clobber a value already written in the new form.
    if (!('scene3d.cam.orbit' in values)) values['scene3d.cam.orbit'] = o.orbit;
    if (!('scene3d.cam.elev'  in values)) values['scene3d.cam.elev']  = o.elev;
    if (!('scene3d.cam.dist'  in values)) values['scene3d.cam.dist']  = o.dist;
    delete values['scene3d.cam.x'];
    delete values['scene3d.cam.y'];
    delete values['scene3d.cam.z'];
  }
  return values;
}

/**
 * Rewrite a controller-record bag in place. Carries what still means the same
 * thing on the new axis — table, invert, cycle, slew, the live controller — and
 * RESETS ctrlMin/ctrlMax, because recall bounds are a box in world units and a
 * box in XYZ is not a box in azimuth/elevation/distance. Carrying the numbers
 * would silently leave a ±20 sweep on an axis that runs to 360.
 */
export function migrateScene3dCameraRecords(recs, values, eye = _scene3dLegacyEye(values, recs)) {
  if (!recs || !eye) return recs;
  const o = scene3dCartesianToOrbit(eye.x, eye.y, eye.z);
  for (const [oldId, newId] of Object.entries(S3D_CAM_RENAME)) {
    const rec = recs[oldId];
    delete recs[oldId];
    if (!rec || recs[newId]) continue;
    const range = S3D_CAM_RANGE[newId];
    // 'scene3d.cam.orbit' → 'orbit', the key scene3dCartesianToOrbit returns.
    recs[newId] = { ...rec, id: newId, value: o[newId.split('.').pop()],
                    ctrlMin: range.min, ctrlMax: range.max };
  }
  return recs;
}

/** Both halves, reading the legacy eye ONCE before either starts deleting it. */
export function migrateScene3dParams(values, recs) {
  const eye = _scene3dLegacyEye(values, recs);
  migrateScene3dCamera(values, recs, eye);
  migrateScene3dCameraRecords(recs, values, eye);
  return values;
}

/** migrateScene3dParams over a Display State array. Mutates and returns it. */
export function migrateStatesScene3dParams(states) {
  if (Array.isArray(states)) {
    for (const s of states) if (s?.values) migrateScene3dParams(s.values, s.controllers);
  }
  return states;
}

/** migrateSdfParams over a Display State array. Mutates and returns `states`. */
export function migrateStatesSdfParams(states) {
  if (Array.isArray(states)) {
    for (const s of states) if (s) migrateSdfParams(s.values, s.controllers);
  }
  return states;
}

// ── Blend amounts: 0–1 → 0–100 % (schema 2) ──────────────────────────────────

/**
 * Schema version for the `params`/`values` maps. Bump ONLY for a change that a
 * saved file cannot describe itself, and stamp it on every write path.
 *
 * 2 — layer.fg/bg.blendAmount moved from 0–1 to 0–100 %.
 */
export const PARAM_SCHEMA = 2;

/**
 * Per-id conversion factor, because the two params did NOT change the same way.
 *
 * layer.bg.blendAmount is still a two-stop opacity, so its old 0–1 is just the
 * same number as a percent: ×100.
 *
 * layer.fg.blendAmount became a three-stop curve (0 % BG → 50 % blend → 100 %
 * FG), and the old two-stop `mix(BG, blended, v)` is exactly the FIRST HALF of
 * it. So old v lands at v/2 of the new range: ×50. That is what preserves the
 * picture — old 1.0 (full blend) becomes 50 % (full blend), not 100 %, which
 * under the new curve would be the raw Foreground with no blend at all.
 */
const BLEND_PCT_FACTOR = {
  'layer.fg.blendAmount': 50,
  'layer.bg.blendAmount': 100,
};
const BLEND_PCT_IDS = Object.keys(BLEND_PCT_FACTOR);

/**
 * Why this one needs a STAMP when migrateSdfTile and migrateSdfCamera do not.
 *
 * Those renamed their keys, so the data answers "has this run?" by itself —
 * the old key is either present or gone. Here the key is unchanged and only
 * the SCALE moved, and 0.5 is a legal value in both schemes (half, and half a
 * percent). Nothing in the map can distinguish them, so guessing by magnitude
 * ("<= 1 must be old") would silently multiply a deliberate 0.5 % by 100 on
 * every load. The stamp is the only honest answer, which is why every write
 * path carries PARAM_SCHEMA exactly as it already carries sourceCount.
 *
 * Consequence worth stating: this migration is idempotent only via the stamp,
 * NOT via the data. Call it once per load, with that file's own schema value.
 */
export function migrateBlendPercent(values, recs, savedSchema) {
  if ((savedSchema ?? 1) >= 2) return values;
  const pct = (v, f) => Math.max(0, Math.min(100, (+v || 0) * f));

  if (values) {
    for (const id of BLEND_PCT_IDS) {
      if (id in values) values[id] = pct(values[id], BLEND_PCT_FACTOR[id]);
    }
  }
  // Recall bounds ARE carried here, unlike the SDF axes: that migration reset
  // them because a box in world units is not a box in azimuth/elevation, while
  // this is the same quantity in the same direction, one constant factor apart.
  if (recs) {
    for (const id of BLEND_PCT_IDS) {
      const rec = recs[id];
      if (!rec) continue;
      const f = BLEND_PCT_FACTOR[id];
      if ('value'   in rec) rec.value   = pct(rec.value,   f);
      if ('ctrlMin' in rec) rec.ctrlMin = pct(rec.ctrlMin, f);
      if ('ctrlMax' in rec) rec.ctrlMax = pct(rec.ctrlMax, f);
    }
  }
  return values;
}

/** migrateBlendPercent over a Display State array. Mutates and returns it. */
export function migrateStatesBlendPercent(states, savedSchema) {
  if (Array.isArray(states)) {
    for (const s of states) if (s) migrateBlendPercent(s.values, s.controllers, savedSchema);
  }
  return states;
}

// ─────────────────────────────────────────────────────────────────────────────
// registerCoreParameters  — defines all Phase 1 parameters
// ─────────────────────────────────────────────────────────────────────────────

export function registerCoreParameters(ps) {
  _ps = ps;  // make ps accessible to setTableManager for global.tableSlot sync

  ps.register({
    id: "layer.fg",
    label: "Foreground",
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: SOURCES,
    value: 0,
    feedbackVisible: true,
  }); // default: Camera
  ps.register({
    id: "layer.bg",
    label: "Background",
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: SOURCES,
    value: 3,
    feedbackVisible: true,
  }); // default: Color
  ps.register({
    id: "layer.ds",
    label: "DisplaceSrc",
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: SOURCES,
    value: 4,
    feedbackVisible: true,
  });

  const BLEND_MODES = [
    "Copy",
    "XOR",
    "OR",
    "AND",
    "Multiply",
    "Screen",
    "Add",
    "Difference",
    "Exclude",
    "Overlay",
    "Hardlight",
    "Softlight",
    "Dodge",
    "Burn",
    "Subtract",
    "Divide",
    "PinLight",
    "VividLight",
    "Hue",
    "Saturation",
    "Color",
    "Luminosity",
  ];
  ps.register({
    id: "layer.fg.blend",
    label: "FG Blend",
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: BLEND_MODES,
    value: 0,
  });
  ps.register({
    id: "layer.bg.blend",
    // Self-process: Pipeline passes the BG as BOTH uFG and uBG, so this is a
    // tone treatment of one picture, not a composite of two. Labelled to say so
    // — it is rendered beside FG Blend, which IS a composite, and the two were
    // indistinguishable while this read as a blend mode.
    label: "BG Self-process",
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: BLEND_MODES,
    value: 0,
  });
  ps.register({
    id: "layer.fg.blendAmount",
    label: "Blend Amt",
    group: "fg",
    min: 0,
    max: 100,
    // 50 is the centre detent: Background alone at 0, the blend mode at full
    // strength at 50, Foreground alone at 100. See blendMix() in the shader.
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "layer.bg.blendAmount",
    label: "Self-proc Amt", // depth of layer.bg.blend, not a composite amount
    group: "bg",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });

  // ── Keyer ─────────────────────────────────────────────────────────────────
  ps.register({
    id: "keyer.active",
    label: "Keyer ON",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "keyer.white",
    label: "KeyLevelWhite",
    group: "keyer",
    min: 0,
    max: 100,
    value: 80,
    unit: "%",
    feedbackVisible: true,
  });
  ps.register({
    id: "keyer.black",
    label: "KeyLevelBlack",
    group: "keyer",
    min: 0,
    max: 100,
    value: 10,
    unit: "%",
    feedbackVisible: true,
  });
  ps.register({
    id: "keyer.softness",
    label: "KeySoftness",
    group: "keyer",
    min: 0,
    max: 100,
    value: 5,
    unit: "%",
  });
  ps.register({
    id: "keyer.extkey",
    label: "ExtKey",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  // What ExtKey keys on. Until now the external key was hardwired to the
  // DisplaceSrc texture, which meant keying externally COST you displacement —
  // one slot doing two unrelated jobs. Now it is a free selector.
  //
  // Default is "DS Src", the old hardwiring, so every saved state, bank and
  // .imweb project keys exactly as it did before this parameter existed.
  // Options are CAPTURE_SOURCES rather than SOURCES so it can also follow
  // whatever a layer is set to, and because that registration is what puts it
  // in CAPTURE_PARAM_IDS — the capture-base migration is automatic for any
  // param declared against that list, and silently absent for one that is not.
  ps.register({
    id: "keyer.keysrc",
    label: "Key src",
    group: "keyer",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: CAPTURE_INDIRECT_BASE + 2,   // "DS Src"
  });
  ps.register({
    id: "keyer.and_displace",
    label: "KeyAndDisplace",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "keyer.alpha",
    label: "Alpha",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "keyer.alpha_inv",
    label: "Invert Alpha",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    // Alpha mode composites as bg*(1-a) + fg instead of mix(bg, fg, a).
    // The difference only shows at PARTIAL coverage, where the matte form lets
    // the background through — correct for a cutout, backwards for anything
    // emissive, because a glow adds light rather than occluding. Without this
    // the SDF's aura carries the background's dark areas as shadows in it.
    // Identical at alpha 1, so an opaque subject is unaffected either way.
    id: "keyer.alpha_emissive",
    label: "Alpha Emissive",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "keyer.rawkey",
    label: "KeyRawFG",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "keyer.chroma",
    label: "Chroma Key",
    group: "keyer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "keyer.chromahue",
    label: "Chroma Hue",
    group: "keyer",
    min: 0,
    max: 360,
    value: 120,
    unit: "°",
  }); // default: green
  ps.register({
    id: "keyer.chromarange",
    label: "Chroma Range",
    group: "keyer",
    min: 0,
    max: 100,
    value: 20,
    unit: "%",
  });
  ps.register({
    id: "keyer.chromasoft",
    label: "Chroma Soft",
    group: "keyer",
    min: 0,
    max: 100,
    value: 10,
    unit: "%",
  });

  // ── Displacement ──────────────────────────────────────────────────────────
  ps.register({
    id: "displace.amount",
    label: "Displace",
    group: "displace",
    min: 0,
    max: 100,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "displace.angle",
    label: "DisplAngle",
    group: "displace",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
    feedbackVisible: true,
  });
  ps.register({
    id: "displace.offset",
    label: "DisplOffset",
    group: "displace",
    min: -100,
    max: 100,
    value: 0,
  });
  ps.register({
    id: "displace.rotateg",
    label: "RotateGrey",
    group: "displace",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "displace.warp",
    label: "WarpMode",
    group: "displace",
    min: 0,
    max: 9,
    value: 0,
    type: PARAM_TYPE.SELECT,
    options: [
      "off",
      "H-Wave",
      "V-Wave",
      "Radial",
      "Spiral",
      "Shear",
      "Pinch",
      "Turb",
      "Rings",
      "Custom",
    ],
  });
  ps.register({
    id: "displace.warpamt",
    label: "WarpAmt",
    group: "displace",
    min: 0,
    // 200, not 100. The WARP shader displaces by (map - 0.5) * uStrength * 0.3
    // and control points clamp at ±0.49, so a ceiling of 100 capped ANY warp —
    // drawn, procedural or recalled — at 0.49 * 1.0 * 0.3 ≈ 15% of the frame.
    // Raising the ceiling rather than the shader's 0.3 is what keeps every
    // saved map, preset and Display State rendering exactly as before: values
    // in the old range are untouched, there is simply more range above them.
    max: 200,
    value: 50,
    unit: "%",
  });

  // ── Performative displacement drawing ─────────────────────────────────────
  // Drive the Custom warp map from controllers (MIDI / LFO / OSC / Automation)
  // instead of only by dragging in the little editor window. 0–100 to match the
  // draw.x / draw.y convention rather than introducing a second scale.
  //
  // There is no on/off switch by design: the brush fires on the MOTION of the
  // point, so a stationary pair of sliders does nothing and an LFO on X/Y
  // produces an orbiting drag.
  ps.register({
    id: "displace.warpDrawX",
    label: "WarpDrawX",
    group: "displace",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "displace.warpDrawY",
    label: "WarpDrawY",
    group: "displace",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "displace.warpDrawAmt",
    // "Strength", not "Draw Amt": the mini editor's Strength slider is now a
    // view of THIS param, and one param with two names on screen is a bug
    // waiting to be reported as two controls that mysteriously move together.
    label: "Strength",
    group: "displace",
    min: 0,
    max: 200,
    value: 100, // 100% = the speed-derived feel this replaced; unchanged default
    unit: "%",
  });
  ps.register({
    // Recall a saved warp slot (1–16) from a controller. 0 = "—", a no-op, so
    // the default does nothing and an LFO parked at zero stays quiet.
    //
    // group 'global' → excluded from Display State capture, and for a sharper
    // reason than glsl.preset's: slot CONTENTS live in per-origin localStorage
    // while the index would live in the .imweb file, so a captured slot 3
    // recalls a different map on another machine, another port, or after the
    // performer re-saves that slot. The index is stable; what it points at is
    // not. warpPreset below has no such problem and IS captured.
    id: "displace.warpSlot",
    label: "WarpSlot",
    group: "global",
    type: PARAM_TYPE.SELECT,
    options: ["—", "1", "2", "3", "4", "5", "6", "7", "8",
              "9", "10", "11", "12", "13", "14", "15", "16"],
    value: 0,
  });
  ps.register({
    // Fire a procedural warp preset from a controller. 0 = "—", a no-op.
    // group 'displace' (unlike warpSlot) because these eight live in code, not
    // in storage: the list is fixed and deterministic on every machine, so a
    // captured index means the same shape everywhere. Append new presets at the
    // END — the value persists as an integer index, same rule as SOURCE_DEFS.
    id: "displace.warpPreset",
    label: "WarpPreset",
    group: "displace",
    type: PARAM_TYPE.SELECT,
    options: ["—", "H-Wave", "V-Wave", "Radial", "Pinch",
              "Spiral", "Shear", "Random", "Reset"],
    value: 0,
  });
  ps.register({
    // Brush width for BOTH main-canvas drags and the WarpDrawX/Y param path —
    // they share one _warpStroke, so they share one radius. Was a hardcoded
    // 0.18: with control points clamping at ±0.49, a narrow brush saturates its
    // peak and the warp simply stops growing, which is why the main canvas hit
    // a wall the mini editor (radius slider to 0.50) did not. Stored as a
    // percentage so it reads like every other param; _warpStroke divides by 100.
    id: "displace.warpDrawRadius",
    label: "Radius",
    group: "displace",
    min: 2,
    max: 50,
    value: 18, // = the old WARP_DRAW_RADIUS 0.18, so the default feel is unchanged
    unit: "%",
  });
  ps.register({
    id: "displace.warpDrawFixed",
    label: "Fixed Dir",
    group: "displace",
    type: PARAM_TYPE.TOGGLE,
    value: 0, // 0 = direction follows motion, exactly as before
  });
  ps.register({
    id: "displace.warpDrawAngle",
    label: "Angle",
    group: "displace",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "displace.warpSlotFade",
    label: "Slot Fade",
    group: "displace",
    min: 0,
    max: 10,
    value: 0, // 0 = instant slot load, exactly as before
    step: 0.05,
    unit: "s",
  });
  ps.register({
    id: "displace.warpFade",
    label: "WarpFade",
    group: "displace",
    min: 0,
    max: 1,
    value: 0, // 0 = no decay — old projects must render identically
    step: 0.005,
  });

  // ── Blend & Feedback ──────────────────────────────────────────────────────
  ps.register({
    id: "blend.active",
    label: "Blend",
    group: "blend",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "feedback.active",
    label: "Feedback",
    group: "blend",
    type: PARAM_TYPE.TOGGLE,
    value: 1,
    feedbackVisible: true,
  });
  ps.register({
    id: "blend.amount",
    label: "BlendAmount",
    group: "blend",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
    feedbackVisible: true,
  });
  // The two offsets are marked ‰ because that is exactly what they are: the
  // pass applies `value / 100 * 0.1` in UV, so one unit is 0.001 of the frame
  // and the full ±100 travel is ±10%. They were labelled "px" for years and are
  // not pixels at all — nothing resolution-dependent enters the shader, so the
  // same value gives the same shift at any output size. Only the LABEL changed;
  // the stored numbers and the mapping are untouched, so every saved state,
  // bank and MIDI mapping renders exactly as before.
  ps.register({
    id: "feedback.hor",
    label: "HorFBOffset",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "‰",
  });
  ps.register({
    id: "feedback.ver",
    label: "VerFBOffset",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "‰",
  });
  ps.register({
    id: "feedback.scale",
    label: "FBScale",
    group: "blend",
    min: -50,
    max: 50,
    value: 0,
  });
  // Percent of a full turn, not degrees: the pass divides by 100 and the shader
  // multiplies by 2π, so 50 is a half turn (180°) and the ±100 travel is a full
  // turn each way. The old "°" label made 50 read as 50 degrees — a factor of
  // 3.6 out. Label only; the mapping is unchanged.
  ps.register({
    id: "feedback.rotate",
    label: "FBRotate",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "% turn",
  });
  ps.register({
    id: "feedback.zoom",
    label: "FBZoom",
    group: "blend",
    min: -50,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "output.colorshift",
    label: "ColorShift",
    group: "blend",
    min: 0,
    max: 100,
    value: 0,
  });
  ps.register({
    id: "feedback.mode",
    label: "Feedback Mode",
    group: "blend",
    type: PARAM_TYPE.SELECT,
    options: [
      "Off",
      "XOR",
      "OR",
      "AND",
      "Multiply",
      "Screen",
      "Add",
      "Difference",
      "Exclude",
      "Overlay",
      "Hardlight",
      "Softlight",
      "Dodge",
      "Burn",
      "Subtract",
      "Divide",
      "PinLight",
      "VividLight",
      "Hue",
      "Saturation",
      "Color",
      "Luminosity",
    ],
    value: 0,
    feedbackVisible: true,
  });

  // ── Feedback loop shaping ─────────────────────────────────────────────────
  // Everything below acts on the RECIRCULATED frame only, before it is blended
  // with the live one. That distinction is the point: output.fade and
  // output.colorshift already sit inside the loop (prev is captured after them),
  // so they can damp or tint a trail — but only by damping or tinting the live
  // picture too. These do it to the trail alone.
  //
  // EVERY default is the identity, and deliberately so: decay 100 % is ×1,
  // centre 50/50 is the hardcoded centre these replace, Clamp is what both
  // passes already did, blur 0 and hue 0 are no-ops and mirror is Off. Existing
  // states, banks and .imweb files must render pixel-identically — see
  // tests/audit-derived-defaults.mjs for why that rule is worth the care.
  ps.register({
    id: "feedback.decay",
    label: "FBDecay",
    group: "blend",
    min: 0,
    max: 100,
    value: 100, // ×1 — no attenuation, exactly as before this param existed
    unit: "%",
  });
  // Centre for FBRotate and FBZoom, which were pinned to the middle of frame.
  // Only has an effect while one of those is non-zero — a centre on its own
  // moves nothing, so no gate changes for it in the pipeline.
  ps.register({
    id: "feedback.centerx",
    label: "FBCenterX",
    group: "blend",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "feedback.centery",
    label: "FBCenterY",
    group: "blend",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  // What the loop finds outside the frame once it is shifted, zoomed or turned.
  // Clamp is the smear both passes have always produced; the other three are
  // genuinely different feedback characters, not error handling.
  ps.register({
    id: "feedback.edge",
    label: "FBEdge",
    group: "blend",
    type: PARAM_TYPE.SELECT,
    options: ["Clamp", "Mirror", "Wrap", "Black"],
    value: 0,
  });
  ps.register({
    id: "feedback.blur",
    label: "FBBlur",
    group: "blend",
    min: 0,
    max: 100,
    value: 0,
  });
  // Hue rotation per generation, compounding around the loop — a trail that
  // walks through the spectrum as it decays. Signed so it can walk either way.
  ps.register({
    id: "feedback.hue",
    label: "FBHue",
    group: "blend",
    min: -180,
    max: 180,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "feedback.mirror",
    label: "FBMirror",
    group: "blend",
    type: PARAM_TYPE.SELECT,
    options: ["Off", "H", "V", "Both"],
    value: 0,
  });

  ps.register({
    id: "output.interlace",
    label: "Interlace",
    group: "blend",
    min: 0,
    max: 8,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "output.fade",
    label: "Fade",
    group: "blend",
    min: 0,
    max: 100,
    value: 0,
  });
  ps.register({
    id: "output.solo",
    label: "Solo",
    group: "blend",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });

  // ── Color ─────────────────────────────────────────────────────────────────
  ps.register({
    id: "color1.hue",
    label: "Hue 1",
    group: "color",
    min: 0,
    max: 100,
    value: 0,
    unit: "°",
    feedbackVisible: true,
  });
  ps.register({
    id: "color1.sat",
    label: "Sat 1",
    group: "color",
    min: 0,
    max: 100,
    value: 80,
  });
  ps.register({
    id: "color1.val",
    label: "Val 1",
    group: "color",
    min: 0,
    max: 100,
    value: 60,
  });
  ps.register({
    id: "color2.hue",
    label: "Hue 2",
    group: "color",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "color2.sat",
    label: "Sat 2",
    group: "color",
    min: 0,
    max: 100,
    value: 80,
  });
  ps.register({
    id: "color2.val",
    label: "Val 2",
    group: "color",
    min: 0,
    max: 100,
    value: 60,
  });
  ps.register({
    id: "color2.type",
    label: "Col2 Type",
    group: "color",
    type: PARAM_TYPE.SELECT,
    options: ["Solid", "Grad H", "Grad V", "Grad R"],
    value: 0,
  });
  ps.register({
    id: "color2.speed",
    label: "Col2 Speed",
    group: "color",
    min: -200,
    max: 200,
    value: 0,
    unit: "%",
  });

  // ── Palette FG / BG (selectable pipeline sources, index 23/24) ────────────
  ps.register({ id: 'palette.fg.hue', label: 'FG Hue', group: 'palettefg', min: 0, max: 360, step: 1, value: 0,   unit: '°', feedbackVisible: true });
  ps.register({ id: 'palette.fg.sat', label: 'FG Sat', group: 'palettefg', min: 0, max: 100, step: 1, value: 100, unit: '%' });
  ps.register({ id: 'palette.fg.val', label: 'FG Val', group: 'palettefg', min: 0, max: 100, step: 1, value: 100, unit: '%' });

  ps.register({ id: 'palette.bg.hue', label: 'BG Hue', group: 'palettebg', min: 0, max: 360, step: 1, value: 240, unit: '°', feedbackVisible: true });
  ps.register({ id: 'palette.bg.sat', label: 'BG Sat', group: 'palettebg', min: 0, max: 100, step: 1, value: 80,  unit: '%' });
  ps.register({ id: 'palette.bg.val', label: 'BG Val', group: 'palettebg', min: 0, max: 100, step: 1, value: 60,  unit: '%' });

  // ── Noise BFG (Basis Function Generator) ─────────────────────────────────
  ps.register({
    id: "noise.type",
    label: "NoiseType",
    group: "noise",
    type: PARAM_TYPE.SELECT,
    options: [
      "WhiteNoise",
      "Value",
      "Perlin",
      "Simplex",
      "Cellular-F1",
      "Cellular-F2",
      "Ridged",
      "Curl",
      "DomainWarp",
      "White",
      "FilmGrain",
      "Gaussian",
      "TVStatic",
      "ScanLines",
      "SaltPepper",
      "Voronoi",
      "Manhattan",
      "Chebyshev",
      "Caustics",
      "FlowNoise",
      "Veins",
      "Truchet",
      "HexGrid",
      "Gabor",
      "BlueNoise",
      "PoissonDisc",
      "Speckle",
      "RGBShift",
      "Interlace",
      "VCRNoise",
      "SpeckleColour",
      "PixelSort",
      "fBm",
      "Turbulence",
      "Billowed",
      "DomainWarp2",
      "VelocityField",
      "Advection",
      "Marble",
      "Psrd2D",
      "PsrdWarp",
    ],
    value: 1,
  }); // default: WhiteNoise
  ps.register({
    id: 'noise.family',
    label: 'Family',
    group: 'noise',
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ['Gradient', 'Fractal', 'Cellular', 'Warp', 'Pattern', 'Analog', 'Periodic'],
    value: 0,
  });
  ps.register({
    id: "noise.color",
    label: "Color Mode",
    group: "noise",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["Grayscale", "RGB Channels", "Two-Tone"],
    value: 2,
  });
  ps.register({
    id: "noise.scale",
    label: "Scale",
    group: "noise",
    min: 0.1,
    max: 20,
    value: 3,
    step: 0.1,
  });
  ps.register({
    id: "noise.octaves",
    label: "Octaves",
    group: "noise",
    min: 1,
    max: 8,
    value: 4,
    step: 1,
  });
  ps.register({
    id: "noise.lacunarity",
    label: "Lacunarity",
    group: "noise",
    min: 1.0,
    max: 4.0,
    value: 2.0,
    step: 0.05,
  });
  ps.register({
    id: "noise.gain",
    label: "Gain",
    group: "noise",
    min: 0.1,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: 'noise.swirl',
    label: 'Swirl',
    group: 'noise',
    min: 0.0,
    max: 1.0,
    value: 0.0,
    step: 0.01,
  });
  ps.register({
    id: 'noise.ridge',
    label: 'Ridge',
    group: 'noise',
    min: 0.0,
    max: 1.0,
    value: 0.0,
    step: 0.01,
  });
  ps.register({
    id: "noise.speed",
    label: "Speed",
    group: "noise",
    min: -5.0,
    max: 5.0,
    value: 0.2,
    step: 0.05,
  });
  ps.register({
    id: "noise.offsetX",
    label: "OffsetX",
    group: "noise",
    min: -10,
    max: 10,
    value: 0,
    step: 0.1,
  });
  ps.register({
    id: "noise.offsetY",
    label: "OffsetY",
    group: "noise",
    min: -10,
    max: 10,
    value: 0,
    step: 0.1,
  });
  ps.register({
    id: "noise.contrast",
    label: "Gamma",
    group: "noise",
    min: 0.1,
    max: 5.0,
    value: 1.0,
    step: 0.05,
  });
  ps.register({
    id: "noise.sharpen",
    label: "Sharpen",
    group: "noise",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "noise.invert",
    label: "Invert",
    group: "noise",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "noise.seed",
    label: "Seed",
    group: "noise",
    min: 0,
    max: 100,
    value: 0,
    step: 0.5,
  });
  ps.register({
    id: 'noise.period.x',
    label: 'Period X',
    group: 'noise',
    min: 0,
    max: 64,
    value: 8,
    step: 1,
  });
  ps.register({
    id: 'noise.period.y',
    label: 'Period Y',
    group: 'noise',
    min: 0,
    max: 64,
    value: 8,
    step: 1,
  });
  ps.register({
    id: 'noise.alpha',
    label: 'Alpha',
    group: 'noise',
    min: 0,
    max: 6.2832,
    value: 0,
    step: 0.01,
  });
  // ── Noise color backing params (for state save/restore) ──────────────────
  // Stored as linear-light R/G/B in [0,1]. Not shown in param rows — driven
  // exclusively by the native <input type="color"> pickers + onChange wiring.
  for (const [id, label, def] of [
    ['noise.col1.r','NC1R',1],['noise.col1.g','NC1G',1],['noise.col1.b','NC1B',1],
    ['noise.col2.r','NC2R',0],['noise.col2.g','NC2G',0],['noise.col2.b','NC2B',0],
  ]) {
    ps.register({ id, label, group:'noise', min:0, max:1, value:def, step:0.001 });
  }
  // ── Particle color backing params ─────────────────────────────────────────
  for (const [id, label, def] of [
    ['particle.col1.r','PC1R',0.102],['particle.col1.g','PC1G',0.2],['particle.col1.b','PC1B',0.8],
    ['particle.col2.r','PC2R',1.0  ],['particle.col2.g','PC2G',0.3],['particle.col2.b','PC2B',0.102],
  ]) {
    ps.register({ id, label, group:'particle', min:0, max:1, value:def, step:0.001 });
  }

  // ── Mirror (slot-based: flip whatever occupies the layer) ────────────────
  ps.register({
    id: "mirror.fg",
    label: "Mirror FG",
    group: "mirror",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "mirror.bg",
    label: "Mirror BG",
    group: "mirror",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  // Legacy source-based mirrors — kept registered so old presets/projects
  // load without errors, but no longer rendered or read by the pipeline.
  // (mirror.movie was never read by the pipeline at all — it shadowed
  // movie.mirror, which lived in the movie group.)
  ps.register({
    id: "mirror.camera",
    label: "Mirror Cam (legacy)",
    group: "mirror-legacy",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "mirror.movie",
    label: "Mirror Movie (legacy)",
    group: "mirror-legacy",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "mirror.buffer",
    label: "Mirror Buffer (legacy)",
    group: "mirror-legacy",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });

  // ── Buffer / Stills ───────────────────────────────────────────────────────
  ps.register({
    id: "buffer.source",
    label: "CaptureFrom",
    group: "buffer",
    type: PARAM_TYPE.SELECT,
    options: [
      "Screen",
      "Camera",
      "Movie",
      "Draw",
      "FG Layer",
      "BG Layer",
      "3D Scene",
    ],
    value: 0,
  });
  (ps.register({
    id: "buffer.rows",
    label: "Rows",
    type: PARAM_TYPE.CONTINUOUS,
    min: 1,
    max: 8,
    value: 4,
    step: 1,
    group: "buffer",
  }),
    ps.register({
      id: "buffer.cols",
      label: "Cols",
      type: PARAM_TYPE.CONTINUOUS,
      min: 1,
      max: 8,
      value: 4,
      step: 1,
      group: "buffer",
    }),
    ps.register({
      id: "buffer.auto",
      label: "AutoCapture",
      group: "buffer",
      type: PARAM_TYPE.TOGGLE,
      value: 0,
    }));
  ps.register({
    id: "buffer.rate",
    label: "CaptureRate",
    group: "buffer",
    min: 0.1,
    max: 30,
    value: 1,
    unit: "fps",
  });
  ps.register({
    id: "buffer.panX",
    label: "PanX",
    group: "buffer",
    min: 0,
    max: 100,
    value: 50,
    feedbackVisible: true,
  });
  ps.register({
    id: "buffer.panY",
    label: "PanY",
    group: "buffer",
    min: 0,
    max: 100,
    value: 50,
    feedbackVisible: true,
  });
  ps.register({
    id: "buffer.scale",
    label: "Scale",
    group: "buffer",
    min: 0,
    max: 5,
    value: 1,
    feedbackVisible: true,
  });
  ps.register({
    id: "buffer.fs1",
    label: "FrameSelect 1",
    group: "buffer",
    min: 0,
    max: 63,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "buffer.fs2",
    label: "FrameSelect 2",
    group: "buffer",
    min: 0,
    max: 63,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "buffer.frameblend",
    label: "FrameBlend",
    group: "buffer",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "buffer.fs3",
    label: "FrameSelect 3",
    group: "buffer",
    min: 0,
    max: 63,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "buffer.scatter",
    label: "Scatter",
    group: "buffer",
    min: 0,
    max: 32,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "buffer.grainrate",
    label: "GrainRate",
    group: "buffer",
    min: 0.5,
    max: 30,
    value: 4,
    step: 0.5,
    unit: "Hz",
  });
  ps.register({
    id: "buffer.scan",
    label: "ScanFrames",
    group: "buffer",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "buffer.scanrate",
    label: "ScanRate",
    group: "buffer",
    min: 0.1,
    max: 60,
    value: 8,
    unit: "fps",
  });
  ps.register({
    id: "buffer.scandir",
    label: "ScanDir",
    group: "buffer",
    type: PARAM_TYPE.SELECT,
    options: ["→ Fwd", "← Back", "↔ Ping"],
    value: 0,
  });
  ps.register({
    id: "buffer.cap_screen",
    label: "Screen→Buffer",
    group: "buffer",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "buffer.cap_video",
    label: "Video→Buffer",
    group: "buffer",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "buffer.cap_movie",
    label: "Movie→Buffer",
    group: "buffer",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "buffer.capture",
    label: "CaptBuffer",
    group: "buffer",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── Movie / clip ──────────────────────────────────────────────────────────
  // Both decks register from one descriptor table so movie.* (Deck A) and
  // movieB.* (Deck B) can never drift. Deck A ids/labels/groups are unchanged.
  const MOVIE_DECK_PARAMS = [
    { key: "active", label: "MovieOn", type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true },
    { key: "speed", label: "MovieSpeed", min: -5, max: 5, value: 1, feedbackVisible: true },
    { key: "pos", label: "MoviePos", min: 0, max: 100, value: 0, unit: "%" },
    { key: "start", label: "MovieStart", min: 0, max: 100, value: 0, unit: "%" },
    { key: "end", label: "MovieEnd", min: 0, max: 100, value: 100, unit: "%" },
    // A two-way view of (End − Start): dial it to set the window's length
    // directly, and it re-reads whenever either mark moves, so it is never a
    // stale second copy of the truth. Start/End remain the stored range — this
    // is a control surface over them, not a third piece of state.
    //
    // Group 'global', so Display States do NOT capture it — the same rule
    // cueSlot follows, and for the same reason. A state already captures
    // start/end; capturing len as well gives that pair a SECOND writer, since
    // len's onChange rewrites End. It happens to be harmless today only
    // because len is registered after start/end and restore follows
    // registration order, so len already equals end−start by the time it is
    // applied and no change fires. That is an accident of ordering, not a
    // design: reorder this table and a recalled state silently loses its
    // Start/End to a left-anchored window. Nothing is lost by excluding it —
    // len is reconstructed from start/end on load by the sync in main.js.
    { key: "len", label: "MovieLen", min: 0, max: 100, value: 100, unit: "%", group: "global" },
    // Off: MoviePos is a fraction WITHIN the Start-End window (the v0.1
    // meaning — every saved project, controller mapping and cue depends on
    // it, so it stays the default). On: MoviePos is the window's POSITION in
    // the clip, and Start/End slide with it keeping their length — drag Pos
    // and a tight loop sweeps through the material. Group is the deck prefix,
    // so Display States DO capture it: it is a code-stable boolean like
    // MovieLoop, with no index that could drift.
    { key: "posslide", label: "SlideRange", type: PARAM_TYPE.TOGGLE, value: 0 },
    { key: "loop", label: "MovieLoop", type: PARAM_TYPE.SELECT, value: 1, options: ["Off", "Loop", "Ping-pong"] },
    // Seconds to dissolve from the outgoing clip to the incoming one when the
    // deck's selection changes. 0 = hard cut, which is what every existing
    // project expects, so it is the default.
    { key: "clipfade", label: "ClipFade", min: 0, max: 5, value: 0, unit: "s" },
    // default muted — user opts in to audio
    { key: "mute", label: "MuteMovie", type: PARAM_TYPE.TOGGLE, value: 1 },
    { key: "bpmsync", label: "BPM Sync", type: PARAM_TYPE.TOGGLE, value: 0 },
    { key: "bpmbeats", label: "BeatLen", type: PARAM_TYPE.SELECT, value: 2, options: ["1 beat", "2 beats", "4 beats", "8 beats", "16 beats"] },
    // Cue slots — eight Start/End/Pos sets per deck. Both are group 'global',
    // which overrides the `group: prefix` below, so Display States cannot
    // capture them. A state already captures start/end/pos directly; capturing
    // the slot index too would give those three values a second writer whose
    // onChange fires after the restore, and which one won would depend on
    // restore order. See MovieCues.js.
    { key: "cueSlot", label: "CueSlot", type: PARAM_TYPE.SELECT, value: 0, group: "global",
      options: ["1", "2", "3", "4", "5", "6", "7", "8"] },
    { key: "cueStore", label: "CueStore", type: PARAM_TYPE.TRIGGER, group: "global" },
  ];
  [
    { prefix: "movie", labelSuffix: "" },
    { prefix: "movieB", labelSuffix: " B" },
  ].forEach(({ prefix, labelSuffix }) => {
    MOVIE_DECK_PARAMS.forEach(({ key, label, ...rest }) => {
      ps.register({
        id: `${prefix}.${key}`,
        label: label + labelSuffix,
        group: prefix,
        ...rest,
      });
    });
  });
  ps.register({
    id: "movie.mirror",
    label: "MirrorMovie (legacy)",
    group: "mirror-legacy", // superseded by slot-based mirror.fg/mirror.bg
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });

  // ── Mix buses ×3 (dual-deck v0.12; free sources + buses 2/3 Phase 23) ─────
  // srcA/srcB select ANY source, not just the two movie decks. Bus 1 keeps the
  // bare `mix.` prefix and its exact v0.12 ids/labels — renaming to `mix1.`
  // would break every saved state, bank, .imweb file and MIDI mapping on earth
  // for zero functional gain. Buses 2 and 3 mirror it structurally, the same
  // accepted asymmetry as movie.* vs movieB.*.
  //
  // Defaults 1 (Movie) / 25 (Movie B) on every bus: on bus 1 they reproduce the
  // pre-Step-2 hardwiring exactly, so existing projects render identically; on
  // buses 2/3 they are simply the least surprising starting point (an unused
  // bus costs nothing — see the consumption gate in main.js).
  //
  // Deliberately group "mix"/"mix2"/"mix3", NOT "global": these ARE captured by
  // Display States. Unlike glsl.preset (an index into a user-editable list),
  // the source list is append-only and not user-editable, so the indices cannot
  // drift out from under a saved state.
  const MIX_BUS_PARAMS = [
    { key: "srcA",    label: "MixSrcA",   type: PARAM_TYPE.SELECT, value: 1,  options: SOURCES },
    { key: "srcB",    label: "MixSrcB",   type: PARAM_TYPE.SELECT, value: 25, options: SOURCES },
    { key: "xfade",   label: "Crossfade", min: 0, max: 1, value: 0, feedbackVisible: true },
    // APPEND-ONLY: indices persisted in saved states
    { key: "mode",    label: "MixMode",   type: PARAM_TYPE.SELECT, value: 0,
      options: ["Crossfade", "Add", "Multiply", "Luma Mask", "Displace"] },
    { key: "dispAmt", label: "MixDisp",   min: 0, max: 1, value: 0.1 },
    { key: "maskLo",  label: "MaskLo",    min: 0, max: 1, value: 0.25 },
    { key: "maskHi",  label: "MaskHi",    min: 0, max: 1, value: 0.75 },
  ];
  [
    { prefix: "mix",  labelSuffix: "" },   // bus 1 — ids/labels frozen at v0.12
    { prefix: "mix2", labelSuffix: " 2" },
    { prefix: "mix3", labelSuffix: " 3" },
  ].forEach(({ prefix, labelSuffix }) => {
    MIX_BUS_PARAMS.forEach(({ key, label, ...rest }) => {
      ps.register({
        id: `${prefix}.${key}`,
        label: label + labelSuffix,
        group: prefix,
        ...rest,
      });
    });
  });

  // ── Clip Library ──────────────────────────────────────────────────────────
  ps.register({
    id: "clip.recordSrc",
    label: "RecordSrc",
    group: "clip",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["Out", "Cam", "Mov", "FG", "BG", "S1", "S2", "S3"],
  });
  ps.register({
    id: "clip.bank",
    label: "Bank",
    group: "clip",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["0", "1", "2", "3", "4", "5", "6", "7"],
  });
  ps.register({
    id: "clip.slot",
    label: "Slot",
    group: "clip",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: [
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
      "10",
      "11",
      "12",
      "13",
      "14",
      "15",
    ],
  });
  ps.register({
    id: "clip.duration",
    label: "Duration",
    group: "clip",
    type: PARAM_TYPE.CONTINUOUS,
    min: 1,
    max: 30,
    step: 1,
    value: 5,
  });
  ps.register({
    id: "clip.record",
    label: "Record",
    group: "clip",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "clip.recall",
    label: "Recall",
    group: "clip",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── Camera ────────────────────────────────────────────────────────────────
  ps.register({
    id: "camera.active",
    label: "CameraOn",
    group: "camera",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "camera.device",
    label: "Cam Device",
    group: "camera",
    type: PARAM_TYPE.SELECT,
    options: ["default"],
    value: 0,
    select: true, // device names are long — always a dropdown, never buttons
  });

  // ── 3D Scene ──────────────────────────────────────────────────────────────
  ps.register({
    id: "scene3d.active",
    label: "3D On",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "scene3d.geo",
    label: "Geometry",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: [
      "Basic: Sphere",
      "Basic: Torus",
      "Basic: Cube",
      "Basic: Plane",
      "Basic: Cylinder",
      "Basic: Capsule",
      "Complex: TorusKnot",
      "Basic: Cone",
      "Platonic: Dodecahedron",
      "Platonic: Icosahedron",
      "Platonic: Octahedron",
      "Platonic: Tetrahedron",
      "Basic: Ring",
    ],
    value: 0,
  });
  ps.register({
    id: "scene3d.rot.x",
    label: "Rotation X",
    group: "scene3d",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
    feedbackVisible: true,
  });
  ps.register({
    id: "scene3d.rot.y",
    label: "Rotation Y",
    group: "scene3d",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
    feedbackVisible: true,
  });
  ps.register({
    id: "scene3d.rot.z",
    label: "Rotation Z",
    group: "scene3d",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "scene3d.pos.screenspace",
    label: "Screen XY",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "scene3d.pos.x",
    label: "Position X",
    group: "scene3d",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.pos.y",
    label: "Position Y",
    group: "scene3d",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.pos.z",
    label: "Position Z",
    group: "scene3d",
    min: -10,
    max: 10,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.scale",
    label: "Scale",
    group: "scene3d",
    min: 0.01,
    max: 5,
    value: 1,
  });
  ps.register({
    id: "scene3d.norm",
    label: "Normalization",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 2.0,
  });
  ps.register({
    // Renders the scene on a transparent background so the target carries real
    // ALPHA — which is what makes Opacity mean "see the layer underneath"
    // rather than "fade into the 3D scene's own backdrop". Without it the scene
    // clears to a near-black blue and a half-transparent object blends into it,
    // so lowering Opacity just turns the object black.
    //
    // Off by default, deliberately. Turning it on changes what the compositor
    // receives — empty space goes from opaque near-black to (0,0,0,0) — and
    // every existing project keys the 3D layer by LUMA. Opt-in means no saved
    // project moves until its author chooses.
    //
    // With it on, the target is PREMULTIPLIED (standard blending over a
    // transparent clear produces premultiplied RGB), so the exact composite is
    // Keyer → Alpha plus Alpha Emissive — the same path the Text layer uses and
    // for the same reason. See the note above gl_FragColor in shaders/index.js.
    id: "scene3d.mat.alphabg",
    label: "Transparent BG",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "scene3d.wireframe",
    label: "Wireframe",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "scene3d.cam.fov",
    label: "Cam FOV",
    group: "scene3d",
    min: 10,
    max: 120,
    value: 60,
    unit: "°",
  });
  // The 3D camera is spherical, not Cartesian — SceneManager always calls
  // lookAt(0,0,0), so cam.x/y/z was never a free position, only ever a point on
  // a sphere around the target written in the least playable coordinates there
  // are. Orbiting meant moving three sliders along a coordinated arc: not doable
  // by hand, and meaningless under a controller, because an LFO on Cam X slides
  // the camera through the object rather than around it.
  //
  // Same treatment sdf.camX/Y/Z got, and deliberately the same names, ranges and
  // defaults, so the two cameras in this instrument behave alike. Saved projects
  // are converted by migrateScene3dCamera() — an exact inverse, so a migrated
  // project opens on the identical frame.
  ps.register({
    id: "scene3d.cam.orbit",
    label: "Orbit",
    group: "scene3d",
    min: 0,
    max: 360,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // Full ±180, and it sweeps continuously over the top. An earlier cut of
    // this clamped to ±89 because lookAt()'s fixed up vector of (0,1,0) goes
    // parallel to the view direction at the pole and the basis collapses — but
    // that was patching the symptom. SceneManager now DERIVES up from the orbit
    // frame, which is well conditioned everywhere (the camera's right vector
    // measures 1.0 at every elevation, against 0.0 at the pole with a fixed
    // up), so there is no pole to avoid and no twitchy zone approaching one.
    id: "scene3d.cam.elev",
    label: "Elevation",
    group: "scene3d",
    min: -180,
    max: 180,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // The fourth degree of freedom, and the one no other control could reach:
    // orbit/elevation/distance place the camera, roll turns it about its own
    // view axis, so the whole IMAGE rotates while the viewpoint stays put.
    id: "scene3d.cam.roll",
    label: "Roll",
    group: "scene3d",
    min: -180,
    max: 180,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // Exponential: distance is perceived as a ratio, so equal travel should give
    // equal ratio. Linear over 0.1–100 would spend 90% of the throw above 10 and
    // make close-up framing unreachable — every useful near value crushed into
    // the first millimetre. The taper puts 1.0 at the middle of the fader and
    // slows right down as it approaches the object, which is the ask.
    id: "scene3d.cam.dist",
    label: "Distance",
    group: "scene3d",
    min: 0.1,
    max: 100,
    value: 5,
    step: 0.01,
    curve: "exp",
  });
  // One spin per angular degree of freedom, the way the mesh has Spin X/Y/Z for
  // its three rotations. A camera's three are NOT x/y/z: orbit and elevation
  // move it over the sphere, roll turns it in place. Each is degrees per second
  // and accumulates internally, so its angle param stays live as an offset
  // rather than being written every frame — which would fight a controller on
  // it and fill Display States with wherever the spin happened to be.
  for (const [suffix, label] of [
    ['spinOrbit', 'Spin Orbit'],
    ['spinElev',  'Spin Elev'],
    ['spinRoll',  'Spin Roll'],
  ]) {
    ps.register({
      id: `scene3d.cam.${suffix}`,
      label,
      group: "scene3d",
      min: -180,
      max: 180,
      value: 0,
      step: 0.1,
      unit: "°/s",
    });
  }
  ps.register({
    id: "scene3d.mat.roughness",
    label: "Roughness",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 0.5,
  });
  ps.register({
    id: "scene3d.mat.metalness",
    label: "Metalness",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 0.0,
  });
  ps.register({
    id: "scene3d.mat.emissive",
    label: "Emissive",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 0.0,
  });
  ps.register({
    id: "scene3d.mat.opacity",
    label: "Opacity",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 1.0,
  });
  ps.register({
    id: "scene3d.mat.hue",
    label: "MatHue",
    group: "scene3d",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "scene3d.mat.sat",
    label: "MatSat",
    group: "scene3d",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "scene3d.mat.texsrc",
    label: "Texture Source",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["None", "Camera", "Movie", "Screen", "Draw", "Buffer", "Noise"],
    value: 0,
  });
  ps.register({
    // How the texture is projected onto the mesh. This used to be inferred —
    // triplanar if and only if the source was Noise — which left the seamless,
    // pole-free mapping unreachable for a movie or the camera, both of which
    // pinch at a sphere's poles just as badly.
    //
    // Auto reproduces the old rule exactly, so no saved project moves. The two
    // explicit modes are both worth having: triplanar projects from three axes
    // and blends, so it is seamless, but it MIRRORS the far side of the object
    // and softens the 45-degree seams — right for noise and texture, wrong for
    // a picture containing faces or text.
    id: "scene3d.mat.mapping",
    label: "Mapping",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["Auto", "UV", "Seamless"],
    value: 0,
  });
  ps.register({
    // How abruptly Seamless hands over between its three projections. Higher is
    // crisper; lower spreads the handover wider. It matters far more for
    // DISPLACEMENT than for colour, because a sharp handover in geometry is a
    // physical ridge — the radial star that shows up on a displaced sphere.
    //
    // Measured on a sphere: 6 leaves 30.7% of the surface in a blend zone,
    // 3 leaves 55.8%, 2 leaves 72.9%. Wider is smoother but flatter, since it
    // averages three samples across more of the surface. No setting is free,
    // which is exactly why this is a knob and not a better constant. Default 6
    // is the value it was hardcoded at, so nothing existing moves.
    //
    // Deliberately ONE control for colour and displacement: they read the same
    // shader function, and letting them blend differently would put the relief
    // out of register with the picture on it.
    id: "scene3d.mat.triblend",
    label: "Blend Sharp",
    group: "scene3d",
    min: 1,
    max: 8,
    value: 6,
    step: 0.1,
  });
  ps.register({
    id: "scene3d.mat.type",
    label: "Material Shader",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: [
      "Standard",
      "Physical",
      "Toon",
      "Normal",
      "Matcap",
      "Lambert",
      "Phong",
    ],
    value: 0,
  });
  ps.register({
    id: "scene3d.mat.clearcoat",
    label: "Clearcoat",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.transmit",
    label: "Transmit",
    group: "scene3d",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.ior",
    label: "IOR",
    group: "scene3d",
    min: 1,
    max: 3,
    value: 1.5,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.toonSteps",
    label: "ToonSteps",
    group: "scene3d",
    min: 2,
    max: 10,
    value: 4,
    step: 1,
  });
  ps.register({
    id: "scene3d.mat.uvSpeedX",
    label: "UVSpeedX",
    group: "scene3d",
    min: -2,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.uvSpeedY",
    label: "UVSpeedY",
    group: "scene3d",
    min: -2,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.rim",
    label: "Rim Intensity",
    group: "lights3d",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.rimHue",
    label: "Rim Hue",
    group: "lights3d",
    min: 0,
    max: 360,
    value: 180,
    unit: "°",
  });
  ps.register({
    id: "scene3d.mat.emissiveHue",
    label: "Glow Hue",
    group: "lights3d",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "scene3d.mat.emissiveSat",
    label: "Glow Sat",
    group: "lights3d",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  // Both displacement amounts ran 0–2 at step 0.01. In practice the whole
  // useful range sits under ~0.15 — a sphere is radius 1, so displacing it by
  // 2 turns the mesh inside out — which put every playable value in the bottom
  // 7% of the fader, with one step worth a fifth of a working setting. Max 0.5
  // is still well past anything recognisable and makes the travel usable;
  // step 0.001 gives ten times the resolution where the control actually lives.
  // Left linear rather than tapered: a taper would decouple the printed number
  // from the fader position, and the range was the actual complaint.
  ps.register({
    id: "scene3d.mat.displace",
    label: "Math Displace",
    group: "scene3d",
    min: 0,
    max: 0.5,
    value: 0,
    step: 0.001,
  });
  ps.register({
    id: "scene3d.mat.tDisplace",
    label: "T-Displace",
    group: "scene3d",
    min: 0,
    max: 0.5,
    value: 0,
    step: 0.001,
  });
  ps.register({
    // Index 0 keeps T-Displace on the SAME image the surface shows, which is
    // what the control implies. Index 1 is the pre-v0.22.2 route (the global
    // Displace Source layer) — kept because displacing by one source while
    // showing another is a real technique, just a bad default. Indices 2+
    // mirror scene3d.mat.texsrc's own list, offset by DISPSRC_TEX_BASE.
    id: "scene3d.mat.dispsrc",
    label: "T-Disp Source",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: [
      "Same as Surface",
      "Displace Layer",
      "None",
      "Camera",
      "Movie",
      "Screen",
      "Draw",
      "Buffer",
      "Noise",
    ],
    value: 0,
  });
  ps.register({
    id: "scene3d.mat.dispScale",
    label: "DispScale",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 1.0,
    step: 0.05,
  });
  ps.register({
    id: "scene3d.mat.dispSpeed",
    label: "Disp. Speed",
    group: "scene3d",
    min: -5,
    max: 5,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.dispTexScale",
    label: "Disp. Tex Scale",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 1,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.dispTexProj",
    label: "Disp. Projection",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    options: ['UV (Skin)', 'Screen (Projector)'],
    value: 0,
  });
  ps.register({
    id: "scene3d.mat.envIntensity",
    label: "EnvInt",
    group: "lights3d",
    min: 0,
    max: 2,
    value: 1,
    step: 0.01,
  });
  // Light defaults are derived, not dialled by eye. three's BRDF_Lambert
  // returns RECIPROCAL_PI * diffuseColor, so EVERY diffuse contribution is
  // divided by π — the old defaults (1.0 directional + 0.4 ambient) put the
  // brightest point of a textured object at (1.0+0.4)/π ≈ 0.45 of the texture's
  // own brightness, and most of the surface far below that. Correct physics,
  // wrong default for an instrument where the texture IS the picture: it read
  // as "everything is dim until Light Int is at 2".
  //
  // Solved for the brightest point reaching 1.0 alongside the 0.35 emissive
  // floor: 0.35 + (1.6 + 0.45)/π = 1.002. The shadow side keeps
  // 0.35 + 0.45/π = 0.49, so the texture stays readable all the way round
  // instead of going black where the key light does not reach.
  ps.register({
    id: "scene3d.light.intensity",
    label: "Light Int.",
    group: "lights3d",
    min: 0,
    max: 5,
    value: 1.6,
  });
  ps.register({
    // Ceiling raised from 2: it was reachable, and reaching it was how you
    // worked around the dimness above. 5 matches Light Int. and Point Int.
    id: "scene3d.light.ambient",
    label: "Ambient",
    group: "lights3d",
    min: 0,
    max: 5,
    step: 0.01,
    value: 0.45,
  });
  ps.register({
    id: "scene3d.light.point",
    label: "Point Int.",
    group: "lights3d",
    min: 0,
    max: 5,
    step: 0.01,
    value: 0.6,
  });
  ps.register({
    id: "scene3d.light.dirX",
    label: "Light X",
    group: "lights3d",
    min: -10,
    max: 10,
    step: 0.1,
    value: 3.0,
  });
  ps.register({
    id: "scene3d.light.dirY",
    label: "Light Y",
    group: "lights3d",
    min: -10,
    max: 10,
    step: 0.1,
    value: 5.0,
  });
  ps.register({
    id: "scene3d.light.dirZ",
    label: "Light Z",
    group: "lights3d",
    min: -10,
    max: 10,
    step: 0.1,
    value: 3.0,
  });
  ps.register({
    id: "scene3d.spin.x",
    label: "Spin X",
    group: "scene3d",
    min: -180,
    max: 180,
    value: 0,
    unit: "°/s",
  });
  ps.register({
    id: "scene3d.spin.y",
    label: "Spin Y",
    group: "scene3d",
    min: -180,
    max: 180,
    value: 0,
    unit: "°/s",
  });
  ps.register({
    id: "scene3d.spin.z",
    label: "Spin Z",
    group: "scene3d",
    min: -180,
    max: 180,
    value: 0,
    unit: "°/s",
  });
  ps.register({
    id: "scene3d.depth.active",
    label: "DepthPass",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "scene3d.depth.mode",
    label: "DepthMode",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    options: ["Distance", "Normals"],
    value: 0,
  });

  // ── 3D Animation ──────────────────────────────────────────────────────────
  ps.register({
    id: "scene3d.anim.active",
    label: "Anim On",
    group: "scene3d",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "scene3d.anim.select",
    label: "Animation",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    options: ["None"],
    value: 0,
  });
  ps.register({
    id: "scene3d.anim.speed",
    label: "Anim Speed",
    group: "scene3d",
    min: -2,
    max: 2,
    value: 1.0,
    step: 0.1,
  });
  ps.register({
    id: "scene3d.clone.mode",
    label: "Cloner",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["Off", "Grid", "Ring", "Line"],
  });
  ps.register({
    id: "scene3d.clone.count",
    label: "CloneN",
    group: "scene3d",
    min: 2,
    max: 200,
    value: 9,
    step: 1,
  });
  ps.register({
    id: "scene3d.clone.spread",
    label: "Spread",
    group: "scene3d",
    min: 0,
    max: 10,
    value: 2.0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.clone.wave",
    label: "Wave",
    group: "scene3d",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
    unit: "Hz",
  });
  ps.register({
    id: "scene3d.clone.waveshape",
    label: "WaveShape",
    group: "scene3d",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["Sine", "Square", "Triangle", "Sawtooth"],
  });
  ps.register({
    id: "scene3d.clone.waveamp",
    label: "WaveAmp",
    group: "scene3d",
    min: 0,
    max: 10,
    value: 0,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "scene3d.clone.wavefreq",
    label: "WaveFreq",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 1.0,
    step: 0.1,
  });
  ps.register({
    id: "scene3d.clone.twist",
    label: "Twist",
    group: "scene3d",
    min: -360,
    max: 360,
    value: 0,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "scene3d.clone.scatter",
    label: "Scatter",
    group: "scene3d",
    min: 0,
    max: 10,
    value: 0,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "scene3d.clone.scale",
    label: "CloneScale",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 1.0,
    step: 0.05,
  });
  ps.register({
    id: "scene3d.clone.scalestep",
    label: "ScaleStep",
    group: "scene3d",
    min: -2,
    max: 2,
    value: 0,
    step: 0.05,
  });
  ps.register({
    id: "scene3d.blob.amount",
    label: "Metaball Amount",
    group: "scene3d",
    min: 0,
    max: 5,
    value: 0,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "scene3d.blob.scale",
    label: "Metaball Scale",
    group: "scene3d",
    min: 0.1,
    max: 10,
    value: 1.0,
    step: 0.05,
  });
  ps.register({
    id: "scene3d.blob.speed",
    label: "Metaball Speed",
    group: "scene3d",
    min: -5,
    max: 5,
    value: 1.0,
    step: 0.05,
    unit: "Hz",
  });

  // ── SDF Generator ────────────────────────────────────────────────────────
  ps.register({
    id: "sdf.active",
    label: "SDF",
    group: "sdf",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "sdf.opMode",
    label: "Combine",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    select: true,
    options: ["Union", "Smooth Union", "Subtraction", "Intersection"],
  });
  ps.register({
    id: "sdf.opAmount",
    label: "Blend",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    // How far apart the two shapes orbit. Labelled "Separation", not
    // "Distance" — the camera has a Distance now and two params called the
    // same thing in one panel is how a performer reaches for the wrong knob.
    id: "sdf.distance",
    label: "Separation",
    group: "sdf",
    min: 0,
    max: 5.0,
    value: 1.5,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "sdf.shape",
    label: "Shape",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    select: true,
    options: [
      "Sphere",
      "Box",
      "Torus",
      "Capsule",
      "Hexagonal Prism",
      "Octahedron",
      "Link",
      "Mandelbulb",
      // 8+ borrowed from Rutt-Etra's parametric surface list. APPEND ONLY:
      // a SELECT persists as an integer index, so inserting above would
      // re-point every saved sdf.shape. Gyroid/Helicoid/Catenoid are implicit
      // shells rather than exact distance fields — the shader marches them
      // more slowly to compensate.
      "Cylinder",
      "Cone",
      "Gyroid",
      "Helicoid",
      "Catenoid",
    ],
  });
  ps.register({
    // Option 0 is "Same as A", which is the default, so a project that never
    // touches this looks exactly as it did. The shader takes < 0 as the
    // sentinel, so tick() passes value - 1.
    id: "sdf.shapeB",
    label: "Shape B",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    select: true,
    options: [
      "Same as A",
      "Sphere", "Box", "Torus", "Capsule", "Hexagonal Prism", "Octahedron",
      "Link", "Mandelbulb", "Cylinder", "Cone", "Gyroid", "Helicoid", "Catenoid",
    ],
  });
  ps.register({
    // Instances on the orbit. 2 was hardcoded; it stays the default, though the
    // generalised placement moves the second instance's wobble phase slightly
    // (the old counter-shape was not a rotation of the first).
    id: "sdf.count",
    label: "Count",
    group: "sdf",
    min: 1,
    max: 8,
    value: 2,
    step: 1,
  });
  ps.register({
    // Uniform scale on every primitive. Each shape's radius used to be a
    // literal in the shader (sphere 0.6, box 0.42, torus 0.45/0.18 ...), so
    // there was no way to change how big the blobs are at all — only how far
    // apart they orbited. 1.0 reproduces the old hardcoded sizes exactly.
    id: "sdf.size",
    label: "Size",
    group: "sdf",
    min: 0.1,
    max: 3.0,
    value: 1.0,
    step: 0.01,
    unit: "x",
  });
  ps.register({
    // Domain repetition is now gated by a toggle instead of by "is the spacing
    // above 0.1", which made the bottom of the slider a dead zone AND put the
    // usable range above a mush zone where cells were smaller than the shapes.
    id: "sdf.tile",
    label: "Tile",
    group: "sdf",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    // Pure cell spacing now — no longer doubles as the on/off switch. The
    // floor is 1.2 because a cell smaller than that is narrower than a
    // default-size shape, so every cell merges into a solid block; that was
    // the whole bottom of the old 0–10 range.
    id: "sdf.repeat",
    label: "Tile Size",
    group: "sdf",
    min: 1.2,
    max: 10.0,
    value: 3.0,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "sdf.warp",
    label: "Warp",
    group: "sdf",
    min: 0,
    max: 2.0,
    value: 0,
    step: 0.01,
  });
  // ── Camera ────────────────────────────────────────────────────────────────
  // Same grammar as Rutt-Etra: azimuth / elevation / distance to orbit, plus a
  // Move that pushes the OBJECT through the scene. This replaced a raw
  // Cartesian eye position (sdf.camX/camY/camZ) for two reasons. Ergonomics:
  // orbiting a Cartesian eye means moving two sliders in a coordinated
  // sine/cosine relationship, which is not a performable gesture. Correctness:
  // the old shader built its basis with lookAt() and a fixed world up, which
  // degenerates at the poles — looking straight down the Y axis made
  // cross(forward, up) the zero vector and normalize() returned NaN, i.e. a
  // black frame. RuttEtra.js:719 documents abandoning lookAt for exactly this.
  //
  // Saved projects are migrated by migrateSdfCamera() below, which is an exact
  // conversion: the eye lands on the same point, so the image does not move.
  ps.register({
    id: "sdf.orbitX",
    label: "Orbit X",
    group: "sdf",
    min: 0,
    max: 360,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    id: "sdf.orbitY",
    label: "Orbit Y",
    group: "sdf",
    min: -180,
    max: 180,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // Named camDist, not dist: sdf.distance already exists and means the
    // separation between the two shapes.
    id: "sdf.camDist",
    label: "Distance",
    group: "sdf",
    min: 0.5,
    max: 20,
    value: 5,
    step: 0.05,
  });
  ps.register({
    // Move translates the FIELD, not the camera, so it swings with the orbit
    // instead of fighting it — Rutt-Etra's rig.position, same reasoning. This
    // is also what finally makes Tile usable: an infinite lattice you cannot
    // travel through is just a wallpaper you look at from outside.
    id: "sdf.moveX",
    label: "Move X",
    group: "sdf",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.moveY",
    label: "Move Y",
    group: "sdf",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.moveZ",
    label: "Move Z",
    group: "sdf",
    min: -5,
    max: 5,
    value: 0,
    step: 0.01,
  });
  ps.register({
    // Was a hardcoded uv*0.75 in the shader. 74° reproduces that to within
    // 0.3° (the old scaling is an effective focal length of 1.333, which is
    // 2·atan(1/1.333) = 73.74°).
    id: "sdf.fov",
    label: "FOV",
    group: "sdf",
    min: 20,
    max: 120,
    value: 74,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // How much world depth fills the "SDF Depth" source (index 30), centred on
    // the field. Normalising over the whole marched distance instead gave the
    // object 6–12% of the 0–1 range — as few as 15 of 255 levels — and made the
    // value drift with camera distance, so a depth map driving Displace changed
    // meaning whenever you dollied. Smaller = more contrast, narrower slice.
    id: "sdf.depthRange",
    label: "Depth Range",
    group: "sdf",
    min: 0.25,
    max: 8.0,
    value: 1.0,
    step: 0.05,
    unit: "u",
  });
  // ── Quality ───────────────────────────────────────────────────────────────
  // Both were pinned. NOTE, measured: the raymarcher is ~0.3ms of an 18.8ms
  // frame in a default project, so these buy SHARPNESS, not frame rate — the
  // time is going elsewhere in the pipeline.
  ps.register({
    // Internal render scale. 0.5 is what it was fixed at; the target is
    // reallocated when this changes.
    id: "sdf.rscale",
    label: "Detail",
    group: "sdf",
    min: 0.25,
    max: 1.0,
    value: 0.5,
    step: 0.05,
    unit: "x",
  });
  ps.register({
    // March iteration budget. Raise it when Warp is high: Warp shrinks every
    // step, so a fixed budget reaches proportionally less far and distant
    // geometry silently disappears. The shader's compile-time ceiling is 256.
    id: "sdf.steps",
    label: "Steps",
    group: "sdf",
    min: 32,
    max: 256,
    value: 96,
    step: 1,
  });
  ps.register({
    id: "sdf.kifsIter",
    label: "Folds",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["0", "1", "2", "3", "4", "5"],
  });
  ps.register({
    id: "sdf.kifsAngle",
    label: "Fold Angle",
    group: "sdf",
    min: 0,
    max: 360,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    // The fold was `abs(kp) - vec3(1.0)` with both numbers hardcoded, which is
    // one fractal rather than a family. Scale 1 / Offset 1 is that expression
    // exactly, so the default is unchanged.
    id: "sdf.kifsScale",
    label: "Fold Scale",
    group: "sdf",
    min: 0.5,
    max: 2.0,
    value: 1.0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.kifsOffset",
    label: "Fold Offset",
    group: "sdf",
    min: 0,
    max: 2.0,
    value: 1.0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.lumaWarp",
    label: "Luma Warp",
    group: "sdf",
    min: 0,
    max: 2.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.speed",
    label: "Speed",
    group: "sdf",
    min: 0,
    max: 5.0,
    value: 0.2,
    step: 0.01,
  });
  ps.register({
    id: "sdf.lumaThresh",
    label: "Luma Thresh",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.2,
    step: 0.01,
  });
  ps.register({
    id: "sdf.texBlend",
    label: "Tex Blend",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.8,
    step: 0.01,
  });
  ps.register({
    id: "sdf.ao",
    label: "Occlusion",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "sdf.glow",
    label: "Glow",
    group: "sdf",
    min: 0,
    max: 1.0,
    // Off by default. The step-count aura is a strong stylistic statement in a
    // fixed violet, and at 0.2 it tinted every render whether or not it was
    // asked for — including fighting any attempt at clear glass.
    value: 0,
    step: 0.01,
  });
  ps.register({
    // The glow used to be a hardcoded vec3(0.5, 0.1, 0.8). 274° is that exact
    // violet in HSV, so the default is the old colour to the pixel; the shader
    // holds sat and val at the same 0.875 / 0.8 it implied. A hue PARAM rather
    // than a colour picker, so it is MIDI-mappable and captured by Display
    // States like every other sdf.* control.
    id: "sdf.glowHue",
    label: "Glow Hue",
    group: "sdf",
    min: 0,
    max: 360,
    value: 274,
    step: 1,
    unit: "°",
  });
  ps.register({
    // How far the aura reaches, in world units of closest approach. The aura
    // used to be derived from step count, which correlates with proximity only
    // loosely — it also rose with distance travelled and field complexity, and
    // a ray grazing the silhouette through empty space takes big strides and
    // scores LOW. That is why it read as a dull wash no amount of Glow fixed.
    id: "sdf.glowSize",
    label: "Glow Size",
    group: "sdf",
    min: 0.02,
    max: 2.0,
    value: 0.4,
    step: 0.01,
    unit: "u",
  });
  ps.register({
    // Sat and Val were frozen at 0.875 / 0.8 — the decomposition of the one
    // hardcoded violet the aura used to be. Frozen, the aura could only ever be
    // a fully saturated hue at one brightness: no pastels, no near-white core,
    // no dim outer stop. Kept as HSV rather than RGB so Hue stays a single
    // sweepable control; the colour picker beside it is a view onto the three.
    id: "sdf.glowSat",
    label: "Glow Sat",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.875,
    step: 0.01,
  });
  ps.register({
    id: "sdf.glowVal",
    label: "Glow Val",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.8,
    step: 0.01,
  });
  ps.register({
    // Outer stop of the aura gradient; sdf.glowHue is the stop AT the object.
    // Defaults to the same hue, so leaving it alone gives the single-colour
    // aura and the gradient only exists once it is asked for.
    id: "sdf.glowHue2",
    label: "Glow Hue 2",
    group: "sdf",
    min: 0,
    max: 360,
    value: 274,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "sdf.glowSat2",
    label: "Glow Sat 2",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.875,
    step: 0.01,
  });
  ps.register({
    id: "sdf.glowVal2",
    label: "Glow Val 2",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.8,
    step: 0.01,
  });
  ps.register({
    // Tints the aura by the Refract Src surround along the ray's own direction.
    // 0 by default: a multiply against a dark or unrouted surround would put
    // the aura out, and an effect that vanishes when a control is at its
    // default is indistinguishable from a broken one.
    id: "sdf.glowEnv",
    label: "Glow Env",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    // Fresnel used to add flat white, which is why "glass" read as a glowing
    // rim rather than a reflective one — a rim that is the same colour all the
    // way round carries no information about the surroundings, and that
    // information is what reflection IS. The reflected direction is now looked
    // up in the Refract Src texture as a spherical surround. 0 = the old white.
    id: "sdf.envAmt",
    label: "Env Mirror",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 1.0,
    step: 0.01,
  });
  ps.register({
    // One traced bounce, so the shapes can see each other. The equirectangular
    // Env Mirror tap is a SURROUND — it can only ever show what is outside the
    // field, which is why the shapes were invisible in each other's reflections
    // no matter how high Env Mirror went. There is no shortcut for this: the
    // reflected ray has to be marched against the same scene.
    //
    // 0 by default because it is a second march plus a 6-sample normal on every
    // surface pixel. The branch is on a uniform, so at 0 it costs nothing.
    id: "sdf.selfReflect",
    label: "Self Reflect",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    // How much of the self-reflection reaches the image DIRECTLY, instead of
    // only through the Fresnel rim. Self Reflect alone fed envCol, whose only
    // exit is pow(grazing, 3.0) * Fresnel — 0.019 at 45° incidence — so the
    // second march paid for a few pixels of silhouette and read as a dead knob.
    //
    // 0.5 rather than 0: the term is multiplied by Self Reflect, which defaults
    // to 0, so nothing changes for a project that never enabled the feature —
    // which means this can default to a setting that is actually visible for
    // one that did, instead of to a second zero the owner has to discover.
    id: "sdf.reflectAmt",
    label: "Reflect Amt",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    // How far the reflected ray travels before giving up. Was a hardcoded
    // rt > 6.0, which is the whole reason Self Reflect could look dead on a
    // wide layout: two shapes further apart than 6 world units never see each
    // other no matter how high Self Reflect goes, and nothing says so. Default
    // 6.0 reproduces the constant exactly.
    id: "sdf.reflectRange",
    label: "Reflect Range",
    group: "sdf",
    min: 1.0,
    max: 20.0,
    value: 6.0,
    step: 0.1,
  });
  ps.register({
    // Reflection step budget as a fraction of Steps — was a hardcoded
    // uSteps * 0.5. Buys reach and cleanliness through thin or distant
    // geometry, at a second march per surface pixel.
    //
    // CEILING: the reflection loop is unrolled to 128, which is 0.5 x the max
    // Steps of 256, so above Steps 128 this knob saturates before 1.0. Real,
    // and left in rather than papered over — the alternative is 128 more
    // inlined scene() calls and the shader compile hitch that comes with them.
    id: "sdf.reflectDetail",
    label: "Reflect Detail",
    group: "sdf",
    min: 0.1,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    // Was a hardcoded light direction of normalize(vec3(1.0, 1.5, 2.0)).
    // Azimuth 27° / elevation 34° is that same unit vector, so the defaults
    // leave every existing render unchanged.
    id: "sdf.lightAz",
    label: "Light Az",
    group: "sdf",
    min: 0,
    max: 360,
    value: 27,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "sdf.lightEl",
    label: "Light El",
    group: "sdf",
    min: -90,
    max: 90,
    value: 34,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "sdf.hue",
    label: "Hue",
    group: "sdf",
    min: 0,
    max: 360,
    value: 0,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "sdf.sat",
    label: "Sat",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.val",
    label: "Val",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 1.0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.refract",
    label: "Refract",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.fresnel",
    label: "Fresnel",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    // APPEND-ONLY, and kept in lockstep with sdf.refractSrc below and with
    // _sdfSrcToLayerIdx in main.js — one map serves both menus, so the two
    // option arrays must stay the same length and order after entry 0.
    //
    // "None" sits at index 8 and stays there: a SELECT persists an integer, so
    // moving it to the end of the menu would silently re-route every saved
    // state, bank and .imweb that stores 9..15. A slightly odd reading order is
    // the cheaper price.
    id: "sdf.texSrc",
    label: "Source",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: [
      "FG Layer",
      "Camera",
      "Movie A",
      "Draw",
      "Noise",
      "Color",
      "Buffer",
      "3D",
      "None",
      "Output",
      "BG1",
      "BG2",
      "Movie B",
      "Mix 1",
      "Mix 2",
      "Mix 3",
    ],
  });
  ps.register({
    // Same list as sdf.texSrc apart from entry 0, and the same append-only
    // rule. This one is sampled through equirectUv() as a lat-long surround,
    // which is why BG1/BG2 earn their place: an environment map is meant to be
    // a still panorama, and until now those were only reachable by routing them
    // through the BG layer. "Output" is the honest version of "reflect itself"
    // — the SDF writes its own target, so sampling last frame's composite is a
    // real feedback loop rather than a read-during-write. An explicit "SDF"
    // entry would just be black: _notSelf drops it by identity.
    id: "sdf.refractSrc",
    label: "Refract Src",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: [
      "BG Layer",
      "Camera",
      "Movie A",
      "Draw",
      "Noise",
      "Color",
      "Buffer",
      "3D",
      "None",
      "Output",
      "BG1",
      "BG2",
      "Movie B",
      "Mix 1",
      "Mix 2",
      "Mix 3",
    ],
  });

  // ── Draw ──────────────────────────────────────────────────────────────────
  ps.register({
    id: "draw.pensize",
    label: "DrawPenSize",
    group: "draw",
    min: 0,
    max: 100,
    value: 0,
  });
  ps.register({
    id: "draw.erasesize",
    label: "ErasePenSize",
    group: "draw",
    min: 0,
    max: 100,
    value: 10,
  });
  ps.register({
    id: "draw.x",
    label: "DrawX",
    group: "draw",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "draw.y",
    label: "DrawY",
    group: "draw",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "draw.color.h",
    label: "PenHue",
    group: "draw",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "draw.color.s",
    label: "PenSat",
    group: "draw",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "draw.color.v",
    label: "PenBright",
    group: "draw",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "draw.opacity",
    label: "PenOpacity",
    group: "draw",
    min: 1,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "draw.fade",
    label: "DrawFade",
    group: "draw",
    min: 0,
    max: 1,
    value: 0,
    step: 0.005,
  }); // 0 = no fade, 1 = instant clear
  ps.register({
    id: "draw.clear",
    label: "ClearDraw",
    group: "draw",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "draw.inkSource",
    label: "InkSource",
    group: "draw",
    type: PARAM_TYPE.SELECT,
    options: ["Color", "Camera", "Movie", "MovieB", "Noise", "Output"],
    value: 0,
  }); // brush stamps source pixels instead of solid color;
      // Camera/Movie/MovieB use video elements, Noise generates random
      // static, Output snapshots the previous composite frame
  ps.register({
    id: "draw.pressure.size",
    label: "PressSize",
    group: "draw",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  }); // pen pressure → brush size amount; 0 = ignore pressure
  ps.register({
    id: "draw.pressure.opacity",
    label: "PressOpacity",
    group: "draw",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  }); // pen pressure → stroke opacity amount
  ps.register({
    id: "draw.toParticles",
    label: "StrokeEmit",
    group: "draw",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  }); // pen position drives particle.emitx/emity while ink lands

  // ── Draw stroke looper (4 slots — see src/inputs/StrokeLooper.js) ─────────
  for (let n = 1; n <= 4; n++) {
    ps.register({
      id: `drawloop${n}.rec`,
      label: `Loop${n}Rec`,
      group: "draw",
      type: PARAM_TYPE.TRIGGER,
    }); // press = arm+record, press again = stop+play (one MIDI pad drives it)
    ps.register({
      id: `drawloop${n}.play`,
      label: `Loop${n}Play`,
      group: "draw",
      type: PARAM_TYPE.TOGGLE,
      value: 0,
    });
    ps.register({
      id: `drawloop${n}.clear`,
      label: `Loop${n}Clear`,
      group: "draw",
      type: PARAM_TYPE.TRIGGER,
    });
    ps.register({
      id: `drawloop${n}.speed`,
      label: `Loop${n}Speed`,
      group: "draw",
      min: 10,
      max: 400,
      value: 100,
      unit: "%",
    });
  }

  // ── Text ──────────────────────────────────────────────────────────────────
  // Render resolution of the text canvas. group 'text' and therefore CAPTURED
  // by Display States: the option list is code-defined and append-only, so an
  // index means the same thing on every machine and every origin (contrast
  // displace.warpSlot, whose contents are per-origin localStorage).
  ps.register({
    id: "text.res",
    label: "Resolution",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["512", "1024", "2048"],
    value: 1,
  });
  ps.register({
    id: "text.size",
    label: "TextSize",
    group: "text",
    min: 8,
    max: 400,
    value: 72,
  });
  ps.register({
    id: "text.x",
    label: "TextX",
    group: "text",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "text.y",
    label: "TextY",
    group: "text",
    min: 0,
    max: 100,
    value: 50,
  });
  ps.register({
    id: "text.hue",
    label: "TextHue",
    group: "text",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "text.sat",
    label: "TextSat",
    group: "text",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "text.opacity",
    label: "TextOpacity",
    group: "text",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "text.align",
    label: "TextAlign",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Center", "Left", "Right"],
    value: 0,
  });
  ps.register({
    id: "text.font",
    label: "Font",
    group: "text",
    type: PARAM_TYPE.SELECT,
    // MUST stay in the same order as FONTS in src/inputs/TextLayer.js, and
    // APPEND-ONLY: this is persisted as an integer index by every saved state,
    // bank, .imweb file and MIDI mapping. "Bold" and "Italic" are indices 3/4
    // from before text.weight/text.italic existed and stay exactly where they
    // are — reordering them silently restyles every project ever saved.
    options: [
      "Sans", "Serif", "Mono", "Bold", "Italic",
      "Inter", "Grotesk", "Archivo", "Oswald", "Playfair",
      "JetBrains", "Bebas", "Anton", "Orbitron", "Monoton",
      "MajorMono", "VT323", "DotGothic", "Silkscreen",
    ],
    value: 0,
  });
  ps.register({
    id: "text.weight",
    label: "Weight",
    group: "text",
    min: 100,
    max: 900,
    value: 400,
    step: 1,
  });
  ps.register({
    id: "text.italic",
    label: "Italic",
    group: "text",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "text.outline",
    label: "Outline",
    group: "text",
    min: 0,
    max: 20,
    value: 0,
    unit: "px",
  });
  ps.register({
    id: "text.spacing",
    label: "LineSpacing",
    group: "text",
    min: 0.5,
    max: 3,
    value: 1.2,
  });
  ps.register({
    id: "text.mode",
    label: "AdvanceMode",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["All", "Char", "Word", "Line"],
    value: 0,
  });
  ps.register({
    id: "text.bg",
    label: "BlackBG",
    group: "text",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "text.advance",
    label: "TextAdvance",
    group: "text",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "text.autoplay",
    label: "AutoPlay",
    group: "text",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "text.rate",
    label: "AdvRate",
    group: "text",
    min: 0,
    max: 20,
    value: 0,
    unit: "Hz",
  });
  ps.register({
    id: "text.letterspacing",
    label: "LetterSpc",
    group: "text",
    min: -20,
    max: 50,
    value: 0,
  });
  ps.register({
    id: "text.rotation",
    label: "TextRot",
    group: "text",
    min: -180,
    max: 180,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "text.shadowBlur",
    label: "ShadowBlur",
    group: "text",
    min: 0,
    max: 40,
    value: 0,
    unit: "px",
  });
  ps.register({
    id: "text.shadowX",
    label: "ShadowX",
    group: "text",
    min: -50,
    max: 50,
    value: 0,
  });
  ps.register({
    id: "text.shadowY",
    label: "ShadowY",
    group: "text",
    min: -50,
    max: 50,
    value: 0,
  });
  ps.register({
    id: "text.bgOpacity",
    label: "BGOpacity",
    group: "text",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "text.outlineHue",
    label: "OutlineHue",
    group: "text",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "text.outlineSat",
    label: "OutlineSat",
    group: "text",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "text.animMode",
    label: "AnimMode",
    group: "text",
    type: PARAM_TYPE.SELECT,
    // APPEND-ONLY — persisted as an integer index. "Glitch" is index 5.
    options: ["None", "Bounce", "Wave", "Fade", "Typewriter", "Glitch"],
    value: 0,
  });
  ps.register({
    id: "text.animSpeed",
    label: "AnimSpeed",
    group: "text",
    min: 0,
    max: 10,
    value: 2,
  });
  ps.register({
    id: "text.animAmt",
    label: "AnimAmt",
    group: "text",
    min: 0,
    max: 100,
    value: 30,
  });
  ps.register({
    id: "text.contentIdx",
    label: "ContentIdx",
    group: "text",
    min: 0,
    max: 63,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "text.progress",
    label: "Progress",
    group: "text",
    min: 0,
    max: 100,
    value: 0,
    step: 0.1,
  });
  ps.register({
    id: "text.auto",
    label: "AutoHz",
    group: "text",
    min: 0,
    max: 10,
    value: 0,
    step: 0.01,
    unit: "Hz",
  });
  ps.register({
    id: "text.anim.in",
    label: "AnimIn",
    group: "text",
    type: PARAM_TYPE.SELECT,
    // APPEND-ONLY — persisted as an integer index. "Decode" is index 7.
    options: ["None", "Fade", "FadeUp", "FadeDown", "Scale", "Blur", "TypeOn", "Decode"],
    value: 0,
  });
  ps.register({
    id: "text.anim.out",
    label: "AnimOut",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["None", "Fade", "FadeDown", "FadeUp", "Scale", "Blur", "Vanish"],
    value: 0,
  });
  ps.register({
    id: "text.anim.dur",
    label: "AnimDur",
    group: "text",
    min: 0.05,
    max: 2.0,
    value: 0.3,
    step: 0.01,
    unit: "s",
  });
  ps.register({
    id: "text.scrollX",
    label: "ScrollX",
    group: "text",
    min: -100,
    max: 100,
    value: 0,
    step: 0.1,
    unit: "%/s",
  });
  ps.register({
    id: "text.scrollY",
    label: "ScrollY",
    group: "text",
    min: -100,
    max: 100,
    value: 0,
    step: 0.1,
    unit: "%/s",
  });
  ps.register({
    id: "text.scrollGap",
    label: "ScrollGap",
    group: "text",
    min: 0,
    max: 100,
    value: 20,
    unit: "%",
  });
  // ── Path layout ───────────────────────────────────────────────────────────
  // APPEND-ONLY — persisted as an integer index. The four shapes are distinct
  // rather than presets of one formula, so pathTwist has exactly one owner
  // (Spiral) instead of quietly deforming Circle too.
  ps.register({
    id: "text.path",
    label: "Path",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["None", "Circle", "Arc", "Spiral", "Wave"],
    value: 0,
  });
  ps.register({
    id: "text.pathRadius",
    label: "PathRadius",
    group: "text",
    min: 0,
    max: 100,
    value: 30,
    unit: "%",
  });
  ps.register({
    // Put an LFO on this and the ring spins — it is the animation control for
    // the whole path family, not just a static offset.
    id: "text.pathAngle",
    label: "PathAngle",
    group: "text",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "text.pathSpread",
    label: "PathSpread",
    group: "text",
    min: 0,
    max: 360,
    value: 360,
    unit: "°",
  });
  ps.register({
    // 100 % is round ON SCREEN — the aspect correction is already applied, so
    // this is the control for making an ellipse on purpose.
    id: "text.pathWidth",
    label: "PathWidth",
    group: "text",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "text.pathTwist",
    label: "PathTwist",
    group: "text",
    min: -100,
    max: 100,
    value: 30,
    unit: "%",
  });
  ps.register({
    id: "text.pathUpright",
    label: "PathUpright",
    group: "text",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "text.pathFlip",
    label: "PathFlip",
    group: "text",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    // ── Audio reactivity ──────────────────────────────────────────────────────
    // Per-GLYPH, which is the point: each letter reads its own slice of the
    // spectrum, so a word becomes a meter bank. The other bands drive every
    // glyph from one number and are much calmer.
    // APPEND-ONLY — persisted as integer indices.
    id: "text.audioTarget",
    label: "AudioTarget",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Off", "Scale", "Rise", "Hue", "Weight", "Rotate", "Opacity"],
    value: 0,
  });
  ps.register({
    id: "text.audioBand",
    label: "AudioBand",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Spectrum", "Level", "Bass", "Mid", "High"],
    value: 0,
  });
  ps.register({
    id: "text.audioAmt",
    label: "AudioAmt",
    group: "text",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    // Release time only — the attack is always fast. A filter slow enough to
    // stop the flicker in both directions swallows every transient, and the
    // transients are what makes it look played rather than animated.
    id: "text.audioSmooth",
    label: "AudioSmooth",
    group: "text",
    min: 0,
    max: 100,
    value: 40,
    unit: "%",
  });
  ps.register({
    // How much of the spectrum is spread across the word. The top of an FFT is
    // nearly always empty, so spreading all of it leaves most glyphs still.
    id: "text.audioRange",
    label: "AudioRange",
    group: "text",
    min: 5,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "text.stagger",
    label: "Stagger",
    group: "text",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "text.staggerFrom",
    label: "StaggerFrom",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Start", "Center", "End", "Random"],
    value: 0,
  });
  ps.register({
    id: "text.glitchSet",
    label: "GlitchSet",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Symbols", "ASCII", "Blocks", "Katakana"],
    value: 0,
  });
  ps.register({
    id: "text.anim.ease",
    label: "AnimEase",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Linear", "EaseIn", "EaseOut", "EaseInOut", "Bounce", "Spring"],
    value: 2,
  });

  // ── Screen capture ────────────────────────────────────────────────────────
  ps.register({
    id: "screen.bg1",
    label: "ScrBG1",
    group: "screen",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "screen.bg2",
    label: "ScrBG2",
    group: "screen",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── Interpolation ─────────────────────────────────────────────────────────
  ps.register({
    id: "output.interp",
    label: "Interpolation",
    group: "output",
    type: PARAM_TYPE.SELECT,
    options: ["none", "linear", "bicubic"],
    value: 0,
  });
  ps.register({
    id: "output.resolution",
    label: "Resolution",
    group: "output",
    type: PARAM_TYPE.SELECT,
    // APPEND-ONLY. SELECT values persist as integer indices, so 1440p and 4K go
    // at the END even though the list then reads out of order — inserting them
    // after "1080p" would silently repoint every saved state, bank and .imweb
    // file that stored 3 (540p) or 4 (Quarter).
    options: ["Display", "720p", "1080p", "540p", "Quarter", "1440p", "4K"],
    value: 0,
  });
  ps.register({
    id: "output.recResolution",
    label: "Rec Resolution",
    group: "output",
    type: PARAM_TYPE.SELECT,
    // APPEND-ONLY, for the same reason as output.resolution above.
    //
    // "Display" (0) is the old behaviour: capture the output canvas itself, at
    // whatever size it happens to be, with no intermediate surface and no copy.
    // Every other entry records through a fixed-size canvas, which is the point
    // — the recorder's measured cost scales with pixel count, so a take should
    // not get slower because the window got bigger.
    //
    // Group "output", so this IS captured by Display States. Unlike
    // displace.warpSlot or glsl.preset, the options are code-owned and
    // append-only, so an index cannot come to mean something else on another
    // machine or origin; a recorded 1080p is 1080p everywhere.
    options: ["Display", "720p", "1080p", "540p", "1440p", "4K"],
    // 1080p rather than "Display": the whole reason this parameter exists is
    // that recording at the window's size is what made recording slow, and a
    // default of "Display" would leave every existing user with the problem
    // this is here to fix until they found the control.
    value: 2,
  });

  // ── Global BPM / Tap Tempo / Morph ───────────────────────────────────────
  ps.register({
    id: "global.bpm",
    label: "BPM",
    group: "global",
    min: 20,
    max: 300,
    value: 120,
    unit: "bpm",
  });
  ps.register({
    id: "global.midisync",
    label: "MidiSync",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.midisyncres",
    label: "MidiSyncRes",
    group: "global",
    min: 1,
    max: 120,
    value: 1,
    unit: "p/f",
  });
  ps.register({
    id: "global.autosync",
    label: "AutoSync",
    group: "global",
    min: 1,
    max: 1000,
    value: 1,
    unit: "div",
  });
  ps.register({
    id: "global.framedone",
    label: "FrameDonePulse",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.tap",
    label: "Tap Tempo",
    group: "global",
    type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "global.morph",
    label: "Morph",
    group: "global",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
    feedbackVisible: true,
  });
  ps.register({
    id: "global.morphspeed",
    label: "MorphSpeed",
    group: "global",
    min: 0,
    max: 20,
    value: 2,
    step: 0.1,
    unit: "s",
  });
  ps.register({
    id: "global.beatdetect",
    label: "Auto BPM",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.debug",
    label: "Debug",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.showwarpgrid",
    label: "WarpGrid",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.keylock",
    label: "KeyLock",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "global.osd",
    label: "Param OSD",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 1,
  });
  ps.register({
    id: "global.tableSlot",
    label: "Table Slot",
    group: "global",
    type: PARAM_TYPE.SELECT,
    options: [],   // populated by setTableManager() once tableManager is ready
    value: 0,
  });
  ps.register({
    id: "touch.mode",
    label: "Touch Mode",
    group: "global",
    type: PARAM_TYPE.SELECT,
    // Append-only: camera/pad grammars gate on exact indices, and the
    // g-key / 3-finger cyclers use options.length — "Draw" (3) is inert
    // to them and routes canvas pointers to the DrawLayer instead.
    options: ["Camera", "Pad", "Locked", "Draw", "Warp"],
    value: 0,
  });
  ps.register({
    id: "canvas.wheelZoom",
    label: "Wheel Zoom",
    group: "global",
    type: PARAM_TYPE.TOGGLE,
    value: 1,
  });
  ps.register({
    id: "canvas.wheelSens",
    label: "Zoom Sens",
    group: "global",
    min: 0.1,
    max: 3,
    value: 1,
    step: 0.05,
  });
  ps.register({
    id: "motion.enable",
    label: "Enable Motion",
    group: "global",
    type: PARAM_TYPE.TRIGGER, // tap = user gesture → iOS sensor permission
  });
  // ── Per-layer color correction ────────────────────────────────────────────
  ps.register({
    id: "fg.hue",
    label: "FG Hue",
    group: "fg",
    min: -180,
    max: 180,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "fg.sat",
    label: "FG Sat",
    group: "fg",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "fg.bright",
    label: "FG Bright",
    group: "fg",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "fg.opacity",
    label: "FG Opacity",
    group: "fg",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "bg.hue",
    label: "BG Hue",
    group: "bg",
    min: -180,
    max: 180,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "bg.sat",
    label: "BG Sat",
    group: "bg",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "bg.bright",
    label: "BG Bright",
    group: "bg",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "bg.opacity",
    label: "BG Opacity",
    group: "bg",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });

  // ── Effects ───────────────────────────────────────────────────────────────
  // ── Master ────────────────────────────────────────────────────────────────
  // Both are real parameters rather than panel buttons, so they can be MIDI
  // mapped, driven by a controller and captured by a Display State like
  // everything else. A bypass you cannot reach from a controller is not much
  // use to anyone performing.
  //
  // Default 1 = effects on, which is what every existing patch already does.
  // A state saved before this param existed simply has no value for it and
  // lands on the default, so nothing switches itself off on load.
  ps.register({
    id: "effect.enable",
    label: "All FX",
    group: "effect",
    type: PARAM_TYPE.TOGGLE,
    value: 1,
    feedbackVisible: true,
  });
  // Resets every effect parameter to its registered default. It does NOT touch
  // the chain ORDER: the order is an arrangement you built on purpose, and
  // losing it because you cleared some slider values would be a nasty surprise.
  ps.register({
    id: "effect.clearall",
    label: "Clear All FX",
    group: "effect",
    type: PARAM_TYPE.TRIGGER,
  });

  ps.register({
    id: "effect.pixelate",
    label: "Pixelate",
    group: "effect",
    min: 1,
    max: 200,
    value: 1,
    unit: "px",
    feedbackVisible: false,
  });
  ps.register({
    id: "effect.edge",
    label: "Edge",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.edge_inv",
    label: "EdgeInvert",
    group: "effect",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "effect.rgbshift",
    label: "RGB Shift",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.rgbangle",
    label: "RGB Angle",
    group: "effect",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  // These two are OFF at their maximum, which is the opposite of every other
  // row in the panel — 32 levels is no posterisation, and a threshold of 100 %
  // is nothing to invert. The mappings cannot change without moving every saved
  // patch, so the LABELS say what the number is instead: a level count and a
  // threshold, not an effect amount. (Renaming a label is safe: ids, values and
  // MIDI mappings are untouched.)
  ps.register({
    id: "effect.posterize",
    label: "Post.Levels",
    group: "effect",
    min: 2,
    max: 32,
    value: 32,
    step: 1,
  });
  ps.register({
    id: "effect.solarize",
    label: "Sol.Thresh",
    group: "effect",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "effect.kaleidoscope",
    label: "Kaleidoscope",
    group: "effect",
    min: 0,
    max: 16,
    value: 0,
    step: 1,
  });
  ps.register({
    id: "effect.kalerot",
    label: "Kale.Rot",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.vignette",
    label: "Vignette",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.vigradius",
    label: "Vign.Radius",
    group: "effect",
    min: 0,
    max: 100,
    value: 65,
    unit: "%",
  });
  ps.register({
    id: "effect.bloom",
    label: "Bloom",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.bloomthresh",
    label: "BloomThresh",
    group: "effect",
    min: 0,
    max: 100,
    value: 70,
    unit: "%",
  });
  // Tap SPACING, not tap count — the 9-tap Gaussian is unchanged, so a wide
  // bloom costs the same as a narrow one. Past ~4 the taps undersample into
  // visible rings, which is where the range stops.
  ps.register({
    id: "effect.bloomradius",
    label: "BloomRadius",
    group: "effect",
    min: 0.25,
    max: 4,
    value: 1, // the original fixed kernel spacing
    step: 0.05,
    unit: "×",
  });

  // ── Bokeh (Optics) ────────────────────────────────────────────────────────
  // Defocus driven by a ROUTABLE MASK, not by depth: video carries no depth
  // buffer, and the only browser-viable monocular estimator costs a throttled
  // neural pass. The gather does not know what the mask means, so when real
  // depth ever lands as a source it drives this effect unchanged.
  //
  // Unlike bloom, this kernel is NOT separable — a bladed iris cannot be, which
  // is the whole point of the effect — so radius is not free here the way
  // bloomradius is. Cost lives in bokehquality.
  ps.register({
    id: "effect.bokeh",
    label: "Bokeh",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  // `options: SOURCES` must be the SHARED array, never a copy: UI.js and
  // ParamRow.js pick the menu display order by the identity test
  // `options === SOURCES`, so a spread here would silently render the raw
  // array order instead of the Sources-tab taxonomy.
  //
  // Default resolved by KEY, never by a literal index — a key cannot rotate
  // under an append to SOURCE_DEFS, and a bare number is exactly how
  // _sdfSrcToLayerIdx drifted three menu entries and read as an effect bug.
  ps.register({
    id: "effect.bokehmask",
    label: "Bokeh.Mask",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: SOURCES,
    value: SOURCE_KEYS.indexOf("motion"),
  });
  // Max circle of confusion, as a PERCENTAGE OF FRAME HEIGHT — not pixels and
  // not bloomradius's "×".
  //
  // It shipped once as 0.25-8 "×", copied from bloomradius. That range is right
  // for bloom, where the number is a tap SPACING multiplier, and meaningless
  // here, where it is a real radius: the handler read it as pixels, so the
  // default 2 was a two-pixel blur on a 1900-pixel canvas. Invisible — while
  // the highlight boost and the power gather still ran at full strength, so the
  // effect looked exactly like bloom and nothing like defocus.
  //
  // Relative to height rather than absolute pixels so the look survives a
  // resolution change: a fixed pixel radius halves in apparent strength going
  // from 1080p to 4K, which is precisely the comparison this project gets
  // judged on.
  ps.register({
    id: "effect.bokehradius",
    label: "Bokeh.Radius",
    group: "effect",
    min: 0,
    max: 100,
    value: 25,
    unit: "%",
  });
  // The mask value that stays SHARP. Focus is a plane, not a side: 100 keeps
  // white sharp (a motion matte's moving subject), 0 keeps black sharp (its
  // static background), and a mid value keeps a band sharp and blurs away from
  // it in both directions. That covers both polarities, which is why there is
  // no separate Invert toggle — two ways to encode one state is a second
  // captured param that can disagree with the first.
  ps.register({
    id: "effect.bokehfocus",
    label: "Bokeh.Focus",
    group: "effect",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "effect.bokehfeather",
    label: "Bokeh.Feather",
    group: "effect",
    min: 0,
    max: 100,
    value: 30,
    unit: "%",
  });
  // Mask smoothing, in SECONDS, on the same "time to visually gone" convention
  // MotionExtract uses: after T seconds 2% of the old value remains. Matching
  // that convention matters more than picking a nicer curve — two different
  // meanings of "seconds" in one instrument is what made Motion's own Bg-adapt
  // and Trail read as simply wrong before they were reconciled.
  //
  // Easing the MASK rather than the picture is the point: it makes the discs
  // glide instead of flicking, which is what a focus pull actually looks like.
  // 0 disables the pass outright rather than approaching zero.
  ps.register({
    id: "effect.bokehsmooth",
    label: "Bokeh.Smooth",
    group: "effect",
    min: 0,
    max: 2,
    value: 0.25,
    step: 0.01,
    unit: "s",
  });
  ps.register({
    id: "effect.bokehblades",
    label: "Bokeh.Blades",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Circle", "5", "6", "8"],
    value: 0,
  });
  ps.register({
    id: "effect.bokehrotate",
    label: "Bokeh.Iris",
    group: "effect",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  // Apodization — where the energy sits across the disc. This is the parameter
  // that separates an OPTICAL effect from a soft one: real lens bokeh puts a
  // bright rim on every out-of-focus highlight (spherical aberration, or a
  // mirror lens), and at the extreme the disc reads as nearly hollow. Negative
  // is centre-weighted and smooth, 0 is a flat disc, positive is soap-bubble.
  ps.register({
    id: "effect.bokehring",
    label: "Bokeh.Ring",
    group: "effect",
    min: -100,
    max: 100,
    value: 0,
    unit: "%",
  });
  // Highlights must DOMINATE the disc rather than average into it, or
  // overlapping discs turn to mush exactly where a real lens gives structure.
  ps.register({
    id: "effect.bokehhighlight",
    label: "Bokeh.Highlight",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "effect.bokehthresh",
    label: "Bokeh.Thresh",
    group: "effect",
    min: 0,
    max: 100,
    value: 70,
    unit: "%",
  });
  // Highlight discs, added back on top of the defocus.
  //
  // Why this is not just more Highlight: spreading a point across a disc
  // DIVIDES its energy by the sample count. Measured on the real shader, a 4px
  // highlight gathered at radius 12 peaks at 13/255 — a disc too faint to see
  // against any real scene, which is why a correct gather can look like it is
  // doing nothing. Extracting the highlights, gathering those separately and
  // ADDING them back with gain restores exactly what the averaging removed.
  //
  // Thresh gates the extraction, so raising it shrinks each highlight to its
  // brightest core — and a highlight only reads as a disc once it is small
  // relative to the radius. Measured: rim/centre contrast is 5.17 when the
  // highlight matches the radius and exactly 1.00 (no disc at all) by twice it.
  //
  // 0 skips the extract and the second gather entirely, so the honest optical
  // defocus costs no more than it did before this existed.
  ps.register({
    id: "effect.bokehdiscs",
    label: "Bokeh.Discs",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  // A SELECT, not a slider, and not by preference: GLSL ES 1.00 requires
  // CONSTANT loop bounds, so sample count cannot be a uniform. Each tier is a
  // separately compiled variant behind `#define BOKEH_SAMPLES n`.
  ps.register({
    id: "effect.bokehquality",
    label: "Bokeh.Quality",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Draft", "Good", "Fine", "Max"],
    value: 1,
  });

  // ── Geometry-effect placement ─────────────────────────────────────────────
  // Kaleidoscope and Vignette were both pinned to the middle of the frame and
  // both measured distance in raw UV. A centre is the single biggest thing
  // either one was missing — the same gap FBZoom/FBRotate had before v0.17.
  ps.register({
    id: "effect.kalecx",
    label: "Kale.CenterX",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "effect.kalecy",
    label: "Kale.CenterY",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  // What the mirror finds outside the frame. Was hardcoded fract() — a wrap,
  // and the one option nobody would have chosen for the area beyond the disc.
  ps.register({
    id: "effect.kaleedge",
    label: "Kale.Edge",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Clamp", "Mirror", "Wrap", "Black"],
    value: 1, // Mirror — the seamless one; Wrap reproduces the old fract()
  });
  ps.register({
    id: "effect.vigcx",
    label: "Vign.CenterX",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "effect.vigcy",
    label: "Vign.CenterY",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  // Vignette tint. Hue alone would be meaningless at zero saturation, so the
  // pair is hue + how far from black to take it; Tint 0 is the classic
  // darkening and leaves every existing patch untouched.
  ps.register({
    id: "effect.vighue",
    label: "Vign.Hue",
    group: "effect",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "effect.vigtint",
    label: "Vign.Tint",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.edge_color",
    label: "EdgeColor",
    group: "effect",
    type: PARAM_TYPE.TOGGLE,
    value: 0, // grey edges, as before
  });
  // Roll-off width around the threshold. 0 is the original hard switch.
  ps.register({
    id: "effect.solarsoft",
    label: "Sol.Soft",
    group: "effect",
    min: 0,
    max: 50,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.scancount",
    label: "Scan.Count",
    group: "effect",
    min: 20,
    max: 1200,
    value: 400, // the number that was hardcoded in the shader
    step: 1,
  });

  // ── Effects that already existed, wired to something else ─────────────────
  // No new shader code behind any of these four: SHARPEN drove only the noise
  // generator, COLOR_CORRECT only the per-layer tint, MIRROR only the per-layer
  // flip, and INTERLACE ran outside the reorderable chain.
  ps.register({
    id: "effect.sharpen",
    label: "Sharpen",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  // Whole-output HSV. The per-layer FG/BG rows could already do this to each
  // layer separately; there was no way to turn the composite.
  ps.register({
    id: "effect.outhue",
    label: "Out.Hue",
    group: "effect",
    min: -180,
    max: 180,
    value: 0,
    unit: "°",
  });
  ps.register({
    id: "effect.outsat",
    label: "Out.Sat",
    group: "effect",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "effect.outbright",
    label: "Out.Bright",
    group: "effect",
    min: 0,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "effect.flip",
    label: "Flip",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Off", "H", "V", "Both"],
    value: 0,
  });

  // ── New effects (v0.17) ───────────────────────────────────────────────────
  // All default to off, so they cost nothing and change nothing until asked for.
  // Each geometry effect carries its own centre and edge mode rather than
  // borrowing the kaleidoscope's — they are independent nodes in a reorderable
  // chain and can be used in any combination.
  ps.register({
    id: "effect.polar",
    label: "Polar",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.polarmode",
    label: "Polar.Mode",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Wrap", "Unroll"],
    value: 0,
  });
  ps.register({
    id: "effect.polarrot",
    label: "Polar.Rot",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "% turn",
  });
  ps.register({
    id: "effect.wavex",
    label: "Wave.AmpX",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "‰",
  });
  ps.register({
    id: "effect.wavey",
    label: "Wave.AmpY",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "‰",
  });
  ps.register({
    id: "effect.wavefx",
    label: "Wave.FreqX",
    group: "effect",
    min: 0,
    max: 60,
    value: 12,
    step: 0.1,
  });
  ps.register({
    id: "effect.wavefy",
    label: "Wave.FreqY",
    group: "effect",
    min: 0,
    max: 60,
    value: 12,
    step: 0.1,
  });
  // The one to put an LFO on.
  ps.register({
    id: "effect.wavephase",
    label: "Wave.Phase",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "% turn",
  });
  ps.register({
    id: "effect.halftone",
    label: "Halftone",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.halfsize",
    label: "Half.Size",
    group: "effect",
    min: 2,
    max: 40,
    value: 6,
    step: 0.5,
    unit: "px",
  });
  ps.register({
    id: "effect.halfangle",
    label: "Half.Angle",
    group: "effect",
    min: 0,
    max: 90,
    value: 15,
    unit: "°",
  });
  ps.register({
    id: "effect.halfmode",
    label: "Half.Mode",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Mono", "Colour"],
    value: 0,
  });
  ps.register({
    id: "effect.duotone",
    label: "Duotone",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.duohue1",
    label: "Duo.Dark",
    group: "effect",
    min: 0,
    max: 360,
    value: 260,
    unit: "°",
  });
  ps.register({
    id: "effect.duohue2",
    label: "Duo.Light",
    group: "effect",
    min: 0,
    max: 360,
    value: 45,
    unit: "°",
  });
  // Signed: negative pincushion, positive barrel, 0 flat.
  ps.register({
    id: "effect.lens",
    label: "Lens",
    group: "effect",
    min: -100,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.twirl",
    label: "Twirl",
    group: "effect",
    min: -100,
    max: 100,
    value: 0,
    unit: "% turn",
  });
  // One centre and one edge mode shared by Polar, Wave and Lens — they are the
  // three effects that sample outside the frame, and a per-effect centre for
  // each would be six more rows for a distinction nobody performs.
  ps.register({
    id: "effect.warpcx",
    label: "Warp.CenterX",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "effect.warpcy",
    label: "Warp.CenterY",
    group: "effect",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "effect.warpedge",
    label: "Warp.Edge",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Clamp", "Mirror", "Wrap", "Black"],
    value: 1, // Mirror — seamless, and the least like a mistake at the corners
  });

  // ── Levels ────────────────────────────────────────────────────────────────
  ps.register({
    id: "effect.lvblack",
    label: "LvBlack",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.lvwhite",
    label: "LvWhite",
    group: "effect",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "effect.lvgamma",
    label: "LvGamma",
    group: "effect",
    min: 10,
    max: 400,
    value: 100,
    unit: "%",
  });

  // ── Quad Mirror ───────────────────────────────────────────────────────────
  ps.register({
    id: "effect.quadmirror",
    label: "QuadMirror",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Off", "4-Way", "Diagonal"],
    value: 0,
  });

  // ── Stroboscope ───────────────────────────────────────────────────────────
  ps.register({
    id: "effect.strobe",
    label: "Strobe",
    group: "effect",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
    feedbackVisible: true,
  });
  ps.register({
    id: "effect.stroberate",
    label: "StrobeRate",
    group: "effect",
    min: 0.5,
    max: 60,
    value: 8,
    unit: "Hz",
  });
  ps.register({
    id: "effect.strobeduty",
    label: "StrobeDuty",
    group: "effect",
    min: 1,
    max: 99,
    value: 50,
    unit: "%",
  });

  // ── Film Grain / Scanlines ────────────────────────────────────────────────
  ps.register({
    id: "effect.grain",
    label: "FilmGrain",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.scanlines",
    label: "Scanlines",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.lutamount",
    label: "LUT Amount",
    group: "lut",
    min: 0,
    max: 100,
    value: 100,
    unit: "%",
  });

  // ── White Balance ─────────────────────────────────────────────────────────
  ps.register({
    id: "effect.wbtemp",
    label: "WB Temp",
    group: "effect",
    min: -100,
    max: 100,
    value: 0,
    unit: "",
  });
  ps.register({
    id: "effect.wbtint",
    label: "WB Tint",
    group: "effect",
    min: -100,
    max: 100,
    value: 0,
    unit: "",
  });

  // ── Pixel Sort ────────────────────────────────────────────────────────────
  ps.register({
    id: "effect.pixelsort",
    label: "PixSort",
    group: "effect",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "effect.psortlen",
    label: "SortLen",
    group: "effect",
    min: 1,
    max: 512,
    value: 64,
    unit: "px",
  });
  ps.register({
    id: "effect.psortthresh",
    label: "SortThresh",
    group: "effect",
    min: 0,
    max: 100,
    value: 30,
    unit: "%",
  });
  ps.register({
    id: "effect.psortdir",
    label: "SortDir",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Vert", "Horiz"],
    value: 0,
  });
  ps.register({
    id: "effect.psortmode",
    label: "SortMode",
    group: "effect",
    type: PARAM_TYPE.SELECT,
    options: ["Bright", "Dark"],
    value: 0,
  });

  // ── Video Delay Line ──────────────────────────────────────────────────────
  ps.register({
    id: "delay.frames",
    // "DelayFrames" was 11 characters and overflowed the panel's label column,
    // rendering as "DelayFram…" — the same overflow the Phase 24 warp params hit.
    // Everything else in this panel is 9-10.
    label: "Delay",
    unit: "fr",
    group: "delay",
    min: 1,
    // Ceiling is the deepest ring delay.size can allocate. The ACHIEVABLE depth
    // is lower whenever the ring is shorter or the VRAM budget clamped it, so
    // getTexture() returns null past the real history and the compositor holds
    // the last good frame. A fixed max here is fine because the param is a
    // request, not a promise.
    max: 480,
    value: 5,
    step: 1,
  });
  // What the delay records. Was hardwired to the composited output — a coherent
  // default (an echo of everything, which is why it reads well as a BG under a
  // live FG) but the only thing it could ever do. Resolved through the same
  // _resolveLayerTex() the layers use; default 8 ("Output") is the old wiring.
  ps.register({
    id: "delay.source",
    label: "Delay src",
    group: "delay",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 8,
  });
  // Ring depth. Seconds assume 60 fps.
  ps.register({
    id: "delay.size",
    label: "Ring depth",
    group: "delay",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["30 (0.5s)", "60 (1s)", "120 (2s)", "240 (4s)", "480 (8s)"],
    value: 0,
  });
  // Working resolution, decoupled from the canvas — this is the lever that makes
  // a long echo affordable. 30 frames at Native is 237 MB for half a second; the
  // same VRAM buys 240 frames (4s) at 640x480, or 8s at 320x240 for less.
  // The trade is real: the delay is composited at full canvas size, so a low
  // buffer resolution is visibly softer. Default Native keeps today's picture.
  ps.register({
    id: "delay.bufferResolution",
    label: "Buffer res",
    group: "delay",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["Native", "640×480", "640×360", "320×240"],
    value: 0,
  });

  // ── RGB Channel Delay (source 31) ───────────────────────────────────────────
  // Per-channel age over the SAME ring Video Delay records, so there is no
  // second buffer and no second source selector: these read delay.source.
  //
  // Units match delay.frames — same ring, so a number means the same thing in
  // both panels. The ceiling is a request, not a promise: getTexture()
  // saturates at the achievable depth.
  //
  // MIN IS 1, NOT 0. getTexture() does Math.max(1, framesAgo), so 0 and 1 are
  // the same frame — a 0-based range would alias its bottom two steps and make
  // "R 0, G 1, B 2" sample only TWO distinct frames while looking like three.
  // That reads as "the effect barely works", not as an off-by-one, which is
  // exactly how it was found: a 0/1/2 test came back grey because R and G were
  // identical by construction.
  //
  // Defaults are a visible spread (1 / 5 / 9 frames ≈ 0 / 67 / 133 ms at 60fps)
  // rather than a neutral 1/1/1. This is a NEW source, not a parameter carved
  // out of an existing constant, so there is no prior picture to reproduce —
  // and a source that renders identically to its input on first selection reads
  // as broken. Equal values on all three ARE a bit-exact passthrough, so
  // neutral is one drag away.
  for (const [ch, label, dflt] of [
    ["r", "Red delay",   1],
    ["g", "Green delay", 5],
    ["b", "Blue delay",  9],
  ]) {
    ps.register({
      id: `rgbdelay.${ch}`,
      label,
      group: "rgbdelay",
      type: PARAM_TYPE.CONTINUOUS,
      min: 1,
      max: 480,
      value: dflt,
      step: 1,
    });
  }

  // ── Motion Extraction (source 32) ───────────────────────────────────────────
  // A matte: white where the source moves, black where it does not. Built to be
  // routed into the keyer's key source, not to be looked at directly.
  //
  // There is deliberately no threshold and no softness here. The keyer already
  // has White / Black / Softness and this matte is its input, so a second set
  // would be two controls doing one job. What IS here is gain, because a raw
  // frame-to-frame difference is a few percent and would otherwise sit at the
  // very bottom of the keyer's range.
  //
  // ONE THING TO KNOW when routing this to the keyer: the keyer passes a BAND —
  // `alpha = smoothstep(black..) * (1 - smoothstep(white..))` — so it rejects
  // the very bright as well as the very dark. At the default KeyLevelWhite of
  // 80% a fully lit matte is keyed OUT, which looks like the brightest motion
  // being the only thing that fails to show. Set KeyLevelWhite to 100% and let
  // KeyLevelBlack alone do the cutting. That is a property of the keyer, not of
  // this matte, which is why it is documented rather than worked around here.
  ps.register({
    id: "motion.source",
    label: "Motion src",
    group: "motion",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 0,                        // Camera — the case this was built for
  });
  // Ranges narrowed after the first real-camera session: 50 and 30 were both
  // well past the useful end, which wastes most of the knob's travel on
  // settings nobody reaches and leaves the part that matters too coarse to
  // dial. Narrowing a max CLAMPS any saved value above it, so this is a change
  // that is free now — the parameters have never shipped — and would silently
  // rewrite people's looks once they had.
  ps.register({
    id: "motion.gain",
    label: "Sensitivity",
    group: "motion",
    type: PARAM_TYPE.CONTINUOUS,
    min: 1, max: 20, value: 8, step: 0.1,
  });
  // Background half-life, in SECONDS. This one control spans both algorithms:
  // long values give a stable background estimate, so a subject who stops
  // moving STAYS in the matte; 0 makes the background exactly the previous
  // frame, which is frame differencing, where anything that stops vanishes.
  // It is one knob rather than a mode select because those are the two ends of
  // a continuum the shader already spans — and because the interesting settings
  // are in between.
  ps.register({
    id: "motion.bgtime",
    label: "Bg adapt",
    group: "motion",
    type: PARAM_TYPE.CONTINUOUS,
    min: 0, max: 10, value: 4, step: 0.05,
  });
  // Time until a trail is visually gone, in seconds — `rutt.rise`/`rutt.fall`
  // convention. Frame counts would mean different things at different frame
  // rates, and dt is not trustworthy here.
  ps.register({
    id: "motion.trail",
    label: "Trail (s)",
    group: "motion",
    type: PARAM_TYPE.CONTINUOUS,
    min: 0, max: 10, value: 0.6, step: 0.05,
  });
  // Blur applied to the SOURCE, before the comparison — the only place sensor
  // grain can be removed for free. Downstream it has already been multiplied by
  // Sensitivity and accumulated into the trail, and neither is reversible.
  // It also fills interiors: a blurred moving object differs from the blurred
  // background across its whole area rather than only at its edges, so
  // silhouettes come out solid instead of hollow.
  //
  // Brightness and contrast were considered here and deliberately left out.
  // Brightness shifts the current frame and the background by the SAME amount —
  // the background is an average of past frames — so it cancels in
  // |cur - bg| and would be a control that does nothing at every setting.
  // Contrast scales both, giving k·|cur - bg|, which is exactly what
  // Sensitivity already does; the two would multiply and you would have to
  // reason about the product to predict anything.
  //
  // Default 0 reproduces the pre-Smoothness picture bit for bit. 1–2 is the
  // useful range on a live camera.
  ps.register({
    id: "motion.blur",
    label: "Smoothness",
    group: "motion",
    type: PARAM_TYPE.CONTINUOUS,
    min: 0, max: 4, value: 0, step: 0.05,
  });

  // ── Particles ─────────────────────────────────────────────────────────────
  ps.register({
    id: "particle.count",
    label: "PCount",
    group: "particle",
    type: PARAM_TYPE.SELECT,
    options: ["1k", "4k", "16k", "64k", "262k"],
    value: 4, // default 262k — GPU engine full resolution
  });
  ps.register({
    id: "particle.spread",
    label: "PSpread",
    group: "particle",
    min: 0,
    max: 100,
    value: 90,
    unit: "%",
  });
  ps.register({
    id: "particle.size",
    label: "PSize",
    group: "particle",
    min: 1,
    max: 32,
    value: 1,
    unit: "px",
  });
  ps.register({
    id: "particle.masksrc",
    label: "PMaskSrc",
    group: "particle",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: PARTICLE_MASK_LABELS,
  });
  ps.register({
    id: "particle.emitter",
    label: "PEmitter",
    group: "particle",
    type: PARAM_TYPE.SELECT,
    options: ["Box", "Ring", "LineH", "LineV", "Point"],
    value: 0,
  });
  ps.register({
    id: "particle.emitx",
    label: "PEmitX",
    group: "particle",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "particle.emity",
    label: "PEmitY",
    group: "particle",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  // PScaleBy, Attr1/Attr2 removed — belonged to legacy ParticleSystem.js (never instantiated).
  // Attractors replaced by Ghost 1/2/3 in the GPU Engine section.

  // The `vasulka.*` sine-warp FX pass was removed here. It was a dead
  // post-effect — commented out of DEFAULT_FX_ORDER, no panel — kept only so
  // old presets naming it would still load. Both load paths already skip
  // unknown ids (ParameterSystem.restoreState guards on the param existing,
  // ControllerManager.assign warns and returns), so nothing needed migrating.
  // NOT to be confused with the Warp Tape, which is `vwarp.*` and very much
  // alive — the shared "Vasulka Warp" name is why this note is here.

  // ── Slit Scan ─────────────────────────────────────────────────────────────
  // What the slit samples. Was hardwired to the composited output, which made
  // the engine self-referential: route a layer to SlitScan and the strip it
  // grabs is a column of its own already-scrolled canvas, so it scans itself
  // and can never bootstrap from black. Resolved through the same
  // _resolveLayerTex() the layers use.
  // Default 8 ("Output") reproduces the old wiring exactly.
  // Group 'slitscan', so captured by Display States — this indexes SOURCES,
  // which is append-only and not user-editable, so it cannot drift under a
  // saved state. Same reasoning as mix.srcA and td.mapSource.
  ps.register({
    id: "slitscan.source",
    label: "Slit src",
    group: "slitscan",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 8,
  });
  ps.register({
    id: "slitscan.active",
    label: "SlitScan",
    group: "slitscan",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "slitscan.pos",
    label: "SlitPos",
    group: "slitscan",
    min: 0,
    max: 100,
    value: 50,
    unit: "%",
  });
  ps.register({
    id: "slitscan.speed",
    label: "SlitSpeed",
    group: "slitscan",
    min: 0.5,
    max: 60,
    value: 15,
    unit: "fps",
  });
  ps.register({
    id: "slitscan.axis",
    label: "SlitAxis",
    group: "slitscan",
    type: PARAM_TYPE.SELECT,
    options: ["Vertical", "Horizontal", "Center-V", "Center-H"],
    value: 0,
  });
  ps.register({
    id: "slitscan.width",
    label: "SlitWidth",
    group: "slitscan",
    min: 1,
    max: 16,
    value: 2,
    unit: "px",
    step: 1,
  });
  ps.register({
    id: "slitscan.clear",
    label: "SlitClear",
    group: "slitscan",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── Time-Displacement Engine (Steina "Warp" / slit-scan) ──────────────────
  // Phase 1: enable + k-steps-back debug read. Map/range/shape params land in
  // later phases. Canonical source key is `tdisp` (label "TimeDisp", index 24).
  ps.register({
    id: "td.enabled",
    label: "TimeDisp",
    group: "td",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  // captureSource = what gets WRITTEN into the ring (distinct from mapSource,
  // Phase 4, which drives the per-pixel delay). Default Camera = clean delay.
  // Mirrors the Layers source list (SOURCES) for full parity. "Output" and
  // "TimeDisp" are deliberate self-feedback (needs feedbackGain/clamp, Phase 4).
  // Conditionally-ticked sources (3D Scene, 3D Depth, SDF, Analog) only update
  // when a layer also uses them this frame; otherwise capture is a no-op.
  ps.register({
    id: "td.captureSource",
    label: "Capture src",
    group: "td",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 0,
  });
  // Phase 3 — analytic gradient read (array-texture path). mode shapes the
  // per-pixel delay d(x,y); maxDelay clamped ≤ bufferFrames−1 (N=60) in tick.
  ps.register({
    id: "td.mode",
    label: "Mode",
    group: "td",
    type: PARAM_TYPE.SELECT,
    select: true,
    // "Shear", not "Slit": these are time-displacement gradients — each column
    // reads its own pixels at its own age. A slit-scan takes ONE fixed column and
    // multiplies it across space, which is the separate Slit Scan engine two
    // subsections below. Calling both "Slit" is what made TimeDisplace look like
    // it was taking over from slitscan.
    // Labels only — SELECT persists the index, so saved states, Display States,
    // .imweb projects and MIDI mappings are untouched.
    options: ["Shear X", "Shear Y", "Warp Line", "Shear X Sym", "Shear Y Sym", "Radial", "Noise"],
    value: 0,
  });
  // Phase 5a — buffer/output resolution decoupling. bufferResolution sets the
  // engine's working size (ring + read); the compositor upscales to display
  // with upscaleFilter. Native = display size (no decoupling).
  ps.register({
    id: "td.bufferResolution",
    label: "Buffer res",
    group: "td",
    type: PARAM_TYPE.SELECT,
    select: true,
    options: ["320×240", "640×360", "640×480", "Native"],
    value: 1,
  });
  ps.register({
    id: "td.upscaleFilter",
    label: "Upscale",
    group: "td",
    type: PARAM_TYPE.SELECT,
    options: ["Nearest", "Linear"],
    value: 1,
  });
  ps.register({
    id: "td.maxDelay",
    label: "Max delay",
    group: "td",
    min: 1,
    max: 119,
    value: 119,
    step: 1,
    unit: "fr",
  });
  ps.register({
    id: "td.delayCurve",
    label: "Curve",
    group: "td",
    min: 0.1,
    max: 4.0,
    value: 1.0,
    step: 0.05,
  });
  ps.register({
    id: "td.direction",
    label: "Direction",
    group: "td",
    type: PARAM_TYPE.SELECT,
    options: ["Forward", "Backward"],
    value: 0,
  });
  ps.register({
    id: "td.scanPosition",
    label: "Scan pos",
    group: "td",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "td.scanPosY",
    label: "Scan pos Y",
    group: "td",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "td.scanWidth",
    label: "Scan width",
    group: "td",
    min: 0,
    max: 1,
    value: 0.05,
    step: 0.01,
  });
  ps.register({
    id: "td.invertMap",
    label: "Invert map",
    group: "td",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  // Phase 25 step 4 — the sampling plane. `angle` rotates the delay map about
  // the frame centre, so every mode above becomes orientable: a slit-scan that
  // runs diagonally, a warp line at any angle. Continuous, so an LFO sweeps the
  // direction time flows through the picture with no mode switch. Default 0 is
  // the exact identity, so saved states are unaffected.
  // Degrees, matching displace.warpDrawAngle and the 3D rotation params.
  ps.register({
    id: "td.angle",
    label: "Angle",
    group: "td",
    min: 0,
    max: 360,
    value: 0,
    unit: "°",
  });
  // What drives the per-pixel delay map. Was hardwired to the Noise generator;
  // resolved through the same _resolveLayerTex() the layers use, ANY source can
  // now be the delay field — the camera's luminance, an SDF distance field, a
  // movie. Default 5 (Noise) reproduces the old wiring exactly.
  // Group 'td', so captured by Display States: unlike glsl.preset this indexes
  // SOURCES, which is append-only and not user-editable, so the index cannot
  // drift under a saved state. Same reasoning as mix.srcA.
  ps.register({
    id: "td.mapSource",
    label: "Map src",
    group: "td",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 5,
  });
  // Blend the map source into the analytic shapes (modes 0-5) — a slit-scan
  // jittered by noise or by the camera. Mode 6 (Noise) is already pure map, so
  // it ignores this. Default 0 keeps every shape exact.
  ps.register({
    id: "td.mapAmount",
    label: "Map amt",
    group: "td",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });

  // ── Warp Tape (`vwarp.*`) — source 22, panel "Warp ▸ Tape" ────────────────
  // A tape whose horizontal axis is time: one column written per frame at a
  // moving head, the whole tape read as a frame. NOT a slit-scan (that is
  // `slitscan.*`, which multiplies ONE fixed column across space) — this offsets
  // each column in time at its own position, a shear. See VasulkaWarp.js.
  // What gets written onto the tape. Replaces a hardcoded
  // `camera3d.active ? camera : pipeline.prev` heuristic in main.js that no
  // parameter could reach — so with a camera attached the engine could only ever
  // warp the camera, whatever the performer intended.
  // Default 0 (Camera) keeps what a camera-attached setup already sees, and
  // matches the lineage: Steina performed to a camera. Unlike slitscan.source
  // (which defaults to Output) there is no single index that reproduces the old
  // heuristic, because the heuristic depended on runtime state.
  ps.register({
    id: "vwarp.source",
    label: "Tape src",
    group: "vwarp",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 0,
  });
  ps.register({
    id: "vwarp.active",
    label: "VWarp",
    group: "vwarp",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    // Which axis Anchor/Position/Span/Flip act on — NOT which axis time runs
    // along. capture() always writes columns, so the temporal shear is always
    // horizontal; "Vertical" redirects the read controls onto the tape's y, which
    // is plain frame-row space, giving a vertical geometric warp over the
    // horizontal shear. Both are useful; the old "Horizontal / Vertical" labels
    // implied a rotatable time axis, which this is not.
    // Options are labels only — the index is what persists.
    id: "vwarp.axis",
    label: "Warp axis",
    group: "vwarp",
    type: PARAM_TYPE.SELECT,
    options: ["Time (X)", "Picture (Y)"],
    value: 0,
  });
  ps.register({
    id: "vwarp.flip",
    label: "Flip",
    group: "vwarp",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "vwarp.mix",
    label: "Mix",
    group: "vwarp",
    min: 0,
    max: 1,
    value: 1.0,
    step: 0.01,
  });
  ps.register({
    id: "vwarp.bufsize",
    label: "Buf Size",
    group: "vwarp",
    type: PARAM_TYPE.SELECT,
    options: ["480 cols (8s)", "960 cols (16s)", "1920 cols (32s)"],
    value: 1,
  });
  ps.register({
    id: "vwarp.speed",
    label: "Speed",
    group: "vwarp",
    min: 1,
    max: 8,
    value: 1,
    step: 1,
  });
  // Which of the two things the read holds still. A tape column holds SOURCE
  // column c captured when the head was at c, so the read picks both WHICH column
  // you see and HOW OLD it is — you cannot fix both.
  //   0 = picture spatially true, wave of freshness sweeps across (historical
  //       Image/ine behaviour, and the default)
  //   1 = temporal gradient stationary, oldest edge to newest edge, but the
  //       picture slides sideways as the head runs
  // Continuous rather than a toggle: intermediate values drift the gradient
  // slowly, which is playable.
  ps.register({
    id: "vwarp.anchor",
    label: "Anchor",
    group: "vwarp",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  // Scrub: rotate which moment of the tape sits at which column. An LFO here
  // sweeps through the recording.
  ps.register({
    id: "vwarp.pos",
    label: "Position",
    group: "vwarp",
    min: 0,
    max: 1,
    value: 0,
    step: 0.001,
  });
  // How much of the tape covers the frame. 1 = the whole recording; 0.1 = a tenth
  // of it, so the shear steepens without the tape getting shorter. With
  // bufsize "1920 cols (32s)" this is a ~3s window on a 32s tape.
  ps.register({
    id: "vwarp.span",
    label: "Span",
    group: "vwarp",
    min: 0.01,
    max: 1,
    value: 1,
    step: 0.01,
  });
  ps.register({
    id: "vwarp.clear",
    label: "Clear tape",
    group: "vwarp",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── Sequence Buffers ──────────────────────────────────────────────────────
  const SEQ_SOURCES = [
    "Output",
    "Camera",
    "Movie",
    "FG",
    "BG",
    "Buffer",
    "Draw",
  ];
  ps.register({
    id: "seq1.active",
    label: "Seq1 Rec",
    type: PARAM_TYPE.TOGGLE,
    group: "seq",
    value: 0,
  });
  ps.register({
    id: "seq1.source",
    label: "Seq1 Source",
    type: PARAM_TYPE.SELECT,
    group: "seq",
    options: SEQ_SOURCES,
    value: 0,
  });
  ps.register({
    id: "seq1.speed",
    label: "Seq1 Speed",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: -300,
    max: 300,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "seq1.size",
    label: "Seq1 Frames",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: 4,
    max: 480,
    value: 60,
    step: 1,
  });
  ps.register({
    id: "seq2.active",
    label: "Seq2 Rec",
    type: PARAM_TYPE.TOGGLE,
    group: "seq",
    value: 0,
  });
  ps.register({
    id: "seq2.source",
    label: "Seq2 Source",
    type: PARAM_TYPE.SELECT,
    group: "seq",
    options: SEQ_SOURCES,
    value: 0,
  });
  ps.register({
    id: "seq2.speed",
    label: "Seq2 Speed",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: -300,
    max: 300,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "seq2.size",
    label: "Seq2 Frames",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: 4,
    max: 480,
    value: 60,
    step: 1,
  });
  ps.register({
    id: "seq3.active",
    label: "Seq3 Rec",
    type: PARAM_TYPE.TOGGLE,
    group: "seq",
    value: 0,
  });
  ps.register({
    id: "seq3.source",
    label: "Seq3 Source",
    type: PARAM_TYPE.SELECT,
    group: "seq",
    options: SEQ_SOURCES,
    value: 0,
  });
  ps.register({
    id: "seq3.speed",
    label: "Seq3 Speed",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: -300,
    max: 300,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "seq3.size",
    label: "Seq3 Frames",
    type: PARAM_TYPE.CONTINUOUS,
    group: "seq",
    min: 4,
    max: 480,
    value: 60,
    step: 1,
  });

  // ── Sequence TimeWarp mode params ─────────────────────────────────────────
  [1, 2, 3].forEach((n) => {
    ps.register({
      id: `seq${n}.mode`,
      label: `Seq${n} Mode`,
      type: PARAM_TYPE.SELECT,
      group: "seq",
      options: ["Loop", "TimeWarp"],
      value: 0,
    });
    ps.register({
      id: `seq${n}.tw.axis`,
      label: `Seq${n} Axis`,
      type: PARAM_TYPE.SELECT,
      group: "seq",
      options: ["Horizontal", "Vertical"],
      value: 0,
    });
    ps.register({
      id: `seq${n}.tw.flip`,
      label: `Seq${n} Flip`,
      type: PARAM_TYPE.TOGGLE,
      group: "seq",
      value: 0,
    });
    ps.register({
      id: `seq${n}.tw.speed`,
      label: `Seq${n} TW Spd`,
      type: PARAM_TYPE.CONTINUOUS,
      group: "seq",
      min: 1,
      max: 120,
      value: 1,
      step: 1,
    });
    ps.register({
      id: `seq${n}.tw.mix`,
      label: `Seq${n} TW Mix`,
      type: PARAM_TYPE.CONTINUOUS,
      group: "seq",
      min: 0,
      max: 100,
      value: 100,
      step: 1,
    });
    ps.register({
      id: `seq${n}.tw.offset`,
      label: `Seq${n} Offset`,
      type: PARAM_TYPE.CONTINUOUS,
      group: "seq",
      min: 0,
      max: 100,
      value: 0,
      step: 1,
    });
    ps.register({
      id: `seq${n}.tw.warp`,
      label: `Seq${n} Warp`,
      type: PARAM_TYPE.CONTINUOUS,
      group: "seq",
      min: 0,
      max: 100,
      value: 0,
      step: 1,
    });
  });

  // ── Vectorscope ───────────────────────────────────────────────────────────
  ps.register({
    id: "vectorscope.mode",
    label: "VScope Mode",
    group: "vectorscope",
    type: PARAM_TYPE.SELECT,
    options: [
      "Lissajous", "Waveform", "Goniometer", "Polar",
      "FFT", "Radial FFT", "Spectrogram", "Scatter Cloud",
      "Phase Space", "3D Waterfall", "Warp Starfield", "Oscilloscope",
    ],
    value: 0,
  });
  ps.register({
    id: "vectorscope.gain",
    label: "VScope Gain",
    group: "vectorscope",
    min: 1,
    max: 200,
    value: 100,
    unit: "%",
  });
  ps.register({
    id: "vectorscope.decay",
    label: "VScope Trail",
    group: "vectorscope",
    min: 0,
    max: 99,
    value: 60,
    unit: "%",
  });
  ps.register({
    id: "vectorscope.linewidth",
    label: "VScope Width",
    group: "vectorscope",
    min: 0.5,
    max: 15,
    step: 0.5,
    value: 1.5,
    unit: "px",
  });
  ps.register({
    id: "vectorscope.glow",
    label: "VScope Glow",
    group: "vectorscope",
    min: 0,
    max: 50,
    value: 8,
    unit: "px",
  });
  ps.register({
    id: "vectorscope.color",
    label: "VScope Color",
    group: "vectorscope",
    type: PARAM_TYPE.SELECT,
    options: ["Green", "Cyan", "Orange", "Gold", "Violet", "Hot Pink", "White", "Aqua"],
    value: 0,
  });

  // ── GLSL custom shader param slots ────────────────────────────────────────
  ps.register({
    id: "glsl.param1",
    label: "uParam1",
    group: "glsl",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "glsl.param2",
    label: "uParam2",
    group: "glsl",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "glsl.param3",
    label: "uParam3",
    group: "glsl",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "glsl.param4",
    label: "uParam4",
    group: "glsl",
    min: 0,
    max: 1,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "glsl.target",
    label: "Target",
    group: "glsl",
    type: PARAM_TYPE.SELECT,
    options: ["Master", "Foreground", "Background", "Displace"], // append-only
    value: 0,
  }); // insert-routing stage for the custom shader
  ps.register({
    id: "glsl.preset",
    label: "GLSL Preset",
    // group 'global' → excluded from Display State capture: the value is an
    // index into a user-editable preset list, so saved states would drift
    // when presets are added/removed. Recall is controller-driven instead.
    group: "global",
    type: PARAM_TYPE.SELECT,
    options: ["Passthrough"], // placeholder — main.js syncs to the GLSL preset list
    value: 0,
  });

  // ── Projection Mapping (corner-pin for second screen output) ──────────────
  ps.register({
    id: "projmap.active",
    label: "ProjMap On",
    group: "projmap",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "projmap.tl_x",
    label: "TL X",
    group: "projmap",
    min: 0,
    max: 1,
    value: 0,
  });
  ps.register({
    id: "projmap.tl_y",
    label: "TL Y",
    group: "projmap",
    min: 0,
    max: 1,
    value: 0,
  });
  ps.register({
    id: "projmap.tr_x",
    label: "TR X",
    group: "projmap",
    min: 0,
    max: 1,
    value: 1,
  });
  ps.register({
    id: "projmap.tr_y",
    label: "TR Y",
    group: "projmap",
    min: 0,
    max: 1,
    value: 0,
  });
  ps.register({
    id: "projmap.br_x",
    label: "BR X",
    group: "projmap",
    min: 0,
    max: 1,
    value: 1,
  });
  ps.register({
    id: "projmap.br_y",
    label: "BR Y",
    group: "projmap",
    min: 0,
    max: 1,
    value: 1,
  });
  ps.register({
    id: "projmap.bl_x",
    label: "BL X",
    group: "projmap",
    min: 0,
    max: 1,
    value: 0,
  });
  ps.register({
    id: "projmap.bl_y",
    label: "BL Y",
    group: "projmap",
    min: 0,
    max: 1,
    value: 1,
  });

  // ── Rutt-Etra Scan Processor (Phase 26) ───────────────────────────────────
  // See src/inputs/RuttEtra.js. Group 'rutt', so all of these are captured by
  // Display States — continuous quantities with fixed meaning, plus one SELECT
  // into CAPTURE_SOURCES, which is append-only and not user-editable (§9d).
  ps.register({
    id: "rutt.active",
    label: "Rutt-Etra",
    group: "rutt",
    type: PARAM_TYPE.TOGGLE,
    value: false,
  });
  ps.register({
    id: "rutt.source",
    label: "Source",
    group: "rutt",
    type: PARAM_TYPE.SELECT,
    options: CAPTURE_SOURCES,
    value: 0,
  }); // default: Camera
  // The surface the raster is wrapped on. Every entry has a natural family of
  // curves at constant v — latitude rings, stacked rings, loops, helices — so
  // the SCAN survives the shape change. That is what keeps this Rutt-Etra
  // rather than the 3D Scene, which already displaces solids by a texture.
  //
  // Gyroid is the exception and is honest about it: a triply periodic minimal
  // surface has no closed-form parameterisation, so it is solved as a height
  // field and gives ONE SHEET rather than the full labyrinth.
  ps.register({
    id: "rutt.shape",
    label: "Shape",
    group: "rutt",
    type: PARAM_TYPE.SELECT,
    // Dropdown, not a button group. ParamRow renders <= 8 options as buttons
    // unless this is set, and seven surface names do not fit a panel row: they
    // wrap, and the row is a fixed height, so they land on top of Draw and
    // Lines. Same reason scene3d.geo sets it for its thirteen geometries.
    select: true,
    options: ["Plane", "Sphere", "Cylinder", "Torus", "Catenoid", "Helicoid", "Gyroid"],
    value: 0,
  });
  ps.register({
    id: "rutt.lines",
    label: "Lines",
    group: "rutt",
    min: 16,
    // 1080, not 480. A max is not a recommendation — the default stays 120, and
    // the range now reaches a scan dense enough to read as a surface rather than
    // as a comb, which is the whole point of the machine. Raising a max is safe
    // where widening a SELECT is not: the stored value is the number itself, so
    // an old state that saved 240 still means 240.
    max: 1080,
    value: 120,
    step: 1,
  });
  // Signed: negative inverts the relief, so highlights become valleys. Cheap,
  // and it is half the expressive range of the machine.
  ps.register({
    id: "rutt.zgain",
    label: "Z Gain",
    group: "rutt",
    min: -2,
    max: 2,
    value: 0.5,
    step: 0.01,
  });
  // The depth transfer function. Same shape as td.delayCurve: gamma applied to
  // the normalised value before scaling. 1.0 is a bit-exact identity, so every
  // patch made before this existed renders unchanged.
  ps.register({
    id: "rutt.zcurve",
    label: "Z Curve",
    group: "rutt",
    min: 0.1,
    max: 4,
    value: 1,
    step: 0.01,
  });
  ps.register({
    id: "rutt.zpivot",
    label: "Z Pivot",
    group: "rutt",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  // Lines is the machine as built; Points is the same lattice drawn as a dot
  // cloud, which scan processors of the period also did.
  ps.register({
    id: "rutt.drawMode",
    label: "Draw",
    group: "rutt",
    type: PARAM_TYPE.SELECT,
    options: ["Lines", "Points", "Both"],
    value: 0,
  });
  ps.register({
    id: "rutt.thickness",
    label: "Beam",
    group: "rutt",
    min: 0.5,
    max: 8,
    value: 1.5,
    step: 0.1,
    unit: "px",
  });
  // Separate from Beam, not derived from it: Both mode wants a thin ribbon under
  // prominent dots. Defaults larger than Beam because a dot is not continuous —
  // at equal width a dot lattice reads far fainter than a line one.
  ps.register({
    id: "rutt.pointSize",
    label: "Dot",
    group: "rutt",
    min: 0.5,
    max: 16,
    value: 3,
    step: 0.1,
    unit: "px",
  });
  // Colour. The machine was monochrome, but its output was routinely run through
  // colourisers — a phosphor tint is period-plausible, and Src Color is the one
  // frank departure. Defaults (sat 0, amt 0) are the original white monochrome.
  ps.register({
    id: "rutt.hue",
    label: "Tint Hue",
    group: "rutt",
    min: 0,
    max: 360,
    value: 0,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "rutt.sat",
    label: "Tint",
    group: "rutt",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "rutt.colorAmt",
    label: "Src Color",
    group: "rutt",
    min: 0,
    max: 1,
    value: 0,
    step: 0.01,
  });
  // Ids stay angle/elev — they are in saved states, banks and MIDI maps, and a
  // label is presentation. X and Y here name the SCREEN direction the camera
  // travels, not the axis it turns about.
  ps.register({
    id: "rutt.angle",
    label: "Orbit X",
    group: "rutt",
    min: 0,
    max: 360,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  // Not decoration: at 0 the camera looks straight down the deflection axis and
  // the relief is invisible. The default turns into it.
  //
  // −180…180 rather than 0…360, which is the same full turn but keeps every
  // saved value: this was −89…89 and existing patches hold negative angles, so
  // a 0…360 range would clamp a stored −53 to 0 and silently reframe them.
  ps.register({
    id: "rutt.elev",
    label: "Orbit Y",
    group: "rutt",
    min: -180,
    max: 180,
    value: 35,
    step: 0.5,
    unit: "°",
  });
  // Placement. Moves the lattice, not the camera, so it swings through
  // perspective rather than sliding flatly — and Z is not Distance: this pushes
  // the object through the scene while Distance dollies the camera.
  ps.register({
    id: "rutt.moveX",
    label: "Move X",
    group: "rutt",
    min: -2,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "rutt.moveY",
    label: "Move Y",
    group: "rutt",
    min: -2,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "rutt.moveZ",
    label: "Move Z",
    group: "rutt",
    min: -2,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "rutt.dist",
    label: "Distance",
    group: "rutt",
    min: 1,
    max: 10,
    value: 3.2,
    step: 0.05,
  });
  // Asymmetric temporal slew — jit.slide semantics, in SECONDS rather than
  // frames so the feel survives a frame-rate change. Both 0 bypasses the history
  // buffer entirely, which is why the default costs neither a pass nor the
  // resampling softness that routing through it would add.
  ps.register({
    id: "rutt.rise",
    label: "Rise",
    group: "rutt",
    min: 0,
    max: 2,
    value: 0,
    step: 0.01,
    unit: "s",
  });
  ps.register({
    id: "rutt.fall",
    label: "Fall",
    group: "rutt",
    min: 0,
    max: 2,
    value: 0,
    step: 0.01,
    unit: "s",
  });
  // Capped below 1.0 on purpose: at exactly 1.0 the phosphor never fades and
  // the buffer saturates to white within seconds under an additive blend.
  ps.register({
    id: "rutt.decay",
    label: "Persist",
    group: "rutt",
    min: 0,
    max: 0.98,
    value: 0,
    step: 0.01,
  });
  // How far the phosphor spreads each frame as it fades. Does nothing at
  // Persist 0 — there is no trail to diffuse — so it reads as a sub-control of
  // Persist and sits directly beneath it.
  ps.register({
    id: "rutt.bleed",
    label: "Spread",
    group: "rutt",
    min: 0,
    max: 4,
    value: 0,
    step: 0.05,
    unit: "px",
  });

  // ── Audio engine (docs/ImWeb-Audio-Blueprint.md) ──────────────────────────
  //
  // The client side of §4.1's split. These params describe the engine; they
  // never travel to it — `src/audio/AudioBinding.js` translates each one into a
  // §8.8 address locally, so no ImWeb identifier crosses the boundary (rule 3).
  //
  // GROUPS, and why they differ (§4.8 capture is opt-out — every param whose
  // group is not 'global' IS captured by a Display State):
  //
  //   'global'  — anything that ALLOCATES, OPENS A DEVICE, or RELAYOUTS.
  //               `audio.tapeSec` reallocates the tape, which throws away every
  //               recording in it; `audio.mic` opens a permissioned device;
  //               partition bounds are a setup act that §4.3 fixes at session
  //               start. Capturing any of them means recalling a Display State
  //               mid-set destroys material or reopens hardware — the loudest
  //               possible version of the silent-reload failure §4.8 exists to
  //               prevent.
  //   'arec' /  — performance state. Region, rate, on/off ARE captured: they
  //   'aplay'     are what a Display State is for, and every index here points
  //   'audio'     into a FIXED slot table (8 partitions, 128 zones per type),
  //               so unlike glsl.preset it cannot drift under a saved state.
  //
  // Regions are fractions of their partition, not sample counts, for the same
  // reason §4.3 makes zone positions partition-relative: a captured layout has
  // to mean the same thing on a machine whose tape is a different length.
  // A TOGGLE, not a TRIGGER: a trigger can only ever start, so there was no way
  // to release the audio device short of a reload. Still 'global' — a Display
  // State must not be able to seize or drop the sound card.
  ps.register({
    id: "audio.enable", label: "Audio On", group: "global",
    type: PARAM_TYPE.TOGGLE, value: 0,
  });
  ps.register({
    id: "audio.tapeSec", label: "Tape", group: "global",
    min: 5, max: 600, value: 60, step: 1, unit: "s",
  });
  ps.register({
    id: "audio.mic", label: "Mic", group: "global",
    type: PARAM_TYPE.TOGGLE, value: 0,
  });
  /**
   * How the performer is listening (§8.6) — the one thing that decides whether
   * `mic → tape → monitors → mic` is a real acoustic path or just a diagram.
   *
   * **A setup act, so `group: 'global'` AND `setup: true`.** §8.6 puts it with
   * partition layout: fixed at session start, never captured, and never a
   * controller target — a switch that changes the performer's feedback exposure
   * must not be sweepable, and the `setup` flag is what makes that enforceable
   * rather than merely written down.
   *
   * **Speakers is the default, and it is the cautious one.** The instrument
   * assumes the loop is closed until told otherwise, the same way `audio.tapSrc`
   * defaults to mic-only so that the safe state requires no selection. Guessing
   * headphones would suppress the one warning that matters on the setup where it
   * matters, which is the wrong direction to be wrong in.
   *
   * It changes no gain and no routing. What it changes is what the instrument
   * knows, and therefore what it can tell you — see `_loopLive` in
   * AudioBinding. Silently attenuating on Speakers was considered and rejected:
   * a monitoring switch that quietly moves the level is a switch nobody can
   * reason about, and §4.11's non-bypassable ceiling already bounds the damage.
   */
  ps.register({
    id: "audio.monitor", label: "Monitoring", group: "global", setup: true,
    type: PARAM_TYPE.SELECT, value: MONITOR.SPEAKERS, options: [...MONITOR_MODES],
  });
  // What the analyser tap listens to (§8.6) — the input to the sound-reactive
  // controllers and the vectorscope, which are consumers of the engine's one
  // context rather than owners of their own.
  //
  // 'audio', so it IS captured, and that is deliberate: unlike `audio.mic` this
  // opens no device and allocates nothing, and it is an index into a fixed
  // enumerated set, not a user-editable list — so it cannot drift the way
  // glsl.preset would. Mic-only is the default, because the safe state must
  // require no selection: Master Out tapped through speakers is §8.1's loop.
  ps.register({
    id: "audio.tapSrc", label: "Tap", group: "audio",
    type: PARAM_TYPE.SELECT, value: 0,
    options: ["Mic", "Master Out"],
  });
  ps.register({
    id: "audio.outGain", label: "Out Gain", group: "audio",
    min: 0, max: 1, value: 0.8, step: 0.01,
  });
  // How long a zone's Start/Length takes to reach a new value. 0 is exact —
  // the right setting for scrubbing by hand, since any smoothing on position is
  // smoothing on the gesture. A few ms hides the 60 Hz staircase a controller
  // writes. Captured, because it is part of how a patch feels to play.
  ps.register({
    id: "audio.glide", label: "Glide", group: "audio",
    min: 0, max: 50, value: 3, step: 0.1, unit: "ms",
  });
  // The limiter's PARAMETERS are adjustable; the limiter is not (§4.11). There
  // is no enable here and no address for one — see protocol.js.
  ps.register({
    id: "audio.limitThresh", label: "Ceiling", group: "audio",
    min: 0.1, max: 1, value: 0.891, step: 0.001,
  });
  ps.register({
    id: "audio.limitRel", label: "Limit Rel", group: "audio",
    min: 0.01, max: 2, value: 0.15, step: 0.01, unit: "s",
  });

  // The Voice (§4.4, §4.10) — the generator half of the phase-one UGen set.
  // Group 'avoice', so it IS captured: this is performance state, and every
  // index here points into a fixed code-side list, not a user-editable one.
  //
  // PITCH AND CUTOFF ARE IN SEMITONES, NOT Hz, and that is the LEARNED
  // 2026-08-08 rule applied at the point where it is cheapest: rate and
  // frequency are heard as ratios, so a linear Hz slider spends most of its
  // travel above the useful range and crushes the bottom three octaves into a
  // few pixels. Semitones make the control linear in what the ear does.
  // AudioBinding converts to Hz — the same one-conversion-site rule as the
  // fractions→samples translation beside it.
  ps.register({
    id: "avoice.on", label: "Voice", group: "avoice",
    type: PARAM_TYPE.TOGGLE, value: 0,
  });
  ps.register({
    id: "avoice.src", label: "Source", group: "avoice",
    type: PARAM_TYPE.SELECT, value: 0, options: ["Osc", "Noise"],
  });
  ps.register({
    id: "avoice.wave", label: "Wave", group: "avoice",
    type: PARAM_TYPE.SELECT, value: 0, options: ["Sine", "Saw", "Square", "Tri"],
  });
  ps.register({
    id: "avoice.pitch", label: "Pitch", group: "avoice",
    min: 12, max: 120, value: 57, step: 1, unit: "st",   // 57 = A3, 220 Hz
  });
  // FM lives on the oscillator's PHASE input rather than in its own UGen
  // (§4.10). Index 0 is the off state and costs nothing, so there is no enable.
  ps.register({
    id: "avoice.fmRatio", label: "FM Ratio", group: "avoice",
    min: 0.25, max: 8, value: 1, step: 0.01,
  });
  ps.register({
    id: "avoice.fmIndex", label: "FM Index", group: "avoice",
    min: 0, max: 4, value: 0, step: 0.01,
  });
  ps.register({
    id: "avoice.colour", label: "Colour", group: "avoice",
    min: 0, max: 1, value: 0.5, step: 0.01,
  });
  ps.register({
    id: "avoice.cut", label: "Cutoff", group: "avoice",
    min: 20, max: 130, value: 84, step: 1, unit: "st",   // 84 ≈ 1046 Hz
  });
  ps.register({
    id: "avoice.res", label: "Resonance", group: "avoice",
    min: 0, max: 1, value: 0.2, step: 0.01,
  });
  // Continuous, not a SELECT: the SVF morphs LP→BP→HP→notch, and a discrete
  // type switch under a controller is a click (§4.11 puts smoothing in the
  // worklet, but only for values that are continuous in the first place).
  ps.register({
    id: "avoice.ftype", label: "Filter Type", group: "avoice",
    min: 0, max: 3, value: 0, step: 0.01,
  });
  ps.register({
    id: "avoice.drive", label: "Drive", group: "avoice",
    min: 0, max: 1, value: 0, step: 0.01,
  });
  ps.register({
    id: "avoice.level", label: "Level", group: "avoice",
    min: 0, max: 1, value: 0.3, step: 0.01,
  });

  // Partition layout. 'global' — see above; relayout is refused by the engine
  // while a zone bound to the slot is running, so a captured value would be
  // either ignored or destructive depending on what happened to be playing.
  const PARTITION_SLOTS = 4;   // of MAX_PARTITIONS in the engine; UI shows four
  for (let i = 0; i < PARTITION_SLOTS; i++) {
    ps.register({
      id: `apart${i}.start`, label: `P${i} Start`, group: "global",
      min: 0, max: 1, value: i / PARTITION_SLOTS, step: 0.001,
    });
    ps.register({
      id: `apart${i}.len`, label: `P${i} Length`, group: "global",
      min: 0, max: 1, value: 1 / PARTITION_SLOTS, step: 0.001,
    });
  }

  // Zones. One of each type is exposed; the engine has 128 per type and the
  // ids are prefixed so more can be added without renaming these (the mix-bus
  // lesson: bus 1 kept the bare `mix.` prefix and its v0.12 ids for exactly
  // this reason).
  const ZONE_COMMON = [
    { key: "part", label: "Partition", type: PARAM_TYPE.SELECT, value: 0,
      options: Array.from({ length: PARTITION_SLOTS }, (_, i) => `P${i}`) },
    { key: "start", label: "Start", min: 0, max: 1, value: 0, step: 0.001 },
    { key: "len", label: "Length", min: 0, max: 1, value: 1, step: 0.001 },
    { key: "unsafe", label: "Unsafe", type: PARAM_TYPE.TOGGLE, value: 0 },
    { key: "on", label: "Run", type: PARAM_TYPE.TOGGLE, value: 0 },
  ];
  [
    { prefix: "arec", suffix: " Rec", extra: [
      { key: "dynamic", label: "Dynamic", type: PARAM_TYPE.TOGGLE, value: 0 },
    ] },
    { prefix: "aplay", suffix: " Play", extra: [
      { key: "rate", label: "Rate", min: -4, max: 4, value: 1, step: 0.01 },
      // The zone's fader. `extra` rather than ZONE_COMMON because only Playback
      // has one — a Recording zone's level would be an input gain, a different
      // decision at a different point in the chain, and the engine exposes no
      // address for it. Defaults to 1 so adding this changes nothing audible
      // for anyone who never touches it.
      { key: "level", label: "Level", min: 0, max: 1, value: 1, step: 0.01 },
      // Eight region cues, the same eight the movie decks have. Both are group
      // 'global', which overrides the `group: prefix` at the registration site
      // below, so Display States cannot capture them — a state already captures
      // part/start/len directly, and capturing the slot index too would give
      // those three a second writer whose onChange fires after the restore.
      // See core/CueBank.js.
      { key: "cueSlot", label: "CueSlot", type: PARAM_TYPE.SELECT, value: 0, group: "global",
        options: ["1", "2", "3", "4", "5", "6", "7", "8"] },
      { key: "cueStore", label: "CueStore", type: PARAM_TYPE.TRIGGER, group: "global" },
    ] },
  ].forEach(({ prefix, suffix, extra }) => {
    [...ZONE_COMMON, ...extra].forEach(({ key, label, ...rest }) => {
      ps.register({ id: `${prefix}.${key}`, label: label + suffix, group: prefix, ...rest });
    });
  });

  // ── The spectral writer (§4.5, §8.10) ─────────────────────────────────────
  //
  // A frequency-time picture rendered ONCE into a partition, after which it is
  // ordinary tape. Registered separately from ZONE_COMMON above rather than as
  // a third entry in it: a render writer has no Run toggle and its region is an
  // argument to the render, not a slewed target, so three of the five common
  // keys would be controls that do nothing (the engine refuses them outright).
  //
  // Group 'aspec' — performance state, captured, every index pointing into a
  // fixed code-side list. EXCEPT the trigger: `aspec.render` is 'global',
  // because it overwrites a region of tape, and a Display State recall that
  // silently destroys material is the exact failure the group split above
  // exists to prevent. Triggers fire their listeners on any set, changed or
  // not, so capturing this one would render on every recall.
  ps.register({
    id: "aspec.part", label: "Partition Spec", group: "aspec",
    type: PARAM_TYPE.SELECT, value: 0,
    options: Array.from({ length: PARTITION_SLOTS }, (_, i) => `P${i}`),
  });
  ps.register({
    id: "aspec.start", label: "Start Spec", group: "aspec",
    min: 0, max: 1, value: 0, step: 0.001,
  });
  ps.register({
    id: "aspec.len", label: "Length Spec", group: "aspec",
    min: 0, max: 1, value: 1, step: 0.001,
  });
  ps.register({
    id: "aspec.unsafe", label: "Unsafe Spec", group: "aspec",
    type: PARAM_TYPE.TOGGLE, value: 0,
  });
  // The musical decision (§4.5). Ten scales, and the engine knows none of them
  // — AudioBinding turns this index plus the root into a list of frequencies.
  ps.register({
    id: "aspec.scale", label: "Scale", group: "aspec",
    type: PARAM_TYPE.SELECT, value: 1, options: [...SCALE_NAMES],
  });
  // Semitones, not Hz, for the same reason `avoice.pitch` is (LEARNED
  // 2026-08-08): pitch is heard as a ratio. 45 = A2, 110 Hz.
  ps.register({
    id: "aspec.root", label: "Root", group: "aspec",
    min: 12, max: 96, value: 45, step: 1, unit: "st",
  });
  // Rows is a request, not a promise: `buildPitches` stops below Nyquist, so a
  // tall chromatic table from a low root comes back short rather than folding
  // partials down on top of the scale.
  ps.register({
    id: "aspec.rows", label: "Rows", group: "aspec",
    min: 4, max: 128, value: 48, step: 1,
  });
  ps.register({
    id: "aspec.frames", label: "Columns", group: "aspec",
    min: 2, max: 1024, value: 256, step: 1,
  });
  ps.register({
    id: "aspec.gamma", label: "Contrast", group: "aspec",
    min: 0.25, max: 4, value: 2, step: 0.05,
  });
  // A camera frame is never actually black. Without a floor every row is
  // faintly on in every column and the render is a wash of all pitches at once,
  // which is the "drawn spectra are just noise" failure §4.5 says the scale
  // quantization exists to avoid.
  ps.register({
    id: "aspec.floor", label: "Floor", group: "aspec",
    min: 0, max: 0.5, value: 0.06, step: 0.005,
  });
  ps.register({
    id: "aspec.level", label: "Level Spec", group: "aspec",
    min: 0, max: 1, value: 1, step: 0.01,
  });
  // The pan image (§8.14) — how a picture becomes stereo positions. 'aspec', so
  // captured, and the index points into `PAN_MODES`, a fixed code-side list of
  // the SOURCE_DEFS kind rather than a user-editable one.
  //
  // Off is the default, and it is not merely the conservative choice: mono into
  // every channel is what the writer did before this existed, so every saved
  // project renders exactly as it did. A default of Colour would re-place the
  // material in every project authored before §8.14 the first time it was
  // re-rendered.
  ps.register({
    id: "aspec.pan", label: "Pan Image", group: "aspec",
    type: PARAM_TYPE.SELECT, value: 0, options: [...PAN_MODES],
  });
  // How far from centre the extremes reach. A width, not a position — 0 is
  // mono and collapses the image away entirely, which is why Off and a width of
  // 0 mean the same thing to the render and both skip the upload.
  ps.register({
    id: "aspec.panWidth", label: "Pan Width", group: "aspec",
    min: 0, max: 1, value: 1, step: 0.01,
  });
  ps.register({
    id: "aspec.render", label: "Render", group: "global",
    type: PARAM_TYPE.TRIGGER,
  });
  // 'global' for the same reason Render is — it is one half of a pair, and a
  // captured Cancel would fire on every recall to say "nothing is rendering".
  ps.register({
    id: "aspec.cancel", label: "Cancel", group: "global",
    type: PARAM_TYPE.TRIGGER,
  });

  // ── The corpus index (§4.6) ───────────────────────────────────────────────
  //
  // Two halves that are deliberately not one panel's worth of the same thing:
  // `acorp.*` is the MAP — how the tape is measured and which two measurements
  // become the axes — and `agrain.*` is the READER that plays what the map
  // points at. The map is rebuilt rarely and the reader is played continuously.
  //
  // Analysis settings are 'global': hop and window decide the SHAPE of a corpus
  // that then has to be re-measured to change, so a Display State recall that
  // silently invalidated the cloud under a performer's hand would be the same
  // class of destruction as recalling a tape length. The AXES are 'acorp' and
  // captured — they are indices into a fixed code-side list, cost nothing to
  // change, and which pair you are navigating by is exactly the sort of thing a
  // State should restore.
  ps.register({
    id: "acorp.hop", label: "Grain Hop", group: "global",
    min: 5, max: 500, value: 45, step: 1, unit: "ms",
  });
  ps.register({
    id: "acorp.window", label: "Analysis Window", group: "global",
    min: 10, max: 300, value: 85, step: 1, unit: "ms",
  });
  ps.register({
    id: "acorp.analyse", label: "Analyse", group: "global", type: PARAM_TYPE.TRIGGER,
  });
  ps.register({
    id: "acorp.cancel", label: "Cancel Analysis", group: "global", type: PARAM_TYPE.TRIGGER,
  });
  // Which two of the four measurements are the pad's axes. Defaults are
  // brightness against loudness — the pair that separates most material on most
  // recordings, and the one that needs no pitch to have been found.
  ps.register({
    id: "acorp.xAxis", label: "X Axis", group: "acorp",
    type: PARAM_TYPE.SELECT, value: 1, options: [...DESCRIPTOR_LABELS],
  });
  ps.register({
    id: "acorp.yAxis", label: "Y Axis", group: "acorp",
    type: PARAM_TYPE.SELECT, value: 0, options: [...DESCRIPTOR_LABELS],
  });
  // Where in the descriptor space the reader is pointed. Ordinary continuous
  // params, so everything that can drive a parameter can drive the navigation —
  // a hand on the pad, an LFO, a MIDI knob, the stroke looper (§4.6's claim
  // that navigating a 2D space is a drawing gesture is only true if these are
  // as drivable as anything else).
  ps.register({ id: "acorp.x", label: "Corpus X", group: "acorp", min: 0, max: 1, value: 0.5, step: 0.001 });
  ps.register({ id: "acorp.y", label: "Corpus Y", group: "acorp", min: 0, max: 1, value: 0.5, step: 0.001 });

  // The grain player. 'agrain', captured — performance state, every value
  // continuous or a fixed-slot index.
  ps.register({
    id: "agrain.part", label: "Partition Grain", group: "agrain",
    type: PARAM_TYPE.SELECT, value: 0,
    options: Array.from({ length: PARTITION_SLOTS }, (_, i) => `P${i}`),
  });
  ps.register({
    id: "agrain.on", label: "Run Grain", group: "agrain", type: PARAM_TYPE.TOGGLE, value: 0,
  });
  /**
   * Where in the partition the cloud reads from — a FRACTION of the partition,
   * like every other zone position (§4.3), converted to samples in
   * AudioBinding at the one seam that does that.
   *
   * **This is the time-stretch control**, and it is a plain parameter for
   * exactly that reason. `aplay.rate` is varispeed: it moves rate and pitch
   * together, because reading tape faster is what a tape deck does. The grain
   * player already separates them — `pos`, `pitch` and `rate` (density) are
   * three independent addresses in the worklet — so a playhead that advances
   * slowly while grains sound at pitch 1.0 IS time stretch, with no new DSP.
   * What was missing was any way to ADVANCE it: the engine has had
   * `/zone/grain/<n>/pos` and a `TGT_GRAIN_POS` controller target since §4.6,
   * but the only writer was the corpus pad, so nothing could sweep it. Now an
   * LFO ramp here is a playhead scanning at whatever speed you set, pitch
   * untouched — the stretch factor is the ramp's period against the region.
   *
   * The corpus pad writes THIS, rather than the engine directly, so there is
   * one path to the address instead of two racing ones — and the pad's
   * position becomes visible in the UI and captured by a Display State.
   */
  ps.register({
    id: "agrain.pos", label: "Grain Pos", group: "agrain",
    // `snap: false` — the pad writes grain-accurate offsets; 0.001 is the drag
    // increment only. See the `snap` field on Parameter for why snapping here
    // silently swallowed every second click on the corpus pad.
    min: 0, max: 1, value: 0, step: 0.001, snap: false,
  });
  ps.register({
    id: "agrain.size", label: "Grain Size", group: "agrain",
    min: 5, max: 500, value: 90, step: 1, unit: "ms",
  });
  ps.register({
    id: "agrain.rate", label: "Density", group: "agrain",
    min: 1, max: 200, value: 25, step: 1, unit: "/s",
  });
  // Semitones, converted in AudioBinding — the LEARNED 2026-08-08 rule, same as
  // the voice's pitch and the spectral writer's root.
  ps.register({
    id: "agrain.pitch", label: "Grain Pitch", group: "agrain",
    min: -24, max: 24, value: 0, step: 0.1, unit: "st",
  });
  ps.register({
    id: "agrain.spray", label: "Spray", group: "agrain",
    min: 0, max: 500, value: 20, step: 1, unit: "ms",
  });
  ps.register({
    id: "agrain.level", label: "Level Grain", group: "agrain",
    min: 0, max: 1, value: 0.6, step: 0.01,
  });
  ps.register({
    id: "agrain.unsafe", label: "Unsafe Grain", group: "agrain",
    type: PARAM_TYPE.TOGGLE, value: 0,
  });

  return ps;
}
