/**
 * The audio engine's DSP, driven headlessly.
 *
 * Why this exists. Every previous check on this engine was either static (does
 * the source say the right thing) or browser-based (does it sound right), and
 * the browser route is nearly unusable here: Claude Code's pane runs Chrome with
 * `--disable-audio`, so `process()` never fires while every port-based check
 * still passes (LEARNED 2026-08-13). That left the actual sample-producing code
 * verified by ear, once, by hand.
 *
 * But the worklet has ZERO IMPORTS by construction (§4.1), which means it can be
 * instantiated in Node with three globals stubbed and driven quantum by quantum.
 * No browser, no audio device, no user gesture, no cached module. The thing that
 * made the engine awkward to import is exactly what makes it testable.
 *
 * The bug this was written for: `_renderPlay` computed `i0 = a + Math.floor(phase)`
 * with a FRACTIONAL `a`, so the span's fraction stayed in the array subscript.
 * `Float32Array[1234.5]` is `undefined`, `undefined * 0.5` is NaN, and NaN sails
 * through a ternary ceiling because every comparison against NaN is false. Under
 * a controller this was permanent silence: `_modStep` gives modulation full float
 * resolution on purpose, so an LFO on Start produced a fractional span every
 * frame. Manual edits snapped to `step` and happened to land on integers, which
 * is why it read as "manual works, the LFO does not".
 *
 * Run:  node tests/audit-audio-dsp.mjs
 */

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── the three globals an AudioWorkletProcessor expects ─────────────────────
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
check('the worklet registered a processor', !!Processor,
  'it must be importable with only sampleRate/AudioWorkletProcessor/registerProcessor');
if (!Processor) process.exit(1);

// ── harness ────────────────────────────────────────────────────────────────
function makeEngine({ tapeSeconds = 1, fill = 0.5 } = {}) {
  const p = new Processor();
  const sent = () => p.__sent;
  const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
  send('/engine/hello', 1);
  send('/engine/tape/alloc', tapeSeconds);
  // A constant, non-zero tape: silence and NaN are then distinguishable, which
  // a zero-filled tape would hide (a NaN read still reads as "not 0.5").
  if (fill !== null) for (const ch of p._tape) ch.fill(fill);
  const out = [new Float32Array(128), new Float32Array(128)];
  const input = [];
  const run = (n = 1) => {
    let nan = 0, peak = 0, sum = 0, count = 0;
    for (let q = 0; q < n; q++) {
      p.process([input], [out]);
      for (const v of out[0]) {
        if (Number.isNaN(v)) nan++;
        else { peak = Math.max(peak, Math.abs(v)); sum += v * v; count++; }
      }
    }
    return { nan, peak, rms: count ? Math.sqrt(sum / count) : 0 };
  };
  return { p, send, run, out, input, sent };
}

// ── 1. the regression: fractional spans must not produce NaN ───────────────
console.log('\nfractional region bounds (what every controller produces)');
{
  const { send, run } = makeEngine();
  send('/part/0/bounds', 0, SR);
  send('/zone/play/0/part', 0);
  send('/engine/glide', 0);
  send('/zone/play/0/region', 0, 24000);
  send('/zone/play/0/on');
  const intRes = run(20);
  check('an integer region produces no NaN', intRes.nan === 0, `${intRes.nan} NaN samples`);
  check('an integer region produces sound', intRes.rms > 0.1, `rms ${intRes.rms.toFixed(4)}`);

  // 1234.5 is what `0.0017146...` × partLen looks like after an LFO write.
  send('/zone/play/0/region', 1234.5, 24000);
  const fracRes = run(20);
  check('a FRACTIONAL region produces no NaN', fracRes.nan === 0,
    `${fracRes.nan} NaN samples — the subscript kept the span's fraction`);
  check('a fractional region still produces sound', fracRes.rms > 0.1,
    `rms ${fracRes.rms.toFixed(4)}`);
}

