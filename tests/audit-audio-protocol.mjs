/**
 * The §8.8 protocol rules, made mechanical.
 *
 * Why this exists. §8.8 opens by saying the addresses matter less than the
 * rules, because address lists get extended by whoever needs a message next and
 * the rules are what stop that extension from quietly voiding §4.1. A rule that
 * lives only in prose is a rule that rots — so the ones that CAN be checked are
 * checked here, and the one that cannot be checked mechanically (rule 2's
 * bulk/control split) is called out at the bottom rather than left implied.
 *
 * The engine's zero-imports property (§4.1) is the load-bearing one: its test is
 * *could you delete every line of ImWeb UI and still drive a working sound
 * engine from a script?*, and the answer stops being yes the first time someone
 * adds a convenient import.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sanitizeSource, calibrateSanitizer } from './lib/sanitize-source.mjs';
import {
  PROTO_VERSION, TYPE_TAGS, CLIENT_TO_ENGINE, ENGINE_TO_CLIENT, DEFERRED,
  allAddresses, isOscLegalAddress, encode,
} from '../src/audio/protocol.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const PROC = 'src/audio/engine/tape-processor.js';
const procRaw = read(PROC);
const procCode = sanitizeSource(procRaw);                          // strings gone
const procKeep = sanitizeSource(procRaw, { blankStrings: false }); // comments gone

console.log('the sanitizer is honest');
calibrateSanitizer(check);

// ── 1. §4.1 — the engine imports nothing ───────────────────────────────────
console.log('\nthe engine boundary is real');

check('worklet processor has no import statement',
  !/^\s*import[\s{*'"]/m.test(procCode),
  'an AudioWorklet has no module loader; an import here is also §4.1 going fake');
check('worklet processor has no require()',
  !/\brequire\s*\(/.test(procCode));
check('worklet processor never mentions ParameterSystem',
  !/ParameterSystem|\bps\./.test(procCode),
  '§4.1: ps.get() inside the worklet means the boundary is fake');

const protoCode = sanitizeSource(read('src/audio/protocol.js'));
check('protocol.js imports nothing',
  !/^\s*import[\s{*'"]/m.test(protoCode),
  'protocol.js is part of the engine contract and must stay ImWeb-free');

const hostCode = sanitizeSource(read('src/audio/AudioEngine.js'));
const hostImports = [...sanitizeSource(read('src/audio/AudioEngine.js'), { blankStrings: false })
  .matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
check('AudioEngine imports only its own engine files',
  hostImports.every((p) => p.startsWith('./')),
  `found: ${hostImports.join(', ')}`);
check('AudioEngine does not reach into ParameterSystem',
  !/ParameterSystem|\bps\.get\(/.test(hostCode),
  'rule 3: binding happens a layer above, through opaque integer slots');

// ── 2. The fixpoint: protocol.js and the worklet agree on what exists ──────
console.log('\nprotocol.js and the worklet describe the same protocol');

const handled = new Set(
  [...procKeep.matchAll(/case\s+'([^']+)'\s*:/g)].map((m) => m[1]));
const posted = new Set(
  [...procKeep.matchAll(/a:\s*'([^']+)'/g)].map((m) => m[1]));

const declaredIn = Object.keys(CLIENT_TO_ENGINE);
const declaredOut = Object.keys(ENGINE_TO_CLIENT);

check('worklet handles every implemented client→engine address',
  declaredIn.every((a) => handled.has(a)),
  `unhandled: ${declaredIn.filter((a) => !handled.has(a)).join(', ') || '—'}`);
check('worklet handles no address protocol.js does not declare',
  [...handled].every((a) => declaredIn.includes(a)),
  `undeclared: ${[...handled].filter((a) => !declaredIn.includes(a)).join(', ') || '—'}`);
check('every address the worklet posts is a declared engine→client address',
  [...posted].every((a) => declaredOut.includes(a)),
  `undeclared: ${[...posted].filter((a) => !declaredOut.includes(a)).join(', ') || '—'}`);
check('worklet posts every declared engine→client address',
  declaredOut.every((a) => posted.has(a)),
  `never sent: ${declaredOut.filter((a) => !posted.has(a)).join(', ') || '—'}`);
check('worklet agrees with protocol.js on the version number',
  new RegExp(`PROTO_VERSION\\s*=\\s*${PROTO_VERSION}\\b`).test(procCode));

// ── 3. Rule 1 — everything is OSC 1.0 representable ────────────────────────
console.log('\nrule 1: every message could go over UDP unchanged');

const illegal = allAddresses().filter((a) => !isOscLegalAddress(a));
check('every address is OSC-legal', illegal.length === 0, illegal.join(', '));

const allTags = Object.entries({ ...CLIENT_TO_ENGINE, ...ENGINE_TO_CLIENT, ...DEFERRED });
const badTags = allTags.filter(([, t]) => [...t].some((c) => !TYPE_TAGS.includes(c)));
check('every argument uses a permitted type tag',
  badTags.length === 0, badTags.map(([a, t]) => `${a}:${t}`).join(', '));

// Behavioural, not static: the rule is only real if encode() refuses.
let threwOnObject = false;
try { encode('/engine/tape/alloc', { seconds: 60 }); } catch { threwOnObject = true; }
check('encode() refuses a non-OSC argument', threwOnObject,
  'rule 1 has to be enforced where the developer meets it');

let threwOnArity = false;
try { encode('/tape/env/req', 1, 2, 3); } catch { threwOnArity = true; }
check('encode() refuses the wrong argument count', threwOnArity);

let threwOnUnknown = false;
try { encode('/not/an/address', 1); } catch { threwOnUnknown = true; }
check('encode() refuses an undeclared address', threwOnUnknown);

// Calibration: it must still ACCEPT valid messages, or the three checks above
// pass for the boring reason that encode() throws at everything.
let accepted = false;
try { encode('/tape/env/req', 0, 100, 64, 1); accepted = true; } catch { /* nope */ }
check('encode() accepts a valid message', accepted,
  'if this fails the refusal checks above are vacuous');

