/**
 * ImWeb State Management
 * Presets and Display States, stored in IndexedDB.
 */

import { DEMO_PRESETS } from './DemoPresets.js';

export const MAX_STATES = 32;

// ── IndexedDB storage ─────────────────────────────────────────────────────────

const DB_NAME    = 'imweb';
const DB_VERSION = 2;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (e.oldVersion < 2) {
        if (db.objectStoreNames.contains('presets')) db.deleteObjectStore('presets');
        if (!db.objectStoreNames.contains('banks'))  db.createObjectStore('banks', { keyPath: 'index' });
      }
      if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables', { keyPath: 'name' });
      if (!db.objectStoreNames.contains('assets')) db.createObjectStore('assets', { keyPath: 'hash' });
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

async function dbPut(store, value) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const req = tx.objectStore(store).put(value);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGet(store, key) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(store) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// ── Preset ────────────────────────────────────────────────────────────────────

export class Preset {
  constructor(index = 0) {
    this.index        = index;
    this.name         = `Bank ${index + 1}`;
    this.controllers  = {};
    this.states       = [];
    this.activeState  = 0;
    this.created      = Date.now();
    this.modified     = Date.now();
    this.thumbnail    = null;
  }

  addState(values, index = null, fxOrder = null, controllers = {}, mediaRefs = {}) {
    const ds = {
      values:      { ...values },
      fxOrder:     fxOrder ? [...fxOrder] : null,
      controllers: { ...controllers },
      mediaRefs:   { movie: null, scene3d: null, text: null, buffer: null, ...mediaRefs },
      name:        null,
      thumbnail:   null,
      created:     Date.now(),
    };
    if (index !== null && index >= 0 && index < MAX_STATES) {
      this.states[index] = ds; return index;
    }
    for (let i = 0; i < MAX_STATES; i++) {
      if (!this.states[i]) { this.states[i] = ds; return i; }
    }
    return null;
  }

  getState(index) { return this.states[index] ?? null; }

  removeState(index) { this.states[index] = null; }

  serialize() {
    return {
      index:       this.index,
      name:        this.name,
      controllers: this.controllers,
      states:      this.states,
      activeState: this.activeState,
      created:     this.created,
      modified:    this.modified,
      thumbnail:   this.thumbnail,
    };
  }

  exportBank() {
    return { __type: 'imbank', version: 1, name: this.name,
             states: this.states, activeState: this.activeState, exported: Date.now() };
  }

  static importBank(data, targetIndex) {
    const p = new Preset(targetIndex);
    p.name        = data.name   || `Bank ${targetIndex + 1}`;
    p.states      = data.states || [];
    p.activeState = data.activeState ?? 0;
    return p;
  }

  static deserialize(data) {
    const p = new Preset(data.index);
    Object.assign(p, data);
    return p;
  }

  async save() {
    this.modified = Date.now();
    await dbPut('banks', this.serialize());
  }

  static async load(index) {
    const data = await dbGet('banks', index);
    return data ? Preset.deserialize(data) : null;
  }

  static async loadAll() {
    const all = await dbGetAll('banks');
    return all.map(d => Preset.deserialize(d));
  }
}

// ── PresetManager ─────────────────────────────────────────────────────────────

export class PresetManager extends EventTarget {
  constructor(ps, controllers, pipeline = null) {
    super();
    this.ps          = ps;
    this.ctrl        = controllers;
    this.pipeline    = pipeline;
    this.presets     = [];
    this.currentIdx  = 0;
    this._fadePresets = true;
    this._fadeTimeoutId = null;
    this._mediaRefs  = { movie: null, scene3d: null, text: null, buffer: null };

    // Morph animation state
    this._morphFrom      = null;
    this._morphTo        = null;
    this._morphT         = 0;
    this._morphActive    = false;
    this._morphOnComplete = null;
  }

  setMediaRef(key, filename) { this._mediaRefs[key] = filename; }

