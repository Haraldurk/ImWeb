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
import { TapeView } from './TapeView.js';
import { partitionSpan, zoneSpan, clampToPartition } from './tape-geometry.js';
import {
  AUDIO_TARGETS, describeController, describeSlew, descDiff, semitoneToHz,
  sampleSlewCurve, SLEW_MECHANISM, SLEW_SEGMENT,
} from './ctrl-handoff.js';
// The ONE table resolver (§8.7 needs the curve to upload it; ParameterSystem
// applies it). See tests/audit-table-write-paths.mjs for both halves of that.
// `SLEW_CURVES` and `slewExcursion` come from the same place for the same
// reason: the curve the worklet runs is sampled from the client's function, and
// the excursion constants are the client's measurements — neither is re-derived.
import {
  resolveTable, SLEW_CURVES, SLEW_CURVE_HAS_STRENGTH, slewExcursion,
} from '../controls/ParameterSystem.js';

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
    /**
     * ControllerManager, injected by main.js (§8.7). Read-only from here: the
     * live `LFO` instance is the source of truth for a description because the
     * badge popover mutates it in place and never re-calls `assign()`, and the
     * BPM sync writes `lfo.hz` directly. Reconciling against the live object
     * therefore catches every authoring path without hunting for mutation
     * sites — which is what a diff each frame buys over an event.
     */
    this.controllers = null;
    /** param id → slot, for the params the WORKLET is currently driving. */
    this._owned = new Map();
    /** Last description sent per slot, so only changes go over the port. */
    this._sentDesc = new Map();
    this._echoOn = false;
    /** Sampled slew curves, keyed by shape:strength — 64 KB each. */
    this._slewCurves = new Map();
    /** Has `process()` been PROVEN to run? Gates the hand-off — see `start()`. */
    this._alive = false;
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
    // §8.7's inversion, arriving: the worklet is authoritative for anything it
    // drives, and ParameterSystem follows it a frame later. Display may lag a
    // frame; display is allowed to.
    this.engine.onCtrlEcho = (triples) => this._applyEcho(triples);
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

    // The allocation's own dirty notification is consumed by the liveness proof
    // above — it is the proof — so the first envelope has to be asked for here.
    // Waiting for the next one would leave the display empty until something
    // happened to write to the tape.
    this._pushRegionsToView();
    this._refreshEnvelope();

    // §8.7's hand-off is gated on this, not on `running`. An engine that loaded
    // but whose audio callback never fires answers every message normally while
    // `process()` — where controllers are evaluated — never runs. Handing a
    // parameter over in that state would take it off the rAF path and give it
    // to something that never ticks: modulation would FREEZE, which is the
    // exact fault §8.7 exists to remove, reintroduced by its own fix.
    this._alive = await alive;

    if (this._alive) {
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
    // Hand every controller back to the rAF path, and forget what was sent. The
    // engine restarts by BUILDING A FRESH WORKLET NODE (step 4), so its
    // controller state does not survive; a cache that did would leave slots
    // looking bound to a node that has never heard of them, and those params
    // would then be driven by nothing at all.
    this._owned.clear();
    this._sentDesc.clear();
    this._echoOn = false;
    this._alive = false;
    // The tape survives a suspend, but nothing can be asked about it while the
    // engine is stopped, so the waveform would silently go stale. Say which it
    // is — the layout stays drawn, because that is still true.
    this.view?.clearEnvelope('audio off');
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

  // ── worklet-resident controllers, client half (§8.7) ─────────────────────

  /**
   * Is the worklet driving this parameter? ControllerManager asks once per LFO
   * per frame, so it must stay a map lookup.
   *
   * This is the whole of the two-code-paths cost §8.7 warns about, in one
   * predicate: true and the rAF loop leaves the parameter alone, false and it
   * evaluates it as it always has.
   */
  ownsParam(id) { return this._owned.has(id); }

  /**
   * Reconcile every audio-relevant controller against the engine, once a frame.
   *
   * A DIFF rather than an event, deliberately. Controller settings are mutated
   * in at least four places — the badge popover writes the live `LFO` object,
   * BPM sync rewrites `hz`, xmap rewrites it per frame, and `assign()` replaces
   * the whole thing — so an event-based hand-off would need a hook at each, and
   * the one that got missed would present as an LFO that ignores its own rate
   * field. Six params, a handful of number comparisons; it costs nothing.
   */
  syncControllers() {
    for (let slot = 0; slot < AUDIO_TARGETS.length; slot++) {
      const entry = AUDIO_TARGETS[slot];
      const p = this.ps.get(entry.id);
      const want = p && this.running && this._alive ? this._describe(p, entry) : null;
      const had = this._sentDesc.get(slot) || null;
      if (!want) {
        if (had) this._release(slot, entry);
        continue;
      }
      // Describe BEFORE binding, so the controller never drives the target for
      // a quantum with defaults it was never given.
      const d = descDiff(had, want);
      if (d.lfo) this.engine.ctrlLfo(slot, want.shape, want.hz, want.width, want.mode);
      if (d.range) this.engine.ctrlRange(slot, want.lo, want.hi, want.map, want.invert);
      if (d.phase) this.engine.ctrlPhase(slot, want.phase);
      if (d.table) {
        // The curve first, THEN the pointer to it — the engine refuses a
        // controller bound to an empty slot, and it is right to: a table that
        // silently stops shaping is the failure this whole step removes.
        // A copy, because the send transfers the buffer and the client keeps
        // using its own array.
        if (want.table) this.engine.tableData(slot, Float32Array.from(want.table.points));
        this.engine.ctrlTable(slot, want.table ? slot : -1);
      }
      if (d.slew) this._pushSlew(slot, want.slew);
      if (d.bind) {
        this.engine.ctrlTarget(slot, entry.address);
        this._owned.set(entry.id, slot);
        this._updateEcho();
      }
      this._sentDesc.set(slot, want);
    }
  }

  /**
   * Slew, in the order the engine needs it: the curve, then the fit that points
   * at it, then the mode. The engine refuses a segment mode with no curve —
   * rightly, since that would silently become no slew at all — so the sequence
   * is not cosmetic.
   *
   * Slew curves live in the upper half of the table slots so a controller can
   * hold a response curve AND a slew curve at once. Two different jobs, two
   * slots, one uploader.
   */
  _pushSlew(slot, slew) {
    if (!slew) {
      this.engine.ctrlSlew(slot, 0, 0.1);
      return;
    }
    const curveSlot = slot + AUDIO_TARGETS.length;
    if (slew.curve) this.engine.tableData(curveSlot, Float32Array.from(slew.curve));
    this.engine.ctrlSlewFit(slot, slew.curve ? curveSlot : -1,
      slew.min, slew.max, slew.under, slew.over, slew.k0);
    this.engine.ctrlSlew(slot, slew.mode, slew.seconds, slew.damp, slew.strength);
  }

  _release(slot, entry) {
    this.engine.ctrlClear(slot);
    this._sentDesc.delete(slot);
    this._owned.delete(entry.id);
    this._updateEcho();
  }

  /** Every slot the worklet owns, retriggered — see `retriggerOwned`. */
  _updateEcho() {
    const want = this._owned.size > 0;
    if (want === this._echoOn) return;
    this._echoOn = want;
    this.engine.ctrlEcho(want);
  }

  /**
   * The live `LFO` for a parameter, described — or null to leave it on the rAF
   * path. The decision itself is in `ctrl-handoff.js`, which imports nothing and
   * is therefore drivable in Node; this only fetches the live object, because
   * the badge popover mutates it in place and never re-calls `assign()`.
   */
  /**
   * The slew half of a description. A segment curve is SAMPLED from the
   * client's own function here, with the live Strength, so the shape the
   * worklet runs is definitionally the shape the client would have run — and
   * the excursion constants travel as the client's measurements rather than
   * being measured again on the other side.
   *
   * The sampled array is cached per (shape, strength) because it is 64 KB and
   * the reconcile asks every frame; the cache key is also what the diff
   * compares, so an unchanged curve produces no upload.
   */
  _slewFor(p) {
    if (!(p.slew > 0)) return null;
    const shape = p.slewShape ?? 'lag';
    const mode = SLEW_MECHANISM[shape];
    if (mode === undefined) return null;
    if (mode !== SLEW_SEGMENT) return describeSlew(p, null, null);
    const strength = SLEW_CURVE_HAS_STRENGTH[shape]
      ? Math.max(0, Math.min(3, p.slewStrength ?? 1)) : 1;
    const key = `${shape}:${Math.round(strength * 100) / 100}`;
    let curve = this._slewCurves.get(key);
    if (!curve) {
      const fn = SLEW_CURVES[shape];
      if (!fn) return null;
      curve = sampleSlewCurve(fn, strength);
      if (this._slewCurves.size > 32) this._slewCurves.clear();
      this._slewCurves.set(key, curve);
    }
    return describeSlew(p, curve, slewExcursion(shape, strength));
  }

  _describe(p, entry) {
    const c = this.controllers?.lfos?.get(p.id);
    if (!c?.lfo) return null;
    // Resolved through ParameterSystem's own resolver, not re-derived: the
    // `'global'` table slot is an indirection through another parameter, and a
    // second copy of that lookup is how the display and the sound end up
    // disagreeing about which curve is in force. Resolved here, APPLIED in the
    // worklet — never both.
    return describeController(
      p, c.lfo, entry, p.table ? resolveTable(p) : null, this._slewFor(p));
  }

  /**
   * Retrigger every worklet-owned controller. Display State recall calls
   * `ControllerManager.retriggerLFOs()`, which resets the client-side LFOs;
   * without this the worklet-owned ones would keep running, because §8.7's rule
   * 4 makes the re-sent descriptions that accompany a recall an UPDATE. The
   * retrigger has to travel as its own verb, and this is the caller.
   */
  retriggerOwned() {
    for (const slot of this._owned.values()) this.engine.ctrlRetrigger(slot);
  }

  /**
   * The echo (§8.7's inversion): for a controller feeding audio the worklet is
   * authoritative, and ParameterSystem follows it.
   *
   * The RAW 0..1 is what comes back through `setNormalized`, so the client
   * applies its own range, invert and table exactly as it does for a
   * client-evaluated controller — the alternative, taking the mapped value and
   * inverting the semitone conversion, would make the two directions two places
   * to disagree, and the symptom would be a parameter drifting while an LFO runs.
   *
   * Guarded by `_fromEngine`: this write fires `onChange`, and unguarded it
   * would send the value straight back to a target the engine already refuses
   * to accept (`REFUSE.CTRL_OWNED`) — a message per frame per controller, all
   * of them rejected.
   */
  _applyEcho(triples) {
    for (let i = 0; i + 2 < triples.length; i += 3) {
      const slot = triples[i] | 0;
      const entry = AUDIO_TARGETS[slot];
      if (!entry || !this._owned.has(entry.id)) continue;
      const p = this.ps.get(entry.id);
      if (!p) continue;
      this._fromEngine = true;
      try { p.setNormalized(triples[i + 1]); } finally { this._fromEngine = false; }
    }
  }

  // ── the tape display (§4.2's landscape, §8.6's "draw the loop") ───────────

  /**
   * Give the display a canvas. Everything it needs crosses HERE, because it is
   * the binding's job to see both halves: the envelope comes from the engine,
   * the partition layout and zone regions come from ParameterSystem, and
   * `TapeView` is handed both without importing either.
   *
   * Wired OUTSIDE `_subscribe()` on purpose. Those subscriptions are torn down
   * by `stop()`, and the display must survive Audio Off — the layout you set up
   * with the engine stopped is exactly what you want to look at while setting it
   * up. Only the envelope needs a running engine; the frame does not.
   */
  attachView(canvas) {
    this.view = new TapeView(canvas);
    // The whole tape, as a fraction of itself. Zoom becomes a narrower span
    // here plus a request over the matching sample range — the view already
    // places columns by position rather than by index, so it needs nothing new.
    this.view.setSpan(0, 1);
    // The dirty notification is the engine saying "the tape changed here". It
    // arrives at frame cadence (rule 7) and `requestEnvelope` keeps one request
    // per view in flight, so this self-throttles without a timer.
    this.engine.onDirty = () => this._refreshEnvelope();
    if (typeof ResizeObserver !== 'undefined') {
      this._viewRO = new ResizeObserver(() => {
        // Ask again at the new width rather than stretching what we hold: a
        // min/max envelope resampled to another resolution invents peaks it
        // never saw and loses the ones between columns (§6 item 6).
        this.view.resize();
        this._refreshEnvelope();
        this._pushRegionsToView();
      });
      this._viewRO.observe(canvas);
    }
    for (const id of this._viewParamIds()) {
      const p = this.ps.get(id);
      // Not through `_on()`: that guard exists to stop engine-caused writes from
      // being sent back, and there is nothing to send back here — a redraw is
      // the right response to a change whoever caused it.
      if (p) p.onChange(() => this._pushRegionsToView());
    }
    this._pushRegionsToView();
    this._refreshEnvelope();
  }

  _viewParamIds() {
    const ids = ['audio.tapeSec'];
    for (let i = 0; i < PARTITION_SLOTS; i++) ids.push(`apart${i}.start`, `apart${i}.len`);
    for (const prefix of ['arec', 'aplay']) {
      ids.push(`${prefix}.part`, `${prefix}.start`, `${prefix}.len`, `${prefix}.unsafe`);
    }
    return ids;
  }

  _refreshEnvelope() {
    if (!this.view || !this.running) return;
    const n = this._tapeLen;
    if (!(n > 0)) return;
    this.view.setEmptyMessage('reading tape…');
    this.engine.requestEnvelope(0, n, this.view.columns, 'main').then((r) => {
      // `null` means superseded or refused — both normal during a drag. Keep
      // what is on screen rather than blanking it, which would flicker the
      // waveform away every time a request was overtaken.
      if (r) this.view.setEnvelope({ ...r, start: r.start / n, end: r.end / n });
    });
  }

  /**
   * The overlay. Everything the view is given is a FRACTION OF THE TAPE, never
   * a sample index — partitions are already fractions of the tape and zone
   * regions are fractions of their partition (§4.3), so the conversion the view
   * would otherwise need is one the params never made in the first place. It
   * also means the display is correct before the engine has ever run, when the
   * sample rate is not yet known: a layout drawn while the engine is off is
   * exactly what you want while setting the layout up.
   *
   * The arithmetic mirrors `_pushLayout` and `_pushRegion` deliberately, and
   * must keep mirroring them. A display that disagrees with the engine about
   * where a zone is is worse than no display, because it will be believed.
   */
  _pushRegionsToView() {
    if (!this.view) return;
    const g = (id) => this.ps.get(id).value;
    const regions = [];
    for (let i = 0; i < PARTITION_SLOTS; i++) {
      const p = this._part(i);
      if (p.len > 0) regions.push({ kind: 'part', start: p.start, end: p.start + p.len, label: `P${i}` });
    }
    for (const [prefix, kind] of [['arec', 'rec'], ['aplay', 'play']]) {
      const part = this._part(g(`${prefix}.part`));
      // The SAME `zoneSpan` the engine push uses — that is the whole point of
      // the helper. The clamp is the display's own step because the engine
      // applies the seam itself, in `_computeSpan`.
      const span = clampToPartition(
        zoneSpan(part, g(`${prefix}.start`), g(`${prefix}.len`)), part, g(`${prefix}.unsafe`));
      regions.push({ kind, ...span, label: kind.toUpperCase() });
    }
    this.view.setRegions(regions);
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

  /** One partition's span in fractions of the tape — the shared arithmetic. */
  _part(slot) {
    return partitionSpan(
      this.ps.get(`apart${slot}.start`).value, this.ps.get(`apart${slot}.len`).value);
  }

  /** Partition bounds, fractions of the tape → absolute samples. */
  _pushLayout() {
    const n = this._tapeLen;
    for (let i = 0; i < PARTITION_SLOTS; i++) {
      const p = this._part(i);
      this.engine.partBounds(i, Math.floor(p.start * n), Math.floor(p.len * n));
    }
  }

  /**
   * A zone's region, as a fraction of its partition → samples relative to that
   * partition's start, which is what `/zone/<type>/<n>/region` takes.
   */
  _pushRegion(prefix, type) {
    const n = this._tapeLen;
    const part = this._part(this.ps.get(`${prefix}.part`).value);
    // Through `zoneSpan` so the display cannot drift from this: the same
    // function answers both, and the only difference is that the engine is told
    // in partition-relative SAMPLES while the view is shown absolute fractions.
    const span = zoneSpan(part, this.ps.get(`${prefix}.start`).value,
      this.ps.get(`${prefix}.len`).value);
    this.engine.zoneRegion(type, 0, (span.start - part.start) * n, (span.end - span.start) * n);
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
   * and frequency are heard as ratios (LEARNED 2026-08-08). The engine speaks Hz
   * because that is what a DSP kernel wants; the UI speaks semitones because
   * that is what an ear wants.
   *
   * The definition moved to `ctrl-handoff.js` when §8.7's controller ranges
   * needed the same conversion — one site, still, just not this one.
   */
  _hz(semitones) { return semitoneToHz(semitones); }

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
      // A parameter the WORKLET drives is not written from here (§8.7). The
      // engine refuses such a write (`REFUSE.CTRL_OWNED`) and the next echo
      // would overwrite it regardless, so sending it would only fill the status
      // line with refusals during ordinary use. Guarded here, in the one place
      // every subscription passes through, for the same reason `_fromEngine` is
      // — a guard each handler has to remember is not a guard.
      if (this._owned.has(id)) return;
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
