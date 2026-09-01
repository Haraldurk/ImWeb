/**
 * Behavioural audit: what the Text layer actually draws.
 *
 * Why this exists. TextLayer decides where every glyph goes, and until now the
 * only way to check that was to look at it — which this environment cannot do,
 * and which no CI run will ever do. Every claim about stagger ordering, glitch
 * determinism, path geometry and marquee wrapping was therefore unfalsifiable
 * in the suite.
 *
 * The invariant that matters most is the FIRST one: with every per-glyph
 * feature off, the layer must emit exactly one fillText per line. The glyph
 * features were refactored from a mutually-exclusive `else if` chain into
 * composed modifiers, and the whole refactor is only safe if the default case
 * came through it untouched. A per-glyph path that renders "correctly" but
 * costs one draw call per character on every project that uses none of these
 * features is a silent regression of exactly the kind this repo keeps paying
 * for.
 *
 * Run:  node tests/audit-text-render.mjs
 */

import { makeLayer, tick, audioFrame, REST, CHAR_W } from './text-render-harness.mjs';

console.log('\nText render behaviour audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL ${m}${d === undefined ? '' : ` — ${JSON.stringify(d)}`}`);
  failed = true;
};
const check = (m, cond, d) => (cond ? ok(m) : fail(m, d));

/**
 * Run the envelope to rest and return the LAST frame that actually drew.
 *
 * Once the followers converge the layer stops re-rendering — correctly, that
 * is the whole point of the dirty flag — so the final tick records nothing.
 * Reading that empty list made three assertions pass vacuously (`[].every()`
 * is true, and `new Set([]).size === [].length`), which is the failure mode
 * this helper exists to remove: it returns the real frame, and every caller
 * asserts a glyph count so an empty result can never read as a pass.
 */
const settle = (layer, opts, frames = 40) => {
  let last = [];
  for (let i = 0; i < frames; i++) {
    const c = tick(layer, opts, 0.016);
    if (c.length) last = c;
  }
  return last;
};

/**
 * A stepped spectrum: one level per glyph band when four glyphs span
 * 30 Hz - 20 kHz. Bins are ~94 Hz apart at 48 kHz, so the boundaries below are
 * the band edges, and the levels clear the noise gate without saturating after
 * the spectral tilt.
 */
const BANDS = (i) => (i < 2 ? 0.50 : i < 19 ? 0.20 : i < 148 ? 0.08 : 0.03);

// ── 1. The default case is untouched ────────────────────────────────────────

{
  const t = await makeLayer('ABCD');
  const c = tick(t);
  check('nothing on → one draw per line, whole string at once',
    c.length === 1 && c[0].s === 'ABCD' && c[0].rot === 0, c);
}

{
  const t = await makeLayer('AB\nCD');
  const c = tick(t, { 'text.mode': 3 });
  // Line mode shows one unit at a time, so this is still a single draw.
  check('multi-line content still draws by line, not by glyph',
    c.every(d => d.s.length > 1 || d.s === 'A'), c);
}

// ── 2. Per-glyph features ───────────────────────────────────────────────────

{
  const t = await makeLayer('ABCD');
  const c = tick(t, { 'text.animMode': 2, 'text.animSpeed': 1, 'text.animAmt': 50 }, 0.016);
  check('Wave draws per glyph on a fixed advance',
    c.length === 4 && c.map(g => g.x - c[0].x).join() === `0,${CHAR_W},${CHAR_W * 2},${CHAR_W * 3}`, c);
  check('Wave displaces in y, not x', new Set(c.map(g => g.y)).size > 1, c.map(g => g.y));
}

{
  const t = await makeLayer('ABCD');
  const o = { 'text.animMode': 5, 'text.animSpeed': 2, 'text.animAmt': 100 };
  const c = tick(t, o, 0.016);
  check('Glitch replaces every glyph at amt 100',
    c.length === 4 && c.filter((g, i) => g.s !== 'ABCD'[i]).length === 4, c.map(g => g.s).join(''));
  check('Glitch preserves the original advance',
    c.map(g => g.x - c[0].x).join() === `0,${CHAR_W},${CHAR_W * 2},${CHAR_W * 3}`, c.map(g => g.x));
  check('Glitch is stable within one scramble step',
    tick(t, o, 0).map(g => g.s).join('') === c.map(g => g.s).join(''));
}

// ── 3. Stagger ──────────────────────────────────────────────────────────────

