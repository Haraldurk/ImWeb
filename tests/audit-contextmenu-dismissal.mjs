/**
 * Context-menu dismissal audit.
 *
 * Why this exists. A surface opened from a `contextmenu` event must be closed by
 * the next `pointerdown`, never by `click`. Pair the close gesture with the
 * phase the open gesture used, or the opening gesture closes the thing it just
 * opened.
 *
 * macOS fires `contextmenu` on the MOUSEDOWN of a Ctrl+click and then still
 * delivers a `click` on the release. A close-on-outside-click handler therefore
 * shuts the menu the instant the button comes back up. Four surfaces had this —
 * the parameter assignment menu, the controller badge popover, the state tile
 * menu and the Stills Buffer slot menu — which between them is the whole
 * controller-assignment grammar plus the state bar. It survived for years
 * because it is INVISIBLE to anyone testing with a real right button: a button-2
 * press emits no `click` at all, so a maintainer with two-finger secondary click
 * enabled can never reproduce it. It took a beta tester on a default trackpad.
 *
 * `setTimeout(…, 0)` before registering the listener is not a fix and reads like
 * one. The macrotask runs the moment the stack unwinds, tens of milliseconds
 * before a human lets go of the button. CtrlPopover.js HAD that guard and was
 * broken anyway.
 *
 * Two consequences the audit also covers:
 *
 *   - An element carrying BOTH a plain click action and a `contextmenu` handler
 *     must ignore modified clicks, or the stray release does not merely close
 *     the menu, it acts. A state tile RECALLED the state — a full instrument
 *     change, mid-performance — and a buffer cell selected a different frame.
 *   - Fixing the close REVEALS collisions the bug was hiding. Ctrl+click on a
 *     value means "type a number", and its `contextmenu` had always been opening
 *     the row menu too; nobody saw it because the menu shut itself on the
 *     release. The value column has to claim that press for itself.
 *
 * This cannot be a runtime check: every one of these failures is a menu that
 * appears and then correctly disappears. Nothing throws, and on a right-button
 * mouse nothing even misbehaves.
 *
 * Promoted from LEARNED.md 2026-08-09, [advisory] -> [audit].
 *
 * Run:  node tests/audit-contextmenu-dismissal.mjs
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');

let failures = 0;
const check = (label, cond, detail = '') => {
  if (cond) { console.log(`  ok   ${label}`); }
  else { console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`); failures++; }
};

/** The document-level dismissal listener nearest after `anchor`. */
const dismissalAfter = (src, anchor) => {
  const at = src.indexOf(anchor);
  if (at === -1) return null;
  const m = /document\s*\.\s*addEventListener\s*\(\s*["'`](\w+)["'`]/.exec(src.slice(at));
  return m ? m[1] : null;
};

// ── 1. Every contextmenu-opened surface dismisses on pointerdown ─────────────
// Named individually rather than pattern-matched: these are the four that burned
// us, and an assertion that says WHICH menu regressed is worth more than a count.
console.log('\ncontextmenu-opened surfaces close on pointerdown, not click');

const SURFACES = [
  {
    what: 'parameter assignment menu (ContextMenu._wire)',
    file: 'src/ui/UI.js',
    anchor: '  _wire() {',
  },
  {
    what: 'state tile menu (StateBar._wireMenu)',
    file: 'src/ui/UI.js',
    anchor: "    m.id = 'state-tile-menu';",
  },
  {
    what: 'controller badge popover (openCtrlPopover)',
    file: 'src/ui/components/CtrlPopover.js',
    anchor: '  const closeClick = e => {',
  },
  {
    what: 'Stills Buffer slot menu (_showBufferSlotMenu)',
    file: 'src/main.js',
    anchor: '_bufSlotMenu.classList.remove("hidden");',
  },
];

for (const s of SURFACES) {
  const src = read(s.file);
  check(`${s.what} — anchor still present`, src.includes(s.anchor),
    `"${s.anchor}" not found in ${s.file}; the audit is pointing at code that moved`);
  const ev = dismissalAfter(src, s.anchor);
  check(`${s.what} — dismisses on pointerdown`, ev === 'pointerdown',
    `registers document "${ev}" instead — on macOS the Ctrl+click that OPENED it ` +
    'also emits that event on release, so the menu shuts before it can be used');
}

// ── 2. Elements with a click action AND a context menu ignore modified clicks ─
// The stray release does not just close the menu here — it does something, and
// the state-tile case is a full instrument change mid-performance.
console.log('\nelements with both a click action and a context menu guard the modifier');

const GUARDED = [
  {
    what: 'state tile (click recalls the state)',
    file: 'src/ui/UI.js',
    anchor: "      tile.addEventListener('click',",
    cost: 'Ctrl+click would recall that state — the whole instrument jumps',
  },
  {
    what: 'buffer cell (click selects the frame)',
    file: 'src/main.js',
    anchor: 'bufferCanvas?.addEventListener("click",',
    cost: 'Ctrl+click would select a different frame out from under the menu',
  },
];

for (const g of GUARDED) {
  const src = read(g.file);
  const at = src.indexOf(g.anchor);
  check(`${g.what} — handler still present`, at !== -1, `"${g.anchor}" not found`);
  if (at === -1) continue;
  const body = src.slice(at, at + 700);
  check(`${g.what} — returns early on ctrl/meta`,
    /if\s*\(\s*e\.ctrlKey\s*\|\|\s*e\.metaKey\s*\)\s*return/.test(body),
    `${g.cost}; guard the handler with "if (e.ctrlKey || e.metaKey) return"`);
}

// The value column owns Ctrl+click ("type a number") and must stop that press
// reaching the row's contextmenu handler. A real right-click has no ctrlKey, so
// the guard must be conditional — swallowing every contextmenu here would take
// the assignment menu away from the value column entirely.
console.log('\nthe value column claims a ctrl-modified contextmenu');
const paramRow = read('src/ui/components/ParamRow.js');
const vAt = paramRow.indexOf("valueEl.addEventListener('contextmenu'");
check('ParamRow valueEl has a contextmenu handler', vAt !== -1,
  'without it, Ctrl+click on a value opens the assignment menu ON TOP of the ' +
  'type-in editor it was meant to open');
if (vAt !== -1) {
  const body = paramRow.slice(vAt, vAt + 300);
  check('it stops propagation only when ctrlKey is set',
    /if\s*\(\s*e\.ctrlKey\s*\)/.test(body) && /stopPropagation\(\)/.test(body),
    'an unconditional stop would also swallow a real right-click, removing the ' +
    'assignment menu from the value column');
}

// ── 3. Tripwire: no NEW document-level click dismissal appears ───────────────
// The remaining click closers are all legitimate — each closes a surface opened
// FROM a click, so its gesture is already correctly paired. This is a count, not
// a judgement: it cannot tell a good one from a bad one, only that someone added
// one and should be made to say which it is.
console.log('\nno unreviewed document-level click listeners');

const EXPECTED = {
  // bank dropdown, status-bar menu, table picker — all opened from a click
  'src/ui/UI.js': 3,
  // slot picker, parameter search overlay, AI settings panel — click-opened
  'src/main.js': 3,
  // custom select — opened from a click, and its setTimeout is correct there
  'src/ui/components/Select.js': 1,
};

const walk = (d, out = []) => {
  for (const f of readdirSync(resolve(root, d))) {
    const rel = `${d}/${f}`;
    if (statSync(resolve(root, rel)).isDirectory()) walk(rel, out);
    else if (rel.endsWith('.js')) out.push(rel);
  }
  return out;
};

const CLICK_RE = /document\s*\.\s*addEventListener\s*\(\s*["'`]click["'`]/g;
const found = {};
for (const f of walk('src')) {
  const n = (read(f).match(CLICK_RE) || []).length;
  if (n) found[f] = n;
}

for (const [file, n] of Object.entries(found)) {
  check(`${file} has ${EXPECTED[file] ?? 0} reviewed click listener(s)`,
    EXPECTED[file] === n,
    `found ${n}, expected ${EXPECTED[file] ?? 0}. If the new one closes a surface ` +
    'opened from contextmenu it is the bug this audit exists for — use ' +
    'pointerdown. If it is click-opened, raise the count here with a reason.');
}
for (const file of Object.keys(EXPECTED)) {
  check(`${file} still has its reviewed click listeners`, found[file] !== undefined,
    'the file lost them all, or moved — update EXPECTED rather than deleting it');
}

if (failures) {
  console.error(
    '\nThe rule: pair the CLOSE gesture with the phase the OPEN gesture used.\n' +
    'Opened from contextmenu (which macOS fires on mousedown) => close on the\n' +
    'next pointerdown. Opened from a click => closing on click is already safe.\n' +
    'Do NOT reach for setTimeout(..., 0) — it runs long before the button comes\n' +
    'back up, and CtrlPopover.js was broken for years with that guard in place.\n' +
    'See docs/LEARNED.md 2026-08-09.',
  );
}

console.log(failures
  ? `\n${failures} FAILURE(S)\n`
  : '\nAll context-menu dismissal checks passed.\n');
process.exit(failures ? 1 : 0);
