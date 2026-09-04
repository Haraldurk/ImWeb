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
  const KEYS = ['start', 'len', 'rate', 'level'];
  const mk = () => new CueBank(makePs(), { banks: ['aplay'], keys: KEYS, allowPartial: true });
  const ps = makePs();
  const cues = new CueBank(ps, { banks: ['aplay'], keys: KEYS, allowPartial: true });

  ps.set('aplay.start', 0.25); ps.set('aplay.len', 0.5);
  ps.set('aplay.rate', 2); ps.set('aplay.level', 0.4);
  ps.set('aplay.part', 2); ps.set('aplay.on', 1); ps.set('aplay.pos', 0.6);
  check('store captures a slot', cues.store('aplay', 0) && cues.has('aplay', 0));

  const cue = cues.get('aplay', 0);
  check('a cue is exactly start/len/rate/level',
    Object.keys(cue).sort().join() === 'len,level,rate,start', Object.keys(cue).join());
  /**
   * PARTITION IS NOT CAPTURED — owner's call, 2026-08-27. It makes the cue
   * partition-RELATIVE: eight shapes applied to whichever partition is
   * selected, rather than eight fixed places on the tape. Asserted rather than
   * merely commented, because the previous decision was the opposite one and
   * "which is it this week" is exactly what an audit is for.
   */
  check('Partition is NOT captured — cues are partition-relative',
    !('part' in cue), Object.keys(cue).join());
  // Pos is a seek. A cue carrying it would restart the read on every recall.
  check('Pos is NOT captured', !('pos' in cue), Object.keys(cue).join());
  check('Run is NOT captured — a recall never starts or stops the zone',
    !('on' in cue), Object.keys(cue).join());

  ps.set('aplay.start', 0); ps.set('aplay.len', 1);
  ps.set('aplay.rate', -1); ps.set('aplay.level', 1);
  ps.set('aplay.part', 0); ps.set('aplay.on', 0);
  const order = spySets(ps, 'aplay');
  cues.recall('aplay', 0);
  check('recall restores start, len, rate and level',
    ps.get('aplay.start').value === 0.25 && ps.get('aplay.len').value === 0.5
      && ps.get('aplay.rate').value === 2 && ps.get('aplay.level').value === 0.4,
    `${ps.get('aplay.start').value}/${ps.get('aplay.len').value} rate ${ps.get('aplay.rate').value} lvl ${ps.get('aplay.level').value}`);
  check('recall writes exactly start, len, rate, level in that order',
    order.join() === 'start,len,rate,level', order.join(' → ') || '(nothing written)');
  check('recall leaves Partition and Run alone',
    ps.get('aplay.part').value === 0 && ps.get('aplay.on').value === 0,
    `P${ps.get('aplay.part').value}, on ${ps.get('aplay.on').value}`);

  // Schema evolution. Cues stored before Rate and Level joined the set carry
  // only part/start/len; rejecting them would silently empty the bank of every
  // project saved until today.
  const legacy = mk();
  legacy.restore({ aplay: [{ part: 2, start: 0.3, len: 0.4 }] });
  const lc = legacy.get('aplay', 0);
  check('a cue saved before Rate/Level joined still loads', lc !== null,
    JSON.stringify(lc));
  check('and keeps the keys it does have',
    lc && lc.start === 0.3 && lc.len === 0.4, JSON.stringify(lc));
  check('while the key it never had is simply absent',
    lc && !('rate' in lc) && !('level' in lc), JSON.stringify(lc));

  // A partial recall must not write `undefined` into the params it lacks —
  // the value setter would clamp that to min and call it a real edit.
  const lps = legacy.ps;
  lps.set('aplay.rate', 1.5); lps.set('aplay.level', 0.8);
  legacy.recall('aplay', 0);
  check('a partial recall leaves the missing params untouched',
    lps.get('aplay.rate').value === 1.5 && lps.get('aplay.level').value === 0.8,
    `rate ${lps.get('aplay.rate').value}, level ${lps.get('aplay.level').value}`);

  const empty = mk();
  empty.restore({ aplay: [{ nothing: 1 }] });
  check('a cue holding NO recognised key is still rejected',
    empty.get('aplay', 0) === null, JSON.stringify(empty.get('aplay', 0)));
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
    check('the shipped key order is start, len, rate, level',
      keys.join() === 'start,len,rate,level', keys.join() || '(no keys found)');
    check('the shipped bank allows partial cues (old saves keep their banks)',
      /allowPartial\s*:\s*true/.test(m[1]), m[1].trim());
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
  const KEYS = ['start', 'len', 'rate', 'level'];
  const cues = new CueBank(ps, { banks: ['aplay'], keys: KEYS, allowPartial: true });
  ps.set('aplay.start', 0.1); ps.set('aplay.len', 0.2);
  cues.store('aplay', 3);
  const json = JSON.parse(JSON.stringify(cues.serialize()));

  const fresh = new CueBank(makePs(), { banks: ['aplay'], keys: KEYS, allowPartial: true });
  fresh.restore(json);
  check('a stored cue survives serialize → restore',
    JSON.stringify(fresh.get('aplay', 3)) === JSON.stringify(cues.get('aplay', 3)),
    JSON.stringify(fresh.get('aplay', 3)));
  check('empty slots stay empty', fresh.get('aplay', 0) === null);
  check('the bank is still eight long', fresh.slots.aplay.length === CUE_SLOTS);

  // Every file written before this feature has no playCues key at all.
  const legacy = new CueBank(makePs(), { banks: ['aplay'], keys: KEYS });
  legacy.restore(undefined);
  check('restore(undefined) is survivable', legacy.slots.aplay.length === CUE_SLOTS
    && legacy.slots.aplay.every(c => c === null));
  // This bank is STRICT (no allowPartial), like the movie decks.
  legacy.restore({ aplay: [{ start: 0.5, len: 0.2, rate: 1 }] });   // level missing
  check('a STRICT bank still drops a cue missing a key',
    legacy.get('aplay', 0) === null, JSON.stringify(legacy.get('aplay', 0)));
  legacy.restore({ aplay: [{ start: 0.5, len: 0.2, rate: 1, level: 'x' }] });
  check('a non-numeric value is dropped', legacy.get('aplay', 0) === null);
  legacy.restore({ somethingElse: [] });
  check('an unknown bank is ignored', legacy.slots.aplay.length === CUE_SLOTS);
}


