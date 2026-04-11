/**
 * ImWeb UI
 * Builds parameter rows, handles tabs, context menu, state dots, signal path.
 * Vanilla JS — no framework. Direct DOM manipulation for sub-ms response.
 */

import { PARAM_TYPE } from '../controls/ParameterSystem.js';
import { DEFAULT_FX_ORDER } from '../core/Pipeline.js';
import { PROVIDERS } from '../ai/AIFeatures.js';
const DEFAULT_FX_ORDER_SP = DEFAULT_FX_ORDER;

// ── Tab switching ──────────────────────────────────────────────────────────────

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

// ── Controller badge popover ──────────────────────────────────────────────────

/**
 * Open a small settings popover for the currently-assigned controller.
 * Supports: random (rate, slew), lfo-* (shape, freq, phase, slew), fixed (value).
 * All number fields support drag (up=increase) and double-click to type.
 */
function _openCtrlPopover(param, anchorEl, ctrl, tables) {
  document.querySelectorAll('.ctrl-popover').forEach(p => p.remove());

  const c = param.controller;
  if (!c) return;

  const popover = document.createElement('div');
  popover.className = 'ctrl-popover';
  popover.style.cssText = [
    'position:fixed;z-index:3000;',
    'background:var(--bg-3);border:1px solid var(--border-hi);border-radius:4px;',
    'padding:6px 8px;box-shadow:0 4px 14px rgba(0,0,0,.55);min-width:170px;',
    'font-size:11px;font-family:var(--mono);color:var(--text-1);',
  ].join('');

  // ── Shared helpers ────────────────────────────────────────────────────────

  const makeRow = (label, valueEl) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 0;';
    const lbl = document.createElement('span');
    lbl.style.cssText = 'color:var(--text-2);';
    lbl.textContent   = label;
    row.appendChild(lbl);
    row.appendChild(valueEl);
    return row;
  };

  /** Draggable + double-click-to-type number span. */
  const makeDragNum = (get, set, { decimals = 2, fineStep = 0.1, coarseStep = 1 } = {}) => {
    const span = document.createElement('span');
    span.style.cssText = [
      'cursor:ns-resize;user-select:none;',
      'padding:1px 5px;background:var(--bg-4);',
      'border:1px solid var(--border);border-radius:2px;',
      'min-width:52px;display:inline-block;text-align:right;',
    ].join('');

    const refresh = () => {
      const v = get();
      span.textContent = typeof v === 'number' ? v.toFixed(decimals) : String(v);
    };
    refresh();

    let startY = 0, startVal = 0;
    span.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      span.setPointerCapture(e.pointerId);
      startY = e.clientY; startVal = get();
      e.preventDefault(); e.stopPropagation();
    });
    span.addEventListener('pointermove', e => {
      if (!span.hasPointerCapture(e.pointerId)) return;
      const step = e.shiftKey ? coarseStep : fineStep;
      set(startVal + (startY - e.clientY) * step);
      refresh();
    });
    span.addEventListener('pointerup', () => {});

    span.addEventListener('dblclick', e => {
      e.stopPropagation();
      e.preventDefault();
      const input = document.createElement('input');
      input.type  = 'number'; input.value = get(); input.step = 'any';
      input.style.cssText = 'width:64px;font:inherit;font-size:inherit;background:#1f1f25;color:#e0e0f0;border:1px solid #c8a020;border-radius:3px;padding:1px 4px;outline:none;';
      span.innerHTML = '';
      span.appendChild(input);
      setTimeout(() => { input.focus(); input.select(); }, 0);
      const commit = () => { const v = parseFloat(input.value); if (!isNaN(v)) set(v); refresh(); };
      input.addEventListener('pointerdown', e2 => e2.stopPropagation());
      input.addEventListener('blur', commit);
      input.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter')  { commit(); e2.stopPropagation(); }
        if (e2.key === 'Escape') { refresh(); e2.stopPropagation(); }
      });
    });

    return span;
  };

  /** Slew row (shared by random and lfo). */
  const addSlewRow = () => {
    popover.appendChild(makeRow('Slew (s)', makeDragNum(
      () => param.slew ?? 0,
      v  => { param.slew = Math.max(0, v); },
      { decimals: 3, fineStep: 0.01, coarseStep: 0.1 }
    )));
  };

  /** Table select row (shared by random and lfo). */
  const addTableRow = () => {
    const sel = document.createElement('select');
    sel.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 2px;border-radius:2px;';
    const noneOpt = document.createElement('option');
    noneOpt.value = ''; noneOpt.textContent = 'none';
    sel.appendChild(noneOpt);
    (tables ? tables.getNames() : []).forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.value = param.table ?? '';
    sel.addEventListener('change', () => { param.table = sel.value || null; });
    popover.appendChild(makeRow('Table', sel));
  };

  // ── Type-specific fields ──────────────────────────────────────────────────

  const t = c.type;

  if (t === 'random') {
    const rndState = ctrl?.randoms?.get(param.id);
    popover.appendChild(makeRow('Rate (Hz)', makeDragNum(
      () => c.hz ?? 1,
      v  => { v = Math.max(0.01, v); c.hz = v; if (rndState) rndState.hz = v; }
    )));

  } else if (t.startsWith('lfo-')) {
    const lfoCtrl = ctrl?.lfos?.get(param.id);
    const lfo     = lfoCtrl?.lfo;

    const shapeSel = document.createElement('select');
    shapeSel.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 2px;border-radius:2px;';
    const SHAPES       = ['sine','triangle','sawtooth','rampdown','square','sh'];
    const SHAPE_LABELS = ['Sine','Triangle','Sawtooth','Ramp↓','Square','S+H'];
    SHAPES.forEach((s, i) => {
      const opt = document.createElement('option');
      opt.value = s; opt.textContent = SHAPE_LABELS[i];
      if ((lfo?.shape ?? t.replace('lfo-', '')) === s) opt.selected = true;
      shapeSel.appendChild(opt);
    });
    shapeSel.addEventListener('change', () => {
      const s = shapeSel.value;
      if (lfo) lfo.shape = s;
      c.type = `lfo-${s}`;
      param.controller = { ...c };
    });
    popover.appendChild(makeRow('Shape', shapeSel));

    const freqLabel = c.beatSync ? `Beat ÷${1 / (c.beatDiv ?? 1)}` : 'Freq (Hz)';
    popover.appendChild(makeRow(freqLabel, makeDragNum(
      () => lfo?.hz ?? c.hz ?? 0.5,
      v  => { v = Math.max(0.001, v); if (lfo) lfo.hz = v; c.hz = v; }
    )));

    popover.appendChild(makeRow('Phase', makeDragNum(
      () => lfo?.phase ?? c.phase ?? 0,
      v  => { v = Math.max(0, Math.min(1, v)); if (lfo) lfo.phase = v; c.phase = v; },
      { decimals: 2, fineStep: 0.01, coarseStep: 0.1 }
    )));

  } else if (t === 'fixed') {
    const decimals = param.step && param.step >= 1 ? 0 : 3;
    popover.appendChild(makeRow('Value', makeDragNum(
      () => param.value,
      v  => {
        v = Math.max(param.min, Math.min(param.max, v));
        c.value = v; param.value = v;
      },
      { decimals, fineStep: (param.max - param.min) * 0.005, coarseStep: (param.max - param.min) * 0.05 }
    )));

  } else if (t === 'midi-cc') {
    popover.appendChild(makeRow('CC#', makeDragNum(
      () => c.cc ?? 0,
      v  => { c.cc = Math.round(Math.max(0, Math.min(127, v))); },
      { decimals: 0, fineStep: 1, coarseStep: 10 }
    )));
    popover.appendChild(makeRow('Chan (0=any)', makeDragNum(
      () => c.channel ?? 0,
      v  => { c.channel = Math.round(Math.max(0, Math.min(16, v))); },
      { decimals: 0, fineStep: 1, coarseStep: 1 }
    )));

  } else if (t === 'midi-note') {
    popover.appendChild(makeRow('Note#', makeDragNum(
      () => c.note ?? 60,
      v  => { c.note = Math.round(Math.max(0, Math.min(127, v))); },
      { decimals: 0, fineStep: 1, coarseStep: 12 }
    )));
    popover.appendChild(makeRow('Chan (0=any)', makeDragNum(
      () => c.channel ?? 0,
      v  => { c.channel = Math.round(Math.max(0, Math.min(16, v))); },
      { decimals: 0, fineStep: 1, coarseStep: 1 }
    )));

  } else if (t === 'key') {
    const keySpan = document.createElement('span');
    keySpan.style.cssText = [
      'cursor:pointer;padding:1px 6px;background:var(--bg-4);',
      'border:1px solid var(--border);border-radius:2px;',
      'min-width:52px;display:inline-block;text-align:center;',
      'font-size:10px;color:var(--accent);',
    ].join('');
    keySpan.textContent = c.key ?? '?';
    keySpan.title = 'Click then press a key to reassign';
    keySpan.addEventListener('click', () => {
      keySpan.textContent = '…';
      keySpan.style.borderColor = 'var(--accent)';
      const onKey = e => {
        e.preventDefault(); e.stopPropagation();
        c.key = e.key;
        if (ctrl) ctrl.assign(param.id, { ...c });
        keySpan.textContent = e.key;
        keySpan.style.borderColor = 'var(--border)';
        document.removeEventListener('keydown', onKey, true);
      };
      document.addEventListener('keydown', onKey, true);
    });
    popover.appendChild(makeRow('Key', keySpan));

  } else if (t === 'expr') {
    const exprInput = document.createElement('input');
    exprInput.type = 'text';
    exprInput.value = c.expr ?? '';
    exprInput.style.cssText = [
      'width:140px;font:10px var(--mono);background:var(--bg-4);',
      'color:var(--text-1);border:1px solid var(--border);border-radius:2px;',
      'padding:1px 4px;outline:none;',
    ].join('');
    exprInput.placeholder = 'sin(t) * 50 + 50';
    const commitExpr = () => {
      const src = exprInput.value.trim();
      if (src && ctrl) ctrl.assign(param.id, { ...c, expr: src });
    };
    exprInput.addEventListener('blur',    commitExpr);
    exprInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') { commitExpr(); e.stopPropagation(); }
      e.stopPropagation(); // prevent global key shortcuts while typing
    });
    exprInput.addEventListener('pointerdown', e => e.stopPropagation());
    popover.appendChild(makeRow('Expr', exprInput));
    setTimeout(() => exprInput.focus(), 0);
  }

  // ── Shared rows (all controller types) ───────────────────────────────────
  addSlewRow();
  addTableRow();

  // ── Position & close wiring ───────────────────────────────────────────────

  document.body.appendChild(popover);

  const r = anchorEl.getBoundingClientRect();
  popover.style.left = `${r.right + 4}px`;
  popover.style.top  = `${r.top}px`;

  requestAnimationFrame(() => {
    const pr  = popover.getBoundingClientRect();
    let left  = r.right + 4;
    let top   = r.top;
    if (left + pr.width  > window.innerWidth)  left = r.left - pr.width - 4;
    if (top  + pr.height > window.innerHeight) top  = window.innerHeight - pr.height - 4;
    popover.style.left = `${Math.max(4, left)}px`;
    popover.style.top  = `${Math.max(4, top)}px`;
  });

  const closeClick = e => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('click',   closeClick, true);
      document.removeEventListener('keydown', closeKey,   true);
    }
  };
  const closeKey = e => {
    if (e.key === 'Escape') {
      popover.remove();
      document.removeEventListener('click',   closeClick, true);
      document.removeEventListener('keydown', closeKey,   true);
    }
  };
  setTimeout(() => {
    document.addEventListener('click',   closeClick, true);
    document.addEventListener('keydown', closeKey,   true);
  }, 0);
}

// ── ParamRow builder ──────────────────────────────────────────────────────────

/**
 * Build a parameter row element and wire it to a Parameter.
 * Supports: continuous (slider + value), toggle, select, trigger.
 * Right-click opens the controller context menu.
 */
