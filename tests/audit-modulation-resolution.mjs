/**
 * Modulation resolution & slew curve audit.
 *
 * Why this exists. `step` does double duty on a Parameter: it is the UI drag
 * increment AND, via the `value` setter, a hard quantization of the stored
 * value. Controller writes used to go through that setter, so a slow LFO on a
 * step:0.01 param over a 0–1 range had only 100 places to land. Measured over
 * 10 s at 60 fps, a sine LFO changed the value on:
 *
 *     1 Hz → 560/600 frames      0.1 Hz → 200/600
 *     0.01 Hz → 30/600           0.001 Hz → 4/600
 *
 * At 0.01 Hz that is ~3 movements a second: a visible stutter while the fps
 * counter reads a healthy 60. Nothing errors — the renderer is fine, the
 * parameter is stepping — which is why this never showed up as a perf bug and
 * why it needs an audit rather than a runtime assert.
 *
 * Two invariants are enforced here:
 *
 *   1. Controller-driven writes quantize only to an INTEGER step. Integer steps
 *      are the value (octaves, line counts, sdf.count) and must still snap;
 *      anything finer is a UI increment and must not touch modulation.
 *
 *   2. slewShape 'ease' is a critically damped spring, not a lerp. Its defining
 *      property is that it carries velocity across frames, so a stepped source
 *      leaves at zero velocity. Reimplementing it as a fixed-duration
 *      interpolation would look right on a single S+H jump and then freeze
 *      solid on a continuously moving target, because the segment would restart
 *      every frame. That specific regression is checked below.
 *
 * Run:  node tests/audit-modulation-resolution.mjs
 */

import {
  ParameterSystem, Parameter, PARAM_TYPE, SLEW_CURVES, SLEW_SHAPES,
} from '../src/controls/ParameterSystem.js';
import { LFO } from '../src/controls/LFO.js';
import { xmapHz, XMAP_HZ_MIN, XMAP_HZ_MAX } from '../src/controls/ControllerManager.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const DT = 1 / 60;
const mk = (cfg) => {
  const ps = new ParameterSystem();
  ps.register(new Parameter({
    id: 'audit.knob', type: PARAM_TYPE.CONTINUOUS,
    min: 0, max: 1, step: 0.01, value: 0.5, ...cfg,
  }));
  return ps.params.get('audit.knob');
};

/** Frames (out of `frames`) on which an LFO at `hz` actually moved the value. */
const movingFrames = (p, hz, frames = 600) => {
  const lfo = new LFO({ shape: 'sine', hz });
  let prev = p.value, moved = 0;
  for (let i = 0; i < frames; i++) {
    p.setNormalized(lfo.tick(DT));
    p.tickSlew(DT);
    if (p.value !== prev) moved++;
    prev = p.value;
  }
  return moved;
};

// ── 1. Slow modulation is smooth ─────────────────────────────────────────────
console.log('\nslow modulation resolution (step:0.01 param, 0–1 range)');
for (const hz of [0.001, 0.01, 0.1]) {
  const moved = movingFrames(mk(), hz);
  check(`${hz} Hz sine moves the value on nearly every frame`,
    moved >= 590,
    `moved on ${moved}/600 — under the old step-quantized path this was ` +
    `${hz === 0.001 ? 4 : hz === 0.01 ? 30 : 200}/600, which reads as a stutter at 60 fps`);
}

// ── 2. Integer params still snap ─────────────────────────────────────────────
console.log('\ninteger steps are the value, not a UI increment');
{
  const p = mk({ min: 1, max: 8, step: 1, value: 4 });
  const lfo = new LFO({ shape: 'sine', hz: 1 });
  const seen = new Set();
  for (let i = 0; i < 300; i++) { p.setNormalized(lfo.tick(DT)); seen.add(p.value); }
  check('a step:1 param only ever holds integers',
    [...seen].every(Number.isInteger),
    `saw ${[...seen].join(',')} — fractional values here would break array ` +
    'indexing in the consumers (octaves, sdf.count, rutt.lines)');
  check('and it does sweep (test is not vacuous)', seen.size > 3,
    `saw ${seen.size} distinct values`);
}

// ── 3. 'ease' eases IN — velocity starts near zero and builds ────────────────
console.log('\nslewShape: ease starts slow, lag does not');
const jumpProfile = (slewShape) => {
  const p = mk();
  p.slew = 0.5;
  p.slewShape = slewShape;
  p.value = 0;          // at rest
  p.setNormalized(1);   // target jumps, S+H style
  const vel = [];
  let prev = p.value;
  for (let i = 0; i < 60; i++) {
    p.tickSlew(DT);
    vel.push((p.value - prev) / DT);
    prev = p.value;
  }
  return vel;
};
const lagVel  = jumpProfile('lag');
const easeVel = jumpProfile('ease');

check('lag is fastest on the very first frame (the snap being complained about)',
  lagVel.indexOf(Math.max(...lagVel)) === 0);
