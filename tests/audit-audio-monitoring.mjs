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

/**
 * `ControllerManager`'s constructor binds a keydown listener, so it needs these
 * two before it can be imported — which is worth the two lines, because it makes
 * the assignment paths testable by OUTCOME instead of by reading their source.
 * Two earlier attempts to census the writers with a regex were both wrong (a
 * negative lookahead behind `\s*` backtracks; a `^\s*` anchor misses a write
 * that follows `if (...)` on the same line), and formatting cannot fool this.
 */
globalThis.window = { addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  addEventListener() {}, removeEventListener() {}, getElementById() { return null; },
};
const { ControllerManager } = await import('../src/controls/ControllerManager.js');

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

  /**
   * That `assign()` refuses is asserted BEHAVIOURALLY in the next section; only
   * the guard's POSITION needs the source, because placing it after the cleanup
   * would be indistinguishable by outcome (a setup act can never hold a
   * controller, so there is never anything for `_removeController` to remove).
   *
   * Two earlier versions of this check were wrong about the file rather than
   * about the code: one measured a bounded character distance from the signature,
   * so lengthening the comment above the guard turned it red; the next assumed
   * `assign` appears before `assignX`, and it does not. Anchor on the one
   * relationship that is actually claimed and nothing else.
   */
  const cm = read('src/controls/ControllerManager.js');
  const assignIdx = cm.indexOf('assign(paramId, controllerConfig) {');
  const setupIdx = cm.indexOf('if (p.setup)', assignIdx);
  const removeIdx = cm.indexOf('_removeController(paramId)', assignIdx);
  check('assign() refuses BEFORE it tries to remove anything',
    assignIdx > 0 && setupIdx > assignIdx && removeIdx > assignIdx
      && setupIdx < removeIdx,
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
    // Not `classList.add(...)` — that named one of at least four ways to set
    // the same class, and `classList.toggle` walked straight past it. The class
    // is the getter's to decide, so the builder must not mention it AT ALL.
    !/param-ctrl-setup/.test(row),
    'updateDisplay() would drop it on the first refresh');

  const ui = read('src/ui/UI.js');
  check('the context menu does not open for a setup act',
    /show\(param, x, y\) \{[\s\S]{0,400}?if \(param\?\.setup\) return;/.test(ui),
    'a menu of controller types that all silently no-op reads as a broken feature');
}

// ═══════════════════════════════════════════════════════════════════════════
console.log('\nEVERY writer of a controller respects it — there is no choke point');
{
  /**
   * Step 10 claimed `assign()` was "the one function every assignment path
   * reaches". It was not, and the claim is the finding: two more writers put a
   * controller onto a parameter without going near it — `assignX()` for the
   * controller-of-controller layer, and `Parameter.deserialize()` for a file.
   *
   * So the invariant cannot be held at one place. It is held by covering every
   * WRITER, and this section is what keeps that true: a census, so a fourth
   * writer added by someone who never read the comments fails here.
   */
  const p = ps.get('audio.monitor');

  // The file path, tested behaviourally rather than by reading the source —
  // this is the one an actual `.imweb` or `.imbank` exercises.
  const before = p.value;
  p.deserialize({
    value: MONITOR.HEADPHONES,
    controller: { type: 'lfo-sine', hz: 2 },
    xControllers: [{ type: 'lfo-tri', hz: 0.5 }],
    table: 'scurve', invert: true,
  });
  check('a file cannot attach a controller to a setup act',
    p.controller === null,
    `controller is ${JSON.stringify(p.controller)} — a saved project would reattach it on load`);
  check('a file cannot attach an xController either',
    (p.xControllers ?? []).every((x) => !x),
    `${JSON.stringify(p.xControllers)} — rebuildXControllers would instantiate a live LFO`);
  check('and a file cannot set its VALUE',
    p.value === before,
    `${MONITOR_MODES[p.value]} — a project authored on headphones must not silence `
    + 'the loop warning at a venue on a PA');

  // A non-setup param must still restore everything, or the guard is a
  // regression dressed as a fix.
  const ok = ps.get('aplay.rate');
  ok.deserialize({ value: 0.5, controller: { type: 'lfo-sine', hz: 2 } });
  check('an ordinary param still restores its controller and value',
    ok.value === 0.5 && ok.controller?.type === 'lfo-sine',
    `${ok.value}, ${JSON.stringify(ok.controller)}`);

  /**
   * The other two writers, tested by OUTCOME rather than by reading the source.
   *
   * The first version of this counted assignment lines with a regex and was
   * wrong twice in a row — once because a negative lookahead behind `\s*`
   * backtracks and let every `= null` through, once because `this.controller =`
   * sits after an `if (...)` on the same line and defeated a `^\s*` anchor.
   * Source-text census is the wrong tool: `ControllerManager` imports cleanly in
   * Node, so what the functions DO is directly observable and cannot be fooled
   * by formatting.
   */
  const cmgr = new ControllerManager(ps);
  cmgr.assign('audio.monitor', { type: 'lfo-sine', hz: 2 });
  check('assign() attaches nothing to a setup act', p.controller === null,
    `controller is ${JSON.stringify(p.controller)}`);
  cmgr.assignX('audio.monitor', 0, { type: 'lfo-tri', hz: 0.5 });
  check('assignX() attaches nothing either',
    (p.xControllers ?? []).every((x) => !x),
    `${JSON.stringify(p.xControllers)} — an xController drives the param just as surely`);

  // The reader that instantiates live LFOs from whatever the writers left.
  // Deliberately UNGUARDED (see the comment there): with every writer refusing,
  // a guard here could not fire, and CLAUDE.md's rule is to cover the writers
  // rather than add a check that is dead by construction. This asserts the
  // consequence — that the reader finds nothing to build.
  p.xControllers = [{ type: 'lfo-sine', hz: 3 }];   // force the hostile state
  cmgr.rebuildXControllers();
  const built = cmgr._xLFOs.has('audio.monitor:0');
  p.xControllers = [];
  check('rebuildXControllers is only safe because the writers are guarded', built,
    'if this ever goes false the reader gained its own guard — which means a '
    + 'writer stopped being covered, or the dead-guard reasoning changed');

  // And the guards must not have broken ordinary parameters.
  cmgr.assign('aplay.len', { type: 'lfo-sine', hz: 2 });
  check('an ordinary param still accepts a controller',
    ps.get('aplay.len').controller?.type === 'lfo-sine',
    JSON.stringify(ps.get('aplay.len').controller));
  cmgr.assignX('aplay.len', 0, { type: 'lfo-tri', hz: 0.5 });
  check('and still accepts an xController',
    ps.get('aplay.len').xControllers?.[0]?.type === 'lfo-tri',
    JSON.stringify(ps.get('aplay.len').xControllers));
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
