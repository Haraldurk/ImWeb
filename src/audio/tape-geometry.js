/**
 * Where a partition and a zone actually are, in fractions of the tape.
 *
 * This exists because the numbers were being computed TWICE — once on the way
 * to the engine (`/part/<n>/bounds`, `/zone/<type>/<n>/region`) and once on the
 * way to the display — and two copies of a conversion are two answers waiting
 * to disagree. A display that disagrees with the engine about where a zone is
 * is worse than no display: it is believed, so the region gets moved until the
 * picture looks right and the sound ends up somewhere else.
 *
 * Fractions, not samples, because that is what the params hold (§4.3 — a
 * captured layout has to mean the same thing on a machine whose tape is a
 * different length). Samples are a multiplication away and only the engine
 * needs them.
 *
 * Imports nothing, from either half.
 */

/**
 * A partition's span, clamped to the tape. Length is what gets shortened, never
 * the start: a partition whose start moved would silently relocate every zone
 * bound to it, since zone regions are partition-relative.
 */
export function partitionSpan(fracStart, fracLen) {
  const start = Math.min(Math.max(fracStart, 0), 1);
  return { start, len: Math.min(Math.max(fracLen, 0), 1 - start) };
}

/**
 * A zone's span in fractions OF THE TAPE, given its partition's span and its
 * own partition-relative fractions. Unclamped on purpose — the engine applies
 * the partition seam itself (`_computeSpan`), and `clampToPartition` below is
 * for the display, which has to show the same clamp without duplicating the
 * decision about whether to apply it.
 */
export function zoneSpan(part, relStart, relLen) {
  const start = part.start + relStart * part.len;
  return { start, end: start + relLen * part.len };
}

/**
 * The seam. `unsafe` is the opt-in that crosses it (§4.3), so a display that
 * ignored this flag would either hide the one deliberate way to read past a
 * partition or show every zone reaching material it never touches.
 */
export function clampToPartition(span, part, unsafe) {
  if (unsafe) return span;
  return { start: span.start, end: Math.max(span.start, Math.min(span.end, part.start + part.len)) };
}
