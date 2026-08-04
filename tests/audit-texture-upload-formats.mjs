/**
 * Texture upload format audit.
 *
 * Why this exists. Every texture this project uploads must use a format/type
 * combination that WebGL2 can give a SIZED internal format, and any texture
 * that is sampled with LinearFilter must be of a type WebGL2 can filter
 * without an extension. Both are silent when violated.
 *
 * The LUT had both problems. `Pipeline.setLUT` uploaded the 3D LUT as
 * `RGBFormat + FloatType`. three r168 still DEFINES `RGBFormat` — so the
 * constant resolves, nothing is undefined, and no warning is printed — but
 * `getInternalFormat` picks no sized internal format for RGB (it only upgrades
 * RGB for `UNSIGNED_INT_5_9_9_9_REV`). The call therefore went out as unsized
 * RGB + FLOAT, which WebGL2 rejects: `texImage2D` raised INVALID_OPERATION,
 * the texture stayed incomplete, and every `texture2D()` against it returned
 * (0,0,0,1). Load a .cube, raise LUT Amount, and the entire picture went
 * black. The colour grade panel had never worked in WebGL2.
 *
 * The lesson generalises past the incident, and that is the reason this audit
 * is not just three assertions about setLUT: **"three still exports the
 * constant" is not "three still supports the upload."** The constant table and
 * `getInternalFormat` disagree, and only the second one runs. Checking that a
 * name resolves proves nothing.
 *
 * The second half — `RGBA16F` rather than `RGBA32F` — is not cosmetic. A
 * linearly filtered RGBA32F texture needs `OES_texture_float_linear`, and
 * samples black without it. That is the same black screen, hidden until it
 * reaches a device that lacks the extension, which for this project means the
 * iPad rather than the desk.
 *
 * This cannot be a runtime check. The bad upload happens once at load time in
 * a path that cannot throw usefully, the GL error is only visible to whoever
 * calls `gl.getError()` on that exact tick, and the resulting picture — solid
 * black — is a picture the instrument is legitimately allowed to produce.
 * Nothing downstream can tell a rejected upload from a dark frame.
 *
 * Run:  node tests/audit-texture-upload-formats.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? `\n       ${detail}` : ''}`); failures++; }
};

// ── Collect every .js under src/ ────────────────────────────────────────────
const jsFiles = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (name.endsWith('.js')) jsFiles.push(p);
  }
})(join(root, 'src'));

/** Lines that are wholly a comment — a live upload is never on one. */
const isCommentLine = (line) => /^\s*(\/\/|\/\*|\*)/.test(line);

