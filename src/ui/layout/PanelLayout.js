/**
 * PanelLayout — which panel sections are open as floating windows, and where.
 *
 * WHY NOT DISPLAY STATES. States are recalled live, often from a MIDI button
 * mid-performance. Layout in a state would rearrange the windows under the
 * performer's hands and creates a two-writers race with a manual drag: the
 * state says "Keyer at 400,120" while the hand is dragging it. The precedent
 * is UI scale, which is deliberately NOT a ParameterSystem param and lives in
 * per-origin localStorage for the same reason (see LayoutManager.js).
 *
 * WHERE IT LIVES INSTEAD, two places with different jobs:
 *   - per-origin localStorage — what a plain reload restores. This is the live
 *     mirror: every detach, drag, resize and re-attach rewrites it.
 *   - the .imweb project file — so a project opened on another machine opens
 *     with its windows arranged. Applied on import, which then re-writes the
 *     autosave, so the two never disagree.
 *
 * COORDINATES ARE VIEWPORT PX. `.detached-panel` is in the `zoom` set, so its
 * `style.left/top/width/height` are ELEMENT-LOCAL px — a saved 1000 would land
 * at 2000 on a 2× display. Everything here is stored the way
 * getBoundingClientRect reports it and converted once, on the way out, through
 * setViewportPos/setViewportSize. That also makes a layout portable across a
 * UI-scale change: the window comes back where it was on screen, not where it
 * was in some other scale's ruler.
 */

export const PANEL_LAYOUT_KEY = 'imweb.panelLayout'; // per-origin, like uiScale
export const LAYOUT_VERSION = 1;

/** Gap kept between a restored window and the viewport edge. */
export const MARGIN = 8;
/**
 * The title bar's height at scale 1 — the only handle a window has. Not used
 * by the clamp, which guarantees something stronger (the whole window, see
 * clampPos); exported so the audit can assert that guarantee in the terms the
 * failure would actually be felt in: a title bar off-screen is a window that
 * cannot be moved, resized or closed by any gesture the app offers.
 */
export const TITLE_H = 28;

/** Matches .detached-panel's min-width / min-height in style.css. */
export const MIN_W = 280;
export const MIN_H = 80;

/**
 * The title used for the floating window, and the basis of its key.
 * childNodes[0] rather than textContent: the header also carries the ⊞/⊟
 * button div, and textContent would fold those glyphs into the name.
 */
export function sectionTitle(section) {
  return (
    section
      ?.querySelector('.section-header')
      ?.childNodes[0]?.textContent?.trim() || ''
  );
}

/**
 * Stable identity for a panel section.
 *
 * Six sections carry an id; the other sixty-odd do not, so the header title is
 * the fallback. All 69 titles in index.html are distinct, plus the two sections
 * built at runtime ("Hypercube", "I / O"), and `tests/audit-panel-layout.mjs`
 * asserts that uniqueness so a future duplicate cannot silently make two
 * windows share one saved position.
 *
 * A renamed section changes its key and its saved entry simply stops matching —
 * the window opens attached, which is the safe direction. Nothing is thrown away
 * on a miss, because a key can also fail to match for a section that has not
 * been built yet.
 */
export function sectionKey(section) {
  if (!section) return null;
  if (section.id) return section.id;
  const slug = sectionTitle(section)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return slug || null;
}

/**
 * Fit a saved size into the current viewport.
 *
 * Pure, so the case this exists for can actually be tested: a window sized on
 * a 3840px external display and restored on a 1440px laptop cannot be
 * reproduced on the development machine at all.
 */
export function clampSize(w, h, vw, vh) {
  return {
    w: w == null ? null : Math.max(MIN_W, Math.min(w, vw - 2 * MARGIN)),
    h: h == null ? null : Math.max(MIN_H, Math.min(h, vh - 2 * MARGIN)),
  };
}

/**
 * Fit a saved position into the current viewport.
 *
 * ONE rule on both axes: the whole window is pulled into view, and a window too
 * large to fit is parked at the margin so that the title bar — its only handle
 * — is the part that survives. The first cut guaranteed only the title bar
 * vertically, on the theory that a tall panel should be allowed to hang off the
 * bottom; that allowance is unreachable, because clampSize has already cut the
 * height to the viewport, and all it did was park an unfittable window with its
 * title bar on the last line of the screen and its whole body below.
 *
 * `w`/`h` are the window's ACTUAL size (after clampSize), not the saved one —
 * clamping against a width the window does not have is the hardcoded-300 bug
 * from the UI-scale work, one release later.
 */
export function clampPos(x, y, w, h, vw, vh) {
  const maxX = Math.max(MARGIN, vw - w - MARGIN);
  const maxY = Math.max(MARGIN, vh - h - MARGIN);
  return {
    x: Math.min(Math.max(x, MARGIN), maxX),
    y: Math.min(Math.max(y, MARGIN), maxY),
  };
}

/** Round-trip guard: reject anything that is not a finite number. */
const num = (v) => (Number.isFinite(v) ? v : null);

/**
 * Normalise a stored blob into the array the app applies.
 * Tolerates null, a parse failure, a future version, and junk entries — a
 * corrupt layout must never be able to stop the instrument from booting.
 */
export function normalizeLayout(data) {
  if (!data || !Array.isArray(data.panels)) return [];
  return data.panels
    .map((p) => ({
      key: typeof p?.key === 'string' ? p.key : null,
      x: num(p?.x) ?? MARGIN,
      y: num(p?.y) ?? MARGIN,
      w: num(p?.w),
      h: num(p?.h),
    }))
    .filter((p) => p.key);
}

export function loadPanelLayout(store = localStorage) {
  try {
    return normalizeLayout(JSON.parse(store.getItem(PANEL_LAYOUT_KEY) ?? 'null'));
  } catch {
    return [];
  }
}

export function savePanelLayout(panels, store = localStorage) {
  try {
    store.setItem(
      PANEL_LAYOUT_KEY,
      JSON.stringify({ v: LAYOUT_VERSION, panels }),
    );
  } catch {
    /* private mode / quota — layout is a convenience, never a failure */
  }
}
