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

/**
 * How many entries may be scanning at once. Scanning downloads a header plus
 * one frame's range, so it is far cheaper than racking a clip — but it is not
 * free, and firing 100 at once would recreate the buffer exhaustion the rack
 * already suffers from.
 */
const SCAN_CONCURRENCY = 1;

/**
 * Tight because the media is faststart: with the moov atom at the FRONT of the
 * file, loadedmetadata fires after a few KB regardless of how large the clip is,
 * so anything still pending after 3s is genuinely broken rather than merely big.
 * Raise this again if a project ever carries clips prepped without
 * `-movflags +faststart` — those cannot report duration until the browser has
 * read to the END of the file, which on a 200 MB+ All-Intra clip takes seconds.
 */
const SCAN_TIMEOUT_MS = 3000;

class MovieLibrary {
  constructor() {
    /** @type {Array<object>} insertion-ordered catalogue */
    this.entries = [];
    /** @type {Map<string, Promise>} in-flight scans, keyed by entry id */
    this._scanning = new Map();
    this._active = 0;
    this._queue = [];
  }

  /**
   * Fill in duration and thumbnail for one entry, lazily.
   *
   * This is what lets the catalogue hold a hundred clips: registering an entry
   * costs a string, and the expensive part — reading the container header and
   * decoding one frame — happens only when something actually needs it (a row
   * scrolling into view). preload='metadata' fetches the header rather than the
   * whole file, and the element is released the moment we have what we need, so
   * a scan never holds a decoder the way a racked clip does.
   *
   * Idempotent and de-duplicated: concurrent calls for the same entry share one
   * promise, and an already-scanned entry resolves immediately.
   */
  async scan(entry) {
    if (!entry || !entry.src) return entry;
    if (entry.duration != null) return entry;          // already scanned
    if (this._scanning.has(entry.id)) return this._scanning.get(entry.id);

    const run = this._withSlot(() => this._probe(entry))
      .catch((err) => {
        // A clip that cannot be probed is still a real catalogue entry — mark
        // it so the UI can show it as unreadable instead of retrying forever.
        entry.scanError = err.message;
        return entry;
      })
      .finally(() => this._scanning.delete(entry.id));

    this._scanning.set(entry.id, run);
    return run;
  }

  /** Bounded-concurrency gate. */
  async _withSlot(fn) {
    if (this._active >= SCAN_CONCURRENCY) {
      await new Promise((resolve) => this._queue.push(resolve));
    }
    this._active++;
    try {
      return await fn();
    } finally {
      this._active--;
      this._queue.shift()?.();
    }
  }

  async _probe(entry) {
    const video = document.createElement("video");
    video.preload = "metadata";       // header only — NOT the whole file
    video.muted = true;
    video.playsInline = true;
    video.crossOrigin = "anonymous";
    const release = () => {
      video.removeAttribute("src");
      video.load();
    };
    const rejectAfter = (ms, msg) =>
      new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms));

    try {
      video.src = entry.src;
      await Promise.race([
        new Promise((resolve, reject) => {
          video.onloadedmetadata = resolve;
          video.onerror = () => reject(new Error("could not read metadata"));
        }),
        rejectAfter(SCAN_TIMEOUT_MS, "metadata scan timed out"),
      ]);
      entry.duration = video.duration;

      // Thumbnail is best-effort: a seek pulls one byte range, and if it stalls
      // we keep the duration we already have rather than failing the entry.
      try {
        video.currentTime = Math.min(video.duration * 0.1, 0.5);
        await Promise.race([
          new Promise((res) => video.addEventListener("seeked", res, { once: true })),
          rejectAfter(SCAN_TIMEOUT_MS, "thumbnail seek timed out"),
        ]);
        const c = document.createElement("canvas");
        c.width = 160;
        c.height = 90;
        c.getContext("2d").drawImage(video, 0, 0, 160, 90);
        entry.thumbnail = c.toDataURL("image/jpeg", 0.7);
      } catch {
        /* thumbnail optional */
      }
      return entry;
    } finally {
      release();
    }
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
