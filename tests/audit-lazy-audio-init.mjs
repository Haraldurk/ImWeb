/**
 * Static audit: a feature that CONSUMES the analyser tap must also ASK for it.
 *
 * Why this exists. `ctrl.sound` — the object holding freqBuf/level/bass/mid/
 * high — does not exist until `ControllerManager._addController` lazily calls
 * `enableSound()`, and it only does that when a sound-TYPE controller is
 * assigned to some parameter. That was fine while the sound controllers were
 * the only consumer: assigning one was both the request and the use.
 *
 * The Text layer's per-glyph audio broke that assumption. `text.audioTarget`
 * is a plain parameter, not a controller assignment, so switching it on never
 * reached the lazy init. The feature shipped **silently inert in its obvious
 * usage**: turn it on, nothing moves, nothing warns, and every unit check
 * still passes because the layer treats "no audio" as silence by design —
 * correctly, which is what made it invisible.
 *
 * The general rule, and the reason this is worth a script rather than a note:
 * **a lazily-initialised resource has exactly one trigger, and every new
 * consumer is a new caller that trigger does not know about.** Reading the
 * resource is not the same as requesting it, and nothing about reading it
 * fails when the request was never made.
 *
 * Run:  node tests/audit-lazy-audio-init.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

// Comments first: this file's own prose names every symbol it looks for, and a
// source-text check that does not strip comments fails on CORRECT code — a
// mistake this repo has now paid for twice (LEARNED 2026-08-14).
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const main = strip(read('src/main.js'));
const cm   = strip(read('src/controls/ControllerManager.js'));

console.log('\nLazy audio-init audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.error(`  FAIL ${m}`); failed = true; };
const check = (m, cond) => (cond ? ok(m) : fail(m));

// ── The premise: the tap really is lazy ─────────────────────────────────────
// If this stops being true the audit is measuring nothing, so it is asserted
// rather than assumed.

check('enableSound() still exists to be called',
  /\basync\s+enableSound\s*\(/.test(cm));
check('ctrl.sound is still gated behind it (it returns early when already up)',
  /enableSound\s*\([^)]*\)\s*\{[\s\S]{0,200}?if\s*\(\s*this\.sound\s*\)\s*return/.test(cm));
check('the only lazy trigger is still a controller assignment',
  /'sound'[\s\S]{0,160}?this\.enableSound\(\)/.test(cm));

// ── Every consumer outside that trigger must ask ────────────────────────────
// Derived, not enumerated: whatever reads ctrl.sound in main.js is a consumer,
// and an enumeration can only pass while it is complete (LEARNED 2026-08-15).

const consumers = [...main.matchAll(/ctrl\.sound\b/g)].length;
check('main.js does read ctrl.sound (the audit has a subject)', consumers > 0);
check(`main.js asks for the tap as well as reading it (${consumers} read site(s))`,
  /\bctrl\.enableSound\s*\(/.test(main));

// The Text layer is the consumer that is NOT a controller assignment, so its
// request has to hang off its own parameter or a saved project that arrives
// with the feature already on would come up dead.
// The wiring may be an inline body or a named helper shared with the other
// edge — either is fine, and the check follows both rather than dictating one.
// Pinning the shape would fail correct code the next time it is refactored,
// which is the expensive direction (LEARNED 2026-08-14).
const armHelper = /const\s+_armTextAudio\s*=\s*\(\)\s*=>\s*\{([\s\S]{0,240}?)\}/.exec(main);
const targetOn  = /ps\.get\(\s*["']text\.audioTarget["']\s*\)\s*\.onChange\(([\s\S]{0,200}?)\)\s*;/
  .exec(main);
// Whichever of the two actually contains the request is the body to judge.
const armBody = armHelper && /\bctrl\.enableSound\s*\(/.test(armHelper[1]) ? armHelper[1]
              : targetOn  && /\bctrl\.enableSound\s*\(/.test(targetOn[1])  ? targetOn[1]
              : null;

check('text.audioTarget has an onChange (so state recall reaches it too)',
  !!targetOn);
check('…and that onChange reaches the tap request',
  !!targetOn && !!armBody &&
  (/\bctrl\.enableSound\s*\(/.test(targetOn[1]) || /_armTextAudio/.test(targetOn[1])));
check('…and it only opens it when the feature is actually on',
  !!armBody && /[><]\s*0|\bOff\b|!==\s*0/.test(armBody));

// BOTH edges. enableSound() gives up quietly when the engine is not running
// and nothing retries it, so arming the feature BEFORE starting the engine
// left it dead until the target was touched again — a state that is
// indistinguishable from the feature not working at all.
check('the engine coming up also opens the tap',
  /ps\.get\(\s*["']audio\.enable["']\s*\)\s*\.onChange\(/.test(main));
check('…through the same guarded helper, not a second copy of the rule',
  !!armHelper && /\bctrl\.enableSound\s*\(/.test(armHelper[1])
              && /audioTarget/.test(armHelper[1]));

// The layer must still treat an absent tap as silence rather than an error —
// the request can legitimately fail (engine not running, no device).
check('TextLayer still tolerates a null audio picture',
  /setAudio\s*\(\s*a\s*\)\s*\{[^}]*\|\|\s*null/.test(strip(read('src/inputs/TextLayer.js'))));

// ── Positive controls ───────────────────────────────────────────────────────
// Proving the detector can fail, since every live site now passes.
{
  const detect = (src) => /\bctrl\.enableSound\s*\(/.test(strip(src));
  check('detector flags a main.js that reads the tap without asking',
    !detect('textLayer.setAudio(ctrl.sound ?? null);'));
  check('detector accepts one that asks',
    detect('ps.get("text.audioTarget").onChange(v => { if (v > 0) ctrl.enableSound(); });'));
  check('detector is not fooled by the request appearing only in a comment',
    !detect('// call ctrl.enableSound() here one day\ntextLayer.setAudio(ctrl.sound);'));
}

if (failed) {
  console.error('\nFAIL — something consumes the analyser tap without opening it.\n'
    + 'Reading a lazily-initialised resource is not the same as requesting it,\n'
    + 'and nothing about the read fails when the request was never made.\n');
  process.exit(1);
}
console.log('\nEvery analyser-tap consumer asks for the tap.\n');
