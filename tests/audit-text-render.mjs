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

void REST;

if (failed) {
  console.error('\nFAIL — the Text layer is not drawing what it should.\n');
  process.exit(1);
}
console.log('\nText render behaviour is as specified.\n');