{
  const t = await makeLayer('ABCD'); t.advance();
  const c = tick(t, { 'text.anim.in': 1, 'text.stagger': 80 }, 0.3);
  check('stagger: leading glyphs are further along than trailing ones',
    c.length > 0 && c.length < 4 && c.every((g, i) => i === 0 || g.a <= c[i - 1].a), c.map(g => g.a));
  check('stagger: glyphs whose own phase is still 0 are not drawn at all',
    c.length < 4, c.length);
}

{
  const t = await makeLayer('ABCD'); t.advance();
  const c = tick(t, { 'text.anim.in': 1, 'text.stagger': 80, 'text.staggerFrom': 2 }, 0.3);
  check('staggerFrom End leads with the last glyphs',
    c.length > 0 && c[c.length - 1].a > c[0].a, c.map(g => g.a));
}

{
  const t = await makeLayer('ABCD'); t.advance();
  const c = tick(t, { 'text.anim.in': 1, 'text.stagger': 80 }, 5);
  check('every glyph completes within anim.dur however wide the stagger',
    c.length === 1 && c[0].s === 'ABCD' && c[0].a === 1, c);
}

// ── 4. Decode ───────────────────────────────────────────────────────────────

{
  const t = await makeLayer('ABCD'); t.advance();
  const early = tick(t, { 'text.anim.in': 7 }, 0.05);
  const late  = tick(t, { 'text.anim.in': 7 }, 2);
  check('Decode scrambles on entry and resolves to the exact source string',
    early.filter((g, i) => g.s !== 'ABCD'[i]).length > 0 &&
    late.map(g => g.s).join('') === 'ABCD',
    { early: early.map(g => g.s).join(''), late: late.map(g => g.s).join('') });
}

// ── 5. Composition — the point of the modifier refactor ─────────────────────
//
// Glitch and stagger were branches of the same `else if`, so this combination
// could not be expressed at all before. It is the regression test for the
// refactor as a feature, not just as a no-op.

{
  const t = await makeLayer('ABCD'); t.advance();
  const c = tick(t, {
    'text.animMode': 5, 'text.animSpeed': 2, 'text.animAmt': 100,
    'text.anim.in': 1, 'text.stagger': 80,
  }, 0.3);
  check('Glitch and stagger compose: substituted glyphs AND a phase ramp',
    c.length > 0 && c.length < 4 &&
    c.filter((g, i) => g.s !== 'ABCD'[i]).length === c.length &&
    c.every((g, i) => i === 0 || g.a <= c[i - 1].a),
    c);
}

// ── 6. Resolution scaling ───────────────────────────────────────────────────

{
  const lo = tick(await makeLayer('AB'), { 'text.res': 0 });
  const hi = tick(await makeLayer('AB'), { 'text.res': 1 });
  check('text.res scales the geometry, not the layout',
    hi[0].x === lo[0].x * 2 && hi[0].y === lo[0].y * 2, { lo: lo[0], hi: hi[0] });
}

// ── 7. Marquee ──────────────────────────────────────────────────────────────

{
  const t = await makeLayer('ABCD');
  const c = tick(t, { 'text.scrollX': 25 }, 0.1);
  check('scroll tiles the line so it can wrap',
    c.length > 1 && new Set(c.map(d => d.x)).size === c.length, c.map(d => d.x));
  check('scroll draws whole lines, not glyphs, when nothing per-glyph is on',
    c.every(d => d.s === 'ABCD'), c.map(d => d.s));
}

{
  // The repetition count is computed from the period, not hardcoded: a
  // one-character marquee has a period of a few pixels and a fixed three
  // repetitions would leave most of the canvas empty.
  const t = await makeLayer('A');
  const wide = await makeLayer('A'.repeat(40));
  const cs = tick(t, { 'text.scrollX': 25, 'text.scrollGap': 0 }, 0.1);
  const cw = tick(wide, { 'text.scrollX': 25, 'text.scrollGap': 0 }, 0.1);
  check('a short marquee repeats more often than a long one',
    cs.length > cw.length, { short: cs.length, long: cw.length });
  check('the repetition count is capped, not unbounded', cs.length <= 66, cs.length);
}

