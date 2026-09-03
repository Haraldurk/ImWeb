/**
 * Readout resolution audit.
 *
 * Why this exists. A parameter row is the instrument most verification in this
 * project is performed with — "click the thing, watch the number move". That
 * only works if the row can RESOLVE the smallest move the parameter can make.
 * When it cannot, two different values print the same string, and a working
 * control is indistinguishable from a dead one.
 *
 * What went wrong. `displayValue` picked its decimals from the RANGE alone
 * (`max - min > 10 ? 1 : 2`), so every 0–1 param rendered to 2 decimals however
 * fine its `step` was. `agrain.pos` carried `step: 0.001` — three times finer
 * than the row displaying it. A verification plan was written whose primary
 * check was "click two adjacent grains and watch the Grain Pos row"; both
 * grains render as `0.42` before the fix and after it. That is worse than a
 * test that fails: its result was fixed in advance and read as evidence.
 * Fourteen params had been silently under-displaying, and the one that forced
 * the issue was T-Displace retuned to `step: 0.001` on a 0–0.5 range, where two
 * thirds of the new resolution would have been invisible and the retune would
 * have looked like it did nothing.
 *
 * Why it lives here. The failure is a plausible-looking number, so nothing
 * throws and no screenshot shows it. And it is a property of the whole
 * registry — 257 params — against one getter, which is not something a runtime
 * assert on a hot path can carry.
 *
 * The check drives the REAL `displayValue`. It does not recompute the decimal
 * formula: two code paths that compute the same expression cannot tell you
 * which one ran (LEARNED 2026-08-27), so a reimplementation here would pass
 * against a `displayValue` that had been reverted to the range-only version.
 * Setting a value and reading the string back cannot be fooled that way.
 *
 * Run:  node tests/audit-readout-resolution.mjs
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ParameterSystem,
  registerCoreParameters,
  PARAM_TYPE,
} from '../src/controls/ParameterSystem.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const ps = new ParameterSystem();
registerCoreParameters(ps);

// ── 1. Every stepped param's row resolves one step ───────────────────────────
//
// A param with a positive `step` can be moved by exactly that much — by an
// arrow key, by a drag, or (for step >= 1, the only steps that still quantize)
// by a controller write. If the row prints the same string either side of that
// move, the row cannot witness it.
console.log('\nAdjacent step values render differently');
{
  const stepped = [...ps.params.values()]
    .filter(p => p.type === PARAM_TYPE.CONTINUOUS && p.step > 0);

  let tested = 0;
  let unreachable = 0;
  const bad = [];
  for (const p of stepped) {
    // Three points across the range rather than one: `decimals` is constant but
    // float representation is not, and a formula that rounds correctly at 1/4
    // can still collide at 3/4.
    let probed = 0;
    for (const frac of [0.25, 0.5, 0.75]) {
      // ASK THE PARAM WHAT IT STORED. `Parameter.value` snaps to the step
      // lattice whenever `snap` is set (256 of the 257 subjects), so a test
      // point chosen by arithmetic is not necessarily a value the param can
      // hold — and two points a step apart in MY numbers can snap onto the
      // same lattice cell. The first draft of this audit did exactly that and
      // reported twelve failures against a correct `displayValue`: the
      // instrument was wrong, not the code (LEARNED 2026-08-30). Setting and
      // reading back removes the guess.
      p.value = p.min + (p.max - p.min) * frac;
      const va = p.value;
      const da = p.displayValue;
      if (va + p.step > p.max) continue;
      p.value = va + p.step;
      const vb = p.value;
      const db = p.displayValue;
      // The param could not represent a one-step move here — a property of its
      // own lattice, not of the readout. Out of scope, but counted, because a
      // silent skip is how a check becomes vacuous.
      if (vb === va) { unreachable++; continue; }
      probed++;
      // Collected rather than asserted one by one: 771 passing lines would bury
      // every other audit in the suite, and the failure list is more useful
      // whole than dribbled out per param.
      if (da === db) bad.push(`${p.id} step ${p.step} on ${p.min}..${p.max}: ` +
        `${va} and ${vb} both read "${da}"`);
    }
    if (probed) tested++;
  }

  // Not vacuous: an empty or tiny subject list would pass every assertion above
  // while asserting nothing (LEARNED 2026-09-01). The registry holds ~257
  // stepped continuous params; a collapse to a handful means the filter broke,
  // not that the params went away.
  check(`all ${tested} stepped params resolve a one-step move in their row`,
    bad.length === 0,
    `\n      ` + bad.join(`\n      `) +
    `\n    The row cannot show a one-step move on these, so it is useless as a ` +
    `verification instrument for them. Either widen the decimal cap in ` +
    `ParameterSystem.js displayValue (currently 4) or coarsen the step`);

  check('exercised the whole stepped-param population', tested >= 200,
    `only ${tested} of ${stepped.length} stepped params were probed — the range ` +
    `filter or the registry import is wrong, and the check above is vacuous`);
  check('few points are unreachable on their own lattice', unreachable <= 10,
    `${unreachable} probe points snapped onto the value below them; if this ` +
    `climbs, the skip is swallowing the population the audit is meant to cover`);
}

// ── 2. The decimal cap is a real ceiling, and this check can see it ───────────
//
// A POSITIVE CONTROL, not a subject count. Every param in the repo passes
// section 1 today, so "no failures" cannot distinguish "the registry is clean"
// from "the detector stopped detecting" — and the second reading is the
// fail-open this audit exists to prevent (LEARNED 2026-08-30: before believing
// a result, confirm the check can tell the two states apart).
//
// `displayValue` caps decimals at 4 so a tiny step cannot stretch the row. That
// cap is arbitrary and load-bearing: a param authored below it rounds silently
// rather than failing. This constructs one and proves the round is visible.
console.log('\nThe check can detect an unresolvable step');
{
  const probe = new ParameterSystem();
  probe.register({
    id: 'audit.tooFine', label: 'Too Fine', group: 'audit',
    min: 0, max: 1, step: 0.00001, value: 0,
  });
  const p = probe.get('audit.tooFine');
  p.value = 0.5;       const a = p.displayValue;
  p.value = 0.50001;   const b = p.displayValue;
  check('a step of 1e-5 is beyond the 4-decimal cap and prints identically',
    a === b,
    `got "${a}" vs "${b}" — the cap moved. If displayValue now resolves 5 ` +
    `decimals this control is stale: update it to the new cap rather than ` +
    `deleting it, or section 1 silently stops proving anything`);

  probe.register({
    id: 'audit.resolvable', label: 'Resolvable', group: 'audit',
    min: 0, max: 1, step: 0.001, value: 0,
  });
  const q = probe.get('audit.resolvable');
  q.value = 0.5;    const c = q.displayValue;
  q.value = 0.501;  const d = q.displayValue;
  check('…while a step of 1e-3 on the same range is resolved',
    c !== d,
    `both read "${c}" — displayValue has regressed to picking decimals from the ` +
    `range alone, which is the exact bug this audit was written for`);
}

// ── 3. The floor: no readout ever loses precision it used to have ────────────
//
// The fix took `max(rangeDec, stepDec)`, not `stepDec`. The floor is the half
// that is easy to drop in a later simplification, and dropping it would coarsen
// every coarse-stepped param at once — a step:1 param on a 0–100 range would
// fall from 1 decimal to 0 and stop showing its controller's slew.
console.log('\nRange-derived decimals survive as a floor');
{
  const shown = (min, max, step) => {
    const probe = new ParameterSystem();
    probe.register({ id: 'audit.floor', label: 'F', group: 'audit', min, max, step, value: min });
    const p = probe.get('audit.floor');
    p.value = min + (max - min) / 3;
    const s = p.displayValue;
    const dot = s.indexOf('.');
    return dot === -1 ? 0 : s.length - dot - 1;
  };
  check('a wide range keeps at least 1 decimal despite an integer step',
    shown(0, 100, 1) >= 1, `rendered ${shown(0, 100, 1)} decimals`);
  check('a narrow range keeps at least 2 despite an integer step',
    shown(0, 10, 1) >= 2, `rendered ${shown(0, 10, 1)} decimals`);
  check('a fine step still wins over the range floor',
    shown(0, 100, 0.001) >= 3, `rendered ${shown(0, 100, 0.001)} decimals`);
}

console.log(failures
  ? `\n${failures} FAILURE(S)\n`
  : '\nAll readout-resolution checks passed.\n');
process.exit(failures ? 1 : 0);
