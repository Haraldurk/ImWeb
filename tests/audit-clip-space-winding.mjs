/**
 * Clip-space expansion winding audit.
 *
 * Why this exists. Geometry that is widened AFTER projection — screen-space
 * ribbons, billboards, thickness quads — has a triangle winding that depends on
 * where the camera is. The vertex shader offsets a clip-space position, so from
 * some angles the expanded triangles face away and are back-face culled, and
 * from others they are not. Such a material must set `side: THREE.DoubleSide`.
 *
 * Rutt-Etra rendered NOTHING at rutt.angle 0 — its own default — and rendered
 * fine at 65°. It read as "the source is broken", not "the winding is
 * backwards", precisely because the dead angle was the default. A forced-white
 * fragment shader still gave a lit-pixel count of 0, which is what ruled out
 * luminance and pointed at culling.
 *
 * This cannot be a runtime check: nothing throws, the draw call succeeds, and
 * the result is an empty frame that looks like a mis-routed source. It is also
 * angle-dependent, so a single screenshot can pass on broken code.
 *
 * The check is structural rather than a hardcoded file list, so it catches the
 * NEXT ribbon or billboard rather than only the one that already burned us.
 *
 * Promoted from LEARNED.md 2026-07-30, [advisory] -> [audit].
 *
 * Run:  node tests/audit-clip-space-winding.mjs
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|frag|vert)$/.test(name)) out.push(p);
  }
  return out;
};

/**
 * Does this source expand geometry in clip space?
 *
 * Two shapes count:
 *   vec4 clip = projectionMatrix * modelViewMatrix * ...;
 *   clip.y += ...;                       <- offset applied to the clip var
 *   gl_Position = clip;
 * and the direct form:
 *   gl_Position = projectionMatrix * ...;
 *   gl_Position.xy += ...;
 */
function findClipExpansion(text) {
  const hits = [];

  // Named clip variable, offset before assignment to gl_Position.
  for (const m of text.matchAll(
    /vec4\s+(\w+)\s*=\s*projectionMatrix\s*\*[^;]*;/g)) {
    const v = m[1];
    const after = text.slice(m.index + m[0].length);
    const stop = after.indexOf(`gl_Position = ${v}`);
    if (stop === -1) continue;
    const between = after.slice(0, stop);
    const off = new RegExp(`\\b${v}\\.(x|y|z|xy|xyz)\\s*[+\\-*/]?=`).exec(between);
    if (off) hits.push(`${v}${off[0].slice(v.length)} before gl_Position = ${v}`);
  }

  // gl_Position offset directly after being projected.
  if (/gl_Position\s*=\s*projectionMatrix/.test(text) &&
      /gl_Position\.(x|y|z|xy|xyz)\s*[+\-*/]?=/.test(text)) {
    hits.push('gl_Position offset after projection');
  }

  return hits;
}

const SIDE = /side\s*:\s*(THREE\.)?DoubleSide/;

console.log('\nscanning for clip-space expansion');
const found = [];
for (const file of walk(resolve(root, 'src'))) {
  const text = readFileSync(file, 'utf8');
  const hits = findClipExpansion(text);
  if (!hits.length) continue;
  const rel = relative(root, file);
  found.push({ rel, hits, doubleSided: SIDE.test(text) });
}

for (const { rel, hits, doubleSided } of found) {
  check(`${rel} sets DoubleSide  [${hits[0]}]`, doubleSided,
    'expanded in clip space but back-face culled at some camera angles');
}

// A detector that silently matches nothing would pass forever. If the codebase
// genuinely stops doing clip-space expansion this assertion should be deleted
// deliberately, not left to rot into a vacuous green tick.
check('the detector found at least one clip-space expansion',
  found.length > 0,
  'no matches — either the pattern changed shape or this audit is now vacuous');

if (failures) {
  console.error(
    '\nAdd `side: THREE.DoubleSide` to the material named above. Do not "fix"\n' +
    'this by flipping the winding or reordering vertices: the correct facing\n' +
    'depends on the camera, so there is no static winding that works from every\n' +
    'angle. Verify with a forced-white fragment shader and a lit-pixel count at\n' +
    'the DEFAULT angle — that is the one that hides the bug.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll clip-space winding checks passed.\n');
process.exit(failures ? 1 : 0);
