/**
 * Cue banks — the eight-slot store/recall shared by the movie decks and the
 * Playback Zone.
 *
 * Why this exists: the mechanism was extracted out of MovieCues into
 * `core/CueBank.js` so the Playback Zone could have the same eight slots
 * instead of a second copy. That extraction is a rewrite of code that already
 * worked and was verified only by hand, in a browser, with video loaded. Every
 * invariant below was true before the extraction and has to stay true after
 * it — and three of them are silent when broken.
 *
 * The sharpest is RECALL ORDER. Both banks capture params where one value is a
 * fraction of another: MoviePos is a fraction of the start→end window, and a
 * zone's Start/Length are fractions of its Partition. Recall in the wrong order
 * and every value written is individually correct while the result points
 * somewhere the cue never described. Nothing throws, nothing logs, and the
 * symptom is "cues are a bit off sometimes".
 *
 * Run:  node tests/audit-cue-banks.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { stripComments } from './lib/source.mjs';
import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';
import { CueBank, CUE_SLOTS } from '../src/core/CueBank.js';
import { MovieCues, CUE_DECKS } from '../src/inputs/MovieCues.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const makePs = () => {
  const ps = new ParameterSystem();
  registerCoreParameters(ps);
  return ps;
};

/** Record the ORDER of ps.set calls for the given prefix. */
const spySets = (ps, prefix) => {
  const seen = [];
  const orig = ps.set.bind(ps);
  ps.set = (id, v) => { if (id.startsWith(`${prefix}.`)) seen.push(id.slice(prefix.length + 1)); return orig(id, v); };
  return seen;
};

console.log('\nshape');
{
  check('eight slots', CUE_SLOTS === 8, String(CUE_SLOTS));
  check('the movie decks are the two that existed', CUE_DECKS.join() === 'movie,movieB',
    CUE_DECKS.join());
}

console.log('\nthe movie deck bank still behaves as it did');
{
  const ps = makePs();
  let seeks = 0;
  const cues = new MovieCues(ps, { movie: { forcePosSeek: () => seeks++ } });

  ps.set('movie.start', 10); ps.set('movie.end', 60); ps.set('movie.pos', 25);
  check('store captures a filled slot', cues.store('movie', 2) && cues.has('movie', 2));
  const cue = cues.get('movie', 2);
  check('a cue is exactly start/end/pos', Object.keys(cue).sort().join() === 'end,pos,start',
    Object.keys(cue).join());

  ps.set('movie.start', 0); ps.set('movie.end', 100); ps.set('movie.pos', 0);
  const order = spySets(ps, 'movie');
  cues.recall('movie', 2);
  check('recall restores the values',
    ps.get('movie.start').value === 10 && ps.get('movie.end').value === 60
      && ps.get('movie.pos').value === 25,
    `${ps.get('movie.start').value}/${ps.get('movie.end').value}/${ps.get('movie.pos').value}`);
  // The order bug: pos before the range resolves against the OLD window.
  // Asserted as the EXACT sequence rather than with indexOf comparisons —
  // audit-audit-hygiene rejects those, and it is right to: `indexOf(x) >
  // indexOf(y)` is true when y is absent (-1), so a recall that stopped
  // writing `start` at all would have passed the ordering check.
  check('recall writes exactly start, end, pos in that order',
    order.join() === 'start,end,pos', order.join(' → ') || '(nothing written)');
  // A cue stored with Pos at its default writes a value the deck already holds,
  // so nothing fires and the head never moves. The forced seek is the fix.
  check('recall forces the deck seek', seeks === 1, `${seeks} seeks`);

  check('clear empties the slot', cues.clear('movie', 2) && !cues.has('movie', 2));
  check('clearing an empty slot is a no-op, not a throw', cues.clear('movie', 2) === false);
  check('recalling an empty slot returns false', cues.recall('movie', 2) === false);
  check('a deck with no seek hook still recalls', (() => {
    const p2 = makePs();
    const c2 = new MovieCues(p2, {});              // movieB has no entry at all
    p2.set('movieB.start', 5);
    c2.store('movieB', 0);
    return c2.recall('movieB', 0) === true;
  })());
}

