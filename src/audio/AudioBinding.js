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

import { AudioEngine, TAP } from './AudioEngine.js';

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
    // True while a param is being written BECAUSE the engine said so. See _on().
    this._fromEngine = false;
    /** How many analyser consumers hold the tap — see stop() and ensureTap(). */
    this._tapConsumers = 0;
    /** Selected input device for the one microphone, or null for the default. */
    this._micDevice = null;
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
      if (partLen > 0) this._applyFromEngine('arec.len', lenSamples / partLen);
    };
    // The engine stops a dynamic recording at the seam on its own. Reflect that
    // in the param, with a guard: writing it fires onChange, which would send
    // the state straight back and make an engine-side fact into a round trip.
    this.engine.onZoneState = (type, i, running) => {
      if (i !== 0) return;
      this._applyFromEngine(type === 'rec' ? 'arec.on' : 'aplay.on', running ? 1 : 0);
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
    // The mic is a device and Audio Off releases it — but only if nothing else
    // is listening. A sound-reactive controller tapping the mic is a consumer
    // that never asked for the engine and must not be silenced by it (§8.6:
    // the controller layer is a consumer of the tap, not a client of the tape).
    if (!this._tapConsumers) this.engine.closeMic();
    await this.engine.close();
    this.running = false;
    // NOT a fresh AudioEngine. It used to be one, because close() closed the
    // context and a closed context cannot be reused — but under §8.6 there is
    // exactly one context for the session and the engine suspends it instead.
    // Replacing the engine here would build a second one on the next start,
    // which is the very thing this step exists to remove.
  }

  /**
   * The §8.6 analyser tap, for consumers that analyse rather than drive —
   * `ControllerManager`'s sound controllers, the vectorscope. Returns the one
   * context and a node carrying the selected signal.
   *
   * Deliberately available **without** the engine running. These consumers
   * predate the audio half and worked on their own contexts; making them wait
   * for Audio On would be a regression, and §8.6's answer to the boot ordering
   * is a context that exists while suspended, not a context that does not exist.
   *
   * @param {{deviceId?: string}} opts a specific input device, if the caller
   *   has a picker for one (the vectorscope does). Selecting a device reopens
   *   the shared mic, so it is the LAST caller that wins — one microphone, like
   *   one context.
   * @returns {Promise<{ctx: AudioContext, tap: GainNode}>}
   */
  async ensureTap(opts = {}) {
    const ctx = this.engine.context();
    this._tapConsumers = (this._tapConsumers || 0) + 1;
    if (opts.deviceId && opts.deviceId !== this._micDevice) {
      this._micDevice = opts.deviceId;
      if (this.engine.micOpen) this.engine.closeMic();  // reopen on the new device
    }
    await this._applyTap();
    return { ctx, tap: this.engine.tap };
  }

  /** Constraints for the one microphone (§8.1: no processing in the path). */
  _micConstraints() {
    return {
      echoCancellation: false, noiseSuppression: false, autoGainControl: false,
      ...(this._micDevice ? { deviceId: { exact: this._micDevice } } : {}),
    };
  }

  /**
   * Route the tap, opening the mic if that is what it now points at. Opening a
   * device is a visible act, so it goes through the `audio.mic` param rather
   * than round the back of it — otherwise the Mic toggle reads off while the
   * light on the machine is on.
   */
  async _applyTap() {
    const which = this.ps.get('audio.tapSrc').value;
    this.engine.setTap(which);
    if (which !== TAP.MIC) {
      if (!this.running) this._say('tap is Master Out, which is silent until Audio On');
      return;
    }
    // Open the device HERE rather than by writing the param and hoping. The
    // param only reaches the engine while subscriptions are live — off, or
    // when the value is already 1 because the device was reopened on another
    // input, the write fires nothing and the mic stays shut.
    if (!this.engine.micOpen) {
      try { await this.engine.openMic(this._micConstraints()); }
      catch (e) { this._say(`mic denied: ${e.message}`); this.ps.set('audio.mic', 0); return; }
    }
    // Reflect the open device in the toggle without asking the engine to open
    // it again — the same "this is a fact, not a command" path the engine's own
    // callbacks use.
    if (!this.ps.get('audio.mic').value) this._applyFromEngine('audio.mic', 1);
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
  /**
   * DELIBERATELY WEAKER THAN THE ENGINE'S RULE, and it must stay that way.
   *
   * The engine refuses while `z.on || z.gainCur > 0` — i.e. through the fade-out
   * tail. The client can only see the `on` param, so there is an ~8 ms window
   * after Run goes off in which a layout drag is accepted here and refused
   * there. That is the desync this guard exists to prevent, in a window small
   * enough not to be worth engineering around.
   *
   * The wrong repair is to relax the ENGINE to match the client: the engine's
   * extra condition is what stops a relayout from yanking the buffer out from
   * under a zone that is still audibly fading. If these two ever need to agree
   * exactly, the client must learn about the tail, not the engine forget it.
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
    this.engine.setTap(g('audio.tapSrc'));
    this._pushVoice();
  }

  /**
   * Semitones → Hz. Pitch and cutoff are registered in semitones because rate
   * and frequency are heard as ratios (LEARNED 2026-08-08), and the conversion
   * lives HERE for the same reason the fractions→samples one does: one site,
   * not one per call. The engine speaks Hz because that is what a DSP kernel
   * wants; the UI speaks semitones because that is what an ear wants.
   */
  _hz(semitones) { return 440 * Math.pow(2, (semitones - 69) / 12); }

  _pushVoice() {
    const g = (id) => this.ps.get(id).value;
    this.engine.voiceSrc(0, g('avoice.src'));
    this.engine.voiceWave(0, g('avoice.wave'));
    this.engine.voiceFreq(0, this._hz(g('avoice.pitch')));
    this.engine.voiceFm(0, g('avoice.fmRatio'), g('avoice.fmIndex'));
    this.engine.voiceColour(0, g('avoice.colour'));
    this.engine.voiceFilter(0, this._hz(g('avoice.cut')), g('avoice.res'), g('avoice.ftype'));
    this.engine.voiceDrive(0, g('avoice.drive'));
    this.engine.voiceLevel(0, g('avoice.level'));
    if (g('avoice.on')) this.engine.voiceOn(0); else this.engine.voiceOff(0);
  }

  // ── subscriptions ─────────────────────────────────────────────────────────

  /**
   * Subscribe, ignoring writes that the ENGINE caused.
   *
   * An engine-initiated write is the engine telling us something it already
   * knows — sending it back is never right, and it is a command answering a
   * fact. The guard lives HERE rather than in each handler because the first
   * version put it in only one of them: the `.on` subscription, which is the
   * one the echo actually travels through, was left open, and it was benign
   * purely because stopping an already-stopped zone happens to be idempotent.
   * A guard that depends on every future handler remembering it is not a guard.
   */
  _on(id, fn) {
    const p = this.ps.get(id);
    if (!p) return;
    this._unsubs.push(p.onChange((v, param) => {
      if (this._fromEngine) return;
      fn(v, param);
    }));
  }

  /** Write a param as a consequence of an engine message, without echoing. */
  _applyFromEngine(id, value) {
    this._fromEngine = true;
    try { this.ps.set(id, value); } finally { this._fromEngine = false; }
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
        try { await this.engine.openMic(this._micConstraints()); this._say('mic open — USE HEADPHONES'); }
        catch (e) { this._say(`mic denied: ${e.message}`); this.ps.set('audio.mic', 0); }
      } else {
        this.engine.closeMic();
        // Closing the mic while the tap points at it deafens every analyser
        // consumer — the sound controllers stop moving. Say so: a controller
        // that has quietly stopped reads as a broken controller.
        if (this._tapConsumers && this.ps.get('audio.tapSrc').value === TAP.MIC) {
          this._say('mic closed — sound controllers have no input while the tap is Mic');
        }
      }
    });

    this._on('audio.tapSrc', () => this._applyTap());

    // The Voice. Every one of these is an UPDATE, not a restart (§8.8 rule 4),
    // and each lands as a slew target in the worklet — so a controller writing
    // one every frame is the ordinary case and costs nothing extra.
    this._on('avoice.on', (v) => { if (v) this.engine.voiceOn(0); else this.engine.voiceOff(0); });
    this._on('avoice.src', (v) => this.engine.voiceSrc(0, v));
    this._on('avoice.wave', (v) => this.engine.voiceWave(0, v));
    this._on('avoice.pitch', (v) => this.engine.voiceFreq(0, this._hz(v)));
    this._on('avoice.colour', (v) => this.engine.voiceColour(0, v));
    this._on('avoice.drive', (v) => this.engine.voiceDrive(0, v));
    this._on('avoice.level', (v) => this.engine.voiceLevel(0, v));
    // Bundled addresses: re-send the whole tuple, since the protocol carries
    // the group and the engine has no partial-update verb.
    for (const id of ['avoice.fmRatio', 'avoice.fmIndex']) {
      this._on(id, () => this.engine.voiceFm(
        0, this.ps.get('avoice.fmRatio').value, this.ps.get('avoice.fmIndex').value));
    }
    for (const id of ['avoice.cut', 'avoice.res', 'avoice.ftype']) {
      this._on(id, () => this.engine.voiceFilter(
        0, this._hz(this.ps.get('avoice.cut').value),
        this.ps.get('avoice.res').value, this.ps.get('avoice.ftype').value));
    }

    for (let i = 0; i < PARTITION_SLOTS; i++) {
      for (const key of ['start', 'len']) {
        const id = `apart${i}.${key}`;
        let accepted = this.ps.get(id).value;
        this._on(id, (v) => {
          if (this._slotBusy(i)) {
            this._say(`P${i} layout is fixed while a zone on it runs (§4.3)`);
            this._applyFromEngine(id, accepted);      // revert without recursing
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
