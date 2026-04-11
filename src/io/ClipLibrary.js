/**
 * ClipLibrary — record canvas output to indexed slots, recall into MovieInput.
 *
 * Storage: IndexedDB 'imweb-clips', object store 'clips', key = slotIndex (0-127).
 * Record: { blob, duration, thumbnail }
 *
 * Usage:
 *   clipLibrary.record(stream, slotIndex, maxSeconds, sourceCanvas)
 *   clipLibrary.recall(slotIndex)  → { blobUrl, duration, thumbnail }
 *   clipLibrary.getManifest()      → [{ slotIndex, duration, thumbnail }, ...]
 *   clipLibrary.delete(slotIndex)
 *   clipLibrary.clear()
 */

const DB_NAME    = 'imweb-clips';
const DB_VERSION = 1;
const STORE      = 'clips';

function _openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

class ClipLibrary {
  /**
   * Record a MediaStream into slotIndex for maxSeconds.
   * Captures a thumbnail from sourceCanvas at recording start (optional).
   *
   * @param {MediaStream}           stream
   * @param {number}                slotIndex  0–127
   * @param {number}                maxSeconds default 5
   * @param {HTMLCanvasElement|null} sourceCanvas  for thumbnail snapshot
   * @returns {Promise<void>} resolves when blob is stored in IDB
   */
  async record(stream, slotIndex, maxSeconds = 5, sourceCanvas = null) {
    const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
      ? 'video/webm;codecs=vp9'
      : 'video/webm';

    // Snapshot thumbnail from canvas at recording start
    let thumbnail = null;
    if (sourceCanvas) {
      try {
        const tc = document.createElement('canvas');
        tc.width  = 160;
        tc.height = 90;
        tc.getContext('2d').drawImage(sourceCanvas, 0, 0, 160, 90);
        thumbnail = tc.toDataURL('image/jpeg', 0.75);
      } catch (_) { /* optional */ }
    }

    return new Promise((resolve, reject) => {
      const chunks = [];
      let mr;
      try {
        mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
      } catch (err) {
        reject(err);
        return;
      }

      mr.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      mr.onstop = async () => {
        try {
          const blob = new Blob(chunks, { type: 'video/webm' });

          // Probe actual duration
          let duration = maxSeconds;
          try {
            const probeUrl = URL.createObjectURL(blob);
            const probe    = document.createElement('video');
            probe.src      = probeUrl;
            probe.muted    = true;
            await new Promise(r => { probe.onloadedmetadata = r; probe.onerror = r; });
            if (isFinite(probe.duration)) duration = probe.duration;
            URL.revokeObjectURL(probeUrl);
          } catch (_) { /* use maxSeconds fallback */ }

          const db = await _openDB();
          await new Promise((res, rej) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put({ blob, duration, thumbnail }, slotIndex);
            tx.oncomplete = () => { db.close(); res(); };
            tx.onerror    = () => { db.close(); rej(tx.error); };
          });
          resolve();
        } catch (err) { reject(err); }
      };

      mr.onerror = e => reject(e.error ?? new Error('MediaRecorder error'));
      mr.start(100);
      setTimeout(() => { if (mr.state !== 'inactive') mr.stop(); }, maxSeconds * 1000);
    });
  }

  /**
   * Recall a stored clip.
   * @param {number} slotIndex
   * @returns {Promise<{blobUrl:string, duration:number, thumbnail:string|null}|null>}
   */
  async recall(slotIndex) {
    const db     = await _openDB();
    const record = await new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(slotIndex);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
    if (!record) return null;
    return {
      blobUrl:   URL.createObjectURL(record.blob),
      duration:  record.duration,
      thumbnail: record.thumbnail,
    };
  }

  /**
   * Returns manifest of all filled slots (no blob data, just metadata).
   * @returns {Promise<Array<{slotIndex:number, duration:number, thumbnail:string|null}>>}
   */
  async getManifest() {
    const db  = await _openDB();
    const out = [];
    await new Promise((resolve, reject) => {
      const tx  = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) { db.close(); resolve(); return; }
        const { duration, thumbnail } = cursor.value;
        out.push({ slotIndex: cursor.key, duration, thumbnail });
        cursor.continue();
      };
      req.onerror = () => { db.close(); reject(req.error); };
    });
    return out;
  }

  /** Delete a single slot. */
  async delete(slotIndex) {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(slotIndex);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  }

  /** Delete all slots. */
  async clear() {
    const db = await _openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).clear();
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  }
}

export default new ClipLibrary();
