import * as THREE from 'three';
import { vertexCount, MAX_DIM } from './HypercubeGeometry.js';

const MAX_INSTANCES = 4096; // matches MAX_DIM vertex ceiling

export class HypercubeInstancer {
  constructor(scene) {
    this._scene    = scene;
    this._mesh     = null;
    this._mat      = null;
    this._matType  = -1;
    this._liveTex  = null;
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
      case 'cone':        geo = new THREE.ConeGeometry(0.5, 1, 16);         break;
      case 'torus':       geo = new THREE.TorusGeometry(0.4, 0.18, 16, 32); break;
      case 'octahedron':  geo = new THREE.OctahedronGeometry(0.5, 1);       break;
      default:            geo = new THREE.SphereGeometry(0.5, 24, 16);      break;
    }

    if (!this._mat) {
      this._mat = new THREE.MeshStandardMaterial({
        side:        THREE.DoubleSide,
        transparent: true,
        depthWrite:  false,
        opacity:     this._opacity,
      });
      this._matType = 0;
    }

    this._mesh = new THREE.InstancedMesh(geo, this._mat, MAX_INSTANCES);
    this._mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this._mesh.frustumCulled = false;
    this._mesh.visible = false;
    this._scene.add(this._mesh);
  }

  _rebuildMat(type) {
    if (this._matType === type) return;
    this._matType = type;
    const old      = this._mat;
    const color    = old?.color?.clone()    ?? new THREE.Color(0xffffff);
    const roughness = old?.roughness        ?? 0.5;
    const metalness = old?.metalness        ?? 0.0;
    const opacity   = old?.opacity          ?? this._opacity;
    const emissive  = old?.emissive?.clone() ?? new THREE.Color(0x000000);
    const emissiveMap = old?.emissiveMap    ?? null;
    const map       = old?.map              ?? null;

    const shared = { color, roughness, metalness, side: THREE.DoubleSide, transparent: true, depthWrite: false };
    const mat = type === 1
      ? new THREE.MeshPhysicalMaterial(shared)
      : new THREE.MeshStandardMaterial(shared);
    mat.opacity     = opacity;
    mat.map         = map;
    mat.emissiveMap = emissiveMap;
    mat.emissive.copy(emissive);

    if (old) old.dispose();
    this._mat = mat;
    if (this._mesh) this._mesh.material = mat;
    mat.needsUpdate = true;
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

  getMesh() { return this._mesh; }

  _dead() {
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
    this._mat.map           = tex;
    this._mat.emissiveMap   = tex;
    this._mat.emissive.set(1, 1, 1);
    this._mat.emissiveIntensity = 1.0;
    this._mat.needsUpdate   = true;
  }

  applyParams(p, inputs, renderTarget) {
    const matType = Math.round(p.get('scene3d.mat.type')?.value ?? 0);
    if (matType !== this._matType) this._rebuildMat(matType);
    if (this._mesh) this._mat = this._mesh.material; // defensive sync after potential rebuild

    const hue = (p.get('scene3d.mat.hue')?.value ?? 240) / 360;
    const sat = (p.get('scene3d.mat.sat')?.value ?? 50) / 100;
    if (this._mat.color) this._mat.color.setHSL(hue, sat, sat > 0 ? 0.5 : 1.0);

    const emissiveAmt = p.get('scene3d.mat.emissive')?.value ?? 0;
    const emHue = (p.get('scene3d.mat.emissiveHue')?.value ?? 0) / 360;
    const emSat = (p.get('scene3d.mat.emissiveSat')?.value ?? 0) / 100;
    if (this._mat.emissive) {
      const useIndep = emSat > 0;
      this._mat.emissive.setHSL(
        useIndep ? emHue : hue,
        useIndep ? emSat : sat,
        0.15 * emissiveAmt,
      );
      this._mat.emissiveIntensity = emissiveAmt;
      // emissiveMap needs a non-black emissive color and intensity ≥ 1 to show
      if (this._mat.emissiveMap) {
        this._mat.emissive.set(1, 1, 1);
        if (this._mat.emissiveIntensity < 1.0) this._mat.emissiveIntensity = 1.0;
      }
    }

    if (this._mat.roughness !== undefined) this._mat.roughness = p.get('scene3d.mat.roughness').value;
    if (this._mat.metalness !== undefined) this._mat.metalness = p.get('scene3d.mat.metalness').value;

    const opacity = p.get('scene3d.mat.opacity').value;
    this._mat.opacity     = opacity;
    this._mat.transparent = opacity < 1;

    if (matType === 1 && this._mat.isMeshPhysicalMaterial) {
      this._mat.clearcoat    = p.get('scene3d.mat.clearcoat')?.value ?? 0;
      this._mat.transmission = p.get('scene3d.mat.transmit')?.value  ?? 0;
      this._mat.ior          = p.get('scene3d.mat.ior')?.value        ?? 1.5;
      this._mat.transparent  = this._mat.transmission > 0 || opacity < 1;
    }

    // Texture source — mirrors SceneManager texSrc logic
    const texSrcIdx = p.get('scene3d.mat.texsrc')?.value ?? 0;
    const texSrcMap = [null, inputs.camera, inputs.movie, inputs.screen, inputs.draw, inputs.buffer, inputs.noise];
    const liveTex   = texSrcMap[texSrcIdx] ?? null;
    const useTex    = (liveTex && renderTarget && liveTex === renderTarget.texture) ? null : liveTex;
    if (useTex !== this._liveTex) {
      this._liveTex         = useTex;
      this._mat.map         = useTex
        ? Object.assign(useTex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping })
        : null;
      this._mat.emissiveMap = useTex;
      if (useTex) this._mat.emissive.set(1, 1, 1);
    }

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
