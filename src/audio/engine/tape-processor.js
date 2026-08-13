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
const REFUSE_BUSY = 5;
const REFUSE_CTRL_OWNED = 6;

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

/** Voices (§4.4) — no buffer region, so they sound with no tape allocated. */
const MAX_VOICES = 8;

/**
 * Envelope scanning budget, in SAMPLE READS per quantum (§8.3 — the same
 * chunking rule the render writers get, applied to the one bulk read that
 * already exists).
 *
 * The whole point of the envelope is that video never touches the raw tape, and
 * the request that draws the whole tape is the largest read in the instrument:
 * a full 600 s stereo tape is 57.6 M reads. Done in the message handler — where
 * it was — that is one `process()` call taking hundreds of milliseconds, i.e. a
 * guaranteed dropout at exactly the moment the display first appears. The audio
 * thread has no watchdog (§4.9), so a bulk read has to be paced by construction
 * rather than by being small in practice.
 *
 * 2^17 reads is roughly 5% of a quantum's 2.67 ms at 48 kHz, which puts a
 * 60-second tape a little over 100 ms away and a full 600-second one ~1.2 s.
 * A displayed envelope that finishes a second late is a non-event; a dropout is
 * the one thing the audio thread must not do.
 */
const ENV_READS_PER_QUANTUM = 1 << 17;

/**
 * Worklet-resident controllers (§8.7). Sixteen is a starting hypothesis like
 * every other count here: it is more than the audio params that exist today and
 * far less than the 128 RoSa gave zones, because a controller costs a per-sample
 * evaluation while an unbound zone costs nothing.
 */
const MAX_CTRLS = 16;

/**
 * Response-curve slots (§8.7). One per controller is the worst case and the
 * simplest allocator: the client sends a table into the slot with the same
 * number as the controller that uses it, so there is no sharing scheme to keep
 * consistent. 16384 floats each — the resolution `ResponseCurve` already uses —
 * so a full set is 1 MB, uploaded on change and never per frame.
 */
const MAX_TABLES = MAX_CTRLS;
const TABLE_SIZE = 16384;

/** LFO shapes, in `src/controls/LFO.js` order — that order is the wire format. */
const SHAPE_SINE = 0, SHAPE_TRI = 1, SHAPE_SAW = 2;
const SHAPE_RAMP = 3, SHAPE_SQUARE = 4, SHAPE_SH = 5;

/** Controller target kinds, resolved from an address ONCE at bind time. */
const TGT_NONE = 0;
const TGT_ZONE_RATE = 1;
const TGT_VOICE_FREQ = 2;
const TGT_VOICE_LEVEL = 3;
const TGT_VOICE_COLOUR = 4;
const TGT_VOICE_DRIVE = 5;
const TGT_OUT_GAIN = 6;

/**
 * The render quantum. Fixed at 128 by the Web Audio spec, and allocated for
 * ONCE here because a controller's per-sample output has to live somewhere that
 * `process()` never allocates. If a future UA renders longer blocks the extra
 * samples hold the last value rather than reading past the end — degraded, not
 * broken, and stated rather than trusted.
 */
const RENDER_QUANTUM = 128;

/**
 * Envelope requests may queue, because the display and any future mini-view are
 * separate clients of the same engine. They may not queue WITHOUT BOUND — the
 * client already coalesces one request per view (`AudioEngine.requestEnvelope`),
 * so a queue deeper than this means the client is broken, and the honest answer
 * is a correlated refusal rather than a growing backlog the tape outlives.
 */
const MAX_ENV_JOBS = 4;

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

/**
 * A Voice (§4.4): the thing with NO buffer region. It runs live to the output
 * and is invisible to the video half until frozen, which is exactly the rule —
 * anything with a region is a Zone, anything without is a Voice.
 *
 * Fixed topology, not a graph: source → filter → saturator → level, where the
 * source is an oscillator (with a phase input) or noise. §4.10 is explicit that
 * voices should NOT have text authoring in the first pass, because the zone
 * model plus a few parameterized generators is already playable and real use is
 * what should decide the UGen set. A fixed graph is still a graph (§4.9); what
 * it is not is a language invented around guesses.
 *
 * Every field is state a §8.9 freeze must be able to SNAPSHOT — that is why the
 * RNG is here and explicit rather than `Math.random()`, which has no seed to
 * copy and would make a fork diverge from its parent immediately.
 */
function makeVoice(seed) {
  return {
    on: false,
    gainCur: 0, gainTgt: 0,
    // Source and waveform are DISCRETE — there is no value between a sine and a
    // square — so they duck instead of slewing, the same treatment a zone gives
    // a partition change and for the same reason: the sample either side of the
    // switch differs by up to full scale, and a step is a click. Ducked only on
    // an actual CHANGE (see `_voiceShape`), because rule 4 makes a re-send an
    // update: a controller parked on one waveform must not duck every frame,
    // which is exactly how the zone-bounds version silenced itself (§4.11).
    src: 0,                        // 0 = oscillator, 1 = noise
    wave: 0,                       // 0 sine, 1 saw, 2 square, 3 triangle
    pend: false, pendSrc: 0, pendWave: 0,
    freqCur: 220, freqTgt: 220,
    // Slot of the worklet-resident controller driving each field, or -1 (§8.7).
    // A back-pointer rather than a list walked per sample: the render loop is
    // the hot path and it should index, not search.
    freqCtrl: -1, levelCtrl: -1, colourCtrl: -1, driveCtrl: -1,
    // FM ratio is slewed like every other continuous voice parameter (§4.11).
    // It was set directly at first, which steps the modulator frequency at
    // control rate — zipper noise on a registered controller target, the same
    // class as the bounds ducking one level down.
    fmRatioCur: 1, fmRatioTgt: 1,
    fmIndexCur: 0, fmIndexTgt: 0,
    phase: 0, modPhase: 0,
    colourCur: 0.5, colourTgt: 0.5,
    noiseLp: 0,
    cutCur: 2000, cutTgt: 2000,
    resCur: 0.2, resTgt: 0.2,
    ftypeCur: 0, ftypeTgt: 0,      // 0 LP → 1 BP → 2 HP → 3 notch, morphable
    ic1: 0, ic2: 0,                // SVF integrator state (TPT form)
    driveCur: 0, driveTgt: 0,
    levelCur: 0.3, levelTgt: 0.3,
    // xorshift32. Explicit and splittable per §8.9 item 1: a fork copies this
    // integer and the two streams stay identical until they are deliberately
    // split. Seeded off the voice index so two voices are not the same noise.
    rng: (seed * 2654435761) >>> 0 || 1,
  };
}

