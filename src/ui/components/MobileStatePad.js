/**
 * MobileStatePad — touch-first state recall for narrow screens (Phase 4).
 *
 * Hybrid bottom bar (#mobile-state-bar, mobile only):
 *   [○ Clear] [＋ Save] [ scrolling thumbnail strip ] [⋯ More]
 * The strip shows every stored state as a tappable mini-tile (recall via
 * pm.recallState — the EXACT desktop tile path); More opens
 * #mobile-state-modal, the full pad grid for the current bank.
 *
 * Both elements live as direct children of <body> (never inside #app —
 * Chromium composites #app descendants into a trapped stacking context)
 * and are display:none outside the ≤900px media query, so the desktop
 * layout is untouched. Subscribes to the same PresetManager events as
 * StateBar, so MIDI / sequencer / automation state changes repaint the
 * button and grid — it can never show a stale state.
 */

const STATE_COUNT = 32;

export class MobileStatePad {
  constructor(presetManager, opts = {}) {
    this.pm = presetManager;
    this.onQuickSave = opts.onQuickSave ?? null;
    this.stripEl = document.getElementById('mobile-state-strip');
    this.modalEl = document.getElementById('mobile-state-modal');
    if (!this.stripEl || !this.modalEl) return;

    this._buildModalShell();

    // Hybrid bar: [Clear] [+Save] [thumbnail strip] [More…]
    // Save = same quick-save-to-next-empty-slot path as Shift+S;
    // Clear = neutral state, same event the desktop ○ button dispatches;
    // More = full modal pad grid
    document.getElementById('mobile-state-save')
      ?.addEventListener('click', () => this.onQuickSave?.());
    document.getElementById('mobile-state-clear')
      ?.addEventListener('click', () => this._neutral());
    document.getElementById('mobile-state-more')
      ?.addEventListener('click', () => this._open());

    // Same event set as StateBar._wirePresetManager — external changes
    // (MIDI, sequencer, automation) repaint button + open grid
    ['presetActivated', 'stateSaved', 'stateRecalled', 'morphStarted', 'morphEnded']
      .forEach((ev) => this.pm.addEventListener(ev, () => this._refresh()));

    this._onKey = (e) => {
      if (e.key === 'Escape' && !this.modalEl.classList.contains('hidden')) this._close();
    };
    document.addEventListener('keydown', this._onKey);

    this._refresh();
  }

  _buildModalShell() {
    this.modalEl.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'msp-head';
    this.bankNameEl = document.createElement('span');
    this.bankNameEl.className = 'msp-bank-name';

    const saveBtn = document.createElement('button');
    saveBtn.className = 'msp-action';
    saveBtn.textContent = '＋ Save';
    // Stays open: the stateSaved event repaints the grid, so the new pad
    // appears with its active ring — immediate visual confirmation
    saveBtn.addEventListener('click', () => this.onQuickSave?.());

    const clearBtn = document.createElement('button');
    clearBtn.className = 'msp-action';
    clearBtn.textContent = '○ Clear';
    clearBtn.addEventListener('click', () => { this._neutral(); this._close(); });

    const closeBtn = document.createElement('button');
    closeBtn.className = 'msp-close';
    closeBtn.textContent = '✕';
    closeBtn.addEventListener('click', () => this._close());

    head.appendChild(this.bankNameEl);
    head.appendChild(saveBtn);
    head.appendChild(clearBtn);
    head.appendChild(closeBtn);

    this.gridEl = document.createElement('div');
    this.gridEl.className = 'msp-grid';

    this.pads = [];
    for (let i = 0; i < STATE_COUNT; i++) {
      const pad = document.createElement('button');
      pad.className = 'msp-pad msp-pad--empty';
      pad.dataset.idx = i;
      const num = document.createElement('span');
      num.className = 'msp-pad-num';
      num.textContent = i + 1;
      const label = document.createElement('span');
      label.className = 'msp-pad-name';
      pad.appendChild(num);
      pad.appendChild(label);
      pad.addEventListener('click', () => {
        if (pad._lpFired) { pad._lpFired = false; return; }
        if (!this.pm.current?.states[i]) return;
        this.pm.recallState(i); // identical path to desktop StateBar tiles
        this._close();
      });
      this._addLongPress(pad, i);
      this.gridEl.appendChild(pad);
      this.pads.push(pad);
    }

    this.modalEl.appendChild(head);
    this.modalEl.appendChild(this.gridEl);

    // Backdrop tap (the modal element itself, outside head/grid) closes
    this.modalEl.addEventListener('click', (e) => {
      if (e.target === this.modalEl) this._close();
    });
  }