// ── 2. a per-frame sweep, i.e. an LFO on Start ─────────────────────────────
console.log('\na controller sweeping Start every frame');
{
  const { send, run } = makeEngine();
  send('/part/0/bounds', 0, SR);
  send('/zone/play/0/part', 0);
  send('/zone/play/0/region', 0, 12000);
  send('/zone/play/0/on');
  run(6);                                     // let the gain ramp up

  let nan = 0, worstRms = Infinity;
  for (let frame = 0; frame < 40; frame++) {
    // Deliberately irrational-ish, so essentially every value is fractional.
    const start = (Math.sin(frame / 6) * 0.5 + 0.5) * 11111.317;
    send('/zone/play/0/region', start, 12000);
    const r = run(6);                         // ~6 quanta per 60 Hz frame
    nan += r.nan;
    worstRms = Math.min(worstRms, r.rms);
  }
  check('a per-frame fractional sweep produces no NaN', nan === 0, `${nan} NaN samples`);
  check('the zone stays audible throughout the sweep', worstRms > 0.1,
    `worst rms ${worstRms.toFixed(4)} — silence here is the duck-per-message regression`);
}

// ── 3. glide ramps pass through fractional intermediates ───────────────────
console.log('\nglide ramps between integer endpoints');
{
  const { send, run } = makeEngine();
  send('/part/0/bounds', 0, SR);
  send('/zone/play/0/part', 0);
  send('/engine/glide', 3);                   // the default
  send('/zone/play/0/region', 0, 12000);
  send('/zone/play/0/on');
  run(6);
  // Both endpoints are integers; every value BETWEEN them is not.
  send('/zone/play/0/region', 8000, 12000);
  const r = run(10);
  check('a glide ramp produces no NaN', r.nan === 0,
    `${r.nan} NaN samples — intermediates are fractional even when endpoints are not`);
}

// ── 4. recording writes land (a fractional write is a silent no-op) ────────
console.log('\nrecording with a fractional region');
{
  const { p, send, run, input } = makeEngine({ fill: 0 });
  send('/part/0/bounds', 0, SR);
  send('/zone/rec/0/part', 0);
  send('/engine/glide', 0);
  send('/zone/rec/0/region', 100.5, 20000);   // fractional on purpose
  const tone = new Float32Array(128).fill(0.7);
  input.push(tone, tone);
  send('/zone/rec/0/on');
  run(8);
  let written = 0;
  for (let i = 0; i < 2000; i++) if (p._tape[0][i] !== 0) written++;
  check('a fractional-region recording actually writes samples', written > 500,
    `${written} non-zero samples — assigning to Float32Array[x.5] is a silent no-op`);
}

// ── 5. dynamic length is reported on BOTH stop paths ───────────────────────
console.log('\ndynamic recording reports its length');
{
  // (a) manual stop
  const m = makeEngine({ fill: 0 });
  m.send('/part/0/bounds', 0, SR);
  m.send('/zone/rec/0/part', 0);
  m.send('/zone/rec/0/region', 0, 40000);
  m.send('/zone/rec/0/dynamic', true);
  const tone = new Float32Array(128).fill(0.4);
  m.input.push(tone, tone);
  m.send('/zone/rec/0/on');
  m.run(5);
  m.send('/zone/rec/0/off');
  check('a manual stop reports /zone/rec/0/length',
    m.sent().some((x) => x.a === '/zone/rec/0/length'),
    'the client is never told what it captured');

  // (b) the head reaching the seam — the path that used to set on=false directly.
  // A dynamic recording runs to the PARTITION seam, not the declared region
  // end (that is the whole point: you have not declared a length yet), so the
  // partition is what has to be small here.
  const s = makeEngine({ fill: 0 });
  s.send('/part/0/bounds', 0, 256);            // two quanta of room
  s.send('/zone/rec/0/part', 0);
  s.send('/zone/rec/0/region', 0, 256);
  s.send('/zone/rec/0/dynamic', true);
  s.input.push(tone, tone);
  s.send('/zone/rec/0/on');
  s.run(10);                                   // runs past the seam
  check('an auto-stop at the seam also reports the length',
    s.sent().some((x) => x.a === '/zone/rec/0/length'),
    'the Run toggle stays on over a zone that already stopped');
}

