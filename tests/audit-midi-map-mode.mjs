/**
 * MIDI Map Mode — a latching learn, and the re-arm that makes it worth having.
 *
 * The complaint this answers: assigning a desk with 8 knobs, 8 faders and 24
 * buttons meant 40 trips through the context menu, because `startMIDILearn` is
 * one-shot — the MIDI handler calls `cancelMIDILearn()` the moment a control
 * moves. Map mode latches, so a bind clears only the TARGET and the mode
 * survives: click a row, move a control, click the next row.
 *
 * Why an audit rather than a manual check: every failure here is SILENT. If the
 * re-arm regresses, the indicator still lights, the tint still shows, the first
 * bind still works — and the mode simply stops accepting the second one, which
 * reads as "the hardware dropped out" rather than as a mode bug. Nothing throws
 * and no value is wrong; there is just one fewer mapping than the performer
 * thinks they made, discovered mid-set.
 *
 * The load-bearing assertion is "the mode is still on AFTER a bind". Note it
 * cannot be replaced by "a second bind works" alone: a mode that never turned
 * on at all would also let the second bind through the one-shot path and score
 * a pass. Both are asserted, and the mode flag is read directly.
 *
 * ── MUTATION CALIBRATION ────────────────────────────────────────────────────
 *
 * Caught: re-arm removed; timeout armed in map mode; unmapMIDI's type guard
 * dropped; coalescing removed; log cap removed; dirty flag never cleared;
 * note-off no longer folding onto note-on; cc-map options not indexed.
 *
 * NOT caught, BY DESIGN — do not read this as a hole and do not "fix" it by
 * deleting a guard: real-time filtering is done twice in `_recordMidi`, by the
 * `status >= 0xF0` early return AND by the label-map lookup returning undefined
 * for those types. Removing EITHER one alone leaves the behaviour correct, so
 * the audit passes and is right to. Removing BOTH is caught. The assertion is
 * about the behaviour — no clock or active-sensing row ever reaches the log —
 * not about which line enforces it, which is the right level to pin given the
 * cost of getting it wrong is a monitor that scrolls itself blank.
 *
 * Run:  node tests/audit-midi-map-mode.mjs
 */

import { ParameterSystem, PARAM_TYPE, MIDI_PAGES, registerCoreParameters }
  from '../src/controls/ParameterSystem.js';

// ── DOM stubs ────────────────────────────────────────────────────────────────
// Richer than the sibling audit's, because map mode writes a body class and
// paints a target row. The class set is recorded so it can be asserted on: the
// tint is not decoration, it is the only signal that a plain click has changed
// meaning, and shipping the mode without it is a trap rather than a cosmetic
// gap.
const bodyClasses = new Set();
const badgeEl = { textContent: '', className: '' };
const indicatorClasses = new Set();
globalThis.navigator ??= {};
// NO `CSS` stub, deliberately. An earlier version stubbed it, and that stub
// MASKED a real fault: the code called browser-only `CSS.escape`, so this
// audit passed while its sibling `audit-midi-buttons` threw ReferenceError
// and took 322 later checks out of the run with it. A stub that supplies a
// global the runtime lacks does not test the code, it tests the stub.
globalThis.document ??= {
  body: {
    classList: {
      toggle: (c, on) => (on ? bodyClasses.add(c) : bodyClasses.delete(c)),
      add: (c) => bodyClasses.add(c),
      remove: (c) => bodyClasses.delete(c),
      contains: (c) => bodyClasses.has(c),
    },
  },
  getElementById: (id) =>
    id === 'status-midi'
      ? {
          classList: {
            add: (c) => indicatorClasses.add(c),
            remove: (c) => indicatorClasses.delete(c),
            toggle: (c, on) => (on ? indicatorClasses.add(c) : indicatorClasses.delete(c)),
            contains: (c) => indicatorClasses.has(c),
          },
        }
      : null,
  // A stand-in for the row's controller badge, so the post-bind repaint can be
  // asserted. Returning null (the obvious stub) makes `_repaintCtrlBadge`
  // return early and every check of it pass vacuously — the fail-open shape
  // this suite exists to avoid.
  querySelector: (sel) => (/\.param-ctrl$/.test(sel) ? badgeEl : null),
  querySelectorAll: () => [],
  addEventListener: () => {},
};
globalThis.window ??= { addEventListener: () => {} };

const { ControllerManager, MIDI_LOG_MAX } =
  await import('../src/controls/ControllerManager.js');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

