/**
 * CueBank — N slots per bank, each holding a fixed set of parameter values
 * captured and recalled together.
 *
 * Extracted from MovieCues when the Playback Zone wanted the same eight slots.
 * The alternative was a second 138-line copy, and this repo has already paid
 * for that pattern once: CLAUDE.md's note about seven near-duplicate
 * consumption checks is the same failure one level down. MovieCues is now a
 * configuration of this rather than a rewrite of it — its constructor
 * signature, its exports and its stored JSON shape are all unchanged.
 *
 * WHAT A BANK IS FOR: a set of params that is only meaningful together.
 * MovieCues says it best — recalling an in/out pair without the playhead that
 * belongs to it lands you outside your own loop. The zone bank has the same
 * shape for a different reason: Start and Length are fractions OF a partition,
 * so a region recalled without its partition points at a different piece of
 * tape entirely.
 *
 * WHERE CONTENTS LIVE: the .imweb project file, not localStorage. That is the
 * deliberate difference from the warp-map slots, whose contents are per-origin
 * and therefore mean different things on 5173 and 4173. Cues travel with the
 * project, so slot 3 is the same slot wherever the project is opened.
 *
 * WHY THE SLOT INDEX IS UNCAPTURED by Display States: a state already captures
 * the underlying params directly. If it also captured the slot index, recalling
 * a state would restore those values and then fire the slot's onChange, which
 * overwrites them with the cue's — two writers for one set of values, and which
 * wins depends on restore order. Leaving the index out makes the captured
 * values the only writer. Every bank's slot param is therefore group 'global'.
 */

export const CUE_SLOTS = 8;

export class CueBank {
  /**
   * @param {ParameterSystem} ps
   * @param {object} cfg
   * @param {string[]} cfg.banks   - param prefixes, one bank each ('movie', 'aplay').
   * @param {string[]} cfg.keys    - param keys captured together, in RECALL order.
   * @param {(prefix: string) => void} [cfg.afterRecall] - run once after a
   *   recall has written every key. For a movie deck this forces the seek that
   *   writing Pos alone does not perform; a bank whose params take effect on
   *   write needs nothing here.
   */
  constructor(ps, { banks, keys, afterRecall = null }) {
    this.ps = ps;
    this.banks = banks;
    this.keys = keys;
    this.afterRecall = afterRecall;
    /** @type {Record<string, Array<Record<string, number>|null>>} */
    this.slots = {};
    for (const b of banks) this.slots[b] = new Array(CUE_SLOTS).fill(null);
    /** Fired after any mutation so the UI can repaint. */
    this.onChange = null;
  }

  _bank(prefix) {
    return this.slots[prefix] ?? null;
  }

  /** True if the slot holds a cue. */
  has(prefix, i) {
    return !!this._bank(prefix)?.[i];
  }

  get(prefix, i) {
    return this._bank(prefix)?.[i] ?? null;
  }

  /** Capture the bank's current values into slot i. */
  store(prefix, i) {
    const bank = this._bank(prefix);
    if (!bank || i < 0 || i >= CUE_SLOTS) return false;
    const cue = {};
    for (const k of this.keys) {
      const p = this.ps.get(`${prefix}.${k}`);
      if (!p) return false;
      cue[k] = p.value;
    }
    bank[i] = cue;
    this.onChange?.();
    return true;
  }

  /**
   * Apply slot i. Writes through ps.set so onChange listeners, the OSD and the
   * param rows all see it exactly as a manual edit.
   *
   * KEY ORDER IS LOAD-BEARING and belongs to the caller: a movie deck must
   * write start/end before pos, because Pos is a fraction of the start→end
   * window and writing it first resolves it against the OLD range. The zone
   * bank must write `part` before start/len for the same reason one level
   * over — those two are fractions of the partition.
   */
  recall(prefix, i) {
    const cue = this.get(prefix, i);
    if (!cue) return false;
    for (const k of this.keys) this.ps.set(`${prefix}.${k}`, cue[k]);
    this.afterRecall?.(prefix);
    return true;
  }

  /** Empty slot i. */
  clear(prefix, i) {
    const bank = this._bank(prefix);
    if (!bank || !bank[i]) return false;
    bank[i] = null;
    this.onChange?.();
    return true;
  }

  /** Plain JSON for ProjectFile. */
  serialize() {
    const out = {};
    for (const b of this.banks) out[b] = this.slots[b].map(c => (c ? { ...c } : null));
    return out;
  }

  /**
   * Restore from a project file. Unknown banks are ignored and a short bank is
   * padded, so a file written before a bank was added still loads.
   */
  restore(data) {
    if (!data || typeof data !== 'object') return;
    for (const b of this.banks) {
      const src = Array.isArray(data[b]) ? data[b] : [];
      this.slots[b] = new Array(CUE_SLOTS).fill(null).map((_, i) => {
        const c = src[i];
        if (!c || typeof c !== 'object') return null;
        const cue = {};
        for (const k of this.keys) {
          const n = Number(c[k]);
          if (!Number.isFinite(n)) return null;
          cue[k] = n;
        }
        return cue;
      });
    }
    this.onChange?.();
  }
}
