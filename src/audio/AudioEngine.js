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