{
  // Coverage: at any phase in the cycle the tiling must reach both edges, or
  // the crawl visibly stutters as it wraps.
  const t = await makeLayer('ABCD');
  let worstGapAtLeftEdge = -Infinity;
  for (let i = 0; i < 12; i++) {
    const c = tick(t, { 'text.scrollX': 60 }, 0.05);
    worstGapAtLeftEdge = Math.max(worstGapAtLeftEdge, Math.min(...c.map(d => d.x)));
  }
  check('the tiling always reaches past the left edge, at every phase',
    worstGapAtLeftEdge <= 0, worstGapAtLeftEdge);
}

{
  const t = await makeLayer('ABCD');
  const a = tick(t, { 'text.scrollX': 50 }, 0.1).map(d => d.x);
  const b = tick(t, { 'text.scrollX': 50 }, 0.1).map(d => d.x);
  check('the phase advances on dt, so the marquee actually moves',
    a.join() !== b.join(), { a, b });
}

// ── 8. Paths ────────────────────────────────────────────────────────────────

{
  // Round ON SCREEN, not on the canvas: the compositor stretches the square
  // source by the output aspect, so the canvas-space x must be pre-divided.
  const t = await makeLayer('ABCDEFGH');
  t.setOutputAspect(16 / 9);
  const c = tick(t, { 'text.path': 1, 'text.pathRadius': 40 });
  const cx = 256, cy = 256, R = 0.4 * 256;
  const radii = c.map(d => Math.hypot((d.x - cx) * (16 / 9), d.y - cy));
  const err = Math.max(...radii.map(r => Math.abs(r - R)));
  check('Circle: every glyph lands on a circle that is round on screen',
    c.length === 8 && err < R * 0.06, { R, radii: radii.map(r => +r.toFixed(1)) });
  check('Circle: glyphs are rotated to face along the curve',
    new Set(c.map(d => d.rot)).size === c.length, c.map(d => d.rot));
}

{
  const t = await makeLayer('ABCDEFGH');
  t.setOutputAspect(16 / 9);
  const c = tick(t, { 'text.path': 1, 'text.pathRadius': 40, 'text.pathUpright': 1 });
  check('pathUpright holds every glyph vertical while it still follows the ring',
    c.every(d => d.rot === 0) && new Set(c.map(d => d.x)).size > 1, c.map(d => d.rot));
}

{
  const t = await makeLayer('ABCDEFGH');
  const c = tick(t, { 'text.path': 3, 'text.pathRadius': 20, 'text.pathTwist': 100 });
  const r = c.map(d => Math.hypot(d.x - 256, d.y - 256));
  check('Spiral: the radius grows monotonically along the string',
    r.every((v, i) => i === 0 || v > r[i - 1] - 0.01), r.map(v => +v.toFixed(1)));
}

{
  const t = await makeLayer('ABCDEFGH');
  const circle = tick(t, { 'text.path': 1, 'text.pathRadius': 30, 'text.pathTwist': 100 });
  const plain  = tick(t, { 'text.path': 1, 'text.pathRadius': 30, 'text.pathTwist': 0 });
  check('pathTwist has exactly one owner — it does not deform Circle',
    circle.map(d => `${d.x},${d.y}`).join() === plain.map(d => `${d.x},${d.y}`).join());
}

{
  const t = await makeLayer('ABCD');
  const a = tick(t, { 'text.path': 2, 'text.pathSpread': 90 });
  const b = tick(t, { 'text.path': 2, 'text.pathSpread': 180 });
  const mid = (c) => c.reduce((s, d) => s + d.x, 0) / c.length;
  check('Arc centres its spread on pathAngle, so widening it keeps the arc put',
    Math.abs(mid(a) - mid(b)) < 2, { narrow: +mid(a).toFixed(2), wide: +mid(b).toFixed(2) });
}

{
  const t = await makeLayer('ABCDEFGH');
  const off = tick(t, { 'text.path': 1, 'text.pathRadius': 40 });
  const on  = tick(t, { 'text.path': 1, 'text.pathRadius': 40, 'text.pathFlip': 1 });
  // Compare glyph CENTRES, not the recorded draw positions. fillText is given
  // the glyph's left edge, and turning a glyph over swings that edge around to
  // the far side — the origin moves by one advance while the centre has not
  // moved at all. Asserting on the origin would fail correct code.
  const centre = (d) => [
    d.x + Math.cos(d.rot * Math.PI / 180) * CHAR_W / 2,
    d.y + Math.sin(d.rot * Math.PI / 180) * CHAR_W / 2,
  ];
  const flipped = (a, b) => Math.abs(((((a - b) % 360) + 360) % 360) - 180) < 0.01;
  check('pathFlip turns the glyphs over without moving them off the ring',
    off.every((d, i) => {
      const [ax, ay] = centre(d), [bx, by] = centre(on[i]);
      return Math.abs(ax - bx) < 0.01 && Math.abs(ay - by) < 0.01;
    }) && off.every((d, i) => flipped(d.rot, on[i].rot)),
    { off: off.map(d => d.rot), on: on.map(d => d.rot) });
}

