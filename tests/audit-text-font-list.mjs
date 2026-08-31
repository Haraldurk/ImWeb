/**
 * Static audit: the Text layer's two font lists, and the append-only contract
 * that binds them.
 *
 * Why this exists. `text.font` is a SELECT, and a SELECT is persisted as an
 * INTEGER INDEX — by every .imweb project, .imbank bank, .imstate Display
 * State and MIDI mapping this instrument has ever written. The label list
 * lives in ParameterSystem.js and the family list it indexes lives in
 * TextLayer.js, in two files that no import connects. That is the exact shape
 * of the failure the project has already paid for twice: SOURCE_DEFS once had
 * six hand-copied copies of which three had silently drifted, and
 * `_sdfSrcToLayerIdx` mapped a menu to bare numbers against an older ordering,
 * where every index was in range and every option resolved to a real texture
 * three entries away from the one named.
 *
 * Nothing about that failure is loud. Pick "Orbitron", get Playfair. Open a
 * project saved last year, get a different typeface than the one it was
 * performed with. No error, no warning, no crash.
 *
 * Three invariants, each a bug class rather than one bug:
 *
 *   1. SAME LENGTH. If the menu is longer than FONTS, the extra options fall
 *      through `FONTS[i] ?? 'sans-serif'` and quietly render as plain sans —
 *      an option that exists, resolves, and lies.
 *   2. PREFIX FROZEN. Indices 0-4 ("Sans", "Serif", "Mono", "Bold", "Italic")
 *      and the five families behind them are what every pre-existing saved
 *      state means. Growth is only ever allowed at the END.
 *   3. FILES PRESENT. Every "IW <name>" family named in FONTS must have an
 *      @font-face rule in style.css AND the woff2 file that rule points at.
 *      A missing file is silent: Canvas 2D substitutes the default face, and
 *      because _render() only runs when something is dirty, the wrong face
 *      stays rasterised into the texture.
 *
 * Run:  node tests/audit-text-font-list.mjs
 */

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

const layer  = read('src/inputs/TextLayer.js');
const params = read('src/controls/ParameterSystem.js');
const css    = read('src/style.css');

console.log('\nText font-list alignment audit\n');

let failed = false;
const ok   = (m) => console.log(`  ok   ${m}`);
const fail = (m) => { console.error(`  FAIL ${m}`); failed = true; };

// The first five labels and families are the frozen prefix. These literals are
// the point of the check — do not regenerate them from the source they guard.
const FROZEN_LABELS   = ['Sans', 'Serif', 'Mono', 'Bold', 'Italic'];
const FROZEN_FAMILIES = [
  'sans-serif',
  'serif',
  '"IBM Plex Mono", monospace',
  'bold sans-serif',
  'italic serif',
];

/** Pull a bracketed array literal that follows `marker`, stripping comments. */
const arrayAfter = (src, marker) => {
  const i = src.indexOf(marker);
  if (i < 0) return null;
  const open = src.indexOf('[', i);
  if (open < 0) return null;
  let depth = 0, end = -1;
  for (let j = open; j < src.length; j++) {
    if (src[j] === '[') depth++;
    else if (src[j] === ']' && --depth === 0) { end = j; break; }
  }
  if (end < 0) return null;
  // Comments first: a family list is full of prose explaining the rule, and a
  // check that reads source text must strip comments or it matches them.
  const body = src.slice(open + 1, end)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
  return [...body.matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
};

const fonts  = arrayAfter(layer, 'const FONTS = ');
const labels = arrayAfter(params, 'id: "text.font"');

// ── 1. Same length ──────────────────────────────────────────────────────────

if (!fonts || !labels) {
  fail('could not locate FONTS or the text.font options (renamed? update this audit, do not delete it)');
} else if (fonts.length !== labels.length) {
  fail(`text.font has ${labels.length} options but FONTS has ${fonts.length} families — `
     + `the surplus resolves through "FONTS[i] ?? 'sans-serif'" and renders as plain sans`);
} else {
  ok(`text.font options and FONTS are the same length (${fonts.length})`);
}

// ── 2. Frozen prefix ────────────────────────────────────────────────────────

if (fonts && labels) {
  const badLabel = FROZEN_LABELS.findIndex((l, i) => labels[i] !== l);
  const badFam   = FROZEN_FAMILIES.findIndex((f, i) => fonts[i] !== f);
  if (badLabel >= 0) {
    fail(`text.font option ${badLabel} is "${labels[badLabel]}", was "${FROZEN_LABELS[badLabel]}" — `
       + 'indices 0-4 are persisted in saved states; append, never reorder');
  } else if (badFam >= 0) {
    fail(`FONTS[${badFam}] is "${fonts[badFam]}", was "${FROZEN_FAMILIES[badFam]}" — `
       + 'indices 0-4 are persisted in saved states; append, never reorder');
  } else {
    ok('indices 0-4 of both lists are unchanged (append-only contract holds)');
  }
}

// ── 3. Bundled faces are actually present ───────────────────────────────────

if (fonts) {
  const bundled = fonts
    .map((f) => f.match(/"(IW [^"]+)"/)?.[1])
    .filter(Boolean);

  if (!bundled.length) {
    ok('no bundled "IW *" faces declared — nothing to resolve');
  } else {
    const missingFace = bundled.filter(
      (fam) => !new RegExp(`font-family:\\s*"${fam}"`).test(css));
    const missingFile = bundled.flatMap((fam) => {
      const rule = css.match(
        new RegExp(`font-family:\\s*"${fam}"[^;}]*;[^}]*?url\\("([^"]+)"`));
      if (!rule) return [];
      const rel = rule[1].replace(/^\//, '');
      return existsSync(resolve(root, 'public', rel)) ? [] : [`${fam} → public/${rel}`];
    });

    if (missingFace.length) {
      fail(`FONTS names ${missingFace.join(', ')} with no @font-face in style.css — `
         + 'Canvas 2D substitutes the default face without erroring');
    } else if (missingFile.length) {
      fail(`@font-face points at a file that is not in the repo: ${missingFile.join(', ')}`);
    } else {
      ok(`every bundled face has an @font-face rule and a woff2 on disk (${bundled.length})`);
    }
  }
}

if (failed) {
  console.error('\nFAIL — the Text font lists have drifted apart.\n');
  process.exit(1);
}
console.log('\nText font lists are aligned.\n');
