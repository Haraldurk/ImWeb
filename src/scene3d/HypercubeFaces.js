import * as THREE from 'three';
import {
  generate2CellFaces,
  generateVertices,
  faceCount,
  MAX_DIM,
} from './HypercubeGeometry.js';

export class HypercubeFaces {
  constructor(scene) {
    this._scene    = scene;
    this._mesh     = null;
    // Pre-generate faces and vertices per dimension — no per-frame culling needed
    this._facesByDim = {};
    this._vertsByDim = {};
    for (let d = 2; d <= MAX_DIM; d++) {
      this._facesByDim[d] = generate2CellFaces(d);
      this._vertsByDim[d] = generateVertices(d);
    }
    this._maxFaces = faceCount(MAX_DIM);
    this._visible  = false; // hidden until explicitly enabled
    this._opacity  = 0.5;   // matches ps default hypercube.faces.opacity

    this._build();
  }

  _build() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.ShaderMaterial({
      side:        THREE.DoubleSide,
      transparent: true,
      depthWrite:  false,
      depthTest:   false,   // faces are transparent overlays — never occlude/get occluded by 3D geometry
      blending:    THREE.NormalBlending,
      uniforms: {
        uFaceTexture: { value: null },
        uOpacity:     { value: this._opacity },
        uHasTexture:  { value: 0.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          // Apply per-instance transform (world-space face quad placement).
          // instanceMatrix is injected by Three.js for InstancedMesh.
          #ifdef USE_INSTANCING
            gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
          #else
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          #endif
        }
      `,
      fragmentShader: `
        uniform sampler2D uFaceTexture;
        uniform float uOpacity;
        uniform float uHasTexture;
        varying vec2 vUv;
        void main() {
          vec4 col = uHasTexture > 0.5
            ? texture2D(uFaceTexture, vUv)
            : vec4(1.0);
          gl_FragColor = vec4(col.rgb, col.a * uOpacity);
        }
      `,
    });
    this._mat = mat;

    this._mesh = new THREE.InstancedMesh(geo, mat, this._maxFaces);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false; // hidden until first update
    this._scene.add(this._mesh);
  }

  /**
   * Update instance matrices from the projected vertex buffer.
   * projBuf: Float32/64Array of [x,y,z, x,y,z, ...] for each vertex.
   * dim: current active dimension.
   * scale: current scale factor.
   */
  update(projBuf, dim, scale) {
    const faces  = this._facesByDim[dim] ?? [];
    const verts  = this._vertsByDim[dim] ?? [];
    let   drawn  = 0;

    for (let f = 0; f < faces.length; f++) {
      const { corners, axisA, axisB } = faces[f];

      // Sort corners by (axisA, axisB) N-D coords into consistent winding
      const sorted = [...corners].sort((i, j) => {
        const va = verts[i], vb = verts[j];
        if (va[axisA] !== vb[axisA]) return va[axisA] - vb[axisA];
        return va[axisB] - vb[axisB];
      });
      // sorted: [(-1,-1), (-1,+1), (+1,-1), (+1,+1)]
      // Rearrange to winding order: c0=(-1,-1) c1=(+1,-1) c2=(-1,+1)
      const c0 = sorted[0], c1 = sorted[2], c2 = sorted[1];

      const get = (ci) => {
        const pi = ci * 3;
        return [projBuf[pi]*scale, projBuf[pi+1]*scale, projBuf[pi+2]*scale];
      };
      const v0 = get(c0), v1 = get(c1), v2 = get(c2);

      // Centroid of all 4 corners
      const v3 = get(sorted[3]);
      const cx = (v0[0]+v1[0]+v2[0]+v3[0])/4;
      const cy = (v0[1]+v1[1]+v2[1]+v3[1])/4;
      const cz = (v0[2]+v1[2]+v2[2]+v3[2])/4;

      // Tangent = v1 - v0 (adjacent edge, length carries X scale)
      const tx = v1[0]-v0[0], ty = v1[1]-v0[1], tz = v1[2]-v0[2];
      const tLen = Math.sqrt(tx*tx + ty*ty + tz*tz);
      if (tLen < 1e-6) continue;

      // Bitangent = v2 - v0 (adjacent edge, length carries Y scale)
      const bx = v2[0]-v0[0], by = v2[1]-v0[1], bz = v2[2]-v0[2];

      // Normal = tangent × bitangent (normalised — only orientation)
      const nx = ty*bz - tz*by;
      const ny = tz*bx - tx*bz;
      const nz = tx*by - ty*bx;
      const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);
      if (nLen < 1e-6) continue;

      // Matrix: tangent/bitangent columns carry scale, normal column normalised
      // PlaneGeometry spans [-0.5,0.5] in local X/Y so tLen maps to face width
      _mat4.set(
        tx,        bx,        nx/nLen,  cx,
        ty,        by,        ny/nLen,  cy,
        tz,        bz,        nz/nLen,  cz,
        0,         0,         0,        1
      );
      this._mesh.setMatrixAt(drawn, _mat4);
      drawn++;
    }

    for (let i = drawn; i < this._maxFaces; i++) {
      this._mesh.setMatrixAt(i, _zeroMatrix);
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.count   = drawn;
    this._mesh.visible = this._visible && drawn > 0;
  }

  setVisible(v) { this._visible = v; }

  setOpacity(v) {
    this._opacity = v;
    this._mat.uniforms.uOpacity.value = v;
  }

  setFaceTexture(tex) {
    this._mat.uniforms.uFaceTexture.value = tex;
    this._mat.uniforms.uHasTexture.value  = tex ? 1.0 : 0.0;
  }

  dispose() {
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh = null;
  }
}

// Module-level reusable matrices — avoid per-frame allocation
const _mat4       = new THREE.Matrix4();
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
