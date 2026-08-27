/**
 * Drawing the loop (§8.6) — the audio graph in the signal path display.
 *
 * §8.6 chose this over every other mitigation for one reason:
 *
 * > *"it is the only one that turns the hazard into an object the performer can
 * > reason about"*
 *
 * An object, not a message. That distinction is what these checks defend, and it
 * decomposes into three claims that can each rot independently:
 *
 * 1. **The row says which link to open.** A warning that the loop is closed is
 *    step 10 and already shipped; this row is only worth its pixels if it names
 *    the microphone, the recorder, the tape, the reader and the monitor
 *    SEPARATELY, so the performer can see which one to break.
 * 2. **There is still exactly one answer to "is the loop closed".**
 *    `AudioBinding._loopLive()` is it. `graph-view.js` takes the answer as an
 *    argument and must never re-derive it — a second implementation would be a
 *    second answer, and the copy that drifted would be the one drawing a safety
 *    marking.
 * 3. **The marking survives the layout.** The bracket is measured from live
 *    offsets, which is the first thing in the strip to depend on its own
 *    geometry; every transition that invalidates those offsets has to re-render,
 *    and a degenerate measurement must not take the label down with it.
 *
 * Driven by OUTCOME rather than by censusing source text, which is the lesson the
 * step-10 review left behind (two regex censuses were both wrong about the file
 * rather than the code). `graph-view.js` is pure, and `UI.js` imports in Node
 * against the small fake DOM below — so the row, the loop and the measured
 * bracket are all directly observable here.
 *
 * **Calibrated by mutation, and the calibration is committed** — the 21 defects
 * these checks are meant to catch live in `tests/mutations.mjs` and are re-run by
 * `npm run mutate`. Two of them found real faults rather than confirming absent
 * ones: `carries()` comparing slot indices where spans were meant, and this
 * file's own hand-copied list of subscribed parameter ids going stale in the same
 * commit that made it matter.
 *
 * Run:  node tests/audit-audio-signalpath.mjs
 *       npm run mutate audit-audio-signalpath
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describeAudioGraph } from '../src/audio/graph-view.js';
import { inOrder } from './lib/source.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ═══════════════════════════════════════════════════════════════════════════
// A fake DOM, just large enough to run SignalPath.
//
// Elements lay themselves out: every child is NODE_W wide with GAP between, in
// append order. Crude, and it does not need to be anything else — what is under
// test is that the bracket spans from the mic node's centre to the monitor
// node's centre, and a fake layout proves that as well as a real one would while
// being deterministic.
// ═══════════════════════════════════════════════════════════════════════════
const NODE_W = 40, GAP = 6;
let LAYOUT_ON = true;

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.style = { cssText: '' };
    this.dataset = {};
    this.textContent = '';
    this.title = '';
    this._class = '';
  }
  get className() { return this._class; }
  set className(v) { this._class = v; }
  get classList() {
    const self = this;
    const list = () => self._class.split(/\s+/).filter(Boolean);
    return {
      add: (...c) => { self._class = [...new Set([...list(), ...c])].join(' '); },
      remove: (...c) => { self._class = list().filter(x => !c.includes(x)).join(' '); },
      toggle: (c, on) => { on ? self.classList.add(c) : self.classList.remove(c); },
      contains: (c) => list().includes(c),
    };
  }
  set innerHTML(v) { if (v === '') { this.children.forEach(c => { c.parent = null; }); this.children = []; } }
  get innerHTML() { return ''; }
  appendChild(c) { c.parent = this; this.children.push(c); return c; }
  addEventListener() {}
  get offsetWidth() { return LAYOUT_ON ? NODE_W : 0; }
  get offsetLeft() {
    if (!LAYOUT_ON || !this.parent) return 0;
    const i = this.parent.children.indexOf(this);
    return i * (NODE_W + GAP);
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  querySelectorAll(sel) {
    const m = /^\[data-sp-key="(.+)"\]$/.exec(sel);
    const out = [];
    const walk = (e) => {
      if (m && e.dataset.spKey === m[1]) out.push(e);
      e.children.forEach(walk);
    };
    this.children.forEach(walk);
    return out;
  }
}

const displayEl = new El('div');
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  addEventListener() {}, removeEventListener() {},
  createElement: (t) => new El(t),
  getElementById: (id) => (id === 'signal-path-display' ? displayEl : null),
  body: new El('body'),
};

const { ParameterSystem, registerCoreParameters } = await import('../src/controls/ParameterSystem.js');
const { SignalPath } = await import('../src/ui/UI.js');

const ps = new ParameterSystem();
registerCoreParameters(ps);

/** A stand-in for AudioBinding: the row under test only ever calls this one. */
const host = { graph: { nodes: [], loop: null }, describeGraph() { return this.graph; } };
const SNAP = {
  running: true, micOpen: true, loopLive: true, monitorLabel: 'Speakers',
  tapeSec: 60,
  rec:   { on: true,  part: 0, unsafe: false },
  play:  { on: true,  part: 0, unsafe: false },
  grain: { on: false, part: 1, unsafe: false },
  voiceOn: false,
  // The registered defaults: four equal, abutting quarters.
  partBounds: [
    { start: 0,    len: 0.25 }, { start: 0.25, len: 0.25 },
    { start: 0.5,  len: 0.25 }, { start: 0.75, len: 0.25 },
  ],
};
const snap = (o = {}) => ({ ...SNAP, ...o });

