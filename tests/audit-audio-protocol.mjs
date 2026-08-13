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

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { sanitizeSource, calibrateSanitizer } from './lib/sanitize-source.mjs';
import {
  PROTO_VERSION, TYPE_TAGS, CLIENT_TO_ENGINE, ENGINE_TO_CLIENT, DEFERRED,
  allAddresses, isOscLegalAddress, encode, normalizeAddress,
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

// ── 1b. The binding is the ONLY place the two halves touch ─────────────────
console.log('\nAudioBinding is the only module that sees both halves');

const bindRaw = read('src/audio/AudioBinding.js');
const bindCode = sanitizeSource(bindRaw);
const bindKeep = sanitizeSource(bindRaw, { blankStrings: false });

// Rule 3 in its concrete form: an ImWeb param id is `prefix.key`, and none may
// appear in a string that becomes an address. Translation, not transport — the
// literal 'aplay.rate' must never leave this file.
const addressLiterals = [
  ...[...bindKeep.matchAll(/'(\/[^']*)'/g)].map((m) => m[1]),
  ...[...bindKeep.matchAll(/`(\/[^`]*)`/g)].map((m) => m[1]),
];
const leaked = addressLiterals.filter((a) => /\b(audio|arec|aplay|apart\d)\./.test(a));
check('no ImWeb param id appears inside an address', leaked.length === 0,
  `rule 3 — leaked: ${leaked.join(', ')}`);
check('the binding does not send raw param ids anywhere',
  !/_send\(|postMessage\(/.test(bindCode),
  'it must go through AudioEngine methods, which encode() validates');

// An engine-initiated param write must not travel back as a command. The guard
// lives in _on() so no handler has to remember it — the first version put it in
// one handler and left open the very path the echo uses, which was benign only
// because stopping a stopped zone is idempotent.
check('_on() drops engine-initiated writes',
  /_on\(id, fn\)[\s\S]{0,400}?if \(this\._fromEngine\) return;/.test(bindCode),
  'without this every subscription must remember the guard individually');
for (const cb of ['onZoneState', 'onRecLength']) {
  const m = new RegExp(`engine\\.${cb}\\s*=\\s*\\([\\s\\S]*?\\n    \\};`).exec(bindCode);
  check(`${cb} writes params only via _applyFromEngine`,
    !!m && !/this\.ps\.set\(/.test(m[0]),
    'a raw ps.set here sends the engine its own fact back as a command');
}

// The engine side must stay ImWeb-free. AudioBinding is the boundary, so it is
// the one file allowed to import from controls/.
for (const f of ['src/audio/AudioEngine.js', 'src/audio/protocol.js',
                 'src/audio/engine/tape-processor.js']) {
  const src = sanitizeSource(read(f), { blankStrings: false });
  const bad = [...src.matchAll(/from\s+'([^']+)'/g)]
    .map((m) => m[1]).filter((p) => !p.startsWith('./'));
  check(`${f.split('/').pop()} imports nothing outside src/audio`,
    bad.length === 0, bad.join(', '));
}

// ── 1c. §8.6 — ONE AudioContext, and it is the engine's ────────────────────
//
// The failure this prevents is not a crash. Two contexts run two clocks, so
// what the instrument hears and what it plays drift apart by an amount nothing
// reports — and §3's coupling claim is the casualty. It shipped that way twice:
// ControllerManager and VectorscopeInput each built their own, which is how the
// app could hold three contexts and open the microphone twice over.
console.log('\n§8.6 — one AudioContext');

const CTX_CTOR = /new\s+(?:window\.)?(?:webkit)?AudioContext\s*\(/g;
const walk = (dir) => readdirSync(resolve(root, dir), { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`)
    : e.name.endsWith('.js') ? [`${dir}/${e.name}`] : []));

const constructors = walk('src').filter((f) =>
  CTX_CTOR.test(sanitizeSource(read(f))) && (CTX_CTOR.lastIndex = 0, true));

check('exactly one file constructs an AudioContext',
  constructors.length === 1, constructors.join(', ') || 'none found');
check('and it is AudioEngine, which §8.6 makes the owner',
  constructors[0] === 'src/audio/AudioEngine.js', constructors[0] ?? '—');

// Calibration. A regex that matches nothing would pass both checks above by
// finding zero constructors — the vacuous-scanner trap, so probe it directly.
check('the AudioContext scanner is live',
  ['new AudioContext()', 'new window.AudioContext()', 'new webkitAudioContext()']
    .every((s) => (CTX_CTOR.lastIndex = 0, CTX_CTOR.test(s))),
  'a scanner that never matches makes "exactly one" vacuous');

