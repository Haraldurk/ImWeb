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

/**
 * Sub-reads averaged per output sample when reading faster than 1× (§4.10).
 * `aplay.rate` runs to ±4, so 4 covers the whole range at one read per skipped
 * sample; the cap is here so a future wider rate range cannot turn the inner
 * loop into an unbounded one — the audio thread has no watchdog (§4.9).
 */
const MAX_SUBREADS = 4;

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
    part: 0, unsafe: false,
    on: false, dynamic: false,
    gainCur: 0, gainTgt: 0,
    rateCur: 1, rateTgt: 1,
    phase: 0, writePos: 0, recorded: 0,
    // §4.11 says zone BOUNDS are slewed at audio rate, like rate and level.
    // They were briefly ducked-and-reapplied instead, which is fine for a hand
    // on a field and catastrophic under a controller: an LFO writes the param
    // every frame, so a fresh "structural edit" lands every ~16 ms, the duck
    // never completes, and the zone only speaks at the LFO's turning points
    // where the value momentarily stops changing. A slewed base is also the
    // musically right answer — moving it smoothly IS scrubbing.
    // Bounds ramp LINEARLY to their target over `_glideSamples`, and they are
    // deliberately not run through _approach(). An exponential follower lags by
    // its time constant AND lowpasses the gesture, so a fast scrub comes out
    // flattened — it feels like the instrument is not responding, because a
    // filter on position is a filter on your hand. Scrubbing is index
    // arithmetic (§4.2); the only reason to smooth it at all is that a 60 Hz
    // control rate would otherwise deliver 60 discrete jumps a second (§8.7's
    // resolution problem, whose real fix is worklet-resident controllers).
    // A linear ramp ARRIVES, in a time the performer sets, and at 0 it is exact.
    startCur: 0, startTgt: 0, startStep: 0, startRamp: 0,
    lenCur: 0, lenTgt: 0, lenStep: 0, lenRamp: 0,
    // A PARTITION change still ducks. That one is genuinely structural: the
    // new region can be anywhere in the tape, and sliding a read position
    // across the gap would sweep through whatever material lies between.
    pend: false, pendPart: 0,
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
    // Bounds glide, in samples. 3 ms is short enough to feel immediate and long
    // enough to hide the 60 Hz staircase a frame-rate controller writes; 0 is
    // exact tracking, which is the right setting for a hand on a value field
    // and the wrong one under an LFO.
    this._glideSamples = Math.round(0.003 * sampleRate);
    this._outGainCur = 1;
    this._outGainTgt = 1;
    this._limThresh = LIMIT_THRESHOLD;
    this._limRelease = 1 - Math.exp(-1 / (LIMIT_RELEASE_S * sampleRate));
    this._limGain = 1;
    // Scratch for _computeSpan(), declared here so the object shape is fixed
    // before the first quantum.
    this._sa = 0;
    this._sb = 0;

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
  /**
   * Writes the zone's absolute span into `_sa` / `_sb` rather than returning a
   * pair. It is called PER SAMPLE now that bounds slew, and `return [a, b]`
   * would be 48000 array literals a second per zone — §4.9's inner-loop
   * allocation, i.e. GC on the audio thread, i.e. the crackle that is invisible
   * until it is loud.
   */
  _computeSpan(z) {
    const p = this._parts[z.part];
    let a = p.start + z.startCur;
    let b = a + z.lenCur;
    if (!z.unsafe) {
      a = Math.max(p.start, Math.min(a, p.start + p.len));
      b = Math.max(a, Math.min(b, p.start + p.len));
    }
    a = Math.max(0, Math.min(a, this._length));
    b = Math.max(a, Math.min(b, this._length));
    this._sa = a;
    this._sb = b;
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

      case '/engine/glide':
        this._glideSamples = Math.max(0, Math.round((v[0] / 1000) * sampleRate));
        return;
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
    // Relayout is refused while a zone runs; reallocating the whole tape throws
    // away every recording in it, so refusing that only when the smaller act is
    // refused would be backwards. §8.8: the protocol enforces the rule rather
    // than trusting the client to remember it.
    for (const list of [this._rec, this._play]) {
      for (let i = 0; i < list.length; i++) {
        if (list[i].on || list[i].gainCur > 0) {
          return this._refuse(REFUSE_LAYOUT_LOCKED,
            'cannot reallocate the tape while a zone is running');
        }
      }
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
    if (!this._length) {
      // Correlated, not just /engine/refuse: the client gates one request per
      // view, so an uncorrelated failure wedges that view permanently.
      this.port.postMessage(
        { a: '/tape/env/err', t: 'ii', v: [reqId, REFUSE_NO_TAPE] });
      return this._refuse(REFUSE_NO_TAPE, 'no tape allocated');
    }
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
    z.pend = true; z.pendPart = slot;
  }

  /**
   * Bounds are TARGETS, slewed at audio rate (§4.11) — not a structural edit.
   * A controller writes this every frame, and anything that interrupts playback
   * per message makes the zone speak only where the controller happens to sit
   * still. Idle zones snap, so starting a stopped zone does not slide into
   * position from wherever it last was.
   */
  _zoneRegion(type, i, startRel, lenRel) {
    const z = this._zone(type, i);
    if (!z) return;
    z.startTgt = startRel;
    z.lenTgt = lenRel;
    // Re-aim the ramp from wherever the value currently is, so a target that
    // moves every frame is followed continuously rather than restarted.
    const n = this._glideSamples;
    z.startRamp = n;
    z.lenRamp = n;
    z.startStep = n > 0 ? (startRel - z.startCur) / n : 0;
    z.lenStep = n > 0 ? (lenRel - z.lenCur) / n : 0;
    if (!z.on && z.gainCur === 0) {
      z.startCur = startRel; z.lenCur = lenRel; z.phase = 0; z.writePos = 0;
      z.startRamp = z.lenRamp = 0;
    }
  }

  /**
   * The single place a dynamic recording resolves. Both stop paths — the user
   * releasing Run, and the head reaching the partition seam — must go through
   * it, or one of them silently skips telling the client what it captured.
   */
  _finishDynamic(z, i) {
    z.on = false;
    // Snap BOTH, not just the target: a dynamic length is a fact about what
    // was captured, and slewing into it would leave the zone briefly reading
    // past the end of the material it just recorded.
    z.lenCur = z.lenTgt = z.recorded;
    z.lenRamp = 0;
    this.port.postMessage({ a: `/zone/rec/${i}/length`, t: 'f', v: [z.recorded] });
    // The engine stopped this zone by itself. Say so, or the Run toggle keeps
    // claiming it is running — the half of this the length reply does not cover.
    this.port.postMessage({ a: `/zone/rec/${i}/state`, t: 'F', v: [false] });
  }

  _zoneOn(type, i, on) {
    const z = this._zone(type, i);
    if (!z) return;
    if (on && !z.on) { z.phase = 0; z.writePos = 0; z.recorded = 0; }
    if (!on && z.on && type === 'rec' && z.dynamic) {
      // LiSa's dynamic length: the recording runs to the end of the region and
      // the length is taken from where you stopped, so you capture a phrase
      // without having declared how long it would be first.
      return this._finishDynamic(z, i);
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

  _renderRec(z, zi, input, frames) {
    // An unconnected worklet input is an empty array, not silence — recording
    // nothing is correct here, and a test that cannot tell the two apart passes
    // while the recorder is dead.
    if (!z.on || !input || !input.length) return;
    const p = this._parts[z.part];
    this._computeSpan(z);
    const a = this._sa, spanEnd = this._sb;
    // Dynamic length runs to the end of the PARTITION, not the declared region:
    // the point is to capture a phrase without having said how long it will be.
    const b = z.dynamic
      ? Math.min(z.unsafe ? this._length : p.start + p.len, this._length)
      : spanEnd;
    // A recording head lands ON samples — there is no sub-sample write, and a
    // fractional subscript here is WORSE than on the read side: assigning to
    // `Float32Array[1234.5]` is a silent no-op even in strict mode, so the
    // recorder captures nothing and reports no error at all.
    const base = Math.ceil(a);
    const limit = Math.floor(b) - base;
    if (limit <= 0) return;
    for (let i = 0; i < frames; i++) {
      const at = base + z.writePos;
      if (at < 0 || at >= this._length) break;
      for (let ch = 0; ch < this._tape.length; ch++) {
        const src = input[Math.min(ch, input.length - 1)];
        this._tape[ch][at] = src ? src[i] : 0;
      }
      z.writePos++;
      if (z.writePos > z.recorded) z.recorded = z.writePos;
      if (z.writePos >= limit) {
        if (z.dynamic) {
          // Stopping at the seam must report the length the same way a manual
          // stop does. Setting z.on = false here and returning silently left
          // the client believing the zone was still running and never told it
          // how long the capture was — the Run toggle stayed on over a zone
          // that had already stopped.
          this._finishDynamic(z, zi);
          break;
        }
        z.writePos = 0;                            // otherwise loop the region
      }
    }
    this._markDirty(base, base + z.recorded);
  }

  /**
   * One Catmull-Rom sample from channel `ch` at fractional position `pos`, with
   * every index wrapped into the integer window `[lo, lo + count)`.
   *
   * §4.10 item 1 — reading between samples with LINEAR interpolation sounds
   * dull and grainy, and this is the reader that runs constantly in a
   * LiSa-lineage instrument, so it is the highest-value change in the set.
   *
   * Catmull-Rom specifically, because it INTERPOLATES: at `t == 0` it returns
   * `p1` exactly, so a 1× read is bit-transparent and "the tape is what is
   * seen" stays literally true — the envelope display shows what you hear. A
   * B-spline only approximates, i.e. it lowpasses even at 1×, which would make
   * heard ≠ seen permanently and dull the main path forever. It rings ~10–15%
   * on hard transients; §4.11's non-bypassable ceiling means that can colour
   * but cannot damage, and tensioned Hermite is a two-coefficient change if the
   * ringing ever offends on real material.
   *
   * Allocation-free by construction: scalars, no array literal, no closure
   * (§4.9 — one array per sample is 48000 a second, i.e. GC on the audio
   * thread). `tests/audit-audio-protocol.mjs` scans this function for both.
   */
  _cubic(ch, pos, lo, count) {
    const i = Math.floor(pos);
    const t = pos - i;
    const buf = this._tape[ch];
    let w0 = (i - 1 - lo) % count; if (w0 < 0) w0 += count;
    let w1 = (i - lo) % count;     if (w1 < 0) w1 += count;
    let w2 = (i + 1 - lo) % count; if (w2 < 0) w2 += count;
    let w3 = (i + 2 - lo) % count; if (w3 < 0) w3 += count;
    const p0 = buf[lo + w0], p1 = buf[lo + w1];
    const p2 = buf[lo + w2], p3 = buf[lo + w3];
    // Horner form — 3 multiplies for the polynomial rather than 3 powers.
    return p1 + 0.5 * t * (p2 - p0
      + t * (2 * p0 - 5 * p1 + 4 * p2 - p3
      + t * (3 * (p1 - p2) + p3 - p0)));
  }

  _renderPlay(z, L, R, frames) {
    for (let i = 0; i < frames; i++) {
      z.gainTgt = z.on && !z.pend ? 1 : 0;
      z.gainCur = this._approach(z.gainCur, z.gainTgt);
      z.rateCur = this._approach(z.rateCur, z.rateTgt);
      // Bounds slew per sample, so a controller sweeping Start slides the read
      // position continuously instead of restarting the zone.
      if (z.startRamp > 0) { z.startCur += z.startStep; z.startRamp--; }
      else z.startCur = z.startTgt;
      if (z.lenRamp > 0) { z.lenCur += z.lenStep; z.lenRamp--; }
      else z.lenCur = z.lenTgt;
      if (z.gainCur === 0) {
        if (z.pend) {                              // bottom of the duck: apply
          z.part = z.pendPart;
          z.phase = 0; z.pend = false;
        }
        if (!z.on) return;
        continue;
      }

      // Recomputed per sample because the bounds are moving; it is what makes a
      // modulated region a scrub rather than a sequence of jumps. ONCE per
      // output sample, before the sub-reads below — they must share one
      // coherent span, and recomputing inside that loop would give each tap a
      // different region.
      this._computeSpan(z);
      const a = this._sa, b = this._sb;
      const room = b - a;
      if (!(room > 0)) continue;                   // also catches NaN
      if (z.phase >= room) z.phase = z.phase % room;

      // INDICES MUST BE INTEGERS. `a` is fractional whenever the region start
      // is — which is always, under a controller: _modStep gives modulation
      // full float resolution on purpose (ParameterSystem.js), so an LFO on
      // Start produces a fractional span every frame. A fractional typed-array
      // subscript reads `undefined`, `undefined * x` is NaN, and NaN is not
      // silence — it propagates through the limiter (every comparison against
      // NaN is false) all the way to the DAC. The old code computed
      // `i0 = a + Math.floor(phase)`, keeping a's fraction in the SUBSCRIPT
      // instead of in the interpolation where it belongs.
      //
      // Folding it into `frac` rather than flooring `a` is the point: the
      // sub-sample part is what makes a slow scrub smooth instead of stepped.
      // The integer read window inside the region. A 4-point kernel reaches one
      // sample either side of the pair linear interpolation used, so every index
      // is wrapped into this window rather than bounds-checked — the region is
      // fractional and moving, so "outside" is the normal case at both ends.
      const lo = Math.ceil(a);
      const count = Math.floor(b) - lo;
      if (count < 1) continue;

      // §4.10 item 2 — rate-aware anti-aliasing. Reading at rate r IS decimation
      // by r: content above SR/2r folds down, and it folds AT THE READ. So the
      // only filter that can help runs over the source material before samples
      // are skipped; a lowpass on this loop's OUTPUT cannot work, because an
      // alias sitting in the baseband is indistinguishable from a partial that
      // belongs there.
      //
      // The kernel is therefore a box average over the decimation support — N
      // reads across the step this sample is about to take. That IS §4.10's
      // "rate-tracking lowpass before the read", computed on the fly instead of
      // baked into mips, which do not fit a tape a Recording Zone is still
      // writing: every level would need maintaining against a moving write head,
      // and mip selection assumes a quasi-static rate while this one is a
      // per-sample slew target.
      //
      // Deliberately STATELESS, and that is not incidental. Any filter with a
      // delay line becomes voice state that §8.9's fork has to snapshot and its
      // determinism test has to verify; an average of sub-reads snapshots to
      // nothing.
      //
      // What it buys, stated honestly: a box of width r nulls at SR/r, an octave
      // ABOVE the fold, so the danger band gets sinc rolloff rather than a
      // stopband — a large improvement, not elimination. The upgrade path is a
      // tent (this box convolved with itself, sidelobes ≈ −26 dB), which is a
      // weight per tap and no restructuring. Not built now.
      const ar = z.rateCur < 0 ? -z.rateCur : z.rateCur;
      const N = ar > 1 ? (ar > MAX_SUBREADS ? MAX_SUBREADS : Math.ceil(ar)) : 1;
      // MIDPOINT spacing: N cells of width rate/N tile the step exactly, one
      // read at each cell's centre. Endpoint spacing (rate/(N-1)) spans the same
      // step but shares its endpoints with the neighbouring output sample and
      // over-weights the edges under uniform weights. Centred on `pos`, so the
      // kernel is zero-phase and symmetric under reverse; at N = 1 the offset is
      // exactly 0, which is what keeps a 1× read bit-transparent.
      const h = z.rateCur / N;
      const base = a + z.phase - h * (N * 0.5);
      let l = 0, r = 0;
      for (let k = 0; k < N; k++) {
        const pos = base + (k + 0.5) * h;
        l += this._cubic(0, pos, lo, count);
        r += this._cubic(1, pos, lo, count);
      }
      if (N > 1) { l /= N; r /= N; }
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
      // NaN passes a ternary ceiling untouched: every comparison against NaN is
      // false, so `l < -1 ? -1 : l > 1 ? 1 : l` returns NaN. A ceiling that
      // guarantees a bounded output except for the one value that is not a
      // number is not a ceiling, and §4.11 makes this stage the thing that must
      // never misbehave. The DSP bug that produced NaN is fixed upstream; this
      // is the backstop that keeps the next one inaudible instead of ruinous.
      L[i] = l >= -1 && l <= 1 ? l : (l > 1 ? 1 : (l < -1 ? -1 : 0));
      R[i] = r >= -1 && r <= 1 ? r : (r > 1 ? 1 : (r < -1 ? -1 : 0));
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
        if (z.on) this._renderRec(z, i, input, frames);
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
