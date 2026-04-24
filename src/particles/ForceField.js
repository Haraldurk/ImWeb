import * as THREE       from "three";
import { ForceFormulas } from './ForceFormulas.js';

const FORCE_SIZE = 256;

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

// Layer 1: luma gradient of source texture
const GRADIENT_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uSourceTex;
uniform vec2  uSourceTexelSize;
uniform float uStrength;
uniform float uInvert;
varying vec2 vUv;

float luma(vec4 c) { return dot(c.rgb, vec3(0.299, 0.587, 0.114)); }

void main() {
  float L  = luma(texture2D(uSourceTex, vUv));
  float Lx = luma(texture2D(uSourceTex, vUv + vec2(uSourceTexelSize.x, 0.0)));
  float Ly = luma(texture2D(uSourceTex, vUv + vec2(0.0, uSourceTexelSize.y)));
  vec2  raw = vec2(Lx - L, Ly - L);
  float mag = length(raw);
  vec2  dir = mag > 0.0001 ? raw / mag : vec2(0.0);
  if (uInvert > 0.5) dir = -dir;
  gl_FragColor = vec4(dir, mag * uStrength, 0.0);
}
`;

// Layer 2: curl noise (direction always normalized, magnitude always 1.0)
const CURL_FRAG = `
precision highp float;
uniform float uTime;
uniform float uScale;
uniform float uSpeed;
varying vec2 vUv;

${ForceFormulas.getGLSL(ForceFormulas.CURL_NOISE)}

void main() {
  vec2  c   = curlNoise(vUv, uTime, uScale, uSpeed);
  float mag = length(c);
  vec2  dir = mag > 0.001 ? c / mag : vec2(0.0);
  gl_FragColor = vec4(dir, 1.0, 0.0);
}
`;

// Compositor: weighted sum of 3 layers (weights pre-normalized to sum 1.0 by CPU)
const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform sampler2D uLayer3;
uniform float uW1;
uniform float uW2;
uniform float uW3;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uLayer1, vUv) * uW1
               + texture2D(uLayer2, vUv) * uW2
               + texture2D(uLayer3, vUv) * uW3;
}
`;

// Layer 2b: Lorenz attractor flow field
const LORENZ_FRAG = `
precision highp float;
uniform float uTime;
uniform float uRho;
uniform float uSigma;
uniform float uBeta;
varying vec2 vUv;

${ForceFormulas.getGLSL(ForceFormulas.LORENZ)}

void main() {
  vec2 dir = lorenzFlow(vUv, uTime, uRho, uSigma, uBeta);
  float m  = length(dir);
  gl_FragColor = vec4(m > 0.001 ? dir / m : vec2(0.0), 0.8, 0.0);
}
`;

// Layer 2c: magnetic dipole field (poles set from videoAnalysis.brightPeaks)
const MAGNETIC_FRAG = `
precision highp float;
varying vec2 vUv;

${ForceFormulas.getGLSL(ForceFormulas.MAGNETIC)}

void main() {
  vec2 dir = magneticFlow(vUv);
  float m  = length(dir);
  gl_FragColor = vec4(m > 0.001 ? dir / m : vec2(0.0, 1.0), 0.6, 0.0);
}
`;

// Layer 3: N-body / boids (samples 32 random neighbors from simulation textures)
const NBODY_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uNBodyPosTex;
uniform sampler2D uNBodyVelTex;
uniform float uAttractRadius;
uniform float uFalloffExp;
uniform float uNBodyMode;
uniform float uNBodyTime;
varying vec2 vUv;

vec2 _nb_hash2(vec2 p){ return fract(sin(vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3))))*43758.5); }

