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
export function buildHypercubePanel(container, hypercube, ps) {
  const panel = document.createElement('div');
  panel.className = 'hc-panel';
  panel.style.cssText = 'padding:8px 0;font-family:monospace;font-size:11px;color:var(--text-1,#e0e0f0);';

  let morphDuration = 800;
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

  _paramRow(dimSec, 'Morph ms', morphDuration, 100, 4000, 50, v => { morphDuration = v; });
  _selectRow(dimSec, 'Easing', EASING_KEYS, EASING_KEYS.indexOf(morphEasing), idx => {
    morphEasing = EASING_KEYS[idx];
  });

  // ── Projection ──────────────────────────────────────────────────────────
  const projSec = _section(panel, 'PROJECTION');
  _paramRow(projSec, 'W-dist', hypercube._wDistance ?? 4,  1.1, 20,  0.1,  v => hypercube.setWDistance(v));
  _paramRow(projSec, 'Scale',  hypercube._scale ?? 1,       0.1, 5,   0.05, v => hypercube.setScale(v));
  _selectRow(projSec, 'Mode', ['perspective', 'orthographic'], 0, idx => {
    hypercube.setProjectionMode(idx === 0 ? 'perspective' : 'orthographic');
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
        const speed = (hypercube._rotSpeeds?.[pIdx] ?? 0) * 100; // store × 100 for drag ergonomics
        _paramRow(body, `${i}↔${j}`, speed, -628, 628, 1, v => {
          hypercube.setRotationSpeed(pIdx, v / 100);
        });
      }
    }
  }
  rebuildRotationRows();

  // ── Render ──────────────────────────────────────────────────────────────
  const renderSec = _section(panel, 'RENDER');
  _selectRow(renderSec, 'Mode', ['wireframe', 'points', 'both'], 0, idx => {
    hypercube.setRenderMode(['wireframe', 'points', 'both'][idx]);
  });
  _paramRow(renderSec, 'Pt size',      hypercube._pointSize ?? 3,       0.5,   20,  0.5, v => hypercube.setPointSize(v));
  _paramRow(renderSec, 'Edge opacity', (hypercube._edgeOpacityMult ?? 1) * 100, 0, 100, 1, v => hypercube.setEdgeOpacity(v / 100));
  _paramRow(renderSec, 'Edge width',  hypercube._edgeWidth ?? 1.5, 0.5, 8.0, 0.1, v => hypercube.setEdgeWidth(v));
  _selectRow(renderSec, 'Faces', ['off', 'on'], hypercube._hFaces?._visible ? 1 : 0, idx => hypercube.setFacesVisible(idx === 1));
  _paramRow(renderSec, 'Face opacity', hypercube._hFaces?._opacity ?? 0.15, 0.0, 1.0, 0.01, v => hypercube.setFaceOpacity(v));

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