// ── 4. Rules 3, 5, 6 — what the address space may not say ──────────────────
console.log('\nrules 3, 5, 6: the address space stays closed');

check('no generic parameter setter exists',
  !allAddresses().some((a) => /^\/param\b/.test(a)),
  'rule 3: a /param/set backdoor makes §4.1 zero-imports fake');

const segments = allAddresses().flatMap((a) => a.split('/').slice(1));
const named = segments.filter((s) => !/^(<[a-z]+>|[a-z][a-z0-9]*)$/.test(s));
check('every address segment is a fixed token or an index placeholder',
  named.length === 0, `rule 5 — name-shaped segments: ${named.join(', ')}`);

const bothWays = declaredIn.filter((a) => declaredOut.includes(a));
check('no address travels in both directions',
  bothWays.length === 0, `rule 6 — ambiguous: ${bothWays.join(', ')}`);

check('no /tap/ address admits a partition',
  !allAddresses().some((a) => a.startsWith('/tap/') && /part/.test(a)),
  '§8.6: the analyser taps signals, never storage — enforced by grammar');

// ── 5. §4.9 — process() does not allocate ──────────────────────────────────
console.log('\n§4.9: the audio callback allocates nothing');

// Direct body only. The rule-7 dirty flush posts an object and is reached from
// process(), which is deliberate and rate-limited to ~60 Hz — a transitive scan
// would flag it and the honest scope is therefore the callback itself.
function methodBody(src, name) {
  const start = src.search(new RegExp(`\\n\\s*${name}\\s*\\([^)]*\\)\\s*\\{`));
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}' && --depth === 0) return src.slice(i, j + 1);
  }
  return null;
}

const body = methodBody(procCode, 'process');
check('process() was located for scanning', !!body,
  'a rename here would silently skip the allocation check');

const ALLOCATORS = [/\bnew\s+[A-Z]/, /\.map\(/, /\.filter\(/, /\.slice\(/, /\.concat\(/, /JSON\./];
const found = body ? ALLOCATORS.filter((r) => r.test(body)).map(String) : [];
check('process() contains no allocating construct', found.length === 0,
  `§4.9 — one array literal per quantum puts GC on the audio thread: ${found.join(', ')}`);

// Calibration: the scanner must actually fire on an allocation.
check('the allocation scanner is live',
  ALLOCATORS.some((r) => r.test('const x = new Float32Array(4);')),
  'a scanner that never matches makes the check above vacuous');

// ── 6. What is NOT checked here ────────────────────────────────────────────
// Rule 2 (control vs bulk) and rule 7 (frame-cadence aggregation) are runtime
// properties. Rule 7 has a static proxy — the flush is gated on a quanta
// counter — but "aggregated to frame cadence" is only observable while running,
// and asserting the counter exists would be a check on the shape of the fix
// rather than on the behaviour. tests/audio-tape.html exercises both by hand.
check('rule 7 flush is gated on a counter, not per-quantum',
  /_quantaPerFlush/.test(procCode) && /_quanta\s*>=\s*this\._quantaPerFlush/.test(procCode),
  'a per-quantum post is 375 messages/s for a display that repaints 60');

if (failures) {
  console.error(
    '\nThe rule: the engine is a server that happens to run in this page.\n' +
    'Every shortcut that makes it "just a module over there" — an import, a\n' +
    'name in an address, an object argument — is the boundary going fake.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll audio-protocol checks passed.\n');
process.exit(failures ? 1 : 0);
