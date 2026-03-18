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

const FORMAT_VERSION = 1;

export class ProjectFile {
  constructor(ps, presetMgr, tableManager) {
    this.ps      = ps;
    this.presets = presetMgr;
    this.tables  = tableManager;
  }

  // ── Export ────────────────────────────────────────────────────────────────

  async export(name = 'project') {
    const data = await this._collect(name);
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = `${name.replace(/\s+/g, '-')}.imweb`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async _collect(name) {
    // Gather all presets from IndexedDB via PresetManager
    const presets = await this.presets.exportAll();

    // Gather user tables (non-builtins)
    const tables = {};
    if (this.tables) {
      this.tables.getNames().forEach(tName => {
        if (!this.tables.isBuiltin(tName)) {
          tables[tName] = Array.from(this.tables.get(tName).points);
        }
      });
    }

    return {
      _type:    'imweb-project',
      _version: FORMAT_VERSION,
      _name:    name,
      _date:    new Date().toISOString(),
      activePreset: this.presets.currentIndex,
      presets,
      tables,
    };
  }

  // ── Import ────────────────────────────────────────────────────────────────

  import(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async e => {
        try {
          const data = JSON.parse(e.target.result);
          await this._apply(data);
          resolve(data._name ?? 'project');
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file);
    });
  }

  async _apply(data) {
    if (data._type !== 'imweb-project') throw new Error('Not an ImWeb project file');
    if (data._version > FORMAT_VERSION) {
      console.warn(`[ProjectFile] Version ${data._version} > ${FORMAT_VERSION} — loading anyway`);
    }

    // Import tables first (presets may reference them)
    if (data.tables && this.tables) {
      Object.entries(data.tables).forEach(([name, points]) => {
        this.tables.set(name, points);
      });
    }

    // Import presets
    if (data.presets) {
      await this.presets.importAll(data.presets);
    }

    // Restore active preset
    if (typeof data.activePreset === 'number') {
      await this.presets.loadPreset(data.activePreset);
    }
  }
}