export function buildParamRow(param, contextMenu) {
  const row = document.createElement('div');
  const typeClass = { [PARAM_TYPE.TOGGLE]: 'toggle-row', [PARAM_TYPE.SELECT]: 'select-row', [PARAM_TYPE.TRIGGER]: 'trigger-row' }[param.type] ?? '';
  row.className = `param-row ${typeClass}`;
  row.dataset.paramId = param.id;

  const label = document.createElement('span');
  label.className = 'param-label';
  label.textContent = param.label;

  const ctrlEl = document.createElement('span');
  ctrlEl.className = `param-ctrl ${param.controllerClass}`;
  ctrlEl.textContent = param.controllerLabel;

  // Right-click or Ctrl+click on badge → controller settings popover
  ctrlEl.addEventListener('contextmenu', e => {
    if (!param.controller) return;
    e.preventDefault();
    e.stopPropagation();
    _openCtrlPopover(param, ctrlEl, contextMenu?.ctrl, contextMenu?.tables);
  });
  // Track pointer type so click handler can distinguish touch tap vs mouse click
  let _ctrlPointerType = 'mouse';
  ctrlEl.addEventListener('click', e => {
    if (!param.controller) return;
    // Desktop: require ctrl/meta modifier; touch: plain tap is enough
    if (_ctrlPointerType === 'mouse' && !e.ctrlKey && !e.metaKey) return;
    e.preventDefault();
    e.stopPropagation();
    _openCtrlPopover(param, ctrlEl, contextMenu?.ctrl, contextMenu?.tables);
  });
  // Long-press (220ms) on touch devices → open controller popover
  let _longPressTimer = null;
  ctrlEl.addEventListener('pointerdown', e => {
    _ctrlPointerType = e.pointerType;
    e.stopPropagation(); // prevent row from capturing pointer + calling preventDefault
    if (e.pointerType !== 'touch' || !param.controller) return;
    _longPressTimer = setTimeout(() => {
      _openCtrlPopover(param, ctrlEl, contextMenu?.ctrl, contextMenu?.tables);
    }, 220);
  });
  const _cancelLongPress = () => clearTimeout(_longPressTimer);
  ctrlEl.addEventListener('pointerup',     _cancelLongPress);
  ctrlEl.addEventListener('pointercancel', _cancelLongPress);
  ctrlEl.addEventListener('pointermove',   _cancelLongPress);

  const valueEl = document.createElement('span');
  valueEl.className = 'param-value';

  const updateDisplay = () => {
    // SELECT with button group manages its own valueEl; skip textContent overwrite
    if (param.type !== PARAM_TYPE.SELECT) valueEl.textContent = param.displayValue;
    ctrlEl.textContent  = param.controllerLabel;
    ctrlEl.className    = `param-ctrl ${param.controllerClass}`;
    row.classList.toggle('active', !!param.controller);
  };

  // ── Type-specific controls ──────────────────────────────────────────────

  if (param.type === PARAM_TYPE.CONTINUOUS) {
    // Click+drag or slider — uses Pointer Events for mouse + touch + pen
    let startX = 0, startVal = 0;
    const range = param.max - param.min;

    row.addEventListener('pointerdown', e => {
      if (e.button !== 0 || param.locked) return;
      row.setPointerCapture(e.pointerId);
      startX   = e.clientX;
      startVal = param.value;
      e.preventDefault();
    });

    row.addEventListener('pointermove', e => {
      if (!row.hasPointerCapture(e.pointerId)) return;
      const delta = (e.clientX - startX) / 200 * range;
      param.value = startVal + delta;
      updateDisplay();
    });

    row.addEventListener('pointerup', () => {});

    // Alt+wheel or horizontal scroll to adjust value; plain vertical scroll scrolls the panel
    row.addEventListener('wheel', e => {
      const horiz = Math.abs(e.deltaX) > Math.abs(e.deltaY);
      if (!e.altKey && !horiz) return; // let vertical scroll pass through
      e.preventDefault();
      if (param.locked) return;
      const delta = horiz ? e.deltaX : e.deltaY;
      const step = range * 0.01 * (e.shiftKey ? 5 : 1);
      param.value = param.value - Math.sign(delta) * step;
      updateDisplay();
    }, { passive: false });

    // Double-click to reset
    row.addEventListener('dblclick', () => {
      param.reset();
      updateDisplay();
    });

    // Ctrl+click on value label → inline type-in
    valueEl.style.cursor = 'text';
    valueEl.addEventListener('click', e => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.stopPropagation();
      const input = document.createElement('input');
      input.type  = 'number';
      input.min   = param.min;
      input.max   = param.max;
      input.step  = param.step ?? 'any';
      input.value = param.value.toFixed(param.step ? 0 : 3);
      input.style.cssText = 'width:60px;font-size:11px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--accent);color:var(--text-0);padding:1px 3px;border-radius:3px;';
      valueEl.innerHTML = '';
      valueEl.appendChild(input);
      input.focus();
      input.select();
      const commit = () => {
        const v = parseFloat(input.value);
        if (!isNaN(v)) param.value = v;
        updateDisplay();
      };
      input.addEventListener('blur',    commit);
      input.addEventListener('keydown', e2 => {
        if (e2.key === 'Enter') { commit(); }
        if (e2.key === 'Escape') { updateDisplay(); }
      });
    });

  } else if (param.type === PARAM_TYPE.TOGGLE) {
    const dot = document.createElement('span');
    dot.className = `toggle-dot ${param.value ? 'on' : ''}`;
    valueEl.appendChild(dot);

    row.addEventListener('click', e => {
      if (e.button !== 0) return;
      param.toggle();
      dot.classList.toggle('on', !!param.value);
    });

  } else if (param.type === PARAM_TYPE.SELECT) {
    const opts = param.options ?? [];
    if (opts.length <= 8) {
      // Button group — compact, tactile, performance-friendly
      const group = document.createElement('div');
      group.className = 'param-btn-group';
      const btns = opts.map((opt, i) => {
        const btn = document.createElement('button');
        btn.className = 'param-opt-btn' + (i === param.value ? ' active' : '');
        // Smart abbreviation: if option contains '-', use the part after the last '-'
        const abbr = opt.includes('-') ? opt.split('-').pop().slice(0, 6)
                   : opt.length <= 6   ? opt : opt.slice(0, 4);
        btn.textContent = abbr;
        btn.title = opt;
        btn.addEventListener('click', () => {
          param.value = i;
          btns.forEach((b, j) => b.classList.toggle('active', j === param.value));
          updateDisplay();
        });
        group.appendChild(btn);
        return btn;
      });
      param.onChange(() => btns.forEach((b, j) => b.classList.toggle('active', j === param.value)));
      valueEl.appendChild(group);
    } else {
      // Fallback: native select for large option sets
      const sel = document.createElement('select');
      sel.className = 'param-select';
      opts.forEach((opt, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = param.value;
      sel.addEventListener('change', e => {
        param.value = parseInt(e.target.value);
        updateDisplay();
      });
      param.onChange(() => { sel.value = param.value; });
      valueEl.appendChild(sel);
    }

  } else if (param.type === PARAM_TYPE.TRIGGER) {
    const btn = document.createElement('button');
    btn.className = 'param-label';
    btn.textContent = '▶ Trigger';
    btn.style.cssText = 'font-size:11px;padding:2px 8px;background:var(--bg-4);border:1px solid var(--border);border-radius:3px;color:var(--text-1);cursor:pointer;';
    btn.addEventListener('click', () => param.trigger());
    row.appendChild(label);
    row.appendChild(ctrlEl);
    valueEl.appendChild(btn);
    row.appendChild(valueEl);
    return row;
  }

  // Right-click → context menu
  row.addEventListener('contextmenu', e => {
    e.preventDefault();
    contextMenu?.show(param, e.clientX, e.clientY);
  });

  // Long-press (500ms) on touch → context menu + haptic; cancel on movement > 8px
  let _lpTimer, _lpX = 0, _lpY = 0;
  row.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse') return;
    _lpX = e.clientX; _lpY = e.clientY;
    _lpTimer = setTimeout(() => {
      contextMenu?.show(param, _lpX, _lpY);
      navigator.vibrate?.(10);
    }, 500);
  });
  row.addEventListener('pointermove', e => {
    if (_lpTimer && (Math.abs(e.clientX - _lpX) > 8 || Math.abs(e.clientY - _lpY) > 8))
      clearTimeout(_lpTimer);
  });
  row.addEventListener('pointerup',     () => clearTimeout(_lpTimer));
  row.addEventListener('pointercancel', () => clearTimeout(_lpTimer));

  // Live update from external controller
  param.onChange(updateDisplay);
  updateDisplay();

  row.appendChild(label);
  row.appendChild(ctrlEl);

  // Min / Max range fields (continuous params only)
  if (param.type === PARAM_TYPE.CONTINUOUS) {
    const makeRangeEl = (which) => {
      const el = document.createElement('span');
      el.className = 'param-range';
      const refresh = () => {
        const v = which === 'min' ? (param.ctrlMin ?? param.min) : (param.ctrlMax ?? param.max);
        el.textContent = Number.isInteger(v) ? v : v.toFixed(1);
        el.classList.toggle('overridden', which === 'min' ? param.ctrlMin !== null : param.ctrlMax !== null);
      };
      refresh();
      param.onChange(refresh);

      // Drag up/down to adjust value; double-click to type
      el.style.cursor = 'ns-resize';
      let _rstartY = 0, _rstartVal = 0;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        _rstartY   = e.clientY;
        _rstartVal = which === 'min' ? (param.ctrlMin ?? param.min) : (param.ctrlMax ?? param.max);
        e.preventDefault();
        e.stopPropagation();
      });
      el.addEventListener('pointermove', e => {
        if (!el.hasPointerCapture(e.pointerId)) return;
        const step  = e.shiftKey ? (param.step ?? 1) : 0.1;
        let v = _rstartVal + (_rstartY - e.clientY) * step;
        const other = which === 'min' ? (param.ctrlMax ?? param.max) : (param.ctrlMin ?? param.min);
        if (which === 'min') { v = Math.min(v, other); param.ctrlMin = v; }
        else                 { v = Math.max(v, other); param.ctrlMax = v; }
        refresh();
      });
      el.addEventListener('pointerup', () => {});

      el.addEventListener('dblclick', e => {
        e.stopPropagation();
        e.preventDefault();
        const current = which === 'min' ? (param.ctrlMin ?? param.min) : (param.ctrlMax ?? param.max);
        const input = document.createElement('input');
        input.type  = 'number';
        input.value = current;
        input.step  = 'any';
        input.style.cssText = 'width:64px;font:inherit;font-size:inherit;background:#1f1f25;color:#e0e0f0;border:1px solid #c8a020;border-radius:3px;padding:1px 4px;outline:none;';
        el.innerHTML = '';
        el.appendChild(input);
        input.addEventListener('pointerdown', e2 => e2.stopPropagation());
        setTimeout(() => { input.focus(); input.select(); }, 0);
        const commit = () => {
          const v = parseFloat(input.value);
          if (!isNaN(v)) {
            const other = which === 'min' ? (param.ctrlMax ?? param.max) : (param.ctrlMin ?? param.min);
            if (which === 'min') param.ctrlMin = Math.min(v, other);
            else                 param.ctrlMax = Math.max(v, other);
          }
          refresh();
        };
        input.addEventListener('blur',    commit);
        input.addEventListener('keydown', e2 => {
          if (e2.key === 'Enter')  { commit(); e2.stopPropagation(); }
          if (e2.key === 'Escape') { refresh(); e2.stopPropagation(); }
        });
      });
      return el;
    };
    row.appendChild(makeRangeEl('min'));
    row.appendChild(makeRangeEl('max'));

    // Thin slider under value for touch-friendly adjustment
    row.classList.add('has-slider');
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.className = 'param-slider';
    slider.min   = param.min;
    slider.max   = param.max;
    slider.step  = param.step ?? 'any';
    slider.value = param.value;
    slider.addEventListener('input', () => {
      param.value = parseFloat(slider.value);
      updateDisplay();
    });
    param.onChange(() => { slider.value = param.value; });
    row.appendChild(slider);
  }

  row.appendChild(valueEl);
  return row;
}

// ── Layer source button matrix ────────────────────────────────────────────────

// Short labels for each source index (matches SOURCES order in ParameterSystem)
// Indices match SOURCES order: Camera(0)…Color2(10), Sound(11, DS only)
// Indices: Camera(0)…Color2(10), Text(11), Sound(12 — DS only)
const SOURCE_ABBREV = ['CAM','MOV','BUF','COL','NSE','3D','DRW','OUT','BG1','BG2','COL2','TXT','SND'];

/**
 * Builds the FG / BG / DS source-selector rows in #layer-params.
 * Each row: a label + one button per source option.
 * Clicking a button sets the param immediately.
 * Buttons stay in sync when the param is driven by a controller.
 * Right-click on any button or label opens the controller context menu.
 */
