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

const FORMAT_VERSION = 3;

export class ProjectFile {
  /**
   * @param {object} ps           ParameterSystem
   * @param {object} presetMgr    PresetManager
   * @param {object} tableManager TableManager (optional)
   * @param {object} extras       Extra save/restore hooks: { warpEditor, drawLayer, stillsBuffer, scene3d }
   */
  constructor(ps, presetMgr, tableManager, extras = {}) {
    this.ps      = ps;
    this.presets = presetMgr;
    this.tables  = tableManager;
    this.extras  = extras; // { warpEditor, drawLayer, stillsBuffer, scene3d, seqBuffers }
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

    // Warp map editor state
    let warpMap  = null;
    let warpSlots = null;
    if (this.extras.warpEditor) {
      const ed = this.extras.warpEditor;
      warpMap   = { dx: Array.from(ed.dx), dy: Array.from(ed.dy) };
      try { warpSlots = JSON.parse(localStorage.getItem('imweb-warpmaps') ?? '{}'); } catch { warpSlots = {}; }
    }

    // DrawLayer content (512x512)
    let drawData = null;
    if (this.extras.drawLayer) {
      drawData = this.extras.drawLayer.canvas.toDataURL('image/png');
    }

    // StillsBuffer metadata (thumbnails + protection)
    // We don't save full-res frames to JSON as it would be too large (>100MB)
    let stillsMetadata = null;
    if (this.extras.stillsBuffer) {
      const sb = this.extras.stillsBuffer;
      stillsMetadata = {
        frameCount: sb.frameCount,
        protected:  Array.from(sb._protected),
        thumbs:     sb.thumbnailCanvases.map(c => c.toDataURL('image/jpeg', 0.6)),
        hasFrame:   [...sb._hasFrame],
      };
    }

    // 3D scene metadata
    let scene3dMetadata = null;
    if (this.extras.scene3d) {
      scene3dMetadata = {
        modelName: this.extras.scene3d.importedModelName,
      };
    }

    // Timewarp strip persistence — save each seq in timewarp mode to IndexedDB
    if (this.extras.seqBuffers) {
      await Promise.all(
        this.extras.seqBuffers
          .filter(seq => seq.mode === 'timewarp')
          .map(seq => seq.saveStrip().catch(err => console.warn('[ProjectFile] strip save failed:', err)))
      );
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
      drawData,
      stills:       stillsMetadata,
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

    // Timewarp strip restore — runs after params so setMode() has already been called
    if (this.extras.seqBuffers) {
      await Promise.all(
        this.extras.seqBuffers
          .filter(seq => seq.mode === 'timewarp')
          .map(seq => seq.restoreStrip().catch(err => console.warn('[ProjectFile] strip restore failed:', err)))
      );
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

    // Restore DrawLayer
    const drawPromise = (data.drawData && this.extras.drawLayer) ? new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        const ctx = this.extras.drawLayer.ctx;
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
        ctx.drawImage(img, 0, 0);
        this.extras.drawLayer.texture.needsUpdate = true;
        resolve();
      };
      img.onerror = () => resolve(); // continue anyway
      img.src = data.drawData;
    }) : Promise.resolve();

    // Restore StillsBuffer metadata
    const stillsPromises = [];
    if (data.stills && this.extras.stillsBuffer) {
      const sb = this.extras.stillsBuffer;
      if (data.stills.frameCount) sb.setFrameCount(data.stills.frameCount);
      if (data.stills.protected) {
        sb._protected.clear();
        data.stills.protected.forEach(idx => sb._protected.add(idx));
      }
      // Restore thumbnails (async)
      if (data.stills.thumbs) {
        data.stills.thumbs.forEach((url, i) => {
          if (!url || i >= sb.frameCount) return;
          stillsPromises.push(new Promise(resolve => {
            const img = new Image();
            img.onload = () => {
              const ctx = sb.thumbnailCanvases[i].getContext('2d');
              ctx.drawImage(img, 0, 0);
              resolve();
            };
            img.onerror = () => resolve();
            img.src = url;
          }));
        });
      }
      if (data.stills.hasFrame) {
        sb._hasFrame = [...data.stills.hasFrame];
      }
    }

    await Promise.all([drawPromise, ...stillsPromises]);

    // 3D Model reminder
    if (data.scene3d?.modelName) {
      console.info(`[Project] Session uses 3D model: ${data.scene3d.modelName}. Please re-import if not already loaded.`);
    }

    return data._name ?? data.name ?? 'project';
  }
}
