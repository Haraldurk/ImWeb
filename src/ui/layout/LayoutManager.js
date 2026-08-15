/**
 * LayoutManager — top-level layout concerns.
 * Extracted from UI.js (initTabs) and main.js (_applyLayout) — Phase 2 Task 5.
 */

// ── Tab switching ────────────────────────────────────────────────────────────

export function initTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t === btn));
      document.querySelectorAll('.tab-content').forEach(c => {
        c.classList.toggle('active', c.id === `tab-${id}`);
      });
    });
  });
}

// ── UI scale ─────────────────────────────────────────────────────────────────
//
// Produces the value of --ui-scale, which style.css applies as `zoom` to the
// chrome. See the long note at the top of style.css for why zoom, and why the
// chrome roots are listed explicitly instead of scaling `body`.
//
// The problem this solves is a display the OS is NOT scaling. On a Mac running
// a 4K panel in HiDPI ("Looks like 1920×1080"), devicePixelRatio is 2, a CSS
// pixel is two device pixels, and the panel's 8px type is 16 device pixels —
// the intended physical size, and nothing here should fire. On the SAME panel
// run at native 3840×2160, devicePixelRatio is 1, a CSS pixel is one device
// pixel at ~163 PPI, and that type is half its intended size. Same monitor,
// same browser, opposite answers — which is why the signal is pixel DENSITY,
// not viewport width, and why the `@media (min-width: 2560px)` block in
// style.css could never have got this right no matter what it declared.

export const UI_SCALE_KEY = "imweb.uiScale"; // per-origin, like every other pref

/**
 * Scale to use when the user has not chosen one.
 *
 * Pure function of `dpr` and `screenW` so it can be tested off a real display:
 * the case it exists for (DPR 1 on a 4K panel) cannot be reproduced on a
 * Retina development machine, which reports DPR 2 and a 1792px screen.
 *
 * screenW is the DISPLAY width, not the window's: a half-width window on a 4K
 * desktop needs the same type size as a maximised one. The window can be any
 * size; the display's pixel pitch is the thing being compensated for.
 */
export function autoUiScale(
  dpr = window.devicePixelRatio || 1,
  screenW = (window.screen && window.screen.width) || window.innerWidth,
  screenH = (window.screen && window.screen.height) || window.innerHeight,
) {
  // Is this a 4K-class PANEL? Not "is the desktop wide" — the first cut asked
  // that and was wrong twice in opposite directions: a 3440×1440 or 5120×1440
  // ultrawide is an ordinary ~110 PPI desktop that people run at 100%, and it
  // would have been doubled; a 4K panel in PORTRAIT reports a 2160px width and
  // would have been left alone despite being the dense case.
  //
  // screen.* is in CSS px, so multiplying by dpr recovers the panel's real
  // pixel count, and the SHORTER side is the one that tracks panel class —
  // it is ~2160 for 4K in either orientation and ~1440 for every ultrawide.
  const physShort = Math.min(screenW, screenH) * dpr;
  if (physShort < 2000) return 1;

  // It is a dense panel. We want ~2× total compensation; the OS already
  // supplies dpr, so ask for the remainder. This is the whole rule, and it
  // makes the two configurations of one monitor agree by construction:
  // 4K at 1× wants 2/1 = 2; the same 4K in HiDPI wants 2/2 = 1.
  //
  // Snapped DOWN to the ladder the control offers, so Auto can never land on a
  // value the user cannot see selected, and never below 1 — scaling an existing
  // user's UI *down* would be a regression on every display.
  const want = 2 / dpr;
  let s = 1;
  for (const step of [1, 1.25, 1.5, 1.75, 2]) if (step <= want + 1e-9) s = step;
  return s;

  // Known and accepted ambiguity: JS cannot see physical size, so a 43" 4K TV
  // used as a monitor (~103 PPI, normal density) gets 2× here and looks too
  // big. That is the deliberate side to err on — "too big" is visible and one
  // dropdown away, whereas "too small" is what made a tester change his
  // monitor's resolution rather than report a UI bug at all.
}

/**
 * The zoom factor in effect for `el` — 1 when it is not in the zoom set.
 *
 * Reads the element rather than the global scale on purpose: it stays correct
 * for elements that are NOT zoomed, so callers do not have to know which set
 * their element is in, and it keeps working if the set changes.
 */
export function elementZoom(el) {
  const z = parseFloat(getComputedStyle(el).zoom);
  return Number.isFinite(z) && z > 0 ? z : 1;
}

/**
 * Place a floating element at a VIEWPORT coordinate.
 *
 * This exists because `zoom` splits the coordinate system in two, and the two
 * halves are easy to mix without noticing:
 *
 *   - `getBoundingClientRect()`, `clientX/clientY`, `innerWidth/innerHeight`
 *     are VIEWPORT px — already multiplied by the element's zoom.
 *   - `style.left`, `style.top`, `offsetLeft`, `offsetTop` are ELEMENT-LOCAL px
 *     — they get multiplied by zoom on the way out.
 *
 * So `el.style.left = e.clientX + 'px'` on a zoomed element paints at
 * clientX × zoom: at 2× the context menu lands twice as far from the pointer as
 * the click, and a detached panel opens off the right edge of a 4K screen with
 * its own drag handle out of reach. Every one of those was a real bug in the
 * first cut of the UI-scale change; they were found in review, not in testing,
 * because at scale 1 the two spaces are identical and nothing is wrong.
 *
 * Pass `zoom` explicitly in a drag loop to avoid a style recalc per pointermove.
 */
export function setViewportPos(el, x, y, zoom = elementZoom(el)) {
  if (x !== null && x !== undefined) el.style.left = `${x / zoom}px`;
  if (y !== null && y !== undefined) el.style.top = `${y / zoom}px`;
}

/** null = follow autoUiScale(); a number = the user's explicit choice. */
export function storedUiScale(raw = localStorage.getItem(UI_SCALE_KEY)) {
  if (raw === null || raw === "auto") return null;
  const n = parseFloat(raw);
  // Clamp rather than trust: a hand-edited or corrupted value of 12 would put
  // the control that fixes it off-screen, with no way back but devtools.
  return Number.isFinite(n) ? Math.min(3, Math.max(0.75, n)) : null;
}

// ── Portrait / landscape body class ──────────────────────────────────────────

export function applyLayout() {
  const portrait = window.innerHeight > window.innerWidth;
  document.body.classList.toggle('layout-portrait', portrait);

  // Sync --status-h to the real (possibly wrapped) status bar height so
  // #app and the slide-over panel start below it. Reset before measuring:
  // min-height reads the var, so a stale override would ratchet the height.
  const bar = document.getElementById('status-bar');
  if (bar) {
    document.documentElement.style.removeProperty('--status-h');
    const h = bar.offsetHeight;
    if (h > 0) document.documentElement.style.setProperty('--status-h', h + 'px');
  }
}