/**
 * One worklet-resident controller (§8.7).
 *
 * The client sends shape/rate/width/mode/phase/range; this evaluates them per
 * sample and writes the target's own field. Every field here is state a §8.9
 * fork would have to copy — hence the explicit RNG for sample-and-hold, for the
 * same reason the voices have one.
 *
 * `t` is the running phase and `phase` is the OFFSET. They are different things
 * and §8.7 is explicit about it: the offset is config and is captured, the
 * running phase is ephemeral across captures and always has been (nothing has
 * ever stored it), so the move into the worklet inherits that rather than
 * causing it.
 */
function makeCtrl(seed) {
  return {
    kind: TGT_NONE, idx: 0,
    shape: SHAPE_SINE,
    hz: 0.5,
    width: 0.5,
    mode: 0,                       // 0 free-running, 1 one-shot
    phase: 0,                      // offset, 0..1
    lo: 0, hi: 1, map: 0,          // output range in the target's units
    invert: 0,                     // applied to the sweep BEFORE the table
    table: -1,                     // response-curve slot, or -1 for none
    t: 0,                          // running phase
    running: true,
    shValue: 0.5,
    // Both halves of the echo. `raw` is the shape's own 0..1 output and `out`
    // is that mapped onto the target's units — see `_ctrlFlush` for why both
    // travel.
    raw: 0,
    out: 0,
    rng: (seed * 2246822519) >>> 0 || 1,
    // One value per sample, which is what makes §8.7's claim literal rather
    // than rhetorical. Evaluating once per QUANTUM would have been six times
    // better than the 60 Hz it replaces and much less code — but 375 Hz is
    // still a staircase, and the whole reason this section exists is that a
    // stepped parameter in audio is not a stutter, it is zipper noise.
    buf: new Float32Array(RENDER_QUANTUM),
  };
}

