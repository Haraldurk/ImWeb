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

    // Cloner state
    this._baseGeo    = null;   // geometry cached for cloner rebuilds
    this._cloneMode  = -1;     // sentinel — forces rebuild on first applyParams
    this._cloneCount = 0;
    this._cloneTime  = 0;      // accumulated time for wave animation
    this._dummy      = new THREE.Object3D(); // reusable dummy for matrix composition

    // Blob state
    this._blobTime   = 0;      // accumulated time for blob animation

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

    // Material type tracking — sentinel forces rebuild on first applyParams
    this._matType   = -1;
    this._toonSteps = -1;
    this._liveTex   = null;

    // Toon gradient: 3-step cel-shading ramp (dark / mid / bright)
    const toonData = new Uint8Array([40, 40, 40, 255,  130, 130, 130, 255,  240, 240, 240, 255]);
    this._toonGradient = new THREE.DataTexture(toonData, 3, 1, THREE.RGBAFormat);
    this._toonGradient.minFilter = this._toonGradient.magFilter = THREE.NearestFilter;
    this._toonGradient.needsUpdate = true;

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

    this._baseGeo   = geo;   // keep reference so cloner can reuse it
    this._cloneMode = -1;    // force cloner rebuild on next applyParams (new geo)
    this.mesh = new THREE.Mesh(geo, this.material);
    this.scene.add(this.mesh);
  }

  _rebuildCloner(mode, count) {
    this._cloneMode  = mode;
    this._cloneCount = count;

    if (this.mesh) this.scene.remove(this.mesh);

    const geo = this._baseGeo;
    if (!geo || this._importedModelName) return; // guard: no geo or imported model active

    if (mode === 0) {
      // Off — restore single mesh
      this.mesh = new THREE.Mesh(geo, this.material);
    } else {
      this.mesh = new THREE.InstancedMesh(geo, this.material, count);
      this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.mesh.frustumCulled = false;
      // Prime all instance matrices to identity so no garbage frame appears
      const m = new THREE.Matrix4();
      for (let i = 0; i < count; i++) this.mesh.setMatrixAt(i, m);
      this.mesh.instanceMatrix.needsUpdate = true;
    }

    this.scene.add(this.mesh);
  }

  _updateClonerMatrices(count, mode, spread, wave, waveshape, waveamp, wavefreq, twist, scatter, clonescale, scalestep, dt) {
    this._cloneTime += dt;
    const t     = this._cloneTime;
    const TAU   = Math.PI * 2;
    const DEG   = Math.PI / 180;
    const mesh  = this.mesh;
    const dummy = this._dummy;

    // Deterministic per-clone hash — stable every frame, no GC
    const frand = (seed) => ((Math.sin(seed * 127.1 + 311.7) * 43758.5453) % 1 + 1) % 1;

    // Waveform helper — all shapes output [-1, 1]
    const waveform = (p) => {
      const norm = ((p % TAU) + TAU) % TAU; // normalize to [0, 2π) — handles negative phase
      switch (waveshape) {
        case 1: return Math.sin(p) >= 0 ? 1 : -1;           // Square
        case 2: return norm < Math.PI                         // Triangle
          ? -1 + (2 / Math.PI) * norm
          :  3 - (2 / Math.PI) * norm;
        case 3: return 1 - norm / Math.PI;                   // Sawtooth
        default: return Math.sin(p);                          // Sine
      }
    };

    for (let i = 0; i < count; i++) {
      const phase = wave * TAU * t + (i / count) * wavefreq * TAU;

      // Progressive taper — calculated first so it gates position AND wave height
      const progressiveScale = Math.max(0, 1.0 + (i / Math.max(count - 1, 1)) * scalestep);

      // waveY tapers with progressiveScale: vanishing clones have no vertical offset
      const waveY = waveform(phase) * waveamp * progressiveScale;

      if (mode === 1) {
        // Grid — xz multiplied by progressiveScale to pack smaller clones closer
        const side = Math.ceil(Math.sqrt(count));
        const col  = i % side;
        const row  = Math.floor(i / side);
        dummy.position.set(
          (col - (side - 1) / 2) * spread * progressiveScale,
          waveY,
          (row - (side - 1) / 2) * spread * progressiveScale
        );
      } else if (mode === 2) {
        // Ring — radius tapers with progressiveScale
        const angle = (i / count) * TAU;
        dummy.position.set(
          Math.cos(angle) * spread * progressiveScale,
          waveY,
          Math.sin(angle) * spread * progressiveScale
        );
      } else {
        // Line — spacing tapers with progressiveScale
        dummy.position.set((i - (count - 1) / 2) * spread * progressiveScale, waveY, 0);
      }

      // Scatter — world-unit noise, NOT tapered (absolute chaos, independent of size)
      dummy.position.x += (frand(i * 3)     - 0.5) * scatter * 2;
      dummy.position.y += (frand(i * 3 + 1) - 0.5) * scatter * 2;
      dummy.position.z += (frand(i * 3 + 2) - 0.5) * scatter * 2;

      // Twist — cumulative Y rotation; clone 0 = 0°, clone N-1 = full twist
      const twistAngle = (i / Math.max(count - 1, 1)) * twist * DEG;
      dummy.rotation.set(0, twistAngle, 0);

      // Scale — progressiveScale already computed above
      dummy.scale.setScalar(clonescale * progressiveScale * (1 + Math.sin(phase + Math.PI * 0.5) * 0.08));

      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }

    mesh.instanceMatrix.needsUpdate = true;
  }

  _setupMaterial(mat) {
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWarpMap    = { value: this._fallback };
      shader.uniforms.uWarpAmt    = { value: 0 };
      shader.uniforms.uTime       = { value: 0 };
      shader.uniforms.uBlobAmount = { value: 0 };
      shader.uniforms.uBlobScale  = { value: 1 };
      shader.uniforms.uBlobSpeed  = { value: 1 };
      shader.uniforms.uDisplace   = { value: 0 };
      shader.uniforms.uDispScale  = { value: 1 };
      shader.uniforms.uRimAmount  = { value: 0 };
      shader.uniforms.uRimColor   = { value: new THREE.Color(0xffffff) };
      mat._shader = shader;

      shader.vertexShader = `
        uniform sampler2D uWarpMap;
        uniform float uWarpAmt;
        uniform float uTime;
        uniform float uBlobAmount;
        uniform float uBlobScale;
        uniform float uBlobSpeed;
        uniform float uDisplace;
        uniform float uDispScale;

        float _bHash(vec3 p) {
          p = fract(p * vec3(127.1, 311.7, 74.7));
          p += dot(p, p + 19.19);
          return fract(p.x * p.y * p.z);
        }
        float _bNoise(vec3 p) {
          vec3 i = floor(p); vec3 f = fract(p);
          vec3 u = f * f * (3.0 - 2.0 * f);
          return mix(
            mix(mix(_bHash(i),             _bHash(i+vec3(1,0,0)), u.x),
                mix(_bHash(i+vec3(0,1,0)), _bHash(i+vec3(1,1,0)), u.x), u.y),
            mix(mix(_bHash(i+vec3(0,0,1)), _bHash(i+vec3(1,0,1)), u.x),
                mix(_bHash(i+vec3(0,1,1)), _bHash(i+vec3(1,1,1)), u.x), u.y), u.z
          ) * 2.0 - 1.0;
        }
        // fBm layered noise for richer displacement
        float _dispNoise(vec3 p) {
          return _bNoise(p)
               + 0.5  * _bNoise(p * 2.0)
               + 0.25 * _bNoise(p * 4.0);
        }
        ${shader.vertexShader}
      `
      .replace(
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
      )
      .replace(
        '#include <displacementmap_vertex>',
        `#include <displacementmap_vertex>
        if (uBlobAmount > 0.0) {
          vec3 noisePos = position;
          #ifdef USE_INSTANCING
            noisePos += instanceMatrix[3].xyz;
          #endif
          float n = _bNoise(noisePos * uBlobScale + uTime * uBlobSpeed);
          transformed += objectNormal * n * uBlobAmount;
        }
        if (uDisplace > 0.0) {
          float dn = _dispNoise(position * uDispScale);
          transformed += objectNormal * dn * uDisplace;
        }`
      );

      // Rim / Fresnel — fragment shader injection
      shader.fragmentShader = `
        uniform float uRimAmount;
        uniform vec3  uRimColor;
        ${shader.fragmentShader}
      `.replace(
        '#include <dithering_fragment>',
        `#include <dithering_fragment>
        if (uRimAmount > 0.0) {
          float rim = 1.0 - max(0.0, dot(normalize(vViewPosition), normalize(vNormal)));
          rim = pow(rim, 4.0);
          gl_FragColor.rgb += uRimColor * rim * uRimAmount;
        }`
      );
    };
    mat.customProgramCacheKey = () => 'warpblobrimdisp'; // unique cache key for custom shader
  }

  _rebuildMaterial(type) {
    if (this._matType === type) return;
    this._matType = type;

    const oldMat = this.material;

    // Carry over basic properties from old material
    const color      = oldMat?.color?.clone() ?? new THREE.Color(0xffffff);
    const roughness  = oldMat?.roughness  ?? 0.5;
    const metalness  = oldMat?.metalness  ?? 0.0;
    const opacity    = oldMat?.opacity    ?? 1.0;
    const wireframe  = oldMat?.wireframe  ?? false;
    const map        = oldMat?.map        ?? null;

    let mat;
    switch (type) {
      case 1: // Physical
        mat = new THREE.MeshPhysicalMaterial({ color, roughness, metalness, wireframe });
        break;
      case 2: // Toon
        mat = new THREE.MeshToonMaterial({ color, wireframe, gradientMap: this._toonGradient });
        break;
      case 3: // Normal
        mat = new THREE.MeshNormalMaterial({ wireframe });
        break;
      case 4: // Matcap
        mat = new THREE.MeshMatcapMaterial({ color, wireframe });
        break;
      case 5: // Lambert
        mat = new THREE.MeshLambertMaterial({ color, wireframe });
        break;
      case 6: // Phong
        mat = new THREE.MeshPhongMaterial({ color, wireframe, shininess: (1 - roughness) * 100 });
        break;
      default: // Standard
        mat = new THREE.MeshStandardMaterial({ color, roughness, metalness, wireframe });
        break;
    }

    mat.opacity     = opacity;
    mat.transparent = opacity < 1;
    if (map) mat.map = map;

    this._setupMaterial(mat);

    if (oldMat) {
      oldMat.onBeforeCompile = () => {};
      oldMat._shader = null;
      oldMat.dispose();
    }

    this.material = mat;

    // Apply to main mesh
    if (this.mesh) {
      if (this.mesh.isMesh) {
        this.mesh.material = mat;
      } else {
        // Imported model group — update all child meshes
        this.mesh.traverse(child => {
          if (child.isMesh) child.material = mat;
        });
      }
    }
  }

  _setToonGradient(steps) {
    this._toonSteps = steps;
    const data = new Uint8Array(steps * 4);
    for (let i = 0; i < steps; i++) {
      const v = Math.round((i / (steps - 1)) * 255);
      data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    if (this._toonGradient) this._toonGradient.dispose();
    this._toonGradient = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
    this._toonGradient.minFilter = this._toonGradient.magFilter = THREE.NearestFilter;
    this._toonGradient.needsUpdate = true;
    if (this.material?.isMeshToonMaterial) {
      this.material.gradientMap = this._toonGradient;
      this.material.needsUpdate = true;
    }
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
    this._blobTime += dt;

    // Geometry selection — skip when a model is imported (only apply on change)
    const geoIdx = p.get('scene3d.geo').value;
    if (!this._importedModelName) {
      this.setGeometry(GEOMETRY_NAMES[geoIdx] ?? 'Sphere');
    }

    if (!this.mesh) return;

    // ── Cloner ────────────────────────────────────────────────────────────────
    const cloneMode  = p.get('scene3d.clone.mode')?.value  ?? 0;
    const cloneCount = Math.round(p.get('scene3d.clone.count')?.value ?? 9);

    if (!this._importedModelName &&
        (cloneMode !== this._cloneMode || cloneCount !== this._cloneCount)) {
      this._rebuildCloner(cloneMode, cloneCount);
    }

    if (cloneMode > 0 && this.mesh?.isInstancedMesh) {
      const spread      = p.get('scene3d.clone.spread')?.value    ?? 2;
      const wave        = p.get('scene3d.clone.wave')?.value      ?? 0;
      const waveshape   = p.get('scene3d.clone.waveshape')?.value ?? 0;
      const waveamp     = p.get('scene3d.clone.waveamp')?.value   ?? 0;
      const wavefreq    = p.get('scene3d.clone.wavefreq')?.value  ?? 1;
      const twist       = p.get('scene3d.clone.twist')?.value     ?? 0;
      const scatter     = p.get('scene3d.clone.scatter')?.value   ?? 0;
      const clonescale  = p.get('scene3d.clone.scale')?.value     ?? 1;
      const scalestep   = p.get('scene3d.clone.scalestep')?.value ?? 0;
      this._updateClonerMatrices(cloneCount, cloneMode, spread, wave, waveshape, waveamp, wavefreq, twist, scatter, clonescale, scalestep, dt);
    }

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
    // Rebuild material if type changed
    const matType = Math.round(p.get('scene3d.mat.type')?.value ?? 0);
    if (matType !== this._matType) this._rebuildMaterial(matType);

    if (this.material) {
      const hue = (p.get('scene3d.mat.hue')?.value ?? 240) / 360;
      const sat = (p.get('scene3d.mat.sat')?.value ?? 50) / 100;
      if (this.material.color) this.material.color.setHSL(hue, sat, sat > 0 ? 0.5 : 1.0);

      // Independent emissive color (falls back to base hue when emissiveSat = 0)
      if (this.material.emissive) {
        const emissiveAmt = p.get('scene3d.mat.emissive')?.value ?? 0;
        const emHue = (p.get('scene3d.mat.emissiveHue')?.value ?? 0) / 360;
        const emSat = (p.get('scene3d.mat.emissiveSat')?.value ?? 0) / 100;
        const useIndepEmissive = emSat > 0;
        this.material.emissive.setHSL(
          useIndepEmissive ? emHue : hue,
          useIndepEmissive ? emSat : sat,
          0.15 * emissiveAmt
        );
        if (this.material.emissiveIntensity !== undefined) this.material.emissiveIntensity = emissiveAmt;
      }

      if (this.material.roughness !== undefined) this.material.roughness = p.get('scene3d.mat.roughness').value;
      if (this.material.metalness !== undefined) this.material.metalness = p.get('scene3d.mat.metalness').value;
      this.material.opacity  = p.get('scene3d.mat.opacity').value;
      this.material.transparent = this.material.opacity < 1;

      // Physical material properties
      if (matType === 1 && this.material.isMeshPhysicalMaterial) {
        this.material.clearcoat    = p.get('scene3d.mat.clearcoat')?.value ?? 0;
        this.material.transmission = p.get('scene3d.mat.transmit')?.value ?? 0;
        this.material.ior          = p.get('scene3d.mat.ior')?.value ?? 1.5;
        this.material.transparent  = this.material.transmission > 0 || this.material.opacity < 1;
      }

      // Toon gradient steps
      if (matType === 2 && this.material.isMeshToonMaterial) {
        const steps = Math.round(p.get('scene3d.mat.toonSteps')?.value ?? 4);
        if (steps !== this._toonSteps) this._setToonGradient(steps);
      }

      // Environment map intensity
      if (this.material.envMapIntensity !== undefined) {
        this.material.envMapIntensity = p.get('scene3d.mat.envIntensity')?.value ?? 1;
      }
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

      // Blob / Morph uniform updates
      const blobAmt   = p.get('scene3d.blob.amount')?.value ?? 0;
      const blobScale = p.get('scene3d.blob.scale')?.value  ?? 1;
      const blobSpeed = p.get('scene3d.blob.speed')?.value  ?? 1;
      const updateBlob = (m) => {
        if (m._shader) {
          m._shader.uniforms.uTime.value       = this._blobTime;
          m._shader.uniforms.uBlobAmount.value = blobAmt;
          m._shader.uniforms.uBlobScale.value  = blobScale;
          m._shader.uniforms.uBlobSpeed.value  = blobSpeed;
        }
      };
      updateBlob(this.material);
      if (this._importedModelName && this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) child.material.forEach(updateBlob);
            else updateBlob(child.material);
          }
        });
      }

      // Vertex displacement uniform updates
      const displaceAmt   = p.get('scene3d.mat.displace')?.value  ?? 0;
      const displaceScale = p.get('scene3d.mat.dispScale')?.value ?? 1;
      const updateDisplace = (m) => {
        if (m._shader) {
          m._shader.uniforms.uDisplace.value  = displaceAmt;
          m._shader.uniforms.uDispScale.value = displaceScale;
        }
      };
      updateDisplace(this.material);
      if (this._importedModelName && this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) child.material.forEach(updateDisplace);
            else updateDisplace(child.material);
          }
        });
      }

      // UV animation — accumulate texture offset each frame
      const uvSpeedX = p.get('scene3d.mat.uvSpeedX')?.value ?? 0;
      const uvSpeedY = p.get('scene3d.mat.uvSpeedY')?.value ?? 0;
      if (this.material.map && (uvSpeedX !== 0 || uvSpeedY !== 0)) {
        this.material.map.offset.x += uvSpeedX * dt;
        this.material.map.offset.y += uvSpeedY * dt;
        this.material.map.needsUpdate = true;
      }

      // Rim / Fresnel uniform updates
      const rimAmt = p.get('scene3d.mat.rim')?.value ?? 0;
      const rimHue = (p.get('scene3d.mat.rimHue')?.value ?? 180) / 360;
      const updateRim = (m) => {
        if (m._shader) {
          m._shader.uniforms.uRimAmount.value = rimAmt;
          m._shader.uniforms.uRimColor.value.setHSL(rimHue, 1, 0.5);
        }
      };
      updateRim(this.material);
      if (this._importedModelName && this.mesh) {
        this.mesh.traverse(child => {
          if (child.isMesh && child.material) {
            if (Array.isArray(child.material)) child.material.forEach(updateRim);
            else updateRim(child.material);
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
