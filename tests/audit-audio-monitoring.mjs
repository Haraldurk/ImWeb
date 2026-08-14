/**
 * The monitoring path (§8.6) — and specifically the two rules §8.6 bothered to
 * write down because it expected them to drift.
 *
 * > *"a switch that changes defaults is exactly the kind of control that drifts
 * > into being controller-assignable when nobody records that it must not be"*
 *
 * That sentence is the reason this file exists. Before step 10 the rule was
 * unenforceable — nothing in `ParameterSystem` could express "takes no
 * controller", so the prose was the only thing holding it, and prose does not
 * fail a build. The `setup` flag is the rule; these checks are what keep the
 * flag from quietly stopping being honoured.
 *
 * The hazard is not hypothetical and not only a developer one: an LFO on the
 * monitoring switch is a performer's feedback exposure being swept at 2 Hz.
 *
 * Run:  node tests/audit-audio-monitoring.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  ParameterSystem, registerCoreParameters, MONITOR, MONITOR_MODES, PARAM_TYPE,
} from '../src/controls/ParameterSystem.js';
import { AUDIO_TARGETS } from '../src/audio/ctrl-handoff.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const ps = new ParameterSystem();
registerCoreParameters(ps);

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe two lists that say what a monitoring mode is');
{
  check('MONITOR_MODES and MONITOR agree on which index is which',
    MONITOR_MODES[MONITOR.HEADPHONES] === 'Headphones'
      && MONITOR_MODES[MONITOR.SPEAKERS] === 'Speakers',
    `${MONITOR_MODES.join(',')} vs headphones=${MONITOR.HEADPHONES}, speakers=${MONITOR.SPEAKERS}`);
  check('there are exactly two modes', MONITOR_MODES.length === 2,
    `${MONITOR_MODES.length} — a third would need its own loop semantics, not just a label`);

  const p = ps.get('audio.monitor');
  check('audio.monitor is registered', !!p);
  check('its options come from the one list',
    p.options.length === MONITOR_MODES.length
      && p.options.every((o, i) => o === MONITOR_MODES[i]),
    `${p.options?.join(',')}`);
  check('it is a SELECT', p.type === PARAM_TYPE.SELECT, p.type);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nit is a setup act: not captured, and never a controller target');
{
  const p = ps.get('audio.monitor');
  // §8.6 puts it with partition layout — fixed at session start, excluded from
  // Display State capture. `captureState` skips group 'global' (§4.8), so the
  // check is against the real mechanism rather than against the group string.
  check("group is 'global'", p.group === 'global', p.group);
  const captured = ps.captureState();
  check('a Display State does not capture it', !('audio.monitor' in captured),
    'a recall would change the performer\'s feedback exposure behind their back');

  check('setup is true', p.setup === true, String(p.setup));

  // The rule that had no teeth before. AUDIO_TARGETS is the worklet-resident
  // controller list; the engine refuses anything absent from its own resolver,
  // so this is the client half of "never a controller target".
  check('it is not a worklet controller target',
    !AUDIO_TARGETS.some((t) => t.id === 'audio.monitor'),
    'a §8.7 hand-off would sweep it at audio rate');

  // And the client-side path, which is the one a user reaches.
  const cm = read('src/controls/ControllerManager.js');
  check('ControllerManager.assign refuses a setup act',
    /assign\(paramId, controllerConfig\)[\s\S]{0,900}?if \(p\.setup\)[\s\S]{0,200}?return;/.test(cm),
    'assign() is the choke point every path reaches — badge, menu, MIDI, a loaded file');
  const assignIdx = cm.indexOf('assign(paramId, controllerConfig)');
  const setupIdx = cm.indexOf('if (p.setup)', assignIdx);
  const removeIdx = cm.indexOf('_removeController(paramId)', assignIdx);
  check('and refuses BEFORE it tries to remove anything',
    setupIdx > 0 && removeIdx > 0 && setupIdx < removeIdx,
    'there is nothing to remove from a parameter nothing could attach to');

  // The badge has to READ as inert, and the dimming must survive a refresh:
  // `updateDisplay()` rewrites `className` wholesale from `controllerClass`, so a
  // class added beside it in the row builder lasted until the first redraw and
  // then vanished. That is how this shipped broken the first time.
  check('a setup act reports an inert badge class',
    ps.get('audio.monitor').controllerClass === 'param-ctrl-setup',
    `'${ps.get('audio.monitor').controllerClass}'`);
  check('an ordinary unassigned param reports none',
    ps.get('audio.outGain').controllerClass === '',
    `'${ps.get('audio.outGain').controllerClass}'`);
  const row = read('src/ui/components/ParamRow.js');
  check('the row builder does not add the class outside that getter',
    !/classList\.add\('param-ctrl-setup'\)/.test(row),
    'updateDisplay() would drop it on the first refresh');

  const ui = read('src/ui/UI.js');
  check('the context menu does not open for a setup act',
    /show\(param, x, y\) \{[\s\S]{0,400}?if \(param\?\.setup\) return;/.test(ui),
    'a menu of controller types that all silently no-op reads as a broken feature');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe flag means "no controller", not "not captured"');
{
  // The distinction that stops `setup` becoming a synonym for 'global' and being
  // applied by habit to everything in that group.
  const globals = ps.getAll().filter((p) => p.group === 'global');
  check('there are many global params', globals.length > 10, `${globals.length}`);
  const setups = globals.filter((p) => p.setup);
  check('but only the monitoring switch is a setup act so far',
    setups.length === 1 && setups[0].id === 'audio.monitor',
    setups.map((p) => p.id).join(',') || 'none');
  check('audio.tapeSec is global and NOT setup', ps.get('audio.tapeSec').setup === false,
    'sweeping it is useless, not a hazard — the flag is for hazards');
  check('an ordinary param defaults to not-setup',
    ps.get('aplay.rate').setup === false);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe default assumes the loop is closed');
{
  const p = ps.get('audio.monitor');
  check('the default is Speakers', p.value === MONITOR.SPEAKERS,
    `${MONITOR_MODES[p.value]} — guessing headphones suppresses the one warning `
    + 'that matters on the setup where it matters');
  // Same principle as `audio.tapSrc` defaulting to mic-only: the safe state must
  // require no selection from the performer.
  check('and the mic is off by default, so nothing is live until asked for',
    ps.get('audio.mic').value === 0);
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe loop is reported as a condition, not as an event');
{
  const ab = read('src/audio/AudioBinding.js');
  check('_loopLive requires the engine running, the device open, and speakers',
    /_loopLive\(\) \{[\s\S]{0,300}?this\.running[\s\S]{0,120}?this\.engine\.micOpen[\s\S]{0,200}?MONITOR\.SPEAKERS/.test(ab),
    'all three: an open mic with no output is an input, not a loop');
  check('it asks the DEVICE, not the mic param',
    /_loopLive\(\)[\s\S]{0,300}?this\.engine\.micOpen/.test(ab)
      && !/_loopLive\(\)[\s\S]{0,300}?get\('audio\.mic'\)/.test(ab),
    "`_applyTap` opens the device directly and the param catches up after — "
    + 'reading the param misses the window where the loop first exists');

  // Every edge that can change the answer has to publish it, or the indicator
  // is stale exactly when it matters. Counted rather than named, so adding an
  // edge without publishing shows up here.
  const refreshes = (ab.match(/this\._refreshLoop\(\)/g) ?? []).length;
  check('every edge that can change the answer publishes it', refreshes >= 6,
    `${refreshes} call sites — monitor switch, mic open, mic close, tap-opens-mic, `
    + 'engine start, engine stop');

  // Declared AND invoked. Checking only for the identifier passed with the call
  // site renamed away, because the `= null` declaration alone satisfied it —
  // a channel nothing writes to is exactly the failure this pins.
  check('the loop has its own channel, separate from the status line',
    /onLoopState = null/.test(ab)
      && /_refreshLoop\(\) \{[\s\S]{0,220}?this\.onLoopState\?\.\(/.test(ab),
    'a status line scrolls away; a loop persists until something changes it');

  const main = read('src/main.js');
  check('and something is actually listening', /audio\.onLoopState = /.test(main));
  check('the warning names the whole closed path',
    /mic → tape → \$\{monitorLabel/.test(main),
    'the point of drawing a loop is seeing WHICH link to open');

  const html = read('index.html');
  check('the element it writes into exists', /id="audio-loop-warning"/.test(html));
  check('and starts hidden', /id="audio-loop-warning"[^>]*class="[^"]*hidden/.test(html),
    'a warning visible before anything is live teaches people to ignore it');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nthe old unconditional advice is gone');
{
  const ab = read('src/audio/AudioBinding.js');
  // Matches the CALL, not the words. A bare `/USE HEADPHONES/` also matched the
  // comment recording why it was removed, so the check went red for the presence
  // of its own explanation — a test that forbids talking about the bug it pins.
  check('"USE HEADPHONES" is no longer said regardless of the answer',
    !/_say\([^)]*USE HEADPHONES/.test(ab),
    'it was advice rather than information, and wrong half the time');
  check('the mic message is conditional on the loop',
    /_loopLive\(\) \? 'mic open — the room loop is LIVE' : 'mic open'/.test(ab));
}

console.log(
  failures === 0 ? '\nAll monitoring-path checks passed.' : `\n${failures} FAILURE(S)`,
);
process.exit(failures ? 1 : 0);
