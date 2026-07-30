/**
 * Static audit: every SOURCE_DEFS entry must be handled by _resolveLayerTex().
 *
 * Why this exists. _resolveLayerTex is the secondary resolver used by everything
 * that needs a texture outside the pipeline — 3D material texsrc, the SDF's
 * texture/refraction sources, the Analog source, the particle luma mask,
 * td.mapSource, slitscan.source, vwarp.source. It ends in a
 * `return pipeline.prev.texture` fall-through, so a source it does not name
 * resolves SILENTLY to the composited output rather than to the thing the
 * dropdown says. It handled 16 of 29 for a long time and nothing complained,
 * because the failure mode is a plausible-looking picture.
 *
 * A fall-through cannot be turned into a thrown error — it is a per-frame hot
 * path and the last thing anyone wants is an exception in the render loop — so
 * the invariant is enforced here instead.
 *
 * Run:  node tests/audit-source-resolution.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const main = readFileSync(resolve(root, 'src/main.js'), 'utf8');
const psrc = readFileSync(resolve(root, 'src/controls/ParameterSystem.js'), 'utf8');

// SOURCE_DEFS is the canonical list. Read only that array, not the parameter
// descriptors further down the file that share its { key, label } shape.
const defsBlock = psrc.slice(
  psrc.indexOf('export const SOURCE_DEFS = ['),
  psrc.indexOf('];', psrc.indexOf('export const SOURCE_DEFS = [')),
);
const defs = [...defsBlock.matchAll(/\{\s*key:\s*"(\w+)",\s*label:\s*"([^"]+)"/g)]
  .map((m) => ({ key: m[1], label: m[2] }));

// The keys _resolveLayerTex names.
const fnStart = main.indexOf('function _resolveLayerTex(idx) {');
const fnBody = main.slice(fnStart, main.indexOf('\n  }', fnStart));
const handled = new Set([...fnBody.matchAll(/key === "(\w+)"/g)].map((m) => m[1]));

const missing = defs.filter((d) => !handled.has(d.key));

console.log(`SOURCE_DEFS entries: ${defs.length}`);
console.log(`handled by _resolveLayerTex: ${handled.size}`);

if (missing.length) {
  console.error(`\nFAIL — ${missing.length} source(s) fall through to Output:`);
  for (const m of missing) {
    console.error(`  ${defs.indexOf(m).toString().padStart(2)} ${m.label}  (key "${m.key}")`);
  }
  console.error(
    '\nAdd a branch in _resolveLayerTex, taking the expression from the inputs\n' +
    'bag in the render loop so the two agree. If a new source genuinely has no\n' +
    'texture, name it and return null explicitly rather than leaving it to fall\n' +
    'through — the fall-through is indistinguishable from a working selection.',
  );
  process.exit(1);
}

// Keys named but not in SOURCE_DEFS — a rename or a typo.
const stray = [...handled].filter((k) => !defs.some((d) => d.key === k));
if (stray.length) {
  console.error(`\nFAIL — _resolveLayerTex names key(s) absent from SOURCE_DEFS: ${stray.join(', ')}`);
  process.exit(1);
}

/**
 * CAPTURE_SOURCES must be SOURCES plus the indirect entries, in that order.
 *
 * The indices are persisted in saved states, banks, .imweb files and MIDI
 * mappings, so the indirect entries have to stay APPENDED. Inserting anything
 * ahead of them — or, worse, adding "FG Src" to SOURCE_DEFS itself, which would
 * also make it selectable as a layer — silently re-points every stored value.
 */
const capBlock = psrc.slice(
  psrc.indexOf('export const CAPTURE_SOURCES'),
  psrc.indexOf('\n', psrc.indexOf('export const CAPTURE_SOURCES')),
);
if (!/\[\s*\.\.\.SOURCES\s*,\s*\.\.\.CAPTURE_INDIRECT\s*\]/.test(capBlock)) {
  console.error(
    '\nFAIL — CAPTURE_SOURCES must be exactly [...SOURCES, ...CAPTURE_INDIRECT].\n' +
    `  found: ${capBlock.trim()}\n` +
    '  The indirect entries are persisted as indices and must stay appended.',
  );
  process.exit(1);
}

// The layer selectors must NOT offer the indirect entries: layer.fg = "FG Src"
// is self-referential, and SOURCE_DEFS is what they are built from.
const layerBad = ['layer.fg', 'layer.bg', 'layer.ds'].filter((id) => {
  const at = main.length && psrc.indexOf(`id: "${id}"`);
  if (at < 0) return false;
  return /options: CAPTURE_SOURCES/.test(psrc.slice(at, at + 400));
});
if (layerBad.length) {
  console.error(`\nFAIL — layer selector(s) offer indirect entries: ${layerBad.join(', ')}`);
  process.exit(1);
}

console.log('\nPASS — every source resolves to itself, none silently to Output.');
console.log('PASS — CAPTURE_SOURCES appends the indirect entries; layers do not offer them.');
