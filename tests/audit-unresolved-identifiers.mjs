/**
 * Static audit: no identifier in src/core/ may reference a name that is
 * declared nowhere.
 *
 * Why this exists. Pipeline.render() passed `uTexture: interlaced` to the
 * master fade pass for an unknown length of time, and `interlaced` was declared
 * nowhere in the file — leftover from the refactor that moved interlace out of
 * a fixed pass and into _FX.interlace, last in DEFAULT_FX_ORDER. In a
 * strict-mode ES module an undeclared identifier is a ReferenceError, so every
 * frame that reached that line threw inside the render loop. Not a wrong
 * picture — a dead instrument, mid-set, until reload.
 *
 * It survived because it sat behind a default-valued guard. output.fade is
 * registered with value 0, so `fadeAmt = 1 - 0/100` is exactly 1 and the
 * `fadeAmt < 1` branch never opened. Nothing reached it: not npm test, not the
 * hooks, not manual use, not the owner playing the instrument. It only fires
 * when Fade goes above 0 — by slider, controller, Display State recall, or a
 * loaded .imweb project — which is to say, in performance.
 *
 * That is the general shape this audit guards, not the single instance:
 * a dead reference parked behind a condition that is false at rest. JavaScript
 * gives no compile step to catch it and the project has no type checker, so
 * the invariant has to be asserted statically here.
 *
 * Scope is src/core/ deliberately. The lexer below is regex-based — there is no
 * parser dependency in this project — and it is exact on these files but not on
 * src/main.js, whose density of string literals, CSS fragments and inline GLSL
 * produces hundreds of false positives. A noisy audit gets switched off, which
 * is worse than no audit. Extending coverage means adding a real parser, not
 * loosening this one. Calibrated at 0 findings on both files; verified to
 * report exactly `interlaced` when the fix is reverted.
 *
 * Run:  node tests/audit-unresolved-identifiers.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CORE = resolve(root, 'src/core');

const KEYWORDS = new Set(
  ('break case catch class const continue debugger default delete do else export extends ' +
   'finally for function if import in instanceof let new return super switch this throw try ' +
   'typeof var void while with yield await async of static get set true false null undefined ' +
   'constructor from as').split(' '));

// Globals legitimately reachable from a module in this app.
const GLOBALS = new Set(
  ('Math JSON Object Array String Number Boolean Promise Map Set WeakMap WeakSet Date Error ' +
   'TypeError RangeError Symbol Proxy Reflect BigInt RegExp Function Infinity NaN globalThis ' +
   'console window document navigator performance location history localStorage sessionStorage ' +
   'requestAnimationFrame cancelAnimationFrame setTimeout clearTimeout setInterval clearInterval ' +
   'queueMicrotask structuredClone fetch URL URLSearchParams Blob File FileReader FormData ' +
   'AbortController AbortSignal DOMParser TextEncoder TextDecoder indexedDB crypto caches ' +
   'AudioContext OfflineAudioContext CustomEvent Event MouseEvent PointerEvent KeyboardEvent ' +
   'ResizeObserver IntersectionObserver MutationObserver Worker MessageChannel ' +
   'Float32Array Float64Array Uint8Array Uint8ClampedArray Uint16Array Uint32Array Int8Array ' +
   'Int16Array Int32Array ArrayBuffer SharedArrayBuffer DataView ' +
   'Image ImageData ImageBitmap OffscreenCanvas HTMLCanvasElement HTMLVideoElement ' +
   'HTMLImageElement HTMLInputElement HTMLElement Element Node ' +
   'isNaN isFinite parseFloat parseInt encodeURIComponent decodeURIComponent ' +
   'encodeURI decodeURI alert confirm prompt').split(' '));

/** Strip comments, then string and template literals. Order matters. */
function delint(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
    .replace(/`(?:\\.|\$\{[^}]*\}|[^`\\])*`/g, '``')
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""');
}

function declaredNames(s) {
  const out = new Set();
  const add = (t) => t.split(/[^A-Za-z_$0-9]+/).filter(Boolean).forEach((x) => out.add(x));
  for (const m of s.matchAll(/\bimport\s+([\s\S]*?)\s+from\b/g)) add(m[1]);
  for (const m of s.matchAll(/\b(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of s.matchAll(/\b(?:function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of s.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of s.matchAll(/\bfor\s*\(\s*(?:const|let|var)\s+(\{[^}]*\}|\[[^\]]*\]|[A-Za-z_$][\w$]*)/g)) add(m[1]);
  // class methods: `  name(args) {` at line start
  for (const m of s.matchAll(/^\s+(?:static\s+|async\s+|get\s+|set\s+|\*\s*)*([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) out.add(m[1]);
  // parameter lists and arrow params
  for (const m of s.matchAll(/(?:^|[\s,({=;])([A-Za-z_$][\w$]*)\s*\(([^()]*)\)\s*(?:=>|\{)/gm)) add(m[2]);
  for (const m of s.matchAll(/\(([^()]*)\)\s*=>/g)) add(m[1]);
  for (const m of s.matchAll(/(?:^|[\s,({=;])([A-Za-z_$][\w$]*)\s*=>/gm)) out.add(m[1]);
  return out;
}

function usedNames(s) {
  // Drop member accesses (`a.b`, `a?.b`) and object-literal keys, so only
  // free identifiers remain — those are the ones that must resolve.
  const u = s
    .replace(/\?\.\s*[A-Za-z_$][\w$]*/g, '')
    .replace(/\.\s*[A-Za-z_$][\w$]*/g, '')
    .replace(/([{,]\s*)[A-Za-z_$][\w$]*\s*:/g, '$1');
  return new Set([...u.matchAll(/\b[A-Za-z_$][\w$]*\b/g)].map((m) => m[0]));
}

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const files = readdirSync(CORE).filter((f) => f.endsWith('.js')).sort();
check('src/core contains modules to audit', files.length > 0, 'found none');

for (const file of files) {
  const raw = readFileSync(resolve(CORE, file), 'utf8');
  const s = delint(raw);
  const declared = declaredNames(s);
  const unresolved = [...usedNames(s)]
    .filter((n) => !declared.has(n) && !KEYWORDS.has(n) && !GLOBALS.has(n))
    .sort();

  if (unresolved.length === 0) {
    check(`${file} — every identifier resolves`, true);
    continue;
  }

  // Locate each one so the failure names the line, not just the name.
  const lines = raw.split('\n');
  const where = unresolved.map((n) => {
    const re = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`);
    const i = lines.findIndex((l) => re.test(l) && !/^\s*(\/\/|\*)/.test(l));
    return `${n} (line ${i + 1})`;
  });
  check(`${file} — every identifier resolves`, false, where.join(', '));
}

if (failures) {
  console.error(`
${failures} FAILURE(S)

An identifier above is referenced but declared nowhere in its file. In a
strict-mode ES module that is a ReferenceError the moment the line executes —
and if it sits behind a condition that is false at rest, it will not surface
until someone moves the control that opens it, which for this project means
during a performance.

Fix: either declare it, or replace it with the value actually intended. If it
is a leftover from a refactor, the surrounding comment usually names what
replaced it — Pipeline.js:838 wanted \`postOut\`, the output of the reorderable
FX chain, and said so two lines above.

If the name is a legitimate browser global this audit does not know about, add
it to GLOBALS at the top of this file rather than deleting the check.
`);
} else {
  console.log('\nAll unresolved-identifier checks passed.\n');
}
process.exit(failures ? 1 : 0);