{
  const t = await makeLayer('ABCD');
  t.setOutputAspect(16 / 9);
  const round = tick(t, { 'text.path': 1, 'text.pathRadius': 40 });
  const wide  = tick(t, { 'text.path': 1, 'text.pathRadius': 40, 'text.pathWidth': 200 });
  const spanX = (c) => Math.max(...c.map(d => d.x)) - Math.min(...c.map(d => d.x));
  const spanY = (c) => Math.max(...c.map(d => d.y)) - Math.min(...c.map(d => d.y));
  check('pathWidth stretches x only — an ellipse on purpose',
    spanX(wide) > spanX(round) * 1.9 && Math.abs(spanY(wide) - spanY(round)) < 0.01,
    { round: [spanX(round), spanY(round)], wide: [spanX(wide), spanY(wide)] });
}

// ── 9. Path and marquee compose ─────────────────────────────────────────────
//
// Scroll folds into the arc-length fraction, not into x. If it were added to x
// every repetition would land at the same angles and draw on top of itself.

{
  const t = await makeLayer('ABCD');
  const c = tick(t, { 'text.path': 1, 'text.pathRadius': 40, 'text.scrollX': 30 }, 0.1);
  const pos = new Set(c.map(d => `${d.x.toFixed(2)},${d.y.toFixed(2)}`));
  check('path + scroll: repetitions sit at DIFFERENT angles, not stacked',
    c.length > 4 && pos.size === c.length, { draws: c.length, distinct: pos.size });
}

{
  const t = await makeLayer('ABCD'); t.advance();
  const c = tick(t, {
    'text.path': 1, 'text.pathRadius': 40,
    'text.animMode': 5, 'text.animSpeed': 2, 'text.animAmt': 100,
    'text.anim.in': 1, 'text.stagger': 60,
  }, 0.3);
  check('path + glitch + stagger all compose in one pass',
    c.length > 0 &&
    c.every(d => d.rot !== 0) &&
    c.filter((d, i) => d.s !== 'ABCD'[i]).length === c.length &&
    c.some(d => d.a < 1),
    c);
}

// ── 10. Audio reactivity ────────────────────────────────────────────────────
//
// The point of this feature is that each glyph reads its OWN slice of the
// spectrum. A check that only proves "the text moves when there is sound"
// would pass just as happily on a single level driving every glyph, which is
// the thing it is not.

// Glyph → frequency is LOGARITHMIC, so these fixtures are written in bins that
// correspond to real BANDS. At 48 kHz with 256 bins each bin is ~94 Hz, and the
// span runs 50 Hz → fTop. A fixture written as "the bottom eighth of the bins"
// is 0–2.3 kHz, which under log spacing is most of the WORD — it cannot tell
// the leading glyphs from the trailing ones, and a check built on it passes
// whatever the mapping does.

{
  // Energy only below ~200 Hz: on a log axis that is the first letter or two.
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame((i) => (i <= 2 ? 1 : 0)));
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0 };
  const c = settle(t, o);
  check('Spectrum: a bass-only signal scales the LEADING glyphs, not the rest',
    c.length === 8 && c[0].scale > 1.05 && c[7].scale < 1.01,
    c.map(d => d.scale));
}

{
  // The other end, and the check that would have FAILED before the mapping was
  // made logarithmic. Energy only above ~9 kHz: with a linear spread over the
  // default range those bins fell outside the word entirely and nothing moved.
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame((i) => (i >= 96 ? 1 : 0)));
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 };
  const c = settle(t, o);
  check('Spectrum: a treble-only signal reaches the TRAILING glyphs',
    c.length === 8 && c[7].scale > 1.05 && c[0].scale < 1.01,
    c.map(d => d.scale));
}

