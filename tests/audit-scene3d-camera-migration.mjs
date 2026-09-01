/**
 * scene3d camera: Cartesian eye → orbit/elevation/distance.
 *
 * The property that matters is NOT "did the keys change" but "does the camera
 * still land on the same point" — so every check asserts the round trip against
 * the CONSUMER'S OWN placement formula (SceneManager.applyParams), not against
 * a restatement of the migration. A migration verified against itself proves
 * only that it is self-consistent.
 *
 * Runs over the real saved files in public/Projects as well as fixtures: a
 * migration that passes on invented data and corrupts the owner's project is
 * the failure this exists to prevent.
 */
import { readFileSync, existsSync } from 'node:fs';
import {
  scene3dCartesianToOrbit,
  migrateScene3dCamera,
  migrateScene3dCameraRecords,
  migrateScene3dParams,
} from '../src/controls/ParameterSystem.js';

let fail = 0, checks = 0;
const ok = (cond, msg) => {
  checks++;
  if (cond) { console.log(`  ok   ${msg}`); }
  else { console.error(`  FAIL ${msg}`); fail++; }
};

/** SceneManager's own placement, copied from the line that runs. */
function place({ orbit, elev, dist }) {
  const az = (orbit * Math.PI) / 180, el = (elev * Math.PI) / 180;
  const ch = Math.cos(el);
  return { x: dist * ch * Math.sin(az), y: dist * Math.sin(el), z: dist * ch * Math.cos(az) };
}

console.log('\nRound trip — eye → orbit → eye, against the consumer formula');

// Spread over the whole legacy range, including the axis-aligned and negative
// cases that atan2/asin treat specially.
const eyes = [];
for (const x of [-20, -7, -1, 0, 1, 7, 20])
  for (const y of [-20, -3, 0, 3, 20])
    for (const z of [-30, -5, -0.1, 0.1, 5, 30]) eyes.push({ x, y, z });
eyes.push({ x: 0, y: 0, z: 5 });          // the default
eyes.push({ x: 0, y: 0, z: 0.1 });        // near clip

let worst = 0, worstEye = null;
for (const e of eyes) {
  const back = place(scene3dCartesianToOrbit(e.x, e.y, e.z));
  const d = Math.max(Math.abs(back.x - e.x), Math.abs(back.y - e.y), Math.abs(back.z - e.z));
  if (d > worst) { worst = d; worstEye = e; }
}
ok(worst < 1e-9,
   `${eyes.length} eyes land on the same point (worst error ${worst.toExponential(2)}` +
   `${worstEye ? ` at ${JSON.stringify(worstEye)}` : ''})`);

// The default must be exactly the documented new default, or a fresh project
// and a migrated one disagree.
const dflt = scene3dCartesianToOrbit(0, 0, 5);
ok(dflt.orbit === 0 && dflt.elev === 0 && dflt.dist === 5,
   `the (0,0,5) default maps to orbit 0 / elev 0 / dist 5 — got ${JSON.stringify(dflt)}`);

// Degenerate eye: at the origin there is no direction, and the old renderer
// showed nothing there anyway. Must not produce NaN.
const deg = scene3dCartesianToOrbit(0, 0, 0);
ok(Number.isFinite(deg.orbit) && Number.isFinite(deg.elev) && Number.isFinite(deg.dist),
   'an eye at the origin yields finite values rather than NaN');

console.log('\nElevation stays off the pole');

// At exactly ±90 the eye sits on the Y axis, parallel to three.js's up vector,
// and lookAt() has no basis to build. Past it the eye crosses to the far side
// and z flips sign, so a sweep through the pole jumps. The registered range
// must therefore stop short of 90 — and the migration must be incapable of
// producing anything outside it, or a loaded project lands somewhere the
// slider cannot represent.
{
  let worstEl = 0;
  for (const e of eyes) {
    const { elev } = scene3dCartesianToOrbit(e.x, e.y, e.z);
    worstEl = Math.max(worstEl, Math.abs(elev));
  }
  ok(worstEl <= 90,
     `asin bounds migrated elevation to ±90 (worst |elev| ${worstEl.toFixed(3)}°)`);
  // Straight up must not be produced as a usable camera by any real file.
  const poleZ = place({ orbit: 0, elev: 90, dist: 5 }).z;
  const pastZ = place({ orbit: 0, elev: 100, dist: 5 }).z;
  ok(Math.abs(poleZ) < 1e-9 && pastZ < 0,
     `the pole is degenerate and past it z flips sign (z@90 ${poleZ.toExponential(1)}, z@100 ${pastZ.toFixed(3)}) — which is why the range stops at 89`);
}

