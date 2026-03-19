/**
 * ImWeb UI
 * Builds parameter rows, handles tabs, context menu, state dots, signal path.
 * Vanilla JS — no framework. Direct DOM manipulation for sub-ms response.
 */

import { PARAM_TYPE } from '../controls/ParameterSystem.js';
import { DEFAULT_FX_ORDER } from '../core/Pipeline.js';
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

  const valueEl = document.createElement('span');
  valueEl.className = 'param-value';

  const updateDisplay = () => {
    valueEl.textContent = param.displayValue;
    ctrlEl.textContent  = param.controllerLabel;
    ctrlEl.className    = `param-ctrl ${param.controllerClass}`;
    row.classList.toggle('active', !!param.controller);
  };

  // ── Type-specific controls ──────────────────────────────────────────────

  if (param.type === PARAM_TYPE.CONTINUOUS) {
    // Click+drag or slider
    let dragging = false, startX = 0, startVal = 0;
    const range = param.max - param.min;

    row.addEventListener('mousedown', e => {
      if (e.button !== 0 || param.locked) return;
      dragging = true;
      startX   = e.clientX;
      startVal = param.value;
      e.preventDefault();
    });

    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const delta = (e.clientX - startX) / 200 * range;
      param.value = startVal + delta;
      updateDisplay();
    });

    window.addEventListener('mouseup', () => { dragging = false; });

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
    const sel = document.createElement('select');
    sel.className = 'param-select';
    (param.options ?? []).forEach((opt, i) => {
      const o = document.createElement('option');
      o.value = i; o.textContent = opt;
      sel.appendChild(o);
    });
    sel.value = param.value;
    sel.addEventListener('change', e => {
      param.value = parseInt(e.target.value);
      updateDisplay();
    });
    valueEl.appendChild(sel);

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

      el.addEventListener('click', e => {
        e.stopPropagation();
        const current = which === 'min' ? (param.ctrlMin ?? param.min) : (param.ctrlMax ?? param.max);
        const input = document.createElement('input');
        input.type  = 'number';
        input.value = current;
        input.step  = 'any';
        input.style.cssText = 'width:36px;font-size:10px;font-family:var(--mono);background:var(--bg-4);border:1px solid var(--accent);color:var(--text-0);padding:1px 2px;border-radius:2px;';
        el.innerHTML = '';
        el.appendChild(input);
        input.focus();
        input.select();
        const commit = () => {
          const v = parseFloat(input.value);
          if (!isNaN(v)) {
            if (which === 'min') param.ctrlMin = v;
            else                 param.ctrlMax = v;
          }
          refresh();
        };
        input.addEventListener('blur', commit);
        input.addEventListener('keydown', e2 => {
          if (e2.key === 'Enter')  { commit(); e2.stopPropagation(); }
          if (e2.key === 'Escape') { refresh(); e2.stopPropagation(); }
        });
        input.addEventListener('dblclick', e2 => {
          e2.stopPropagation();
          // Double-click resets to natural range
          if (which === 'min') param.ctrlMin = null;
          else                 param.ctrlMax = null;
          refresh();
        });
      });
      return el;
    };
    row.appendChild(makeRangeEl('min'));
    row.appendChild(makeRangeEl('max'));
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
    'displace-params': ps.getGroup('displace'),
    'blend-params':    ps.getGroup('blend'),
    'color-params':    ps.getGroup('color'),
    'noise-params':    ps.getGroup('noise'),
    'output-params':   ps.getGroup('output'),
    'buffer-controls': ps.getGroup('buffer'),
    'clip-params':     ps.getGroup('movie'),
    'transform-params': ps.getGroup('scene3d').filter(p => p.id.includes('rot') || p.id.includes('pos') || p.id.includes('scale')),
    'camera3d-params': ps.getGroup('scene3d').filter(p => p.id.includes('cam')),
    'material-params': ps.getGroup('scene3d').filter(p => p.id.includes('mat') || p.id.includes('wire') || p.id.includes('light')),
    'draw-params':     ps.getGroup('draw'),
    'text-params':     ps.getGroup('text'),
    'fg-params':       ps.getGroup('fg'),
    'bg-params':       ps.getGroup('bg'),
    'effect-params':   ps.getGroup('effect'),
    'global-params':       ps.getGroup('global'),
    'particle-params':     ps.getGroup('particle'),
    'delay-params':        ps.getGroup('delay'),
    'vectorscope-params':  ps.getGroup('vectorscope'),
    'slitscan-params':     ps.getGroup('slitscan'),
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

