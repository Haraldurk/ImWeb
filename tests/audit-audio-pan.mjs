/**
 * The spectral writer's pan image (§8.14), measured on the samples it produced.
 *
 * §8.10 deferred this with a sentence that set the terms:
 *
 * > *"a second picture assigning each row a stereo position, and it is a second
 * > upload with its own meaning rather than a flag on this one"*
 *
 * Two claims follow from "second upload", and both are the kind that fail
 * silently rather than loudly:
 *
 * 1. **A render with no pan image is bit-for-bit what it was before.** The pan
 *    path is a second loop, not a branch inside the old one, and the whole point
 *    of that is that adding stereo cannot have moved mono. Every project that
 *    ever rendered has to re-render identically.
 * 2. **The positions mean what the picture says.** A pan image flipped, mirrored
 *    or scaled wrong still sounds like music — it just comes out of the wrong
 *    side — so nothing about it is self-evident from listening once. Signs and
 *    axes are pinned here for exactly that reason.
 *
 * Measured rather than asserted, for `audit-audio-spectral.mjs`'s reason: every
 * claim here is about sound, and the browser pane cannot be trusted to run
 * `process()` at all. The worklet has zero imports (§4.1), so it instantiates in
 * Node and is driven quantum by quantum.
 *
 * Run:  node tests/audit-audio-pan.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { PROTO_VERSION, REFUSE, CLIENT_TO_ENGINE } from '../src/audio/protocol.js';
import {
  buildPitches, imageFromLuma, boxAverage, buildPan, PAN, PAN_MODES,
  lumaFromRGBA, chromaFromRGBA,
} from '../src/audio/spectral-image.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const SR = 48000;
globalThis.sampleRate = SR;
globalThis.AudioWorkletProcessor = class {
  constructor() {
    this.port = { onmessage: null, postMessage: (m) => this.__sent.push(m) };
    this.__sent = [];
  }
};
let Processor = null;
globalThis.registerProcessor = (_name, cls) => { Processor = cls; };
await import(`file://${resolve(root, 'src/audio/engine/tape-processor.js')}`);
if (!Processor) { console.error('the worklet did not register a processor'); process.exit(1); }

// ── harness ────────────────────────────────────────────────────────────────

function makeEngine({ tapeSeconds = 2 } = {}) {
  const p = new Processor();
  const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
  send('/engine/hello', PROTO_VERSION);
  send('/engine/tape/alloc', tapeSeconds);
  // Partitions come up ZERO-LENGTH — the client lays them out (§4.3), and a
  // harness that forgets gets `render 0..4800 leaves partition 0 (0..0)` and a
  // tape of silence that looks exactly like a broken renderer.
  send('/part/0/bounds', 0, p._length);
  for (const ch of p._tape) ch.fill(0);
  p.__sent.length = 0;
  const out = [new Float32Array(128), new Float32Array(128)];
  const runJob = (id, cap = 40000) => {
    for (let q = 0; q < cap; q++) {
      p.process([[]], [out]);
      if (p.__sent.some((m) => m.a === `/job/${id}/done` || m.a === `/job/${id}/error`)) {
        return q + 1;
      }
    }
    return -1;
  };
  const refusals = () => p.__sent.filter((m) => m.a === '/engine/refuse');
  const clear = () => { p.__sent.length = 0; };
  return { p, send, runJob, refusals, clear, out };
}

const rms = (buf, a, b) => {
  let s = 0;
  for (let i = a; i < b; i++) s += buf[i] * buf[i];
  return Math.sqrt(s / (b - a));
};
const peak = (buf, a, b) => {
  let m = 0;
  for (let i = a; i < b; i++) { const v = Math.abs(buf[i]); if (v > m) m = v; }
  return m;
};

/**
 * Render one image, optionally with a pan image, and hand back both channels
 * over the written span. `len` is short on purpose — these are level and
 * balance measurements, not tuning ones.
 */
