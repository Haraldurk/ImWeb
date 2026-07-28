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

    this._value = config.value ?? this.min;
    this._target = this._value; // slew target
    this.defaultValue = this._value;

    // Controller assignment — set by ControllerManager
    this.controller = null; // { type, ...config } — primary controller
    this.xControllers = []; // external mapping controllers (controller-of-controller)
    this.table = null; // response curve table name (string)

    // Flags
    this.select = config.select ?? false; // force native <select> dropdown regardless of option count
    this.invert = false;
    this.cycle = false; // for SELECT: cycle on trigger
    this.slew = 0; // 0=instant, 0.001–1.0 seconds (lag time)
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
      if (this.step) clamped = Math.round(clamped / this.step) * this.step;
    }

    const changed = clamped !== this._value;
    this._value = clamped;
    // Keep _target in sync so slew doesn't fight manual UI / direct .value writes
    if (this.type === PARAM_TYPE.CONTINUOUS) this._target = clamped;

    if (changed || this.type === PARAM_TYPE.TRIGGER) {
      this._listeners.forEach((fn) => fn(clamped, this));
    }
    if (this.type === PARAM_TYPE.TRIGGER && changed) {
      this._triggerListeners.forEach((fn) => fn(this));
    }
  }

  // Normalized value in [0, 1]
  get normalized() {
    if (this.type === PARAM_TYPE.TOGGLE) return this._value;
    if (this.type === PARAM_TYPE.SELECT)
      return this._value / Math.max(1, (this.options?.length ?? 1) - 1);
    return (this._value - this.min) / (this.max - this.min);
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
    // Exponential lag: approach target at rate 1/slew per second.
    // Bypass the value setter so _target is preserved during lerp.
    const alpha = Math.min(1, dt / Math.max(0.001, this.slew));
    const next = this._value + (this._target - this._value) * alpha;
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
    const decimals = this.max - this.min > 10 ? 1 : 2;
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
      feedbackVisible: this.feedbackVisible,
      feedbackPos: { ...this.feedbackPos },
    };
  }

  deserialize(data) {
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
  { key: "vwarp",     label: "Vasulka Warp" }, // 22 — matches its panel header
  { key: "analog",    label: "Analog"    }, // 23
  { key: "tdisp",     label: "TimeDisp"  }, // 24
  { key: "movieB",    label: "Movie B"   }, // 25
  { key: "mixbus",    label: "Mix 1"     }, // 26 — not in inputs bag
  { key: "mixbus2",   label: "Mix 2"     }, // 27 — not in inputs bag
  { key: "mixbus3",   label: "Mix 3"     }, // 28 — not in inputs bag
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
                                16 /* Particles */, 21 /* SDF */, 11 /* Text */,
                                7 /* Draw */, 6 /* 3D Scene */, 20 /* 3D Depth */,
                                23 /* Analog */,
  { header: "From the Signal" }, 8 /* Output */, 13 /* Delay */, 24 /* TimeDisp */,
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
    label: "Self-process mode", // self-process: blends BG against itself (not against FG)
    group: "layers",
    type: PARAM_TYPE.SELECT,
    options: BLEND_MODES,
    value: 0,
  });
  ps.register({
    id: "layer.fg.blendAmount",
    label: "FG Blend Amt",
    group: "fg",
    min: 0,
    max: 1,
    value: 1,
  });
  ps.register({
    id: "layer.bg.blendAmount",
    label: "BG Blend Amt",
    group: "bg",
    min: 0,
    max: 1,
    value: 1,
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
  ps.register({
    id: "feedback.hor",
    label: "HorFBOffset",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "px",
  });
  ps.register({
    id: "feedback.ver",
    label: "VerFBOffset",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "px",
  });
  ps.register({
    id: "feedback.scale",
    label: "FBScale",
    group: "blend",
    min: -50,
    max: 50,
    value: 0,
  });
  ps.register({
    id: "feedback.rotate",
    label: "FBRotate",
    group: "blend",
    min: -100,
    max: 100,
    value: 0,
    unit: "°",
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
    { key: "speed", label: "MovieSpeed", min: -3, max: 3, value: 1, feedbackVisible: true },
    { key: "pos", label: "MoviePos", min: 0, max: 100, value: 0, unit: "%" },
    { key: "start", label: "MovieStart", min: 0, max: 100, value: 0, unit: "%" },
    { key: "end", label: "MovieEnd", min: 0, max: 100, value: 100, unit: "%" },
    { key: "loop", label: "MovieLoop", type: PARAM_TYPE.SELECT, value: 1, options: ["Off", "Loop", "Ping-pong"] },
    // default muted — user opts in to audio
    { key: "mute", label: "MuteMovie", type: PARAM_TYPE.TOGGLE, value: 1 },
    { key: "bpmsync", label: "BPM Sync", type: PARAM_TYPE.TOGGLE, value: 0 },
    { key: "bpmbeats", label: "BeatLen", type: PARAM_TYPE.SELECT, value: 2, options: ["1 beat", "2 beats", "4 beats", "8 beats", "16 beats"] },
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
  ps.register({
    id: "scene3d.cam.x",
    label: "Cam X",
    group: "scene3d",
    min: -20,
    max: 20,
    value: 0,
  });
  ps.register({
    id: "scene3d.cam.y",
    label: "Cam Y",
    group: "scene3d",
    min: -20,
    max: 20,
    value: 0,
  });
  ps.register({
    id: "scene3d.cam.z",
    label: "Cam Z",
    group: "scene3d",
    min: 0.1,
    max: 30,
    value: 5,
  });
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
  ps.register({
    id: "scene3d.mat.displace",
    label: "Math Displace",
    group: "scene3d",
    min: 0,
    max: 2,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "scene3d.mat.tDisplace",
    label: "T-Displace",
    group: "scene3d",
    min: 0,
    max: 2,
    value: 0,
    step: 0.01,
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
  ps.register({
    id: "scene3d.light.intensity",
    label: "Light Int.",
    group: "lights3d",
    min: 0,
    max: 5,
    value: 1.0,
  });
  ps.register({
    id: "scene3d.light.ambient",
    label: "Ambient",
    group: "lights3d",
    min: 0,
    max: 2,
    step: 0.01,
    value: 0.4,
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
    label: "SDFActive",
    group: "sdf",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "sdf.opMode",
    label: "SDFOpMode",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    select: true,
    options: ["Union", "Smooth Union", "Subtraction", "Intersection"],
  });
  ps.register({
    id: "sdf.opAmount",
    label: "SDFOpAmt",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "sdf.distance",
    label: "SDFDist",
    group: "sdf",
    min: 0,
    max: 5.0,
    value: 1.5,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "sdf.shape",
    label: "SDFShape",
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
    ],
  });
  ps.register({
    id: "sdf.repeat",
    label: "SDFRepeat",
    group: "sdf",
    min: 0,
    max: 10.0,
    value: 0,
    step: 0.05,
    unit: "u",
  });
  ps.register({
    id: "sdf.warp",
    label: "SDFWarp",
    group: "sdf",
    min: 0,
    max: 2.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.camX",
    label: "SDFCamX",
    group: "sdf",
    min: -10,
    max: 10,
    value: 0,
    step: 0.05,
  });
  ps.register({
    id: "sdf.camY",
    label: "SDFCamY",
    group: "sdf",
    min: -10,
    max: 10,
    value: 0,
    step: 0.05,
  });
  ps.register({
    id: "sdf.camZ",
    label: "SDFCamZ",
    group: "sdf",
    min: -20,
    max: 20,
    value: 5,
    step: 0.05,
  });
  ps.register({
    id: "sdf.kifsIter",
    label: "KIFSIter",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: ["0", "1", "2", "3", "4", "5"],
  });
  ps.register({
    id: "sdf.kifsAngle",
    label: "KIFSAngle",
    group: "sdf",
    min: 0,
    max: 360,
    value: 0,
    step: 0.5,
    unit: "°",
  });
  ps.register({
    id: "sdf.lumaWarp",
    label: "LumaWarp",
    group: "sdf",
    min: 0,
    max: 2.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.speed",
    label: "SDFSpeed",
    group: "sdf",
    min: 0,
    max: 5.0,
    value: 0.2,
    step: 0.01,
  });
  ps.register({
    id: "sdf.lumaThresh",
    label: "LumaThresh",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.2,
    step: 0.01,
  });
  ps.register({
    id: "sdf.texBlend",
    label: "TexBlend",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.8,
    step: 0.01,
  });
  ps.register({
    id: "sdf.ao",
    label: "SDFAO",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.5,
    step: 0.01,
  });
  ps.register({
    id: "sdf.glow",
    label: "SDFGlow",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0.2,
    step: 0.01,
  });
  ps.register({
    id: "sdf.hue",
    label: "SDFHue",
    group: "sdf",
    min: 0,
    max: 360,
    value: 0,
    step: 1,
    unit: "°",
  });
  ps.register({
    id: "sdf.sat",
    label: "SDFSat",
    group: "sdf",
    min: 0,
    max: 1.0,
    value: 0,
    step: 0.01,
  });
  ps.register({
    id: "sdf.val",
    label: "SDFVal",
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
    id: "sdf.texSrc",
    label: "TexSrc",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: [
      "FG Layer",
      "Camera",
      "Movie",
      "Draw",
      "Noise",
      "Color",
      "Buffer",
      "3D",
      "None",
    ],
  });
  ps.register({
    id: "sdf.refractSrc",
    label: "RefractSrc",
    group: "sdf",
    type: PARAM_TYPE.SELECT,
    value: 0,
    options: [
      "BG Layer",
      "Camera",
      "Movie",
      "Draw",
      "Noise",
      "Color",
      "Buffer",
      "3D",
      "None",
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
    label: "FontStyle",
    group: "text",
    type: PARAM_TYPE.SELECT,
    options: ["Sans", "Serif", "Mono", "Bold", "Italic"],
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
    options: ["None", "Bounce", "Wave", "Fade", "Typewriter"],
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
    options: ["None", "Fade", "FadeUp", "FadeDown", "Scale", "Blur", "TypeOn"],
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
    options: ["Display", "720p", "1080p", "540p", "Quarter"],
    value: 0,
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
  ps.register({
    id: "effect.posterize",
    label: "Posterize",
    group: "effect",
    min: 2,
    max: 32,
    value: 32,
    step: 1,
  });
  ps.register({
    id: "effect.solarize",
    label: "Solarize",
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
    label: "DelayFrames",
    group: "delay",
    min: 1,
    max: 30,
    value: 5,
    step: 1,
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
    options: [
      "None",
      "Camera",
      "Movie",
      "Buffer",
      "Output",
      "Draw",
      "FG Src",
      "BG Src",
      "DS Src",
      "Noise",
      "Vectorscope",
    ],
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

  // ── Slit Scan ─────────────────────────────────────────────────────────────
  // ── Vasulka Warp ──────────────────────────────────────────────────────────
  ps.register({
    id: "vasulka.active",
    label: "Vasulka",
    group: "vasulka",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "vasulka.freqh",
    label: "FreqH",
    group: "vasulka",
    min: 0,
    max: 20,
    value: 3,
  });
  ps.register({
    id: "vasulka.freqv",
    label: "FreqV",
    group: "vasulka",
    min: 0,
    max: 20,
    value: 0,
  });
  ps.register({
    id: "vasulka.amph",
    label: "AmpH",
    group: "vasulka",
    min: 0,
    max: 100,
    value: 20,
    unit: "%",
  });
  ps.register({
    id: "vasulka.ampv",
    label: "AmpV",
    group: "vasulka",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "vasulka.phase",
    label: "Phase",
    group: "vasulka",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "vasulka.freq2",
    label: "Freq2",
    group: "vasulka",
    min: 0,
    max: 20,
    value: 7,
  });
  ps.register({
    id: "vasulka.amp2",
    label: "Amp2",
    group: "vasulka",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
  });
  ps.register({
    id: "vasulka.color",
    label: "VasColor",
    group: "vasulka",
    min: 0,
    max: 100,
    value: 0,
    unit: "%",
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
    options: SOURCES,
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
    options: ["Slit X", "Slit Y", "Warp Line", "Slit X Sym", "Slit Y Sym", "Radial", "Noise"],
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

  // ── Vasulka Warp (Temporal Slit-Scan) ────────────────────────────────────
  ps.register({
    id: "vwarp.active",
    label: "VWarp",
    group: "vwarp",
    type: PARAM_TYPE.TOGGLE,
    value: 0,
  });
  ps.register({
    id: "vwarp.axis",
    label: "Axis",
    group: "vwarp",
    type: PARAM_TYPE.SELECT,
    options: ["Horizontal", "Vertical"],
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

  return ps;
}
