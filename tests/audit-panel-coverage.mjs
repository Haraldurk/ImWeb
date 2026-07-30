/**
 * Panel coverage audit — every param of a split group reaches the UI.
 *
 * Why this exists. Most panels are fed `ps.getGroup('x')`, so registering a
 * param is enough to make it appear. Groups large enough to be split across
 * sections (Rutt-Etra, 19 rows) are fed EXPLICIT id lists instead, because
 * getGroup returns registration order and a sliced panel wants its own reading
 * order per section.
 *
 * The cost of that is a silent failure mode: a newly registered param simply
 * does not appear anywhere, with no error and nothing missing from the render.
 * You get a control you can save, recall and MIDI-map but never see — and the
 * obvious conclusion is that the feature did not ship, not that a list in UI.js
 * was not updated.
 *
 * Run:  node tests/audit-panel-coverage.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ui = readFileSync(resolve(root, 'src/ui/UI.js'), 'utf8');

// Collect every pick('<prefix>', ['a', 'b', ...]) call, across line breaks.
const placed = new Map();               // prefix -> Set of keys
for (const m of ui.matchAll(/pick\(\s*'(\w+)'\s*,\s*\[([\s\S]*?)\]\s*\)/g)) {
  const prefix = m[1];
  const keys = [...m[2].matchAll(/'([\w.]+)'/g)].map(k => k[1]);
  if (!placed.has(prefix)) placed.set(prefix, []);
  placed.get(prefix).push(...keys);
}

if (!placed.size) {
  console.error('FAIL — no pick() panel sections found; has the helper been renamed?');
  process.exit(1);
}

const ps = new ParameterSystem();
registerCoreParameters(ps);

let failures = 0;
for (const [prefix, keys] of placed) {
  const registered = ps.getGroup(prefix).map(p => p.id.slice(prefix.length + 1));
  const shown = new Set(keys);

  const missing = registered.filter(k => !shown.has(k));
  const unknown = keys.filter(k => !registered.includes(k));
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);

  console.log(`${prefix}: ${registered.length} registered, ${keys.length} placed`);

  if (missing.length) {
    console.error(`  FAIL — registered but in no panel section: ${missing.join(', ')}`);
    console.error('         Add each to a pick() list in buildMappingPanels (UI.js).');
    failures++;
  }
  if (unknown.length) {
    console.error(`  FAIL — placed but not registered: ${unknown.join(', ')}`);
    failures++;
  }
  if (dupes.length) {
    console.error(`  FAIL — placed in more than one section: ${dupes.join(', ')}`);
    failures++;
  }
  if (!missing.length && !unknown.length && !dupes.length) {
    console.log('  ok — every param placed exactly once');
  }
}

process.exit(failures ? 1 : 0);
