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
import { readFileSync } from 'node:fs';
// The handshake is version-gated, so the audit sends the CONSTANT — a literal
// here would keep passing through a bump and stop testing the gate.
import { PROTO_VERSION } from '../src/audio/protocol.js';

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
  send('/engine/hello', PROTO_VERSION);
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
  send('/engine/hello', PROTO_VERSION);
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

// ═══════════════════════════════════════════════════════════════════════════
//
// A structural edit a zone cannot honour is REFUSED, never parked.
//
// Reported from a real listening session: "recording to P0, P1, P2, P3 — it all
// goes to P0". `_zonePart`'s duck path parks the change in `pend` and lets the
// zone's gain ramp apply it at the bottom — but `pend` is only ever drained in
// `_renderPlay` and `_renderVoice`, so for a RECORDING zone it parked forever.
// `Partition Rec` moved in the UI, the take went on landing in the old
// partition, and nothing was reported. The click went nowhere.
//
// Third instance of the class: spectral and grain already have explicit
// early-return branches. The lasting question for any new zone type is "what
// drains `pend` for me?", and "nothing" must be answered here rather than
// discovered by a performer.
console.log('\na structural edit a running zone cannot honour is refused');
{
  const s = makeEngine({ fill: 0 });
  s.send('/part/0/bounds', 0, 256);
  s.send('/part/1/bounds', 256, 256);
  s.send('/part/2/bounds', 512, 256);

  s.send('/zone/rec/0/part', 2);
  check('a STOPPED recorder takes a new partition immediately',
    s.p._rec[0].part === 2, `part = ${s.p._rec[0].part}`);

  s.send('/zone/rec/0/part', 0);
  s.send('/zone/rec/0/region', 0, 256);
  s.send('/zone/rec/0/on');
  s.sent().length = 0;
  s.send('/zone/rec/0/part', 1);

  const ref = s.sent().filter((m) => m.a === '/engine/refuse');
  check('a RUNNING one refuses, rather than accepting and ignoring',
    ref.some((m) => /stop it to change partition/.test(m.v[1])),
    JSON.stringify(ref.map((m) => m.v)));
  check('and the partition is unchanged', s.p._rec[0].part === 0,
    `part = ${s.p._rec[0].part}`);
  // The specific defect: a parked flag nothing on this zone consumes. If a
  // future change reintroduces the duck path here, `pend` goes true and the
  // recording silently keeps writing where it was.
  check('with nothing parked in pend', s.p._rec[0].pend === false,
    'pend is only drained by _renderPlay/_renderVoice — a rec zone never clears it');
  s.run(200);
  check('and it stays unchanged however long it runs', s.p._rec[0].part === 0);

  // ORDER, not just presence. The refusal sits AFTER the range check, so an
  // impossible slot is reported as impossible rather than as "stop the zone" —
  // advice that would not help, about a partition that does not exist. Found by
  // a mutation that moved the branch one step earlier and survived: the section
  // above proves the refusal fires, and proved nothing about which one.
  s.sent().length = 0;
  s.send('/zone/rec/0/part', 99);
  const why = s.sent().filter((m) => m.a === '/engine/refuse').map((m) => m.v[1]);
  check('an impossible slot on a running recorder reports the RANGE, not the zone',
    why.some((t) => /out of range/.test(t)) && !why.some((t) => /stop it/.test(t)),
    JSON.stringify(why));

  s.send('/zone/rec/0/off');
  s.send('/zone/rec/0/part', 1);
  check('stopping it makes the change take, which is the documented way round',
    s.p._rec[0].part === 1, `part = ${s.p._rec[0].part}`);

  // A playback zone DOES duck, and must keep doing so — the fix is a branch for
  // one type, not a new blanket rule.
  const q = makeEngine({ fill: 0 });
  q.send('/part/0/bounds', 0, 256);
  q.send('/part/1/bounds', 256, 256);
  q.send('/zone/play/0/part', 0);
  q.send('/zone/play/0/region', 0, 256);
  q.send('/zone/play/0/on');
  q.run(2);
  q.send('/zone/play/0/part', 1);
  check('a running PLAYBACK zone still defers through the duck',
    q.p._play[0].pend === true && q.p._play[0].pendPart === 1,
    `pend = ${q.p._play[0].pend}, pendPart = ${q.p._play[0].pendPart}`);
  q.send('/zone/play/0/off');
  q.run(4000);
  check('and applies it at the bottom of the ramp',
    q.p._play[0].part === 1 && q.p._play[0].pend === false,
    `part = ${q.p._play[0].part}, pend = ${q.p._play[0].pend}`);
}

