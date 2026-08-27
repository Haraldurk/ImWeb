/**
 * Movie deck Pos-branch audit.
 *
 * Why this exists. MovieInput.tick() resolves MoviePos down one of three
 * mutually exclusive paths, and which one runs must depend on exactly one
 * thing each:
 *
 *   SlideRange on            → Pos moves the WINDOW; Start/End follow it.
 *   else a controller on Pos → pos-drive; the deck is paused and Pos owns
 *                              the scrub, bypassing MovieSpeed and MovieLoop.
 *   else                     → manual; Pos scrubs on change, and a Start/End
 *                              move only recovers a head left OUTSIDE the
 *                              window.
 *
 * The failure mode is silent because pos-drive and the manual scrub compute
 * the SAME expression — `startT + pos/100 * range`. Feed them the same inputs
 * and they return the same number, so from the outside the wrong branch looks
 * like the right one. That is not hypothetical: the clamp behaviour these
 * branches implement was first "verified" in a browser against the
 * MasterProject, which carries an lfo-sawtooth controller on movie.pos. Every
 * tick took pos-drive, the numbers came back exactly as predicted, and the
 * manual path under test had never executed once. It surfaced only because a
 * playhead parked mid-window kept being moved by an idle tick that no branch
 * should have touched.
 *
 * So the branches are separated here by a side effect that DIFFERS, never by
 * the seek result that does not:
 *
 *   - pos-drive pauses the deck and re-seeks every tick, even when nothing
 *     changed. It ignores MovieSpeed.
 *   - the manual path honours MovieSpeed (it plays), and leaves an unchanged
 *     Pos alone on an idle tick.
 *
 * An idle tick with the head parked strictly inside the window is therefore
 * the discriminator, and it is the check that would have caught the bad
 * verification run immediately.
 *
 * This cannot be a runtime check: tick() is a per-frame hot path that must not
 * throw, and the three paths are correct code — the bug is taking the wrong
 * one, which only a test can assert.
 *
 * Run:  node tests/audit-movie-pos-branches.mjs
 */

import { ParameterSystem, registerCoreParameters } from '../src/controls/ParameterSystem.js';
import { MovieInput } from '../src/inputs/MovieInput.js';

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const CLIP_SECONDS = 10;

/**
 * A <video> stand-in. tick() only ever reads/writes these, so the real branch
 * logic runs unmodified — this is not a reimplementation of it.
 */
function makeVideo() {
  return {
    currentTime: 0,
    playbackRate: 1,
    paused: true,
    ended: false,
    readyState: 4,
    HAVE_CURRENT_DATA: 2,
    playCalls: 0,
    pauseCalls: 0,
    play() { this.playCalls++; this.paused = false; return Promise.resolve(); },
    pause() { this.pauseCalls++; this.paused = true; },
  };
}

function makeDeck() {
  const ps = new ParameterSystem();
  registerCoreParameters(ps);
  const deck = new MovieInput('movie');
  const video = makeVideo();
  deck.clips = [{
    name: 'fixture', url: 'fixture', video,
    duration: CLIP_SECONDS,
    texture: { needsUpdate: false },
    _lastUploadT: -1,
  }];
  deck._current = 0;
  deck.active = true;
  // A deck at rest: full window, no slide, playing forward.
  ps.set('movie.active', 1);
  ps.set('movie.speed', 1);
  ps.set('movie.loop', 0);
  ps.set('movie.bpmsync', 0);
  ps.set('movie.posslide', 0);
  ps.set('movie.start', 0);
  ps.set('movie.end', 100);
  ps.set('movie.pos', 0);
  const tick = () => deck.tick(ps, 0, 1 / 60, false);
  return { ps, deck, video, tick };
}

// ── 1. No controller on Pos → the manual path ────────────────────────────────
console.log('\nManual path (no controller on MoviePos)');
{
  const { ps, video, tick } = makeDeck();
  tick(); // settle: the first tick consumes the initial pos change
  check('honours MovieSpeed — the deck plays rather than being force-paused',
    !video.paused, `paused=${video.paused}`);

  // THE DISCRIMINATOR. Park the head strictly inside the window and tick with
  // nothing changed. The manual path must not touch it; pos-drive would drag
  // it back to startT + pos/100*range = 0.
  video.currentTime = 5;
  tick();
  check('an idle tick leaves a parked head alone',
    video.currentTime === 5,
    `head moved to ${video.currentTime} — pos-drive ran instead of the manual path`);

  // Pos still scrubs when it actually moves.
  ps.set('movie.pos', 50);
  tick();
  check('moving Pos still scrubs to the fraction it names',
    Math.abs(video.currentTime - 5) < 1e-9, `got ${video.currentTime}, want 5`);

  // A trim that does not reach the head must not move it.
  video.currentTime = 5;
  ps.set('movie.start', 20); // 2s — head at 5s is still inside
  tick();
  check('a trim that does not reach the head leaves it playing',
    video.currentTime === 5,
    `head moved to ${video.currentTime}; only a trim PAST the head may move it`);

  // A trim that passes the head must step it back to the nearest edge.
  ps.set('movie.start', 60); // 6s — now past the head
  tick();
  check('a trim past the head steps it to the nearest edge',
    Math.abs(video.currentTime - 6) < 1e-9, `got ${video.currentTime}, want 6`);
}

