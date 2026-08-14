/**
 * Advisory-age audit — promotion pressure for LEARNED.md.
 *
 * Why this exists. LEARNED.md's own taxonomy says promoting an entry from
 * prose to mechanism is the point: [audit] runs here, [hook] is a hook,
 * [skill] is a step, [tool] is on-demand but executable. An [advisory] entry
 * has no fence — it works only while someone remembers it. The SessionStart
 * hook (.claude/hooks/session-advisory.sh) surfaces them, but recall is not
 * enforcement, and an entry that sits at [advisory] forever is a lesson the
 * repo has agreed to keep re-learning.
 *
 * So entries age out: an [advisory] lesson older than 90 days fails this
 * audit. The fix is never to delete the lesson — it is to promote it to a
 * mechanism (the new-audit skill exists for that), refine it in place into a
 * sharper one that can be promoted, or fold the reason it resists promotion
 * into the entry and re-date it as a conscious decision, the way the
 * 2026-07-31 blending entry explains why it stays advisory.
 *
 * Run:  node tests/audit-learned-advisory-age.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MAX_AGE_DAYS = 90;
const DAY_MS = 24 * 60 * 60 * 1000;

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const text = readFileSync(resolve(root, 'docs/LEARNED.md'), 'utf8');
const entries = [...text.matchAll(/^- (\d{4})-(\d{2})-(\d{2}) \[advisory\]: (.*)$/gm)]
  .map((m) => ({
    date: m[0].slice(2, 12),
    ageDays: Math.floor((Date.now() - Date.UTC(+m[1], +m[2] - 1, +m[3])) / DAY_MS),
    text: m[4],
  }));

check('LEARNED.md parses and the advisory entries are dated', entries.length > 0 || !text.includes('[advisory]:'));

for (const e of entries) {
  check(
    `${e.date} advisory entry is younger than ${MAX_AGE_DAYS} days`,
    e.ageDays < MAX_AGE_DAYS,
    `age ${e.ageDays}d — promote it, refine it, or re-date it as a conscious deferral: ${e.text.slice(0, 80)}…`,
  );
}

if (failures) {
  console.error(
    '\nDo NOT fix this by deleting the lesson. An old [advisory] entry is a risk\n' +
    'the repo carries in prose; the exits are promotion to a mechanism, refinement\n' +
    'into something promotable, or an in-entry explanation of why it must stay\n' +
    'advisory, re-dated as a deliberate decision.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : `\nAll advisory entries are fresh (< ${MAX_AGE_DAYS} days).\n`);
process.exit(failures ? 1 : 0);
