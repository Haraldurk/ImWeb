/**
 * Guided-tour target audit — every step points at something that exists.
 *
 * Why this exists. The tour's steps live in docs/ImWeb-Guide.md and name their
 * targets as strings: `point:` takes parameter ids, `show:` takes CSS
 * selectors. Nothing checks those strings at build time, and the failure mode
 * is quiet in the worst way — the tour still opens, the step still reads
 * correctly, and only the little "show me" chip does nothing. A reader
 * concludes the app is broken rather than the doc.
 *
 * It is also a rename tripwire. A parameter id is a string in two places once
 * the tour references it, and ParameterSystem is where renames happen. Without
 * this audit, `rutt.zgain → rutt.depth` would leave a dead chip behind with no
 * error anywhere.
 *
 * Uses the tour's OWN parser rather than a second regex, so a change to the
 * step grammar cannot pass here and fail in the app.
 *
 * Run:  node tests/audit-guide-targets.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';
import { parseGuide, TRACKS } from '../src/ui/Guide.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(resolve(root, 'docs/ImWeb-Guide.md'), 'utf8');
const html = readFileSync(resolve(root, 'index.html'), 'utf8');

const steps = parseGuide(md);

// A parser that silently matches nothing would make every check below vacuous.
if (steps.length < 5) {
  console.error(`FAIL — parsed only ${steps.length} steps from docs/ImWeb-Guide.md.`);
  console.error('       Either the file lost its "## " headings or the grammar changed.');
  process.exit(1);
}

const ps = new ParameterSystem();
registerCoreParameters(ps);

// The served copy is what the app actually fetches; docs/ is what people edit.
// They drift the moment someone edits one and forgets `npm run sync-docs`.
//
// EVERY file that script copies, not just the Guide. This checked the Guide
// alone for a long time, and the other three drifted unnoticed underneath it:
// public/docs/ImWeb_Full_Manual.md was last synced in #78 while docs/ had been
// rewritten twice since (#99, #101), so the app served a manual missing the
// whole 3D camera table, Transparent BG and Mapping — every symptom of a
// feature that does not exist, in the one document a confused user opens.
//
// The list is DERIVED from the npm script rather than written here. An audit
// that enumerates its own subjects fails open the day someone adds one
// (LEARNED 2026-08-15), and that is precisely how three of these four escaped.
let failures = 0;
{
  const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
  const script = pkg.scripts?.['sync-docs'] ?? '';
  const copied = [...script.matchAll(/docs\/([\w.-]+\.md)/g)]
    .map(m => m[1])
    .filter(f => !script.startsWith(`cp public/docs/${f}`));
  const files = [...new Set(copied)];

  if (files.length < 2) {
    console.error('FAIL — parsed only ' + files.length + ' file(s) out of the sync-docs script.');
    console.error('       The script changed shape; this check is now vacuous. Fix the parse.');
    failures++;
  }

  for (const f of files) {
    let source;
    try {
      source = readFileSync(resolve(root, `docs/${f}`), 'utf8');
    } catch {
      console.error(`FAIL — docs/${f} is named by sync-docs but does not exist.`);
      failures++;
      continue;
    }
    try {
      if (readFileSync(resolve(root, `public/docs/${f}`), 'utf8') !== source) {
        console.error(`FAIL — public/docs/${f} differs from docs/${f}.`);
        console.error('       The app serves the public/ copy. Run: npm run sync-docs');
        failures++;
      }
    } catch {
      console.error(`FAIL — public/docs/${f} is missing. Run: npm run sync-docs`);
      failures++;
    }
  }
  console.log(`${files.length} served doc(s) checked against docs/`);
}

// Every track needs steps. A typo in a `track:` value is silent in the app —
// the step lands in the default track and the intended one is short — and an
// empty track renders as a dead chip.
const known = new Set(TRACKS.map(([k]) => k));
const perTrack = new Map(TRACKS.map(([k]) => [k, 0]));
for (const s of steps) {
  if (!known.has(s.track)) {
    console.error(`FAIL — step "${s.title}" has unknown track "${s.track}".`);
    console.error(`       Known tracks: ${[...known].join(', ')}`);
    failures++;
  } else {
    perTrack.set(s.track, perTrack.get(s.track) + 1);
  }
}
for (const [k, n] of perTrack) {
  if (!n) {
    console.error(`FAIL — track "${k}" has no steps; its chip would open a blank panel.`);
    failures++;
  }
}

console.log(`${steps.length} steps parsed — ` +
  [...perTrack].map(([k, n]) => `${k}: ${n}`).join(', '));

const tabs = new Set([...html.matchAll(/data-tab="([\w-]+)"/g)].map(m => m[1]));

for (const step of steps) {
  const problems = [];

  for (const id of step.point) {
    if (!ps.get(id)) problems.push(`point: no such parameter "${id}"`);
  }

  for (const sel of step.show) {
    // Only id selectors are checkable statically, which is all the tour uses.
    const m = sel.match(/^#([\w-]+)$/);
    if (!m) { problems.push(`show: "${sel}" is not a plain #id selector`); continue; }
    // Runtime-injected panels (I/O, Hypercube) create their ids in JS, so a
    // miss in index.html is not yet a failure — check the source tree too.
    if (!html.includes(`id="${m[1]}"`) && !html.includes(`id='${m[1]}'`)) {
      problems.push(`show: no element with id "${m[1]}" in index.html`);
    }
  }

  if (step.tab && !tabs.has(step.tab)) {
    problems.push(`tab: "${step.tab}" is not a data-tab in index.html`);
  }

  if (problems.length) {
    console.error(`  FAIL — step "${step.title}"`);
    for (const p of problems) console.error(`         ${p}`);
    failures += problems.length;
  }
}

if (failures) {
  console.error(`\n${failures} broken guide target(s).`);
  process.exit(1);
}
console.log('PASS — every guide target resolves.');
