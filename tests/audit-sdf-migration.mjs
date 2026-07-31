/**
 * SDF v2 migration audit.
 *
 * Why this exists. Two sdf.* controls changed meaning, not just name:
 *
 *   sdf.camX/camY/camZ  (Cartesian eye)   → sdf.orbitX/orbitY/camDist (spherical)
 *   sdf.repeat          (spacing AND on/off) → sdf.tile + sdf.repeat (spacing only)
 *
 * A rename that also converts units has a failure mode a rename does not: the
 * file still loads, every key resolves, nothing throws — the camera has simply
 * moved. So the property that actually matters is not "did the keys change"
 * but "is the eye on the same point afterwards", and that is what is asserted
 * here, against the exact placement the shader performs.
 *
 * The migration carries no version stamp on purpose (it deletes the keys it
 * reads, so the data answers "has this run?" by itself). That makes
 * idempotency load-bearing rather than incidental, so it is checked too.
 *
 * Run:  node tests/audit-sdf-migration.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ParameterSystem,
  registerCoreParameters,
  sdfCartesianToOrbit,
  migrateSdfParams,
  migrateStatesSdfParams,
} from '../src/controls/ParameterSystem.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const DEG = Math.PI / 180;

/**
 * The shader's placement, in JS. Kept literally in step with SDFGenerator's
 * `cam = rotY(uOrbitX) * rotX(uOrbitY); ro = cam * vec3(0, 0, uCamDist)` —
 * if that line changes and this one does not, these tests should go red.
 */
const eyeFromOrbit = ({ orbitX, orbitY, camDist }) => {
  const az = orbitX * DEG, el = orbitY * DEG;
  return [camDist * Math.cos(el) * Math.sin(az),
          camDist * Math.sin(el),
          camDist * Math.cos(el) * Math.cos(az)];
};

const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

// ── 1. The conversion puts the eye back on the same point ────────────────────
console.log('sdfCartesianToOrbit round-trips the eye position');
const eyes = [
  [0, 0, 5],           // the old default
  [0, 1.85, 2],        // MasterProject's live value
  [0.1, 1.65, 2],      // MasterProject state 2
  [3, -4, 12],
  [-2, 0, -2],         // behind the origin — azimuth must come out 180-ish
  [0, 0, -7],          // straight behind
  [0, 6, 0],           // the pole that made lookAt() return NaN
  [0, -6, 0],          // the other pole
];
for (const [x, y, z] of eyes) {
  const o = sdfCartesianToOrbit(x, y, z);
  const [rx, ry, rz] = eyeFromOrbit(o);
  check(`(${x}, ${y}, ${z}) → az ${o.orbitX.toFixed(2)}° el ${o.orbitY.toFixed(2)}° d ${o.camDist.toFixed(4)}`,
    near(rx, x, 1e-9) && near(ry, y, 1e-9) && near(rz, z, 1e-9),
    `reconstructed (${rx}, ${ry}, ${rz})`);
}
check('azimuth is always within the sdf.orbitX range 0..360',
  eyes.every(e => { const a = sdfCartesianToOrbit(...e).orbitX; return a >= 0 && a <= 360; }));
check('elevation is always within the sdf.orbitY range -180..180',
  eyes.every(e => { const l = sdfCartesianToOrbit(...e).orbitY; return l >= -180 && l <= 180; }));

// The one documented lossy case: an eye closer than the new minimum distance.
const inside = sdfCartesianToOrbit(0, 0, 0.2);
check('an eye inside the near limit clamps to camDist 0.5 (documented, lossy)',
  inside.camDist === 0.5);

// ── 2. Values maps ───────────────────────────────────────────────────────────
console.log('\nvalues maps');
{
  const v = { 'sdf.camX': 0, 'sdf.camY': 1.85, 'sdf.camZ': 2, 'sdf.glow': 0 };
  migrateSdfParams(v);
  const [rx, ry, rz] = eyeFromOrbit({
    orbitX: v['sdf.orbitX'], orbitY: v['sdf.orbitY'], camDist: v['sdf.camDist'] });
  check('MasterProject camera converts to the identical eye',
    near(rx, 0) && near(ry, 1.85) && near(rz, 2), `got (${rx}, ${ry}, ${rz})`);
  check('the legacy keys are gone',
    !('sdf.camX' in v) && !('sdf.camY' in v) && !('sdf.camZ' in v));
  check('unrelated params are untouched', v['sdf.glow'] === 0);
}
{
  // A file that predates one of the axes still lands on the old default.
  const v = { 'sdf.camY': 0 };
  migrateSdfParams(v);
  check('a partial camera falls back to the legacy defaults (0, 0, 5)',
    near(v['sdf.orbitX'], 0) && near(v['sdf.orbitY'], 0) && near(v['sdf.camDist'], 5));
}
{
  const v = { 'layer.fg': 3, 'rutt.angle': 40 };
  const before = JSON.stringify(v);
  migrateSdfParams(v);
  check('a map with no sdf camera keys is left exactly as it was',
    JSON.stringify(v) === before);
}

