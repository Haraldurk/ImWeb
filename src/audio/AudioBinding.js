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
import { SLEW_TABLE_BASE } from './protocol.js';
import { TapeView } from './TapeView.js';
import { partitionSpan, zoneSpan, clampToPartition } from './tape-geometry.js';
import { buildPitches, imageFromLuma, buildPan, PAN } from './spectral-image.js';
import { CorpusView } from './CorpusView.js';
import { DESCRIPTORS, buildIndex, nearest, grainTime } from './corpus-index.js';
import { describeAudioGraph } from './graph-view.js';
import {
  AUDIO_TARGETS, describeController, describeSlew, descDiff, semitoneToHz,
  sampleSlewCurve, slewStrength, SLEW_MECHANISM, SLEW_SEGMENT,
} from './ctrl-handoff.js';
// The ONE table resolver (§8.7 needs the curve to upload it; ParameterSystem
// applies it). See tests/audit-table-write-paths.mjs for both halves of that.
// `SLEW_CURVES` and `slewExcursion` come from the same place for the same
// reason: the curve the worklet runs is sampled from the client's function, and
// the excursion constants are the client's measurements — neither is re-derived.
import {
  resolveTable, SLEW_CURVES, SLEW_CURVE_HAS_STRENGTH, slewExcursion,
  MONITOR, MONITOR_MODES,
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
     * Called with (loopLive, monitorLabel) whenever the acoustic feedback path
     * appears or disappears (§8.6). A separate channel from `onStatus` because a
     * loop is a condition, not an event — see `_refreshLoop`.
     */
    this.onLoopState = null;
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
    /**
     * `() => { luma: Float32Array, width, height }`, injected by main.js — the
     * picture the spectral writer renders (§4.5). Injected rather than imported
     * for §4.1's reason: this stays the only module seeing both halves, so it
     * must not learn what a renderer is. Anything that can produce a luminance
     * grid can be the source, which is what leaves paint-surface-versus-import
     * an open client-side question rather than a protocol one.
     */
    this.imageSource = null;
    /**
     * The partition the ENGINE last accepted for the recording zone — see
     * `_sendZonePart`, which is the only thing that writes it. Used to put
     * `arec.part` back when a change is refused because the recorder is running.
     */
    this._recPart = 0;
    /** The render in flight, or -1. Held so `cancelSpectral` has an id to send. */
    this._specJobId = -1;
    /** The corpus analysis in flight, or -1. */
    this._corpusJobId = -1;
    /** The last measurements received, kept so an axis change re-projects them. */
    this._corpusRaw = null;
    /** The 2D map built from them for the current axis pair. */
    this._corpus = null;
    this.corpusView = null;
    /**
     * Progress on any paced job (§8.3), at frame cadence. Straight to the
     * status line: a multi-second job with no sign of life is indistinguishable
     * from a wedged one.
     *
     * Keyed on the job id, because there is more than one kind of job now and
     * the first version hardcoded "spectral" — so a corpus analysis reported
     * itself as a render for twenty seconds, which is worse than saying nothing
     * (it names a job that is not running over material it is not touching).
     */
    this.engine.onJobProgress = (id, done, total) => {
      const pct = Math.round((done / total) * 100);
      if (id === this._corpusJobId) this._say(`corpus: analysing ${pct}%`);
      else if (id === this._specJobId) this._say(`spectral: rendering ${pct}%`);
    };
  }

  _say(msg) { this.onStatus?.(msg); }

  // ── the monitoring path (§8.6) ────────────────────────────────────────────

  /**
   * Is `mic → tape → monitors → mic` a real acoustic path right now?
   *
   * All three conjuncts are load-bearing, which is why this is a function and
   * not a flag someone maintains:
   *
   * - **the engine is running** — nothing reaches the monitors otherwise, so an
   *   open mic with the engine stopped is an input, not a loop;
   *   `_tapConsumers` can hold the mic open for the video controllers with no
   *   audio path in existence at all (§8.6's tap is a consumer, not a client);
   * - **the mic is open** — asked of the DEVICE rather than of `audio.mic`,
   *   because `_applyTap` opens it directly when the tap needs it and the param
   *   catches up afterwards. Reading the param would miss exactly the window in
   *   which the loop first exists;
   * - **the performer is on speakers** — the only part a human tells us.
   */
  _loopLive() {
    return this.running
      && this.engine.micOpen
      && this.ps.get('audio.monitor').value === MONITOR.SPEAKERS;
  }

  /**
   * Publish the loop state to whatever is showing it.
   *
   * Separate from `_say` on purpose. A status line is a record of the last thing
   * that happened and scrolls away; the loop is a CONDITION that persists until
   * something changes it, and §8.6's whole argument for drawing the loop is that
   * it should be an object the performer can see rather than an event they have
   * to have caught. Called from every edge that can change the answer — the
   * monitoring switch, the mic, engine start and stop.
   */
  _refreshLoop() {
    this.onLoopState?.(this._loopLive(), MONITOR_MODES[this.ps.get('audio.monitor').value]);
  }

  /**
   * The audio graph as drawable nodes, for the signal path display (§8.6).
   *
   * Pull, not push: the display asks when it renders. The one thing that can
   * change the answer without a param changing is the DEVICE opening or closing,
   * and `_refreshLoop` already fires on exactly those edges — so the display
   * subscribes to that and calls back here, rather than this method growing a
   * second notification channel beside `onLoopState`.
   *
   * The shape of the row lives in `graph-view.js`, which knows nothing about
   * ParameterSystem. This method is the translation layer and nothing else — the
   * same split as `buildPitches` and `buildIndex`, and it is what makes the row
   * testable without a browser.
   */
  describeGraph() {
    const v = (id, dflt = 0) => this.ps.get(id)?.value ?? dflt;
    const zone = (prefix) => ({
      on: !!v(`${prefix}.on`),
      part: v(`${prefix}.part`),
      unsafe: !!v(`${prefix}.unsafe`),
    });
    return describeAudioGraph({
      running: this.running,
      micOpen: this.engine.micOpen,
      // Asked of the ONE predicate rather than re-assembled from the same three
      // reads. Two answers to "is the loop closed" is the failure this whole
      // step exists to make visible, and it would be a poor joke to introduce it
      // in the drawing of it.
      loopLive: this._loopLive(),
      monitorLabel: MONITOR_MODES[v('audio.monitor')],
      tapeSec: v('audio.tapeSec', 60),
      // The partition layout, so `carries()` can ask whether two zones' spans
      // OVERLAP rather than whether their slot indices match. Nothing makes
      // partitions disjoint — the worklet's `_partBounds` validates the range
      // and refuses while a zone runs, and that is all — so two slots can cover
      // the same tape and an index comparison would call that "not carrying".
      partBounds: Array.from({ length: PARTITION_SLOTS }, (_, i) => ({
        start: v(`apart${i}.start`), len: v(`apart${i}.len`),
      })),
      rec: zone('arec'),
      play: zone('aplay'),
      grain: zone('agrain'),
      voiceOn: !!v('avoice.on'),
    });
  }

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
    // Starting the engine can complete the loop on its own: a mic already open
    // for the video controllers becomes an acoustic path the moment there is an
    // output for it to return through.
    this._refreshLoop();

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
    // Stopping breaks the path whatever the mic is doing — refreshed after the
    // flag flips below, since `_loopLive` reads it.
    await this.engine.close();
    this.running = false;
    this._refreshLoop();
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
    // The corpus is tape-derived too, and it goes with the tape. `start()`
    // re-allocates, which ZEROES it, so a cloud that survived the restart would
    // sit there confidently plotting material that no longer exists and point
    // the grain player into silence. The waveform already had this rule; two
    // views of the same tape must not have two.
    this._corpusRaw = null;
    this._corpus = null;
    this._corpusJobId = -1;
    this._refreshCorpusLabels();
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
      // This path opens the DEVICE without going through the mic param's
      // subscription, so it has to publish the loop itself — the one place the
      // path can appear with nobody having touched the Mic toggle.
      this._refreshLoop();
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
   * Slew curves live in the upper half of the table slots, so a controller can
   * hold a response curve AND a slew curve at once. The base is `SLEW_TABLE_BASE`
   * from protocol.js, NOT `AUDIO_TARGETS.length`: the latter is a soft contract
   * that holds only while the target list stays shorter than the controller
   * count, and the day it does not, two controllers quietly share a slot.
   */
  _pushSlew(slot, slew) {
    if (!slew) {
      this.engine.ctrlSlew(slot, 0, 0.1);
      return;
    }
    const curveSlot = slot + SLEW_TABLE_BASE;
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
      ? slewStrength(SLEW_SEGMENT, p.slewStrength) : 1;
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
      this._sendZonePart(type, g(`${prefix}.part`));
      this._pushRegion(prefix, type);
      this.engine.zoneUnsafe(type, 0, !!g(`${prefix}.unsafe`));
    }
    this.engine.playRate(0, g('aplay.rate'));
    this.engine.recDynamic(0, !!g('arec.dynamic'));
    this.engine.zonePart('spectral', 0, g('aspec.part'));
    this.engine.zoneUnsafe('spectral', 0, !!g('aspec.unsafe'));
    this.engine.grainPart(0, g('agrain.part'));
    this.engine.grainPos(0, this._grainPosSamples(g('agrain.pos')));
    this.engine.grainUnsafe(0, !!g('agrain.unsafe'));
    this.engine.grainSize(0, this._ms(g('agrain.size')));
    this.engine.grainRate(0, g('agrain.rate'));
    this.engine.grainPitch(0, Math.pow(2, g('agrain.pitch') / 12));
    this.engine.grainSpray(0, this._ms(g('agrain.spray')));
    this.engine.grainLevel(0, g('agrain.level'));
    if (g('agrain.on')) this.engine.grainOn(0); else this.engine.grainOff(0);
    this.engine.setTap(g('audio.tapSrc'));
    this._pushVoice();
  }

  // ── the spectral writer (§4.5, §8.10) ─────────────────────────────────────

  /**
   * Turn the current picture into tape.
   *
   * The picture comes from `imageSource`, injected by main.js — the same rule
   * the analyser tap follows (§4.1): AudioBinding is the only module allowed to
   * see both halves, so it must not learn about the renderer to do this. It
   * asks for `{ luma, width, height }` and does not care whether that came from
   * the output canvas, a paint surface or a file.
   *
   * Everything musical happens on this side. The scale, the root, the rows, the
   * y flip, the contrast — all of it resolves to a list of frequencies and a
   * magnitude image before anything crosses the port, which is what lets the
   * engine hold no vocabulary of tunings at all.
   */
  async renderSpectral() {
    if (!this.running) return this._say('spectral render needs the audio engine running');
    /**
     * Refused HERE as well as by the engine, and this half is the one that
     * matters. The engine already refuses a second render BUSY, so the material
     * was never at risk — but this method would have overwritten `_specJobId`
     * with the id of the render that was about to be refused, then reset it to
     * -1 when that refusal resolved a moment later, all while the FIRST render
     * was still running. Cancel would then answer "nothing is rendering" over a
     * live job, and the only way to stop it would be Audio Off again.
     *
     * Early, before the picture is read: rebuilding a 128×1024 image to throw
     * it away is not free, and the two uploads below would each draw their own
     * BUSY refusal into the status line on the way to the same answer.
     */
    if (this._specJobId >= 0) return this._say('spectral: already rendering');
    const g = (id) => this.ps.get(id).value;
    const pitches = buildPitches(
      g('aspec.scale'), semitoneToHz(g('aspec.root')), g('aspec.rows') | 0,
      this.engine.sampleRate);
    if (!pitches.length) return this._say('spectral render: no pitch is below Nyquist');
    /**
     * Read the row count NOW, before anything is sent.
     *
     * `encode()` puts a blob's ArrayBuffer in the transfer list (rule 2, zero
     * copy), so `specPitches` DETACHES this array and `pitches.length` is 0 on
     * the next line. That shipped once: the image then uploaded with rows = 0,
     * was refused, and the render came back "spectral slot 0 is empty" —
     * a message about the slot, three steps downstream of the actual cause.
     * Nothing below may read a typed array after passing it to the engine.
     */
    const rows = pitches.length;
    // `buildPitches` stops below Nyquist, so a tall chromatic table from a high
    // root comes back SHORT. Said out loud rather than silently accepted: the
    // Rows control appearing to stick is otherwise indistinguishable from a bug.
    if (rows < (g('aspec.rows') | 0)) {
      this._say(`spectral: ${rows} of ${g('aspec.rows') | 0} rows fit below Nyquist`);
    }

    const frames = g('aspec.frames') | 0;
    // The picture is asked for at the size it is about to become, and the size
    // is the RESOLVED row count, not the requested one — `buildPitches` may have
    // stopped short of Nyquist. Reading `aspec.rows` at the grab site instead
    // meant the readback was taller than the render whenever that happened:
    // harmless, because the box average absorbs it, but it made the comment
    // there one step ahead of the truth, and the next person to optimise the
    // grab would have been optimising against the wrong number.
    // Colour is asked for only when the pan mode needs it (§8.14) — every other
    // mode is geometry or off, and reading a second channel out of the frame to
    // ignore it is a per-pixel pass for nothing.
    const panMode = g('aspec.pan') | 0;
    const panWidth = g('aspec.panWidth');
    const wantChroma = panMode === PAN.COLOUR && panWidth > 0;
    const pic = this.imageSource?.(rows, frames, wantChroma);
    if (!pic || !pic.width || !pic.height) {
      return this._say('spectral render: no picture to read');
    }
    const mag = imageFromLuma(pic.luma, pic.width, pic.height, rows, frames, {
      gamma: g('aspec.gamma'), floor: g('aspec.floor'), gain: g('aspec.level'),
    });
    // Null for Off, for a width of 0, and for Colour with no colour to read.
    // Null means the render goes mono, which is what it did before §8.14 — so
    // the failure mode of every one of those is the previous behaviour rather
    // than a refusal.
    const pan = buildPan(panMode, rows, frames, panWidth, pic);
    if (panMode === PAN.COLOUR && !pan && panWidth > 0) {
      this._say('spectral: pan needs colour from the picture — rendering mono');
    }

    const n = this._tapeLen;
    const part = this._part(g('aspec.part'));
    // Through `zoneSpan` for the same reason `_pushRegion` is: one conversion
    // from fractions-of-a-partition to samples, so the render lands exactly
    // where the tape display says it will.
    const span = zoneSpan(part, g('aspec.start'), g('aspec.len'));
    const startRel = (span.start - part.start) * n;
    const lengthSamples = Math.floor((span.end - span.start) * n);
    if (lengthSamples < 1) return this._say('spectral render: the region is empty');

    const secs = (lengthSamples / this.engine.sampleRate).toFixed(1);
    this.engine.specPitches(0, pitches);
    this.engine.specData(0, rows, frames, mag);
    // AFTER the data, and the order is load-bearing rather than tidy: the engine
    // refuses a pan image for a slot with no magnitudes, and `/spec/<n>/data`
    // clears whatever pan was there. Sent before it, this would be refused; and
    // if the refusal were ever relaxed it would be dropped instead, which is
    // worse — a silent mono render.
    if (pan) this.engine.specPan(0, rows, frames, pan);
    const { jobId, done } = this.engine.render('spectral', 0, 0, startRel, lengthSamples);
    this._specJobId = jobId;
    this._say(`spectral: rendering ${secs}s from ${rows}×${frames}…`);
    const res = await done;
    this._specJobId = -1;
    // Reported either way. A render that refused in silence looks exactly like
    // one that is still going, and the region it would have written is the one
    // the performer is about to play.
    this._say(res.ok
      ? `spectral: ${secs}s rendered into P${g('aspec.part')}`
      : `spectral render refused (${res.code}): ${res.message}`);
    return res;
  }

  /**
   * Stop the render in flight.
   *
   * Worth a control rather than left to the protocol, because a render is not
   * always the second or two the default settings suggest: the region can be a
   * whole partition and the row count goes to 128, which at the engine's budget
   * is the better part of a minute. Until this existed the only way to stop one
   * was Audio Off — which settles the job, but by taking the instrument down.
   *
   * Partially rendered material stays on the tape. That is the engine's rule
   * (`_specCancel`) and it is the right one: it is what was actually asked for
   * and actually written, and an `unsafe` render can begin anywhere, so zeroing
   * could destroy a region that was being recorded into before this started.
   */
  cancelSpectral() {
    if (!(this._specJobId >= 0)) return this._say('spectral: nothing is rendering');
    this.engine.cancelJob(this._specJobId);
  }

  // ── the corpus index (§4.6) ───────────────────────────────────────────────

  attachCorpusView(canvas) {
    this.corpusView = new CorpusView(canvas);
    // The pad writes the PARAMS, not the engine. That is what makes §4.6's
    // "navigating a descriptor space is a drawing gesture" true rather than
    // decorative: the same two values can be driven by a hand, an LFO, a MIDI
    // knob or the stroke looper, and all four arrive by the same path.
    this.corpusView.onNavigate = (x, y) => {
      this.ps.set('acorp.x', x);
      this.ps.set('acorp.y', y);
    };
    this._refreshCorpusLabels();
  }

  /** Measure the whole tape and build the map (§4.6). */
  async analyseCorpus() {
    if (!this.running) return this._say('corpus analysis needs the audio engine running');
    if (this._corpusJobId >= 0) return this._say('corpus: already analysing');
    const g = (id) => this.ps.get(id).value;
    const sr = this.engine.sampleRate;
    const hop = Math.max(1, Math.round((g('acorp.hop') / 1000) * sr));
    const window = Math.max(1, Math.round((g('acorp.window') / 1000) * sr));
    const { jobId, done } = this.engine.analyseCorpus(0, this._tapeLen, hop, window);
    this._corpusJobId = jobId;
    this._say('corpus: analysing the tape…');
    const res = await done;
    this._corpusJobId = -1;
    if (!res.ok) return this._say(`corpus analysis refused (${res.code}): ${res.message}`);
    if (!res.data) return this._say('corpus: the analysis finished but sent no table');
    this._corpusRaw = res.data;
    // `_rebuildCorpus` owns the reporting, and must be the LAST thing to speak.
    // Saying the measured count here afterwards clobbered it — so the one number
    // a performer needs, how many grains are actually reachable, was replaced by
    // the raw total a millisecond later and never seen.
    this._rebuildCorpus();
    return res;
  }

  cancelCorpus() {
    if (!(this._corpusJobId >= 0)) return this._say('corpus: nothing is analysing');
    this.engine.cancelJob(this._corpusJobId);
  }

  /**
   * Rebuild the 2D map from the measurements already held.
   *
   * Separate from the analysis, because changing which descriptors are the axes
   * is a re-projection of the same measurements and must NOT re-measure the
   * tape — that would turn a menu change into a multi-second job, and it is the
   * whole reason the corpus is an index rather than a second buffer (§4.6).
   */
  _rebuildCorpus() {
    const d = this._corpusRaw;
    if (!d) return;
    const g = (id) => this.ps.get(id).value;
    // What the grain player can actually read: its partition, or the whole tape
    // when `unsafe`. The same span `_grainSpan` computes engine-side, so the map
    // shows exactly the grains the reader will play and no others.
    const n = this._tapeLen;
    const part = this._part(g('agrain.part'));
    const reach = g('agrain.unsafe')
      ? { lo: 0, hi: n }
      : { lo: part.start * n, hi: (part.start + part.len) * n };
    this._corpus = buildIndex(
      d.raw, d.count, d.start, d.hop, g('acorp.xAxis'), g('acorp.yAxis'), 32, reach);
    const c = this._corpus;
    if (!c.dropped) {
      this._say(`corpus: ${c.count} grains`);
    } else {
      // The two reasons are named separately because the fixes differ: one
      // wants a different axis pair, the other a different partition.
      const why = [];
      if (c.droppedPitchless) why.push(`${c.droppedPitchless} unpitched`);
      if (c.droppedUnreachable) why.push(`${c.droppedUnreachable} outside P${g('agrain.part')}`);
      this._say(`corpus: ${c.count} of ${d.count} grains reachable `
        + `(${why.join(', ')})`);
    }
    this._refreshCorpusLabels();
    this._navigate();
  }

  _refreshCorpusLabels() {
    if (!this.corpusView) return;
    const label = (id) => DESCRIPTORS[this.ps.get(id).value]?.label ?? '';
    this.corpusView.setIndex(this._corpus, label('acorp.xAxis'), label('acorp.yAxis'));
  }

  /**
   * `agrain.pos` is a fraction OF THE PARTITION, like every other zone
   * position (§4.3); the engine wants samples relative to the partition start.
   * One conversion site, the same rule the rest of this file follows.
   */
  _grainPosSamples(frac) {
    return frac * this._part(this.ps.get('agrain.part').value).len * this._tapeLen;
  }

  /** Resolve the current XY to a timestamp and point the grain player at it. */
  _navigate() {
    if (!this._corpus || !this._corpus.count) return;
    const x = this.ps.get('acorp.x').value;
    const y = this.ps.get('acorp.y').value;
    this.corpusView?.setCursor(x, y);
    const k = nearest(this._corpus, x, y);
    if (k < 0) return;
    const part = this._part(this.ps.get('agrain.part').value);
    // The engine takes a position RELATIVE to the grain zone's partition, and
    // the corpus holds absolute tape samples — the same fractions→samples seam
    // every other zone parameter crosses, in the one direction that has to be
    // undone rather than applied.
    const abs = grainTime(this._corpus, k);
    // Write the PARAM, not the address. `agrain.pos` is now a real parameter
    // (the time-stretch control), so the pad and an LFO would otherwise be two
    // writers racing for one engine address, with the pad's value invisible in
    // the UI and absent from any captured state. Going through the param makes
    // the subscription below the single path to `/zone/grain/0/pos` — and the
    // pad's landing position shows up on its own row, which is also how you
    // find out where the pad just sent you.
    const len = part.len * this._tapeLen;
    // A zero-length partition would divide by zero; the pad has nothing to
    // point at in that case anyway.
    if (len > 0) {
      this.ps.set('agrain.pos', Math.min(1, Math.max(0, (abs - part.start * this._tapeLen) / len)));
    }
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

  /**
   * Milliseconds → samples. The grain player's size and spray are authored in
   * ms because that is the unit a granular gesture is actually thought in, and
   * the engine speaks samples like every other position in the protocol.
   */
  _ms(milliseconds) { return (milliseconds / 1000) * this.engine.sampleRate; }

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

  /**
   * Send a zone's partition, and remember the recorder's.
   *
   * **The ONE place `_recPart` is assigned**, and that is deliberate rather than
   * tidy. It is a mirror of engine state, which is the shape of thing this
   * project keeps paying for — so it gets exactly one writer, sitting on the
   * exact call that makes it true. The audit asserts there is only one.
   *
   * It exists because reverting a refused change needs the last value the
   * engine ACCEPTED, and a Parameter does not keep its previous value. Reverting
   * to anything else would put the two back out of step in the other direction.
   */
  _sendZonePart(type, slot) {
    this.engine.zonePart(type, 0, slot);
    if (type === 'rec') this._recPart = slot;
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

    this._on('audio.monitor', () => this._refreshLoop());

    this._on('audio.mic', async (v) => {
      if (v) {
        try {
          await this.engine.openMic(this._micConstraints());
          // Was an unconditional "USE HEADPHONES", which is advice rather than
          // information and is wrong half the time — it fired at someone
          // already wearing them, and said the same thing to someone on
          // speakers who had just closed a real loop. §8.6's switch is what
          // lets this report the state instead of guessing at it.
          this._say(this._loopLive() ? 'mic open — the room loop is LIVE' : 'mic open');
        } catch (e) { this._say(`mic denied: ${e.message}`); this.ps.set('audio.mic', 0); }
        this._refreshLoop();
      } else {
        this.engine.closeMic();
        this._refreshLoop();
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
          // Moving a partition moves what the grain player can reach, so the
          // corpus is re-projected for the same reason `agrain.part` does it.
          this._rebuildCorpus();
        });
      }
    }

    for (const [prefix, type] of [['arec', 'rec'], ['aplay', 'play']]) {
      this._on(`${prefix}.part`, (v) => {
        /**
         * A RUNNING recorder cannot move (§4.4), and the client has to say so
         * too — the engine's refusal alone is not enough.
         *
         * The engine refusing keeps the AUDIO right: the take goes on landing
         * where it was. What it cannot fix is that `arec.part` has already
         * changed on this side, so the button shows P1, the tape display draws
         * the REC band over P1 (it reads this param, not the engine), and the
         * recording is in P0. Every surface agrees with every other surface and
         * all of them are wrong — which is exactly how this was reported:
         * "recording into P1, it still goes into P0". A refusal on the status
         * line does not undo that; it only annotates it.
         *
         * So the value goes back. `_applyFromEngine` is the vehicle because it
         * suppresses the echo — reverting through a plain `set` would re-enter
         * this handler with the old value and send it to the engine again.
         *
         * This also covers a Display State recall or a loaded project trying to
         * move it mid-take: `arec.part` is captured (group 'arec'), so a recall
         * IS a writer, and it gets the same answer as a click.
         */
        if (type === 'rec' && this.ps.get('arec.on').value) {
          this._applyFromEngine('arec.part', this._recPart);
          return this._say('recording — stop Run Rec to change its partition');
        }
        this._sendZonePart(type, v);
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

    // The spectral writer. Only the two the ENGINE holds are pushed on change —
    // partition and unsafe. Everything else (scale, root, rows, region,
    // contrast) is read at render time, because it never crosses the port as a
    // setting: it is arithmetic that produces the frequencies and the image.
    this._on('aspec.part', (v) => this.engine.zonePart('spectral', 0, v));
    this._on('aspec.unsafe', (v) => this.engine.zoneUnsafe('spectral', 0, !!v));
    this._on('aspec.render', () => { this.renderSpectral(); });
    this._on('aspec.cancel', () => this.cancelSpectral());

    // The corpus (§4.6). Axis changes RE-PROJECT the measurements already held;
    // they never re-measure. That is the index paying for itself.
    this._on('acorp.analyse', () => { this.analyseCorpus(); });
    this._on('acorp.cancel', () => this.cancelCorpus());
    this._on('acorp.xAxis', () => this._rebuildCorpus());
    this._on('acorp.yAxis', () => this._rebuildCorpus());
    this._on('acorp.x', () => this._navigate());
    this._on('acorp.y', () => this._navigate());

    // Both of these change WHAT THE READER CAN REACH, so both re-project the
    // map — the cloud must never show a grain the player would wrap away from.
    // `part` re-sends `pos` because the fraction is OF the partition: the same
    // 0.5 means a different sample the moment the partition changes, and the
    // engine holds samples. Without this the cloud would keep reading the old
    // absolute position until something happened to touch pos again.
    this._on('agrain.part', (v) => {
      this.engine.grainPart(0, v);
      this.engine.grainPos(0, this._grainPosSamples(this.ps.get('agrain.pos').value));
      this._rebuildCorpus();
    });
    this._on('agrain.pos', (v) => this.engine.grainPos(0, this._grainPosSamples(v)));
    this._on('agrain.unsafe', (v) => { this.engine.grainUnsafe(0, !!v); this._rebuildCorpus(); });
    this._on('agrain.on', (v) => { if (v) this.engine.grainOn(0); else this.engine.grainOff(0); });
    this._on('agrain.size', (v) => this.engine.grainSize(0, this._ms(v)));
    this._on('agrain.rate', (v) => this.engine.grainRate(0, v));
    // Semitones → a read-rate ratio. 0 st is 1×, twelve semitones is 2×.
    this._on('agrain.pitch', (v) => this.engine.grainPitch(0, Math.pow(2, v / 12)));
    this._on('agrain.spray', (v) => this.engine.grainSpray(0, this._ms(v)));
    this._on('agrain.level', (v) => this.engine.grainLevel(0, v));

    // Reallocating throws away every recording, so it is not a live control:
    // it applies on the next enable. Reflected here rather than silently
    // ignored, because a slider that appears to do nothing is worse than one
    // that says why.
    this._on('audio.tapeSec', () => this._say(
      'tape length applies on the next Audio On — reallocating would discard the tape'));
  }
}
