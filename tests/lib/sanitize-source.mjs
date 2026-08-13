/**
 * Blank comments, string bodies, template text and regex literals before a
 * source-scanning audit matches against a file.
 *
 * Why this exists: a regex check for a forbidden construct also matches the
 * comment explaining why the construct is forbidden, and it fails on CORRECT
 * code — the expensive direction, because the reflex it trains is "reword the
 * prose until the check goes quiet", which leaves the check weaker than it
 * looks (LEARNED 2026-08-12, promoted to [audit] the same day).
 *
 * Shared rather than copied. The second audit that needed it is exactly where
 * a near-duplicate would have appeared, and CLAUDE.md's standing instruction is
 * to extend one canonical function instead of copying the pattern.
 *
 * Ranges are blanked IN PLACE so offsets and line count survive — multi-line
 * structural checks (`/try\s*\{[\s\S]*?catch/`) depend on that.
 *
 * Known limit: the brace counter inside a `${…}` does not itself understand
 * strings or comments, so `${ f("}") }` would mis-detect the template's end.
 * Fixing it properly means a real parser; it fails loudly rather than silently,
 * which is the tolerable direction.
 */
export function sanitizeSource(src, { blankStrings = true } = {}) {
  const out = src.split('');
  const blank = (a, b) => { for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' '; };
  const n = src.length;
  let i = 0, prev = '';

  while (i < n) {
    const c = src[i], d = src[i + 1];

    if (c === '/' && d === '/') {
      let j = src.indexOf('\n', i); if (j < 0) j = n;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2); j = j < 0 ? n : j + 2;
      blank(i, j); i = j; continue;
    }
    // `/` opens a regex unless the previous significant char could end a value.
    if (c === '/' && !/[A-Za-z0-9_$)\]]/.test(prev)) {
      let j = i + 1, inClass = false, closed = false;
      while (j < n) {
        const e = src[j];
        if (e === '\\') { j += 2; continue; }
        if (e === '\n') break;
        if (e === '[') inClass = true;
        else if (e === ']') inClass = false;
        else if (e === '/' && !inClass) { j++; closed = true; break; }
        j++;
      }
      if (closed) {
        while (j < n && /[a-z]/.test(src[j])) j++;      // flags
        if (blankStrings) blank(i + 1, j - 1);
        i = j; prev = ')'; continue;
      }
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;
        j++;
      }
      if (blankStrings) blank(i + 1, j - 1);
      i = j; prev = c; continue;
    }
    if (c === '`') {
      let j = i + 1, segStart = j;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '`') { if (blankStrings) blank(segStart, j); j++; break; }
        if (src[j] === '$' && src[j + 1] === '{') {
          if (blankStrings) blank(segStart, j);
          let k = j + 2, depth = 1;                     // leave ${…} code intact
          while (k < n && depth > 0) {
            if (src[k] === '{') depth++;
            else if (src[k] === '}') depth--;
            k++;
          }
          j = k; segStart = j; continue;
        }
        j++;
      }
      i = j; prev = '`'; continue;
    }

    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join('');
}

/** A fixture planting the same match in all four contexts, plus live code. */
export const SANITIZER_FIXTURE = [
  '// a comment warning that new Function( must never come back',
  '/* block comment: new Function( */',
  "const s = 'new Function(';",
  'const re = /new Function\\(/;',
  'const t = `new Function(`;',
  'const u = `${ realCall() }`;',
  'legit();',
].join('\n');

/**
 * Calibrate before trusting. A sanitizer that blanks too much makes every check
 * downstream vacuously true, and that failure mode is silence — so proving it
 * leaves real code intact matters more than proving it hides prose.
 *
 * @param {(label:string, cond:boolean, detail?:string)=>void} check
 */
export function calibrateSanitizer(check) {
  const clean = sanitizeSource(SANITIZER_FIXTURE);
  check('sanitizer hides new Function( in comments, strings, regex and templates',
    !/new Function\s*\(/.test(clean), 'a live match here means prose still leaks in');
  check('sanitizer leaves real code intact',
    /legit\(\)/.test(clean) && /realCall\(\)/.test(clean),
    'blanking code would make every check downstream vacuous');
  check('sanitizer preserves line count',
    clean.split('\n').length === SANITIZER_FIXTURE.split('\n').length,
    'multi-line structural checks depend on offsets surviving');
}