const sp = new SignalPath({ ps, pipeline: null, audioHost: host });
/** Render with a given graph and hand back the audio row. */
const draw = (graph) => {
  host.graph = graph;
  sp._render();
  return displayEl.children.find(c => c.className.includes('sp-audio-row')) ?? null;
};
const labels = (row) => (row ? row.children.map(c => c.textContent).filter(Boolean) : []);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe row names every link, so it says which one to open');
{
  const g = describeAudioGraph(snap({ voiceOn: true }));
  const keys = g.nodes.map(n => n.key).filter(Boolean);
  ['mic', 'rec', 'tape', 'read', 'voice', 'limit', 'out'].forEach(k => {
    check(`there is a '${k}' node`, keys.includes(k), keys.join(','));
  });
  // Via inOrder(), not a chain of `<`: a missing key indexOf()s to -1, and -1
  // is less than every real position, so the chain reported "in signal order"
  // for a graph with no 'mic' node at all.
  const order = inOrder(keys.join('\u0000') + '\u0000',
    ['mic\u0000', 'rec\u0000', 'tape\u0000', 'read\u0000', 'limit\u0000', 'out\u0000']);
  check('and they are in signal order', order.ok,
    order.missing.length ? `missing: ${order.missing.join(',').replace(/\u0000/g, '')}`
                         : keys.join(' → '));
  // §4.11: the limiter is not bypassable, and the thing that bounds the damage
  // belongs in the same picture as the thing that causes it.
  check('the limiter is drawn even with nothing else running',
    describeAudioGraph(snap({
      rec: { on: false, part: 0 }, play: { on: false, part: 0 }, micOpen: false,
    })).nodes.some(n => n.key === 'limit'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\neach node reports its own state');
{
  check('mic is a live source when the DEVICE is open',
    describeAudioGraph(snap()).nodes.find(n => n.key === 'mic').type === 'source');
  check('and an inert node when it is not',
    describeAudioGraph(snap({ micOpen: false })).nodes.find(n => n.key === 'mic').type === 'node');

  const rec = describeAudioGraph(snap({ rec: { on: true, part: 2 } })).nodes.find(n => n.key === 'rec');
  check('a running recorder names its partition', rec.label === 'rec P2' && rec.type === 'active', rec.label);
  const recOff = describeAudioGraph(snap({ rec: { on: false, part: 2 } })).nodes.find(n => n.key === 'rec');
  check('a stopped one does not — a partition it is not writing is noise',
    recOff.label === 'rec' && recOff.type === 'node', recOff.label);

  const both = describeAudioGraph(snap({
    play: { on: true, part: 1 }, grain: { on: true, part: 3 },
  }));
  check('two readers both appear',
    both.nodes.filter(n => n.key === 'read').length === 2,
    both.nodes.map(n => n.label).join(' '));
  check('with a merge between them, as the video row already means',
    both.nodes.some(n => n.type === 'merge'));
  const none = describeAudioGraph(snap({ play: { on: false, part: 0 }, grain: { on: false, part: 0 } }));
  check('no reader still draws the link, greyed',
    none.nodes.filter(n => n.key === 'read').length === 1
      && none.nodes.find(n => n.key === 'read').type === 'node');
  check('the monitor node names where the sound is going',
    describeAudioGraph(snap({ monitorLabel: 'Headphones' })).nodes
      .find(n => n.key === 'out').label.includes('headphones'));
  check('the tape node carries its length',
    describeAudioGraph(snap({ tapeSec: 90 })).nodes.find(n => n.key === 'tape').label === 'tape 90s');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nno row at all when nothing is running');
{
  const g = describeAudioGraph(snap({ running: false }));
  check('a stopped engine draws nothing', g.nodes.length === 0 && g.loop === null);
  check('and the same is true with the mic open and the loop claimed live',
    describeAudioGraph(snap({ running: false, micOpen: true, loopLive: true })).nodes.length === 0);
  const row = draw(describeAudioGraph(snap({ running: false })));
  check('so SignalPath appends no audio row', row === null);
  check('and the strip shrinks back', !document.body.classList.contains('sp-audio'));
  const row2 = draw(describeAudioGraph(snap()));
  check('while a running engine grows it', !!row2 && document.body.classList.contains('sp-audio'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nONE answer to "is the loop closed" — loopLive is read, never re-derived');
{
  check('loopLive false ⇒ no loop, whatever else is true',
    describeAudioGraph(snap({ loopLive: false })).loop === null);
  // The teeth of the rule. If graph-view re-implemented the predicate from the
  // same three reads, THIS is the case that would disagree with _loopLive().
  const odd = describeAudioGraph(snap({ loopLive: true, micOpen: false, monitorLabel: 'Headphones' }));
  check('loopLive true is honoured even when the parts would say otherwise',
    odd.loop !== null,
    'graph-view must not second-guess the one predicate');

  const src = read('src/audio/graph-view.js');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  check('graph-view imports nothing at all', !/^\s*import\s/m.test(code));
  check('and never names a monitoring mode', !/Speakers|Headphones|MONITOR/.test(code));

  // ── The one place this file reads SOURCE instead of behaviour, and why ──
  // Everything else here is driven: graph-view is pure, UI.js imports in Node.
  // `AudioBinding` does NOT — it reaches `AudioEngine`, which has a Vite `?url`
  // import that Node cannot resolve — so there is no way to observe
  // `describeGraph()` calling `_loopLive()` rather than rebuilding the three-term
  // conjunction itself. That substitution is the single most consequential
  // regression available in this feature (two answers to "is the loop closed",
  // with the drifting copy drawing a safety marking), so it is worth a regex
  // that could in principle be fooled by formatting over no check at all.
  //
  // Its weakness is stated rather than left to be discovered: it proves the
  // TEXT is present, not that it is reached. The behavioural half is the
  // `loopLive: true` snapshot above, which pins the direction of the dependency
  // from the other side — graph-view honours the flag it is given.
  const ab = read('src/audio/AudioBinding.js');
  check('the binding asks _loopLive() rather than rebuilding the conjunction',
    /describeGraph\(\)[\s\S]{0,900}?loopLive: this\._loopLive\(\)/.test(ab));
  check('and describeGraph is the only thing UI.js calls',
    /this\.audioHost\s*\n?\s*\?\s*this\.audioHost\.describeGraph\(\)/.test(read('src/ui/UI.js')));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\ncarrying is a different question from closed');
{
  const carried = (o) => describeAudioGraph(snap(o)).loop.carried;
  check('recorder off ⇒ the room is a wire with nothing driving it',
    carried({ rec: { on: false, part: 0 } }) === false);
  check('no reader ⇒ the same',
    carried({ play: { on: false, part: 0 }, grain: { on: false, part: 0 } }) === false);
  check('recorder and reader on the SAME partition ⇒ carrying',
    carried({ rec: { on: true, part: 1 }, play: { on: true, part: 1 } }) === true);
  check('on different partitions ⇒ not carrying — the mic never reaches the out',
    carried({ rec: { on: true, part: 1 }, play: { on: true, part: 3 } }) === false);
  check('a grain player counts as a reader too',
    carried({
      play: { on: false, part: 0 },
      grain: { on: true, part: 0 }, rec: { on: true, part: 0 },
    }) === true);
  // §4.3: unsafe spans the whole tape, so partitions stop meaning anything.
  check('an unsafe reader carries from any partition',
    carried({ rec: { on: true, part: 0 }, play: { on: true, part: 3, unsafe: true } }) === true);
  check('and so does an unsafe recorder',
    carried({ rec: { on: true, part: 0, unsafe: true }, play: { on: true, part: 3 } }) === true);

  const live = describeAudioGraph(snap()).loop;
  const idle = describeAudioGraph(snap({ rec: { on: false, part: 0 } })).loop;
  check('the two states are labelled differently', live.label !== idle.label,
    `${live.label} vs ${idle.label}`);
  check('and the carrying one is the one that shouts', live.label.includes('⚠'));
  check('both explain themselves in full', live.title.includes('→') && idle.title.includes('→'));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\npartitions are not disjoint, so carrying compares SPANS not indices');
{
  // Nothing in the worklet makes partitions disjoint: `_partBounds` validates
  // the range and refuses while a zone runs, and that is all. Two slots CAN
  // cover the same tape, and an index comparison calls that "not carrying" —
  // a live howl drawn dashed-grey, which is an under-claim in a test whose
  // whole justification is that it over-claims.
  const overlapped = [
    { start: 0, len: 0.5 }, { start: 0.25, len: 0.5 },     // P0 and P1 share tape
    { start: 0.5, len: 0.25 }, { start: 0.75, len: 0.25 },
  ];
  const carried = (o) => describeAudioGraph(snap(o)).loop.carried;
  check('two DIFFERENT partitions covering the same tape ⇒ carrying',
    carried({
      partBounds: overlapped,
      rec: { on: true, part: 0 }, play: { on: true, part: 1 },
    }) === true,
    'an index comparison reports this as idle — it is a howl');
  check('and abutting partitions still do not touch',
    carried({ rec: { on: true, part: 0 }, play: { on: true, part: 1 } }) === false,
    'P0 ends exactly where P1 starts; a half-open interval does not overlap');
  check('a zero-length partition carries nothing',
    carried({
      partBounds: [{ start: 0, len: 0 }, ...SNAP.partBounds.slice(1)],
      rec: { on: true, part: 0 }, play: { on: true, part: 0 },
    }) === false);
  // Cautious direction when the layout is unknown, and it cannot arise today.
  check('missing bounds are treated as overlapping, not as disjoint',
    carried({ partBounds: undefined, rec: { on: true, part: 0 }, play: { on: true, part: 3 } }) === true);
  check('the binding actually supplies the spans',
    /partBounds: Array\.from\(\{ length: PARTITION_SLOTS \}/.test(read('src/audio/AudioBinding.js')));
  check('and SignalPath re-renders when a partition is dragged',
    ['apart0.start', 'apart0.len', 'apart3.start', 'apart3.len']
      .every(id => read('src/ui/UI.js').includes(`'${id}'`)));
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe idle tooltip names the link that is actually open');
{
  const why = (o) => describeAudioGraph(snap(o)).loop.title;
  check('recorder off ⇒ it says so, and names the toggle',
    /Run Rec is off/.test(why({ rec: { on: false, part: 0 } })));
  check('no reader ⇒ it names those toggles instead',
    /Run Play and Run Grain/.test(why({
      play: { on: false, part: 0 }, grain: { on: false, part: 0 },
    })));
  check('a reader on the wrong material ⇒ it says that, not "no reader"',
    /not writing/.test(why({ rec: { on: true, part: 0 }, play: { on: true, part: 3 } })));
  // The bug this replaces: one sentence for every idle case, pointing at the
  // wrong end of the chain in the most common one.
  check('the three reasons are genuinely different sentences',
    new Set([
      why({ rec: { on: false, part: 0 } }),
      why({ play: { on: false, part: 0 }, grain: { on: false, part: 0 } }),
      why({ rec: { on: true, part: 0 }, play: { on: true, part: 3 } }),
    ]).size === 3);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe bracket is measured, and anchored to nodes that exist');
{
  const g = describeAudioGraph(snap());
  const keys = g.nodes.map(n => n.key);
  check('the loop anchors name real nodes',
    keys.includes(g.loop.from) && keys.includes(g.loop.to),
    `${g.loop.from} → ${g.loop.to} in ${keys.join(',')}`);
  check('it returns from the monitor to the mic, not the other way',
    g.loop.from === 'out' && g.loop.to === 'mic');

  const row = draw(g);
  const ret = row.children.find(c => c.className.includes('sp-loop-return'));
  check('a bracket is drawn', !!ret);
  const mic = row.querySelector('[data-sp-key="mic"]');
  const out = row.querySelector('[data-sp-key="out"]');
  check('it starts at the mic node centre',
    ret.style.left === `${mic.offsetLeft + NODE_W / 2}px`, ret.style.left);
  check('and is as wide as the span back from the monitor node centre',
    ret.style.width === `${out.offsetLeft - mic.offsetLeft}px`, ret.style.width);
  check('it is marked live when the loop is carrying', ret.className.includes('live'));
  check('and idle when it is not',
    draw(describeAudioGraph(snap({ rec: { on: false, part: 0 } })))
      .children.find(c => c.className.includes('sp-loop-return')).className.includes('idle'));

  // The claim in _renderAudio's comment, made testable: a strip that measures
  // zero loses the LINE and keeps the LABEL. Anything else and a `display:none`
  // ancestor silently deletes a safety marking.
  LAYOUT_ON = false;
  const flat = draw(describeAudioGraph(snap()));
  check('an unmeasurable layout drops the bracket',
    !flat.children.some(c => c.className.includes('sp-loop-return')));
  check('but never the label',
    flat.children.some(c => c.className.includes('sp-loop-tag')));
  LAYOUT_ON = true;
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe row is re-drawn on every edge that can change it');
{
  const main = read('src/main.js');
  const ui = read('src/ui/UI.js');
  check('main.js hands SignalPath the binding', /audioHost: audio/.test(main));
  // The device is not a param: `_applyTap` opens the mic directly and audio.mic
  // catches up afterwards, so the ONE edge the subscriptions cannot see arrives
  // through onLoopState.
  check('and re-renders from onLoopState, which is where the DEVICE edge arrives',
    /audio\.onLoopState = \([\s\S]{0,600}?signalPath\?\._render\(\)/.test(main));
  check('the warning line still exists beside it — the strip can be hidden',
    /audio-loop-warning/.test(main) && /loopEl\.textContent = live/.test(main));
  // The bracket is the only thing in the strip whose CORRECTNESS depends on
  // pixel widths, and .sp-node flex-shrinks.
  check('a window resize re-measures the bracket',
    /window\.addEventListener\('resize', \(\) => this\._render\(\)\)/.test(ui));
  check('showing a hidden strip re-measures it',
    /_applySPHidden = \(\) => \{[\s\S]{0,700}?if \(!_spHidden\) signalPath\?\._render\(\)/.test(main));
  check('floating it re-measures it too',
    /_floatSP\(\) \{[\s\S]{0,3000}?signalPath\._render\(\);\s*\n\s*\}/.test(main));

  ['audio.enable', 'audio.mic', 'audio.monitor', 'arec.on', 'arec.part',
   'aplay.on', 'agrain.on', 'avoice.on', 'apart1.start'].forEach(id => {
    check(`SignalPath subscribes to ${id}`, ui.includes(`'${id}'`));
  });

  // ── Every id it asks for RESOLVES ─────────────────────────────────────────
  // This used to be a hand-copied list of ids, which is the bug it was meant to
  // catch wearing a different hat: the partition ids were added to UI.js and not
  // to the list, so a typo in `apart2.len` would have subscribed to nothing,
  // silently, exactly like the typo the check exists for. `ps.get(id)?.onChange`
  // swallows a miss, so nothing else would have said a word.
  //
  // Recorded instead of enumerated. Every id SignalPath asks for during a full
  // construct-and-render is observed, and any that does not resolve is named —
  // so a new subscription is covered the moment it is written, and nobody has to
  // remember this file exists.
  {
    const probe = new ParameterSystem();
    registerCoreParameters(probe);
    const missed = [];
    const realGet = probe.get.bind(probe);
    probe.get = (id) => {
      const p = realGet(id);
      if (!p) missed.push(id);
      return p;
    };
    host.graph = describeAudioGraph(snap());
    new SignalPath({ ps: probe, pipeline: null, audioHost: host });
    check('every id SignalPath asks for resolves to a real parameter',
      missed.length === 0, `unresolved: ${[...new Set(missed)].join(', ')}`);
    // Guards the guard: if the probe stopped seeing anything, the check above
    // would pass by asking nothing at all.
    check('and the probe actually saw the subscriptions',
      realGet('apart3.len') && ui.includes("'apart3.len'"));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe strip makes room, and hiding it still wins');
{
  // COMMENTS STRIPPED FIRST, and the first draft did not: the ordering check
  // below found `body.signalpath-hidden` inside the comment explaining the
  // ordering and failed a correct file. Same shape as the step-10 check that
  // matched its own prose. A stylesheet check must read the stylesheet, not the
  // argument for it.
  const css = read('src/style.css').replace(/\/\*[\s\S]*?\*\//g, '');
  check('body.sp-audio widens the strip', /body\.sp-audio\s*\{[^}]*--signal-h/.test(css));
  // Both selectors are (0,1,1), so ORDER decides. Getting this backwards means
  // starting the audio engine un-hides a strip the performer hid.
  // Guarded: with either selector absent, `-1 < n` is true and this passed on
  // a stylesheet missing the rule entirely — the very failure this check
  // exists to catch. (The lesson that named THIS check: LEARNED 2026-08-14.)
  const spOrder = inOrder(css, ['body.sp-audio', 'body.signalpath-hidden']);
  check('and is declared BEFORE body.signalpath-hidden, so hiding still wins',
    spOrder.ok,
    spOrder.missing.length ? `absent from the stylesheet: ${spOrder.missing.join(', ')}`
      : `${css.indexOf('body.sp-audio')} vs ${css.indexOf('body.signalpath-hidden')}`);
  check('the class is toggled on every render, not merely added',
    /classList\.toggle\('sp-audio', nodes\.length > 0\)/.test(read('src/ui/UI.js')));
  ['.sp-audio-row', '.sp-loop-return', '.sp-loop-head', '.sp-loop-tag'].forEach(sel => {
    check(`${sel} is styled`, css.includes(sel));
  });
  check('the audio row leaves room under it for the bracket',
    /\.sp-audio-row\s*\{[^}]*padding-bottom/.test(css));
  check('live is red and idle is not',
    /\.sp-loop-return\.live[^{]*\{[^}]*var\(--red\)/.test(css)
      && /\.sp-loop-return\.idle[^{]*\{[^}]*var\(--text-2\)/.test(css));
}

console.log(failures === 0
  ? '\n✅ signal-path audio row: all checks passed\n'
  : `\n❌ ${failures} check(s) failed\n`);
process.exit(failures ? 1 : 0);