export function buildLayerButtons(ps, contextMenu) {
  const el = document.getElementById('layer-params');
  if (!el) return;
  el.innerHTML = '';

  [
    { param: ps.get('layer.fg'), label: 'Foreground' },
    { param: ps.get('layer.bg'), label: 'Background' },
    { param: ps.get('layer.ds'), label: 'DisplaceSrc' },
  ].forEach(({ param, label }) => {
    const row = document.createElement('div');
    row.className = 'param-row';

    const lbl = document.createElement('span');
    lbl.className = 'param-label';
    lbl.textContent = label;
    lbl.addEventListener('contextmenu', e => {
      e.preventDefault();
      contextMenu?.show(param, e.clientX, e.clientY);
    });
    row.appendChild(lbl);

    const sel = document.createElement('select');
    sel.className = 'source-select';
    (param.options ?? []).forEach((opt, i) => {
      const option = document.createElement('option');
      option.value = i;
      option.textContent = opt;
      if (i === param.value) option.selected = true;
      sel.appendChild(option);
    });
    sel.addEventListener('change', () => { param.value = parseInt(sel.value); });
    sel.addEventListener('contextmenu', e => {
      e.preventDefault();
      contextMenu?.show(param, e.clientX, e.clientY);
    });

    // Keep in sync with controller changes (MIDI, LFO, etc.)
    param.onChange(v => { sel.value = Math.round(v); });

    row.appendChild(sel);
    el.appendChild(row);
  });
}

// ── Populate mapping panels ───────────────────────────────────────────────────

export function buildMappingPanels(ps, contextMenu) {
  const sections = {
    'mirror-params':   ps.getGroup('mirror'),
    'keyer-params':    ps.getGroup('keyer'),
    'displace-params': ps.getGroup('displace').filter(p => !p.id.startsWith('displace.warp')),
    'blend-params':    ps.getGroup('blend'),
    'color-params':    ps.getGroup('color'),
    'noise-params':    ps.getGroup('noise'),
    'output-params':   ps.getGroup('output'),
    'buffer-controls': ps.getGroup('buffer'),
    'clip-params':     ps.getGroup('movie'),
    'transform-params': ps.getGroup('scene3d').filter(p => p.id.includes('rot') || p.id.includes('pos') || p.id.includes('scale') || p.id.includes('spin')),
    'camera3d-params': ps.getGroup('scene3d').filter(p => p.id.includes('cam')),
    'material-params': ps.getGroup('scene3d').filter(p => p.id.includes('mat') || p.id.includes('wire') || p.id.includes('light') || p.id.includes('depth')),
    'draw-params':     ps.getGroup('draw'),
    'text-params':     ps.getGroup('text'),
    'fg-params':       ps.getGroup('fg'),
    'bg-params':       ps.getGroup('bg'),
    'effect-params':   ps.getGroup('effect'),
    'global-params':       ps.getGroup('global'),
    'particle-params':     ps.getGroup('particle'),
    'sdf-params':          ps.getGroup('sdf'),
    'delay-params':        ps.getGroup('delay'),
    'vasulka-params':      ps.getGroup('vasulka'),
    'vectorscope-params':  ps.getGroup('vectorscope'),
    'slitscan-params':     ps.getGroup('slitscan'),
    'vwarp-params':        ps.getGroup('vwarp'),
    // 'seq-params' is built by buildSeqParams() — skip here
    // 'layer-params' is owned by buildLayerButtons() — do not render here
    'lut-params':          ps.getGroup('lut'),
  };

  Object.entries(sections).forEach(([elId, params]) => {
    const el = document.getElementById(elId);
    if (!el || !params.length) return;
    el.innerHTML = '';
    params.forEach(p => el.appendChild(buildParamRow(p, contextMenu)));
  });
}

// ── Sequence params panel ─────────────────────────────────────────────────────

const SEQ_SRC_OPTS = [
  { label: 'Out',  title: 'Output (composite)' },
  { label: 'Cam',  title: 'Camera' },
  { label: 'Mov',  title: 'Movie / Video clip' },
  { label: 'FG',   title: 'Foreground layer source' },
  { label: 'BG',   title: 'Background layer source' },
  { label: 'Buf',  title: 'Stills buffer' },
  { label: 'Draw', title: 'Draw layer' },
];

export function buildSeqParams(ps, contextMenu) {
  const el = document.getElementById('seq-params');
  if (!el) return;
  el.innerHTML = '';

  [1, 2, 3].forEach(n => {
    const card = document.createElement('div');
    card.className = 'seq-card';

    // ── Header row: label + active toggle ──
    const hdr = document.createElement('div');
    hdr.className = 'seq-card-hdr';

    const hdrLabel = document.createElement('span');
    hdrLabel.className = 'seq-card-label';
    hdrLabel.textContent = `Seq ${n}`;

    const activeParam = ps.get(`seq${n}.active`);
    const recBtn = document.createElement('button');
    const setRecBtnState = () => {
      recBtn.textContent = activeParam.value ? '⏺ REC' : '⏺ OFF';
      recBtn.classList.toggle('active', !!activeParam.value);
    };
    setRecBtnState();
    recBtn.title = 'Toggle recording';
    recBtn.className = 'seq-rec-btn';
    recBtn.addEventListener('click', () => {
      activeParam.toggle();
      setRecBtnState();
    });
    activeParam.onChange(setRecBtnState);

    hdr.appendChild(hdrLabel);
    hdr.appendChild(recBtn);
    card.appendChild(hdr);

    // ── Source row: compact buttons ──
    const srcLabel = document.createElement('div');
    srcLabel.className = 'seq-row-label';
    srcLabel.textContent = 'Source';
    card.appendChild(srcLabel);

    const srcRow = document.createElement('div');
    srcRow.className = 'seq-src-row';
    const srcParam = ps.get(`seq${n}.source`);

    SEQ_SRC_OPTS.forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.textContent = opt.label;
      btn.title = opt.title;
      btn.className = 'seq-src-btn';
      const refresh = () => btn.classList.toggle('active', srcParam.value === i);
      refresh();
      srcParam.onChange(refresh);
      btn.addEventListener('click', () => {
        srcParam.value = i;
      });
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextMenu?.show(srcParam, e.clientX, e.clientY);
      });
      srcRow.appendChild(btn);
    });
    card.appendChild(srcRow);

    // ── Speed row ──
    const speedParam = ps.get(`seq${n}.speed`);
    card.appendChild(buildParamRow(speedParam, contextMenu));

    // ── Frames row + memory hint ──
    const sizeParam = ps.get(`seq${n}.size`);
    card.appendChild(buildParamRow(sizeParam, contextMenu));

    // Memory estimate (updates live as slider is dragged)
    const memHint = document.createElement('div');
    memHint.className = 'seq-mem-hint';
    const updateMemHint = (frames) => {
      // Approximate: W × H × 4 bytes per frame; use screen size as proxy
      const W = window.innerWidth  || 1280;
      const H = window.innerHeight || 720;
      const mb = Math.round(frames * W * H * 4 / 1024 / 1024);
      const warn = mb > 800;
      memHint.textContent = `≈ ${mb} MB VRAM${warn ? ' ⚠' : ''}`;
      memHint.style.color = warn ? 'var(--red)' : 'var(--text-2)';
    };
    updateMemHint(sizeParam.value);
    sizeParam.onChange(updateMemHint);
    card.appendChild(memHint);

    el.appendChild(card);
  });
}

// ── 3D geometry buttons ───────────────────────────────────────────────────────

export function buildGeometryButtons(ps, sceneManager, contextMenu) {
  const el = document.getElementById('geometry-controls');
  if (!el) return;

  // 3D on/off toggle at top of section
  const activeParam = ps.get('scene3d.active');
  const btn3D = document.createElement('button');
  btn3D.className = 'import-btn';
  btn3D.style.cssText = 'margin:0 0 8px 0;';
  const update3DBtn = () => {
    btn3D.textContent = activeParam.value ? '■ 3D Scene On' : '▶ 3D Scene Off';
  };
  update3DBtn();
  btn3D.addEventListener('click', () => {
    activeParam.toggle();
    update3DBtn();
  });
  activeParam.onChange(update3DBtn);
  el.appendChild(btn3D);

  const geoParam = ps.get('scene3d.geo');
  const names = geoParam.options;

  names.forEach((name, i) => {
    const btn = document.createElement('button');
    btn.className = `geo-btn ${i === 0 ? 'active' : ''}`;
    btn.textContent = name;
    btn.addEventListener('click', () => {
      geoParam.value = i;
      document.querySelectorAll('.geo-btn').forEach((b, j) => b.classList.toggle('active', j === i));
    });
    el.appendChild(btn);
  });

  // ── Transform section ────────────────────────────────────────────────────
  const transformEl = document.getElementById('transform-params');
  if (transformEl) {
    // Screen XY toggle — sits above the position rows as a mode switch
    const screenRow = buildParamRow(ps.get('scene3d.pos.screenspace'), contextMenu);
    const hint = document.createElement('div');
    hint.className = 'import-note';
    hint.style.cssText = 'margin:2px 0 6px 0; color:var(--text-2);';
    const updateHint = () => {
      hint.textContent = ps.get('scene3d.pos.screenspace').value
        ? 'X/Y: ±1 = screen edge  ·  Z: world units'
        : 'X/Y/Z: world units  ·  default cam at z=5';
    };
    updateHint();
    ps.get('scene3d.pos.screenspace').onChange(updateHint);
    transformEl.appendChild(screenRow);
    transformEl.appendChild(hint);

    ['scene3d.pos.x','scene3d.pos.y','scene3d.pos.z',
     'scene3d.rot.x','scene3d.rot.y','scene3d.rot.z',
     'scene3d.spin.x','scene3d.spin.y','scene3d.spin.z',
     'scene3d.scale','scene3d.norm',
    ].forEach(id => {
      const p = ps.get(id);
      if (p) transformEl.appendChild(buildParamRow(p, contextMenu));
    });
  }

  // ── Cloner section ───────────────────────────────────────────────────────
  const clonerEl = document.getElementById('cloner-params');
  if (clonerEl) {
    ['scene3d.clone.mode',    'scene3d.clone.count',
     'scene3d.clone.spread',    'scene3d.clone.wave',
     'scene3d.clone.waveshape', 'scene3d.clone.waveamp', 'scene3d.clone.wavefreq',
     'scene3d.clone.twist',   'scene3d.clone.scatter',
     'scene3d.clone.scale',   'scene3d.clone.scalestep',
    ].forEach(id => {
      const p = ps.get(id);
      if (p) clonerEl.appendChild(buildParamRow(p, contextMenu));
    });
  }

  // ── Blob / Morph section ─────────────────────────────────────────────────
  const blobEl = document.getElementById('blob-params');
  if (blobEl) {
    ['scene3d.blob.amount', 'scene3d.blob.scale', 'scene3d.blob.speed',
    ].forEach(id => {
      const p = ps.get(id);
      if (p) blobEl.appendChild(buildParamRow(p, contextMenu));
    });
  }

  // Model import buttons
  const importEl = document.getElementById('model-import');
  if (!importEl) return;

  // Status label — updated by main.js via _refreshModelLabel()
  const modelLabel = document.createElement('div');
  modelLabel.id = 'model-status-label';
  modelLabel.className = 'import-note';
  modelLabel.textContent = 'No model loaded — drop .glb/.obj/.stl/.dae here or use buttons below';
  importEl.appendChild(modelLabel);

  const importBtn = document.createElement('button');
  importBtn.className = 'import-btn';
  importBtn.textContent = '+ Import Model (GLB / OBJ / STL / DAE)';
  const _doImport = async (files) => {
    const modelFile = files.find(f => /\.(glb|gltf|obj|stl|dae)$/i.test(f.name));
    if (!modelFile) return;
    importBtn.textContent = '⏳ Loading…';
    try {
      await sceneManager.loadModel(modelFile, ps, files);
      modelLabel.textContent = `✓ ${modelFile.name} (+${files.length - 1} assets)`;
      modelLabel.style.color = 'var(--green)';
      importBtn.textContent = '+ Import Model';
      importEl.dispatchEvent(new CustomEvent('modelLoaded', { bubbles: true, detail: { name: modelFile.name } }));
    } catch (err) {
      console.error('[Import]', err);
      modelLabel.textContent = `✗ Error: ${err.message}`;
      modelLabel.style.color = 'var(--red, #e05)';
      importBtn.textContent = '+ Import Model';
    }
  };

  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    // Accept model formats + common texture formats so they survive the file picker filter
    input.accept = '.gltf,.glb,.obj,.stl,.dae,.jpg,.jpeg,.png,.webp,.bmp,.tga,.mtl,.bin';
    input.multiple = true;
    input.onchange = e => _doImport(Array.from(e.target.files));
    input.click();
  });
  importEl.appendChild(importBtn);

  // Folder import — picks entire directory; best for DAE/OBJ + textures
  const folderBtn = document.createElement('button');
  folderBtn.className = 'import-btn';
  folderBtn.textContent = '📁 Import Folder (DAE / OBJ + textures)';
  folderBtn.title = 'Select the folder containing the model and its textures';
  folderBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.webkitdirectory = true;
    input.onchange = e => _doImport(Array.from(e.target.files));
    input.click();
  });
  importEl.appendChild(folderBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'import-btn';
  clearBtn.textContent = '↩ Back to Geometry';
  clearBtn.title = 'Remove imported model and return to procedural geometry';
  clearBtn.addEventListener('click', () => {
    const geoIdx = ps.get('scene3d.geo').value;
    const geoName = ps.get('scene3d.geo').options[geoIdx] ?? 'Sphere';
    // Clear imported model then force geometry re-select
    sceneManager._importedModelName = null;
    sceneManager._geoKey = null;  // invalidate so setGeometry actually runs
    sceneManager.setGeometry(geoName);
    modelLabel.textContent = 'No model loaded — drop .glb/.obj/.stl/.dae here or use button below';
    modelLabel.style.color = '';
  });
  importEl.appendChild(clearBtn);

  const note = document.createElement('div');
  note.className = 'import-note';
  note.style.marginTop = '4px';
  note.textContent = 'Tip: drag & drop model files anywhere onto the app window';
  importEl.appendChild(note);

  // ── Model size controls (shown when a model is imported) ──────────────────
  const sizeSection = document.createElement('div');
  sizeSection.id = 'model-size-controls';
  sizeSection.style.cssText = 'display:none; margin-top:10px; border-top:1px solid var(--border); padding-top:8px;';

  const sizeLabel = document.createElement('div');
  sizeLabel.className = 'import-note';
  sizeLabel.style.cssText = 'margin-bottom:4px; font-weight:bold; color:var(--text-1);';
  sizeLabel.textContent = 'Model Size';
  sizeSection.appendChild(sizeLabel);
  sizeSection.appendChild(buildParamRow(ps.get('scene3d.norm'), contextMenu));
  sizeSection.appendChild(buildParamRow(ps.get('scene3d.scale'), contextMenu));
  importEl.appendChild(sizeSection);

  // ── Animation controls (shown when model has animations) ──────────────────
  const animSection = document.createElement('div');
  animSection.id = 'model-anim-controls';
  animSection.style.cssText = 'display:none; margin-top:10px; border-top:1px solid var(--border); padding-top:8px;';

  const animLabel = document.createElement('div');
  animLabel.className = 'import-note';
  animLabel.style.cssText = 'margin-bottom:4px; font-weight:bold; color:var(--text-1);';
  animLabel.textContent = 'Animations';
  animSection.appendChild(animLabel);
  animSection.appendChild(buildParamRow(ps.get('scene3d.anim.active'), contextMenu));
  animSection.appendChild(buildParamRow(ps.get('scene3d.anim.select'), contextMenu));
  animSection.appendChild(buildParamRow(ps.get('scene3d.anim.speed'), contextMenu));
  importEl.appendChild(animSection);

  // Show/hide model sections when a model is loaded or cleared
  const refreshModelSections = () => {
    const hasModel = !!sceneManager.importedModelName;
    const hasAnims = hasModel && sceneManager.actions && sceneManager.actions.length > 0;
    sizeSection.style.display = hasModel ? '' : 'none';
    animSection.style.display = hasAnims ? '' : 'none';
  };

  importEl.addEventListener('modelLoaded', refreshModelSections);
  clearBtn.addEventListener('click', refreshModelSections);
}

