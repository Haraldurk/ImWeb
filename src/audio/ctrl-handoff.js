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
 * Slew mechanisms — which one a `slewShape` name is, not which curve.
 *
 * §8.7 said *"sample the seven slew curves and transfer them as buffers"*, and
 * that is true of four of them. The other three are not functions of normalized
 * time at all: `lag` is a one-pole filter, `ease` a critically damped spring
 * carrying velocity, `elastic` an underdamped spring that collides with the
 * parameter's rails. There is no k to sample against, so what travels for those
 * is the MECHANISM plus its constants; only the segment curves travel as data.
 */
export const SLEW_NONE = 0, SLEW_LAG = 1, SLEW_EASE = 2, SLEW_ELASTIC = 3, SLEW_SEGMENT = 4;
export const SLEW_MECHANISM = {
  lag: SLEW_LAG,
  ease: SLEW_EASE,
  elastic: SLEW_ELASTIC,
  ease2: SLEW_SEGMENT,
  expo: SLEW_SEGMENT,
  bounce: SLEW_SEGMENT,
  back: SLEW_SEGMENT,
};

/** How finely a segment curve is sampled for the wire. */
export const SLEW_CURVE_POINTS = 16384;

/**
 * Sample a segment curve into the table the worklet reads.
 *
 * The client's own function is the source — `SLEW_CURVES[shape]` — so Back's
 * anticipation is defined once and shipped, rather than defined twice and
 * compared. Values outside [0,1] are stored as they come: they ARE the
 * anticipation and the overshoot, and the lookup clamps its input, never its
 * output.
 */
export function sampleSlewCurve(fn, strength = 1, n = SLEW_CURVE_POINTS) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = fn(i / (n - 1), strength);
  return out;
}

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
export function describeController(param, lfo, entry, table = null, slew = null) {
  if (!param || !lfo || !entry) return null;
  const shape = CTRL_SHAPES[lfo.shape];
  if (shape === undefined) return null;
  if (lfo.beatSync) return null;               // no beat clock in the worklet
  if (lfo.mode === 'xmap') return null;        // externally triggered, client-side
  // A slew the caller could not describe — an unknown curve name, or a segment
  // curve nobody sampled — disqualifies, for the same reason an unresolvable
  // response table does: the row would say one shape and the sound be another.
  if (param.slew > 0 && !slew) return null;
  // A table NAMED but not resolvable is the one case that must refuse rather
  // than proceed: the client would shape the sweep with a curve the worklet has
  // never seen, so what is heard would stop matching what the row says.
  if (param.table && !table) return null;
  const lo = param.ctrlMin ?? param.min;
  const hi = param.ctrlMax ?? param.max;
  if (!(Number.isFinite(lo) && Number.isFinite(hi))) return null;
  return {
    shape,
    hz: lfo.hz,
    width: lfo.width,
    mode: lfo.mode === 'shot' ? 1 : 0,
    phase: lfo.phase,
    // Endpoints in the TARGET's units, in the parameter's own order.
    //
    // `invert` travels as its own flag rather than as a swapped range. The swap
    // is identical arithmetic while there is no response curve and wrong the
    // moment there is one, because `setNormalized` inverts BEFORE the table:
    // `table(1 − x)` mapped over lo..hi is not `table(x)` mapped over hi..lo.
    lo: entry.unit === 'semitone' ? semitoneToHz(lo) : lo,
    hi: entry.unit === 'semitone' ? semitoneToHz(hi) : hi,
    map: entry.map,
    invert: param.invert ? 1 : 0,
    // The resolved `ResponseCurve`, by reference. `TableManager.set()` replaces
    // the object rather than mutating it, so a reference change IS an edit —
    // which is what makes a per-frame identity comparison enough to catch one.
    table,
    slew,
  };
}

/**
 * What the worklet needs in order to slew this parameter exactly as
 * `Parameter.tickSlew` would, or `null` if it cannot.
 *
 * The rails are the PARAMETER's min/max, not the controller's range: that is
 * what the client fits excursions against, and using the narrower range here
 * would give Back a different dip on the audio side than on the video side.
 *
 * @param excursion  `slewExcursion(shape, strength)` — measured on the client,
 *                   shipped rather than re-measured, so how far Back dips has
 *                   one definition.
 * @param curve      the sampled f(k), for segment curves only.
 */
export function describeSlew(param, curve = null, excursion = null) {
  if (!(param.slew > 0)) return null;
  const mode = SLEW_MECHANISM[param.slewShape ?? 'lag'];
  if (mode === undefined) return null;
  if (mode === SLEW_SEGMENT && !(curve && excursion)) return null;
  return {
    mode,
    seconds: param.slew,
    damp: param.slewDamp ?? 0.45,
    strength: param.slewStrength ?? 1,
    curve,
    min: param.min,
    max: param.max,
    under: excursion?.under ?? 0,
    over: excursion?.over ?? 0,
    k0: excursion?.k0 ?? 0,
  };
}

/** Which of the three description messages actually need re-sending. */
export function descDiff(had, want) {
  return {
    lfo: !had || had.shape !== want.shape || had.hz !== want.hz
      || had.width !== want.width || had.mode !== want.mode,
    range: !had || had.lo !== want.lo || had.hi !== want.hi
      || had.map !== want.map || had.invert !== want.invert,
    phase: !had || had.phase !== want.phase,
    // 64 KB per upload, so this must be a real change and not a re-send. A
    // reference comparison is exactly right: `TableManager.set()` replaces the
    // curve object, so an edit changes the identity and a redraw of the same
    // curve does not.
    table: !had || had.table !== want.table,
    slew: !had || slewChanged(had.slew, want.slew),
    bind: !had,
  };
}

function slewChanged(a, b) {
  if (!a || !b) return a !== b;
  return a.mode !== b.mode || a.seconds !== b.seconds || a.damp !== b.damp
    || a.strength !== b.strength || a.curve !== b.curve || a.min !== b.min
    || a.max !== b.max || a.under !== b.under || a.over !== b.over || a.k0 !== b.k0;
}
