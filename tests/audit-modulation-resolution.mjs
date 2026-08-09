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
  ParameterSystem, Parameter, PARAM_TYPE, SLEW_CURVES, SLEW_SHAPES, slewExcursion,
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

// ── 5d-bis. Elastic is a spring, and its state survives the clamp ────────────
// Two separate regressions are guarded here, both of which LOOK fine on a
// mid-range move and only misbehave at the edges of the parameter.
//
// 1. Elastic must EASE IN. The textbook easeOutElastic covered 39% of the whole
//    move in its first frame — a snap with a wobble after it, which is the
//    opposite of what a slew curve is for.
// 2. The integrator must keep its own unclamped position. If it reads the
//    published value back, then at the top of the range it is told it is at max
//    while carrying the velocity it had at 1.19, so it keeps pushing outward,
//    is clipped again, and the ring never returns — 78 frames flat against the
//    limit, worse than the curve it replaced.
console.log('\nelastic is an underdamped spring, not a timed curve');
{
  const firstFrame = (shape) => {
    const p = mk();
    p.slew = 0.5;
    p.slewShape = shape;
    p.value = 0.2;
    p.setNormalized(0.8);
    p.tickSlew(DT);
    return (p.value - 0.2) / 0.6;
  };
  check('elastic eases in — well under a tenth of the move in frame 1',
    firstFrame('elastic') < 0.1,
    `covered ${(firstFrame('elastic') * 100).toFixed(1)}% — easeOutElastic covered 39%`);
  check('elastic opens no faster than the plain lag it should feel gentler than',
    firstFrame('elastic') <= firstFrame('lag') + 1e-9,
    `elastic ${(firstFrame('elastic') * 100).toFixed(2)}% vs lag ${(firstFrame('lag') * 100).toFixed(2)}%`);

  // The ring must survive being clipped at the range limit.
  const p = mk();
  p.slew = 0.5;
  p.slewShape = 'elastic';
  p.value = 0.4;
  p.setNormalized(1.0);            // target IS the ceiling: overshoot is unshowable
  const v = [];
  for (let i = 0; i < 90; i++) { p.tickSlew(DT); v.push(p.value); }
  let longestPin = 0, runLen = 0;
  for (const x of v) { if (x >= 1) { runLen++; longestPin = Math.max(longestPin, runLen); } else runLen = 0; }
  check('a target at the ceiling still shows the ring as a dip below it',
    v.some((x) => x < 0.999),
    'the value never left the limit — the spring is reading its position back ' +
    'from the CLAMPED value instead of keeping its own');
  check('and does not sit pinned at the limit for most of the move',
    longestPin < 40, `pinned for ${longestPin} consecutive frames`);

  // A fresh step arriving mid-clip must not stall behind the stored overshoot.
  const q = mk();
  q.slew = 0.5;
  q.slewShape = 'elastic';
  q.value = 0.4;
  q.setNormalized(1.0);
  for (let i = 0; i < 12; i++) q.tickSlew(DT);
  const held = q.value;
  q.setNormalized(0.2);
  const w = [];
  for (let i = 0; i < 60; i++) { q.tickSlew(DT); w.push(q.value); }
  const reactedAfter = w.findIndex((x) => x < held - 1e-6);
  check('a new step during a clipped overshoot is answered promptly',
    reactedAfter >= 0 && reactedAfter < 8,
    `took ${reactedAfter} frames to start moving`);

  // _slewX must not leak past the park, or the next move starts off-target.
  const r = mk();
  r.slew = 0.3;
  r.slewShape = 'elastic';
  r.value = 0;
  r.setNormalized(1);
  for (let i = 0; i < 1200; i++) r.tickSlew(DT);
  check('the spring position is reset when it parks',
    r._slewX === r._target, `_slewX ${r._slewX} vs target ${r._target}`);
}

