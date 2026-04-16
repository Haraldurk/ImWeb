/**
 * HypercubeObject.js
 * Three.js wrapper for an N-dimensional hypercube (4D–12D).
 * Renders as LineSegments + Points with additive blending.
 */

import * as THREE from 'three';
import {
  MAX_DIM,
  DIMENSION_COLORS,
  generateVertices,
  generateEdges,
  projectAllVertices,
  rotationPlaneCount,
  defaultRotationSpeeds,
  vertexCount,
  edgeCount,
  createMorphState,
  morphStep,
  edgeOpacity,
} from './HypercubeGeometry.js';

export class HypercubeObject {
  /**
   * @param {THREE.Scene} scene
   * @param {object} options
   * @param {number}  [options.dim=4]
   * @param {number}  [options.wDistance=4]
   * @param {number}  [options.scale=1]
   * @param {string}  [options.projectionMode='perspective']
   * @param {string}  [options.renderMode='wireframe']  'wireframe'|'points'|'both'
   * @param {number}  [options.pointSize=3]
   * @param {number}  [options.edgeOpacity=1]
   */
  constructor(scene, options = {}) {
    this._scene          = scene;
    this._dim            = Math.max(3, Math.min(MAX_DIM, options.dim ?? 4));
    this._wDistance      = options.wDistance      ?? 4.0;
    this._scale          = options.scale          ?? 1.0;
    this._projectionMode = options.projectionMode ?? 'perspective';
    this._renderMode     = options.renderMode     ?? 'wireframe';
    this._pointSize      = options.pointSize      ?? 3.0;
    this._edgeOpacityMult = options.edgeOpacity   ?? 1.0;

    // N-D geometry
    this._vertices = null;   // Float64Array[] — raw hypercube coords
    this._edges    = null;   // [indexA, indexB, dimAxis][]
    this._projected = null;  // [x,y,z][] — current projected positions

    // Rotation state
    this._rotAngles = null;  // Float64Array – one angle per (i<j) plane
    this._rotSpeeds = null;  // Float64Array – rad/s per plane

    // Morph
    this._morphQueue        = [];
    this._morphState        = null;
    this._morphFromVertices = null;
    this._morphFromDim      = null;
    this._morphFromAngles   = null;

    // Vertex subscriber callbacks: Map<vertexIndex, callback[]>
    this._subscribers = new Map();

    // Three.js objects (set by _rebuildGeometry)
    this._lines  = null;
    this._points = null;

    this._rebuild();
  }

  // ── Internal rebuild ──────────────────────────────────────────────────────

  _rebuild() {
    this._vertices = generateVertices(this._dim);
    this._edges    = generateEdges(this._dim);

    const nPlanes   = rotationPlaneCount(this._dim);
    const oldAngles = this._rotAngles;
    const oldSpeeds = this._rotSpeeds;

    this._rotAngles = new Float64Array(nPlanes);
    this._rotSpeeds = defaultRotationSpeeds(this._dim);

    // Carry over angles/speeds for any planes that existed before
    if (oldAngles) {
      const n = Math.min(oldAngles.length, nPlanes);
      for (let i = 0; i < n; i++) this._rotAngles[i] = oldAngles[i];
    }
    if (oldSpeeds) {
      const n = Math.min(oldSpeeds.length, nPlanes);
      for (let i = 0; i < n; i++) this._rotSpeeds[i] = oldSpeeds[i];
    }

    this._projected = projectAllVertices(
      this._vertices, this._dim, this._rotAngles, this._wDistance
    );
    this._rebuildGeometry();
  }

