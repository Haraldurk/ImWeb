import * as THREE from 'three';
import {
  generate2CellFaces,
  faceCount,
  vertexCount,
  MAX_DIM,
} from './HypercubeGeometry.js';

export class HypercubeFaces {
  constructor(scene) {
    this._scene    = scene;
    this._mesh     = null;
    this._dummy    = new THREE.Object3D();
    this._faces    = generate2CellFaces(MAX_DIM);
    this._maxFaces = faceCount(MAX_DIM);
    this._visible  = true;
    this._opacity  = 0.4;

    this._build();
  }

  _build() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      color:       0xffffff,
      side:        THREE.DoubleSide,
      transparent: true,
      depthWrite:  false,
      blending:    THREE.AdditiveBlending,
      opacity:     this._opacity,
    });

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
    const dummy   = this._dummy;
    const faces   = this._faces;
    const nActive = vertexCount(dim);
    let   drawn   = 0;

    for (let f = 0; f < faces.length; f++) {
      const { corners, axisA, axisB } = faces[f];

      // Cull faces whose spanning axes exceed current dim
      if (axisA >= dim || axisB >= dim) continue;

      // Cull faces referencing inactive vertices
      if (corners.some(ci => ci >= nActive)) continue;

      // Centroid = average of 4 projected corners
      let cx = 0, cy = 0, cz = 0;
      for (const ci of corners) {
        const pi = ci * 3;
        cx += projBuf[pi]     * scale;
        cy += projBuf[pi + 1] * scale;
        cz += projBuf[pi + 2] * scale;
      }
      cx /= 4; cy /= 4; cz /= 4;

      // Size = edge length between first two corners in projected space
      const p0 = corners[0] * 3, p1 = corners[1] * 3;
      const dx = projBuf[p0]     * scale - projBuf[p1]     * scale;
      const dy = projBuf[p0 + 1] * scale - projBuf[p1 + 1] * scale;
      const dz = projBuf[p0 + 2] * scale - projBuf[p1 + 2] * scale;
      const size = Math.sqrt(dx*dx + dy*dy + dz*dz);

      // Two edge vectors for face normal (cross product)
      const p2 = corners[2] * 3;
      const ax = projBuf[p1]     * scale - projBuf[p0]     * scale;
      const ay = projBuf[p1 + 1] * scale - projBuf[p0 + 1] * scale;
      const az = projBuf[p1 + 2] * scale - projBuf[p0 + 2] * scale;
      const bx = projBuf[p2]     * scale - projBuf[p0]     * scale;
      const by = projBuf[p2 + 1] * scale - projBuf[p0 + 1] * scale;
      const bz = projBuf[p2 + 2] * scale - projBuf[p0 + 2] * scale;

      const nx = ay*bz - az*by;
      const ny = az*bx - ax*bz;
      const nz = ax*by - ay*bx;
      const nLen = Math.sqrt(nx*nx + ny*ny + nz*nz);

      dummy.position.set(cx, cy, cz);
      dummy.scale.setScalar(size);

      if (nLen > 1e-6) {
        _zAxis.set(nx/nLen, ny/nLen, nz/nLen);
        dummy.quaternion.setFromUnitVectors(_zUp, _zAxis);
      } else {
        dummy.quaternion.identity();
      }

      dummy.updateMatrix();
      this._mesh.setMatrixAt(drawn, dummy.matrix);
      drawn++;
    }

    // Zero out unused slots
    for (let i = drawn; i < this._maxFaces; i++) {
      this._mesh.setMatrixAt(i, _zeroMatrix);
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.count   = drawn;
    this._mesh.visible = this._visible && drawn > 0;
  }

  setVisible(v) { this._visible = v; }
  setOpacity(v) { this._mesh.material.opacity = v; }

  dispose() {
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mesh.material.dispose();
    this._mesh = null;
  }
}

// Module-level reusable vectors — avoid per-frame allocation
const _zUp       = new THREE.Vector3(0, 0, 1);
const _zAxis     = new THREE.Vector3();
const _zeroMatrix = new THREE.Matrix4();
