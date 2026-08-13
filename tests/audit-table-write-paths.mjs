/**
 * Response-table write-path audit.
 *
 * Why this exists. A parameter can be driven two ways, and they must shape the
 * value identically:
 *
 *   ps.setNormalized(id, n)   — the system-level entry point
 *   p.setNormalized(n)        — direct, used by MIDI, mouse, sound, tilt,
 *                               gamepad and fixed controllers
 *
 * Response tables were once resolved only in the first one. Nearly every
 * controller calls the second, so tables silently never applied to MIDI, mouse
 * or sound — the honest answer to "do tables auto-scale?" was "they mostly
 * don't run". Nothing failed; the curve simply wasn't there.
 *
 * The fix was to resolve the table inside Parameter.setNormalized, at module
 * level, so both paths go through it. That is the invariant here: table
 * resolution happens in ONE place. A per-call-site lookup added to a controller
 * would work for that controller and silently diverge from every other.
 *
 * This cannot be a runtime check — a missing table produces a plausible value,
 * not an error — so it is enforced statically AND behaviourally: the static
 * half catches a second resolution site appearing, the behavioural half proves
 * the two paths still agree.
 *
 * Promoted from LEARNED.md 2026-07-12, [advisory] -> [audit].
 *
 * Run:  node tests/audit-table-write-paths.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ParameterSystem, Parameter, PARAM_TYPE, setTableManager,
} from '../src/controls/ParameterSystem.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── 1. Exactly one resolution site ───────────────────────────────────────────
const src = readFileSync(resolve(root, 'src/controls/ParameterSystem.js'), 'utf8');

console.log('\n_resolveTable');
const defs  = [...src.matchAll(/function _resolveTable\s*\(/g)].length;
// The exported pass-through is not a second resolution — it is the same one,
// re-exported. §8.7 needs the resolved curve in order to UPLOAD it to the audio
// worklet, which then applies it at audio rate; resolving it over there by hand
// would duplicate the 'global' slot indirection, which is the thing this
// function exists to prevent. So the rule tightens rather than loosens: one
// resolver, and exactly one place that APPLIES what it returns (below).
const wrapper = [...src.matchAll(/export function resolveTable\([^)]*\)\s*\{\s*return _resolveTable\(param\);\s*\}/g)].length;
const calls = [...src.matchAll(/_resolveTable\s*\(/g)].length - defs - wrapper;
check('is defined exactly once', defs === 1, `found ${defs}`);
check('has at most the one exported pass-through', wrapper <= 1, `found ${wrapper}`);
check('is called from exactly one site', calls === 1,
  `found ${calls} call(s) — a second site is how the two paths diverge`);

// The upload path may RESOLVE a curve; it may not APPLY one. Applying it in the
// binding as well would shape the value twice — once client-side on the way to
// the engine and once inside the worklet — and the doubling is a curve that
// merely looks wrong rather than an error.
const binding = readFileSync(resolve(root, 'src/audio/AudioBinding.js'), 'utf8');
check('AudioBinding resolves a table but never applies one',
  !/\.apply\s*\(/.test(binding),
  'the worklet applies it at audio rate; a client-side apply would double it');

// The one call must sit inside Parameter.setNormalized, not somewhere upstream.
const pSetStart = src.indexOf('  setNormalized(n, table = null) {');
const pSetBody  = src.slice(pSetStart, src.indexOf('\n  }', pSetStart));
check('the call is inside Parameter.setNormalized',
  pSetStart !== -1 && /_resolveTable\(this\)/.test(pSetBody));

// ── 2. The system path delegates rather than reimplements ────────────────────
console.log('\nParameterSystem.setNormalized');
const sysStart = src.indexOf('  setNormalized(id, n, table = null) {');
const sysBody  = src.slice(sysStart, src.indexOf('\n  }', sysStart));
check('exists', sysStart !== -1);
check('delegates to p.setNormalized', /\bp\.setNormalized\(/.test(sysBody));
check('does not resolve tables itself', !/_resolveTable\(/.test(sysBody),
  'resolving here too would double-apply or diverge');
check('does not remap to [min,max] itself',
  !/ctrlMin|ctrlMax/.test(sysBody),
  'the remap belongs to Parameter.setNormalized — duplicating it is the bug');

// ── 3. No controller resolves tables on its own ──────────────────────────────
console.log('\ncontrollers stay out of it');
for (const f of ['ControllerManager.js', 'LFO.js', 'Automation.js',
                 'StepSequencer.js', 'BeatDetector.js']) {
  let body = '';
  try { body = readFileSync(resolve(root, 'src/controls', f), 'utf8'); } catch { continue; }
  check(`${f} does no table lookup`,
    !/_resolveTable|tableManager\s*\.\s*get\(|\.apply\(\s*n/.test(body),
    'a per-call-site table lookup here diverges from every other controller');
}

// ── 4. Behavioural: both paths agree ─────────────────────────────────────────
// A stub table manager, not the real one: this asserts the WIRING, and a stub
// with a distinctive curve makes it obvious whether the table ran at all.
const curve = { apply: (n) => n * n };            // 0.5 -> 0.25, clearly not identity
setTableManager({
  get:              (name) => (name === 'test-curve' ? curve : null),
  getNames:         () => ['test-curve'],
  addEventListener: () => {},   // setTableManager subscribes to 'change'
});

const mk = () => {
  const ps = new ParameterSystem();
  ps.register(new Parameter({
    id: 'audit.knob', type: PARAM_TYPE.CONTINUOUS, min: 0, max: 100, value: 0,
  }));
  const p = ps.params.get('audit.knob');
  p.table = 'test-curve';
  return { ps, p };
};

console.log('\nboth write paths agree');
const N = 0.5;

const viaSystem = mk();
viaSystem.ps.setNormalized('audit.knob', N);

const viaDirect = mk();
viaDirect.p.setNormalized(N);

check('ps.setNormalized and p.setNormalized produce the same value',
  viaSystem.p.value === viaDirect.p.value,
  `system=${viaSystem.p.value} direct=${viaDirect.p.value}`);

// Margin check: if the table were skipped BOTH paths would still agree, and the
// assertion above would pass while proving nothing. Prove the curve applied.
const noTable = mk();
noTable.p.table = null;
noTable.p.setNormalized(N);
check('the table actually changed the value (test is not vacuous)',
  viaDirect.p.value !== noTable.p.value,
  `with table=${viaDirect.p.value}, without=${noTable.p.value} — identical means ` +
  'the table never ran and this audit proves nothing');
check('the curve applied is the one installed',
  Math.abs(viaDirect.p.value - 25) < 1e-9,
  `expected 0.5^2*100 = 25, got ${viaDirect.p.value}`);

// ── 5. The 'global' slot resolves through the same single site ───────────────
console.log("\nthe 'global' tableSlot path");
const g = mk();
g.p.table = 'global';
g.ps.register(new Parameter({
  id: 'global.tableSlot', type: PARAM_TYPE.CONTINUOUS, min: 0, max: 8, value: 0,
}));
g.p.setNormalized(N);
check('a table:"global" param also gets the curve',
  Math.abs(g.p.value - 25) < 1e-9,
  `got ${g.p.value} — the global slot is resolved in _resolveTable too`);

// Deliberately not calling setTableManager(null) — it dereferences tm
// unconditionally. Module state dies with the process.

if (failures) {
  console.error(
    '\nDo not fix this by adding a table lookup at the failing call site — that\n' +
    'is the original bug. Table resolution belongs in Parameter.setNormalized\n' +
    'via _resolveTable(), so every controller inherits it. See CLAUDE.md,\n' +
    '"Response tables".',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll table write-path checks passed.\n');
process.exit(failures ? 1 : 0);
