/**
 * MovieLibrary — the catalogue of clips available to the instrument.
 *
 * Holds DESCRIPTORS, not players. Two decks playing the same file need
 * independent <video> elements (independent playhead, speed, start/end), so the
 * catalogue can never be a pool of live clips both decks point at. Each deck
 * instantiates its own video from an entry via MovieInput.addClip(), which
 * already accepts either a File or a URL string.
 *
 * Entry shape:
 *   { id, name, origin, src, duration, thumbnail, slotIndex }
 *
 * ids are origin-prefixed and end in the filename — 'preload:Dive.mp4',
 * 'import:foo.mp4', 'rec:12'. That makes them stable across sessions, readable
 * in a saved .imweb, and gives filename-fallback matching for free (see
 * findByFilename, for resolving legacy mediaRefs.movie).
 *
 * Deliberately NOT here yet (blueprint steps 3+): persistence, the panel UI,
 * rack references in .imweb, and recorder entries. This is the store only.
 */

class MovieLibrary {
  constructor() {
    /** @type {Array<object>} insertion-ordered catalogue */
    this.entries = [];
  }

  get size() {
    return this.entries.length;
  }

  /**
   * Register a clip descriptor. Idempotent by id: re-adding the same source
   * returns the existing entry rather than duplicating it, so a re-read of the
   * manifest cannot grow the catalogue.
   */
  add({
    origin = "import",
    name,
    src = null,
    duration = null,
    thumbnail = null,
    slotIndex = null,
  }) {
    const id = `${origin}:${origin === "record" ? slotIndex : name}`;
    const existing = this.get(id);
    if (existing) return existing;
    const entry = { id, name, origin, src, duration, thumbnail, slotIndex };
    this.entries.push(entry);
    return entry;
  }

  get(id) {
    return this.entries.find((e) => e.id === id) ?? null;
  }

  /**
   * Resolve by bare filename. Legacy states store mediaRefs.movie as a plain
   * filename, and ids end in that filename, so this is the migration path.
   */
  findByFilename(filename) {
    if (!filename) return null;
    return this.entries.find((e) => e.name === filename) ?? null;
  }

  remove(id) {
    const i = this.entries.findIndex((e) => e.id === id);
    if (i < 0) return false;
    this.entries.splice(i, 1);
    return true;
  }

  clear() {
    this.entries = [];
  }
}

export default new MovieLibrary();
