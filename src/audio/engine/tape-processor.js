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
const REFUSE_LAYOUT_LOCKED = 4;

/** Ceiling on `/engine/tape/alloc`, so a typo cannot ask for 40 GB. */
const MAX_TAPE_SECONDS = 600;

/**
 * Starting hypotheses, not specifications. §6 item 4 is still open: RoSa fixed
 * 128 zones per type and that number is inherited, but the partition count has
 * no precedent at all, so 8 is a guess to be revised by use (§4.10's framing).
 */
const MAX_PARTITIONS = 8;
const ZONES_PER_TYPE = 128;

/**
 * §4.11: every zone parameter is slewed inside the worklet at audio rate, on
 * arrival. The protocol carries targets; the worklet decides how it gets there.
 * This is deliberately not the client-side frame-rate slew — that cannot
 * prevent a per-sample discontinuity, which is the only kind that clicks.
 */
const SLEW_MS = 8;

/** Output ceiling (§4.11). Not reachable by any address — see protocol.js. */
const LIMIT_THRESHOLD = 0.891;   // ≈ −1 dBFS
const LIMIT_RELEASE_S = 0.15;

/**
 * Patterns declared for one zone type rather than all of them. A pattern in
 * here keeps its type token; everything else collapses to `/zone/<type>/`.
 */
const ZONE_SPECIFIC = new Set([
  '/zone/play/<n>/rate',
  '/zone/rec/<n>/dynamic',
  '/zone/rec/<n>/length',
]);

