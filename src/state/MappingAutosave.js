/**
 * MappingAutosave — learned controller mappings survive a reload.
 *
 * The complaint this answers: you learn a MIDI control, reload, and it is gone.
 * Mappings were only ever persisted by an explicit save — `serializeControllers`
 * is called from Preset.js and the project file, and nothing else — so a
 * mapping lived in memory until you remembered to save something.
 *
 * ── MAPPINGS ONLY, NEVER VALUES ─────────────────────────────────────────────
 *
 * This is the whole reason the module exists rather than a two-line
 * `localStorage.setItem(serializeControllers())`.
 *
 * `Parameter.serialize()` includes `value`, and `deserialize` applies it. So a
 * naive autosave of "the controllers" is really an autosave of the CURRENT
 * VALUE of every mapped parameter, and restoring it boots the instrument into a
 * partial version of however you left it — Run Rec still on, a swept Level
 * still at 0.2, a mapped source still pointing somewhere you have forgotten
 * about. A mapping is a fact about your hardware and is safe to restore
 * silently. A value is a fact about a performance and is not.
 *
 * `value` is therefore stripped on the way OUT (via `ps.serializeMappings()`)
 * and again on the way IN, because the stored blob is user-visible in
 * localStorage and an older or hand-edited one may still carry values.
 *
 * ── PRECEDENCE ──────────────────────────────────────────────────────────────
 *
 * Controllers are already written at boot by whatever bank or project is
 * restored, so there are two writers and order decides. The rule:
 *
 *   restore() runs AFTER the boot bank/project restore.
 *
 * The autosave is the more recent truth — it is what the rig looked like when
 * you last had the app open, whereas the bank carries whatever mappings existed
 * when it was last SAVED. Anything the user explicitly imports afterwards wins
 * outright, and is then picked up as the new autosave within a second.
 *
 * ── ORIGIN ──────────────────────────────────────────────────────────────────
 *
 * localStorage is per-origin, so mappings learned on :5173 are invisible on
 * :4173 and on a bumped port. That is the standing trap in CLAUDE.md, and it is
 * why restore() reports the origin it read from: "my MIDI is gone" has meant
 * "different port" more often than anything else in this project.
 *
 * ── SETUP ACTS ──────────────────────────────────────────────────────────────
 *
 * Nothing extra is needed. `Parameter.deserialize` returns early on
 * `param.setup`, so no persisted blob can attach a controller to Monitoring —
 * that guard was written for exactly this class of writer.
 */

/** How often to look for a change. Learning is rare; a second is invisible. */
const TICK_MS = 1000;

export class MappingAutosave {
  /**
   * @param {ParameterSystem} ps
   * @param {object} [opts]
   * @param {string} [opts.key] - localStorage key.
   * @param {(msg: string) => void} [opts.onStatus] - told what was restored.
   */
  constructor(ps, { key = 'imweb.mappings', onStatus = null } = {}) {
    this.ps = ps;
    this.key = key;
    this.onStatus = onStatus;
    /** The last blob written, so a tick that changed nothing costs one compare. */
    this._last = null;
    this._timer = null;
    this._onHide = () => this.flush();
  }

  /** The current mappings as JSON, or '' if the store is unreadable. */
  _snapshot() {
    try {
      return JSON.stringify(this.ps.serializeMappings());
    } catch {
      return '';
    }
  }

  /**
   * Load the saved mappings. Call AFTER the boot bank/project restore — see
   * PRECEDENCE above. Returns how many parameters were touched.
   */
  restore() {
    let raw = null;
    // Private mode, disabled site data, a browser that throws on access — all
    // report as "no mappings" rather than breaking boot.
    try { raw = localStorage.getItem(this.key); } catch { return 0; }
    if (!raw) { this._last = this._snapshot(); return 0; }

    let data;
    try { data = JSON.parse(raw); } catch { return 0; }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return 0;

    // Strip values defensively. The file on disk is user-visible and may have
    // been written by an older build or edited by hand; a `value` reaching
    // deserialize() is the one failure this module is designed around.
    for (const rec of Object.values(data)) {
      if (rec && typeof rec === 'object') delete rec.value;
    }

    this.ps.deserializeControllers(data);
    this._last = this._snapshot();

    const n = Object.keys(data).length;
    if (n && this.onStatus) {
      // Name the origin. Mappings are per-origin, and "they vanished" has meant
      // "different port" more often than it has meant anything else.
      this.onStatus(`${n} mapping${n === 1 ? '' : 's'} restored from ${location.origin}`);
    }
    return n;
  }

  /** Begin watching. Idempotent. */
  start() {
    if (this._timer) return;
    if (this._last === null) this._last = this._snapshot();
    this._timer = setInterval(() => this.flush(), TICK_MS);
    // A tab closed or backgrounded between ticks would otherwise lose the last
    // edit. `pagehide` fires where `beforeunload` is unreliable (iOS Safari).
    addEventListener('pagehide', this._onHide);
    addEventListener('visibilitychange', this._onHide);
  }

  stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    removeEventListener('pagehide', this._onHide);
    removeEventListener('visibilitychange', this._onHide);
  }

  /**
   * Write if anything changed.
   *
   * A DIFF rather than a hook on every writer. There is no choke point — the
   * setup-act guard needed three separate call sites for the same reason — and
   * a writer added later would silently stop being autosaved. Comparing the
   * serialized form cannot miss one, and it is cheap because
   * `serializeMappings()` only includes parameters that actually carry mapping
   * state, which is a handful even on a fully mapped rig.
   */
  flush() {
    const json = this._snapshot();
    if (!json || json === this._last) return false;
    try {
      localStorage.setItem(this.key, json);
      this._last = json;
      return true;
    } catch {
      // Quota or a blocked store. Keep running: the next edit tries again, and
      // failing to persist must never break the instrument.
      return false;
    }
  }

  /** Forget the saved mappings. Live mappings are untouched. */
  clear() {
    try { localStorage.removeItem(this.key); } catch { /* nothing to do */ }
    this._last = null;
  }

  /** True if anything is stored for this origin. */
  get hasSaved() {
    try { return !!localStorage.getItem(this.key); } catch { return false; }
  }
}
