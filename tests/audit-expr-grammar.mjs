/**
 * Expression-grammar audit (#33).
 *
 * Why this exists. Expression controllers were compiled with `new Function`,
 * whose grammar is OPEN: it accepts any JS expression, including an IIFE
 * containing a loop — `(() => { while (true) {} })()` compiles fine and hangs
 * the render loop at evaluation time, where the tick's try/catch cannot see a
 * hang. Expression text rides in saved .imweb projects, so the wedge arrives
 * from outside. The fix compiles to a bounded instruction list instead: a
 * closed grammar (one variable, fourteen helpers, plus the superset of
 * ternaries / comparisons / Math.* that existing projects may use), rejected
 * at compile time with the last good expression kept.
 *
 * Two directions matter, and both are checked against the REAL compiler:
 *   - everything the documented vocabulary (and its superset) can express
 *     must still compile AND evaluate to the same numbers as before
 *   - the wedge shapes — loops, statements, allocation literals, unknown
 *     names, unwhitelisted calls — must fail at compile time
 *
 * A static check on ControllerManager.js guards the boundary itself: if
 * `new Function` ever returns to the expression path, this fails even if the
 * behavioural corpus still passes.
 *
 * Run:  node tests/audit-expr-grammar.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { compileExpression } from '../src/controls/ExprCompiler.js';
import { sanitizeSource, calibrateSanitizer } from './lib/sanitize-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── 1. Accepted vocabulary evaluates to the same numbers as before ──────────
// Expected values are what the old `new Function` path produced — plain JS
// semantics with the fourteen helpers in scope.
console.log('\naccepted expressions keep their values');

const EPS = 1e-12;
const accept = [
  // [source, t, expected]
  ['sin(t)',                         Math.PI / 2, 1],
  ['cos(t)',                         0, 1],
  ['tan(t)',                         Math.PI / 4, 1],
  ['abs(t)',                         -3, 3],
  ['floor(t)',                       2.7, 2],
  ['ceil(t)',                        2.1, 3],
  ['round(t)',                       2.5, 3],
  ['mod(t, 1)',                      -0.5, 0.5],        // helper mod is floored, unlike %
  ['fract(t)',                       2.25, 0.25],
  ['clamp(t, 0, 1)',                 5, 1],
  ['mix(t, 8, 0.5)',                 2, 5],
  ['pow(t, 3)',                      2, 8],
  ['sqrt(t)',                        9, 3],
  ['t * 2 + 1',                      3, 7],
  ['(t + 1) * 2',                    3, 8],
  ['-t**2',                          3, -9],            // JS: -(t**2), not (-t)**2
  ['2**3**2',                        0, 512],           // right-associative
  ['t % 2',                          5, 1],
  ['t > 1 ? 2 : 3',                  2, 2],
  ['t > 1 ? 2 : 3',                  0.5, 3],
  ['t >= 1 ? t < 2 ? 10 : 20 : 30',  1.5, 10],          // nested ternary
  ['t >= 1 ? t < 2 ? 10 : 20 : 30',  5, 20],
  ['t >= 1 ? t < 2 ? 10 : 20 : 30',  0, 30],
  ['t < 1',                          0.5, 1],           // comparisons coerce to 1/0
  ['t == 2',                         2, 1],
  ['t != 2',                         2, 0],
  ['!t',                             0, 1],
  ['!t',                             4, 0],
  ['t && 5',                         0, 0],             // JS operand semantics
  ['t && 5',                         2, 5],
  ['t || 5',                         0, 5],
  ['t || 5',                         2, 2],
  ['Math.PI * t',                    2, Math.PI * 2],
  ['Math.E',                         0, Math.E],
  ['Math.SQRT2',                     0, Math.SQRT2],
  ['Math.max(t, 10)',                3, 10],
  ['Math.min(t, 10)',                3, 3],
  ['Math.atan2(t, 1)',               1, Math.PI / 4],
  ['pow(abs(sin(t)), 2) + pow(cos(t), 2)', 0.7, 1],     // the identity, end to end
  ['1e3 * t',                        2, 2000],          // exponent number syntax
  ['.5 + t',                         0.5, 1],           // leading-dot number
];

for (const [src, t, expected] of accept) {
  let got;
  try { got = compileExpression(src)(t); }
  catch (e) { check(`'${src}' compiles`, false, e.message); continue; }
  check(`'${src}' at t=${t} → ${expected}`,
    Math.abs(got - expected) < EPS || (Number.isNaN(expected) && Number.isNaN(got)),
    `got ${got}`);
}

// noise() is the one nondeterministic helper — check range, not value.
{
  let okRange = true;
  const fn = compileExpression('noise()');
  for (let i = 0; i < 1000; i++) {
    const v = fn(0);
    if (!(v >= 0 && v < 1)) okRange = false;
  }
  check('noise() stays in [0, 1)', okRange);
}

// ── 2. The wedge shapes fail at COMPILE time ────────────────────────────────
// Every one of these compiled cleanly under `new Function`. The first two are
// the verified hangs from the issue; the rest are the same open grammar —
// statements, allocation literals, member access, unknown names, bad calls.
console.log('\nwedge shapes are rejected at compile time');

const reject = [
  '(() => { while (true) {} })()',      // the hang — verified COMPILES under new Function
  '(() => { let a=[]; while(1) a.push(1); })()', // the unbounded allocation
  'while (true) {}',
  't = 1',                              // assignment is a statement-level act
  't++',
  't += 1',
  '[1, 2][0]',                          // array literal + member access
  '({a: 1}).a',                         // object literal
  't => t',                             // arrow function
  '(sin)(t)',                           // indirect call — callee must be a whitelisted name
  'new Function("x")',
  'window.location',
  'globalThis',
  'x',                                  // unknown identifier
  'sin',                                // bare function reference
  'Math',                               // bare namespace
  'Math.foo(t)',                        // unwhitelisted Math member
  'Math.random.constructor',
  'sin()',                              // wrong arity
  'clamp(1, 2)',
  '"string"',
  '`template`',
  't; 1',                               // second statement
  'sin(t',                              // unterminated — still an error, still caught
  '',
];

for (const src of reject) {
  let threw = false;
  try { compileExpression(src); } catch { threw = true; }
  check(`rejects ${JSON.stringify(src)}`, threw,
    'compiled — the grammar is open again');
}

// ── 3. The boundary itself: no `new Function` in the expression path ────────
console.log('\nthe open grammar is gone from the source');

calibrateSanitizer(check);

const cmRaw = readFileSync(resolve(root, 'src/controls/ControllerManager.js'), 'utf8');
const cm = sanitizeSource(cmRaw);                       // code only
const cmCode = sanitizeSource(cmRaw, { blankStrings: false }); // comments gone, strings kept

check('ControllerManager no longer uses new Function', !/new Function\s*\(/.test(cm),
  'if this fails the compile-time rejection above is bypassed');
// This one needs the string literal, so it reads the strings-kept view.
check('ControllerManager imports the bounded compiler',
  /import\s*\{\s*compileExpression\s*\}\s*from\s*'\.\/ExprCompiler\.js'/.test(cmCode));

// Last-good behaviour: a failed compile must not clear the previous entry.
// The guard lives in ControllerManager's catch — assert it still only writes
// exprs.set inside the try.
check('exprs.set stays inside the try (last-good on failure)',
  /try\s*\{[\s\S]*?exprs\.set[\s\S]*?\}\s*catch/.test(cm),
  'moving exprs.set out of the try would break last-good');

if (failures) {
  console.error(
    '\nThe rule: expression text is DATA, not code. It compiles to a bounded\n' +
    'instruction list or it does not run at all — "accept what we cannot parse\n' +
    'and guard the rest" is exactly the design that made the wedge possible.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll expression-grammar checks passed.\n');
process.exit(failures ? 1 : 0);