/** A ControllerManager with a fake MIDI input wired to its real handler. */
function rig() {
  bodyClasses.clear();
  indicatorClasses.clear();
  badgeEl.textContent = ''; badgeEl.className = '';
  const ps = new ParameterSystem();
  ps.register({ id: 't.a', label: 'A', group: 'g', min: 0, max: 100, value: 0 });
  ps.register({ id: 't.b', label: 'B', group: 'g', min: 0, max: 100, value: 0 });
  ps.register({ id: 't.lfo', label: 'L', group: 'g', min: 0, max: 100, value: 0 });
  ps.register({ id: 't.sel', label: 'S', group: 'g', type: PARAM_TYPE.SELECT, value: 0,
    options: ['P0', 'P1', 'P2', 'P3'] });
  // The page params, mirrored from the real registry. Hand-copied lists are the
  // hazard this project keeps paying for, so a check below asserts the real
  // registry still declares these four with these types — if it drifts, that
  // check fails rather than these silently testing a fiction.
  ps.register({ id: 'midi.page', label: 'Map Page', group: 'global',
    type: PARAM_TYPE.SELECT, value: 0,
    options: Array.from({ length: MIDI_PAGES }, (_, i) => `${i + 1}`) });
  ps.register({ id: 'midi.pagePrev', label: 'P-', group: 'global', type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'midi.pageNext', label: 'P+', group: 'global', type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 'midi.pickup', label: 'Pickup', group: 'global',
    type: PARAM_TYPE.TOGGLE, value: 1 });
  // A SELECT too long for ParamRow's button group (>8), like clip.slot's 16.
  ps.register({ id: 't.slot', label: 'Slot', group: 'g', type: PARAM_TYPE.SELECT, value: 0,
    options: Array.from({ length: 16 }, (_, i) => String(i)) });
  const cm = new ControllerManager(ps);
  const input = {};
  cm._attachMIDIInput(input);
  const cc = (num, val = 127, ch = 1) => input.onmidimessage({ data: [0xB0 | (ch - 1), num, val] });
  const note = (n, vel = 100, ch = 1) => input.onmidimessage({ data: [0x90 | (ch - 1), n, vel] });
  // Both spellings of a release: a real 0x80, and the note-on-velocity-0 that
  // most controllers actually send.
  const noteOff  = (n, ch = 1) => input.onmidimessage({ data: [0x80 | (ch - 1), n, 0] });
  const noteOff0 = (n, ch = 1) => input.onmidimessage({ data: [0x90 | (ch - 1), n, 0] });
  return { ps, cm, cc, note, noteOff, noteOff0 };
}

console.log('\nmap mode is off until it is asked for');
{
  const { cm } = rig();
  check('starts off', cm.mapMode === false, String(cm.mapMode));
  check('no body class at rest', !bodyClasses.has('midi-map-mode'));
  cm.toggleMapMode();
  check('toggles on', cm.mapMode === true);
  check('body carries the tint class', bodyClasses.has('midi-map-mode'),
    'without it a plain click silently means something new — the mode is invisible');
  check('the indicator latches', indicatorClasses.has('mapping'));
  cm.toggleMapMode();
  check('toggles back off', cm.mapMode === false);
  check('body class is removed', !bodyClasses.has('midi-map-mode'));
  check('the indicator unlatches', !indicatorClasses.has('mapping'));
}

console.log('\na bind RE-ARMS instead of exiting — the point of the mode');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);

  cm.startMIDILearn('t.a');
  check('arming records the target', cm._midiLearnParam === 't.a');
  cc(21);
  check('the first control binds', ps.get('t.a').controller?.cc === 21,
    JSON.stringify(ps.get('t.a').controller));

  // The load-bearing pair. Neither alone is sufficient: a mode that never
  // switched on would still let the second bind through the one-shot path.
  check('MAP MODE IS STILL ON after the bind', cm.mapMode === true,
    'the bind exited the mode — every subsequent row needs the context menu again');
  check('the target cleared, so a stray CC binds nothing',
    cm._midiLearnParam === null, String(cm._midiLearnParam));

  cc(99);
  check('a CC with no target armed binds nothing',
    ps.get('t.b').controller == null && ps.get('t.a').controller?.cc === 21);

  cm.startMIDILearn('t.b');
  cc(22);
  check('a second row binds with no re-entry', ps.get('t.b').controller?.cc === 22,
    JSON.stringify(ps.get('t.b').controller));
  check('and the mode is STILL on after that one too', cm.mapMode === true);
  check('the two rows kept different CCs',
    ps.get('t.a').controller.cc === 21 && ps.get('t.b').controller.cc === 22);
}

console.log('\nthe one-shot learn is unchanged (no regression)');
{
  const { ps, cm, cc } = rig();
  check('mode is off for this path', cm.mapMode === false);
  cm.startMIDILearn('t.a');
  cc(30);
  check('it still binds', ps.get('t.a').controller?.cc === 30);
  check('and it still EXITS learn', cm._midiLearnParam === null);
  check('and did not silently turn map mode on', cm.mapMode === false);
  cc(31);
  check('a following CC binds nothing', ps.get('t.b').controller == null);
}

