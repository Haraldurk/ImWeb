/**
 * The engine — §4.1's server, §8.8's protocol endpoint.
 *
 * ZERO IMPORTS, AND NOT ONLY BY CONVENTION. An AudioWorklet global scope has no
 * module loader, so this file physically cannot import one. That happens to
 * enforce §4.1's rule — *could you delete every line of ImWeb UI and still drive
 * a working sound engine from a script?* — for free. The addresses below are
 * string literals rather than shared constants for the same reason; the drift
 * that would normally invite is closed by the fixpoint check in
 * `tests/audit-audio-protocol.mjs`, which fails if this file and
 * `src/audio/protocol.js` disagree about what exists.
 *
 * Step 1 scope: the tape, its allocation, the bulk write path and the envelope
 * request/reply. No zones, no voices, no DSP — `process()` outputs silence.
 * Zones are step 2 (§4.4).
 */

const PROTO_VERSION = 1;
const REFUSE_PROTO_MISMATCH = 1;
const REFUSE_NO_TAPE = 2;
const REFUSE_BAD_RANGE = 3;

/** Ceiling on `/engine/tape/alloc`, so a typo cannot ask for 40 GB. */
const MAX_TAPE_SECONDS = 600;

class TapeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    /** @type {Float32Array[]} one per channel; empty until /engine/tape/alloc. */
    this._tape = [];
    this._length = 0;

    // Rule 7: engine→client traffic is aggregated to frame cadence. Dirty
    // regions coalesce into one range and flush on a timer measured in quanta,
    // so a writer touching the tape every quantum still produces ~60 msg/s.
    this._dirtyLo = Infinity;
    this._dirtyHi = -Infinity;
    this._quantaPerFlush = Math.max(1, Math.round(sampleRate / 128 / 60));
    this._quanta = 0;

    this.port.onmessage = (e) => this._dispatch(e.data);
  }

  // ── protocol ──────────────────────────────────────────────────────────────

  _send(a, v, transfer = []) {
    this.port.postMessage({ a, t: '', v }, transfer);
  }

  _refuse(code, message) {
    this.port.postMessage({ a: '/engine/refuse', t: 'is', v: [code, message] });
  }

  _dispatch(m) {
    if (!m || typeof m.a !== 'string') return;
    const v = m.v || [];
    switch (m.a) {
      case '/engine/hello':      return this._hello(v[0]);
      case '/engine/tape/alloc': return this._alloc(v[0]);
      case '/engine/panic':      return this._panic();
      case '/tape/write':        return this._write(v[0], v[1], v[2]);
      case '/tape/env/req':      return this._envReq(v[0], v[1], v[2], v[3]);
      default: return this._refuse(REFUSE_PROTO_MISMATCH, `unknown address '${m.a}'`);
    }
  }

  _hello(proto) {
    if (proto !== PROTO_VERSION) {
      // Refuse rather than degrade: a half-understood protocol is worse than
      // no connection, because it fails later and further from the cause.
      return this._refuse(
        REFUSE_PROTO_MISMATCH, `engine speaks ${PROTO_VERSION}, client sent ${proto}`);
    }
    this.port.postMessage({
      a: '/engine/ready', t: 'iff', v: [PROTO_VERSION, sampleRate, MAX_TAPE_SECONDS],
    });
  }

  _alloc(seconds) {
    if (!(seconds > 0) || seconds > MAX_TAPE_SECONDS) {
      return this._refuse(REFUSE_BAD_RANGE, `tape seconds out of range: ${seconds}`);
    }
    this._length = Math.floor(seconds * sampleRate);
    this._tape = [new Float32Array(this._length), new Float32Array(this._length)];
    this._markDirty(0, this._length);
  }

  _panic() {
    this._tape = [];
    this._length = 0;
    this._dirtyLo = Infinity;
    this._dirtyHi = -Infinity;
  }

  /**
   * Bulk write (rule 2). The blob is interleaved float32 for `channels`
   * channels; a mono payload feeds both sides so a caller does not have to
   * duplicate it before sending.
   */
  _write(startSample, channels, blob) {
    if (!this._length) return this._refuse(REFUSE_NO_TAPE, 'no tape allocated');
    const src = new Float32Array(blob);
    const frames = Math.floor(src.length / channels);
    if (startSample < 0 || startSample + frames > this._length) {
      return this._refuse(REFUSE_BAD_RANGE,
        `write ${startSample}+${frames} exceeds tape length ${this._length}`);
    }
    for (let ch = 0; ch < this._tape.length; ch++) {
      const dst = this._tape[ch];
      const lane = channels === 1 ? 0 : Math.min(ch, channels - 1);
      for (let i = 0; i < frames; i++) dst[startSample + i] = src[i * channels + lane];
    }
    this._markDirty(startSample, startSample + frames);
  }

  /**
   * Envelope for an explicit span (§6 item 6). The client asks and never
   * resamples: min/max is not an average, so a zoomed view reconstructed from a
   * coarser one invents peaks it never saw and loses the ones between columns.
   *
   * `reqId` comes back untouched so the client can drop stale replies — during
   * a zoom drag, answers arrive for spans the user has already left.
   */
  _envReq(start, end, columns, reqId) {
    if (!this._length) return this._refuse(REFUSE_NO_TAPE, 'no tape allocated');
    const a = Math.max(0, Math.min(start, this._length));
    const b = Math.max(a, Math.min(end, this._length));
    const cols = Math.max(1, Math.min(columns | 0, 8192));
    const out = new Float32Array(cols * 2);
    const span = b - a;

    for (let c = 0; c < cols; c++) {
      const i0 = a + Math.floor((c * span) / cols);
      const i1 = c === cols - 1 ? b : a + Math.floor(((c + 1) * span) / cols);
      let lo = 0, hi = 0;
      if (i1 > i0) {
        lo = Infinity; hi = -Infinity;
        for (let ch = 0; ch < this._tape.length; ch++) {
          const t = this._tape[ch];
          for (let i = i0; i < i1; i++) {
            const s = t[i];
            if (s < lo) lo = s;
            if (s > hi) hi = s;
          }
        }
      }
      out[c * 2] = lo;
      out[c * 2 + 1] = hi;
    }
    this.port.postMessage(
      { a: '/tape/env/data', t: 'iiiib', v: [reqId, a, b, cols, out.buffer] },
      [out.buffer],
    );
  }

  _markDirty(lo, hi) {
    if (lo < this._dirtyLo) this._dirtyLo = lo;
    if (hi > this._dirtyHi) this._dirtyHi = hi;
  }

  _flushDirty() {
    if (this._dirtyHi < this._dirtyLo) return;
    this.port.postMessage(
      { a: '/tape/env/dirty', t: 'ii', v: [this._dirtyLo, this._dirtyHi] });
    this._dirtyLo = Infinity;
    this._dirtyHi = -Infinity;
  }

  // ── audio ─────────────────────────────────────────────────────────────────

  /**
   * Silence for now — zones arrive in step 2. The only work here is the rule-7
   * flush, which is deliberately NOT per-quantum: a writer touching the tape
   * 375 times a second would otherwise emit 375 messages a second for a display
   * that repaints 60 times.
   *
   * Nothing in this method allocates. That is not tidiness, it is the §4.9
   * hazard — one array literal per quantum puts GC on the audio thread, which
   * is the real source of granular crackle and is invisible until it is loud.
   */
  process(_inputs, outputs) {
    const out = outputs[0];
    for (let ch = 0; ch < out.length; ch++) out[ch].fill(0);

    if (++this._quanta >= this._quantaPerFlush) {
      this._quanta = 0;
      this._flushDirty();
    }
    return true;
  }
}

registerProcessor('imweb-tape', TapeProcessor);
