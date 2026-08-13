/**
 * The tape display: geometry, and agreement with the engine.
 *
 * Two things are checked here, and the second is the one that matters.
 *
 * `TapeView` imports nothing — that is a §4.1 consequence, not a coincidence,
 * and it is what makes the renderer drivable in Node against a stub 2D context.
 * The geometry rules it encodes are the ones that go wrong silently: a column
 * placed by index rather than by sample position looks right until a reply
 * arrives for a span the user has left, and a silent column drawn as nothing
 * looks exactly like a stretch of tape that does not exist.
 *
 * The second half checks that the OVERLAY AGREES WITH THE ENGINE. The binding
 * converts the same params twice — once into `/zone/<type>/<n>/region` for the
 * engine and once into rectangles for the display — and the two conversions are
 * written out separately. A display that disagrees with the engine about where a
 * zone is is worse than no display, because it is believed: you would move the
 * region until the picture looked right and the sound would be somewhere else.
 *
 * Run:  node tests/audit-audio-view.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { TapeView } from '../src/audio/TapeView.js';
import { partitionSpan, zoneSpan, clampToPartition } from '../src/audio/tape-geometry.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── a canvas that records instead of painting ──────────────────────────────
globalThis.window = { devicePixelRatio: 1 };
globalThis.requestAnimationFrame = (fn) => fn();

function stubCanvas(w = 400, h = 100) {
  const calls = [];
  const ctx = {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '',
    fillRect: (...a) => calls.push({ op: 'fillRect', a, fill: ctx.fillStyle }),
    fillText: (...a) => calls.push({ op: 'fillText', a }),
    beginPath: () => {}, moveTo: () => {}, lineTo: () => {}, stroke: () => {},
  };
  return {
    width: w, height: h, calls,
    getContext: () => ctx,
    getBoundingClientRect: () => ({ width: w, height: h }),
  };
}

const envelope = (cols, fill = (c) => [-0.5, 0.5]) => {
  const data = new Float32Array(cols * 2);
  for (let c = 0; c < cols; c++) {
    const [lo, hi] = fill(c);
    data[c * 2] = lo; data[c * 2 + 1] = hi;
  }
  return data;
};

console.log('the tape view draws what it was given');
{
  const el = stubCanvas(400, 100);
  const v = new TapeView(el);
  check('the backing store is one column per device pixel', v.columns === 400,
    `columns ${v.columns} for a 400 px canvas — asking for fewer loses peaks the screen could show`);
}

// A column is placed by SAMPLE POSITION, not by its index. During a zoom the
// reply for the previous span arrives after the view has moved, and an
// index-placed column would spread that answer across the whole new window —
// the waveform would appear to be of the right material in the wrong place.
{
  const el = stubCanvas(400, 100);
  const v = new TapeView(el);
  v.setSpan(0, 1);
  v.setEnvelope({ start: 0.25, end: 0.5, columns: 100, data: envelope(100) });
  v.draw();
  const bars = el.calls.filter((c) => c.op === 'fillRect' && c.a[3] > 1 && c.a[1] > 0);
  const xs = bars.map((b) => b.a[0]);
  check('an envelope narrower than the view draws only over its own span',
    bars.length > 0 && Math.min(...xs) >= 99 && Math.max(...xs) <= 201,
    `x range ${Math.min(...xs)}..${Math.max(...xs)} — expected ~100..200 of 400`);
}

// A silent column must still be a mark. "There is tape here and it is silent"
// and "there is no tape here" are different facts, and a viewer deciding where
// a recording actually starts is reading exactly that difference.
{
  const el = stubCanvas(400, 100);
  const v = new TapeView(el);
  v.setSpan(0, 1);
  v.setEnvelope({ start: 0, end: 1, columns: 400, data: envelope(400, () => [0, 0]) });
  v.draw();
  const bars = el.calls.filter((c) => c.op === 'fillRect' && c.a[3] >= 1 && c.a[2] >= 1 && c.a[1] > 0);
  check('a silent column draws as a hairline, not as nothing', bars.length >= 400,
    `${bars.length} marks for 400 silent columns`);
}

// With no envelope the frame still says something. An empty canvas and a
// broken canvas look identical.
{
  const el = stubCanvas(400, 100);
  const v = new TapeView(el);
  v.clearEnvelope('audio off');
  v.draw();
  const text = el.calls.find((c) => c.op === 'fillText');
  check('with no envelope the view states why', !!text && text.a[0] === 'audio off',
    text ? `drew "${text.a[0]}"` : 'nothing drawn');
}

// Partitions under, zones over. The layout is the ground the material sits on;
// a region is something being done to it, and a zone rectangle hidden behind a
// partition fill is a zone you cannot see.
{
  const el = stubCanvas(400, 100);
  const v = new TapeView(el);
  v.setSpan(0, 1);
  v.setRegions([
    { kind: 'play', start: 0.1, end: 0.2 },
    { kind: 'part', start: 0, end: 0.5 },
  ]);
  // Only the LAST paint: `invalidate()` runs the frame callback synchronously
  // under the stub, so setRegions has already drawn once by now.
  el.calls.length = 0;
  v.draw();
  const order = el.calls
    .filter((c) => c.op === 'fillRect' && c.a[3] === 100 && !/^#0a0a0b$/.test(c.fill))
    .map((c) => c.fill);
  check('partitions are drawn under zones regardless of list order',
    order.length === 2 && /0\.10/.test(order[0]) && /0\.18/.test(order[1]),
    `fills in order: ${order.join(' then ')}`);
}

// ── the overlay and the engine are given the same geometry ─────────────────
//
// `AudioBinding` cannot be imported here — it pulls in `AudioEngine`, which
// imports the worklet through Vite's `?url`. So the invariant is enforced
// STRUCTURALLY instead: both conversions go through `tape-geometry.js`, and the
// check below is that neither path has grown its own arithmetic since.
console.log('\nthe overlay and the engine share one conversion');
{
  const src = readFileSync(resolve(root, 'src/audio/AudioBinding.js'), 'utf8');
  const body = (name) => {
    const at = src.indexOf(`  ${name}(`);
    if (at < 0) return '';
    let depth = 0, i = src.indexOf('{', at);
    for (let j = i; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}' && --depth === 0) return src.slice(i, j);
    }
    return '';
  };
  const engineSide = body('_pushRegion');
  const viewSide = body('_pushRegionsToView');
  check('both region paths were located', !!engineSide && !!viewSide,
    'a rename makes every check below vacuous');
  check('the engine push goes through zoneSpan()', /zoneSpan\(/.test(engineSide),
    'a second copy of the conversion is a second answer waiting to disagree');
  check('the display push goes through the same zoneSpan()', /zoneSpan\(/.test(viewSide),
    'the display would be believed, and the sound would be somewhere else');
  check('neither path recomputes a partition span by hand',
    !/apart\$\{[a-z]+\}\.(start|len)/.test(engineSide + viewSide),
    'partition bounds must come from _part(), which clamps');
}

console.log('\nthe shared geometry itself');
{
  const p = partitionSpan(0.25, 0.25);
  check('a partition span is its own start and length', p.start === 0.25 && p.len === 0.25);
  check('an overlong partition loses LENGTH, never its start',
    partitionSpan(0.8, 0.5).start === 0.8 && Math.abs(partitionSpan(0.8, 0.5).len - 0.2) < 1e-9,
    'moving the start would silently relocate every zone bound to it');

  const z = zoneSpan(p, 0.5, 1);
  check('a zone span is partition-relative, expressed against the tape',
    Math.abs(z.start - 0.375) < 1e-9 && Math.abs(z.end - 0.625) < 1e-9,
    `${z.start} .. ${z.end}`);
  check('zoneSpan does NOT clamp — the engine applies the seam itself',
    z.end > p.start + p.len, 'clamping here would hide the unsafe case entirely');

  const clamped = clampToPartition(z, p, 0);
  check('the display clamps to the seam', Math.abs(clamped.end - 0.5) < 1e-9,
    `end ${clamped.end} — an unclamped rectangle shows material the zone never reaches`);
  check('unsafe crosses the seam it is allowed to cross',
    clampToPartition(z, p, 1).end === z.end,
    'the one deliberate way past a partition would look like a bug');
  check('a clamp never inverts a region',
    clampToPartition(zoneSpan(p, 2, 1), p, 0).end >= clampToPartition(zoneSpan(p, 2, 1), p, 0).start,
    'a start past the seam must collapse to zero width, not to a negative one');
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll tape-view checks passed.\n');
process.exit(failures ? 1 : 0);