  async init() {
    const saved = await Preset.loadAll();
    if (saved.length === 0) {
      // Seed factory demo presets on first launch
      for (const def of DEMO_PRESETS) {
        const p = new Preset(def.index);
        p.name = def.name;
        p.controllers = def.controllers;
        p.states = def.states;
        p.activeState = def.activeState;
        this.presets[def.index] = p;
        await p.save();
      }
    } else {
      saved.forEach(p => { this.presets[p.index] = p; });
    }
    // Ensure at least slot 0 exists (other banks are created on demand)
    if (!this.presets[0]) this.presets[0] = new Preset(0);
    await this.activatePreset(0, { fade: false });
  }

  get current() { return this.presets[this.currentIdx]; }

  async activatePreset(index, { fade = true } = {}) {
    const p = this.presets[index];
    if (!p) return;

    this.currentIdx = index;

    // Cancel any running morph from the previous bank
    this._morphActive    = false;
    this._morphFrom      = null;
    this._morphTo        = null;
    this._morphOnComplete = null;

    // Clear all assignments so leftover controllers from the previous bank
    // don't leak into the new one
    this.ctrl.clearAllAssignments();

    // Restore controller assignments
    if (p.controllers) {
      this.ps.deserializeControllers(p.controllers);
      Object.entries(p.controllers).forEach(([paramId, config]) => {
        if (config.controller) this.ctrl.assign(paramId, config.controller);
      });
      // Rebuild xController LFO instances from deserialized xControllers
      this.ctrl.rebuildXControllers();
    }

    // Get target state values
    const stateIdx = p.activeState ?? 0;
    const ds = p.getState(stateIdx);

    if (ds?.values && fade && this.ps.get('global.morphspeed')?.value > 0) {
      // Start a morph animation instead of snapping
      this._morphFrom   = this.ps.captureState();
      this._morphTo     = { ...ds.values };
      this._morphT      = 0;
      this._morphActive = true;
      this.ps.set('global.morph', 0);
    } else if (ds?.values) {
      this.ps.restoreState(ds.values);
      this.ctrl.retriggerLFOs();
      // Send MIDI feedback to motorized faders
      this.ps.getAll().forEach(p => this.ctrl.sendParamFeedback(p));
    }

    // Restore fx order if saved
    if (ds?.fxOrder && this.pipeline) {
      this.pipeline.setFxOrder(ds.fxOrder);
    }

    // Update UI
    const _statusBank = document.getElementById('status-bank');
    if (_statusBank) _statusBank.textContent = p.name;
    const _bankSel = document.getElementById('bank-select');
    if (_bankSel) _bankSel.value = String(index);

    this.dispatchEvent(new CustomEvent('presetActivated', {
      detail: { index, preset: p }
    }));
  }

  /**
   * Called from the render loop. Advances morph animation.
   * dt: delta time in seconds.
   */
  tickMorph(dt) {
    if (!this._morphActive) return;
    const speed = this.ps.get('global.morphspeed')?.value ?? 2;
    // If speed was set to 0 mid-morph, snap immediately to the end
    if (speed <= 0) { this._morphT = 1; }
    else { this._morphT = Math.min(1, this._morphT + dt / speed); }
    // Smooth step
    const t = this._morphT * this._morphT * (3 - 2 * this._morphT);
    this.ps.set('global.morph', Math.round(t * 100));

    // Lerp all continuous params between from and to
    const SKIP_TYPES = new Set(['toggle', 'trigger', 'select']);
    this.ps.getAll().forEach(p => {
      if (SKIP_TYPES.has(p.type)) return;
      if (p.group === 'global') return; // session-level params (BPM, morphspeed…) never morphed
      if (p.controller) return; // don't override active controllers
      const from = this._morphFrom?.[p.id] ?? p.value;
      const to   = this._morphTo?.[p.id]   ?? p.value;
      if (from === to) return;
      p.value = from + (to - from) * t;
    });

    if (this._morphT >= 1) {
      // Snap to final state and clean up
      if (this._morphTo) this.ps.restoreState(this._morphTo);
      // Sync Fixed controller configs to restored values
      this._syncFixedControllers();
      const onComplete = this._morphOnComplete;
      this._morphActive    = false;
      this._morphFrom      = null;
      this._morphTo        = null;
      this._morphOnComplete = null;
      if (onComplete) onComplete();
      else this.ctrl.retriggerLFOs();
    }
  }

