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

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll audio DSP checks passed.\n');
process.exit(failures ? 1 : 0);
