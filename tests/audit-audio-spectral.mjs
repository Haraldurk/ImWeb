/**
 * The spectral writer (§4.5), driven headlessly and measured on the samples it
 * actually produced.
 *
 * Why measured rather than asserted. Every claim this feature makes is about
 * sound: that a row lands on the pitch the scale says it does, that a render
 * does not clip, that pacing it across quanta does not put a seam in the tone.
 * None of those can be checked by reading the source, and none of them can be
 * checked in Claude Code's browser pane either — it runs Chrome with audio
 * disabled often enough that `process()` never firing is the normal case, and a
 * paced job that lives inside `process()` then never completes while every
 * port-based check still passes. The worklet has zero imports by construction
 * (§4.1), so it instantiates in Node with three globals stubbed and can be
 * driven quantum by quantum. That is the only route that has held.
 *
 * The checks below were calibrated by MUTATION — each one was re-run against a
 * deliberately broken engine to confirm it goes red. A check that stays green
 * when the code is wrong is decoration, and about a third of these were that on
 * first writing.
 *
 * Run:  node tests/audit-audio-spectral.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTO_VERSION, REFUSE } from '../src/audio/protocol.js';
import { SCALES, buildPitches, imageFromLuma, lumaFromRGBA } from '../src/audio/spectral-image.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

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

// ── measurement ────────────────────────────────────────────────────────────

/**
 * Frequency of a (near-)pure tone, from the interpolated positions of its
 * positive-going zero crossings. Accurate to a fraction of a hertz over a
 * second, which is what makes it able to tell "the scale degree" from "the
 * nearest FFT bin to the scale degree" — 2048-point bins are 23 Hz apart at
 * 48 kHz, and a check that could not see 23 Hz could not see the difference
 * between this design and the one it was corrected away from.
 */
function toneHz(buf) {
  let first = -1, last = -1, n = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) {
      const frac = buf[i - 1] === buf[i] ? 0 : -buf[i - 1] / (buf[i] - buf[i - 1]);
      const pos = i - 1 + frac;
      if (first < 0) first = pos; else { last = pos; n++; }
    }
  }
  return n < 1 ? 0 : (n * SR) / (last - first);
}

/** Goertzel magnitude at `hz`, normalized so a unit sine reads about 1. */
function energyAt(buf, hz) {
  const w = (2 * Math.PI * hz) / SR;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < buf.length; i++) {
    const s0 = buf[i] + coeff * s1 - s2;
    s2 = s1; s1 = s0;
  }
  const power = s1 * s1 + s2 * s2 - coeff * s1 * s2;
  return (2 * Math.sqrt(Math.max(0, power))) / buf.length;
}

const cents = (a, b) => 1200 * Math.log2(a / b);

// ── harness ────────────────────────────────────────────────────────────────

function makeEngine({ tapeSeconds = 4, fill = 0 } = {}) {
  const p = new Processor();
  const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
  send('/engine/hello', PROTO_VERSION);
  send('/engine/tape/alloc', tapeSeconds);
  if (fill !== null) for (const ch of p._tape) ch.fill(fill);
  p.__sent.length = 0;
  const out = [new Float32Array(128), new Float32Array(128)];
  const run = (n = 1) => { for (let q = 0; q < n; q++) p.process([[]], [out]); };
  /** Run until the job sends a terminal message, or give up. Returns quanta. */
  const runJob = (id, cap = 20000) => {
    for (let q = 0; q < cap; q++) {
      p.process([[]], [out]);
      if (p.__sent.some((m) => m.a === `/job/${id}/done` || m.a === `/job/${id}/error`)) {
        return q + 1;
      }
    }
    return -1;
  };
  const msgs = (a) => p.__sent.filter((m) => m.a === a);
  const refusals = () => p.__sent.filter((m) => m.a === '/engine/refuse');
  const clear = () => { p.__sent.length = 0; };
  /** Load a slot and point spectral zone 0 at partition `part`. */
  const load = (slot, pitches, mag, rows, frames) => {
    send(`/spec/${slot}/pitches`, Float32Array.from(pitches).buffer);
    send(`/spec/${slot}/data`, rows, frames, Float32Array.from(mag).buffer);
  };
  return { p, send, run, runJob, msgs, refusals, clear, load, out };
}

