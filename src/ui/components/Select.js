/**
 * ImWeb UI — custom dark dropdown component.
 * Extracted verbatim from UI.js (Phase 2 componentization).
 */

// ── Custom dark dropdown (replaces native <select> whose popup ignores CSS) ───
//
// Uses the existing .imw-sel / .imw-sel-trigger / .imw-sel-menu / .imw-sel-item
// CSS already in style.css.
//
// Returns a div element with:
//   .value        — get/set current index (keeps label in sync)
//   .addEventListener — works as a normal DOM element
//
/**
 * @param order  Optional display sequence. Entries are either an integer
 *   (an index into `opts`) or `{ header: 'MEDIA' }` for a non-clickable group
 *   label. Lets a dropdown be grouped and reordered for legibility while the
 *   value reported to onChangeVal stays the TRUE index into `opts` — which is
 *   what SELECT params persist. Items carry data-idx so nothing relies on
 *   menu position matching the value.
 */
export function mkSelect(opts, initVal, onChangeVal, extraClass = '', order = null) {
  const state = { v: Math.round(initVal) };

  const wrap = document.createElement('div');
  wrap.className = `imw-sel ${extraClass}`;

  const trigger = document.createElement('div');
  trigger.className = 'imw-sel-trigger';

  const lbl = document.createElement('span');
  lbl.textContent = opts[state.v] ?? '';

  const chev = document.createElement('span');
  chev.className = 'imw-sel-chev';
  chev.textContent = '▾';

  trigger.appendChild(lbl);
  trigger.appendChild(chev);
  wrap.appendChild(trigger);

  // Menu — created lazily, appended to document.body for correct stacking
  let menu = null;

  function _buildMenu() {
    menu = document.createElement('div');
    menu.className = 'imw-sel-menu';
    menu.style.cssText = 'position:fixed;z-index:9999;display:none;overflow-y:auto;max-height:60vh;';
    const seq = order ?? opts.map((_, i) => i);
    seq.forEach(entry => {
      if (entry && typeof entry === 'object' && entry.header) {
        const h = document.createElement('div');
        h.className = 'imw-sel-group';
        h.textContent = entry.header;
        menu.appendChild(h);
        return;
      }
      const i = entry;
      if (opts[i] == null) return; // order outlived the options array
      const item = document.createElement('div');
      item.className = 'imw-sel-item' + (i === state.v ? ' sel' : '');
      item.dataset.idx = i;
      item.textContent = opts[i];
      item.addEventListener('click', e => {
        e.stopPropagation();
        _close();
        state.v = i;
        lbl.textContent = opts[i] ?? '';
        menu.querySelectorAll('.imw-sel-item').forEach(el =>
          el.classList.toggle('sel', +el.dataset.idx === i));
        onChangeVal(i);
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
  }

  function _open() {
    if (!menu) _buildMenu();
    const rect = trigger.getBoundingClientRect();
    menu.style.display = 'block';
    menu.style.minWidth = rect.width + 'px';

    // ── Keep the menu inside the viewport ────────────────────────────────────
    // It is position:fixed, so anything past an edge is simply unreachable —
    // the page cannot scroll to it and the menu's own scrollbar is on a box that
    // is itself partly offscreen. Opening downward unconditionally therefore
    // truncated the list whenever the trigger sat low on the screen, silently
    // hiding the tail. The longer the list the worse it got, and the newest
    // options are always at the tail because these lists are append-only.
    const GAP = 2, EDGE = 6;
    menu.style.maxHeight = 'none';               // measure the natural height
    const wantH = menu.offsetHeight;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;

    // Prefer downward; flip up only when that genuinely buys more room.
    const flip = wantH > below && above > below;
    const room = Math.max(96, flip ? above : below);
    const useH = Math.min(wantH, room);
    menu.style.maxHeight = useH + 'px';
    menu.style.top = (flip ? rect.top - GAP - useH : rect.bottom + GAP) + 'px';

    // Same treatment horizontally: a menu wider than its trigger can overhang
    // the right edge, which detached panels near the screen edge do hit.
    const w = menu.offsetWidth;
    menu.style.left =
      Math.max(EDGE, Math.min(rect.left, window.innerWidth - w - EDGE)) + 'px';

    // Scroll selected item into view
    menu.querySelector(`.imw-sel-item[data-idx="${state.v}"]`)
      ?.scrollIntoView({ block: 'nearest' });
    // Use click (bubble, fires after pointerup) — never interferes with canvas
    // pointerdown or altKey-click pin placement.
    setTimeout(() => document.addEventListener('click', _outside), 0);
  }

  function _close() {
    if (menu) menu.style.display = 'none';
    document.removeEventListener('click', _outside);
  }

  function _outside(e) {
    if (!wrap.contains(e.target) && e.target !== menu && !menu?.contains(e.target)) {
      _close();
    }
  }

  trigger.addEventListener('click', e => {
    e.stopPropagation(); // prevent _outside from immediately closing
    if (menu && menu.style.display !== 'none') { _close(); } else { _open(); }
  });

  Object.defineProperty(wrap, 'value', {
    get: () => state.v,
    set: v => {
      const i = Math.round(v);
      state.v = i;
      lbl.textContent = opts[i] ?? opts[0] ?? '';
      menu?.querySelectorAll('.imw-sel-item').forEach(el =>
        el.classList.toggle('sel', +el.dataset.idx === i));
    },
  });

  // Tear down: detach the body-level menu and its outside-click listener.
  // Required before discarding an instance whose options need to change —
  // _mkSelect has no setOptions(), so callers rebuild from scratch.
  wrap._destroy = () => {
    document.removeEventListener('click', _outside);
    menu?.remove();
  };

  return wrap;
}
