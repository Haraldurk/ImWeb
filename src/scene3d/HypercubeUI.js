/**
 * HypercubeUI.js
 * Build a hypercube control panel matching the ImWeb param-row pattern.
 * No external dependencies beyond HypercubeGeometry.js imports.
 */

import {
  DIMENSION_COLORS,
  EASING,
  MAX_DIM,
  rotationPlaneCount,
  vertexCount,
  edgeCount,
} from './HypercubeGeometry.js';

const EASING_KEYS = Object.keys(EASING);

/**
 * Build and append a hypercube control panel to container.
 * @param {HTMLElement}      container  – parent DOM node
 * @param {HypercubeObject}  hypercube  – live HypercubeObject
 * @param {ParameterSystem|null} ps     – optional; unused currently but kept for future wiring
 * @returns {HTMLElement} the panel root
 */
// Mapping from (i,j) plane to ps param id — covers the 4 base-4D planes
const _ROT_PARAM = { '0,1':'hypercube.rot.xy', '0,2':'hypercube.rot.xz', '1,2':'hypercube.rot.yz', '0,3':'hypercube.rot.xw' };

export function buildHypercubePanel(container, hypercube, ps) {
  const panel = document.createElement('div');
  panel.className = 'hc-panel';
  panel.style.cssText = 'padding:8px 0;font-family:monospace;font-size:11px;color:var(--text-1,#e0e0f0);';

  let morphDuration = ps?.get('hypercube.morphDuration')?.value ?? 800;
  let morphEasing   = 'easeInOut';
  let lastRebuildDim = -1;
  let pendingRebuild = null;

  // ── Dimension pills ─────────────────────────────────────────────────────
  const dimSec = _section(panel, 'DIMENSION');

  const pillRow = document.createElement('div');
  pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;padding:4px 8px 6px;';

  for (let d = 4; d <= MAX_DIM; d++) {
    const col  = DIMENSION_COLORS[d] ?? '#ffffff';
    const pill = document.createElement('button');
    pill.textContent = `${d}D`;
    pill.dataset.dim = d;
    pill.style.cssText = `
      padding:3px 8px;border:1px solid ${col}66;background:${col}22;
      color:${col};cursor:pointer;font-size:10px;font-family:monospace;
      border-radius:3px;transition:background 0.12s;
    `;
    pill.addEventListener('mouseenter', () => { pill.style.background = `${col}44`; });
    pill.addEventListener('mouseleave', () => { pill.style.background = `${col}22`; });
    pill.addEventListener('click', () => {
      hypercube.morphTo(d, { durationMs: morphDuration, easing: morphEasing });
      ps?.set('hypercube.dim', d);   // persist to state
      // Stats text updates next interval tick. Defer the 66-row DOM rebuild
      // until after the morph completes so it doesn't freeze the start frames.
      if (pendingRebuild) clearTimeout(pendingRebuild);
      pendingRebuild = setTimeout(() => {
        pendingRebuild = null;
        lastRebuildDim = -1; // force rebuild on next updateStats
      }, morphDuration + 50);
    });
    pillRow.appendChild(pill);
  }
  dimSec.appendChild(pillRow);

  _paramRow(dimSec, 'Morph ms', morphDuration, 100, 4000, 50, v => {
    morphDuration = v;
    ps?.set('hypercube.morphDuration', v);
  });
  _selectRow(dimSec, 'Easing', EASING_KEYS, EASING_KEYS.indexOf(morphEasing), idx => {
    morphEasing = EASING_KEYS[idx];
  });

  // ── Projection ──────────────────────────────────────────────────────────
  const projSec = _section(panel, 'PROJECTION');
  _paramRow(projSec, 'W-dist', ps?.get('hypercube.wDistance')?.value ?? hypercube._wDistance ?? 3.0, 1.1, 20, 0.1, v => {
    hypercube.setWDistance(v);
    ps?.set('hypercube.wDistance', v);
  });
  _paramRow(projSec, 'Scale', ps?.get('hypercube.scale')?.value ?? hypercube._scale ?? 1.0, 0.1, 5, 0.05, v => {
    hypercube.setScale(v);
    ps?.set('hypercube.scale', v);
  });
  // ── Rotation planes ─────────────────────────────────────────────────────
  const rotSec = _section(panel, 'ROTATION PLANES');

  function rebuildRotationRows() {
    // Remove all children after the section header
    while (rotSec.children.length > 1) rotSec.removeChild(rotSec.lastChild);

    const dim = hypercube.dim;

    // Collect planes into tier buckets
    const tiers = [
      { label: 'Base 3D',  planes: [], open: true },
      { label: 'W tier',   planes: [], open: true },
      { label: 'V+ tier',  planes: [], open: false },
    ];

    let idx = 0;
    for (let i = 0; i < dim; i++) {
      for (let j = i + 1; j < dim; j++) {
        const tier = Math.max(i, j) < 3 ? 0 : Math.max(i, j) < 4 ? 1 : 2;
        tiers[tier].planes.push({ i, j, idx });
        idx++;
      }
    }

    for (const { label, planes, open } of tiers) {
      if (planes.length === 0) continue;
      const { body } = _collapsible(rotSec, label, open);
      for (const { i, j, idx: pIdx } of planes) {
        const paramId = _ROT_PARAM[`${i},${j}`] ?? null;
        // Read initial speed from ps if available, else from live object
        const initSpeed = paramId && ps?.get(paramId)
          ? ps.get(paramId).value * 100
          : (hypercube._rotSpeeds?.[pIdx] ?? 0) * 100;
        _paramRow(body, `${i}↔${j}`, initSpeed, -628, 628, 1, v => {
          hypercube.setRotationSpeed(pIdx, v / 100);
          if (paramId) ps?.set(paramId, v / 100);  // persist to state
        });
      }
    }
  }
  rebuildRotationRows();

  // ── Projection mode ─────────────────────────────────────────────────────
  const _PROJ = ['perspective', 'orthographic'];
  _selectRow(projSec, 'Proj', _PROJ,
    ps?.get('hypercube.projMode')?.value ?? 0,
    idx => { hypercube.setProjectionMode(_PROJ[idx]); ps?.set('hypercube.projMode', idx); });

  // ── Render ──────────────────────────────────────────────────────────────
  const renderSec = _section(panel, 'RENDER');
  const _RMODES = ['wireframe', 'points', 'both', 'none'];
  _selectRow(renderSec, 'Mode', _RMODES,
    ps?.get('hypercube.renderMode')?.value ?? 0,
    idx => { hypercube.setRenderMode(_RMODES[idx]); ps?.set('hypercube.renderMode', idx); });
  _paramRow(renderSec, 'Pt size',
    ps?.get('hypercube.pointSize')?.value ?? hypercube._pointSize ?? 3.0,
    0.5, 20, 0.5, v => { hypercube.setPointSize(v);      ps?.set('hypercube.pointSize', v); });
  _paramRow(renderSec, 'Edge opacity',
    (ps?.get('hypercube.edgeOpacity')?.value ?? hypercube._edgeOpacityMult ?? 1.0) * 100,
    0, 100, 1, v => { hypercube.setEdgeOpacity(v / 100); ps?.set('hypercube.edgeOpacity', v / 100); });
  _paramRow(renderSec, 'Edge width',
    ps?.get('hypercube.edgeWidth')?.value ?? hypercube._edgeWidth ?? 1.5,
    0.5, 8.0, 0.1, v => { hypercube.setEdgeWidth(v);     ps?.set('hypercube.edgeWidth', v); });
  const _TEX_SRC_LABELS = ['None', 'Camera', 'Movie', 'Screen', 'Draw', 'Buffer', 'Noise'];
  const _BLEND_LABELS   = ['Normal', 'Additive', 'Multiply', 'Subtract'];

  _selectRow(renderSec, 'Faces', ['off', 'on'],
    ps?.get('hypercube.faces.active')?.value ? 1 : 0,
    idx => { hypercube.setFacesVisible(idx === 1); ps?.set('hypercube.faces.active', idx === 1 ? 1 : 0); });
  _paramRow(renderSec, 'Face opacity',
    ps?.get('hypercube.faces.opacity')?.value ?? 0.5,
    0.0, 1.0, 0.01,
    v => { hypercube.setFaceOpacity(v); ps?.set('hypercube.faces.opacity', v); });
  _selectRow(renderSec, 'Face blend', _BLEND_LABELS,
    ps?.get('hypercube.faces.blend')?.value ?? 0,
    idx => { hypercube.setFaceBlending(idx); ps?.set('hypercube.faces.blend', idx); });
  _paramRow(renderSec, 'Face hue',
    ps?.get('hypercube.faces.hue')?.value ?? 0,
    0, 360, 1, v => {
      hypercube.setFaceHue(v, ps?.get('hypercube.faces.sat')?.value ?? 0);
      ps?.set('hypercube.faces.hue', v);
    });
  _paramRow(renderSec, 'Face sat',
    ps?.get('hypercube.faces.sat')?.value ?? 0,
    0, 100, 1, v => {
      hypercube.setFaceHue(ps?.get('hypercube.faces.hue')?.value ?? 0, v);
      ps?.set('hypercube.faces.sat', v);
    });
  _selectRow(renderSec, 'Face tex', _TEX_SRC_LABELS,
    ps?.get('hypercube.faces.texsrc')?.value ?? 0,
    idx => { ps?.set('hypercube.faces.texsrc', idx); });

  const _GEO_LABELS = ['Sphere','Torus','Cube','Plane','Cylinder','Capsule','TorusKnot','Cone','Dodecahedron','Icosahedron','Octahedron','Tetrahedron','Ring'];
  _selectRow(renderSec, 'Instancer', ['off', 'on'],
    ps?.get('hypercube.inst.active')?.value ? 1 : 0,
    idx => { hypercube.setInstancerVisible(idx === 1); ps?.set('hypercube.inst.active', idx === 1 ? 1 : 0); });
  _selectRow(renderSec, 'Inst geo', _GEO_LABELS,
    ps?.get('hypercube.inst.geo')?.value ?? 0,
    idx => { hypercube.setInstancerGeoType(_GEO_LABELS[idx]); ps?.set('hypercube.inst.geo', idx); });
  _paramRow(renderSec, 'Inst scale',
    ps?.get('hypercube.inst.scale')?.value ?? 0.08,
    0.01, 2.0, 0.01,
    v => { hypercube.setInstancerScale(v);   ps?.set('hypercube.inst.scale', v); });
  _paramRow(renderSec, 'Inst opacity',
    ps?.get('hypercube.inst.opacity')?.value ?? 1.0,
    0.0, 1.0, 0.01,
    v => { hypercube.setInstancerOpacity(v); ps?.set('hypercube.inst.opacity', v); });
  _selectRow(renderSec, 'Inst tex', _TEX_SRC_LABELS,
    ps?.get('hypercube.inst.texsrc')?.value ?? 0,
    idx => { ps?.set('hypercube.inst.texsrc', idx); });

  // ── Stats ────────────────────────────────────────────────────────────────
  const statsDiv = document.createElement('div');
  statsDiv.style.cssText = `
    padding:4px 8px;color:var(--text-2,#8888a0);font-size:10px;
    border-top:1px solid #2a2a34;margin-top:4px;
  `;

  function updateStats() {
    const d = hypercube.dim;
    statsDiv.textContent =
      `dim:${d}  verts:${vertexCount(d)}  edges:${edgeCount(d)}  planes:${rotationPlaneCount(d)}`;
    // Only rebuild the rotation-plane rows when dim actually changed — at 12D
    // this is 66 row creations and was firing every 200ms unconditionally.
    if (d !== lastRebuildDim) {
      lastRebuildDim = d;
      rebuildRotationRows();
    }
  }
  updateStats();
  setInterval(updateStats, 200);
  panel.appendChild(statsDiv);

  container.appendChild(panel);
  return panel;
}

