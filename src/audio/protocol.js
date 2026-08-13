/**
 * The audio protocol — §8.8 of docs/ImWeb-Audio-Blueprint.md.
 *
 * This file is the ONE place addresses and their argument types are authored.
 * The worklet (src/audio/engine/tape-processor.js) cannot import it: an
 * AudioWorklet global scope has no module loader, so the processor must be a
 * single self-contained file. That is a real constraint, and the honest answer
 * to it is a fixpoint check, not a second copy — `tests/audit-audio-protocol.mjs`
 * asserts that every address handled by the worklet is declared here and every
 * implemented address declared here is handled by the worklet. Six drifting
 * copies of SOURCE_DEFS is the precedent being avoided (CLAUDE.md).
 *
 * **This file must have zero ImWeb imports and must never import one.** It is
 * part of the engine contract, and §4.1's test is: could you delete every line
 * of ImWeb UI and still drive the engine from a script?
 *
 * Rule 1 (§8.8): every message must be representable as OSC 1.0 — addresses are
 * OSC-legal paths, arguments are `i` `f` `s` `b` `T` `F` and nothing else.
 * `encode()` enforces that at the send site rather than trusting the caller, so
 * a message that could not survive a UDP hop cannot be constructed at all.
 */

export const PROTO_VERSION = 1;

/** The complete permitted argument-type set. Rule 1 — do not extend casually. */
export const TYPE_TAGS = Object.freeze(['i', 'f', 's', 'b', 'T', 'F']);

/** Refusal codes carried by `/engine/refuse`. */
export const REFUSE = Object.freeze({
  PROTO_MISMATCH: 1,
  NO_TAPE: 2,
  BAD_RANGE: 3,
  LAYOUT_LOCKED: 4,
});

/**
 * Client → engine. Imperative (rule 6).
 *
 * `<n>` in an address marks an index segment: indices and fixed tokens only,
 * never names (rule 5). Names are client-side presentation and do not travel.
 */
export const CLIENT_TO_ENGINE = Object.freeze({
  '/engine/hello': 'i',            // protoVersion
  '/engine/tape/alloc': 'f',       // seconds
  '/engine/panic': '',
  '/tape/write': 'iib',            // startSample, channels, float32 blob
  '/tape/env/req': 'iiii',         // start, end, columns, reqId
});

/**
 * Engine → client. Observational (rule 6) — the engine answers, echoes and
 * reports, and never initiates a request.
 */
export const ENGINE_TO_CLIENT = Object.freeze({
  '/engine/ready': 'iff',          // protoVersion, sampleRate, maxTapeSeconds
  '/engine/refuse': 'is',          // code, message
  '/tape/env/data': 'iiiib',       // reqId, start, end, columns, min/max blob
  '/tape/env/dirty': 'ii',         // start, end
});

/**
 * Declared in §8.8 but not implemented yet — zones, graphs, controllers, jobs,
 * taps, the output bus. Listed so the address space is validated as a whole
 * (OSC-legality, no names, no generic setter) while the fixpoint check above
 * stays honest about what actually exists. Move an entry up as it lands.
 */
export const DEFERRED = Object.freeze({
  '/part/<n>/bounds': 'ii',
  '/part/<n>/ring': 'T',
  '/part/<n>/clear': '',
  '/zone/<type>/<n>/part': 'i',
  '/zone/<type>/<n>/region': 'ff',
  '/zone/<type>/<n>/unsafe': 'T',
  '/zone/<type>/<n>/on': '',
  '/zone/<type>/<n>/off': '',
  '/zone/play/<n>/rate': 'f',
  '/zone/rec/<n>/dynamic': 'T',
  '/zone/synth/<n>/render': 'iffi',
  '/graph/def': 'ib',
  '/graph/free': 'i',
  '/voice/<n>/graph': 'i',
  '/ctrl/<n>/target': 's',
  '/ctrl/<n>/retrigger': '',
  '/ctrl/<n>/clear': '',
  '/ctrl/echo': 'b',
  '/table/<n>/data': 'b',
  '/expr/<n>/code': 'b',
  '/job/<n>/progress': 'ii',
  '/job/<n>/done': '',
  '/job/<n>/error': 'is',
  '/job/<n>/cancel': '',
  '/tap/src': 's',
  '/bus/out/gain': 'f',
  '/bus/out/limit': 'ff',
});

/** Every address the protocol knows about, implemented or not. */
export function allAddresses() {
  return [
    ...Object.keys(CLIENT_TO_ENGINE),
    ...Object.keys(ENGINE_TO_CLIENT),
    ...Object.keys(DEFERRED),
  ];
}

/**
 * OSC 1.0 forbids these in an address pattern, plus space. Checked here rather
 * than left to a code review, because an illegal address only fails once the
 * transport is actually swapped for a real OSC one — years after it was typed.
 */
const OSC_ILLEGAL = /[ #*,?[\]{}]/;

export function isOscLegalAddress(a) {
  return typeof a === 'string'
    && a.startsWith('/')
    && !a.endsWith('/')
    && !a.includes('//')
    && !OSC_ILLEGAL.test(a.replace(/<[a-z]+>/g, 'x'));
}

/** Rule 1: an argument must be an OSC scalar or an ArrayBuffer-backed blob. */
function tagMatches(tag, v) {
  switch (tag) {
    case 'i': return Number.isInteger(v);
    case 'f': return typeof v === 'number' && Number.isFinite(v);
    case 's': return typeof v === 'string';
    case 'b': return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
    case 'T': return v === true;
    case 'F': return v === false;
    default: return false;
  }
}

/**
 * Build a validated message. Throws rather than sending something that could
 * not survive a UDP hop — rule 1 is only real if it is enforced somewhere the
 * developer meets it, and that place is here.
 *
 * The wire shape is `{ a, t, v }`: address, type tags, arguments. A `b`
 * argument is additionally listed in `transfer` so the caller can hand it to
 * `postMessage` at zero copy (rule 2). Over a network transport it becomes an
 * OSC blob and a copy — a stated cost, not a surprise.
 */
export function encode(address, ...args) {
  const tags = CLIENT_TO_ENGINE[address] ?? ENGINE_TO_CLIENT[address];
  if (tags === undefined) throw new Error(`unknown address '${address}'`);
  if (args.length !== tags.length) {
    throw new Error(`'${address}' takes ${tags.length} arg(s), got ${args.length}`);
  }
  const transfer = [];
  for (let i = 0; i < tags.length; i++) {
    if (!tagMatches(tags[i], args[i])) {
      throw new Error(`'${address}' arg ${i} is not OSC type '${tags[i]}'`);
    }
    if (tags[i] === 'b') {
      transfer.push(ArrayBuffer.isView(args[i]) ? args[i].buffer : args[i]);
    }
  }
  return { msg: { a: address, t: tags, v: args }, transfer };
}
