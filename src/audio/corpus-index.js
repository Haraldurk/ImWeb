/**
 * The corpus index (§4.6) — the map. The tape is the territory, and the engine
 * owns that; everything here is the map, and the engine has never heard of it.
 *
 * **Zero imports**, so all of it is testable in Node with no audio device, no
 * canvas and no parameter system — which matters more here than anywhere else
 * in the audio half, because "does this descriptor space put similar material
 * near itself" is a question about arithmetic that no listening test answers
 * quickly.
 *
 * What arrives from the engine is a flat table of numbers: four columns per
 * grain, in `CORPUS_COLUMNS` order, times derived from a start and a hop. What
 * leaves is a timestamp. Everything between — which columns are the axes, how
 * they are scaled, what "near" means — is here.
 */

/**
 * How each measured column becomes an axis.
 *
 * The `scale` is the load-bearing field, and it is not decoration on any of the
 * three non-linear ones:
 *
 * - **loudness** arrives as RMS, which is linear in pressure and nothing like
 *   linear in hearing. On a linear axis the entire quiet half of a corpus —
 *   which is most of it, in real material — piles into a few pixels at the
 *   bottom and cannot be navigated at all.
 * - **pitch** is heard as a ratio (LEARNED 2026-08-08, the same rule that put
 *   semitones on the voice's controls). An octave must be the same distance
 *   wherever it sits, or the top of the axis is a smear and the bottom is empty.
 * - **brightness** and **periodicity** are already normalized rates in 0..1,
 *   and neither is a ratio quantity, so linear is correct rather than lazy.
 */
export const DESCRIPTORS = Object.freeze([
  { key: 'loudness', label: 'Loudness', scale: 'db' },
  { key: 'brightness', label: 'Brightness', scale: 'linear' },
  { key: 'pitch', label: 'Pitch', scale: 'logHz' },
  { key: 'periodicity', label: 'Periodicity', scale: 'linear' },
]);

export const DESCRIPTOR_LABELS = Object.freeze(DESCRIPTORS.map((d) => d.label));

/** Matches the engine's `CORPUS_COLS`; the audit pins the two together. */
export const CORPUS_COLS = DESCRIPTORS.length;

/** Below this the RMS is treated as silence rather than as a very quiet grain. */
const DB_FLOOR = -60;

function transform(scale, v) {
  if (scale === 'db') {
    if (!(v > 0)) return DB_FLOOR;
    const db = 20 * Math.log10(v);
    return db < DB_FLOOR ? DB_FLOOR : db;
  }
  if (scale === 'logHz') return Math.log2(v);
  return v;
}

/**
 * Build a navigable 2D index over two of the measured columns.
 *
 * **Axes are normalized across THIS corpus, not against absolute ranges.** A
 * recording of quiet material should still spread across the whole loudness
 * axis: the pad is for navigating what you have, and an absolute scale would
 * leave most corpora crushed into one corner of it. The cost is that the same
 * grain sits at a different coordinate in a different corpus, which is correct
 * — the map is of this territory.
 *
 * **Grains with no detected pitch are DROPPED when pitch is an axis**, and
 * counted in `droppedPitchless`. The alternative is placing them somewhere, and
 * there is nowhere honest: an unpitched grain is not a low-pitched one, so
 * parking the noise along the bottom edge invents a reading of the axis that is
 * false exactly where a performer would go looking for noise.
 *
 * **Grains the reader cannot reach are dropped too**, counted separately in
 * `droppedUnreachable`. `reach` is the absolute sample span the grain player can
 * actually read — its partition, or the whole tape when `unsafe`. The analysis
 * covers the whole tape, so without this the map claims material the reader will
 * not play: the position wraps into the partition and you hear a DIFFERENT grain
 * from the one you touched. That is the one place a map can lie about its
 * territory while looking like it works, so unreachable grains are removed from
 * the map rather than silently redirected in the reader.
 *
 * Filtering here rather than at analysis time is what keeps changing the
 * partition free — the measurements are still valid, only the projection
 * changes, which is the same reason an axis change does not re-measure.
 */
