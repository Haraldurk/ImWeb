/**
 * ImWeb GPU Particle System
 *
 * Simulates N particles using ping-pong WebGLRenderTargets (position + velocity).
 * Renders as point sprites into a final output texture.
 *
 * Parameters:
 *   particle.count   SELECT  1k / 4k / 16k / 64k
 *   particle.speed   0–100   base speed
 *   particle.life    0–100   particle lifetime (affects trail length)
 *   particle.gravity 0–100   downward acceleration
 *   particle.wind    -100–100 horizontal wind
 *   particle.size    1–32    point sprite size
 *   particle.color   SELECT  White/Rainbow/Mono/Fire
 *   particle.emit    TRIGGER restart emission burst
 */

import * as THREE from 'three';

// ── Shaders ───────────────────────────────────────────────────────────────────

const SIM_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = vec4(position, 1.0); }
`;

// Simulation pass: update position and velocity
const SIM_FRAG = /* glsl */ `
  uniform sampler2D uPos;   // xy=pos, zw=life
  uniform sampler2D uVel;   // xy=vel, zw=unused
  uniform sampler2D uRand;  // random seeds
  uniform float uDt;
  uniform float uSpeed;
  uniform float uGravity;
  uniform float uWind;
  uniform float uLifeScale;  // 1/maxLife
  varying vec2 vUv;

  float hash(vec2 p){ return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5); }

  void main() {
    vec4 pos = texture2D(uPos, vUv);
    vec4 vel = texture2D(uVel, vUv);

    float life = pos.z; // 0=dead, 1=fresh

    if(life <= 0.0) {
      // Respawn: random position near centre, random velocity
      vec4 r = texture2D(uRand, vUv);
      float angle = r.x * 6.283;
      float spd   = (0.2 + r.y * 0.8) * uSpeed;
      pos.xy = vec2(0.5 + (r.z - 0.5) * 0.1, 0.5 + (r.w - 0.5) * 0.1);
      vel.xy = vec2(cos(angle) * spd, sin(angle) * spd);
      pos.z  = 0.5 + r.x * 0.5; // random life 0.5–1
    } else {
      // Update
      vel.x += uWind    * uDt;
      vel.y -= uGravity * uDt;
      pos.x += vel.x    * uDt;
      pos.y += vel.y    * uDt;
      pos.z -= uLifeScale * uDt;

      // Bounce off walls
      if(pos.x < 0.0) { pos.x = 0.0; vel.x = abs(vel.x); }
      if(pos.x > 1.0) { pos.x = 1.0; vel.x = -abs(vel.x); }
      if(pos.y < 0.0) { pos.y = 0.0; vel.y = abs(vel.y); }
      if(pos.y > 1.0) { pos.y = 1.0; vel.y = -abs(vel.y); }
    }

    gl_FragColor = pos;   // render to position buffer
  }
`;

const VEL_FRAG = /* glsl */ `
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform sampler2D uRand;
  uniform float uDt;
  uniform float uSpeed;
  uniform float uGravity;
  uniform float uWind;
  varying vec2 vUv;

  void main() {
    vec4 pos = texture2D(uPos, vUv);
    vec4 vel = texture2D(uVel, vUv);
    float life = pos.z;
    if(life <= 0.0) {
      vec4 r = texture2D(uRand, vUv);
      float angle = r.x * 6.283;
      float spd   = (0.2 + r.y * 0.8) * uSpeed;
      vel.xy = vec2(cos(angle) * spd, sin(angle) * spd);
    } else {
      vel.x += uWind    * uDt;
      vel.y -= uGravity * uDt;
      if(pos.x < 0.0 || pos.x > 1.0) vel.x = -vel.x;
      if(pos.y < 0.0 || pos.y > 1.0) vel.y = -vel.y;
    }
    gl_FragColor = vel;
  }