function makeZone() {
  return {
    part: 0, unsafe: false,
    on: false, dynamic: false,
    gainCur: 0, gainTgt: 0,
    rateCur: 1, rateTgt: 1, rateCtrl: -1,
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

    /**
     * Envelope requests accepted but not yet scanned. A queue rather than a
     * single slot because views are independent clients; bounded by
     * MAX_ENV_JOBS. Allocated here, pushed to from the message handler only —
     * `_envStep` mutates cursors and never grows it.
     */
    this._envJobs = [];

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
    this._voices = [];
    for (let i = 0; i < MAX_VOICES; i++) this._voices.push(makeVoice(i + 1));
    this._ctrls = [];
    for (let i = 0; i < MAX_CTRLS; i++) this._ctrls.push(makeCtrl(i + 1));
    /**
     * Uploaded response curves, one slot per controller. Null until filled —
     * and a controller pointing at a null slot is refused rather than run
     * unshaped, because a curve that silently stops applying is exactly the
     * silent-feature-loss failure the eligibility rule exists to prevent.
     */
    this._tables = new Array(MAX_TABLES).fill(null);
    /** Echo is opt-in (§8.7) — nobody reads it until the client asks. */
    this._ctrlEcho = false;

    this._slewCoef = 1 - Math.exp(-1 / ((SLEW_MS / 1000) * sampleRate));
    // Bounds glide, in samples. 3 ms is short enough to feel immediate and long
    // enough to hide the 60 Hz staircase a frame-rate controller writes; 0 is
    // exact tracking, which is the right setting for a hand on a value field
    // and the wrong one under an LFO.
    this._glideSamples = Math.round(0.003 * sampleRate);
    this._outGainCur = 1;
    this._outGainTgt = 1;
    this._outGainCtrl = -1;
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
      case '/zone/play/<n>/rate':
        return this._zoneSet('play', idx[0], 'rateTgt', v[0], 'rateCtrl', m.a);
      case '/zone/rec/<n>/dynamic':   return this._zoneSet('rec', idx[0], 'dynamic', !!v[0]);

      // Voices (§4.4, §4.10). Re-sending is an UPDATE, never a restart (rule 4)
      // — every one of these lands as a slew target, so a controller writing
      // the same address every frame is the normal case, not an edit.
      case '/voice/<n>/on':     return this._voiceOn(idx[0], true);
      case '/voice/<n>/off':    return this._voiceOn(idx[0], false);
      case '/voice/<n>/src':    return this._voiceShape(idx[0], 'src', v[0] | 0);
      case '/voice/<n>/wave':   return this._voiceShape(idx[0], 'wave', v[0] | 0);
      // The four bindable voice scalars go through the OWNERSHIP guard — a
      // direct write to a controller-driven target is refused, not silently
      // overwritten a sample later. See `_ctrlOwned`.
      case '/voice/<n>/freq':   return this._voiceSet(idx[0], 'freqTgt', v[0], 'freqCtrl', m.a);
      case '/voice/<n>/fm':     return this._voiceFm(idx[0], v[0], v[1]);
      case '/voice/<n>/colour': return this._voiceSet(idx[0], 'colourTgt', v[0], 'colourCtrl', m.a);
      case '/voice/<n>/filter': return this._voiceFilter(idx[0], v[0], v[1], v[2]);
      case '/voice/<n>/drive':  return this._voiceSet(idx[0], 'driveTgt', v[0], 'driveCtrl', m.a);
      case '/voice/<n>/level':  return this._voiceSet(idx[0], 'levelTgt', v[0], 'levelCtrl', m.a);

      // Worklet-resident controllers (§8.7). Every one of these is a
      // DESCRIPTION: rule 4 makes a re-send an update, and `/retrigger` is the
      // only thing that restarts a wave.
      case '/ctrl/<n>/target':    return this._ctrlTarget(idx[0], v[0]);
      case '/ctrl/<n>/lfo':       return this._ctrlLfo(idx[0], v[0], v[1], v[2], v[3]);
      case '/ctrl/<n>/phase':     return this._ctrlPhase(idx[0], v[0]);
      case '/ctrl/<n>/range':     return this._ctrlRange(idx[0], v[0], v[1], v[2], v[3]);
      case '/ctrl/<n>/retrigger': return this._ctrlRetrigger(idx[0]);
      case '/ctrl/<n>/clear':     return this._ctrlClear(idx[0]);
      case '/table/<n>/data':     return this._tableData(idx[0], v[0]);
      case '/ctrl/<n>/table':     return this._ctrlTable(idx[0], v[0]);
      case '/ctrl/echo':          this._ctrlEcho = !!v[0]; return;

      case '/engine/glide':
        this._glideSamples = Math.max(0, Math.round((v[0] / 1000) * sampleRate));
        return;
      case '/bus/out/gain':
        if (this._ctrlOwned(m.a, this._outGainCtrl)) return;
        this._outGainTgt = v[0];
        return;
      case '/bus/out/limit':     return this._setLimit(v[0], v[1]);

      default: return this._refuse(REFUSE_PROTO_MISMATCH, `unknown address '${m.a}'`);
    }
  }

  /**
   * A voice index outside the allocated set is refused, not clamped. Clamping
   * would make `/voice/9/on` silently start voice 7 — a message that looks
   * accepted and does something else is worse than one that is rejected.
   */
  _voice(i) {
    if (!Number.isInteger(i) || i < 0 || i >= MAX_VOICES) {
      this._refuse(REFUSE_BAD_RANGE, `voice ${i} outside 0..${MAX_VOICES - 1}`);
      return null;
    }
    return this._voices[i];
  }

  _voiceOn(i, on) { const v = this._voice(i); if (v) v.on = !!on; }
  _voiceSet(i, key, value, ctrlField = null, address = '') {
    const v = this._voice(i);
    if (!v) return;
    if (ctrlField && this._ctrlOwned(address, v[ctrlField])) return;
    v[key] = value;
  }

  /**
   * A discrete shape change — source or waveform — ducks the voice first, the
   * same structural treatment `_zonePart` gives a partition change.
   *
   * The `=== value` early-out is the load-bearing line, not an optimisation:
   * without it a controller re-sending the same waveform every frame restarts
   * the duck before it ever completes and the voice never speaks again. That is
   * the failure the zone bounds shipped with once (§4.11); the difference here
   * is that a shape genuinely IS structural, so the answer is to duck on change
   * rather than to stop ducking.
   */
  _voiceShape(i, key, value) {
    const v = this._voice(i);
    if (!v) return;
    if (v[key] === value && !v.pend) return;
    if (!v.on && v.gainCur === 0) { v[key] = value; return; }
    // Stack onto any duck already in flight, so src and wave arriving in the
    // same frame cost one duck rather than two.
    if (!v.pend) { v.pend = true; v.pendSrc = v.src; v.pendWave = v.wave; }
    v[key === 'src' ? 'pendSrc' : 'pendWave'] = value;
  }

  _voiceFm(i, ratio, index) {
    const v = this._voice(i);
    if (!v) return;
    v.fmRatioTgt = ratio;
    v.fmIndexTgt = index;
  }
  _voiceFilter(i, cutoff, res, type) {
    const v = this._voice(i);
    if (!v) return;
    v.cutTgt = cutoff;
    v.resTgt = res;
    v.ftypeTgt = type;
  }

  // ── worklet-resident controllers (§8.7) ───────────────────────────────────

  _ctrl(i) {
    if (!Number.isInteger(i) || i < 0 || i >= MAX_CTRLS) {
      this._refuse(REFUSE_BAD_RANGE, `controller ${i} outside 0..${MAX_CTRLS - 1}`);
      return null;
    }
    return this._ctrls[i];
  }

  /**
   * Point a slot at an engine-side address.
   *
   * **A target is an address whose signature is exactly one float.** That is the
   * whole rule, and it is why the cutoff is not bindable yet: it lives inside
   * `/voice/<n>/filter <fff>`, and inventing a scalar alias for one of three
   * arguments is a vocabulary decision that belongs with the rest of §8.7's
   * description set rather than smuggled in beside it.
   *
   * The address is the ENGINE's own, so nothing about ImWeb travels (rule 3) and
   * there is no slot⇄meaning registry to drift — the address list is the
   * registry, and it is already validated as a whole.
   */
  _ctrlTarget(i, address) {
    const c = this._ctrl(i);
    if (!c) return;
    this._ctrlDetach(i);
    c.kind = TGT_NONE;
    if (!address) return;                        // '' unbinds, and is not an error

    const seg = String(address).split('/');      // '' , 'zone', 'play', '0', 'rate'
    let kind = TGT_NONE, index = 0;
    if (seg[1] === 'zone' && seg[2] === 'play' && seg[4] === 'rate') {
      kind = TGT_ZONE_RATE; index = Number(seg[3]);
    } else if (seg[1] === 'voice' && seg.length === 4) {
      index = Number(seg[2]);
      if (seg[3] === 'freq') kind = TGT_VOICE_FREQ;
      else if (seg[3] === 'level') kind = TGT_VOICE_LEVEL;
      else if (seg[3] === 'colour') kind = TGT_VOICE_COLOUR;
      else if (seg[3] === 'drive') kind = TGT_VOICE_DRIVE;
    } else if (address === '/bus/out/gain') {
      kind = TGT_OUT_GAIN;
    }
    if (kind === TGT_NONE) {
      return this._refuse(REFUSE_PROTO_MISMATCH, `'${address}' is not a controllable target`);
    }
    // Indices are checked HERE rather than at evaluation time: a controller that
    // silently drives nothing is indistinguishable from one whose rate is wrong,
    // and it would be diagnosed as a broken LFO for as long as it took to notice.
    const limit = kind === TGT_ZONE_RATE ? ZONES_PER_TYPE : MAX_VOICES;
    if (kind !== TGT_OUT_GAIN && !(Number.isInteger(index) && index >= 0 && index < limit)) {
      return this._refuse(REFUSE_BAD_RANGE, `'${address}' index out of range`);
    }
    c.kind = kind;
    c.idx = index;
    this._ctrlAttach(i, c);
  }

  /**
   * Is this target owned by a controller? If so, refuse the direct write.
   *
   * The alternative — accept it and let the controller overwrite it a sample
   * later — is last-writer-wins with a 20 µs window, which presents as "the
   * slider does nothing" and produces no message to find. 7b will teach the
   * client not to write owned targets, but that is client discipline, and this
   * protocol does not rely on client discipline anywhere else: `/part/<n>/bounds`
   * is refused while a zone runs rather than trusted not to arrive. Ownership is
   * the same shape of rule and gets the same treatment.
   *
   * Note what is NOT refused: `/ctrl/<n>/…` itself, and `/voice/<n>/on|off`.
   * Owning a value is not owning the voice.
   */
  _ctrlOwned(address, owner) {
    if (!(owner >= 0)) return false;
    this._refuse(REFUSE_CTRL_OWNED, `'${address}' is driven by controller ${owner}`);
    return true;
  }

  /** Write this slot into its target's back-pointer. */
  _ctrlAttach(slot, c) {
    if (c.kind === TGT_ZONE_RATE) this._play[c.idx].rateCtrl = slot;
    else if (c.kind === TGT_VOICE_FREQ) this._voices[c.idx].freqCtrl = slot;
    else if (c.kind === TGT_VOICE_LEVEL) this._voices[c.idx].levelCtrl = slot;
    else if (c.kind === TGT_VOICE_COLOUR) this._voices[c.idx].colourCtrl = slot;
    else if (c.kind === TGT_VOICE_DRIVE) this._voices[c.idx].driveCtrl = slot;
    else if (c.kind === TGT_OUT_GAIN) this._outGainCtrl = slot;
  }

  /**
   * Remove this slot from wherever it points, by SCANNING and matching the slot
   * number rather than by undoing what the controller currently claims.
   *
   * Undoing from `c.kind`/`c.idx` is the tempting version and it is wrong in the
   * one case that matters: bind slot 3 to a voice, then bind slot 5 to the SAME
   * voice, then retarget slot 3. The field now holds 5, and clearing it because
   * slot 3 used to be there silently kills slot 5's controller. Matching the
   * slot cannot get that wrong. Bind time only, so the scan costs nothing where
   * cost matters.
   */
  _ctrlDetach(slot) {
    for (let i = 0; i < this._play.length; i++) {
      if (this._play[i].rateCtrl === slot) this._play[i].rateCtrl = -1;
    }
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (v.freqCtrl === slot) v.freqCtrl = -1;
      if (v.levelCtrl === slot) v.levelCtrl = -1;
      if (v.colourCtrl === slot) v.colourCtrl = -1;
      if (v.driveCtrl === slot) v.driveCtrl = -1;
    }
    if (this._outGainCtrl === slot) this._outGainCtrl = -1;
  }

  /**
   * Shape, rate, width, mode — a DESCRIPTION. Rule 4: re-sending it is an
   * update, so `t` is deliberately untouched here. A receiver that inferred
   * "start over" from "received a description" would turn every unrelated field
   * change into a hidden retrigger, and §8.7 spells out where that becomes
   * audible: a Display State recall retriggers on purpose, and nothing else
   * should.
   */
  _ctrlLfo(i, shape, hz, width, mode) {
    const c = this._ctrl(i);
    if (!c) return;
    if (!(shape >= SHAPE_SINE && shape <= SHAPE_SH)) {
      return this._refuse(REFUSE_BAD_RANGE, `LFO shape ${shape} unknown`);
    }
    c.shape = shape | 0;
    // Clamped, not refused. Rate is a controller target itself one day, and an
    // instrument that stops making sound because a modulated rate touched zero
    // is worse than one that holds still there.
    c.hz = Math.max(0, Math.min(hz, sampleRate * 0.5));
    c.width = Math.max(0.001, Math.min(width, 0.999));
    c.mode = mode === 1 ? 1 : 0;
  }

  /**
   * The phase OFFSET, slid relative — `LFO.setPhase`'s semantics, which move the
   * wave under the playhead rather than jumping the playhead to the start of the
   * cycle. Dragging Phase must not sound like a retrigger; retriggering has its
   * own verb.
   */
  _ctrlPhase(i, phase) {
    const c = this._ctrl(i);
    if (!c) return;
    const next = ((phase % 1) + 1) % 1;
    c.t = ((((c.t + (next - c.phase)) % 1) + 1) % 1);
    c.phase = next;
  }

  /**
   * Fill a response-curve slot. The blob is the same 16384-float array
   * `ResponseCurve` holds client-side — shipped rather than reimplemented, so
   * "one definition of an S-curve" is literal (§8.7).
   *
   * The size is checked because a wrong-length upload would otherwise read as a
   * curve that is merely a strange shape: a 256-point table stretched over a
   * 16384-entry lookup is not an error anywhere, it is just wrong.
   */
  _tableData(i, buffer) {
    if (!Number.isInteger(i) || i < 0 || i >= MAX_TABLES) {
      return this._refuse(REFUSE_BAD_RANGE, `table ${i} outside 0..${MAX_TABLES - 1}`);
    }
    const data = new Float32Array(buffer);
    if (data.length !== TABLE_SIZE) {
      return this._refuse(REFUSE_BAD_RANGE,
        `table ${i} has ${data.length} points, expected ${TABLE_SIZE}`);
    }
    this._tables[i] = data;
  }

  _ctrlTable(i, id) {
    const c = this._ctrl(i);
    if (!c) return;
    if (id < 0) { c.table = -1; return; }
    if (!(Number.isInteger(id) && id < MAX_TABLES && this._tables[id])) {
      // Refused, not ignored. An unfilled slot treated as identity is a
      // response curve that silently stops shaping the sweep — the exact
      // failure the client's eligibility rule refuses to risk.
      return this._refuse(REFUSE_BAD_RANGE, `table ${id} is empty or out of range`);
    }
    c.table = id;
  }

  /** Linear-interpolated lookup — `ResponseCurve.apply`, sample for sample. */
  _tableApply(table, x) {
    const n = x < 0 ? 0 : x > 1 ? 1 : x;
    const f = n * (TABLE_SIZE - 1);
    const i0 = Math.floor(f);
    const i1 = i0 + 1 < TABLE_SIZE ? i0 + 1 : TABLE_SIZE - 1;
    return table[i0] + (table[i1] - table[i0]) * (f - i0);
  }

  _ctrlRange(i, lo, hi, map, invert) {
    const c = this._ctrl(i);
    if (!c) return;
    // Exponential mapping needs endpoints on the same side of zero — it is a
    // ratio sweep, and a ratio through zero has no meaning. Refused rather than
    // silently demoted to linear, because a rate range of -2..2 asking for
    // exponential is a mistake in the client, and hiding it makes the LFO look
    // merely wrong instead of misconfigured.
    if (map === 1 && !(lo > 0 && hi > 0)) {
      return this._refuse(REFUSE_BAD_RANGE, 'exponential range needs both endpoints > 0');
    }
    c.lo = lo;
    c.hi = hi;
    c.map = map === 1 ? 1 : 0;
    c.invert = invert ? 1 : 0;
  }

  /**
   * The one thing that restarts a wave (§8.7). Display State recall sends this
   * explicitly alongside the re-sent descriptions, mirroring what
   * `ControllerManager.retriggerLFOs()` does today — without it the
   * update-not-restart rule would silently drop the recall-retriggers-LFOs
   * behaviour the instrument already has.
   */
  _ctrlRetrigger(i) {
    const c = this._ctrl(i);
    if (!c) return;
    c.t = c.phase;
    c.running = true;
  }

  _ctrlClear(i) {
    const c = this._ctrl(i);
    if (!c) return;
    this._ctrlDetach(i);
    c.kind = TGT_NONE;
    c.t = c.phase;
    c.running = true;
    c.out = 0;
  }

  /** One LFO shape, at phase `t`. Same six as `src/controls/LFO.js`, same order. */
  _ctrlShape(c, t) {
    switch (c.shape) {
      case SHAPE_TRI:    return t < 0.5 ? t * 2 : 2 - t * 2;
      case SHAPE_SAW:    return t;
      case SHAPE_RAMP:   return 1 - t;
      case SHAPE_SQUARE: return t < c.width ? 1 : 0;
      case SHAPE_SH:     return c.shValue;
      default:           return 0.5 + 0.5 * Math.sin(t * 2 * Math.PI);
    }
  }

  /**
   * Fill every live controller's per-sample buffer for this quantum. Runs BEFORE
   * the render, so the values a zone or voice reads are this quantum's, not the
   * previous one's — a one-quantum lag would be exactly the frame of jitter
   * §8.7 exists to remove, just smaller.
   */
  _ctrlStep(frames) {
    const dt = 1 / sampleRate;
    const n = frames > RENDER_QUANTUM ? RENDER_QUANTUM : frames;
    for (let k = 0; k < this._ctrls.length; k++) {
      const c = this._ctrls[k];
      if (c.kind === TGT_NONE) continue;
      for (let i = 0; i < n; i++) {
        if (c.running) {
          const prev = c.t;
          c.t += c.hz * dt;
          if (c.mode === 1) {
            // One-shot ends AT the end of the cycle and stays there — the value
            // holds rather than snapping back, which is what makes it usable as
            // an envelope-shaped gesture on a fader.
            if (c.t >= 1) { c.t = 1; c.running = false; }
          } else {
            if (c.shape === SHAPE_SH && Math.floor(c.t) > Math.floor(prev)) {
              c.shValue = this._rand(c);
            }
            c.t -= Math.floor(c.t);
          }
        }
        let x = this._ctrlShape(c, c.t);
        // Invert FIRST, then the table, then the range — the order
        // `Parameter.setNormalized` uses. It used to be folded into a swapped
        // range instead, which is identical arithmetic while there is no table
        // and wrong the moment there is one: `table(1 − x)` mapped over lo..hi
        // is not `table(x)` mapped over hi..lo.
        if (c.invert) x = 1 - x;
        // The response curve shapes the SWEEP, before the range maps it onto
        // the target's units — the same order as `Parameter.setNormalized`,
        // where the table is applied to the normalized value and the range
        // follows. Reversing the two would make an S-curve mean something
        // different in audio than it does everywhere else in the instrument.
        if (c.table >= 0) x = this._tableApply(this._tables[c.table], x);
        // Exponential is a RATIO sweep: equal fractions of the range are equal
        // musical intervals, which is the same reason pitch is registered in
        // semitones on the client side (LEARNED 2026-08-08).
        c.buf[i] = c.map === 1
          ? c.lo * Math.pow(c.hi / c.lo, x)
          : c.lo + (c.hi - c.lo) * x;
      }
      // Longer-than-128 blocks hold the last value rather than reading past the
      // end of the buffer — see RENDER_QUANTUM.
      for (let i = n; i < frames; i++) c.buf[i] = c.buf[n - 1];
      // PRE-invert and PRE-table, deliberately: the client feeds this straight
      // back through `setNormalized`, which applies both itself. Echoing the
      // shaped value would have them applied twice.
      c.raw = this._ctrlShape(c, c.t);
      c.out = c.buf[n - 1];
    }
  }

  /**
   * The echo (§8.7's inversion): for a controller feeding audio the worklet is
   * authoritative, and the video half and the UI read its value back. One
   * message per frame carrying every live slot (rule 7), never one per slot.
   *
   * Floats rather than §8.8's drafted `[slot:u16, value:f32]` packing — a slot
   * is a small integer a float carries exactly, and the mixed-width version
   * would need a DataView at both ends to save two bytes per slot.
   *
   * TRIPLES, `[slot, raw, mapped]`, because the two consumers want different
   * numbers. A remote client wants the mapped value: 220 Hz, rate 1.5, the
   * thing the engine is actually applying. ImWeb wants the raw 0..1 shape
   * output, because it feeds it back through `setNormalized`, which re-applies
   * the same range, invert and table the client already knows about — handing
   * ImWeb the mapped value would mean inverting a semitone conversion on the
   * way back in, and any disagreement between the two directions would show up
   * as a parameter that drifts while an LFO runs.
   */
  _ctrlFlush() {
    if (!this._ctrlEcho) return;
    let live = 0;
    for (let i = 0; i < this._ctrls.length; i++) if (this._ctrls[i].kind !== TGT_NONE) live++;
    if (!live) return;
    const out = new Float32Array(live * 3);
    let w = 0;
    for (let i = 0; i < this._ctrls.length; i++) {
      const c = this._ctrls[i];
      if (c.kind === TGT_NONE) continue;
      out[w++] = i;
      out[w++] = c.raw;
      out[w++] = c.out;
    }
    this.port.postMessage({ a: '/ctrl/echo/data', t: 'b', v: [out.buffer] }, [out.buffer]);
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
    // Every queued scan indexes the tape that is about to be replaced, so they
    // are settled before it goes. Reusing the cursors against the new buffer
    // would answer a question about material that no longer exists.
    this._envCancel(REFUSE_NO_TAPE);
    this._length = Math.floor(seconds * sampleRate);
    this._tape = [new Float32Array(this._length), new Float32Array(this._length)];
    this._markDirty(0, this._length);
  }

  _panic() {
    this._tape = [];
    this._length = 0;
    this._envCancel(REFUSE_NO_TAPE);
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
    if (this._envJobs.length >= MAX_ENV_JOBS) {
      this.port.postMessage(
        { a: '/tape/env/err', t: 'ii', v: [reqId, REFUSE_BUSY] });
      return this._refuse(REFUSE_BUSY, `${MAX_ENV_JOBS} envelope requests already queued`);
    }
    const a = Math.max(0, Math.min(start, this._length));
    const b = Math.max(a, Math.min(end, this._length));
    const cols = Math.max(1, Math.min(columns | 0, 8192));
    // Accepted here, SCANNED in `_envStep` across as many quanta as it takes.
    // The reply is unchanged either way — chunking is invisible to the client,
    // which already correlates by reqId and drops what it has moved past.
    // `i: -1` means "this column has not been entered yet"; a column's first
    // sample index is derived, never stored, so a job holds no span state that
    // could disagree with `a`/`b`.
    this._envJobs.push({
      reqId, a, b, cols, span: b - a,
      out: new Float32Array(cols * 2),
      c: 0, i: -1, lo: Infinity, hi: -Infinity,
    });
  }

  /**
   * One quantum's worth of envelope scanning, paced by `ENV_READS_PER_QUANTUM`.
   * Resumes MID-COLUMN, not just between columns: at one column per screen pixel
   * a 600-second tape puts ~28 k samples in each, and a 4000-pixel window on a
   * short tape puts fractions of one — neither granularity may be assumed, and a
   * budget that could only stop at a column boundary would be no budget at all
   * on a long tape zoomed out, which is the exact case that motivates this.
   */
  _envStep() {
    const job = this._envJobs[0];
    if (!job) return;
    const chans = this._tape.length;
    let budget = ENV_READS_PER_QUANTUM;
    while (job.c < job.cols) {
      const i0 = job.a + Math.floor((job.c * job.span) / job.cols);
      const i1 = job.c === job.cols - 1
        ? job.b
        : job.a + Math.floor(((job.c + 1) * job.span) / job.cols);
      if (job.i < i0) job.i = i0;
      // The budget counts READS, and every sample index costs one read per
      // channel — so the number of indices this step may advance is the budget
      // divided by the channel count. Spending it as if it were an index count
      // made a stereo scan cost twice what the constant says, which is the kind
      // of factor that only shows up as a dropout on someone else's machine.
      const room = Math.floor(budget / chans);
      const stop = i1 - job.i > room ? job.i + room : i1;
      for (let ch = 0; ch < chans; ch++) {
        const t = this._tape[ch];
        for (let i = job.i; i < stop; i++) {
          const s = t[i];
          if (s < job.lo) job.lo = s;
          if (s > job.hi) job.hi = s;
        }
      }
      budget -= (stop - job.i) * chans;
      job.i = stop;
      if (job.i < i1) return;                    // budget ran out mid-column
      // A column covering no whole sample reports 0/0 rather than ±Infinity:
      // the client draws what it is sent, and Infinity draws as nothing at all
      // on a canvas — a silent gap that looks like missing audio.
      job.out[job.c * 2] = i1 > i0 ? job.lo : 0;
      job.out[job.c * 2 + 1] = i1 > i0 ? job.hi : 0;
      job.lo = Infinity; job.hi = -Infinity;
      job.c++;
      job.i = -1;
      // Yield only if there is more to scan. A bare `if (budget <= 0) return`
      // here spent the last column's overrun on an extra quantum that did
      // nothing but call `_envDone`, which made every "did this take more than
      // one quantum" check pass for an unpaced scanner too.
      if (job.c < job.cols && budget <= 0) return;
    }
    this._envDone(job);
  }

  /** Reply and retire. Separate from `_envStep` so the hot path holds no literal. */
  _envDone(job) {
    this._envJobs.shift();
    this.port.postMessage(
      { a: '/tape/env/data', t: 'iiiib', v: [job.reqId, job.a, job.b, job.cols, job.out.buffer] },
      [job.out.buffer],
    );
  }

  /**
   * Settle every queued request, because their sample indices refer to a tape
   * that is about to stop existing. Silence here would leave `_inflight` in the
   * client holding a promise that never resolves, and that view never asks
   * again — the same wedge the NO_TAPE reply was correlated to avoid.
   */
  _envCancel(code) {
    for (const job of this._envJobs) {
      this.port.postMessage({ a: '/tape/env/err', t: 'ii', v: [job.reqId, code] });
    }
    this._envJobs.length = 0;
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

  _zoneSet(type, i, field, value, ctrlField = null, address = '') {
    const z = this._zone(type, i);
    if (!z) return;
    if (ctrlField && this._ctrlOwned(address, z[ctrlField])) return;
    z[field] = value;
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

  // ── the phase-one generator set (§4.10) ───────────────────────────────────
  //
  // The dividing rule, from §4.10: do NOT rebuild in UGens what the controller
  // layer already does. LFOs, random-with-slew, seven slew curves, response
  // tables, MIDI and device motion are already mapped to every parameter, so a
  // control-rate LFO UGen would be a duplicate with worse ergonomics. What
  // cannot come from frame-rate parameters is AUDIO-rate modulation — FM, AM,
  // ring mod — and that is the only reason any of this is a UGen.
  //
  // Deliberately absent: envelope generators. SC needs them because it is
  // note-based; this instrument has no note-on, and its envelope is a hand on a
  // fader or slew on a parameter, both of which already exist. Also absent:
  // reverb, delay, chorus, compression — downstream effects, not voice
  // components, and the video half already has a pass architecture for them.

  /** xorshift32 → [0,1). Explicit state, so §8.9's fork can copy it. */
  _rand(v) {
    let x = v.rng;
    x ^= x << 13; x >>>= 0;
    x ^= x >> 17;
    x ^= x << 5;  x >>>= 0;
    v.rng = x;
    return x / 4294967296;
  }

  /**
   * PolyBLEP correction at a discontinuity (§4.10: "a naive saw or pulse
   * aliases badly up high; PolyBLEP is the cheap standard answer").
   *
   * A naive saw steps by 2 once per cycle, and a step has energy at every
   * harmonic — all of it above Nyquist folding straight back down. This
   * subtracts a polynomial approximation of the band-limited step across the
   * one sample either side of the jump.
   */
  _blep(t, dt) {
    if (t < dt) { const x = t / dt; return x + x - x * x - 1; }
    if (t > 1 - dt) { const x = (t - 1) / dt; return x * x + x + x + 1; }
    return 0;
  }

  /**
   * The oscillator, with a PHASE INPUT — which is what makes FM and phase
   * distortion free instead of needing their own UGens (§4.10). The modulator
   * is a sine at `fmRatio` times the carrier; index 0 leaves the carrier
   * untouched, so the feature costs nothing when unused.
   */
  _osc(v, dt) {
    // The modulator FREE-RUNS, and only the mod term is gated on the index.
    // Gating the accumulation instead froze `modPhase` the moment the index hit
    // exactly 0, so re-engaging FM resumed the modulator at a stale phase — a
    // timbral jump, and worse, a state advance that depends on a parameter's
    // history, which §8.9's fork would then have to reproduce to stay identical.
    // Same cost either way: one add whether or not FM is engaged.
    v.modPhase += dt * v.fmRatioCur;
    // Floor rather than one subtraction: at the top of both ranges (pitch 120 st
    // ≈ 8.4 kHz, ratio 8) the step exceeds a full cycle, and a single subtract
    // leaves the phase above 1 for good — it then grows without bound and loses
    // resolution to float error. The carrier below cannot reach that, but the
    // invariant should hold by construction, not by range.
    v.modPhase -= Math.floor(v.modPhase);
    const mod = v.fmIndexCur !== 0
      ? Math.sin(2 * Math.PI * v.modPhase) * v.fmIndexCur
      : 0;
    // Phase modulation, not frequency modulation: modulating phase keeps the
    // centre pitch stable as the index moves, which is the difference between
    // an FM timbre and a wobbling one.
    let p = v.phase + mod;
    p -= Math.floor(p);
    let y;
    switch (v.wave) {
      case 1:  y = 2 * p - 1 - this._blep(p, dt); break;                 // saw
      case 2: {                                                          // square
        y = p < 0.5 ? 1 : -1;
        y += this._blep(p, dt);
        let q = p + 0.5; q -= Math.floor(q);
        y -= this._blep(q, dt);
        break;
      }
      // Triangle is naive on purpose: its harmonics fall off as 1/n², so it
      // aliases far less than saw or pulse and does not earn the correction.
      case 3:  y = 1 - 4 * Math.abs(p - 0.5); break;
      default: y = Math.sin(2 * Math.PI * p);                            // sine
    }
    v.phase += dt;
    if (v.phase >= 1) v.phase -= 1;
    return y;
  }

  /**
   * Noise with one colour control (§4.10 asks for exactly one). 0.5 is white;
   * below that a one-pole lowpass darkens it, above that the same pole is
   * subtracted to brighten. Cheapest thing that spans the useful range, and
   * noise is the fastest way to test the whole chain.
   */
  _noise(v) {
    const w = this._rand(v) * 2 - 1;
    v.noiseLp += 0.05 * (w - v.noiseLp);
    const c = v.colourCur;
    if (c < 0.5) return v.noiseLp + (w - v.noiseLp) * (c * 2);
    return w + ((w - v.noiseLp) - w) * ((c - 0.5) * 2);
  }

  /**
   * State-variable filter, TPT/zero-delay form — "one structure yields
   * LP/BP/HP/notch with a morphable type. Worth ten mediocre oscillators."
   *
   * TPT rather than the classic Chamberlin form because Chamberlin's stability
   * limit falls with cutoff: it blows up as the cutoff approaches a fifth of
   * the sample rate, which on a filter that is a controller target is a matter
   * of when, not if. This one is unconditionally stable across the whole range.
   */
  _svf(v, x) {
    const fc = v.cutCur < 20 ? 20 : (v.cutCur > sampleRate * 0.45 ? sampleRate * 0.45 : v.cutCur);
    const g = Math.tan(Math.PI * fc / sampleRate);
    // Resonance as a damping term. Floored so the filter cannot self-oscillate
    // into the limiter — §4.11's ceiling would catch it, but a filter that
    // screams whenever a controller reaches the top of its travel is not a
    // musical instrument, it is a hazard with a knob.
    const k = 2 - 1.98 * (v.resCur < 0 ? 0 : v.resCur > 1 ? 1 : v.resCur);
    const a1 = 1 / (1 + g * (g + k));
    const a2 = g * a1;
    const a3 = g * a2;
    const v3 = x - v.ic2;
    const v1 = a1 * v.ic1 + a2 * v3;
    const v2 = v.ic2 + a2 * v.ic1 + a3 * v3;
    v.ic1 = 2 * v1 - v.ic1;
    v.ic2 = 2 * v2 - v.ic2;
    const lp = v2, bp = v1, hp = x - k * v1 - v2;
    // Morph across LP → BP → HP → notch. A blend rather than a switch, because
    // a discrete type change under a controller is a click, and §4.11 says the
    // worklet is where discontinuities get smoothed.
    const t = v.ftypeCur < 0 ? 0 : v.ftypeCur > 3 ? 3 : v.ftypeCur;
    const i = Math.floor(t);
    const f = t - i;
    // Scalars, not `[lo, hi]` — the first draft of this used an array literal,
    // which is 48000 of them per second per voice: §4.9's inner-loop
    // allocation, arriving through a line that reads as a lookup table.
    const notch = lp + hp;
    let lo, hi;
    if (i === 0) { lo = lp; hi = bp; }
    else if (i === 1) { lo = bp; hi = hp; }
    else if (i === 2) { lo = hp; hi = notch; }
    else { lo = notch; hi = notch; }
    return lo + (hi - lo) * f;
  }

  /**
   * Saturator. "Digital sums are brittle without one. Cheap, and it is most of
   * what 'warmth' means" (§4.10). A Padé approximation of tanh, with the input
   * clamped to the range where that approximation is actually tanh-shaped —
   * beyond ±3 it diverges instead of saturating, which would turn the one stage
   * whose job is to bound things into an amplifier.
   *
   * The makeup division keeps drive from reading as a volume control.
   */
  _sat(x, drive) {
    if (drive <= 0) return x;
    const d = 1 + drive * 9;
    let y = x * d;
    if (y > 3) y = 3; else if (y < -3) y = -3;
    const y2 = y * y;
    return (y * (27 + y2) / (27 + 9 * y2)) / (1 + drive * 2);
  }

  /**
   * One voice, summed into the bus. Every parameter is slewed at audio rate on
   * arrival (§4.11) — the protocol carries targets and the worklet decides how
   * it gets there, because smoothing in the protocol would mean the transport
   * carrying per-sample detail and that defeats §4.1.
   */
  _renderVoice(v, L, R, frames) {
    for (let i = 0; i < frames; i++) {
      // A worklet-resident controller writes BOTH the target and the current
      // value, which lands its output exactly and leaves the follower below
      // with nothing to chase (§8.7).
      //
      // Writing only the target was the first version and it is wrong. §4.11's
      // slew is an 8 ms one-pole — a ~20 Hz lowpass — and it is there to
      // de-zipper values arriving at CONTROL rate. A per-sample controller has
      // no zipper to remove, so all that filter can do is round the edges off a
      // square, drop the depth of anything fast, and phase-shift the rest:
      // the audio-rate precision that justifies this whole section, filtered
      // away by the mechanism it supersedes.
      //
      // Smoothing does not disappear, it MOVES: §8.7 puts slew curve and table
      // in the controller's own description, so a controller that wants a
      // rounded square asks for one. That set is deferred, so today a square
      // arrives square — which is what was asked for.
      if (v.freqCtrl >= 0) v.freqCur = v.freqTgt = this._ctrls[v.freqCtrl].buf[i];
      if (v.levelCtrl >= 0) v.levelCur = v.levelTgt = this._ctrls[v.levelCtrl].buf[i];
      if (v.colourCtrl >= 0) v.colourCur = v.colourTgt = this._ctrls[v.colourCtrl].buf[i];
      if (v.driveCtrl >= 0) v.driveCur = v.driveTgt = this._ctrls[v.driveCtrl].buf[i];
      v.gainTgt = v.on && !v.pend ? 1 : 0;
      v.gainCur = this._approach(v.gainCur, v.gainTgt);
      if (v.gainCur === 0) {
        if (v.pend) {                              // bottom of the duck: apply
          v.src = v.pendSrc; v.wave = v.pendWave; v.pend = false;
        }
        if (!v.on) return;
      }
      v.freqCur = this._approach(v.freqCur, v.freqTgt);
      v.fmRatioCur = this._approach(v.fmRatioCur, v.fmRatioTgt);
      v.fmIndexCur = this._approach(v.fmIndexCur, v.fmIndexTgt);
      v.colourCur = this._approach(v.colourCur, v.colourTgt);
      v.cutCur = this._approach(v.cutCur, v.cutTgt);
      v.resCur = this._approach(v.resCur, v.resTgt);
      v.ftypeCur = this._approach(v.ftypeCur, v.ftypeTgt);
      v.driveCur = this._approach(v.driveCur, v.driveTgt);
      v.levelCur = this._approach(v.levelCur, v.levelTgt);

      const dt = v.freqCur / sampleRate;
      let x = v.src === 1 ? this._noise(v) : this._osc(v, dt);
      x = this._svf(v, x);
      x = this._sat(x, v.driveCur);
      x *= v.levelCur * v.gainCur;
      L[i] += x;
      if (R !== L) R[i] += x;
    }
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
      // Both, so the value lands exactly — see the note in `_renderVoice`.
      if (z.rateCtrl >= 0) z.rateCur = z.rateTgt = this._ctrls[z.rateCtrl].buf[i];
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

      // Wrap SYMMETRICALLY, and by modulo rather than by one subtraction. A
      // single `+= room` bounds the negative side only while |rate| < room, so a
      // fast reverse read of a region a couple of samples long walked the phase
      // steadily negative — harmless in itself, since `_cubic` wraps every index
      // it derives and doubles have the headroom, but it left the invariant
      // `phase ∈ [0, room)` true only because the pre-check above happened to
      // restore it on the positive side. Half an invariant is worse than none:
      // the next reader trusts it here and is wrong.
      z.phase += z.rateCur;
      if (z.phase >= room || z.phase < 0) {
        z.phase %= room;
        if (z.phase < 0) z.phase += room;
      }
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
      if (this._outGainCtrl >= 0) {
        this._outGainCur = this._outGainTgt = this._ctrls[this._outGainCtrl].buf[i];
      }
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

    // Controllers first: everything below reads their buffers, and a value
    // computed after the render would be a quantum late — the same jitter §8.7
    // exists to remove, one order of magnitude down.
    this._ctrlStep(frames);

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

    // OUTSIDE the tape guard, deliberately. A Voice has no buffer region
    // (§4.4), so it must sound with no tape allocated — putting this inside
    // would make the generators silent until someone happened to allocate a
    // tape, which is a dependency the architecture explicitly does not have.
    for (let i = 0; i < this._voices.length; i++) {
      const v = this._voices[i];
      if (v.on || v.gainCur > 0) this._renderVoice(v, L, R, frames);
    }

    this._limit(L, R, frames);

    // AFTER the audio work, and budgeted: an envelope scan is bulk reading for
    // the display, so it may take as many quanta as it needs but may never make
    // one of them late (§8.3).
    if (this._envJobs.length) this._envStep();

    if (++this._quanta >= this._quantaPerFlush) {
      this._quanta = 0;
      this._flushDirty();
      this._ctrlFlush();
    }
    return true;
  }
}

registerProcessor('imweb-tape', TapeProcessor);
