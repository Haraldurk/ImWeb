/**
 * ImWeb SDF Generator — Phase 2
 * Raymarches two orbiting SDF metaballs into a WebGLRenderTarget.
 * Exposes .texture for use as a pipeline source (Foreground / Background / Displacement).
 *
 * Parameters:
 *   sdf.active   — toggle rendering
 *   sdf.opMode   — 0=Union, 1=Smooth Union, 2=Subtraction, 3=Intersection
 *   sdf.opAmount — smooth blend radius 0–1
 *   sdf.distance — orbit radius (world units, or cell fraction when repeat > 0)
 *   sdf.shape    — 0=Sphere,1=Box,2=Torus,3=Capsule,4=HexPrism,5=Octahedron,6=Link,7=Mandelbulb
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
uniform float uSdfOpMode;   // 0=Union, 1=Smooth Union, 2=Subtraction, 3=Intersection
uniform float uSdfOpAmount; // blend / smooth radius 0–1
uniform float uDistance;
uniform float uShape;    // 0=Sphere,1=Box,2=Torus,3=Capsule,4=HexPrism,5=Octahedron,6=Link,7=Mandelbulb
uniform float uRepeat;   // domain repetition spacing; 0 = off
uniform float uWarp;      // surface displacement amplitude
uniform vec3  uSDFCamPos; // camera position; always looks at origin
uniform float uKifsIter;    // KIFS fold iterations 0–5 (float for WebGL compat)
uniform float uKifsAngle;   // KIFS rotation angle (radians)
uniform float uLumaWarp;    // video luma displacement amplitude
uniform float uSdfSpeed;    // animation time scale (0 = freeze)
uniform float uLumaThresh;  // smoothstep low edge — cuts noise below this luma
uniform float uTexBlend;    // 0=base material, 1=triplanar video texture
uniform float uAO;          // ambient occlusion strength (0=off, 1=full)
uniform float uGlow;        // step-count glow intensity
uniform vec3  uBaseHSV;     // base material color (hue 0–1, sat 0–1, val 0–1)
uniform float uRefract;     // glass refraction strength
uniform float uFresnel;     // Fresnel edge rim strength
uniform vec2  uResolution;  // render target size in pixels
uniform sampler2D uFgTex;   // foreground video texture (luma warp + triplanar)
uniform sampler2D uBgTex;   // background layer texture for refraction
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
  return length(vec2(length(p.xz) - t.x, p.y)) - t.y;
}

// Capsule between two points
float sdCapsule(vec3 p, vec3 a, vec3 b, float r) {
  vec3 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h) - r;
}

// Hexagonal prism (IQ)
float sdHexPrism(vec3 p, vec2 h) {
  const vec3 k = vec3(-0.8660254, 0.5, 0.57735);
  p = abs(p);
  p.xy -= 2.0 * min(dot(k.xy, p.xy), 0.0) * k.xy;
  vec2 d = vec2(
    length(p.xy - vec2(clamp(p.x, -k.z * h.x, k.z * h.x), h.x)) * sign(p.y - h.x),
    p.z - h.y
  );
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Octahedron (IQ exact)
float sdOctahedron(vec3 p, float s) {
  p = abs(p);
  float m = p.x + p.y + p.z - s;
  vec3 q;
  if      (3.0 * p.x < m) q = p.xyz;
  else if (3.0 * p.y < m) q = p.yzx;
  else if (3.0 * p.z < m) q = p.zxy;
  else return m * 0.57735027;
  float k = clamp(0.5 * (q.z - q.y + s), 0.0, s);
  return length(vec3(q.x, q.y - s + k, q.z - k));
}

// Link (chain-link torus variant)
float sdLink(vec3 p, float le, float r1, float r2) {
  vec3 q = vec3(p.x, max(abs(p.y) - le, 0.0), p.z);
  return length(vec2(length(q.xy) - r1, q.z)) - r2;
}

// Mandelbulb distance estimator (power 7, 6 iterations)
float sdMandelbulb(vec3 pos) {
  vec3 z = pos;
  float dr = 1.0, r = 0.0;
  for (int i = 0; i < 6; i++) {
    r = length(z);
    if (r > 2.0) break;
    float theta = acos(z.z / r);
    float phi   = atan(z.y, z.x);
    float zr    = pow(r, 7.0);
    dr = pow(r, 6.0) * 7.0 * dr + 1.0;
    z  = zr * vec3(sin(theta * 7.0) * cos(phi * 7.0),
                   sin(phi   * 7.0) * sin(theta * 7.0),
                   cos(theta * 7.0)) + pos;
  }
  return 0.5 * log(r) * r / dr;
}

float sdShape(vec3 p) {
  if      (uShape < 0.5) return sdSphere(p, 0.6);
  else if (uShape < 1.5) return sdBox(p, vec3(0.42));
  else if (uShape < 2.5) return sdTorus(p, vec2(0.45, 0.18));
  else if (uShape < 3.5) return sdCapsule(p, vec3(0.0, -0.3, 0.0), vec3(0.0, 0.3, 0.0), 0.25);
  else if (uShape < 4.5) return sdHexPrism(p, vec2(0.4, 0.2));
  else if (uShape < 5.5) return sdOctahedron(p, 0.7);
  else if (uShape < 6.5) return sdLink(p, 0.3, 0.3, 0.12);
  else                   return sdMandelbulb(p * 1.2) * 0.8;
}

// ── Smooth-min (Inigo Quilez polynomial) ────────────────────────────────────
float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * h * k / 6.0;
}

// ── Smooth subtraction (d2 carves into d1) ──────────────────────────────────
float opSmoothSub(float d1, float d2, float k) {
  float h = max(k - abs(-d2 - d1), 0.0) / k;
  return max(-d2, d1) + h * h * h * k / 6.0;
}

// ── 2D rotation helper ───────────────────────────────────────────────────────
mat2 rot2D(float a) {
  float s = sin(a), c = cos(a);
  return mat2(c, -s, s, c);
}

// ── Scene SDF ────────────────────────────────────────────────────────────────
float scene(vec3 p) {
  // Domain repetition: fold space into repeating cells.
  // Guard uRepeat > 0.1 to avoid mod(p, 0) undefined behaviour.
  vec3 q = (uRepeat > 0.1)
    ? mod(p + 0.5 * uRepeat, uRepeat) - 0.5 * uRepeat
    : p;

  // KIFS folding — Kaleidoscopic Iterated Function System.
  // Each iteration: mirror all axis planes (abs), then rotate xy and xz to
  // misalign successive folds and generate fractal complexity.
  // Uses a fixed loop bound (5) with a float break for WebGL 1 compatibility.
  // At uKifsIter == 0 the loop body never runs — zero behaviour change.
  vec3 kp = q;
  for (int ki = 0; ki < 5; ki++) {
    if (float(ki) >= uKifsIter) break;
    kp = abs(kp) - vec3(1.0);
    kp.xy = rot2D(uKifsAngle) * kp.xy;
    kp.xz = rot2D(uKifsAngle) * kp.xz;
  }

  // Orbit radius — when repeating, derive from cell spacing so shapes stay in-cell.
  float rad = (uRepeat > 0.1) ? uRepeat * 0.3 : uDistance * 0.35;
  float ang = uTime * 0.8 * uSdfSpeed;
  vec3 cA   = vec3( cos(ang) * rad,  sin(ang * 0.7) * 0.3,  sin(ang * 0.4) * 0.2);
  vec3 cB   = vec3(-cos(ang) * rad, -sin(ang * 0.7) * 0.3,  cos(ang * 0.4) * 0.2);

  float dA = sdShape(kp - cA);
  float dB = sdShape(kp - cB);
  // k scales opAmount from [0,1] into a useful blend radius.
  // For Soft Cut, uSdfOpAmount=0 means no cut; =1 means deep bite.
  float k  = max(uSdfOpAmount, 0.001);
  float d1;
  if (uSdfOpMode < 0.5) {
    // Union: hard min, no blending
    d1 = min(dA, dB);
  } else if (uSdfOpMode < 1.5) {
    // Smooth Union: polynomial smooth-min blend
    d1 = smin(dA, dB, k);
  } else if (uSdfOpMode < 2.5) {
    // Subtraction: dB carves into dA
    d1 = opSmoothSub(dA, dB, k);
  } else {
    // Intersection: smooth intersection (negate both, smin, negate result)
    d1 = -smin(-dA, -dB, k);
  }

  // Surface displacement: sin-product warp on the distance field.
  // Uses q (cell-local) so displacement tiles cleanly with repetition.
  float sdfT = uTime * uSdfSpeed;
  float displacement = sin(sdfT + q.x * 5.0)
                     * sin(sdfT + q.y * 5.0)
                     * sin(sdfT + q.z * 5.0)
                     * uWarp;

  // Video luma displacement: project world-space XY onto [0,1] UVs, sample the
  // foreground texture, compute Rec.709 luminance, displace outward.
  // clamp keeps UVs in-bounds; at uLumaWarp=0 this term is zero — no cost.
  vec2 lumaUv  = clamp(p.xy * 0.5 + 0.5, 0.0, 1.0);
  vec3 lumaRgb = texture2D(uFgTex, lumaUv).rgb;
  float luma   = dot(lumaRgb, vec3(0.2126, 0.7152, 0.0722));
  luma = smoothstep(uLumaThresh, 1.0, luma);
  float lumaDsp = luma * uLumaWarp;

  return d1 + displacement + lumaDsp;
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

// ── HSV → RGB (compact IQ version) ──────────────────────────────────────────
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

// ── Ambient Occlusion (IQ method) ────────────────────────────────────────────
// Marches 5 steps outward along the normal, compares actual vs expected dist.
// Returns 1.0 = fully lit, 0.0 = fully occluded.
float calcAO(vec3 p, vec3 n) {
  float occ = 0.0;
  float sca = 1.0;
  for (int i = 0; i < 5; i++) {
    float h = 0.01 + 0.15 * float(i) / 4.0;
    float d = scene(p + h * n);
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
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

  // Conservative step scaling: each displacement term inflates the Lipschitz
  // constant. Combine both factors multiplicatively so neither overshoots.
  // At uWarp=0 and uLumaWarp=0 both divisors collapse to 1 — zero cost.
  float stepScale = (1.0 / (1.0 + uWarp * 2.5))
                  * (1.0 / (1.0 + uLumaWarp * 2.0));

  // tMax: march at least to origin + generous margin so far cameras still hit.
  float tMax = length(ro) + 8.0;
  float t = 0.0;
  float d = 0.0;
  int stepCount = 0; // declared outside loop — GLSL ES loop vars are loop-scoped
  for (int i = 0; i < 96; i++) {
    stepCount = i;
    d = scene(ro + rd * t);
    if (d < 0.001 || t > tMax) break;
    t += max(d, 0.001) * stepScale;
  }
  float glowFactor = float(stepCount) / 96.0;
  vec3  glowCol    = glowFactor * vec3(0.5, 0.1, 0.8) * uGlow;

  if (d < 0.001) {
    vec3  p     = ro + rd * t;
    vec3  n     = calcNormal(p);
    vec3  light = normalize(vec3(1.0, 1.5, 2.0));
    float diff  = clamp(dot(n, light), 0.0, 1.0);
    float spec  = pow(clamp(dot(reflect(-light, n), -rd), 0.0, 1.0), 32.0);
    vec3  baseColor = hsv2rgb(uBaseHSV);
    vec3  col       = baseColor * (0.2 + diff * 0.8) + vec3(spec * 0.5);
    // Triplanar video projection: sample uFgTex from each world-space axis,
    // weighted by abs(normal) so the dominant face contributes most.
    vec3  triW     = abs(n);
    triW = triW / (triW.x + triW.y + triW.z);
    float tsc      = 0.5; // world-space scale — repeats every 2 units
    vec3  tpX      = texture2D(uFgTex, p.yz * tsc).rgb;
    vec3  tpY      = texture2D(uFgTex, p.xz * tsc).rgb;
    vec3  tpZ      = texture2D(uFgTex, p.xy * tsc).rgb;
    vec3  texColor = tpX * triW.x + tpY * triW.y + tpZ * triW.z;
    // Modulate tex sample by lighting so shading is preserved at uTexBlend=1
    vec3  litTex   = texColor * (0.15 + diff * 0.85 + spec * 0.3);
    vec3  finalCol = mix(col, litTex, uTexBlend);
    finalCol *= mix(1.0, calcAO(p, n), uAO);
    vec2  screenUV    = gl_FragCoord.xy / uResolution;
    vec2  refractUV   = clamp(screenUV + n.xy * uRefract * 0.5, 0.0, 1.0);
    vec3  glassColor  = texture2D(uBgTex, refractUV).rgb;
    float fresnelTerm = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * uFresnel;
    finalCol = mix(finalCol, glassColor, uRefract) + vec3(fresnelTerm);
    finalCol += glowCol;
    gl_FragColor = vec4(finalCol, 1.0);
  } else {
    // Background glow: rays that almost hit complex geometry take many steps —
    // adding glowCol here produces the neon aura at SDF edges.
    gl_FragColor = vec4(glowCol, 1.0);
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
        uSdfOpMode:   { value: 0 },
        uSdfOpAmount: { value: 0.5 },
        uDistance:   { value: 1.5 },
        uShape:      { value: 0 },
        uRepeat:     { value: 0 },
        uWarp:       { value: 0 },
        uSDFCamPos:  { value: new THREE.Vector3(0, 0, 5) },
        uKifsIter:   { value: 0 },
        uKifsAngle:  { value: 0 },
        uLumaWarp:    { value: 0 },
        uSdfSpeed:    { value: 0.2 },
        uLumaThresh:  { value: 0.2 },
        uTexBlend:    { value: 0.8 },
        uAO:          { value: 0.5 },
        uGlow:        { value: 0.2 },
        uBaseHSV:     { value: new THREE.Vector3(0, 0, 1) },
        uRefract:     { value: 0 },
        uFresnel:     { value: 0.5 },
        uResolution:  { value: new THREE.Vector2(width, height) },
        uFgTex:       { value: new THREE.DataTexture(new Uint8Array([0,0,0,255]), 1, 1) },
        uBgTex:       { value: new THREE.DataTexture(new Uint8Array([0,0,0,255]), 1, 1) },
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

  tick(ps, dt, fgTex, bgTex) {
    this.active = !!ps.get('sdf.active').value;
    if (!this.active) return;

    this._time += dt;
    const u       = this._mat.uniforms;
    u.uTime.value     = this._time;
    u.uSdfOpMode.value   = ps.get('sdf.opMode').value;
    u.uSdfOpAmount.value = ps.get('sdf.opAmount').value;
    u.uDistance.value = ps.get('sdf.distance').value;
    u.uShape.value    = ps.get('sdf.shape').value;
    u.uRepeat.value   = ps.get('sdf.repeat').value;
    u.uWarp.value     = ps.get('sdf.warp').value;
    u.uSDFCamPos.value.set(
      ps.get('sdf.camX').value,
      ps.get('sdf.camY').value,
      ps.get('sdf.camZ').value,
    );
    u.uKifsIter.value  = ps.get('sdf.kifsIter').value;
    u.uKifsAngle.value = ps.get('sdf.kifsAngle').value * (Math.PI / 180);
    u.uLumaWarp.value   = ps.get('sdf.lumaWarp').value;
    u.uSdfSpeed.value   = ps.get('sdf.speed').value;
    u.uLumaThresh.value = ps.get('sdf.lumaThresh').value;
    u.uTexBlend.value   = ps.get('sdf.texBlend').value;
    u.uAO.value         = ps.get('sdf.ao').value;
    u.uGlow.value       = ps.get('sdf.glow').value;
    u.uBaseHSV.value.set(
      ps.get('sdf.hue').value / 360,
      ps.get('sdf.sat').value,
      ps.get('sdf.val').value,
    );
    u.uRefract.value    = ps.get('sdf.refract').value;
    u.uFresnel.value    = ps.get('sdf.fresnel').value;
    if (fgTex) u.uFgTex.value = fgTex;
    if (bgTex) u.uBgTex.value = bgTex;

    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this._rt.texture; }

  resize(w, h) {
    this._rt.setSize(w, h);
    this._mat.uniforms.uResolution.value.set(w, h);
  }

  dispose() {
    this._rt.dispose();
    this._mat.dispose();
    this._scene.children[0].geometry.dispose();
  }
}
