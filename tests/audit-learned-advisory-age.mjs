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
 * So entries age out: an [advisory] lesson that REACHES 90 days fails this
 * audit. Stated that way because the boundary is inclusive — at exactly 90 days
 * the check goes red — and the first wording said "older than 90 days", which
 * describes a different rule and disagrees with the code on the one day a year
 * it matters. One sentence, one boundary, everywhere.
 *
 * The fix is never to delete the lesson — it is to promote it to a mechanism
 * (the new-audit skill exists for that), refine it in place into a sharper one
 * that can be promoted, or fold the reason it resists promotion into the entry
 * and re-date it as a conscious decision, the way the 2026-07-31 blending entry
 * explains why it stays advisory.
 *
 * **An undated entry is not exempt, it is invisible** — the parser matches
 * `- YYYY-MM-DD [advisory]:` and anything else simply is not seen, so the
 * easiest way to silence this audit forever would be to write an entry without
 * a date. That is the one failure a promotion-pressure audit cannot afford, so
 * it counts advisory-shaped lines and asserts every one of them parsed.
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

/**
 * The self-guard: every advisory-SHAPED entry line must have parsed.
 *
 * The old check was `entries.length > 0 || !text.includes('[advisory]:')`,
 * which passes as soon as ONE entry is dated — so an undated entry beside
 * fifteen dated ones is invisible, ages forever, and takes the audit's whole
 * purpose with it. It also passed trivially the day the file had no advisories
 * at all. An audit whose parser can be stepped around by writing the entry
 * slightly differently is not promotion pressure; it is a suggestion.
 */
const shaped = [...text.matchAll(/^- .*?\[advisory\]:/gm)].map((m) => m[0]);
const unparsed = shaped.filter((line) => !/^- \d{4}-\d{2}-\d{2} \[advisory\]:/.test(line));
check(
  `every [advisory] entry carries a date (${shaped.length} found)`,
  unparsed.length === 0,
  unparsed.length
    ? `undated, so invisible to the age check: ${unparsed.map((l) => l.slice(0, 60)).join(' | ')}`
    : '',
);
check('and the parser saw all of them', entries.length === shaped.length,
  `${entries.length} parsed of ${shaped.length} — a gap means the regex and the file disagree`);

for (const e of entries) {
  check(
    `${e.date} advisory entry is younger than ${MAX_AGE_DAYS} days`,
    e.ageDays < MAX_AGE_DAYS,
    `age ${e.ageDays}d — promote it, refine it, or re-date it as a conscious deferral: ${e.text.slice(0, 80)}…`,
  );
}

/**
 * Say when the next one falls due.
 *
 * The review's fourth item was "watch for the first aging-out event" — which is
 * a job for a person to remember, and this file exists because people do not.
 * So it announces it instead: every run names the entry closest to the boundary
 * and how long it has. The first time this audit goes red should be a date
 * somebody already knew, not a surprise on an unrelated PR.
 */
if (entries.length) {
  const next = entries.reduce((a, b) => (a.ageDays >= b.ageDays ? a : b));
  const left = MAX_AGE_DAYS - next.ageDays;
  console.log(
    left > 0
      ? `\n  next due: ${next.date} ages out in ${left} day(s) — ${next.text.slice(0, 60)}…`
      : `\n  ${next.date} is past due by ${-left} day(s)`,
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