console.log('\na movie cue carries the clip its region belongs to');
{
  // A stand-in for main.js's clip host: it records what was asked for and can
  // pretend a clip is missing.
  const mkHost = (start = 'A') => {
    const h = {
      cur: start, asked: [], missing: new Set(),
      currentId: () => h.cur,
      select: async (_p, id) => {
        h.asked.push(id);
        if (h.missing.has(id)) return false;
        h.cur = id;
        return true;
      },
    };
    return h;
  };
  const host = mkHost('preload:Dive.mp4');
  const ps = makePs();
  const cues = new MovieCues(ps, { movie: { forcePosSeek: () => {} } }, host);

  ps.set('movie.start', 10); ps.set('movie.end', 40); ps.set('movie.pos', 25);
  cues.store('movie', 0);
  check('the cue records which clip was loaded',
    cues.get('movie', 0)?.clip === 'preload:Dive.mp4',
    JSON.stringify(cues.get('movie', 0)));
  check('and still records the region', cues.get('movie', 0)?.start === 10);

  // Store a second cue against a different clip.
  host.cur = 'preload:Gara.mp4';
  ps.set('movie.start', 60); ps.set('movie.end', 90); ps.set('movie.pos', 70);
  cues.store('movie', 1);
  check('a second cue records its own clip',
    cues.get('movie', 1)?.clip === 'preload:Gara.mp4');

  // Recalling cue 0 must SWITCH the clip back.
  host.asked.length = 0;
  cues.recall('movie', 0);
  await new Promise((r) => setTimeout(r, 0));
  check('recall asks for the cue\'s clip', host.asked[0] === 'preload:Dive.mp4',
    JSON.stringify(host.asked));
  check('the deck ends up on it', host.cur === 'preload:Dive.mp4');
  check('and the region follows the clip', ps.get('movie.start').value === 10 &&
    ps.get('movie.pos').value === 25,
    `${ps.get('movie.start').value}/${ps.get('movie.pos').value}`);

  // Already on the right clip: no switch, and applied SYNCHRONOUSLY so no frame
  // shows the new region against the old clip.
  host.asked.length = 0;
  ps.set('movie.start', 0);
  cues.recall('movie', 0);
  check('no clip switch when it is already up', host.asked.length === 0);
  check('and the region applied without awaiting', ps.get('movie.start').value === 10,
    String(ps.get('movie.start').value));

  // A clip removed from the library: recall the region anyway rather than
  // doing nothing, which would read as a dead pad.
  host.missing.add('preload:Gara.mp4');
  host.cur = 'preload:Dive.mp4';
  cues.recall('movie', 1);
  await new Promise((r) => setTimeout(r, 0));
  check('a missing clip still recalls its region', ps.get('movie.start').value === 60,
    String(ps.get('movie.start').value));
}

