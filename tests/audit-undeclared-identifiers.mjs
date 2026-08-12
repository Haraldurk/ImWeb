/**
 * Static audit: no expression in Pipeline.js may read an identifier that is
 * declared nowhere in the file.
 *
 * Why this exists. The master Fade pass in render() read a variable named
 * `interlaced` that had not existed since interlace became _FX.interlace and
 * moved into the reorderable chain. The read survived a refactor because it sits
 * behind `if (fadeAmt < 1)`, and `output.fade` is registered with value 0 — so
 * fadeAmt was exactly 1 on every boot and the branch never ran. The file
 * imported clean, built clean, and rendered clean. The first time anyone raised
 * the master Fade above 0 — by hand, by a controller, by a Display State recall
 * or by loading a .imweb project — a strict-mode ES module threw
 * `ReferenceError: interlaced is not defined` inside the render loop, once per
 * frame, and the picture froze on its last good frame.
 *
 * That is the whole shape of the bug class: a stale identifier hidden behind a
 * guard whose default value is the one value that keeps the guard shut. Nothing
 * at author time or build time looks at it, because a free identifier in JS is
 * only an error when it is evaluated.
 *
 * It cannot be a runtime check. render() is the per-frame hot path, and the
 * failure mode being guarded against is precisely an exception in the render
 * loop — adding a throw to catch a throw buys nothing. So the invariant is
 * enforced statically here.
 *
 * Deliberately conservative. Declarations are gathered file-wide rather than
 * per-scope, so a variable declared in a *different* method still counts as
 * declared and will not be reported. That means this audit misses cross-scope
 * leaks; it catches identifiers that exist NOWHERE, which is the case that
 * actually shipped. The trade is intentional: a static check without a real
 * parser that reports even occasional false positives gets weakened or deleted
 * the first time it blocks a legitimate commit, and then it guards nothing. If
 * this ever needs to be scope-exact, add a real parser rather than tightening
 * the regexes.
 *
 * Run:  node tests/audit-undeclared-identifiers.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REL = 'src/core/Pipeline.js';
const raw = readFileSync(resolve(root, REL), 'utf8');

// ── 1. Strip comments and string/template bodies ────────────────────────────
// Identifier-shaped text inside a comment or a GLSL template literal is not a
// read. Replace with same-length blanks so reported line numbers stay true.
const blank = (s) => s.replace(/[^\n]/g, ' ');

let src = raw
  .replace(/\/\*[\s\S]*?\*\//g, blank)          // block comments
  .replace(/(^|[^:])\/\/[^\n]*/g, (m, p) => p + blank(m.slice(p.length)))
  .replace(/`(?:\\[\s\S]|[^\\`])*`/g, blank)    // template literals
  .replace(/'(?:\\[\s\S]|[^\\'])*'/g, blank)    // single-quoted
  .replace(/"(?:\\[\s\S]|[^\\"])*"/g, blank);   // double-quoted

// ── 2. Gather everything that counts as DECLARED, file-wide ─────────────────
// Over-collecting here is safe: it can only suppress a report, never invent one.
const declared = new Set();
const add = (name) => { if (name) declared.add(name); };
const addAll = (text) => {
  for (const m of text.matchAll(/[A-Za-z_$][\w$]*/g)) add(m[0]);
};

// const / let / var, including destructuring patterns up to the initialiser.
for (const m of src.matchAll(/\b(?:const|let|var)\s+([^=;\n]+?)(?:=[^=]|;|\n|\bof\b|\bin\b)/g)) {
  addAll(m[1]);
}
// function declarations & expressions, class names.
for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
// import bindings.
for (const m of src.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) addAll(m[1]);
// catch (e)
for (const m of src.matchAll(/\bcatch\s*\(([^)]*)\)/g)) addAll(m[1]);
// Parameter lists: any (...) immediately followed by `{` (function/method body)
// or `=>` (arrow). Also bare single-identifier arrow params: `x => ...`.
for (const m of src.matchAll(/\(([^()]*)\)\s*(?:=>|\{)/g)) addAll(m[1]);
for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) add(m[1]);
// Labels (`outer:` before a loop) and class field names are never read as free
// identifiers, but adding them costs nothing.
for (const m of src.matchAll(/^\s*([A-Za-z_$][\w$]*)\s*[:=]/gm)) add(m[1]);
// Class method definitions — `render(p) {`, `get lutLoaded() {`, `async foo()`.
// The name is a binding on the class, not a read of a free variable.
for (const m of src.matchAll(
  /^\s*(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?\*?\s*([A-Za-z_$][\w$]*)\s*\(/gm,
)) add(m[1]);

// ── 3. Known globals ────────────────────────────────────────────────────────
const globals = new Set([
  ...Object.getOwnPropertyNames(globalThis),
  // Browser globals Node does not define.
  'window', 'document', 'navigator', 'location', 'history', 'screen',
  'requestAnimationFrame', 'cancelAnimationFrame', 'devicePixelRatio',
  'Image', 'ImageData', 'ImageBitmap', 'createImageBitmap', 'OffscreenCanvas',
  'HTMLCanvasElement', 'HTMLImageElement', 'HTMLVideoElement', 'HTMLElement',
  'WebGLRenderingContext', 'WebGL2RenderingContext', 'WebGLTexture',
  'MediaStream', 'MediaRecorder', 'AudioContext', 'ResizeObserver',
  'IntersectionObserver', 'MutationObserver', 'CustomEvent', 'Event',
  'localStorage', 'sessionStorage', 'indexedDB', 'caches', 'alert',
  'getComputedStyle', 'matchMedia', 'Worker', 'Blob', 'FileReader',
  'XMLHttpRequest', 'DOMMatrix', 'Path2D', 'PointerEvent', 'KeyboardEvent',
]);

// Reserved words and contextual keywords that match the identifier shape.
const keywords = new Set([
  'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'export', 'extends', 'finally', 'for',
  'function', 'if', 'import', 'in', 'instanceof', 'new', 'return', 'super',
  'switch', 'this', 'throw', 'try', 'typeof', 'var', 'void', 'while', 'with',
  'yield', 'let', 'static', 'get', 'set', 'of', 'as', 'from', 'async', 'await',
  'true', 'false', 'null', 'undefined', 'constructor',
]);

// ── 4. Find reads of identifiers that are declared nowhere ──────────────────
// A token is a candidate READ unless it is a property access (`.x`, `?.x`), an
// object-literal key or label (`x:`), or a declaration/keyword/global. Tokens
// followed by `:` are skipped wholesale — that also skips the middle arm of a
// ternary, which is a deliberate miss in exchange for no false positives on
// every `{ uTexture: ... }` uniform bag in the file.
const findings = [];
const lineStarts = [];
for (let i = 0, n = 0; i <= src.length; i++) {
  if (i === 0 || src[i - 1] === '\n') lineStarts.push(i), n++;
}
const lineOf = (idx) => {
  let lo = 0, hi = lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineStarts[mid] <= idx) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
};

for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) {
  const name = m[0];
  const at = m.index;
  if (keywords.has(name) || globals.has(name) || declared.has(name)) continue;

  // Property access: preceded by `.` (covers `?.` too).
  const before = src.slice(Math.max(0, at - 2), at);
  if (/\.\s*$/.test(before)) continue;

  // Tail of a numeric literal, not an identifier: the `x3c00` of `0x3c00`, the
  // `e5` of `1e5`, the `b1010` of `0b1010`.
  if (/[0-9]$/.test(before)) continue;

  // Object-literal key / label: followed by `:` (but not `::`).
  const after = src.slice(at + name.length, at + name.length + 3);
  if (/^\s*:/.test(after)) continue;

  findings.push({ name, line: lineOf(at) });
}

// ── 5. Report ───────────────────────────────────────────────────────────────
const seen = new Map();
for (const f of findings) {
  if (!seen.has(f.name)) seen.set(f.name, []);
  seen.get(f.name).push(f.line);
}

console.log(`${REL}: ${declared.size} declared name(s) in scope-insensitive index`);
console.log(`free identifier reads with no declaration anywhere: ${seen.size}`);

if (seen.size) {
  console.error(`\nFAIL — ${seen.size} identifier(s) read but declared nowhere in ${REL}:`);
  for (const [name, lines] of seen) {
    console.error(`  ${name}  — line(s) ${lines.join(', ')}`);
  }
  console.error(
    '\nEach of these throws ReferenceError the moment its line is evaluated, and\n' +
    'this file is the render loop. If the name is a leftover from a refactor,\n' +
    'point it at the value that replaced it — usually the variable the enclosing\n' +
    'statement already assigns on the line above. If it is a legitimate global,\n' +
    'add it to the `globals` set in this audit with a note saying why.\n' +
    '\nDo NOT silence this by initialising a dead variable: a guard whose default\n' +
    'value keeps it shut is exactly how the original bug stayed invisible.',
  );
  process.exit(1);
}

console.log('\nAll undeclared-identifier checks passed.\n');
process.exit(0);
