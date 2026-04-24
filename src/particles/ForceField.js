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

// Compositor: weighted sum of layers (weights pre-normalized to sum 1.0 by CPU)
const COMPOSITE_FRAG = /* glsl */`
precision highp float;
uniform sampler2D uLayer1;
uniform sampler2D uLayer2;
uniform float uW1;
uniform float uW2;
varying vec2 vUv;
void main() {
  gl_FragColor = texture2D(uLayer1, vUv) * uW1 + texture2D(uLayer2, vUv) * uW2;
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
    this._compositeRT = makeForceRT();

    this._matGradient = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: GRADIENT_FRAG,
      uniforms: {
        uSourceTex:      { value: null },
        uSourceTexelSize: { value: new THREE.Vector2(1 / 256, 1 / 256) },
        uStrength:       { value: 50.0 },
        uInvert:         { value: 0.0 },
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

    this._matComposite = new THREE.RawShaderMaterial({
      vertexShader:   QUAD_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        uLayer1: { value: null },
        uLayer2: { value: null },
        uW1:     { value: 0.6 },
        uW2:     { value: 0.4 },
      },
    });
  }

  // Returns the composite WebGLRenderTarget; also accessible via get forceFieldTex()
  composite({ sourceTex, sourceDims, posAgeTex, velTex, weights, time }) {
    const { gradient = 0.6, flow = 0.4 } = weights;
    const total = gradient + flow || 1.0;
    const w1    = gradient / total;
    const w2    = flow     / total;

    // Layer 1: gradient
    const uG = this._matGradient.uniforms;
    uG.uSourceTex.value = sourceTex;
    uG.uSourceTexelSize.value.set(1 / sourceDims.w, 1 / sourceDims.h);
    this._quad.material = this._matGradient;
    this._renderer.setRenderTarget(this._layer1RT);
    this._renderer.render(this._scene, this._camera);

    // Layer 2: curl noise
    this._matCurl.uniforms.uTime.value = time;
    this._quad.material = this._matCurl;
    this._renderer.setRenderTarget(this._layer2RT);
    this._renderer.render(this._scene, this._camera);

    // Composite
    const uC = this._matComposite.uniforms;
    uC.uLayer1.value = this._layer1RT.texture;
    uC.uLayer2.value = this._layer2RT.texture;
    uC.uW1.value     = w1;
    uC.uW2.value     = w2;
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
    this._compositeRT.dispose();
    this._matGradient.dispose();
    this._matCurl.dispose();
    this._matComposite.dispose();
    this._quad.geometry.dispose();
  }
}