console.log('\nthe clip survives save and load — the whole point of extraKeys');
{
  const a = new MovieCues(makePs(), {}, { currentId: () => 'preload:Dive.mp4', select: async () => true });
  a.store('movie', 0);
  const blob = JSON.parse(JSON.stringify(a.serialize()));
  check('serialize carries it', blob.movie[0]?.clip === 'preload:Dive.mp4',
    JSON.stringify(blob.movie[0]));

  const b = new MovieCues(makePs(), {}, null);
  b.restore(blob);
  check('RESTORE CARRIES IT TOO', b.get('movie', 0)?.clip === 'preload:Dive.mp4',
    'restore() coerces every key to Number, which drops a string id — the cue ' +
    'would come back pointing at no clip and recall a region against whatever ' +
    'happens to be loaded');
  check('and the region survives', b.get('movie', 0)?.start === 0);

  // A cue file written before clips were carried still loads.
  const legacy = new MovieCues(makePs(), {}, null);
  legacy.restore({ movie: [{ start: 5, end: 50, pos: 20 }] });
  check('a legacy cue restores', legacy.get('movie', 0)?.start === 5);
  check('with no clip, and that is not an error', legacy.get('movie', 0)?.clip === undefined);

  // A slot holding ONLY an extra key is not a cue.
  //
  // Tested on an allowPartial bank, which is the ONLY configuration where the
  // guard is reachable: MovieCues is strict, so its numeric loop already
  // rejects a cue missing `start` long before the extra-key code runs. Asserting
  // it through MovieCues passed whether or not the guard existed — the guard was
  // being credited for the strict path's work.
  const partial = new CueBank(makePs(), {
    banks: ['aplay'], keys: ['start', 'len'], extraKeys: ['clip'], allowPartial: true,
  });
  partial.restore({ aplay: [{ clip: 'preload:Dive.mp4' }] });
  check('an extra key with no region is not a cue', partial.get('aplay', 0) === null,
    'a slot that lights up and recalls nothing is worse than an empty one');
  partial.restore({ aplay: [{ start: 5, clip: 'preload:Dive.mp4' }] });
  check('but one real key is enough, and carries the extra',
    partial.get('aplay', 0)?.start === 5 && partial.get('aplay', 0)?.clip === 'preload:Dive.mp4',
    JSON.stringify(partial.get('aplay', 0)));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll cue-bank checks passed.\n');
process.exit(failures ? 1 : 0);