console.log('\nthe 10s auto-cancel is armed for one-shot, never for the mode');
{
  const { cm } = rig();
  cm.startMIDILearn('t.a');
  check('one-shot arms a timeout', cm._midiLearnTimer != null,
    'without it a forgotten arm waits for ever');
  cm.cancelMIDILearn();

  cm.setMapMode(true);
  cm._midiLearnTimer = null;
  cm.startMIDILearn('t.a');
  check('map mode arms NO timeout', cm._midiLearnTimer == null,
    'ten seconds expires while you reach for the far end of a fader bank, and ' +
    'the arm dying mid-reach reads as the mode being broken');
}

console.log('\nleaving the mode cancels a half-finished arm');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a');
  cm.setMapMode(false);
  check('the target is dropped', cm._midiLearnParam === null);
  cc(40);
  check('a CC arriving after exit binds nothing', ps.get('t.a').controller == null,
    'a stray control move after leaving the mode would bind to whatever was ' +
    'last clicked');
}

console.log('\nunmap, so a bad pass is recoverable');
{
  const { ps, cm } = rig();
  ps.get('t.a').controller = { type: 'midi-cc', cc: 21, channel: 1 };
  ps.get('t.lfo').controller = { type: 'lfo-sine', hz: 1 };

  check('unmapping a MIDI row reports success', cm.unmapMIDI('t.a') === true);
  check('and the binding is gone', ps.get('t.a').controller == null);
  check('unmapping an unmapped row reports false', cm.unmapMIDI('t.b') === false);
  check('unmapping a NON-MIDI controller is refused', cm.unmapMIDI('t.lfo') === false,
    'alt-clicking an LFO row in map mode must not silently delete the LFO');
  check('and the LFO survives', ps.get('t.lfo').controller?.type === 'lfo-sine');
}

console.log('\nclear-all drops MIDI bindings and nothing else');
{
  const { ps, cm } = rig();
  ps.get('t.a').controller = { type: 'midi-cc', cc: 21, channel: 1 };
  ps.get('t.b').controller = { type: 'midi-note', note: 60, channel: 1 };
  ps.get('t.lfo').controller = { type: 'lfo-sine', hz: 1 };

  const n = cm.clearAllMIDI();
  check('it reports how many it cleared', n === 2, String(n));
  check('the CC binding is gone', ps.get('t.a').controller == null);
  check('the note binding is gone', ps.get('t.b').controller == null);
  check('the LFO is untouched', ps.get('t.lfo').controller?.type === 'lfo-sine',
    'a clear-all that also wipes LFOs is not a MIDI clear');
}

console.log('\nper-option learn (midi-cc-map) re-arms too');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);

  cm.startMIDILearn('t.sel', 0);
  cc(50);
  cm.startMIDILearn('t.sel', 1);
  cc(51);
  const c = ps.get('t.sel').controller;
  check('both options bound in one pass', c?.type === 'midi-cc-map' &&
    c.ccs[0] === 50 && c.ccs[1] === 51, JSON.stringify(c));
  check('learning the second did not forget the first', c.ccs[0] === 50,
    'the merge was lost — a bank of buttons would only ever keep its last one');
  check('the mode survived both', cm.mapMode === true);

  // Re-learning a CC moves it rather than firing two options.
  cm.startMIDILearn('t.sel', 2);
  cc(50);
  const c2 = ps.get('t.sel').controller;
  check('re-using a CC moves it off the option that had it',
    c2.ccs[0] === null && c2.ccs[2] === 50, JSON.stringify(c2.ccs));
}

console.log('\nthe monitor records what arrives, and filters what would drown it');
{
  const { cm, cc } = rig();
  const raw = (status, d1, d2) => cm._recordMidi(status, d1, d2);

  check('starts empty', cm.midiLog.length === 0);
  cc(21, 96);
  check('a CC is recorded', cm.midiLast?.num === 21 && cm.midiLast?.val === 96,
    JSON.stringify(cm.midiLast));
  check('it carries the channel', cm.midiLast?.channel === 1);
  check('and is labelled', cm.midiLast?.label === 'CC');

  // The filter that matters most. The clock branch in the handler returns early
  // ONLY when clock sync is enabled, so with it off 0xF8 reaches here at 24 ppq
  // — 48/sec at 120bpm — and active sensing every ~300ms besides.
  const before = cm.midiLog.length;
  for (let i = 0; i < 200; i++) raw(0xF8, 0, 0);
  raw(0xFE, 0, 0); raw(0xFA, 0, 0); raw(0xFF, 0, 0);
  check('SYSTEM REAL-TIME IS DROPPED', cm.midiLog.length === before,
    `${cm.midiLog.length - before} clock/sensing rows got in — a 16-row monitor ` +
    'is scrolled to uselessness in under a second and looks broken, not flooded');

  raw(0xF0, 0x7E, 0); // sysex
  check('system common is dropped', cm.midiLog.length === before);
  raw(0xA0, 60, 100); // poly aftertouch
  raw(0xD0, 60, 0);   // channel aftertouch
  check('aftertouch is dropped', cm.midiLog.length === before,
    'continuous and with no control identity — it only pushes real rows out');
}