{
  // Every letter must have a band with something in it. A linear spread left
  // the top half of a word permanently still on real material, which is what
  // forced AudioRange down to 5 % and threw the treble away.
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame(() => 0.5));                       // flat spectrum
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 };
  const c = settle(t, o);
  check('every glyph gets a live band — none is left permanently still',
    c.length === 8 && c.every(d => d.scale > 1.05), c.map(d => d.scale));
}

{
  // The same signal on a uniform band must move every glyph equally — this is
  // the control that proves the check above is measuring per-glyph mapping.
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame((i, n) => (i < n / 8 ? 1 : 0), 256, { level: 1 }));
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioBand': 1 };
  const c = settle(t, o);
  check('Level: one number drives every glyph the same amount',
    c.length === 8 && c.every(d => Math.abs(d.scale - c[0].scale) < 1e-6) && c[0].scale > 1.05,
    c.map(d => d.scale));
}

// ── Focus, and spaces ───────────────────────────────────────────────────────
//
// The owner's own statement of the goal: with "IMWEB FUTURE", a bass sound
// should move the I and not the whole of IMWEB. That is a selectivity control,
// and these are the checks that say whether it works.

{
  // A bass note over a broadband floor — a real sound, not a lab tone. This is
  // the owner's case: the low peak should claim the front of the word and the
  // rest should settle, rather than the whole sentence shimmering.
  //
  // Note what this canNOT do, deliberately: a genuinely FLAT band of energy
  // gives several letters identical readings, and nothing should separate
  // them. Focus sharpens a peak; it does not invent one.
  const tone = (i) => Math.max(0.2, 1 - i / 25);
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 };

  const broad = await makeLayer('ABCDEFGH');
  broad.setAudio(audioFrame(tone));
  const cb = settle(broad, { ...o, 'text.audioFocus': 0 });

  const tight = await makeLayer('ABCDEFGH');
  tight.setAudio(audioFrame(tone));
  const ct = settle(tight, { ...o, 'text.audioFocus': 100 });

  const moving = (c) => c.filter(d => d.scale > 1.02).length;
  check('Focus narrows a tone onto FEWER letters',
    cb.length === 8 && ct.length === 8 && moving(ct) < moving(cb),
    { broad: moving(cb), tight: moving(ct) });
  check('…and it leaves a front-to-back gradient, not a flat block',
    ct[0].scale > ct[2].scale && ct[2].scale > ct[4].scale,
    ct.map(d => +d.scale.toFixed(2)));
}

{
  // Broadband sound is the case narrow filters alone cannot fix: every letter
  // has something to react to. Competition is what makes one win.
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 };
  const shaped = (i) => (i < 3 ? 0.9 : 0.35);   // energy everywhere, a bass peak

  const broad = await makeLayer('ABCDEFGH');
  broad.setAudio(audioFrame(shaped));
  const cb = settle(broad, { ...o, 'text.audioFocus': 0 });

  const tight = await makeLayer('ABCDEFGH');
  tight.setAudio(audioFrame(shaped));
  const ct = settle(tight, { ...o, 'text.audioFocus': 100 });

  const spread = (c) => Math.max(...c.map(d => d.scale)) - Math.min(...c.map(d => d.scale));
  check('on BROADBAND sound, Focus still separates the letters',
    cb.length === 8 && ct.length === 8 && spread(ct) > spread(cb),
    { broad: +spread(cb).toFixed(3), tight: +spread(ct).toFixed(3) });
}

{
  // Focus 0 must remain the old broad behaviour, so the control is additive
  // rather than a change to what everyone already has.
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame(() => 0.5));
  const c = settle(t, { ...{ 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 }, 'text.audioFocus': 0 });
  check('Focus 0 leaves every letter live (the broad behaviour is intact)',
    c.length === 8 && c.every(d => d.scale > 1.05), c.map(d => +d.scale.toFixed(2)));
}

{
  // Spaces must not consume a slice of the spectrum: a four-word line would
  // otherwise spend three of its bands on characters that never draw.
  const o = { ...{ 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 }, 'text.audioFocus': 0 };
  const spaced = await makeLayer('AB CD');
  spaced.setAudio(audioFrame(() => 0.5));
  const cs = settle(spaced, o);
  const plain = await makeLayer('ABCD');
  plain.setAudio(audioFrame(() => 0.5));
  const cn = settle(plain, o);
  check('spaces take no share of the spectrum — four letters band identically',
    cs.length === 4 && cn.length === 4 &&
    cs.every((d, i) => Math.abs(d.scale - cn[i].scale) < 1e-6),
    { spaced: cs.map(d => +d.scale.toFixed(3)), plain: cn.map(d => +d.scale.toFixed(3)) });
}

