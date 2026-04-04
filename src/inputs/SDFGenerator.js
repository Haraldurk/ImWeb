/**
 * ImWeb SDF Generator — Phase 2
 * Raymarches two orbiting SDF metaballs into a WebGLRenderTarget.
 * Exposes .texture for use as a pipeline source (Foreground / Background / Displacement).
 *
 * Parameters:
 *   sdf.active   — toggle rendering
 *   sdf.blend    — smin melt factor k
 *   sdf.distance — orbit radius (world units, or cell fraction when repeat > 0)
 *   sdf.shape    — primitive: 0=Sphere, 1=Box, 2=Torus
 *   sdf.repeat   — domain repetition cell spacing; 0 = off
 *   sdf.warp     — surface displacement amplitude
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
uniform float uShape;    // 0=Sphere, 1=Box, 2=Torus (float for WebGL compat)
uniform float uRepeat;   // domain repetition spacing; 0 = off
uniform float uWarp;     // surface displacement amplitude
uniform vec3  uSDFCamPos; // camera position; always looks at origin
varying vec2 vUv;

// ── SDF primitives ───────────────────────────────────────────────────────────
float sdSphere(vec3 p, float r) {
  return length(p) - r;
}

float sdBox(vec3 p, vec3 b) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0);
}

float sdTorus(vec3 p, vec2 t) {
  // t.x = major radius, t.y = minor radius
  return length(vec2(length(p.xz) - t.x, p.y)) - t.y;
}

float sdShape(vec3 p) {
  if (uShape > 1.5) return sdTorus(p, vec2(0.45, 0.18));
  if (uShape > 0.5) return sdBox(p, vec3(0.42));
  return sdSphere(p, 0.6);
}

// ── Smooth-min (Inigo Quilez polynomial) ────────────────────────────────────
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k / 6.0;
}

// ── Scene SDF ────────────────────────────────────────────────────────────────
float scene(vec3 p) {
  // Domain repetition: fold space into repeating cells.
  // Guard uRepeat > 0.1 to avoid mod(p, 0) undefined behaviour.
  vec3 q = (uRepeat > 0.1)
    ? mod(p + 0.5 * uRepeat, uRepeat) - 0.5 * uRepeat
    : p;

  // Orbit radius — when repeating, derive from cell spacing so shapes stay in-cell.
  float rad = (uRepeat > 0.1) ? uRepeat * 0.3 : uDistance * 0.35;
  float ang = uTime * 0.8;
  vec3 cA   = vec3( cos(ang) * rad,  sin(ang * 0.7) * 0.3,  sin(ang * 0.4) * 0.2);
  vec3 cB   = vec3(-cos(ang) * rad, -sin(ang * 0.7) * 0.3,  cos(ang * 0.4) * 0.2);

  float d1 = smin(sdShape(q - cA), sdShape(q - cB), max(uBlend, 0.001));

  // Surface displacement: sin-product warp on the distance field.
  // Uses q (cell-local) so displacement tiles cleanly with repetition.
  float displacement = sin(uTime + q.x * 5.0)
                     * sin(uTime + q.y * 5.0)
                     * sin(uTime + q.z * 5.0)
                     * uWarp;
  return d1 + displacement;
}

// ── Normal (6-sample central differences) ────────────────────────────────────
// epsilon 0.002 (vs 0.001) smooths normals across high-frequency displaced surfaces
vec3 calcNormal(vec3 p) {
  float e = 0.002;
  return normalize(vec3(
    scene(p + vec3(e,0,0)) - scene(p - vec3(e,0,0)),
    scene(p + vec3(0,e,0)) - scene(p - vec3(0,e,0)),
    scene(p + vec3(0,0,e)) - scene(p - vec3(0,0,e))
  ));
}

// ── LookAt camera ────────────────────────────────────────────────────────────
// Builds a 3×3 rotation matrix so the camera at 'eye' points at 'target'.
// rd = mat * normalize(vec3(uv, -focalLength))
mat3 lookAt(vec3 eye, vec3 target, vec3 up) {
  vec3 f = normalize(target - eye);
  vec3 r = normalize(cross(f, up));
  vec3 u = cross(r, f);
  return mat3(r, u, -f);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;

  // Guard: if the camera sits exactly on the origin the lookAt up-vector
  // degenerates when eye==target. Nudge Z by a tiny epsilon to stay safe.
  vec3 ro  = uSDFCamPos;
  if (length(ro) < 0.001) ro = vec3(0.0, 0.0, 0.001);

  mat3 cam = lookAt(ro, vec3(0.0), vec3(0.0, 1.0, 0.0));
  vec3 rd  = cam * normalize(vec3(uv * 0.75, -1.0)); // ~75° FOV (focal = 1/tan(37.5°) ≈ 1.33, uv scaled 0.75)

  // Conservative step scaling: displacement inflates the Lipschitz constant
  // by up to 5 * uWarp. Dividing by (1 + uWarp * 2.5) keeps the marcher
  // stable at all warp values. At uWarp=0, stepScale=1.0 — zero cost.
  float stepScale = 1.0 / (1.0 + uWarp * 2.5);

  // tMax: march at least to origin + generous margin so far cameras still hit.
  float tMax = length(ro) + 8.0;
  float t = 0.0;
  float d = 0.0;
  for (int i = 0; i < 96; i++) {
    d = scene(ro + rd * t);
    if (d < 0.001 || t > tMax) break;
    t += max(d, 0.001) * stepScale;
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
        uTime:       { value: 0 },
        uBlend:      { value: 0.5 },
        uDistance:   { value: 1.5 },
        uShape:      { value: 0 },
        uRepeat:     { value: 0 },
        uWarp:       { value: 0 },
        uSDFCamPos:  { value: new THREE.Vector3(0, 0, 5) },
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
    u.uShape.value    = ps.get('sdf.shape').value;
    u.uRepeat.value   = ps.get('sdf.repeat').value;
    u.uWarp.value     = ps.get('sdf.warp').value;
    u.uSDFCamPos.value.set(
      ps.get('sdf.camX').value,
      ps.get('sdf.camY').value,
      ps.get('sdf.camZ').value,
    );

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