`;

// Render pass: draw particles as point sprites
const RENDER_VERT = /* glsl */ `
  uniform sampler2D uPos;
  uniform float uSize;
  uniform float uResW;
  uniform float uResH;
  attribute float aIndex;  // 0..N-1 / texSize
  varying float vLife;
  varying float vIdx;

  void main() {
    // Decode UV from aIndex (texSize x texSize texture)
    float texSize = sqrt(float(int(uResW)));  // approximate
    float fi = aIndex;
    vec2 uv = vec2(mod(fi, texSize) / texSize, floor(fi / texSize) / texSize);
    vec4 p = texture2D(uPos, uv);
    vLife = p.z;
    vIdx  = aIndex;
    vec2 pos = p.xy * 2.0 - 1.0;
    gl_Position = vec4(pos, 0.0, 1.0);
    gl_PointSize = uSize * p.z;
  }
`;

const RENDER_FRAG = /* glsl */ `
  uniform float uColorMode; // 0=white, 1=rainbow, 2=mono, 3=fire
  varying float vLife;
  varying float vIdx;

  void main() {
    // Circular point
    vec2 pc = gl_PointCoord - 0.5;
    float d = length(pc);
    if(d > 0.5) discard;
    float alpha = (1.0 - d * 2.0) * vLife;

    vec3 col = vec3(1.0);
    if(uColorMode < 0.5) {
      col = vec3(1.0);
    } else if(uColorMode < 1.5) {
      // Rainbow by index
      float h = fract(vIdx * 0.0037);
      float r=abs(h*6.0-3.0)-1.0, g=2.0-abs(h*6.0-2.0), b=2.0-abs(h*6.0-4.0);
      col = clamp(vec3(r,g,b),0.0,1.0);
    } else if(uColorMode < 2.5) {
      // Monochrome (life-based grey)
      col = vec3(vLife);
    } else {
      // Fire: yellow-orange-red by life
      col = mix(vec3(1.0,0.1,0.0), vec3(1.0,0.9,0.0), vLife);
    }

    gl_FragColor = vec4(col * alpha, alpha);
  }