// ── State dots ────────────────────────────────────────────────────────────────

export class StateDots {
  constructor(presetManager) {
    this.pm = presetManager;
    this.el = document.getElementById('state-dots');
    this.dots = [];
    this._build();
    this._wirePresetManager();
  }

  _build() {
    if (!this.el) return;
    this.el.innerHTML = '';
    this.dots = [];
    for (let i = 0; i < 128; i++) {
      const dot = document.createElement('div');
      dot.className = 'state-dot';
      dot.title = `State ${i} (click to recall, right-click to store)`;
      dot.dataset.idx = i;

      dot.addEventListener('click', e => {
        e.preventDefault();
        this.pm.recallState(i);
      });

      dot.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.pm.saveCurrentState(i).then(() => this._refresh());
      });

      this.el.appendChild(dot);
      this.dots.push(dot);
    }
  }

  _refresh() {
    const preset = this.pm.current;
    if (!preset) return;
    this.dots.forEach((dot, i) => {
      dot.className = 'state-dot';
      if (preset.states[i])        dot.classList.add('stored');
      if (preset.activeState === i) dot.classList.add('active');
    });
  }

  _wirePresetManager() {
    this.pm.addEventListener('presetActivated', () => this._refresh());
    this.pm.addEventListener('stateSaved',      () => this._refresh());
    this.pm.addEventListener('stateRecalled',   () => this._refresh());
  }
}

// ── Signal path display ────────────────────────────────────────────────────────

// Map from fx ID to { label, isActive(p) } for the signal path display
const _FX_NODE_INFO = {
  pixelate:    { label: 'pixel',   isActive: p => p.get('effect.pixelate').value > 1 },
  edge:        { label: 'edge',    isActive: p => p.get('effect.edge').value > 0 },
  rgbshift:    { label: 'rgb»',    isActive: p => p.get('effect.rgbshift').value > 0 },
  kaleidoscope:{ label: 'kale',    isActive: p => p.get('effect.kaleidoscope').value >= 2 },
  quadmirror:  { label: 'mirror',  isActive: p => p.get('effect.quadmirror').value > 0 },
  posterize:   { label: 'poster',  isActive: p => p.get('effect.posterize').value < 32 },
  solarize:    { label: 'solar',   isActive: p => p.get('effect.solarize').value < 100 },
  vignette:    { label: 'vign',    isActive: p => p.get('effect.vignette').value > 0 },
  bloom:       { label: 'bloom',   isActive: p => p.get('effect.bloom').value > 0 },
  levels:      { label: 'levels',  isActive: p => p.get('effect.lvblack').value > 0 || p.get('effect.lvwhite').value < 100 || p.get('effect.lvgamma').value !== 100 },
  lut:         { label: 'lut',     isActive: p => (p.get('effect.lutamount')?.value ?? 0) > 0 },
  whitebal:    { label: 'wbal',    isActive: p => (p.get('effect.wbtemp')?.value ?? 0) !== 0 || (p.get('effect.wbtint')?.value ?? 0) !== 0 },
  pixelsort:   { label: 'psort',   isActive: p => p.get('effect.pixelsort').value > 0 },
  grain:       { label: 'grain',   isActive: p => p.get('effect.grain').value > 0 || p.get('effect.scanlines').value > 0 },
};

export class SignalPath {
  constructor({ ps, pipeline = null, onOrderChange = null }) {
    this.ps = ps;
    this.pipeline = pipeline;
    this.onOrderChange = onOrderChange;
    this.el = document.getElementById('signal-path-display');
    this._fxOrder = pipeline ? [...pipeline.fxOrder] : [...DEFAULT_FX_ORDER_SP];
    this._dragSrc = null;
    this._render();

    // Re-render on sequence changes too
    ['seq1.active','seq1.source','seq1.speed',
     'seq2.active','seq2.source','seq2.speed',
     'seq3.active','seq3.source','seq3.speed',
    ].forEach(id => { ps.get(id)?.onChange(() => this._render()); });

    // Re-render on layer/effect changes
    [
      'layer.fg','layer.bg','layer.ds',
      'keyer.active','keyer.extkey',
      'displace.amount','displace.warp',
      'blend.active','feedback.hor','feedback.ver','feedback.scale',
      'output.colorshift','output.fade',
      'effect.pixelate','effect.edge','effect.rgbshift','effect.kaleidoscope','effect.posterize','effect.solarize',
      'effect.vignette','effect.bloom','effect.pixelsort','effect.grain','effect.scanlines','effect.strobe',
      'effect.quadmirror','effect.lvblack','effect.lvwhite','effect.lvgamma',
      'effect.lutamount','effect.wbtemp','effect.wbtint',
      'fg.hue','fg.sat','fg.bright','bg.hue','bg.sat','bg.bright',
      'keyer.chroma',
    ].forEach(id => {
      ps.get(id)?.onChange(() => this._render());
    });
  }

  _render() {
    if (!this.el) return;
    const p = this.ps;
    const fgSrc   = p.get('layer.fg').displayValue;
    const bgSrc   = p.get('layer.bg').displayValue;
    const dsSrc   = p.get('layer.ds').displayValue;
    const keyerOn  = p.get('keyer.active').value;
    const extKeyOn = p.get('keyer.extkey').value;
    const displOn  = p.get('displace.amount').value > 0;
    const warpOn   = p.get('displace.warp').value > 0;
    const blendOn  = p.get('blend.active').value;
    const fbOn     = blendOn && (
      p.get('feedback.hor').value !== 0 ||
      p.get('feedback.ver').value !== 0 ||
      p.get('feedback.scale').value !== 0
    );
    const csOn      = p.get('output.colorshift').value > 0;
    const fadeOn    = p.get('output.fade').value > 0;
    const fgCCon    = p.get('fg.hue').value !== 0 || p.get('fg.sat').value !== 100 || p.get('fg.bright').value !== 100;
    const bgCCon    = p.get('bg.hue').value !== 0 || p.get('bg.sat').value !== 100 || p.get('bg.bright').value !== 100;
    const chromaOn  = p.get('keyer.chroma').value;
    const strobeOn2 = p.get('effect.strobe').value;

    this.el.innerHTML = '';
    const mainRow = document.createElement('div');
    mainRow.style.cssText = 'display:flex;align-items:center;gap:6px;';
    this.el.appendChild(mainRow);

    // Build pre-FX fixed nodes
    const fixedNodes = [
      { label: fgSrc,  type: 'source' },
      ...(fgCCon ? [{ label: 'fg-cc',  type: 'active' }] : []),
      { label: '/',    type: 'merge' },
      { label: bgSrc,  type: 'source' },
      ...(bgCCon ? [{ label: 'bg-cc',  type: 'active' }] : []),
      keyerOn  ? { label: extKeyOn ? 'extkey' : 'keyer', type: 'active' } : { label: 'keyer',    type: 'node' },
      ...(chromaOn ? [{ label: 'chroma', type: 'active' }] : []),
      displOn  ? { label: 'displace', type: 'active' }  : { label: 'displace',  type: 'node' },
      warpOn   ? { label: 'warp',     type: 'active' }  : null,
      { label: dsSrc,  type: 'source' },
      blendOn  ? { label: fbOn ? 'blend+fb' : 'blend', type: 'active' } : { label: 'blend', type: 'node' },
      ...(csOn   ? [{ label: 'cshift',  type: 'active' }] : []),
    ].filter(Boolean);

    // Build post-FX nodes in current order (only active ones rendered, but fxId stored for drag)
    const fxNodes = this._fxOrder
      .map(fxId => {
        const info = _FX_NODE_INFO[fxId];
        if (!info) return null;
        const active = info.isActive(p);
        if (!active) return null;
        return { label: info.label, type: 'active', fxId, draggable: true };
      })
      .filter(Boolean);

    // Tail nodes (fixed, not draggable)
    const tailNodes = [
      ...(strobeOn2 ? [{ label: 'strobe', type: 'active' }] : []),
      ...(fadeOn    ? [{ label: 'fade',   type: 'active' }] : []),
      { label: '▶ out', type: 'active' },
    ];

    const allNodes = [...fixedNodes, ...fxNodes, ...tailNodes];

    // ── Sequence rows (below main chain) ──────────────────────────────────
    const seqRowEls = [];
    const SEQ_SRC_OPTIONS = ['Output','Camera','Movie','FG','BG','Buffer','Draw'];
    [1,2,3].forEach(n => {
      const active = p.get(`seq${n}.active`)?.value;
      if (!active) return;
      const srcIdx  = p.get(`seq${n}.source`)?.value ?? 0;
      const speed   = (p.get(`seq${n}.speed`)?.value ?? 100);
      const spdLbl  = speed === 100 ? '1×' : (speed / 100).toFixed(1) + '×';

      const row = document.createElement('div');
      row.className = 'sp-seq-row';

      // Source <select>
      const sel = document.createElement('select');
      sel.className = 'sp-seq-source';
      SEQ_SRC_OPTIONS.forEach((opt, i) => {
        const o = document.createElement('option');
        o.value = i; o.textContent = opt;
        sel.appendChild(o);
      });
      sel.value = srcIdx;
      sel.title = `Seq${n} record source`;
      sel.addEventListener('change', e => {
        p.get(`seq${n}.source`).value = parseInt(e.target.value);
      });
      sel.addEventListener('click', e => e.stopPropagation()); // don't trigger drag etc.

      const arrow1 = document.createElement('span');
      arrow1.className = 'sp-arrow'; arrow1.textContent = '→';

      const recNode = document.createElement('span');
      recNode.className = 'sp-node active';
      recNode.textContent = `seq${n} ⏺`;

      const arrow2 = document.createElement('span');
      arrow2.className = 'sp-arrow'; arrow2.textContent = '→';

      const spdNode = document.createElement('span');
      spdNode.className = 'sp-node active';
      spdNode.textContent = spdLbl;

      row.appendChild(sel);
      row.appendChild(arrow1);
      row.appendChild(recNode);
      row.appendChild(arrow2);
      row.appendChild(spdNode);
      seqRowEls.push(row);
    });

    allNodes.forEach((n, i) => {
      const el = document.createElement('div');
      if (n.type === 'merge') {
        el.className = 'sp-merge';
        el.textContent = '╱';
      } else if (n.label === '▶ out') {
        el.className = 'sp-node active';
        el.textContent = n.label;
      } else {
        el.className = `sp-node ${n.type}`;
        el.textContent = n.label;
        if (n.draggable && n.fxId) {
          el.classList.add('draggable');
          el.draggable = true;
          el.dataset.fxId = n.fxId;
          el.addEventListener('dragstart', e => {
            this._dragSrc = n.fxId;
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', n.fxId);
          });
          el.addEventListener('dragover', e => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            el.classList.add('drag-over');
          });
          el.addEventListener('dragleave', () => {
            el.classList.remove('drag-over');
          });
          el.addEventListener('drop', e => {
            e.preventDefault();
            el.classList.remove('drag-over');
            const srcId = this._dragSrc;
            const dstId = n.fxId;
            if (!srcId || srcId === dstId) return;
            // Reorder within this._fxOrder: move srcId to position of dstId
            const newOrder = [...this._fxOrder];
            const srcIdx = newOrder.indexOf(srcId);
            const dstIdx = newOrder.indexOf(dstId);
            if (srcIdx === -1 || dstIdx === -1) return;
            newOrder.splice(srcIdx, 1);
            newOrder.splice(dstIdx, 0, srcId);
            this._fxOrder = newOrder;
            if (this.pipeline) this.pipeline.setFxOrder(newOrder);
            if (this.onOrderChange) this.onOrderChange(newOrder);
            this._render();
          });
          el.addEventListener('dragend', () => {
            this._dragSrc = null;
            this.el.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
          });
        }
      }
      mainRow.appendChild(el);

      if (i < allNodes.length - 1 && n.type !== 'merge' && allNodes[i+1].type !== 'merge') {
        const arrow = document.createElement('div');
        arrow.className = 'sp-arrow';
        arrow.textContent = '→';
        mainRow.appendChild(arrow);
      }
    });

