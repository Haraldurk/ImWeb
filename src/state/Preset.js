/**
 * ImWeb State Management
 * Presets and Display States, stored in IndexedDB.
 */

// ── IndexedDB storage ─────────────────────────────────────────────────────────

const DB_NAME    = 'imweb';
const DB_VERSION = 1;

export function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('presets')) {
        db.createObjectStore('presets', { keyPath: 'index' });
      }
      if (!db.objectStoreNames.contains('tables')) {
        db.createObjectStore('tables', { keyPath: 'name' });
      }
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'hash' });
      }
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
    this.name         = `Preset ${index}`;
    this.controllers  = {};     // paramId → controller config
    this.states       = [];     // Array of DisplayState snapshots (max 128)
    this.activeState  = 0;
    this.movieRef     = null;
    this.textRef      = null;
    this.scene3dRef   = null;
    this.bufferRef    = null;
    this.created      = Date.now();
    this.modified     = Date.now();
  }

  addState(values, index = null) {
    const ds = { values: { ...values }, created: Date.now() };
    if (index !== null && index >= 0 && index < 128) {
      this.states[index] = ds;
      return index;
    }
    // Find next empty slot
    for (let i = 0; i < 128; i++) {
      if (!this.states[i]) { this.states[i] = ds; return i; }
    }
    return null; // Full
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
      movieRef:    this.movieRef,
      textRef:     this.textRef,
      scene3dRef:  this.scene3dRef,
      bufferRef:   this.bufferRef,
      created:     this.created,
      modified:    this.modified,
    };
  }

  static deserialize(data) {
    const p = new Preset(data.index);
    Object.assign(p, data);
    return p;
  }

  async save() {
    this.modified = Date.now();
    await dbPut('presets', this.serialize());
  }

  static async load(index) {
    const data = await dbGet('presets', index);
    return data ? Preset.deserialize(data) : null;
  }

  static async loadAll() {
    const all = await dbGetAll('presets');
    return all.map(d => Preset.deserialize(d));
  }
}

// ── PresetManager ─────────────────────────────────────────────────────────────

export class PresetManager extends EventTarget {
  constructor(ps, controllers) {
    super();
    this.ps          = ps;
    this.ctrl        = controllers;
    this.presets     = [];
    this.currentIdx  = 0;
    this._fadePresets = true;
    this._fadeTimeoutId = null;

    // Morph animation state
    this._morphFrom   = null; // { paramId: value } snapshot of source state
    this._morphTo     = null; // { paramId: value } snapshot of target state
    this._morphT      = 0;   // 0→1 progress
    this._morphActive = false;
  }

  async init() {
    const saved = await Preset.loadAll();
    if (saved.length === 0) {
      // Create default preset 0
      const p = new Preset(0);
      p.name = 'Default';
      this.presets[0] = p;
      await p.save();
    } else {
      saved.forEach(p => { this.presets[p.index] = p; });
    }
    // Ensure at least 8 preset slots exist
    for (let i = 0; i < 8; i++) {
      if (!this.presets[i]) this.presets[i] = new Preset(i);
    }
    await this.activatePreset(0, { fade: false });
  }

  get current() { return this.presets[this.currentIdx]; }

  async activatePreset(index, { fade = true } = {}) {
    const p = this.presets[index];
    if (!p) return;

    this.currentIdx = index;

    // Restore controller assignments
    if (p.controllers) {
      this.ps.deserializeControllers(p.controllers);
      Object.entries(p.controllers).forEach(([paramId, config]) => {
        if (config.controller) this.ctrl.assign(paramId, config.controller);
      });
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

    // Update UI
    document.getElementById('status-preset').textContent = p.name;
    document.getElementById('preset-label').textContent  = p.name;

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
    this._morphT = Math.min(1, this._morphT + dt / speed);
    // Smooth step
    const t = this._morphT * this._morphT * (3 - 2 * this._morphT);
    this.ps.set('global.morph', Math.round(t * 100));

    // Lerp all continuous params between from and to
    const SKIP_TYPES = new Set(['toggle', 'trigger', 'select']);
    this.ps.getAll().forEach(p => {
      if (SKIP_TYPES.has(p.type)) return;
      if (p.controller) return; // don't override active controllers
      const from = this._morphFrom?.[p.id] ?? p.value;
      const to   = this._morphTo?.[p.id]   ?? p.value;
      if (from === to) return;
      p.value = from + (to - from) * t;
    });

    if (this._morphT >= 1) {
      // Snap to final state and clean up
      if (this._morphTo) this.ps.restoreState(this._morphTo);
      this.ctrl.retriggerLFOs();
      this._morphActive = false;
      this._morphFrom   = null;
      this._morphTo     = null;
    }
  }

  async saveCurrentState(stateIndex = null) {
    const p = this.current;
    if (!p) return;

    const values = this.ps.captureState();
    const idx = p.addState(values, stateIndex);
    await p.save();

    this.dispatchEvent(new CustomEvent('stateSaved', { detail: { presetIndex: this.currentIdx, stateIndex: idx } }));
    return idx;
  }

  async recallState(stateIndex) {
    const p = this.current;
    if (!p) return;

    const ds = p.getState(stateIndex);
    if (!ds) return;

    p.activeState = stateIndex;
    this.ps.restoreState(ds.values);
    this.ctrl.retriggerLFOs();

    document.getElementById('status-state').textContent = `State ${stateIndex}`;

    this.dispatchEvent(new CustomEvent('stateRecalled', {
      detail: { presetIndex: this.currentIdx, stateIndex, state: ds }
    }));
  }

  async nextPreset() {
    const next = (this.currentIdx + 1) % this.presets.length;
    await this.activatePreset(next);
  }

  async prevPreset() {
    const prev = (this.currentIdx - 1 + this.presets.length) % this.presets.length;
    await this.activatePreset(prev);
  }

  async saveCurrentPreset() {
    const p = this.current;
    if (!p) return;
    p.controllers = this.ps.serializeControllers();
    await p.save();
  }

  getAll() { return this.presets; }

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
