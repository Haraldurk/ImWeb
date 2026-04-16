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
  rotationPlaneCount,
  defaultRotationSpeeds,
  vertexCount,
  edgeCount,
  createMorphState,
  morphStep,
  edgeOpacity,
} from './HypercubeGeometry.js';
import { HypercubeFaces } from './HypercubeFaces.js';

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
    // Generated once at MAX_DIM — never reallocated
    this._vertices = generateVertices(MAX_DIM);
    this._edges    = generateEdges(MAX_DIM);

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

    // Permanent buffers — allocated once at MAX_DIM capacity, never reallocated
    const maxEdges = edgeCount(MAX_DIM);
    const maxVerts = vertexCount(MAX_DIM);
    this._linePosBuf = new Float32Array(maxEdges * 6);
    this._lineColBuf = new Float32Array(maxEdges * 6);

    // Quad buffers — 4 verts per edge, 2 triangles per edge
    this._quadEndABuf  = new Float32Array(maxEdges * 4 * 3);  // 4 verts × A.xyz
    this._quadEndBBuf  = new Float32Array(maxEdges * 4 * 3);  // 4 verts × B.xyz
    this._quadColBuf   = new Float32Array(maxEdges * 4 * 3);  // 4 verts × [r g b]
    this._quadSideBuf  = new Float32Array(maxEdges * 4);      // 4 verts × side (+1/-1)
    this._quadIndexBuf = new Uint32Array(maxEdges * 6);       // 2 tris × 3 indices

    // Index buffer — fixed topology, build once
    for (let e = 0; e < maxEdges; e++) {
      const vi = e * 4;
      const ii = e * 6;
      this._quadIndexBuf[ii]     = vi;
      this._quadIndexBuf[ii + 1] = vi + 1;
      this._quadIndexBuf[ii + 2] = vi + 2;
      this._quadIndexBuf[ii + 3] = vi + 2;
      this._quadIndexBuf[ii + 4] = vi + 1;
      this._quadIndexBuf[ii + 5] = vi + 3;
    }

    // Side buffer — fixed (+1 = +extrude, -1 = -extrude), build once
    for (let e = 0; e < maxEdges; e++) {
      const vi = e * 4;
      this._quadSideBuf[vi]     =  1.0;  // vert 0: A end, +extrude
      this._quadSideBuf[vi + 1] =  1.0;  // vert 1: B end, +extrude
      this._quadSideBuf[vi + 2] = -1.0;  // vert 2: A end, -extrude
      this._quadSideBuf[vi + 3] = -1.0;  // vert 3: B end, -extrude
    }
    this._ptPosBuf   = new Float32Array(maxVerts * 3);
    this._ptColBuf   = new Float32Array(maxVerts * 3);

    // Zero-allocation projection buffers
    this._projBuf          = new Float64Array(maxVerts * 3); // flat xyz output per vertex
    this._scratchCoords    = new Float64Array(MAX_DIM);      // single-vertex scratch
    this._morphFromProjBuf = new Float64Array(maxVerts * 3); // from-projection during morph
    this._morphToProjBuf   = new Float64Array(maxVerts * 3); // to-projection during morph

    // Edge/point colors only change on dim, edgeOpacity or morph events — flag
    // gates color writes + GPU upload to skip ~half the per-frame bandwidth.
    this._colorsDirty = true;
    this._edgeWidth = 1.5;

    // Pre-computed RGB color table — eliminates _hexToRgb() per-frame allocations
    this._colorTable = new Float32Array(DIMENSION_COLORS.length * 3);
    for (let _i = 0; _i < DIMENSION_COLORS.length; _i++) {
      const _h = DIMENSION_COLORS[_i];
      this._colorTable[_i * 3]     = parseInt(_h.slice(1, 3), 16) / 255;
      this._colorTable[_i * 3 + 1] = parseInt(_h.slice(3, 5), 16) / 255;
      this._colorTable[_i * 3 + 2] = parseInt(_h.slice(5, 7), 16) / 255;
    }

    this._rebuild();
    this._hFaces = new HypercubeFaces(scene);
  }

  // ── Internal rebuild ──────────────────────────────────────────────────────

  _rebuild() {
    // vertices and edges are permanent MAX_DIM arrays — no regeneration needed

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

    this._colorsDirty = true;
    this._rebuildGeometry();
  }

  _rebuildGeometry() {
    // ShaderMaterial created once
    if (!this._pointMat) {
      this._pointMat = new THREE.ShaderMaterial({
        uniforms: { opacity: { value: 0.8 }, uPointSize: { value: this._pointSize } },
        vertexShader: `
          attribute vec3 color;
          varying vec3 vColor;
          uniform float uPointSize;
          void main() {
            vColor = color;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * mv;
            gl_PointSize = uPointSize * (60.0 / max(-mv.z, 0.1));
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          uniform float opacity;
          void main() {
            vec2 uv = gl_PointCoord - vec2(0.5);
            if (length(uv) > 0.5) discard;
            gl_FragColor = vec4(vColor, opacity);
          }
        `,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
    }

    if (this._lines) {
      // Buffers permanent at MAX_DIM. Edges aren't sorted by dimAxis, so we
      // must always draw the full range and rely on the cull-zero in
      // _updateBuffers to hide inactive edges.
      this._lines.geometry.setDrawRange(0, edgeCount(MAX_DIM) * 6);
    } else {
      const quadGeo = new THREE.BufferGeometry();
      quadGeo.setAttribute('aEndA', new THREE.BufferAttribute(this._quadEndABuf, 3));
      quadGeo.setAttribute('aEndB', new THREE.BufferAttribute(this._quadEndBBuf, 3));
      quadGeo.setAttribute('aSide', new THREE.BufferAttribute(this._quadSideBuf, 1));
      quadGeo.setAttribute('color', new THREE.BufferAttribute(this._quadColBuf,  3));
      quadGeo.setIndex(new THREE.BufferAttribute(this._quadIndexBuf, 1));
      quadGeo.setDrawRange(0, edgeCount(MAX_DIM) * 6);

      const lineMat = new THREE.ShaderMaterial({
        transparent: true,
        depthWrite:  false,
        blending:    THREE.AdditiveBlending,
        side:        THREE.DoubleSide,
        uniforms: {
          uEdgeWidth:  { value: 1.5 },
          uResolution: { value: new THREE.Vector2(800, 600) },
        },
        vertexShader: `
          attribute vec3 aEndA;
          attribute vec3 aEndB;
          attribute float aSide;
          attribute vec3 color;
          varying vec3 vColor;
          uniform float uEdgeWidth;
          uniform vec2 uResolution;
          void main() {
            vColor = color;
            vec4 clipA = projectionMatrix * modelViewMatrix * vec4(aEndA, 1.0);
            vec4 clipB = projectionMatrix * modelViewMatrix * vec4(aEndB, 1.0);
            vec2 ndcA = clipA.xy / clipA.w;
            vec2 ndcB = clipB.xy / clipB.w;
            // Skip degenerate edges (collapsed / culled to origin)
            vec2 delta = (ndcB - ndcA) * uResolution;
            if (dot(delta, delta) < 1e-6) {
              gl_Position = vec4(2.0, 0.0, 0.0, 1.0); // off-screen
              return;
            }
            vec2 dir  = normalize(delta);
            vec2 perp = vec2(-dir.y, dir.x);
            // gl_VertexID mod 2: 0 = A endpoint, 1 = B endpoint
            float tB = mod(float(gl_VertexID), 2.0);
            vec4 clipPos = tB < 0.5 ? clipA : clipB;
            // aSide drives extrusion direction (+1 / -1)
            vec2 offset = perp * aSide * uEdgeWidth / uResolution;
            clipPos.xy += offset * clipPos.w;
            gl_Position = clipPos;
          }
        `,
        fragmentShader: `
          varying vec3 vColor;
          void main() {
            gl_FragColor = vec4(vColor, 1.0);
          }
        `,
      });
      this._lines = new THREE.Mesh(quadGeo, lineMat);
      this._lineMat = lineMat;
      this._lines.frustumCulled = false;
      this._scene.add(this._lines);
    }

    if (this._points) {
      this._points.geometry.setDrawRange(0, vertexCount(this._dim));
    } else {
      const ptGeo = new THREE.BufferGeometry();
      ptGeo.setAttribute('position', new THREE.BufferAttribute(this._ptPosBuf, 3));
      ptGeo.setAttribute('color',    new THREE.BufferAttribute(this._ptColBuf, 3));
      this._points = new THREE.Points(ptGeo, this._pointMat);
      this._points.frustumCulled = false;
      this._scene.add(this._points);
    }

    this._updateVisibility();
  }

  /**
   * Zero-allocation projection: rotates and perspective-projects every active vertex
   * into outBuf as flat [x0,y0,z0, x1,y1,z1, ...] Float64 values.
   */
  _projectInPlace(vertices, dim, rotAngles, wDistance, outBuf) {
    const scratch = this._scratchCoords;
    const nVerts  = vertexCount(dim);
    for (let vi = 0; vi < nVerts; vi++) {
      const v = vertices[vi];
      // Copy active coords into scratch
      for (let d = 0; d < dim; d++) scratch[d] = v[d];
      // Apply all Givens rotation planes (inlined for zero call overhead)
      let planeIdx = 0;
      for (let i = 0; i < dim; i++) {
        for (let j = i + 1; j < dim; j++) {
          const angle = rotAngles[planeIdx++] ?? 0;
          const c = Math.cos(angle), s = Math.sin(angle);
          const xi = scratch[i], xj = scratch[j];
          scratch[i] =  c * xi - s * xj;
          scratch[j] =  s * xi + c * xj;
        }
      }
      // Perspective project dim → 3 (in-place on scratch)
      for (let d = dim - 1; d >= 3; d--) {
        const scale = wDistance / (wDistance - scratch[d]);
        for (let k = 0; k < d; k++) scratch[k] *= scale;
      }
      // Write result
      outBuf[vi * 3]     = scratch[0];
      outBuf[vi * 3 + 1] = scratch[1];
      outBuf[vi * 3 + 2] = scratch[2];
    }
  }

  _updateVisibility() {
    if (this._lines)  this._lines.visible  = this._renderMode !== 'points';
    if (this._points) this._points.visible = this._renderMode !== 'wireframe';
  }

  // ── Update ────────────────────────────────────────────────────────────────

  update(deltaMs) {
    // Skip all CPU work if not visible — avoids 12D projection
    // cost when hypercube is not the active scene source
    if (this._lines && !this._lines.visible &&
        this._points && !this._points.visible) return;
    const dt = deltaMs / 1000;

    // Advance morph
    if (this._morphState) {
      if (!this._morphState.done) {
        morphStep(this._morphState, deltaMs);
      }
      if (this._morphState.done) {
        if (this._morphState.toDim < this._morphState.fromDim) {
          this._rebuild();
        }
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

    // Project — zero-allocation path
    if (this._morphState && this._morphFromVertices) {
      this._projectMorphInterp();
    } else {
      this._projectInPlace(this._vertices, this._dim, this._rotAngles, this._wDistance, this._projBuf);
    }

    this._updateBuffers();
    this._hFaces.update(this._projBuf, this._dim, this._scale);
    this._notifySubscribers();
  }

  _projectMorphInterp() {
    // fromAngles may be longer than fromDim needs — _projectInPlace only reads
    // rotationPlaneCount(fromDim) entries, so passing the full array is safe.
    const fromAngles = this._morphFromAngles ?? this._rotAngles;
    this._projectInPlace(this._morphFromVertices, this._morphFromDim, fromAngles,    this._wDistance, this._morphFromProjBuf);
    this._projectInPlace(this._vertices,          this._dim,          this._rotAngles, this._wDistance, this._morphToProjBuf);

    const t         = this._morphState.t;
    const mt        = 1 - t;
    const fromCount = vertexCount(this._morphFromDim);
    const toCount   = vertexCount(this._dim);
    const count     = Math.min(fromCount, toCount);

    for (let i = 0; i < count; i++) {
      const bi = i * 3;
      this._projBuf[bi]     = this._morphFromProjBuf[bi]     * mt + this._morphToProjBuf[bi]     * t;
      this._projBuf[bi + 1] = this._morphFromProjBuf[bi + 1] * mt + this._morphToProjBuf[bi + 1] * t;
      this._projBuf[bi + 2] = this._morphFromProjBuf[bi + 2] * mt + this._morphToProjBuf[bi + 2] * t;
    }
    for (let i = count; i < toCount; i++) {
      const bi = i * 3;
      this._projBuf[bi]     = this._morphToProjBuf[bi];
      this._projBuf[bi + 1] = this._morphToProjBuf[bi + 1];
      this._projBuf[bi + 2] = this._morphToProjBuf[bi + 2];
    }
  }

  _updateBuffers() {
    const s             = this._scale;
    const projBuf       = this._projBuf;
    const edges         = this._edges;
    const colorTable    = this._colorTable;
    const colLen        = colorTable.length / 3 | 0;
    const nActiveVerts  = vertexCount(this._dim);
    const writeColors   = this._colorsDirty;

    // ── Line buffer ───────────────────────────────────────────────────────
    const lp = this._linePosBuf;
    const lc = this._lineColBuf;

    for (let e = 0; e < edges.length; e++) {
      const [a, b, dimAxis] = edges[e];
      const base = e * 6;
      // Cull edges that belong to inactive dimensions OR reference vertex
      // indices outside the active vertex set (stale projBuf data otherwise).
      if (dimAxis >= this._dim || a >= nActiveVerts || b >= nActiveVerts) {
        lp[base] = lp[base+1] = lp[base+2] = 0;
        lp[base+3] = lp[base+4] = lp[base+5] = 0;
        if (writeColors) {
          lc[base] = lc[base+1] = lc[base+2] = 0;
          lc[base+3] = lc[base+4] = lc[base+5] = 0;
        }
        continue;
      }
      const ai = a * 3, bi = b * 3;
      lp[base]     = projBuf[ai]     * s; lp[base + 1] = projBuf[ai + 1] * s; lp[base + 2] = projBuf[ai + 2] * s;
      lp[base + 3] = projBuf[bi]     * s; lp[base + 4] = projBuf[bi + 1] * s; lp[base + 5] = projBuf[bi + 2] * s;

      if (writeColors) {
        const ci = Math.min(dimAxis, colLen - 1) * 3;
        const op = edgeOpacity(dimAxis, this._dim) * this._edgeOpacityMult;
        const cr = colorTable[ci] * op, cg = colorTable[ci + 1] * op, cb = colorTable[ci + 2] * op;
        lc[base]     = cr; lc[base + 1] = cg; lc[base + 2] = cb;
        lc[base + 3] = cr; lc[base + 4] = cg; lc[base + 5] = cb;
      }
    }

    // ── Quad buffer (screen-space width mesh) ────────────────────────────
    const qa = this._quadEndABuf;
    const qb = this._quadEndBBuf;
    const qc = this._quadColBuf;

    for (let e = 0; e < edges.length; e++) {
      const [a, b, dimAxis] = edges[e];
      const base6 = e * 6;
      if (dimAxis >= this._dim || a >= nActiveVerts || b >= nActiveVerts) {
        // Culled edge — zero all quad verts so the degenerate quad clips cleanly
        for (let v = 0; v < 4; v++) {
          const qi3 = (e * 4 + v) * 3;
          qa[qi3] = qa[qi3+1] = qa[qi3+2] = 0;
          qb[qi3] = qb[qi3+1] = qb[qi3+2] = 0;
          if (writeColors) { qc[qi3] = qc[qi3+1] = qc[qi3+2] = 0; }
        }
        continue;
      }
      const ax = lp[base6],     ay = lp[base6+1], az = lp[base6+2];
      const bx = lp[base6+3],   by = lp[base6+4], bz = lp[base6+5];
      for (let v = 0; v < 4; v++) {
        const qi3 = (e * 4 + v) * 3;
        qa[qi3] = ax; qa[qi3+1] = ay; qa[qi3+2] = az;
        qb[qi3] = bx; qb[qi3+1] = by; qb[qi3+2] = bz;
        if (writeColors) {
          qc[qi3]   = lc[base6];
          qc[qi3+1] = lc[base6+1];
          qc[qi3+2] = lc[base6+2];
        }
      }
    }

    this._lines.geometry.attributes.aEndA.needsUpdate = true;
    this._lines.geometry.attributes.aEndB.needsUpdate = true;
    if (writeColors) this._lines.geometry.attributes.color.needsUpdate = true;

    // ── Point buffer ──────────────────────────────────────────────────────
    const pp  = this._ptPosBuf;
    const pc  = this._ptColBuf;
    const nVerts = nActiveVerts;

    if (writeColors) {
      const dci = Math.min(this._dim - 1, colLen - 1) * 3;
      const dcr = colorTable[dci], dcg = colorTable[dci + 1], dcb = colorTable[dci + 2];
      for (let i = 0; i < nVerts; i++) {
        const pi = i * 3;
        pp[pi]     = projBuf[pi]     * s;
        pp[pi + 1] = projBuf[pi + 1] * s;
        pp[pi + 2] = projBuf[pi + 2] * s;
        pc[pi]     = dcr;
        pc[pi + 1] = dcg;
        pc[pi + 2] = dcb;
      }
    } else {
      for (let i = 0; i < nVerts; i++) {
        const pi = i * 3;
        pp[pi]     = projBuf[pi]     * s;
        pp[pi + 1] = projBuf[pi + 1] * s;
        pp[pi + 2] = projBuf[pi + 2] * s;
      }
    }

    this._points.geometry.attributes.position.needsUpdate = true;
    if (writeColors) this._points.geometry.attributes.color.needsUpdate = true;

    if (writeColors) this._colorsDirty = false;
    if (this._lineMat) {
      this._lineMat.uniforms.uEdgeWidth.value = this._edgeWidth ?? 1.5;
    }
  }

  _notifySubscribers() {
    if (this._subscribers.size === 0) return;
    const s = this._scale;
    for (const [vi, callbacks] of this._subscribers) {
      const pi = vi * 3;
      const wx = this._projBuf[pi] * s, wy = this._projBuf[pi + 1] * s, wz = this._projBuf[pi + 2] * s;
      for (const cb of callbacks) cb(wx, wy, wz);
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
    this._morphFromVertices = this._vertices;
    this._morphFromAngles   = this._rotAngles.slice();

    // Switch to target dimension
    this._dim = toDim;
    // For upward morphs: rebuild immediately so new geometry exists during animation
    // For downward morphs: keep old geometry, defer rebuild to avoid ghost doubling
    if (toDim > this._morphFromDim) {
      this._rebuild();
    }
    // dim changed → edge colors and dim cull mask must be rewritten next frame
    this._colorsDirty = true;
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

  setVisible(visible) {
    if (this._lines)  this._lines.visible  = visible && this._renderMode !== 'points';
    if (this._points) this._points.visible = visible && this._renderMode !== 'wireframe';
  }

  setPointSize(size) {
    this._pointSize = size;
    if (this._pointMat && this._pointMat.uniforms) {
      this._pointMat.uniforms.uPointSize.value = size;
    }
  }

  setEdgeOpacity(v) {
    this._edgeOpacityMult = v;
    this._colorsDirty = true;
  }

  setEdgeWidth(w) {
    this._edgeWidth = Math.max(0.5, Math.min(8.0, w));
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
    if (this._hFaces) { this._hFaces.dispose(); this._hFaces = null; }
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