/** A one-row-per-column image: row `rowOf(f)` lit at magnitude 1. */
function stripeImage(rows, frames, rowOf, mag = 1) {
  const img = new Float32Array(rows * frames);
  for (let f = 0; f < frames; f++) img[f * rows + rowOf(f)] = mag;
  return img;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nscales are a client-side idea (the engine is only told frequencies)');
{
  const chrom = buildPitches(0, 110, 13, SR);
  check('a chromatic octave is 13 degrees ending an octave up',
    chrom.length === 13 && Math.abs(chrom[12] - 220) < 0.001,
    `got ${chrom.length} rows ending at ${chrom[12]}`);
  check('every chromatic step is 100 cents',
    Math.abs(cents(chrom[1], chrom[0]) - 100) < 0.01,
    `${cents(chrom[1], chrom[0]).toFixed(3)} cents`);

  const major = buildPitches(1, 110, 8, SR);
  check('a major scale steps 2,2,1,2,2,2,1 semitones',
    [2, 2, 1, 2, 2, 2, 1].every((st, i) =>
      Math.abs(cents(major[i + 1], major[i]) - st * 100) < 0.01),
    major.length ? [...major].map((h) => h.toFixed(1)).join(' ') : 'empty');

  const harm = buildPitches(SCALES.findIndex((s) => s.kind === 'harmonic'), 100, 5, SR);
  check('the harmonic series is integer multiples, not semitones',
    [100, 200, 300, 400, 500].every((h, i) => Math.abs(harm[i] - h) < 0.001),
    [...harm].join(' '));

  // The check that matters: a table is allowed to come back SHORT. A row above
  // Nyquist does not go silent, it folds down and lands on a pitch that is
  // supposed to be there — the failure then reads as "the scale is wrong at the
  // top", which is much harder to recognise than "I ran out of rows".
  const tall = buildPitches(0, 110, 200, SR);
  check('the pitch table stops below Nyquist rather than running past it',
    tall.length < 200 && tall[tall.length - 1] < SR / 2,
    `${tall.length} rows, top ${tall[tall.length - 1]}`);
  check('a low sample rate shortens the table further',
    buildPitches(0, 110, 200, 8000).length < tall.length,
    'the ceiling must depend on the sample rate, not be a constant');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe picture becomes the image (axis, averaging, floor)');
{
  // 4 wide, 4 tall. Top-left quadrant bright, everything else black.
  const w = 4, h = 4;
  const luma = new Float32Array(w * h);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) luma[y * w + x] = 1;
  const img = imageFromLuma(luma, w, h, 4, 4, { gamma: 1, floor: 0 });
  // Frame-major: img[f * rows + r]. The bright quadrant is at the TOP of the
  // picture and the LEFT, so it must land in HIGH rows of EARLY frames.
  check('screen up is pitch up (row 0 is the bottom of the picture)',
    img[0 * 4 + 3] === 1 && img[0 * 4 + 0] === 0,
    `top row ${img[3]}, bottom row ${img[0]} in frame 0`);
  check('screen left is early in time',
    img[3 * 4 + 3] === 0, `frame 3 top row is ${img[3 * 4 + 3]}, expected silent`);

  // Box averaging, not point sampling. A single lit pixel in a 4-wide source
  // squeezed into 2 frames must survive as half-brightness; a point sample
  // lands on it or misses it entirely.
  const thin = new Float32Array(4);
  thin[1] = 1;
  const avg = imageFromLuma(thin, 4, 1, 1, 2, { gamma: 1, floor: 0 });
  check('downsampling averages the source rather than point-sampling it',
    Math.abs(avg[0] - 0.5) < 1e-6 && avg[1] === 0,
    `frames ${avg[0]}, ${avg[1]} — a point sample would read 0 or 1`);

  const dim = imageFromLuma(Float32Array.from([0.05, 0.5]), 2, 1, 1, 2,
    { gamma: 1, floor: 0.06 });
  check('the floor zeroes near-black and rescales what survives',
    dim[0] === 0 && dim[1] > 0.4 && dim[1] < 0.5,
    `${dim[0]}, ${dim[1].toFixed(4)} — a camera frame is never actually black`);

  const rgba = Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]);
  const lum = lumaFromRGBA(rgba, 2, 1);
  check('luminance is 0..1 from packed RGBA', Math.abs(lum[0] - 1) < 1e-6 && lum[1] === 0,
    `${lum[0]}, ${lum[1]}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\na rendered row sounds at the pitch the scale asked for');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  const pitches = buildPitches(1, 220, 8, SR);   // major scale from 220 Hz

  for (const row of [0, 4, 7]) {
    e.clear();
    e.load(0, pitches, stripeImage(pitches.length, 1, () => row), pitches.length, 1);
    e.send('/zone/spectral/0/render', 0, 0, SR, 100 + row);
    const q = e.runJob(100 + row);
    const buf = e.p._tape[0].subarray(0, SR);
    const measured = toneHz(buf);
    const want = pitches[row];
    check(`row ${row} renders at ${want.toFixed(2)} Hz`,
      q > 0 && Math.abs(cents(measured, want)) < 2,
      `measured ${measured.toFixed(2)} Hz (${cents(measured, want).toFixed(1)} cents off)`);
  }

  // The correction §4.5 needed, stated as a measurement. An inverse FFT rounds
  // every partial to a bin centre — 23.4 Hz apart for a 2048-point transform at
  // 48 kHz — so a scale degree that is not on a bin comes out up to 12 Hz away.
  // 293.66 Hz sits 8.6 Hz from the nearest such bin, so it is exactly the case
  // that separates "the oscillator is at the scale degree" from "the scale
  // degree was quantized onto a linear grid".
  e.clear();
  const d = 293.665;
  e.load(1, [d], [1], 1, 1);
  e.send('/zone/spectral/0/render', 1, 0, SR, 200);
  e.runJob(200);
  const measured = toneHz(e.p._tape[0].subarray(0, SR));
  check('the pitch is the scale degree, not the nearest linear bin to it',
    Math.abs(measured - d) < 0.5,
    `measured ${measured.toFixed(2)} Hz for a requested ${d} Hz`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nenergy goes where the image put it, and nowhere else');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  const pitches = buildPitches(1, 220, 8, SR);
  const rows = pitches.length;
  // Rows 0 and 4 lit, the rest dark.
  const img = new Float32Array(rows);
  img[0] = 1; img[4] = 1;
  e.load(0, pitches, img, rows, 1);
  e.send('/zone/spectral/0/render', 0, 0, SR, 300);
  e.runJob(300);
  const buf = e.p._tape[0].subarray(0, SR);

  const lit0 = energyAt(buf, pitches[0]);
  const lit4 = energyAt(buf, pitches[4]);
  const dark = Math.max(...[1, 2, 3, 5, 6, 7].map((r) => energyAt(buf, pitches[r])));
  check('both lit rows are present', lit0 > 0.3 && lit4 > 0.3,
    `${lit0.toFixed(3)}, ${lit4.toFixed(3)}`);
  check('the unlit rows are 30 dB down on the lit ones',
    dark < Math.min(lit0, lit4) / 30,
    `loudest dark row ${dark.toFixed(5)} vs quietest lit ${Math.min(lit0, lit4).toFixed(3)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe render cannot clip, and cannot leave its region');
{
  const e = makeEngine({ fill: 0.5 });
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  // Every row of a full chromatic table on at once, all at magnitude 1 — the
  // worst case the normalization exists for. Unnormalized this sums to `rows`.
  const pitches = buildPitches(0, 55, 64, SR);
  const rows = pitches.length;
  e.load(0, pitches, new Float32Array(rows).fill(1), rows, 1);
  const base = SR;
  e.send('/zone/spectral/0/render', 0, base, SR, 400);
  const q = e.runJob(400);
  const buf = e.p._tape[0].subarray(base, base + SR);
  let peak = 0, nan = 0;
  for (const v of buf) { if (Number.isNaN(v)) nan++; else peak = Math.max(peak, Math.abs(v)); }
  check('the job finished', q > 0, 'no terminal message inside the cap');
  check('a fully lit image produces no NaN', nan === 0, `${nan} NaN samples`);
  check(`${rows} simultaneous partials still cannot clip`, peak <= 1,
    `peak ${peak.toFixed(4)} — the worst-case column sum is what norm is for`);
  check('it is not merely silent', peak > 0.05, `peak ${peak.toFixed(4)}`);

  check('the sample before the region is untouched', e.p._tape[0][base - 1] === 0.5,
    `${e.p._tape[0][base - 1]} — a render must not write outside what it was given`);
  check('the sample after the region is untouched', e.p._tape[0][base + SR] === 0.5,
    `${e.p._tape[0][base + SR]}`);
  check('both channels were written',
    e.p._tape[1][base + 1000] === e.p._tape[0][base + 1000],
    'a mono render feeds every channel, as /tape/write does');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nit is paced across quanta (§8.3) and does not stop the audio');
{
  const e = makeEngine({ fill: 0.5 });
  e.send('/part/0/bounds', 0, SR * 2);          // playback material
  e.send('/part/1/bounds', SR * 2, SR * 2);     // render target
  e.send('/zone/play/0/part', 0);
  e.send('/engine/glide', 0);
  e.send('/zone/play/0/region', 0, SR);
  e.send('/zone/play/0/on');
  e.send('/zone/spectral/0/part', 1);

  const pitches = buildPitches(0, 55, 64, SR);
  const rows = pitches.length;
  e.load(0, pitches, stripeImage(rows, 8, (f) => f % rows), rows, 8);
  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 500);

  // The pacing claim, as a number. 64 rows × 96000 samples is 6.1 M
  // oscillator-samples against a 65536 budget, so this cannot be fewer than
  // ~93 quanta. An unpaced render — the whole thing inside the message handler,
  // or a budget that resets mid-job — finishes in one, which is precisely the
  // dropout §8.3 says a render writer must never cause.
  let audibleQuanta = 0, silentQuanta = 0, q = 0;
  for (; q < 20000; q++) {
    e.p.process([[]], [e.out]);
    let energy = 0;
    for (const v of e.out[0]) energy += Math.abs(v);
    if (energy > 1) audibleQuanta++; else silentQuanta++;
    if (e.msgs('/job/500/done').length) break;
  }
  check('a long render takes many quanta, not one', q > 90,
    `finished in ${q + 1} quanta — a budget that does not carry across quanta looks like this`);
  check('the job did finish', e.msgs('/job/500/done').length === 1,
    `${e.msgs('/job/500/done').length} done messages`);
  check('playback kept sounding through the whole render', silentQuanta === 0,
    `${silentQuanta} of ${audibleQuanta + silentQuanta} quanta went silent`);

  const prog = e.msgs('/job/500/progress');
  check('progress is reported while it runs', prog.length > 1, `${prog.length} messages`);
  check('progress is on the frame timer, not per quantum (rule 7)',
    prog.length < q / 4, `${prog.length} messages over ${q + 1} quanta`);
  check('progress rises and ends at the total',
    prog.length > 0 && prog.every((m, i) => i === 0 || m.v[0] > prog[i - 1].v[0])
      && prog[prog.length - 1].v[1] === SR * 2,
    prog.map((m) => m.v[0]).join(','));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\ncolumns are crossfaded, not switched');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  // One row, two frames: full in the first, silent in the second. Interpolated,
  // that is a linear fade across the first half of the render, so the amplitude
  // a quarter of the way in is HALF. Switched, it is still full until the
  // halfway point and then gone — which is the staircase that turns a painted
  // glide into a row of discrete steps with a buzz on top.
  e.load(0, [440], [1, 0], 1, 2);
  e.send('/zone/spectral/0/render', 0, 0, SR, 900);
  e.runJob(900);
  const peakNear = (frac) => {
    let peak = 0;
    const c = Math.floor(SR * frac);
    for (let i = c - 400; i < c + 400; i++) peak = Math.max(peak, Math.abs(e.p._tape[0][i]));
    return peak;
  };
  const q1 = peakNear(0.25);
  check('a quarter of the way through a fade-out, the level is half',
    q1 > 0.4 && q1 < 0.6, `peak ${q1.toFixed(3)} — switching columns would read about 1.0`);
  check('and an eighth of the way through it is three quarters',
    Math.abs(peakNear(0.125) - 0.75) < 0.1, `peak ${peakNear(0.125).toFixed(3)}`);
  check('the fade reaches silence by the halfway point', peakNear(0.6) < 0.02,
    `peak ${peakNear(0.6).toFixed(4)}`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\na row that goes quiet and comes back is where it would have been');
{
  // The claim in `_specStep`: phase advances whether or not a row sounds, so a
  // returning row lands where a continuously running oscillator would be. That
  // is measurable rather than merely assertable — render the SAME row twice
  // from the same seed, once sounding throughout and once with a hole in the
  // middle, and compare the tails. If the phase froze while the row was silent,
  // the second render's tail is shifted against the first's.
  const build = (mags) => {
    const e = makeEngine();
    e.send('/part/0/bounds', 0, SR * 4);
    e.send('/zone/spectral/0/part', 0);
    e.load(0, [440], mags, 1, mags.length);
    e.send('/zone/spectral/0/render', 0, 0, SR, 1000);
    e.runJob(1000);
    return e.p._tape[0];
  };
  const solid = build([1, 1, 1, 1, 1, 1, 1, 1]);
  const gapped = build([1, 1, 0, 0, 0, 0, 1, 1]);

  const gapStart = Math.floor(SR * 0.4);
  check('the hole really is silent in the gapped render',
    Math.abs(gapped[gapStart]) < 0.01 && Math.abs(solid[gapStart]) > 0.5,
    `gapped ${gapped[gapStart].toFixed(4)}, solid ${solid[gapStart].toFixed(4)}`);

  let worst = 0;
  for (let i = Math.floor(SR * 0.9); i < SR; i++) {
    worst = Math.max(worst, Math.abs(solid[i] - gapped[i]));
  }
  check('after the gap the two renders are sample-identical', worst < 1e-6,
    `tails differ by up to ${worst.toFixed(5)} — the phase stopped while the row was silent`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nchunking leaves no seam, and the same image renders the same twice');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  // 64 rows so the render is split over dozens of quanta, but only one lit, so
  // the result is a single pure tone whose continuity is measurable.
  const pitches = buildPitches(0, 110, 64, SR);
  const rows = pitches.length;
  const img = new Float32Array(rows);
  img[10] = 1;
  e.load(0, pitches, img, rows, 1);
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 600);
  const q = e.runJob(600);
  check('this render really was chunked', q > 20, `${q} quanta`);

  const buf = e.p._tape[0].subarray(0, SR * 2);
  // A sine of frequency f cannot move more than 2π·f/SR per sample. A phase
  // that restarted at a chunk boundary — the obvious way to get this wrong,
  // since the per-row phase lives on the processor and not in the job — shows
  // up as exactly one sample-to-sample jump far above that.
  const maxSlope = (2 * Math.PI * pitches[10]) / SR * 1.05;
  let worst = 0, worstAt = -1;
  for (let i = 1; i < buf.length; i++) {
    const d = Math.abs(buf[i] - buf[i - 1]);
    if (d > worst) { worst = d; worstAt = i; }
  }
  check('no discontinuity at any chunk boundary', worst <= maxSlope,
    `biggest step ${worst.toFixed(5)} at sample ${worstAt}, ceiling ${maxSlope.toFixed(5)}`);

  const first = Float32Array.from(buf);
  const e2 = makeEngine();
  e2.send('/part/0/bounds', 0, SR * 4);
  e2.send('/zone/spectral/0/part', 0);
  e2.load(0, pitches, img, rows, 1);
  e2.send('/zone/spectral/0/render', 0, 0, SR * 2, 601);
  e2.runJob(601);
  let same = true;
  for (let i = 0; i < first.length; i++) {
    if (first[i] !== e2.p._tape[0][i]) { same = false; break; }
  }
  check('the same image renders to identical samples (§8.9)', same,
    'random initial phases must be SEEDED, or nothing about a render is reproducible');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nrefusals are correlated, so a client waiting on a job is never wedged');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR);
  e.send('/zone/spectral/0/part', 0);
  e.load(0, [440], [1], 1, 1);

  const jobErr = (id) => e.msgs(`/job/${id}/error`);

  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 700);
  check('a render past the partition seam is refused', jobErr(700).length === 1
    && jobErr(700)[0].v[0] === REFUSE.BAD_RANGE,
    'clamping a one-shot destructive write silently renders half of what was asked');
  check('and it is refused on /engine/refuse as well', e.refusals().length === 1);

  e.clear();
  e.send('/zone/spectral/0/unsafe', true);
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 701);
  check('unsafe DOES cross the partition seam (§4.3)', jobErr(701).length === 0,
    'crossing the seam is opt-in, not forbidden');
  e.send('/job/701/cancel');
  e.clear();
  // The seam is opt-in; the end of the buffer is not, and no flag opens it.
  e.send('/zone/spectral/0/render', 0, 0, SR * 5, 702);
  check('unsafe still cannot leave the TAPE', jobErr(702).length === 1,
    `a ${SR * 5}-sample render into a ${SR * 4}-sample tape must be refused`);
  e.send('/zone/spectral/0/unsafe', false);

  e.clear();
  e.send('/zone/spectral/0/render', 9, 0, SR, 703);
  check('a slot that does not exist is refused', jobErr(703).length === 1
    && jobErr(703)[0].v[0] === REFUSE.BAD_RANGE, 'slot 9 is out of range');

  e.clear();
  e.send('/zone/spectral/0/render', 2, 0, SR, 704);
  check('an empty slot is refused', jobErr(704).length === 1
    && jobErr(704)[0].v[0] === REFUSE.BAD_RANGE, 'slot 2 was never uploaded');

  e.clear();
  e.send('/zone/synth/0/render', 0, 0, SR, 705);
  check('a zone type with no renderer is refused, with a job error',
    jobErr(705).length === 1, 'synth zones do not exist yet');

  // The BUSY path, and the thing it protects: the first render must survive.
  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, SR, 706);
  e.send('/zone/spectral/0/render', 0, 0, SR, 707);
  check('a second render is refused BUSY', jobErr(707).length === 1
    && jobErr(707)[0].v[0] === REFUSE.BUSY, 'one destructive write at a time');
  check('the first render is unaffected by the refusal', jobErr(706).length === 0);
  e.send('/spec/0/data', 1, 1, Float32Array.from([0.5]).buffer);
  check('editing the image under a running render is refused',
    e.refusals().some((m) => m.v[0] === REFUSE.BUSY && /being rendered/.test(m.v[1])),
    'there is no snapshot, so the guard is what makes reading the live slot safe');
  e.send('/engine/tape/alloc', 2);
  check('reallocating the tape under a running render is refused',
    e.refusals().some((m) => m.v[0] === REFUSE.LAYOUT_LOCKED),
    'unfinished work on this tape is not something a realloc may silently drop');
  check('the tape was not in fact reallocated', e.p._length === SR * 4);

  // A render counts as active on its partition. `_render` fixed its span in
  // ABSOLUTE samples at accept time, so a relayout does not move the writer with
  // it — it goes on filling where the partition used to be, which after a drag
  // may be inside the NEXT partition's material. The rec/play loop in
  // `_partBounds` cannot catch this: it tests `on` and `gainCur`, and a render
  // writer has neither.
  e.clear();
  e.send('/part/0/bounds', SR, SR);
  check('moving the partition under a running render is refused',
    e.refusals().some((m) => m.v[0] === REFUSE.LAYOUT_LOCKED),
    'the writer would keep filling where the partition was');
  check('the layout did not move', e.p._parts[0].start === 0 && e.p._parts[0].len === SR);
  e.clear();
  e.send('/part/2/bounds', SR * 3, SR);
  check('a partition the render is NOT writing into still moves freely',
    e.refusals().length === 0 && e.p._parts[2].start === SR * 3,
    'the lock is per-slot, exactly as the running-zone lock beside it is');
  const done = e.runJob(706);
  check('and it still completes', done > 0 && e.msgs('/job/706/done').length === 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nevery accepted job ends exactly once');
{
  const e = makeEngine();
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/spectral/0/part', 0);
  const pitches = buildPitches(0, 110, 64, SR);
  e.load(0, pitches, new Float32Array(pitches.length).fill(1), pitches.length, 1);

  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 800);
  e.run(3);
  check('a render in progress has sent no terminal message yet',
    e.msgs('/job/800/done').length === 0 && e.msgs('/job/800/error').length === 0);
  e.send('/job/800/cancel');
  const err = e.msgs('/job/800/error');
  check('cancel terminates the job with CANCELLED', err.length === 1
    && err[0].v[0] === REFUSE.CANCELLED,
    'a quiet /done over a half-written region is the silent-failure shape');
  e.run(50);
  check('cancel really stops the work', e.msgs('/job/800/progress').length <= 1
    && e.msgs('/job/800/done').length === 0);
  check('a cancelled job leaves the tape alone from where it stopped',
    e.p._tape[0][SR * 2 - 1] === 0,
    'what was rendered stays; what was not was never written');

  e.clear();
  e.send('/job/800/cancel');
  check('cancelling a job that is not running is refused, not silent',
    e.refusals().length === 1, 'a no-op reply teaches a client its id was fine');

  // Panic is the one path that ends a render without being asked about it.
  e.clear();
  e.send('/zone/spectral/0/render', 0, 0, SR * 2, 801);
  e.run(3);
  e.send('/engine/panic');
  check('panic terminates a running render', e.msgs('/job/801/error').length === 1,
    'a job left pointing into a freed tape indexes an empty array next quantum');
  e.run(5);
  check('and nothing runs after it', e.msgs('/job/801/done').length === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nuploads that would sound wrong are refused at the upload');
{
  const e = makeEngine();
  const bad = (label, fn, code = REFUSE.BAD_RANGE) => {
    e.clear();
    fn();
    const r = e.refusals();
    check(label, r.length === 1 && r[0].v[0] === code,
      r.length ? `code ${r[0].v[0]}: ${r[0].v[1]}` : 'nothing was refused');
  };

  bad('a pitch at or above Nyquist is refused',
    () => e.send('/spec/0/pitches', Float32Array.from([440, SR / 2]).buffer));
  bad('a zero or negative pitch is refused',
    () => e.send('/spec/0/pitches', Float32Array.from([0]).buffer));
  bad('an image with no pitch table is refused',
    () => e.send('/spec/0/data', 1, 1, Float32Array.from([1]).buffer));

  e.send('/spec/0/pitches', Float32Array.from([440, 880]).buffer);
  bad('an image whose row count disagrees with the pitch table is refused',
    () => e.send('/spec/0/data', 1, 1, Float32Array.from([1]).buffer));
  bad('a blob of the wrong length is refused',
    () => e.send('/spec/0/data', 2, 3, Float32Array.from([1, 1, 1, 1]).buffer));

  e.clear();
  e.send('/spec/0/data', 2, 2, Float32Array.from([1, 0, 0, 1]).buffer);
  check('a well-formed upload is accepted', e.refusals().length === 0);
  e.send('/spec/0/clear');
  check('clear empties the slot', e.p._spec[0].mag === null && e.p._spec[0].pitches === null);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\na render writer is not a zone you switch on');
{
  const e = makeEngine();
  const refusedBy = (fn) => { e.clear(); fn(); return e.refusals().length === 1; };
  check('/zone/spectral/0/on is refused', refusedBy(() => e.send('/zone/spectral/0/on')),
    'accepting it would set a field nothing reads — dead by construction');
  check('/zone/spectral/0/off is refused', refusedBy(() => e.send('/zone/spectral/0/off')));
  check('/zone/spectral/0/region is refused',
    refusedBy(() => e.send('/zone/spectral/0/region', 0, 100)),
    'the region travels with the render verb, not with the zone');

  // The one that would have been a silent bug: `_zonePart`'s ducking path tests
  // `z.gainCur === 0` on a field a spectral zone does not have, so the change
  // would have been parked in a `pend` flag nothing on this zone consumes.
  e.clear();
  e.send('/zone/spectral/0/part', 3);
  check('/zone/spectral/0/part takes effect immediately',
    e.p._spectral[0].part === 3 && e.refusals().length === 0,
    `part is ${e.p._spectral[0].part} — a render writer has no playhead to duck`);
  e.send('/zone/spectral/0/unsafe', true);
  check('/zone/spectral/0/unsafe applies to a render writer too',
    e.p._spectral[0].unsafe === true);
}

console.log(
  failures === 0
    ? '\nAll spectral-writer checks passed.'
    : `\n${failures} FAILURE(S)`,
);
process.exit(failures ? 1 : 0);