function makeZone() {
  return {
    part: 0, startRel: 0, lenRel: 0, unsafe: false,
    on: false, dynamic: false,
    gainCur: 0, gainTgt: 0,
    rateCur: 1, rateTgt: 1,
    phase: 0, writePos: 0, recorded: 0,
    // A pending edit ducks the zone to silence, applies at the bottom of the
    // ramp, then rises again — §4.11 names zone bounds as a discontinuity
    // source, and moving a region under a running playhead clicks otherwise.
    pend: false, pendPart: 0, pendStart: 0, pendLen: 0,
  };
}

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

    // Everything below is allocated ONCE, here. Nothing in process() may
    // allocate — one array literal per quantum puts GC on the audio thread,
    // which is §4.9's second hazard and is invisible until it is loud.
    this._parts = [];
    for (let i = 0; i < MAX_PARTITIONS; i++) this._parts.push({ start: 0, len: 0 });
    this._rec = [];
    this._play = [];
    for (let i = 0; i < ZONES_PER_TYPE; i++) {
      this._rec.push(makeZone());
      this._play.push(makeZone());
    }

    this._slewCoef = 1 - Math.exp(-1 / ((SLEW_MS / 1000) * sampleRate));
    this._outGainCur = 1;
    this._outGainTgt = 1;
    this._limThresh = LIMIT_THRESHOLD;
    this._limRelease = 1 - Math.exp(-1 / (LIMIT_RELEASE_S * sampleRate));
    this._limGain = 1;

    this.port.onmessage = (e) => this._dispatch(e.data);
  }

  _zones(type) {
    return type === 'rec' ? this._rec : type === 'play' ? this._play : null;
  }

  /**
   * A zone's absolute span, clamped to its partition unless `unsafe`.
   *
   * §4.3: the one failure mode in a shared buffer that ruins a performance
   * rather than merely sounding wrong is a recording zone with wrong bounds
   * overwriting material you are playing. Clamping is the default; crossing the
   * seam is productive enough to keep, so it is opt-in rather than forbidden.
   */
  _span(z) {
    const p = this._parts[z.part];
    let a = p.start + z.startRel;
    let b = a + z.lenRel;
    if (!z.unsafe) {
      a = Math.max(p.start, Math.min(a, p.start + p.len));
      b = Math.max(a, Math.min(b, p.start + p.len));
    }
    a = Math.max(0, Math.min(a, this._length));
    b = Math.max(a, Math.min(b, this._length));
    return [a, b];
  }

  // ── protocol ──────────────────────────────────────────────────────────────

  _send(a, v, transfer = []) {
    this.port.postMessage({ a, t: '', v }, transfer);
  }

  _refuse(code, message) {
    this.port.postMessage({ a: '/engine/refuse', t: 'is', v: [code, message] });
  }

  /**
   * Collapse a concrete address to its declared pattern before switching, so
   * the `case` labels below read exactly as the keys in protocol.js do. That is
   * what lets the fixpoint audit compare the two files without either importing
   * the other — which an AudioWorklet could not do anyway.
   */
  _dispatch(m) {
    if (!m || typeof m.a !== 'string') return;
    const v = m.v || [];
    const idx = [];
    for (const seg of m.a.split('/')) if (/^\d+$/.test(seg)) idx.push(Number(seg));
    const type = /^\/zone\/([a-z]+)\//.exec(m.a)?.[1] ?? '';

    let pattern = m.a.replace(/\/\d+(?=\/|$)/g, '/<n>');
    if (pattern.startsWith('/zone/') && !ZONE_SPECIFIC.has(pattern)) {
      pattern = pattern.replace(/^\/zone\/[a-z]+\//, '/zone/<type>/');
    }

    switch (pattern) {
      case '/engine/hello':      return this._hello(v[0]);
      case '/engine/tape/alloc': return this._alloc(v[0]);
      case '/engine/panic':      return this._panic();
      case '/tape/write':        return this._write(v[0], v[1], v[2]);
      case '/tape/env/req':      return this._envReq(v[0], v[1], v[2], v[3]);

      case '/part/<n>/bounds':   return this._partBounds(idx[0], v[0], v[1]);
      case '/part/<n>/clear':    return this._partClear(idx[0]);

      case '/zone/<type>/<n>/part':   return this._zonePart(type, idx[0], v[0]);
      case '/zone/<type>/<n>/region': return this._zoneRegion(type, idx[0], v[0], v[1]);
      case '/zone/<type>/<n>/unsafe': return this._zoneSet(type, idx[0], 'unsafe', !!v[0]);
      case '/zone/<type>/<n>/on':     return this._zoneOn(type, idx[0], true);
      case '/zone/<type>/<n>/off':    return this._zoneOn(type, idx[0], false);
      case '/zone/play/<n>/rate':     return this._zoneSet('play', idx[0], 'rateTgt', v[0]);
      case '/zone/rec/<n>/dynamic':   return this._zoneSet('rec', idx[0], 'dynamic', !!v[0]);

      case '/bus/out/gain':      this._outGainTgt = v[0]; return;
      case '/bus/out/limit':     return this._setLimit(v[0], v[1]);

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
    // Silence everything immediately. Panic is the one place a click is the
    // correct outcome — whatever is wrong, it should stop now, not in 8 ms.
    for (const list of [this._rec, this._play]) {
      for (let i = 0; i < list.length; i++) {
        const z = list[i];
        z.on = false; z.gainCur = 0; z.gainTgt = 0; z.pend = false;
        z.phase = 0; z.writePos = 0; z.recorded = 0;
      }
    }
    for (let i = 0; i < this._parts.length; i++) {
      this._parts[i].start = 0;
      this._parts[i].len = 0;
    }
    this._limGain = 1;
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

  // ── partitions (§4.3) ─────────────────────────────────────────────────────

  /**
   * Layout is a setup act, not an instrumental one. LiSa and RoSa both sized at
   * startup, and mid-set resizing would mean relocating live material for a
   * gesture nobody performs — so this is REFUSED while a zone bound to the slot
   * is active. Clearing and reassigning contents need no relayout and stay live.
   */
  _partBounds(slot, start, len) {
    if (!this._length) return this._refuse(REFUSE_NO_TAPE, 'no tape allocated');
    if (!(slot >= 0 && slot < MAX_PARTITIONS)) {
      return this._refuse(REFUSE_BAD_RANGE, `partition ${slot} out of range`);
    }
    if (start < 0 || len < 0 || start + len > this._length) {
      return this._refuse(REFUSE_BAD_RANGE,
        `partition ${slot} bounds ${start}+${len} exceed tape ${this._length}`);
    }
    for (const list of [this._rec, this._play]) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].part === slot && (list[i].on || list[i].gainCur > 0)) {
          return this._refuse(REFUSE_LAYOUT_LOCKED,
            `partition ${slot} has an active zone; layout is fixed while it runs`);
        }
      }
    }
    this._parts[slot].start = start;
    this._parts[slot].len = len;
  }

  _partClear(slot) {
    if (!this._length) return this._refuse(REFUSE_NO_TAPE, 'no tape allocated');
    if (!(slot >= 0 && slot < MAX_PARTITIONS)) {
      return this._refuse(REFUSE_BAD_RANGE, `partition ${slot} out of range`);
    }
    const p = this._parts[slot];
    for (let ch = 0; ch < this._tape.length; ch++) {
      this._tape[ch].fill(0, p.start, p.start + p.len);
    }
    this._markDirty(p.start, p.start + p.len);
  }

  // ── zones (§4.4) ──────────────────────────────────────────────────────────

  _zone(type, i) {
    const list = this._zones(type);
    if (!list || !(i >= 0 && i < list.length)) {
      this._refuse(REFUSE_BAD_RANGE, `no ${type} zone ${i}`);
      return null;
    }
    return list[i];
  }

  _zoneSet(type, i, field, value) {
    const z = this._zone(type, i);
    if (z) z[field] = value;
  }

  /** Structural edits duck the zone first — see `pend` on makeZone(). */
  _zonePart(type, i, slot) {
    const z = this._zone(type, i);
    if (!z) return;
    if (!(slot >= 0 && slot < MAX_PARTITIONS)) {
      return this._refuse(REFUSE_BAD_RANGE, `partition ${slot} out of range`);
    }
    if (!z.on && z.gainCur === 0) { z.part = slot; return; }
    z.pend = true; z.pendPart = slot; z.pendStart = z.startRel; z.pendLen = z.lenRel;
  }

  _zoneRegion(type, i, startRel, lenRel) {
    const z = this._zone(type, i);
    if (!z) return;
    if (!z.on && z.gainCur === 0) {
      z.startRel = startRel; z.lenRel = lenRel; z.phase = 0; z.writePos = 0;
      return;
    }
    z.pend = true; z.pendPart = z.part; z.pendStart = startRel; z.pendLen = lenRel;
  }

  _zoneOn(type, i, on) {
    const z = this._zone(type, i);
    if (!z) return;
    if (on && !z.on) { z.phase = 0; z.writePos = 0; z.recorded = 0; }
    if (!on && z.on && type === 'rec' && z.dynamic) {
      // LiSa's dynamic length: the recording runs to the end of the region and
      // the length is taken from where you stopped, so you capture a phrase
      // without having declared how long it would be first.
      z.lenRel = z.recorded;
      this.port.postMessage(
        { a: `/zone/rec/${i}/length`, t: 'f', v: [z.recorded] });
    }
    z.on = on;
  }

  _setLimit(threshold, releaseSeconds) {
    // Clamped, not validated-and-refused: the limiter is the one thing that
    // must never end up disabled by a bad message (§4.11).
    this._limThresh = Math.max(0.001, Math.min(threshold, 1));
    const r = Math.max(0.001, Math.min(releaseSeconds, 5));
    this._limRelease = 1 - Math.exp(-1 / (r * sampleRate));
  }

  // ── rendering ─────────────────────────────────────────────────────────────

  /** One-pole approach to a target, with a snap so it actually arrives. */
  _approach(cur, tgt) {
    const next = cur + (tgt - cur) * this._slewCoef;
    // An exponential never reaches its target, and "never" here means a zone
    // switched off keeps contributing forever at -100 dB, and a partition stays
    // layout-locked because gainCur > 0 (LEARNED 2026-07-30, same shape).
    return Math.abs(tgt - next) < 1e-6 ? tgt : next;
  }

  _renderRec(z, input, frames) {
    // An unconnected worklet input is an empty array, not silence — recording
    // nothing is correct here, and a test that cannot tell the two apart passes
    // while the recorder is dead.
    if (!z.on || !input || !input.length) return;
    const p = this._parts[z.part];
    const [a, spanEnd] = this._span(z);
    // Dynamic length runs to the end of the PARTITION, not the declared region:
    // the point is to capture a phrase without having said how long it will be.
    const b = z.dynamic
      ? Math.min(z.unsafe ? this._length : p.start + p.len, this._length)
      : spanEnd;
    const limit = b - a;
    if (limit <= 0) return;
    for (let i = 0; i < frames; i++) {
      const at = a + z.writePos;
      for (let ch = 0; ch < this._tape.length; ch++) {
        const src = input[Math.min(ch, input.length - 1)];
        this._tape[ch][at] = src ? src[i] : 0;
      }
      z.writePos++;
      if (z.writePos > z.recorded) z.recorded = z.writePos;
      if (z.writePos >= limit) {
        if (z.dynamic) { z.on = false; break; }   // dynamic stops at the seam
        z.writePos = 0;                            // otherwise loop the region
      }
    }
    this._markDirty(a, a + z.recorded);
  }

  _renderPlay(z, L, R, frames) {
    const [a, b] = this._span(z);
    const room = b - a;
    for (let i = 0; i < frames; i++) {
      z.gainTgt = z.on && !z.pend ? 1 : 0;
      z.gainCur = this._approach(z.gainCur, z.gainTgt);
      z.rateCur = this._approach(z.rateCur, z.rateTgt);
      if (z.gainCur === 0) {
        if (z.pend) {                              // bottom of the duck: apply
          z.part = z.pendPart; z.startRel = z.pendStart; z.lenRel = z.pendLen;
          z.phase = 0; z.pend = false;
        }
        if (!z.on) return;
        continue;
      }
      if (room <= 1) continue;

      const p = z.phase;
      const i0 = a + Math.floor(p);
      const frac = p - Math.floor(p);
      const i1 = i0 + 1 >= b ? a : i0 + 1;         // wrap inside the region
      const l = this._tape[0][i0] * (1 - frac) + this._tape[0][i1] * frac;
      const r = this._tape[1][i0] * (1 - frac) + this._tape[1][i1] * frac;
      L[i] += l * z.gainCur;
      R[i] += r * z.gainCur;

      z.phase += z.rateCur;
      if (z.phase >= room) z.phase -= room;
      else if (z.phase < 0) z.phase += room;
    }
  }

  /**
   * The output bus (§4.11). Master gain, then a peak limiter with instant
   * attack and exponential release, then a hard ceiling as the final backstop.
   *
   * **Not bypassable, by construction.** There is no address that disables it,
   * no flag it reads, and it runs after everything. §8.1 makes
   * `mic → tape → monitors → mic` the instrument's default state, so an
   * instrument without this is one dialled coupling away from damaging monitors
   * and ears in a room.
   */
  _limit(L, R, frames) {
    for (let i = 0; i < frames; i++) {
      this._outGainCur = this._approach(this._outGainCur, this._outGainTgt);
      let l = L[i] * this._outGainCur;
      let r = R[i] * this._outGainCur;

      const peak = Math.abs(l) > Math.abs(r) ? Math.abs(l) : Math.abs(r);
      const want = peak > this._limThresh ? this._limThresh / peak : 1;
      if (want < this._limGain) this._limGain = want;
      else this._limGain += (want - this._limGain) * this._limRelease;

      l *= this._limGain;
      r *= this._limGain;
      L[i] = l < -1 ? -1 : l > 1 ? 1 : l;
      R[i] = r < -1 ? -1 : r > 1 ? 1 : r;
    }
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
   * Writers first, then readers, then the output bus.
   *
   * Later-reads-earlier within a quantum is deliberate and matches §4.3's
   * single-buffer premise: a playback zone reading a region a recording zone
   * just wrote hears this quantum's material, which is the tight capture-and-
   * scrub loop the instrument is for.
   *
   * Nothing in this method allocates. That is not tidiness, it is the §4.9
   * hazard — one array literal per quantum puts GC on the audio thread, which
   * is the real source of granular crackle and is invisible until it is loud.
   * The rule-7 dirty flush at the bottom is the one exception, and it is rate-
   * limited to frame cadence rather than running per quantum.
   */
  process(inputs, outputs) {
    const out = outputs[0];
    const L = out[0];
    const R = out.length > 1 ? out[1] : out[0];
    L.fill(0);
    if (R !== L) R.fill(0);
    const frames = L.length;

    if (this._length) {
      const input = inputs[0];
      for (let i = 0; i < this._rec.length; i++) {
        const z = this._rec[i];
        if (z.on) this._renderRec(z, input, frames);
      }
      for (let i = 0; i < this._play.length; i++) {
        const z = this._play[i];
        if (z.on || z.gainCur > 0) this._renderPlay(z, L, R, frames);
      }
    }

    this._limit(L, R, frames);

    if (++this._quanta >= this._quantaPerFlush) {
      this._quanta = 0;
      this._flushDirty();
    }
    return true;
  }
}

registerProcessor('imweb-tape', TapeProcessor);
