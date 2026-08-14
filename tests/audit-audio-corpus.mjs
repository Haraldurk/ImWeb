/**
 * The corpus index (§4.6) — the map checked against arithmetic, the territory
 * checked against signals whose descriptors are known in advance.
 *
 * Two halves, and they fail in different ways, which is why both are here.
 *
 * The MAP (`src/audio/corpus-index.js`) is pure arithmetic, and its
 * characteristic failure is silent and geometric: an axis that looks populated
 * but puts unlike material next to itself, or a nearest-neighbour search that
 * returns something merely close. Neither is audible as wrongness — the
 * instrument still makes sound, it just stops rewarding the gesture. So
 * `nearest` is checked against BRUTE FORCE over random corpora rather than
 * against hand-picked cases.
 *
 * The TERRITORY (the engine's `_describe`) can be checked properly because a
 * sine's pitch is known before you measure it. Every descriptor claim below is
 * made against synthesized material whose answer is arithmetic, not against a
 * recording somebody listened to once.
 *
 * Calibrated by MUTATION, like the spectral audit beside it: a check that stays
 * green when the code is broken is decoration. Eighteen deliberate breakages,
 * seventeen caught.
 *
 * **The one that survives, recorded rather than hidden:** swapping the NSDF's
 * energy normalization back to a global-energy one changes nothing any check
 * here can see. That is a fact about the code, not a hole in the audit — the
 * peak-picking rule below it does essentially all of the octave-error work on
 * its own, and the normalization is defence in depth. Measured both ways on a
 * decaying tone and on noise, the two agree to three decimal places. Do not add
 * a check that pins it by coincidence; if it ever needs pinning, the case is a
 * signal whose energy changes sharply across the analysis window.
 *
 * Run:  node tests/audit-audio-corpus.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PROTO_VERSION, REFUSE, CORPUS_COLUMNS } from '../src/audio/protocol.js';
import {
  DESCRIPTORS, CORPUS_COLS, buildIndex, nearest, grainTime,
} from '../src/audio/corpus-index.js';

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

function energyAt(buf, hz) {
  const w = (2 * Math.PI * hz) / SR;
  const coeff = 2 * Math.cos(w);
  let s1 = 0, s2 = 0;
  for (let i = 0; i < buf.length; i++) { const s0 = buf[i] + coeff * s1 - s2; s2 = s1; s1 = s0; }
  return (2 * Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2))) / buf.length;
}
const cents = (a, b) => 1200 * Math.log2(a / b);

// ── harness ────────────────────────────────────────────────────────────────

function makeEngine({ tapeSeconds = 2 } = {}) {
  const p = new Processor();
  const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
  send('/engine/hello', PROTO_VERSION);
  send('/engine/tape/alloc', tapeSeconds);
  p.__sent.length = 0;
  const out = [new Float32Array(128), new Float32Array(128)];
  const run = (n = 1) => {
    let nan = 0, peak = 0, sum = 0, count = 0;
    for (let q = 0; q < n; q++) {
      p.process([[]], [out]);
      for (const v of out[0]) {
        if (Number.isNaN(v)) nan++;
        else { peak = Math.max(peak, Math.abs(v)); sum += v * v; count++; }
      }
    }
    return { nan, peak, rms: count ? Math.sqrt(sum / count) : 0 };
  };
  /** Collect `n` quanta of channel 0 into one buffer, for spectral measurement. */
  const capture = (n) => {
    const buf = new Float32Array(n * 128);
    for (let q = 0; q < n; q++) { p.process([[]], [out]); buf.set(out[0], q * 128); }
    return buf;
  };
  const runJob = (id, cap = 40000) => {
    for (let q = 0; q < cap; q++) {
      p.process([[]], [out]);
      if (p.__sent.some((m) => m.a === `/job/${id}/done` || m.a === `/job/${id}/error`)) return q + 1;
    }
    return -1;
  };
  const msgs = (a) => p.__sent.filter((m) => m.a === a);
  const refusals = () => p.__sent.filter((m) => m.a === '/engine/refuse');
  const clear = () => { p.__sent.length = 0; };
  /** Run an analysis to completion and hand back the measured table. */
  const analyse = (a, b, hop, window, id) => {
    send('/corpus/analyse', a, b, hop, window, id);
    runJob(id);
    const d = msgs('/corpus/data')[0];
    return d ? { count: d.v[3], start: d.v[1], hop: d.v[2], raw: new Float32Array(d.v[4]) } : null;
  };
  return { p, send, run, capture, runJob, msgs, refusals, clear, analyse, out };
}

