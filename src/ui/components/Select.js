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
export function mkSelect(opts, initVal, onChangeVal, extraClass = '') {
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
    opts.forEach((opt, i) => {
      const item = document.createElement('div');
      item.className = 'imw-sel-item' + (i === state.v ? ' sel' : '');
      item.textContent = opt;
      item.addEventListener('click', e => {
        e.stopPropagation();
        _close();
        state.v = i;
        lbl.textContent = opts[i] ?? '';
        menu.querySelectorAll('.imw-sel-item').forEach((el, j) => el.classList.toggle('sel', j === i));
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
    menu.style.left  = rect.left + 'px';
    menu.style.top   = (rect.bottom + 2) + 'px';
    menu.style.minWidth = rect.width + 'px';
    // Scroll selected item into view
    const items = menu.querySelectorAll('.imw-sel-item');
    items[state.v]?.scrollIntoView({ block: 'nearest' });
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
      menu?.querySelectorAll('.imw-sel-item').forEach((el, j) => el.classList.toggle('sel', j === i));
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
