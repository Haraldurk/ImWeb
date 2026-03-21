/**
 * ImWeb Project File (.imweb)
 *
 * Exports and imports the complete application state as a JSON file.
 * Format version: 1
 *
 * Saved:
 *   - All preset data (parameter values + controller assignments)
 *   - All display states (128 snapshots per preset)
 *   - All user response curves (Tables)
 *   - Active preset index
 *   - App metadata (version, date, name)
 *
 * NOT saved (session-only):
 *   - Video/camera streams
 *   - Movie clip files (blob URLs are not portable)
 *   - DrawLayer canvas content
 *   - 3D imported models
 */

const FORMAT_VERSION = 2;

export class ProjectFile {
  /**
   * @param {object} ps           ParameterSystem
   * @param {object} presetMgr    PresetManager
   * @param {object} tableManager TableManager (optional)
   * @param {object} extras       Extra save/restore hooks: { warpEditor }
   */
  constructor(ps, presetMgr, tableManager, extras = {}) {
    this.ps      = ps;
    this.presets = presetMgr;
    this.tables  = tableManager;
    this.extras  = extras; // { warpEditor }
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async export(name = 'project') {
    const data = await this._collect(name);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${name.replace(/[^a-z0-9_\-\s]/gi, '_')}.imweb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async _collect(name) {
    const presets = await this.presets.exportAll();

    // User tables (non-builtins)
    const tables = {};
    if (this.tables) {
      this.tables.getNames().forEach(tName => {
        if (!this.tables.isBuiltin(tName)) {
          tables[tName] = Array.from(this.tables.get(tName).points);
        }
      });
    }

    // Warp map editor state (if provided)
    let warpMap  = null;
    let warpSlots = null;
    if (this.extras.warpEditor) {
      const ed = this.extras.warpEditor;
      warpMap   = { dx: Array.from(ed.dx), dy: Array.from(ed.dy) };
      try { warpSlots = JSON.parse(localStorage.getItem('imweb-warpmaps') ?? '{}'); } catch { warpSlots = {}; }
    }

    // 3D scene metadata
    let scene3dMetadata = null;
    if (this.extras.scene3d) {
      scene3dMetadata = {
        modelName: this.extras.scene3d.importedModelName,
      };
    }

    return {
      _type:        'imweb-project',
      _version:     FORMAT_VERSION,
      _name:        name,
      _date:        new Date().toISOString(),
      activePreset: this.presets.currentIndex,
      params:       this.ps.captureState(),
      presets,
      tables,
      warpMap,
      warpSlots,
      scene3d:      scene3dMetadata,
    };
  }

  // ── Import ────────────────────────────────────────────────────────────────

  async import(file) {
    const text = await file.text();
    const data = JSON.parse(text);
    await this._apply(data);
    return data._name ?? data.name ?? 'project';
  }

  async _apply(data) {
    // Accept both v1/v2 (_type) and the inline format (format:'imweb')
    const isLegacy = data._type === 'imweb-project';
    const isInline = data.format === 'imweb';
    if (!isLegacy && !isInline) throw new Error('Not a valid .imweb project file');

    if (isLegacy && data._version > FORMAT_VERSION) {
      console.warn(`[ProjectFile] Version ${data._version} > ${FORMAT_VERSION} — loading anyway`);
    }

    // Import tables
    if (data.tables && this.tables) {
      Object.entries(data.tables).forEach(([tName, points]) => {
        this.tables.set(tName, points);
      });
    }

    // Import presets
    if (data.presets) {
      await this.presets.importAll(data.presets);
    }

    // Restore active preset
    const presetIdx = data.activePreset ?? data.currentPreset ?? 0;
    if (typeof presetIdx === 'number') {
      await this.presets.loadPreset(presetIdx);
    }

    // Restore live params (overlay on top of preset)
    if (data.params) {
      this.ps.restoreState(data.params);
    }

    // Restore warp map
    if (this.extras.warpEditor && data.warpMap?.dx && data.warpMap?.dy) {
      const ed = this.extras.warpEditor;
      ed.dx = new Float32Array(data.warpMap.dx);
      ed.dy = new Float32Array(data.warpMap.dy);
      ed._rebuild();
    }
    if (data.warpSlots) {
      localStorage.setItem('imweb-warpmaps', JSON.stringify(data.warpSlots));
    }

    // 3D Model reminder
    if (data.scene3d?.modelName) {
      console.info(`[Project] Session uses 3D model: ${data.scene3d.modelName}. Please re-import if not already loaded.`);
    }

    return data._name ?? data.name ?? 'project';
  }
}