  _neutral() {
    // Same event the desktop ○ button and Shift+0 dispatch
    this.pm.dispatchEvent(new CustomEvent('neutralState'));
  }

  /** Clear one slot — identical block to the desktop tile menu's 'Clear'
   *  (StateBar._openTileMenu); the stateSaved event repaints both bars. */
  async _clearState(i) {
    const bank = this.pm.current;
    if (!bank?.states[i]) return;
    bank.removeState(i);
    await bank.save?.();
    this.pm.dispatchEvent(new CustomEvent('stateSaved',
      { detail: { presetIndex: this.pm.currentIdx, stateIndex: i } }));
  }

  /** Duplicate slot i into the next empty slot — pure reuse of the
   *  export/import code paths. */
  async _duplicateState(i) {
    const data = this.pm.exportState(i);
    if (!data) return;
    if (data.name) data.name += ' copy';
    const idx = this.pm.importState(data, null); // null → next empty slot
    if (idx === null) return;
    await this.pm.current?.save?.();
    this.pm.dispatchEvent(new CustomEvent('stateSaved',
      { detail: { presetIndex: this.pm.currentIdx, stateIndex: idx } }));
  }

  /** Touch action menu opened by long-press: Duplicate / Clear / outside
   *  tap dismisses. Anchored near the pressed tile. */
  _openTileMenu(el, i) {
    this._closeTileMenu();
    const menu = document.createElement('div');
    menu.className = 'msb-menu';
    const add = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = cls;
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); this._closeTileMenu(); fn(); });
      menu.appendChild(b);
    };
    add('⧉ Duplicate', '', () => this._duplicateState(i));
    add('✕ Clear', 'msb-menu-danger', () => {
      el.classList.add('msb-tile--clearing');
      // let the red flash render before the stateSaved repaint removes it
      setTimeout(() => this._clearState(i), 180);
    });
    document.body.appendChild(menu);
    // Position above the tile, clamped to the viewport
    const r = el.getBoundingClientRect();
    const mr = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(r.left, window.innerWidth - mr.width - 8)) + 'px';
    menu.style.top = Math.max(8, r.top - mr.height - 8) + 'px';
    this._menuEl = menu;
    // Outside tap dismisses. Capture phase: it must fire before any app
    // handler that stopPropagation()s pointerdown lower in the tree.
    // Deferred so the opening gesture doesn't immediately close it.
    this._menuDismiss = (e) => { if (!menu.contains(e.target)) this._closeTileMenu(); };
    setTimeout(() => document.addEventListener('pointerdown', this._menuDismiss, true), 0);
  }

  _closeTileMenu() {
    if (this._menuDismiss) document.removeEventListener('pointerdown', this._menuDismiss, true);
    this._menuDismiss = null;
    this._menuEl?.remove();
    this._menuEl = null;
  }

  /** Long-press (600ms, <10px travel) on a tile opens the action menu.
   *  pointerup / pointercancel / movement cancels the timer, so strip
   *  scrolling and normal taps never trigger it. */
  _addLongPress(el, i) {
    let timer = null, sx = 0, sy = 0;
    const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
    el.addEventListener('pointerdown', (e) => {
      if (!this.pm.current?.states[i]) return;
      sx = e.clientX; sy = e.clientY;
      timer = setTimeout(() => {
        timer = null;
        el._lpFired = true; // swallow the click that follows finger lift
        this._openTileMenu(el, i);
      }, 600);
    });
    el.addEventListener('pointermove', (e) => {
      if (timer && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel();
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);
    // iOS long-press also fires contextmenu — suppress on these
    // mobile-only tiles (desktop right-click menus live on #state-bar)
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  _open() {
    // Unhide FIRST: _refresh skips the pad grid while the modal is hidden
    this.modalEl.classList.remove('hidden');
    this._refresh();
  }

  _close() {
    this._closeTileMenu();
    this.modalEl.classList.add('hidden');
  }

  _stateName(state, i) {
    return state?.name || `State ${i + 1}`;
  }

  /** One persistent strip tile per occupied slot, keyed by state index
   *  (slots are nulled on clear, never spliced — Preset.removeState —
   *  so an index-keyed tile and its captured `i` stay valid for life). */
  _makeStripTile(i) {
    const tile = document.createElement('button');
    tile.className = 'msb-tile';
    const num = document.createElement('span');
    num.className = 'msb-tile-num';
    num.textContent = i + 1;
    tile.appendChild(num);
    tile.addEventListener('click', () => {
      if (tile._lpFired) { tile._lpFired = false; return; }
      this.pm.recallState(i);
    });
    this._addLongPress(tile, i);
    return tile;
  }

  _refresh() {
    const bank = this.pm.current;
    if (!bank) return;
    const idx = bank.activeState;

    // Thumbnail strip: targeted update — reuse existing tiles, touch only
    // background-image / active class when they actually changed. The
    // sequencer fires stateRecalled at musical rate; the old full
    // innerHTML rebuild meant DOM teardown + thumbnail re-decode per step.
    if (!this._tiles) this._tiles = new Map(); // state index → tile element
    const tiles = this._tiles;

    // Drop tiles whose slot was cleared (or emptied by a bank switch)
    for (const [i, tile] of tiles) {
      if (!bank.states[i]) { tile.remove(); tiles.delete(i); }
    }

    let activeTile = null;
    bank.states.forEach((state, i) => {
      if (!state) return;
      let tile = tiles.get(i);
      if (!tile) {
        tile = this._makeStripTile(i);
        // Insert in index order: before the lowest existing tile above i
        let ref = null, refIdx = Infinity;
        for (const [j, t] of tiles) {
          if (j > i && j < refIdx) { refIdx = j; ref = t; }
        }
        this.stripEl.insertBefore(tile, ref);
        tiles.set(i, tile);
      }
      const thumb = state.thumbnail || '';
      if (tile._thumb !== thumb) {
        tile._thumb = thumb;
        tile.style.backgroundImage = thumb ? `url(${thumb})` : '';
      }
      const active = i === idx;
      if (tile._active !== active) {
        tile._active = active;
        tile.classList.toggle('msb-tile--active', active);
        tile.classList.remove('msb-tile--clearing'); // stale flash from an aborted clear
      }
      if (active) activeTile = tile;
    });

    // Keep the active state visible — but scrollIntoView forces layout,
    // so only when the active slot (or bank) actually changed
    const activeKey = `${this.pm.currentIdx}:${idx}`;
    if (activeKey !== this._lastActiveKey) {
      this._lastActiveKey = activeKey;
      activeTile?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }

    // Modal grid: skip entirely while hidden (32 pads × image + text per
    // sequencer tick for an invisible element); _open() unhides first,
    // then calls _refresh, so it always opens freshly painted
    if (this.modalEl.classList.contains('hidden')) return;
    this.bankNameEl.textContent = bank.name || 'Bank';
    this.pads.forEach((pad, i) => {
      const state = bank.states[i];
      const thumb = state?.thumbnail || '';
      if (pad._thumb !== thumb) {
        pad._thumb = thumb;
        pad.style.backgroundImage = thumb ? `url(${thumb})` : '';
      }
      const name = state ? this._stateName(state, i) : '';
      if (pad._name !== name) {
        pad._name = name;
        pad.querySelector('.msp-pad-name').textContent = name;
      }
      const cls = 'msp-pad'
        + (!state ? ' msp-pad--empty' : '')
        + (i === idx ? ' msp-pad--active' : '');
      if (pad._cls !== cls) {
        pad._cls = cls;
        pad.className = cls;
      }
    });
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey);
  }
}
