/**
 * Shared source-reading helpers for the audits in tests/.
 *
 * Exists because 2026-08-14's lesson in docs/LEARNED.md was paid for twice and
 * kept being re-implemented (or not) per audit. The rules it encodes:
 *
 *   - A source-text check must read the SOURCE, not the argument for it, so
 *     comments come out before anything is matched.
 *   - An index lookup that misses returns -1, and -1 is a VALID-LOOKING index:
 *     `a.indexOf(x) < a.indexOf(y)` is true when x is absent, and
 *     `s.slice(i, -1)` is nearly the whole file rather than a section. Both
 *     turn a missing needle into a passing check.
 *
 * Enforced by tests/audit-audit-hygiene.mjs.
 */

/**
 * Remove block and line comments, preserving string/template literals so a
 * URL's `//` survives, and preserving LINE COUNT so reported line numbers
 * still point at the right place.
 */
export function stripComments(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  let quote = null;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (d ?? ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && d === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? n : end + 2;
      const nl = src.slice(i, stop).match(/\n/g);
      out += nl ? nl.join('') : ' ';
      i = stop;
      continue;
    }
    if (c === '/' && d === '/') {
      const end = src.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    out += c; i++;
  }
  return out;
}

/**
 * The slice of `src` between two markers, or null if either is missing.
 *
 * Never returns a window built from a -1: `slice(-1, n)` is the last character
 * and `slice(i, -1)` is almost the entire file, so both silently answer
 * questions about the wrong text. A null return means "say so", not "assume".
 */
export function sectionBetween(src, fromMarker, toMarker) {
  const a = src.indexOf(fromMarker);
  if (a === -1) return null;
  const b = src.indexOf(toMarker, a + fromMarker.length);
  if (b === -1) return null;
  return src.slice(a, b);
}

/**
 * True when every marker appears in `src` in the given order.
 * Returns { ok, missing } — a missing marker is reported as missing, never
 * silently ordered first by its -1.
 */
export function inOrder(src, markers) {
  const missing = markers.filter(m => src.indexOf(m) === -1);
  if (missing.length) return { ok: false, missing };
  let prev = -1;
  for (const m of markers) {
    const at = src.indexOf(m);
    if (at <= prev) return { ok: false, missing: [], outOfOrder: m };
    prev = at;
  }
  return { ok: true, missing: [] };
}