{
  const t = await makeLayer('ABCDEFGH');
  t.setAudio(audioFrame(() => 0));
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100 };
  const c = settle(t, o);
  check('silence leaves the glyphs at rest',
    c.length === 8 && c.every(d => Math.abs(d.scale - 1) < 1e-6), c.map(d => d.scale));
}

{
  // Fast attack, slow release. A symmetric filter would fail this both ways.
  const t = await makeLayer('AAAA');
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 100 };
  t.setAudio(audioFrame(() => 1));
  const rise = tick(t, o, 0.05);
  t.setAudio(audioFrame(() => 0));
  const fall = tick(t, o, 0.05);
  check('the envelope attacks fast and releases slowly',
    rise[0].scale > 1.4 && fall[0].scale > rise[0].scale * 0.6,
    { rise: rise[0].scale, fall: fall[0].scale });
}

{
  // Falling as well as rising must keep re-rendering, or the text freezes at
  // its loudest and stays there — the failure you would only notice as
  // "why is it stuck bright".
  const t = await makeLayer('AAAA');
  const o = { 'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 80 };
  t.setAudio(audioFrame(() => 1));
  settle(t, o);
  t.setAudio(audioFrame(() => 0));
  const a = tick(t, o, 0.016);
  const b = tick(t, o, 0.016);
  check('the decay keeps re-rendering — the text does not stick at its loudest',
    a.length > 0 && b.length > 0 && b[0].scale < a[0].scale, { a: a[0]?.scale, b: b[0]?.scale });
}

{
  const t = await makeLayer('ABCD');
  // A STEPPED spectrum, one level per glyph band. A smooth ramp will not do:
  // the tilt is designed to flatten a falling spectrum, so a ramp comes out
  // nearly uniform and the check stops discriminating. Levels are chosen to
  // clear the gate without saturating.
  const o = { 'text.audioTarget': 3, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000, 'text.outline': 4 };
  t.setAudio(audioFrame(BANDS));
  const c = settle(t, o);
  check('Hue: each glyph takes its own colour, and the OUTLINE pass keeps it',
    c.length === 4 && new Set(c.map(d => d.fill)).size === 4, c.map(d => d.fill));
}

{
  const t = await makeLayer('ABCD');
  const o = { 'text.audioTarget': 4, 'text.audioAmt': 100, 'text.audioSmooth': 0,
              'text.audioLo': 30, 'text.audioHi': 20000 };
  t.setAudio(audioFrame(BANDS));
  const c = settle(t, o);
  check('Weight: each glyph gets its own weight, and the advance does NOT move',
    c.length === 4 && new Set(c.map(d => d.font)).size === 4 &&
    c.map(d => d.x - c[0].x).join() === `0,${CHAR_W},${CHAR_W * 2},${CHAR_W * 3}`,
    c.map(d => d.font));
}

{
  // Audio runs INSIDE placement, so a glyph on a ring pulses in place rather
  // than being flung off it.
  const t = await makeLayer('ABCDEFGH');
  t.setOutputAspect(16 / 9);
  const o = { 'text.path': 1, 'text.pathRadius': 40,
              'text.audioTarget': 1, 'text.audioAmt': 100, 'text.audioSmooth': 0 };
  t.setAudio(audioFrame(() => 1));
  const c = settle(t, o);
  const R = 0.4 * 256;
  const radii = c.map(d => Math.hypot((d.x - 256) * (16 / 9), d.y - 256));
  check('audio + path: glyphs pulse ON the ring, not off it',
    c.length === 8 && c.every(d => d.scale > 1.05) &&
    radii.every(r => Math.abs(r - R) < R * 0.15),
    { scales: c.map(d => d.scale), radii: radii.map(r => +r.toFixed(1)) });
}

{
  const t = await makeLayer('ABCD');
  t.setAudio(null);
  const c = tick(t, { 'text.audioTarget': 1, 'text.audioAmt': 100 }, 0.016);
  check('no audio host at all is silence, not an error',
    c.length === 4 && c.every(d => Math.abs(d.scale - 1) < 1e-6), c.map(d => d.scale));
}

void REST;

if (failed) {
  console.error('\nFAIL — the Text layer is not drawing what it should.\n');
  process.exit(1);
}
console.log('\nText render behaviour is as specified.\n');
