/**
 * Bank-save exclusion audit.
 *
 * Why this exists. A user's saved banks and projects must never ship. Only
 * MasterProject.imweb and FactoryBank.imbank are factory content; everything
 * else under public/Projects/ is the owner's own performance state.
 *
 * That is enforced by ORDERING, not by a pattern: .gitignore un-ignores all of
 * public/ with a broad `!public/**`, and then re-ignores
 * `public/Projects/*.imweb` on a LATER line, because later rules win. The
 * ordering is load-bearing and invisible — a tidy-up that groups the negations
 * together, or moves the re-ignore up, silently re-exposes every bank save.
 *
 * It has already happened once: Bank 1.imweb was committed and pushed to this
 * repo, which is public, alongside a Phase 10 fix. There was no error and
 * nothing looked wrong; a `git add -A` simply picked it up.
 *
 * This cannot be a runtime check — it is a property of the repository, not of
 * the app — and it cannot be a comment, because the existing comment already
 * says "this must stay BELOW the !public/** negation" and a comment cannot
 * fail a test run.
 *
 * Promoted from LEARNED.md 2026-07-10, [advisory] -> [audit].
 *
 * Run:  node tests/audit-gitignore-banks.mjs
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// Every git spawn from node costs ~330ms on macOS (vs ~49ms from a shell), so
// this asks git ONCE for all paths rather than once per path. Fourteen spawns
// took five seconds; two take well under one, and this audit runs from the
// audit-after-edit hook on every source edit.
//
// `check-ignore --stdin -z` reads NUL-separated paths and prints back only the
// ignored ones. It exits 1 when nothing matches, which execFileSync throws on,
// so the output is read off the error too.
const ignoredSet = (paths) => {
  let out = '';
  try {
    out = execFileSync('git', ['check-ignore', '--stdin', '-z'],
      { cwd: root, input: paths.join('\0'), encoding: 'utf8' });
  } catch (e) {
    out = e.stdout ?? '';
  }
  return new Set(out.split('\0').filter(Boolean));
};

// Which of these paths does git track? One spawn, and it names them.
const trackedSet = (paths) => {
  let out = '';
  try {
    out = execFileSync('git', ['ls-files', '-z', '--', ...paths],
      { cwd: root, encoding: 'utf8' });
  } catch { /* nothing tracked */ }
  return new Set(out.split('\0').filter(Boolean));
};

// ── 1. Real files on disk ────────────────────────────────────────────────────
// Anything present under public/Projects that is not factory content must be
// ignored right now.
const FACTORY = new Set(['MasterProject.imweb', 'FactoryBank.imbank']);

console.log('\npublic/Projects on disk');
const present = readdirSync(resolve(root, 'public/Projects'));

// Hypothetical names too — the real risk is the NEXT save, not the ones already
// here. check-ignore evaluates patterns, not the filesystem, so these need not
// exist. Asked in the same single call as the real files.
const FUTURE = [
  'Bank 99.imweb', 'Untitled.imweb', 'gig-2027-01-14.imweb',
  'Bank 1 (7).imweb', 'set list.imstate', 'live.imbank',
];

const ignored = ignoredSet(
  [...present, ...FUTURE].map((n) => `public/Projects/${n}`));

for (const name of present) {
  const p = `public/Projects/${name}`;
  if (FACTORY.has(name)) {
    check(`${name} is shippable factory content`, !ignored.has(p));
  } else {
    check(`${name} is excluded`, ignored.has(p),
      'a user save would be committed by a careless `git add`');
  }
}
check('at least one non-factory save was actually examined',
  present.some((n) => !FACTORY.has(n)),
  'no user saves present — this run proved less than it looks');

// ── 2. Names that do not exist yet ───────────────────────────────────────────
// The real risk is the NEXT save, not the ones already here. These are
// hypothetical paths: check-ignore evaluates patterns, not the filesystem.
console.log('\nfuture save names');
for (const name of FUTURE) {
  check(`a future "${name}" would be excluded`, ignored.has(`public/Projects/${name}`));
}

// ── 3. The ordering that makes it work ───────────────────────────────────────
// Assert the mechanism, not just the outcome, so a reorder fails here with an
// explanation rather than silently widening what ships.
console.log('\n.gitignore ordering');
const gi = readFileSync(resolve(root, '.gitignore'), 'utf8').split('\n');
const broadNegation = gi.findIndex((l) => l.trim() === '!public/**');
const reIgnore = gi.findIndex((l) => l.trim() === 'public/Projects/*.imweb');

check('the broad `!public/**` negation is present', broadNegation !== -1);
check('the `public/Projects/*.imweb` re-ignore is present', reIgnore !== -1);
check('the re-ignore comes AFTER the negation (later rules win)',
  broadNegation !== -1 && reIgnore !== -1 && reIgnore > broadNegation,
  `!public/** at line ${broadNegation + 1}, re-ignore at line ${reIgnore + 1}`);

// ── 4. Factory content stays reachable ───────────────────────────────────────
console.log('\nfactory content');
const tracked = trackedSet([...FACTORY].map((n) => `public/Projects/${n}`));
for (const name of FACTORY) {
  check(`${name} is tracked`, tracked.has(`public/Projects/${name}`),
    'the app ships this — an over-broad rule has excluded it');
}

if (failures) {
  console.error(
    '\nDo NOT fix this by loosening the rule. The order in .gitignore is the\n' +
    'mechanism: `!public/**` opens all of public/, and `public/Projects/*.imweb`\n' +
    'must come after it to close the bank saves again. If you moved or grouped\n' +
    'the negations, move the re-ignore back below them. If you added new factory\n' +
    'content, add an explicit `!public/Projects/<name>` and extend FACTORY here.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll bank-exclusion checks passed.\n');
process.exit(failures ? 1 : 0);