// The consumers reach the tap by injection. An import here would work and would
// be wrong: it puts a second module on the boundary AudioBinding is supposed to
// be the whole of, and §4.1's test only means something while that is true.
for (const f of ['src/controls/ControllerManager.js', 'src/inputs/VectorscopeInput.js']) {
  check(`${f.split('/').pop()} does not import the audio half`,
    !/from\s+['"][^'"]*audio\/(AudioEngine|AudioBinding|protocol)/.test(read(f)),
    'the tap is injected as audioHost by main.js');
}

// ── 2. The fixpoint: protocol.js and the worklet agree on what exists ──────
console.log('\nprotocol.js and the worklet describe the same protocol');

const handled = new Set(
  [...procKeep.matchAll(/case\s+'([^']+)'\s*:/g)].map((m) => m[1]));
// Addresses are posted either as literals or as templates carrying an index —
// `/zone/rec/${i}/length`. Missing the template form made this check pass for
// the boring reason that it could not see half the send sites.
const posted = new Set([
  ...[...procKeep.matchAll(/a:\s*'([^']+)'/g)].map((m) => m[1]),
  ...[...procKeep.matchAll(/a:\s*`([^`]+)`/g)]
    .map((m) => m[1].replace(/\$\{[^}]*\}/g, '0')),
].map(normalizeAddress));   // collapse through the canonical function, not a copy

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

// ── 4b. §4.11 — the output limiter is not bypassable ───────────────────────
console.log('\n§4.11: the output ceiling cannot be switched off');

// The rule is "not by effect.enable, not by a Display State, not by a loaded
// project — the one control that must never be a controller target". The way to
// make that true rather than merely intended is for the address space to have
// no production for it, so this checks the grammar, not the implementation.
const bypassy = allAddresses().filter(
  (a) => /limit|ceiling|clip/.test(a) && /(bypass|enable|off|disable|on)$/.test(a));
check('no address disables the limiter', bypassy.length === 0, bypassy.join(', '));
check('/bus/out/limit sets parameters only, and takes no boolean',
  (CLIENT_TO_ENGINE['/bus/out/limit'] ?? '') === 'ff',
  'a T/F argument here would be a bypass in disguise');
check('the limiter runs unconditionally in the callback',
  /\n\s*this\._limit\(L, R, frames\);/.test(procCode)
  && !/if\s*\([^)]*\)\s*this\._limit/.test(procCode),
  'a guarded limiter is a bypassable limiter');

// The ceiling's BEHAVIOUR — bounded output, and no NaN survivors — is asserted
// against real samples in tests/audit-audio-dsp.mjs. This used to be a regex
// matching the exact ternary, which is a check on the shape of a fix rather
// than on the property, and it duly went red the moment the clamp was made
// NaN-safe. What is worth asserting statically is that the behavioural test
// cannot be quietly dropped from the suite.
const pkg = read('package.json');
check('the DSP audit runs in npm test',
  /audit-audio-dsp\.mjs/.test(pkg),
  'the ceiling, NaN handling and fractional-index regressions are checked there');

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

// Not just process(): the per-sample work lives in the helpers it calls, and a
// PER-SAMPLE allocation is 48000 a second rather than 375. `return [a, b]` from
// a span helper called once per quantum was fine; the same helper called once
// per sample was not, and this list is scoped to the methods where that
// distinction bites.
const HOT = ['process', '_renderPlay', '_renderRec', '_limit', '_computeSpan', '_approach'];

const ALLOCATORS = [
  /\bnew\s+[A-Z]/, /\.map\(/, /\.filter\(/, /\.slice\(/, /\.concat\(/, /JSON\./,
  /return\s*\[/,          // the pair-returning helper that started this
];

for (const name of HOT) {
  const body = methodBody(procCode, name);
  check(`${name}() was located for scanning`, !!body,
    'a rename here would silently skip the allocation check');
  const found = body ? ALLOCATORS.filter((r) => r.test(body)).map(String) : [];
  check(`${name}() contains no allocating construct`, found.length === 0,
    `§4.9 — GC on the audio thread: ${found.join(', ')}`);
}

// Calibration: the scanner must actually fire, on both shapes it looks for.
check('the allocation scanner is live',
  ALLOCATORS.some((r) => r.test('const x = new Float32Array(4);'))
  && ALLOCATORS.some((r) => r.test('  return [a, b];')),
  'a scanner that never matches makes every check above vacuous');

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
