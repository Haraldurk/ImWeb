/**
 * ParameterSystem ⇄ AudioEngine. The only place the two halves touch.
 *
 * §4.1's test is *could you delete every line of ImWeb UI and still drive a
 * working sound engine from a script?* This file is the answer's edge: it is
 * the ONLY module that imports both `ps` and the engine, and everything below
 * it — `AudioEngine`, `protocol.js`, the worklet — stays ImWeb-free. Adding an
 * `import { ... } from '../controls/...'` to any of those makes the boundary
 * fake; `tests/audit-audio-protocol.mjs` fails if one appears.
 *
 * §8.8 rule 3 says no ImWeb identifier crosses the boundary, and the mechanism
 * here is translation, not transport: `aplay.rate` is turned into
 * `/zone/play/0/rate` locally and the string `aplay.rate` never leaves this
 * file. (The opaque-slot table rule 3 also describes belongs with worklet-side
 * controller evaluation — §8.7 — which does not exist yet. Nothing here needs
 * it, and pretending otherwise would be a slot allocator with one caller.)
 *
 * Unit translation lives here too, deliberately. Params are fractions of a
 * partition (§4.3 — a captured layout must mean the same thing on a machine
 * whose tape is a different length); the engine wants samples. One conversion
 * site, not one per call.
 */

import { AudioEngine } from './AudioEngine.js';

const PARTITION_SLOTS = 4;

export class AudioBinding {
  /**
   * @param {object} ps ParameterSystem
   */
  constructor(ps) {
    this.ps = ps;
    this.engine = new AudioEngine();
    this.running = false;
    this._unsubs = [];
    /** Set by main.js to surface refusals and errors in the UI. */
    this.onStatus = null;
  }

  _say(msg) { this.onStatus?.(msg); }

  /**
   * Must be called from a user gesture — an AudioContext started without one
   * stays suspended, and a suspended context is indistinguishable from a
   * working one over the message port (LEARNED 2026-08-13).
   */
  async start() {
    if (this.running) return;
    this.engine.onRefuse = (code, m) => this._say(`audio refused (${code}): ${m}`);
    // A dynamic recording resolves its own length; without this the engine
    // reports it and nobody listens, so arec.len keeps the length that was
    // DECLARED and the next playback reads past the end of what was captured.
    this.engine.onRecLength = (i, lenSamples) => {
      if (i !== 0) return;                     // only zone 0 is exposed today
      const n = this._tapeLen;
      const slot = this.ps.get('arec.part').value;
      const partLen = Math.floor(this.ps.get(`apart${slot}.len`).value * n);
      if (partLen > 0) this.ps.set('arec.len', lenSamples / partLen);
    };
    // The engine stops a dynamic recording at the seam on its own. Reflect that
    // in the param, with a guard: writing it fires onChange, which would send
    // the state straight back and make an engine-side fact into a round trip.
    this.engine.onZoneState = (type, i, running) => {
      if (i !== 0) return;
      const id = type === 'rec' ? 'arec.on' : 'aplay.on';
      this._fromEngine = true;
      try { this.ps.set(id, running ? 1 : 0); } finally { this._fromEngine = false; }
    };
    this.engine.onProcessorError = () => this._say(
      'AUDIO ENGINE DIED — process() will not run again; reload to recover');

    await this.engine.start();
    this.running = true;

    // Do not report "running" on faith. A handshake proves the message port
    // works, which is a much weaker claim than it looks: with no output device
    // the render thread never pulls, so process() is never called while
    // AudioContext.state still reads 'running' and every message is answered
    // normally (LEARNED 2026-08-13). `/tape/env/dirty` is flushed from the
    // audio callback and nowhere else, so the allocation below doubles as the
    // liveness proof — telling a performer the engine is up when it is silent
    // is the one status message that must never be wrong.
    const alive = new Promise((resolve) => {
      // Save and restore the ENGINE's handler. Reading this.onDirty saved
      // `undefined` from the binding and then installed that over whatever the
      // real consumer (the waveform display) had registered.
      const prev = this.engine.onDirty;
      this.engine.onDirty = (a, b) => { this.engine.onDirty = prev; resolve(true); };
      setTimeout(() => resolve(false), 3000);
    });

    this.engine.allocTape(this.ps.get('audio.tapeSec').value);
    this._pushLayout();
    this._pushAll();
    this._subscribe();

    if (await alive) {
      this._say(`audio running at ${this.engine.sampleRate} Hz`);
    } else {
      this._say('ENGINE LOADED BUT SILENT — the audio callback never ran. '
        + 'No output device, or the browser was started with audio disabled.');
    }
  }

  async stop() {
    if (!this.running) return;
    this._unsubs.forEach((u) => u());
    this._unsubs = [];
    this.engine.closeMic();
    await this.engine.close();
    this.running = false;
    // A fresh engine for the next start: AudioEngine holds a closed
    // AudioContext and a resolved handshake promise, neither of which can be
    // reused, and addModule() cannot be undone on a context anyway.
    this.engine = new AudioEngine();
  }

  // ── translation ───────────────────────────────────────────────────────────

