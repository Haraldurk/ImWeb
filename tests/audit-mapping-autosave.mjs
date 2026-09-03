/**
 * Mapping autosave — learned controllers survive a reload, values do not.
 *
 * The whole module exists because of one property of the data: `serialize()`
 * carries `value`, and `deserialize()` applies it. So the obvious two-line
 * version — persist `serializeControllers()`, restore it at boot — silently
 * persists the CURRENT VALUE of every mapped parameter, and the instrument
 * comes back in a partial version of however you left it. Run Rec still on. A
 * swept Level still at 0.2. Nothing errors; it just boots wrong, and only for
 * the parameters you happen to have mapped, which makes it look like a
 * different bug every time.
 *
 * These checks are therefore mostly about what the autosave does NOT carry.
 *
 * Run:  node tests/audit-mapping-autosave.mjs
 */

import { ParameterSystem, PARAM_TYPE } from '../src/controls/ParameterSystem.js';

// A localStorage that behaves, one that throws, and one that is full.
function fakeStore({ mode = 'ok' } = {}) {
  const map = new Map();
  return {
    getItem: (k) => { if (mode === 'throw') throw new Error('blocked'); return map.has(k) ? map.get(k) : null; },
    setItem: (k, v) => { if (mode === 'throw' || mode === 'full') throw new Error('quota'); map.set(k, v); },
    removeItem: (k) => { if (mode === 'throw') throw new Error('blocked'); map.delete(k); },
    _map: map,
  };
}

globalThis.location ??= { origin: 'http://localhost:5173' };
globalThis.addEventListener ??= () => {};
globalThis.removeEventListener ??= () => {};

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const makePs = () => {
  const ps = new ParameterSystem();
  ps.register({ id: 't.cont', label: 'C', group: 'g', min: 0, max: 100, value: 0 });
  ps.register({ id: 't.tog',  label: 'T', group: 'g', type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 't.sel',  label: 'S', group: 'g', type: PARAM_TYPE.SELECT, value: 0,
    options: ['P0', 'P1', 'P2', 'P3'] });
  ps.register({ id: 't.plain', label: 'U', group: 'g', min: 0, max: 10, value: 3 });
  ps.register({ id: 't.setup', label: 'X', group: 'global', type: PARAM_TYPE.SELECT, value: 0,
    options: ['A', 'B'], setup: true });
  return ps;
};

const { MappingAutosave } = await import('../src/state/MappingAutosave.js');

const withStore = (store, fn) => {
  const prev = globalThis.localStorage;
  globalThis.localStorage = store;
  try { return fn(); } finally { globalThis.localStorage = prev; }
};

console.log('\nserializeMappings drops the value and keeps the mapping');
{
  const ps = makePs();
  const p = ps.get('t.cont');
  p.controller = { type: 'midi-cc', cc: 45, channel: 1 };
  p.value = 72;
  p.ctrlMin = 10; p.ctrlMax = 90; p.invert = true;

  const withValues = ps.serializeControllers();
  const mappings   = ps.serializeMappings();

  check('serializeControllers DOES carry the value (the hazard is real)',
    withValues['t.cont'].value === 72, String(withValues['t.cont'].value));
  check('serializeMappings does NOT', !('value' in mappings['t.cont']),
    JSON.stringify(mappings['t.cont']));
  check('but keeps the controller', mappings['t.cont'].controller?.cc === 45,
    JSON.stringify(mappings['t.cont'].controller));
  check('and the recall range', mappings['t.cont'].ctrlMin === 10 && mappings['t.cont'].ctrlMax === 90);
  check('and invert', mappings['t.cont'].invert === true);
  check('an unmapped param is not stored at all', !('t.plain' in mappings),
    Object.keys(mappings).join());
}

console.log('\na restore moves mappings and leaves values where they are');
{
  const store = fakeStore();
  withStore(store, () => {
    const a = makePs();
    a.get('t.cont').controller = { type: 'midi-cc', cc: 45, channel: 1 };
    a.get('t.cont').value = 72;
    a.get('t.sel').controller = { type: 'midi-cc-map', ccs: [32, null, 34, 35], channel: 1 };
    a.get('t.sel').value = 2;
    const saveA = new MappingAutosave(a);
    check('flush writes when something changed', saveA.flush() === true);
    check('flush is a no-op when nothing changed', saveA.flush() === false);

    // A fresh session: different values, no mappings.
    const b = makePs();
    b.get('t.cont').value = 5;
    b.get('t.sel').value = 0;
    const saveB = new MappingAutosave(b);
    const n = saveB.restore();

    check('both mapped params were restored', n === 2, `${n}`);
    check('the CC came back', b.get('t.cont').controller?.cc === 45,
      JSON.stringify(b.get('t.cont').controller));
    check('the per-option map came back',
      JSON.stringify(b.get('t.sel').controller?.ccs) === JSON.stringify([32, null, 34, 35]),
      JSON.stringify(b.get('t.sel').controller?.ccs));
    // The point of the whole module.
    check('the VALUE did not come back with it', b.get('t.cont').value === 5,
      `${b.get('t.cont').value} — the autosave restored a performance value`);
    check('nor for the select', b.get('t.sel').value === 0, `P${b.get('t.sel').value}`);
    check('an unmapped param is untouched', b.get('t.plain').value === 3);
  });
}

