/**
 * MovieCues — eight in/out/position cues per movie deck.
 *
 * A cue is the three range params of one deck captured together:
 * MovieStart, MovieEnd and MoviePos. Storing them as a set is the point —
 * recalling an in/out pair without the playhead that belongs to it lands you
 * outside your own loop, and the three are only meaningful together.
 *
 * WHERE THE CONTENTS LIVE: in the .imweb project file, not localStorage.
 * That is the deliberate difference from the warp-map slots, whose contents
 * are per-origin and therefore mean different things on 5173 and 4173. Cues
 * travel with the project, so slot 3 is the same slot wherever the project is
 * opened.
 *
 * WHY THE SLOT INDEX IS STILL UNCAPTURED: `${P}.cueSlot` is group 'global',
 * so Display States do not capture it — even though, unlike warpSlot, the
 * contents WOULD travel. The reason here is different: a Display State
 * already captures movie.start / .end / .pos directly (group 'movie'). If it
 * also captured cueSlot, recalling a state would restore those three values
 * and then fire the cueSlot onChange, which overwrites them with the cue's.
 * Two writers for one set of values, and which wins depends on restore order.
 * Leaving the index out means the captured values are the only writer.
 */

export const CUE_SLOTS = 8;

/** Deck prefixes that own a cue bank. Mirrors MOVIE_DECK_PARAMS' prefixes. */
export const CUE_DECKS = ['movie', 'movieB'];

const CUE_KEYS = ['start', 'end', 'pos'];

export class MovieCues {
  /**
   * @param {ParameterSystem} ps
   * @param {Record<string, {forcePosSeek?: () => void}>} decks - prefix → deck.
   *   Needed because writing pos is not enough to MOVE the playhead: the deck
   *   only seeks when Pos CHANGES, and the most likely cue of all is one stored
   *   while Pos sat at its default. See recall().
   */
  constructor(ps, decks = {}) {
    this.ps = ps;
    this.decks = decks;
    /** @type {Record<string, Array<{start:number,end:number,pos:number}|null>>} */
    this.slots = {};
    for (const d of CUE_DECKS) this.slots[d] = new Array(CUE_SLOTS).fill(null);
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

  /** Capture the deck's current range into slot i. */
  store(prefix, i) {
    const bank = this._bank(prefix);
    if (!bank || i < 0 || i >= CUE_SLOTS) return false;
    const cue = {};
    for (const k of CUE_KEYS) {
      const p = this.ps.get(`${prefix}.${k}`);
      if (!p) return false;
      cue[k] = p.value;
    }
    bank[i] = cue;
    this.onChange?.();
    return true;
  }

  /**
   * Apply slot i to the deck. Writes through ps.set so onChange listeners,
   * the OSD and the param rows all see it exactly as a manual edit.
   */
  recall(prefix, i) {
    const cue = this.get(prefix, i);
    if (!cue) return false;
    // start/end before pos: MoviePos is a fraction OF the start→end window
    // (MovieInput maps it as startT + pos/100 * range), so writing pos first
    // resolves it against the OLD range and lands the playhead somewhere the
    // cue never described.
    for (const k of CUE_KEYS) this.ps.set(`${prefix}.${k}`, cue[k]);
    // Writing pos is not the same as moving the head. The manual seek is gated
    // on `pos !== _lastPos`, so a cue stored with Pos at 0 — the default, and
    // therefore the common case — writes a value the deck already holds,
    // nothing fires, and the head stays where free-run playback left it. That
    // is exactly the "in/out without the playhead that belongs to it" this
    // module exists to prevent, so the recall forces the seek explicitly.
    this.decks?.[prefix]?.forcePosSeek?.();
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
    for (const d of CUE_DECKS) out[d] = this.slots[d].map(c => (c ? { ...c } : null));
    return out;
  }

  /**
   * Restore from a project file. Unknown decks are ignored and a short bank is
   * padded, so a file written before a deck was added still loads.
   */
  restore(data) {
    if (!data || typeof data !== 'object') return;
    for (const d of CUE_DECKS) {
      const src = Array.isArray(data[d]) ? data[d] : [];
      this.slots[d] = new Array(CUE_SLOTS).fill(null).map((_, i) => {
        const c = src[i];
        if (!c || typeof c !== 'object') return null;
        const cue = {};
        for (const k of CUE_KEYS) {
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
