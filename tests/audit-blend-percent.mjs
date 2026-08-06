/**
 * Blend-amount percent migration audit — schema 2.
 *
 * Why this exists. layer.fg/bg.blendAmount moved from 0–1 to 0–100 %, and
 * unlike every other migration in this file's neighbourhood the KEY did not
 * change — only the scale did. That removes the property the other migrations
 * rely on: the data can no longer answer "has this run?", because 0.5 is legal
 * in both schemes (half, and half a percent). The migration is therefore
 * idempotent only via the stamp, and a write path that forgets to stamp
 * silently halves every saved patch's blend on the NEXT load — a change small
 * enough to look like a rendering difference rather than a data bug.
 *
 * So this audit checks two separate things:
 *   1. the conversion is right, carries controller bounds, and is stamp-gated
 *   2. every write path stamps, and every read path migrates
 *
 * Run:  node tests/audit-blend-percent.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ParameterSystem, registerCoreParameters,
  PARAM_SCHEMA, migrateBlendPercent, migrateStatesBlendPercent,
} from '../src/controls/ParameterSystem.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = p => readFileSync(resolve(root, p), 'utf8');

let fail = 0;
const ok = (name, cond) => {
  console.log(`  ${cond ? 'ok  ' : 'FAIL'}   ${name}`);
  if (!cond) fail++;
};

// ── 1. The parameters really are percent now ─────────────────────────────────
console.log('\nparameter registry');
const ps = new ParameterSystem();
registerCoreParameters(ps);
for (const id of ['layer.fg.blendAmount', 'layer.bg.blendAmount']) {
  const p = ps.get(id);
  ok(`${id} exists`, !!p);
  ok(`${id} runs 0–100`, p.min === 0 && p.max === 100);
  ok(`${id} is a percent`, p.unit === '%');
  ok(`${id} defaults to full`, p.value === 100);
}

// ── 2. Conversion ────────────────────────────────────────────────────────────
console.log('\nconversion (legacy → percent)');
{
  const v = { 'layer.fg.blendAmount': 1, 'layer.bg.blendAmount': 0.35, 'displace.amount': 0.5 };
  migrateBlendPercent(v, null, 1);
  ok('a full legacy blend becomes 100', v['layer.fg.blendAmount'] === 100);
  ok('a partial legacy blend scales', Math.abs(v['layer.bg.blendAmount'] - 35) < 1e-9);
  ok('an unrelated param is untouched', v['displace.amount'] === 0.5);
}
{
  const v = { 'layer.fg.blendAmount': 0 };
  migrateBlendPercent(v, null, 1);
  ok('zero stays zero', v['layer.fg.blendAmount'] === 0);
}
{
  const v = {};
  migrateBlendPercent(v, null, 1);
  ok('a map without the keys is left alone', Object.keys(v).length === 0);
  ok('a missing values map is survivable',
     migrateBlendPercent(null, null, 1) === null || true);
}

// ── 3. The stamp gates it ────────────────────────────────────────────────────
// This is the whole reason the stamp exists: without it, the values below are
// indistinguishable from legacy ones and would be multiplied again.
console.log('\nstamp gating');
{
  const v = { 'layer.fg.blendAmount': 50 };
  migrateBlendPercent(v, null, PARAM_SCHEMA);
  ok('a current-schema file is NOT converted', v['layer.fg.blendAmount'] === 50);
}
{
  const v = { 'layer.fg.blendAmount': 0.5 };
  migrateBlendPercent(v, null, PARAM_SCHEMA);
  ok('a deliberate 0.5 % survives a current-schema load', v['layer.fg.blendAmount'] === 0.5);
}
{
  const v = { 'layer.fg.blendAmount': 0.5 };
  migrateBlendPercent(v, null, undefined);
  ok('an UNSTAMPED file is read as legacy', v['layer.fg.blendAmount'] === 50);
}
{
  // Re-running with the file's own (legacy) stamp is what a second load does,
  // and it must not compound. Values are clamped at 100, so the visible symptom
  // of a double-run is everything pinned to full rather than an absurd number.
  const v = { 'layer.fg.blendAmount': 0.4 };
  migrateBlendPercent(v, null, 1);
  const once = v['layer.fg.blendAmount'];
  migrateBlendPercent(v, null, PARAM_SCHEMA);
  ok('a migrated map re-read at the new stamp does not compound',
     v['layer.fg.blendAmount'] === once && once === 40);
}
{
  const v = { 'layer.fg.blendAmount': 5 };
  migrateBlendPercent(v, null, 1);
  ok('an out-of-range legacy value clamps to 100', v['layer.fg.blendAmount'] === 100);
}

// ── 4. Controller records ────────────────────────────────────────────────────
// Recall bounds are carried, not reset: same quantity, same direction, one
// factor of 100 apart. (The SDF camera migration resets its bounds because a
// box in world units is not a box in azimuth/elevation — different case.)
console.log('\ncontroller records');
{
  const recs = {
    'layer.fg.blendAmount': { id: 'layer.fg.blendAmount', type: 'lfo', value: 0.8,
                              ctrlMin: 0.2, ctrlMax: 0.9, hz: 0.1 },
    'displace.amount':      { id: 'displace.amount', ctrlMin: 0, ctrlMax: 1 },
  };
  migrateBlendPercent(null, recs, 1);
  const r = recs['layer.fg.blendAmount'];
  ok('the record value scales', Math.abs(r.value - 80) < 1e-9);
  ok('ctrlMin scales', Math.abs(r.ctrlMin - 20) < 1e-9);
  ok('ctrlMax scales', Math.abs(r.ctrlMax - 90) < 1e-9);
  ok('unrelated controller settings are carried', r.type === 'lfo' && r.hz === 0.1);
  ok('another param\'s record is untouched', recs['displace.amount'].ctrlMax === 1);
}

// ── 5. Display states ────────────────────────────────────────────────────────
console.log('\ndisplay states');
{
  const states = [
    { values: { 'layer.fg.blendAmount': 1 }, controllers: { 'layer.bg.blendAmount': { ctrlMax: 0.5 } } },
    null,
    { name: 'no values' },
    { values: { 'layer.bg.blendAmount': 0.25 } },
  ];
  migrateStatesBlendPercent(states, 1);
  ok('each state with values is migrated', states[0].values['layer.fg.blendAmount'] === 100);
  ok('its controller bag is migrated too', states[0].controllers['layer.bg.blendAmount'].ctrlMax === 50);
  ok('a later state is migrated', states[3].values['layer.bg.blendAmount'] === 25);
  ok('null and value-less slots are tolerated', true);
  ok('a non-array is tolerated', migrateStatesBlendPercent(undefined, 1) === undefined);
}

// ── 6. Every write path stamps, every read path migrates ─────────────────────
// The source-level half. A conversion that is correct in isolation is worthless
// if one of the four file formats never carries the stamp.
console.log('\nstamps on every write path');
{
  const preset = read('src/state/Preset.js');
  const project = read('src/io/ProjectFile.js');
  const serialize  = preset.slice(preset.indexOf('serialize()'), preset.indexOf('exportBank'));
  const exportBank = preset.slice(preset.indexOf('exportBank('), preset.indexOf('static importBank'));
  const exportState = preset.slice(preset.indexOf('exportState('), preset.indexOf('importState('));
  ok('Preset.serialize stamps',  /schema:\s*PARAM_SCHEMA/.test(serialize));
  ok('Preset.exportBank stamps', /schema:\s*PARAM_SCHEMA/.test(exportBank));
  ok('PresetManager.exportState stamps', /schema:\s*PARAM_SCHEMA/.test(exportState));
  ok('ProjectFile._collect stamps', /_schema:\s*PARAM_SCHEMA/.test(project));
}

console.log('\nreads on every load path');
{
  const preset = read('src/state/Preset.js');
  const project = read('src/io/ProjectFile.js');
  const deserialize = preset.slice(preset.indexOf('static deserialize'), preset.indexOf('async save()'));
  const importBank  = preset.slice(preset.indexOf('static importBank'), preset.indexOf('static deserialize'));
  const importState = preset.slice(preset.indexOf('importState('), preset.indexOf('exportState(') > preset.indexOf('importState(')
                        ? preset.length : preset.indexOf('importState(') + 1500);
  ok('Preset.deserialize migrates states (IndexedDB + .imweb banks)',
     /migrateStatesBlendPercent\(\s*p\.states,\s*data\.schema/.test(deserialize));
  ok('Preset.deserialize migrates the bank-level controller bag',
     /migrateBlendPercent\(\s*null,\s*p\.controllers,\s*data\.schema/.test(deserialize));
  ok('Preset.importBank migrates (.imbank)',
     /migrateStatesBlendPercent\(/.test(importBank));
  ok('PresetManager.importState migrates (.imstate)',
     /migrateBlendPercent\(\s*data\.values,\s*data\.controllers,\s*data\.schema/.test(importState));
  ok('ProjectFile._apply migrates the live params overlay',
     /migrateBlendPercent\(\s*data\.params,\s*null,\s*data\._schema/.test(project));
}

// ── 7. The shader still gets 0–1 ─────────────────────────────────────────────
// A percent param feeding a mix() straight would clamp everything to full and
// look like "the amount control does nothing above 1%".
console.log('\npipeline scales percent back to unit');
{
  const pipeline = read('src/core/Pipeline.js');
  const calls = [...pipeline.matchAll(/uBlendAmount:\s*\(p\.get\('layer\.(fg|bg)\.blendAmount'\)[^)]*\)\s*\/\s*100/g)];
  ok('both layer blend passes divide by 100', calls.length === 2);
  ok('neither passes a raw percent',
     !/uBlendAmount:\s*\(p\.get\('layer\.[a-z]+\.blendAmount'\)\?\.value\s*\?\?\s*\d+\),/.test(pipeline));
}

console.log(fail ? `\n${fail} blend-percent check(s) failed.` : '\nAll blend-percent checks passed.\n');
process.exit(fail ? 1 : 0);
