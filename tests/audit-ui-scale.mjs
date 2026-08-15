/**
 * UI scale audit.
 *
 * Why this exists. Every font-size in style.css is an absolute px — 198 of
 * them, with 8px and 10px the two most common values. That is fine on a display
 * the OS is scaling, and unusable on one it is not: the SAME 4K monitor reports
 * devicePixelRatio 2 in HiDPI ("Looks like 1920×1080"), where 8px type is 16
 * device pixels and correct, and devicePixelRatio 1 at native 3840×2160, where
 * it is 8 device pixels at ~163 PPI — half its intended physical size. A beta
 * tester was dropping his monitor's resolution to read the panel at all, which
 * in turn made the picture soft, which arrived as an image-quality complaint.
 * One cause, two symptoms, and the wrong one was nearly fixed alone.
 *
 * The reason this is an audit and not a manual check: the case it exists for
 * CANNOT BE REPRODUCED on the developer's machine. A Retina laptop reports
 * devicePixelRatio 2 and screen.width 1792 — autoUiScale()'s entire DPR-1
 * branch, the only branch Tom's monitor will ever take, is dead code locally.
 * Resizing the browser viewport to 3840 does not help: that changes innerWidth,
 * not the pixel density, and density is the whole signal. So the rule is a pure
 * function of (dpr, screenW) and is exercised here with the values the machines
 * actually report.
 *
 * The layout half is checked statically: `zoom` on a full-viewport scrim
 * multiplies it past the viewport edge, so scrims must stay unzoomed and their
 * inner box must carry the zoom instead — and #app, the one element that is not
 * zoomed but must clear chrome that is, has to multiply the bar heights itself.
 *
 * Run:  node tests/audit-ui-scale.mjs
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

const cssRaw = readFileSync(resolve(root, 'src/style.css'), 'utf8');
// Strip comments before any structural parsing. The zoom rules are documented
// at length, and those comments NAME the selectors they are talking about —
// "#onboarding, #kb-help, #docs-viewer ... are all scrims" parses as a selector
// list if you let it, and this audit duly reported #kb-help as zoomed when it
// is not. Prose about a selector is not a rule about it.
const css = cssRaw.replace(/\/\*[\s\S]*?\*\//g, '');
const lm = readFileSync(resolve(root, 'src/ui/layout/LayoutManager.js'), 'utf8');

// ── 1. The auto rule, on the values real machines report ─────────────────────
console.log('\nautoUiScale — density, not viewport width');

const { autoUiScale, storedUiScale } = await import(
  new URL('../src/ui/layout/LayoutManager.js', import.meta.url).href
);

// screen.* is reported in CSS px, so each triple must be internally consistent:
// ONE 4K panel reports (1, 3840, 2160) at 100% and (2, 1920, 1080) in HiDPI.
const CASES = [
  // dpr,  screenW, screenH, expect, what it is
  [1,    3840, 2160, 2,   '4K at native 1× — the reported case'],
  [2,    1920, 1080, 1,   'the same 4K panel in HiDPI'],
  [1,    2160, 3840, 2,   '4K in PORTRAIT — dense, and the width test missed it'],
  [1,    5120, 2880, 2,   '5K at 1×'],
  [2,    2560, 1440, 1,   '5K iMac in HiDPI'],
  [1,    3440, 1440, 1,   'ultrawide — 110 PPI, the width test doubled it'],
  [1,    5120, 1440, 1,   'super-ultrawide — same trap, wider'],
  [1,    2560, 1440, 1,   '27in 1440p at 1× — ordinary density'],
  [1,    1920, 1080, 1,   'an ordinary 1080p desktop'],
  [1.25, 3072, 1728, 1.5, '4K at Windows 125% — partial OS compensation'],
  [1.5,  2560, 1440, 1.25,'4K at Windows 150%'],
  [2,    1792, 1120, 1,   'this dev machine — must be a no-op'],
];
for (const [dpr, w, h, want, what] of CASES) {
  const got = autoUiScale(dpr, w, h);
  check(`${what} → ${want}×`, got === want, `got ${got}`);
}

// The default must never scale DOWN, or every existing user's UI shrinks.
check('the rule never returns less than 1',
  CASES.every(([d, w, h]) => autoUiScale(d, w, h) >= 1) &&
  [[3, 1920, 1080], [1, 640, 480], [4, 1024, 768]].every(([d, w, h]) => autoUiScale(d, w, h) >= 1));

// Auto must only ever land on a value the control actually offers, or the
// select shows a blank and the user cannot get back to what they had.
const LADDER = new Set([1, 1.25, 1.5, 1.75, 2]);
check('every auto result is on the control ladder',
  CASES.every(([d, w, h]) => LADDER.has(autoUiScale(d, w, h))));

// ── 2. The stored override ───────────────────────────────────────────────────
console.log('\nstoredUiScale — the user overrides the rule');

check('absent means "follow the rule"', storedUiScale(null) === null);
check('"auto" means "follow the rule"', storedUiScale('auto') === null);
check('a chosen value wins over the rule', storedUiScale('1.5') === 1.5);
check('garbage falls back to the rule', storedUiScale('banana') === null);
// A value large enough to push the control that fixes it off-screen would trap
// the user with no route back but devtools.
check('an absurd stored value is clamped, not obeyed', storedUiScale('12') === 3,
  `got ${storedUiScale('12')}`);
check('a tiny stored value is clamped too', storedUiScale('0.01') === 0.75,
  `got ${storedUiScale('0.01')}`);

// ── 3. Scrims must not be zoomed; their inner box must be ────────────────────
console.log('\nzoom targets');

// Parse the stylesheet into rules once, and DERIVE both sets from it.
//
// The first version of this audit hardcoded `SCRIMS = [five selectors]`, which
// is a check that can only pass while the list is complete — and it was not:
// #glsl-ai-modal was a sixth scrim nobody had listed, and #mobile-state-modal
// was a seventh that was actually IN the zoom set, i.e. the live instance of
// the bug the audit claimed to prevent. An enumeration cannot catch the next
// one. Deriving the set means a new `position: fixed; inset: 0` rule is
// classified automatically, or fails here.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
  .map(m => ({ sel: m[1].trim().replace(/\s+/g, ' '), body: m[2] }));

const zoomRules = [];
for (const r of rules) {
  if (/zoom:\s*var\(--ui-scale\)/.test(r.body)) {
    r.sel.split(',').map(s => s.trim()).filter(Boolean).forEach(s => zoomRules.push(s));
  }
}
check('the zoom set is non-empty (the parse actually worked)', zoomRules.length > 5);

// A `position: fixed; inset: 0` element zoomed by 2 becomes twice the viewport:
// the backdrop overflows and the card it centres drifts off-screen.
const scrims = rules
  .filter(r => /position:\s*fixed/.test(r.body) &&
    (/inset:\s*0/.test(r.body) || (/top:\s*0/.test(r.body) && /bottom:\s*0/.test(r.body))))
  .flatMap(r => r.sel.split(',').map(s => s.trim()));

check('the stylesheet still has full-viewport scrims to check', scrims.length >= 5);
for (const s of scrims) {
  check(`${s} (full-viewport, fixed) is not itself zoomed`,
    !zoomRules.includes(s),
    'zooming a full-viewport element pushes it past the viewport edge');
}
for (const box of ['#onboarding-box', '#kb-help-box', '#docs-viewer-box', '#about-box']) {
  check(`${box} carries the zoom instead`, zoomRules.includes(box));
}
check('the control panel is zoomed', zoomRules.includes('#control-panel'));
check('the status bar is zoomed', zoomRules.includes('#status-bar'));
check('the controller popover is zoomed (the badge-workflow editor)',
  zoomRules.includes('.ctrl-popover'));

// ── 3b. Viewport units and env() inside the zoom set ─────────────────────────
console.log('\nviewport units under zoom');

// Inside a zoomed subtree, `80vh` resolves against the UNZOOMED viewport and is
// then multiplied — 160vh at 2×, which clipped the docs viewer's own titlebar
// off the top of the screen. `%` is fine (its containing block is zoomed too),
// px is fine. env() must not be multiplied at all: it describes a bezel.
const underZoom = (sel) => zoomRules.find((z) => {
  const base = z.replace(/\s*>\s*\*$/, '');
  return sel === base || sel.startsWith(base + ' ') || sel.startsWith(base + '.') ||
    sel.startsWith(base + ':') ||
    sel.replace(/^[#.]/, '').startsWith(base.replace(/^[#.]/, '') + '-');
});

let rawUnits = 0;
for (const r of rules) {
  const body = r.body.replace(/var\(--[a-z-]+\)/g, ''); // --vh/--vw are the FIX
  const hits = body.match(/[0-9.]+v[hw]\b|env\(/g);
  if (!hits) continue;
  for (const sel of r.sel.split(',').map(s => s.trim())) {
    if (underZoom(sel)) {
      console.error(`  FAIL ${sel} uses ${[...new Set(hits)].join(',')} inside the zoom set` +
        ' — use var(--vh) / var(--vw) / var(--safe-b)');
      rawUnits++; failures++;
    }
  }
}
check('no raw viewport unit or env() inside the zoom set', rawUnits === 0);

// And the converse: the helpers divide by --ui-scale, so using one OUTSIDE the
// zoom set shrinks the value with nothing to multiply it back.
let strayHelpers = 0;
for (const r of rules) {
  for (const decl of r.body.split(';')) {
    const [prop, ...rest] = decl.split(':');
    const value = rest.join(':');
    if (!/var\(--(?:vh|vw|safe-b)\)/.test(value)) continue;
    // A CUSTOM property is not a used length — it is a token that some other
    // element resolves later, and that element may well be zoomed. The mobile
    // `:root { --ctrl-w: calc(100 * var(--vw)) }` is exactly this: the value is
    // consumed by #control-panel, which IS in the zoom set, so it is correct.
    // Only a real property declaration commits to a coordinate space here.
    if (prop.trim().startsWith('--')) continue;
    for (const sel of r.sel.split(',').map(s => s.trim())) {
      if (!underZoom(sel)) {
        console.error(`  FAIL ${sel} sets ${prop.trim()} from --vh/--vw/--safe-b` +
          ' but is not in the zoom set — the division would never be undone');
        strayHelpers++; failures++;
      }
    }
  }
}
check('no scale-divided helper used outside the zoom set', strayHelpers === 0);

// Zooming #output-panel would be self-defeating: applyResolution() sizes the
// renderer from canvas.parentElement.clientWidth, an UNZOOMED layout value, so
// the canvas would render small and be scaled up — the exact softness the 4K
// output preset exists to remove.
for (const never of ['#output-panel', '#output-canvas', 'body', 'html', ':root']) {
  check(`${never} is never zoomed`, !zoomRules.includes(never));
}

// ── 3c. No raw viewport→style.left writes anywhere in the UI ─────────────────
console.log('\ncoordinate spaces in JS');

// The bug class that review found three live instances of: `getBoundingClientRect`,
// `clientX/clientY` and `innerWidth/innerHeight` are VIEWPORT px (already
// multiplied by zoom); `style.left/top` and `offsetLeft/offsetTop` are
// ELEMENT-LOCAL px (multiplied on the way out). Mixing them double-scales.
// At scale 1 the two spaces are identical, so nothing is ever wrong in testing
// on a normal display — which is exactly why this has to be mechanical.
//
// The rule: floating elements are positioned through setViewportPos(), which
// does the one conversion. A bare `style.left = <something>px` in these files
// is either a bug or needs to justify itself.
const JS_FILES = [
  'src/main.js',
  'src/ui/UI.js',
  'src/ui/components/CtrlPopover.js',
];
// The check is deliberately narrow: a style.left/top write is only suspect when
// the value FED INTO IT came from viewport space. A write driven by local
// geometry (offsetLeft/offsetWidth) is self-consistent — both sides share a
// ruler — and a write of a stored//computed number is nobody's business here.
// Broadening this to every style.left write flags ~23 legitimate lines, most of
// them overlays inside the unzoomed #output-panel, and an audit that cries wolf
// 23 times is one nobody will read on the day it is right.
// Which JS variables refer to an element that IS in the zoom set? Derived from
// the zoom set itself, not listed here — so a newly-zoomed element is covered
// the moment it joins, which is the property the scrim check lacked and paid
// for. An element positioned in viewport space while UNZOOMED is correct and
// must not be flagged: #h-tl..#h-bl (corner-pin handles, which have to track
// the picture, not the chrome) and .feedback-item (inside the unzoomed output
// overlay) are both in that category and are the reason this is targeted.
const zoomNames = zoomRules
  .map(s => s.replace(/\s*>\s*\*$/, '').match(/^[#.]([\w-]+)$/)?.[1])
  .filter(Boolean);

const POS_WRITE = /(\w+)\.style\.(?:left|top)\s*=/;
const VIEWPORT_SRC = /client[XY]|innerWidth|innerHeight|getBoundingClientRect|\b\w*[Rr]ect\.(?:left|right|top|bottom)\b/;
const LOCAL_SRC = /offset(?:Left|Top|Width|Height)/;
let bareWrites = 0;
let scanned = 0;
for (const f of JS_FILES) {
  const src = readFileSync(resolve(root, f), 'utf8');
  const lines = src.split('\n');

  // Every point where a variable is bound to SOME element, with whether that
  // element is in the zoom set. Nearest preceding binding wins — `el` and
  // `panel` are rebound all over these files, and a file-wide set would report
  // an unzoomed .feedback-item as zoomed purely because some other `el` is.
  const BIND = /(?:const|let|var)\s+(\w+)\s*=|(\w+)\.(?:className|id)\s*=/;
  const bindings = [];
  lines.forEach((line, i) => {
    const m = BIND.exec(line);
    if (!m) return;
    const name = m[1] || m[2];
    const zoomed = zoomNames.some(n =>
      new RegExp(`["'\`][#.]?${n}(?:[\\s"'\`])`).test(line));
    bindings.push({ i, name, zoomed });
  });
  scanned += bindings.filter(b => b.zoomed).length;

  const isZoomedAt = (name, at) => {
    let last = null;
    for (const b of bindings) {
      if (b.i > at) break;
      if (b.name === name) last = b;
    }
    return last?.zoomed === true;
  };

  lines.forEach((line, i) => {
    const m = POS_WRITE.exec(line);
    if (!m) return;
    if (!isZoomedAt(m[1], i)) return;  // not a zoomed element — correct as-is
    if (LOCAL_SRC.test(line)) return;  // local geometry, self-consistent
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n');
    if (!VIEWPORT_SRC.test(ctx)) return;
    console.error(`  FAIL ${f}:${i + 1} writes a viewport coordinate into ${m[1]}.style` +
      ' — that element is zoomed; use setViewportPos()');
    bareWrites++; failures++;
  });
}
check('the scan actually resolved zoomed elements in JS (not vacuous)', scanned >= 3,
  `resolved ${scanned}`);
check('no zoomed element is positioned from a raw viewport coordinate',
  bareWrites === 0);

check('setViewportPos and elementZoom are exported for those call sites',
  /export function setViewportPos/.test(lm) && /export function elementZoom/.test(lm));

// A drag loop must not subtract a local offset from a viewport coordinate.
for (const f of ['src/main.js']) {
  const src = readFileSync(resolve(root, f), 'utf8');
  check(`${f}: no drag grabs an offset as clientX - offsetLeft`,
    !/client[XY]\s*-\s*\w+\.offset(?:Left|Top)/.test(src),
    'mixes viewport and local px — the panel jumps on grab and tracks at scale× speed');
}

// ── 4. #app compensates for chrome it does not share the zoom with ───────────
console.log('\n#app offsets');

const appRule = /#app\s*\{([\s\S]*?)\}/.exec(css)?.[1] ?? '';
check('#app top multiplies --status-h by --ui-scale',
  /top:\s*calc\(\s*var\(--status-h\)\s*\*\s*var\(--ui-scale\)\s*\)/.test(appRule),
  'without it #app sits under the zoomed status bar at any scale above 1');
check('#app bottom multiplies the two bottom bars by --ui-scale',
  /bottom:\s*calc\([\s\S]*var\(--signal-h\)[\s\S]*var\(--state-h\)[\s\S]*var\(--ui-scale\)/.test(appRule));
check('the safe-area inset is NOT multiplied',
  /env\(safe-area-inset-bottom[^)]*\)\s*\)?\s*;?\s*$|\+\s*env\(safe-area-inset-bottom/.test(appRule) &&
  !/var\(--ui-scale\)\s*\*\s*env\(|env\([^)]*\)\s*\*\s*var\(--ui-scale\)/.test(appRule),
  'the inset is a property of the device bezel, not of our type size');

// The multiply must live where body-level overrides are visible. body.sp-audio,
// body.statebar-hidden and body.signalpath-hidden all redefine these heights on
// BODY; a --status-h-out hoisted onto :root would resolve against :root's own
// value and silently ignore every one of them.
check('the heights are not pre-multiplied into :root variables',
  !/--(?:status|signal|state)-h-out\s*:/.test(css),
  'hoisting the calc to :root ignores the body.*-hidden overrides');
for (const cls of ['body.statebar-hidden', 'body.signalpath-hidden']) {
  check(`${cls} still overrides its height on body (the reason for the above)`,
    new RegExp(`${cls.replace('.', '\\.')}\\s*\\{[^}]*--(?:state|signal)-h`).test(css));
}

// ── 5. The breakpoint that used to claim this job ────────────────────────────
console.log('\nthe ≥2560px breakpoint');

const wide = /@media\s*\(min-width:\s*2560px\)\s*\{([\s\S]*?)\n\}/.exec(css)?.[1] ?? '';
check('the ≥2560px block still exists', wide.length > 0);
// It set body{font-size} to fix small text. Measured: it reached zero visible
// elements, because all 198 font-size declarations are set on the elements
// themselves and a declaration always beats inheritance.
check('it no longer pretends to fix type size with body { font-size }',
  !/body\s*\{[^}]*font-size/.test(wide),
  'that declaration was measured to reach zero elements — --ui-scale does this job now');

// ── 6. The scale is not captured by Display States ───────────────────────────
console.log('\ncapture boundary');

// The right value is a property of the MONITOR, not of the patch. A captured
// scale would travel to a machine with a different display and be wrong there
// — the same reason displace.warpSlot is excluded from capture.
const ps = readFileSync(resolve(root, 'src/controls/ParameterSystem.js'), 'utf8');
check('UI scale is not a ParameterSystem parameter',
  !/id:\s*["']ui\.scale["']|id:\s*["']output\.uiScale["']/.test(ps),
  'a captured scale would recall another monitor\'s value');
check('it is persisted per-origin in localStorage instead',
  /UI_SCALE_KEY\s*=\s*["']imweb\.uiScale["']/.test(lm));

console.log(failures ? `\n${failures} FAILURE(S)\n` : '\nAll UI scale checks passed.\n');
process.exit(failures ? 1 : 0);
