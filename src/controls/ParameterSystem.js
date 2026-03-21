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

// Set by main.js after TableManager is initialised
let _tableManager = null;
export function setTableManager(tm) { _tableManager = tm; }

export const PARAM_TYPE = {
  CONTINUOUS: 'continuous', // floating point in [min, max]
  TOGGLE:     'toggle',     // 0 | 1
  TRIGGER:    'trigger',    // fires event on set; value resets to 0 next frame
  SELECT:     'select',     // integer index into options[]
};

// ─────────────────────────────────────────────────────────────────────────────
// Parameter
// ─────────────────────────────────────────────────────────────────────────────

export class Parameter {
  constructor(config) {
    this.id      = config.id;
    this.label   = config.label ?? config.id;
    this.type    = config.type  ?? PARAM_TYPE.CONTINUOUS;
    this.group   = config.group ?? null;
    this.min     = config.min   ?? 0;
    this.max     = config.max   ?? 100;
    this.options = config.options ?? null; // for SELECT
    this.unit    = config.unit  ?? '';     // display unit string e.g. '°', '%'
    this.step    = config.step  ?? null;   // optional snap step

    this._value  = config.value ?? this.min;
    this._target = this._value; // slew target
    this.defaultValue = this._value;

    // Controller assignment — set by ControllerManager
    this.controller      = null;   // { type, ...config } — primary controller
    this.xControllers    = [];     // external mapping controllers (controller-of-controller)
    this.table           = null;   // response curve table name (string)

    // Flags
    this.invert          = false;
    this.cycle           = false;   // for SELECT: cycle on trigger
    this.slew            = 0;       // 0=instant, 0.001–1.0 seconds (lag time)
    this.ctrlMin         = null;    // controller output range override (null = param.min)
    this.ctrlMax         = null;    // controller output range override (null = param.max)
    this.feedbackVisible = config.feedbackVisible ?? false;
    this.feedbackPos     = config.feedbackPos ?? { x: 20, y: 60 };

    // Modifier combos for mouse controller (ImOs9 style: up to 32 combos)
    this.mouseModifiers  = config.mouseModifiers ?? '';

    this._listeners        = new Set();
    this._triggerListeners = new Set();
    this.locked            = false; // when true, value cannot be changed by UI/controllers
  }

  // ── Value access ────────────────────────────────────────────────────────

  get value() { return this._value; }

  set value(v) {
    if (this.locked) return;
    let clamped;
    if (this.type === PARAM_TYPE.TOGGLE) {
      clamped = v ? 1 : 0;
    } else if (this.type === PARAM_TYPE.SELECT) {
      clamped = Math.max(0, Math.min((this.options?.length ?? 1) - 1, Math.round(v)));
    } else {
      clamped = Math.max(this.min, Math.min(this.max, v));
      if (this.step) clamped = Math.round(clamped / this.step) * this.step;
    }

    const changed = clamped !== this._value;
    this._value = clamped;

    if (changed || this.type === PARAM_TYPE.TRIGGER) {
      this._listeners.forEach(fn => fn(clamped, this));
    }
    if (this.type === PARAM_TYPE.TRIGGER && changed) {
      this._triggerListeners.forEach(fn => fn(this));
    }
  }

  // Normalized value in [0, 1]
  get normalized() {
    if (this.type === PARAM_TYPE.TOGGLE)  return this._value;
    if (this.type === PARAM_TYPE.SELECT)  return this._value / Math.max(1, (this.options?.length ?? 1) - 1);
    return (this._value - this.min) / (this.max - this.min);
  }

  /**
   * Called by controllers. n is normalized 0–1.
   * Applies invert and table before remapping to [min, max].
   */
  setNormalized(n, table = null) {
    let applied = this.invert ? 1 - n : n;
    if (table) applied = table.apply(applied);
    if (this.type === PARAM_TYPE.TOGGLE) {
      this.value = applied > 0.5 ? 1 : 0;
    } else if (this.type === PARAM_TYPE.SELECT) {
      this.value = Math.round(applied * ((this.options?.length ?? 1) - 1));
    } else {
      const lo = this.ctrlMin ?? this.min;
      const hi = this.ctrlMax ?? this.max;
      const target = lo + applied * (hi - lo);
      if (this.slew > 0) {
        this._target = target; // defer to tickSlew
      } else {
        this.value = target;
      }
    }
  }