// ── 5d-ter. The spring bounces off min/max, and Strength/Damp do their jobs ──
// Overshoot is a fraction of the MOVE, so any large move landing near a rail
// throws well past it. Clipping that silently is what "elastic does nothing at
// the extremes" means in practice. The spring collides with the rail instead.
console.log('\nelastic bounces off the rails rather than parking on them');
{
  const spring = ({ from, to, n = 90, st = 1, dp = 0.45, slew = 0.5 }) => {
    const p = mk();
    p.slew = slew;
    p.slewShape = 'elastic';
    p.slewStrength = st;
    p.slewDamp = dp;
    p.value = from;
    p.setNormalized(to);
    const v = [];
    for (let i = 0; i < n; i++) { p.tickSlew(DT); v.push(p.value); }
    return v;
  };
  const longestPin = (v) => {
    let m = 0, r = 0;
    for (const x of v) { if (x >= 1 - 1e-9 || x <= 1e-9) { r++; m = Math.max(m, r); } else r = 0; }
    return m;
  };

  const top = spring({ from: 0.05, to: 1.0 });
  check('a full-range move onto the ceiling does not park on it',
    longestPin(top) <= 4,
    `pinned ${longestPin(top)} consecutive frames — clipping instead of bouncing`);
  check('and visibly rebounds off it',
    Math.min(...top.slice(0, 40)) < 0.97,
    `never came back below 0.97 — the rail collision is not reversing velocity`);

  const bot = spring({ from: 0.95, to: 0.0 });
  check('the floor behaves the same way',
    longestPin(bot) <= 4 && Math.max(...bot.slice(0, 40)) > 0.03,
    `pin ${longestPin(bot)}, rebound peak ${Math.max(...bot.slice(0, 40)).toFixed(3)}`);

  // A bounce must not disturb a move that had room to begin with.
  const mid = spring({ from: 0.2, to: 0.8 });
  check('a move with headroom is untouched by the rail logic',
    Math.max(...mid) < 1 && Math.max(...mid) > 0.85,
    `peaked at ${Math.max(...mid).toFixed(4)}`);

  // Damp: the overshoot control. At 1 it must vanish entirely — that is the
  // continuum back to 'ease', and a non-zero overshoot there means the damping
  // ratio is not reaching the caller.
  const over = (dp) => (Math.max(...spring({ from: 0.2, to: 0.8, dp, n: 200 })) - 0.8) / 0.6;
  check('Damp 1.0 removes the overshoot completely (elastic becomes ease)',
    over(1) < 1e-4, `overshoot ${(over(1) * 100).toFixed(3)}%`);
  check('lowering Damp increases the overshoot',
    over(0.7) < over(0.45) && over(0.45) > 0.1,
    `damp0.70 ${(over(0.7) * 100).toFixed(1)}%  damp0.45 ${(over(0.45) * 100).toFixed(1)}%`);

  // Strength: the speed/tightness control, orthogonal to Damp.
  const settle = (st) => {
    const v = spring({ from: 0.2, to: 0.8, st, n: 600 });
    return v.findIndex((_, i) => v.slice(i).every((y) => Math.abs(y - 0.8) < 0.012));
  };
  check('raising Strength settles the spring sooner',
    settle(4) < settle(1) && settle(1) < settle(0.25),
    `st4 ${settle(4)}, st1 ${settle(1)}, st0.25 ${settle(0.25)} frames`);
  check('Strength barely moves the overshoot — it is Damp that owns that',
    Math.abs(over(0.45) - (Math.max(...spring({ from: 0.2, to: 0.8, st: 2, n: 200 })) - 0.8) / 0.6) < 0.05,
    'the two knobs are supposed to be independent');

  // Out-of-range settings must be clamped, not trusted.
  const wild = spring({ from: 0.2, to: 0.8, st: 1e6, dp: -5, n: 200 });
  check('absurd Strength/Damp values cannot produce NaN or a runaway',
    wild.every((x) => Number.isFinite(x) && x >= 0 && x <= 1),
    'the spring constants are not being clamped at use time');

  // Persistence.
  const a = mk();
  a.slewShape = 'elastic';
  a.slewStrength = 2.5;
  a.slewDamp = 0.2;
  const b = mk();
  b.deserialize(a.serialize());
  check('Strength and Damp survive a serialize/deserialize round trip',
    b.slewStrength === 2.5 && b.slewDamp === 0.2,
    `got strength ${b.slewStrength}, damp ${b.slewDamp}`);
  const old = mk();
  old.deserialize({ slew: 0.4, slewShape: 'elastic' });   // written before the knobs existed
  check('a file without them keeps the original spring feel',
    old.slewStrength === 1 && Math.abs(old.slewDamp - 0.45) < 1e-9,
    `got strength ${old.slewStrength}, damp ${old.slewDamp}`);
}

// ── 5d-quater. A segment curve must never STALL against a rail ──────────────
// Back dips below its start before setting off. Starting a move at min made
// that dip impossible, and letting the clamp absorb it froze the value for ten
// frames at 60fps before anything moved — a sixth of a second of nothing at the
// top of every move that begins at the bottom. The lobe is now scaled to the
// room in front of it AND squeezed in time, so travel begins immediately.
console.log('\nsegment curves never stall against a rail');
{
  const trace = (shape, from, to, n = 60) => {
    const p = mk();
    p.slew = 0.5;
    p.slewShape = shape;
    p.value = from;
    p.setNormalized(to);
    const v = [];
    for (let i = 0; i < n; i++) { p.tickSlew(DT); v.push(p.value); }
    return v;
  };
  const stalled = (v, from) => {
    let n = 0;
    for (const x of v) { if (Math.abs(x - from) < 1e-9) n++; else break; }
    return n;
  };

  for (const [from, to] of [[0, 0.8], [1, 0.2], [0.02, 0.8], [0.98, 0.2]]) {
    const s = stalled(trace('back', from, to), from);
    check(`back ${from} → ${to}: moves on the first frame`, s === 0,
      `frozen for ${s} frames — the anticipation lobe is being clamped instead of fitted`);
  }

  // Fitting must be gradual, not a cliff: more room ⇒ a deeper dip.
  const dip = (from) => from - Math.min(...trace('back', from, 0.8));
  check('the dip grows smoothly with the room available',
    dip(0) <= dip(0.02) + 1e-9 && dip(0.02) < dip(0.05) && dip(0.05) < dip(0.2),
    `dips ${[0, 0.02, 0.05, 0.2].map((f) => dip(f).toFixed(4)).join(' ')}`);

  // And a move that had room must be untouched by any of this.
  const mid = trace('back', 0.2, 0.8);
  check('a mid-range move keeps the full anticipation and overshoot',
    Math.abs((0.2 - Math.min(...mid)) - 0.0599) < 1e-3 &&
    Math.abs((Math.max(...mid) - 0.8) - 0.0599) < 1e-3,
    `dip ${(0.2 - Math.min(...mid)).toFixed(4)}, overshoot ${(Math.max(...mid) - 0.8).toFixed(4)}`);

  // The time warp must not cost the exact landing.
  for (const shape of Object.keys(SLEW_CURVES)) {
    for (const [from, to] of [[0, 0.8], [0.2, 0.8], [1, 0]]) {
      const v = trace(shape, from, to, 120);
      check(`${shape} ${from} → ${to} still lands exactly`,
        Math.abs(v[v.length - 1] - to) < 1e-9, `ended at ${v[v.length - 1]}`);
    }
  }
}

