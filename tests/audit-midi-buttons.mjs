/**
 * MIDI buttons — press/release edges, and one control per SELECT option.
 *
 * The bug this was written for: a hardware button is MOMENTARY. A Korg
 * nanoKONTROL2 sends CC 127 on press and CC 0 on RELEASE, and the CC path fed
 * both straight into `setNormalized`. On a TOGGLE that meant press → on,
 * release → off, so Run Rec only recorded while the button was held. On a
 * TRIGGER it fired TWICE per press, because the value setter fires trigger
 * listeners on every set regardless of `changed`. The owner reported it as
 * "it bangs, but bangs again when released", which is exactly what it did.
 *
 * What makes it worth an audit rather than a fix: **the other two button paths
 * were already right.** `midi-note` guards with `if (data2 > 0)` and the
 * gamepad tracks `_gamepadBtnPrev` for a rising edge. MIDI CC was the only
 * input that never got one, and nothing compared them — so the next input path
 * can be added with the same hole and no test will notice. These assertions are
 * about the RULE (a button is not a fader), not about one controller.
 *
 * Run:  node tests/audit-midi-buttons.mjs
 */

import { ParameterSystem, PARAM_TYPE } from '../src/controls/ParameterSystem.js';

// The manager touches both on construction; neither exists in Node.
globalThis.navigator ??= {};
globalThis.document ??= {
  getElementById: () => null,
  querySelectorAll: () => [],
  addEventListener: () => {},
};
globalThis.window ??= { addEventListener: () => {} };

const { ControllerManager } = await import('../src/controls/ControllerManager.js');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) console.log(`  ok   ${label}`);
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

/** A ControllerManager with a fake MIDI input wired to its real handler. */
function rig() {
  const ps = new ParameterSystem();
  ps.register({ id: 't.tog',  label: 'T', group: 'g', type: PARAM_TYPE.TOGGLE, value: 0 });
  ps.register({ id: 't.trig', label: 'R', group: 'g', type: PARAM_TYPE.TRIGGER });
  ps.register({ id: 't.cont', label: 'C', group: 'g', min: 0, max: 100, value: 0 });
  ps.register({ id: 't.sel',  label: 'S', group: 'g', type: PARAM_TYPE.SELECT, value: 0,
    options: ['P0', 'P1', 'P2', 'P3'] });
  const cm = new ControllerManager(ps);
  const input = {};
  cm._attachMIDIInput(input);
  // channel 1 = status 0xB0
  const cc = (num, val, ch = 1) => input.onmidimessage({ data: [0xB0 | (ch - 1), num, val] });
  return { ps, cm, input, cc };
}

console.log('\na CC button on a TOGGLE latches — press acts, release does not');
{
  const { ps, cc } = rig();
  const p = ps.get('t.tog');
  p.controller = { type: 'midi-cc', cc: 45, channel: 1 };

  cc(45, 127);
  check('press turns it on', p.value === 1, String(p.value));
  cc(45, 0);
  check('RELEASE LEAVES IT ON', p.value === 1,
    `${p.value} — the release turned it back off, so it only runs while held`);
  cc(45, 127);
  check('a second press turns it off', p.value === 0, String(p.value));
  cc(45, 0);
  check('and its release leaves it off', p.value === 0, String(p.value));
}

console.log('\na CC button on a TRIGGER fires once per press');
{
  const { ps, cc } = rig();
  const p = ps.get('t.trig');
  p.controller = { type: 'midi-cc', cc: 45, channel: 1 };
  let fires = 0;
  p.onChange(() => fires++);

  cc(45, 127);
  check('press fires once', fires === 1, `${fires} fires`);
  cc(45, 0);
  check('RELEASE DOES NOT FIRE AGAIN', fires === 1, `${fires} fires — the second bang`);
  cc(45, 127);
  check('the next press fires again', fires === 2, `${fires} fires`);
}

console.log('\na CC knob on a CONTINUOUS param is untouched by any of this');
{
  const { ps, cc } = rig();
  const p = ps.get('t.cont');
  p.controller = { type: 'midi-cc', cc: 20, channel: 1 };

  cc(20, 127);
  check('full scale reaches max', p.value === 100, String(p.value));
  cc(20, 64);
  check('a mid value is followed, not edge-gated',
    Math.abs(p.value - 50.4) < 0.5, String(p.value));
  cc(20, 0);
  check('zero reaches min — a fader may legitimately return to 0',
    p.value === 0, String(p.value));
}

