/**
 * Half-float slew convergence audit.
 *
 * Why this exists. An exponential approach takes ever smaller steps. Stored in
 * a HALF-FLOAT buffer, the step eventually falls below one ulp — near 1.0 that
 * is about 1e-3 — and rounds to no change at all. The glide then FREEZES short
 * of its target, permanently. Rutt-Etra's per-line follower sat at 98.51
 * against a target of 100.91, bit-identical at frame 300 and frame 2000.
 *
 * It does not read as a rounding curiosity. It reads as a slow slide that
 * visibly never arrives, and the first guess was something else entirely
 * (resampling through the history buffer), disproved only by measuring a
 * no-lag reference.
 *
 * The fix is a guaranteed-progress floor: any step smaller than one ulp is
 * replaced by exactly one ulp in the right direction, then clamped so it cannot
 * overshoot. sign(0) is 0, so a converged pixel stays put.
 *
 * This cannot be a runtime check — the stall IS the steady state, so there is
 * no moment at which anything is detectably wrong — and it cannot be caught by
 * a single observation, because a stall and a convergence look identical if you
 * only look once. Hence: sample at TWO horizons.
 *
 * The shader half is checked statically. The claim itself — that half-float
 * rounding stalls an exponential, and that a one-ulp floor fixes it — is
 * simulated numerically here, so this audit still means something if the
 * shader is rewritten.
 *
 * Promoted from LEARNED.md 2026-07-30, [advisory] -> [audit].
 *
 * Run:  node tests/audit-halffloat-slew.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const src = readFileSync(resolve(root, 'src/inputs/RuttEtra.js'), 'utf8');

// ── 1. The guard is still in the shader, with its three parts ────────────────
console.log('\nguaranteed-progress guard');

const ulpMatch = /const\s+float\s+ULP\s*=\s*([0-9.eE-]+)\s*;/.exec(src);
check('the ULP constant is declared', ulpMatch !== null);

check('steps below one ulp are replaced by one ulp in the direction of travel',
  /mix\(\s*stepv\s*,\s*sign\(\s*d\s*\)\s*\*\s*ULP\s*,[^)]*lessThan\(\s*abs\(\s*stepv\s*\)/.test(src),
  'without this the exponential tail rounds to nothing and freezes');

check('the replacement is clamped against overshoot',
  /clamp\(\s*progressed\s*,\s*-abs\(\s*d\s*\)\s*,\s*abs\(\s*d\s*\)\s*\)/.test(src),
  'a fixed-size step with no clamp oscillates around the target instead');

check('the history buffer is still HalfFloat',
  /type:\s*THREE\.HalfFloatType/.test(src),
  'if the format changed, the ULP value below is calibrated for the wrong one');

// ── 2. The ULP value matches the format ──────────────────────────────────────
// Half-float carries a 10-bit mantissa, so near 1.0 consecutive representable
// values are 2^-10 apart. A floor smaller than that rounds away and does
// nothing; a much larger one makes the tail visibly linear.
console.log('\nULP calibration');
const ULP = ulpMatch ? Number(ulpMatch[1]) : NaN;
const HALF_SPACING_AT_1 = 2 ** -10;   // 0.0009765625

check('ULP is at least one half-float step near 1.0', ULP >= HALF_SPACING_AT_1,
  `ULP=${ULP}, need >= ${HALF_SPACING_AT_1} or the floor itself rounds away`);
check('ULP is not so large the tail becomes visibly linear', ULP <= 0.01,
  `ULP=${ULP}`);

// ── 3. The claim, simulated ──────────────────────────────────────────────────
// Quantise to the nearest representable half-float: spacing is 2^(exponent-10).
const half = (x) => {
  if (x === 0 || !Number.isFinite(x)) return x;
  const e = Math.floor(Math.log2(Math.abs(x)));
  const step = 2 ** (e - 10);
  return Math.round(x / step) * step;
};

// A realistic long time constant: rise = 2s at 60fps -> k = 1 - exp(-dt/rise).
const k = 1 - Math.exp(-(1 / 60) / 2);
const TARGET = 1.0;

function run(frames, { guard }) {
  let v = 0;
  for (let i = 0; i < frames; i++) {
    const d = TARGET - v;
    let step = d * k;
    if (guard) {
      if (Math.abs(step) < ULP) step = Math.sign(d) * ULP;
      step = Math.max(-Math.abs(d), Math.min(Math.abs(d), step));
    }
    v = half(v + step);
  }
  return v;
}

console.log('\nwithout the guard: stalls');
const bare300  = run(300,    { guard: false });
const bare2k   = run(2000,   { guard: false });
const bare100k = run(100000, { guard: false });

// The whole trap in one assertion pair: at frame 300 it is still creeping, so a
// single early sample calls it "converging". It is not — by frame 2000 it has
// stopped, and it is still bit-identical 98,000 frames later.
check('still creeping at frame 300 — one early sample would read as converging',
  bare300 !== bare2k,
  `f300=${bare300} f2000=${bare2k}`);
check('bit-identical at frame 2000 and frame 100000 — permanently stalled',
  bare2k === bare100k,
  `f2000=${bare2k} f100000=${bare100k} — if these differ the simulation is not ` +
  'reproducing the stall and the rest of this section proves nothing');
check('and it is stuck short of the target', bare100k < TARGET - ULP,
  `stalled at ${bare100k.toFixed(6)} against ${TARGET} ` +
  `(${(100 * bare100k / TARGET).toFixed(1)}% — the real case was 98.51 of 100.91)`);

console.log('\nwith the guard: arrives');
const fix2k = run(2000, { guard: true });
check('reaches the target by frame 2000', Math.abs(fix2k - TARGET) <= ULP,
  `got ${fix2k}, target ${TARGET}`);
check('does not overshoot', fix2k <= TARGET + ULP, `got ${fix2k}`);
check('and it got there because of the floor, not the exponential',
  fix2k > bare100k,
  'the guarded run must end up past where the bare one stalls');

// A converged value must stay put — sign(0) is 0, so the floor must not kick a
// settled pixel off its target forever.
console.log('\nconverged values stay put');
let settled = TARGET;
for (let i = 0; i < 100; i++) {
  const d = TARGET - settled;
  let step = d * k;
  if (Math.abs(step) < ULP) step = Math.sign(d) * ULP;   // sign(0) === 0
  step = Math.max(-Math.abs(d), Math.min(Math.abs(d), step));
  settled = half(settled + step);
}
check('a pixel already at target does not jitter', settled === TARGET,
  `drifted to ${settled} — sign(0) must be 0 and the clamp must hold it`);

if (failures) {
  console.error(
    '\nIf the shader changed: the fix is a floor of one ulp in the direction of\n' +
    'travel, clamped against overshoot — not a larger coefficient, and not a\n' +
    '"close enough" epsilon compare, which leaves a permanent residue at the\n' +
    'default. And when measuring convergence, always sample at TWO horizons: a\n' +
    'stall and a convergence are indistinguishable from one observation.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll half-float slew checks passed.\n');
process.exit(failures ? 1 : 0);