// ── 5d-quinquies. Strength reshapes Back, and the excursion table follows ────
// The fit above needs to know how far the curve leaves [0,1]. Strength changes
// that, and NOT linearly — 3.1% / 10.0% / 27.0% / 45.3% at 0.5 / 1 / 2 / 3, with
// the k at which the opening dip closes moving too. A table computed once at
// load would silently mis-fit every non-default Strength.
console.log('\nBack responds to Strength, and the excursion table tracks it');
{
  const back = (from, to, st, n = 90) => {
    const p = mk();
    p.slew = 0.5;
    p.slewShape = 'back';
    p.slewStrength = st;
    p.value = from;
    p.setNormalized(to);
    const v = [];
    for (let i = 0; i < n; i++) { p.tickSlew(DT); v.push(p.value); }
    return v;
  };
  const dip = (st) => 0.2 - Math.min(...back(0.2, 0.8, st));

  check('Strength 0 leaves a plain ease — no anticipation, no overshoot',
    dip(0) < 1e-3 && Math.max(...back(0.2, 0.8, 0)) - 0.8 < 1e-6,
    `dip ${dip(0).toFixed(5)}`);
  check('raising Strength deepens the excursion',
    dip(0.5) < dip(1) && dip(1) < dip(2),
    `dips ${[0.5, 1, 2].map((s) => dip(s).toFixed(4)).join(' ')}`);
  check('the default Strength 1 reproduces the historical ±10% shape',
    Math.abs(dip(1) - 0.0599) < 1e-3, `dip ${dip(1).toFixed(4)}`);

  for (const st of [0, 0.5, 1, 2, 3]) {
    check(`Strength ${st}: still lands exactly on the target`,
      Math.abs(back(0.2, 0.8, st).at(-1) - 0.8) < 1e-9,
      `ended at ${back(0.2, 0.8, st).at(-1)}`);
  }

  // The excursion table must move with Strength, or the rail fit mis-measures.
  const e0 = slewExcursion('back', 0.5);
  const e1 = slewExcursion('back', 1);
  const e2 = slewExcursion('back', 2);
  check('slewExcursion reports a different shape per Strength',
    e0.under < e1.under && e1.under < e2.under && e0.k0 < e1.k0 && e1.k0 < e2.k0,
    `under ${e0.under.toFixed(3)}/${e1.under.toFixed(3)}/${e2.under.toFixed(3)}, ` +
    `k0 ${e0.k0.toFixed(3)}/${e1.k0.toFixed(3)}/${e2.k0.toFixed(3)}`);
  check('a curve with no Strength input is unaffected by the argument',
    slewExcursion('bounce', 3).over === slewExcursion('bounce', 1).over);

  // The rail fit must keep working when Strength asks for more room than exists.
  const railed = back(0.0, 0.8, 3);
  let stalled = 0;
  for (const x of railed) { if (Math.abs(x) < 1e-9) stalled++; else break; }
  check('a high Strength starting on a rail still moves on the first frame',
    stalled === 0, `frozen ${stalled} frames`);
  check('…and still lands exactly',
    Math.abs(railed.at(-1) - 0.8) < 1e-9, `ended at ${railed.at(-1)}`);

  // Elastic must not have been disturbed by sharing the field.
  const p = mk();
  p.slew = 0.5;
  p.slewShape = 'elastic';
  p.value = 0.2;
  p.setNormalized(0.8);
  const v = [];
  for (let i = 0; i < 90; i++) { p.tickSlew(DT); v.push(p.value); }
  check('elastic still overshoots ~19% at its defaults',
    Math.abs((Math.max(...v) - 0.8) / 0.6 - 0.19) < 0.02,
    `${(((Math.max(...v) - 0.8) / 0.6) * 100).toFixed(1)}%`);
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
