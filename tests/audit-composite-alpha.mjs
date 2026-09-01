/**
 * A composite's OUTPUT ALPHA must describe the composite, not one of its inputs.
 *
 * This class has now cost two incidents. Both have the same shape: a channel
 * that is a CONSTANT for every source anyone has tried, read by a consumer that
 * therefore never had to distinguish it from anything else — until a new source
 * makes it vary.
 *
 *   2026-07-31  SDF packed depth into alpha, which had been a constant 1.0.
 *               That enabled NormalBlending's src.a multiply and deleted the
 *               background aura.
 *   2026-09-01  The keyer's emissive branch emitted `fg.a` as the composite's
 *               alpha. Correct-looking while every foreground was opaque, since
 *               fg.a was 1 and "the fg's coverage" and "the result's coverage"
 *               were the same number. The 3D scene's Transparent BG made fg.a
 *               real, so outside the object the whole frame reported alpha 0
 *               and the BACKGROUND vanished — which reads as the background
 *               being keyed out rather than as a compositing bug.
 *
 * The invariant: over an opaque background the result is opaque, whatever the
 * foreground's coverage. That is what a background IS.
 *
 * Checked behaviourally — the formula is lifted out of the shader source and
 * evaluated — rather than by matching the spelling, because the construct an
 * audit forbids is exactly the construct its own comment has to name, and a
 * regex would match this file's own prose. Comments are stripped first for the
 * same reason (LEARNED 2026-08-12 / 2026-08-14, paid for twice already).
 */
import { KEYER } from '../src/shaders/index.js';

let fail = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (cond) console.log(`  ok   ${msg}`);
  else { console.error(`  FAIL ${msg}`); fail++; }
};

/** Blank comments so a check reads the source, not the argument for it. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/\/\/[^\n]*/g, m => m.replace(/[^\n]/g, ' '));
}

console.log('\nThe sanitizer is load-bearing, so calibrate it first');
{
  const probe = 'a // fg.a hidden in a comment\nb /* fg.a too */ c';
  const clean = stripComments(probe);
  ok(!/fg\.a/.test(clean), 'a mention of fg.a inside comments is blanked');
  ok(/\ba\b/.test(clean) && /\bb\b/.test(clean) && /\bc\b/.test(clean),
     'real code either side survives');
  ok(clean.split('\n').length === probe.split('\n').length, 'line count is preserved');
}

const src = stripComments(KEYER);

console.log('\nThe emissive composite');

// Pull the alpha term out of `vec4(<rgb>, <alpha>)` in the emissive branch.
const m = /uAlphaEmissive\s*==\s*1[\s\S]{0,200}?\?\s*vec4\(([\s\S]*?)\)\s*:/.exec(src);
ok(!!m, 'the emissive branch is still a vec4(...) — the shape this audit reads');

if (m) {
  // Split on the LAST top-level comma: the alpha component.
  const args = m[1];
  let depth = 0, cut = -1;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ',' && depth === 0) cut = i;
  }
  const alphaTerm = cut === -1 ? args : args.slice(cut + 1).trim();
  console.log(`  ..   alpha term reads: ${alphaTerm}`);

  ok(/\bbg\s*\.\s*a\b/.test(alphaTerm),
     'the output alpha depends on the BACKGROUND\'s alpha, not only the foreground\'s');

  // Evaluate it. Anything that ignores bg.a fails the opaque-background case.
  const evalAlpha = (fgA, bgA) => {
    const expr = alphaTerm
      .replace(/\bfg\s*\.\s*a\b/g, `(${fgA})`)
      .replace(/\bbg\s*\.\s*a\b/g, `(${bgA})`);
    if (!/^[-+*/(). \d]+$/.test(expr)) return NaN;   // refuse anything unexpected
    return Function(`"use strict";return (${expr});`)();
  };

  const cases = [
    ['an opaque foreground over an opaque background', 1,   1,   1],
    ['NOTHING of the foreground, over an opaque background', 0, 1, 1],
    ['half coverage over an opaque background',        0.5, 1,   1],
    ['a glyph edge over an opaque background',         0.3, 1,   1],
  ];
  let worst = 0;
  for (const [, fgA, bgA, want] of cases) {
    const got = evalAlpha(fgA, bgA);
    worst = Math.max(worst, Math.abs(got - want));
  }
  ok(worst < 1e-9,
     `over an OPAQUE background the result is opaque at every coverage ` +
     `(worst error ${worst.toExponential(2)} across ${cases.length} cases)`);

  // And it must still be a real composite, not a hardcoded 1.0.
  const nested = evalAlpha(0.5, 0.5);
  ok(Math.abs(nested - 0.75) < 1e-9,
     `two transparent layers still combine rather than clamping to opaque ` +
     `(0.5 over 0.5 → ${Number.isNaN(nested) ? 'NaN' : nested.toFixed(3)}, expected 0.750)`);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${checks - fail}/${checks} checks\n`);
process.exit(fail === 0 ? 0 : 1);
