/**
 * Capture-base migration audit (Phase 26 Step 0).
 *
 * Why this exists. SOURCE_DEFS is append-only, so source indices 0..N-1 are
 * stable forever — but CAPTURE_SOURCES appends "FG Src / BG Src / DS Src" AFTER
 * the source list, at CAPTURE_INDIRECT_BASE = SOURCES.length. Appending one
 * source therefore slides the indirect tail up by one, and every saved
 * td.captureSource / td.mapSource / slitscan.source / vwarp.source /
 * delay.source holding an old tail index silently re-reads as the NEW source.
 *
 * The failure mode is a plausible-looking picture — the same reason
 * audit-source-resolution.mjs exists — so the invariant is enforced here.
 *
 * This test is written BEFORE the first source append, while the migration is
 * an identity transform, so it fails loudly the day an append makes it real.
 *
 * Run:  node tests/audit-capture-base.mjs
 */

import {
  ParameterSystem,
  registerCoreParameters,
  CAPTURE_SOURCES,
  CAPTURE_INDIRECT,
  CAPTURE_INDIRECT_BASE,
  CAPTURE_PARAM_IDS,
  LEGACY_CAPTURE_BASE,
  migrateCaptureBase,
  migrateStatesCaptureBase,
} from '../src/controls/ParameterSystem.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── 1. The registry collects every capture selector, by identity ──────────────
const ps = new ParameterSystem();
registerCoreParameters(ps);

const expected = [...ps.params.values()]
  .filter(p => p.options === CAPTURE_SOURCES)
  .map(p => p.id)
  .sort();

console.log('\nCAPTURE_PARAM_IDS');
check('collects every param declared with options: CAPTURE_SOURCES',
  JSON.stringify([...CAPTURE_PARAM_IDS].sort()) === JSON.stringify(expected),
  `got [${[...CAPTURE_PARAM_IDS].sort()}], expected [${expected}]`);
check('is non-empty (registration hook actually ran)', CAPTURE_PARAM_IDS.length > 0);

// A capture selector that is NOT in the list is one the migration will miss.
// This is the assertion that catches a future selector built from a hand-copied
// array literal instead of the shared CAPTURE_SOURCES reference.
check('no capture-shaped param escapes the registry',
  expected.every(id => CAPTURE_PARAM_IDS.includes(id)));

// ── 2. The base is where the tail actually starts ────────────────────────────
console.log('\nCAPTURE_INDIRECT_BASE');
check('points at the first indirect entry',
  CAPTURE_SOURCES[CAPTURE_INDIRECT_BASE] === CAPTURE_INDIRECT[0],
  `CAPTURE_SOURCES[${CAPTURE_INDIRECT_BASE}] = ${CAPTURE_SOURCES[CAPTURE_INDIRECT_BASE]}`);
check('tail is exactly CAPTURE_INDIRECT long',
  CAPTURE_SOURCES.length - CAPTURE_INDIRECT_BASE === CAPTURE_INDIRECT.length);

// ── 3. The arithmetic ────────────────────────────────────────────────────────
// Simulated append: a file stamped one base BELOW the current one must have its
// tail shifted up by one, and its real source indices left alone. Driving this
// with an explicit savedBase rather than by mutating the const is what lets the
// test prove the shift while the live transform is still identity.
console.log('\nmigrateCaptureBase');
const B = CAPTURE_INDIRECT_BASE;
const id = CAPTURE_PARAM_IDS[0];

const shifted = migrateCaptureBase({ [id]: B - 1 }, B - 1);
check('first indirect entry shifts up by the append size', shifted[id] === B,
  `got ${shifted[id]}, expected ${B}`);

const lastTail = migrateCaptureBase({ [id]: B - 1 + CAPTURE_INDIRECT.length - 1 }, B - 1);
check('last indirect entry shifts too',
  lastTail[id] === B + CAPTURE_INDIRECT.length - 1);

const realSrc = migrateCaptureBase({ [id]: B - 2 }, B - 1);
check('a real source index below the saved base is untouched', realSrc[id] === B - 2);

const same = migrateCaptureBase({ [id]: B }, B);
check('identity when the stamp matches the current base', same[id] === B);

const twice = migrateCaptureBase(migrateCaptureBase({ [id]: B - 1 }, B - 1), B);
check('idempotent — a re-saved value carries the current base and does not move',
  twice[id] === B);

const noStamp = migrateCaptureBase({ [id]: LEGACY_CAPTURE_BASE }, undefined);
check('an unstamped file is read at LEGACY_CAPTURE_BASE',
  noStamp[id] === LEGACY_CAPTURE_BASE + (CAPTURE_INDIRECT_BASE - LEGACY_CAPTURE_BASE));

check('a non-capture param in the same map is never touched',
  migrateCaptureBase({ 'layer.fg': B - 1, [id]: B - 1 }, B - 1)['layer.fg'] === B - 1);

check('survives a missing values map', migrateCaptureBase(null, 0) === null);

// ── 4. States helper ─────────────────────────────────────────────────────────
console.log('\nmigrateStatesCaptureBase');
const states = [null, { values: { [id]: B - 1 } }, { }, { values: {} }];
migrateStatesCaptureBase(states, B - 1);
check('migrates each state that has values', states[1].values[id] === B);
check('tolerates null and value-less slots', true);
check('tolerates a non-array', migrateStatesCaptureBase(undefined, 0) === undefined);

// ── 5. Every write path stamps ───────────────────────────────────────────────
// Static, because instantiating PresetManager needs a renderer. The stamp is
// worthless if one exporter forgets it: an unstamped file is assumed legacy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const preset = readFileSync(resolve(root, 'src/state/Preset.js'), 'utf8');
const project = readFileSync(resolve(root, 'src/io/ProjectFile.js'), 'utf8');

console.log('\nstamps on every write path');
const stampCount = (preset.match(/sourceCount:\s*CAPTURE_INDIRECT_BASE/g) ?? []).length;
check('Preset.js stamps serialize(), exportBank() and exportState()',
  stampCount === 3, `found ${stampCount} of 3`);
check('ProjectFile stamps _collect()',
  /_sourceCount:\s*CAPTURE_INDIRECT_BASE/.test(project));

console.log('\nreads on every load path');
check('Preset.deserialize migrates (covers IndexedDB + .imweb banks)',
  /static deserialize[\s\S]{0,220}migrateStatesCaptureBase/.test(preset));
check('Preset.importBank migrates (.imbank)',
  /static importBank[\s\S]{0,260}migrateStatesCaptureBase/.test(preset));
check('PresetManager.importState migrates (.imstate)',
  /importState\(data[\s\S]{0,120}migrateCaptureBase/.test(preset));
check('ProjectFile._apply migrates the live params overlay',
  /migrateCaptureBase\(data\.params,\s*data\._sourceCount\)/.test(project));

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll capture-base checks passed.\n');
process.exit(failures ? 1 : 0);