// ── 6. the ceiling holds, including against NaN ────────────────────────────
console.log('\n§4.11: the output ceiling');
{
  const { p, out } = makeEngine();
  // Feed the limiter directly: whatever upstream does, this stage is the one
  // that must never emit something unbounded.
  const L = new Float32Array([0.5, 5, -5, NaN, Infinity, -Infinity, 0]);
  const R = Float32Array.from(L);
  p._limit(L, R, L.length);
  check('no NaN survives the ceiling', ![...L].some(Number.isNaN), [...L].join(','));
  check('output is bounded to [-1, 1]', [...L].every((v) => v >= -1 && v <= 1),
    [...L].join(','));
  void out;
}

// ── 7. the engine refuses what it cannot safely do mid-performance ─────────
console.log('\nrefusals that protect material');
{
  const { send, run, sent } = makeEngine();
  send('/part/0/bounds', 0, SR);
  send('/zone/play/0/part', 0);
  send('/zone/play/0/region', 0, 12000);
  send('/zone/play/0/on');
  run(4);
  const before = sent().filter((m) => m.a === '/engine/refuse').length;
  send('/engine/tape/alloc', 2);
  const refusals = sent().filter((m) => m.a === '/engine/refuse');
  check('reallocating the tape while a zone runs is refused',
    refusals.length > before,
    'realloc discards every recording — refusing relayout but not this is backwards');
  check('the refusal is LAYOUT_LOCKED',
    refusals.at(-1)?.v[0] === 4, String(refusals.at(-1)?.v[0]));
}

// ── 8. a failed request settles its own promise ────────────────────────────
console.log('\nrequest/reply correlation');
{
  const p = new Processor();
  const sent = () => p.__sent;
  const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
  send('/engine/hello', 1);
  send('/tape/env/req', 0, 100, 8, 77);        // no tape allocated yet
  const err = sent().find((m) => m.a === '/tape/env/err');
  check('a refused envelope request replies with its reqId', !!err,
    'an uncorrelated refusal cannot settle the promise, and the view gates on it');
  check('the error carries the originating reqId', err?.v[0] === 77, String(err?.v[0]));
}

// ── 9. engine-initiated state changes are reported ─────────────────────────
console.log('\nthe engine says when it stops a zone itself');
{
  const s = makeEngine({ fill: 0 });
  s.send('/part/0/bounds', 0, 256);
  s.send('/zone/rec/0/part', 0);
  s.send('/zone/rec/0/region', 0, 256);
  s.send('/zone/rec/0/dynamic', true);
  const tone = new Float32Array(128).fill(0.4);
  s.input.push(tone, tone);
  s.send('/zone/rec/0/on');
  s.run(10);
  const st = s.sent().find((m) => m.a === '/zone/rec/0/state');
  check('an auto-stop reports the zone state', !!st,
    'without it the Run toggle stays on over a stopped zone');
  check('the reported state is "stopped"', st?.v[0] === false, String(st?.v[0]));
}

