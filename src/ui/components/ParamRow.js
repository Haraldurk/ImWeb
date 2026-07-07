/**
 * ParamRow — parameter row builder.
 * Extracted verbatim from UI.js (Phase 2 Task 4); param.onChange
 * subscriptions now route through ParamBinding so row._psUnsub
 * releases ALL row listeners on teardown, not just updateDisplay.
 */

import { PARAM_TYPE } from '../../controls/ParameterSystem.js';
import { createBinding } from '../bindings/ParamBinding.js';
import { mkSelect as _mkSelect } from './Select.js';
import { openCtrlPopover as _openCtrlPopover } from './CtrlPopover.js';

/**
 * Touch double-tap detector (iOS doesn't synthesize dblclick reliably on
 * pointer-captured rows). Two taps within 300ms / 24px, each with <12px
 * travel, fire fn. Mouse pointers are ignored — desktop dblclick paths
 * are untouched.
 */
function addDoubleTap(el, fn) {
  let lastT = 0, lastX = 0, lastY = 0, downX = 0, downY = 0;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse') return;
    downX = e.clientX; downY = e.clientY;
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    if (Math.hypot(e.clientX - downX, e.clientY - downY) > 12) { lastT = 0; return; } // drag, not tap
    const now = performance.now();
    if (now - lastT < 300 && Math.hypot(e.clientX - lastX, e.clientY - lastY) < 24) {
      lastT = 0;
      fn(e);
    } else {
      lastT = now; lastX = e.clientX; lastY = e.clientY;
    }
  });
}

/**
 * Build a parameter row element and wire it to a Parameter.
 * Supports: continuous (slider + value), toggle, select, trigger.
 * Right-click opens the controller context menu.
 */