const fillSine = (p, hz, amp = 0.5, from = 0, to = null) => {
  const end = to ?? p._length;
  for (const ch of p._tape) {
    for (let i = from; i < end; i++) ch[i] = amp * Math.sin((2 * Math.PI * hz * i) / SR);
  }
};
const fillNoise = (p, amp = 0.5, from = 0, to = null) => {
  const end = to ?? p._length;
  let s = 12345;
  for (let i = from; i < end; i++) {
    s = (Math.imul(s, 1103515245) + 12345) & 0x7fffffff;
    const v = amp * ((s / 0x40000000) - 1);
    for (const ch of p._tape) ch[i] = v;
  }
};

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe engine measures what it says it measures');
{
  const W = 8192;
  const col = (t, g, c) => t.raw[g * CORPUS_COLS + c];

  const e = makeEngine();
  fillSine(e.p, 220, 0.5);
  const t220 = e.analyse(0, W * 4, W, W, 1);
  check('an analysis returns one row per whole window', t220 && t220.count === 4,
    t220 ? `${t220.count} grains` : 'no /corpus/data');
  check('a 220 Hz sine reads as 220 Hz',
    Math.abs(cents(col(t220, 0, 2), 220)) < 15,
    `${col(t220, 0, 2).toFixed(2)} Hz`);
  check('and reads as highly periodic', col(t220, 0, 3) > 0.9,
    `periodicity ${col(t220, 0, 3).toFixed(3)}`);
  check('loudness is the RMS of the material',
    Math.abs(col(t220, 0, 0) - 0.5 / Math.SQRT2) < 0.01,
    `${col(t220, 0, 0).toFixed(4)}, expected ${(0.5 / Math.SQRT2).toFixed(4)}`);

  check('a sine reads as maximally periodic', col(t220, 0, 3) > 0.99,
    `${col(t220, 0, 3).toFixed(4)} — a normalization that is not energy-based falls short of 1`);

  /**
   * The top of the searchable range, where decimating by 4 costs the most
   * resolution — the check the parabolic interpolation exists for.
   *
   * **1145 Hz specifically, and the number is the whole test.** A decimated lag
   * L answers 48000/(4L), so 1200 Hz IS lag 10 exactly and 700 Hz is lag 17
   * within a cent: pick either and the interpolation can be deleted with every
   * check still green, which is how this first passed. 1145 sits almost exactly
   * between lags 10 and 11, so an unrefined peak is ~40 cents out.
   */
  const e2 = makeEngine();
  fillSine(e2.p, 1145, 0.5);
  const t1145 = e2.analyse(0, W * 2, W, W, 2);
  check('a 1145 Hz sine reads as 1145 Hz, not as the nearest whole lag',
    Math.abs(cents(col(t1145, 0, 2), 1145)) < 8,
    `${col(t1145, 0, 2).toFixed(2)} Hz (${cents(col(t1145, 0, 2), 1145).toFixed(1)} cents)`);

  const e3 = makeEngine();
  fillNoise(e3.p, 0.5);
  const tn = e3.analyse(0, W * 2, W, W, 3);
  check('noise reads as unperiodic', tn && col(tn, 0, 3) < 0.35,
    `periodicity ${col(tn, 0, 3).toFixed(3)}`);
  check('noise reads brighter than a low sine',
    col(tn, 0, 1) > col(t220, 0, 1) * 4,
    `noise ${col(tn, 0, 1).toFixed(4)} vs 220 Hz sine ${col(t220, 0, 1).toFixed(4)}`);

  const e4 = makeEngine();
  fillSine(e4.p, 3000, 0.5);
  const thi = e4.analyse(0, W * 2, W, W, 4);
  check('brightness rises with frequency',
    col(thi, 0, 1) > col(t220, 0, 1) * 5,
    `3000 Hz ${col(thi, 0, 1).toFixed(4)} vs 220 Hz ${col(t220, 0, 1).toFixed(4)}`);

  /**
   * Decimating for the pitch search folds everything above 6 kHz down into the
   * range being searched, so the decimation has to attenuate it first. This is
   * the case that separates averaging four samples from taking every fourth:
   * 11800 Hz point-sampled lands at 200 Hz at FULL amplitude, right beside the
   * 220 Hz that is really there, and the two beat against each other.
   *
   * Note what this does NOT claim. A four-tap average is not an anti-alias
   * filter, and because the NSDF is amplitude-normalized a loud enough alias
   * still reads as a confident pitch. What the averaging buys is that an alias
   * loses to real low-frequency content instead of competing with it.
   */
  const e8 = makeEngine();
  for (const ch of e8.p._tape) {
    for (let i = 0; i < e8.p._length; i++) {
      ch[i] = 0.45 * Math.sin((2 * Math.PI * 220 * i) / SR)
        + 0.45 * Math.sin((2 * Math.PI * 11800 * i) / SR);
    }
  }
  const ta = e8.analyse(0, W * 2, W, W, 8);
  check('content above the decimated Nyquist does not become a phantom pitch',
    Math.abs(cents(col(ta, 0, 2), 220)) < 20 && col(ta, 0, 3) > 0.9,
    `${col(ta, 0, 2).toFixed(2)} Hz, periodicity ${col(ta, 0, 3).toFixed(3)}`);

  const e5 = makeEngine();
  const tz = e5.analyse(0, W * 2, W, W, 5);
  check('silence has no loudness, no pitch and no periodicity',
    col(tz, 0, 0) === 0 && col(tz, 0, 2) === 0 && col(tz, 0, 3) === 0,
    `${col(tz, 0, 0)}, ${col(tz, 0, 2)}, ${col(tz, 0, 3)}`);

  // Grain i must describe the material at start + i*hop, not near it. A tape
  // that changes character halfway makes an off-by-one in the cursor visible.
  const e6 = makeEngine();
  fillSine(e6.p, 220, 0.5, 0, W * 2);
  fillNoise(e6.p, 0.5, W * 2, W * 4);
  const tm = e6.analyse(0, W * 4, W, W, 6);
  check('grain i describes the material at start + i*hop',
    col(tm, 0, 3) > 0.9 && col(tm, 1, 3) > 0.9
      && col(tm, 2, 3) < 0.35 && col(tm, 3, 3) < 0.35,
    [0, 1, 2, 3].map((g) => col(tm, g, 3).toFixed(2)).join(' '));

  // The hop is what moves the cursor; halving it must double the grain count
  // over the same span and interleave the same measurements.
  const e7 = makeEngine();
  fillSine(e7.p, 220, 0.5);
  const dense = e7.analyse(0, W * 4, W / 2, W, 7);
  check('halving the hop doubles the corpus over the same span',
    dense.count === 7, `${dense.count} grains, expected 7`);
  check('and the hop travels back with the data',
    dense.hop === W / 2 && dense.start === 0, `hop ${dense.hop}, start ${dense.start}`);

  // Every descriptor is a bounded quantity and the client normalizes against
  // the corpus, so one out-of-range grain drags a whole axis. Checked across
  // four kinds of material at once rather than trusted per measurement.
  let bad = '';
  for (const [name, t] of [['sine', t220], ['noise', tn], ['high', thi], ['silence', tz]]) {
    for (let g = 0; g < t.count; g++) {
      const [loud, bright, pitch, per] = [0, 1, 2, 3].map((c) => col(t, g, c));
      if (!(loud >= 0 && loud <= 1)) bad = `${name} loudness ${loud}`;
      if (!(bright >= 0 && bright <= 1)) bad = `${name} brightness ${bright}`;
      if (!(per >= 0 && per <= 1)) bad = `${name} periodicity ${per}`;
      if (!(pitch >= 0 && pitch < SR / 2)) bad = `${name} pitch ${pitch}`;
      if (!Number.isFinite(loud + bright + pitch + per)) bad = `${name} non-finite`;
    }
  }
  check('every descriptor stays inside its declared range', bad === '', bad);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe protocol and the client agree about the columns');
{
  check('the client reads as many columns as the engine writes',
    CORPUS_COLS === CORPUS_COLUMNS.length,
    `${CORPUS_COLS} descriptors vs ${CORPUS_COLUMNS.length} protocol columns`);
  check('and reads them in the same order',
    DESCRIPTORS.every((d, i) => d.key === CORPUS_COLUMNS[i]),
    `${DESCRIPTORS.map((d) => d.key).join(',')} vs ${CORPUS_COLUMNS.join(',')}`);
  check('pitch is the column the engine fills with hertz',
    CORPUS_COLUMNS[2] === 'pitch' && DESCRIPTORS[2].scale === 'logHz',
    'a column swap here mislabels every axis silently');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe axes are scaled the way the ear is');
{
  const mk = (rows) => {
    const raw = new Float32Array(rows.length * CORPUS_COLS);
    rows.forEach((r, i) => r.forEach((v, c) => { raw[i * CORPUS_COLS + c] = v; }));
    return raw;
  };
  // Loudness 0.001, 0.01, 0.1 — three equal steps in dB, wildly unequal in RMS.
  const quiet = mk([[0.001, 0.5, 440, 0.9], [0.01, 0.5, 440, 0.9], [0.1, 0.5, 440, 0.9]]);
  const li = buildIndex(quiet, 3, 0, 1000, 0, 1);
  check('loudness is spread in dB, so the middle grain lands in the middle',
    Math.abs(li.x[1] - 0.5) < 0.01,
    `x = ${li.x[1].toFixed(4)} — on a linear axis this reads about 0.09`);

  // Pitch 110, 220, 440 — two octaves, which must be two equal distances.
  const oct = mk([[0.5, 0.5, 110, 0.9], [0.5, 0.5, 220, 0.9], [0.5, 0.5, 440, 0.9]]);
  const pi = buildIndex(oct, 3, 0, 1000, 2, 1);
  check('an octave is the same distance wherever it sits',
    Math.abs((pi.x[1] - pi.x[0]) - (pi.x[2] - pi.x[1])) < 1e-6,
    `${pi.x[0].toFixed(3)} ${pi.x[1].toFixed(3)} ${pi.x[2].toFixed(3)}`);

  const flat = mk([[0.5, 0.3, 440, 0.9], [0.5, 0.7, 440, 0.9]]);
  const fi = buildIndex(flat, 2, 0, 1000, 0, 1);
  check('an axis with one distinct value collapses to the middle, not to NaN',
    fi.x[0] === 0.5 && fi.x[1] === 0.5, `${fi.x[0]}, ${fi.x[1]}`);
  check('and the other axis still spreads',
    fi.y[0] === 0 && fi.y[1] === 1, `${fi.y[0]}, ${fi.y[1]}`);

  // Unpitched grains. Dropping them is only right when pitch is an axis.
  const mixed = mk([[0.5, 0.2, 0, 0.1], [0.5, 0.8, 440, 0.9]]);
  const withPitch = buildIndex(mixed, 2, 0, 1000, 2, 1);
  check('a grain with no detected pitch is dropped from a pitch axis',
    withPitch.count === 1 && withPitch.droppedPitchless === 1,
    `${withPitch.count} kept, ${withPitch.droppedPitchless} unpitched`);
  const noPitch = buildIndex(mixed, 2, 0, 1000, 0, 1);
  check('and kept when pitch is not an axis',
    noPitch.count === 2 && noPitch.dropped === 0,
    `${noPitch.count} kept — an unpitched grain is still loud and still bright`);
  check('the surviving grain keeps its own identity, not its new position',
    grainTime(withPitch, 0) === 1000,
    `${grainTime(withPitch, 0)} — dropping must not renumber what is left`);

  /**
   * The map must not claim grains the reader cannot reach.
   *
   * The analysis covers the whole tape; a grain zone reads its partition and
   * wraps anything outside it. Without the reach filter the pad plots material
   * the player will not play — you touch a grain and hear a DIFFERENT one,
   * silently. That is the one failure where a map looks like it is working while
   * lying about its territory, so unreachable grains leave the map rather than
   * being redirected in the reader.
   */
  const ten = new Float32Array(10 * CORPUS_COLS);
  for (let i = 0; i < 10; i++) {
    ten[i * CORPUS_COLS] = 0.1 + i * 0.05;
    ten[i * CORPUS_COLS + 1] = i / 9;
    ten[i * CORPUS_COLS + 2] = 200 + i * 30;
    ten[i * CORPUS_COLS + 3] = 0.8;
  }
  // Grains at 0, 1000, …, 9000. A partition covering 3000..6999 reaches four.
  const all = buildIndex(ten, 10, 0, 1000, 0, 1);
  check('with no reach given, every grain is on the map', all.count === 10
    && all.droppedUnreachable === 0, `${all.count} grains`);
  const reached = buildIndex(ten, 10, 0, 1000, 0, 1, 32, { lo: 3000, hi: 7000 });
  check('grains outside the reader\'s span are dropped',
    reached.count === 4 && reached.droppedUnreachable === 6,
    `${reached.count} reachable, ${reached.droppedUnreachable} outside`);
  check('and the ones kept are exactly the reachable ones',
    [0, 1, 2, 3].every((k) => {
      const t = grainTime(reached, k);
      return t >= 3000 && t < 7000;
    }),
    [0, 1, 2, 3].map((k) => grainTime(reached, k)).join(','));
  check('every reachable grain is findable from somewhere on the pad',
    new Set([0, 0.25, 0.5, 0.75, 1].flatMap((x) => [0, 0.5, 1]
      .map((y) => nearest(reached, x, y)))).size === reached.count,
    'a filtered index must still be fully navigable, not a cloud with holes');
  const widened = buildIndex(ten, 10, 0, 1000, 0, 1, 32, { lo: 0, hi: 10000 });
  check('widening the reach — what `unsafe` does — restores them',
    widened.count === 10 && widened.droppedUnreachable === 0,
    `${widened.count} grains`);
  // The two drop reasons are reported separately, because the fixes differ:
  // one wants a different axis, the other a different partition.
  const both = buildIndex(mixed, 2, 0, 1000, 2, 1, 32, { lo: 1000, hi: 2000 });
  check('the two reasons for dropping a grain are counted separately',
    both.droppedPitchless === 1 && both.droppedUnreachable === 0
      && both.dropped === 1,
    `${both.droppedPitchless} unpitched, ${both.droppedUnreachable} unreachable`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nnearest() really returns the nearest, checked against brute force');
{
  // Random corpora rather than chosen ones: the failure mode is a search that
  // returns something merely close, which hand-picked cases pass by luck.
  let worst = 0;
  let mismatches = 0;
  let seed = 987654321;
  const rnd = () => {
    seed ^= seed << 13; seed >>>= 0; seed ^= seed >> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 4294967296;
  };
  for (let trial = 0; trial < 60; trial++) {
    const n = 1 + Math.floor(rnd() * 400);
    const raw = new Float32Array(n * CORPUS_COLS);
    for (let i = 0; i < n; i++) {
      raw[i * CORPUS_COLS] = rnd();
      raw[i * CORPUS_COLS + 1] = rnd();
      raw[i * CORPUS_COLS + 2] = 100 + rnd() * 900;
      raw[i * CORPUS_COLS + 3] = rnd();
    }
    const idx = buildIndex(raw, n, 0, 512, 0, 1);
    for (let q = 0; q < 40; q++) {
      const x = rnd();
      const y = rnd();
      const got = nearest(idx, x, y);
      let bestD = Infinity;
      let want = -1;
      for (let i = 0; i < idx.count; i++) {
        const d = (idx.x[i] - x) ** 2 + (idx.y[i] - y) ** 2;
        if (d < bestD) { bestD = d; want = i; }
      }
      const gotD = (idx.x[got] - x) ** 2 + (idx.y[got] - y) ** 2;
      if (got !== want) {
        // A tie is not a mismatch; a longer distance is.
        if (gotD > bestD + 1e-12) { mismatches++; worst = Math.max(worst, gotD - bestD); }
      }
    }
  }
  check('2400 lookups over 60 random corpora all find the true nearest',
    mismatches === 0, `${mismatches} misses, worst by ${worst.toExponential(2)}`);

  const empty = buildIndex(new Float32Array(0), 0, 0, 512, 0, 1);
  check('an empty corpus answers -1 rather than throwing', nearest(empty, 0.5, 0.5) === -1);

  const one = new Float32Array(CORPUS_COLS);
  one[0] = 0.5; one[1] = 0.5; one[2] = 440; one[3] = 0.5;
  const single = buildIndex(one, 1, 4096, 512, 0, 1);
  check('a one-grain corpus answers that grain from anywhere',
    nearest(single, 0, 0) === 0 && nearest(single, 1, 1) === 0);
  check('grainTime is start + id × hop', grainTime(single, 0) === 4096);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe analysis is paced (§8.3) and does not stop the audio');
{
  const e = makeEngine({ tapeSeconds: 4 });
  fillSine(e.p, 220, 0.5);
  e.send('/part/0/bounds', 0, SR * 4);
  e.send('/zone/play/0/part', 0);
  e.send('/engine/glide', 0);
  e.send('/zone/play/0/region', 0, SR);
  e.send('/zone/play/0/on');
  e.clear();

  e.send('/corpus/analyse', 0, SR * 4, 2048, 4096, 10);
  let silent = 0;
  let q = 0;
  for (; q < 40000; q++) {
    e.p.process([[]], [e.out]);
    let energy = 0;
    for (const v of e.out[0]) energy += Math.abs(v);
    if (energy <= 1) silent++;
    if (e.msgs('/job/10/done').length) break;
  }
  check('a whole-tape analysis takes many quanta, not one', q > 40,
    `${q + 1} quanta — a budget that does not carry across quanta looks like this`);
  check('the job finished', e.msgs('/job/10/done').length === 1);
  check('playback kept sounding throughout', silent === 0,
    `${silent} of ${q + 1} quanta went silent`);
  const prog = e.msgs('/job/10/progress');
  check('progress is reported', prog.length > 1, `${prog.length} messages`);
  check('progress is on the frame timer, not per quantum', prog.length < q / 4,
    `${prog.length} over ${q + 1} quanta`);
  const data = e.msgs('/corpus/data')[0];
  check('the payload arrives before the terminal message',
    e.p.__sent.findIndex((m) => m.a === '/corpus/data')
      < e.p.__sent.findIndex((m) => m.a === '/job/10/done'),
    'a client resolving on /done must already hold the data');
  check('the blob is grainCount × columns floats',
    new Float32Array(data.v[4]).length === data.v[3] * CORPUS_COLS,
    `${new Float32Array(data.v[4]).length} floats for ${data.v[3]} grains`);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nanalysis refusals are correlated, and cancel works');
{
  const e = makeEngine({ tapeSeconds: 2 });
  const jobErr = (id) => e.msgs(`/job/${id}/error`);

  e.clear();
  e.send('/corpus/analyse', 0, SR * 2, 0, 4096, 20);
  check('a zero hop is refused', jobErr(20).length === 1
    && jobErr(20)[0].v[0] === REFUSE.BAD_RANGE, 'it would never advance');

  e.clear();
  e.send('/corpus/analyse', 0, SR * 2, 1024, 8, 21);
  check('an impossibly short window is refused', jobErr(21).length === 1);

  e.clear();
  e.send('/corpus/analyse', 0, 1000, 512, 4096, 22);
  check('a span with no whole window in it is refused', jobErr(22).length === 1,
    'a partial window would sit in the cloud looking like a real outlier');

  e.clear();
  e.send('/corpus/analyse', 0, SR * 2, 1, 4096, 23);
  check('a corpus larger than the cap is refused', jobErr(23).length === 1
    && /exceeds/.test(jobErr(23)[0].v[1]),
    'the result is allocated at accept, so the cap is what bounds it');

  e.clear();
  e.send('/corpus/analyse', 0, SR * 2, 2048, 4096, 24);
  e.send('/corpus/analyse', 0, SR * 2, 2048, 4096, 25);
  check('a second analysis is refused BUSY', jobErr(25).length === 1
    && jobErr(25)[0].v[0] === REFUSE.BUSY);
  check('the first is unaffected', jobErr(24).length === 0);
  e.p.process([[]], [e.out]);
  e.send('/job/24/cancel');
  check('cancel terminates it with CANCELLED', jobErr(24).length === 1
    && jobErr(24)[0].v[0] === REFUSE.CANCELLED);
  e.clear();
  e.run(200);
  check('and no data arrives afterwards', e.msgs('/corpus/data').length === 0);

  // A read, not a write: it must NOT lock the layout the way a render does.
  e.clear();
  e.send('/corpus/analyse', 0, SR * 2, 2048, 4096, 26);
  e.p.process([[]], [e.out]);
  e.send('/part/1/bounds', 0, 1000);
  check('an analysis does not lock the layout', e.refusals().length === 0
    && e.p._parts[1].len === 1000,
    'measuring is a read; the tape may be re-laid-out or recorded into while it runs');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe grain player reads the tape it was pointed at');
{
  const e = makeEngine({ tapeSeconds: 2 });
  fillSine(e.p, 220, 0.5);
  e.send('/part/0/bounds', 0, SR * 2);
  e.send('/zone/grain/0/part', 0);
  e.send('/zone/grain/0/pos', 0);
  e.send('/zone/grain/0/size', 4800);
  e.send('/zone/grain/0/rate', 30);
  e.send('/zone/grain/0/level', 1);
  e.send('/zone/grain/0/on');
  const buf = e.capture(200);
  let nan = 0;
  let sum = 0;
  for (const v of buf) { if (Number.isNaN(v)) nan++; else sum += v * v; }
  const rms = Math.sqrt(sum / buf.length);
  // RMS rather than the energy at 220, and the reason is worth writing down
  // because it looks like a weaker check and is not. With `spray` at 0 and a
  // fixed position, EVERY grain replays the same tape segment, so the output is
  // periodic at the grain rate and the 220 Hz component is smeared across
  // grain-rate sidebands — the tonal energy at exactly 220 reads far lower than
  // the sound obviously is. That comb is not a defect; it is precisely the buzz
  // `spray` exists to break up, measured two sections down.
  check('a grain cloud produces sound', rms > 0.05, `rms ${rms.toFixed(4)}`);
  check('and no NaN', nan === 0, `${nan} NaN samples`);
  check('the energy is at the material\'s frequency, not an octave off',
    energyAt(buf, 220) > energyAt(buf, 440) * 20,
    `220 Hz ${energyAt(buf, 220).toFixed(4)} vs 440 Hz ${energyAt(buf, 440).toFixed(5)}`);

  // Pitch is a per-grain read rate: doubling it must double the heard
  // frequency. Compared against the SAME measurement before the change rather
  // than against the other frequency in the same buffer, for the comb reason
  // above — what moves is where the energy went, not the ratio within one take.
  const before = energyAt(buf, 440);
  e.send('/zone/grain/0/pitch', 2);
  const up = e.capture(200);
  check('pitch 2 moves the energy up an octave',
    energyAt(up, 440) > before * 10,
    `440 Hz went ${before.toFixed(5)} → ${energyAt(up, 440).toFixed(4)}`);
  e.send('/zone/grain/0/pitch', 1);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\ngrains in flight finish; the cap holds; spray scatters');
{
  const e = makeEngine({ tapeSeconds: 2 });
  fillSine(e.p, 220, 0.5);
  e.send('/part/0/bounds', 0, SR * 2);
  e.send('/zone/grain/0/part', 0);
  e.send('/zone/grain/0/size', 4800);        // 100 ms
  e.send('/zone/grain/0/rate', 30);
  e.send('/zone/grain/0/on');
  e.run(50);
  const z = e.p._grain[0];
  check('grains are in flight while it runs', z.live > 0, `${z.live} live`);

  e.send('/zone/grain/0/off');
  const tail = e.run(4);                     // ~10 ms — a zone gain ramp is 8 ms
  check('switching off does not cut the cloud dead', tail.rms > 0.001,
    `rms ${tail.rms.toFixed(5)} — in-flight windows must finish, or every stop clicks`);
  e.run(60);                                 // well past one grain length
  const after = e.run(20);
  check('but it does stop, once the last window closes', after.rms < 1e-6,
    `rms ${after.rms.toExponential(2)}`);
  check('and the live count returns to zero', e.p._grain[0].live === 0,
    `${e.p._grain[0].live} — a leaked count keeps the zone rendering forever`);

  // The cap. A rate far above what the slots can serve must not overflow them,
  // allocate, or wedge the count.
  e.send('/zone/grain/0/size', 48000);       // 1 s grains
  e.send('/zone/grain/0/rate', 5000);        // absurd density
  e.send('/zone/grain/0/on');
  const hot = e.run(100);
  let active = 0;
  for (const g of e.p._grain[0].grains) if (g.active) active++;
  check('the grain cap holds under an absurd rate',
    e.p._grain[0].live <= 16 && active === e.p._grain[0].live,
    `live ${e.p._grain[0].live}, active ${active}`);
  check('and it still produces finite audio', hot.nan === 0 && hot.peak < 40,
    `nan ${hot.nan}, peak ${hot.peak.toFixed(2)}`);
  e.send('/zone/grain/0/off');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nspray is what stops a held position being a buzz');
{
  /**
   * Collect the START POSITION of every grain spawned, which is the quantity
   * spray actually controls.
   *
   * The first version of this measured the amplitude range of the output over a
   * ramp tape, on the theory that where a grain reads is visible in what it
   * reads. It is — but every grain is also multiplied by a Hann window that
   * takes it from zero to its peak and back, so the output range measures the
   * WINDOW and barely moves when the positions scatter. It passed with spray
   * off and on alike.
   */
  const spawnPositions = (spray) => {
    const e = makeEngine({ tapeSeconds: 2 });
    e.send('/part/0/bounds', 0, SR * 2);
    e.send('/zone/grain/0/part', 0);
    e.send('/zone/grain/0/pos', SR);
    e.send('/zone/grain/0/size', 2400);
    e.send('/zone/grain/0/rate', 40);
    e.send('/zone/grain/0/spray', spray);
    e.send('/zone/grain/0/on');
    const seen = [];
    // `pos` SLEWS to its target (§4.11), so the first few grains legitimately
    // start somewhere between 0 and the position asked for. Twenty quanta is
    // 53 ms, comfortably past the 8 ms approach — collecting through it instead
    // reads the slew as spray, which is how this check first failed.
    for (let q = 0; q < 20; q++) e.p.process([[]], [e.out]);
    for (let q = 0; q < 400; q++) {
      e.p.process([[]], [e.out]);
      for (const g of e.p._grain[0].grains) {
        // Freshly spawned this quantum: `t` has not yet run past one block.
        if (g.active && g.t <= 128) seen.push(g.pos - g.t * g.inc);
      }
    }
    return seen;
  };
  const uniq = (a) => new Set(a.map((v) => Math.round(v))).size;
  const range = (a) => Math.max(...a) - Math.min(...a);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;

  const dry = spawnPositions(0);
  check('grains actually spawned', dry.length > 20, `${dry.length} observed`);
  // Not "identical": the position slew is an exponential approach, so it is
  // still creeping the last few samples toward its target long after it is
  // audibly there. What matters is that the spread is three orders of magnitude
  // smaller than a sprayed one, which is the difference between a buzz and a
  // texture — not that a float settled exactly.
  check('with no spray every grain starts in the same place',
    range(dry) < SR / 1000 && Math.abs(mean(dry) - SR) < SR / 1000,
    `range ${range(dry).toFixed(1)} samples about ${mean(dry).toFixed(0)}`);

  const wet = spawnPositions(SR / 4);
  check('with spray they scatter', uniq(wet) > wet.length / 2
    && range(wet) > range(dry) * 1000,
    `${uniq(wet)} distinct positions out of ${wet.length}, range ${range(wet).toFixed(0)}`);
  check('and scatter symmetrically around the position, not ahead of it',
    Math.abs(mean(wet) - SR) < SR / 12,
    `mean ${mean(wet).toFixed(0)}, position ${SR}`);
  check('across roughly the sprayed width',
    range(wet) > SR / 4 && range(wet) <= SR / 2 + 2,
    `range ${range(wet).toFixed(0)} for a spray of ${SR / 4}`);

  const again = spawnPositions(SR / 4);
  check('and scatter the SAME way twice',
    again.length === wet.length && again.every((v, i) => v === wet[i]),
    'spray is seeded per zone, so a corpus gesture is reproducible');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe grain player is its own zone type, not a playback zone');
{
  const e = makeEngine({ tapeSeconds: 2 });
  e.send('/part/0/bounds', 0, SR * 2);
  e.send('/zone/play/0/part', 0);
  e.send('/zone/play/0/rate', 1);
  e.clear();

  // The address-collapsing trap. `/zone/grain/0/rate` is grains per second and
  // `/zone/play/0/rate` is a read speed; if the grain address is missing from
  // ZONE_SPECIFIC it collapses onto the play pattern and lands in the wrong
  // handler — a density control that changes pitch instead.
  e.send('/zone/grain/0/rate', 50);
  check('grain rate is grains per second, not a playback speed',
    e.p._grain[0].rate === 50 && e.p._play[0].rateTgt === 1,
    `grain ${e.p._grain[0].rate}, play ${e.p._play[0].rateTgt}`);

  e.clear();
  e.send('/zone/grain/0/region', 0, 100);
  check('a grain zone has no region, and says so', e.refusals().length === 1,
    'pos and size already say where and how much');

  e.clear();
  e.send('/zone/grain/0/size', -50);
  check('a negative grain size is clamped, not refused', e.refusals().length === 0
    && e.p._grain[0].size >= 1,
    'continuous values a controller writes every frame must not refuse per frame');
  e.send('/zone/grain/0/pitch', -1);
  check('a negative PITCH is kept — it reads the grain backwards',
    e.p._grain[0].pitch === -1);

  // §8.7: pos is a single-float address, so it must be a legal controller
  // target, and the ownership guard must then refuse direct writes.
  e.clear();
  e.send('/ctrl/0/target', '/zone/grain/0/pos');
  check('grain pos binds as a worklet controller target',
    e.refusals().length === 0 && e.p._grain[0].posCtrl === 0,
    `posCtrl ${e.p._grain[0].posCtrl} — the ownership fields are dead otherwise`);
  e.clear();
  e.send('/zone/grain/0/pos', 500);
  check('and a direct write to it is then refused',
    e.refusals().length === 1 && e.refusals()[0].v[0] === REFUSE.CTRL_OWNED);
  e.clear();
  e.send('/ctrl/0/target', '');
  check('unbinding releases it', e.p._grain[0].posCtrl === -1);
  e.send('/zone/grain/0/pos', 500);
  check('and the direct write works again', e.p._grain[0].posTgt === 500);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\na running grain zone is a reader, and the engine knows it');
{
  const e = makeEngine({ tapeSeconds: 2 });
  fillSine(e.p, 220, 0.5);
  e.send('/part/0/bounds', 0, SR * 2);
  e.send('/zone/grain/0/part', 0);
  e.send('/zone/grain/0/on');
  e.run(20);
  e.clear();
  e.send('/engine/tape/alloc', 1);
  check('reallocating under a running grain zone is refused',
    e.refusals().some((m) => m.v[0] === REFUSE.LAYOUT_LOCKED),
    'the tape it is reading is not something a realloc may pull away');
  check('the tape was not reallocated', e.p._length === SR * 2);

  e.clear();
  e.send('/engine/panic');
  let active = 0;
  for (const g of e.p._grain[0].grains) if (g.active) active++;
  check('panic silences the cloud immediately',
    !e.p._grain[0].on && e.p._grain[0].live === 0 && active === 0,
    `on ${e.p._grain[0].on}, live ${e.p._grain[0].live}, active ${active}`);
  const dead = e.run(10);
  check('and nothing sounds afterwards', dead.rms === 0, `rms ${dead.rms}`);
}

console.log(
  failures === 0 ? '\nAll corpus-index checks passed.' : `\n${failures} FAILURE(S)`,
);
process.exit(failures ? 1 : 0);
