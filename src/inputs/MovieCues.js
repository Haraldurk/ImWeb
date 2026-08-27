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
  constructor(ps, decks = {}) {
    super(ps, {
      banks: CUE_DECKS,
      keys: CUE_KEYS,
      afterRecall: (prefix) => decks?.[prefix]?.forcePosSeek?.(),
    });
    this.decks = decks;
  }
}