console.log('\none CC per SELECT option (the nanoKONTROL2 has no pads)');
{
  const { ps, cc } = rig();
  const p = ps.get('t.sel');
  p.controller = { type: 'midi-cc-map', ccs: [32, 33, 34, 35], channel: 1 };

  cc(34, 127);
  check('the button mapped to P2 selects P2', p.value === 2, `P${p.value}`);
  cc(34, 0);
  check('its release selects nothing', p.value === 2, `P${p.value}`);

  // THE case the rising edge is actually for, and the one a same-button
  // press/release cannot show: releasing button A after B has been pressed
  // re-selects A's option and steals the selection back. Mutation calibration
  // caught this — dropping the edge guard passed every other assertion here,
  // because re-selecting the option you are already on is invisible.
  cc(32, 127);                                  // hold P0
  cc(35, 127);                                  // then press P3
  check('pressing a second button moves the selection', p.value === 3, `P${p.value}`);
  cc(32, 0);                                    // now release the FIRST one
  check('releasing a still-held earlier button does NOT steal it back',
    p.value === 3, `P${p.value} — the release re-selected the button being let go`);
  cc(35, 0);

  cc(32, 127);
  check('another button selects its own option', p.value === 0, `P${p.value}`);
  cc(99, 127);
  check('an unmapped CC does nothing', p.value === 0, `P${p.value}`);
  // The old whole-param behaviour chose the index by VALUE. If a map ever fell
  // back to that, a half-pressed button would land on a different partition.
  cc(35, 64);
  check('a mapped button at half value still selects ITS option, not by value',
    p.value === 3, `P${p.value}`);
}

console.log('\nedges belong to the control, not the parameter');
{
  const { ps, cc } = rig();
  const a = ps.get('t.tog');
  const b = ps.get('t.trig');
  a.controller = { type: 'midi-cc', cc: 45, channel: 1 };
  b.controller = { type: 'midi-cc', cc: 45, channel: 1 };
  let fires = 0;
  b.onChange(() => fires++);

  cc(45, 127);
  check('both params on one CC see the same press',
    a.value === 1 && fires === 1, `toggle ${a.value}, trigger ${fires}`);
  cc(45, 0);
  check('and both ignore the same release',
    a.value === 1 && fires === 1, `toggle ${a.value}, trigger ${fires}`);
}

console.log('\nchannel filtering still applies');
{
  const { ps, cc } = rig();
  const p = ps.get('t.tog');
  p.controller = { type: 'midi-cc', cc: 45, channel: 2 };
  cc(45, 127, 1);
  check('a press on the wrong channel is ignored', p.value === 0, String(p.value));
  cc(45, 127, 2);
  check('a press on the right channel acts', p.value === 1, String(p.value));
}

console.log('\nlearning one option at a time');
{
  const { ps, cm, cc } = rig();
  const p = ps.get('t.sel');

  cm.startMIDILearn('t.sel', 1);
  cc(33, 127);
  check('learning option 1 builds a map', p.controller?.type === 'midi-cc-map',
    p.controller?.type);
  check('the learned CC lands in the right slot',
    JSON.stringify(p.controller.ccs) === JSON.stringify([null, 33, null, null]),
    JSON.stringify(p.controller.ccs));

  cm.startMIDILearn('t.sel', 3);
  cc(35, 127);
  check('learning a SECOND option keeps the first',
    JSON.stringify(p.controller.ccs) === JSON.stringify([null, 33, null, 35]),
    JSON.stringify(p.controller.ccs));

  // Re-learning a CC that already drives another option must MOVE it. Leaving
  // it in both makes one button select two partitions, last writer winning.
  cm.startMIDILearn('t.sel', 0);
  cc(33, 127);
  check('re-using a CC moves it rather than duplicating',
    JSON.stringify(p.controller.ccs) === JSON.stringify([33, null, null, 35]),
    JSON.stringify(p.controller.ccs));

  const done = [];
  cm.startMIDILearn('t.sel', 2, () => done.push(1));
  cc(34, 127);
  check('the learn callback fires so the row can repaint', done.length === 1,
    `${done.length} calls`);
  check('learn state is cleared after a bind',
    cm._midiLearnParam === null && cm._midiLearnOption === null,
    `${cm._midiLearnParam} / ${cm._midiLearnOption}`);
}

console.log('\nlearning the whole parameter still works as before');
{
  const { ps, cm, cc } = rig();
  cm.startMIDILearn('t.cont');
  cc(21, 100);
  const c = ps.get('t.cont').controller;
  check('a plain learn still makes a midi-cc', c?.type === 'midi-cc', c?.type);
  check('with the CC it heard', c?.cc === 21, String(c?.cc));
}

console.log('\nthe map survives a save/load round trip');
{
  const { ps } = rig();
  const p = ps.get('t.sel');
  p.controller = { type: 'midi-cc-map', ccs: [32, null, 34, 35], channel: 1 };
  const json = JSON.parse(JSON.stringify(ps.serializeControllers()));
  const fresh = rig().ps;
  fresh.deserializeControllers(json);
  const c = fresh.get('t.sel').controller;
  check('the map comes back intact',
    c?.type === 'midi-cc-map' && JSON.stringify(c.ccs) === JSON.stringify([32, null, 34, 35]),
    JSON.stringify(c));
}

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll MIDI button checks passed.\n');
process.exit(failures ? 1 : 0);