console.log('\nthe Playback Zone bank');
{
  const ps = makePs();
  const cues = new CueBank(ps, { banks: ['aplay'], keys: ['part', 'start', 'len'] });

  ps.set('aplay.part', 2); ps.set('aplay.start', 0.25); ps.set('aplay.len', 0.5);
  ps.set('aplay.rate', 2); ps.set('aplay.on', 1);
  check('store captures a slot', cues.store('aplay', 0) && cues.has('aplay', 0));

  const cue = cues.get('aplay', 0);
  check('a cue is exactly part/start/len', Object.keys(cue).sort().join() === 'len,part,start',
    Object.keys(cue).join());
  // The whole point of the "region only" decision: recall must not touch how
  // the zone sounds or whether it is running.
  check('rate, level, unsafe and on are NOT captured',
    !('rate' in cue) && !('level' in cue) && !('unsafe' in cue) && !('on' in cue),
    Object.keys(cue).join());

  ps.set('aplay.part', 0); ps.set('aplay.start', 0); ps.set('aplay.len', 1);
  ps.set('aplay.rate', -1); ps.set('aplay.on', 0);
  const order = spySets(ps, 'aplay');
  cues.recall('aplay', 0);
  check('recall restores the region',
    ps.get('aplay.part').value === 2 && ps.get('aplay.start').value === 0.25
      && ps.get('aplay.len').value === 0.5,
    `P${ps.get('aplay.part').value} ${ps.get('aplay.start').value}/${ps.get('aplay.len').value}`);
  // Start and Length are fractions OF the partition, so writing them first
  // resolves them against the partition being left.
  check('recall writes exactly part, start, len in that order',
    order.join() === 'part,start,len', order.join(' → ') || '(nothing written)');
  check('recall leaves Rate and Run alone',
    ps.get('aplay.rate').value === -1 && ps.get('aplay.on').value === 0,
    `rate ${ps.get('aplay.rate').value}, on ${ps.get('aplay.on').value}`);
}

console.log('\nDisplay States must not capture a slot index');
{
  const ps = makePs();
  // Two writers for one set of values, and which wins depends on restore order.
  for (const prefix of [...CUE_DECKS, 'aplay']) {
    for (const key of ['cueSlot', 'cueStore']) {
      const p = ps.get(`${prefix}.${key}`);
      check(`${prefix}.${key} is group 'global'`, p && p.group === 'global',
        p ? p.group : 'MISSING');
    }
  }
  const state = ps.captureState();
  check('no cue param reaches a captured state',
    !Object.keys(state).some(id => /\.cue(Slot|Store)$/.test(id)),
    Object.keys(state).filter(id => /\.cue/.test(id)).join());
}

console.log('\nthe SHIPPED construction, not a hand-built one');
{
  // Everything above builds its own CueBank with the right keys, which means
  // none of it can see main.js getting the key ORDER wrong at the real call
  // site. Calibration proved exactly that: reversing the keys in main.js left
  // the whole suite green. A check that cannot fail for the shipped code is
  // decoration, so this reads the source.
  const main = stripComments(readFileSync(resolve(root, 'src/main.js'), 'utf8'));
  const m = main.match(/new CueBank\(\s*ps\s*,\s*\{([^}]*)\}\s*\)/);
  check('main.js constructs the Playback Zone bank', !!m);
  if (m) {
    const keys = (m[1].match(/keys\s*:\s*\[([^\]]*)\]/) || [, ''])[1]
      .split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean);
    check('the shipped key order is part, start, len',
      keys.join() === 'part,start,len', keys.join() || '(no keys found)');
    check('the shipped bank is aplay',
      /banks\s*:\s*\[\s*['"]aplay['"]\s*\]/.test(m[1]), m[1].trim());
  }
  // The zone params take effect on write, so an afterRecall hook here would be
  // a second writer nobody asked for.
  check('the zone bank declares no afterRecall hook',
    m ? !/afterRecall/.test(m[1]) : false);
}

console.log('\nproject-file round trip');
{
  const ps = makePs();
  const cues = new CueBank(ps, { banks: ['aplay'], keys: ['part', 'start', 'len'] });
  ps.set('aplay.part', 1); ps.set('aplay.start', 0.1); ps.set('aplay.len', 0.2);
  cues.store('aplay', 3);
  const json = JSON.parse(JSON.stringify(cues.serialize()));

  const fresh = new CueBank(makePs(), { banks: ['aplay'], keys: ['part', 'start', 'len'] });
  fresh.restore(json);
  check('a stored cue survives serialize → restore',
    JSON.stringify(fresh.get('aplay', 3)) === JSON.stringify(cues.get('aplay', 3)),
    JSON.stringify(fresh.get('aplay', 3)));
  check('empty slots stay empty', fresh.get('aplay', 0) === null);
  check('the bank is still eight long', fresh.slots.aplay.length === CUE_SLOTS);

  // Every file written before this feature has no playCues key at all.
  const legacy = new CueBank(makePs(), { banks: ['aplay'], keys: ['part', 'start', 'len'] });
  legacy.restore(undefined);
  check('restore(undefined) is survivable', legacy.slots.aplay.length === CUE_SLOTS
    && legacy.slots.aplay.every(c => c === null));
  legacy.restore({ aplay: [{ part: 1, start: 0.5 }] });     // len missing
  check('a cue missing a key is dropped, not half-restored',
    legacy.get('aplay', 0) === null, JSON.stringify(legacy.get('aplay', 0)));
  legacy.restore({ aplay: [{ part: 1, start: 0.5, len: 'x' }] });
  check('a non-numeric value is dropped', legacy.get('aplay', 0) === null);
  legacy.restore({ somethingElse: [] });
  check('an unknown bank is ignored', legacy.slots.aplay.length === CUE_SLOTS);
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll cue-bank checks passed.\n');
process.exit(failures ? 1 : 0);