console.log('\nKey rewriting');

{
  const v = { 'scene3d.cam.x': 3, 'scene3d.cam.y': 4, 'scene3d.cam.z': 0 };
  migrateScene3dCamera(v);
  ok(!('scene3d.cam.x' in v) && !('scene3d.cam.y' in v) && !('scene3d.cam.z' in v),
     'the legacy keys are deleted');
  ok('scene3d.cam.orbit' in v && 'scene3d.cam.elev' in v && 'scene3d.cam.dist' in v,
     'the new keys are written');
  ok(Math.abs(v['scene3d.cam.dist'] - 5) < 1e-9,
     `(3,4,0) is 5 from the origin — got ${v['scene3d.cam.dist']}`);
}

{
  // Idempotency is load-bearing: with no stamp, the data must answer
  // "has this run?" itself, and a second pass must change nothing.
  const v = { 'scene3d.cam.x': 1, 'scene3d.cam.y': 2, 'scene3d.cam.z': 3 };
  migrateScene3dParams(v, null);
  const once = JSON.stringify(v);
  migrateScene3dParams(v, null);
  ok(JSON.stringify(v) === once, 'running the migration twice changes nothing');
}

{
  // A file already in the new form must not be clobbered by legacy defaults.
  const v = { 'scene3d.cam.orbit': 123, 'scene3d.cam.elev': 45, 'scene3d.cam.dist': 9,
              'scene3d.cam.x': 0 };
  migrateScene3dParams(v, null);
  ok(v['scene3d.cam.orbit'] === 123 && v['scene3d.cam.elev'] === 45 && v['scene3d.cam.dist'] === 9,
     'an existing new-form value is never overwritten');
}

console.log('\nController records');

{
  const recs = {
    'scene3d.cam.x': { id: 'scene3d.cam.x', value: 0, ctrlMin: -1.4, ctrlMax: 1.4,
                       type: 'lfo', hz: 0.2, tableId: 'sCurve' },
  };
  migrateScene3dCameraRecords(recs, { 'scene3d.cam.x': 0, 'scene3d.cam.y': 0, 'scene3d.cam.z': 5 });
  const r = recs['scene3d.cam.orbit'];
  ok(!!r, 'a controller on Cam X moves to Orbit');
  ok(r && r.type === 'lfo' && r.hz === 0.2 && r.tableId === 'sCurve',
     'the controller, rate and table are carried');
  ok(r && r.ctrlMin === 0 && r.ctrlMax === 360,
     `recall bounds are RESET to the new axis, not carried — got ${r?.ctrlMin}..${r?.ctrlMax}`);
  ok(!('scene3d.cam.x' in recs), 'the legacy record is removed');
}

console.log('\nReal saved files (not fixtures)');