vec2 nbodyForce(vec2 pos, vec2 vel) {
  vec2 acc=vec2(0.0), alignSum=vec2(0.0); float count=0.0;
  for(int i=0;i<32;i++){
    vec2 ruv=_nb_hash2(vec2(float(i)*0.017, uNBodyTime*0.001+float(i)*0.031));
    vec2 op=texture2D(uNBodyPosTex,ruv).rg, ov=texture2D(uNBodyVelTex,ruv).rg;
    vec2 delta=op-pos; float d=length(delta);
    if(d<uAttractRadius && d>0.001){
      float f=1.0/pow(d,uFalloffExp);
      acc+=normalize(delta)*f*(1.0-uNBodyMode*2.0);
      alignSum+=ov; count+=1.0;
    }
  }
  if(count>0.0 && uNBodyMode>0.3 && uNBodyMode<0.7){
    vec2 avg=alignSum/count; float al=length(avg);
    if(al>0.001) acc=mix(acc, avg/al*0.5, 0.6);
  }
  return acc*0.01;
}

void main() {
  vec4 vel = texture2D(uNBodyVelTex, vUv);
  vec2 acc = nbodyForce(vUv, vel.rg);
  float m  = length(acc);
  vec2 dir = m > 0.001 ? acc / m : vec2(0.0);
  gl_FragColor = vec4(dir, clamp(m * 50.0, 0.0, 1.0), 0.0);
}
`;

function makeForceRT() {
  return new THREE.WebGLRenderTarget(FORCE_SIZE, FORCE_SIZE, {
    format:        THREE.RGBAFormat,
    type:          THREE.FloatType,
    minFilter:     THREE.LinearFilter,
    magFilter:     THREE.LinearFilter,
    depthBuffer:   false,
    stencilBuffer: false,
  });
}

export class ForceField {
  constructor(renderer) {
    this._renderer = renderer;

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this._scene.add(this._quad);

    this._layer1RT    = makeForceRT();
    this._layer2RT    = makeForceRT();
    this._layer3RT    = makeForceRT();
    this._compositeRT = makeForceRT();

    this._matGradient = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: GRADIENT_FRAG,
      uniforms: {
        uSourceTex:       { value: null },
        uSourceTexelSize: { value: new THREE.Vector2(1 / 256, 1 / 256) },
        uStrength:        { value: 50.0 },
        uInvert:          { value: 0.0 },
      },
    });

    this._matCurl = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: CURL_FRAG,
      uniforms: {
        uTime:  { value: 0.0 },
        uScale: { value: 3.0 },
        uSpeed: { value: 0.5 },
      },
    });

    this._matLorenz = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: LORENZ_FRAG,
      uniforms: {
        uTime:  { value: 0.0 },
        uRho:   { value: 28.0 },
        uSigma: { value: 10.0 },
        uBeta:  { value: 2.67 },
      },
    });

    // Persistent typed arrays — mutated in composite(), uploaded via gl.uniform2fv / gl.uniform1fv
    this._magneticPoles    = new Float32Array(16); // 8 × vec2
    this._magneticPolarity = new Float32Array(8);

    this._matMagnetic = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: MAGNETIC_FRAG,
      uniforms: {
        uPoles:     { value: this._magneticPoles },
        uPolarity:  { value: this._magneticPolarity },
        uPoleCount: { value: 0 },
      },
    });

    this._matNBody = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: NBODY_FRAG,
      uniforms: {
        uNBodyPosTex:   { value: null },
        uNBodyVelTex:   { value: null },
        uAttractRadius: { value: 0.1 },
        uFalloffExp:    { value: 2.0 },
        uNBodyMode:     { value: 0.0 },
        uNBodyTime:     { value: 0.0 },
      },
    });

    this._matComposite = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uLayer1: { value: null },
        uLayer2: { value: null },
        uLayer3: { value: null },
        uW1:     { value: 0.4 },
        uW2:     { value: 0.3 },
        uW3:     { value: 0.3 },
      },
    });
  }

  // Returns the composite WebGLRenderTarget; also accessible via get forceFieldTex()
  // flowFormula: 0=curl, 1=lorenz, 2=magnetic
  composite({
    sourceTex, sourceDims,
    posAgeTex, velTex,
    weights,
    time,
    flowFormula = 0,
    lorenz      = { rho: 28, sigma: 10, beta: 2.67 },
    poles       = [],
    nbody       = { attractRadius: 0.1, falloffExp: 2, mode: 0 },
  }) {
    const { gradient = 0.4, flow = 0.3, nbody: nbodyW = 0.3 } = weights;
    const total = (gradient + flow + nbodyW) || 1.0;
    const w1    = gradient / total;
    const w2    = flow     / total;
    const w3    = nbodyW   / total;

    // Layer 1: luma gradient
    const uG = this._matGradient.uniforms;
    uG.uSourceTex.value = sourceTex;
    uG.uSourceTexelSize.value.set(1 / sourceDims.w, 1 / sourceDims.h);
    this._quad.material = this._matGradient;
    this._renderer.setRenderTarget(this._layer1RT);
    this._renderer.render(this._scene, this._camera);

    // Layer 2: selected flow formula
    if (flowFormula === 1) {
      const uL = this._matLorenz.uniforms;
      uL.uTime.value  = time;
      uL.uRho.value   = lorenz.rho;
      uL.uSigma.value = lorenz.sigma;
      uL.uBeta.value  = lorenz.beta;
      this._quad.material = this._matLorenz;
    } else if (flowFormula === 2) {
      const numPoles = Math.min(poles.length, 8);
      this._magneticPoles.fill(0);
      this._magneticPolarity.fill(0);
      for (let i = 0; i < numPoles; i++) {
        this._magneticPoles[i*2]   = poles[i].x;
        this._magneticPoles[i*2+1] = poles[i].y;
        this._magneticPolarity[i]  = i % 2 === 0 ? 1.0 : -1.0;
      }
      this._matMagnetic.uniforms.uPoleCount.value = numPoles;
      this._quad.material = this._matMagnetic;
    } else {
      this._matCurl.uniforms.uTime.value = time;
      this._quad.material = this._matCurl;
    }
    this._renderer.setRenderTarget(this._layer2RT);
    this._renderer.render(this._scene, this._camera);

    // Layer 3: N-body / boids
    const uN = this._matNBody.uniforms;
    uN.uNBodyPosTex.value   = posAgeTex;
    uN.uNBodyVelTex.value   = velTex;
    uN.uAttractRadius.value = nbody.attractRadius;
    uN.uFalloffExp.value    = nbody.falloffExp;
    uN.uNBodyMode.value     = nbody.mode;
    uN.uNBodyTime.value     = time;
    this._quad.material = this._matNBody;
    this._renderer.setRenderTarget(this._layer3RT);
    this._renderer.render(this._scene, this._camera);

    // Composite: L1*w1 + L2*w2 + L3*w3
    const uC = this._matComposite.uniforms;
    uC.uLayer1.value = this._layer1RT.texture;
    uC.uLayer2.value = this._layer2RT.texture;
    uC.uLayer3.value = this._layer3RT.texture;
    uC.uW1.value     = w1;
    uC.uW2.value     = w2;
    uC.uW3.value     = w3;
    this._quad.material = this._matComposite;
    this._renderer.setRenderTarget(this._compositeRT);
    this._renderer.render(this._scene, this._camera);

    this._renderer.setRenderTarget(null);
    return this._compositeRT;
  }

  get forceFieldTex() { return this._compositeRT.texture; }

  dispose() {
    this._layer1RT.dispose();
    this._layer2RT.dispose();
    this._layer3RT.dispose();
    this._compositeRT.dispose();
    this._matGradient.dispose();
    this._matCurl.dispose();
    this._matLorenz.dispose();
    this._matMagnetic.dispose();
    this._matNBody.dispose();
    this._matComposite.dispose();
    this._quad.geometry.dispose();
  }
}