    // Append sequence rows below the main chain
    seqRowEls.forEach(row => this.el.appendChild(row));
  }
}

// ── Context menu for parameter controller assignment ───────────────────────────

export class ContextMenu {
  constructor(ps, controllerManager, presetManager = null, tableManager = null) {
    this.ps      = ps;
    this.ctrl    = controllerManager;
    this.presets = presetManager;
    this.tables  = tableManager;
    this.el      = document.getElementById('param-context-menu');
    this._currentParam = null;
    this._tablePopup   = null;
    this._wire();
  }

  show(param, x, y) {
    this._currentParam = param;
    document.getElementById('ctx-param-label').textContent = param.label;

    // Mark current controller type as active
    this.el.querySelectorAll('.menu-item[data-ctrl]').forEach(btn => {
      btn.classList.toggle('active', param.controller?.type === btn.dataset.ctrl);
    });

    // Populate active xController list
    const xmapList = document.getElementById('ctx-xmap-list');
    if (xmapList) {
      xmapList.innerHTML = '';
      (param.xControllers ?? []).forEach((xc, idx) => {
        if (!xc) return;
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;align-items:center;gap:2px;padding:1px 6px;';
        const lbl = document.createElement('span');
        lbl.style.cssText = 'flex:1;font-size:10px;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
        const typeShort = xc.type.replace('lfo-', '').replace('sound-', 'snd-').replace('mouse-', 'm-');
        lbl.textContent = `↪ ${typeShort} → ${xc.target}`;
        lbl.title = `${xc.type} → ${xc.target}${xc.hz ? ' @ ' + xc.hz.toFixed(2) + 'Hz' : ''}`;
        const del = document.createElement('button');
        del.className = 'menu-item';
        del.style.cssText = 'padding:0 5px;font-size:11px;line-height:16px;min-width:0;';
        del.textContent = '×';
        const capturedIdx = idx;
        del.addEventListener('click', e => {
          e.stopPropagation();
          this.ctrl.removeX(param.id, capturedIdx);
          this.hide();
        });
        row.append(lbl, del);
        xmapList.appendChild(row);
      });
    }

    // LFO visualizer — draw waveform preview when param has an LFO controller
    const vizCanvas = document.getElementById('ctx-lfo-viz');
    if (vizCanvas) {
      const lfoEntry = this.ctrl.lfos?.get(param.id);
      if (lfoEntry) {
        vizCanvas.style.display = 'block';
        this._drawLFOViz(vizCanvas, lfoEntry.lfo);
      } else {
        vizCanvas.style.display = 'none';
      }
    }

    this.el.style.left = `${x}px`;
    this.el.style.top  = `${y}px`;
    this.el.classList.remove('hidden');

    // Clamp to viewport — all four edges, after browser has computed menu size
    requestAnimationFrame(() => {
      const r   = this.el.getBoundingClientRect();
      const pad = 4;
      let left = x;
      let top  = y;
      if (left + r.width  > window.innerWidth)  left = x - r.width;
      if (top  + r.height > window.innerHeight) top  = y - r.height;
      left = Math.max(pad, Math.min(left, window.innerWidth  - r.width  - pad));
      top  = Math.max(pad, Math.min(top,  window.innerHeight - r.height - pad));
      this.el.style.left = `${left}px`;
      this.el.style.top  = `${top}px`;
    });
  }

  hide() {
    this.el.classList.add('hidden');
    this._currentParam = null;
  }

  _drawLFOViz(canvas, lfo) {
    const W   = canvas.width;
    const H   = canvas.height;
    const ctx = canvas.getContext('2d');

    ctx.clearRect(0, 0, W, H);

    // Grid centre line
    ctx.strokeStyle = '#2a2a3a';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(0, H / 2);
    ctx.lineTo(W, H / 2);
    ctx.stroke();

    // Waveform — sample 2 full cycles across the canvas width
    ctx.strokeStyle = '#e8c840';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    const cycles = 2;
    for (let px = 0; px <= W; px++) {
      const t   = (px / W) * cycles % 1;
      const val = lfo._sample(t); // 0–1
      const py  = H - val * H;
      px === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
    }
    ctx.stroke();

    // Current phase marker
    const cx  = ((lfo._t % 1) / cycles) * W;
    ctx.strokeStyle = '#60a0e0';
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(cx, 0);
    ctx.lineTo(cx, H);
    ctx.stroke();

    // Hz label
    const bpmDiv = this._currentParam?.controller?.bpmDiv;
    const label  = bpmDiv != null ? `÷${1 / bpmDiv}` : `${lfo.hz.toFixed(2)}Hz`;
    ctx.fillStyle = '#9090a8';
    ctx.font      = '9px monospace';
    ctx.fillText(label, 4, H - 4);
  }