`;

// ── ParticleSystem class ───────────────────────────────────────────────────────

const COUNTS = [1024, 4096, 16384, 65536];

export class ParticleSystem {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width    = width;
    this.height   = height;

    this._texSize    = 0;
    this._count      = 0;
    this._posBuffers = [];
    this._velBuffers = [];
    this._randTex    = null;
    this._outputRT   = null;
    this._simScene   = null;
    this._simCamera  = null;
    this._posQuad    = null;
    this._velQuad    = null;
    this._posMat     = null;
    this._velMat     = null;
    this._renderScene  = null;
    this._renderCamera = null;
    this._pointsMat    = null;
    this._points       = null;
    this._curPos     = 0; // ping-pong index

    this.texture = null; // THREE.Texture of latest rendered frame

    this._init(0); // default: 1k particles
  }

  _init(countIdx) {
    const n = COUNTS[countIdx] ?? 1024;
    const sz = Math.ceil(Math.sqrt(n)); // texture side length

    this._texSize = sz;
    this._count   = sz * sz;

    // ── Simulation render targets (pos and vel, ping-pong) ────────────────
    const rtOpts = {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat, type: THREE.FloatType, generateMipmaps: false,
    };

    this._posBuffers.forEach(rt => rt.dispose());
    this._velBuffers.forEach(rt => rt.dispose());
    this._posBuffers = [
      new THREE.WebGLRenderTarget(sz, sz, rtOpts),
      new THREE.WebGLRenderTarget(sz, sz, rtOpts),
    ];
    this._velBuffers = [
      new THREE.WebGLRenderTarget(sz, sz, rtOpts),
      new THREE.WebGLRenderTarget(sz, sz, rtOpts),
    ];

    // ── Random seed texture ───────────────────────────────────────────────
    const rData = new Float32Array(sz * sz * 4);
    for (let i = 0; i < rData.length; i++) rData[i] = Math.random();
    this._randTex?.dispose();
    this._randTex = new THREE.DataTexture(rData, sz, sz, THREE.RGBAFormat, THREE.FloatType);
    this._randTex.needsUpdate = true;

    // ── Simulation scene ──────────────────────────────────────────────────
    if (!this._simScene) {
      this._simScene  = new THREE.Scene();
      this._simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
      const geo = new THREE.PlaneGeometry(2, 2);
      this._posQuad = new THREE.Mesh(geo, null);
      this._velQuad = new THREE.Mesh(geo, null);
      this._simScene.add(this._posQuad);
    }

    this._posMat?.dispose();
    this._velMat?.dispose();
    this._posMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uRand: { value: this._randTex },
        uDt: { value: 0.016 }, uSpeed: { value: 0.3 }, uGravity: { value: 0.1 },
        uWind: { value: 0 }, uLifeScale: { value: 1 },
      },
      vertexShader: SIM_VERT, fragmentShader: SIM_FRAG, depthTest: false, depthWrite: false,
    });
    this._velMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos: { value: null }, uVel: { value: null }, uRand: { value: this._randTex },
        uDt: { value: 0.016 }, uSpeed: { value: 0.3 }, uGravity: { value: 0.1 }, uWind: { value: 0 },
      },
      vertexShader: SIM_VERT, fragmentShader: VEL_FRAG, depthTest: false, depthWrite: false,
    });

    // ── Initialize particle positions ─────────────────────────────────────
    this._initPositions();

    // ── Render output ─────────────────────────────────────────────────────
    this._outputRT?.dispose();
    this._outputRT = new THREE.WebGLRenderTarget(this.width, this.height, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.UnsignedByteType, generateMipmaps: false,
    });
    this.texture = this._outputRT.texture;

    // ── Particle render scene ─────────────────────────────────────────────
    if (!this._renderScene) {
      this._renderScene  = new THREE.Scene();
      this._renderCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    }

    this._points?.geometry.dispose();
    this._pointsMat?.dispose();
    if (this._points) this._renderScene.remove(this._points);

    const indices = new Float32Array(this._count);
    for (let i = 0; i < this._count; i++) indices[i] = i;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this._count * 3), 3));
    geo.setAttribute('aIndex', new THREE.BufferAttribute(indices, 1));

    this._pointsMat = new THREE.ShaderMaterial({
      uniforms: {
        uPos:       { value: null },
        uSize:      { value: 4 },
        uResW:      { value: this._count },
        uColorMode: { value: 0 },
      },
      vertexShader:   RENDER_VERT,
      fragmentShader: RENDER_FRAG,
      transparent: true,
      blending:    THREE.AdditiveBlending,
      depthTest:   false,
      depthWrite:  false,
    });
    this._points = new THREE.Points(geo, this._pointsMat);
    this._renderScene.add(this._points);

    this._curPos = 0;
  }

  _initPositions() {
    // Render a random initial state into pos/vel buffers using a plain DataTexture
    const sz = this._texSize;
    const n  = sz * sz;
    const pos = new Float32Array(n * 4);
    const vel = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      pos[i * 4    ] = Math.random(); // x
      pos[i * 4 + 1] = Math.random(); // y
      pos[i * 4 + 2] = Math.random(); // life
      pos[i * 4 + 3] = 0;

      const angle = Math.random() * Math.PI * 2;
      vel[i * 4    ] = Math.cos(angle) * 0.1;
      vel[i * 4 + 1] = Math.sin(angle) * 0.1;
    }

    const posTex = new THREE.DataTexture(pos, sz, sz, THREE.RGBAFormat, THREE.FloatType);
    const velTex = new THREE.DataTexture(vel, sz, sz, THREE.RGBAFormat, THREE.FloatType);
    posTex.needsUpdate = true;
    velTex.needsUpdate = true;

    // Upload initial data to both ping-pong buffers
    const simScene  = new THREE.Scene();
    const simCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null } },
      vertexShader: SIM_VERT,
      fragmentShader: `uniform sampler2D uTexture; varying vec2 vUv;
        void main() { gl_FragColor = texture2D(uTexture, vUv); }`,
      depthTest: false, depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    simScene.add(quad);

    for (const rt of this._posBuffers) {
      mat.uniforms.uTexture.value = posTex;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(simScene, simCamera);
    }
    for (const rt of this._velBuffers) {
      mat.uniforms.uTexture.value = velTex;
      this.renderer.setRenderTarget(rt);
      this.renderer.render(simScene, simCamera);
    }
    this.renderer.setRenderTarget(null);
    mat.dispose();
    posTex.dispose();
    velTex.dispose();
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  tick(ps, dt) {
    const countIdx  = ps.get('particle.count').value;
    if (COUNTS[countIdx] !== this._count) this._init(countIdx);

    const speed  = ps.get('particle.speed').value   / 100 * 0.5;
    const life   = ps.get('particle.life').value    / 100;
    const grav   = ps.get('particle.gravity').value / 100 * 0.3;
    const wind   = (ps.get('particle.wind').value - 50) / 50 * 0.1;
    const ptSize = ps.get('particle.size').value;
    const col    = ps.get('particle.color').value;

    const curPos = this._curPos;
    const nxtPos = curPos ^ 1;

    // ── Velocity simulation pass ──────────────────────────────────────────
    this._simScene.add(this._velQuad);
    this._simScene.remove(this._posQuad);
    this._velMat.uniforms.uPos.value    = this._posBuffers[curPos].texture;
    this._velMat.uniforms.uVel.value    = this._velBuffers[curPos].texture;
    this._velMat.uniforms.uDt.value     = dt;
    this._velMat.uniforms.uSpeed.value  = speed;
    this._velMat.uniforms.uGravity.value= grav;
    this._velMat.uniforms.uWind.value   = wind;
    this._velQuad.material = this._velMat;
    this.renderer.setRenderTarget(this._velBuffers[nxtPos]);
    this.renderer.render(this._simScene, this._simCamera);

    // ── Position simulation pass ──────────────────────────────────────────
    this._simScene.remove(this._velQuad);
    this._simScene.add(this._posQuad);
    this._posMat.uniforms.uPos.value      = this._posBuffers[curPos].texture;
    this._posMat.uniforms.uVel.value      = this._velBuffers[nxtPos].texture;
    this._posMat.uniforms.uDt.value       = dt;
    this._posMat.uniforms.uSpeed.value    = speed;
    this._posMat.uniforms.uGravity.value  = grav;
    this._posMat.uniforms.uWind.value     = wind;
    this._posMat.uniforms.uLifeScale.value= life > 0 ? (1 / life) : 10;
    this._posQuad.material = this._posMat;
    this.renderer.setRenderTarget(this._posBuffers[nxtPos]);
    this.renderer.render(this._simScene, this._simCamera);

    // ── Render particles ──────────────────────────────────────────────────
    this._pointsMat.uniforms.uPos.value       = this._posBuffers[nxtPos].texture;
    this._pointsMat.uniforms.uSize.value      = ptSize;
    this._pointsMat.uniforms.uColorMode.value = col;
    this.renderer.setRenderTarget(this._outputRT);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.render(this._renderScene, this._renderCamera);
    this.renderer.setRenderTarget(null);

    this._curPos = nxtPos;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this._outputRT?.setSize(w, h);
  }

  dispose() {
    this._posBuffers.forEach(rt => rt.dispose());
    this._velBuffers.forEach(rt => rt.dispose());
    this._outputRT?.dispose();
    this._randTex?.dispose();
    this._posMat?.dispose();
    this._velMat?.dispose();
    this._pointsMat?.dispose();
  }
}
