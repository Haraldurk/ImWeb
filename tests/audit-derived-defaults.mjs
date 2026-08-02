/**
 * Derived-defaults audit.
 *
 * Why this exists. Exposing a hardcoded constant as a parameter is only a safe
 * change if the DEFAULT reproduces the constant it replaces. Otherwise every
 * existing patch silently renders differently the moment the param ships —
 * nothing errors, the picture just moves.
 *
 * Four SDF constants were exposed at once, and each default was derived rather
 * than rounded to something tidy:
 *
 *   vec3(0.5, 0.1, 0.8)            is HSV(274 deg, 0.875, 0.8)   -> glow colour
 *   normalize(vec3(1, 1.5, 2))     is az 27 deg / el 34 deg      -> light dir
 *   uv * 0.75                      is a 73.74 deg vertical FOV   -> sdf.fov
 *
 * The risk is not that someone deletes these. It is that someone "tidies" 274
 * to 270, or 74 to 75, or 27/34 to 30/35 — each of which looks like a harmless
 * default and each of which moves every saved patch.
 *
 * This cannot be a runtime check: the wrong default renders a perfectly valid
 * picture, just not the one the patch was built on.
 *
 * Where the original constant still exists in the source (uLightDir keeps its
 * `new THREE.Vector3(1, 1.5, 2).normalize()` initialiser) the audit compares
 * the two places against each other rather than against a number written here.
 *
 * Promoted from LEARNED.md 2026-07-31, [advisory] -> [audit].
 *
 * Run:  node tests/audit-derived-defaults.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src  = readFileSync(resolve(root, 'src/inputs/SDFGenerator.js'), 'utf8');

const ps = new ParameterSystem();
registerCoreParameters(ps);
const def = (id) => ps.params.get(id)?.value;

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ── 1. Light direction ───────────────────────────────────────────────────────
// The az/el defaults, run through the CPU formula in SDFGenerator, must
// reproduce the uniform's own initialiser. Both live in the source; this
// asserts they still agree.
console.log('\nlight direction — sdf.lightAz / sdf.lightEl');

const vecLit = /uLightDir:\s*\{\s*value:\s*new THREE\.Vector3\(([^)]*)\)\.normalize\(\)/.exec(src);
check('the uLightDir initialiser is still a literal we can read', vecLit !== null);

if (vecLit) {
  const [x, y, z] = vecLit[1].split(',').map((s) => Number(s.trim()));
  const len = Math.hypot(x, y, z);
  const want = [x / len, y / len, z / len];

  const DEG = Math.PI / 180;
  const az = def('sdf.lightAz') * DEG;
  const el = def('sdf.lightEl') * DEG;
  // Convention from SDFGenerator: (cos(el)sin(az), sin(el), cos(el)cos(az))
  const got = [
    Math.cos(el) * Math.sin(az),
    Math.sin(el),
    Math.cos(el) * Math.cos(az),
  ];

  for (const [i, axis] of ['x', 'y', 'z'].entries()) {
    check(`${axis} reproduces normalize(${vecLit[1].trim()})`,
      near(got[i], want[i], 0.01),
      `az=${def('sdf.lightAz')} el=${def('sdf.lightEl')} give ${got[i].toFixed(4)}, ` +
      `initialiser wants ${want[i].toFixed(4)}`);
  }
}

// ── 2. Glow colour ───────────────────────────────────────────────────────────
// HSV(274, 0.875, 0.8) must come back out as the original vec3(0.5, 0.1, 0.8).
console.log('\nglow colour — sdf.glowHue / glowSat / glowVal');

const hsv2rgb = (h, s, v) => {
  const c = v * s;
  const hp = (h % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] =
    hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] :
    hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const m = v - c;
  return [r + m, g + m, b + m];
};

const ORIGINAL_GLOW = [0.5, 0.1, 0.8];
const rgb = hsv2rgb(def('sdf.glowHue'), def('sdf.glowSat'), def('sdf.glowVal'));
for (const [i, ch] of ['r', 'g', 'b'].entries()) {
  check(`${ch} reproduces the original vec3(0.5, 0.1, 0.8)`,
    near(rgb[i], ORIGINAL_GLOW[i], 0.01),
    `HSV(${def('sdf.glowHue')}, ${def('sdf.glowSat')}, ${def('sdf.glowVal')}) ` +
    `gives ${rgb[i].toFixed(4)}, want ${ORIGINAL_GLOW[i]}`);
}

// The second colour stop defaults to the same colour, so a fresh patch shows a
// flat aura rather than a gradient nobody asked for.
console.log('\nglow stop 2 starts equal to stop 1');
for (const k of ['Hue', 'Sat', 'Val']) {
  check(`glow${k}2 matches glow${k}`, def(`sdf.glow${k}2`) === def(`sdf.glow${k}`),
    `${def(`sdf.glow${k}2`)} vs ${def(`sdf.glow${k}`)}`);
}

// ── 3. Field of view ─────────────────────────────────────────────────────────
// The ray setup uses focal = 1 / tan(fov/2). The constant it replaced was
// uv * 0.75, i.e. tan(fov/2) = 0.75.
console.log('\nfield of view — sdf.fov');

check('the ray setup still derives focal from tan(uFov * 0.5)',
  /focal\s*=\s*1\.0\s*\/\s*max\(tan\(uFov\s*\*\s*0\.5\)/.test(src),
  'if the projection changed, the 0.75 derivation below no longer applies');

const ORIGINAL_TAN_HALF = 0.75;
const fovFromConstant = 2 * Math.atan(ORIGINAL_TAN_HALF) * (180 / Math.PI); // 73.7398
check(`sdf.fov reproduces uv * 0.75 (${fovFromConstant.toFixed(2)} deg)`,
  near(def('sdf.fov'), fovFromConstant, 0.5),
  `default is ${def('sdf.fov')}, derivation gives ${fovFromConstant.toFixed(4)}`);

if (failures) {
  console.error(
    '\nDo not "fix" this by rounding the default to a tidier number — the tidier\n' +
    'number is the bug. A default that does not reproduce the constant it\n' +
    'replaced moves every saved patch, silently and without error. If the\n' +
    'underlying constant genuinely changed, update the derivation here and say\n' +
    'so in CHANGELOG.md, because existing projects will render differently.',
  );
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll derived-default checks passed.\n');
process.exit(failures ? 1 : 0);