  _wire() {
    // Close on outside click
    document.addEventListener('click', e => {
      if (!this.el.contains(e.target)) this.hide();
    });

    // Controller selection
    this.el.querySelectorAll('.menu-item[data-ctrl]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._currentParam) return;
        const type = btn.dataset.ctrl;

        if (type === 'none') {
          this.ctrl.assign(this._currentParam.id, null);
        } else if (type === 'midi-cc') {
          const raw = prompt('MIDI CC — enter CC number, or "ch:cc" to filter by channel\n(e.g. "7" or "1:7")', '7');
          if (raw !== null) {
            const parts = raw.split(':');
            const cc = parseInt(parts.length > 1 ? parts[1] : parts[0]);
            const ch = parts.length > 1 ? parseInt(parts[0]) : 0; // 0 = any channel
            if (!isNaN(cc)) this.ctrl.assign(this._currentParam.id, { type: 'midi-cc', cc, ...(ch > 0 && { channel: ch }) });
          }
        } else if (type === 'midi-note') {
          const raw = prompt('MIDI Note — enter note number, or "ch:note"\n(e.g. "60" or "1:60")', '60');
          if (raw !== null) {
            const parts = raw.split(':');
            const note = parseInt(parts.length > 1 ? parts[1] : parts[0]);
            const ch   = parts.length > 1 ? parseInt(parts[0]) : 0;
            if (!isNaN(note)) this.ctrl.assign(this._currentParam.id, { type: 'midi-note', note, ...(ch > 0 && { channel: ch }) });
          }
        } else if (type.startsWith('lfo-')) {
          const prev = this._currentParam.controller;
          const prevDefault = prev?.beatSync
            ? `${prev.beatDiv ?? 1}b`
            : (prev?.hz?.toFixed(2) ?? '0.5');
          const hzStr = prompt(
            'LFO rate:\n' +
            '  Hz (free): "0.5"  or  "1.5"\n' +
            '  Beat-sync (locks to BPM): "1b" = 1 beat, "2b" = 2 beats, "0.5b" = half beat\n' +
            '  Append phase (0-1) and width (0-1 for square/sh):\n' +
            '  e.g.  "2b 0.25"  or  "0.5 0 0.3"',
            prevDefault
          );
          if (hzStr === null) { this.hide(); return; }
          const parts = hzStr.trim().split(/\s+/);
          const phase = parseFloat(parts[1] ?? '0');
          const width = parseFloat(parts[2] ?? '0.5');

          // Beat-sync: "Nb" or "N/Mb" suffix
          const beatMatch = parts[0].match(/^([\d./]+)b$/i);
          if (beatMatch) {
            const beatDiv = parseFloat(eval(beatMatch[1])); // "1/4" → 0.25
            const bpm = this.ps.get('global.bpm')?.value ?? 120;
            this.ctrl.assign(this._currentParam.id, {
              type,
              hz:       (bpm / 60) / beatDiv, // approximate hz for display
              beatSync: true,
              beatDiv:  isNaN(beatDiv) ? 1 : beatDiv,
              phase:    isNaN(phase) ? 0 : Math.max(0, Math.min(1, phase)),
              width:    isNaN(width) ? 0.5 : Math.max(0, Math.min(1, width)),
            });
          } else {
            const hz = parseFloat(parts[0]);
            this.ctrl.assign(this._currentParam.id, {
              type,
              hz:    isNaN(hz) ? 0.5 : hz,
              phase: isNaN(phase) ? 0 : Math.max(0, Math.min(1, phase)),
              width: isNaN(width) ? 0.5 : Math.max(0, Math.min(1, width)),
              beatSync: false,
            });
          }
        } else if (type === 'fixed') {
          const v = parseFloat(prompt(`Fixed value (${this._currentParam.min}–${this._currentParam.max}):`,
            this._currentParam.value));
          if (!isNaN(v)) this.ctrl.assign(this._currentParam.id, { type: 'fixed', value: v });
        } else if (type === 'key') {
          const k = prompt('Press a key character (e.g. a, 1, Enter, ArrowUp):', this._currentParam.controller?.key ?? '');
          if (k) this.ctrl.assign(this._currentParam.id, { type: 'key', key: k.trim() });
        } else if (type === 'expr') {
          const p    = this._currentParam;
          const prev = p.controller?.expr ?? `sin(t) * ${(p.max - p.min) / 2} + ${p.min + (p.max - p.min) / 2}`;
          const src  = prompt(
            `Expression controller — result sets param value directly.\n` +
            `Variables: t (time in seconds)\n` +
            `Functions: sin cos tan abs floor ceil round mod fract clamp mix pow sqrt noise\n` +
            `Range: ${p.min} – ${p.max}`,
            p.controller?.expr ?? prev
          );
          if (src !== null) this.ctrl.assign(p.id, { type: 'expr', expr: src.trim() });
        } else {
          this.ctrl.assign(this._currentParam.id, { type });
        }
        this._currentParam?.notify(); // refresh badge label immediately
        this.hide();
        this.presets?.saveCurrentPreset();
      });
    });

    // Options
    this.el.querySelectorAll('.menu-item[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!this._currentParam) return;
        const action = btn.dataset.action;
        if (action === 'invert') {
          this._currentParam.invert = !this._currentParam.invert;
          this.hide();
        }
        if (action === 'lock') {
          this._currentParam.locked = !this._currentParam.locked;
          this.hide();
          // Visual indicator on param row
          const row = document.querySelector(`[data-param-id="${this._currentParam.id}"]`);
          row?.classList.toggle('param-locked', this._currentParam.locked);
        }
        if (action === 'show') {
          this._currentParam.feedbackVisible = !this._currentParam.feedbackVisible;
          this.ps.dispatchEvent(new CustomEvent('feedbackToggled', { detail: this._currentParam }));
          this.hide();
        }
        if (action === 'table') {
          this._showTablePicker(btn);
        }
        if (action === 'midi-learn') {
          const paramId = this._currentParam.id;
          this.hide();
          this.ctrl.startMIDILearn(paramId);
        }
        if (action === 'slew') {
          const v = parseFloat(prompt(
            'Slew time (seconds, 0=instant):\n0.01=very fast, 0.1=smooth, 0.5=slow, 1=very slow',
            this._currentParam.slew?.toFixed(3) ?? '0'
          ));
          if (!isNaN(v)) {
            this._currentParam.slew = Math.max(0, v);
            this.hide();
          }
        }
        if (action === 'xmap-hz' || action === 'xmap-amp' || action === 'xmap-value') {
          const target = action === 'xmap-hz' ? 'hz' : action === 'xmap-amp' ? 'amp' : 'value';
          const targetLabel = { hz: 'LFO Hz', amp: 'Amplitude (VCA)', value: 'Value (override)' }[target];
          const typeStr = prompt(
            `X-Map: ${targetLabel}\n\n` +
            'Controller type (+ optional Hz):\n' +
            '  lfo-sine 0.5   lfo-triangle 2   lfo-sawtooth\n' +
            '  lfo-square 1   lfo-sh 0.25\n' +
            '  sound  sound-bass  sound-mid  sound-high\n' +
            '  mouse-x  mouse-y  random 4',
            'lfo-sine 0.5'
          );
          if (typeStr === null) { this.hide(); return; }
          const parts = typeStr.trim().split(/\s+/);
          const type  = parts[0];
          const hz    = parseFloat(parts[1] ?? '0.5');
          const xIdx  = (this._currentParam.xControllers ?? []).length;
          this.ctrl.assignX(this._currentParam.id, xIdx, {
            type,
            hz:     isNaN(hz) ? 0.5 : hz,
            target,
          });
          this.hide();
          this.presets?.saveCurrentPreset();
        }
        if (action === 'xmap-clear') {
          const p = this._currentParam;
          const id = p.id;
          p.xControllers.forEach((_, idx) => this.ctrl._xLFOs.delete(`${id}:${idx}`));
          p.xControllers = [];
          this.hide();
          this.presets?.saveCurrentPreset();
        }
      });
    });
  }

  _showTablePicker(anchorBtn) {
    // Remove existing popup
    this._tablePopup?.remove();

    const popup = document.createElement('div');
    popup.className = 'table-picker';
    document.body.appendChild(popup);
    this._tablePopup = popup;

    const names = this.tables ? this.tables.getNames() : [];

    // "None" option
    const noneBtn = document.createElement('button');
    noneBtn.className = 'menu-item' + (!this._currentParam?.table ? ' active' : '');
    noneBtn.textContent = '— None —';
    noneBtn.addEventListener('click', () => {
      if (this._currentParam) this._currentParam.table = null;
      popup.remove(); this.hide();
    });
    popup.appendChild(noneBtn);

    names.forEach(name => {
      const btn = document.createElement('button');
      btn.className = 'menu-item' + (this._currentParam?.table === name ? ' active' : '');
      btn.textContent = name;
      btn.addEventListener('click', () => {
        if (this._currentParam) this._currentParam.table = name;
        popup.remove(); this.hide();
      });
      popup.appendChild(btn);
    });

    // Position next to anchor
    const r = anchorBtn.getBoundingClientRect();
    popup.style.cssText = `position:fixed;left:${r.right + 4}px;top:${r.top}px;z-index:3000;
      background:var(--bg-3);border:1px solid var(--border-hi);border-radius:4px;padding:4px;
      box-shadow:0 4px 12px rgba(0,0,0,.5);min-width:110px;`;

    // Close on outside click
    const closeHandler = e => {
      if (!popup.contains(e.target) && e.target !== anchorBtn) {
        popup.remove();
        document.removeEventListener('click', closeHandler, true);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler, true), 0);
  }
}

// ── Feedback overlay (floating parameter values on output canvas) ─────────────

export class FeedbackOverlay {
  constructor(ps) {
    this.ps = ps;
    this.el = document.getElementById('feedback-overlay');
    this.items = new Map(); // paramId → element
    this._nextY = 8;       // auto-stagger Y for default positions

    // Add initially visible items
    ps.getAll().forEach(p => {
      if (!p.feedbackVisible) return;
      this._addItem(p);
    });

    // Wire value updates for all params (even hidden ones — they may become visible)
    ps.getAll().forEach(p => {
      p.onChange(() => this._updateItem(p));
    });

    // Listen for feedbackVisible toggling from context menu
    ps.addEventListener('feedbackToggled', e => {
      const p = e.detail;
      if (p.feedbackVisible && !this.items.has(p.id)) {
        this._addItem(p);
      } else if (!p.feedbackVisible && this.items.has(p.id)) {
        this._removeItem(p);
      }
    });
  }

  _addItem(p) {
    // Auto-stagger if position is still the default
    if (p.feedbackPos.x === 20 && p.feedbackPos.y === 60) {
      p.feedbackPos = { x: 8, y: this._nextY };
    }
    this._nextY += 18;

    const el = document.createElement('div');
    el.className = 'feedback-item';
    el.style.left = `${p.feedbackPos.x}px`;
    el.style.top  = `${p.feedbackPos.y}px`;
    el.textContent = `${p.label}: ${p.displayValue}`;
    this.el.appendChild(el);
    this.items.set(p.id, el);
    this._makeDraggable(el, p);
  }

  _removeItem(p) {
    const el = this.items.get(p.id);
    if (el) {
      el.remove();
      this.items.delete(p.id);
    }
  }

  _updateItem(p) {
    const el = this.items.get(p.id);
    if (el) el.textContent = `${p.label}: ${p.displayValue}`;
  }

  _makeDraggable(el, p) {
    let ox = 0, oy = 0;
    el.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      const rect = el.getBoundingClientRect();
      const parentRect = this.el.getBoundingClientRect();
      ox = e.clientX - (rect.left - parentRect.left);
      oy = e.clientY - (rect.top  - parentRect.top);
      e.stopPropagation();
    });
    el.addEventListener('pointermove', e => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      const x = e.clientX - ox;
      const y = e.clientY - oy;
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
      p.feedbackPos = { x, y };
    });
    el.addEventListener('pointerup', () => {});
  }
}

// ── Presets panel ─────────────────────────────────────────────────────────────

export class PresetsPanel {
  constructor(presetManager) {
    this.pm = presetManager;
    this.el = document.getElementById('presets-list');
    this._build();
    this._wireNav();
    this.pm.addEventListener('presetActivated', () => this._refresh());
  }

  _build() {
    if (!this.el) return;
    this.el.innerHTML = '';
    this.pm.getAll().forEach((p, i) => {
      const row = document.createElement('div');
      row.className = `preset-item ${i === this.pm.currentIdx ? 'active' : ''}`;
      row.dataset.idx = i;

      const thumbEl = document.createElement('div');
      thumbEl.className = 'preset-thumb';
      if (p.thumbnail) {
        thumbEl.style.backgroundImage = `url(${p.thumbnail})`;
        thumbEl.classList.add('preset-thumb--has');
      }

      row.innerHTML = `<span class="preset-num">${i}</span><span class="preset-name">${p.name}</span>`;
      row.insertBefore(thumbEl, row.firstChild);

      row.addEventListener('dblclick', () => {
        clearTimeout(row._timer); // prevent rename prompt from firing after dblclick
        this.pm.activatePreset(i);
      });
      row.addEventListener('click', e => {
        clearTimeout(row._timer);
        row._timer = setTimeout(() => {
          const newName = prompt('Rename preset:', p.name);
          if (newName) { p.name = newName; this._refresh(); p.save(); }
        }, 800);
      });
      row.addEventListener('mouseup', () => clearTimeout(row._timer));
      this.el.appendChild(row);
    });
  }

  _refresh() {
    if (!this.el) return;
    this.el.querySelectorAll('.preset-item').forEach((row, i) => {
      row.classList.toggle('active', i === this.pm.currentIdx);
      const p = this.pm.presets[i];
      if (!p) return;
      row.querySelector('.preset-name').textContent = p.name;
      const thumb = row.querySelector('.preset-thumb');
      if (thumb && p.thumbnail) {
        thumb.style.backgroundImage = `url(${p.thumbnail})`;
        thumb.classList.add('preset-thumb--has');
      }
    });
  }

  _wireNav() {
    document.getElementById('btn-preset-prev')?.addEventListener('click', () => this.pm.prevPreset());
    document.getElementById('btn-preset-next')?.addEventListener('click', () => this.pm.nextPreset());
  }
}

// ── Tables editor ────────────────────────────────────────────────────────────

export class TablesEditor {
  constructor(tableManager) {
    this.tm       = tableManager;
    this.canvas   = document.getElementById('table-editor');
    this.listEl   = document.getElementById('tables-list');
    this._current = null;  // currently selected table name
    this._drawing = false;

    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this._buildList();
    this._wireCanvas();
    this.tm.addEventListener('change', () => this._buildList());
  }

  // ── List of tables ──────────────────────────────────────────────────────

  _buildList() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '';

    this.tm.getNames().forEach(name => {
      const row = document.createElement('div');
      row.className = 'table-list-row' + (name === this._current ? ' active' : '');

      const lbl = document.createElement('span');
      lbl.textContent = name;
      lbl.style.cssText = 'flex:1;font-size:11px;cursor:pointer;';
      lbl.addEventListener('click', () => this._select(name));

      row.appendChild(lbl);

      if (!this.tm.isBuiltin(name)) {
        const del = document.createElement('button');
        del.textContent = '✕';
        del.style.cssText = 'font-size:10px;padding:0 4px;background:none;border:none;color:var(--text-2);cursor:pointer;';
        del.title = 'Delete table';
        del.addEventListener('click', e => {
          e.stopPropagation();
          if (this._current === name) this._current = null;
          this.tm.delete(name);
        });
        row.appendChild(del);
      }

      this.listEl.appendChild(row);
    });

    // "New table" button
    const newBtn = document.createElement('button');
    newBtn.className = 'import-btn';
    newBtn.textContent = '+ New Table';
    newBtn.style.cssText = 'margin:6px 0;width:100%;';
    newBtn.addEventListener('click', () => {
      const name = prompt('Table name:', `user-${Date.now().toString(36)}`);
      if (!name) return;
      // Start with linear curve
      const pts = Array.from({ length: 256 }, (_, i) => i / 255);
      this.tm.set(name, pts);
      this._select(name);
    });
    this.listEl.appendChild(newBtn);