  /** Sync Fixed controller normalized values to match actual param values. */
  _syncFixedControllers() {
    this.ps.getAll().forEach(param => {
      if (param.controller?.type === 'fixed' && param.max !== param.min) {
        const norm = (param._value - param.min) / (param.max - param.min);
        param.controller = { ...param.controller, value: norm };
      }
    });
  }

  async saveCurrentState(stateIndex = null) {
    const p = this.current;
    if (!p) return;
    const values      = this.ps.captureState();
    const fxOrder     = this.pipeline ? [...this.pipeline.fxOrder] : null;
    const controllers = this.ps.serializeControllers();
    const mediaRefs   = { ...this._mediaRefs };
    const idx = p.addState(values, stateIndex, fxOrder, controllers, mediaRefs);
    await p.save();
    this.dispatchEvent(new CustomEvent('stateSaved',
      { detail: { presetIndex: this.currentIdx, stateIndex: idx } }));
    return idx;
  }

  async recallState(stateIndex) {
    const p = this.current;
    if (!p) return;
    const ds = p.getState(stateIndex);
    if (!ds) return;
    p.activeState = stateIndex;

    const speed    = this.ps.get('global.morphspeed')?.value ?? 0;
    const useMorph = speed > 0 && ds.values;

    // Remember previous active state index (for morph highlight event)
    const prevStateIdx = p.activeState;

    // Capture current values BEFORE clearing anything (morph 'from' state)
    const fromValues = useMorph ? this.ps.captureState() : null;

    // Cancel any running morph
    this._morphActive    = false;
    this._morphFrom      = null;
    this._morphTo        = null;
    this._morphOnComplete = null;

    // Clear all controller assignments — states are self-contained;
    // leftover LFOs/randoms/exprs from the previous state would keep writing
    // to params and corrupt the restored values on the very next frame.
    this.ctrl.clearAllAssignments();

    // Restore fx chain order
    if (ds.fxOrder && this.pipeline) this.pipeline.setFxOrder(ds.fxOrder);

    // Restore controller assignments so Fixed controllers are wired up.
    // (Fixed controllers write their value once in ctrl.assign.)
    if (ds.controllers && Object.keys(ds.controllers).length) {
      this.ps.deserializeControllers(ds.controllers);
      Object.entries(ds.controllers).forEach(([paramId, cfg]) => {
        if (cfg.controller) this.ctrl.assign(paramId, cfg.controller);
      });
      this.ctrl.rebuildXControllers();
    }

    if (useMorph) {
      // Restore from-values NOW so Fixed-controller assign() writes (above) don't
      // corrupt the morph start position. tickMorph skips Fixed-assigned params,
      // so they'll hold this from-value for the duration and snap at completion.
      this.ps.restoreState(fromValues);

      // Start morph — tickMorph lerps values; restoreState + cleanup happen on completion
      this._morphFrom   = fromValues;
      this._morphTo     = { ...ds.values };
      this._morphT      = 0;
      this._morphActive = true;
      this.ps.set('global.morph', 0);
      this.dispatchEvent(new CustomEvent('morphStarted',
        { detail: { fromIndex: prevStateIdx, toIndex: stateIndex } }));
      this._morphOnComplete = () => {
        this._syncFixedControllers();
        this.ctrl.retriggerLFOs();
        if (ds.mediaRefs) this._checkMediaRefs(ds.mediaRefs);
        this.ps.getAll().forEach(param => this.ctrl.sendParamFeedback(param));
        this.dispatchEvent(new CustomEvent('morphEnded',
          { detail: { stateIndex } }));
      };
    } else {
      // Snap immediately — restore values AFTER controller setup so this always wins.
      this.ps.restoreState(ds.values);

      // Sync Fixed controller configs to the just-restored values so future
      // saves and re-assigns use the correct normalized value.
      this._syncFixedControllers();

      // Retrigger LFOs after values are set (LFOs will animate from here)
      this.ctrl.retriggerLFOs();

      // Check media refs — warn if mismatch
      if (ds.mediaRefs) this._checkMediaRefs(ds.mediaRefs);

      // Send MIDI feedback to motorized faders
      this.ps.getAll().forEach(param => this.ctrl.sendParamFeedback(param));
    }

    const _statusState = document.getElementById('status-state');
    if (_statusState) _statusState.textContent = ds.name || `State ${stateIndex}`;
    this.dispatchEvent(new CustomEvent('stateRecalled',
      { detail: { presetIndex: this.currentIdx, stateIndex, state: ds } }));
  }