// ── DOM helpers ───────────────────────────────────────────────────────────────

function _section(parent, label) {
  const sec = document.createElement('div');
  sec.style.cssText = 'margin-bottom:2px;';
  const hdr = document.createElement('div');
  hdr.textContent = label;
  hdr.style.cssText = `
    padding:3px 8px;font-size:9px;letter-spacing:0.08em;text-transform:uppercase;
    color:var(--text-2,#8888a0);background:var(--bg-3,#1f1f25);
  `;
  sec.appendChild(hdr);
  parent.appendChild(sec);
  return sec;
}

function _collapsible(parent, label, open = true) {
  const group  = document.createElement('div');
  const toggle = document.createElement('div');
  toggle.style.cssText = `
    padding:2px 8px;cursor:pointer;color:var(--text-2,#8888a0);
    font-size:10px;display:flex;align-items:center;gap:4px;
  `;
  const arrow = document.createElement('span');
  arrow.textContent = open ? '▾' : '▸';

  toggle.appendChild(arrow);
  toggle.appendChild(document.createTextNode(' ' + label));

  const body = document.createElement('div');
  body.style.display = open ? 'block' : 'none';

  toggle.addEventListener('click', () => {
    const isOpen = body.style.display !== 'none';
    body.style.display = isOpen ? 'none' : 'block';
    arrow.textContent  = isOpen ? '▸' : '▾';
  });

  group.appendChild(toggle);
  group.appendChild(body);
  parent.appendChild(group);
  return { group, body };
}