// ── 10. the tape reader's quality (§4.10 items 1 and 2) ────────────────────
//
// §4.10: "Get those right and a plain sine sounds good. Get them wrong and no
// UGen set rescues it." Both claims are measurable on produced samples, so they
// are measured rather than asserted about the source.
console.log('\nthe tape reader — interpolation and rate-aware anti-aliasing');
{
  /** Energy at one normalized frequency (cycles/sample), by direct projection. */
  const energyAt = (x, f) => {
    let re = 0, im = 0;
    const w = 2 * Math.PI * f;
    for (let n = 0; n < x.length; n++) { re += x[n] * Math.cos(w * n); im += x[n] * Math.sin(w * n); }
    return (re * re + im * im) / (x.length * x.length);
  };
  /** Fill a tape with a sine at `f` cycles/sample. */
  const writeSine = (p, f, amp = 0.5) => {
    for (const ch of p._tape) for (let n = 0; n < ch.length; n++) ch[n] = amp * Math.sin(2 * Math.PI * f * n);
  };
  /** Raw post-bus samples, after the gain ramp has settled. */
  const collect = (s, quanta = 24, settle = 12) => {
    s.run(settle);
    const out = [];
    for (let q = 0; q < quanta; q++) { s.p.process([s.input], [s.out]); out.push(...s.out[0]); }
    return Float32Array.from(out);
  };

  // (a) Bit-transparency at integer phase. THE property that rejects B-spline:
  // an approximating kernel lowpasses even at 1×, so the main path would be
  // permanently dull and what you hear would stop matching the envelope you see.
  {
    const { p } = makeEngine({ fill: null });
    writeSine(p, 0.01);
    let worst = 0;
    for (let i = 40; i < 120; i++) worst = Math.max(worst, Math.abs(p._cubic(0, i, 0, 4096) - p._tape[0][i]));
    check('at integer phase the kernel returns the tape sample EXACTLY', worst === 0,
      `worst deviation ${worst} — an approximating kernel (B-spline) fails here`);
  }

  // (a2) The same property END TO END, through _renderPlay rather than the
  // kernel alone — which is what covers the sub-read CENTRING. Off-centre, the
  // single tap at N = 1 would sit half a step late, so a 1× read would be
  // interpolated rather than exact and this fails while (a) still passes.
  // `rateCur` starts at exactly 1 and no rate message is sent, so the phase
  // stays integral; a rate that slewed in would leave it fractional.
  {
    const s = makeEngine({ fill: null });
    for (const ch of s.p._tape) for (let n = 0; n < ch.length; n++) ch[n] = Math.sin(n * 12.9898) * 0.5;
    s.send('/part/0/bounds', 0, 8192);
    s.send('/zone/play/0/part', 0);
    s.send('/engine/glide', 0);
    s.send('/bus/out/gain', 1);
    s.send('/zone/play/0/region', 0, 8192);
    s.send('/zone/play/0/on');
    s.run(80);                                  // let gain snap to exactly 1
    const z = s.p._zones('play')[0];
    const phase0 = z.phase;
    const x = [];
    for (let q = 0; q < 2; q++) { s.p.process([s.input], [s.out]); x.push(...s.out[0]); }
    let worst = 0;
    for (let n = 0; n < x.length; n++) {
      worst = Math.max(worst, Math.abs(x[n] - s.p._tape[0][(phase0 + n) % 8192]));
    }
    check('the preconditions hold: integral phase and unity gain', Number.isInteger(phase0) && z.gainCur === 1,
      `phase ${phase0}, gain ${z.gainCur}`);
    check('a 1× read is bit-transparent END TO END', worst === 0,
      `worst deviation ${worst.toExponential(2)} — an off-centre tap reads between samples at 1×`);
  }

  // (b) Cubic beats linear on the thing the reader actually does: land between
  // samples. Measured against the analytic sine the tape was filled from, so
  // neither kernel is being compared to the other's idea of the truth.
  {
    const { p } = makeEngine({ fill: null });
    const f = 0.05;
    writeSine(p, f, 1);
    const buf = p._tape[0];
    let cub = 0, lin = 0;
    for (let n = 100; n < 900; n++) {
      for (const frac of [0.25, 0.5, 0.75]) {
        const truth = Math.sin(2 * Math.PI * f * (n + frac));
        cub = Math.max(cub, Math.abs(p._cubic(0, n + frac, 0, 4096) - truth));
        lin = Math.max(lin, Math.abs(buf[n] * (1 - frac) + buf[n + 1] * frac - truth));
      }
    }
    check('cubic interpolation beats linear against the analytic signal', cub < lin * 0.5,
      `cubic ${cub.toExponential(2)} vs linear ${lin.toExponential(2)}`);
    // Calibration: linear must be measurably wrong here, or "cubic is better"
    // is a comparison against a kernel that happened to be exact.
    check('the linear reference is measurably wrong (the test is live)', lin > 1e-3,
      `linear error ${lin.toExponential(2)} — too small to distinguish kernels`);
  }

  // (c) The fold, measured as a RATIO of two tones through ONE path.
  //
  // The obvious test — alias energy against a naive read computed here — is
  // invalid, and was believed for several iterations. Two reasons, both of
  // which inflate the result: the engine's phase is fractional (the rate slews
  // in, so reads land mid-sample) while a hand-computed reference at `n*rate`
  // sits on exact integers, so the engine pays cubic droop the reference never
  // does; and the box attenuates the offending content itself, which is its
  // JOB but is indistinguishable from attenuating everything. Together they
  // scored "16 dB of suppression" for a kernel that was mostly just quieter.
  //
  // So: put a tone that SURVIVES a 2× read (0.05 → 0.1) and one that cannot
  // (0.35 → 0.7, folding to 0.3) on the same tape, and measure alias ÷ wanted.
  // Both tones take the same path, so droop, gain and the limiter cancel out of
  // the ratio, and only SELECTIVITY moves it.
  // The rate SLEWS to its target (`_approach`, ~8 ms with a 1e-6 snap), and
  // until it arrives the read is a chirp, which smears the alias off whatever
  // bin you measure. At the first settle used here — 12 quanta — rateCur was
  // still 1.963, and the engine scored 16 dB "suppression" that was really just
  // the alias sitting next to the probe frequency rather than on it. Forcing
  // N = 1 did not change that number, which is how the artefact was caught.
  //
  // So: settle past the snap, and PROVE the rate arrived rather than trusting
  // the sample count (LEARNED 2026-08-04 — a run should prove its own
  // preconditions).
  // Both tones are an INTEGER number of cycles in the 8192-sample loop. With
  // 0.05 and 0.35 they are not, so the region's wrap is a discontinuity that
  // splatters broadband energy into the measurement bin — and forward and
  // reverse meet that seam at different points, which made the direction test
  // fail on correct code (ratio 0.591, stable). Loop-periodic tones remove the
  // seam instead of widening the tolerance to hide it.
  const LOOP = 8192;
  const F_LO = 410 / LOOP;          // ≈ 0.0500 — survives a 2× read
  const F_HI = 2867 / LOOP;         // ≈ 0.3501 — cannot; folds back
  const BIN_WANTED = 2 * F_LO;                  // 0.1001
  const BIN_ALIAS = Math.abs(1 - 2 * F_HI);     // 0.2999
  const foldRatio = (rate) => {
    const s = makeEngine({ fill: null });
    for (const ch of s.p._tape) {
      for (let n = 0; n < ch.length; n++) {
        ch[n] = 0.4 * Math.sin(2 * Math.PI * F_LO * n) + 0.4 * Math.sin(2 * Math.PI * F_HI * n);
      }
    }
    s.send('/part/0/bounds', 0, LOOP);
    s.send('/zone/play/0/part', 0);
    s.send('/engine/glide', 0);
    s.send('/bus/out/gain', 1);
    s.send('/zone/play/0/region', 0, LOOP);
    s.send('/zone/play/0/rate', rate);
    s.send('/zone/play/0/on');
    const x = collect(s, 24, 80);
    const wanted = energyAt(x, BIN_WANTED), alias = energyAt(x, BIN_ALIAS);
    return { wanted, alias, ratio: alias / wanted, arrived: s.p._zones('play')[0].rateCur };
  };
  {
    const e = foldRatio(2);
    check('the read rate actually reached 2× before measuring', e.arrived === 2,
      `rateCur ${e.arrived} — a still-slewing rate is a chirp, and smears the alias off the bin`);
    check('the surviving tone is actually there (the test is live)', e.wanted > 1e-4,
      `wanted energy ${e.wanted.toExponential(2)} — a ratio against silence proves nothing`);
    // The threshold is set from MEASUREMENT, not taste, because the kernel is
    // not the only thing here that discriminates: the cubic's own droop already
    // attenuates 0.35 more than 0.05 when reads land off-sample. Measured
    // alias/wanted — 0.209 with the kernel (6.8 dB), 0.398 with N forced to 1
    // (4.0 dB). So the box contributes 2.8 dB and the interpolator 4.0, and a
    // threshold above 0.398 would pass with the kernel deleted. 0.30 sits
    // between them with ~30% margin either side; both states verified by
    // mutation. The 6.8 dB also matches theory independently — a box of width
    // rate/N has response |cos(πf)| here, i.e. −6.9 dB at 0.35 against −0.1 dB
    // at 0.05.
    check('the AA kernel suppresses the FOLDED tone and not the wanted one', e.ratio < 0.30,
      `alias/wanted ${e.ratio.toFixed(3)} (${(10 * Math.log10(e.ratio)).toFixed(1)} dB)`);
    console.log(`       selective alias suppression at 2×: ${(-10 * Math.log10(e.ratio)).toFixed(1)} dB`);
  }

  // (d) Reverse is the same read with a sign, so the |rate| the kernel keys on
  // has to hold. Cheap, and it pins the absolute-value assumption.
  {
    const fwd = foldRatio(2), rev = foldRatio(-2);
    const m = rev.ratio / fwd.ratio;
    // Tight on purpose. At ±2 the two directions are the same read mirrored, so
    // anything but ~1.0 means the kernel is not keying on |rate| — and keying
    // on the SIGNED rate gives 1.90, which a lazy 0.5–2 window lets through.
    check('alias suppression at −2× matches +2×', m > 0.85 && m < 1.18,
      `reverse/forward alias-to-wanted ratio ${m.toFixed(3)}`);
  }

  // (e) The bypass boundary. `aplay.rate` is a controller target and will be
  // swept through 1×, where N steps 1 → 2. "Subtle click at unison under an
  // LFO" is precisely the bug class this engine keeps meeting, so the step is
  // measured rather than assumed inaudible.
  {
    let prev = null, worstJump = 0;
    for (let rate = 0.9; rate <= 1.1001; rate += 0.02) {
      const s = makeEngine({ fill: null });
      writeSine(s.p, 0.02);
      s.send('/part/0/bounds', 0, 8192);
      s.send('/zone/play/0/part', 0);
      s.send('/engine/glide', 0);
      s.send('/bus/out/gain', 1);
      s.send('/zone/play/0/region', 0, 8192);
      s.send('/zone/play/0/rate', rate);
      s.send('/zone/play/0/on');
      const x = collect(s, 8);
      let sum = 0;
      for (const v of x) sum += v * v;
      const rms = Math.sqrt(sum / x.length);
      if (prev !== null) worstJump = Math.max(worstJump, Math.abs(rms - prev) / prev);
      prev = rms;
    }
    check('no RMS step crossing the N=1 → N=2 boundary at 1×', worstJump < 0.02,
      `worst relative jump ${(worstJump * 100).toFixed(2)}% across a 0.9→1.1 rate sweep`);
  }

  // (f) Degenerate regions. A 4-point window in a region shorter than 4 samples
  // wraps indices onto each other; modular arithmetic on a degenerate window is
  // where sign errors live, and at length 1 all four taps are the same sample.
  {
    for (const len of [1, 2, 3]) {
      const s = makeEngine({ fill: 0.25 });
      s.send('/part/0/bounds', 0, 4096);
      s.send('/zone/play/0/part', 0);
      s.send('/engine/glide', 0);
      s.send('/bus/out/gain', 1);
      s.send('/zone/play/0/region', 0, len);
      s.send('/zone/play/0/on');
      // 40 quanta, not 12: the zone's gain approaches 1 exponentially, so at 12
      // it is still ~0.982 and the peak below misses by 1.8% for a reason that
      // has nothing to do with the reader. Run the ramp out rather than widen
      // the tolerance, which would blunt the assertion it exists to make.
      const res = s.run(40);
      check(`a ${len}-sample region produces no NaN`, res.nan === 0, `${res.nan} NaN samples`);
      if (len === 1) {
        check('a 1-sample region reads that sample, not silence', Math.abs(res.peak - 0.25) < 1e-3,
          `peak ${res.peak.toFixed(4)} — all four taps collapse onto one sample`);
      }
    }
  }

  // (g) The window's FIRST sample, where `i - 1` is negative. A Float32Array
  // read at -1 is `undefined`, `undefined` in the polynomial is NaN, and NaN
  // walks through §4.11's ceiling untouched because every comparison against
  // NaN is false — the exact mechanism of the bug this whole file was written
  // for, one index to the left. It gets its own check because no other test
  // here happens to land on that sample, which is precisely how it would ship:
  // a loop restart reads it on every pass.
  {
    const { p } = makeEngine({ fill: 0.3 });
    const first = p._cubic(0, 0, 0, 8);
    check('the first sample of the window wraps instead of reading off the front',
      Number.isFinite(first) && Math.abs(first - 0.3) < 1e-6, `got ${first}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll audio DSP checks passed.\n');
process.exit(failures ? 1 : 0);