console.log('\nconsecutive messages from ONE control coalesce');
{
  const { cm, cc } = rig();
  cc(21, 10); cc(21, 20); cc(21, 30);
  check('one row, not three', cm.midiLog.length === 1, String(cm.midiLog.length));
  check('the value is the latest', cm.midiLast.val === 30);
  check('and the count rose', cm.midiLast.count === 3, String(cm.midiLast.count));
  cc(22, 5);
  check('a different control opens a new row', cm.midiLog.length === 2);
  cc(21, 40);
  check('returning to the first also opens a new row', cm.midiLog.length === 3,
    'coalescing is CONSECUTIVE-only; collapsing non-adjacent rows would reorder ' +
    'the log and lose the sequence you are reading it for');

  // A sweep must not evict everything else.
  const { cm: cm2, cc: cc2 } = rig();
  cc2(1, 1); cc2(2, 1); cc2(3, 1);
  for (let v = 0; v < 200; v++) cc2(64, v);
  const nums = cm2.midiLog.map(e => e.num);
  check('a 200-message fader sweep does not evict the other controls',
    nums.includes(1) && nums.includes(2) && nums.includes(3), JSON.stringify(nums));
}

console.log('\nthe log is capped and ordered newest-first for display');
{
  const { cm, cc } = rig();
  for (let i = 0; i < 40; i++) cc(i, 100);
  check('capped at MIDI_LOG_MAX', cm.midiLog.length === MIDI_LOG_MAX,
    String(cm.midiLog.length));
  check('newest is first', cm.midiLog[0].num === 39, String(cm.midiLog[0].num));
  check('oldest survivor is last', cm.midiLog[cm.midiLog.length - 1].num === 40 - MIDI_LOG_MAX);
}

console.log('\nthe dirty flag lets an idle rig cost nothing');
{
  const { cm, cc } = rig();
  check('clean at rest', cm.consumeMidiDirty() === false);
  cc(21, 1);
  check('dirty after a message', cm.consumeMidiDirty() === true);
  check('and consuming clears it', cm.consumeMidiDirty() === false,
    'a flag that never clears repaints every frame for ever');
}

console.log('\nthe bound column resolves every binding shape');
{
  const { ps, cm } = rig();
  ps.get('t.a').controller = { type: 'midi-cc', cc: 21, channel: 1 };
  ps.get('t.b').controller = { type: 'midi-note', note: 60, channel: 1 };
  ps.get('t.sel').controller = { type: 'midi-cc-map', ccs: [50, 51, null, null], channel: 1 };
  const ix = cm.buildMidiBindIndex();

  const at = (type, channel, num) => cm.midiBindingsFor({ type, channel, num }, ix);
  check('a plain CC resolves', at(0xB0, 1, 21).length === 1, JSON.stringify(at(0xB0,1,21)));
  check('a note resolves', at(0x90, 1, 60).length === 1);
  check('NOTE-OFF resolves to the same param as note-on', at(0x80, 1, 60).length === 1,
    'otherwise releasing a key shows the binding vanishing');
  check('a cc-map option resolves and names the option',
    at(0xB0, 1, 51)[0]?.includes('P1'), JSON.stringify(at(0xB0,1,51)));
  check('an unbound control reports nothing', at(0xB0, 1, 99).length === 0);
  check('a channel-0 (any) binding still matches',
    (() => { ps.get('t.lfo').controller = { type: 'midi-cc', cc: 77 };
             return cm.midiBindingsFor({ type: 0xB0, channel: 7, num: 77 },
               cm.buildMidiBindIndex()).length === 1; })());

  // Not cached across frames on purpose: MappingAutosave restores through
  // Parameter.deserialize, which never calls assign(), so a cached index would
  // be stale after every reload.
  ps.get('t.a').controller = { type: 'midi-cc', cc: 99, channel: 1 };
  const ix2 = cm.buildMidiBindIndex();
  check('a rebuild sees a controller written WITHOUT assign()',
    cm.midiBindingsFor({ type: 0xB0, channel: 1, num: 99 }, ix2).length === 1 &&
    cm.midiBindingsFor({ type: 0xB0, channel: 1, num: 21 }, ix2).length === 0);
}