/**
 * Param row: [label] [draggable value display]
 * Drag: (startY – currentY) × step × 0.5; Shift = ×10.
 * Double-click opens inline number input; Enter commits, Escape cancels.
 */
function _paramRow(parent, label, value, min, max, step, onChange) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;padding:2px 8px;gap:6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'flex:1;color:var(--text-1,#e0e0f0);min-width:60px;';

  const display = document.createElement('span');
  display.style.cssText = `
    min-width:44px;text-align:right;color:var(--accent,#c8a020);
    cursor:ns-resize;user-select:none;
  `;

  let current = value;

  const fmt = v => step < 1 ? v.toFixed(2) : String(Math.round(v));
  display.textContent = fmt(current);

  let dragging = false, startY = 0, startVal = 0;

  display.addEventListener('mousedown', e => {
    dragging = true; startY = e.clientY; startVal = current;
    e.preventDefault();
  });
  const onMove = e => {
    if (!dragging) return;
    const mult = e.shiftKey ? 10 : 1;
    const delta = (startY - e.clientY) * step * 0.5 * mult;
    current = Math.max(min, Math.min(max, startVal + delta));
    display.textContent = fmt(current);
    onChange(current);
  };
  const onUp = () => { dragging = false; };
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  display.addEventListener('dblclick', () => {
    const input = document.createElement('input');
    input.type  = 'number';
    input.value = current;
    input.min   = min; input.max = max; input.step = step;
    input.style.cssText = 'width:60px;background:#1a1a22;color:#e0e0f0;border:1px solid #555;font-size:11px;padding:1px 3px;';
    row.replaceChild(input, display);
    input.focus();
    const commit = () => {
      const v = Math.max(min, Math.min(max, parseFloat(input.value) || current));
      current = v;
      display.textContent = fmt(v);
      if (row.contains(input)) row.replaceChild(display, input);
      onChange(v);
    };
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter')  commit();
      if (e.key === 'Escape' && row.contains(input)) row.replaceChild(display, input);
    });
    input.addEventListener('blur', commit);
  });

  row.appendChild(lbl);
  row.appendChild(display);
  parent.appendChild(row);
  return row;
}

function _selectRow(parent, label, options, selectedIdx, onChange) {
  const row = document.createElement('div');
  row.style.cssText = 'display:flex;align-items:center;padding:2px 8px;gap:6px;';

  const lbl = document.createElement('span');
  lbl.textContent = label;
  lbl.style.cssText = 'flex:1;color:var(--text-1,#e0e0f0);min-width:60px;';

  const sel = document.createElement('select');
  sel.style.cssText = `
    background:var(--bg-2,#18181f);color:var(--text-1,#e0e0f0);
    border:1px solid #444;font-size:10px;font-family:monospace;padding:1px 3px;
  `;
  options.forEach((opt, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = opt;
    if (i === selectedIdx) o.selected = true;
    sel.appendChild(o);
  });
  sel.addEventListener('change', () => onChange(parseInt(sel.value)));

  row.appendChild(lbl);
  row.appendChild(sel);
  parent.appendChild(row);
  return row;
}