  _checkMediaRefs(saved) {
    const current = this._mediaRefs;
    const mismatches = [];
    if (saved.movie   && saved.movie   !== current.movie)   mismatches.push(`Movie: "${saved.movie}"`);
    if (saved.scene3d && saved.scene3d !== current.scene3d) mismatches.push(`3D model: "${saved.scene3d}"`);
    if (mismatches.length) {
      this.dispatchEvent(new CustomEvent('toast',
        { detail: { msg: `⚠ State was saved with: ${mismatches.join(', ')} — please load manually` } }));
    }
  }

  exportState(stateIndex) {
    const state = this.current?.getState(stateIndex);
    if (!state) return null;
    return { __type: 'imstate', version: 1, ...state, exported: Date.now() };
  }

  importState(data, targetSlot = null) {
    const { values, fxOrder, controllers, mediaRefs, name, thumbnail } = data;
    const idx = this.current?.addState(values, targetSlot, fxOrder, controllers, mediaRefs);
    if (idx !== null && name)      this.current.states[idx].name = name;
    if (idx !== null && thumbnail) this.current.states[idx].thumbnail = thumbnail;
    return idx;
  }

  async nextPreset() {
    const next = (this.currentIdx + 1) % this.presets.length;
    await this.activatePreset(next);
  }

  async prevPreset() {
    const prev = (this.currentIdx - 1 + this.presets.length) % this.presets.length;
    await this.activatePreset(prev);
  }

  async saveCurrentPreset(thumbnail = null) {
    const p = this.current;
    if (!p) return;
    p.controllers = this.ps.serializeControllers();
    if (thumbnail) p.thumbnail = thumbnail;
    await p.save();
  }

  async saveCurrentBank() {
    const p = this.current;
    if (!p) return;
    p.controllers = this.ps.serializeControllers();
    await p.save();
  }

  async saveAsBank(newName) {
    const src = this.current;
    if (!src) return;
    const idx = this.presets.length;
    const copy = new Preset(idx);
    copy.name = newName || src.name + ' copy';
    copy.controllers = JSON.parse(JSON.stringify(src.controllers));
    copy.states = src.states.map(s => s ? JSON.parse(JSON.stringify(s)) : null);
    copy.activeState = src.activeState;
    this.presets[idx] = copy;
    await copy.save();
    await this.activatePreset(idx);
    return copy;
  }

  getAll() { return this.presets; }

  async createBank() {
    const idx = this.presets.length;
    const bank = new Preset(idx);
    this.presets[idx] = bank;
    await bank.save();
    await this.activatePreset(idx);
    return idx;
  }

  get currentIndex() { return this.currentIdx; }

  /** Return all preset data for project file export. */
  async exportAll() {
    const all = await Preset.loadAll();
    return all.map(p => p.serialize());
  }

  /** Replace all presets from imported project data. */
  async importAll(presetDataArray) {
    this.presets = [];
    for (const data of presetDataArray) {
      const p = Preset.deserialize(data);
      this.presets[p.index] = p;
      await p.save();
    }
    // Ensure at least slot 0 exists
    if (!this.presets[0]) {
      this.presets[0] = new Preset(0);
      await this.presets[0].save();
    }
    this.dispatchEvent(new CustomEvent('presetActivated', { detail: { index: 0 } }));
  }

  async loadPreset(index) {
    await this.activatePreset(index, { fade: false });
  }
}