// ── 2. Controller on Pos → pos-drive ─────────────────────────────────────────
console.log('\nPos-drive path (controller on MoviePos)');
{
  const { ps, video, tick } = makeDeck();
  ps.get('movie.pos').controller = { type: 'lfo', shape: 'sawtooth' };
  ps.set('movie.pos', 50);
  tick();
  check('pauses the deck — MovieSpeed is bypassed',
    video.paused, `paused=${video.paused}; speed=${ps.get('movie.speed').value} must not play`);
  check('seeks to the Pos fraction',
    Math.abs(video.currentTime - 5) < 1e-9, `got ${video.currentTime}, want 5`);

  // The mirror of the discriminator: pos-drive OWNS the head, so an idle tick
  // must drag a displaced head back. If this stops holding, pos-drive has
  // silently become the manual path.
  video.currentTime = 8;
  tick();
  check('an idle tick re-asserts the Pos fraction (pos-drive owns the head)',
    Math.abs(video.currentTime - 5) < 1e-9,
    `head left at ${video.currentTime}; the controller no longer owns the scrub`);
}

// ── 3. SlideRange wins over a controller ─────────────────────────────────────
// The mode exists so a controller on Pos can sweep the WINDOW. If pos-drive
// were tested first, an LFO would pause the deck and scrub inside a window
// that never moved — the mode would be dead for its main use.
console.log('\nSlideRange (takes precedence over pos-drive)');
{
  const { ps, video, tick } = makeDeck();
  ps.get('movie.pos').controller = { type: 'lfo', shape: 'sawtooth' };
  ps.set('movie.posslide', 1);
  ps.set('movie.start', 10);
  ps.set('movie.end', 12); // a 2% window
  ps.set('movie.pos', 50);
  tick();
  const start = ps.get('movie.start').value;
  const end = ps.get('movie.end').value;
  check('a controller on Pos moves the WINDOW, not the head within it',
    Math.abs(start - 50) < 1e-9, `start=${start}, want 50 — pos-drive claimed the tick`);
  check('the window keeps its length while sliding',
    Math.abs((end - start) - 2) < 1e-9, `length=${(end - start).toFixed(4)}, want 2`);
  check('the deck is not force-paused by pos-drive in slide mode',
    !video.paused, 'slide mode must fall through to normal speed/loop playback');

  // Length wins over position at the tail.
  ps.set('movie.pos', 99);
  tick();
  const s2 = ps.get('movie.start').value;
  const e2 = ps.get('movie.end').value;
  check('near the tail the window slides back rather than being squashed',
    Math.abs(s2 - 98) < 1e-9 && Math.abs(e2 - 100) < 1e-9,
    `got ${s2}-${e2}, want 98-100`);
}

// ── 4. The branches are genuinely exclusive ──────────────────────────────────
// Stated as a relationship rather than a re-test: whatever the inputs, exactly
// one of the three behaviours may be observable on a single tick.
console.log('\nExclusivity');
{
  const cases = [
    { slide: 0, ctrl: false, want: 'manual' },
    { slide: 0, ctrl: true, want: 'pos-drive' },
    { slide: 1, ctrl: false, want: 'slide' },
    { slide: 1, ctrl: true, want: 'slide' },
  ];
  for (const { slide, ctrl, want } of cases) {
    const { ps, video, tick } = makeDeck();
    if (ctrl) ps.get('movie.pos').controller = { type: 'lfo' };
    ps.set('movie.posslide', slide);
    ps.set('movie.start', 10);
    ps.set('movie.end', 12);
    ps.set('movie.pos', 50);
    tick();
    const windowMoved = Math.abs(ps.get('movie.start').value - 10) > 1e-9;
    // MovieSpeed is 1, so only pos-drive can leave the deck paused. Testing it
    // independently of windowMoved is what catches TWO branches running on one
    // tick — a slide that also got force-paused means pos-drive claimed the
    // tick as well, which an either/or classifier would report as a clean
    // 'slide'.
    const forcedPause = video.paused;
    const got = windowMoved
      ? (forcedPause ? 'slide+pos-drive' : 'slide')
      : (forcedPause ? 'pos-drive' : 'manual');
    check(`slide=${slide} controller=${ctrl} → ${want}`, got === want,
      `took ${got}${got.includes('+') ? ' — two branches ran on one tick' : ''}`);
  }
}

console.log(failures
  ? `\n${failures} FAILURE(S)\n\nFix: MovieInput.tick() must test SlideRange FIRST, then a controller on\n\`\${P}.pos\` for pos-drive, and fall through to the manual scrub otherwise.\nThe two seek paths share the expression \`startT + pos/100 * range\`, so do not\nverify them by the number they produce — separate them by whether the deck is\nforce-paused and whether an IDLE tick moves a parked head.\n`
  : '\nAll movie Pos-branch checks passed.\n');
process.exit(failures ? 1 : 0);
