/**
 * The mutation harness — proof that the audits in `tests/` can actually fail.
 *
 * An audit that stays green when the code is wrong is decoration. Every audio
 * audit in this repo claims to have been "mutation-calibrated", and until now
 * that claim rested on ad-hoc shell one-liners typed during one session and then
 * thrown away: not reproducible, not reviewable, and — twice — not even correct,
 * because a mutation whose pattern did not match reports the same "0 failures"
 * as an audit with a genuine hole in it.
 *
 * This runs the calibration from a committed list. `npm run mutate`.
 *
 * ── What it does, and why each step is not optional ────────────────────────
 *
 * For every mutation: read the file, keep the ORIGINAL BYTES IN MEMORY, apply,
 * assert the file actually changed, run the audit, expect it to FAIL, restore
 * from those bytes, and assert the file is byte-identical again.
 *
 * - **Assert the mutation applied.** The failure that makes calibration worthless
 *   rather than merely incomplete: a `find` string with the wrong indentation
 *   silently matches nothing, the audit passes because nothing broke, and the
 *   result reads exactly like a check that failed to catch a real defect. Two of
 *   this session's mutations were no-ops for exactly that reason, and one of them
 *   was initially written up as an audit gap.
 * - **Restore from memory, never `git checkout`.** LEARNED 2026-08-13: `git
 *   checkout <file>` restores from the INDEX, so it discards uncommitted work
 *   along with the probe. Three files of finished work went that way. In-memory
 *   restore cannot touch anything the harness did not write.
 * - **Assert green before starting and green at the end.** Same entry: probes run
 *   against an already-broken tree dutifully report FAIL and calibrate nothing.
 *   A run that begins red is aborted rather than reported.
 * - **Restore in a `finally`, and on a signal.** A harness that leaves the tree
 *   mutated after Ctrl-C is a worse hazard than the one it is testing.
 *
 * ── What a failure means ───────────────────────────────────────────────────
 *
 * `SURVIVED` — the audit passed with the code broken. Either the check that
 * should cover this does not, or it covers it too loosely. That is a real hole
 * and this exits non-zero for it.
 *
 * `NOT APPLIED` — the mutation's pattern no longer matches the source, usually
 * because the code was legitimately refactored. Fix the mutation; it is asserting
 * nothing until you do.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { MUTATIONS } from './mutations.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const abs = (p) => resolve(root, p);

/** Files this process has written, so a signal can put them back. */
const dirty = new Map();
const restoreAll = () => {
  for (const [path, bytes] of dirty) writeFileSync(path, bytes);
  dirty.clear();
};
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { restoreAll(); process.exit(130); });
}

/** Run an audit. Returns true if it PASSED. */
function auditPasses(audit) {
  try {
    execFileSync('node', [abs(`tests/${audit}`)], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Apply one mutation to a source string.
 *
 * Two forms, because some defects are not a substring swap — a CSS rule moving
 * below another one, for instance, is a delete and an append. `apply` gets the
 * whole file and returns the whole file.
 */
function mutate(src, m) {
  if (m.apply) return m.apply(src);
  if (!src.includes(m.find)) return src;
  return src.replace(m.find, m.replace);
}

const only = process.argv[2];
const list = only
  ? MUTATIONS.filter((m) => m.audit.includes(only) || m.file.includes(only))
  : MUTATIONS;

if (!list.length) {
  console.error(`no mutations match '${only}'`);
  console.error(`audits: ${[...new Set(MUTATIONS.map((m) => m.audit))].join(', ')}`);
  process.exit(1);
}

// ── the tree must be green before any of this means anything ───────────────
const audits = [...new Set(list.map((m) => m.audit))];
console.log(`\nmutation harness — ${list.length} mutations over ${audits.length} audit(s)\n`);
for (const a of audits) {
  if (!auditPasses(a)) {
    console.error(`  ABORT  ${a} is already failing — every probe below would be`);
    console.error('         meaningless, because a red tree makes a mutation unfalsifiable.');
    process.exit(1);
  }
}
console.log('  baseline green\n');

let survived = 0, notApplied = 0, caught = 0;
try {
  for (const m of list) {
    const path = abs(m.file);
    const original = readFileSync(path, 'utf8');
    const mutated = mutate(original, m);

    if (mutated === original) {
      console.error(`  NOT APPLIED  ${m.name}`);
      console.error(`               pattern no longer matches ${m.file} — asserting nothing`);
      notApplied++;
      continue;
    }

    dirty.set(path, original);
    writeFileSync(path, mutated);
    const passed = auditPasses(m.audit);
    writeFileSync(path, original);
    dirty.delete(path);

    // Byte-identical, checked rather than assumed. A restore that quietly did
    // not happen would leave every later probe running against broken code.
    if (readFileSync(path, 'utf8') !== original) {
      console.error(`  FATAL  could not restore ${m.file} — stopping before more damage`);
      process.exit(2);
    }

    if (passed) {
      console.error(`  SURVIVED     ${m.name}`);
      console.error(`               ${m.why}`);
      survived++;
    } else {
      console.log(`  caught       ${m.name}`);
      caught++;
    }
  }
} finally {
  restoreAll();
}

// ── and green again, or the restores did not work ──────────────────────────
for (const a of audits) {
  if (!auditPasses(a)) {
    console.error(`\n  FATAL  ${a} is red after restoring — the tree is not as it was.`);
    process.exit(2);
  }
}

const bad = survived + notApplied;
console.log(`\n  ${caught}/${list.length} caught, tree restored and green`);
if (survived) console.log(`  ${survived} survived — those audits have a hole`);
if (notApplied) console.log(`  ${notApplied} did not apply — those mutations need updating`);
console.log(bad === 0 ? '\n✅ every mutation was caught\n' : `\n❌ ${bad} mutation(s) need attention\n`);
process.exit(bad ? 1 : 0);
