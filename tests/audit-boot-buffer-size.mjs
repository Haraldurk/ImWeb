/**
 * Boot buffer size audit.
 *
 * Why this exists. The working size handed to the buffer engines at startup
 * must never be zero, because two of them can never recover from it.
 *
 * `VideoDelayLine` and `TimeDisplaceEngine` both make `resize()` a deliberate
 * no-op, so that a display-resolution change cannot wipe their history. The
 * consequence is that they take their working size EXACTLY ONCE, from the
 * `W`/`H` computed at boot, and only ever reallocate from a
 * `bufferResolution` change — which fires on CHANGE, so it never fires at
 * startup.
 *
 * `W` came straight from `canvas.parentElement.clientWidth`, which is 0
 * whenever the page runs before layout has produced a box: a tab that boots in
 * the background, a `display:none` container, a frame that has not been shown.
 * The rings were then allocated 0x0 and stayed that way for the whole session.
 *
 * Nothing errors. `capture()` and `getTexture()` both keep working against
 * zero-sized targets, so the Delay source renders nothing and the only symptom
 * is an effect that appears not to be implemented — until someone touches
 * Buffer res, which reallocates from real numbers and fixes it by accident.
 * That is the worst shape of bug this project has: no error, no warning, and a
 * plausible picture (an empty one) at the end of it.
 *
 * This cannot be a runtime check. The moment to catch it is construction, and
 * at construction a zero is indistinguishable from a container that is
 * genuinely being laid out — there is no later point at which anything knows
 * the buffer is wrong, because a 0x0 target is a legal target.
 *
 * Run:  node tests/audit-boot-buffer-size.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); failures++; }
};

console.log('\nBoot buffer size audit\n');

const mainSrc = readFileSync(join(root, 'src/main.js'), 'utf8');

// ── 1. The boot size must not be a bare clientWidth read ────────────────────
console.log('Boot size derivation:');

const bareRead = /let\s+W\s*=\s*canvas\.parentElement\.clientWidth\s*;/.test(mainSrc);
check(
  'W is not assigned straight from clientWidth',
  !bareRead,
  'FIX: clientWidth is 0 before layout. Fall back to a plausible size —\n' +
  '       VideoDelayLine and TimeDisplaceEngine take this value ONCE and\n' +
  '       never recover from a zero.',
);

const wLine = mainSrc.match(/let\s+W\s*=\s*[^\n]+/)?.[0] ?? '';
const hLine = mainSrc.match(/let\s+H\s*=\s*[^\n]+/)?.[0] ?? '';
check('W initialiser found', wLine.length > 0);
check('H initialiser found', hLine.length > 0);
check(
  'W falls back when the measurement is unusable',
  /_bootSize|\|\||\?\?/.test(wLine),
  `got: ${wLine.trim()}`,
);
check(
  'H falls back when the measurement is unusable',
  /_bootSize|\|\||\?\?/.test(hLine),
  `got: ${hLine.trim()}`,
);

// ── 2. The fallback helper actually rejects every unusable value ────────────
// Re-implemented from the source rather than imported, because main.js cannot
// be loaded outside a browser. Extract the expression and evaluate it.
console.log('\nFallback behaviour:');

const helper = mainSrc.match(/const\s+_bootSize\s*=\s*\(([^)]*)\)\s*=>\s*([^;]+);/);
check('_bootSize helper found in main.js', !!helper);

if (helper) {
  // eslint-disable-next-line no-new-func
  const _bootSize = new Function(helper[1], `return (${helper[2]});`);
  const CASES = [
    ['a real measurement passes through', 959, 1280, 959],
    ['zero falls back',                     0, 1280, 1280],
    ['undefined falls back',        undefined, 1280, 1280],
    ['NaN falls back',                    NaN, 1280, 1280],
    ['negative falls back',               -10, 1280, 1280],
  ];
  for (const [label, input, fallback, want] of CASES) {
    const got = _bootSize(input, fallback);
    check(`${label} (${String(input)} → ${got})`, got === want, `expected ${want}`);
  }
}

// ── 3. The engines that cannot recover are still the ones we think ──────────
// If another engine adopts the no-op resize, it inherits this hazard and
// belongs in the reasoning above. Fail loudly rather than let it go unnoticed.
console.log('\nEngines whose resize() is a deliberate no-op:');

const NOOP_RESIZE = /resize\(_w,\s*_h\)\s*\{\s*\/\*\s*intentionally empty/;
const KNOWN = ['src/inputs/VideoDelayLine.js', 'src/inputs/TimeDisplaceEngine.js'];
for (const rel of KNOWN) {
  check(
    `${rel} still declares a no-op resize`,
    NOOP_RESIZE.test(readFileSync(join(root, rel), 'utf8')),
    'if this engine now follows the canvas, the boot-size hazard no longer\n' +
    '       applies to it and this audit should be updated to say so.',
  );
}

console.log(
  failures ? `\n${failures} FAILURE(S)\n` : '\nAll boot buffer size checks passed.\n',
);
process.exit(failures ? 1 : 0);