export function buildParamRow(param, contextMenu) {
  const binding = createBinding(param);
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
    let startX = 0, startVal = 0, _dragPid = null;
    const range = param.max - param.min;

    // ── Flick momentum (touch/pen only) ────────────────────────────────
    // Residual velocity from a fast drag glides the value with friction
    // after a CLEAN pointerup. Never on pointercancel (that path reverts —
    // the browser stole the gesture), never while a controller owns the
    // param, and the loop yields the instant anything else writes the
    // value (controller assigned mid-glide, state recall, automation).
    // Velocity samples param.value itself, so drags on the slider lane
    // (which also write the param) feed the same engine.
    let _vel = 0, _velT = 0, _velVal = 0, _glideRaf = 0;

    const _stopGlide = () => {
      if (_glideRaf) { cancelAnimationFrame(_glideRaf); _glideRaf = 0; }
    };
    row._stopGlide = _stopGlide; // teardown hook for _psUnsub

    const _startGlide = () => {
      // Flick threshold ≈ a 300px/s drag; deliberate adjustments stay dry
      if (Math.abs(_vel) < range * 1.5) return;
      if (param.controller || param.locked) return;
      let v = Math.max(-range * 6, Math.min(range * 6, _vel));
      let prevT = performance.now();
      let expected = param.value;
      const tick = (now) => {
        _glideRaf = 0;
        // Yield rule: someone else wrote the param since our last write
        if (param.value !== expected || param.controller) return;
        const dt = Math.min((now - prevT) / 1000, 0.032); // hidden-tab resume can't jump
        prevT = now;
        param.value = param.value + v * dt;
        expected = param.value; // setter clamped/stepped — read back
        updateDisplay();
        v *= Math.pow(0.9, dt * 60); // frame-rate-independent friction
        if (Math.abs(v) < range * 0.05) return;                      // spent
        if (param.value === param.min || param.value === param.max) return; // hit an edge
        _glideRaf = requestAnimationFrame(tick);
      };
      _glideRaf = requestAnimationFrame(tick);
    };

    row.addEventListener('pointerdown', e => {
      if (e.button !== 0 || param.locked) return;
      _stopGlide(); // touching the param again always kills the physics
      row.setPointerCapture(e.pointerId);
      _dragPid = e.pointerId;
      startX   = e.clientX;
      startVal = param.value;
      _vel = 0; _velT = performance.now(); _velVal = param.value;
      e.preventDefault();
    });

    row.addEventListener('pointermove', e => {
      if (!row.hasPointerCapture(e.pointerId)) return;
      const delta = (e.clientX - startX) / 200 * range;
      param.value = startVal + delta;
      updateDisplay();
      // EMA velocity over recent movement, in value-units/second
      const now = performance.now();
      const dtv = (now - _velT) / 1000;
      if (dtv > 0.001) {
        _vel = _vel * 0.6 + ((param.value - _velVal) / dtv) * 0.4;
        _velT = now; _velVal = param.value;
      }
    });

    row.addEventListener('pointerup', e => {
      const wasDrag = _dragPid === e.pointerId;
      _dragPid = null;
      if (!wasDrag || e.pointerType === 'mouse') return;
      // A rested finger (no movement in the last 100ms) lifts dry —
      // stale velocity from earlier in the gesture must not glide
      if (performance.now() - _velT > 100) return;
      _startGlide();
    });

    // Browser hijacked the gesture mid-drag (panel scroll, system gesture):
    // pointermove already wrote intermediate values — revert to the value
    // the drag started from so an aborted drag never leaves a random one.
    // Deliberately NO momentum here.
    row.addEventListener('pointercancel', e => {
      if (_dragPid !== e.pointerId) return;
      _dragPid = null;
      _vel = 0;
      param.value = startVal;
      updateDisplay();
    });

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
    // Touch equivalent: double-tap resets (range fields excluded — they
    // have their own double-tap → min/max editor)
    addDoubleTap(row, (e) => {
      if (e.target.closest('.param-range')) return;
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
    if (opts.length <= 8 && !param.select) {
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
      binding.sync(() => btns.forEach((b, j) => b.classList.toggle('active', j === param.value)));
      valueEl.appendChild(group);
    } else {
      // Custom dark dropdown for large option sets
      const sel = _mkSelect(opts, param.value, i => { param.value = i; updateDisplay(); }, 'param-select');
      binding.sync(() => { sel.value = param.value; });
      valueEl.appendChild(sel);
    }

  } else if (param.type === PARAM_TYPE.TRIGGER) {
    valueEl.textContent = '▶';
    valueEl.style.cssText = 'cursor:pointer;text-align:right;color:var(--text-2);font-size:13px;';
    row.style.cursor = 'pointer';
    row.addEventListener('click', e => {
      if (e.target === ctrlEl || ctrlEl.contains(e.target)) return; // badge click handled separately
      param.trigger();
      // brief flash to confirm
      valueEl.style.color = 'var(--accent)';
      setTimeout(() => { valueEl.style.color = 'var(--text-2)'; }, 120);
    });
    row.appendChild(valueEl);
    // fall through — context menu + touch long-press added below
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
  // (disposer stashed on the element so callers that rebuild rows
  // repeatedly — e.g. the param search results — can avoid leaking listeners;
  // releases ALL of this row's subscriptions, not just updateDisplay)
  row._psUnsub = () => { binding.dispose(); row._stopGlide?.(); };
  binding.sync(updateDisplay);

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
      binding.sync(refresh);

      // Drag up/down to adjust value; double-click to type
      el.style.cursor = 'ns-resize';
      let _rstartY = 0, _rstartVal = 0, _rstartRaw = null, _rPid = null;
      el.addEventListener('pointerdown', e => {
        if (e.button !== 0) return;
        el.setPointerCapture(e.pointerId);
        _rPid      = e.pointerId;
        _rstartY   = e.clientY;
        _rstartVal = which === 'min' ? (param.ctrlMin ?? param.min) : (param.ctrlMax ?? param.max);
        // raw (may be null = "no override") — pointercancel restores this,
        // so an aborted drag can't turn an unset range into a set one
        _rstartRaw = which === 'min' ? param.ctrlMin : param.ctrlMax;
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
      el.addEventListener('pointerup', () => { _rPid = null; });

      // Vertical drag here is the same gesture as panel scroll — when the
      // browser claims it (pointercancel), restore the exact pre-drag state
      el.addEventListener('pointercancel', e => {
        if (_rPid !== e.pointerId) return;
        _rPid = null;
        if (which === 'min') param.ctrlMin = _rstartRaw;
        else                 param.ctrlMax = _rstartRaw;
        refresh();
      });

      const openEditor = e => {
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
      };
      el.addEventListener('dblclick', openEditor);
      addDoubleTap(el, openEditor); // touch: double-tap opens the same editor
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
    binding.sync(() => { slider.value = param.value; });
    row.appendChild(slider);
  }

  row.appendChild(valueEl);
  return row;
}
