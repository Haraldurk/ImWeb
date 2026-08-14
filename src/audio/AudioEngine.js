/**
 * The client half of §4.1 — owns the AudioContext, loads the engine, and speaks
 * §8.8 over the message port.
 *
 * Deliberately knows nothing about ParameterSystem. Binding parameters to
 * engine-side targets happens a layer above this, through opaque integer slots
 * (§8.8 rule 3), so no ImWeb identifier ever reaches the worklet. If `ps.get()`
 * ever appears in this file or below it, the boundary has gone fake.
 *
 * One AudioContext, owned here (§8.6).
 */

import workletUrl from './engine/tape-processor.js?url';
import { PROTO_VERSION, REFUSE, encode } from './protocol.js';

/**
 * Tap points (§8.6). **Signals, never storage** — you cannot tap a partition,
 * because nothing flows out of one until a Playback Zone reads it.
 *
 * Deliberately NOT protocol addresses: both points are nodes on the client's
 * side of the message port, so selecting between them is Web Audio routing and
 * never a message. Zone and voice outputs join this list when the worklet grows
 * per-zone outputs — it declares one today — and the selection stays client-side
 * even then.
 */
export const TAP = { MIC: 0, MASTER: 1 };

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.sampleRate = 0;
    this.maxTapeSeconds = 0;

    /** Called with (start, end) when the engine reports written tape. */
    this.onDirty = null;
    /** Called with (code, message) on `/engine/refuse`. */
    this.onRefuse = null;
    /** Called with (zoneIndex, lengthSamples) after a dynamic recording stops. */
    this.onRecLength = null;
    /** Called with (type, zoneIndex, running) when the ENGINE changes a zone's state. */
    this.onZoneState = null;

    this._mic = null;
    this._micStream = null;

    /**
     * The §8.6 analyser tap: a signal, selected, that consumers hang their own
     * analysers off. A GainNode rather than an AnalyserNode because the two
     * consumers want different analysis — `ControllerManager` one 512-point
     * FFT, `VectorscopeInput` a stereo splitter into two 2048-point ones — and
     * an engine that owned one analyser would be dictating the resolution of
     * every future reader.
     *
     * **It is never connected to `destination`, and that is load-bearing.**
     * Tapping the mic must not make the mic audible: §8.1's loop is meant to
     * close acoustically through the room, where the performer can hear it
     * coming, not electrically inside the graph where nothing can be done about
     * it. An AnalyserNode is pulled even with no downstream connection, which
     * is what makes a terminal branch work at all.
     */
    this.tap = null;
    this._tapSrc = TAP.MIC;
    this._tapFrom = null;
    /**
     * `addModule()` cannot be undone (§4.9), and registering the same processor
     * name twice throws — so a restart on a surviving context must not repeat
     * it. This is that memory.
     */
    this._moduleAdded = false;

    this._nextReqId = 1;
    /** view key → { reqId, resolve } for the single outstanding request. */
    this._inflight = new Map();
    /** view key → pending args, collapsed to the newest while one is in flight. */
    this._queued = new Map();

    this._nextJobId = 1;
    /** job id → resolve, for paced renders (§8.3). */
    this._jobs = new Map();
    /** job id → payload that arrived before the job's terminal message. */
    this._jobData = new Map();
    /** Called with (jobId, samplesDone, samplesTotal) at frame cadence. */
    this.onJobProgress = null;

    this._ready = null;
  }

  /**
   * **The one AudioContext (§8.6), and the only `new AudioContext` in the app.**
   * Two contexts mean two clocks, so what the instrument hears and what it plays
   * drift apart — and §3's coupling claim dies with them.
   * `tests/audit-audio-protocol.mjs` fails if a second construction appears.
   *
   * Deliberately does NOT resume. §8.6 called this out as the boot-ordering
   * detail the decision creates: a consumer may want the context before any user
   * gesture has happened, and a context that exists but is suspended is a
   * perfectly good thing to hand it — analysers attached now start reading the
   * moment `start()` resumes. What is NOT safe is treating suspended as working,
   * which is why `start()` is the only caller that resumes and why the liveness
   * proof in `AudioBinding` exists.
   */
  context() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      this.tap = this.ctx.createGain();
    }
    return this.ctx;
  }

  /** Is the one microphone open? Asked by consumers before they route to it. */
  get micOpen() { return !!this._mic; }

  /** Which signal the tap carries. @param {number} which a `TAP` value. */
  setTap(which) {
    this._tapSrc = which;
    this._routeTap();
  }

  _routeTap() {
    if (!this.tap) return;
    // Disconnect only the edge INTO the tap. `this.tap.disconnect()` would drop
    // the consumers hanging off it instead, which is the mistake that turns a
    // tap change into permanently dead sound controllers.
    try { this._tapFrom?.disconnect(this.tap); } catch { /* already gone */ }
    this._tapFrom = this._tapSrc === TAP.MASTER ? this.node : this._mic;
    // Post-limiter by choice (§8.6): the video response then visibly flattens
    // when §4.11's ceiling engages, so the picture tells you the limiter is
    // working. `this.node` IS the limiter's output — the bus is inside it.
    this._tapFrom?.connect(this.tap);
  }

  /**
   * Must be called from a user gesture — browsers start an AudioContext
   * suspended otherwise, and the handshake below would never complete.
   *
   * Restartable: after `close()` the context and the registered module survive,
   * so this builds a fresh worklet NODE on them. That is a fresh processor and
   * therefore a fresh, empty tape — the same thing Audio Off has always meant.
   */
  async start() {
    if (this.node) return this._ready;

    this.context();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    // Cache-bust the processor in dev. `addModule()` fetches a stable URL and
    // the browser caches worklet modules hard, so editing the processor and
    // reloading can silently keep running the PREVIOUS one — and a worklet that
    // is one version behind looks like a fix that did not work, not like a
    // stale module. Cost an hour once already. Production keeps the plain URL:
    // `vite build` gives it a content hash, which is the correct buster.
    if (!this._moduleAdded) {
      const url = import.meta.env?.DEV
        ? `${workletUrl}${workletUrl.includes('?') ? '&' : '?'}v=${Date.now()}`
        : workletUrl;
      await this.ctx.audioWorklet.addModule(url);
      this._moduleAdded = true;
    }

    this.node = new AudioWorkletNode(this.ctx, 'imweb-tape', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });
    this.node.port.onmessage = (e) => this._receive(e.data);
    // A throw inside process() makes Chrome stop calling it PERMANENTLY, and
    // nothing else reports that: the port keeps answering, so every
    // message-based check still passes while the engine is dead. Silence is the
    // worst failure mode an audio engine has — surface it.
    this.node.onprocessorerror = (e) => {
      this.processorDead = true;
      this.onProcessorError?.(e);
    };
    this.node.connect(this.ctx.destination);
    // A mic opened before the engine started has nowhere to record to until
    // now. Without this, turning the mic on and THEN turning Audio on gives a
    // recording zone that captures silence — with every status message green.
    this._mic?.connect(this.node);
    this._routeTap();

    this._ready = new Promise((resolve, reject) => {
      this._onReady = resolve;
      // A handshake that never answers is a hang, and a hang during load reads
      // as "the app is broken" rather than "the engine refused".
      setTimeout(() => reject(new Error('engine did not answer /engine/hello')), 5000);
    });
    this._send('/engine/hello', PROTO_VERSION);
    return this._ready;
  }

  /**
   * Release the sound card without destroying the context.
   *
   * **Suspend, not close** — and the difference is §8.6's whole point. Closing
   * would take the one context down with the engine, leaving every consumer
   * attached to a dead graph: sound-reactive controllers reading zeros, the
   * vectorscope frozen, and no error anywhere, because reading a closed
   * context's analyser does not throw. A suspended context renders nothing and
   * holds no device callback, which is what Audio Off is actually asking for,
   * and the consumers' nodes stay valid across it.
   *
   * The tape does not survive: the processor is discarded with the node, so the
   * next `start()` gets an empty one. That is unchanged behaviour — Audio Off
   * has always discarded recordings.
   */
  async close() {
    if (!this.ctx) return;
    if (this.node) {
      this._send('/engine/panic');
      this.node.disconnect();
      this.node.port.onmessage = null;
      this.node = null;
    }
    this._routeTap();          // a MASTER tap now has nothing upstream
    this._ready = null;
    // Resolve rather than drop: an envelope request outstanding at Audio Off
    // has no answer coming, and a Map.clear() here leaves the waveform display
    // awaiting a promise that can never settle. `null` is already this API's
    // word for "no envelope, not an error".
    for (const [, cur] of this._inflight) cur.resolve(null);
    for (const [, q] of this._queued) q.resolve(null);
    this._inflight.clear();
    this._queued.clear();
    // Same rule for renders, and it matters more: a render promise is what a UI
    // keeps its Render button disabled on, so one left unsettled at Audio Off
    // is a control that never comes back. It resolves as a refusal rather than
    // `null`, because unlike a superseded envelope this really did fail.
    for (const [, settle] of this._jobs) {
      settle({ ok: false, code: REFUSE.CANCELLED, message: 'the engine stopped' });
    }
    this._jobs.clear();
    this._jobData.clear();
    if (this.ctx.state === 'running') await this.ctx.suspend();
  }

  // ── commands (client → engine, imperative per rule 6) ─────────────────────

  allocTape(seconds) { this._send('/engine/tape/alloc', seconds); }

  /** Milliseconds for a zone's bounds to reach a new target; 0 = exact. */
  glide(ms) { this._send('/engine/glide', ms); }

  /**
   * Route the microphone into the engine's input.
   *
   * **§8.1: this makes `mic → tape → monitors → mic` the instrument's default
   * state, not an edge case.** The mic is connected to the worklet's INPUT
   * only — it is never passed through to the destination — so the loop closes
   * acoustically through the room rather than electrically inside the graph.
   * That is the difference between a feedback instrument and a howl, and it is
   * still a room loop: use headphones until the monitoring discipline (§8.6)
   * has a UI.
   */
  async openMic(constraints = { echoCancellation: false, noiseSuppression: false, autoGainControl: false }) {
    if (this._mic) return this._micStream;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this._micStream = stream;
    // `context()`, not `this.ctx`: the engine need not be running. A consumer
    // that only wants to ANALYSE the mic (the sound-reactive controllers) has
    // always been able to do that without an engine, and taking it away would
    // be a regression dressed as a cleanup.
    this._mic = this.context().createMediaStreamSource(stream);
    if (this.node) this._mic.connect(this.node);
    this._routeTap();
    return stream;
  }

  closeMic() {
    this._mic?.disconnect();
    this._micStream?.getTracks().forEach((t) => t.stop());
    this._mic = this._micStream = null;
    this._routeTap();          // a MIC tap now has nothing upstream
  }

  // Partitions (§4.3) — layout is a setup act and is refused while a zone
  // bound to the slot is running.
  partBounds(slot, start, len) { this._send(`/part/${slot}/bounds`, start | 0, len | 0); }
  partClear(slot) { this._send(`/part/${slot}/clear`); }

  // Zones (§4.4). Regions are partition-relative, in samples.
  zonePart(type, i, slot) { this._send(`/zone/${type}/${i}/part`, slot | 0); }
  zoneRegion(type, i, startRel, lenRel) {
    this._send(`/zone/${type}/${i}/region`, startRel, lenRel);
  }
  zoneUnsafe(type, i, on) { this._send(`/zone/${type}/${i}/unsafe`, !!on); }
  zoneOn(type, i) { this._send(`/zone/${type}/${i}/on`); }
  zoneOff(type, i) { this._send(`/zone/${type}/${i}/off`); }
  playRate(i, rate) { this._send(`/zone/play/${i}/rate`, rate); }
  recDynamic(i, on) { this._send(`/zone/rec/${i}/dynamic`, !!on); }

  // Voices (§4.4, §4.10). No buffer region, so they sound with no tape.
  voiceOn(i) { this._send(`/voice/${i}/on`); }
  voiceOff(i) { this._send(`/voice/${i}/off`); }
  voiceSrc(i, src) { this._send(`/voice/${i}/src`, src | 0); }
  voiceWave(i, wave) { this._send(`/voice/${i}/wave`, wave | 0); }
  voiceFreq(i, hz) { this._send(`/voice/${i}/freq`, hz); }
  voiceFm(i, ratio, index) { this._send(`/voice/${i}/fm`, ratio, index); }
  voiceColour(i, c) { this._send(`/voice/${i}/colour`, c); }
  voiceFilter(i, cutoffHz, res, type) {
    this._send(`/voice/${i}/filter`, cutoffHz, res, type);
  }
  voiceDrive(i, d) { this._send(`/voice/${i}/drive`, d); }
  voiceLevel(i, l) { this._send(`/voice/${i}/level`, l); }

  // Worklet-resident controllers (§8.7). The client describes; the engine
  // evaluates, at audio rate, on the thread a hidden tab cannot suspend.
  //
  // `slot` is the opaque integer rule 3 requires and `address` is the ENGINE's
  // own — `/zone/play/0/rate`, not `aplay.rate`. A target must be an address
  // whose signature is exactly one float; the engine refuses anything else.
  ctrlTarget(slot, address) { this._send(`/ctrl/${slot}/target`, address || ''); }
  ctrlLfo(slot, shape, hz, width, mode) {
    this._send(`/ctrl/${slot}/lfo`, shape | 0, hz, width, mode | 0);
  }
  ctrlPhase(slot, phase) { this._send(`/ctrl/${slot}/phase`, phase); }
  ctrlRange(slot, lo, hi, map = 0, invert = 0) {
    this._send(`/ctrl/${slot}/range`, lo, hi, map | 0, invert ? 1 : 0);
  }
  /** @param {Float32Array} points the 16384 a `ResponseCurve` already holds. */
  tableData(slot, points) { this._send(`/table/${slot}/data`, points); }
  ctrlTable(slot, id) { this._send(`/ctrl/${slot}/table`, id | 0); }
  /** mode: 0 none, 1 lag, 2 ease, 3 elastic, 4 segment curve. */
  ctrlSlew(slot, mode, seconds, damp = 0.45, strength = 1) {
    this._send(`/ctrl/${slot}/slew`, mode | 0, seconds, damp, strength);
  }
  ctrlSlewFit(slot, curve, min, max, under, over, k0) {
    this._send(`/ctrl/${slot}/slewfit`, curve | 0, min, max, under, over, k0);
  }
  /** The ONLY restart. Everything else is an update (rule 4). */
  ctrlRetrigger(slot) { this._send(`/ctrl/${slot}/retrigger`); }
  ctrlClear(slot) { this._send(`/ctrl/${slot}/clear`); }
  /** Ask for values back — §8.7's inversion. Off by default. */
  ctrlEcho(on) { this._send('/ctrl/echo', !!on); }

  // Output bus (§4.11). Note the absence of a bypass — there is no address for
  // one, and that is the enforcement.
  outGain(g) { this._send('/bus/out/gain', g); }
  outLimit(threshold, releaseSeconds) {
    this._send('/bus/out/limit', threshold, releaseSeconds);
  }

  /** @param {Float32Array} samples interleaved for `channels` channels. */
  write(startSample, channels, samples) {
    this._send('/tape/write', startSample, channels, samples);
  }

  // ── the spectral writer (§4.5) ────────────────────────────────────────────

  /** @param {Float32Array} hz one frequency per image row, ascending. */
  specPitches(slot, hz) { this._send(`/spec/${slot}/pitches`, hz); }
  /** @param {Float32Array} mag frame-major: `rows` magnitudes per frame. */
  specData(slot, rows, frames, mag) {
    this._send(`/spec/${slot}/data`, rows | 0, frames | 0, mag);
  }
  specClear(slot) { this._send(`/spec/${slot}/clear`); }

  /**
   * Start a paced render (§8.3) and hand back a promise for its outcome.
   *
   * The job id is minted HERE rather than by the caller, for the reason the
   * envelope path mints reqIds here: two callers picking their own would
   * eventually pick the same one, and the correlated error that exists to stop
   * a client wedging would then settle the wrong promise.
   *
   * Resolves `{ok:true}` on `/job/<n>/done` and `{ok:false, code, message}` on
   * `/job/<n>/error` — never rejects. A refused render is an ordinary answer
   * (the region left the partition, another render is running), not an
   * exception, and making callers try/catch around a normal outcome is how a
   * refusal ends up swallowed.
   */
  render(type, i, slot, startRel, lengthSamples) {
    const jobId = this._nextJobId++;
    const done = new Promise((resolve) => this._jobs.set(jobId, resolve));
    this._send(`/zone/${type}/${i}/render`, slot | 0, startRel, lengthSamples | 0, jobId);
    return { jobId, done };
  }

  cancelJob(jobId) { this._send(`/job/${jobId}/cancel`); }

  // ── the corpus index (§4.6) ───────────────────────────────────────────────

  /**
   * Measure a span of tape. Resolves like `render` does, except that the
   * payload rides ON the resolution: `/corpus/data` arrives first and is
   * stashed against the job id, so `{ok:true, data}` hands the caller the
   * table without a second callback to sequence against.
   */
  analyseCorpus(startSample, endSample, hopSamples, windowSamples) {
    const jobId = this._nextJobId++;
    const done = new Promise((resolve) => this._jobs.set(jobId, resolve));
    this._send('/corpus/analyse',
      startSample | 0, endSample | 0, hopSamples | 0, windowSamples | 0, jobId);
    return { jobId, done };
  }

  grainPart(i, slot) { this._send(`/zone/grain/${i}/part`, slot | 0); }
  grainUnsafe(i, on) { this._send(`/zone/grain/${i}/unsafe`, !!on); }
  grainOn(i) { this._send(`/zone/grain/${i}/on`); }
  grainOff(i) { this._send(`/zone/grain/${i}/off`); }
  grainPos(i, samples) { this._send(`/zone/grain/${i}/pos`, samples); }
  grainSize(i, samples) { this._send(`/zone/grain/${i}/size`, samples); }
  grainRate(i, perSecond) { this._send(`/zone/grain/${i}/rate`, perSecond); }
  grainPitch(i, ratio) { this._send(`/zone/grain/${i}/pitch`, ratio); }
  grainSpray(i, samples) { this._send(`/zone/grain/${i}/spray`, samples); }
  grainLevel(i, level) { this._send(`/zone/grain/${i}/level`, level); }

  /**
   * Ask for an envelope over an explicit span. **Never resample a envelope you
   * already hold into a different resolution — ask** (§6 item 6): min/max is not
   * an average, so a reconstructed zoom invents peaks that were never there.
   *
   * One outstanding request per `view`. A zoom drag emits a request per frame
   * otherwise, and the engine is not the place to absorb that. Superseded
   * requests resolve to `null` rather than rejecting — being overtaken during a
   * drag is the normal case, not an error.
   *
   * @returns {Promise<{reqId:number,start:number,end:number,columns:number,data:Float32Array}|null>}
   */
  requestEnvelope(start, end, columns, view = 'main') {
    if (this._inflight.has(view)) {
      const prev = this._queued.get(view);
      prev?.resolve(null);
      return new Promise((resolve) => {
        this._queued.set(view, { args: [start, end, columns], resolve });
      });
    }
    return this._issue(view, start, end, columns);
  }

  _issue(view, start, end, columns) {
    const reqId = this._nextReqId++;
    const p = new Promise((resolve) => this._inflight.set(view, { reqId, resolve }));
    this._send('/tape/env/req', start | 0, end | 0, columns | 0, reqId);
    return p;
  }

  // ── replies (engine → client, observational) ──────────────────────────────

  _receive(m) {
    // Indexed addresses cannot be switch labels, so they are matched first.
    const recLen = /^\/zone\/rec\/(\d+)\/length$/.exec(m.a);
    if (recLen) return this.onRecLength?.(Number(recLen[1]), m.v[0]);

    const zState = /^\/zone\/([a-z]+)\/(\d+)\/state$/.exec(m.a);
    if (zState) return this.onZoneState?.(zState[1], Number(zState[2]), !!m.v[0]);

    // Paced jobs (§8.3). Exactly one of done/error settles the promise, and the
    // entry is deleted first so a duplicate terminal message cannot resolve a
    // job id that has since been reused.
    const job = /^\/job\/(\d+)\/(progress|done|error)$/.exec(m.a);
    if (job) {
      const id = Number(job[1]);
      if (job[2] === 'progress') return this.onJobProgress?.(id, m.v[0], m.v[1]);
      const settle = this._jobs.get(id);
      this._jobs.delete(id);
      const payload = this._jobData.get(id);
      this._jobData.delete(id);
      settle?.(job[2] === 'done'
        ? { ok: true, data: payload ?? null }
        : { ok: false, code: m.v[0], message: m.v[1] });
      return;
    }

    switch (m.a) {
      case '/engine/ready': {
        const [proto, rate, maxSec] = m.v;
        if (proto !== PROTO_VERSION) {
          this.onRefuse?.(REFUSE.PROTO_MISMATCH, `engine speaks ${proto}`);
          return;
        }
        this.sampleRate = rate;
        this.maxTapeSeconds = maxSec;
        this._onReady?.(this);
        return;
      }
      case '/engine/refuse':
        this.onRefuse?.(m.v[0], m.v[1]);
        return;
      case '/tape/env/data': {
        const [reqId, start, end, columns, blob] = m.v;
        for (const [view, cur] of this._inflight) {
          if (cur.reqId !== reqId) continue;       // stale: the view moved on
          this._inflight.delete(view);
          cur.resolve({ reqId, start, end, columns, data: new Float32Array(blob) });
          const next = this._queued.get(view);
          if (next) {
            this._queued.delete(view);
            this._issue(view, ...next.args).then(next.resolve);
          }
          return;
        }
        return;
      }
      case '/tape/env/err': {
        const [reqId] = m.v;
        for (const [view, cur] of this._inflight) {
          if (cur.reqId !== reqId) continue;
          this._inflight.delete(view);
          cur.resolve(null);
          const next = this._queued.get(view);
          if (next) {
            this._queued.delete(view);
            this._issue(view, ...next.args).then(next.resolve);
          }
          return;
        }
        return;
      }
      case '/tape/env/dirty':
        this.onDirty?.(m.v[0], m.v[1]);
        return;
      case '/corpus/data': {
        // Stashed against the job id rather than delivered by callback: the
        // terminal `/job/<n>/done` follows immediately, and holding it here
        // means one promise carries both "it finished" and "here it is". A
        // separate callback would make every caller sequence two events that
        // the engine already guarantees the order of.
        const [jobId, start, hop, count, blob] = m.v;
        this._jobData.set(jobId, { start, hop, count, raw: new Float32Array(blob) });
        return;
      }
      case '/ctrl/echo/data': {
        // One message per frame carrying every live slot (rule 7). Handed over
        // as the flat [slot, value, …] pairs it arrived as: the consumer knows
        // which slots it allocated, and building a Map here would allocate one
        // per frame for a caller that is about to iterate it once anyway.
        if (this.onCtrlEcho) this.onCtrlEcho(new Float32Array(m.v[0]));
        return;
      }
      default:
        return;
    }
  }

  _send(address, ...args) {
    const { msg, transfer } = encode(address, ...args);
    this.node.port.postMessage(msg, transfer);
  }
}
