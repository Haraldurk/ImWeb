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
}
// The two defaults differ ON PURPOSE and the difference is the whole feature:
// FG is a three-stop curve whose CENTRE is the blend, BG is a plain two-stop
// depth. A "make them consistent" edit here would silently drop every new
// patch's foreground blend to half strength.
ok('FG defaults to the centre detent (the blend)', ps.get('layer.fg.blendAmount').value === 50);
ok('BG self-process defaults to full', ps.get('layer.bg.blendAmount').value === 100);

// ── 2. Conversion ────────────────────────────────────────────────────────────
// FG scales by 50 and BG by 100, because the old two-stop `mix(BG, blended, v)`
// is exactly the first HALF of the new FG curve. Getting this wrong does not
// throw — it just quietly replaces every saved blend with the raw Foreground.
console.log('\nconversion (legacy → percent)');
{
  const v = { 'layer.fg.blendAmount': 1, 'layer.bg.blendAmount': 0.35, 'displace.amount': 0.5 };
  migrateBlendPercent(v, null, 1);
  ok('a full legacy FG blend lands on the blend detent, not 100',
     v['layer.fg.blendAmount'] === 50);
  ok('a partial legacy BG self-process scales by 100',
     Math.abs(v['layer.bg.blendAmount'] - 35) < 1e-9);
  ok('an unrelated param is untouched', v['displace.amount'] === 0.5);
}
{
  const v = { 'layer.fg.blendAmount': 0.5 };
  migrateBlendPercent(v, null, 1);
  ok('a half-strength legacy FG blend stays half-strength under the new curve',
     v['layer.fg.blendAmount'] === 25);
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
  ok('an UNSTAMPED file is read as legacy', v['layer.fg.blendAmount'] === 25);
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
     v['layer.fg.blendAmount'] === once && once === 20);
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
  ok('the record value scales by the FG factor', Math.abs(r.value - 40) < 1e-9);
  ok('ctrlMin scales', Math.abs(r.ctrlMin - 10) < 1e-9);
  ok('ctrlMax scales', Math.abs(r.ctrlMax - 45) < 1e-9);
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
  ok('each state with values is migrated', states[0].values['layer.fg.blendAmount'] === 50);
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

// ── 8. uCurve is set at EVERY transfermode pass ──────────────────────────────
// The material is shared by three passes and _pass() writes only what it is
// given, so a pass that omits uCurve inherits whatever the previous one set —
// the exact stale-uniform bug the uBlendAmount comment in Pipeline warns about.
// The damage is silent and intermittent: the feedback blend would flip curve
// depending on whether a layer blend ran earlier in the same frame.
console.log('\nuCurve is explicit at every shared-material pass');
{
  const pipeline = read('src/core/Pipeline.js');
  const passes = [...pipeline.matchAll(/this\._pass\(this\.m\.transfermode,\s*\{([\s\S]*?)\}\s*\)/g)]
    .map(m => m[1]);
  ok('found all three transfermode passes', passes.length === 3);
  ok('every one sets uCurve', passes.every(b => /uCurve:/.test(b)));
  ok('every one sets uBlendAmount', passes.every(b => /uBlendAmount:/.test(b)));
  ok('exactly one uses the three-stop curve (the FG layer)',
     passes.filter(b => /uCurve:\s*1/.test(b)).length === 1);
  ok('the material declares a uCurve default',
     /transfermode:[^\n]*uCurve:\s*\{\s*value:/.test(pipeline));
}

// ── 9. The three-stop curve itself ───────────────────────────────────────────
// Reimplemented from the shader so the endpoints are asserted, not assumed.
console.log('\nblendMix curve');
{
  const shader = read('src/shaders/index.js');
  ok('blendMix exists and branches on uCurve',
     /vec3 blendMix\([\s\S]*?uCurve < 0\.5/.test(shader));
  ok('both fragment writes go through it',
     (shader.match(/gl_FragColor = vec4\(blendMix\(/g) || []).length === 2);

  const mix = (a, b, t) => a + (b - a) * t;
  const three = (bg, bl, fg, amt) =>
    amt < 0.5 ? mix(bg, bl, amt * 2) : mix(bl, fg, (amt - 0.5) * 2);
  const BG = 0.2, BLENDED = 0.7, FG = 1.0;
  ok('0 % is the Background alone',        three(BG, BLENDED, FG, 0.0) === BG);
  ok('50 % is the blend at full strength', three(BG, BLENDED, FG, 0.5) === BLENDED);
  ok('100 % is the Foreground alone',      three(BG, BLENDED, FG, 1.0) === FG);
  ok('the Background is gone by 100 %', three(0, BLENDED, FG, 1.0) === three(1, BLENDED, FG, 1.0));

  // The legacy value that migration maps to must land where it used to.
  const two = (bg, bl, v) => mix(bg, bl, v);
  const legacy = 0.6;
  ok('a migrated legacy value renders identically to the old two-stop pass',
     Math.abs(three(BG, BLENDED, FG, (legacy * 50) / 100) - two(BG, BLENDED, legacy)) < 1e-12);
}

console.log(fail ? `\n${fail} blend-percent check(s) failed.` : '\nAll blend-percent checks passed.\n');
process.exit(fail ? 1 : 0);
