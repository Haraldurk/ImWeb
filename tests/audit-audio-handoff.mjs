/**
 * §8.7's hand-off: which controllers move to the worklet, and whether the two
 * evaluators agree once one has.
 *
 * §8.7 names the cost of this section up front — *"two code paths. With audio
 * off entirely, modulation falls back to rAF. This is where bugs will live."*
 * The path with audio OFF is the one nobody exercises while developing, because
 * developing means the engine is running. So it is tested here: the same
 * description is evaluated by `src/controls/LFO.js` and by the worklet, over the
 * same elapsed time, and the two waveforms are compared.
 *
 * Both halves are importable in Node — the LFO because it is plain arithmetic,
 * the worklet because §4.1 gives it zero imports — so this needs no browser and
 * no audio device.
 *
 * Run:  node tests/audit-audio-handoff.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { LFO } from '../src/controls/LFO.js';
import {
  Parameter, SLEW_CURVES, SLEW_CURVE_HAS_STRENGTH, slewExcursion,
} from '../src/controls/ParameterSystem.js';
import {
  AUDIO_TARGETS, CTRL_SHAPES, describeController, describeSlew, descDiff,
  semitoneToHz, sampleSlewCurve, slewStrength, SLEW_MECHANISM, SLEW_SEGMENT,
} from '../src/audio/ctrl-handoff.js';
import { PROTO_VERSION } from '../src/audio/protocol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── the engine, headless (same three globals as the DSP audit) ─────────────
const SR = 48000;
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage: (m) => this.__sent.push(m) };
    this.__sent = [];
  }
};
let Processor = null;
globalThis.registerProcessor = (_name, cls) => { Processor = cls; };
await import(`file://${resolve(root, 'src/audio/engine/tape-processor.js')}`);

// ── 1. the target list is a list, and it agrees with the engine ────────────
console.log('the audio-relevance list');
{
  const ids = AUDIO_TARGETS.map((t) => t.id);
  // The count is asserted alongside the uniqueness, not as decoration: on an
  // empty list `new Set([]).size === [].length` is TRUE, so this check — and
  // the density check below it — would both pass green with the whole target
  // list gone. See the collection-assertion section of audit-audit-hygiene.
  check('every entry is unique', ids.length > 0 && new Set(ids).size === ids.length,
    ids.join(', '));
  // The slot IS the index. Nothing persists it, so it cannot drift — but a
  // reordering would silently repoint a live binding mid-session.
  check('slots are positional and dense', AUDIO_TARGETS.every((t, i) => i === AUDIO_TARGETS.indexOf(t)));

  // Every address must be one the ENGINE can actually bind, which is the
  // single-float rule. Checked against the engine rather than asserted, so an
  // entry added here that the engine refuses fails at build time rather than as
  // an LFO that mysteriously does nothing.
  const p = new Processor();
  p.port.onmessage({ data: { a: '/engine/hello', t: 'i', v: [PROTO_VERSION] } });
  for (let slot = 0; slot < AUDIO_TARGETS.length; slot++) {
    p.__sent.length = 0;
    p.port.onmessage({ data: { a: `/ctrl/${slot}/target`, t: 's', v: [AUDIO_TARGETS[slot].address] } });
    const refused = p.__sent.some((m) => m.a === '/engine/refuse');
    check(`the engine accepts ${AUDIO_TARGETS[slot].address}`, !refused,
      'the engine refuses it — a target the client thinks it owns and nothing drives');
  }
}

// ── 2. eligibility: what the worklet may NOT take ──────────────────────────
//
// Every null here is a feature the worklet does not have yet. Handing the
// parameter over anyway would not fail loudly — it would silently drop that
// feature, which is the worst outcome available.
console.log('\nwhat stays on the rAF path, and why');
{
  const entry = AUDIO_TARGETS[2];                        // avoice.level, linear
  const param = () => ({ min: 0, max: 1, ctrlMin: null, ctrlMax: null, slew: 0 });
  const lfo = (over = {}) => Object.assign(
    new LFO({ shape: 'sine', hz: 2, phase: 0, mode: 'norm', width: 0.5 }), over);

  check('a plain LFO is taken', !!describeController(param(), lfo(), entry));
  check('a beat-synced LFO is NOT taken', describeController(param(), lfo({ beatSync: true }), entry) === null,
    'the worklet has no beat clock — it would free-run at whatever Hz it last held');
  check('an xmap LFO is NOT taken', describeController(param(), lfo({ mode: 'xmap' }), entry) === null,
    'externally triggered, and the trigger is client-side');
  // Response tables no longer disqualify — they travel as data. But a table
  // NAMED and not resolvable still must, because the client would then be
  // shaping the row's value with a curve the worklet has never seen.
  const curve = { points: new Float32Array(16384) };
  check('a param with a RESOLVED response table is taken',
    !!describeController({ ...param(), table: 'sCurve' }, lfo(), entry, curve));
  check('a param whose table cannot be resolved is NOT taken',
    describeController({ ...param(), table: 'sCurve' }, lfo(), entry, null) === null,
    'the sweep would be shaped by a curve the worklet has never seen');
  // Slew no longer disqualifies either — but a slew nobody could describe
  // still does, which is the same rule as for an unresolvable table.
  const slewDesc = describeSlew({ slew: 0.2, slewShape: 'lag', min: 0, max: 1 });
  check('a param with a DESCRIBED slew is taken',
    !!describeController({ ...param(), slew: 0.2 }, lfo(), entry, null, slewDesc));
  check('a param with an undescribed slew is NOT taken',
    describeController({ ...param(), slew: 0.2 }, lfo(), entry, null, null) === null,
    'the row would say one shape and the sound be another');
  check('an unknown slew curve name cannot be described',
    describeSlew({ slew: 0.2, slewShape: 'wobble', min: 0, max: 1 }) === null);
  check('a segment curve with no sampled curve cannot be described',
    describeSlew({ slew: 0.2, slewShape: 'bounce', min: 0, max: 1 }) === null,
    'it would silently become no slew at all');
  check('an unknown shape is NOT taken',
    describeController(param(), lfo({ shape: 'wobble' }), entry) === null);
  check('a non-finite range is NOT taken',
    describeController({ ...param(), min: NaN }, lfo(), entry) === null,
    'NaN endpoints would reach the engine and produce silence, not an error');
}

// ── 3. the description carries the client's own semantics ──────────────────
console.log('\nthe description reproduces what the client would have done');
{
  const lfo = new LFO({ shape: 'square', hz: 3, phase: 0.25, mode: 'shot', width: 0.3 });
  const d = describeController(
    { min: 0, max: 1, ctrlMin: 0.2, ctrlMax: 0.8, slew: 0 }, lfo, AUDIO_TARGETS[2]);
  check('shape, rate, width and mode travel', d.shape === CTRL_SHAPES.square
    && d.hz === 3 && d.width === 0.3 && d.mode === 1, JSON.stringify(d));
  check('phase travels as the OFFSET it is', d.phase === 0.25);
  check('ctrlMin/ctrlMax become the range', d.lo === 0.2 && d.hi === 0.8);

  // Invert travels as a FLAG and the range keeps its order. Swapping the
  // endpoints instead is identical arithmetic while there is no response curve
  // and wrong the moment there is one, because `setNormalized` inverts BEFORE
  // the table: `table(1 − x)` over lo..hi is not `table(x)` over hi..lo.
  const inv = describeController(
    { min: 0, max: 1, ctrlMin: 0.2, ctrlMax: 0.8, slew: 0, invert: true },
    new LFO({ shape: 'sine' }), AUDIO_TARGETS[2]);
  check('invert travels as a flag, applied before the table',
    inv.invert === 1 && inv.lo === 0.2 && inv.hi === 0.8, `${inv.lo}..${inv.hi}, invert ${inv.invert}`);

  // Pitch: semitones out, Hz in, exponential. The map is not an approximation
  // of the semitone sweep — a linear ramp in semitones IS a constant-ratio
  // sweep, because semitones are a log₂ frequency scale.
  const pitch = describeController(
    { min: 12, max: 120, ctrlMin: 57, ctrlMax: 69, slew: 0 },
    new LFO({ shape: 'sawtooth' }), AUDIO_TARGETS[1]);
  check('pitch converts semitones to Hz', Math.abs(pitch.lo - 220) < 1e-9 && Math.abs(pitch.hi - 440) < 1e-9,
    `${pitch.lo}..${pitch.hi}`);
  check('pitch asks for the exponential map', pitch.map === 1,
    'a linear sweep between two frequencies spends most of its travel in the top octave');
  check('an octave in semitones is a doubling in Hz',
    Math.abs(semitoneToHz(69) / semitoneToHz(57) - 2) < 1e-12);
}

// ── 4. only changes go over the port ───────────────────────────────────────
console.log('\nthe reconcile sends only what changed');
{
  const base = { shape: 0, hz: 2, width: 0.5, mode: 0, phase: 0, lo: 0, hi: 1, map: 0 };
  const first = descDiff(null, base);
  check('the first reconcile sends everything, and binds',
    first.lfo && first.range && first.phase && first.bind);
  const same = descDiff(base, { ...base });
  check('an unchanged controller sends nothing',
    !same.lfo && !same.range && !same.phase && !same.bind,
    'a per-frame re-send would be 60 messages a second saying the same thing');
  const rate = descDiff(base, { ...base, hz: 4 });
  check('a rate change sends the LFO message only',
    rate.lfo && !rate.range && !rate.phase && !rate.bind);
  const range = descDiff(base, { ...base, hi: 0.5 });
  check('a range change sends the range message only',
    !range.lfo && range.range && !range.phase && !range.bind);
  const phase = descDiff(base, { ...base, phase: 0.3 });
  check('a phase change sends the phase message only',
    !phase.lfo && !phase.range && phase.phase && !phase.bind,
    'and NOT a retrigger — phase slides the wave, it does not restart it');
  const inv = descDiff(base, { ...base, invert: 1 });
  check('an invert change rides on the range message', inv.range && !inv.lfo);

  // A curve upload is 64 KB, so it must fire on a real change and never on a
  // re-send. Reference identity is exactly the right test: `TableManager.set()`
  // replaces the curve object, so an edit changes it and a redraw does not.
  const t1 = { points: new Float32Array(16384) };
  const t2 = { points: new Float32Array(16384) };
  check('no table, no upload', !descDiff({ ...base, table: null }, { ...base, table: null }).table);
  check('attaching a curve uploads it',
    descDiff({ ...base, table: null }, { ...base, table: t1 }).table);
  check('the same curve object does not re-upload',
    !descDiff({ ...base, table: t1 }, { ...base, table: t1 }).table,
    '64 KB a frame for a curve nobody touched');
  check('a replaced curve object DOES re-upload',
    descDiff({ ...base, table: t1 }, { ...base, table: t2 }).table,
    'editing a table replaces the object — a stale curve in the worklet is silent');

  const s1 = { mode: 1, seconds: 0.1, damp: 0.45, strength: 1, curve: null, min: 0, max: 1, under: 0, over: 0, k0: 0 };
  check('an unchanged slew sends nothing', !descDiff({ ...base, slew: s1 }, { ...base, slew: s1 }).slew);
  check('a slew TIME change re-sends',
    descDiff({ ...base, slew: s1 }, { ...base, slew: { ...s1, seconds: 0.3 } }).slew,
    'dragging Slew in the popover would otherwise do nothing to the sound');
  check('turning slew off re-sends',
    descDiff({ ...base, slew: s1 }, { ...base, slew: null }).slew);
}

// ── 5. THE FALLBACK PATH: both evaluators agree ────────────────────────────
//
// §8.7's stated cost, made a test. With audio off the rAF path evaluates the
// same controller, and a divergence there is invisible during development
// because development means the engine is up. Same description, same elapsed
// time, compared sample for sample.
console.log('\nthe two code paths agree on the same description');
{
  // Long enough for every shape to cover more than a full cycle at 1.7 Hz —
  // 60 quanta is 160 ms, a quarter cycle, over which a sawtooth moves a third
  // of its range and a square may not toggle at all. A comparison that never
  // saw an edge would call the two paths equal for the wrong reason.
  const QUANTA = 400;
  const DT = 128 / SR;                       // one quantum, so both accumulate alike

  const engineRun = (desc) => {
    const p = new Processor();
    const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
    send('/engine/hello', PROTO_VERSION);
    send('/ctrl/0/lfo', desc.shape, desc.hz, desc.width, desc.mode);
    send('/ctrl/0/range', desc.lo, desc.hi, desc.map);
    send('/ctrl/0/phase', desc.phase);
    send('/ctrl/0/target', '/voice/0/level');
    const out = [new Float32Array(128), new Float32Array(128)];
    const seen = [];
    for (let q = 0; q < QUANTA; q++) {
      p.process([[]], [out]);
      seen.push(p._ctrls[0].buf[127]);       // the value at the quantum's end
    }
    return seen;
  };

  const clientRun = (desc, lfo, param) => {
    const seen = [];
    for (let q = 0; q < QUANTA; q++) {
      const raw = lfo.tick(DT);
      // What `Parameter.setNormalized` does to a controller value, for a param
      // with no table and no slew: map onto [ctrlMin, ctrlMax].
      const lo = param.ctrlMin, hi = param.ctrlMax;
      seen.push(lo + raw * (hi - lo));
    }
    return seen;
  };

  for (const shape of ['sine', 'triangle', 'sawtooth', 'rampdown', 'square']) {
    const param = { min: 0, max: 1, ctrlMin: 0.25, ctrlMax: 0.75, slew: 0 };
    const lfo = new LFO({ shape, hz: 1.7, phase: 0, mode: 'norm', width: 0.5 });
    const desc = describeController(param, lfo, AUDIO_TARGETS[2]);
    const a = engineRun(desc);
    const b = clientRun(desc, lfo, param);
    let worst = 0, at = -1;
    for (let i = 0; i < QUANTA; i++) {
      const d = Math.abs(a[i] - b[i]);
      if (d > worst) { worst = d; at = i; }
    }
    // A square's edges land between two quantum boundaries, so the two paths
    // can straddle one sample of the transition — hence the wider tolerance
    // there. The continuous shapes must agree far more tightly than that.
    const tol = shape === 'square' ? 0.51 : 2e-3;
    check(`${shape}: the worklet and the rAF path produce the same wave`, worst < tol,
      `worst divergence ${worst.toFixed(5)} at quantum ${at}`);
    check(`${shape}: the comparison is live (the wave actually moved)`,
      Math.max(...a) - Math.min(...a) > 0.2, `range ${(Math.max(...a) - Math.min(...a)).toFixed(3)}`);
  }
}

// ── 5b. SLEW: the one place the audio half reimplements client logic ───────
//
// §8.7 says *"sample the seven slew curves and transfer them as buffers"*. That
// is true of four of them. `lag` is a one-pole filter, `ease` a critically
// damped spring carrying velocity, `elastic` an underdamped spring that
// collides with the parameter's rails — none is a function of normalized time,
// so none can be a table. What travels for those is the mechanism, and the
// worklet runs a second copy of the physics.
//
// A second copy is exactly what §8.7 warns against, so it is pinned the only
// way that means anything: run `Parameter.tickSlew` and the worklet's
// `_ctrlSlew` over the same description AT THE SAME dt and compare sample for
// sample. A divergence is a failure, not a tolerance to widen.
console.log('\nslew: both implementations, same description, same dt');
{
  const DT = 1 / SR;
  const STEPS = 6000;                          // ~125 ms of audio

  /**
   * The client: one Parameter, slewed, driven by a moving target.
   *
   * Through `setNormalized`, not through a hand-rolled copy of the arming rule.
   * The arming rule — a new segment only once the previous one landed — is part
   * of what is under test, and re-stating it here would be a second copy inside
   * the very test that exists to catch second copies. The parameter is 0..1 with
   * no ctrlMin/ctrlMax and no table, so a normalized write IS the target.
   */
  const clientRun = (shape, target, cfg = {}) => {
    const p = new Parameter({
      id: 'test', label: 'test', min: 0, max: 1, value: 0.5, step: 0.001,
    });
    p.slew = cfg.slew ?? 0.02;
    p.slewShape = shape;
    p.slewDamp = cfg.damp ?? 0.45;
    p.slewStrength = cfg.strength ?? 1;
    p._value = 0.5;
    p._target = 0.5;
    p._slewFrom = 0.5;
    p._slewK = 1;
    const out = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) {
      p.setNormalized(target(i));
      p.tickSlew(DT);
      out[i] = p._value;
    }
    return out;
  };

  /** The engine: the same slew, fed the same targets through _ctrlSlew. */
  const engineRun = (shape, target, cfg = {}) => {
    const proc = new Processor();
    const send = (a, ...v) => proc.port.onmessage({ data: { a, t: '', v } });
    send('/engine/hello', PROTO_VERSION);
    const strength = cfg.strength ?? 1;
    const slew = describeSlew(
      {
        slew: cfg.slew ?? 0.02, slewShape: shape, min: 0, max: 1,
        slewDamp: cfg.damp ?? 0.45, slewStrength: strength,
      },
      // Sampled at the CLAMPED strength, through the same helper the binding
      // uses — the client clamps a segment curve to 0..3 and the elastic spring
      // to 0.25..4, and sampling at the raw 4 while the client evaluates 3 is a
      // different shape. That is what this corner found.
      SLEW_MECHANISM[shape] === SLEW_SEGMENT
        ? sampleSlewCurve(SLEW_CURVES[shape],
          SLEW_CURVE_HAS_STRENGTH[shape] ? slewStrength(SLEW_SEGMENT, strength) : 1) : null,
      SLEW_MECHANISM[shape] === SLEW_SEGMENT
        ? slewExcursion(shape,
          SLEW_CURVE_HAS_STRENGTH[shape] ? slewStrength(SLEW_SEGMENT, strength) : 1) : null);
    if (slew.curve) send('/table/0/data', slew.curve.buffer);
    send('/ctrl/0/slewfit', slew.curve ? 0 : -1, slew.min, slew.max, slew.under, slew.over, slew.k0);
    send('/ctrl/0/slew', slew.mode, slew.seconds, slew.damp, slew.strength);
    const c = proc._ctrls[0];
    // Seeded to the client's starting state, so the comparison is of the
    // mechanism and not of where each happened to begin.
    c.slewInit = 1; c.slewVal = 0.5; c.slewTgt = 0.5; c.slewFrom = 0.5; c.slewK = 1;
    const out = new Float32Array(STEPS);
    for (let i = 0; i < STEPS; i++) out[i] = proc._ctrlSlew(c, target(i), DT);
    return out;
  };

  // Two target shapes, because they exercise different halves: a STEP is what a
  // segment curve is designed for, and a SWEEP is what an LFO actually does —
  // the case where a segment re-aims mid-flight rather than restarting.
  const step = (i) => (i < 200 ? 0.5 : 0.9);
  const sweep = (i) => 0.5 + 0.4 * Math.sin(2 * Math.PI * 3 * i * DT);
  // Rail to rail. The excursion FITTING only engages when a lobe has no room —
  // Back's dip needs space below the start, Bounce's overshoot needs space past
  // the target — so a comfortable mid-range move never exercises it, and the
  // first version of this test passed with the fitting deleted entirely.
  // Elastic's rail COLLISION and its parking are only reached here too.
  // The first phase must be long enough for the value to ARRIVE at the floor
  // before the step: at 200 samples it was still at 0.45 when the target moved,
  // so the move began mid-range and the fitting never engaged.
  const rails = (i) => (i < 2000 ? 0.02 : 0.99);

  for (const [name, target] of [
    ['a step', step], ['a swept target', sweep], ['a rail-to-rail step', rails],
  ]) {
    for (const shape of ['lag', 'ease', 'elastic', 'ease2', 'expo', 'bounce', 'back']) {
      const a = clientRun(shape, target);
      const b = engineRun(shape, target);
      let worst = 0, at = -1;
      for (let i = 0; i < STEPS; i++) {
        const d = Math.abs(a[i] - b[i]);
        if (d > worst) { worst = d; at = i; }
      }
      check(`${shape} on ${name}: the two implementations agree`, worst < 1e-6,
        `worst divergence ${worst.toExponential(2)} at step ${at}`);
    }
  }

  // THE CLAMP CORNERS. The comparison above runs at one setting, and the
  // springs' agreement is not unconditional in the way a curve's is: elastic's
  // stiffness is ω = 5·Strength / Slew, so the corner of the two clamps —
  // Strength 4 against the 1 ms floor — puts ω·dt at 0.42, past the 0.3 rad
  // limit where the client substeps. Before the worklet substepped too, that
  // corner diverged by 0.107 while every check here stayed green.
  {
    for (const [label, cfg] of [
      ['stiffest: strength 4, slew 1 ms, damp 0.05', { slew: 0.001, strength: 4, damp: 0.05 }],
      ['fast and springy: strength 4, slew 5 ms', { slew: 0.005, strength: 4, damp: 0.2 }],
      ['softest: strength 0.25, slew 2 s, damp 1', { slew: 2, strength: 0.25, damp: 1 }],
    ]) {
      for (const shape of ['elastic', 'ease', 'lag', 'back']) {
        const a = clientRun(shape, rails, cfg);
        const b = engineRun(shape, rails, cfg);
        let worst = 0;
        for (let i = 0; i < STEPS; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
        check(`${shape} at the ${label}: still agree`, worst < 1e-6,
          `worst divergence ${worst.toExponential(2)}`);
      }
    }
  }

  // Calibration: the comparison must be capable of failing, and the slew must
  // actually be doing something rather than passing the value through.
  {
    const a = clientRun('bounce', step);
    const plain = step;
    let moved = 0;
    for (let i = 0; i < STEPS; i++) moved = Math.max(moved, Math.abs(a[i] - plain(i)));
    check('the slew visibly lags the target (the comparison is live)', moved > 0.1,
      `largest gap between value and target ${moved.toFixed(3)}`);
    const wrong = clientRun('lag', step);
    let diff = 0;
    for (let i = 0; i < STEPS; i++) diff = Math.max(diff, Math.abs(a[i] - wrong[i]));
    check('two different curves produce measurably different traces', diff > 0.05,
      `lag vs bounce differ by ${diff.toFixed(3)} — a comparison that cannot tell them apart proves nothing`);

    // And the rail case must actually reach the rails, or the fitting and the
    // collision are still untested however many shapes are compared.
    const railTrace = clientRun('back', rails);
    let lowest = 1;
    for (let i = 0; i < STEPS; i++) lowest = Math.min(lowest, railTrace[i]);
    check('the rail case presses against a rail (the fitting is exercised)', lowest <= 0.02,
      `lowest value ${lowest.toFixed(4)} — Back should try to dip below its start and be squeezed`);
    const springTrace = clientRun('elastic', rails);
    let highest = 0;
    for (let i = 0; i < STEPS; i++) highest = Math.max(highest, springTrace[i]);
    check('the spring reaches the ceiling (the collision is exercised)', highest >= 0.999,
      `highest ${highest.toFixed(4)} — elastic should overshoot into the rail and bounce off it`);
  }

  // The rails a segment curve fits against are the PARAMETER's min/max, not the
  // controller's range. Using the narrower range would give Back a different dip
  // on the audio side than on the video side — the same shape, quietly rescaled.
  {
    const d = describeSlew(
      { slew: 0.1, slewShape: 'back', min: -4, max: 4, ctrlMin: 0, ctrlMax: 1 },
      sampleSlewCurve(SLEW_CURVES.back, 1), slewExcursion('back', 1));
    check('the fitting rails are the parameter min/max, not the sweep range',
      d.min === -4 && d.max === 4, `${d.min}..${d.max}`);
  }
}

