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

function truncate(s) { return s.length > 46 ? s.slice(0, 43) + '…' : s; }

console.log(failures
  ? `\n${failures} FAILURE(S)\n\nFix: a source-text check must read the SOURCE, not the argument for it.\nStrip /* */ and // before matching, and guard indexOf against -1 before\ncomparing two positions. Prefer a behavioural check whenever the module can\nbe imported at all.\n`
  : '\nAll audit-hygiene checks passed.\n');
process.exit(failures ? 1 : 0);
