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

// A source-scanning audit reads prose as well as code, so a check for a
// forbidden construct also matches the comment explaining why it is forbidden —
// and it fails on CORRECT code (LEARNED 2026-08-12). Blank comments, and
// optionally string bodies, before matching. Ranges are blanked in place so
// offsets and line count survive: the multi-line structural check below still
// means what it says.
function sanitizeSource(src, { blankStrings = true } = {}) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const n = src.length;
  let i = 0, prev = '';

  while (i < n) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      blank(i, j); i = j; continue;
    }
    // `/` opens a regex unless the previous significant char could end a value.
    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(prev)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') break;
        if (e === '[') inClass = true;
        else if (e === ']') inClass = false;
        else if (e === '/' && !inClass) { j++; closed = true; break; }
        j++;
      }
      if (closed) {
        while (j < n && /[a-z]/.test(src[j])) j++;      // flags
        if (blankStrings) blank(i + 1, j - 1);
        i = j; prev = ')'; continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;
        j++;
      }
      if (blankStrings) blank(i + 1, j - 1);
      i = j; prev = c; continue;
    }
    if (c === '`') {
      let j = i + 1, segStart = j;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { if (blankStrings) blank(segStart, j); j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          if (blankStrings) blank(segStart, j);
          let k = j + 2, depth = 1;                     // leave ${…} code intact
          while (k < n && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            k++;
          }
          j = k; segStart = j; continue;
        }
        j++;
      }
      i = j; prev = '`'; continue;
    }

    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

// Calibrate the sanitizer before trusting it. A sanitizer that blanks too much
// makes every forbidden-construct check below vacuously true — the failure mode
// is silence, so it has to be proven to hide prose AND expose code.
const FIXTURE = [
  '// a comment warning that new Function( must never come back',
  '/* block comment: new Function( */',
  "const s = 'new Function(';",
  'const re = /new Function\\(/;',
  'const t = `new Function(`;',
  'const u = `${ realCall() }`;',
  'legit();',
].join('\n');
const clean = sanitizeSource(FIXTURE);
check('sanitizer hides new Function( in comments, strings, regex and templates',
  !/new Function\s*\(/.test(clean), 'a live match here means prose still leaks in');
check('sanitizer leaves real code intact',
  /legit\(\)/.test(clean) && /realCall\(\)/.test(clean),
  'blanking code would make every check below vacuous');
check('sanitizer preserves line count',
  clean.split('\n').length === FIXTURE.split('\n').length,
  'the multi-line try/catch check depends on offsets surviving');

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
