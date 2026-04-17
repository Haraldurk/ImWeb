import * as THREE from 'three';
import { vertexCount, MAX_DIM } from './HypercubeGeometry.js';

const MAX_INSTANCES = 4096; // matches MAX_DIM vertex ceiling

export class HypercubeInstancer {
  constructor(scene) {
    this._scene    = scene;
    this._mesh     = null;
    this._mat      = null;
    this._instScale = 0.08;
    this._visible  = false;
    this._opacity  = 0.8;
    this._geoType  = 'sphere';

    this._build(this._geoType);
  }

  _build(geoType) {
    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
      this._mesh = null;
    }

    let geo;
    switch (geoType) {
      case 'box':         geo = new THREE.BoxGeometry(1, 1, 1);             break;
      case 'cone':        geo = new THREE.ConeGeometry(0.5, 1, 8);          break;
      case 'torus':       geo = new THREE.TorusGeometry(0.4, 0.15, 8, 16);  break;
      case 'octahedron':  geo = new THREE.OctahedronGeometry(0.6);          break;
      default:            geo = new THREE.SphereGeometry(0.5, 8, 6);        break;
    }

    if (!this._mat) {
      this._mat = new THREE.MeshStandardMaterial({
        side:       THREE.DoubleSide,
        transparent: true,
        depthWrite: false,
        opacity:    this._opacity,
      });
    }

    this._mesh = new THREE.InstancedMesh(geo, this._mat, MAX_INSTANCES);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._scene.add(this._mesh);
  }

  /**
   * Position one instance per vertex using projected coords from projBuf.
   * projBuf: Float32/64Array [x,y,z, ...] per vertex.
   * dim: active dimension. scale: world scale. instScale: per-instance size.
   */
  update(projBuf, dim, scale, instScale) {
    const count = Math.min(vertexCount(dim), MAX_INSTANCES);
    const s = instScale ?? this._instScale;

    for (let i = 0; i < count; i++) {
      const bi = i * 3;
      _dummy.position.set(
        projBuf[bi]     * scale,
        projBuf[bi + 1] * scale,
        projBuf[bi + 2] * scale,
      );
      _dummy.scale.setScalar(s);
      _dummy.updateMatrix();
      this._mesh.setMatrixAt(i, _dummy.matrix);
    }

    for (let i = count; i < MAX_INSTANCES; i++) {
      this._mesh.setMatrixAt(i, _zeroMatrix);
    }

    this._mesh.instanceMatrix.needsUpdate = true;
    this._mesh.count   = count;
    this._mesh.visible = this._visible && count > 0;
  }

  setVisible(v) {
    this._visible = v;
    if (this._mesh) this._mesh.visible = v;
  }

  setInstanceScale(v) { this._instScale = v; }

  setOpacity(v) {
    this._opacity = v;
    this._mat.opacity = v;
  }

  setGeoType(type) {
    this._geoType = type;
    this._build(type);
  }

  setTexture(tex) {
    this._mat.map = tex;
    this._mat.needsUpdate = true;
  }

  dispose() {
    if (!this._mesh) return;
    this._scene.remove(this._mesh);
    this._mesh.geometry.dispose();
    this._mat.dispose();
    this._mesh = null;
    this._mat  = null;
  }
}

// Module-level reusables — avoid per-frame allocation
const _dummy      = new THREE.Object3D();
const _mat4       = new THREE.Matrix4(); // eslint-disable-line no-unused-vars
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0);
