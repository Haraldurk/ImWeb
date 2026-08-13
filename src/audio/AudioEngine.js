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

    this._mic = null;
    this._micStream = null;

    this._nextReqId = 1;
    /** view key → { reqId, resolve } for the single outstanding request. */
    this._inflight = new Map();
    /** view key → pending args, collapsed to the newest while one is in flight. */
    this._queued = new Map();
    this._ready = null;
  }

  /**
   * Must be called from a user gesture — browsers start an AudioContext
   * suspended otherwise, and the handshake below would never complete.
   */
  async start() {
    if (this.ctx) return this._ready;

    this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    await this.ctx.audioWorklet.addModule(workletUrl);

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

    this._ready = new Promise((resolve, reject) => {
      this._onReady = resolve;
      // A handshake that never answers is a hang, and a hang during load reads
      // as "the app is broken" rather than "the engine refused".
      setTimeout(() => reject(new Error('engine did not answer /engine/hello')), 5000);
    });
    this._send('/engine/hello', PROTO_VERSION);
    return this._ready;
  }

  async close() {
    if (!this.ctx) return;
    this._send('/engine/panic');
    this.node?.disconnect();
    await this.ctx.close();
    this.ctx = this.node = null;
    this._ready = null;
  }

  // ── commands (client → engine, imperative per rule 6) ─────────────────────

  allocTape(seconds) { this._send('/engine/tape/alloc', seconds); }

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
    const stream = await navigator.mediaDevices.getUserMedia({ audio: constraints });
    this._micStream = stream;
    this._mic = this.ctx.createMediaStreamSource(stream);
    this._mic.connect(this.node);
    return stream;
  }

  closeMic() {
    this._mic?.disconnect();
    this._micStream?.getTracks().forEach((t) => t.stop());
    this._mic = this._micStream = null;
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
      case '/tape/env/dirty':
        this.onDirty?.(m.v[0], m.v[1]);
        return;
      default:
        return;
    }
  }

  _send(address, ...args) {
    const { msg, transfer } = encode(address, ...args);
    this.node.port.postMessage(msg, transfer);
  }
}
