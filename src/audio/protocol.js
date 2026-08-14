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

// 2 since step 7: the controller vocabulary arrived (§8.7) and
// `/ctrl/<n>/range` gained an argument. A signature that changes without a
// bump is precisely the half-understood protocol `/engine/hello` exists to
// refuse — the handshake can only protect what the number tracks.
//
// 3 since step 8: the spectral writer (§4.5) brought the image slots, the
// render verb and the job replies. New addresses count as much as changed
// signatures here — an engine one version behind answers `/spec/0/data` with
// `unknown address`, and a client that never learns that will sit waiting on a
// `/job/<n>/done` nothing is going to send.
//
// 4 since step 9: the corpus index (§4.6) brought `/corpus/analyse`, its reply,
// and the grain player's zone type. A new ZONE TYPE is the sharper reason —
// `grain` joining ZONE_TYPES changes how `normalizeAddress` collapses an
// address, so an older client and a newer engine disagree about what
// `/zone/grain/0/on` even IS rather than merely one of them not knowing it.
// 5 since step 12: the spectral writer's PAN image (§8.14). A new address, so
// the step-8 reason applies unchanged — but there is a second one that is worse
// than a missing reply. `/spec/<n>/pan` carries positions an older engine drops
// silently, and a dropped pan image is not a failure the performer can hear as a
// failure: the render simply comes out mono, which is exactly what it did
// before, so it reads as the feature not working rather than as the engine being
// too old. Version mismatch is the only place that can say which.
export const PROTO_VERSION = 5;

/** The complete permitted argument-type set. Rule 1 — do not extend casually. */
export const TYPE_TAGS = Object.freeze(['i', 'f', 's', 'b', 'T', 'F']);

/**
 * Refusal codes carried by `/engine/refuse`.
 *
 * The engine declares these again as its own constants — it has zero imports by
 * construction (§4.1) — so the two lists are kept in step by an audit, not by
 * memory. Append only: a code is a number on a wire.
 */
