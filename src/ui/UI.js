/**
 * ImWeb UI
 * Builds parameter rows, handles tabs, context menu, state dots, signal path.
 * Vanilla JS — no framework. Direct DOM manipulation for sub-ms response.
 */

import { PARAM_TYPE } from '../controls/ParameterSystem.js';

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
  row.className = `param-row ${param.type === PARAM_TYPE.TOGGLE ? 'toggle-row' : ''}`;
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
      if (e.button !== 0) return;
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

    // Scroll to adjust
    row.addEventListener('wheel', e => {
      e.preventDefault();
      const step = range * 0.01 * (e.shiftKey ? 5 : 1);
      param.value = param.value - Math.sign(e.deltaY) * step;
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
    row.appendChild(btn);
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
    { param: ps.get('layer.fg'), label: 'FG' },
    { param: ps.get('layer.bg'), label: 'BG' },
    { param: ps.get('layer.ds'), label: 'DS' },
  ].forEach(({ param, label }) => {
    const row = document.createElement('div');
    row.className = 'layer-row';

    const lbl = document.createElement('span');
    lbl.className = 'layer-label';
    lbl.textContent = label;
    lbl.addEventListener('contextmenu', e => {
      e.preventDefault();
      contextMenu?.show(param, e.clientX, e.clientY);
    });
    row.appendChild(lbl);

    const btns = document.createElement('div');
    btns.className = 'layer-btns';

    const buttons = [];
    (param.options ?? []).forEach((opt, i) => {
      const btn = document.createElement('button');
      btn.className = 'source-btn';
      btn.textContent = SOURCE_ABBREV[i] ?? opt.slice(0, 3).toUpperCase();
      btn.title = opt;
      btn.classList.toggle('active', i === param.value);
      btn.addEventListener('click', () => { param.value = i; });
      btn.addEventListener('contextmenu', e => {
        e.preventDefault();
        contextMenu?.show(param, e.clientX, e.clientY);
      });
      buttons.push(btn);
      btns.appendChild(btn);
    });

    // Keep highlight in sync with controller changes (MIDI, LFO, etc.)
    param.onChange(v => {
      const idx = Math.round(v);
      buttons.forEach((b, i) => b.classList.toggle('active', i === idx));
    });

    row.appendChild(btns);
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
    'layer-params':        ps.getGroup('layers'),
  };

  Object.entries(sections).forEach(([elId, params]) => {
    const el = document.getElementById(elId);
    if (!el || !params.length) return;
    el.innerHTML = '';
    params.forEach(p => el.appendChild(buildParamRow(p, contextMenu)));
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

  const fmts = [
    { label: '+ Import GLTF / GLB',  accept: '.gltf,.glb',  method: 'loadGLTF' },
    { label: '+ Import OBJ',          accept: '.obj',         method: 'loadOBJ'  },
    { label: '+ Import STL',          accept: '.stl',         method: 'loadSTL'  },
  ];

  fmts.forEach(({ label, accept, method }) => {
    const btn = document.createElement('button');
    btn.className = 'import-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = accept;
      input.onchange = async e => {
        const file = e.target.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        try {
          await sceneManager[method](url);
          btn.textContent = `✓ ${file.name}`;
        } catch (err) {
          console.error('[Import]', err);
          btn.textContent = `✗ Error loading ${file.name}`;
        }
      };
      input.click();
    });
    importEl.appendChild(btn);
  });

  const note = document.createElement('div');
  note.className = 'import-note';
  note.textContent = 'FBX requires additional setup — see README';
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

export class SignalPath {
  constructor(ps) {
    this.ps = ps;
    this.el = document.getElementById('signal-path-display');
    this._render();

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
    const vigOn     = p.get('effect.vignette').value > 0;
    const bloomOn   = p.get('effect.bloom').value > 0;
    const pixOn     = p.get('effect.pixelate').value > 1;
    const edgeOn    = p.get('effect.edge').value > 0;
    const rgbOn     = p.get('effect.rgbshift').value > 0;
    const kaleOn    = p.get('effect.kaleidoscope').value >= 2;
    const psortOn   = p.get('effect.pixelsort').value > 0;
    const grainOn   = p.get('effect.grain').value > 0 || p.get('effect.scanlines').value > 0;
    const strobeOn2   = p.get('effect.strobe').value;
    const qmOn        = p.get('effect.quadmirror').value > 0;
    const levelsOn    = p.get('effect.lvblack').value > 0 || p.get('effect.lvwhite').value < 100 || p.get('effect.lvgamma').value !== 100;
    const postOn    = p.get('effect.posterize').value < 32;
    const solOn     = p.get('effect.solarize').value < 100;

    this.el.innerHTML = '';

    const nodes = [
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
      ...(pixOn  ? [{ label: 'pixel',   type: 'active' }] : []),
      ...(edgeOn ? [{ label: 'edge',    type: 'active' }] : []),
      ...(rgbOn  ? [{ label: 'rgb»',    type: 'active' }] : []),
      ...(kaleOn   ? [{ label: 'kale',   type: 'active' }] : []),
      ...(qmOn     ? [{ label: 'mirror', type: 'active' }] : []),
      ...(postOn   ? [{ label: 'poster', type: 'active' }] : []),
      ...(solOn  ? [{ label: 'solar',   type: 'active' }] : []),
      ...(vigOn    ? [{ label: 'vign',   type: 'active' }] : []),
      ...(bloomOn  ? [{ label: 'bloom',  type: 'active' }] : []),
      ...(levelsOn ? [{ label: 'levels', type: 'active' }] : []),
      ...(psortOn ? [{ label: 'psort',  type: 'active' }] : []),
      ...(grainOn  ? [{ label: 'grain',   type: 'active' }] : []),
      ...(strobeOn2? [{ label: 'strobe', type: 'active' }] : []),
      ...(fadeOn   ? [{ label: 'fade',   type: 'active' }] : []),
      { label: '▶ out', type: 'active' },
    ].filter(Boolean);

    nodes.forEach((n, i) => {
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
      }
      this.el.appendChild(el);

      if (i < nodes.length - 1 && n.type !== 'merge' && nodes[i+1].type !== 'merge') {
        const arrow = document.createElement('div');
        arrow.className = 'sp-arrow';
        arrow.textContent = '→';
        this.el.appendChild(arrow);
      }
    });
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

    // Clamp to viewport
    requestAnimationFrame(() => {
      const r = this.el.getBoundingClientRect();
      if (r.right  > window.innerWidth)  this.el.style.left = `${x - r.width}px`;
      if (r.bottom > window.innerHeight) this.el.style.top  = `${y - r.height}px`;
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
          const cc = parseInt(prompt('MIDI CC number (0–127):', '7'));
          if (!isNaN(cc)) this.ctrl.assign(this._currentParam.id, { type: 'midi-cc', cc });
        } else if (type === 'midi-note') {
          const note = parseInt(prompt('MIDI Note number (0–127, e.g. 60=C4):', '60'));
          if (!isNaN(note)) this.ctrl.assign(this._currentParam.id, { type: 'midi-note', note });
        } else if (type.startsWith('lfo-')) {
          const hzStr = prompt(
            'LFO Hz (or beat div: "1/8","1/4","1/2","1","2","4"):\n' +
            '  Phase 0-1 and Width 0-1 (square only) can be appended:\n' +
            '  e.g.  "0.5 0.25 0.7"  → 0.5Hz, phase=0.25, width=0.7',
            this._currentParam.controller?.hz?.toFixed(2) ?? '0.5'
          );
          if (hzStr === null) { this.hide(); return; }
          const parts  = hzStr.trim().split(/\s+/);
          const beatDivMap = { '1/8': 2, '1/4': 1, '1/2': 0.5, '1': 0.25, '2': 0.125, '4': 0.0625 };
          const bpmDiv = beatDivMap[parts[0]];
          const bpm = this.ps.get('global.bpm')?.value ?? 120;
          const hz  = bpmDiv != null ? (bpm / 60) * bpmDiv : parseFloat(parts[0]);
          const phase = parseFloat(parts[1] ?? '0');
          const width = parseFloat(parts[2] ?? '0.5');
          this.ctrl.assign(this._currentParam.id, {
            type, hz: isNaN(hz) ? 0.5 : hz,
            phase: isNaN(phase) ? 0 : Math.max(0, Math.min(1, phase)),
            width: isNaN(width) ? 0.5 : Math.max(0, Math.min(1, width)),
            ...(bpmDiv != null ? { bpmDiv } : {}),
          });
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
      row.innerHTML = `<span class="preset-num">${i}</span><span class="preset-name">${p.name}</span>`;
      row.addEventListener('dblclick', () => this.pm.activatePreset(i));
      row.addEventListener('click', e => {
        // Single click selects, shows name editor on long hold
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
      if (p) row.querySelector('.preset-name').textContent = p.name;
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
