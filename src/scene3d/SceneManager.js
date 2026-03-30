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
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OBJLoader }  from 'three/addons/loaders/OBJLoader.js';
import { STLLoader }  from 'three/addons/loaders/STLLoader.js';
import { ColladaLoader } from 'three/addons/loaders/ColladaLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { GeometryFactory, GEOMETRY_NAMES } from './GeometryFactory.js';

export class SceneManager {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width    = width;
    this.height   = height;
    this.active   = false;

    // Three.js scene
    this.scene    = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020205); // Very dark blue instead of pure black
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
    this._normalMat = new THREE.MeshNormalMaterial();

    // Current mesh
    this.mesh     = null;
    this.material = null;
    this._geoKey  = null;

    // Loaders
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
    
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);

    this.objLoader  = new OBJLoader();
    this.stlLoader  = new STLLoader();
    this.colladaLoader = new ColladaLoader();

    // Geometry factory — must be before setGeometry()
    this.geoFactory = new GeometryFactory();

    // Imported model tracking
    this._importedModelName = null;
    this._importedBaseScale = 1.0;
    this.mixer    = null;
    this.actions  = [];
    this._curAnimIdx = -1;

    // Fallback texture for uWarpMap if null (avoid shader errors)
    const d = new Uint8Array([0, 0, 0, 255]);
    this._fallback = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
    this._fallback.needsUpdate = true;

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
      if (this.mesh.geometry) this.mesh.geometry.dispose();
    }

    if (!this.material) {
      this.material = new THREE.MeshStandardMaterial({
        color:     0xffffff,
        roughness: 0.5,
        metalness: 0.1,
      });
      this._setupMaterial(this.material);
    }

    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  _setupMaterial(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWarpMap = { value: this._fallback };
      shader.uniforms.uWarpAmt = { value: 0 };
      mat._shader = shader;

      shader.vertexShader = `
        uniform sampler2D uWarpMap;
        uniform float uWarpAmt;
        ${shader.vertexShader}
      `.replace(
        '#include <uv_vertex>',
        `
        #include <uv_vertex>
        #ifdef USE_UV
          if (uWarpAmt > 0.0) {
            vec4 warp = texture2D(uWarpMap, vUv);
            vUv += (warp.rg - 0.5) * uWarpAmt * 0.3;
          }
        #endif
        `
      );
    };
    mat.customProgramCacheKey = () => 'warpuniv'; // ensure unique cache key for this hack
  }

  // ── Model import ───────────────────────────────────────────────────────────

  /**
   * Wrap a loaded model in a pivot Group so that:
   *  - The model's geometric center sits at the pivot's local origin
   *  - applyParams controls only the pivot (rotation = around center, position = linear)
   * Returns the pivot.
   */
  _wrapInPivot(model) {
    // Measure raw bounding box before any of our transforms
    const box    = new THREE.Box3().setFromObject(model);
    const size   = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    // Offset the model inside the pivot so its geometric center = pivot origin
    model.position.sub(center);

    // Store normalization scale (1 unit cube baseline; scene3d.norm scales on top)
    this._importedBaseScale = maxDim > 0 ? 1 / maxDim : 1;

    const pivot = new THREE.Group();
    pivot.add(model);
    return pivot;
  }

  async loadGLTF(url, name = '', params = null) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.load(url, gltf => {
        const model = gltf.scene;
        model.traverse(child => {
          if (child.isMesh && child.material) this._setupMaterial(child.material);
        });
        this._setupAnimations(model, gltf.animations, params);
        const pivot = this._wrapInPivot(model);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = pivot;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(pivot);
        resolve(pivot);
      }, undefined, reject);
    });
  }

  async loadOBJ(url, name = '') {
    return new Promise((resolve, reject) => {
      this.objLoader.load(url, obj => {
        obj.traverse(child => {
          if (child.isMesh && child.material) this._setupMaterial(child.material);
        });
        this._setupAnimations(null, [], null);
        const pivot = this._wrapInPivot(obj);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = pivot;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(pivot);
        resolve(pivot);
      }, undefined, reject);
    });
  }

  async loadSTL(url, name = '') {
    return new Promise((resolve, reject) => {
      this.stlLoader.load(url, geo => {
        const model = new THREE.Mesh(geo, this.material ?? new THREE.MeshStandardMaterial({ color: 0xffffff }));
        this._setupAnimations(null, [], null);
        const pivot = this._wrapInPivot(model);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = pivot;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(pivot);
        resolve(pivot);
      }, undefined, reject);
    });
  }

  async loadCollada(url, name = '', params = null) {
    return new Promise((resolve, reject) => {
      this.colladaLoader.load(url, collada => {
        const model = collada.scene;
        model.traverse(child => {
          if (child.isMesh && child.material) this._setupMaterial(child.material);
        });

        // Wrap first so the pivot is the animation root
        const pivot = this._wrapInPivot(model);
        if (this.mesh) this.scene.remove(this.mesh);
        this.mesh = pivot;
        this._geoKey = '__imported__';
        this._importedModelName = name;
        this.scene.add(pivot);

        // Animations — use collada.scene.animations (collada.animations is deprecated)
        const clips = collada.scene.animations ?? [];
        this._setupAnimations(model, clips, params);

        resolve(pivot);
      }, undefined, reject);
    });
  }

  _setupAnimations(model, animations, params) {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
      this.actions = [];
      this._curAnimIdx = -1;
    }

    if (!model || !animations || !animations.length) {
      if (params) {
        params.get('scene3d.anim.select').options = ['None'];
        params.get('scene3d.anim.select').value = 0;
      }
      return;
    }

    this.mixer = new THREE.AnimationMixer(model);
    this.actions = animations.map(clip => this.mixer.clipAction(clip));

    if (params) {
      const p = params.get('scene3d.anim.select');
      p.options = animations.map((c, i) => c.name || `Anim ${i}`);
      p.value = 0;
    }
  }

  /**
   * Load a 3D model from a File object, routing by extension.
   * If the file is part of a folder (e.g. from a drag-and-drop of multiple files),
   * we can try to resolve textures if provided.
   */
  async loadModel(file, params = null, extraFiles = []) {
    const url = URL.createObjectURL(file);
    const ext = file.name.split('.').pop().toLowerCase();
    
    // Create a loading manager to handle internal resources (textures, etc)
    const manager = new THREE.LoadingManager();
    const objectURLs = [];

    manager.setURLModifier(path => {
      // If the path matches one of our extra files, use that blob URL
      const fileName = path.split('/').pop();
      const match = extraFiles.find(f => f.name === fileName);
      if (match) {
        const blobUrl = URL.createObjectURL(match);
        objectURLs.push(blobUrl);
        return blobUrl;
      }
      return path;
    });

    // Update specific loaders to use the manager
    this.gltfLoader.manager = manager;
    this.objLoader.manager  = manager;
    this.colladaLoader.manager = manager;

    try {
      if (ext === 'glb' || ext === 'gltf') return await this.loadGLTF(url, file.name, params);
      if (ext === 'obj')                   return await this.loadOBJ(url, file.name);
      if (ext === 'stl')                   return await this.loadSTL(url, file.name);
      if (ext === 'dae')                   return await this.loadCollada(url, file.name, params);
      throw new Error(`Unsupported format: .${ext}`);
    } finally {
      URL.revokeObjectURL(url);
      objectURLs.forEach(u => URL.revokeObjectURL(u));
    }
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

    // Animation playback
    if (this.mixer) {
      const active = !!p.get('scene3d.anim.active').value;
      const speed  = p.get('scene3d.anim.speed').value;
      const animIdx = p.get('scene3d.anim.select').value;

      if (active) {
        if (animIdx !== this._curAnimIdx) {
          if (this.actions[this._curAnimIdx]) this.actions[this._curAnimIdx].stop();
          this._curAnimIdx = animIdx;
          if (this.actions[animIdx]) this.actions[animIdx].play();
        }
        this.mixer.update(dt * speed);
      } else {
        if (this._curAnimIdx !== -1) {
          if (this.actions[this._curAnimIdx]) this.actions[this._curAnimIdx].stop();
          this._curAnimIdx = -1;
        }
      }
    }

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
    // Scale
    const s = p.get('scene3d.scale').value;
    const n = p.get('scene3d.norm').value;
    const S = this._importedModelName
      ? s * n * this._importedBaseScale
      : s;
    this.mesh.scale.setScalar(S);

    // Position
    const px = p.get('scene3d.pos.x').value;
    const py = p.get('scene3d.pos.y').value;
    const pz = p.get('scene3d.pos.z').value;

    if (p.get('scene3d.pos.screenspace')?.value) {
      // Screen-space mode: pos.x/y treated as normalised screen coords (±1 = screen edge).
      // Convert to world units using camera FOV and distance from origin.
      const fovRad  = (p.get('scene3d.cam.fov').value * Math.PI) / 180;
      const camDist = Math.abs(p.get('scene3d.cam.z').value);
      const halfH   = Math.tan(fovRad / 2) * camDist;
      const halfW   = halfH * (this.width / this.height);
      this.mesh.position.set(px * halfW, py * halfH, pz);
    } else {
      this.mesh.position.set(px, py, pz);
    }

    // Material
    if (this.material) {
      const hue = (p.get('scene3d.mat.hue')?.value ?? 240) / 360;
      const sat = (p.get('scene3d.mat.sat')?.value ?? 50) / 100;
      this.material.color.setHSL(hue, sat, sat > 0 ? 0.5 : 1.0);
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
      const texSrcMap = [null, inputs.camera, inputs.movie, inputs.screen, inputs.draw, inputs.buffer, inputs.noise];
      const liveTex = texSrcMap[texSrcIdx] ?? null;
      if (liveTex !== this._liveTex) {
        this._liveTex = liveTex;
        this.material.map = liveTex
          ? Object.assign(liveTex, { wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping })
          : null;
      }

      // If a texture source is active, override imported model materials with our pipeline-ready material
      if (this._importedModelName && this.mesh && texSrcIdx > 0) {
        this.mesh.traverse(child => {
          if (child.isMesh) child.material = this.material;
        });
      }

      // WarpMap displacement on UVs
      const warpIdx = p.get('displace.warp').value;
      const activeWarp = (warpIdx > 0 && inputs.warpMaps?.[warpIdx - 1]) ? inputs.warpMaps[warpIdx - 1] : null;
      const warpAmt = p.get('displace.warpamt').value / 100;

      const updateMat = (m) => {
        if (m._shader) {
          m._shader.uniforms.uWarpMap.value = activeWarp || this._fallback;
          m._shader.uniforms.uWarpAmt.value = warpAmt;
        }
      };

      updateMat(this.material);
      if (this._importedModelName && this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) child.material.forEach(updateMat);
            else updateMat(child.material);
          }
        });
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
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();

    // Light
    this.lights.directional.intensity = p.get('scene3d.light.intensity').value;
    this.lights.ambient.intensity     = p.get('scene3d.light.ambient').value;
    this.lights.point.intensity       = p.get('scene3d.light.point').value;
    this.lights.directional.position.set(
      p.get('scene3d.light.dirX').value,
      p.get('scene3d.light.dirY').value,
      p.get('scene3d.light.dirZ').value
    );
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
      const mode = params.get('scene3d.depth.mode')?.value ?? 0;
      this.scene.overrideMaterial = (mode === 1) ? this._normalMat : this._depthMat;
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