    // Re-select current
    if (this._current) this._drawCurve(this._current);
  }

  _select(name) {
    this._current = name;
    this._buildList();
    this._drawCurve(name);
  }

  // ── Canvas drawing ───────────────────────────────────────────────────────

  _drawCurve(name) {
    if (!this.ctx) return;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const curve = this.tm.get(name);

    this.ctx.clearRect(0, 0, W, H);

    // Background
    this.ctx.fillStyle = '#0d0d14';
    this.ctx.fillRect(0, 0, W, H);

    // Grid
    this.ctx.strokeStyle = '#1e1e2e';
    this.ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const x = Math.round(W * i / 4) + 0.5;
      const y = Math.round(H * i / 4) + 0.5;
      this.ctx.beginPath(); this.ctx.moveTo(x, 0); this.ctx.lineTo(x, H); this.ctx.stroke();
      this.ctx.beginPath(); this.ctx.moveTo(0, y); this.ctx.lineTo(W, y); this.ctx.stroke();
    }

    // Diagonal reference (linear)
    this.ctx.strokeStyle = '#282838';
    this.ctx.lineWidth = 1;
    this.ctx.beginPath(); this.ctx.moveTo(0, H); this.ctx.lineTo(W, 0); this.ctx.stroke();

    if (!curve) return;

    // Curve
    this.ctx.strokeStyle = '#e8c840';
    this.ctx.lineWidth = 1.5;
    this.ctx.beginPath();
    for (let i = 0; i < 256; i++) {
      const x = (i / 255) * W;
      const y = (1 - curve.points[i]) * H;
      i === 0 ? this.ctx.moveTo(x, y) : this.ctx.lineTo(x, y);
    }
    this.ctx.stroke();
  }

  _wireCanvas() {
    const W = this.canvas.width;
    const H = this.canvas.height;

    const paint = e => {
      if (!this._current || this.tm.isBuiltin(this._current)) return;
      const r  = this.canvas.getBoundingClientRect();
      const nx = (e.clientX - r.left) / r.width;
      const ny = 1 - (e.clientY - r.top)  / r.height;
      const ix = Math.round(nx * 255);
      const iy = Math.max(0, Math.min(1, ny));
      if (ix < 0 || ix > 255) return;

      const curve = this.tm.get(this._current);
      if (!curve) return;

      // Smooth fill between last painted index and current (avoid gaps on fast drag)
      if (this._lastPaintIdx !== null) {
        const from = Math.min(this._lastPaintIdx, ix);
        const to   = Math.max(this._lastPaintIdx, ix);
        for (let i = from; i <= to; i++) {
          const t = to === from ? 1 : (i - from) / (to - from);
          curve.points[i] = this._lastPaintVal + t * (iy - this._lastPaintVal);
        }
      } else {
        curve.points[ix] = iy;
      }
      this._lastPaintIdx = ix;
      this._lastPaintVal = iy;

      this.tm.set(this._current, curve); // triggers 'change' → persist
      this._drawCurve(this._current);
    };

    this.canvas.addEventListener('mousedown', e => {
      this._drawing = true;
      this._lastPaintIdx = null;
      this._lastPaintVal = null;
      paint(e);
    });
    this.canvas.addEventListener('mousemove', e => { if (this._drawing) paint(e); });
    window.addEventListener('mouseup', () => {
      this._drawing = false;
      this._lastPaintIdx = null;
    });
    this.canvas.addEventListener('contextmenu', e => e.preventDefault());
  }
}

// ── Debug overlay ─────────────────────────────────────────────────────────────

export class DebugOverlay {
  constructor(ps) {
    this.ps  = ps;
    this.el  = null;
    this._fps = 0;
    this._frames = 0;
    this._last = performance.now();
    this._create();
  }

  _create() {
    const el = document.createElement('div');
    el.id = 'debug-overlay';
    el.style.cssText = [
      'position:absolute', 'top:8px', 'left:8px',
      'background:rgba(0,0,0,0.65)', 'color:#0f0',
      'font-family:monospace', 'font-size:11px',
      'line-height:1.5', 'padding:6px 10px',
      'border-radius:4px', 'pointer-events:none',
      'white-space:pre', 'z-index:50', 'display:none',
    ].join(';');
    document.getElementById('canvas-wrap')?.appendChild(el);
    this.el = el;
  }

  tick(fps) {
    const p = this.ps;
    const active = p.get('global.debug')?.value;
    if (!this.el) return;
    this.el.style.display = active ? 'block' : 'none';
    if (!active) return;

    const SNAMES = ['CAM','MOV','BUF','COL','NSE','3D','DRW','OUT','BG1','BG2','COL2','TXT','SND','DEL','SCO','SLI','PAR'];
    const fg  = SNAMES[p.get('layer.fg')?.value] ?? '?';
    const bg  = SNAMES[p.get('layer.bg')?.value] ?? '?';
    const ds  = SNAMES[p.get('layer.ds')?.value] ?? '?';
    const warp = p.get('displace.warp')?.options?.[p.get('displace.warp')?.value] ?? 'off';
    const warpAmt = ((p.get('displace.warpamt')?.value ?? 0)).toFixed(0);
    const blend = p.get('blend.active')?.value ? `${(p.get('blend.amount')?.value ?? 0).toFixed(0)}%` : 'off';
    const keyer = p.get('keyer.active')?.value ? 'on' : 'off';
    const displ = (p.get('displace.amount')?.value ?? 0).toFixed(0);

    this.el.textContent = [
      `FPS  ${fps}`,
      `FG   ${fg}   BG  ${bg}   DS  ${ds}`,
      `Warp ${warp} (${warpAmt}%)   Displ ${displ}%`,
      `Blend ${blend}   Keyer ${keyer}`,
      `BPM  ${(p.get('global.bpm')?.value ?? 0).toFixed(0)}`,
    ].join('\n');
  }
}

// ── FPS display ───────────────────────────────────────────────────────────────

// ── WarpMap Editor ────────────────────────────────────────────────────────────

/**
 * Build the interactive WarpMap editor canvas UI.
 * Mounted inside #warp-editor-container in the Mapping tab.
 *
 * @param {WarpMapEditor} editor
 * @param {ParameterSystem} ps
 */