check('ease is NOT fastest on the first frame',
  easeVel.indexOf(Math.max(...easeVel)) > 0,
  `peak at frame ${easeVel.indexOf(Math.max(...easeVel))} — a one-pole lag ` +
  'peaks at frame 0, which is exactly the hard direction change being fixed');
check('ease leaves at a small fraction of lag\'s opening speed',
  easeVel[0] < lagVel[0] * 0.25,
  `ease=${easeVel[0].toFixed(3)} lag=${lagVel[0].toFixed(3)} units/s`);
check('ease eases OUT too — it decelerates into the target',
  easeVel[59] < Math.max(...easeVel) * 0.25,
  `final=${easeVel[59].toFixed(3)} peak=${Math.max(...easeVel).toFixed(3)}`);

// ── 4. ease still TRACKS a moving target ─────────────────────────────────────
// The regression guard. A fixed-duration eased segment restarted on every
// target change would park here, because a sine changes target every frame.
console.log('\nno curve freezes on a continuously moving source');
for (const shape of SLEW_SHAPES) {
  const p = mk();
  p.slew = 0.3;
  p.slewShape = shape;
  const lfo = new LFO({ shape: 'sine', hz: 0.5 });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 600; i++) {
    p.setNormalized(lfo.tick(DT));
    p.tickSlew(DT);
    if (i > 120) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
  }
  check(`${shape}: a 0.5 Hz sine still swings most of the range`,
    hi - lo > 0.7,
    `swing ${lo.toFixed(3)}..${hi.toFixed(3)} — a near-zero swing means the segment ` +
    'clock is being RESTARTED on every target change instead of re-aimed, which pins k at 0');
}

// ── 5. ease settles; it does not jitter forever ──────────────────────────────
console.log('\nease settles');
{
  const p = mk();
  p.slew = 0.2;
  p.slewShape = 'ease';
  p.value = 0;
  p.setNormalized(1);
  let n = 0;
  for (; n < 6000; n++) {
    const before = p.value;
    p.tickSlew(DT);
    if (before === p.value && p._slewVel === 0) break;
  }
  check('the spring parks at the target within a few seconds', n < 300,
    `still moving after ${n} frames`);
  check('and parks exactly on it', p.value === 1, `parked at ${p.value}`);
}

// ── 5b. Every segment curve lands exactly on its target ─────────────────────
// f(1) must be exactly 1. A curve that ends at 0.999 leaves the parameter
// permanently short of where the controller asked for, and because the early-
// out in tickSlew never fires it also fires listeners forever.
console.log('\nsegment curves land, and land exactly');
for (const [name, f] of Object.entries(SLEW_CURVES)) {
  check(`${name}: f(0) === 0 and f(1) === 1`,
    f(0) === 0 && f(1) === 1, `f(0)=${f(0)} f(1)=${f(1)}`);
}
for (const shape of SLEW_SHAPES) {
  const p = mk();
  p.slew = 0.15;
  p.slewShape = shape;
  const asked = [0.2, 0.9, 0.1, 0.7];
  const got = [];
  for (const t of asked) {
    p.setNormalized(t);
    for (let i = 0; i < 30; i++) p.tickSlew(DT);  // 0.5 s, well past the 0.15 s slew
    got.push(p.value);
  }
  // The filters are asymptotic and legitimately arrive a hair short; the
  // segment curves have a defined end and must be exact.
  const tol = SLEW_CURVES[shape] ? 1e-9 : 0.03;
  check(`${shape}: settles on each of four consecutive targets`,
    got.every((v, i) => Math.abs(v - asked[i]) <= tol),
    `asked ${asked.join(' ')} → got ${got.map((v) => v.toFixed(3)).join(' ')}`);
}

// ── 5c. The overshooting curves actually overshoot ───────────────────────────
// With headroom on both sides — at the ends of the range the [min,max] clamp
// legitimately flattens the overshoot, which is why this probes mid-range.
console.log('\novershoot is real (and only where it should be)');
{
  const travel = (shape) => {
    const p = mk();
    p.slew = 0.5;
    p.slewShape = shape;
    p.value = 0.4;
    p.setNormalized(0.6);
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < 90; i++) { p.tickSlew(DT); lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
    return { lo, hi };
  };
  for (const shape of ['elastic', 'back']) {
    const { hi } = travel(shape);
    check(`${shape} passes beyond the target`, hi > 0.6 + 1e-6,
      `peaked at ${hi.toFixed(4)}, target 0.6 — no overshoot means the curve is not the one named`);
  }
  const back = travel('back');
  check('back anticipates — it moves AWAY from the target first',
    back.lo < 0.4 - 1e-6, `dipped to ${back.lo.toFixed(4)} from a 0.4 start`);
  for (const shape of ['lag', 'ease', 'ease2', 'expo', 'bounce']) {
    const { lo, hi } = travel(shape);
    check(`${shape} stays within the move (no overshoot)`,
      hi <= 0.6 + 1e-6 && lo >= 0.4 - 1e-6,
      `travelled ${lo.toFixed(4)}..${hi.toFixed(4)}`);
  }
}

