/**
 * ImWeb 3D Scene Manager
 *
 * Renders a Three.js 3D scene to a WebGLRenderTarget.
 * The resulting texture flows into the compositing pipeline as
 * any other input source — FG, BG, or DisplaceSrc.
 *
 * The depth pass can also be routed to DisplaceSrc for
 * geometry-driven displacement (3D objects distort video).
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
import { STLLoader }  from 'three/addons/loaders/STLLoader.js';
import { GeometryFactory, GEOMETRY_NAMES } from './GeometryFactory.js';

export class SceneManager {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width    = width;
    this.height   = height;
    this.active   = false;

    // Three.js scene
    this.scene    = new THREE.Scene();
    this.camera   = new THREE.PerspectiveCamera(60, width / height, 0.01, 1000);
    this.camera.position.z = 5;

    // Render target — output texture fed to compositing pipeline
    this.target = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });

    // Depth render target — grayscale depth map for use as displacement/key source
    this.depthTarget = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });
    this._depthMat = new THREE.MeshDepthMaterial({
      depthPacking: THREE.BasicDepthPacking,
    });

    // Current mesh
    this.mesh     = null;
    this.material = null;
    this._geoKey  = null;

    // Loaders
    this.gltfLoader = new GLTFLoader();
    this.objLoader  = new OBJLoader();
    this.stlLoader  = new STLLoader();

    // Geometry factory — must be before setGeometry()
    this.geoFactory = new GeometryFactory();

    // Imported model tracking
    this._importedModelName = null;

    // Lights
    this._setupLights();

    // Build default geometry
    this.setGeometry('Sphere');
  }

  // ── Setup ──────────────────────────────────────────────────────────────────

  _setupLights() {
    this.lights = {
      ambient:     new THREE.AmbientLight(0xffffff, 0.4),
      directional: new THREE.DirectionalLight(0xffffff, 1.0),
      point:       new THREE.PointLight(0x4488ff, 0.6, 20),
    };
    this.lights.directional.position.set(3, 5, 3);
    this.lights.point.position.set(-3, 2, -3);
    Object.values(this.lights).forEach(l => this.scene.add(l));
  }

  // ── Geometry ───────────────────────────────────────────────────────────────

  setGeometry(name) {
    if (name === this._geoKey) return;
    this._geoKey = name;
    this._importedModelName = null;

    const geo = this.geoFactory.create(name);
    this._replaceMesh(geo);
  }

  _replaceMesh(geo) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }

    if (!this.material) {
      this.material = new THREE.MeshStandardMaterial({
        color:     0x8888cc,
        roughness: 0.5,
        metalness: 0.1,
      });
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  // ── Model import ───────────────────────────────────────────────────────────

  async loadGLTF(url, name = '') {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, gltf => {
        const model = gltf.scene;
        this._fitToView(model);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = model;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(model);
        resolve(model);
      }, undefined, reject);
    });
  }

  async loadOBJ(url, name = '') {
    return new Promise((resolve, reject) => {
      this.objLoader.load(url, obj => {
        this._fitToView(obj);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = obj;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(obj);
        resolve(obj);
      }, undefined, reject);
    });
  }

  async loadSTL(url, name = '') {
    return new Promise((resolve, reject) => {
      this.stlLoader.load(url, geo => {
        const mesh = new THREE.Mesh(geo, this.material ?? new THREE.MeshStandardMaterial({ color: 0x8888cc }));
        this._fitToView(mesh);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = mesh;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(mesh);
        resolve(mesh);
      }, undefined, reject);
    });
  }

  /**
   * Load a 3D model from a File object, routing by extension.
   */
  async loadModel(file) {
    const url = URL.createObjectURL(file);
    const ext = file.name.split('.').pop().toLowerCase();
    try {
      if (ext === 'glb' || ext === 'gltf') return await this.loadGLTF(url, file.name);
      if (ext === 'obj')                   return await this.loadOBJ(url, file.name);
      if (ext === 'stl')                   return await this.loadSTL(url, file.name);
      throw new Error(`Unsupported format: .${ext}`);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  _fitToView(obj) {
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 2 / maxDim;
    obj.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    obj.position.sub(center.multiplyScalar(scale));
  }

  // ── Parameter-driven updates ───────────────────────────────────────────────

  applyParams(params, dt = 0, inputs = {}) {
    const p = params;

    // Geometry selection — skip when a model is imported (only apply on change)
    const geoIdx = p.get('scene3d.geo').value;
    if (!this._importedModelName) {
      this.setGeometry(GEOMETRY_NAMES[geoIdx] ?? 'Sphere');
    }

    if (!this.mesh) return;

    // Transform
    const toRad = Math.PI / 180;
    // Auto-spin: accumulate rotation over time
    const spinX = p.get('scene3d.spin.x')?.value ?? 0;
    const spinY = p.get('scene3d.spin.y')?.value ?? 0;
    const spinZ = p.get('scene3d.spin.z')?.value ?? 0;
    if (spinX !== 0 || spinY !== 0 || spinZ !== 0) {
      this.mesh.rotation.x += spinX * toRad * dt;
      this.mesh.rotation.y += spinY * toRad * dt;
      this.mesh.rotation.z += spinZ * toRad * dt;
    } else {
      this.mesh.rotation.x = p.get('scene3d.rot.x').value * toRad;
      this.mesh.rotation.y = p.get('scene3d.rot.y').value * toRad;
      this.mesh.rotation.z = p.get('scene3d.rot.z').value * toRad;
    }
    this.mesh.position.x = p.get('scene3d.pos.x').value;
    this.mesh.position.y = p.get('scene3d.pos.y').value;
    this.mesh.position.z = p.get('scene3d.pos.z').value;
    const s = p.get('scene3d.scale').value;
    this.mesh.scale.setScalar(s);

    // Material
    if (this.material) {
      const hue = (p.get('scene3d.mat.hue')?.value ?? 240) / 360;
      const sat = (p.get('scene3d.mat.sat')?.value ?? 50) / 100;
      this.material.color.setHSL(hue, sat, 0.5);
      this.material.emissive.setHSL(hue, sat, 0.15 * (p.get('scene3d.mat.emissive')?.value ?? 0));
      this.material.roughness = p.get('scene3d.mat.roughness').value;
      this.material.metalness = p.get('scene3d.mat.metalness').value;
      this.material.emissiveIntensity = p.get('scene3d.mat.emissive').value;
      this.material.opacity  = p.get('scene3d.mat.opacity').value;
      this.material.transparent = this.material.opacity < 1;
      const wireframe = !!p.get('scene3d.wireframe').value;
      this.material.wireframe = wireframe;
      // Also apply wireframe to any imported model's sub-meshes
      if (this._importedModelName && this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material && child.material !== this.material) {
            child.material.wireframe = wireframe;
          }
        });
      }

      // Live texture source on mesh surface
      const texSrcIdx = p.get('scene3d.mat.texsrc')?.value ?? 0;
      const texSrcMap = [null, inputs.camera, inputs.movie, inputs.screen, inputs.draw, inputs.buffer];
      const liveTex = texSrcMap[texSrcIdx] ?? null;
      if (liveTex !== this._liveTex) {
        this._liveTex = liveTex;
        this.material.map = liveTex
          ? Object.assign(liveTex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping })
          : null;
      }
      this.material.needsUpdate = true;
    }

    // Camera
    this.camera.fov = p.get('scene3d.cam.fov').value;
    this.camera.position.set(
      p.get('scene3d.cam.x').value,
      p.get('scene3d.cam.y').value,
      p.get('scene3d.cam.z').value
    );
    this.camera.lookAt(this.mesh.position);
    this.camera.updateProjectionMatrix();

    // Light
    this.lights.directional.intensity = p.get('scene3d.light.intensity').value;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  render(params, dt = 0, inputs = {}) {
    this.applyParams(params, dt, inputs);
    const prev = this.renderer.getRenderTarget();

    // Color pass
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);

    // Depth pass — only when scene3d.depth.active is set, to avoid wasting GPU
    if (params.get('scene3d.depth.active')?.value) {
      this.scene.overrideMaterial = this._depthMat;
      this.renderer.setRenderTarget(this.depthTarget);
      this.renderer.render(this.scene, this.camera);
      this.scene.overrideMaterial = null;
    }

    this.renderer.setRenderTarget(prev);
  }

  get texture()      { return this.target.texture; }
  get depthTexture() { return this.depthTarget.texture; }
  get importedModelName() { return this._importedModelName; }

  resize(w, h) {
    this.width = w; this.height = h;
    this.target.setSize(w, h);
    this.depthTarget.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.target.dispose();
    this.depthTarget.dispose();
    this._depthMat.dispose();
    this.scene.traverse(obj => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) obj.material.dispose();
    });
  }
}
