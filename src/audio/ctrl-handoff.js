/**
 * Which controllers the worklet may take, and what to tell it (§8.7).
 *
 * Pure, and imports nothing from either half — so the decision that governs the
 * hand-off can be driven directly in Node. That matters more here than anywhere
 * else in the audio code: §8.7 says plainly that the two code paths are where
 * the bugs will live, and the path that only runs with audio OFF is the one
 * nobody exercises while developing.
 */

/**
 * §8.7's "per-parameter audio-relevance question", answered as ONE list.
 *
 * The slot is the array index — opaque to the engine (rule 3), stable within a
 * session, and deliberately not persisted: nothing captures it, so it cannot
 * drift the way a saved index into a user-editable list does (the `warpSlot`
 * failure). The target is an ENGINE address, so `aplay.rate` never travels.
 *
 * **Extend THIS. Do not copy the pattern.** Same shape as `_srcUsed` in
 * main.js, same warning: seven near-duplicates of that function accrued before
 * it was made canonical, and three had silently drifted.
 *
 * Every address here takes exactly one float, which is the engine's binding
 * rule. The filter cutoff is absent because it lives inside
 * `/voice/<n>/filter <fff>`.
 */
export const AUDIO_TARGETS = [
  { id: 'aplay.rate', address: '/zone/play/0/rate', map: 0 },
  // `map: 1` is exponential, and for pitch it is not an approximation of the
  // semitone sweep — it IS the semitone sweep. Semitones are a log₂ frequency
  // scale, so a linear ramp in semitones between two endpoints is exactly a
  // constant-ratio sweep between their frequencies.
  { id: 'avoice.pitch', address: '/voice/0/freq', map: 1, unit: 'semitone' },
  { id: 'avoice.level', address: '/voice/0/level', map: 0 },
  { id: 'avoice.colour', address: '/voice/0/colour', map: 0 },
  { id: 'avoice.drive', address: '/voice/0/drive', map: 0 },
  { id: 'audio.outGain', address: '/bus/out/gain', map: 0 },
];

/** `src/controls/LFO.js` shape names → the wire's integers, in its own order. */
export const CTRL_SHAPES = { sine: 0, triangle: 1, sawtooth: 2, rampdown: 3, square: 4, sh: 5 };

/**
 * Semitones → Hz. Pitch and cutoff are registered in semitones because rate and
 * frequency are heard as ratios (LEARNED 2026-08-08); the engine speaks Hz
 * because that is what a DSP kernel wants. One conversion site for both the
 * per-value path and the controller range.
 */
export function semitoneToHz(semitones) {
  return 440 * Math.pow(2, (semitones - 69) / 12);
}

/**
 * A description for the worklet, or `null` if this parameter must stay on the
 * rAF path.
 *
 * **The null cases are the honest half of this function.** Each is a feature
 * the worklet does not have yet, and handing the parameter over anyway would
 * not fail loudly — it would quietly drop that feature: a response table would
 * stop shaping the sweep, a beat-synced LFO would free-run at whatever Hz it
 * last held, a slewed parameter would step. Silent feature loss is the worst
 * outcome available here, so the rule is that the worklet takes a controller
 * only when it can reproduce it exactly.
 *
 * @param {object} param  a ParameterSystem Parameter (min/max/ctrlMin/ctrlMax/
 *                        invert/table/slew are read)
 * @param {object} lfo    the live `LFO` instance — the popover mutates it in
 *                        place and BPM sync writes its `hz`, so it is the only
 *                        source of truth for what the controller is doing NOW
 * @param {object} entry  the AUDIO_TARGETS row
 */
export function describeController(param, lfo, entry) {
  if (!param || !lfo || !entry) return null;
  const shape = CTRL_SHAPES[lfo.shape];
  if (shape === undefined) return null;
  if (lfo.beatSync) return null;               // no beat clock in the worklet
  if (lfo.mode === 'xmap') return null;        // externally triggered, client-side
  if (param.table) return null;                // response tables are §8.7's next step
  if (param.slew > 0) return null;             // so are the seven slew curves
  let lo = param.ctrlMin ?? param.min;
  let hi = param.ctrlMax ?? param.max;
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return null;
  // `invert` is `1 - n`, which over a monotonic map is exactly the range read
  // backwards — so it costs a swap here rather than a flag on the wire.
  if (param.invert) { const t = lo; lo = hi; hi = t; }
  if (entry.unit === 'semitone') { lo = semitoneToHz(lo); hi = semitoneToHz(hi); }
  return {
    shape,
    hz: lfo.hz,
    width: lfo.width,
    mode: lfo.mode === 'shot' ? 1 : 0,
    phase: lfo.phase,
    lo,
    hi,
    map: entry.map,
  };
}

/** Which of the three description messages actually need re-sending. */
export function descDiff(had, want) {
  return {
    lfo: !had || had.shape !== want.shape || had.hz !== want.hz
      || had.width !== want.width || had.mode !== want.mode,
    range: !had || had.lo !== want.lo || had.hi !== want.hi || had.map !== want.map,
    phase: !had || had.phase !== want.phase,
    bind: !had,
  };
}
