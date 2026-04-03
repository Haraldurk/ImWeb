/**
 * ImWeb SDF Generator
 * Raymarches two orbiting SDF metaballs into a WebGLRenderTarget.
 * Exposes .texture for use as a pipeline source (Foreground / Background / Displacement).
 *
 * Parameters: sdf.active (toggle), sdf.blend (melt factor k), sdf.distance (orbit radius)
 */

import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform float uTime;
uniform float uBlend;
uniform float uDistance;
varying vec2 vUv;

// Polynomial smooth-min — the "melting" function (Inigo Quilez)
// max(uBlend, 0.001) guards against divide-by-zero when blend=0
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k / 6.0;
}

float sdSphere(vec3 p, float r) { return length(p) - r; }

float scene(vec3 p) {
  float ang = uTime * 0.8;
  float rad = uDistance * 0.35;
  // Lissajous-like orbit: frequencies 0.8, 0.56, 0.32 — never perfectly periodic
  vec3 cA = vec3( cos(ang) * rad,  sin(ang * 0.7) * 0.3,  sin(ang * 0.4) * 0.2);
  vec3 cB = vec3(-cos(ang) * rad, -sin(ang * 0.7) * 0.3,  cos(ang * 0.4) * 0.2);
  return smin(sdSphere(p - cA, 0.6), sdSphere(p - cB, 0.6), max(uBlend, 0.001));
}

// 6-sample central-difference normal
vec3 calcNormal(vec3 p) {
  float e = 0.001;
  return normalize(vec3(
    scene(p + vec3(e,0,0)) - scene(p - vec3(e,0,0)),
    scene(p + vec3(0,e,0)) - scene(p - vec3(0,e,0)),
    scene(p + vec3(0,0,e)) - scene(p - vec3(0,0,e))
  ));
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  vec3 ro  = vec3(0.0, 0.0, 3.0);
  vec3 rd  = normalize(vec3(uv * 1.5, -2.0)); // perspective ~75° FOV

  float t = 0.0;
  float d = 0.0;
  for (int i = 0; i < 80; i++) {
    d = scene(ro + rd * t);
    if (d < 0.001 || t > 8.0) break;
    t += d;
  }

  if (d < 0.001) {
    vec3  p     = ro + rd * t;
    vec3  n     = calcNormal(p);
    vec3  light = normalize(vec3(1.0, 1.5, 2.0));
    float diff  = clamp(dot(n, light), 0.0, 1.0);
    float spec  = pow(clamp(dot(reflect(-light, n), -rd), 0.0, 1.0), 32.0);
    // Blue-magenta tint for distinct visual identity
    vec3  col   = vec3(0.15 + diff * 0.7 + spec * 0.4,
                       0.05 + diff * 0.35,
                       0.25 + diff * 0.6 + spec * 0.2);
    gl_FragColor = vec4(col, 1.0);
  } else {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  }
}
`;

export class SDFGenerator {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this._time    = 0;
    this.active   = false;

    this._rt = new THREE.WebGLRenderTarget(width, height, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    });

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime:     { value: 0 },
        uBlend:    { value: 0.5 },
        uDistance: { value: 1.5 },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      depthTest:  false,
      depthWrite: false,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat));
  }

  tick(ps, dt) {
    this.active = !!ps.get('sdf.active').value;
    if (!this.active) return;

    this._time += dt;
    const u       = this._mat.uniforms;
    u.uTime.value     = this._time;
    u.uBlend.value    = ps.get('sdf.blend').value;
    u.uDistance.value = ps.get('sdf.distance').value;

    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this._rt.texture; }

  resize(w, h) { this._rt.setSize(w, h); }

  dispose() {
    this._rt.dispose();
    this._mat.dispose();
    this._scene.children[0].geometry.dispose();
  }
}
