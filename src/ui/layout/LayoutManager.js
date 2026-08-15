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
) {
  // >=1.5, not >1: a Windows desktop at 125% reports dpr 1.25, which is real
  // but PARTIAL compensation — on a 4K panel it still leaves 8px type at 10
  // device pixels. Bailing out at anything above 1 would call that solved. The
  // remaining shortfall is then picked up by the width tests below, because
  // screenW is reported in CSS pixels and so is already divided by dpr: the
  // same 4K panel reports 3840 at 100% and 3072 at 125%.
  if (dpr >= 1.5) return 1;
  if (screenW >= 3200) return 2;   // 4K+ addressed at 1×
  if (screenW >= 2400) return 1.5; // 1440p/2.5K, or 4K at 125%
  return 1;
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
