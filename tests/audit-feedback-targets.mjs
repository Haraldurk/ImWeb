/**
 * Static audit: the feedback transform passes must not use the ping-pong pool.
 *
 * Why this exists. Pipeline keeps exactly TWO general render targets and
 * alternates between them (`_pass`). The composited live frame sits in one of
 * them while the blend is being assembled, so any pass that runs in between and
 * takes a ping-pong slot can land on it.
 *
 * That is what the feedback transforms did. Rotate/zoom and offset/scale each
 * took a slot, and whether the second one overwrote the live frame depended on
 * how many passes the keyer / chroma / warp / displace chain had run earlier in
 * the same frame — parity, not intent. When it landed wrong, TRANSFERMODE
 * received the transformed prev frame as BOTH uFG and uBG and the live picture
 * disappeared from the output entirely.
 *
 * Two reasons this needs a static check rather than a runtime one:
 *
 *   1. The identity guard in `_pass()` cannot see it. The guard fires when a
 *      pass reads the texture it is about to write. Here nothing is aliased at
 *      the moment of the write — the clobbered texture is read by a LATER pass.
 *      A guard on values cannot catch a hazard that only exists across time.
 *   2. It is invisible in a still. The failure looks like "the feedback ate my
 *      picture", which reads as an artistic property of feedback, and it comes
 *      and goes as unrelated effects are switched on and off.
 *
 * The invariant: inside the blend/feedback block, the two transform passes go
 * through `_passTo(..., fbTarget())` — dedicated targets — never `_pass`.
 *
 * Run:  node tests/audit-feedback-targets.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(root, 'src/core/Pipeline.js'), 'utf8');

console.log('\nFeedback render-target audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.error(`  FAIL ${m}`); failed = true; };

// The blend block runs from the feedback offset reads to the colour-shift pass.
const start = src.indexOf("const fbHor    = p.get('feedback.hor')");
const end   = src.indexOf('// ── Color shift', start);
if (start < 0 || end < 0) {
  console.error('  FAIL could not locate the blend/feedback block in Pipeline.js');
  console.error('       (the markers moved — update this audit, do not delete it)');
  process.exit(1);
}
const block = src.slice(start, end);

// 1. Both transform materials are used, and only via _passTo.
for (const mat of ['feedbackRotate', 'feedback']) {
  const viaPassTo = new RegExp(`_passTo\\(this\\.m\\.${mat}\\b`).test(block);
  const viaPass   = new RegExp(`_pass\\(this\\.m\\.${mat}\\b`).test(block);
  if (viaPass) {
    fail(`this.m.${mat} runs through _pass — it must use _passTo with a dedicated target`);
  } else if (!viaPassTo) {
    fail(`this.m.${mat} pass not found in the blend block`);
  } else {
    ok(`this.m.${mat} renders to a dedicated target`);
  }
}

// 2. Those _passTo calls target the feedback pool, not something borrowed.
const passToCount   = (block.match(/_passTo\(/g) ?? []).length;
const fbTargetCount = (block.match(/\}\s*,\s*fbTarget\(\)\s*\)/g) ?? []).length;
if (!passToCount) {
  fail('no _passTo calls found in the blend block');
} else if (passToCount === fbTargetCount) {
  ok(`all ${passToCount} feedback passes target fbTarget()`);
} else {
  fail(`${passToCount} _passTo calls but ${fbTargetCount} target fbTarget() — ` +
       'a feedback pass is writing somewhere else');
}

// 3. The pool alternates. One shared target would make the second pass read the
//    texture it is writing, which IS what the identity guard exists to stop —
//    but _passTo has no guard, so it would simply render undefined content.
if (/_fbRT\[fbSlot\+\+ & 1\]/.test(src)) {
  ok('fbTarget() alternates between the two dedicated targets');
} else {
  fail('fbTarget() must alternate (_fbRT[fbSlot++ & 1]) so a pass never reads its own target');
}

// 4. The pool must resize with the output, or a window resize leaves the
//    feedback rendering at the old size and the trail visibly rescales.
if (/_fbRT\?\.forEach\(t => t\.setSize\(w, h\)\)/.test(src)) {
  ok('the feedback targets resize with the pipeline');
} else {
  fail('_fbRT is not resized in setSize()');
}

if (failed) {
  console.error('\nFAIL — feedback transforms must not share the ping-pong pool.\n');
  process.exit(1);
}
console.log('\nAll feedback render-target checks passed.\n');