  /** Called each frame with dt in seconds. Advances slewed params. */
  tickSlew(dt) {
    if (this.slew <= 0 || this.type !== PARAM_TYPE.CONTINUOUS) return;
    if (this._target === this._value) return;
    // Exponential lag: approach target at rate 1/slew per second
    const alpha = Math.min(1, dt / Math.max(0.001, this.slew));
    this.value  = this._value + (this._target - this._value) * alpha;
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

  // ── Display ──────────────────────────────────────────────────────────────

  get displayValue() {
    const v = this._value;
    if (this.type === PARAM_TYPE.TOGGLE)  return v ? '●' : '○';
    if (this.type === PARAM_TYPE.TRIGGER) return '▶';
    if (this.type === PARAM_TYPE.SELECT)  return this.options?.[v] ?? v;
    const decimals = (this.max - this.min) > 10 ? 1 : 2;
    return v.toFixed(decimals) + (this.unit ? ' ' + this.unit : '');
  }

  get controllerLabel() {
    if (!this.controller) return '—';
    const c = this.controller;
    const labels = {
      'mouse-x': 'MX', 'mouse-y': 'MY',
      'midi-cc': c.channel ? `${c.channel}:CC${c.cc ?? '?'}` : `CC${c.cc ?? '?'}`,
      'midi-note': c.channel ? `${c.channel}:N${c.note ?? '?'}` : `N${c.note ?? '?'}`,
      'lfo-sine': 'LFO~', 'lfo-triangle': 'LFO△',
      'lfo-sawtooth': 'LFO⊿', 'lfo-square': 'LFO▭',
      'sound': 'SND', 'sound-bass': 'BAS', 'sound-mid': 'MID', 'sound-high': 'HIG',
      'random': 'RND', 'fixed': 'FXD',
      'key': `KEY:${c.key ?? '?'}`, 'nudge': 'NDG',
      'movie-pos': 'MVP', 'osc': 'OSC',
      'expr': `ƒ(t)`,
    };
    return labels[c.type] ?? c.type.toUpperCase().slice(0, 4);
  }

  get controllerClass() {
    if (!this.controller) return '';
    const t = this.controller.type;
    if (t.startsWith('lfo'))   return 'lfo';
    if (t.startsWith('midi'))  return 'midi';
    if (t.startsWith('mouse')) return 'mouse';
    if (t.startsWith('sound')) return 'sound';
    return 'assigned';
  }

  // ── Serialization ────────────────────────────────────────────────────────

  reset() { this.value = this.defaultValue; }

  serialize() {
    return {
      id:          this.id,
      value:       this._value,
      controller:  this.controller   ? { ...this.controller }  : null,
      xControllers: this.xControllers.length
        ? this.xControllers.map(xc => xc ? { ...xc, _fn: undefined, _rState: undefined } : null)
        : undefined,
      table:       this.table,
      ctrlMin:     this.ctrlMin,
      ctrlMax:     this.ctrlMax,
      invert:      this.invert,
      cycle:       this.cycle,
      slew:        this.slew,
      feedbackVisible: this.feedbackVisible,
      feedbackPos: { ...this.feedbackPos },
    };
  }

  deserialize(data) {
    if (data.value       !== undefined) this.value = data.value;
    if (data.controller  !== undefined) this.controller = data.controller;
    if (data.xControllers !== undefined) {
      this.xControllers = (data.xControllers ?? []).map(xc => xc ? { ...xc } : null);
    }
    if (data.table       !== undefined) this.table = data.table;
    if (data.ctrlMin     !== undefined) this.ctrlMin = data.ctrlMin;
    if (data.ctrlMax     !== undefined) this.ctrlMax = data.ctrlMax;
    if (data.invert      !== undefined) this.invert = data.invert;
    if (data.cycle       !== undefined) this.cycle = data.cycle;
    if (data.slew        !== undefined) this.slew = data.slew;
    if (data.feedbackVisible !== undefined) this.feedbackVisible = data.feedbackVisible;
    if (data.feedbackPos !== undefined) this.feedbackPos = data.feedbackPos;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ParameterSystem
// ─────────────────────────────────────────────────────────────────────────────

export class ParameterSystem extends EventTarget {
  constructor() {
    super();
    this.params = new Map();    // id → Parameter
    this.groups = new Map();    // groupName → [paramId, ...]
  }

  /**
   * Register a parameter. Returns the Parameter instance.
   */
  register(config) {
    const p = new Parameter(config);
    this.params.set(p.id, p);
    if (p.group) {
      if (!this.groups.has(p.group)) this.groups.set(p.group, []);
      this.groups.get(p.group).push(p.id);
    }
    return p;
  }

  get(id)     { return this.params.get(id); }
  has(id)     { return this.params.has(id); }
  getAll()    { return [...this.params.values()]; }

  getGroup(name) {
    return (this.groups.get(name) ?? []).map(id => this.params.get(id)).filter(Boolean);
  }

  set(id, value) {
    const p = this.params.get(id);
    if (p) p.value = value;
    else console.warn(`[ParameterSystem] Unknown param: ${id}`);
  }

  setNormalized(id, n, table = null) {
    const p = this.params.get(id);
    if (!p) return;
    // Resolve table by name if the param has one assigned and none provided directly
    const resolved = table ?? (p.table && _tableManager ? _tableManager.get(p.table) : null);
    p.setNormalized(n, resolved);
  }

  toggle(id)  { this.params.get(id)?.toggle(); }
  trigger(id) { this.params.get(id)?.trigger(); }

  /** Advance all slewed parameters. Call once per frame. */
  tickSlew(dt) {
    this.params.forEach(p => p.tickSlew(dt));
  }

  // ── State snapshots ──────────────────────────────────────────────────────

  captureState() {
    const s = {};
    this.params.forEach((p, id) => { s[id] = p.value; });
    return s;
  }

  restoreState(state) {
    Object.entries(state).forEach(([id, v]) => this.set(id, v));
    this.dispatchEvent(new CustomEvent('stateRestored', { detail: state }));
  }

  // ── Preset serialization ─────────────────────────────────────────────────

  serializeControllers() {
    const r = {};
    this.params.forEach((p, id) => {
      if (p.controller || p.table || p.invert || p.xControllers.length || p.ctrlMin !== null || p.ctrlMax !== null) r[id] = p.serialize();
    });
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
// registerCoreParameters  — defines all Phase 1 parameters
// ─────────────────────────────────────────────────────────────────────────────

export function registerCoreParameters(ps) {

  // ── Layer source selection ────────────────────────────────────────────────
  const SOURCES = ['Camera', 'Movie', 'Buffer', 'Color', 'Noise', '3D Scene', 'Draw', 'Output', 'BG1', 'BG2', 'Color2', 'Text', 'Sound', 'Delay', 'Scope', 'SlitScan', 'Particles', 'Seq1', 'Seq2', 'Seq3', '3D Depth'];

  ps.register({ id: 'layer.fg', label: 'Foreground', group: 'layers',
    type: PARAM_TYPE.SELECT, options: SOURCES, value: 0, feedbackVisible: true }); // default: Camera
  ps.register({ id: 'layer.bg', label: 'Background', group: 'layers',
    type: PARAM_TYPE.SELECT, options: SOURCES, value: 3, feedbackVisible: true }); // default: Color
  ps.register({ id: 'layer.ds', label: 'DisplaceSrc', group: 'layers',
    type: PARAM_TYPE.SELECT, options: SOURCES, value: 4, feedbackVisible: true });

  // ── Keyer ─────────────────────────────────────────────────────────────────
  ps.register({ id: 'keyer.active',     label: 'Keyer ON',      group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'keyer.white',      label: 'KeyLevelWhite', group: 'keyer',
    min: 0, max: 100, value: 80, unit: '%', feedbackVisible: true });
  ps.register({ id: 'keyer.black',      label: 'KeyLevelBlack', group: 'keyer',
    min: 0, max: 100, value: 10, unit: '%', feedbackVisible: true });
  ps.register({ id: 'keyer.softness',   label: 'KeySoftness',   group: 'keyer',
    min: 0, max: 100, value: 5,  unit: '%' });
  ps.register({ id: 'keyer.extkey',     label: 'ExtKey',        group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'keyer.and_displace', label: 'KeyAndDisplace', group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'keyer.alpha',      label: 'Alpha',         group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'keyer.alpha_inv',  label: 'Invert Alpha',  group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'keyer.chroma',     label: 'Chroma Key',    group: 'keyer',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'keyer.chromahue',  label: 'Chroma Hue',    group: 'keyer',
    min: 0, max: 360, value: 120, unit: '°' }); // default: green
  ps.register({ id: 'keyer.chromarange',label: 'Chroma Range',  group: 'keyer',
    min: 0, max: 100, value: 20, unit: '%' });
  ps.register({ id: 'keyer.chromasoft', label: 'Chroma Soft',   group: 'keyer',
    min: 0, max: 100, value: 10, unit: '%' });

  // ── Displacement ──────────────────────────────────────────────────────────
  ps.register({ id: 'displace.amount',  label: 'Displace',      group: 'displace',
    min: 0, max: 100, value: 0, feedbackVisible: true });
  ps.register({ id: 'displace.angle',   label: 'DisplAngle',    group: 'displace',
    min: 0, max: 360, value: 0, unit: '°', feedbackVisible: true });
  ps.register({ id: 'displace.offset',  label: 'DisplOffset',   group: 'displace',
    min: -100, max: 100, value: 0 });
  ps.register({ id: 'displace.rotateg', label: 'RotateGrey',    group: 'displace',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'displace.warp',    label: 'WarpMode',      group: 'displace',
    min: 0, max: 9, value: 0, type: PARAM_TYPE.SELECT,
    options: ['off','H-Wave','V-Wave','Radial','Spiral','Shear','Pinch','Turb','Rings','Custom'] });
  ps.register({ id: 'displace.warpamt', label: 'WarpAmt',       group: 'displace',
    min: 0, max: 100, value: 50, unit: '%' });

  // ── Blend & Feedback ──────────────────────────────────────────────────────
  ps.register({ id: 'blend.active',     label: 'Blend',         group: 'blend',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'blend.amount',     label: 'BlendAmount',   group: 'blend',
    min: 0, max: 100, value: 50, unit: '%', feedbackVisible: true });
  ps.register({ id: 'feedback.hor',     label: 'HorFBOffset',   group: 'blend',
    min: -100, max: 100, value: 0, unit: 'px' });
  ps.register({ id: 'feedback.ver',     label: 'VerFBOffset',   group: 'blend',
    min: -100, max: 100, value: 0, unit: 'px' });
  ps.register({ id: 'feedback.scale',   label: 'FBScale',       group: 'blend',
    min: -50, max: 50, value: 0 });
  ps.register({ id: 'feedback.rotate',  label: 'FBRotate',      group: 'blend',
    min: -100, max: 100, value: 0, unit: '°' });
  ps.register({ id: 'feedback.zoom',    label: 'FBZoom',        group: 'blend',
    min: -50, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'output.colorshift',label: 'ColorShift',    group: 'blend',
    min: 0, max: 100, value: 0 });
  ps.register({ id: 'output.transfer',  label: 'TransferMode',  group: 'blend',
    type: PARAM_TYPE.SELECT,
    options: [
      'Copy','XOR','OR','AND',
      'Multiply','Screen','Add','Difference','Exclude',
      'Overlay','Hardlight','Softlight','Dodge','Burn',
      'Subtract','Divide','PinLight','VividLight',
      'Hue','Saturation','Color','Luminosity',
    ],
    value: 0, feedbackVisible: true });
  ps.register({ id: 'output.interlace', label: 'Interlace',     group: 'blend',
    min: 0, max: 8, value: 0, step: 1 });
  ps.register({ id: 'output.fade',      label: 'Fade',          group: 'blend',
    min: 0, max: 100, value: 0 });
  ps.register({ id: 'output.solo',      label: 'Solo',          group: 'blend',
    type: PARAM_TYPE.TOGGLE, value: 0 });

  // ── Color ─────────────────────────────────────────────────────────────────
  ps.register({ id: 'color1.hue', label: 'Hue 1',  group: 'color',
    min: 0, max: 100, value: 0, unit: '°', feedbackVisible: true });
  ps.register({ id: 'color1.sat', label: 'Sat 1',  group: 'color',
    min: 0, max: 100, value: 80 });
  ps.register({ id: 'color1.val', label: 'Val 1',  group: 'color',
    min: 0, max: 100, value: 60 });
  ps.register({ id: 'color2.hue', label: 'Hue 2',  group: 'color',
    min: 0, max: 100, value: 50 });
  ps.register({ id: 'color2.sat', label: 'Sat 2',  group: 'color',
    min: 0, max: 100, value: 80 });
  ps.register({ id: 'color2.val', label: 'Val 2',  group: 'color',
    min: 0, max: 100, value: 60 });
  ps.register({ id: 'color2.type', label: 'Col2 Type', group: 'color',
    type: PARAM_TYPE.SELECT,
    options: ['Solid','Grad H','Grad V','Grad R'], value: 0 });
  ps.register({ id: 'color2.speed', label: 'Col2 Speed', group: 'color',
    min: -200, max: 200, value: 0, unit: '%' });

  // ── Noise BFG (Basis Function Generator) ─────────────────────────────────
  ps.register({ id: 'noise.type', label: 'BasisType', group: 'noise',
    type: PARAM_TYPE.SELECT,
    options: ['Value','Perlin','Simplex','Cellular-F1','Cellular-F2','Ridged','Curl','DomainWarp'],
    value: 1 }); // default: Perlin
  ps.register({ id: 'noise.scale',      label: 'Scale',      group: 'noise', min: 0.1,  max: 20,   value: 3,    step: 0.1  });
  ps.register({ id: 'noise.octaves',    label: 'Octaves',    group: 'noise', min: 1,    max: 8,    value: 4,    step: 1    });
  ps.register({ id: 'noise.lacunarity', label: 'Lacunarity', group: 'noise', min: 1.0,  max: 4.0,  value: 2.0,  step: 0.05 });
  ps.register({ id: 'noise.gain',       label: 'Gain',       group: 'noise', min: 0.1,  max: 1.0,  value: 0.5,  step: 0.01 });
  ps.register({ id: 'noise.speed',      label: 'Speed',      group: 'noise', min: -5.0, max: 5.0,  value: 0.2,  step: 0.05 });
  ps.register({ id: 'noise.offsetX',    label: 'OffsetX',    group: 'noise', min: -10,  max: 10,   value: 0,    step: 0.1  });
  ps.register({ id: 'noise.offsetY',    label: 'OffsetY',    group: 'noise', min: -10,  max: 10,   value: 0,    step: 0.1  });
  ps.register({ id: 'noise.contrast',   label: 'Contrast',   group: 'noise', min: 0.1,  max: 5.0,  value: 1.0,  step: 0.05 });
  ps.register({ id: 'noise.invert',     label: 'Invert',     group: 'noise', type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'noise.seed',       label: 'Seed',       group: 'noise', min: 0,    max: 100,  value: 0,    step: 0.5  });
  ps.register({ id: 'noise.color',      label: 'ColorField', group: 'noise', type: PARAM_TYPE.TOGGLE, value: 0 });

  // ── Mirror ────────────────────────────────────────────────────────────────
  ps.register({ id: 'mirror.camera', label: 'Mirror Cam',    group: 'mirror',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'mirror.movie',  label: 'Mirror Movie',  group: 'mirror',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'mirror.buffer', label: 'Mirror Buffer', group: 'mirror',
    type: PARAM_TYPE.TOGGLE, value: 0 });

  // ── Buffer / Stills ───────────────────────────────────────────────────────
  ps.register({ id: 'buffer.source', label: 'CaptureFrom', group: 'buffer',
    type: PARAM_TYPE.SELECT,
    options: ['Screen','Camera','Movie','Draw','FG Layer','BG Layer','3D Scene'], value: 0 });
  ps.register({ id: 'buffer.rows', label: 'Rows', type: PARAM_TYPE.CONTINUOUS, min: 1, max: 8, value: 4, step: 1, group: 'buffer' }),
  ps.register({ id: 'buffer.cols', label: 'Cols', type: PARAM_TYPE.CONTINUOUS, min: 1, max: 8, value: 4, step: 1, group: 'buffer' }),
  ps.register({ id: 'buffer.auto',   label: 'AutoCapture', group: 'buffer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'buffer.rate',   label: 'CaptureRate', group: 'buffer',
    min: 0.1, max: 30, value: 1, unit: 'fps' });
  ps.register({ id: 'buffer.panX',  label: 'PanX',  group: 'buffer',
    min: 0, max: 100, value: 50, feedbackVisible: true });
  ps.register({ id: 'buffer.panY',  label: 'PanY',  group: 'buffer',
    min: 0, max: 100, value: 50, feedbackVisible: true });
  ps.register({ id: 'buffer.scale', label: 'Scale', group: 'buffer',
    min: 0, max: 5, value: 1, feedbackVisible: true });
  ps.register({ id: 'buffer.fs1',   label: 'FrameSelect 1', group: 'buffer',
    min: 0, max: 63, value: 0, step: 1 });
  ps.register({ id: 'buffer.fs2',   label: 'FrameSelect 2', group: 'buffer',
    min: 0, max: 63, value: 0, step: 1 });
  ps.register({ id: 'buffer.frameblend', label: 'FrameBlend', group: 'buffer',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'buffer.fs3',   label: 'FrameSelect 3', group: 'buffer',
    min: 0, max: 63, value: 0, step: 1 });
  ps.register({ id: 'buffer.scan',      label: 'ScanFrames', group: 'buffer',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'buffer.scanrate',  label: 'ScanRate',   group: 'buffer',
    min: 0.1, max: 60, value: 8, unit: 'fps' });
  ps.register({ id: 'buffer.scandir',   label: 'ScanDir',    group: 'buffer',
    type: PARAM_TYPE.SELECT, options: ['→ Fwd','← Back','↔ Ping'], value: 0 });
  ps.register({ id: 'buffer.cap_screen', label: 'Screen→Buffer', group: 'buffer',
    type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'buffer.cap_video',  label: 'Video→Buffer',  group: 'buffer',
    type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'buffer.cap_movie',  label: 'Movie→Buffer',  group: 'buffer',
    type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'buffer.capture',    label: 'CaptBuffer',    group: 'buffer',
    type: PARAM_TYPE.TRIGGER });

  // ── Movie / clip ──────────────────────────────────────────────────────────
  ps.register({ id: 'movie.active',  label: 'MovieOn',    group: 'movie',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'movie.speed',   label: 'MovieSpeed', group: 'movie',
    min: -1, max: 3, value: 1, feedbackVisible: true });
  ps.register({ id: 'movie.pos',     label: 'MoviePos',   group: 'movie',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'movie.start',   label: 'MovieStart', group: 'movie',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'movie.loop',    label: 'MovieLoop',  group: 'movie',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'movie.mirror',  label: 'MirrorMovie',group: 'movie',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'movie.bpmsync', label: 'BPM Sync',   group: 'movie',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'movie.bpmbeats',label: 'BeatLen',    group: 'movie',
    type: PARAM_TYPE.SELECT, value: 2,
    options: ['1 beat','2 beats','4 beats','8 beats','16 beats'] });

  // ── Camera ────────────────────────────────────────────────────────────────
  ps.register({ id: 'camera.active', label: 'CameraOn',   group: 'camera',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'camera.device', label: 'Cam Device', group: 'camera',
    type: PARAM_TYPE.SELECT, options: ['default'], value: 0 });

  // ── 3D Scene ──────────────────────────────────────────────────────────────
  ps.register({ id: 'scene3d.active',    label: '3D On',       group: 'scene3d',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'scene3d.geo',       label: 'Geometry',    group: 'scene3d',
    type: PARAM_TYPE.SELECT,
    options: ['Sphere','Torus','Cube','Plane','Cylinder','Capsule','TorusKnot','Cone','Dodecahedron','Icosahedron','Octahedron','Tetrahedron','Ring'],
    value: 0 });
  ps.register({ id: 'scene3d.rot.x',     label: 'Rotation X',  group: 'scene3d',
    min: 0, max: 360, value: 0, unit: '°', feedbackVisible: true });
  ps.register({ id: 'scene3d.rot.y',     label: 'Rotation Y',  group: 'scene3d',
    min: 0, max: 360, value: 0, unit: '°', feedbackVisible: true });
  ps.register({ id: 'scene3d.rot.z',     label: 'Rotation Z',  group: 'scene3d',
    min: 0, max: 360, value: 0, unit: '°' });
  ps.register({ id: 'scene3d.pos.x',     label: 'Position X',  group: 'scene3d',
    min: -10, max: 10, value: 0 });
  ps.register({ id: 'scene3d.pos.y',     label: 'Position Y',  group: 'scene3d',
    min: -10, max: 10, value: 0 });
  ps.register({ id: 'scene3d.pos.z',     label: 'Position Z',  group: 'scene3d',
    min: -20, max: 20, value: 0 });
  ps.register({ id: 'scene3d.scale',     label: 'Scale',       group: 'scene3d',
    min: 0.01, max: 5, value: 1 });
  ps.register({ id: 'scene3d.wireframe', label: 'Wireframe',   group: 'scene3d',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'scene3d.cam.fov',   label: 'Cam FOV',     group: 'scene3d',
    min: 10, max: 120, value: 60, unit: '°' });
  ps.register({ id: 'scene3d.cam.x',     label: 'Cam X',       group: 'scene3d',
    min: -20, max: 20, value: 0 });
  ps.register({ id: 'scene3d.cam.y',     label: 'Cam Y',       group: 'scene3d',
    min: -20, max: 20, value: 0 });
  ps.register({ id: 'scene3d.cam.z',     label: 'Cam Z',       group: 'scene3d',
    min: 0.1, max: 30, value: 5 });
  ps.register({ id: 'scene3d.mat.roughness', label: 'Roughness', group: 'scene3d',
    min: 0, max: 1, value: 0.5 });
  ps.register({ id: 'scene3d.mat.metalness', label: 'Metalness', group: 'scene3d',
    min: 0, max: 1, value: 0.0 });
  ps.register({ id: 'scene3d.mat.emissive',  label: 'Emissive',  group: 'scene3d',
    min: 0, max: 1, value: 0.0 });
  ps.register({ id: 'scene3d.mat.opacity',   label: 'Opacity',   group: 'scene3d',
    min: 0, max: 1, value: 1.0 });
  ps.register({ id: 'scene3d.mat.hue',       label: 'MatHue',    group: 'scene3d',
    min: 0, max: 360, value: 240, unit: '°' });
  ps.register({ id: 'scene3d.mat.sat',       label: 'MatSat',    group: 'scene3d',
    min: 0, max: 100, value: 50, unit: '%' });
  ps.register({ id: 'scene3d.mat.texsrc', label: 'TexSrc', group: 'scene3d',
    type: PARAM_TYPE.SELECT,
    options: ['None','Camera','Movie','Screen','Draw','Buffer','Noise'], value: 0 });
  ps.register({ id: 'scene3d.light.intensity', label: 'Light Int.', group: 'scene3d',
    min: 0, max: 5, value: 1.0 });
  ps.register({ id: 'scene3d.spin.x', label: 'Spin X', group: 'scene3d',
    min: -180, max: 180, value: 0, unit: '°/s' });
  ps.register({ id: 'scene3d.spin.y', label: 'Spin Y', group: 'scene3d',
    min: -180, max: 180, value: 0, unit: '°/s' });
  ps.register({ id: 'scene3d.spin.z', label: 'Spin Z', group: 'scene3d',
    min: -180, max: 180, value: 0, unit: '°/s' });
  ps.register({ id: 'scene3d.depth.active', label: 'DepthPass', group: 'scene3d',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'scene3d.depth.mode', label: 'DepthMode', group: 'scene3d',
    type: PARAM_TYPE.SELECT, options: ['Distance','Normals'], value: 0 });

  // ── Draw ──────────────────────────────────────────────────────────────────
  ps.register({ id: 'draw.pensize',   label: 'DrawPenSize',  group: 'draw',
    min: 0, max: 100, value: 0 });
  ps.register({ id: 'draw.erasesize', label: 'ErasePenSize', group: 'draw',
    min: 0, max: 100, value: 10 });
  ps.register({ id: 'draw.x',        label: 'DrawX',        group: 'draw',
    min: 0, max: 100, value: 50 });
  ps.register({ id: 'draw.y',        label: 'DrawY',        group: 'draw',
    min: 0, max: 100, value: 50 });
  ps.register({ id: 'draw.color.h',  label: 'PenHue',       group: 'draw',
    min: 0, max: 360, value: 0, unit: '°' });
  ps.register({ id: 'draw.color.s',  label: 'PenSat',       group: 'draw',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'draw.color.v',  label: 'PenBright',    group: 'draw',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'draw.opacity',  label: 'PenOpacity',   group: 'draw',
    min: 1, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'draw.fade',     label: 'DrawFade',     group: 'draw',
    min: 0, max: 1, value: 0, step: 0.005 }); // 0 = no fade, 1 = instant clear
  ps.register({ id: 'draw.clear',    label: 'ClearDraw',    group: 'draw',
    type: PARAM_TYPE.TRIGGER });

  // ── Text ──────────────────────────────────────────────────────────────────
  ps.register({ id: 'text.size',    label: 'TextSize',    group: 'text',
    min: 8, max: 400, value: 72 });
  ps.register({ id: 'text.x',       label: 'TextX',       group: 'text',
    min: 0, max: 100, value: 50 });
  ps.register({ id: 'text.y',       label: 'TextY',       group: 'text',
    min: 0, max: 100, value: 50 });
  ps.register({ id: 'text.hue',     label: 'TextHue',     group: 'text',
    min: 0, max: 360, value: 0, unit: '°' });
  ps.register({ id: 'text.sat',     label: 'TextSat',     group: 'text',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'text.opacity', label: 'TextOpacity', group: 'text',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'text.align',   label: 'TextAlign',   group: 'text',
    type: PARAM_TYPE.SELECT, options: ['Center','Left','Right'], value: 0 });
  ps.register({ id: 'text.font',    label: 'FontStyle',   group: 'text',
    type: PARAM_TYPE.SELECT, options: ['Sans','Serif','Mono','Bold','Italic'], value: 0 });
  ps.register({ id: 'text.outline', label: 'Outline',     group: 'text',
    min: 0, max: 20, value: 0, unit: 'px' });
  ps.register({ id: 'text.spacing', label: 'LineSpacing', group: 'text',
    min: 0.5, max: 3, value: 1.2 });
  ps.register({ id: 'text.mode',    label: 'AdvanceMode', group: 'text',
    type: PARAM_TYPE.SELECT, options: ['All','Char','Word','Line'], value: 0 });
  ps.register({ id: 'text.bg',      label: 'BlackBG',     group: 'text',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'text.advance', label: 'TextAdvance', group: 'text',
    type: PARAM_TYPE.TRIGGER });

  // ── Screen capture ────────────────────────────────────────────────────────
  ps.register({ id: 'screen.bg1',   label: 'ScrBG1', group: 'screen',
    type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'screen.bg2',   label: 'ScrBG2', group: 'screen',
    type: PARAM_TYPE.TRIGGER });

  // ── Interpolation ─────────────────────────────────────────────────────────
  ps.register({ id: 'output.interp', label: 'Interpolation', group: 'output',
    type: PARAM_TYPE.SELECT, options: ['none', 'linear', 'bicubic'], value: 0 });
  ps.register({ id: 'output.resolution', label: 'Resolution', group: 'output',
    type: PARAM_TYPE.SELECT,
    options: ['Display','720p','1080p','540p','Quarter'], value: 0 });

  // ── Global BPM / Tap Tempo / Morph ───────────────────────────────────────
  ps.register({ id: 'global.bpm',   label: 'BPM',       group: 'global',
    min: 20, max: 300, value: 120, unit: 'bpm' });
  ps.register({ id: 'global.tap',   label: 'Tap Tempo', group: 'global',
    type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'global.morph', label: 'Morph',     group: 'global',
    min: 0, max: 100, value: 0, unit: '%', feedbackVisible: true });
  ps.register({ id: 'global.morphspeed', label: 'MorphSpeed', group: 'global',
    min: 0.1, max: 20, value: 2, unit: 's' });
  ps.register({ id: 'global.beatdetect', label: 'Auto BPM', group: 'global',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'global.debug',     label: 'Debug',    group: 'global',
    type: PARAM_TYPE.TOGGLE, value: 0 });

  // ── Per-layer color correction ────────────────────────────────────────────
  ps.register({ id: 'fg.hue',     label: 'FG Hue',     group: 'fg',
    min: -180, max: 180, value: 0, unit: '°' });
  ps.register({ id: 'fg.sat',     label: 'FG Sat',     group: 'fg',
    min: 0, max: 200, value: 100, unit: '%' });
  ps.register({ id: 'fg.bright',  label: 'FG Bright',  group: 'fg',
    min: 0, max: 200, value: 100, unit: '%' });
  ps.register({ id: 'fg.opacity', label: 'FG Opacity', group: 'fg',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'bg.hue',     label: 'BG Hue',     group: 'bg',
    min: -180, max: 180, value: 0, unit: '°' });
  ps.register({ id: 'bg.sat',     label: 'BG Sat',     group: 'bg',
    min: 0, max: 200, value: 100, unit: '%' });
  ps.register({ id: 'bg.bright',  label: 'BG Bright',  group: 'bg',
    min: 0, max: 200, value: 100, unit: '%' });
  ps.register({ id: 'bg.opacity', label: 'BG Opacity', group: 'bg',
    min: 0, max: 100, value: 100, unit: '%' });

  // ── Effects ───────────────────────────────────────────────────────────────
  ps.register({ id: 'effect.pixelate',  label: 'Pixelate',   group: 'effect',
    min: 1, max: 200, value: 1, unit: 'px', feedbackVisible: false });
  ps.register({ id: 'effect.edge',      label: 'Edge',       group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.edge_inv',  label: 'EdgeInvert', group: 'effect',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'effect.rgbshift',  label: 'RGB Shift',  group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.rgbangle',  label: 'RGB Angle',  group: 'effect',
    min: 0, max: 360, value: 0, unit: '°' });
  ps.register({ id: 'effect.posterize', label: 'Posterize',  group: 'effect',
    min: 2, max: 32, value: 32, step: 1 });
  ps.register({ id: 'effect.solarize',  label: 'Solarize',   group: 'effect',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'effect.kaleidoscope', label: 'Kaleidoscope', group: 'effect',
    min: 0, max: 16, value: 0, step: 1 });
  ps.register({ id: 'effect.kalerot',   label: 'Kale.Rot',   group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.vignette',  label: 'Vignette',   group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.vigradius', label: 'Vign.Radius',group: 'effect',
    min: 0, max: 100, value: 65, unit: '%' });
  ps.register({ id: 'effect.bloom',     label: 'Bloom',      group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.bloomthresh',label:'BloomThresh',group: 'effect',
    min: 0, max: 100, value: 70, unit: '%' });

  // ── Levels ────────────────────────────────────────────────────────────────
  ps.register({ id: 'effect.lvblack',  label: 'LvBlack',    group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.lvwhite',  label: 'LvWhite',    group: 'effect',
    min: 0, max: 100, value: 100, unit: '%' });
  ps.register({ id: 'effect.lvgamma',  label: 'LvGamma',    group: 'effect',
    min: 10, max: 400, value: 100, unit: '%' });

  // ── Quad Mirror ───────────────────────────────────────────────────────────
  ps.register({ id: 'effect.quadmirror', label: 'QuadMirror', group: 'effect',
    type: PARAM_TYPE.SELECT, options: ['Off','4-Way','Diagonal'], value: 0 });

  // ── Stroboscope ───────────────────────────────────────────────────────────
  ps.register({ id: 'effect.strobe',     label: 'Strobe',     group: 'effect',
    type: PARAM_TYPE.TOGGLE, value: 0, feedbackVisible: true });
  ps.register({ id: 'effect.stroberate', label: 'StrobeRate', group: 'effect',
    min: 0.5, max: 60, value: 8, unit: 'Hz' });
  ps.register({ id: 'effect.strobeduty', label: 'StrobeDuty', group: 'effect',
    min: 1, max: 99, value: 50, unit: '%' });

  // ── Film Grain / Scanlines ────────────────────────────────────────────────
  ps.register({ id: 'effect.grain',      label: 'FilmGrain',  group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.scanlines',  label: 'Scanlines',  group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.lutamount',  label: 'LUT Amount', group: 'lut',
    min: 0, max: 100, value: 100, unit: '%' });

  // ── White Balance ─────────────────────────────────────────────────────────
  ps.register({ id: 'effect.wbtemp', label: 'WB Temp',  group: 'effect',
    min: -100, max: 100, value: 0, unit: '' });
  ps.register({ id: 'effect.wbtint', label: 'WB Tint',  group: 'effect',
    min: -100, max: 100, value: 0, unit: '' });

  // ── Pixel Sort ────────────────────────────────────────────────────────────
  ps.register({ id: 'effect.pixelsort',   label: 'PixSort',    group: 'effect',
    min: 0, max: 100, value: 0, unit: '%' });
  ps.register({ id: 'effect.psortlen',    label: 'SortLen',    group: 'effect',
    min: 1, max: 512, value: 64, unit: 'px' });
  ps.register({ id: 'effect.psortthresh',label: 'SortThresh', group: 'effect',
    min: 0, max: 100, value: 30, unit: '%' });
  ps.register({ id: 'effect.psortdir',   label: 'SortDir',    group: 'effect',
    type: PARAM_TYPE.SELECT, options: ['Vert','Horiz'], value: 0 });
  ps.register({ id: 'effect.psortmode',  label: 'SortMode',   group: 'effect',
    type: PARAM_TYPE.SELECT, options: ['Bright','Dark'], value: 0 });

  // ── Video Delay Line ──────────────────────────────────────────────────────
  ps.register({ id: 'delay.frames', label: 'DelayFrames', group: 'delay',
    min: 1, max: 30, value: 5, step: 1 });

  // ── Particles ─────────────────────────────────────────────────────────────
  ps.register({ id: 'particle.count',   label: 'PCount',   group: 'particle',
    type: PARAM_TYPE.SELECT, options: ['1k','4k','16k','64k'], value: 0 });
  ps.register({ id: 'particle.speed',   label: 'PSpeed',   group: 'particle',
    min: 0, max: 100, value: 40, unit: '%' });
  ps.register({ id: 'particle.life',    label: 'PLife',    group: 'particle',
    min: 1, max: 100, value: 30, unit: '%' });
  ps.register({ id: 'particle.gravity', label: 'PGravity', group: 'particle',
    min: 0, max: 100, value: 20, unit: '%' });
  ps.register({ id: 'particle.wind',    label: 'PWind',    group: 'particle',
    min: 0, max: 100, value: 50, unit: '%' });
  ps.register({ id: 'particle.size',    label: 'PSize',    group: 'particle',
    min: 1, max: 32, value: 4, unit: 'px' });
  ps.register({ id: 'particle.color',   label: 'PColor',   group: 'particle',
    type: PARAM_TYPE.SELECT, options: ['White','Rainbow','Mono','Fire'], value: 0 });

  // ── Slit Scan ─────────────────────────────────────────────────────────────
  ps.register({ id: 'slitscan.active', label: 'SlitScan',   group: 'slitscan',
    type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 'slitscan.pos',    label: 'SlitPos',    group: 'slitscan',
    min: 0, max: 100, value: 50, unit: '%' });
  ps.register({ id: 'slitscan.speed',  label: 'SlitSpeed',  group: 'slitscan',
    min: 0.5, max: 60, value: 15, unit: 'fps' });
  ps.register({ id: 'slitscan.axis',   label: 'SlitAxis',   group: 'slitscan',
    type: PARAM_TYPE.SELECT, options: ['Vertical','Horizontal','Center-V','Center-H'], value: 0 });
  ps.register({ id: 'slitscan.width',  label: 'SlitWidth',  group: 'slitscan',
    min: 1, max: 16, value: 2, unit: 'px', step: 1 });
  ps.register({ id: 'slitscan.clear',  label: 'SlitClear',  group: 'slitscan',
    type: PARAM_TYPE.TRIGGER });

  // ── Sequence Buffers ──────────────────────────────────────────────────────
  const SEQ_SOURCES = ['Output','Camera','Movie','FG','BG','Buffer','Draw'];
  ps.register({ id: 'seq1.active',  label: 'Seq1 Rec',    type: PARAM_TYPE.TOGGLE,     group: 'seq', value: 0 });
  ps.register({ id: 'seq1.source',  label: 'Seq1 Source', type: PARAM_TYPE.SELECT,     group: 'seq', options: SEQ_SOURCES, value: 0 });
  ps.register({ id: 'seq1.speed',   label: 'Seq1 Speed',  type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: -300, max: 300, value: 100, unit: '%' });
  ps.register({ id: 'seq1.size',    label: 'Seq1 Frames', type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: 4, max: 480, value: 60, step: 1 });
  ps.register({ id: 'seq2.active',  label: 'Seq2 Rec',    type: PARAM_TYPE.TOGGLE,     group: 'seq', value: 0 });
  ps.register({ id: 'seq2.source',  label: 'Seq2 Source', type: PARAM_TYPE.SELECT,     group: 'seq', options: SEQ_SOURCES, value: 0 });
  ps.register({ id: 'seq2.speed',   label: 'Seq2 Speed',  type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: -300, max: 300, value: 100, unit: '%' });
  ps.register({ id: 'seq2.size',    label: 'Seq2 Frames', type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: 4, max: 480, value: 60, step: 1 });
  ps.register({ id: 'seq3.active',  label: 'Seq3 Rec',    type: PARAM_TYPE.TOGGLE,     group: 'seq', value: 0 });
  ps.register({ id: 'seq3.source',  label: 'Seq3 Source', type: PARAM_TYPE.SELECT,     group: 'seq', options: SEQ_SOURCES, value: 0 });
  ps.register({ id: 'seq3.speed',   label: 'Seq3 Speed',  type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: -300, max: 300, value: 100, unit: '%' });
  ps.register({ id: 'seq3.size',    label: 'Seq3 Frames', type: PARAM_TYPE.CONTINUOUS, group: 'seq', min: 4, max: 480, value: 60, step: 1 });

  // ── Vectorscope ───────────────────────────────────────────────────────────
  ps.register({ id: 'vectorscope.mode',  label: 'VScope Mode',  group: 'vectorscope',
    type: PARAM_TYPE.SELECT, options: ['Lissajous','Waveform','FFT'], value: 0 });
  ps.register({ id: 'vectorscope.gain',  label: 'VScope Gain',  group: 'vectorscope',
    min: 1, max: 200, value: 100, unit: '%' });
  ps.register({ id: 'vectorscope.decay', label: 'VScope Decay', group: 'vectorscope',
    min: 0, max: 99, value: 60, unit: '%' });
  ps.register({ id: 'vectorscope.color', label: 'VScope Color', group: 'vectorscope',
    type: PARAM_TYPE.SELECT, options: ['Green','Cyan','Red','Gold'], value: 0 });

  return ps;
}
