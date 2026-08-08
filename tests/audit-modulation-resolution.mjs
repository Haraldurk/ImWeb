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
  ParameterSystem, Parameter, PARAM_TYPE,
} from '../src/controls/ParameterSystem.js';
import { LFO } from '../src/controls/LFO.js';

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
console.log('\nease tracks a continuously moving source');
{
  const p = mk();
  p.slew = 0.3;
  p.slewShape = 'ease';
  const lfo = new LFO({ shape: 'sine', hz: 0.5 });
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 600; i++) {
    p.setNormalized(lfo.tick(DT));
    p.tickSlew(DT);
    if (i > 120) { lo = Math.min(lo, p.value); hi = Math.max(hi, p.value); }
  }
  check('a 0.5 Hz sine still swings most of the range under ease',
    hi - lo > 0.7,
    `swing ${lo.toFixed(3)}..${hi.toFixed(3)} — a near-zero swing means the ` +
    'ease was implemented as a restarting segment and froze on a moving target');
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
  const roundTrip = mk();
  roundTrip.slewShape = 'ease';
  roundTrip.slew = 0.4;
  const clone = mk();
  clone.deserialize(roundTrip.serialize());
  check('ease survives a serialize/deserialize round trip',
    clone.slewShape === 'ease', `got ${clone.slewShape}`);
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