const liveHits = (re) => {
  const hits = [];
  for (const file of jsFiles) {
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (isCommentLine(line)) return;
      if (re.test(line)) hits.push(`${relative(root, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  return hits;
};

console.log('\nTexture upload format audit\n');

// ── 1. The rule: only formats three can SIZE may be used ────────────────────
// three's getInternalFormat upgrades RED/RG/RGBA (and the *Integer variants) to
// sized internal formats. It does NOT size RGB, LUMINANCE, LUMINANCE_ALPHA or
// ALPHA — those stay unsized and accept only UNSIGNED_BYTE, so pairing any of
// them with a float type is the exact defect that blacked out the LUT.
console.log('Formats that three cannot size:');

const UNSIZEABLE = [
  ['RGBFormat',            'use THREE.RGBAFormat and widen the data to 4 components'],
  ['RGBIntegerFormat',     'use THREE.RGBAIntegerFormat'],
  ['LuminanceFormat',      'use THREE.RedFormat (R8/R16F/R32F) and swizzle in the shader'],
  ['LuminanceAlphaFormat', 'use THREE.RGFormat and swizzle in the shader'],
  ['AlphaFormat',          'use THREE.RedFormat and swizzle in the shader'],
];

for (const [fmt, remedy] of UNSIZEABLE) {
  const hits = liveHits(new RegExp(`THREE\\.${fmt}\\b`));
  check(
    `no live use of THREE.${fmt}`,
    hits.length === 0,
    hits.length ? `${hits.join('\n       ')}\n       FIX: ${remedy}.\n` +
      `       three still EXPORTS this constant, so it resolves and nothing warns —\n` +
      `       but getInternalFormat leaves it unsized and the upload is rejected.` : ''
  );
}

// ── 2. The LUT path specifically ────────────────────────────────────────────
// The regression that motivated this audit. Checked as a shape, not a string
// match on one line, so a rewrite that preserves the invariant still passes.
console.log('\nPipeline.setLUT — the LUT upload:');

const pipelineSrc = readFileSync(join(root, 'src/core/Pipeline.js'), 'utf8');
const setLutBody = pipelineSrc.slice(
  pipelineSrc.indexOf('setLUT('),
  pipelineSrc.indexOf('clearLUT()')
);
check('setLUT() body located', setLutBody.length > 200 && setLutBody.includes('DataTexture'));

const lutTexCall = setLutBody.match(/new THREE\.DataTexture\([^)]*\)/s)?.[0] ?? '';
check(
  'LUT texture is RGBAFormat',
  /THREE\.RGBAFormat/.test(lutTexCall),
  `got: ${lutTexCall || '(no DataTexture call found)'}`
);
check(
  'LUT texture is HalfFloatType, not FloatType',
  /THREE\.HalfFloatType/.test(lutTexCall) && !/THREE\.FloatType/.test(lutTexCall),
  'RGBA32F needs OES_texture_float_linear and samples BLACK without it; ' +
  'RGBA16F is filterable in core WebGL2.'
);
check(
  'LUT is linearly filtered (the reason the type must be half-float)',
  /minFilter\s*=\s*THREE\.LinearFilter/.test(setLutBody) &&
  /magFilter\s*=\s*THREE\.LinearFilter/.test(setLutBody),
  'if this ever becomes NearestFilter the half-float requirement relaxes — ' +
  'but so does LUT interpolation quality. Do not silently swap it.'
);
check(
  'LUT buffer is a Uint16Array (half-float storage), not Float32Array',
  /new Uint16Array\(/.test(setLutBody) && !/new Float32Array\(/.test(setLutBody),
  'HalfFloatType expects 16-bit storage; a Float32Array here is a 2x ' +
  'over-read and uploads garbage.'
);
check(
  'LUT buffer is allocated with 4 components per texel',
  /new Uint16Array\(\s*N \* N \* N \* 4\s*\)/.test(setLutBody),
  'the parser emits tightly packed RGB; a 3-component allocation here is a ' +
  'quarter short and the upload is rejected for size.'
);
check(
  'the RGB->RGBA widening steps 3 in, 4 out',
  /i \+= 3,\s*o \+= 4/.test(setLutBody),
  'stride mismatch silently shears the cube along its own axes.'
);

// ── 3. The alpha constant is really 1.0 in half-float ───────────────────────
// 0x3c00 is a magic number. Someone "tidying" it to 1.0 would write a
// half-float denormal of ~6e-8 into alpha instead. Decode it and prove it.
console.log('\nHalf-float alpha constant:');

const halfToFloat = (h) => {
  const s = (h & 0x8000) ? -1 : 1;
  const e = (h >> 10) & 0x1f;
  const m = h & 0x03ff;
  if (e === 0)    return s * Math.pow(2, -14) * (m / 1024);
  if (e === 0x1f) return m ? NaN : s * Infinity;
  return s * Math.pow(2, e - 15) * (1 + m / 1024);
};

const alphaLit = setLutBody.match(/rgba\[o \+ 3\]\s*=\s*(0x[0-9a-fA-F]+|[\d.]+)/)?.[1];
check('alpha constant found in setLUT', !!alphaLit, `got: ${alphaLit}`);
check(
  `alpha constant ${alphaLit} decodes to exactly 1.0 as a half-float`,
  alphaLit !== undefined && halfToFloat(Number(alphaLit)) === 1.0,
  `decodes to ${alphaLit !== undefined ? halfToFloat(Number(alphaLit)) : '?'} — ` +
  'writing the literal 1.0 here produces a denormal ~6e-8, not opaque alpha.'
);

// ── 4. The LUT3D shader's blue axis ─────────────────────────────────────────
// Shipped alongside the upload bug and equally silent: the slice index was
// derived from the CENTRE-MAPPED blue rather than the raw one, compressing the
// blue axis by (N-1)/N. Pure blue graded to 247 where it should have hit 255 —
// a mild cast, not an obvious break, which is why it survived.
console.log('\nLUT3D shader — blue axis:');

const shaderSrc = readFileSync(join(root, 'src/shaders/index.js'), 'utf8');
const lut3d = shaderSrc.slice(
  shaderSrc.indexOf('export const LUT3D'),
  shaderSrc.indexOf('export const LEVELS')
);
check('LUT3D shader located', lut3d.includes('sampleLUT'));

const bSliceLine = lut3d.match(/float\s+bSlice\s*=\s*([^;]+);/)?.[1]?.trim();
check(
  'blue slice index comes from RAW col.b',
  bSliceLine === 'col.b * (N - 1.0)',
  `got: bSlice = ${bSliceLine}\n       FIX: must be col.b * (N - 1.0). Feeding the ` +
  'scaled+offset blue in here\n       compresses the blue axis by (N-1)/N so pure ' +
  'blue never reaches the last slice.'
);
check(
  'red/green ARE centre-mapped (texel centres, unlike the slice index)',
  /float\s+r\s*=\s*col\.r \* scale \+ offset;/.test(lut3d) &&
  /float\s+g\s*=\s*col\.g \* scale \+ offset;/.test(lut3d),
  'r and g index within a slice and must sit at texel centres; only the slice ' +
  'index itself uses raw col.b.'
);
check(
  'upper slice is clamped to the last slice',
  /min\(\s*bFloor \+ 1\.0,\s*N - 1\.0\s*\)/.test(lut3d),
  'without the clamp the top slice samples one slice past the strip.'
);

// ── 5. The blue-axis claim itself, numerically ──────────────────────────────
// So this audit still means something if the shader is rewritten: show that the
// old expression really does fail to reach the last slice, and the new one does.
console.log('\nBlue axis, simulated:');

const N = 17, scale = (N - 1) / N, offset = 0.5 / N;
const oldTop = (1.0 * scale + offset) * (N - 1);
const newTop = 1.0 * (N - 1);
check(
  `raw col.b reaches the last slice (${newTop} of ${N - 1})`,
  Math.abs(newTop - (N - 1)) < 1e-9
);
check(
  `centre-mapped blue falls short (${oldTop.toFixed(3)} of ${N - 1}) — margin is real`,
  (N - 1) - oldTop > 0.4,
  `shortfall ${( (N - 1) - oldTop ).toFixed(3)} slices; a fix that left this ` +
  'under ~0.4 would not be distinguishable from rounding.'
);

console.log(
  failures
    ? `\n${failures} FAILURE(S)\n`
    : '\nAll texture upload format checks passed.\n'
);
process.exit(failures ? 1 : 0);