// ── 5d. Nothing burns listeners once settled ────────────────────────────────
console.log('\nevery curve goes quiet when it has arrived');
for (const shape of SLEW_SHAPES) {
  const p = mk();
  p.slew = 0.2;
  p.slewShape = shape;
  p.value = 0;
  p.setNormalized(1);
  for (let i = 0; i < 600; i++) p.tickSlew(DT);   // 10 s — long settled
  let fires = 0;
  p.onChange(() => fires++);
  for (let i = 0; i < 1000; i++) p.tickSlew(DT);
  check(`${shape}: silent while idle`, fires === 0,
    `${fires} listener fires with nothing happening — that is a per-frame cost on every ` +
    'slewed param in the patch');
}

// ── 5e. X-map onto an LFO's rate sweeps logarithmically and never hits 0 ─────
// A rate of exactly 0 Hz is not "very slow", it is STOPPED, and no amount of
// nudging the fader off the bottom stop distinguishes the two while you are
// playing. The old linear `norm * 20` produced it at norm 0 and additionally
// buried everything below 0.5 Hz in the bottom 2.5% of travel.
console.log('\nX-map → LFO rate is logarithmic and floored');
{
  check('norm 0 gives the floor, not silence',
    xmapHz(0) === XMAP_HZ_MIN, `got ${xmapHz(0)}`);
  check('norm 1 gives the ceiling exactly',
    Math.abs(xmapHz(1) - XMAP_HZ_MAX) < 1e-9, `got ${xmapHz(1)}`);
  check('out-of-range input is clamped, not extrapolated',
    xmapHz(-5) === XMAP_HZ_MIN && Math.abs(xmapHz(5) - XMAP_HZ_MAX) < 1e-9,
    `got ${xmapHz(-5)} and ${xmapHz(5)}`);
  check('the sweep is monotonic',
    Array.from({ length: 200 }, (_, i) => xmapHz(i / 199))
      .every((v, i, a) => i === 0 || v > a[i - 1]));

  // The point of the change: the slow half must be reachable by hand.
  const halfTravel = xmapHz(0.5);
  check('mid-travel lands in the slow region, not at 10 Hz',
    halfTravel > 0.05 && halfTravel < 0.5,
    `mid-travel = ${halfTravel.toFixed(4)} Hz — linear put it at 10 Hz`);
  const normFor = (hz) => {
    let lo = 0, hi = 1;
    for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (xmapHz(m) < hz) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  check('0.5 Hz sits in the usable middle of the fader, not the bottom 2.5%',
    normFor(0.5) > 0.2,
    `0.5 Hz is at ${(normFor(0.5) * 100).toFixed(1)}% of travel — it was at 2.5% under linear`);

  // Equal fader moves must give equal RATIOS — that is what "logarithmic" means.
  const r = [0.2, 0.4, 0.6, 0.8].map((n) => xmapHz(n + 0.1) / xmapHz(n));
  check('equal travel gives equal frequency ratios',
    r.every((v) => Math.abs(v - r[0]) < 1e-9), `ratios ${r.map((v) => v.toFixed(4)).join(' ')}`);

  // A custom range still behaves.
  check('a custom min/max is honoured end to end',
    Math.abs(xmapHz(0, 0.5, 4) - 0.5) < 1e-9 && Math.abs(xmapHz(1, 0.5, 4) - 4) < 1e-9);
  check('an inverted range degrades to a constant rather than NaN',
    Number.isFinite(xmapHz(0.5, 10, 1)), `got ${xmapHz(0.5, 10, 1)}`);
}

// ── 6. 'lag' is the default, so old saved states recall unchanged ────────────
console.log('\nbackward compatibility');
{
  const fresh = mk();
  check('a new param defaults to lag', fresh.slewShape === 'lag',
    `got ${fresh.slewShape}`);
  const old = mk();
  old.deserialize({ slew: 0.4 });   // a file written before ease existed
  check('a state file with no slewShape deserializes to lag',
    old.slewShape === 'lag', `got ${old.slewShape}`);
  for (const shape of SLEW_SHAPES) {
    const roundTrip = mk();
    roundTrip.slewShape = shape;
    roundTrip.slew = 0.4;
    const clone = mk();
    clone.deserialize(roundTrip.serialize());
    check(`${shape} survives a serialize/deserialize round trip`,
      clone.slewShape === shape, `got ${clone.slewShape}`);
  }
  const bogus = mk();
  bogus.deserialize({ slew: 0.4, slewShape: 'wobble' });
  check('an unknown curve name falls back to lag rather than breaking tickSlew',
    bogus.slewShape === 'lag', `got ${bogus.slewShape}`);
}

if (failures) {
  console.error(
    '\nDo not fix a resolution failure by lowering `step` on the param — step is\n' +
    'the UI increment and changing it moves the arrow keys for everyone. The\n' +
    'controller path must bypass sub-unit snapping via Parameter._modStep.\n' +
    'Do not fix an ease failure by replacing the spring with a timed segment:\n' +
    'check 4 exists precisely to catch that.\n',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll modulation resolution checks passed.\n');
process.exit(failures ? 1 : 0);
