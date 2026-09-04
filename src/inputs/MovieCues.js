/**
 * MovieCues — eight in/out/position cues per movie deck.
 *
 * A cue is the three range params of one deck captured together:
 * MovieStart, MovieEnd and MoviePos. Storing them as a set is the point —
 * recalling an in/out pair without the playhead that belongs to it lands you
 * outside your own loop, and the three are only meaningful together.
 *
 * The mechanism moved to `src/core/CueBank.js` when the Playback Zone wanted
 * the same eight slots; this file is now the movie-deck CONFIGURATION of it.
 * Behaviour, exports and stored JSON shape are unchanged — see CueBank for
 * where the contents live, and why the slot index stays out of Display States.
 */

import { CueBank, CUE_SLOTS } from '../core/CueBank.js';

export { CUE_SLOTS };

/** Deck prefixes that own a cue bank. Mirrors MOVIE_DECK_PARAMS' prefixes. */
export const CUE_DECKS = ['movie', 'movieB'];

/**
 * ORDER IS LOAD-BEARING: start/end before pos. MoviePos is a fraction OF the
 * start→end window (MovieInput maps it as startT + pos/100 * range), so writing
 * pos first resolves it against the OLD range and lands the playhead somewhere
 * the cue never described.
 */
const CUE_KEYS = ['start', 'end', 'pos'];

export class MovieCues extends CueBank {
  /**
   * @param {ParameterSystem} ps
   * @param {Record<string, {forcePosSeek?: () => void}>} decks - prefix → deck.
   *   Needed because writing pos is not enough to MOVE the playhead: the deck
   *   only seeks when Pos CHANGES, and the most likely cue of all is one stored
   *   while Pos sat at its default. Hence the afterRecall hook below — a cue
   *   stored with Pos at 0 writes a value the deck already holds, nothing
   *   fires, and the head stays where free-run playback left it. That is
   *   exactly the "in/out without the playhead that belongs to it" this module
   *   exists to prevent, so the recall forces the seek explicitly.
   */
  constructor(ps, decks = {}, clipHost = null) {
    super(ps, {
      banks: CUE_DECKS,
      keys: CUE_KEYS,
      // The clip the region belongs to. CueBank's own docstring makes the case:
      // "a region recalled without its partition points at a different piece of
      // tape entirely." A movie cue had exactly that hole — start/end/pos with
      // no record of WHICH clip they measure — so recalling one after loading a
      // different movie landed you in a window that meant nothing.
      extraKeys: ['clip'],
      afterRecall: (prefix) => decks?.[prefix]?.forcePosSeek?.(),
    });
    this.decks = decks;
    /**
     * Injected rather than imported: resolving a clip id means reaching the
     * movie library and the deck rack, and main.js is the integration hub that
     * already owns both. Keeping it out of here preserves the property that
     * this module knows only about parameters and its own bank.
     *
     * @type {{ currentId(prefix): string|null,
     *          select(prefix, id): Promise<boolean> } | null}
     */
    this.clipHost = clipHost;
  }

  /** Capture the region AND which clip it belongs to. */
  store(prefix, i) {
    if (!super.store(prefix, i)) return false;
    const id = this.clipHost?.currentId?.(prefix);
    if (id) this.get(prefix, i).clip = id;
    this.onChange?.();
    return true;
  }

  /**
   * Recall the region, switching the deck to the cue's clip first.
   *
   * Synchronous whenever it can be — a legacy cue with no clip, or one whose
   * clip is already up — because the async path leaves one frame in which the
   * NEW region is being applied to the OLD clip. Only a genuine clip change
   * pays for the await.
   */
  recall(prefix, i) {
    const cue = this.get(prefix, i);
    if (!cue) return false;
    const want = cue.clip;
    if (!want || !this.clipHost || this.clipHost.currentId?.(prefix) === want) {
      return super.recall(prefix, i);
    }
    this.clipHost.select(prefix, want)
      .then((ok) => {
        // Apply the region even if the clip could not be found: the cue's
        // numbers are still the best guess, and silently doing nothing reads
        // as a dead pad. The warning says which clip went missing.
        if (!ok) console.warn(`[MovieCues] clip "${want}" not found; recalling region only`);
        super.recall(prefix, i);
      })
      .catch((e) => {
        console.warn('[MovieCues] clip switch failed:', e?.message ?? e);
        super.recall(prefix, i);
      });
    return true;
  }
}
