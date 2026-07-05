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