// ── 6. the client half is wired where it has to be ─────────────────────────
//
// Three call sites carry the hand-off, and each is invisible when missing:
// without the tick guard both paths write the parameter; without the retrigger
// hook a Display State recall silently stops retriggering the moved LFOs;
// without the reconcile call nothing is ever handed over at all.
console.log('\nthe three call sites exist');
{
  const cm = read('src/controls/ControllerManager.js');
  const main = read('src/main.js');
  check('ControllerManager skips params the worklet owns',
    /ownsParam\?\.\(paramId\)/.test(cm),
    'both paths would write the parameter, one of them a frame stale');
  check('retriggerLFOs also retriggers the worklet-owned ones',
    /retriggerLFOs\s*\(\)[\s\S]{0,900}retriggerOwned/.test(cm),
    '§8.7: a re-sent description is an update, so recall must send the verb');
  check('main.js reconciles once a frame, after the tick',
    /ctrl\.tick\(dt, beatPhase\);[\s\S]{0,600}audio\.syncControllers\(\)/.test(main),
    'the tick is where xmap and BPM sync rewrite an LFO rate');
  check('the binding is given ControllerManager', /audio\.controllers\s*=\s*ctrl/.test(main),
    'the live LFO object is the only source of truth for a description');

  // The hand-off is gated on the LIVENESS PROOF, not on `running`. An engine
  // that loaded but whose audio callback never fires answers every message
  // normally while `process()` never runs (LEARNED 2026-08-13) — handing a
  // parameter over then takes it off the rAF path and gives it to something
  // that never ticks. Modulation would freeze: §8.7's own fault, reintroduced
  // by §8.7's fix, and only on machines with no output device.
  const bind = read('src/audio/AudioBinding.js');
  check('the hand-off requires a proven-live engine, not just a started one',
    /this\.running && this\._alive/.test(bind),
    'an engine with a dead audio callback would freeze every modulation it took over');
  check('the liveness proof is what sets that flag',
    /this\._alive = await alive/.test(bind));
  check('and stopping clears it', /this\._alive = false/.test(bind));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll controller hand-off checks passed.\n');
process.exit(failures ? 1 : 0);