// ── 3. Idempotency — the property that replaces a version stamp ──────────────
console.log('\nidempotency (there is no version stamp; the data answers instead)');
{
  const v = { 'sdf.camX': 3, 'sdf.camY': -4, 'sdf.camZ': 12, 'sdf.repeat': 2.5 };
  migrateSdfParams(v);
  const once = JSON.stringify(v);
  migrateSdfParams(v);
  migrateSdfParams(v);
  check('running it three times equals running it once', JSON.stringify(v) === once);
}
{
  // Already-new data that somehow still carries a stale legacy key must not be
  // overwritten by the conversion — the new value is the authoritative one.
  const v = { 'sdf.orbitX': 90, 'sdf.orbitY': 10, 'sdf.camDist': 8, 'sdf.camX': 999 };
  migrateSdfParams(v);
  check('an existing orbit value wins over a stale legacy key',
    v['sdf.orbitX'] === 90 && v['sdf.camDist'] === 8 && !('sdf.camX' in v));
}

// ── 4. Repeat → Tile + Tile Size ─────────────────────────────────────────────
console.log('\nrepeat → tile');
{
  const off = { 'sdf.repeat': 0 };
  migrateSdfParams(off);
  check('repeat 0 becomes Tile off with a usable spacing waiting',
    off['sdf.tile'] === 0 && off['sdf.repeat'] === 3.0);

  const on = { 'sdf.repeat': 2.5 };
  migrateSdfParams(on);
  check('repeat 2.5 becomes Tile on, spacing preserved',
    on['sdf.tile'] === 1 && on['sdf.repeat'] === 2.5);

  // The old shader's own threshold was `> 0.1`, so this WAS on — but at a
  // spacing narrower than a shape, which rendered as a solid block.
  const mush = { 'sdf.repeat': 0.5 };
  migrateSdfParams(mush);
  check('a spacing from the old mush zone is floored to the new minimum',
    mush['sdf.tile'] === 1 && mush['sdf.repeat'] === 1.2);

  const dead = { 'sdf.repeat': 0.05 };
  migrateSdfParams(dead);
  check('a spacing from the old dead zone reads as off, as the shader did',
    dead['sdf.tile'] === 0);

  const already = { 'sdf.tile': 1, 'sdf.repeat': 4 };
  migrateSdfParams(already);
  check('an already-migrated pair is left alone',
    already['sdf.tile'] === 1 && already['sdf.repeat'] === 4);
}

// ── 5. Controller records ────────────────────────────────────────────────────
console.log('\ncontroller records');
{
  const recs = {
    'sdf.camY': { id: 'sdf.camY', value: 1.85, controller: null, table: 'Smooooth',
                  ctrlMin: -1.397, ctrlMax: 1.636, invert: false, cycle: false,
                  slew: 0.4, feedbackVisible: true, feedbackPos: { x: 20, y: 60 } },
  };
  const values = { 'sdf.camX': 0, 'sdf.camY': 1.85, 'sdf.camZ': 2 };
  migrateSdfParams(values, recs);
  const r = recs['sdf.orbitY'];
  check('the record is renamed to the new axis', !!r && !('sdf.camY' in recs));
  check('settings that still mean the same thing are carried',
    r.table === 'Smooooth' && r.slew === 0.4 && r.feedbackVisible === true &&
    r.feedbackPos.x === 20);
  check('recall bounds are reset to the new range, not carried in world units',
    r.ctrlMin === -180 && r.ctrlMax === 180);
  check('the record value matches the converted elevation',
    near(r.value, values['sdf.orbitY']));
}
{
  // A bank's own controller bag arrives with no values map at all.
  const recs = {
    'sdf.camX': { id: 'sdf.camX', value: 0,    ctrlMin: -1.1, ctrlMax: 1.08 },
    'sdf.camY': { id: 'sdf.camY', value: 1.85, ctrlMin: -1.4, ctrlMax: 1.64 },
    'sdf.camZ': { id: 'sdf.camZ', value: 2,    ctrlMin: -20,  ctrlMax: 20 },
  };
  migrateSdfParams(null, recs);
  const [rx, ry, rz] = eyeFromOrbit({
    orbitX: recs['sdf.orbitX'].value, orbitY: recs['sdf.orbitY'].value,
    camDist: recs['sdf.camDist'].value });
  check('records alone (no values map) still reconstruct the same eye',
    near(rx, 0) && near(ry, 1.85) && near(rz, 2), `got (${rx}, ${ry}, ${rz})`);
}