console.log('\na hand-edited or older blob carrying a value is still refused');
{
  const store = fakeStore();
  // Exactly what the naive implementation would have written.
  store._map.set('imweb.mappings', JSON.stringify({
    't.cont': { id: 't.cont', value: 99, controller: { type: 'midi-cc', cc: 7 } },
  }));
  withStore(store, () => {
    const ps = makePs();
    ps.get('t.cont').value = 5;
    new MappingAutosave(ps).restore();
    check('the mapping is taken', ps.get('t.cont').controller?.cc === 7,
      JSON.stringify(ps.get('t.cont').controller));
    check('the value in the blob is ignored', ps.get('t.cont').value === 5,
      `${ps.get('t.cont').value} — a stored value reached deserialize()`);
  });
}

console.log('\nsetup acts stay untouchable');
{
  const store = fakeStore();
  store._map.set('imweb.mappings', JSON.stringify({
    't.setup': { id: 't.setup', controller: { type: 'midi-cc', cc: 3 }, value: 1 },
  }));
  withStore(store, () => {
    const ps = makePs();
    new MappingAutosave(ps).restore();
    check('a persisted blob cannot map a setup act',
      ps.get('t.setup').controller === null || ps.get('t.setup').controller === undefined,
      JSON.stringify(ps.get('t.setup').controller));
    check('nor set its value', ps.get('t.setup').value === 0, String(ps.get('t.setup').value));
  });
}

console.log('\nnothing about this may break the instrument');
{
  withStore(fakeStore({ mode: 'throw' }), () => {
    const ps = makePs();
    const s = new MappingAutosave(ps);
    let threw = false;
    try { s.restore(); s.flush(); s.clear(); s.hasSaved; } catch { threw = true; }
    check('a blocked localStorage is survivable, not fatal', !threw);
  });
  withStore(fakeStore({ mode: 'full' }), () => {
    const ps = makePs();
    ps.get('t.cont').controller = { type: 'midi-cc', cc: 1 };
    const s = new MappingAutosave(ps);
    check('a full store reports failure rather than throwing', s.flush() === false);
  });
  withStore(fakeStore(), () => {
    const store = globalThis.localStorage;
    store._map.set('imweb.mappings', 'not json{');
    const ps = makePs();
    check('a corrupt blob restores nothing and does not throw',
      new MappingAutosave(ps).restore() === 0);
    store._map.set('imweb.mappings', JSON.stringify([1, 2, 3]));
    check('an array is refused too', new MappingAutosave(makePs()).restore() === 0);
    store._map.delete('imweb.mappings');
    check('an empty store restores nothing', new MappingAutosave(makePs()).restore() === 0);
  });
}

console.log('\nclear forgets the store without unmapping the rig');
{
  withStore(fakeStore(), () => {
    const ps = makePs();
    ps.get('t.cont').controller = { type: 'midi-cc', cc: 45 };
    const s = new MappingAutosave(ps);
    s.flush();
    check('something is stored', s.hasSaved === true);
    s.clear();
    check('and then it is not', s.hasSaved === false);
    check('the LIVE mapping is untouched by clear',
      ps.get('t.cont').controller?.cc === 45,
      JSON.stringify(ps.get('t.cont').controller));
  });
}

console.log('\nboot order: the autosave is applied AFTER the project restore');
{
  // The precedence rule, asserted against main.js rather than trusted to a
  // comment: both write p.controller, so whichever runs last wins, and the
  // intent is that the session's learned mappings beat a bank's saved ones.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const { stripComments } = await import('./lib/source.mjs');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const main = stripComments(readFileSync(resolve(root, 'src/main.js'), 'utf8'));

  const iLoad    = main.indexOf('_loadMasterProject()');
  const iRestore = main.indexOf('mappingAutosave.restore()');
  const iStart   = main.indexOf('mappingAutosave.start()');
  check('main.js still loads the boot project', iLoad !== -1);
  check('main.js restores mappings', iRestore !== -1);
  check('main.js starts the watcher', iStart !== -1);
  check('the mapping restore runs AFTER the boot project load',
    iLoad !== -1 && iRestore !== -1 && iRestore > iLoad,
    `load@${iLoad}, restore@${iRestore}`);
  check('and the watcher starts after the restore, not before',
    iRestore !== -1 && iStart !== -1 && iStart > iRestore,
    `restore@${iRestore}, start@${iStart}`);
  // stripComments first: the module's own doc block NAMES serializeControllers
  // to explain why it must not call it, and matching raw text failed on the
  // argument rather than the code — the exact trap tests/lib/source.mjs exists
  // for, caught here by its own rule.
  const autosave = stripComments(
    readFileSync(resolve(root, 'src/state/MappingAutosave.js'), 'utf8'));
  check('the autosave CALLS serializeMappings', /serializeMappings\(\)/.test(autosave));
  // `\\(\\)` asserted a SPELLING — `serializeControllers(ps)` is the ordinary way
  // this call would evolve and it walked straight past (LEARNED 2026-08-15).
  // The `\\b` is load-bearing: without it this matches the TAIL of the
  // legitimate `deserializeControllers(` on line 103 and fails correct code.
  check('and never calls serializeControllers', !/\bserializeControllers\s*\(/.test(autosave));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll mapping-autosave checks passed.\n');
process.exit(failures ? 1 : 0);