for (const file of ['public/Projects/MasterProject.imweb', 'public/Projects/FactoryBank.imbank']) {
  if (!existsSync(file)) { console.log(`  --   ${file} absent, skipped`); continue; }
  let data;
  try { data = JSON.parse(readFileSync(file, 'utf8')); }
  catch { ok(false, `${file} parses`); continue; }

  // Collect every values-bag this file carries, wherever it nests them.
  const bags = [];
  const walk = (n, depth = 0) => {
    if (!n || typeof n !== 'object' || depth > 6) return;
    if (n.values && typeof n.values === 'object') bags.push(n.values);
    if (n.params && typeof n.params === 'object') bags.push(n.params);
    for (const v of Object.values(n)) {
      if (Array.isArray(v)) v.forEach(e => walk(e, depth + 1));
      else if (v && typeof v === 'object') walk(v, depth + 1);
    }
  };
  walk(data);

  let migrated = 0, maxErr = 0;
  for (const bag of bags) {
    const had = ['scene3d.cam.x', 'scene3d.cam.y', 'scene3d.cam.z'].some(k => k in bag);
    if (!had) continue;
    const eye = {
      x: +bag['scene3d.cam.x'] || 0,
      y: +bag['scene3d.cam.y'] || 0,
      z: 'scene3d.cam.z' in bag ? +bag['scene3d.cam.z'] || 0 : 5,
    };
    migrateScene3dCamera(bag);
    const back = place({ orbit: bag['scene3d.cam.orbit'], elev: bag['scene3d.cam.elev'],
                         dist: bag['scene3d.cam.dist'] });
    // Only meaningful away from the clamped near-clip case.
    if (Math.hypot(eye.x, eye.y, eye.z) >= 0.1) {
      maxErr = Math.max(maxErr,
        Math.abs(back.x - eye.x), Math.abs(back.y - eye.y), Math.abs(back.z - eye.z));
    }
    migrated++;
  }
  // Report the count as well as the property: an assertion over an empty
  // collection passes vacuously, and "0 cameras, all correct" is not a pass.
  console.log(`  ..   ${file}: ${bags.length} value bags, ${migrated} carried a camera`);
  if (migrated > 0) {
    ok(maxErr < 1e-9,
       `${file}: all ${migrated} cameras land on the same point (worst ${maxErr.toExponential(2)})`);
  }
}

console.log('\nRegistered ranges, and the exp taper');

{
  // The migration resets recall bounds to these; a stale copy would hand a
  // controller a sweep the parameter cannot express, silently.
  const psSrc = readFileSync(new URL('../src/controls/ParameterSystem.js', import.meta.url), 'utf8');
  const declared = (id) => {
    const i = psSrc.indexOf(`id: "${id}"`);
    if (i === -1) return null;
    const body = psSrc.slice(i, i + 400);
    const num = (k) => {
      const m = new RegExp(`${k}:\\s*(-?[0-9.]+)`).exec(body);
      return m ? parseFloat(m[1]) : undefined;
    };
    return { min: num('min'), max: num('max'), curve: /curve:\s*"exp"/.test(body) };
  };
  const elev = declared('scene3d.cam.elev');
  const dist = declared('scene3d.cam.dist');
  ok(!!elev && elev.min > -90 && elev.max < 90,
     `Elevation stops short of the pole — declared ${elev?.min}..${elev?.max}`);
  ok(!!dist && dist.min > 0 && dist.curve,
     `Distance is exp-tapered with a positive floor — declared ${dist?.min}..${dist?.max}, curve ${dist?.curve}`);

  // An exp taper is only usable if its two directions are exact inverses: the
  // slider reads one and writes the other, so a mismatch drifts the thumb.
  const lo = dist.min, hi = dist.max;
  const toNorm = (v) => Math.log(Math.max(lo, v) / lo) / Math.log(hi / lo);
  const fromNorm = (n) => lo * Math.pow(hi / lo, n);
  let worstRT = 0;
  for (let i = 0; i <= 1000; i++) {
    const n = i / 1000;
    worstRT = Math.max(worstRT, Math.abs(toNorm(fromNorm(n)) - n));
  }
  ok(worstRT < 1e-12, `taper round trips over 1001 positions (worst ${worstRT.toExponential(2)})`);
  // The point of the taper: the low decade must get real travel.
  const halfway = fromNorm(0.5);
  ok(halfway > 2 && halfway < 4.5,
     `half travel lands near the geometric mean, not 50 — got ${halfway.toFixed(3)}`);
  const linearAtTenth = lo + 0.1 * (hi - lo);
  ok(fromNorm(0.1) < linearAtTenth / 5,
     `a tenth of the throw reaches ${fromNorm(0.1).toFixed(3)}, far below the linear ${linearAtTenth.toFixed(2)} — close framing is reachable`);
}

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${checks - fail}/${checks} checks\n`);
process.exit(fail === 0 ? 0 : 1);
