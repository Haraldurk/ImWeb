/**
 * Pixel-ratio audit.
 *
 * Why this exists. `renderer.setPixelRatio(1)` in main.js is a deliberate
 * performance decision with a long comment attached: on a Retina display DPR = 2
 * doubles every dimension, which quadruples fill cost across 35+ shader passes
 * for no perceptible gain on moving video, and DPR = 1 is what buys 60 fps.
 *
 * `_onDPRChange()` — the handler that exists to notice a window moving to a
 * display of a different pixel density — then called
 * `renderer.setPixelRatio(window.devicePixelRatio)`, which undid that decision
 * PERMANENTLY on the first display change of the session. Nothing ever put the
 * ratio back. Drag the window to a Retina screen once and the instrument got
 * four times more expensive to draw and stayed that way for the rest of the
 * session, across every reload of the patch but not of the page.
 *
 * Nothing errors and nothing looks wrong. The picture is IDENTICAL — that is the
 * whole argument for DPR = 1 — so the only symptom is that the instrument became
 * slower at some point that no longer correlates with anything the user did to
 * it. It was found from the outside, by reading frame timestamps out of four
 * real recordings: the one file at 2646×1766 (= 1323×883 CSS at DPR 2, the only
 * DPR-2 file in the set) ran at 19 fps against 30 fps for DPR-1 files at half
 * the pixels. See docs/Recorder-Frame-Rate-Investigation.md.
 *
 * This cannot be a runtime check, for the same reason it went unnoticed: at the
 * moment `setPixelRatio` is called, a 2 is a perfectly legal ratio and the
 * renderer has no way to know it contradicts a decision made elsewhere. The
 * invariant is "the project has exactly one pixel-ratio policy", which is a
 * property of the source, not of any single call.
 *
 * The check is a source-text census, so it MUST run against sanitized source.
 * The fix's own comment quotes `setPixelRatio(window.devicePixelRatio)` while
 * explaining why it is gone, and a naive scan would fail on the corrected file —
 * the exact trap recorded in LEARNED (2026-08-12) and the reason
 * tests/lib/sanitize-source.mjs is shared rather than copied.
 *
 * Run:  node tests/audit-pixel-ratio.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';
import { sanitizeSource, calibrateSanitizer } from './lib/sanitize-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); failures++; }
};

console.log('\nPixel-ratio audit\n');

// ── 0. Calibrate the sanitizer before trusting anything it feeds ────────────
// A sanitizer that blanked too much would make every census below vacuously
// true, and that failure mode is silence.
console.log('Sanitizer calibration:');
calibrateSanitizer(check);

// ── 1. Every setPixelRatio call in src/ passes the literal 1 ───────────────
console.log('\nsetPixelRatio call sites:');

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.js')) out.push(p);
  }
  return out;
}

const calls = [];
for (const file of walk(join(root, 'src'))) {
  const clean = sanitizeSource(readFileSync(file, 'utf8'));
  const lines = clean.split('\n');
  lines.forEach((line, i) => {
    const m = line.match(/setPixelRatio\s*\(([^)]*)\)/);
    if (m) calls.push({ file: relative(root, file), line: i + 1, arg: m[1].trim() });
  });
}

check(
  'at least one setPixelRatio call exists',
  calls.length > 0,
  'the census found nothing — either the sanitizer is over-blanking or the\n' +
  '       renderer setup moved, and this audit is no longer watching anything.',
);

for (const c of calls) {
  check(
    `${c.file}:${c.line} passes the literal 1 (got \`${c.arg}\`)`,
    c.arg === '1',
    'FIX: the project renders at logical CSS pixels on purpose. Adopting\n' +
    '       window.devicePixelRatio here quadruples fill cost on a Retina\n' +
    '       display, silently and permanently — the picture is identical, so\n' +
    '       there is no symptom but a slower instrument. If a variable ratio is\n' +
    '       genuinely wanted, it needs a param and a way back, not a bare read.',
  );
}

// ── 2. The DPR handler still does the two things it is actually for ────────
// Pinning the ratio would be easy to "achieve" by deleting the handler, which
// would trade this bug for two others: engine targets left stale after a
// display move, and a matchMedia listener that is `{ once: true }` and so never
// fires a second time unless it re-arms itself.
console.log('\n_onDPRChange responsibilities:');

const mainClean = sanitizeSource(readFileSync(join(root, 'src/main.js'), 'utf8'));
const handler = mainClean.match(/function\s+_onDPRChange\s*\(\)\s*\{([\s\S]*?)\n  \}/);

check('_onDPRChange still exists in main.js', !!handler,
  'a display change must still resize targets and re-arm its listener.');

if (handler) {
  const body = handler[1];
  check(
    'it re-asserts the pixel ratio',
    /setPixelRatio\s*\(\s*1\s*\)/.test(body),
    'restating the decision at the one place that used to break it is the point.',
  );
  check(
    'it re-syncs every engine through applyResolution',
    /applyResolution\s*\(/.test(body),
    'a display move changes the container box; the render targets must follow.',
  );
  check(
    're-arms its own matchMedia listener',
    // The event name is not matched: sanitizeSource blanks string BODIES, so
    // `'change'` reaches this check as `'      '`. Anchor on the handler
    // identity instead, which is the part that carries the meaning anyway.
    /matchMedia[\s\S]*addEventListener\s*\(\s*'[^']*'\s*,\s*_onDPRChange/.test(body),
    'the listener is { once: true }, so without this a SECOND display change\n' +
    '       is never noticed at all.',
  );
}

console.log(
  failures ? `\n${failures} FAILURE(S)\n` : '\nAll pixel-ratio checks passed.\n',
);
process.exit(failures ? 1 : 0);