console.log('\nthe row badge repaints after a bind — the only confirmation you get');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a');
  cc(41, 127);
  // '1:CC41', not 'CC41': `controllerLabel` prefixes the channel whenever the
  // controller records one, and learn always does. Asserting the bare form
  // would be testing a label this app never renders.
  check('the badge shows the channel and CC it just learned',
    badgeEl.textContent === '1:CC41',
    `"${badgeEl.textContent}" — a badge still reading "—" after a successful bind ` +
    'means a bulk pass gives no per-row confirmation at all');
  check('and carries the midi class', /\bmidi\b/.test(badgeEl.className), badgeEl.className);

  // The one-shot path already repainted via its callback; doing it here too
  // must not break it.
  const { cm: cm2, cc: cc2 } = rig();
  let cbFired = false;
  cm2.startMIDILearn('t.a', null, () => { cbFired = true; });
  cc2(42, 127);
  check('the one-shot callback still fires', cbFired);
  check('and its badge is right too', badgeEl.textContent === '1:CC42', badgeEl.textContent);
}

console.log('\nthe page params exist in the REAL registry, with the right shapes');
{
  const real = new ParameterSystem();
  registerCoreParameters(real);
  const want = {
    'midi.page':     PARAM_TYPE.SELECT,
    'midi.pagePrev': PARAM_TYPE.TRIGGER,
    'midi.pageNext': PARAM_TYPE.TRIGGER,
    'midi.pickup':   PARAM_TYPE.TOGGLE,
  };
  for (const [id, type] of Object.entries(want)) {
    const p = real.get(id);
    check(`${id} is registered as ${type}`, p?.type === type, String(p?.type));
    check(`${id} is group 'global' (never Display-State captured)`, p?.group === 'global',
      String(p?.group));
  }
  check('midi.page has one option per page', real.get('midi.page')?.options?.length === MIDI_PAGES);
  check('pickup defaults ON', real.get('midi.pickup')?.value === 1,
    'the jump is the surprising behaviour, not the pickup');
}

console.log('\npages hold separate bindings, and switching projects them');
{
  const { ps, cm, cc } = rig();
  check('starts on page 1', cm.mapPage === 0);

  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21);
  check('page 1 binding lands', ps.get('t.a').controller?.cc === 21);

  cm.setMapPage(1);
  check('the binding is gone on page 2', ps.get('t.a').controller == null,
    JSON.stringify(ps.get('t.a').controller));
  cm.startMIDILearn('t.a'); cc(31);
  check('page 2 takes its own binding', ps.get('t.a').controller?.cc === 31);

  cm.setMapPage(0);
  check('PAGE 1 BINDING COMES BACK', ps.get('t.a').controller?.cc === 21,
    JSON.stringify(ps.get('t.a').controller));
  cm.setMapPage(1);
  check('and page 2 is still page 2', ps.get('t.a').controller?.cc === 31);
  check('both live in midiPages', ps.get('t.a').midiPages[0].cc === 21 &&
    ps.get('t.a').midiPages[1].cc === 31, JSON.stringify(ps.get('t.a').midiPages));
}

console.log('\nthe page-switch controls are NOT paged — the escape hatch');
{
  const { ps, cm } = rig();
  cm.setPageBinding('midi.pageNext', { type: 'midi-cc', cc: 58, channel: 1 });
  check('it binds', ps.get('midi.pageNext').controller?.cc === 58);
  check('and is NOT written into a page', !ps.get('midi.pageNext').midiPages?.some(Boolean),
    'a paged page-switch control strands you on a page with no way back');
  cm.setMapPage(2);
  check('IT SURVIVES A PAGE SWITCH', ps.get('midi.pageNext').controller?.cc === 58,
    'without this the desk is bricked until you reach for the mouse');
  cm.setMapPage(0);
  check('and every page', ps.get('midi.pageNext').controller?.cc === 58);
}

console.log('\nswitching pages never eats a non-MIDI controller');
{
  const { ps, cm } = rig();
  ps.get('t.lfo').controller = { type: 'lfo-sine', hz: 1 };
  cm.setMapPage(1); cm.setMapPage(2); cm.setMapPage(0);
  check('an unpaged LFO is untouched', ps.get('t.lfo').controller?.type === 'lfo-sine',
    JSON.stringify(ps.get('t.lfo').controller));
}

console.log('\npage index wraps both ways');
{
  const { cm } = rig();
  cm.setMapPage(MIDI_PAGES - 1);
  cm.nextMapPage();
  check('forward wraps to the first', cm.mapPage === 0, String(cm.mapPage));
  cm.prevMapPage();
  check('backward wraps to the last', cm.mapPage === MIDI_PAGES - 1, String(cm.mapPage));
}

