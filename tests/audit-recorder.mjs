/**
 * Output recorder audit.
 *
 * Why this exists. The recorder's frame rate was measured, over five real
 * recordings, to be limited by the capture/encode path and to scale with pixel
 * count — 57.6 fps at 0.58 MP against 19.0 at 4.67 (see
 * docs/Recorder-Frame-Rate-Investigation.md). Two decisions came out of that,
 * and both are the kind that fail SILENTLY when they get undone: the file still
 * records, it is just slower or subtly wrong, and nothing throws.
 *
 * 1. **Codec order.** VP9 has no hardware encoder on this class of machine; it
 *    is libvpx on the CPU. H.264 and HEVC do. Reverting to a WebM-first
 *    preference costs frames and produces no error.
 *
 * 2. **VP8 must not come back.** It is the obvious cheap fix and it is wrong:
 *    faster below ~2 MP, then off a cliff between 1964 and 2048 px wide — 7.7
 *    fps against VP9's 26.8 at 2048x1280, 3.2 against 21.6 at 1440p (PR #72).
 *    Since v0.21.0 ships 1440p and 4K presets, re-promoting VP8 would be a 7x
 *    regression at a headline resolution, sold as a speed-up. A future reader
 *    who has not read PR #72 will find "VP8 is cheaper than VP9" in any codec
 *    reference and believe it. This check is the argument's memory.
 *
 * 3. **The extension must follow the container.** Changing the preference to
 *    MP4 while leaving `download="...webm"` produces a file that some editors
 *    open and some silently refuse — and it looks like a codec problem, not a
 *    naming one.
 *
 * 4. **The record resolution must stay decoupled.** The whole point of the
 *    intermediate canvas is that recording cost stops tracking window size.
 *    Re-pointing the Record select at output.resolution restores the old
 *    behaviour and, again, nothing errors.
 *
 * 5. **The audio tap must stay post-limiter.** `engine.node` IS the limiter's
 *    output (audio blueprint 8.6). Tapping anywhere else records a signal that
 *    is not the one the audience heard, and an un-limited one can clip the file
 *    while the monitor sounded fine.
 *
 * Source-text census, so it MUST run against sanitized source — and here that
 * is not a nicety. The recorder's comments QUOTE the strings this audit
 * forbids, at length, while explaining why they are gone: a naive scan reports
 * `vp8,opus` in the very file that removed it. Same trap as LEARNED 2026-08-12.
 *
 * Where a check can ask about structure rather than spelling it does
 * (LEARNED 2026-08-15): the codec order is decided by PARSING the preference
 * list and comparing positions, not by regexing for an arrangement of tokens.
 *
 * Run:  node tests/audit-recorder.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { sanitizeSource, calibrateSanitizer } from './lib/sanitize-source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); failures++; }
};

console.log('\nOutput recorder audit\n');

// ── 0. Calibrate the sanitizer ─────────────────────────────────────────────
// Over-blanking would make every census below vacuously true, and that failure
// mode is silence. It matters doubly here: the checks are mostly ABSENCE
// checks, which a sanitizer that blanked the whole file would pass perfectly.
console.log('Sanitizer calibration:');
calibrateSanitizer(check);

// `blankStrings: false` — comments go, string BODIES stay. This audit's
// subject matter IS string literals: codec mime types and parameter ids. The
// default mode blanks them, which made every census below find nothing and
// then pass, because "no VP8 candidate" is trivially true of an empty list.
// Comments are still removed, and comments were the actual trap: the recorder
// documents at length why `vp8,opus` and `video/webm` are gone, naming both.
const readCode = (rel) =>
  sanitizeSource(readFileSync(join(root, rel), 'utf8'), { blankStrings: false });

const main = readCode('src/main.js');

// Prove that mode does what this audit needs, in both directions. Without
// this, a change to the sanitizer's defaults would quietly re-empty the census.
console.log('\nSanitizer mode is fit for a string-literal census:');
check('string bodies survive', /["'`]video\/mp4/.test(main),
  'the codec census cannot see mime types; every check below is vacuous.');
check('comment bodies are still blanked',
  !/VP8 is deliberately absent/.test(main),
  'the recorder\'s own prose names the codecs this audit forbids — leaving\n' +
  '       comments in place makes the VP8 check fail on correct code.');

// The sanitizer blanks comment bodies but preserves line count, so a check that
// the recorder code is still THERE keeps the absence checks honest.
console.log('\nThe recorder is still present to audit:');
const mimeFn = main.match(/function\s+_recMimeType\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
check('_recMimeType() located', !!mimeFn,
  'the codec preference moved or was renamed; this audit is watching nothing.');

// ── 1. Codec preference order ──────────────────────────────────────────────
// Parse the list, then ask about POSITIONS. Asserting "mp4 appears before
// webm" as a regex over the raw text would be satisfied by a comment, and
// would break the moment the list was reformatted across lines.
console.log('\nCodec preference order:');

// TWO lists, not one: the with-audio branch and the video-only branch. A flat
// census over the whole function concatenates them, so branch 2's MP4 entries
// land after branch 1's WebM ones and the ordering check fails on correct
// code. Each branch is a preference order in its own right and each has to be
// audited as one — a regression could easily touch only the fallback branch.
const lists = mimeFn
  ? [...mimeFn[1].matchAll(/\[([\s\S]*?)\]/g)]
      .map(m => [...m[1].matchAll(/["'`](video\/[^"'`]+)["'`]/g)].map(x => x[1]))
      .filter(l => l.length > 0)
  : [];

check('both preference lists were found', lists.length === 2,
  `found ${lists.length}. _recMimeType offers one order with audio and one\n` +
  '       without; if there is now some other number of them, the per-branch\n' +
  '       checks below are not covering what they claim to.');

// Flattened, for the checks that are about membership rather than order.
const types = lists.flat();

check('the preference list is non-empty', types.length > 0,
  'no video/* candidates found inside _recMimeType — either the list moved or\n' +
  '       the sanitizer ate it. Either way the order below is unverified.');

const isMp4 = t => t.startsWith('video/mp4');
const isWebm = t => t.startsWith('video/webm');

// Every ordering check is guarded on a non-empty list. Written without that
// guard they PASSED on the empty census this audit produced in its first run —
// "every MP4 precedes every WebM" is trivially true of no candidates at all,
// which is the fail-open shape LEARNED 2026-08-15 is about: the check reported
// all-clear at exactly the moment it could see nothing.
lists.forEach((list, n) => {
  const branch = `branch ${n + 1} (${list.length} candidates)`;

  check(`${branch}: the first candidate is MP4`, isMp4(list[0] ?? ''),
    `got \`${list[0]}\`. H.264/HEVC in MP4 are the only codecs here with a\n` +
    '       hardware encoder on this hardware; a WebM-first order silently gives\n' +
    '       up frames. Probed capability table: advisory section 2.');

  const firstWebm = list.findIndex(isWebm);
  const lastMp4 = list.map(isMp4).lastIndexOf(true);
  check(`${branch}: every MP4 candidate precedes every WebM candidate`,
    list.length > 0 && (firstWebm === -1 || lastMp4 < firstWebm),
    `order was: ${list.join(' -> ') || '(nothing found)'}\n` +
    '       WebM is the FALLBACK tier, not a peer.');

  const l51 = list.findIndex(t => t.includes('avc1.640033'));
  const l50 = list.findIndex(t => t.includes('avc1.640032'));
  check(`${branch}: H.264 level 5.1 is offered before level 5.0`,
    l51 !== -1 && l50 !== -1 && l51 < l50,
    'L5.0 is REFUSED at 4K (VideoEncoder.isConfigSupported, probed headed in\n' +
    '       Chrome 151). Offering it first caps recording below the 4K preset\n' +
    '       the app ships.');

  check(`${branch}: VP9 is present as the software fallback`,
    list.some(t => t.includes('vp9')),
    'removing it entirely leaves no codec at all on a browser without MP4\n' +
    '       support. It is retired as FIRST choice, not deleted.');
});

// ── 2. VP8 stays out ───────────────────────────────────────────────────────
// Stated as its own check rather than folded into the ordering one, because
// "VP8 is ranked correctly" and "VP8 is absent" are different claims and only
// the second one is the decision PR #72 actually made.
console.log('\nVP8 does not come back:');

check('no VP8 candidate in the recorder preference list',
  types.length > 0 && !types.some(t => t.includes('vp8')),
  `order was: ${types.join(' -> ')}\n` +
  '       FIX: remove it. VP8 is 7.7 fps against VP9\'s 26.8 at 2048x1280 and\n' +
  '       3.2 against 21.6 at 1440p on this machine (PR #72, WebCodecs, 8 Mbps,\n' +
  '       three repeats a cell). It wins only below ~2 MP, which is the region\n' +
  '       every recording measured BEFORE the 1440p/4K presets shipped happened\n' +
  '       to sit in. If you are re-adding it because a codec reference says it\n' +
  '       is cheaper: it is, and that is not the question.');

// ── 3. The extension follows the container ─────────────────────────────────
console.log('\nThe saved file is named for what was written:');

const onstop = main.match(/mediaRecorder\.onstop\s*=\s*\(\)\s*=>\s*\{([\s\S]*?)\n      \}/);
check('the onstop handler was located', !!onstop,
  'the save path moved; the naming checks below are unverified.');

if (onstop) {
  const body = onstop[1];
  check('the container is read back off the recorder',
    /mediaRecorder\.mimeType/.test(body),
    'MediaRecorder may write a type other than the one requested. Assuming\n' +
    '       the requested one is how an MP4 payload ends up named .webm.');
  check('the download extension is not a hardcoded literal',
    !/download\s*=\s*[`"'][^`"']*\.(webm|mp4)[`"']/.test(body),
    'the extension must be derived from the actual mimeType, not written in.');
  check('the Blob type is not a hardcoded container',
    !/new Blob\([^)]*type:\s*["'`]video\/(webm|mp4)["'`]/.test(body),
    'a Blob labelled video/webm holding H.264 misleads every consumer of it.');
}

// ── 4. Record resolution is decoupled from display resolution ──────────────
console.log('\nRecord resolution is independent of output.resolution:');

const ps = readCode('src/controls/ParameterSystem.js');

check('output.recResolution is registered',
  /id:\s*["'`]output\.recResolution["'`]/.test(ps),
  'the record target is a parameter so it can be saved, recalled and mapped.');

// The bug this guards is specific and was the shipped state for two releases:
// the Record select wrote the SAME param as Display, so choosing a record size
// silently changed what the audience saw.
const recSelBlock = main.match(/const recSel = _ioSel\(\);([\s\S]*?)ioOutBlock\.appendChild\(_ioRow\("Record"/);
check('the Record select block was located', !!recSelBlock,
  'the I/O panel wiring moved; the decoupling check is unverified.');

if (recSelBlock) {
  const body = recSelBlock[1];
  check('the Record select does not write output.resolution',
    !/ps\.set\(\s*["'`]output\.resolution["'`]/.test(body),
    'FIX: this is the exact bug the control shipped with — "Record" and\n' +
    '       "Display" wrote one param, so a record size changed the live output.');
  check('the Record select writes output.recResolution',
    /ps\.set\(\s*["'`]output\.recResolution["'`]/.test(body),
    'a select that writes nothing is decoupled and also useless.');
}

check('the capture surface is chosen from output.recResolution',
  /_recSurface[\s\S]{0,600}?output\.recResolution/.test(main),
  'the record path must consult the record resolution, not the display one.');

// A fixed record size is pointless if the bitrate is still computed from the
// display canvas — the encoder would be sized for the wrong picture.
check('the bitrate is computed from the captured surface',
  /_recVideoBitrate\(\s*surface\.width\s*,\s*surface\.height\s*\)/.test(main),
  'passing canvas.width here sizes the bitrate to the WINDOW while the\n' +
  '       encoder sees the record canvas — starved or wasteful, never right.');

// ── 5. The blit respects render gating ─────────────────────────────────────
// If the copy ran on every rAF callback rather than every RENDERED frame, the
// file would contain duplicate frames whenever midisync/autosync gated the
// loop — which reads as the recorder being fine and the instrument stuttering.
console.log('\nThe record blit follows the render loop, not the rAF clock:');

const renderFn = main.match(/function\s+render\s*\(now\)\s*\{([\s\S]*?)\n  \}\n\n  requestAnimationFrame\(render\)/);
check('the render loop was located', !!renderFn,
  'the loop moved; the gating check below is unverified.');

if (renderFn) {
  const body = renderFn[1];
  const blitAt = body.indexOf('_recBlit()');
  const gateAt = body.indexOf('if (!shouldRender) return');
  const capAt = body.indexOf('if (_captureMode) return');
  check('_recBlit() is called from the render loop', blitAt !== -1,
    'without it the record canvas never updates and the file is one frozen frame.');
  check('_recBlit() runs after the midisync/autosync gate',
    blitAt !== -1 && gateAt !== -1 && blitAt > gateAt,
    'a frame the instrument chose NOT to draw must not become a frame in the\n' +
    '       file. Blitting before the gate records the rAF clock, not the work.');
  check('_recBlit() runs after the capture-mode early return',
    blitAt !== -1 && capAt !== -1 && blitAt > capAt,
    'frame-capture mode steps the loop explicitly; the recorder must not\n' +
    '       sample it.');
}

// ── 5b. No recorder asks for a chunk cadence ───────────────────────────────
// The single largest frame-rate win in this subsystem, and the easiest to undo
// by copying an example: every MediaRecorder tutorial passes a timeslice, and
// it looks like a streaming nicety. Measured here it costs a 120-190 ms stall
// on a ~0.5 s period — 100 ms takes stall from the first 8-second window while
// no-timeslice takes hold 56-58 fps. Nothing in this app consumes chunks: both
// recorders read their array only in onstop.
console.log('\nNo recorder passes a timeslice to start():');

for (const rel of ['src/main.js', 'src/io/ClipLibrary.js']) {
  const src = readCode(rel);
  // Match .start( on a MediaRecorder-ish receiver, then ask whether it was
  // given an argument. Asking the structure, not the spelling, so a renamed
  // variable or a reformat does not silently stop covering it.
  const calls = [...src.matchAll(/\b(\w*(?:[rR]ecorder|\bmr)\w*)\.start\s*\(([^)]*)\)/g)];
  check(`${rel}: a recorder start() call was found`, calls.length > 0,
    'the census found nothing — either the recorder moved or the sanitizer\n' +
    '       over-blanked, and the timeslice check below is vacuous.');
  for (const c of calls) {
    check(`${rel}: ${c[1]}.start() is called with no timeslice`,
      c[2].trim() === '',
      `got \`${c[1]}.start(${c[2].trim()})\`.\n` +
      '       FIX: delete the argument. A timeslice makes MediaRecorder deliver\n' +
      '       chunks on a cadence, and that cadence costs a periodic stall worth\n' +
      '       ~12 fps. Nothing reads the chunks before onstop, so the cadence\n' +
      '       buys nothing. If a streaming consumer is ever added, this check is\n' +
      '       the right place to argue with — measure the stall first.');
  }
}

// ── 6. The audio tap has not moved ─────────────────────────────────────────
// Carried over from the audio-track work (commit e86fdf6) rather than left to
// the audio audits: this is the recorder's copy of the decision, and the
// recorder is what a codec change touches.
console.log('\nThe audio tap is still post-limiter:');

const tapFn = main.match(/function\s+_attachRecordAudio\s*\([^)]*\)\s*\{([\s\S]*?)\n  \}/);
check('_attachRecordAudio() located', !!tapFn,
  'the audio tap moved or was removed; recordings may be silent.');

if (tapFn) {
  const body = tapFn[1];
  check('it taps engine.node (the limiter output)',
    /_recAudioFrom\s*=\s*eng\.node/.test(body),
    'engine.node IS the limiter output (audio blueprint 8.6). Tapping before\n' +
    '       it records a signal the audience never heard, and one that can clip\n' +
    '       the file while the monitor sounded clean.');
  check('it refuses to add a track when the engine is not running',
    /if\s*\(!eng\?\.ctx\s*\|\|\s*!eng\.node\)\s*return false/.test(body),
    'a suspended engine contributes digital silence, which is WORSE than no\n' +
    '       track: it looks like the audio was captured and came out empty.');
}

// ── Verdict ────────────────────────────────────────────────────────────────
console.log(
  '\nThe rule: the recorder\'s codec, container, resolution and audio tap are\n' +
  'each a measured decision. Every one of them fails silently — the file still\n' +
  'records, it is just slower, mis-named, window-sized or not what was heard.\n',
);

if (failures) {
  console.error(`${failures} FAILURE(S)\n`);
  process.exit(1);
}
console.log('All recorder checks passed.\n');