export const REFUSE = Object.freeze({
  PROTO_MISMATCH: 1,
  NO_TAPE: 2,
  BAD_RANGE: 3,
  LAYOUT_LOCKED: 4,
  // Work already queued, not work that is wrong. Bulk reads are paced across
  // quanta, so the engine bounds how many may be outstanding rather than
  // absorbing an unbounded backlog on the audio thread.
  BUSY: 5,
  // A direct write to a target a worklet-resident controller is driving (§8.7).
  // Refused rather than accepted-then-overwritten-a-sample-later: the protocol
  // does not enforce its rules by trusting the client anywhere else (layout
  // lock, alloc refusal), and "my slider does nothing" with no message is the
  // worst version of this to debug.
  CTRL_OWNED: 6,
  // A paced job did not finish because something ended it: `/job/<n>/cancel`,
  // a re-allocated tape, a panic. It is an ERROR code rather than a quiet
  // `/job/<n>/done` because the region really did not get written, and a
  // writer that reports success over a half-rendered partition is the same
  // silent-failure class as an envelope reply that never arrives.
  CANCELLED: 7,
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

  // ── The spectral writer (§4.5) ──────────────────────────────────────────
  //
  // A frequency-time image is inverse-transformed ONCE, at write time, into an
  // ordinary waveform in a partition. Nothing here appears in the realtime read
  // path: after a render the material is tape like any other, scrubbed by index
  // arithmetic forever after (§4.2).
  //
  // Note what the engine is NOT told: the scale. §4.5's load-bearing claim is
  // that quantizing the vertical axis to a musical scale is what separates
  // Metasynth and UPIC from noise — but a scale is a client-side musical idea,
  // and putting a `/spec/<n>/scale 'i'` here would make the engine hold a
  // vocabulary of tunings that rule 5 exists to keep out. The client sends
  // FREQUENCIES, one per row, so the engine cannot express the concept and
  // every tuning — equal, just, harmonic, microtonal, one somebody invents next
  // year — costs the protocol nothing.
  '/spec/<n>/pitches': 'b',        // float32 blob, Hz per row, defines row count
  // rows, frames, float32 magnitude blob. FRAME-MAJOR: one whole column of
  // `rows` magnitudes per frame, which is both how a spectrogram is thought
  // about and the layout the renderer reads contiguously — row-major would
  // stride by `frames` on every sample of the inner loop.
  //
  // `rows` travels even though `/pitches` already implies it, so a mismatch is
  // refused loudly at upload instead of rendering an image against the wrong
  // pitch table — which sounds like a broken instrument rather than a bad
  // message.
  '/spec/<n>/data': 'iib',
  // The PAN image (§8.14) — rows, frames, float32 blob, the same shape and the
  // same frame-major layout as `/spec/<n>/data`, because it is a second picture
  // over the same grid and any other layout would need its own indexing in the
  // one loop that must stay cheap.
  //
  // **Positions, in [-1, +1]. Not pixels, and not a "width".** The engine is
  // told where each cell sits between the speakers and nothing about how that
  // was decided — which colour meant which side, whether the spread runs low-to-
  // high or high-to-low, how far a width control had opened. All of that is a
  // client-side musical idea in exactly the sense §4.5's scale is, so it stays
  // client-side for the same reason: the engine holds no vocabulary, and a
  // fifth pan mode invented next year costs the protocol nothing.
  //
  // Optional by construction. A slot with no pan image renders mono into every
  // channel, which is what every slot did before this address existed.
  '/spec/<n>/pan': 'iib',
  '/spec/<n>/clear': '',
  // image slot, startRel, lengthSamples, jobId — the §8.8 render signature
  // unchanged, where the leading id is "the thing to render from". Region
  // travels with the VERB rather than being read off the zone: a render is a
  // one-shot destructive act with an explicit destination, and taking its
  // bounds from a slewing, controller-driven region would make where the audio
  // landed depend on when the message happened to arrive.
  '/zone/<type>/<n>/render': 'ifii',
  // Stop a paced job (§8.3). The client already holds the id it minted.
  '/job/<n>/cancel': '',

  // ── The corpus index (§4.6) ─────────────────────────────────────────────
  //
  // §4.6's claim is that the corpus is a MAP and the tape is the territory, and
  // the split below is that sentence made structural: the engine measures the
  // territory and plays positions in it, and never learns that a map exists.
  //
  // What crosses the boundary is a table of NUMBERS per grain. The engine does
  // not know that column 1 is "brightness", does not know which two columns a
  // performer is currently navigating by, and holds no 2D space — all of that is
  // client-side, exactly as the musical scale is for the spectral writer (§4.5).
  // The engine's whole half of §4.6 is "measure this span" and "read from here".
  //
  // start, end, hop, window, jobId. Hop and window are SEPARATE on purpose: hop
  // is how densely the corpus is sampled, window is how much material each
  // measurement describes. They are independent, and conflating them would fix
  // the grain density to the descriptor resolution for no reason beyond having
  // typed one number instead of two.
  '/corpus/analyse': 'iiiii',

  // The grain player (§4.6) — the reader that makes a descriptor space mean
  // something. Navigating a corpus yields timestamps, and a single playhead
  // jumping between them is a scrub, not corpus synthesis; overlapping windowed
  // grains are what let a position in the space be HELD and heard as a texture.
  //
  // `pos` is deliberately its own address carrying exactly one float, which is
  // §8.7's binding rule — that makes it a legal worklet-resident controller
  // target, so an LFO can sweep the corpus at audio rate rather than in 60 Hz
  // steps. Samples relative to the partition, like every other zone position.
  '/zone/grain/<n>/pos': 'f',
  '/zone/grain/<n>/size': 'f',    // grain duration, samples
  '/zone/grain/<n>/rate': 'f',    // grains per second
  '/zone/grain/<n>/pitch': 'f',   // per-grain read rate; signed, negative reads back
  // Random offset added to each grain's start, in samples. The one parameter
  // here with no equivalent anywhere else in the instrument: without it a held
  // position is the same few hundred milliseconds repeating at the grain rate,
  // which is a buzz at that frequency rather than a texture.
  '/zone/grain/<n>/spray': 'f',
  '/zone/grain/<n>/level': 'f',

  // Voices (§4.4, §4.10) — the things with no buffer region. Fixed topology in
  // this pass: source → filter → saturator → level. There is deliberately no
  // address here for an envelope generator: this instrument has no note-on, so
  // the envelope is a hand on a fader or slew on a parameter, both of which
  // already exist client-side. Importing SC's note model out of habit would add
  // a whole verb set for a gesture that is not in the instrument.
  '/voice/<n>/on': '',
  '/voice/<n>/off': '',
  '/voice/<n>/src': 'i',           // 0 oscillator, 1 noise
  '/voice/<n>/wave': 'i',          // 0 sine, 1 saw, 2 square, 3 triangle
  '/voice/<n>/freq': 'f',          // Hz
  // ratio, index. The oscillator's PHASE input is what makes FM free rather
  // than a UGen of its own (§4.10), so this is two numbers on the oscillator
  // and not a separate node.
  '/voice/<n>/fm': 'ff',
  '/voice/<n>/colour': 'f',        // noise tilt: 0 dark, 0.5 white, 1 bright
  // cutoff (Hz), resonance, type. Type is a FLOAT because the SVF morphs
  // LP→BP→HP→notch continuously — an integer would make it a switch, and a
  // discrete type change under a controller is a click.
  '/voice/<n>/filter': 'fff',
  '/voice/<n>/drive': 'f',
  '/voice/<n>/level': 'f',

  // Output bus (§4.11). Note what is absent: there is no address that disables
  // the limiter. A feedback instrument without an output ceiling is one dialled
  // coupling away from damaging monitors and ears, so non-bypassable is
  // enforced by the address space having no production for it.
  '/bus/out/gain': 'f',
  '/bus/out/limit': 'ff',          // threshold (linear), release (seconds)

  // ── Worklet-resident controllers (§8.7) ─────────────────────────────────
  //
  // The client DESCRIBES the controller; the engine EVALUATES it, at audio
  // rate, on the thread a hidden tab cannot suspend. §8.7's three problems —
  // the freeze, a frame of jitter, and 60 Hz steps that are zipper noise on a
  // fader — all come from evaluating on the rAF thread, and none of them are
  // fixed by clocking that thread differently.
  //
  // This does NOT contradict §4.10's rule against rebuilding the controller
  // layer in UGens. That rule forbids duplicating the AUTHORING; the badge
  // popover, MIDI mapping and range fields do not move. What travels is a
  // description, so there stays one definition of each curve.
  //
  // `<n>` is the opaque slot rule 3 requires: the client allocates it, the
  // engine knows nothing else about the controller, and `aplay.rate` never
  // travels. The TARGET is an engine-side address — the engine's own namespace,
  // not ImWeb's — so binding needs no second registry to drift out of step.
  '/ctrl/<n>/target': 's',         // engine address to drive, or '' to unbind
  // shape (0 sine, 1 triangle, 2 saw, 3 ramp-down, 4 square, 5 sample-and-hold),
  // hz, pulse width, mode (0 free-running, 1 one-shot).
  '/ctrl/<n>/lfo': 'iffi',
  // Phase OFFSET, slid relative — the same semantics as `LFO.setPhase`, which
  // moves the wave under the playhead instead of jumping the playhead back to
  // the start of the cycle. Setting it is not a retrigger (rule 4).
  '/ctrl/<n>/phase': 'f',
  // Output range in the TARGET's own units, and how the sweep is mapped onto
  // it: 0 linear, 1 exponential. Exponential exists because frequency and rate
  // are heard as ratios (LEARNED 2026-08-08) — a linear sweep between two
  // frequencies spends most of its travel in the top octave. The mapping has to
  // live here rather than in the client's semitone conversion, because the
  // client would otherwise have to send a value per sample, which is the whole
  // thing this section removes.
  // lo, hi, map, invert. Invert is here rather than folded into a swapped range
  // because it must be applied to the normalized sweep BEFORE the response
  // curve, exactly as `Parameter.setNormalized` does — the swap is identical
  // arithmetic only while there is no table.
  '/ctrl/<n>/range': 'ffii',
  '/ctrl/<n>/retrigger': '',       // explicit, and the ONLY thing that restarts
  '/ctrl/<n>/clear': '',
  // A response curve, 16384 floats — the SAME array `ResponseCurve` holds, so
  // there is one definition of an S-curve rather than a client one and a
  // worklet one that drift (§8.7). Bulk (rule 2): announced by this control
  // message and transferred at zero copy.
  '/table/<n>/data': 'b',
  // Which uploaded table shapes this controller's sweep, or -1 for none. A
  // table id whose slot was never filled is REFUSED, not treated as identity:
  // a curve that silently stops shaping is the failure this whole step exists
  // to prevent.
  '/ctrl/<n>/table': 'i',

  // Slew (§8.7). mode, seconds, damp, strength.
  //
  // §8.7 says *"sample the seven slew curves the same way and transfer them as
  // buffers"* and that is only true of four of them. The other three are not
  // functions of normalized time at all: `lag` is a one-pole filter, `ease` is
  // a critically damped spring carrying velocity between frames, and `elastic`
  // is an underdamped spring that collides with the parameter's rails. A table
  // cannot express any of those — there is no k to sample against — so the mode
  // says WHICH MECHANISM, and only mode 4 carries a curve.
  //
  //   0 none · 1 lag (one-pole) · 2 ease (critically damped spring)
  //   3 elastic (underdamped spring) · 4 segment curve, from a table
  '/ctrl/<n>/slew': 'ifff',
  // The rest of what a segment curve needs: its sampled curve, the rails it
  // fits its excursions to, and the three measured excursion constants
  // (`slewExcursion` in ParameterSystem). Sent as data for the same reason the
  // curve itself is — measuring them again here would be a second definition of
  // how far Back dips.
  '/ctrl/<n>/slewfit': 'ifffff',   // curve slot, min, max, under, over, k0
  // Echo on/off. §8.7's inversion: for a controller feeding audio the worklet is
  // authoritative and echoes values back for the video side and the UI to read.
  // Off by default — an echo nobody reads is 60 messages a second of nothing.
  '/ctrl/echo': 'T',
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
  // §8.7's echo, aggregated to frame cadence (rule 7): ONE message carrying
  // every live slot, never one per slot. Float TRIPLES, [slot, raw, mapped, …].
  // §8.8 drafted packed `[slot:u16, value:f32]`; a single Float32Array is used
  // instead because slots are small integers a float carries exactly, and the
  // mixed-width version needs a DataView at both ends to save two bytes. The
  // extra number is deliberate — see `_ctrlFlush`: a remote client wants the
  // MAPPED value, ImWeb wants the RAW 0..1 so it can feed it back through
  // `setNormalized` instead of inverting its own unit conversions.
  '/ctrl/echo/data': 'b',
  // Paced-job replies (§8.3). Exactly one terminal message per accepted job —
  // `/done` or `/error`, never both and never neither — because the client
  // holds a promise per job and an unterminated one wedges the surface that
  // started it, the same way an uncorrelated envelope refusal wedges a view.
  '/job/<n>/progress': 'ii',       // samples done, samples total
  '/job/<n>/done': '',
  '/job/<n>/error': 'is',          // refusal code, message
  // The corpus measurements (§4.6): jobId, start, hop, grainCount, then a blob
  // of grainCount × CORPUS_COLUMNS floats.
  //
  // Each grain's TIME is derived — `start + i * hop` — never stored, the same
  // rule the envelope reply follows for column positions: a table that carried
  // its own times could disagree with the start and hop in the same message,
  // and a corpus whose timestamps drift from the tape is unfalsifiably wrong.
  //
  // This is the PAYLOAD, not the terminal message: `/job/<n>/done` still
  // follows, so "exactly one terminal per accepted job" holds for every job
  // type rather than gaining an exception the first time a job returned data.
  '/corpus/data': 'iiiib',
});