  get _tapeLen() { return Math.floor(this.ps.get('audio.tapeSec').value * this.engine.sampleRate); }

  /**
   * Is a zone bound to this partition running? Mirrors the engine's own refusal
   * (§4.3, layout is a setup act). Checked HERE as well, because a refusal
   * arrives after the param has already changed: the engine keeps the old
   * layout, the param keeps the new one, and every subsequent region is
   * converted against a partition length the engine does not have.
   */
  _slotBusy(slot) {
    return [['arec', 'rec'], ['aplay', 'play']].some(([prefix]) =>
      this.ps.get(`${prefix}.on`).value && this.ps.get(`${prefix}.part`).value === slot);
  }

  /** Partition bounds, fractions of the tape → absolute samples. */
  _pushLayout() {
    const n = this._tapeLen;
    for (let i = 0; i < PARTITION_SLOTS; i++) {
      const start = Math.floor(this.ps.get(`apart${i}.start`).value * n);
      const len = Math.floor(this.ps.get(`apart${i}.len`).value * n);
      this.engine.partBounds(i, start, Math.min(len, n - start));
    }
  }

  /**
   * A zone's region, as a fraction of its partition → samples relative to that
   * partition's start, which is what `/zone/<type>/<n>/region` takes.
   */
  _pushRegion(prefix, type) {
    const n = this._tapeLen;
    const slot = this.ps.get(`${prefix}.part`).value;
    const partLen = Math.floor(this.ps.get(`apart${slot}.len`).value * n);
    const start = this.ps.get(`${prefix}.start`).value * partLen;
    const len = this.ps.get(`${prefix}.len`).value * partLen;
    this.engine.zoneRegion(type, 0, start, len);
  }

  _pushAll() {
    const g = (id) => this.ps.get(id).value;
    this.engine.glide(g('audio.glide'));
    this.engine.outGain(g('audio.outGain'));
    this.engine.outLimit(g('audio.limitThresh'), g('audio.limitRel'));
    for (const [prefix, type] of [['arec', 'rec'], ['aplay', 'play']]) {
      this.engine.zonePart(type, 0, g(`${prefix}.part`));
      this._pushRegion(prefix, type);
      this.engine.zoneUnsafe(type, 0, !!g(`${prefix}.unsafe`));
    }
    this.engine.playRate(0, g('aplay.rate'));
    this.engine.recDynamic(0, !!g('arec.dynamic'));
  }

  // ── subscriptions ─────────────────────────────────────────────────────────

  _on(id, fn) {
    const p = this.ps.get(id);
    if (p) this._unsubs.push(p.onChange(fn));
  }

  _subscribe() {
    this._on('audio.glide', (v) => this.engine.glide(v));
    this._on('audio.outGain', (v) => this.engine.outGain(v));
    this._on('audio.limitThresh',
      (v) => this.engine.outLimit(v, this.ps.get('audio.limitRel').value));
    this._on('audio.limitRel',
      (v) => this.engine.outLimit(this.ps.get('audio.limitThresh').value, v));

    this._on('audio.mic', async (v) => {
      if (v) {
        try { await this.engine.openMic(); this._say('mic open — USE HEADPHONES'); }
        catch (e) { this._say(`mic denied: ${e.message}`); this.ps.set('audio.mic', 0); }
      } else {
        this.engine.closeMic();
      }
    });

    for (let i = 0; i < PARTITION_SLOTS; i++) {
      for (const key of ['start', 'len']) {
        const id = `apart${i}.${key}`;
        let accepted = this.ps.get(id).value;
        this._on(id, (v) => {
          if (this._fromEngine) return;
          if (this._slotBusy(i)) {
            this._say(`P${i} layout is fixed while a zone on it runs (§4.3)`);
            this._fromEngine = true;                 // revert without recursing
            try { this.ps.set(id, accepted); } finally { this._fromEngine = false; }
            return;
          }
          accepted = v;
          this._pushLayout();
        });
      }
    }

    for (const [prefix, type] of [['arec', 'rec'], ['aplay', 'play']]) {
      this._on(`${prefix}.part`, (v) => {
        this.engine.zonePart(type, 0, v);
        this._pushRegion(prefix, type);   // the region is relative to the NEW partition
      });
      this._on(`${prefix}.start`, () => this._pushRegion(prefix, type));
      this._on(`${prefix}.len`, () => this._pushRegion(prefix, type));
      this._on(`${prefix}.unsafe`, (v) => this.engine.zoneUnsafe(type, 0, !!v));
      this._on(`${prefix}.on`, (v) => {
        if (v) this.engine.zoneOn(type, 0); else this.engine.zoneOff(type, 0);
      });
    }
    this._on('aplay.rate', (v) => this.engine.playRate(0, v));
    this._on('arec.dynamic', (v) => this.engine.recDynamic(0, !!v));

    // Reallocating throws away every recording, so it is not a live control:
    // it applies on the next enable. Reflected here rather than silently
    // ignored, because a slider that appears to do nothing is worse than one
    // that says why.
    this._on('audio.tapeSec', () => this._say(
      'tape length applies on the next Audio On — reallocating would discard the tape'));
  }
}