  _rebuildGeometry() {
    const nVerts = this._vertices.length;
    const nEdges = this._edges.length;

    // ── LineSegments ──────────────────────────────────────────────────────
    const linePos  = new Float32Array(nEdges * 6);
    const lineCol  = new Float32Array(nEdges * 6);
    const lineGeo  = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3));
    lineGeo.setAttribute('color',    new THREE.BufferAttribute(lineCol, 3));

    const lineMat = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent:  true,
      depthWrite:   false,
      blending:     THREE.AdditiveBlending,
    });

    // ── Points ────────────────────────────────────────────────────────────
    const ptPos = new Float32Array(nVerts * 3);
    const ptCol = new Float32Array(nVerts * 3);
    const ptGeo = new THREE.BufferGeometry();
    ptGeo.setAttribute('position', new THREE.BufferAttribute(ptPos, 3));
    ptGeo.setAttribute('color',    new THREE.BufferAttribute(ptCol, 3));

    const ptMat = new THREE.PointsMaterial({
      vertexColors:   true,
      size:           this._pointSize,
      sizeAttenuation: false,
      transparent:    true,
      depthWrite:     false,
      blending:       THREE.AdditiveBlending,
    });

    // Dispose old objects
    if (this._lines) {
      this._scene.remove(this._lines);
      this._lines.geometry.dispose();
      this._lines.material.dispose();
    }
    if (this._points) {
      this._scene.remove(this._points);
      this._points.geometry.dispose();
      this._points.material.dispose();
    }

    this._lines  = new THREE.LineSegments(lineGeo, lineMat);
    this._points = new THREE.Points(ptGeo, ptMat);
    this._lines.frustumCulled  = false;
    this._points.frustumCulled = false;

    this._scene.add(this._lines);
    this._scene.add(this._points);

    this._updateVisibility();
  }

  _updateVisibility() {
    if (this._lines)  this._lines.visible  = this._renderMode !== 'points';
    if (this._points) this._points.visible = this._renderMode !== 'wireframe';
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(deltaMs) {
    const dt = deltaMs / 1000;

    // Advance morph
    if (this._morphState) {
      if (!this._morphState.done) {
        morphStep(this._morphState, deltaMs);
      }
      if (this._morphState.done) {
        this._morphState = null;
        if (this._morphQueue.length > 0) this._startNextMorph();
      }
    } else if (this._morphQueue.length > 0) {
      this._startNextMorph();
    }

    // Advance rotation angles
    for (let i = 0; i < this._rotAngles.length; i++) {
      this._rotAngles[i] += this._rotSpeeds[i] * dt;
    }

    // Project
    if (this._morphState && this._morphFromVertices) {
      this._projectMorphInterp();
    } else {
      this._projected = projectAllVertices(
        this._vertices, this._dim, this._rotAngles, this._wDistance
      );
    }

    this._updateBuffers();
    this._notifySubscribers();
  }

  _projectMorphInterp() {
    const fromDim    = this._morphFromDim;
    const fromAngles = this._morphFromAngles ?? this._rotAngles;

    const fromProj = projectAllVertices(
      this._morphFromVertices,
      fromDim,
      fromAngles.slice(0, rotationPlaneCount(fromDim)),
      this._wDistance
    );
    const toProj = projectAllVertices(
      this._vertices, this._dim, this._rotAngles, this._wDistance
    );

    const t     = this._morphState.t;
    const count = Math.min(fromProj.length, toProj.length);
    this._projected = [];

    for (let i = 0; i < count; i++) {
      this._projected.push([
        fromProj[i][0] * (1 - t) + toProj[i][0] * t,
        fromProj[i][1] * (1 - t) + toProj[i][1] * t,
        fromProj[i][2] * (1 - t) + toProj[i][2] * t,
      ]);
    }
    for (let i = count; i < toProj.length; i++) {
      this._projected.push(toProj[i]);
    }
  }

  _updateBuffers() {
    const s     = this._scale;
    const proj  = this._projected;
    const edges = this._edges;

    // ── Line buffer ───────────────────────────────────────────────────────
    const lp = this._lines.geometry.attributes.position.array;
    const lc = this._lines.geometry.attributes.color.array;

    for (let e = 0; e < edges.length; e++) {
      const [a, b, dimAxis] = edges[e];
      const pa  = proj[a] ?? [0, 0, 0];
      const pb  = proj[b] ?? [0, 0, 0];
      const base = e * 6;
      lp[base]     = pa[0] * s; lp[base + 1] = pa[1] * s; lp[base + 2] = pa[2] * s;
      lp[base + 3] = pb[0] * s; lp[base + 4] = pb[1] * s; lp[base + 5] = pb[2] * s;

      const hex = DIMENSION_COLORS[Math.min(dimAxis + 3, DIMENSION_COLORS.length - 1)] ?? '#ffffff';
      const col = _hexToRgb(hex);
      const op  = edgeOpacity(dimAxis, this._dim) * this._edgeOpacityMult;
      lc[base]     = col[0] * op; lc[base + 1] = col[1] * op; lc[base + 2] = col[2] * op;
      lc[base + 3] = col[0] * op; lc[base + 4] = col[1] * op; lc[base + 5] = col[2] * op;
    }

    this._lines.geometry.attributes.position.needsUpdate = true;
    this._lines.geometry.attributes.color.needsUpdate    = true;

    // ── Point buffer ──────────────────────────────────────────────────────
    const pp = this._points.geometry.attributes.position.array;
    const pc = this._points.geometry.attributes.color.array;
    const dimCol = _hexToRgb(DIMENSION_COLORS[Math.min(this._dim, DIMENSION_COLORS.length - 1)] ?? '#ffffff');

    for (let i = 0; i < proj.length; i++) {
      const p3 = proj[i] ?? [0, 0, 0];
      pp[i * 3]     = p3[0] * s;
      pp[i * 3 + 1] = p3[1] * s;
      pp[i * 3 + 2] = p3[2] * s;
      pc[i * 3]     = dimCol[0];
      pc[i * 3 + 1] = dimCol[1];
      pc[i * 3 + 2] = dimCol[2];
    }

    this._points.geometry.attributes.position.needsUpdate = true;
    this._points.geometry.attributes.color.needsUpdate    = true;
  }

  _notifySubscribers() {
    if (this._subscribers.size === 0) return;
    const s = this._scale;
    for (const [vi, callbacks] of this._subscribers) {
      const p = this._projected[vi];
      if (p) {
        const wx = p[0] * s, wy = p[1] * s, wz = p[2] * s;
        for (const cb of callbacks) cb(wx, wy, wz);
      }
    }
  }

  // ── Morph ──────────────────────────────────────────────────────────────────

  /**
   * Queue a morph to toDim.
   * @param {number} toDim
   * @param {{durationMs?:number, easing?:string}} options
   */
  morphTo(toDim, options = {}) {
    toDim = Math.max(3, Math.min(MAX_DIM, toDim));
    const { durationMs = 800, easing = 'easeInOut' } = options;
    this._morphQueue.push({ toDim, durationMs, easing });
    if (!this._morphState) this._startNextMorph();
  }

  _startNextMorph() {
    if (this._morphQueue.length === 0) return;
    const { toDim, durationMs, easing } = this._morphQueue.shift();

    // Snapshot the current state as "from"
    this._morphFromDim      = this._dim;
    this._morphFromVertices = generateVertices(this._dim);
    this._morphFromAngles   = this._rotAngles.slice();

    // Switch to target dimension
    this._dim = toDim;
    this._rebuild();

    this._morphState = createMorphState(this._morphFromDim, toDim, durationMs, easing);
  }

  // ── Pub/sub ───────────────────────────────────────────────────────────────

  /**
   * Subscribe to world-position updates for vertex vi.
   * Returns an unsubscribe function.
   * @param {number} vi
   * @param {(x:number,y:number,z:number)=>void} callback
   */
  subscribeVertex(vi, callback) {
    if (!this._subscribers.has(vi)) this._subscribers.set(vi, []);
    this._subscribers.get(vi).push(callback);
    return () => {
      const arr = this._subscribers.get(vi);
      if (arr) {
        const idx = arr.indexOf(callback);
        if (idx !== -1) arr.splice(idx, 1);
      }
    };
  }

  // ── Setters ───────────────────────────────────────────────────────────────

  setRenderMode(mode) {
    this._renderMode = mode;
    this._updateVisibility();
  }

  setProjectionMode(mode) {
    this._projectionMode = mode;
    if (mode === 'orthographic') {
      this._wDistanceSaved = this._wDistance;
      this._wDistance = 1e9;
    } else if (this._wDistanceSaved != null) {
      this._wDistance = this._wDistanceSaved;
    }
  }

  setWDistance(d) {
    this._wDistance = Math.max(1.1, d);
  }

  setScale(s) {
    this._scale = s;
  }

  setPointSize(size) {
    this._pointSize = size;
    if (this._points) this._points.material.size = size;
  }

  setEdgeOpacity(v) {
    this._edgeOpacityMult = v;
  }

  /**
   * Set rotation speed (rad/s) for one rotation plane by index.
   */
  setRotationSpeed(planeIdx, speedRadPerSec) {
    if (planeIdx >= 0 && planeIdx < this._rotSpeeds.length) {
      this._rotSpeeds[planeIdx] = speedRadPerSec;
    }
  }

  get dim() { return this._dim; }

  // ── Dispose ───────────────────────────────────────────────────────────────

  dispose() {
    if (this._lines) {
      this._scene.remove(this._lines);
      this._lines.geometry.dispose();
      this._lines.material.dispose();
      this._lines = null;
    }
    if (this._points) {
      this._scene.remove(this._points);
      this._points.geometry.dispose();
      this._points.material.dispose();
      this._points = null;
    }
    this._subscribers.clear();
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _hexToRgb(hex) {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}
