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

import { makeLayer, tick, REST, CHAR_W } from './text-render-harness.mjs';

console.log('\nText render behaviour audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m, d) => {
  console.error(`  FAIL ${m}${d === undefined ? '' : ` — ${JSON.stringify(d)}`}`);
  failed = true;
};
const check = (m, cond, d) => (cond ? ok(m) : fail(m, d));

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

void REST;

if (failed) {
  console.error('\nFAIL — the Text layer is not drawing what it should.\n');
  process.exit(1);
}
console.log('\nText render behaviour is as specified.\n');