console.log('\nunmapping clears the PAGE, not just the live projection');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21);
  cm.unmapMIDI('t.a');
  check('gone now', ps.get('t.a').controller == null);
  cm.setMapPage(1); cm.setMapPage(0);
  check('AND STILL GONE after a page round trip', ps.get('t.a').controller == null,
    'clearing only `controller` leaves midiPages holding it, so it returns the ' +
    'next time you come back to this page');
}

console.log('\nsoft takeover: the value does not jump after a page switch');
{
  const { ps, cm, cc } = rig();
  const a = ps.get('t.a'), b = ps.get('t.b');

  // One physical fader (CC21) drives t.a on page 1 and t.b on page 2 — the real
  // shape of the problem. Binding both pages to ONE param would share a value
  // and could not show a jump at all.
  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21, 64);
  cm.setMapPage(1);
  cm.startMIDILearn('t.b'); cc(21, 64);
  cm.setMapPage(0);
  cm.setMapMode(false);
  // The learn branch CONSUMES the message that binds, so neither value moved.
  check('learning did not write a value', a.value === 0 && b.value === 0,
    `${a.value}/${b.value}`);

  // Returning to page 1 armed pickup for t.a as well — correctly, since the
  // fader could have moved while page 2 was live. Sweep down through t.a's
  // value (0) to pick it up, then drive it to the top.
  cc(21, 0);
  cc(21, 127);
  check('the fader drives page 1 to the top', a.normalized > 0.99, String(a.normalized));

  b.value = 50;                       // t.b sits mid-range; the fader is at the top
  const bWas = b.normalized;
  cm.setMapPage(1);                   // pickup arms for t.b

  cc(21, 120);
  check('a first touch away from the value is SWALLOWED', b.normalized === bWas,
    `${b.normalized} vs ${bWas} — this is the visible glitch pickup exists for`);
  cc(21, 100);
  check('still swallowed while above the value', b.normalized === bWas, String(b.normalized));
  cc(21, 40);
  check('it picks up on the sweep that crosses the value', b.normalized < bWas,
    `${b.normalized} — crossing should release pickup and apply`);
  cc(21, 90);
  check('and follows normally afterwards', Math.abs(b.normalized - 90 / 127) < 0.01,
    String(b.normalized));
  check('page 1 was never disturbed by any of it', a.normalized > 0.99,
    String(a.normalized));
}

console.log('\npickup can be turned off, and never gates a button');
{
  const { ps, cm, cc } = rig();
  const p = ps.get('t.a');
  cm.setMapMode(true); cm.startMIDILearn('t.a'); cc(21, 127); cm.setMapMode(false);
  cm.setMapPage(1);
  cm.setMapMode(true); cm.startMIDILearn('t.a'); cc(21, 0); cm.setMapMode(false);
  ps.set('midi.pickup', 0);
  cm.setMapPage(0);
  cc(21, 100);
  check('with pickup off the value jumps straight there',
    Math.abs(p.normalized - 100 / 127) < 0.01, String(p.normalized));

  // A TOGGLE has no position, so it must act on the first press after a switch.
  const { ps: ps2, cm: cm2, cc: cc2 } = rig();
  ps2.register({ id: 't.tog', label: 'T', group: 'g', type: PARAM_TYPE.TOGGLE, value: 0 });
  cm2.setMapMode(true); cm2.startMIDILearn('t.tog'); cc2(45, 127); cm2.setMapMode(false);
  cm2.setMapPage(1); cm2.setMapPage(0);
  const was = ps2.get('t.tog').value;
  cc2(45, 0); cc2(45, 127);
  check('a button acts on its first press after a page switch',
    ps2.get('t.tog').value !== was,
    'gating a button on pickup makes it look dead until pressed twice');
}

console.log('\npages survive serialization, and a legacy file becomes page 1');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21);
  cm.setMapPage(1);
  cm.startMIDILearn('t.a'); cc(31);
  cm.setMapPage(0);

  const blob = JSON.parse(JSON.stringify(ps.serializeMappings()));
  check('midiPages is persisted', Array.isArray(blob['t.a']?.midiPages),
    JSON.stringify(blob['t.a']));
  check('and values are still stripped', blob['t.a']?.value === undefined,
    'mappings only, never values');

  const fresh = rig();
  fresh.ps.deserializeControllers(blob);
  check('page 1 restores', fresh.ps.get('t.a').midiPages?.[0]?.cc === 21);
  check('page 2 restores', fresh.ps.get('t.a').midiPages?.[1]?.cc === 31);
  fresh.cm.setMapPage(1);
  check('and switching to it works after a reload',
    fresh.ps.get('t.a').controller?.cc === 31,
    JSON.stringify(fresh.ps.get('t.a').controller));

  // A file written before pages existed: one controller, no midiPages.
  const legacy = rig();
  legacy.ps.deserializeControllers({ 't.b': { controller: { type: 'midi-cc', cc: 77, channel: 1 } } });
  check('a legacy binding is seeded into page 1',
    legacy.ps.get('t.b').midiPages?.[0]?.cc === 77,
    JSON.stringify(legacy.ps.get('t.b').midiPages));
  legacy.cm.setMapPage(1);
  check('so page 2 is empty rather than stuck with it',
    legacy.ps.get('t.b').controller == null);
  legacy.cm.setMapPage(0);
  check('and page 1 still has it — no mapping lost to the upgrade',
    legacy.ps.get('t.b').controller?.cc === 77);

  // A non-MIDI controller must NOT be dragged into a page by the migration.
  const lfo = rig();
  lfo.ps.deserializeControllers({ 't.lfo': { controller: { type: 'lfo-sine', hz: 2 } } });
  check('an LFO is not seeded into a page', !lfo.ps.get('t.lfo').midiPages?.some(Boolean),
    JSON.stringify(lfo.ps.get('t.lfo').midiPages));
}

