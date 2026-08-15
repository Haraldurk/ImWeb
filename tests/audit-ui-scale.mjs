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

// The two configurations of ONE physical 4K monitor. Getting the same answer
// for both would mean the rule is reading the wrong thing.
check('4K at native 1× scales up (the reported case)',
  autoUiScale(1, 3840) === 2, `got ${autoUiScale(1, 3840)}`);
check('the same 4K panel in HiDPI is left alone',
  autoUiScale(2, 1920) === 1, `got ${autoUiScale(2, 1920)}`);

check('5K/retina-class desktop in HiDPI is left alone',
  autoUiScale(2, 2560) === 1, `got ${autoUiScale(2, 2560)}`);
check('1440p at 1× gets the intermediate step',
  autoUiScale(1, 2560) === 1.5, `got ${autoUiScale(1, 2560)}`);
check('an ordinary 1080p desktop is left alone',
  autoUiScale(1, 1920) === 1, `got ${autoUiScale(1, 1920)}`);
// screen.width is reported in CSS pixels, so the pair must be consistent: one
// 4K panel reports (1, 3840) at 100%, (1.25, 3072) at 125%, (1.5, 2560) at 150%.
check('a 4K panel at Windows 125% still gets the remaining half-step',
  autoUiScale(1.25, 3072) === 1.5, `got ${autoUiScale(1.25, 3072)}`);
check('a 4K panel at Windows 150% is left alone',
  autoUiScale(1.5, 2560) === 1, `got ${autoUiScale(1.5, 2560)}`);

// The default must be a no-op, or every existing user's UI moves.
check('the rule never scales DOWN',
  [[1, 800], [1, 1280], [2, 1440], [3, 1920]].every(([d, w]) => autoUiScale(d, w) >= 1));

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

// A `position: fixed; inset: 0` element zoomed by 2 becomes twice the viewport:
// the backdrop overflows and the card it centres drifts off-screen.
const SCRIMS = ['#onboarding', '#kb-help', '#docs-viewer', '#about-modal', '#panel-overlay'];
const zoomRules = [...css.matchAll(/([^{}]+)\{[^{}]*zoom:\s*var\(--ui-scale\)[^{}]*\}/g)]
  .map(m => m[1].split(',').map(s => s.trim()).filter(Boolean))
  .flat();

for (const s of SCRIMS) {
  check(`${s} (a full-viewport scrim) is not itself zoomed`,
    !zoomRules.includes(s),
    'zooming a full-viewport element pushes it past the viewport edge');
}
for (const box of ['#onboarding-box', '#kb-help-box', '#docs-viewer-box', '#about-box']) {
  check(`${box} carries the zoom instead`, zoomRules.includes(box));
}
check('the control panel is zoomed', zoomRules.includes('#control-panel'));
check('the status bar is zoomed', zoomRules.includes('#status-bar'));

// Zooming #output-panel would be self-defeating: applyResolution() sizes the
// renderer from canvas.parentElement.clientWidth, an UNZOOMED layout value, so
// the canvas would render small and be scaled up — the exact softness the 4K
// output preset exists to remove.
for (const never of ['#output-panel', '#output-canvas', 'body', 'html', ':root']) {
  check(`${never} is never zoomed`, !zoomRules.includes(never));
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
