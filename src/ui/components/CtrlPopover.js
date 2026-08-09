/**
 * ImWeb UI — controller badge settings popover.
 * Extracted verbatim from UI.js (Phase 2 componentization).
 */

// ── Controller badge popover ──────────────────────────────────────────────────

/**
 * Open a small settings popover for the currently-assigned controller.
 * Supports: random (rate, slew), lfo-* (shape, freq, phase, slew), fixed (value).
 * All number fields support drag (up=increase) and double-click to type.
 */
export function openCtrlPopover(param, anchorEl, ctrl, tables) {
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

    // Slew curve, in two families — the grouping is not decoration, it is the
    // difference between a filter that chases a live target and a timed segment
    // that has to know how far through a move it is. Only a segment can
    // overshoot or bounce; only a filter smooths a continuously sweeping
    // source. See SLEW_CURVES in ParameterSystem.js.
    const shapeSel = document.createElement('select');
    shapeSel.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 2px;border-radius:2px;';
    const SLEW_GROUPS = [
      ['Any source', [
        ['lag',     'Lag (snap out)'],
        ['ease',    'Ease in/out'],
        ['elastic', 'Elastic (springs)'],
      ]],
      ['Stepped sources', [
        ['ease2',   'Super Ease in/out'],
        ['expo',    'Exponential'],
        ['bounce',  'Bounce'],
        ['back',    'Back (overshoot)'],
      ]],
    ];
    SLEW_GROUPS.forEach(([groupLabel, entries]) => {
      const g = document.createElement('optgroup');
      g.label = groupLabel;
      entries.forEach(([v, label]) => {
        const opt = document.createElement('option');
        opt.value = v; opt.textContent = label;
        if ((param.slewShape ?? 'lag') === v) opt.selected = true;
        g.appendChild(opt);
      });
      shapeSel.appendChild(g);
    });
    shapeSel.title =
      'Any source: filters that chase a live target — smooth on S+H AND on a sweeping LFO.\n' +
      'Stepped sources: timed curves that can overshoot and bounce. Built for S+H,\n' +
      'Random, Square and MIDI notes; on a continuously sweeping source they add\n' +
      'ripple instead of smoothing.';
    popover.appendChild(makeRow('Slew curve', shapeSel));

    // Spring constants. Only 'elastic' reads them, so they only appear for it —
    // an always-visible pair of inert fields is worse than none.
    // Strength means "stiffness" to the spring and "how far it throws" to Back,
    // so the range differs: Back may go to 0 (no excursion at all, a plain
    // in/out ease), the spring may not (a stiffness of 0 never arrives).
    const strengthRow = makeRow('  ↳ Strength', makeDragNum(
      () => param.slewStrength ?? 1,
      v  => {
        const lo = shapeSel.value === 'back' ? 0 : 0.25;
        const hi = shapeSel.value === 'back' ? 3 : 4;
        param.slewStrength = Math.max(lo, Math.min(hi, v));
      },
      { decimals: 2, fineStep: 0.05, coarseStep: 0.25 }
    ));
    const dampRow = makeRow('  ↳ Damp', makeDragNum(
      () => param.slewDamp ?? 0.45,
      v  => { param.slewDamp = Math.max(0.05, Math.min(1, v)); },
      { decimals: 2, fineStep: 0.01, coarseStep: 0.1 }
    ));
    dampRow.title = 'Damping. Lower throws further past the target and rings longer.\n' +
                    '1.00 removes the overshoot entirely, which is Ease in/out.';
    popover.appendChild(strengthRow);
    popover.appendChild(dampRow);

    const syncSpringRows = () => {
      const shape = shapeSel.value;
      // Strength is meaningful to both overshooting curves; Damp describes the
      // decay of a RING, which only the spring has.
      const hasStrength = shape === 'elastic' || shape === 'back';
      strengthRow.style.display = hasStrength ? '' : 'none';
      dampRow.style.display     = shape === 'elastic' ? '' : 'none';
      strengthRow.title = shape === 'back'
        ? 'How far Back pulls back before setting off and overshoots on arrival.\n' +
          '1.00 is ±10% of the move; 0 removes both and leaves a plain ease.'
        : 'Stiffness. Higher is tighter and faster — more rings inside the same Slew time.';
    };
    syncSpringRows();
    shapeSel.addEventListener('change', () => {
      param.slewShape = shapeSel.value;
      syncSpringRows();
    });
  };

  /** Table select row (shared by random and lfo). */
  const addTableRow = () => {
    const sel = document.createElement('select');
    sel.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 2px;border-radius:2px;';
    const noneOpt = document.createElement('option');
    noneOpt.value = ''; noneOpt.textContent = 'none';
    sel.appendChild(noneOpt);
    const globalOpt = document.createElement('option');
    globalOpt.value = 'global'; globalOpt.textContent = '⟳ global slot';
    sel.appendChild(globalOpt);
    (tables ? tables.getNames() : []).forEach((name, idx) => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = `${idx}  ${name}`;
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
      v  => { v = Math.max(0.001, v); c.hz = v; if (rndState) rndState.hz = v; },
      { decimals: 3, fineStep: 0.005, coarseStep: 0.25 }
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
    // 3 decimals, not 2: the field already accepted 0.001 Hz but displayed it
    // as "0.00", so the slowest rates were invisible and looked like a no-op.
    // Drag steps are sized for the slow end; double-click to type an exact Hz.
    popover.appendChild(makeRow(freqLabel, makeDragNum(
      () => lfo?.hz ?? c.hz ?? 0.5,
      v  => { v = Math.max(0.001, v); if (lfo) lfo.hz = v; c.hz = v; },
      { decimals: 3, fineStep: 0.005, coarseStep: 0.25 }
    )));

    popover.appendChild(makeRow('Phase', makeDragNum(
      () => lfo?.phase ?? c.phase ?? 0,
      // setPhase, not `lfo.phase = v` — a free-running LFO never re-reads the
      // field, so a direct assignment moved the wave nowhere until a recall.
      v  => { v = Math.max(0, Math.min(1, v)); if (lfo) lfo.setPhase(v); c.phase = v; },
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

  } else if (t.startsWith('stroke-')) {
    const parts = t.split('-');
    const slot  = parseInt(parts[1]) || 1;
    const axis  = parts[2] === 'y' ? 'y' : 'x';

    // Slot selector (1-4)
    const slotSel = document.createElement('select');
    slotSel.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 2px;border-radius:2px;';
    for (let n = 1; n <= 4; n++) {
      const opt = document.createElement('option');
      opt.value = n; opt.textContent = `Slot ${n}`;
      if (n === slot) opt.selected = true;
      slotSel.appendChild(opt);
    }
    slotSel.addEventListener('change', () => {
      const newType = `stroke-${slotSel.value}-${axis}`;
      c.type = newType;
      param.controller = { ...c };
      if (ctrl) ctrl.assign(param.id, { type: newType, rate: c.rate ?? 1 });
    });
    popover.appendChild(makeRow('Slot', slotSel));

    // Axis toggle (X / Y)
    const axisBtn = document.createElement('button');
    axisBtn.style.cssText = 'font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--border);color:var(--text-1);padding:1px 6px;border-radius:2px;cursor:pointer;';
    axisBtn.textContent = axis.toUpperCase();
    axisBtn.addEventListener('click', () => {
      const newAxis = axis === 'x' ? 'y' : 'x';
      const newType = `stroke-${slot}-${newAxis}`;
      c.type = newType;
      param.controller = { ...c };
      if (ctrl) ctrl.assign(param.id, { type: newType, rate: c.rate ?? 1 });
    });
    popover.appendChild(makeRow('Axis', axisBtn));

    // Rate (playhead multiplier, 0.1–10, default 1)
    popover.appendChild(makeRow('Rate', makeDragNum(
      () => c.rate ?? 1,
      v  => {
        v = Math.max(0.1, Math.min(10, v));
        c.rate = v;
        // update driver state live
        const s = ctrl?.strokes?.get(param.id);
        if (s) s.rate = v;
      },
      { decimals: 2, fineStep: 0.1, coarseStep: 1 }
    )));
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

  // Close on the next outside gesture — pointerdown, NOT click. This popover is
  // opened from `contextmenu`, which macOS fires on MOUSEDOWN for Ctrl+click and
  // then follows with a `click` on release. setTimeout(…, 0) does not save us:
  // the macrotask runs the moment the stack unwinds, long before a human lets
  // the button up, so the release closed the popover every time and Ctrl+click
  // (the only right-click a trackpad has by default) could never edit a
  // controller. The opening pointerdown is already dispatched by the time we get
  // here, so a pointerdown now is necessarily a new gesture.
  const closeClick = e => {
    if (!popover.contains(e.target) && e.target !== anchorEl) {
      popover.remove();
      document.removeEventListener('pointerdown', closeClick, true);
      document.removeEventListener('keydown',     closeKey,   true);
    }
  };
  const closeKey = e => {
    if (e.key === 'Escape') {
      popover.remove();
      document.removeEventListener('pointerdown', closeClick, true);
      document.removeEventListener('keydown',     closeKey,   true);
    }
  };
  document.addEventListener('pointerdown', closeClick, true);
  document.addEventListener('keydown',     closeKey,   true);
}
