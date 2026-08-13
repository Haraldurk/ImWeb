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
  // Milliseconds for a zone's bounds to reach a new target. 0 = exact tracking.
  // Exposed rather than fixed because the right value depends on what is
  // driving the parameter: a hand wants 0, a 60 Hz controller wants a few ms to
  // hide the staircase (§8.7's resolution problem, until controllers move into
  // the worklet and the staircase stops existing).
  '/engine/glide': 'f',
  '/tape/write': 'iib',            // startSample, channels, float32 blob
  '/tape/env/req': 'iiii',         // start, end, columns, reqId

  // Partitions (§4.3). Layout is a setup act: /bounds is refused while a zone
  // bound to that slot is active, so the protocol enforces the rule instead of
  // trusting the client to remember it.
  '/part/<n>/bounds': 'ii',        // startSample, lengthSamples
  '/part/<n>/clear': '',

  // Zones (§4.4). Regions are partition-relative — that is what lets a layout
  // differ between machines without every zone landing in the wrong material.
  '/zone/<type>/<n>/part': 'i',    // partition slot
  '/zone/<type>/<n>/region': 'ff', // startRel, lengthRel, in samples
  '/zone/<type>/<n>/unsafe': 'T',  // opt-in crossing of the partition seam
  '/zone/<type>/<n>/on': '',
  '/zone/<type>/<n>/off': '',
  '/zone/play/<n>/rate': 'f',      // signed; negative reads backwards
  '/zone/rec/<n>/dynamic': 'T',    // length taken from where you stop

  // Output bus (§4.11). Note what is absent: there is no address that disables
  // the limiter. A feedback instrument without an output ceiling is one dialled
  // coupling away from damaging monitors and ears, so non-bypassable is
  // enforced by the address space having no production for it.
  '/bus/out/gain': 'f',
  '/bus/out/limit': 'ff',          // threshold (linear), release (seconds)
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
  '/zone/rec/<n>/length': 'f',     // resolved length after a dynamic recording
  // A request/reply pair needs a correlated ERROR reply, not just the shared
  // /engine/refuse: a refusal carrying no reqId cannot settle the promise it
  // belongs to, and with one-outstanding-per-view that wedges the view forever.
  '/tape/env/err': 'ii',           // reqId, refusal code
  // The engine can stop a zone on its own (a dynamic recording reaching the
  // partition seam). Without this the client's Run toggle stays on over a zone
  // that has already stopped — state the engine knows and nobody else does.
  '/zone/<type>/<n>/state': 'T',   // running
});

/**
 * Declared in §8.8 but not implemented yet — zones, graphs, controllers, jobs,
 * taps, the output bus. Listed so the address space is validated as a whole
 * (OSC-legality, no names, no generic setter) while the fixpoint check above
 * stays honest about what actually exists. Move an entry up as it lands.
 */
export const DEFERRED = Object.freeze({
  '/part/<n>/ring': 'T',
  // graph, startRel, lengthSamples, jobId. `len` is a sample count, so `i` —
  // it was 'iffi' when first written down, which would have typed a length as
  // a float and let a fractional render span through validation.
  '/zone/<type>/<n>/render': 'ifii',
  // §8.9: freeze is render PLUS A STATE SEED, so it is a sibling verb rather
  // than an argument on render. Cold state vs warm state are different musical
  // acts, and one verb with an optional voice would frame the cold case as a
  // degenerate freeze — it is the other way round.
  '/voice/<n>/freeze': 'ifii',     // partition, startRel, lengthSamples, jobId
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

/** Zone type tokens. Fixed vocabulary — rule 5 forbids a free name here. */
export const ZONE_TYPES = Object.freeze(['rec', 'play', 'load', 'spectral', 'synth']);

/**
 * Collapse a concrete address to its declared pattern: `/zone/play/3/rate`
 * becomes `/zone/play/<n>/rate`, and `/zone/rec/0/on` becomes
 * `/zone/<type>/<n>/on` when no type-specific pattern is declared.
 *
 * The worklet performs the same collapse before its switch, which is why its
 * `case` labels read as patterns and the fixpoint audit can compare them to the
 * tables above without either side knowing about the other.
 */
export function normalizeAddress(a) {
  const byIndex = a.replace(/\/\d+(?=\/|$)/g, '/<n>');
  if (byIndex in CLIENT_TO_ENGINE || byIndex in ENGINE_TO_CLIENT) return byIndex;
  return byIndex.replace(
    new RegExp(`^/zone/(?:${ZONE_TYPES.join('|')})/`), '/zone/<type>/');
}

/** The integer indices in a concrete address, left to right. */
export function addressIndices(a) {
  return [...a.matchAll(/\/(\d+)(?=\/|$)/g)].map((m) => Number(m[1]));
}

/**
 * Rule 1: an argument must be an OSC scalar or an ArrayBuffer-backed blob.
 *
 * `T` in a table means "a boolean". OSC 1.0 encodes booleans as the type tag
 * itself with no payload — `T` for true, `F` for false — so a settable flag is
 * declared `T` and `encode()` emits whichever tag the value calls for. Reading
 * `T` as "only ever true" would make every boolean address one-way, which is
 * how a `/unsafe` you cannot turn back off would have shipped.
 */
function tagMatches(tag, v) {
  switch (tag) {
    case 'i': return Number.isInteger(v);
    case 'f': return typeof v === 'number' && Number.isFinite(v);
    case 's': return typeof v === 'string';
    case 'b': return v instanceof ArrayBuffer || ArrayBuffer.isView(v);
    case 'T': case 'F': return typeof v === 'boolean';
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
  const pattern = normalizeAddress(address);
  const tags = CLIENT_TO_ENGINE[pattern] ?? ENGINE_TO_CLIENT[pattern];
  if (tags === undefined) throw new Error(`unknown address '${address}'`);
  if (args.length !== tags.length) {
    throw new Error(`'${address}' takes ${tags.length} arg(s), got ${args.length}`);
  }
  const transfer = [];
  let wire = '';
  for (let i = 0; i < tags.length; i++) {
    if (!tagMatches(tags[i], args[i])) {
      throw new Error(`'${address}' arg ${i} is not OSC type '${tags[i]}'`);
    }
    wire += tags[i] === 'T' || tags[i] === 'F' ? (args[i] ? 'T' : 'F') : tags[i];
    if (tags[i] === 'b') {
      transfer.push(ArrayBuffer.isView(args[i]) ? args[i].buffer : args[i]);
    }
  }
  return { msg: { a: address, t: wire, v: args }, transfer };
}
