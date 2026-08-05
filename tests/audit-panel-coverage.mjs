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

// ── Post-FX chain coverage ───────────────────────────────────────────────────
// Same failure shape, different list. An id in DEFAULT_FX_ORDER with no
// _FX_NODE_INFO entry renders and can be automated, but is INVISIBLE in the
// signal-flow diagram — and because the diagram is also the reorder UI, it can
// never be moved in the chain either. Nothing errors; the effect just cannot be
// seen or dragged, which reads as "the flow display is missing an effect"
// rather than as a missing table entry.
console.log('\npost-FX chain:');
const { DEFAULT_FX_ORDER } = await import('../src/core/Pipeline.js');
const nodeBlock = ui.slice(ui.indexOf('const _FX_NODE_INFO = {'), ui.indexOf('export class SignalPath'));
const nodeIds = new Set([...nodeBlock.matchAll(/^\s{2}(\w+):\s*\{\s*label:/gm)].map(m => m[1]));
const noNode = DEFAULT_FX_ORDER.filter(id => !nodeIds.has(id));
console.log(`  ${DEFAULT_FX_ORDER.length} effects in DEFAULT_FX_ORDER, ${nodeIds.size} with flow nodes`);
if (noNode.length) {
  console.error(`  FAIL — in the chain but with no _FX_NODE_INFO entry: ${noNode.join(', ')}`);
  console.error('         Add a { label, isActive } entry in UI.js, or the effect');
  console.error('         cannot be seen or reordered in the signal-flow display.');
  failures++;
} else {
  console.log('  ok — every effect in the chain has a flow node');
}

process.exit(failures ? 1 : 0);