// ═══════════════════════════════════════════════════════════════════════════
//
// …and the CLIENT must not diverge from that refusal.
//
// The engine refusing keeps the audio right — the take goes on landing where it
// was. It cannot fix that `arec.part` has already changed on the client, so the
// button reads P1, the tape display draws the REC band over P1 (it reads the
// PARAM, not the engine), and the recording is in P0. Every surface agrees with
// every other surface and all of them are wrong. That is how this was reported
// the second time, WITH the engine fix in place: "recording into P1, it still
// goes into P0".
//
// Source text, because `AudioBinding` reaches `AudioEngine`'s Vite `?url` import
// and will not load in Node — the same forced exception as the step-11 and
// step-12 audits, and it is paired with the behavioural engine checks above,
// which cover what the engine does. Comments are stripped first: a check that
// matches the prose explaining it has now failed a correct file twice.
console.log('\nthe client reverts a refused partition rather than showing a lie');
{
  const raw = readFileSync(resolve(root, 'src/audio/AudioBinding.js'), 'utf8');
  const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  check('the guard asks whether the recorder is RUNNING',
    /if \(type === 'rec' && this\.ps\.get\('arec\.on'\)\.value\) \{/.test(src));
  check('and puts the parameter back',
    /_applyFromEngine\('arec\.part', this\._recPart\)/.test(src));
  check('through the echo-suppressing path, or the revert re-enters the handler',
    /_applyFromEngine\(id, value\) \{[\s\S]{0,160}?_fromEngine = true/.test(src));
  check('and says why, where the performer is looking',
    /stop Run Rec to change its partition/.test(src));
  // The revert must happen INSTEAD of the send, not alongside it.
  const guard = src.indexOf("if (type === 'rec' && this.ps.get('arec.on').value)");
  const send = src.indexOf('this._sendZonePart(type, v)');
  check('and returns before sending, so a refused change is never transmitted',
    guard > 0 && send > guard
      && /return this\._say\('recording — stop Run Rec/.test(src));

  // `_recPart` mirrors engine state, which is the shape of thing this project
  // keeps paying for. Exactly two assignments: the declaration, and one writer
  // sitting on the call that makes it true. A third is a second source of truth.
  const writes = [...src.matchAll(/this\._recPart\s*=[^=]/g)].map((m) => m[0]);
  check('_recPart is assigned exactly twice — a declaration and one writer',
    writes.length === 2, `${writes.length} assignments`);
  check('the declaration initialises it to a real slot',
    /this\._recPart = 0;/.test(src),
    'undefined would be reverted INTO the param before the first send');
  check('and the writer sits on the call that sends the value',
    /_sendZonePart\(type, slot\) \{\s*this\.engine\.zonePart\(type, 0, slot\);\s*if \(type === 'rec'\) this\._recPart = slot;/.test(src));
  // A second rec/play send site would move the engine without the mirror.
  const sends = [...src.matchAll(/this\.engine\.zonePart\((.+?),/g)].map((m) => m[1]);
  check('every zonePart send is either the helper or an explicit render zone',
    sends.every((a) => a === 'type' || a === "'spectral'" || a === "'grain'")
      && sends.filter((a) => a === 'type').length === 1,
    sends.join(' | '));
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
    // mutation.
    //
    // DO NOT try to reconcile these numbers with theory — the arithmetic does
    // not close, and it is the measurement that is limited, not the kernel. A
    // box of width rate/N has response |cos(πf)| here: −6.9 dB at 0.35 against
    // −0.1 dB at 0.05, which stacked on the 4.0 dB of cubic droop would predict
    // ~10.7 dB end to end, not 6.8. The kernel meets that model exactly when
    // measured in ISOLATION (−6.86 dB predicted, −6.86 dB measured at f =
    // 0.3501, N = 2 — verified in review, 2026-08-13). The end-to-end figure is
    // leakage-limited: this analysis window is not an integer number of alias
    // cycles, so the bin sits on a noise floor that a deeper suppression cannot
    // go below. What this check is for is SELECTIVITY, and mutation calibration
    // in both directions is what establishes that; the absolute dB is a
    // by-product with a floor under it.
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

// ── 11. the generator set (§4.10) ──────────────────────────────────────────
console.log('\nthe phase-one UGens — oscillator, noise, filter, saturator');
{
  const energyAt = (x, f) => {
    let re = 0, im = 0;
    const w = 2 * Math.PI * f;
    for (let n = 0; n < x.length; n++) { re += x[n] * Math.cos(w * n); im += x[n] * Math.sin(w * n); }
    return (re * re + im * im) / (x.length * x.length);
  };
  const rms = (x) => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length); };
  /** A voice, configured, with the gain ramp run out. NO TAPE ALLOCATED. */
  const voice = (cfg = {}, quanta = 32) => {
    const p = new Processor();
    const send = (a, ...v) => p.port.onmessage({ data: { a, t: '', v } });
    send('/engine/hello', PROTO_VERSION);
    send('/bus/out/gain', 1);
    send('/voice/0/level', cfg.level ?? 0.5);
    send('/voice/0/src', cfg.src ?? 0);
    send('/voice/0/wave', cfg.wave ?? 0);
    send('/voice/0/freq', cfg.freq ?? 480);            // 0.01 cycles/sample
    send('/voice/0/fm', cfg.fmRatio ?? 1, cfg.fmIndex ?? 0);
    send('/voice/0/colour', cfg.colour ?? 0.5);
    send('/voice/0/filter', cfg.cut ?? 20000, cfg.res ?? 0, cfg.ftype ?? 0);
    send('/voice/0/drive', cfg.drive ?? 0);
    send('/voice/0/on');
    const out = [new Float32Array(128), new Float32Array(128)];
    for (let q = 0; q < 80; q++) p.process([[]], [out]);   // settle every slew
    const x = [];
    for (let q = 0; q < quanta; q++) { p.process([[]], [out]); x.push(...out[0]); }
    return { p, x: Float32Array.from(x), send, out };
  };

  // A Voice has NO buffer region (§4.4), so it must sound with no tape. If this
  // ever fails the voice loop has drifted inside the `if (this._length)` guard,
  // which would make every generator silent until someone allocated a tape.
  {
    const { p, x } = voice();
    check('a voice sounds with NO tape allocated', rms(x) > 0.1 && p._length === 0,
      `rms ${rms(x).toFixed(4)}, tape length ${p._length}`);
    check('a voice produces no NaN', ![...x].some(Number.isNaN));
  }

  // The oscillator, at 0.01 cycles/sample. Each waveform's harmonic signature
  // is asserted, not just "it makes noise": a saw has BOTH even and odd
  // harmonics, a square only odd. Getting those backwards is the classic
  // waveform-table bug and sounds merely "different", not broken.
  {
    const f = 0.01;
    const saw = voice({ wave: 1 }).x;
    const sq = voice({ wave: 2 }).x;
    const sine = voice({ wave: 0 }).x;
    const h = (x, n) => energyAt(x, f * n);
    check('sine has a fundamental and negligible 2nd harmonic',
      h(sine, 1) > 1e-3 && h(sine, 2) < h(sine, 1) * 1e-4,
      `h1 ${h(sine, 1).toExponential(2)}, h2 ${h(sine, 2).toExponential(2)}`);
    check('saw has a strong EVEN harmonic', h(saw, 2) > h(saw, 1) * 0.1,
      `h2/h1 ${(h(saw, 2) / h(saw, 1)).toFixed(3)}`);
    check('square suppresses the even harmonic', h(sq, 2) < h(sq, 1) * 0.01,
      `h2/h1 ${(h(sq, 2) / h(sq, 1)).toExponential(2)} — a square is odd-only`);
  }

  // PolyBLEP. A naive saw steps by 2 once per cycle and that step has energy at
  // every harmonic, all of it above Nyquist folding back. Measured where it
  // hurts: a high fundamental, looking at a bin that no harmonic of the
  // fundamental lands on, so anything there arrived by folding.
  {
    // The fundamental must NOT be a simple rational, or every folded partial
    // lands back exactly on a harmonic bin and is unmeasurable. At 1/12 c/s —
    // the first fixture used here — harmonics sit at k/12 and aliases fold to
    // |k/12 − 1|, which are also multiples of 1/12: the test could not have
    // failed, and removing PolyBLEP entirely left it green.
    //
    // At 0.11 c/s the 9th harmonic sits at 0.99 and folds to 0.01, where no
    // real harmonic is (they are at 0.11, 0.22, …). That bin is alias or
    // nothing.
    const hi = voice({ wave: 1, freq: 0.11 * SR }).x;
    const alias = energyAt(hi, 0.01);
    const fund = energyAt(hi, 0.11);
    // Threshold from measurement: 1.15e-6 with PolyBLEP, 1.27e-2 without — a
    // factor of ~11,000. The first threshold here was 0.02, which sat ABOVE the
    // naive value and so passed with the correction deleted; the 9th harmonic
    // of a saw carries only 1/81 of the fundamental's energy, so "well under
    // the fundamental" is satisfied by an unbanded oscillator too.
    check('the band-limited saw keeps folded energy well under the fundamental',
      alias < fund * 1e-4,
      `alias(0.01)/fundamental ${(alias / fund).toExponential(2)}`);
  }

  // The phase input — §4.10's stated reason the oscillator has one at all.
  // Index 0 must be exactly the unmodulated oscillator, or FM is not free.
  {
    const plain = voice({ wave: 0, fmIndex: 0 }).x;
    const fm = voice({ wave: 0, fmIndex: 2, fmRatio: 2 }).x;
    const f = 0.01;
    const side = energyAt(fm, f * 3);
    check('FM index 0 leaves the carrier spectrally clean',
      energyAt(plain, f * 3) < energyAt(plain, f) * 1e-4,
      'an always-on modulator would put sidebands here');
    check('a non-zero FM index creates sidebands', side > energyAt(fm, f) * 0.05,
      `sideband/carrier ${(side / energyAt(fm, f)).toExponential(2)}`);
  }

  // Noise, and its one colour control. Dark must actually be darker.
  {
    const dark = voice({ src: 1, colour: 0 }).x;
    const bright = voice({ src: 1, colour: 1 }).x;
    const hf = (x) => energyAt(x, 0.4) / (energyAt(x, 0.02) + 1e-12);
    check('noise colour 0 is darker than colour 1', hf(dark) < hf(bright) * 0.5,
      `hf ratio dark ${hf(dark).toExponential(2)} vs bright ${hf(bright).toExponential(2)}`);
    // The RNG is explicit (§8.9 item 1) so a fork can copy it. Two engines with
    // the same seed must produce the SAME noise, or freeze cannot be a fork.
    const a = voice({ src: 1 }).x, b = voice({ src: 1 }).x;
    let same = true;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
    check('noise is deterministic from its seed (§8.9 needs a copyable RNG)', same,
      'Math.random() here would make a frozen render diverge from its parent');
  }

  // The filter. A lowpass well under a tone must remove it; the same structure
  // at the same cutoff in highpass must not.
  {
    const f = 0.05;                                  // 2400 Hz at 48k
    const lp = voice({ wave: 0, freq: 2400, cut: 300, ftype: 0 }).x;
    const hp = voice({ wave: 0, freq: 2400, cut: 300, ftype: 2 }).x;
    check('the SVF in lowpass attenuates a tone above its cutoff',
      energyAt(lp, f) < energyAt(hp, f) * 0.05,
      `lp ${energyAt(lp, f).toExponential(2)} vs hp ${energyAt(hp, f).toExponential(2)}`);
    // Resonance must not run away. Asserted on the FILTER, not on the output:
    // §4.11's ceiling bounds the bus unconditionally, so "peak ≤ 1" downstream
    // is true whatever the filter does — the first version of this check was
    // guaranteed to pass and stayed green with the damping term inverted into
    // self-oscillation. Drive an impulse through `_svf` directly and require
    // the ringing to DECAY.
    const { p: fp } = voice({ res: 1, cut: 1000 });
    const fv = fp._voices[0];
    fv.ic1 = fv.ic2 = 0;
    fv.resCur = 1; fv.cutCur = 1000; fv.ftypeCur = 0;
    let early = 0, late = 0;
    for (let n = 0; n < 20000; n++) {
      const y = Math.abs(fp._svf(fv, n === 0 ? 1 : 0));
      if (n > 100 && n < 1100) early = Math.max(early, y);
      if (n > 18000) late = Math.max(late, y);
    }
    check('resonance at maximum decays instead of self-oscillating', late < early * 0.5,
      `ring at 18k samples ${late.toExponential(2)} vs ${early.toExponential(2)} early`);
  }

  // The saturator. Drive must add harmonics rather than just volume — the
  // makeup division is what stops it reading as a second level control.
  {
    const clean = voice({ wave: 0, drive: 0, level: 0.5 }).x;
    const dirty = voice({ wave: 0, drive: 1, level: 0.5 }).x;
    const f = 0.01;
    const thd = (x) => energyAt(x, f * 3) / (energyAt(x, f) + 1e-12);
    check('drive adds harmonic content', thd(dirty) > thd(clean) * 50,
      `3rd/1st clean ${thd(clean).toExponential(2)} → driven ${thd(dirty).toExponential(2)}`);
    // Measured on `_sat` DIRECTLY, not through the bus: the limiter compresses
    // the very difference this asserts, and the end-to-end version stayed green
    // with the makeup division deleted. At unit level the gain ratio is 0.885
    // with makeup and 2.655 without, so the threshold has room either side.
    const { p: sp } = voice();
    let a = 0, b = 0;
    const M = 2000;
    for (let n = 0; n < M; n++) {
      const x = 0.5 * Math.sin(n * 0.1);
      a += x * x;
      const s = sp._sat(x, 1);
      b += s * s;
    }
    const gain = Math.sqrt(b / M) / Math.sqrt(a / M);
    check('drive is not merely a volume control', gain < 1.5,
      `saturator gain ×${gain.toFixed(3)} — makeup should hold it near 1`);
  }

  // Refusals. A voice index outside the set is refused, not clamped: silently
  // starting voice 7 for /voice/9/on is a message that looks accepted and does
  // something else, which is worse than one that is rejected.
  {
    const { p } = voice();
    p.__sent.length = 0;
    p.port.onmessage({ data: { a: '/voice/99/on', t: '', v: [] } });
    const ref = p.__sent.find((m) => m.a === '/engine/refuse');
    check('an out-of-range voice index is refused, not clamped', !!ref, 'no refusal sent');
  }

  // ── the four review findings on 5b (2026-08-13), each pinned ──────────────

  // (1) FM Ratio is a registered controller target, so setting it directly
  // stepped the modulator frequency at CONTROL rate — audible zipper noise, the
  // same class as the bounds ducking one level down. §4.11: every continuous
  // voice parameter is slewed inside the worklet.
  {
    const { p, send, out } = voice({ fmRatio: 1, fmIndex: 2 });
    const v = p._voices[0];
    send('/voice/0/fm', 8, 2);
    check('an FM ratio change lands as a slew TARGET, not on the value',
      v.fmRatioTgt === 8 && v.fmRatioCur < 8,
      `tgt ${v.fmRatioTgt}, cur ${v.fmRatioCur} — equal means it was written straight through`);
    for (let q = 0; q < 200; q++) p.process([[]], [out]);
    check('the FM ratio then ARRIVES at its target', v.fmRatioCur === 8,
      `cur ${v.fmRatioCur} — an exponential that never lands leaves the ratio permanently wrong`);
  }

  // (2) `modPhase` used to accumulate only while the index was non-zero, so
  // dialling FM out froze the modulator and re-engaging resumed from a stale
  // phase. Both voices here run the same number of samples, and the modulator
  // advance does not depend on the index, so the two phases must be identical.
  // Under the gated version the first is stuck at 0 and this fails.
  {
    const idle = voice({ fmIndex: 0 }).p._voices[0].modPhase;
    const live = voice({ fmIndex: 2 }).p._voices[0].modPhase;
    check('the modulator free-runs whether or not the index is engaged',
      Math.abs(idle - live) < 1e-12 && live > 0,
      `idle ${idle}, engaged ${live} — a frozen modulator jumps in timbre when FM returns`);
  }

  // (3) Source and waveform are discrete, so they duck rather than slew. Two
  // properties, and the second is the one that bites: a re-send must NOT duck,
  // or a controller parked on one waveform silences the voice forever.
  {
    const maxStep = (x) => {
      let m = 0;
      for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i] - x[i - 1]));
      return m;
    };
    const across = (poke) => {
      const { p, out } = voice({ wave: 0, level: 0.5 }, 1);
      poke(p);
      const x = [];
      for (let q = 0; q < 60; q++) { p.process([[]], [out]); x.push(...out[0]); }
      return { p, x: Float32Array.from(x) };
    };
    // Sine → TRIANGLE, deliberately: both are continuous waveforms whose own
    // per-sample step is ~0.02 here, so the largest step in the run is the
    // switch itself. Against a square the check is meaningless — its own edges
    // step by ~0.5 twice a cycle and swamp the thing being measured (this test
    // failed exactly that way first).
    const ducked = across((p) => p.port.onmessage({ data: { a: '/voice/0/wave', t: '', v: [3] } }));
    // The control: the same switch with the duck bypassed, which is what the
    // code did before. Self-calibrating — the threshold is the naive version's
    // own step, so this cannot pass by the signal being quiet.
    const naive = across((p) => { p._voices[0].wave = 3; });
    check('a waveform CHANGE ducks the voice, and the switch lands',
      ducked.p._voices[0].wave === 3 && !ducked.p._voices[0].pend,
      `wave ${ducked.p._voices[0].wave}, pend ${ducked.p._voices[0].pend}`);
    check('ducking removes the switching click', maxStep(ducked.x) < maxStep(naive.x) * 0.5,
      `max step ${maxStep(ducked.x).toFixed(4)} ducked vs ${maxStep(naive.x).toFixed(4)} naive`);
    {
      const { p, send, out } = voice({ wave: 2 });
      const v = p._voices[0];
      for (let q = 0; q < 20; q++) { send('/voice/0/wave', 2); p.process([[]], [out]); }
      check('re-sending the SAME waveform never ducks (rule 4: re-send is an update)',
        !v.pend && v.gainCur === 1,
        `pend ${v.pend}, gain ${v.gainCur} — a re-ducking voice goes silent under any controller`);
    }
  }
}

// ── 12. the read phase stays inside its region, in BOTH directions ─────────
//
// The negative side used to get one `+= room`, which bounds it only while
// |rate| < room. A fast reverse read of a two-sample region therefore walked the
// phase steadily negative. `_cubic` wraps every index it derives, so nothing
// misread — but the invariant `phase ∈ [0, room)` held on one side only, and a
// half-true invariant is what the next change trips over.
console.log('\nthe read phase wraps symmetrically');
{
  for (const rate of [-4, -3.7, 4]) {
    const s = makeEngine({ tapeSeconds: 1 });
    s.send('/part/0/bounds', 0, 4096);
    s.send('/zone/play/0/part', 0);
    s.send('/engine/glide', 0);
    s.send('/zone/play/0/region', 100.5, 2.25);   // a region ~2 samples long
    s.send('/zone/play/0/rate', rate);
    s.send('/zone/play/0/on');
    const r = s.run(200);
    const z = s.p._zones('play')[0];
    s.p._computeSpan(z);
    const room = s.p._sb - s.p._sa;
    check(`phase stays in [0, room) at rate ${rate}`, z.phase >= 0 && z.phase < room,
      `phase ${z.phase.toFixed(3)}, room ${room.toFixed(3)} after 200 quanta`);
    check(`no NaN reading a 2-sample region at rate ${rate}`, r.nan === 0, `${r.nan} NaN`);
  }
}

// ── 13. the envelope scan is paced, and says the same thing ────────────────
//
// §8.3 says bulk work is chunked across quanta, and the envelope is the biggest
// bulk read there is: a full 600-second stereo tape is 57.6 M sample reads. Done
// in the message handler — where it was — that is one `process()` call of
// hundreds of milliseconds, which on the audio thread is a dropout at exactly
// the moment the display first appears. Chunked, it is invisible to the client:
// same reply, same correlation, later.
console.log('\nthe envelope scan is paced across quanta');
{
  /** min/max per column, computed the obvious way, as the thing to match. */
  const reference = (p, a, b, cols) => {
    const out = new Float32Array(cols * 2);
    const span = b - a;
    for (let c = 0; c < cols; c++) {
      const i0 = a + Math.floor((c * span) / cols);
      const i1 = c === cols - 1 ? b : a + Math.floor(((c + 1) * span) / cols);
      let lo = 0, hi = 0;
      if (i1 > i0) {
        lo = Infinity; hi = -Infinity;
        for (const ch of p._tape) {
          for (let i = i0; i < i1; i++) { if (ch[i] < lo) lo = ch[i]; if (ch[i] > hi) hi = ch[i]; }
        }
      }
      out[c * 2] = lo; out[c * 2 + 1] = hi;
    }
    return out;
  };
  const dataFor = (s, reqId) =>
    s.sent().find((m) => m.a === '/tape/env/data' && m.v[0] === reqId);
  const errFor = (s, reqId) =>
    s.sent().find((m) => m.a === '/tape/env/err' && m.v[0] === reqId);

  // 8 seconds stereo = 768 k reads against a 131 k budget, so this MUST take
  // more than one quantum. A tape short enough to finish in one would let the
  // unchunked version pass every check below.
  {
    const s = makeEngine({ tapeSeconds: 8, fill: null });
    for (const ch of s.p._tape) for (let n = 0; n < ch.length; n++) ch[n] = Math.sin(n * 0.001) * 0.7;
    const cols = 512;
    s.send('/tape/env/req', 0, s.p._length, cols, 7);
    check('the reply does NOT arrive in the message handler', !dataFor(s, 7),
      'an unchunked scan answers before process() has run — and blocks it when it does');
    let quanta = 0;
    while (!dataFor(s, 7) && quanta < 200) { s.run(1); quanta++; }
    const msg = dataFor(s, 7);
    check('the scan finishes, across several quanta', !!msg && quanta > 1,
      `finished after ${quanta} quanta`);
    // The pacing has to be real, not just "more than one": 768 k reads over a
    // 131 k budget is 6 quanta, and anything far below that means the budget is
    // being ignored somewhere.
    check('the pacing matches the declared budget', quanta >= 5 && quanta <= 12,
      `${quanta} quanta for 768 k reads at 131 k/quantum`);
    const got = msg ? new Float32Array(msg.v[4]) : new Float32Array(0);
    const want = reference(s.p, 0, s.p._length, cols);
    let worst = 0;
    for (let i = 0; i < want.length; i++) worst = Math.max(worst, Math.abs(got[i] - want[i]));
    check('a chunked scan produces exactly the unchunked answer', got.length === want.length && worst === 0,
      `worst column deviation ${worst} — resuming mid-column must not lose a peak`);
  }

  // Resuming MID-COLUMN. One column over the whole tape puts 768 k reads in a
  // single column, so a scanner that could only stop at column boundaries would
  // have to blow the budget to answer at all.
  {
    const s = makeEngine({ tapeSeconds: 8, fill: null });
    const peakAt = 300000;
    for (const ch of s.p._tape) ch.fill(0.1);
    s.p._tape[0][peakAt] = 0.95;                 // one peak, deep inside the column
    s.send('/tape/env/req', 0, s.p._length, 1, 11);
    let quanta = 0;
    while (!dataFor(s, 11) && quanta < 200) { s.run(1); quanta++; }
    const got = new Float32Array(dataFor(s, 11).v[4]);
    // 768 k reads at 131 k/quantum is 6 — and the count is asserted, not just
    // "more than one", because a scanner that yields only between columns still
    // takes two quanta here (one to overrun, one to notice it had finished).
    check('a single column spanning the tape still resumes and keeps its peak',
      quanta >= 5 && Math.abs(got[1] - 0.95) < 1e-7,
      `${quanta} quanta, hi ${got[1]}`);
  }

  // Degenerate the other way: more columns than samples. Columns covering no
  // whole sample must report 0/0 — ±Infinity draws as NOTHING on a canvas, a
  // gap that reads as missing audio rather than as an empty column.
  {
    const s = makeEngine({ tapeSeconds: 1, fill: 0.25 });
    s.send('/tape/env/req', 0, 40, 200, 13);
    let quanta = 0;
    while (!dataFor(s, 13) && quanta < 50) { s.run(1); quanta++; }
    const got = new Float32Array(dataFor(s, 13).v[4]);
    check('columns finer than one sample are finite, not ±Infinity',
      [...got].every(Number.isFinite),
      'a canvas draws Infinity as a hole in the waveform');
  }

  // The queue is bounded. The client already coalesces one request per view, so
  // a deeper queue means the client is broken — and the honest answer is a
  // CORRELATED refusal, because an uncorrelated one leaves that view's promise
  // unresolved and it never asks again.
  {
    const s = makeEngine({ tapeSeconds: 8, fill: 0.5 });
    for (let i = 0; i < 4; i++) s.send('/tape/env/req', 0, s.p._length, 256, 100 + i);
    s.send('/tape/env/req', 0, s.p._length, 256, 104);
    const err = errFor(s, 104);
    check('a fifth queued request is refused, correlated by reqId', !!err && err.v[1] === 5,
      err ? `code ${err.v[1]}` : 'no /tape/env/err sent');
    check('the four accepted requests all still answer', (() => {
      for (let q = 0; q < 400; q++) s.run(1);
      return [100, 101, 102, 103].every((id) => !!dataFor(s, id));
    })(), 'a bounded queue must still drain');
  }

  // Reallocation retires what is queued. Those cursors index a tape that is
  // about to stop existing, and silence would leave the client holding a promise
  // that never settles — the same wedge the NO_TAPE reply is correlated to avoid.
  {
    const s = makeEngine({ tapeSeconds: 8, fill: 0.5 });
    s.send('/tape/env/req', 0, s.p._length, 256, 21);
    s.run(1);
    s.send('/engine/tape/alloc', 2);
    const err = errFor(s, 21);
    check('reallocating the tape settles a queued scan instead of dropping it',
      !!err && err.v[1] === 2 && s.p._envJobs.length === 0,
      err ? `code ${err.v[1]}, ${s.p._envJobs.length} left queued` : 'no error reply');
    s.run(20);
    check('and no stale reply arrives afterwards', !dataFor(s, 21),
      'a scan resumed against the new tape answers a question about material that is gone');
  }
}

// ── 14. worklet-resident controllers (§8.7) ────────────────────────────────
//
// The point of the section, restated as a test: evaluation happens on the audio
// thread, per sample. §8.7 lists three faults of evaluating on the rAF thread —
// the freeze in a hidden tab, a frame of jitter, and 60 Hz steps that are zipper
// noise on a fader — and only the third is measurable here. The first two are
// properties of WHERE the code runs, which the engine's zero-imports design
// makes structurally true: nothing in this file can see rAF.
console.log('\nworklet-resident controllers');
{
  /** An engine with one controller bound, its buffer filled for one quantum. */
  const ctrlRig = (address, { shape = 0, hz = 100, width = 0.5, mode = 0,
    lo = 0, hi = 1, map = 0 } = {}) => {
    const s = makeEngine({ tapeSeconds: 1 });
    s.send('/ctrl/0/target', address);
    s.send('/ctrl/0/lfo', shape, hz, width, mode);
    s.send('/ctrl/0/range', lo, hi, map);
    return s;
  };
  const buf0 = (s) => s.p._ctrls[0].buf;
  const refusals = (s) => s.sent().filter((m) => m.a === '/engine/refuse');

  // Per SAMPLE, not per quantum. A once-per-quantum evaluation would be 375 Hz —
  // six times better than the 60 Hz it replaces, much less code, and still a
  // staircase, which in audio is zipper noise rather than a visible stutter.
  {
    // A SAWTOOTH, deliberately: it is monotonic across the cycle, so every
    // sample is a new value. A sine at the same rate turns around inside the
    // quantum and repeats its own values on the way down — 69 distinct out of
    // 128, which says nothing about the evaluation rate.
    const s = ctrlRig('/voice/0/level', { shape: 2, hz: 200 });
    s.run(1);
    const b = buf0(s);
    const distinct = new Set([...b].map((v) => v.toFixed(9))).size;
    check('a controller produces a distinct value per SAMPLE', distinct === 128,
      `${distinct} distinct values across 128 samples — a per-quantum evaluation gives 1`);
    check('the values move monotonically within the cycle',
      b[1] > b[0] && b[2] > b[1], `${b[0]}, ${b[1]}, ${b[2]}`);
  }

  // Every shape, checked where it differs from the others rather than by name.
  {
    const at = (shape, t) => {
      // hz chosen so one quantum is exactly one cycle: 128 samples at 48 kHz.
      const s = ctrlRig('/voice/0/level', { shape, hz: SR / 128 });
      s.run(1);
      return buf0(s)[Math.round(t * 128)];
    };
    check('sine peaks at a quarter cycle', Math.abs(at(0, 0.25) - 1) < 0.02, `${at(0, 0.25)}`);
    check('triangle peaks at the half cycle', Math.abs(at(1, 0.5) - 1) < 0.05, `${at(1, 0.5)}`);
    check('sawtooth rises', at(2, 0.75) > at(2, 0.25), `${at(2, 0.25)} → ${at(2, 0.75)}`);
    check('ramp-down falls', at(3, 0.75) < at(3, 0.25), `${at(3, 0.25)} → ${at(3, 0.75)}`);
    check('square is two-valued', at(4, 0.25) === 1 && at(4, 0.75) === 0,
      `${at(4, 0.25)} / ${at(4, 0.75)}`);
    // Sample-and-hold must be flat WITHIN a cycle and different across cycles.
    // One cycle per FOUR quanta, so the first quantum is safely inside a cycle:
    // at exactly one cycle per quantum the boundary lands inside the block and
    // the check would fail on correct code.
    const sh = ctrlRig('/voice/0/level', { shape: 5, hz: SR / 512 });
    sh.run(1);
    const first = [...buf0(sh)];
    sh.run(4);
    check('sample-and-hold holds one value per cycle',
      new Set(first).size === 1 && buf0(sh)[0] !== first[0],
      `${new Set(first).size} values within a cycle, ${buf0(sh)[0]} vs ${first[0]} across one`);
  }

  // §8.7's rule 4: a re-sent description is an UPDATE. Nothing but /retrigger
  // restarts the wave — otherwise every unrelated field change becomes a hidden
  // retrigger, inaudible until the one recall where it matters.
  {
    const s = ctrlRig('/voice/0/level', { hz: 1 });
    s.run(40);
    const mid = s.p._ctrls[0].t;
    check('the wave actually advanced before the test', mid > 0, `t ${mid}`);
    s.send('/ctrl/0/lfo', 2, 3, 0.5, 0);          // shape AND rate change
    check('a re-sent description does not restart the wave', s.p._ctrls[0].t === mid,
      `t ${s.p._ctrls[0].t} after a description update`);
    s.send('/ctrl/0/range', -1, 1, 0);
    check('a range change does not restart it either', s.p._ctrls[0].t === mid);
    s.send('/ctrl/0/retrigger');
    check('retrigger, and only retrigger, restarts it', s.p._ctrls[0].t === 0,
      `t ${s.p._ctrls[0].t}`);
  }

  // Phase is an OFFSET and slides the wave under the playhead — `LFO.setPhase`'s
  // semantics. Setting it must not sound like a retrigger.
  {
    const s = ctrlRig('/voice/0/level', { hz: 1 });
    s.run(40);
    const before = s.p._ctrls[0].t;
    s.send('/ctrl/0/phase', 0.25);
    const after = s.p._ctrls[0].t;
    check('a phase offset slides the wave, it does not reset it',
      Math.abs(after - (before + 0.25)) < 1e-6 && after !== 0.25,
      `${before} → ${after}`);
    s.send('/ctrl/0/retrigger');
    check('retrigger then lands ON the offset', Math.abs(s.p._ctrls[0].t - 0.25) < 1e-9,
      `t ${s.p._ctrls[0].t}`);
  }

  // Range mapping. Exponential exists because rate and frequency are heard as
  // ratios — the midpoint of an exponential sweep is the geometric mean, and of
  // a linear one the arithmetic mean. That difference IS the feature.
  {
    const lin = ctrlRig('/voice/0/freq', { shape: 2, hz: SR / 128, lo: 100, hi: 1600, map: 0 });
    lin.run(1);
    const exp = ctrlRig('/voice/0/freq', { shape: 2, hz: SR / 128, lo: 100, hi: 1600, map: 1 });
    exp.run(1);
    check('a linear sweep passes through the arithmetic mean',
      Math.abs(buf0(lin)[64] - 850) < 20, `${buf0(lin)[64].toFixed(1)} Hz at the midpoint`);
    check('an exponential sweep passes through the GEOMETRIC mean',
      Math.abs(buf0(exp)[64] - 400) < 20, `${buf0(exp)[64].toFixed(1)} Hz — 400 is two octaves up from 100`);
    const bad = ctrlRig('/voice/0/level', { lo: -1, hi: 1, map: 1 });
    check('an exponential range through zero is refused, not demoted to linear',
      refusals(bad).length > 0, 'a ratio sweep across zero has no meaning');
  }

  // Binding. The rule is that a target is an address taking exactly one float,
  // and the engine enforces it rather than driving nothing quietly.
  {
    const s = makeEngine();
    s.send('/ctrl/0/target', '/voice/0/filter');   // three floats
    check('a multi-argument address is refused as a target', refusals(s).length === 1,
      'a controller that silently drives nothing reads as a broken LFO');
    s.send('/ctrl/0/target', '/voice/99/freq');
    check('an out-of-range target index is refused', refusals(s).length === 2);
    s.send('/ctrl/0/target', '/voice/0/freq');
    check('a valid target binds', s.p._voices[0].freqCtrl === 0 && refusals(s).length === 2);
    s.send('/ctrl/0/target', '');
    check('an empty address unbinds, and is not an error',
      s.p._voices[0].freqCtrl === -1 && refusals(s).length === 2);
  }

  // The two-controllers-one-target case, which is where a "undo what I claimed"
  // detach silently kills the wrong controller.
  {
    const s = makeEngine();
    s.send('/ctrl/3/target', '/voice/0/freq');
    s.send('/ctrl/5/target', '/voice/0/freq');
    check('the later bind wins the target', s.p._voices[0].freqCtrl === 5);
    s.send('/ctrl/3/target', '/voice/1/freq');
    check('retargeting the EARLIER slot leaves the winner alone',
      s.p._voices[0].freqCtrl === 5 && s.p._voices[1].freqCtrl === 3,
      `voice0 ${s.p._voices[0].freqCtrl}, voice1 ${s.p._voices[1].freqCtrl}`);
    s.send('/ctrl/5/clear');
    check('clearing the winner releases the target', s.p._voices[0].freqCtrl === -1);
  }

  // §4.11's slew must NOT filter a controller. It is an 8 ms one-pole meant to
  // de-zipper CONTROL-rate messages; a per-sample controller has no zipper to
  // remove, so leaving it in the path would round the edges off a square, drop
  // the depth of anything fast, and phase-shift the rest — the audio-rate
  // precision that justifies the whole section, filtered away by the mechanism
  // it supersedes. The controller writes cur AND tgt, so the value lands
  // exactly and the follower has nothing to chase.
  {
    const exact = (address, read) => {
      const s = ctrlRig(address, { shape: 4, hz: 300, lo: 0.2, hi: 0.9 });  // square
      s.send('/voice/0/on');
      s.send('/part/0/bounds', 0, SR);
      s.send('/zone/play/0/part', 0);
      s.send('/zone/play/0/region', 0, 24000);
      s.send('/zone/play/0/on');
      s.run(8);
      const want = buf0(s)[127];
      const got = read(s.p);
      return { want, got };
    };
    for (const [label, address, read] of [
      ['voice level', '/voice/0/level', (p) => p._voices[0].levelCur],
      ['voice freq', '/voice/0/freq', (p) => p._voices[0].freqCur],
      ['zone rate', '/zone/play/0/rate', (p) => p._zones('play')[0].rateCur],
      ['master gain', '/bus/out/gain', (p) => p._outGainCur],
    ]) {
      const { want, got } = exact(address, read);
      check(`a controlled ${label} lands EXACTLY on the controller's value`,
        Math.abs(got - want) < 1e-9,
        `${got} vs ${want} — a lagging value means §4.11's slew is still filtering the LFO`);
    }
  }

  // Ownership. A direct write to a controller-driven target is refused, not
  // accepted and then overwritten a sample later — last-writer-wins with a 20 µs
  // window presents as "the slider does nothing" and leaves no message to find.
  {
    const s = makeEngine();
    s.send('/voice/0/level', 0.4);
    check('an unbound target takes a direct write', s.p._voices[0].levelTgt === 0.4);
    s.send('/ctrl/0/target', '/voice/0/level');
    s.send('/ctrl/0/range', 0, 1, 0);
    const before = s.p._voices[0].levelTgt;
    s.send('/voice/0/level', 0.9);
    const ref = refusals(s);
    check('a direct write to an OWNED target is refused', ref.length === 1 && ref[0].v[0] === 6,
      ref.length ? `code ${ref[0].v[0]}` : 'no refusal sent');
    check('and the write does not land', s.p._voices[0].levelTgt === before,
      `levelTgt ${s.p._voices[0].levelTgt}`);
    // Owning a VALUE is not owning the voice.
    s.send('/voice/0/on');
    check('on/off is not refused by ownership',
      s.p._voices[0].on === true && refusals(s).length === 1);
    s.send('/ctrl/0/clear');
    s.send('/voice/0/level', 0.9);
    check('the target is writable again once the controller lets go',
      s.p._voices[0].levelTgt === 0.9 && refusals(s).length === 1);
  }

  // A bound rate drives real audio, end to end.
  {
    const s = ctrlRig('/zone/play/0/rate', { shape: 0, hz: 2, lo: 0.5, hi: 2, map: 1 });
    s.send('/part/0/bounds', 0, SR);
    s.send('/zone/play/0/part', 0);
    s.send('/zone/play/0/region', 0, 24000);
    s.send('/zone/play/0/on');
    const r = s.run(60);
    const z = s.p._zones('play')[0];
    check('a bound zone rate is driven and produces sound', r.nan === 0 && r.rms > 0.05,
      `rms ${r.rms.toFixed(4)}, ${r.nan} NaN`);
    check('the rate landed inside the declared range',
      z.rateCur >= 0.5 - 1e-3 && z.rateCur <= 2 + 1e-3, `rateCur ${z.rateCur}`);
  }

  // Response curves (§8.7). The 16384-point array `ResponseCurve` already holds
  // is SHIPPED, not reimplemented, so "one definition of an S-curve" is literal.
  {
    const TABLE_N = 16384;
    /** The same curve the client would hold: y = x². */
    const squared = () => {
      const t = new Float32Array(TABLE_N);
      for (let i = 0; i < TABLE_N; i++) { const x = i / (TABLE_N - 1); t[i] = x * x; }
      return t;
    };
    const rig = ({ table = null, invert = 0, tableId = 0 } = {}) => {
      const s = makeEngine({ tapeSeconds: 1 });
      if (table) s.send('/table/0/data', table.buffer);
      s.send('/ctrl/0/lfo', 2, SR / 128, 0.5, 0);        // sawtooth, one cycle per quantum
      s.send('/ctrl/0/range', 0, 1, 0, invert);
      if (table || tableId >= 0) s.send('/ctrl/0/table', table ? tableId : -1);
      s.send('/ctrl/0/target', '/voice/0/level');
      s.run(1);
      return s;
    };

    // Compared against the SAME engine with no curve attached, so the sweep's
    // own phase convention cancels out. Against a hand-computed x = i/128 the
    // expectation is a sample out — the phase advances before the value is
    // taken — and the first version of this check was wrong in exactly that way.
    const plain = rig({}).p._ctrls[0].buf;                 // x
    const shaped = rig({ table: squared() }).p._ctrls[0].buf;   // f(x) = x²
    const inverted = rig({ table: squared(), invert: 1 }).p._ctrls[0].buf;
    {
      let worst = 0, worstInv = 0;
      for (let i = 8; i < 120; i++) {
        worst = Math.max(worst, Math.abs(shaped[i] - plain[i] * plain[i]));
        // Invert BEFORE the curve, as `setNormalized` does: f(1 − x), never
        // 1 − f(x). With y = x² the two are plainly different shapes.
        worstInv = Math.max(worstInv, Math.abs(inverted[i] - Math.pow(1 - plain[i], 2)));
      }
      check('an uploaded curve shapes the sweep', shaped[64] < plain[64] * 0.8,
        `${shaped[64].toFixed(4)} vs ${plain[64].toFixed(4)} unshaped`);
      check('the curve is the client\'s, sample for sample', worst < 1e-3,
        `worst deviation ${worst.toExponential(2)}`);
      check('invert is applied BEFORE the response curve', worstInv < 1e-3,
        `worst deviation ${worstInv.toExponential(2)} — 1 − f(x) instead of f(1 − x)`);
    }

    // An unfilled slot is refused, not treated as identity. A curve that
    // silently stops shaping is the failure the eligibility rule exists for.
    {
      const s = makeEngine();
      s.send('/ctrl/0/table', 3);
      check('binding an EMPTY table slot is refused', refusals(s).length === 1,
        'identity-by-default is a response curve that quietly does nothing');
      s.send('/table/0/data', new Float32Array(256).buffer);
      check('a wrong-length upload is refused', refusals(s).length === 2,
        'a 256-point table stretched over 16384 entries is not an error, just wrong');
      s.send('/ctrl/0/table', -1);
      check('-1 detaches the curve without complaint', refusals(s).length === 2);
    }

    // A segment slew with no curve to read is refused for the same reason: it
    // would silently become no slew at all, which is a shape the performer
    // chose quietly not happening.
    {
      const s = makeEngine();
      s.send('/ctrl/0/slew', 4, 0.1, 0.45, 1);
      check('a segment slew with no curve is refused', refusals(s).length === 1,
        'it would degrade to no slew, silently');
      s.send('/ctrl/0/slew', 9, 0.1, 0.45, 1);
      check('an unknown slew mode is refused', refusals(s).length === 2);
      s.send('/ctrl/0/slew', 1, 0.1, 0.45, 1);
      check('a filter slew needs no curve', refusals(s).length === 2
        && s.p._ctrls[0].slewMode === 1);
    }
  }

  // The echo (§8.7's inversion). Off by default — an echo nobody reads is 60
  // messages a second of nothing — and aggregated to frame cadence (rule 7).
  {
    // A range where raw and mapped DIFFER, so the two numbers in the echo
    // cannot be confused for each other — with 0..1 they are equal and the
    // check would pass whichever was sent twice.
    const s = ctrlRig('/voice/0/freq', { hz: 5, lo: 100, hi: 200 });
    s.run(20);
    check('no echo until it is asked for',
      s.sent().every((m) => m.a !== '/ctrl/echo/data'), 'the engine offered it unasked');
    s.send('/ctrl/echo', true);
    s.run(20);
    const echoes = s.sent().filter((m) => m.a === '/ctrl/echo/data');
    check('the echo arrives once asked for', echoes.length > 0);
    // 20 quanta at 48 kHz is ~53 ms — about three frames, never twenty.
    check('the echo is aggregated to frame cadence, not per quantum',
      echoes.length <= 5, `${echoes.length} messages in 20 quanta`);
    const t = new Float32Array(echoes[echoes.length - 1].v[0]);
    check('the echo carries [slot, raw, mapped] for live slots only',
      t.length === 3 && t[0] === 0, `[${[...t].join(', ')}]`);
    // Both numbers travel because the two consumers want different ones: a
    // remote client wants the mapped value, ImWeb wants the raw 0..1 so it can
    // feed it back through setNormalized instead of inverting its own unit
    // conversions on the way in.
    check('the raw value is the shape output, in 0..1', t[1] >= 0 && t[1] <= 1, `${t[1]}`);
    check('the mapped value is in the TARGET\'s units',
      t[2] >= 100 && t[2] <= 200 && Math.abs(t[2] - (100 + 100 * t[1])) < 1e-3,
      `${t[2]} Hz for raw ${t[1]}`);
  }
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll audio DSP checks passed.\n');
process.exit(failures ? 1 : 0);
