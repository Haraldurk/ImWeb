/**
 * Detached-panel layout audit.
 *
 * Three properties, each of which fails silently in a different place.
 *
 * 1. KEY UNIQUENESS. Sixty-three of the sixty-nine panel sections carry no id,
 *    so their saved identity is a slug of the header title. Two sections
 *    sharing a title would share one saved window: detach both, and the second
 *    overwrites the first's position while the first can never be restored.
 *    Nothing anywhere would report it — the app would simply "forget" one
 *    window. Same shape as the flow-display registry lesson (2026-08-05): a
 *    second table keyed by the same id must be asserted to agree.
 *
 * 2. THE CLAMP. Its whole reason for existing is a window detached on a second
 *    monitor and restored on the laptop alone, which is not reproducible on one
 *    display — so clampPos/clampSize are pure functions of the viewport and are
 *    exercised here with the numbers the machines actually report. The
 *    load-bearing assertion is that the TITLE BAR survives: it is the only
 *    handle a window has, and a window whose title bar is off-screen cannot be
 *    moved, resized or closed by any gesture the app offers. The failure is
 *    permanent — the layout autosaves, so it comes back off-screen every boot.
 *
 * 3. THE CAPTURE BOUNDARY. Layout is per-origin + project file, never a Display
 *    State: states are recalled live from MIDI, so layout in a state would
 *    rearrange the windows mid-performance and race a hand on the title bar.
 *    Precedent: UI scale, asserted the same way in audit-ui-scale.mjs.
 *
 * Plus the pair check that a persisted thing needs both halves — a capture with
 * no restore is a file that grows a key nobody reads.
 *
 * Run:  node tests/audit-panel-layout.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import {
  sectionKey,
  clampPos,
  clampSize,
  normalizeLayout,
  loadPanelLayout,
  savePanelLayout,
  MARGIN,
  TITLE_H,
  MIN_W,
  MIN_H,
} from '../src/ui/layout/PanelLayout.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

// ── 1. Every detachable section has a distinct key ───────────────────────────
console.log('\nsection keys');

const html = readFileSync(resolve(root, 'index.html'), 'utf8');
const mainSrc = readFileSync(resolve(root, 'src/main.js'), 'utf8');

// Markup sections: <div class="panel-section" [id=...]> followed by the first
// .section-header, whose first text node is the title (the header also holds
// the ⊞/⊟ button div, which is why _detachSection reads childNodes[0]).
const sections = [];
const SEC = /<div([^>]*class="[^"]*panel-section[^"]*"[^>]*)>/g;
for (let m; (m = SEC.exec(html)); ) {
  const id = /id="([^"]+)"/.exec(m[1])?.[1] ?? null;
  const title =
    /class="section-header"[^>]*>\s*([^<\n]*)/.exec(html.slice(m.index, m.index + 2000))?.[1]?.trim() ?? '';
  sections.push({ id, title, where: 'index.html' });
}
check('the markup scan found the panel sections (not vacuous)',
  sections.length > 50, `found ${sections.length}`);

// Sections built in JS. These are the ones a markup-only scan would miss, and
// one of them (I/O) has a hand-wired detach button, so it is detachable and
// must have a key like any other.
const JS_SECTION = /className\s*=\s*['"]section-header['"];?[\s\S]{0,200}?\.textContent\s*=\s*['"]([^'"]+)['"]/g;
for (let m; (m = JS_SECTION.exec(mainSrc)); ) {
  sections.push({ id: null, title: m[1].trim(), where: 'src/main.js' });
}
check('the JS scan found the runtime-built sections',
  sections.some(s => s.where === 'src/main.js'),
  'Hypercube and I/O are created in main.js, not in the markup');

// sectionKey() reads the DOM; replay its rule on the scraped pairs so the audit
// tests the shipped function rather than a copy of its logic.
const stub = ({ id, title }) => ({
  id,
  querySelector: () => ({ childNodes: [{ textContent: title }] }),
});
const keys = new Map();
const dupes = [];
for (const s of sections) {
  const k = sectionKey(stub(s));
  if (!k) { dupes.push(`${s.where}: section with no id and no title`); continue; }
  if (keys.has(k)) dupes.push(`${k} — ${keys.get(k)} and ${s.where}/${s.title}`);
  else keys.set(k, `${s.where}/${s.title}`);
}
check('every panel section has a distinct layout key', dupes.length === 0, dupes.join('; '));
check('the key derivation is exercised (not vacuous)', keys.size > 50, `${keys.size} keys`);

// ── 2. The clamp ─────────────────────────────────────────────────────────────
console.log('\nviewport clamping');

// A 13" laptop, and the external display the window was placed on.
const LAP_W = 1440, LAP_H = 900;

{
  // The case the clamp exists for: detached at x=3000 on a 3840px desktop,
  // reopened with only the laptop attached.
  const { w, h } = clampSize(360, 500, LAP_W, LAP_H);
  const p = clampPos(3000, 200, w, h, LAP_W, LAP_H);
  check('a window from a second monitor lands inside the laptop viewport',
    p.x >= 0 && p.x + w <= LAP_W, `x=${p.x} w=${w}`);
}

{
  // A window saved far below the bottom of a taller screen. Stated as the
  // consequence rather than as the arithmetic: what breaks is that the title
  // bar — the only handle — is unreachable, and the layout autosaves, so it
  // comes back unreachable on every boot.
  const { w, h } = clampSize(360, 2000, LAP_W, LAP_H);
  const p = clampPos(100, 5000, w, h, LAP_W, LAP_H);
  check('the title bar is never below the bottom edge',
    p.y + TITLE_H <= LAP_H, `y=${p.y}`);
  check('an oversized window is cut to the viewport', h <= LAP_H, `h=${h}`);
  check('and the whole of it is in view once it has been cut',
    p.y + h <= LAP_H, `y=${p.y} h=${h}`);
}

{
  // Negative coordinates: a monitor arranged to the LEFT of the laptop reports
  // them, and they are the direction where "it opened somewhere I cannot see"
  // is hardest to notice, because nothing about the app looks wrong.
  const p = clampPos(-2400, -60, 360, 500, LAP_W, LAP_H);
  check('a window from a display left of the main one comes back on screen',
    p.x >= MARGIN && p.y >= MARGIN, `x=${p.x} y=${p.y}`);
}

{
  // The other half of the rule: a window already on screen must not be nudged.
  // A clamp that moves everything is as wrong as one that moves nothing, and it
  // would creep a window a few px per reload, which reads as a rendering
  // artefact rather than as a bug.
  const p = clampPos(400, 300, 360, 500, LAP_W, LAP_H);
  check('a window already inside the viewport is left exactly where it was',
    p.x === 400 && p.y === 300, `${p.x},${p.y}`);
  const s = clampSize(360, 500, LAP_W, LAP_H);
  check('a size that already fits is unchanged', s.w === 360 && s.h === 500);
}

{
  // A viewport narrower than the window's own CSS min-width. Clamping to
  // vw - 2*MARGIN would return a width below min-width, which the browser
  // ignores — so the stored size and the real one diverge and the position
  // clamp is then computed against a width the window does not have.
  const s = clampSize(360, 500, 200, 200);
  check('the clamp never returns a size below .detached-panel min-width',
    s.w >= MIN_W, `w=${s.w}`);
  // Too big for the viewport in both axes: park it at the margin so the title
  // bar is the part that survives, rather than pushing it to the last line of
  // the screen with the whole body below it.
  const p = clampPos(500, 500, s.w, s.h, 200, 200);
  check('an unfittable window is parked at the margin, not off-screen',
    p.x === MARGIN && p.y === MARGIN, `${p.x},${p.y}`);
  check('its title bar is on screen even then', p.y + TITLE_H <= 200);
}

{
  // A viewport SHORTER than .detached-panel's min-height — a slim window, or a
  // phone in landscape once the browser chrome is subtracted. This is the only
  // configuration in which the vertical max goes negative, and it is the one
  // the first draft of this audit missed: `clampSize` floors the height at
  // MIN_H, so every viewport of a sane height leaves the window fitting and the
  // guard on the upper bound untested. Found by `npm run mutate`, not by
  // reading — the mutation that drops `Math.max(MARGIN, …)` from maxY survived
  // a full green run.
  const s = clampSize(400, 500, 900, 60);
  check('a viewport shorter than the window still fits the size to min-height',
    s.h >= MIN_H, `h=${s.h}`);
  const p = clampPos(100, 100, s.w, s.h, 900, 60);
  check('a window taller than the whole viewport keeps its title bar on screen',
    p.y >= 0 && p.y + TITLE_H <= 60, `y=${p.y}`);
}

{
  // Missing size — a window that was never resized has no stored w/h and must
  // stay auto-sized rather than being given a number.
  const s = clampSize(null, null, LAP_W, LAP_H);
  check('an unresized window keeps its natural size', s.w === null && s.h === null);
}

// ── 3. Corrupt storage cannot stop the instrument booting ────────────────────
console.log('\nstorage tolerance');

for (const [label, raw] of [
  ['a truncated JSON blob', '{"v":1,"panels":[{"key"'],
  ['a blob of the wrong shape', '{"panels":"nope"}'],
  ['a null', 'null'],
  ['a bare array (a plausible future format)', '[{"key":"layers"}]'],
]) {
  let out, threw = false;
  try { out = loadPanelLayout({ getItem: () => raw }); } catch { threw = true; }
  check(`${label} loads as an empty layout rather than throwing`,
    !threw && Array.isArray(out) && out.length === 0);
}
check('a storage that throws on read (private mode) is survivable',
  loadPanelLayout({ getItem() { throw new Error('denied'); } }).length === 0);
{
  let threw = false;
  try { savePanelLayout([], { setItem() { throw new Error('quota'); } }); } catch { threw = true; }
  check('a storage that throws on write is survivable', !threw);
}
{
  const out = normalizeLayout({ panels: [{ key: 'a', x: 'NaN', y: null }, { x: 1 }, null] });
  check('junk entries are dropped and junk coordinates defaulted',
    out.length === 1 && out[0].key === 'a' && Number.isFinite(out[0].x));
}

// ── 4. Capture boundary ──────────────────────────────────────────────────────
console.log('\ncapture boundary');

const psSrc = readFileSync(resolve(root, 'src/controls/ParameterSystem.js'), 'utf8');
check('panel layout is not a ParameterSystem parameter',
  !/id:\s*["'][^"']*panelLayout["']|id:\s*["']ui\.layout["']/.test(psSrc),
  'a captured layout would rearrange the windows on a MIDI state recall');

const plSrc = readFileSync(resolve(root, 'src/ui/layout/PanelLayout.js'), 'utf8');
check('it is persisted per-origin in localStorage',
  /PANEL_LAYOUT_KEY\s*=\s*["']imweb\.panelLayout["']/.test(plSrc));

const pf = readFileSync(resolve(root, 'src/io/ProjectFile.js'), 'utf8');
check('the .imweb file writes the layout', /panelLayout:\s*this\.extras\.panelLayout/.test(pf));
// Both halves, always. A capture with no restore is a key that grows in every
// saved file and is read by nothing; a restore with no capture reads a key that
// is never written. Either one looks like a working feature from one side.
check('the .imweb file reads it back', /extras\.panelLayout\.restore\(/.test(pf));
check('an import before the UI is built stashes rather than drops it',
  /pendingPanelLayout\s*=\s*data\.panelLayout/.test(pf) &&
  /projectFile\.pendingPanelLayout/.test(mainSrc),
  'the first-launch MasterProject import runs before the hook registers');

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll panel layout checks passed.\n');
process.exit(failures ? 1 : 0);