export function buildWarpEditor(editor, ps, contextMenu) {
  const container = document.getElementById('warp-editor-container');
  if (!container) return;

  // WarpMode + WarpAmt param rows at the top of the section
  const warpModeRow = buildParamRow(ps.get('displace.warp'),    contextMenu ?? null);
  const warpAmtRow  = buildParamRow(ps.get('displace.warpamt'), contextMenu ?? null);
  container.appendChild(warpModeRow);
  container.appendChild(warpAmtRow);

  const CW = 288, CH = 200; // canvas display size in px
  const DISP_SCALE = 2.5;   // amplify displacements for visual clarity

  // ── Canvas ────────────────────────────────────────────────────────────────
  const canvas = document.createElement('canvas');
  canvas.width  = CW;
  canvas.height = CH;
  canvas.className = 'warp-canvas';
  container.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  // ── Controls row ──────────────────────────────────────────────────────────
  const controlRow = document.createElement('div');
  controlRow.className = 'warp-controls';
  container.appendChild(controlRow);

  // Tool Selection
  let activeTool = 'push';
  const tools = ['push', 'smooth', 'erase'];
  const toolGroup = document.createElement('div');
  toolGroup.style.display = 'flex'; toolGroup.style.gap = '2px'; toolGroup.style.marginRight = '8px';
  tools.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'warp-preset-btn';
    btn.textContent = t.toUpperCase();
    btn.style.padding = '2px 5px';
    btn.classList.toggle('active', t === activeTool);
    btn.addEventListener('click', () => {
      activeTool = t;
      toolGroup.querySelectorAll('button').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    toolGroup.appendChild(btn);
  });
  controlRow.appendChild(toolGroup);

  // Brush radius
  const radiusLabel = document.createElement('span');
  radiusLabel.className = 'warp-ctrl-label';
  radiusLabel.textContent = 'Radius';
  let brushRadius = 0.20;
  const radiusSlider = document.createElement('input');
  radiusSlider.type = 'range'; radiusSlider.min = '0.05'; radiusSlider.max = '0.50';
  radiusSlider.step = '0.01'; radiusSlider.value = String(brushRadius);
  radiusSlider.className = 'warp-slider';
  radiusSlider.addEventListener('input', () => { brushRadius = parseFloat(radiusSlider.value); });

  // Strength
  const strLabel = document.createElement('span');
  strLabel.className = 'warp-ctrl-label';
  strLabel.textContent = 'Strength';
  let brushStrength = 0.015;
  const strSlider = document.createElement('input');
  strSlider.type = 'range'; strSlider.min = '0.002'; strSlider.max = '0.08';
  strSlider.step = '0.001'; strSlider.value = String(brushStrength);
  strSlider.className = 'warp-slider';
  strSlider.addEventListener('input', () => { brushStrength = parseFloat(strSlider.value); });

  controlRow.append(radiusLabel, radiusSlider, strLabel, strSlider);

  // ── Preset buttons ────────────────────────────────────────────────────────
  const presetRow = document.createElement('div');
  presetRow.className = 'warp-presets';
  container.appendChild(presetRow);

  const presets = ['H-Wave','V-Wave','Radial','Pinch','Spiral','Shear','Random','Reset'];
  presets.forEach(name => {
    const btn = document.createElement('button');
    btn.className = 'warp-preset-btn';
    btn.textContent = name;
    btn.addEventListener('click', () => {
      if (name === 'Reset') {
        editor.reset();
      } else {
        editor.applyPreset(name);
        ps.set('displace.warp', 9);                           // activate Custom mode
        if (ps.get('displace.warpamt').value === 0) ps.set('displace.warpamt', 50);
      }
      drawMesh();
    });
    presetRow.appendChild(btn);
  });

  // ── Save / Load slots ─────────────────────────────────────────────────────
  const slotRow = document.createElement('div');
  slotRow.className = 'warp-slots';
  container.appendChild(slotRow);

  function refreshSlots() {
    slotRow.innerHTML = '';
    const slotLabel = document.createElement('span');
    slotLabel.className = 'warp-ctrl-label';
    slotLabel.textContent = 'Slots:';
    slotRow.appendChild(slotLabel);
    // Save buttons 1-16
    for (let i = 1; i <= 16; i++) {
      const btn = document.createElement('button');
      btn.className = 'warp-slot-btn';
      const hasSaved = editor.getSavedSlots().includes(String(i));
      btn.textContent = hasSaved ? `${i}` : `·`;
      btn.title = hasSaved ? `Load slot ${i} (right-click to save)` : `Save to slot ${i}`;
      btn.style.width = '24px';
      btn.style.padding = '3px 0';
      if (hasSaved) btn.style.color = 'var(--accent)';
      btn.addEventListener('click', () => {
        if (hasSaved) { editor.load(String(i)); drawMesh(); }
        else { editor.save(String(i)); refreshSlots(); }
      });
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        editor.save(String(i));
        refreshSlots();
      });
      slotRow.appendChild(btn);
    }
  }
  refreshSlots();

  // ── Canvas drawing ────────────────────────────────────────────────────────

  function warpedPos(ni, nj) {
    const { dx, dy } = editor.dispAt(ni, nj);
    return {
      x: (ni + dx * DISP_SCALE) * CW,
      y: (nj + dy * DISP_SCALE) * CH,
    };
  }

  function drawMesh() {
    ctx.clearRect(0, 0, CW, CH);
    ctx.fillStyle = '#0d0d14';
    ctx.fillRect(0, 0, CW, CH);

    const c = editor.cols, r = editor.rows;

    // Draw mesh lines
    ctx.strokeStyle = 'rgba(140,140,180,0.45)';
    ctx.lineWidth = 0.8;

    // Horizontal lines
    for (let j = 0; j < r; j++) {
      ctx.beginPath();
      for (let i = 0; i < c; i++) {
        const { x, y } = warpedPos(i / (c-1), j / (r-1));
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    // Vertical lines
    for (let i = 0; i < c; i++) {
      ctx.beginPath();
      for (let j = 0; j < r; j++) {
        const { x, y } = warpedPos(i / (c-1), j / (r-1));
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Control point dots at every intersection
    for (let j = 0; j < r; j++) {
      for (let i = 0; i < c; i++) {
        const { dx, dy } = editor.dispAt(i / (c-1), j / (r-1));
        const mag = Math.sqrt(dx*dx + dy*dy) * 15; // normalize for color
        const { x, y } = warpedPos(i / (c-1), j / (r-1));
        
        ctx.fillStyle = mag > 0.01 
          ? `hsla(${180 - mag * 100}, 80%, 60%, ${0.3 + mag * 0.7})` 
          : 'rgba(140,140,180,0.2)';
        
        ctx.beginPath();
        ctx.arc(x, y, 1.5, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Cursor circle
    if (_hover) {
      ctx.strokeStyle = 'rgba(232,200,64,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(_hover.cx, _hover.cy, brushRadius * CW, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // ── Mouse interaction ─────────────────────────────────────────────────────

  let _drag = false;
  let _lastX = 0, _lastY = 0;
  let _hover = null;
  let _rightBtn = false;

  function evToNorm(e) {
    const rect = canvas.getBoundingClientRect();
    return {
      nx: (e.clientX - rect.left) / rect.width,
      ny: (e.clientY - rect.top)  / rect.height,
      cx: e.clientX - rect.left,
      cy: e.clientY - rect.top,
    };
  }

  canvas.addEventListener('mousedown', e => {
    e.preventDefault();
    _drag = true;
    _rightBtn = (e.button === 2);
    const { nx, ny } = evToNorm(e);
    _lastX = nx; _lastY = ny;
    // Activate Custom warp mode automatically
    ps.set('displace.warp', 9);
    ps.set('displace.warpamt', 80);
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());

  canvas.addEventListener('mousemove', e => {
    const { nx, ny, cx, cy } = evToNorm(e);
    _hover = { cx, cy };
    if (_drag) {
      const ddx = (nx - _lastX);
      const ddy = (ny - _lastY);
      const sign = _rightBtn ? -1 : 1;
      
      if (activeTool === 'push') {
        editor.brush(nx, ny, brushRadius, brushStrength * 60, ddx * sign, ddy * sign);
      } else if (activeTool === 'smooth') {
        editor.smooth(nx, ny, brushRadius, brushStrength * 5);
      } else if (activeTool === 'erase') {
        editor.erase(nx, ny, brushRadius, brushStrength * 10);
      }
      
      _lastX = nx; _lastY = ny;
    }
    drawMesh();
  });

  canvas.addEventListener('mouseup',   () => { _drag = false; });
  canvas.addEventListener('mouseleave', () => { _drag = false; _hover = null; drawMesh(); });

  // Initial draw
  drawMesh();
}

export class Profiler {
  constructor() {
    this.el    = document.getElementById('status-fps');
    this._last = performance.now();
    this._frames = 0;
    this._fps = 0;
    this._cpuTime = 0;
    this._vram = 0;
    this._startTime = 0;
  }

  /** Call at start of render() */
  begin() {
    this._startTime = performance.now();
  }

  /** Call at end of render() */
  end() {
    this._cpuTime += (performance.now() - this._startTime);
  }

  tick(pipeline, sequencerManager) {
    this._frames++;
    const now = performance.now();
    if (now - this._last >= 1000) {
      const duration = now - this._last;
      this._fps = Math.round(this._frames * 1000 / duration);
      const avgCpu = (this._cpuTime / this._frames).toFixed(1);
      
      // Calculate VRAM estimate (MB)
      let bytes = 0;
      if (pipeline) {
        // Approximate VRAM from active render targets
        const targets = [
          pipeline.target1, pipeline.target2, pipeline.noiseTarget,
          pipeline.scene3d?.target, pipeline.scene3d?.depthTarget
        ];
        targets.forEach(t => {
          if (t) bytes += t.width * t.height * 4;
        });
        
        // Include sequencers from the manager if provided
        if (sequencerManager) {
          sequencerManager.sequencers.forEach(s => {
            if (s && s.frames) {
              bytes += s.width * s.height * 4 * s.frames.length;
            }
          });
        }

        // Plus some overhead for stills buffer (16 slots of 1280x720)
        bytes += 1280 * 720 * 4 * 16; 
      }
      const mb = Math.round(bytes / (1024 * 1024));

      if (this.el) {
        this.el.innerHTML = `
          <span title="Frames per second">${this._fps} fps</span>
          <span style="color:var(--text-2);margin:0 4px">|</span>
          <span title="Logic time per frame">${avgCpu}ms CPU</span>
          <span style="color:var(--text-2);margin:0 4px">|</span>
          <span title="Estimated VRAM usage" style="color:${mb > 800 ? 'var(--red)' : 'var(--green)'}">${mb}MB VRAM</span>
        `;
      }

      this._frames = 0;
      this._cpuTime = 0;
      this._last = now;
    }
  }
}

// ── AI Settings Panel ─────────────────────────────────────────────────────────

/**
 * Populate an existing panel element with the multi-provider AI settings UI.
 * ai — AIFeatures instance (getConfig, setActiveProvider, setProviderKey,
 *       setProviderModel, testConnection)
 * panelEl — the container element to populate (replaces its innerHTML)
 */
export function buildAISettingsPanel(ai, panelEl) {
  if (!panelEl) return;

  const cfg = ai.getConfig();

  // ── Helpers ────────────────────────────────────────────────────────────────

  const row = (label, child, note) => {
    const wrap = document.createElement('div');
    wrap.className = 'ai-prov-row';
    if (label) {
      const lbl = document.createElement('span');
      lbl.className = 'ai-prov-label';
      lbl.textContent = label;
      wrap.appendChild(lbl);
    }
    if (child) wrap.appendChild(child);
    if (note) {
      const n = document.createElement('span');
      n.className = 'ai-prov-note';
      n.textContent = note;
      wrap.appendChild(n);
    }
    return wrap;
  };

  const makeSelect = (opts, current, onChange) => {
    const sel = document.createElement('select');
    sel.className = 'ai-prov-select';
    opts.forEach(({ value, label }) => {
      const opt = document.createElement('option');
      opt.value = value; opt.textContent = label;
      if (value === current) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.addEventListener('change', () => onChange(sel.value));
    return sel;
  };

  // ── Build UI ───────────────────────────────────────────────────────────────

  panelEl.innerHTML = '';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'ai-settings-hdr';
  hdr.textContent = 'SETTINGS';
  panelEl.appendChild(hdr);

  // Status line
  const statusEl = document.createElement('div');
  statusEl.className = 'ai-key-status';
  panelEl.appendChild(statusEl);

  // Provider selector
  const provSel = makeSelect(
    Object.values(PROVIDERS).map(p => ({ value: p.id, label: p.name })),
    cfg.activeProvider,
    id => {
      ai.setActiveProvider(id);
      refreshProviderUI(id);
    }
  );
  panelEl.appendChild(row('Provider', provSel));

  // Provider-specific fields (key, model, link) — rebuilt on provider change
  const provFields = document.createElement('div');
  panelEl.appendChild(provFields);

  // Test + status
  const testBtn = document.createElement('button');
  testBtn.className = 'import-btn';
  testBtn.textContent = '⟳ Test connection';
  testBtn.style.marginTop = '8px';
  testBtn.addEventListener('click', async () => {
    testBtn.disabled = true;
    testBtn.textContent = '⏳ Testing…';
    statusEl.textContent = '';
    statusEl.className = 'ai-key-status';
    try {
      await ai.testConnection();
      statusEl.textContent = '✓ Connected';
      statusEl.className = 'ai-key-status ok';
    } catch (err) {
      statusEl.textContent = `✗ ${err.message}`;
      statusEl.className = 'ai-key-status error';
    } finally {
      testBtn.disabled = false;
      testBtn.textContent = '⟳ Test connection';
    }
  });
  panelEl.appendChild(testBtn);

  // AI sub-header
  const aiHdr = document.createElement('div');
  aiHdr.className = 'ai-settings-hdr';
  aiHdr.style.marginTop = '10px';
  aiHdr.textContent = 'AI PROVIDER';
  panelEl.insertBefore(aiHdr, testBtn);

  // Storage note
  const note = document.createElement('div');
  note.className = 'ai-settings-note';
  note.textContent = 'Keys stored in browser localStorage only.';
  panelEl.appendChild(note);

  // ── Resources section ─────────────────────────────────────────────────────
  const resHdr = document.createElement('div');
  resHdr.className = 'ai-settings-hdr';
  resHdr.style.marginTop = '10px';
  resHdr.textContent = 'DOCUMENTATION';
  panelEl.appendChild(resHdr);

  const links = [
    { label: 'Quick Reference', href: 'docs/ImWeb_Quick_Reference.md' },
    { label: 'Full Manual',     href: 'docs/ImWeb_Full_Manual.md' },
  ];
  links.forEach(({ label, href }) => {
    const a = document.createElement('a');
    a.className = 'ai-prov-link';
    a.textContent = label + ' →';
    a.href = href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    panelEl.appendChild(a);
  });

  const prepHdr = document.createElement('div');
  prepHdr.className = 'ai-settings-hdr';
  prepHdr.style.marginTop = '10px';
  prepHdr.textContent = 'VIDEO PREP';
  panelEl.appendChild(prepHdr);

  const prepNote = document.createElement('div');
  prepNote.className = 'ai-settings-note';
  prepNote.style.lineHeight = '1.6';
  prepNote.innerHTML =
    'For frame-accurate scrubbing, convert clips with:<br>' +
    '<code style="color:var(--accent)">node imweb-prep.js</code><br>' +
    'Drop raw files in <code style="color:var(--accent)">_raw_videos/</code><br>' +
    'Output: H.264 All-Intra, yuv420p, no audio, even dimensions.';
  panelEl.appendChild(prepNote);

  // ── Per-provider fields renderer ───────────────────────────────────────────

  function refreshProviderUI(providerId) {
    const pDef  = PROVIDERS[providerId];
    const pCfg  = ai.getConfig().providers[providerId] ?? {};
    provFields.innerHTML = '';

    // Key / Base URL field
    const keyWrap = document.createElement('div');
    keyWrap.className = 'ai-prov-row';
    keyWrap.style.flexWrap = 'wrap';
    keyWrap.style.gap = '4px';

    const keyLbl = document.createElement('span');
    keyLbl.className = 'ai-prov-label';
    keyLbl.textContent = pDef.keyLabel;
    keyWrap.appendChild(keyLbl);

    const keyInput = document.createElement('input');
    keyInput.type        = pDef.needsKey ? 'password' : 'text';
    keyInput.className   = 'ai-key-input';
    keyInput.placeholder = pDef.keyPlaceholder;
    keyInput.value       = pCfg.apiKey ?? '';
    keyInput.style.flex  = '1';
    keyWrap.appendChild(keyInput);

    if (pDef.needsKey) {
      // Show/hide toggle
      const toggle = document.createElement('button');
      toggle.className   = 'import-btn';
      toggle.textContent = '👁';
      toggle.title       = 'Show/hide key';
      toggle.style.cssText = 'padding:2px 6px;min-width:0;font-size:12px;';
      toggle.addEventListener('click', () => {
        keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
      });
      keyWrap.appendChild(toggle);
    }

    // Save key on blur or Enter
    const saveKey = () => {
      ai.setProviderKey(providerId, keyInput.value.trim());
      updateStatusFromKey(providerId);
    };
    keyInput.addEventListener('blur', saveKey);
    keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { saveKey(); keyInput.blur(); } });

    provFields.appendChild(keyWrap);

    // "Get API key" link
    const link = document.createElement('a');
    link.className   = 'ai-prov-link';
    link.textContent = pDef.keyUrlLabel;
    link.href        = pDef.keyUrl;
    link.target      = '_blank';
    link.rel         = 'noopener noreferrer';
    provFields.appendChild(link);

    // Model selector
    const modelOpts = pDef.models.map(m => ({ value: m, label: m }));
    const customModel = pCfg.model && !pDef.models.includes(pCfg.model)
      ? pCfg.model : null;
    if (customModel) modelOpts.push({ value: customModel, label: `${customModel} (custom)` });
    modelOpts.push({ value: '__custom__', label: 'Custom…' });

    const modelSel = makeSelect(modelOpts, pCfg.model ?? pDef.defaultModel, val => {
      if (val === '__custom__') {
        const m = prompt('Enter model name:', pCfg.model ?? pDef.defaultModel);
        if (m) {
          ai.setProviderModel(providerId, m.trim());
          refreshProviderUI(providerId); // rebuild with new custom model in list
        } else {
          modelSel.value = pCfg.model ?? pDef.defaultModel;
        }
      } else {
        ai.setProviderModel(providerId, val);
      }
    });
    provFields.appendChild(row('Model', modelSel));

    updateStatusFromKey(providerId);
  }

  function updateStatusFromKey(providerId) {
    const pDef = PROVIDERS[providerId];
    const pCfg = ai.getConfig().providers[providerId] ?? {};
    if (!pDef.needsKey) {
      statusEl.textContent = `Ollama at ${pCfg.apiKey || 'http://localhost:11434'}`;
      statusEl.className = 'ai-key-status';
    } else if (pCfg.apiKey) {
      statusEl.textContent = `Key set: ${pCfg.apiKey.slice(0, 8)}…`;
      statusEl.className = 'ai-key-status ok';
    } else {
      statusEl.textContent = 'No key set';
      statusEl.className = 'ai-key-status';
    }
  }

  // Initial render
  refreshProviderUI(cfg.activeProvider);
}