// ── 6. Display State arrays ──────────────────────────────────────────────────
console.log('\ndisplay states');
{
  const states = [
    { values: { 'sdf.camX': 0, 'sdf.camY': 0, 'sdf.camZ': 5, 'sdf.repeat': 0 },
      controllers: { 'sdf.camZ': { id: 'sdf.camZ', value: 5, ctrlMin: -20, ctrlMax: 20 } } },
    null,
    { name: 'no values' },
  ];
  migrateStatesSdfParams(states);
  check('each state with values is migrated',
    near(states[0].values['sdf.camDist'], 5) && !('sdf.camZ' in states[0].values));
  check('its controller bag is migrated too',
    !!states[0].controllers['sdf.camDist'] && !('sdf.camZ' in states[0].controllers));
  check('null and value-less slots are tolerated', states[1] === null);
  check('a non-array is tolerated', migrateStatesSdfParams(undefined) === undefined);
}

// ── 7. Every retired id is really gone, and every new one is registered ──────
console.log('\nparameter registry');
{
  const ps = new ParameterSystem();
  registerCoreParameters(ps);
  const has = (id) => !!ps.get(id);
  check('the legacy cartesian params are unregistered',
    !has('sdf.camX') && !has('sdf.camY') && !has('sdf.camZ'));
  const added = ['sdf.orbitX', 'sdf.orbitY', 'sdf.camDist', 'sdf.moveX', 'sdf.moveY',
                 'sdf.moveZ', 'sdf.fov', 'sdf.size', 'sdf.tile', 'sdf.glowHue',
                 'sdf.lightAz', 'sdf.lightEl'];
  const missing = added.filter(id => !has(id));
  check(`all ${added.length} new params are registered`, !missing.length, missing.join(', '));
  check('sdf.repeat can no longer be set below the mush threshold',
    ps.get('sdf.repeat').min >= 1.2);
  check('the two "distance" controls do not share a label',
    ps.get('sdf.distance').label !== ps.get('sdf.camDist').label);
}

// ── 8. The migration is actually wired into every load path ──────────────────
console.log('\nreads on every load path');
const preset  = readFileSync(resolve(root, 'src/state/Preset.js'), 'utf8');
const project = readFileSync(resolve(root, 'src/io/ProjectFile.js'), 'utf8');
const shader  = readFileSync(resolve(root, 'src/inputs/SDFGenerator.js'), 'utf8');

check('Preset.deserialize migrates (covers IndexedDB + .imweb banks)',
  /static deserialize[\s\S]{0,320}migrateStatesSdfParams/.test(preset));
check('Preset.deserialize migrates the bank-level controller bag',
  /static deserialize[\s\S]{0,420}migrateSdfParams\(null,\s*p\.controllers\)/.test(preset));
check('Preset.importBank migrates (.imbank)',
  /static importBank[\s\S]{0,300}migrateStatesSdfParams/.test(preset));
check('PresetManager.importState migrates (.imstate)',
  /importState\(data[\s\S]{0,200}migrateSdfParams\(data\.values,\s*data\.controllers\)/.test(preset));
check('ProjectFile._apply migrates the live params overlay',
  /migrateSdfParams\(data\.params\)/.test(project));

// ── 9. The shader agrees with the conversion it is the inverse of ────────────
console.log('\nshader placement matches the conversion');
check('SDFGenerator builds the camera as rotY(orbitX) * rotX(orbitY)',
  /rotY\(uOrbitX\)\s*\*\s*rotX\(uOrbitY\)/.test(shader));
check('SDFGenerator backs the eye off along +Z by uCamDist',
  /vec3\(0\.0,\s*0\.0,\s*uCamDist\)/.test(shader));
check('lookAt() is gone — it was the pole singularity',
  !/mat3 lookAt/.test(shader));

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll SDF migration checks passed.\n');
process.exit(failures ? 1 : 0);