console.log('\nclearing removes bindings from EVERY page, not just the live one');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21);
  cm.setMapPage(1);
  cm.startMIDILearn('t.a'); cc(31);
  cm.startMIDILearn('t.b'); cc(32);
  cm.setMapPage(0);
  ps.get('t.lfo').controller = { type: 'lfo-sine', hz: 1 };
  cm.setMapMode(false);

  const n = cm.clearAllMIDI();
  check('it counts bindings on pages you cannot see', n === 3, `${n} — expected 3`);
  check('the live page is clear', ps.get('t.a').controller == null);
  check('and the page array is empty', !ps.get('t.a').midiPages?.some(Boolean),
    JSON.stringify(ps.get('t.a').midiPages));
  cm.setMapPage(1);
  check('NOTHING COMES BACK on another page', ps.get('t.a').controller == null &&
    ps.get('t.b').controller == null,
    'clearing only `controller` leaves midiPages holding them, so they return');
  cm.setMapPage(0);
  check('the LFO is spared', ps.get('t.lfo').controller?.type === 'lfo-sine');
  check('a second clear reports nothing left', cm.clearAllMIDI() === 0);

  // A page-exempt binding lives in `controller` alone and must count exactly
  // once — the branch that double-counted paged params was here to serve it.
  const ex = rig();
  ex.cm.setPageBinding('midi.pageNext', { type: 'midi-cc', cc: 58, channel: 1 });
  check('an exempt binding counts once', ex.cm.clearAllMIDI() === 1);
  check('and is actually cleared', ex.ps.get('midi.pageNext').controller == null);
}

console.log('\nclearAllAssignments clears pages too — a bank load must leave none');
{
  const { ps, cm, cc } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a'); cc(21);
  cm.setMapPage(1);
  cm.startMIDILearn('t.a'); cc(31);
  cm.setMapPage(0);
  cm.setMapMode(false);

  cm.clearAllAssignments();          // what Preset.js calls when loading a bank
  check('the live binding is gone', ps.get('t.a').controller == null);
  check('and so is the page array', !ps.get('t.a').midiPages?.some(Boolean),
    JSON.stringify(ps.get('t.a').midiPages));
  cm.setMapPage(1);
  check('a page switch after a bank load restores nothing',
    ps.get('t.a').controller == null,
    'stale page bindings would reappear on the new bank, which is the exact ' +
    '"no leftovers from the previous bank" case this call exists for');
}

console.log('\nlearn accepts NOTES — a keyboard could previously learn nothing');
{
  const { ps, cm, note } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.a');
  note(60, 100);
  const c = ps.get('t.a').controller;
  check('a key press binds', c?.type === 'midi-note' && c.note === 60, JSON.stringify(c));
  check('and it re-arms like any other bind', cm.mapMode === true && cm._midiLearnParam === null);

  // A note-OFF (velocity 0) must not bind: it would either double-bind or bind
  // the wrong control on the way up.
  const r2 = rig();
  r2.cm.setMapMode(true);
  r2.cm.startMIDILearn('t.b');
  r2.noteOff(62);
  check('a 0x80 note-off does NOT bind', r2.ps.get('t.b').controller == null,
    JSON.stringify(r2.ps.get('t.b').controller));
  r2.noteOff0(62);
  check('nor does note-on with velocity 0', r2.ps.get('t.b').controller == null,
    JSON.stringify(r2.ps.get('t.b').controller));
  check('and the arm is still waiting for a real press', r2.cm._midiLearnParam === 't.b');
  r2.note(62, 90);
  check('which the next real press satisfies', r2.ps.get('t.b').controller?.note === 62,
    JSON.stringify(r2.ps.get('t.b').controller));
}

