/**
 * Static audit: Bokeh's numeric contracts — units, and index alignment.
 *
 * Why this exists. Bokeh shipped its first working build with a radius that did
 * nothing visible. `effect.bokehradius` was registered as 0.25-8 "×", copied
 * from `effect.bloomradius`, and the handler passed that value straight into
 * `uRadius` — which BOKEH_GATHER consumes as PIXELS. The default 2 was a
 * two-pixel blur on a nineteen-hundred-pixel canvas.
 *
 * What made it expensive to spot: the effect was not inert. The highlight boost
 * and the power-space accumulation still ran at full strength, so bright areas
 * bloomed while nothing defocused, and the owner's report was the precise and
 * accurate "I don't see bokeh, it does bloom". A control that is scaled wrongly
 * does not look broken. It looks like a different effect.
 *
 * The shader was already proven correct in a real GLSL compiler at the time —
 * with uRadius = 12 on a 64-pixel test image. Both halves were right on their
 * own; only the units between them disagreed, which is exactly the kind of gap
 * no single-component test can see.
 *
 * Three invariants, each a bug class rather than that one bug:
 *
 *   1. UNITS. A radius consumed as pixels must be scaled by a frame dimension
 *      on the way in, or it silently means something different at every canvas
 *      size — and, per the 4K report, resolution is what this project gets
 *      judged on.
 *   2. INDEX ALIGNMENT. Two SELECTs feed lookup tables by position:
 *      bokehquality → BOKEH_TIERS, bokehblades → a blade-count array. If a
 *      table is shorter than its menu, the extra options silently fall back
 *      rather than erroring — the same shape as `_sdfSrcToLayerIdx`, where
 *      every index was in range and every option resolved to a real texture,
 *      three entries away from the one named.
 *   3. ZERO IS OFF. At radius 0 the pass must short-circuit before the
 *      highlight boost, or "off" brightens the picture.
 *
 * Run:  node tests/audit-bokeh-units.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const pipeline = read('src/core/Pipeline.js');
const shaders  = read('src/shaders/index.js');

console.log('\nBokeh units and index-alignment audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.error(`  FAIL ${m}`); failed = true; };

const { PARAMS } = await import('../src/controls/ParameterSystem.js')
  .then((m) => ({ PARAMS: m }))
  .catch(() => ({ PARAMS: null }));

// ── 1. Units ────────────────────────────────────────────────────────────────

const handler = (() => {
  const i = pipeline.indexOf('bokeh: (pipe, tex, p) =>');
  if (i < 0) return null;
  const j = pipeline.indexOf('\n  levels:', i);
  return j < 0 ? pipeline.slice(i) : pipeline.slice(i, j);
})();

if (!handler) {
  fail('could not locate the bokeh handler in Pipeline.js (renamed? update this audit, do not delete it)');
} else {
  const radiusLine = handler.split('\n').find((l) => l.includes('uRadius:'));
  if (!radiusLine) {
    fail('the bokeh handler sets no uRadius');
  } else if (/pipe\.(height|width)/.test(radiusLine)) {
    ok('uRadius is scaled by a frame dimension, not passed raw');
  } else {
    fail('uRadius is passed WITHOUT a pipe.height/width term — ' +
         'the shader reads it as pixels, so this is a different blur at every canvas size');
  }

  // The shader must agree that it is receiving pixels.
  if (/uRadius;\s*\/\/[^\n]*pixel/i.test(shaders)) {
    ok('BOKEH_GATHER documents uRadius as pixels (the contract both sides rely on)');
  } else {
    fail('BOKEH_GATHER no longer declares uRadius in pixels — the handler scales for pixels');
  }
}

// ── 2. Index alignment ──────────────────────────────────────────────────────

const tierMatch = pipeline.match(/const BOKEH_TIERS = \[([^\]]*)\]/);
const tiers = tierMatch ? tierMatch[1].split(',').filter((s) => s.trim()).length : -1;

const bladeLine = handler?.split('\n').find((l) => l.includes('bokehblades'));
const bladeMatch = bladeLine?.match(/\[([^\]]*)\]\[/);
const blades = bladeMatch ? bladeMatch[1].split(',').filter((s) => s.trim()).length : -1;

// Option counts come from the registry, so a menu edit is what moves them.
let qualityOpts = -1, bladeOpts = -1;
if (PARAMS?.createParameterSystem) {
  try {
    const ps = PARAMS.createParameterSystem();
    qualityOpts = ps.get('effect.bokehquality')?.options?.length ?? -1;
    bladeOpts   = ps.get('effect.bokehblades')?.options?.length ?? -1;
  } catch { /* fall through to the source-scrape below */ }
}
if (qualityOpts < 0) {
  const src = read('src/controls/ParameterSystem.js');
  const q = src.match(/id: "effect\.bokehquality"[\s\S]{0,240}?options: \[([^\]]*)\]/);
  const b = src.match(/id: "effect\.bokehblades"[\s\S]{0,240}?options: \[([^\]]*)\]/);
  qualityOpts = q ? q[1].split(',').filter((s) => s.trim()).length : -1;
  bladeOpts   = b ? b[1].split(',').filter((s) => s.trim()).length : -1;
}

if (tiers < 1 || qualityOpts < 1) {
  fail(`could not compare bokehquality options (${qualityOpts}) with BOKEH_TIERS (${tiers})`);
} else if (tiers === qualityOpts) {
  ok(`bokehquality has ${qualityOpts} options and BOKEH_TIERS has ${tiers} entries`);
} else {
  fail(`bokehquality has ${qualityOpts} options but BOKEH_TIERS has ${tiers} — ` +
       'a tier past the end of the array selects undefined and the pass silently stops rendering');
}

if (blades < 1 || bladeOpts < 1) {
  fail(`could not compare bokehblades options (${bladeOpts}) with the blade map (${blades})`);
} else if (blades === bladeOpts) {
  ok(`bokehblades has ${bladeOpts} options and the blade map has ${blades} entries`);
} else {
  fail(`bokehblades has ${bladeOpts} options but the blade map has ${blades} — ` +
       'the extra option falls back to a circle instead of the iris it names');
}

// ── 3. Zero is off ──────────────────────────────────────────────────────────

if (/if \(radiusPx < [\d.]+\) \{[^}]*return;/.test(shaders)) {
  ok('BOKEH_GATHER returns the untouched centre below a sub-pixel radius');
} else {
  fail('BOKEH_GATHER has no sub-pixel early return — at radius 0 the highlight ' +
       'boost still runs, so "off" brightens the picture instead of doing nothing');
}

if (handler && /const amt = p\.get\('effect\.bokeh'\)\.value \/ 100;\s*\n\s*if \(amt <= 0\) return tex;/.test(handler)) {
  ok('the handler short-circuits at amount 0, like every other effect');
} else {
  fail('the bokeh handler does not early-return at amount 0');
}

if (failed) {
  console.error('\nFAIL — a Bokeh numeric contract is broken.\n');
  process.exit(1);
}
console.log('\nAll Bokeh unit and alignment checks passed.\n');
