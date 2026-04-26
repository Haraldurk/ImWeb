import * as THREE from "three";

// dim = ceil(sqrt(262144)) = 512 → 262,144 particles
const DIM = 512;

const SIM_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// blit a DataTexture into a float RT without precision loss
const BLIT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D tInput;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(tInput, vUv);
}
`;

// Pass A — advance position + age
const PASS_A_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uPosAgeTex;
uniform sampler2D uVelTex;
uniform float uDt;
uniform float uLifeDecay;
uniform int   uBoundaryMode;
uniform float uRespawnSeed;
uniform float uEmitter;
uniform float uEmitX;
uniform float uEmitY;
uniform float uSpread;
varying vec2 vUv;

vec2 spawnPos(vec2 uv, float seed) {
  float h     = fract(sin(dot(uv + seed,       vec2(127.1, 311.7))) * 43758.5);
  float h2    = fract(sin(dot(uv + seed + 0.1, vec2(269.5, 183.3))) * 43758.5);
  float angle = h * 6.2832;
  float cx    = uEmitX, cy = uEmitY;
  vec2 p;
  if      (uEmitter < 0.5) p = vec2(cx + (h  - 0.5) * uSpread,      cy + (h2 - 0.5) * uSpread);
  else if (uEmitter < 1.5) p = vec2(cx + cos(angle)  * uSpread * 0.4, cy + sin(angle) * uSpread * 0.4);
  else if (uEmitter < 2.5) p = vec2(cx + (h  - 0.5) * uSpread,      cy);
  else if (uEmitter < 3.5) p = vec2(cx,                              cy + (h2 - 0.5) * uSpread);
  else                     p = vec2(cx + (h  - 0.5) * 0.005,        cy + (h2 - 0.5) * 0.005);
  return clamp(p, 0.001, 0.999);
}

void main() {
  vec4  pa  = texture2D(uPosAgeTex, vUv);
  vec4  vel = texture2D(uVelTex,    vUv);
  vec2  pos = pa.rg;
  float age = pa.b + uLifeDecay;

  if (age >= 1.0) {
    gl_FragColor = vec4(spawnPos(vUv, uRespawnSeed), 0.0, 0.0);
    return;
  }

  pos += vel.rg * uDt;

  if (uBoundaryMode == 0) {
    pos = fract(pos);
  } else if (uBoundaryMode == 1) {
    pos = clamp(pos, 0.001, 0.999);
  } else {
    if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
      gl_FragColor = vec4(spawnPos(vUv, uRespawnSeed), 0.0, 0.0);
      return;
    }
  }

  gl_FragColor = vec4(pos, age, 0.0);
}
`;

// Pass B — damping + force field + ghost SDF + bounce reflect
const PASS_B_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uPosAgeTex;
uniform sampler2D uVelTex;
uniform sampler2D uForceFieldTex;
uniform sampler2D uGhostSDFTex;
uniform float uDt;
uniform int   uBoundaryMode;
uniform float uFieldStrength;
uniform float uGhostStrength;
uniform float uInertia;
varying vec2 vUv;