export function buildIndex(
  raw, count, startSample, hopSamples, xCol, yCol, gridSize = 32, reach = null,
) {
  const xd = DESCRIPTORS[xCol] ?? DESCRIPTORS[0];
  const yd = DESCRIPTORS[yCol] ?? DESCRIPTORS[1];
  const needsPitch = (c) => DESCRIPTORS[c]?.scale === 'logHz';
  const dropPitchless = needsPitch(xCol) || needsPitch(yCol);

  const ids = [];
  const xs = [];
  const ys = [];
  let droppedPitchless = 0;
  let droppedUnreachable = 0;
  for (let i = 0; i < count; i++) {
    const base = i * CORPUS_COLS;
    if (dropPitchless && !(raw[base + 2] > 0)) { droppedPitchless++; continue; }
    if (reach) {
      const t = startSample + i * hopSamples;
      if (t < reach.lo || t >= reach.hi) { droppedUnreachable++; continue; }
    }
    ids.push(i);
    xs.push(transform(xd.scale, raw[base + xCol]));
    ys.push(transform(yd.scale, raw[base + yCol]));
  }

  const n = ids.length;
  const index = {
    count: n, dropped: count - n, droppedPitchless, droppedUnreachable,
    start: startSample, hop: hopSamples,
    ids: Int32Array.from(ids),
    x: new Float32Array(n), y: new Float32Array(n),
    xCol, yCol, gridSize,
    grid: null, cells: null,
  };
  if (!n) return index;

  const spread = (src, out) => {
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < n; i++) { if (src[i] < lo) lo = src[i]; if (src[i] > hi) hi = src[i]; }
    // A corpus with one distinct value on an axis is not an error — a pure tone
    // has one pitch — so it collapses to the middle rather than dividing by
    // zero and scattering NaN through every distance comparison downstream.
    const span = hi - lo;
    for (let i = 0; i < n; i++) out[i] = span > 0 ? (src[i] - lo) / span : 0.5;
    return { lo, hi };
  };
  index.xRange = spread(xs, index.x);
  index.yRange = spread(ys, index.y);

  // A uniform bucket grid, rebuilt whenever the axes change. Flat arrays rather
  // than an array of arrays: a corpus is up to 16384 points and this is rebuilt
  // on every axis change, so the allocation is worth doing once as two typed
  // arrays instead of thousands of small ones.
  const g = gridSize;
  const counts = new Int32Array(g * g + 1);
  const cellOf = (i) => {
    const cx = Math.min(g - 1, Math.max(0, Math.floor(index.x[i] * g)));
    const cy = Math.min(g - 1, Math.max(0, Math.floor(index.y[i] * g)));
    return cy * g + cx;
  };
  for (let i = 0; i < n; i++) counts[cellOf(i) + 1]++;
  for (let c = 0; c < g * g; c++) counts[c + 1] += counts[c];
  const cells = new Int32Array(n);
  const cursor = Int32Array.from(counts.subarray(0, g * g));
  for (let i = 0; i < n; i++) cells[cursor[cellOf(i)]++] = i;
  index.grid = counts;
  index.cells = cells;
  return index;
}

/**
 * The grain nearest (x, y) in normalized axis space, or -1 for an empty corpus.
 *
 * Searches the containing cell, then rings outward, and — the part that is easy
 * to get wrong — **keeps going one ring past the first hit**. Stopping at the
 * first non-empty ring returns a point that is merely in a near cell, which on
 * a coarse grid is visibly not the nearest one: the pad would snap to something
 * a centimetre from the cursor while a closer grain sat just across a cell
 * boundary. The extra ring is bounded by the distance already found, so it
 * costs one ring on a dense corpus and nothing on a sparse one.
 */
export function nearest(index, x, y) {
  const { count, gridSize: g, grid, cells } = index;
  if (!count) return -1;
  const cx = Math.min(g - 1, Math.max(0, Math.floor(x * g)));
  const cy = Math.min(g - 1, Math.max(0, Math.floor(y * g)));
  let best = -1;
  let bestD = Infinity;
  const scan = (ix, iy) => {
    if (ix < 0 || iy < 0 || ix >= g || iy >= g) return;
    const c = iy * g + ix;
    for (let k = grid[c]; k < grid[c + 1]; k++) {
      const i = cells[k];
      const dx = index.x[i] - x;
      const dy = index.y[i] - y;
      const d = dx * dx + dy * dy;
      if (d < bestD) { bestD = d; best = i; }
    }
  };
  for (let ring = 0; ring < g; ring++) {
    if (ring > 0) {
      for (let d = -ring; d <= ring; d++) {
        scan(cx + d, cy - ring); scan(cx + d, cy + ring);
        scan(cx - ring, cy + d); scan(cx + ring, cy + d);
      }
    } else {
      scan(cx, cy);
    }
    // A hit inside `ring` cells can still be beaten by one in the next ring
    // out, because a cell's near corner is closer than its far corner. Once the
    // best distance is inside the ring's guaranteed radius, nothing further can
    // beat it and the search is genuinely done.
    if (best >= 0 && Math.sqrt(bestD) <= ring / g) break;
  }
  return best;
}

/** Where in the tape grain `k` of this index lives, in samples. */
export function grainTime(index, k) {
  return index.start + index.ids[k] * index.hop;
}
