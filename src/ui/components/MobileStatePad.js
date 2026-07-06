/**
 * MobileStatePad — touch-first state recall for narrow screens (Phase 4).
 *
 * Collapsed: #mobile-state-btn (bottom bar, ≤900px only) shows the active
 * state's thumbnail + name. Tapping opens #mobile-state-modal — a grid of
 * large pads for the current bank. Tapping a stored pad recalls it via the
 * EXACT same code path as the desktop tiles (pm.recallState) and closes
 * the modal.
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
    this.btnEl = document.getElementById('mobile-state-btn');
    this.modalEl = document.getElementById('mobile-state-modal');
    if (!this.btnEl || !this.modalEl) return;

    this._buildModalShell();
    this.btnEl.addEventListener('click', () => this._open());

    // Flanking quick-action buttons in the collapsed bar:
    // Save = same quick-save-to-next-empty-slot path as Shift+S;
    // Clear = neutral state, same event the desktop ○ button dispatches
    document.getElementById('mobile-state-save')
      ?.addEventListener('click', () => this.onQuickSave?.());
    document.getElementById('mobile-state-clear')
      ?.addEventListener('click', () => this._neutral());

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
        if (!this.pm.current?.states[i]) return;
        this.pm.recallState(i); // identical path to desktop StateBar tiles
        this._close();
      });
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

  _open() {
    this._refresh();
    this.modalEl.classList.remove('hidden');
  }

  _close() {
    this.modalEl.classList.add('hidden');
  }

  _stateName(state, i) {
    return state?.name || `State ${i + 1}`;
  }

  _refresh() {
    const bank = this.pm.current;
    if (!bank) return;

    // Collapsed button: active state thumbnail + name
    const idx = bank.activeState;
    const active = idx != null ? bank.states[idx] : null;
    this.btnEl.innerHTML = '';
    const swatch = document.createElement('span');
    swatch.className = 'msp-btn-thumb';
    if (active?.thumbnail) swatch.style.backgroundImage = `url(${active.thumbnail})`;
    const label = document.createElement('span');
    label.className = 'msp-btn-name';
    label.textContent = active
      ? this._stateName(active, idx)
      : (bank.name || 'No state');
    this.btnEl.appendChild(swatch);
    this.btnEl.appendChild(label);

    // Modal grid (cheap enough to repaint even while hidden)
    this.bankNameEl.textContent = bank.name || 'Bank';
    this.pads.forEach((pad, i) => {
      const state = bank.states[i];
      pad.className = 'msp-pad';
      pad.style.backgroundImage = state?.thumbnail ? `url(${state.thumbnail})` : '';
      pad.querySelector('.msp-pad-name').textContent = state ? this._stateName(state, i) : '';
      if (!state) pad.classList.add('msp-pad--empty');
      if (i === idx) pad.classList.add('msp-pad--active');
    });
  }

  dispose() {
    document.removeEventListener('keydown', this._onKey);
  }
}