function render({ rows = 4, frames = 4, mag, pan = null, len = 4800 }) {
  const e = makeEngine();
  const pitches = buildPitches(0, 220, rows, SR);
  e.send('/spec/0/pitches', Float32Array.from(pitches).buffer);
  e.send('/spec/0/data', rows, frames, Float32Array.from(mag).buffer);
  if (pan) e.send('/spec/0/pan', rows, frames, Float32Array.from(pan).buffer);
  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, len, 1);
  const quanta = e.runJob(1);
  return {
    e, quanta,
    L: e.p._tape[0].slice(0, len),
    R: e.p._tape[1].slice(0, len),
    done: e.p.__sent.some((m) => m.a === '/job/1/done'),
  };
}

/** All rows lit equally — a chord, so the balance is easy to read. */
const flat = (rows, frames, v = 1) => new Float32Array(rows * frames).fill(v);
/** One constant pan position everywhere. */
const panAt = (rows, frames, p) => new Float32Array(rows * frames).fill(p);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe protocol says the pan image exists, and says which version has it');
{
  check('/spec/<n>/pan is declared', !!CLIENT_TO_ENGINE['/spec/<n>/pan']);
  check('with the same signature as /spec/<n>/data',
    CLIENT_TO_ENGINE['/spec/<n>/pan'] === CLIENT_TO_ENGINE['/spec/<n>/data'],
    `${CLIENT_TO_ENGINE['/spec/<n>/pan']} vs ${CLIENT_TO_ENGINE['/spec/<n>/data']}`);
  check('PROTO_VERSION was bumped past the corpus step', PROTO_VERSION >= 5, `${PROTO_VERSION}`);
  // Bumped in protocol.js and NOT in the worklet's own copy, twice running, in
  // steps 8 and 9 — 13 audit failures each time, all of them the handshake.
  const eng = read('src/audio/engine/tape-processor.js');
  const m = /const PROTO_VERSION = (\d+)/.exec(eng);
  check('and the worklet agrees about it', m && Number(m[1]) === PROTO_VERSION,
    `worklet says ${m?.[1]}, protocol says ${PROTO_VERSION}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe modes are client-side, and their axes are pinned');
{
  check('PAN and PAN_MODES agree',
    PAN_MODES[PAN.OFF] === 'Off' && PAN_MODES[PAN.COLOUR] === 'Colour'
      && PAN_MODES[PAN.SPREAD] === 'Spread' && PAN_MODES[PAN.SWEEP] === 'Sweep',
    PAN_MODES.join(','));
  check('Off is index 0, so the default is the pre-§8.14 behaviour', PAN.OFF === 0);

  // The engine must not be able to express a mode. §4.5 makes the same split for
  // scales, and it is the reason a fifth mode needs no protocol bump.
  const eng = read('src/audio/engine/tape-processor.js');
  check('the engine never learns a mode name',
    !/Colour|Spread|Sweep|PAN_MODES/.test(eng));

  const sp = buildPan(PAN.SPREAD, 4, 3, 1);
  check('Spread puts the lowest row hard left and the highest hard right',
    sp[0] === -1 && sp[3] === 1, `${sp[0]} .. ${sp[3]}`);
  check('and does the same in every frame',
    sp[0] === sp[4] && sp[3] === sp[7]);

  const sw = buildPan(PAN.SWEEP, 2, 3, 1);
  check('Sweep travels left to right across the render',
    sw[0] === -1 && sw[4] === 1, `${sw[0]} .. ${sw[4]}`);
  check('and does the same on every row', sw[0] === sw[1] && sw[4] === sw[5]);

  // Arbitrary but permanent: a later flip would silently mirror every project
  // authored against it.
  const rgba = new Uint8ClampedArray([0, 0, 255, 255, 255, 0, 0, 255]);
  const chroma = chromaFromRGBA(rgba, 2, 1);
  const luma = lumaFromRGBA(rgba, 2, 1);
  const col = buildPan(PAN.COLOUR, 1, 2, 1, { chroma, luma, width: 2, height: 1 });
  check('Colour puts blue left and red right', col[0] === -1 && col[1] === 1,
    `blue ${col[0]}, red ${col[1]}`);

  check('width scales the extremes toward centre',
    buildPan(PAN.SPREAD, 4, 1, 0.5)[3] === 0.5);
  check('Off builds nothing', buildPan(PAN.OFF, 4, 4, 1) === null);
  check('and so does a width of zero — the two mean the same to the render',
    buildPan(PAN.SPREAD, 4, 4, 0) === null);
  check('Colour with no colour to read builds nothing rather than centring',
    buildPan(PAN.COLOUR, 4, 4, 1, { chroma: null }) === null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nColour asks where the SOUND is, not where the pixels are');
{
  // One cell, 4 pixels: a single bright red pixel and three black ones. An
  // unweighted average reads +0.25 — the same stroke would drift toward centre
  // purely because it is surrounded by more darkness. Luma-weighted reads +1,
  // because the black pixels make no sound to place.
  const rgba = new Uint8ClampedArray([
    255, 0, 0, 255, 0, 0, 0, 255,
    0, 0, 0, 255, 0, 0, 0, 255,
  ]);
  const chroma = chromaFromRGBA(rgba, 2, 2);
  const luma = lumaFromRGBA(rgba, 2, 2);
  const p = buildPan(PAN.COLOUR, 1, 1, 1, { chroma, luma, width: 2, height: 2 });
  check('a lone bright stroke keeps its position against a black background',
    p[0] > 0.9, `${p[0].toFixed(3)} — unweighted would be about 0.25`);

  const unweighted = boxAverage(chroma, 2, 2, 1, 1);
  check('and the unweighted average really would have drifted',
    unweighted[0] < 0.5, `${unweighted[0].toFixed(3)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\none y-flip, shared — a pan image upside down is inaudible as a fault');
{
  // Two copies of the flip is CLAUDE.md's warp-axis section in miniature. If pan
  // and magnitude disagreed about which way up the picture is, every stroke
  // would come out on the wrong side while sounding otherwise perfect.
  const w = 2, h = 2;
  const src = Float32Array.from([1, 1, 0, 0]);      // bright TOP row
  const viaBox = boxAverage(src, w, h, 2, 1);
  const viaImage = imageFromLuma(src, w, h, 2, 1, { gamma: 1, floor: 0 });
  check('boxAverage puts the top of the picture in the HIGH row',
    viaBox[1] === 1 && viaBox[0] === 0, `${viaBox[0]}, ${viaBox[1]}`);
  check('and imageFromLuma agrees, because it is the same code',
    viaImage[1] === viaBox[1] && viaImage[0] === viaBox[0]);
  check('imageFromLuma still applies its floor and gamma on top',
    imageFromLuma(Float32Array.from([0.5, 0.5, 0.5, 0.5]), w, h, 1, 1,
      { gamma: 2, floor: 0 })[0] === 0.25);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe render places the sound where the image says');
{
  const rows = 4, frames = 2;
  const mag = flat(rows, frames);

  const left = render({ rows, frames, mag, pan: panAt(rows, frames, -1) });
  check('a hard-left image completes', left.done && left.quanta > 0);
  check('and puts the sound in the left channel',
    rms(left.L, 0, left.L.length) > 0.05
      && rms(left.R, 0, left.R.length) < 1e-6,
    `L ${rms(left.L, 0, 4800).toFixed(4)}, R ${rms(left.R, 0, 4800).toFixed(6)}`);

  const right = render({ rows, frames, mag, pan: panAt(rows, frames, 1) });
  check('hard right is the mirror of it',
    rms(right.R, 0, 4800) > 0.05 && rms(right.L, 0, 4800) < 1e-6,
    `L ${rms(right.L, 0, 4800).toFixed(6)}, R ${rms(right.R, 0, 4800).toFixed(4)}`);
  check('and the two sides carry the same level',
    Math.abs(rms(left.L, 0, 4800) - rms(right.R, 0, 4800)) < 1e-6);

  const mid = render({ rows, frames, mag, pan: panAt(rows, frames, 0) });
  // EXACTLY equal, not nearly. The gain table has to be odd-sized for this: with
  // an even one the true centre falls between entries and truncation leans the
  // mix 0.15% left — inaudible, and still wrong in the one place a listener has
  // a reference for.
  check('centre is bit-identical in both channels',
    mid.L.every((v, i) => v === mid.R[i]),
    'an even-sized pan table fails exactly here');
  // Equal power, not linear: a linear law would put centre at 0.5 of the hard
  // level, so a centred stroke would be 3 dB quieter than the same stroke pushed
  // to one side — the picture changing loudness while claiming to change place.
  const ratio = rms(mid.L, 0, 4800) / rms(left.L, 0, 4800);
  check('and sits at 1/√2 of a hard-panned side, which is equal power',
    Math.abs(ratio - Math.SQRT1_2) < 0.01,
    `${ratio.toFixed(4)}, linear panning would be 0.5`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nno pan image renders exactly what it always did');
{
  const rows = 4, frames = 2;
  const mag = flat(rows, frames);
  const mono = render({ rows, frames, mag });
  check('a render with no pan image still completes', mono.done);
  check('and is identical in both channels',
    mono.L.every((v, i) => v === mono.R[i]));

  // The claim the split loop exists to protect. A pan image of all zeroes is
  // NOT the same thing — equal power at centre is 1/√2, not 1 — so "mono" has
  // to mean "no image", and this is what says the two paths did not merge.
  const centred = render({ rows, frames, mag, pan: panAt(rows, frames, 0) });
  check('and is LOUDER than a centred pan image, because it is a different path',
    rms(mono.L, 0, 4800) > rms(centred.L, 0, 4800) * 1.4,
    `mono ${rms(mono.L, 0, 4800).toFixed(4)} vs centred ${rms(centred.L, 0, 4800).toFixed(4)}`);

  // Determinism: the seeded phases (SPEC_SEED) mean the same image renders to
  // the same samples twice, so a regression in the mono path is exactly
  // detectable rather than approximately.
  const again = render({ rows, frames, mag });
  check('the mono path is deterministic sample for sample',
    mono.L.every((v, i) => v === again.L[i]));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe normalization still cannot clip');
{
  const rows = 16, frames = 2;
  // Every row lit at full — the worst case phase 0 measures.
  const mag = flat(rows, frames);
  for (const p of [-1, -0.5, 0, 0.5, 1]) {
    const r = render({ rows, frames, mag, pan: panAt(rows, frames, p) });
    check(`pan ${p}: neither channel exceeds full scale`,
      peak(r.L, 0, 4800) <= 1 && peak(r.R, 0, 4800) <= 1,
      `L ${peak(r.L, 0, 4800).toFixed(4)}, R ${peak(r.R, 0, 4800).toFixed(4)}`);
  }
  // The reason it holds: both equal-power gains are ≤ 1, so a channel's sum is
  // bounded by the worst-case column sum that phase 0 already measured. If the
  // gains were ever normalized differently — say to sum to 1 rather than to
  // sum in quadrature — this is the check that would notice.
  const hard = render({ rows, frames, mag, pan: panAt(rows, frames, -1) });
  const mono = render({ rows, frames, mag });
  check('and a hard-panned channel is no louder than the mono render',
    peak(hard.L, 0, 4800) <= peak(mono.L, 0, 4800) + 1e-6,
    `hard ${peak(hard.L, 0, 4800).toFixed(4)} vs mono ${peak(mono.L, 0, 4800).toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nposition is crossfaded between columns, like magnitude is');
{
  // Two columns, hard left then hard right. If position were switched rather
  // than interpolated the balance would jump at the seam; interpolated, the
  // second quarter and third quarter of the render must differ smoothly.
  // ONE row, and that is a measurement decision rather than a simplification.
  // With two partials the render beats, RMS over a short window swings with the
  // beat phase, and the drift at CONSTANT pan (0.13) is larger than the step
  // this check wants to detect — which is how the first draft of it passed on
  // correct code by luck and stayed green under the mutation. One row drifts
  // 0.02 while the sweep travels 1.10.
  const rows = 1, frames = 2;
  const mag = flat(rows, frames);
  const pan = Float32Array.from([-1, 1]);   // frame 0 hard left, frame 1 hard right
  const r = render({ rows, frames, mag, pan, len: 4800 });

  // The crossfade lives in the FIRST HALF: `pos = s·frames/len` reaches the last
  // column at the midpoint and clamps there, so the second half is column 1
  // throughout. A first draft measured across the whole render in quarters and
  // compared neighbouring RMS values — the last two are both hard right and
  // differ only by phase noise, so the ordering it asserted held by luck and a
  // mutation that switched position instead of interpolating it went UNCAUGHT.
  //
  // The noise-free form: with a switch, the right channel is EXACTLY silent for
  // the whole first half, because column 0 is hard left and nothing blends it.
  const half = 2400;
  check('the far channel is not silent while the near column is hard over',
    rms(r.R, 0, half) > 0.01,
    `${rms(r.R, 0, half).toFixed(5)} — a switched position leaves this exactly 0`);

  const w = 300;
  const bal = (a) => rms(r.R, a, a + w) - rms(r.L, a, a + w);
  const steps = [bal(150), bal(1050), bal(1950)];
  check('and the balance travels steadily across that half',
    steps[0] < steps[1] && steps[1] < steps[2],
    steps.map((v) => v.toFixed(3)).join(' → '));
  check('by a margin an order of magnitude above the window noise',
    steps.every((s, i) => i === 0 || s - steps[i - 1] > 0.2),
    `${steps.map((v) => v.toFixed(3)).join(', ')} — constant pan drifts about 0.02`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nuploads are refused where a silent mono render would be worse');
{
  const e = makeEngine();
  const pitches = buildPitches(0, 220, 4, SR);
  e.send('/spec/0/pitches', Float32Array.from(pitches).buffer);

  e.clear();
  e.send('/spec/0/pan', 4, 2, new Float32Array(8).buffer);
  check('pan before an image is refused',
    e.refusals().some((m) => /no image yet/.test(m.v[1])),
    JSON.stringify(e.refusals().map((m) => m.v[1])));

  e.send('/spec/0/data', 4, 2, new Float32Array(8).buffer);
  e.clear();
  e.send('/spec/0/pan', 4, 4, new Float32Array(16).buffer);
  check('a pan image of the wrong shape is refused',
    e.refusals().some((m) => m.v[0] === REFUSE.BAD_RANGE && /pan is 4×4/.test(m.v[1])),
    JSON.stringify(e.refusals().map((m) => m.v[1])));

  e.clear();
  const bad = new Float32Array(8).fill(2);
  e.send('/spec/0/pan', 4, 2, bad.buffer);
  check('a position outside [-1,1] is refused, not clamped',
    e.refusals().some((m) => /outside \[-1, 1\]/.test(m.v[1])),
    JSON.stringify(e.refusals().map((m) => m.v[1])));
  check('and nothing was stored from the bad upload', e.p._spec[0].pan === null);

  // The trap this closes: a client sending 0..1 (a luma image, unshifted) would
  // otherwise get a hard-right mix and no clue why.
  e.clear();
  e.send('/spec/0/pan', 4, 2, new Float32Array(8).fill(0.5).buffer);
  check('a legal image IS stored', e.p._spec[0].pan !== null && e.refusals().length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\na new picture invalidates the old positions');
{
  const e = makeEngine();
  const pitches = buildPitches(0, 220, 4, SR);
  e.send('/spec/0/pitches', Float32Array.from(pitches).buffer);
  e.send('/spec/0/data', 4, 2, new Float32Array(8).fill(1).buffer);
  e.send('/spec/0/pan', 4, 2, new Float32Array(8).fill(-1).buffer);
  check('the pan image is held', e.p._spec[0].pan !== null);

  // SAME SHAPE, so no size check could catch it: the render would place a new
  // picture using the previous one's positions, silently.
  e.send('/spec/0/data', 4, 2, new Float32Array(8).fill(1).buffer);
  check('uploading a new image of the SAME shape drops it anyway',
    e.p._spec[0].pan === null,
    'a size check cannot catch this one — it has to be unconditional');

  e.clear();
  e.send('/spec/0/clear');
  check('clearing the slot clears the pan too', e.p._spec[0].pan === null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\npacing still holds when every row costs twice as much');
{
  const rows = 32, frames = 4;
  const mag = flat(rows, frames);
  const mono = render({ rows, frames, mag, len: 9600 });
  const panned = render({ rows, frames, mag, pan: panAt(rows, frames, -0.5), len: 9600 });
  check('a panned render completes', panned.done && panned.quanta > 0);
  // §8.3's budget is a promise about not making a quantum late, priced in
  // oscillator-samples. A panned row costs about two, so a panned render must
  // take about twice the quanta — if it took the same, the budget stopped
  // meaning what it says and the promise went with it.
  check('and takes about twice the quanta, because it is charged twice',
    panned.quanta > mono.quanta * 1.5,
    `mono ${mono.quanta}, panned ${panned.quanta}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nequal power means the total is the same wherever the image puts it');
{
  // The property, stated correctly. A first draft compared a PANNED total
  // against a MONO one and expected them equal — they are not, and cannot be:
  // the mono path writes the same signal to both channels, which is 3 dB more
  // total power than any pan law that conserves it. What equal power promises
  // is that moving a stroke does not change its loudness, so the comparison is
  // between pan POSITIONS.
  const rows = 8, frames = 2;
  const mag = flat(rows, frames);
  const total = (p) => {
    const r = render({ rows, frames, mag, pan: panAt(rows, frames, p) });
    return Math.hypot(rms(r.L, 0, 4800), rms(r.R, 0, 4800));
  };
  const at = [-1, -0.5, 0, 0.5, 1].map(total);
  const spread = (Math.max(...at) - Math.min(...at)) / at[0];
  check('the total is flat across the whole sweep', spread < 0.01,
    at.map((v) => v.toFixed(4)).join(' '));
  // A linear pan law dips about 30% at centre. This is the check that tells the
  // two apart, and it is the reason the table is cos/sin rather than a lerp.
  check('and centre is not the dip a linear law would give',
    Math.abs(at[2] - at[0]) / at[0] < 0.01,
    `centre ${at[2].toFixed(4)} vs hard ${at[0].toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe client only asks for colour when it needs it');
{
  const main = read('src/main.js');
  const bind = read('src/audio/AudioBinding.js');
  check('imageSource takes a wantChroma flag', /wantChroma = false/.test(main));
  check('and returns null chroma unless asked',
    /chroma: wantChroma \? chromaFromRGBA\(rgba, w, h\) : null/.test(main));
  check('the binding asks only in Colour mode',
    /wantChroma = panMode === PAN\.COLOUR && panWidth > 0/.test(bind));
  check('and sends pan AFTER data, which is the only order that works',
    bind.indexOf('this.engine.specData(0, rows, frames, mag)')
      < bind.indexOf('this.engine.specPan(0, rows, frames, pan)'));
}

console.log(failures === 0
  ? '\n✅ spectral pan image: all checks passed\n'
  : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