console.log('\nsequential option learn: one key per option, in one pass');
{
  const { ps, cm, note } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.slot', 0, null, true);
  check('it arms option 0', cm._midiLearnOption === 0);

  for (let i = 0; i < 16; i++) note(36 + i, 100);
  const c = ps.get('t.slot').controller;
  check('all sixteen options bound', c?.type === 'midi-cc-map' &&
    c.notes.filter((n) => n != null).length === 16, JSON.stringify(c?.notes));
  check('in order', c?.notes?.[0] === 36 && c?.notes?.[15] === 51, JSON.stringify(c?.notes));
  check('the walk ended by itself at the last option', cm._midiLearnParam === null,
    'it must disarm at the end, not wrap and overwrite option 0');
  check('and map mode survived the whole pass', cm.mapMode === true);

  // Dispatch: which KEY spoke picks the option.
  note(38, 100);
  check('pressing the third key selects option 2', ps.get('t.slot').value === 2,
    String(ps.get('t.slot').value));
  note(51, 100);
  check('and the sixteenth selects option 15', ps.get('t.slot').value === 15,
    String(ps.get('t.slot').value));
}

console.log('\nnotes and CCs coexist in one option map');
{
  const { ps, cm, cc, note } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.sel', 0); note(60);
  cm.startMIDILearn('t.sel', 1); cc(70);
  const c = ps.get('t.sel').controller;
  check('option 0 took the note', c?.notes?.[0] === 60, JSON.stringify(c?.notes));
  check('option 1 took the CC', c?.ccs?.[1] === 70, JSON.stringify(c?.ccs));
  check('neither claimed the other slot', c?.ccs?.[0] == null && c?.notes?.[1] == null,
    JSON.stringify({ ccs: c?.ccs, notes: c?.notes }));
  note(60); check('the note drives option 0', ps.get('t.sel').value === 0);
  cc(70);   check('the CC drives option 1',   ps.get('t.sel').value === 1);

  // Re-learning an option from note to CC must release the note, or it answers
  // to both controls for ever.
  cm.startMIDILearn('t.sel', 0); cc(71);
  const c2 = ps.get('t.sel').controller;
  check('re-learning to a CC releases the note', c2?.notes?.[0] == null && c2?.ccs?.[0] === 71,
    JSON.stringify({ ccs: c2?.ccs, notes: c2?.notes }));
  ps.get('t.sel').value = 3;
  note(60);
  check('the old note no longer selects it', ps.get('t.sel').value === 3,
    String(ps.get('t.sel').value));
}

console.log('\nthe monitor names note-mapped options too');
{
  const { ps, cm, note } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.slot', 0, null, true);
  note(36); note(37);
  cm.cancelMIDILearn();
  const ix = cm.buildMidiBindIndex();
  const b = cm.midiBindingsFor({ type: 0x90, channel: 1, num: 36 }, ix);
  check('a note-mapped option resolves', b.length === 1, JSON.stringify(b));
  check('and names which option', b[0]?.includes('[0]') === true, String(b[0]));
}

console.log('\na note-mapped option LOOKS mapped — a working binding must not read as absent');
{
  const { ps, cm, cc, note } = rig();
  cm.setMapMode(true);
  cm.startMIDILearn('t.sel', 0); note(60);
  check('the badge does not claim zero', ps.get('t.sel').controllerLabel !== '1:CC×0',
    `"${ps.get('t.sel').controllerLabel}" — counting only ccs reports CC×0 for a ` +
    'fully note-mapped SELECT, which reads as nothing bound');
  check('it counts the note', /N×1/.test(ps.get('t.sel').controllerLabel),
    ps.get('t.sel').controllerLabel);

  cm.startMIDILearn('t.sel', 1); cc(70);
  check('a mixed map names both', /CC×1\+N×1/.test(ps.get('t.sel').controllerLabel),
    ps.get('t.sel').controllerLabel);

  const { ps: p2, cm: c2, cc: cc2 } = rig();
  c2.setMapMode(true);
  c2.startMIDILearn('t.sel', 0); cc2(70);
  check('a CC-only map still reads as it always did', /CC×1/.test(p2.get('t.sel').controllerLabel) &&
    !/N×/.test(p2.get('t.sel').controllerLabel), p2.get('t.sel').controllerLabel);
}

if (failures) {
  console.error(
    `\n${failures} FAILURE(S)\n\n` +
    'Map mode is a LATCH. `cancelMIDILearn()` clears the target and must never\n' +
    'touch `_mapMode` — that is what makes a bind re-arm rather than exit. If a\n' +
    'bind starts exiting the mode, the feature silently reverts to the one-shot\n' +
    'learn it was built to replace, and nothing in the UI says so.\n'
  );
  process.exit(1);
}
console.log('\nAll MIDI map-mode checks passed.');