/**
 * What the engine measures per grain, and the ORDER it measures it in — the
 * wire layout of `/corpus/data`'s blob.
 *
 * §6 item 5 asked which descriptors the corpus extracts. These four, and the
 * reason they are these four is that all of them fall out of two passes over a
 * time-domain window with no FFT anywhere: one pass for level and zero
 * crossings, one autocorrelation for the other two. Pitch and periodicity come
 * from the SAME autocorrelation — the peak's position and its height — so the
 * pair costs what either would alone.
 *
 * The engine does not know these names. It fills columns; this list is the
 * client's reading of them, and it lives here rather than in the UI because the
 * blob's column order is a protocol fact, not a presentation choice.
 *
 * APPEND-ONLY: a column index is a position in a wire format, and a SELECT
 * storing "navigate by column 2" is saved in projects.
 */
export const CORPUS_COLUMNS = Object.freeze(['loudness', 'brightness', 'pitch', 'periodicity']);

/**
 * Declared in §8.8 but not implemented yet — zones, graphs, controllers, jobs,
 * taps, the output bus. Listed so the address space is validated as a whole
 * (OSC-legality, no names, no generic setter) while the fixpoint check above
 * stays honest about what actually exists. Move an entry up as it lands.
 */
export const DEFERRED = Object.freeze({
  '/part/<n>/ring': 'T',
  // §8.9: freeze is render PLUS A STATE SEED, so it is a sibling verb rather
  // than an argument on render. Cold state vs warm state are different musical
  // acts, and one verb with an optional voice would frame the cold case as a
  // degenerate freeze — it is the other way round.
  '/voice/<n>/freeze': 'ifii',     // partition, startRel, lengthSamples, jobId
  '/graph/def': 'ib',
  '/graph/free': 'i',
  '/voice/<n>/graph': 'i',
  // The controller addresses moved up to CLIENT_TO_ENGINE in step 7a. What is
  // still deferred is the rest of §8.7's description vocabulary: random-with-
  // slew and the seven slew curves as sampled tables, response tables, and
  // expression controllers (whose wire format already exists — ExprCompiler's
  // instruction list, c3b5b12).
  '/ctrl/<n>/random': 'ff',        // hz, slew seconds
  '/expr/<n>/code': 'b',
  // The job vocabulary moved up in step 8 — the spectral writer is the first
  // paced render, and it needed all four verbs to have one.
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

/**
 * How many controller slots the engine has, and where slew curves live.
 *
 * Part of the contract rather than a client convenience: a controller may hold
 * a response curve AND a slew curve at once, so the table space is two halves
 * and the split has to mean the same thing on both sides. Offsetting by the
 * number of audio targets instead — which is what this did first — is a soft
 * contract that holds only while that list is shorter than the controller
 * count, and breaks silently rather than loudly when it is not.
 *
 * The engine declares these again (it cannot import this file); the protocol
 * audit checks the two agree.
 */
export const MAX_CONTROLLERS = 16;
export const SLEW_TABLE_BASE = MAX_CONTROLLERS;

/** Zone type tokens. Fixed vocabulary — rule 5 forbids a free name here. */
export const ZONE_TYPES = Object.freeze(['rec', 'play', 'load', 'spectral', 'synth', 'grain']);

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