void main() {
  vec4  pa  = texture2D(uPosAgeTex, vUv);
  vec4  vel = texture2D(uVelTex,    vUv);
  float age = pa.b;

  if (age >= 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }

  vec2 pos = pa.rg;
  vec2 v   = vel.rg * 0.995;

  // force field contribution
  vec4 field = texture2D(uForceFieldTex, pos);
  vec2 force = field.rg * field.b * uFieldStrength;

  // ghost field — accumulated force from ALL ghost nodes (GhostNodes SDF pass sums every ghost)
  vec4  ghostField = texture2D(uGhostSDFTex, pos);
  force += ghostField.rg * uGhostStrength;
  // freeze channel: damp velocity proportional to accumulated freeze weight
  float freezeW = ghostField.b * uGhostStrength;
  if (freezeW > 0.001) v *= max(0.0, 1.0 - freezeW * uDt * 8.0);

  v = mix(force * uDt, v, uInertia);

  if (uBoundaryMode == 1) {
    vec2 next = pos + v * uDt;
    if (next.x < 0.0 || next.x > 1.0) v.x *= -0.8;
    if (next.y < 0.0 || next.y > 1.0) v.y *= -0.8;
  }

  gl_FragColor = vec4(v, 0.0, 0.0);
}
`;

function makeSimRT(dim) {
  return new THREE.WebGLRenderTarget(dim, dim, {
    format:        THREE.RGBAFormat,
    type:          THREE.FloatType,
    minFilter:     THREE.NearestFilter,
    magFilter:     THREE.NearestFilter,
    depthBuffer:   false,
    stencilBuffer: false,
  });
}

function makeSeedData(dim, mode = 'random') {
  const n      = dim * dim;
  const posAge = new Float32Array(n * 4);
  const vel    = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    if (mode === 'center') {
      posAge[i*4+0] = 0.5 + (Math.random() - 0.5) * 0.1;
      posAge[i*4+1] = 0.5 + (Math.random() - 0.5) * 0.1;
    } else {
      posAge[i*4+0] = Math.random();
      posAge[i*4+1] = Math.random();
    }
    posAge[i*4+2] = Math.random(); // stagger ages so not all die at once
    posAge[i*4+3] = 0.0;
    const angle  = Math.random() * Math.PI * 2;
    const speed  = Math.random() * 0.05;
    vel[i*4+0]   = Math.cos(angle) * speed;
    vel[i*4+1]   = Math.sin(angle) * speed;
    vel[i*4+2]   = 0.0;
    vel[i*4+3]   = 0.0;
  }
  return { posAge, vel };
}

export class ParticleGPU {
  constructor(renderer, count = 262144) {
    this._renderer = renderer;
    this._dim      = DIM;
    this._cur      = 0;

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this._scene.add(this._quad);

    this._blitMat = new THREE.RawShaderMaterial({
      vertexShader:   SIM_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { tInput: { value: null } },
    });

    this._matA = new THREE.RawShaderMaterial({
      vertexShader:   SIM_VERT,
      fragmentShader: PASS_A_FRAG,
      uniforms: {
        uPosAgeTex:    { value: null },
        uVelTex:       { value: null },
        uDt:           { value: 0.016 },
        uLifeDecay:    { value: 0.005 },
        uBoundaryMode: { value: 0 },
        uRespawnSeed:  { value: 0.0 },
        uEmitter:      { value: 0 },
        uEmitX:        { value: 0.5 },
        uEmitY:        { value: 0.5 },
        uSpread:       { value: 0.5 },
      },
    });

    const ffb = new Float32Array([0, 0, 0, 0]);
    this._fallbackForce = new THREE.DataTexture(ffb, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this._fallbackForce.needsUpdate = true;

    const gfb = new Float32Array([0, 0, 0, 0]);
    this._fallbackGhost = new THREE.DataTexture(gfb, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this._fallbackGhost.needsUpdate = true;

    this._matB = new THREE.RawShaderMaterial({
      vertexShader:   SIM_VERT,
      fragmentShader: PASS_B_FRAG,
      uniforms: {
        uPosAgeTex:     { value: null },
        uVelTex:        { value: null },
        uForceFieldTex: { value: null },
        uGhostSDFTex:   { value: null },
        uDt:            { value: 0.016 },
        uBoundaryMode:  { value: 0 },
        uFieldStrength: { value: 1.0 },
        uGhostStrength: { value: 1.0 },
        uInertia:       { value: 0.3 },
      },
    });

    this._posAgeRT = [makeSimRT(this._dim), makeSimRT(this._dim)];
    this._velRT    = [makeSimRT(this._dim), makeSimRT(this._dim)];

    this._initData();
  }

  _blit(srcTex, dstRT) {
    this._blitMat.uniforms.tInput.value = srcTex;
    this._quad.material = this._blitMat;
    this._renderer.setRenderTarget(dstRT);
    this._renderer.render(this._scene, this._camera);
  }

  _initData(mode = 'random') {
    const { posAge, vel } = makeSeedData(this._dim, mode);
    const dim = this._dim;

    const paTex = new THREE.DataTexture(posAge, dim, dim, THREE.RGBAFormat, THREE.FloatType);
    paTex.needsUpdate = true;
    const vTex  = new THREE.DataTexture(vel,    dim, dim, THREE.RGBAFormat, THREE.FloatType);
    vTex.needsUpdate = true;

    // upload to both ping-pong slots so first update() has valid reads on both sides
    this._blit(paTex, this._posAgeRT[0]);
    this._blit(paTex, this._posAgeRT[1]);
    this._blit(vTex,  this._velRT[0]);
    this._blit(vTex,  this._velRT[1]);

    this._renderer.setRenderTarget(null);
    paTex.dispose();
    vTex.dispose();
  }

  get posAgeTex() { return this._posAgeRT[this._cur].texture; }
  get velTex()    { return this._velRT[this._cur].texture; }

  // writes next slot; swap() advances _cur
  update(dt, forceFieldTex = null, ghostSDFTex = null) {
    const next = 1 - this._cur;

    const uA = this._matA.uniforms;
    uA.uPosAgeTex.value   = this._posAgeRT[this._cur].texture;
    uA.uVelTex.value      = this._velRT[this._cur].texture;
    uA.uDt.value          = dt;
    uA.uRespawnSeed.value = Math.random();
    this._quad.material   = this._matA;
    this._renderer.setRenderTarget(this._posAgeRT[next]);
    this._renderer.render(this._scene, this._camera);

    // Pass B reads the freshly-written posAge from [next]
    const uB = this._matB.uniforms;
    uB.uPosAgeTex.value     = this._posAgeRT[next].texture;
    uB.uVelTex.value        = this._velRT[this._cur].texture;
    uB.uForceFieldTex.value = forceFieldTex ?? this._fallbackForce;
    uB.uGhostSDFTex.value   = ghostSDFTex   ?? this._fallbackGhost;
    uB.uDt.value            = dt;
    this._quad.material     = this._matB;
    this._renderer.setRenderTarget(this._velRT[next]);
    this._renderer.render(this._scene, this._camera);

    this._renderer.setRenderTarget(null);
  }

  swap() {
    this._cur = 1 - this._cur;
  }

  respawn(mode = 'random') {
    this._initData(mode);
    this._cur = 0;
  }

  setCount(n) {
    const newDim = Math.ceil(Math.sqrt(n));
    if (newDim === this._dim) return;
    this._posAgeRT.forEach(rt => rt.dispose());
    this._velRT.forEach(rt => rt.dispose());
    this._dim      = newDim;
    this._posAgeRT = [makeSimRT(newDim), makeSimRT(newDim)];
    this._velRT    = [makeSimRT(newDim), makeSimRT(newDim)];
    this._cur      = 0;
    this._initData();
  }

  dispose() {
    this._posAgeRT.forEach(rt => rt.dispose());
    this._velRT.forEach(rt => rt.dispose());
    this._matA.dispose();
    this._matB.dispose();
    this._blitMat.dispose();
    this._quad.geometry.dispose();
    this._fallbackForce.dispose();
    this._fallbackGhost.dispose();
  }
}
