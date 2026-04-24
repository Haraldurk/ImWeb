import * as THREE from "three";

const COUNT = 262144;
const DIM   = 512; // ceil(sqrt(262144))

const QUAD_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FADE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uTrailTex;
uniform float     uTrailDecay;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uTrailTex, vUv) * uTrailDecay;
}
`;

const POINTS_VERT = /* glsl */`
precision highp float;
attribute float aIndex;
uniform sampler2D uPosAgeTex;
uniform sampler2D uVelTex;
uniform sampler2D uForceFieldTex;
uniform float uDim;
uniform float uPointSize;
varying float vAge;
varying vec2  vVel;
varying vec2  vPos;
varying vec2  vFieldDir;
void main() {
  vec2 texUV  = vec2(mod(aIndex, uDim), floor(aIndex / uDim)) / uDim;
  vec4 pa     = texture2D(uPosAgeTex, texUV);
  vec4 vel    = texture2D(uVelTex,    texUV);
  vAge      = pa.b;
  vVel      = vel.rg;
  vPos      = pa.rg;
  vFieldDir = texture2D(uForceFieldTex, pa.rg).rg;
  if (vAge >= 1.0) {
    gl_Position  = vec4(-99.0, -99.0, 0.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position  = vec4(pa.rg * 2.0 - 1.0, 0.0, 1.0);
  gl_PointSize = uPointSize * (1.0 - vAge * 0.5);
}
`;

const POINTS_FRAG = /* glsl */`
precision highp float;
uniform int       uColorMode;
uniform sampler2D uSourceTex;
varying float vAge;
varying vec2  vVel;
varying vec2  vPos;
varying vec2  vFieldDir;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  if (length(pc) > 0.5) discard;
  vec3 col;
  if (uColorMode == 0) {
    // Velocity — cool→warm
    float speed = length(vVel);
    col = mix(vec3(0.1, 0.2, 0.8), vec3(1.0, 0.3, 0.1), clamp(speed / 3.0, 0.0, 1.0));
  } else if (uColorMode == 1) {
    // Age — bright when new, dark when old
    col = mix(vec3(1.0, 0.9, 0.7), vec3(0.1, 0.1, 0.3), vAge);
  } else if (uColorMode == 2) {
    // Field alignment — blue↔yellow by how well vel tracks the force field direction
    vec2 v = normalize(vVel      + vec2(0.0001));
    vec2 f = normalize(vFieldDir + vec2(0.0001));
    float align = dot(v, f) * 0.5 + 0.5;
    col = mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 0.8, 0.0), align);
  } else {
    // Video sample at particle position
    col = texture2D(uSourceTex, vPos).rgb;
  }
  gl_FragColor = vec4(col, 1.0 - vAge * 0.5);
}
`;

function makeTrailRT(w, h) {
  return new THREE.WebGLRenderTarget(w, h, {
    format:        THREE.RGBAFormat,
    type:          THREE.UnsignedByteType,
    minFilter:     THREE.LinearFilter,
    magFilter:     THREE.LinearFilter,
    depthBuffer:   false,
    stencilBuffer: false,
  });
}

export class ParticleRender {
  constructor(renderer, width, height) {
    this._renderer = renderer;
    this._trailCur = 0;
    this._trailRT  = [makeTrailRT(width, height), makeTrailRT(width, height)];

    this._camera      = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fadeScene   = new THREE.Scene();
    this._pointsScene = new THREE.Scene();

    // --- fade quad ---
    this._fadeMat = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: FADE_FRAG,
      uniforms: {
        uTrailTex:   { value: null },
        uTrailDecay: { value: 0.93 },
      },
      depthTest:  false,
      depthWrite: false,
    });
    const fadeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._fadeMat);
    this._fadeScene.add(fadeQuad);

    // --- points mesh ---
    const idx = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) idx[i] = i;
    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('aIndex', new THREE.BufferAttribute(idx, 1));
    pointsGeo.setDrawRange(0, COUNT);

    this._pointsMat = new THREE.RawShaderMaterial({
      vertexShader:   POINTS_VERT,
      fragmentShader: POINTS_FRAG,
      uniforms: {
        uPosAgeTex:     { value: null },
        uVelTex:        { value: null },
        uForceFieldTex: { value: null },
        uSourceTex:     { value: null },
        uDim:           { value: DIM },
        uPointSize:     { value: 2.0 },
        uColorMode:     { value: 0 },
      },
      blending:    THREE.AdditiveBlending,
      depthTest:   false,
      depthWrite:  false,
      transparent: true,
    });
    const pointsMesh = new THREE.Points(pointsGeo, this._pointsMat);
    pointsMesh.frustumCulled = false;
    this._pointsScene.add(pointsMesh);

    this.texture = this._trailRT[0].texture;
  }

  draw(posAgeTex, velTex, colorMode = 0, sourceTex = null, forceFieldTex = null) {
    const prevAutoClear = this._renderer.autoClear;
    this._renderer.autoClear = false;

    const next = 1 - this._trailCur;

    // fade pass: read trailRT[cur] → write trailRT[next]
    this._fadeMat.uniforms.uTrailTex.value    = this._trailRT[this._trailCur].texture;
    this._renderer.setRenderTarget(this._trailRT[next]);
    this._renderer.render(this._fadeScene, this._camera);

    // point pass: additive on top of faded trail
    this._pointsMat.uniforms.uPosAgeTex.value     = posAgeTex;
    this._pointsMat.uniforms.uVelTex.value        = velTex;
    this._pointsMat.uniforms.uForceFieldTex.value = forceFieldTex;
    this._pointsMat.uniforms.uSourceTex.value     = sourceTex;
    this._pointsMat.uniforms.uColorMode.value     = colorMode;
    this._renderer.setRenderTarget(this._trailRT[next]);
    this._renderer.render(this._pointsScene, this._camera);

    this._renderer.setRenderTarget(null);
    this._trailCur = next;
    this.texture   = this._trailRT[this._trailCur].texture;

    this._renderer.autoClear = prevAutoClear;
  }

  resize(w, h) {
    this._trailRT.forEach(rt => rt.dispose());
    this._trailRT  = [makeTrailRT(w, h), makeTrailRT(w, h)];
    this._trailCur = 0;
    this.texture   = this._trailRT[0].texture;
  }

  dispose() {
    this._trailRT.forEach(rt => rt.dispose());
    this._fadeMat.dispose();
    this._pointsMat.dispose();
    this._fadeScene.children[0]?.geometry.dispose();
    this._pointsScene.children[0]?.geometry.dispose();
  }
}
