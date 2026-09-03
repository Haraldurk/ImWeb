/**
 * Audit hygiene audit — the audits check the code; this checks the audits.
 *
 * Promotes 2026-08-14 [advisory] in docs/LEARNED.md, which had already been
 * paid for twice and both times failed a CORRECT file:
 *
 *   (a) a monitoring audit asserted the engine no longer emits an unconditional
 *       "USE HEADPHONES" string, and matched its own comment quoting the old
 *       string while explaining why it was removed;
 *   (b) a stylesheet audit asserted `body.sp-audio` is declared before
 *       `body.signalpath-hidden`, and found the second selector inside the
 *       comment EXPLAINING that ordering, twenty characters above the rule.
 *
 * A source-text check must read the source, not the argument for it.
 *
 * Two checks, because the entry contains two rules.
 *
 * 1. NO AUDIT MAY MATCH A LITERAL THAT EXISTS ONLY IN A COMMENT. Rather than
 *    demanding every audit strip comments — 24 of 29 do not, and most never
 *    match anything a comment could contain, so that would be 24 false alarms
 *    and a disabled test — this computes the failure directly: for each literal
 *    an audit searches for, if it appears in the target file RAW but vanishes
 *    once comments are stripped, that audit is asserting against prose. That
 *    fails closed. A new audit written tomorrow against a commented-out string
 *    is caught with nothing to add here.
 *
 * 2. AN ORDERING CHECK ON indexOf MUST GUARD -1. `a.indexOf(x) < a.indexOf(y)`
 *    is true when x is ABSENT, because -1 is less than everything — so the
 *    check passes on a file missing the call entirely, which is the exact
 *    failure it was written to catch.
 *
 * Subjects are DERIVED, never listed: every tests/audit-*.mjs is read and
 * classified. Per 2026-08-15's lesson, an audit that enumerates its own
 * subjects fails open the day someone adds one.
 *
 * Run:  node tests/audit-audit-hygiene.mjs
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripComments } from './lib/source.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const auditFiles = readdirSync(join(ROOT, 'tests'))
  .filter(f => f.startsWith('audit-') && f.endsWith('.mjs'))
  .sort();

check('found the audit suite to inspect', auditFiles.length > 5,
  `only ${auditFiles.length} audit files found — is the path right?`);

// Source files whose comments can swallow a literal. .gitignore/.md/.json are
// excluded: their comment syntax is different or absent, and a literal found in
// a markdown file is the point of that audit, not a mistake.
const SOURCEY = /\.(m?js|css|html|glsl)$/;

// ── 1. No audit may assert against a literal that only exists in a comment ────
console.log('\nLiterals matched against comments');
{
  let inspected = 0;
  let pairs = 0;
  for (const f of auditFiles) {
    if (f === 'audit-audit-hygiene.mjs') continue;   // do not inspect self
    const src = readFileSync(join(ROOT, 'tests', f), 'utf8');
    const code = stripComments(src);

    // Bind each variable to the file it holds. Pairing every literal in an
    // audit with every file it reads produced eight false alarms on the first
    // run — short words like "live" and "idle" that are tested against a label
    // array, not against source at all. The needle has to be attributed to the
    // variable it is actually searched in, or this check is noise.
    const bind = new Map();   // varName -> repo-relative path
    for (const m of code.matchAll(
      /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*readFileSync\(([^;]*?)\)/g)) {
      const lit = /['"`]([^'"`\n]+\.(?:m?js|css|html|glsl))['"`]/.exec(m[2]);
      if (!lit) continue;
      const rel = lit[1].replace(/^\.\.\//, '').replace(/^\.\//, '');
      if (!SOURCEY.test(rel) || rel.startsWith('tests/')) continue;
      bind.set(m[1], rel);
    }
    if (!bind.size) continue;
    inspected++;

    const cache = new Map();
    for (const m of code.matchAll(
      /\b([A-Za-z_$][\w$]*)\s*\.\s*(?:includes|indexOf|lastIndexOf)\(\s*(['"])((?:[^'"\\\n]|\\.){4,})\2/g)) {
      const rel = bind.get(m[1]);
      if (!rel) continue;                      // not a file-content variable
      const needle = m[3].replace(/\\(.)/g, '$1');
      // Searching FOR a comment is legitimate — section banners are used as
      // anchors. The rule is about literals that happen to also appear in
      // prose, not about deliberately locating prose.
      if (/^\s*(?:\/\/|\/\*|\*)/.test(needle)) continue;
      if (!cache.has(rel)) {
        try {
          const raw = readFileSync(join(ROOT, rel), 'utf8');
          cache.set(rel, { raw, stripped: stripComments(raw) });
        } catch { cache.set(rel, null); }
      }
      const t = cache.get(rel);
      if (!t || !t.raw.includes(needle)) continue;
      pairs++;
      check(`${f}: "${truncate(needle)}" in ${rel} is real code, not a comment`,
        t.stripped.includes(needle),
        `the ONLY occurrence is inside a comment — this check asserts against prose. ` +
        `Strip comments before matching (tests/lib/source.mjs exports stripComments)`);
    }
  }
  check('inspected a meaningful number of audit/source literal pairs', pairs >= 10,
    `only ${pairs} pairs across ${inspected} audits — the extractor is probably not matching`);
}

// ── 2. indexOf ordering comparisons must guard -1 ────────────────────────────
console.log('\nOrdering checks guard a missing needle');
{
  let ordering = 0;
  for (const f of auditFiles) {
    if (f === 'audit-audit-hygiene.mjs') continue;
    const src = readFileSync(join(ROOT, 'tests', f), 'utf8');
    const code = stripComments(src);
    const lines = code.split('\n');

    lines.forEach((line, i) => {
      const idxCount = (line.match(/indexOf/g) ?? []).length;
      if (idxCount < 2) return;
      // Two shapes fail the same silent way when the needle is absent:
      //   a.indexOf(x) < a.indexOf(y)   → -1 < n is TRUE, the check passes
      //   s.slice(s.indexOf(x), s.indexOf(y))
      //       → slice(-1, n) quietly returns the LAST CHARACTER, so every
      //         assertion about that window is made against one byte
      const isOrdering = /indexOf\s*\([^)]*\)\s*[<>]=?/.test(line);
      const isWindow = /\.slice\s*\(/.test(line);
      if (!isOrdering && !isWindow) return;
      ordering++;
      // The guard may sit on the same line or in the few lines around it —
      // audits commonly hoist the lookups then compare.
      const ctx = lines.slice(Math.max(0, i - 6), i + 3).join('\n');
      const guarded = /(!==|!=|>=|>)\s*-1|-1\s*(!==|!=|<)|\bincludes\(/.test(ctx);
      check(`${f}:${i + 1} ordering check guards an absent needle`, guarded,
        `\`a.indexOf(x) < b.indexOf(y)\` is TRUE when x is absent (-1 < n), so this ` +
        `passes on a file missing the call entirely. Assert both are !== -1 first`);
    });
  }
  // A POSITIVE CONTROL instead of `ordering >= 1`. Every instance in the suite
  // is now guarded, so counting real subjects cannot tell "nothing to find"
  // apart from "the detector stopped working" — and the second reading is the
  // fail-open this whole audit exists to prevent. Run the detector against
  // known-bad and known-good text instead, so it is proven to work whether or
  // not the repo currently contains a violation.
  const detect = (line, ctx) => {
    const idxCount = (line.match(/indexOf/g) ?? []).length;
    if (idxCount < 2) return false;
    const isOrdering = /indexOf\s*\([^)]*\)\s*[<>]=?/.test(line);
    const isWindow = /\.slice\s*\(/.test(line);
    if (!isOrdering && !isWindow) return false;
    return !/(!==|!=|>=|>)\s*-1|-1\s*(!==|!=|<)|\bincludes\(/.test(ctx ?? line);
  };
  check('detector flags an unguarded ordering comparison',
    detect(`check('order', css.indexOf('a') < css.indexOf('b'));`));
  check('detector flags an unguarded slice window',
    detect(`const sec = src.slice(src.indexOf('a('), src.indexOf('b('));`));
  check('detector accepts a guarded comparison',
    !detect(`if (a.indexOf(x) !== -1 && a.indexOf(y) !== -1) ok(a.indexOf(x) < a.indexOf(y));`));
  check('detector ignores an unrelated single lookup',
    !detect(`const at = src.indexOf('marker');`));
  console.log(`  note  ${ordering} live two-indexOf site(s) in the suite, all guarded`);
}

// ── Collection assertions guard an EMPTY collection ─────────────────────────
//
// The same fail-open as the ordering check above, one level up: an assertion
// about every member of a collection is vacuously TRUE when the collection is
// empty. `[].every(...)` is true. `new Set([]).size === [].length` is true.
// `[].some(...)` is false, so a negated some passes too.
//
// This is not hypothetical. Three checks in audit-text-render shipped green
// while asserting nothing at all: the layer stops re-rendering once its audio
// envelope converges — correctly — so the final tick recorded no draws, and
// every assertion about those draws passed against an empty array. The feature
// could have been entirely broken and the suite would have said "ok".
//
// The guard is cheap and total: assert the SIZE too. Any nearby comparison of
// `.length` or `.size` against something counts, so the natural fix registers.
console.log('\nCollection assertions guard an empty collection');
{
  // Scoped to the case that actually fails: a collection **produced by running
  // the code under test**, which is the only kind that can legitimately come
  // back empty. A statically-sized fixture (`[...L]` over a seven-element
  // literal in audit-audio-dsp) cannot, and flagging it would fail a correct
  // check — the expensive direction, per LEARNED 2026-08-14. So the receiver
  // must be a bare identifier assigned from a CALL nearby.
  const vacuous = (line, ctx) => {
    // Only inside an assertion — a bare .every() in a helper is not a claim.
    if (!/\b(check|ok|assert)\s*\(/.test(line)) return false;

    const setShape = /new Set\([^;]*\)\.size\s*===\s*([A-Za-z_$][\w$]*)\.length/;
    const m = line.match(/([A-Za-z_$][\w$]*)\.every\s*\(/)
           || line.match(/!\s*([A-Za-z_$][\w$]*)\.some\s*\(/)
           || line.match(setShape);
    if (!m) return false;
    const recv = m[1];

    const around = ctx ?? line;
    // Produced by a call? `const c = settle(...)`, `= tick(...)`, `= run(...)`.
    if (!new RegExp(`\\b${recv}\\s*=\\s*[^;\\n]*\\w\\s*\\(`).test(around)) return false;

    // The set-size shape IS the assertion, so its own `.size ===` must not be
    // read as the guard — remove it before looking for one.
    const guardText = around.replace(setShape, '');
    return !new RegExp(
      `${recv}\\.(length|size)\\s*(===|!==|==|!=|>=|<=|>|<)`
      + `|(===|!==|>=|<=|>|<)\\s*${recv}\\.(length|size)`
    ).test(guardText);
  };

  let sites = 0;
  for (const f of auditFiles) {
    if (f === 'audit-audit-hygiene.mjs') continue;
    const lines = stripComments(readFileSync(join(ROOT, 'tests', f), 'utf8')).split('\n');
    lines.forEach((line, i) => {
      const ctx = lines.slice(Math.max(0, i - 3), i + 4).join('\n');
      if (!/\.every\s*\(|\.some\s*\(|new Set\(/.test(line)) return;
      if (!/\b(check|ok|assert)\s*\(/.test(line)) return;
      sites++;
      check(`${f}:${i + 1} collection assertion guards an empty collection`,
        !vacuous(line, ctx),
        `\`[].every(...)\` is TRUE, so this passes when the collection is empty — ` +
        `which is what "the code drew nothing" looks like. Assert the count too`);
    });
  }

  // Positive control, for the reason the ordering check states: once every
  // live site is guarded, counting subjects cannot distinguish "clean" from
  // "the detector broke".
  const RUN = `const c = settle(t, o);\n`;
  check('detector flags an unguarded every()',
    vacuous(`check('all scaled', c.every(d => d.scale > 1));`,
            RUN + `check('all scaled', c.every(d => d.scale > 1));`));
  check('detector flags an unguarded negated some()',
    vacuous(`check('none stale', !c.some(d => d.stale));`,
            RUN + `check('none stale', !c.some(d => d.stale));`));
  check('detector flags an unguarded set-size-vs-length',
    vacuous(`check('all distinct', new Set(c.map(d => d.x)).size === c.length);`,
            RUN + `check('all distinct', new Set(c.map(d => d.x)).size === c.length);`));
  check('detector accepts a check that asserts the count as well',
    !vacuous(`check('all scaled', c.length === 8 && c.every(d => d.scale > 1));`,
             RUN + `check('all scaled', c.length === 8 && c.every(d => d.scale > 1));`));
  check('detector accepts a guard on a nearby line',
    !vacuous(`check('all scaled', c.every(d => d.scale > 1));`,
             RUN + `if (c.length !== 8) fail('no draws');\ncheck('all scaled', c.every(d => d.scale > 1));`));
  check('detector accepts a set-size check that also asserts the count',
    !vacuous(`check('all distinct', c.length === 4 && new Set(c.map(d => d.x)).size === 4);`,
             RUN + `check('all distinct', c.length === 4 && new Set(c.map(d => d.x)).size === 4);`));
  check('detector ignores a non-assertion every()',
    !vacuous(`const allBig = c.every(d => d.scale > 1);`, RUN + `const allBig = c.every(d => d.scale > 1);`));
  check('detector ignores a statically-sized fixture',
    !vacuous(`check('bounded', [...L].every((v) => v >= -1 && v <= 1));`,
             `const L = new Float32Array([0.5, 5, -5]);\ncheck('bounded', [...L].every((v) => v >= -1 && v <= 1));`));
  console.log(`  note  ${sites} collection assertion(s) in the suite, all guarded`);
}

// Attribute a variable to the source file it holds. Broader than section 1s
// binder on purpose: that one must stay narrow (widening it reintroduced eight
// false alarms once), while the two sections below only look at variables they
// have already decided are interesting, so they can afford to follow the
// per-audit read helpers (`const pipeline = read('src/core/Pipeline.js')`).
const bindSourceVarsShared = (code) => {
  const map = new Map();
  for (const m of code.matchAll(
    /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*([^;]*?)(?=;|\n\s*(?:const|let|var|function|check|console|\/\/))/g)) {
    const lit = /['"`]((?:src|public|tests)\/[^'"`\n]+\.(?:m?js|css|html|glsl))['"`]/.exec(m[2]);
    if (lit && SOURCEY.test(lit[1])) map.set(m[1], lit[1]);
  }
  return map;
};

// ── A window anchor must be UNAMBIGUOUS in the file it slices ───────────────
//
// Promotes the second of the three incidents in the 2026-08-30 entry. An audit
// that slices a region out of a source file and then asserts about its contents
// is only asserting about the region it MEANT to slice if the anchor occurs
// once. `indexOf` silently takes the first match, so a bare method name lands on
// the CALL SITE when the call happens to appear above the definition:
//
//   pipeline.indexOf('_ensureBokehMaskRT')   // → line 196, `pipe._ensureBokehMaskRT()`
//   pipeline.indexOf('\n  _ensureBokehMaskRT() {')   // → line 1419, the definition
//
// The first sliced a window containing no allocation at all and reported "the
// target is not FloatType" about a target that was — a RED result on correct
// code, which is the expensive direction: it nearly reverted the fix.
//
// Scoped deliberately to slice windows. The obvious wider rule — "a needle must
// be unique" — fails a correct check: audit-audio-signalpath compares the
// positions of two CSS selectors, and `body.signalpath-hidden` legitimately
// heads two adjacent rules, where taking the first is exactly what "declared
// before" means. Ambiguity is only a defect when it decides the CONTENTS of a
// window rather than a position, so that is what this asks about.
console.log('\nWindow anchors are unambiguous in their target');
{
  // A broader binder than section 1's, on purpose. That one attributes short
  // needles to the variable holding a file and must stay narrow — widening it
  // reintroduced eight false alarms once. This one only ever looks at anchors
  // already known to slice, so it can afford to follow the per-audit read
  // helpers (`const pipeline = read('src/core/Pipeline.js')`) that the narrow
  // binder cannot see.
  const bindSourceVars = bindSourceVarsShared;

  // Returns the needle when this site is a window anchor worth checking, else
  // null. Split out so the positive controls below drive the same code the
  // suite is scanned with — a detector proven on a copy of itself proves
  // nothing (LEARNED 2026-08-27).
  const anchorAt = (m, lines, lineNo) => {
    const [, lhs, , , quote, rawNeedle, hasFrom] = m;
    // A template with a substitution cannot be resolved statically, and a
    // search given a `from` offset is a deliberately scoped one — the author
    // has already answered the question this check asks.
    if (quote === '`' && /\$\{/.test(rawNeedle)) return null;
    if (hasFrom) return null;
    const inlineSlice = /\.slice\s*\(/.test(lines[lineNo - 1] ?? '');
    const viaVar = lhs && new RegExp(`\\.slice\\s*\\(\\s*(?:[^)]*\\b${lhs}\\b)`)
      .test(lines.slice(lineNo - 1, lineNo + 5).join('\n'));
    if (!inlineSlice && !viaVar) return null;
    return rawNeedle.replace(/\\n/g, '\n').replace(/\\(.)/g, '$1');
  };

  const SITE = /(?:(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*)?\b([A-Za-z_$][\w$]*)\s*\.\s*(indexOf|lastIndexOf)\(\s*(['"`])((?:[^'"`\\\n]|\\.){3,})\4\s*(,)?/g;

  const occurrences = (hay, needle) => {
    let n = 0, at = 0;
    while ((at = hay.indexOf(needle, at)) !== -1) { n++; at += needle.length; }
    return n;
  };

  let anchors = 0;
  for (const f of auditFiles) {
    if (f === 'audit-audit-hygiene.mjs') continue;
    const code = stripComments(readFileSync(join(ROOT, 'tests', f), 'utf8'));
    const bind = bindSourceVars(code);
    if (!bind.size) continue;
    const lines = code.split('\n');
    const cache = new Map();

    for (const m of code.matchAll(SITE)) {
      const rel = bind.get(m[2]);
      if (!rel) continue;
      const lineNo = code.slice(0, m.index).split('\n').length;
      const needle = anchorAt(m, lines, lineNo);
      if (needle === null) continue;
      if (!cache.has(rel)) {
        try { cache.set(rel, stripComments(readFileSync(join(ROOT, rel), 'utf8'))); }
        catch { cache.set(rel, null); }
      }
      const target = cache.get(rel);
      if (!target) continue;
      const n = occurrences(target, needle);
      if (n === 0) continue;              // section 1's problem, not this one
      anchors++;
      check(`${f}:${lineNo} window anchor is unique in ${rel}`, n === 1,
        `"${truncate(needle)}" occurs ${n} times — indexOf takes the FIRST, which ` +
        `may be a call site rather than the definition, so the window sliced here ` +
        `is not the one this check reasons about. Anchor on the definition ` +
        `("\\n  name() {", "function name(", "export const name =") or pass a ` +
        `start offset`);
    }
  }

  // Positive controls, for the reason the two checks above give: every live
  // anchor in the suite is unique, so a subject count cannot separate "clean"
  // from "the detector stopped matching".
  const drive = (src) => {
    const code = stripComments(src);
    const bind = bindSourceVars(code);
    const lines = code.split('\n');
    const out = [];
    for (const m of code.matchAll(SITE)) {
      if (!bind.get(m[2])) continue;
      const lineNo = code.slice(0, m.index).split('\n').length;
      const needle = anchorAt(m, lines, lineNo);
      if (needle !== null) out.push(needle);
    }
    return out;
  };
  const READ = `const pipeline = read('src/core/Pipeline.js');\n`;
  check('detector sees an anchor hoisted into a variable then sliced',
    drive(READ + `const i = pipeline.indexOf('_ensureBokehMaskRT');\n`
               + `const body = pipeline.slice(i, i + 400);`).length === 1);
  check('detector sees an inline slice anchor',
    drive(READ + `const b = pipeline.slice(pipeline.indexOf('bokeh: ('), 900);`).length === 1);
  check('detector ignores a scoped search that passes a start offset',
    drive(READ + `const j = pipeline.indexOf('\\n  }', i + 10);\n`
               + `const body = pipeline.slice(i, j);`).length === 0);
  check('detector ignores a lookup that never becomes a window',
    drive(READ + `check('present', pipeline.indexOf('uRadius') !== -1);`).length === 0);
  check('detector ignores an unresolvable template anchor',
    drive(READ + 'const i = pipeline.indexOf(`${name}: this._mat(`);\n'
               + 'const body = pipeline.slice(i, i + 200);').length === 0);
  // The historical incident itself, end to end: the bare name really is
  // ambiguous in the file it was used against, and the fix really is unique.
  {
    const pipeline = stripComments(readFileSync(join(ROOT, 'src/core/Pipeline.js'), 'utf8'));
    check('the 2026-08-30 bare-name anchor is genuinely ambiguous',
      occurrences(pipeline, '_ensureBokehMaskRT') > 1,
      `Pipeline.js no longer contains both a call and a definition, so this ` +
      `control has gone stale — point it at another method that does`);
    check('…and the definition anchor that replaced it is unique',
      occurrences(pipeline, '\n  _ensureBokehMaskRT() {') === 1);
  }
  console.log(`  note  ${anchors} window anchor(s) in the suite, all unambiguous`);
}

// ── A NEGATED source-text assertion must have a mutation behind it ──────────
//
// Promotes 2026-08-15. A regex over source asserts a SPELLING, and the defect
// it guards against usually has more than one. A POSITIVE assertion fails safe
// — rearrange the tokens and it stops matching, so the check goes red and
// someone looks. A NEGATED one fails OPEN: the same rearrangement makes it stop
// matching and the check PASSES, on code that now contains the exact fault it
// names.
//
// That is not hypothetical, and it is not rare enough to shrug at. Every one of
// the three negated source assertions in this suite was walked around by an
// ordinary rewrite the first time a mutation was pointed at it:
//
//   audit-sw-cache-bump  `!includes("__APP_VERSION__")`
//       -> `import.meta.env.VITE_APP_VERSION` — a different spelling of the
//          same fatal thing, since public/ never passes through Vite at all
//   audit-sw-cache-bump  `!/^\s*import\s/m`
//       -> `await import('./assets/util.js')` mid-line, equally fatal at
//          registration and not at the start of a line
//   audit-mapping-autosave  `!/serializeControllers\(\)/`
//       -> `serializeControllers(ps)`, the ordinary way a call evolves
//
// All three are now structural and all three are in tests/mutations.mjs. This
// check keeps the next one honest: if you write a negated source assertion, the
// suite requires a mutation proving the rearrangement is caught, because
// reading the regex is exactly what failed to find these.
console.log('\nNegated source assertions are backed by a mutation');
{
  const mutations = readFileSync(join(ROOT, 'tests/mutations.mjs'), 'utf8');
  let negated = 0;

  // KNOWN DEBT, measured 2026-09-03. Six audits carry negated source assertions
  // with no mutation behind them. They are listed rather than fixed because
  // each needs a plausible rearrangement written and confirmed caught, which is
  // real work and not this change.
  //
  // This list may only SHRINK. Adding a name to it is not a fix — it is a
  // decision to ship a check that can pass over broken code, and the next
  // section asserts every name here is still genuinely uncovered, so an entry
  // that has since been given a mutation fails until it is deleted. A NEW
  // negated assertion in an audit outside this list fails immediately, which is
  // the whole point: the debt is bounded and the door is shut behind it.
  // Three names came off this list within an hour of it being written, which is
  // the behaviour it was built for: each got a mutation, each mutation SURVIVED
  // on the first run, and each check was rewritten to ask about structure. The
  // staleness check below is what forced the removal — it failed the suite the
  // moment the mutations landed rather than letting the exemptions linger.
  const KNOWN_UNCOVERED = new Set([
    'audit-blend-percent.mjs',
    'audit-sdf-migration.mjs',
  ]);
  const stillUncovered = new Set();

  for (const f of auditFiles) {
    if (f === 'audit-audit-hygiene.mjs') continue;
    const code = stripComments(readFileSync(join(ROOT, 'tests', f), 'utf8'));
    const bind = bindSourceVarsShared(code);
    if (!bind.size) continue;

    const srcLines = code.split('\n');
    srcLines.forEach((line, i) => {
      // The assertion may wrap: `check('label',` on one line and the negation
      // on the next is ordinary formatting, and a line-scoped test missed
      // exactly one of the suite's three sites that way — a detector that only
      // sees the tidy spelling is the very thing this section is about.
      const ctx = srcLines.slice(Math.max(0, i - 2), i + 1).join('\n');
      if (!/\b(check|ok|assert)\s*\(/.test(ctx)) return;
      const negRe = /!\s*\/[^\n]*?\/\w*\s*\.test\s*\(\s*([A-Za-z_$][\w$]*)/.exec(line);
      const negInc = /!\s*([A-Za-z_$][\w$]*)\s*\.\s*(?:includes|match)\s*\(/.exec(line);
      const v = negRe?.[1] ?? negInc?.[1];
      if (!v || !bind.has(v)) return;
      negated++;
      if (!mutations.includes(`'${f}'`)) stillUncovered.add(f);
      check(`${f}:${i + 1} negated source assertion has a mutation`,
        mutations.includes(`'${f}'`) || KNOWN_UNCOVERED.has(f),
        `this asserts a pattern is ABSENT from ${bind.get(v)}, which passes the ` +
        `moment someone spells the fault differently — the failure mode is a ` +
        `GREEN check over broken code. Add an entry to tests/mutations.mjs with ` +
        `audit: '${f}' that rearranges the tokens, and confirm npm run mutate ` +
        `reports it caught`);
    });
  }

  // Positive controls, for the reason the other sections give: every live site
  // is covered now, so a subject count cannot separate "clean" from "the
  // detector stopped matching".
  const READ = `const css = readFileSync(resolve(root, 'src/style.css'), 'utf8');\n`;
  const detect = (src) => {
    const code = stripComments(src);
    const bind = bindSourceVarsShared(code);
    const ls = code.split('\n');
    return ls.some((line, i) => {
      if (!/\b(check|ok|assert)\s*\(/.test(ls.slice(Math.max(0, i - 2), i + 1).join('\n'))) return false;
      const a = /!\s*\/[^\n]*?\/\w*\s*\.test\s*\(\s*([A-Za-z_$][\w$]*)/.exec(line);
      const b = /!\s*([A-Za-z_$][\w$]*)\s*\.\s*(?:includes|match)\s*\(/.exec(line);
      const v = a?.[1] ?? b?.[1];
      return !!v && bind.has(v);
    });
  };
  check('detector flags a negated regex over source',
    detect(READ + `check('not scaled', !/env\\(.*var\\(--ui-scale\\)/.test(css));`));
  check('detector flags a negated includes over source',
    detect(READ + `check('absent', !css.includes('--ui-scale'));`));
  check('detector ignores a POSITIVE source assertion',
    !detect(READ + `check('present', /var\\(--ui-scale\\)/.test(css));`));
  check('detector ignores a negation over something that is not a source file',
    !detect(`const labels = ['a'];\ncheck('none', !labels.includes('b'));`));
  // The debt list must not go stale. An audit that has since gained a mutation
  // stays on this list only by someone forgetting, and a forgotten exemption is
  // how a bounded debt becomes a permanent hole.
  for (const f of KNOWN_UNCOVERED) {
    check(`${f} is still genuinely uncovered (else remove it from KNOWN_UNCOVERED)`,
      stillUncovered.has(f),
      `it now has a mutation, or no longer carries a negated source assertion — ` +
      `delete it from the list so the next one cannot hide behind it`);
  }
  console.log(`  note  ${negated} negated source assertion(s); ` +
    `${negated - [...stillUncovered].length} covered, ` +
    `${KNOWN_UNCOVERED.size} audit(s) on the shrinking debt list`);
}

function truncate(s) { return s.length > 46 ? s.slice(0, 43) + '…' : s; }

console.log(failures
  ? `\n${failures} FAILURE(S)\n\nFix: a source-text check must read the SOURCE, not the argument for it.\nStrip /* */ and // before matching, and guard indexOf against -1 before\ncomparing two positions. Prefer a behavioural check whenever the module can\nbe imported at all.\n`
  : '\nAll audit-hygiene checks passed.\n');
process.exit(failures ? 1 : 0);
