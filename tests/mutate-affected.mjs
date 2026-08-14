/**
 * Which calibrated audits does a set of changed files affect? — the CI half of
 * `npm run mutate`.
 *
 * The full mutation run calibrates every registered audit and grows linearly
 * with the registry; a run people wait ten minutes for is a run they stop
 * making. But calibration only needs to re-prove the audits whose code MOVED.
 * This maps a PR's changed file list to the audits with mutations against
 * those files, so CI runs exactly those slices and nothing else.
 *
 * Usage: node tests/mutate-affected.mjs <changed-file> [...]
 * Prints the affected audit names, one per line. Empty output = nothing to
 * calibrate. Exit 0 always — "no audit affected" is an answer, not an error.
 *
 * A change to the harness itself (this file, mutate.mjs, mutations.mjs)
 * affects EVERY audit: the registry is the claim, and editing the claim
 * re-opens every proof.
 */

import { MUTATIONS } from './mutations.mjs';

const HARNESS_FILES = new Set([
  'tests/mutate.mjs',
  'tests/mutations.mjs',
  'tests/mutate-affected.mjs',
]);

const changed = process.argv.slice(2);

const all = [...new Set(MUTATIONS.map((m) => m.audit))];
const affected =
  changed.some((f) => HARNESS_FILES.has(f))
    ? all
    : [
        ...new Set(
          MUTATIONS.filter(
            (m) =>
              changed.includes(m.file) || changed.includes(`tests/${m.audit}`)
          ).map((m) => m.audit)
        ),
      ];

for (const a of affected) console.log(a);