export function buildGeometryButtons(ps, sceneManager) {
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

  // Model import buttons
  const importEl = document.getElementById('model-import');
  if (!importEl) return;

  // Status label — updated by main.js via _refreshModelLabel()
  const modelLabel = document.createElement('div');
  modelLabel.id = 'model-status-label';
  modelLabel.className = 'import-note';
  modelLabel.textContent = 'No model loaded — drop .glb/.obj/.stl here or use buttons below';
  importEl.appendChild(modelLabel);

  const importBtn = document.createElement('button');
  importBtn.className = 'import-btn';
  importBtn.textContent = '+ Import Model (GLB / OBJ / STL)';
  importBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.gltf,.glb,.obj,.stl';
    input.onchange = async e => {
      const file = e.target.files[0];
      if (!file) return;
      importBtn.textContent = `⏳ Loading…`;
      try {
        await sceneManager.loadModel(file);
        modelLabel.textContent = `✓ ${file.name}`;
        modelLabel.style.color = 'var(--green)';
        importBtn.textContent = '+ Import Model (GLB / OBJ / STL)';
        // Fire event so main.js can update layer routing
        importEl.dispatchEvent(new CustomEvent('modelLoaded', { bubbles: true, detail: { name: file.name } }));
      } catch (err) {
        console.error('[Import]', err);
        modelLabel.textContent = `✗ Error: ${err.message}`;
        modelLabel.style.color = 'var(--red, #e05)';
        importBtn.textContent = '+ Import Model (GLB / OBJ / STL)';
      }
    };
    input.click();
  });
  importEl.appendChild(importBtn);

  const clearBtn = document.createElement('button');
  clearBtn.className = 'import-btn';
  clearBtn.textContent = '↩ Back to Geometry';
  clearBtn.title = 'Remove imported model and return to procedural geometry';
  clearBtn.addEventListener('click', () => {
    const geoIdx = ps.get('scene3d.geo').value;
    // Force re-select current geometry by temporarily invalidating the key
    sceneManager._geoKey = null;
    sceneManager._importedModelName = null;
    sceneManager.setGeometry(sceneManager.geoFactory.create ? (ps.get('scene3d.geo').options[geoIdx] ?? 'Sphere') : 'Sphere');
    modelLabel.textContent = 'No model loaded — drop .glb/.obj/.stl here or use buttons below';
    modelLabel.style.color = '';
  });
  importEl.appendChild(clearBtn);

  const note = document.createElement('div');
  note.className = 'import-note';
  note.style.marginTop = '4px';
  note.textContent = 'Tip: drag & drop model files anywhere onto the app window';
  importEl.appendChild(note);
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
    let ox = 0, oy = 0, dragging = false;
    el.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true;
      const rect = el.getBoundingClientRect();
      const parentRect = this.el.getBoundingClientRect();
      ox = e.clientX - (rect.left - parentRect.left);
      oy = e.clientY - (rect.top  - parentRect.top);
      e.stopPropagation();
    });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      const x = e.clientX - ox;
      const y = e.clientY - oy;
      el.style.left = `${x}px`;
      el.style.top  = `${y}px`;
      p.feedbackPos = { x, y };
    });
    window.addEventListener('mouseup', () => { dragging = false; });
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

export class FPSDisplay {
  constructor() {
    this.el    = document.getElementById('status-fps');
    this._last = performance.now();
    this._frames = 0;
    this._fps = 0;
  }

  tick() {
    this._frames++;
    const now = performance.now();
    if (now - this._last >= 500) {
      this._fps = Math.round(this._frames * 1000 / (now - this._last));
      this._frames = 0;
      this._last = now;
      if (this.el) this.el.textContent = `${this._fps} fps`;
    }
  }
}
