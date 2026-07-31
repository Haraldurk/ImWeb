/**
 * ImWeb SDF Generator
 *
 * Raymarches up to eight orbiting signed-distance shapes into a
 * WebGLRenderTarget. `.texture` is source 21 ("SDF"); `.depthTexture` is source
 * 30 ("SDF Depth"), rendered by a SECOND march of the same material with
 * uDepthPass set — WebGL 1 has no MRT here, so the alternative was packing
 * depth into alpha, and alpha is worth more as COVERAGE: it is how the
 * compositor knows where this source actually is, which is what keeps a glow
 * from reading as black. main.js only runs the depth pass when that source is
 * really consumed, so a project that never routes it never marches twice.
 *
 * NOT "Metaballs": a metaball is a blobby sum-of-falloff surface, which is one
 * of thirteen shapes under one of four combine modes. That name also belongs to
 * the 3D Scene tab's own, unrelated system.
 *
 * Every parameter lives in ParameterSystem under the `sdf.` namespace and is
 * documented there. The shader-side invariants worth knowing before editing:
 *
 *  - The shape list is APPEND-ONLY. sdf.shape persists as an integer index.
 *  - Orientation comes from Euler angles, never lookAt — lookAt has a pole.
 *  - Animation is driven by an integrated PHASE, not by time x speed, so that
 *    Speed 0 freezes in place instead of snapping to the pose at angle 0.
 *  - Anything that inflates the Lipschitz constant (Warp, Luma Warp, the
 *    implicit shell shapes, KIFS scaling) must shrink the step or the sphere
 *    trace tunnels through the surface. They are combined in one place.
 */

import * as THREE from 'three';

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
// Animation PHASE, integrated on the CPU as ∫speed·dt — not a clock times a
// speed. With time*speed the clock ran on regardless, so Speed 0 did not
// hold the shapes where they were: it snapped them to the pose at angle 0, and
// nudging Speed off zero teleported to wherever the free-running clock had got
// to. Neither freezing nor ramping was possible, which for a live instrument
// is the whole point of the control. Integrating also stops the value growing
// without bound, which costs float precision over a long set.
uniform float uPhase;
uniform float uSteps;       // raymarch iteration budget
uniform float uSdfOpMode;   // 0=Union, 1=Smooth Union, 2=Subtraction, 3=Intersection
uniform float uSdfOpAmount; // blend / smooth radius 0–1
uniform float uDistance; // separation between the two orbiting shapes
uniform float uShape;    // 0=Sphere,1=Box,2=Torus,3=Capsule,4=HexPrism,5=Octahedron,6=Link,7=Mandelbulb
uniform float uShapeB;   // second primitive; < 0 means "same as A"
uniform float uCount;    // number of orbiting instances, 1–8
uniform float uSize;     // uniform scale on every primitive
uniform float uTile;     // domain repetition on/off
uniform float uRepeat;   // domain repetition cell spacing
uniform float uWarp;      // surface displacement amplitude
uniform vec3  uMove;      // translates the FIELD (Rutt-Etra's rig.position)
uniform float uOrbitX;    // camera azimuth, radians
uniform float uOrbitY;    // camera elevation, radians
uniform float uCamDist;   // camera distance from origin
uniform float uFov;       // vertical field of view, radians
uniform float uGlowHue;   // aura hue, 0–1
uniform float uGlowSize;  // aura reach in world units (closest-approach falloff)
uniform float uGlowSat;   // aura saturation at the inner stop
uniform float uGlowVal;   // aura value at the inner stop
uniform float uGlowHue2;  // aura hue at the OUTER edge of the falloff
uniform float uGlowSat2;  // aura saturation at the outer stop
uniform float uGlowVal2;  // aura value at the outer stop
uniform float uGlowEnv;   // 0 = flat gradient, 1 = aura tinted by the surround
uniform float uEnvAmt;    // 0 = flat white rim, 1 = reflected environment
uniform float uDepthRange;  // world depth that fills the SDF Depth channel
uniform float uDepthPass;   // 1 = render depth instead of colour (SDF Depth)
uniform vec3  uLightDir;  // unit light direction, built from az/el on the CPU
uniform float uKifsIter;    // KIFS fold iterations 0–5 (float for WebGL compat)
uniform float uKifsAngle;   // KIFS rotation angle (radians)
uniform float uKifsScale;   // KIFS per-iteration scale (1 = the legacy fold)
uniform float uKifsOffset;  // KIFS per-iteration offset (1 = the legacy fold)
uniform float uLumaWarp;    // video luma displacement amplitude
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

// Capped cylinder (IQ exact) — Rutt-Etra's parametric list has one.
float sdCylinder(vec3 p, float r, float h) {
  vec2 d = abs(vec2(length(p.xz), p.y)) - vec2(r, h);
  return min(max(d.x, d.y), 0.0) + length(max(d, 0.0));
}

// Capped cone (IQ exact)
float sdCone(vec3 p, float r, float h) {
  vec2 q = vec2(length(p.xz), p.y);
  vec2 k1 = vec2(0.0, h);
  vec2 k2 = vec2(-r, 2.0 * h);
  vec2 ca = vec2(q.x - min(q.x, (q.y < 0.0) ? r : 0.0), abs(q.y) - h);
  vec2 cb = q - k1 + k2 * clamp(dot(k1 - q, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

// ── Implicit surfaces (Rutt-Etra's parametric family) ────────────────────────
// Gyroid, Helicoid and Catenoid have no exact distance function — these are
// implicit fields turned into thin shells by abs(f) - thickness. The result is
// a BOUND, not a distance, and it over-reports near the surface, so each is
// scaled down by a conservative factor. That factor is why uShapeStep exists:
// the march also has to take smaller steps for these, or it tunnels through.

// Gyroid — a triply-periodic minimal surface, INTERSECTED WITH A BALL.
// Unbounded it is space-filling, so it ignored Size, Separation and Count and
// simply flooded the frame: the periodic field has no size of its own to scale.
// Clipping it to the family envelope makes it a ball of gyroid, which is one
// shape among the others rather than a background. Raise the frequency to keep
// visible structure inside a ball that small.
float sdGyroid(vec3 p, float thickness) {
  float k = 8.0;                       // cells per world unit
  vec3 s = sin(p * k), c = cos(p * k);
  float g = dot(s, c.yzx);             // sin x·cos y + sin y·cos z + sin z·cos x
  float shell = (abs(g) - thickness) / (k * 1.5);  // divisor tames |∇g| at this k
  return max(shell, length(p) - 0.62);
}

// Helicoid — a ruled minimal surface; the sheet a spiral staircase sweeps.
// Clipped in BOTH r and y: the sheet is infinite along the axis it winds around,
// so a disc clip alone still left it running off the top and bottom of frame.
float sdHelicoid(vec3 p, float thickness) {
  float a = atan(p.z, p.x);
  float r = length(p.xz);
  // Wrap the angular error into the nearest turn so the sheet is single-valued.
  float h = p.y * 6.0 - a;
  h = mod(h + 3.14159265, 6.28318531) - 3.14159265;
  float d = abs(h) * min(r, 1.0) / 6.0 - thickness;
  return max(max(d, r - 0.6), abs(p.y) - 0.6) * 0.5;
}

// Catenoid — the minimal surface of revolution, r = c·cosh(y/c).
// The flare is exponential, so the y clamp IS the size control: at c = 0.25,
// y = ±0.38 gives a mouth radius of 0.25·cosh(1.52) = 0.60. The previous ±0.7
// flared to 2.06 — three and a half times the rest of the family.
float sdCatenoid(vec3 p, float thickness) {
  float c    = 0.25;
  float yLim = 0.38;
  float y    = clamp(p.y, -yLim, yLim);
  float rr   = c * (exp(y / c) + exp(-y / c)) * 0.5;
  float d    = abs(length(p.xz) - rr) - thickness;
  return max(d, abs(p.y) - yLim) * 0.35;
}

// Selected by an argument, not by reading uShape, so two instances can use two
// different primitives. sdShape(p) keeps the old one-argument form for the
// callers that only ever want the A shape.
float sdShapeSel(vec3 p, float sh) {
  if      (sh < 0.5) return sdSphere(p, 0.6);
  else if (sh < 1.5) return sdBox(p, vec3(0.42));
  else if (sh < 2.5) return sdTorus(p, vec2(0.45, 0.18));
  else if (sh < 3.5) return sdCapsule(p, vec3(0.0, -0.3, 0.0), vec3(0.0, 0.3, 0.0), 0.25);
  else if (sh < 4.5) return sdHexPrism(p, vec2(0.4, 0.2));
  else if (sh < 5.5) return sdOctahedron(p, 0.7);
  else if (sh < 6.5) return sdLink(p, 0.3, 0.3, 0.12);
  else if (sh < 7.5) return sdMandelbulb(p * 1.2) * 0.8;
  // 8+ appended — SELECT values persist as indices, so this list only grows
  // at the end. Inserting anywhere above would re-point every saved sdf.shape.
  // Sized to the same envelope as the eight above, which sit between 0.50 and
  // 0.73 bounding radius. Shipped at 0.64–2.06 and unbounded, so the new shapes
  // read as a different scale of object rather than alternatives to the old.
  else if (sh < 8.5)  return sdCylinder(p, 0.40, 0.45);   // bounding 0.60
  else if (sh < 9.5)  return sdCone(p, 0.45, 0.45);       // bounding 0.64
  else if (sh < 10.5) return sdGyroid(p, 0.55);           // clipped to 0.62
  else if (sh < 11.5) return sdHelicoid(p, 0.06);         // clipped to 0.60
  else                return sdCatenoid(p, 0.05);         // flares to 0.60
}

float sdShape(vec3 p) { return sdShapeSel(p, uShape); }

/**
 * Per-shape step multiplier. The implicit shells return a bound rather than a
 * distance, so the sphere trace must creep where it would otherwise stride.
 * Folded into stepScale next to the Warp and Luma terms — one place where every
 * Lipschitz correction is combined, rather than a special case at the call site.
 *
 * Takes the MINIMUM over both slots: one implicit shape in the scene is enough
 * to require the slower march, and gating on the A shape alone would tunnel
 * through a gyroid sitting in slot B.
 */
float shapeStepScale() {
  float a = (uShape  > 9.5) ? 0.4 : 1.0;
  float b = (uShapeB > 9.5) ? 0.4 : 1.0;
  return min(a, b);
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
  // Move translates the FIELD rather than the camera, so it swings with the
  // orbit instead of fighting it — and, with Tile on, it is what lets you
  // travel through an infinite lattice instead of watching it from outside.
  // Applied here so calcNormal and calcAO inherit it for free.
  p -= uMove;

  // Domain repetition: fold space into repeating cells.
  // Gated by uTile, not by "is the spacing big enough". The old form
  // (uRepeat > 0.1) made the bottom of the spacing slider a dead zone and put
  // the on/off switch inside the value, so Tile could not be toggled without
  // also losing the spacing you had dialled in.
  vec3 q = (uTile > 0.5)
    ? mod(p + 0.5 * uRepeat, uRepeat) - 0.5 * uRepeat
    : p;

  // KIFS folding — Kaleidoscopic Iterated Function System.
  // Each iteration: mirror all axis planes (abs), then rotate xy and xz to
  // misalign successive folds and generate fractal complexity.
  // Uses a fixed loop bound (5) with a float break for WebGL 1 compatibility.
  // At uKifsIter == 0 the loop body never runs — zero behaviour change.
  //
  // Scale and Offset were literals (abs(kp) - vec3(1.0)); at Scale 1 / Offset 1
  // this is that expression exactly, so the default fractal is unchanged.
  // A scaling fold shrinks the distance metric by uKifsScale each iteration, so
  // kifsScl accumulates it and the result is divided back out below — without
  // that the estimate over-reports and the march tunnels straight through the
  // fractal. At Scale 1 the accumulator stays 1 and the division is a no-op.
  vec3  kp      = q;
  float kifsScl = 1.0;
  for (int ki = 0; ki < 5; ki++) {
    if (float(ki) >= uKifsIter) break;
    kp = abs(kp) * uKifsScale - vec3(uKifsOffset);
    kp.xy = rot2D(uKifsAngle) * kp.xy;
    kp.xz = rot2D(uKifsAngle) * kp.xz;
    kifsScl *= uKifsScale;
  }

  // Separation always comes from uDistance. It used to be overridden by the
  // cell spacing whenever repetition was on, which meant the Separation slider
  // silently did nothing in tile mode — a dead control with no indication.
  float rad = uDistance * 0.35;
  float ang = uPhase * 0.8;

  // Uniform scale on a distance field is d(p) = s * shape(p / s); dividing the
  // point without re-multiplying the result would break the Lipschitz bound
  // and make the raymarch overshoot through thin geometry.
  float s = max(uSize, 0.001);
  // k scales opAmount from [0,1] into a useful blend radius.
  // For Soft Cut, uSdfOpAmount=0 means no cut; =1 means deep bite.
  float k = max(uSdfOpAmount, 0.001);

  // Instances are placed on one orbit, evenly spaced in phase. This replaced a
  // hand-written cA/cB pair; instance 0 is byte-identical to the old cA, and
  // at Count 2 instance 1 lands close to the old cB but not exactly on it —
  // the old counter-shape was not a rotation of the first, so a generalised
  // orbit cannot reproduce its wobble. The x axis (the large motion) matches;
  // the two small wobble axes differ by a phase offset.
  // Rounded: a controller or LFO driving Count lands on fractional values, and
  // a fraction both spaced the instances unevenly (the gap back to instance 0
  // is the remainder) and popped one in and out at the threshold.
  float cnt = max(floor(uCount + 0.5), 1.0);
  float d1  = 1e9;
  for (int i = 0; i < 8; i++) {
    if (float(i) >= cnt) break;
    float ph = ang + float(i) * 6.28318531 / cnt;
    vec3  ci = vec3(cos(ph) * rad, sin(ph * 0.7) * 0.3, sin(ph * 0.4) * 0.2);
    // Alternate primitives so Shape B reads as "the other one" at Count 2 and
    // as an alternating pattern above it. uShapeB < 0 means "same as A".
    float useB = (uShapeB >= 0.0 && mod(float(i), 2.0) > 0.5) ? 1.0 : 0.0;
    float di = sdShapeSel((kp - ci) / s, mix(uShape, uShapeB, useB)) * s;

    // The first instance seeds d1; combining it with the 1e9 sentinel would
    // let smin/opSmoothSub blend against a number that is not a surface.
    if (i == 0) { d1 = di; }
    else if (uSdfOpMode < 0.5)      d1 = min(d1, di);
    else if (uSdfOpMode < 1.5)      d1 = smin(d1, di, k);
    else if (uSdfOpMode < 2.5)      d1 = opSmoothSub(d1, di, k);
    else                            d1 = -smin(-d1, -di, k);
  }

  // Undo the KIFS scaling so the estimate is in original-space units.
  // max(.., 1.0) rather than the accumulator itself: dividing by a number below
  // 1 would INFLATE the estimate, and an over-reported distance is the one
  // error a sphere trace cannot survive — it steps straight through the
  // surface. Only ever shrinking is conservative in both directions.
  d1 /= max(kifsScl, 1.0);

  // Surface displacement: sin-product warp on the distance field.
  // Uses q (cell-local) so displacement tiles cleanly with repetition.
  float sdfT = uPhase;
  float displacement = sin(sdfT + q.x * 5.0)
                     * sin(sdfT + q.y * 5.0)
                     * sin(sdfT + q.z * 5.0)
                     * uWarp;

  // Video luma displacement: project world-space XY onto [0,1] UVs, sample the
  // foreground texture, compute Rec.709 luminance, displace outward.
  //
  // The branch is the point. scene() runs up to 96 times per ray in the march,
  // plus 6 for the normal and 5 for AO — so an UNCONDITIONAL texture2D here was
  // ~107 dependent samples per pixel, paid on every frame by every project,
  // whether or not Luma Warp was above zero (and it defaults to zero). The old
  // comment claimed "at uLumaWarp=0 this term is zero — no cost", which was
  // true of the arithmetic and false of the fetch that fed it.
  //
  // uLumaWarp is a uniform, so this is uniform control flow: every fragment
  // takes the same path and the implicit-LOD rule for texture2D is satisfied.
  float lumaDsp = 0.0;
  if (uLumaWarp > 0.0) {
    vec2 lumaUv  = clamp(p.xy * 0.5 + 0.5, 0.0, 1.0);
    vec3 lumaRgb = texture2D(uFgTex, lumaUv).rgb;
    float luma   = dot(lumaRgb, vec3(0.2126, 0.7152, 0.0722));
    lumaDsp = smoothstep(uLumaThresh, 1.0, luma) * uLumaWarp;
  }

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

// ── Equirectangular lookup for the environment tap ───────────────────────────
// Treats the Refract Src texture as a spherical surround and maps a direction
// into it. This is what makes the reflection behave like a reflection: it is a
// function of the DIRECTION the surface looks in, so it slides across curvature
// and stays put in the world as the camera orbits, instead of being painted on.
// v is flipped because three's textures are flipY by default, so up (+y) has to
// land at the top of the image.
vec2 equirectUv(vec3 d) {
  return vec2(atan(d.z, d.x) * 0.15915494 + 0.5,           // 1 / 2π
              1.0 - acos(clamp(d.y, -1.0, 1.0)) * 0.31830989); // 1 / π
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
    // Probe distance tracks Size. Fixed, it reached 0.16 world units: at
    // Size 0.1 that is far outside a 0.06-radius shape so AO vanished, and at
    // Size 3 it is 9% of the radius so crevice shading collapsed to a contact
    // line. At Size 1 this is the value it always had.
    float h = (0.01 + 0.15 * float(i) / 4.0) * max(uSize, 0.05);
    float d = scene(p + h * n);
    occ += (h - d) * sca;
    sca *= 0.85;
  }
  return clamp(1.0 - 2.5 * occ, 0.0, 1.0);
}

// ── Orbit camera ─────────────────────────────────────────────────────────────
// Orientation from Euler angles, NOT lookAt — the same choice RuttEtra.js:719
// documents, for the same reason. lookAt needs an up vector, and at ±90°
// elevation the forward axis becomes parallel to it: cross(f, up) is the zero
// vector, normalize() returns NaN, and the frame goes black. Rotating a camera
// that starts at the origin and then backing it off along its own +Z has no
// such pole. Column-major: mat3(col0, col1, col2).
mat3 rotX(float a) { float s = sin(a), c = cos(a);
  return mat3(1.0, 0.0, 0.0,  0.0, c, -s,  0.0, s, c); }
mat3 rotY(float a) { float s = sin(a), c = cos(a);
  return mat3(c, 0.0, -s,  0.0, 1.0, 0.0,  s, 0.0, c); }

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  // Aspect correction. Without it a Sphere renders as a wide ellipse on any
  // non-square target, because uv spans [-1,1] on both axes regardless of the
  // render target's shape. uFov is therefore the VERTICAL field of view.
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  // YXZ, so Orbit Y reads as elevation applied before Orbit X's azimuth.
  // camRot * (0,0,d) = (d·cos(el)·sin(az), d·sin(el), d·cos(el)·cos(az)) —
  // the exact placement migrateSdfCamera() inverts, so a migrated project's
  // eye lands on the identical point.
  mat3 cam = rotY(uOrbitX) * rotX(uOrbitY);
  vec3 ro  = cam * vec3(0.0, 0.0, uCamDist);

  // Focal length from vertical FOV. tan is guarded away from the 180° pole.
  float focal = 1.0 / max(tan(uFov * 0.5), 0.001);
  vec3  rd    = cam * normalize(vec3(uv, -focal));

  // Conservative step scaling: each displacement term inflates the Lipschitz
  // constant. Combine both factors multiplicatively so neither overshoots.
  // At uWarp=0 and uLumaWarp=0 both divisors collapse to 1 — zero cost.
  float stepScale = (1.0 / (1.0 + uWarp * 2.5))
                  * (1.0 / (1.0 + uLumaWarp * 2.0))
                  * shapeStepScale();

  // tMax: march at least to the field's centre + generous margin so far
  // cameras still hit. Measured to uMove, not to the origin — Move relocates
  // the field, so marching only as far as the origin would clip it away.
  float tMax = length(ro - uMove) + 8.0;
  float t = 0.0;
  float d = 0.0;
  int stepCount = 0; // declared outside loop — GLSL ES loop vars are loop-scoped
  // The bound must be a compile-time constant in GLSL ES 1.00, so the budget is
  // a uniform break instead — the same shape as the KIFS loop. 256 is the
  // ceiling the Steps control can ask for, not what it costs by default.
  //
  // Steps exists because stepScale shrinks every step as Warp rises (at Warp 2
  // it is a sixth), while a fixed budget then reached only a sixth as far and
  // distant geometry silently vanished. Raising Steps is the lever for that.
  float minD = 1e9;   // closest the ray ever came to the surface
  for (int i = 0; i < 256; i++) {
    if (float(i) >= uSteps) break;
    stepCount = i;
    d = scene(ro + rd * t);
    minD = min(minD, d);
    if (d < 0.001 || t > tMax) break;
    t += max(d, 0.001) * stepScale;
  }

  // AURA from CLOSEST APPROACH, not from step count.
  //
  // Step count was a proxy for proximity and a poor one: it also rises with the
  // total distance travelled and with how tangled the field is, and in mostly
  // empty space a missing ray takes big strides and exits after a handful of
  // iterations. So the very rays that should glow brightest — the ones grazing
  // the silhouette — scored low, and the whole effect read as a dull wash that
  // no amount of Glow could sharpen. It also drifted whenever Steps changed.
  //
  // Distance to the surface is the thing actually wanted, and the sphere trace
  // has already computed it at every step. Squared for a tighter falloff.
  // Sat 0.875 / val 0.8 decompose the old fixed vec3(0.5, 0.1, 0.8), so the
  // default hue of 274° is the colour this always had.
  float halo = 1.0 - clamp(minD / max(uGlowSize, 0.001), 0.0, 1.0);

  // TWO-STOP GRADIENT across the falloff: Glow Hue is the colour AT the object
  // (halo = 1) and Glow Hue 2 the colour at the outer edge (halo = 0). Both
  // default to the same hue, so a project that never touches Hue 2 sees the
  // single-colour aura it had.
  // Saturation and value are per-stop uniforms, not the fixed 0.875 / 0.8 they
  // were. Those two numbers were the decomposition of one hardcoded violet, and
  // freezing them meant the aura could only ever be a fully saturated hue at one
  // brightness — no pastels, no near-white core, no dim outer falloff.
  vec3 auraTint = mix(hsv2rgb(vec3(uGlowHue2, uGlowSat2, uGlowVal2)),
                      hsv2rgb(vec3(uGlowHue,  uGlowSat,  uGlowVal )), halo);

  // REFLECTIVE AURA: take the surround's COLOUR along the ray's own direction,
  // but not its brightness.
  //
  // This was a straight multiply by 2x the sampled texel, and a multiply can
  // reach zero: against a dark patch of surround the whole aura went out.
  // Measured against a real setting — Glow Env 1.0 over a dark region of the
  // Noise layer — the aura fell to luma 0.004, which is black. An emissive
  // glow does not reflect anyway; it emits, and what the surround can
  // reasonably do is tint it. Normalising by the brightest channel takes the
  // hue and leaves the level alone, and a surround that is essentially black
  // falls back to no tint at all rather than to darkness.
  vec3  auraEnv = texture2D(uBgTex, equirectUv(rd)).rgb;
  float envMax  = max(auraEnv.r, max(auraEnv.g, auraEnv.b));
  vec3  envTint = envMax > 0.01 ? auraEnv / envMax : vec3(1.0);
  auraTint = mix(auraTint, auraTint * envTint, uGlowEnv);

  // Brightness falls off LINEARLY, not squared.
  //
  // Squared, the falloff extinguished the aura exactly where the gradient's
  // outer colour lives: at the point the mix is 76% Hue 2, halo^2 is 0.059 and
  // the result is luma 0.010 — invisible. Colour position and brightness are
  // the same variable here, so a curve steep enough to look "tight" also makes
  // the second colour of a two-colour gradient unreachable. Which it was: the
  // outer stop could be set to anything and never showed.
  vec3 glowCol = halo * auraTint * uGlow;

  float depthVal = 0.0;   // filled on a hit; a miss stays at 0 = maximally far
  if (d < 0.001) {
    vec3  p     = ro + rd * t;
    vec3  n     = calcNormal(p);
    vec3  light = uLightDir;
    float diff  = clamp(dot(n, light), 0.0, 1.0);
    float spec  = pow(clamp(dot(reflect(-light, n), -rd), 0.0, 1.0), 32.0);
    vec3  baseColor = hsv2rgb(uBaseHSV);
    // BODY terms only — no specular. Specular is a reflection off the surface,
    // not part of what the surface transmits, so it is added once at the very
    // end instead of being baked into the albedo. That is what lets Refract
    // reach 1.0 without flattening the object: previously the glass mix
    // lerped the WHOLE shaded colour toward the background, so a clear-glass
    // setting threw away every highlight and the ball read as a flat hole.
    vec3  col       = baseColor * (0.2 + diff * 0.8);
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
    vec3  litTex   = texColor * (0.15 + diff * 0.85);
    vec3  finalCol = mix(col, litTex, uTexBlend);
    // Branch, not mix(): mix() evaluates both arguments, so calcAO — five more
    // scene() evaluations — ran in full even at Occlusion 0.
    if (uAO > 0.0) finalCol *= mix(1.0, calcAO(p, n), uAO);
    // Glass body: at uRefract=1 the object transmits the background instead of
    // showing its own diffuse. AO is applied BEFORE this, so cavity darkening
    // fades out with the diffuse it belongs to rather than dirtying clear glass.
    // VIEW-space normal, not world. The lookup is in screen space, so a
    // world-space normal pinned the refraction smear to world axes: orbit the
    // camera and the distortion kept pointing the same way while the picture
    // turned under it. n*cam is transpose(cam)*n, and cam is orthonormal
    // so its transpose is its inverse. Invisible before there was an orbit
    // control; obvious the moment there was one.
    vec3  nv          = n * cam;
    vec2  screenUV    = gl_FragCoord.xy / uResolution;
    vec2  refractUV   = clamp(screenUV + nv.xy * uRefract * 0.5, 0.0, 1.0);
    vec3  glassColor  = texture2D(uBgTex, refractUV).rgb;
    finalCol = mix(finalCol, glassColor, uRefract);
    // Surface layer, on top of body and glass alike — this is the part that
    // reads as "wet"/"glazed" rather than "painted".
    //
    // ENVIRONMENT TAP. The Fresnel term used to add flat white, which is why a
    // glass setting read as a glowing rim rather than a reflective one: a rim
    // that is the same colour everywhere carries no information about what is
    // around the object, and reflection is entirely information about what is
    // around the object. Now the reflected direction is looked up in the same
    // texture the refraction transmits (Refract Src — one surround feeding both
    // transmission and reflection, which is what a surround IS).
    //
    // Env Mirror 0 restores the flat white rim exactly.
    vec3  refl        = reflect(rd, n);
    vec3  envCol      = texture2D(uBgTex, equirectUv(refl)).rgb;
    float fresnelTerm = pow(1.0 - max(dot(n, -rd), 0.0), 3.0) * uFresnel;
    finalCol += vec3(spec * 0.5) + mix(vec3(1.0), envCol, uEnvAmt) * fresnelTerm;
    // AURA ON THE OBJECT, weighted by the rim rather than applied flat.
    //
    // Dropping it from hits entirely (previous commit) left a dark band at the
    // silhouette: the object's own unlit edge, with the bright halo starting
    // immediately outside it — read as "a black halo closest to the object".
    // Applying it flat is the other failure, and why it was dropped: minD is ~0
    // on every hit, so the full halo colour would wash across the whole surface.
    //
    // The rim term is the answer to both. It peaks exactly at the silhouette,
    // where the outer halo also peaks, so the two meet with no seam, and falls
    // to nothing facing the camera, so the lit surface stays readable. auraTint
    // is evaluated at halo = 1 here, which is the gradient's inner stop — the
    // colour continues across the boundary as well as the brightness.
    float rimGlow = pow(1.0 - max(dot(n, -rd), 0.0), 2.0);
    finalCol += auraTint * uGlow * rimGlow;

    // ALPHA CARRIES DEPTH, not opacity. Layer compositing in Pipeline.js goes
    // through explicit blend modes and the keyer and never reads source alpha,
    // so this channel was writing a constant 1.0 into every frame for nothing.
    // The material is NoBlending precisely so this can be data.
    //
    // Centred on the field and scaled by uDepthRange, NOT normalised over the
    // whole marched distance. Over the full range the object occupied 6–12% of
    // 0–1 — as little as 15 of 255 levels — because most of the march is empty
    // space, and worse, the value drifted with camera distance, so a depth map
    // driving Displace changed meaning every time you dollied. Measuring from
    // the field centre makes 0.5 the centre at any distance, and Depth Range
    // sets how much world depth fills the channel. Nearer = brighter.
    float dc = length(ro - uMove);
    depthVal = clamp(0.5 + (dc - t) / (2.0 * max(uDepthRange, 0.001)), 0.0, 1.0);
    // ALPHA IS COVERAGE. The object is opaque.
    gl_FragColor = vec4(finalCol, 1.0);
  } else {
    // Background glow: rays that pass close to the surface carry the aura.
    //
    // Coverage here is the aura's own strength, which is what stops a glow from
    // ever reading as BLACK: composited through the keyer's Alpha mode, a weak
    // glow is mostly background rather than mostly dark pixel. Under Copy it
    // was the SDF's black that replaced the background, and no amount of
    // keying or glow tuning could fix that — the layer was simply opaque
    // everywhere. Depth 0: a miss is as far away as the channel can express.
    gl_FragColor = vec4(glowCol, clamp(halo * uGlow, 0.0, 1.0));
  }

  // Depth is a SECOND pass over the same march rather than a channel of the
  // first. It used to ride in alpha, which cost nothing but took the one
  // channel the compositor needs to know where this source actually IS.
  // Coverage is worth more there than depth, so depth pays for itself instead:
  // main.js only runs this pass when the SDF Depth source is really consumed,
  // so a project that never routes it never marches twice.
  if (uDepthPass > 0.5) gl_FragColor = vec4(vec3(depthVal), 1.0);
}
`;

export class SDFGenerator {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this._phase   = 0;   // ∫ speed·dt — see uPhase in the shader
    this.active   = false;

    // Raymarch at reduced internal resolution and let the bilinear-filtered
    // render target upscale on composite — the march + 6-sample normals + AO
    // is expensive per-pixel at full canvas resolution. Exposed as Detail
    // (sdf.rscale); 0.5 is what it was pinned at. Canvas size is cached so a
    // Detail change can re-derive the target without waiting for a resize.
    this._scale = 0.5;
    this._w = width;
    this._h = height;
    const rtW = Math.max(1, Math.round(width  * this._scale));
    const rtH = Math.max(1, Math.round(height * this._scale));

    this._rt = new THREE.WebGLRenderTarget(rtW, rtH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    });

    // One shared 1×1 opaque-black texture for both slots. `needsUpdate` matters:
    // a DataTexture is created at version 0, so without it three never uploads
    // and the sampler binds null. It is also what "None" (and a self-reference
    // rejected by _notSelf) resolves to — before this, a null texture simply
    // left the previous frame's texture bound, so choosing None froze the last
    // source in place instead of clearing it.
    this._black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._black.needsUpdate = true;

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        uPhase:      { value: 0 },
        uSteps:      { value: 96 },
        uSdfOpMode:   { value: 0 },
        uSdfOpAmount: { value: 0.5 },
        uDistance:   { value: 1.5 },
        uShape:      { value: 0 },
        uShapeB:     { value: -1 },
        uCount:      { value: 2 },
        uSize:       { value: 1 },
        uTile:       { value: 0 },
        uRepeat:     { value: 3 },
        uWarp:       { value: 0 },
        uMove:       { value: new THREE.Vector3(0, 0, 0) },
        uOrbitX:     { value: 0 },
        uOrbitY:     { value: 0 },
        uCamDist:    { value: 5 },
        uFov:        { value: THREE.MathUtils.degToRad(74) },
        uGlowHue:    { value: 274 / 360 },
        uGlowSize:   { value: 0.4 },
        uGlowSat:    { value: 0.875 },
        uGlowVal:    { value: 0.8 },
        uGlowHue2:   { value: 274 / 360 },
        uGlowSat2:   { value: 0.875 },
        uGlowVal2:   { value: 0.8 },
        uGlowEnv:    { value: 0 },
        uEnvAmt:     { value: 1 },
        uDepthRange: { value: 1.0 },
        uDepthPass:  { value: 0 },
        uLightDir:   { value: new THREE.Vector3(1, 1.5, 2).normalize() },
        uKifsIter:   { value: 0 },
        uKifsAngle:  { value: 0 },
        uKifsScale:  { value: 1 },
        uKifsOffset: { value: 1 },
        uLumaWarp:    { value: 0 },
        uLumaThresh:  { value: 0.2 },
        uTexBlend:    { value: 0.8 },
        uAO:          { value: 0.5 },
        uGlow:        { value: 0.2 },
        uBaseHSV:     { value: new THREE.Vector3(0, 0, 1) },
        uRefract:     { value: 0 },
        uFresnel:     { value: 0.5 },
        uResolution:  { value: new THREE.Vector2(rtW, rtH) },
        uFgTex:       { value: this._black },
        uBgTex:       { value: this._black },
      },
      vertexShader:   VERT,
      fragmentShader: FRAG,
      depthTest:  false,
      depthWrite: false,
      // MUST be NoBlending, now that alpha carries depth rather than opacity.
      // ShaderMaterial defaults to NormalBlending, which computes
      //   RGBout = src.rgb * src.a + dst.rgb * (1 - src.a)
      // and the target clears to (0,0,0,0) — so the moment alpha stopped being
      // a constant 1.0, every hit was silently multiplied by its own depth
      // (~0.62 at the default camera) and every MISS was multiplied by zero,
      // which killed the background glow aura outright. Nothing here is being
      // composited: this is a full-screen write into a source target and it
      // wants the shader's RGBA verbatim.
      blending: THREE.NoBlending,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat));
  }

  tick(ps, dt, fgTex, bgTex) {
    this.active = !!ps.get('sdf.active').value;
    if (!this.active) return;

    // Detail is read before anything else writes uniforms — setScale() resizes
    // the target and rewrites uResolution, which the ray setup depends on.
    this.setScale(ps.get('sdf.rscale').value);

    this._phase += dt * ps.get('sdf.speed').value;
    const u       = this._mat.uniforms;
    u.uPhase.value    = this._phase;
    u.uSteps.value    = ps.get('sdf.steps').value;
    u.uSdfOpMode.value   = ps.get('sdf.opMode').value;
    u.uSdfOpAmount.value = ps.get('sdf.opAmount').value;
    u.uDistance.value = ps.get('sdf.distance').value;
    u.uShape.value    = ps.get('sdf.shape').value;
    // Shape B option 0 is "Same as A"; the shader takes < 0 to mean that, so
    // the index shifts down by one and 0 becomes the sentinel.
    u.uShapeB.value   = ps.get('sdf.shapeB').value - 1;
    u.uCount.value    = ps.get('sdf.count').value;
    u.uSize.value     = ps.get('sdf.size').value;
    u.uTile.value     = ps.get('sdf.tile').value ? 1 : 0;
    u.uRepeat.value   = ps.get('sdf.repeat').value;
    u.uWarp.value     = ps.get('sdf.warp').value;
    u.uMove.value.set(
      ps.get('sdf.moveX').value,
      ps.get('sdf.moveY').value,
      ps.get('sdf.moveZ').value,
    );
    const DEG = Math.PI / 180;
    u.uOrbitX.value  = ps.get('sdf.orbitX').value * DEG;
    u.uOrbitY.value  = ps.get('sdf.orbitY').value * DEG;
    u.uCamDist.value = ps.get('sdf.camDist').value;
    u.uFov.value     = ps.get('sdf.fov').value * DEG;
    u.uGlowHue.value  = ps.get('sdf.glowHue').value / 360;
    u.uGlowSize.value = ps.get('sdf.glowSize').value;
    u.uGlowSat.value  = ps.get('sdf.glowSat').value;
    u.uGlowVal.value  = ps.get('sdf.glowVal').value;
    u.uGlowHue2.value = ps.get('sdf.glowHue2').value / 360;
    u.uGlowSat2.value = ps.get('sdf.glowSat2').value;
    u.uGlowVal2.value = ps.get('sdf.glowVal2').value;
    u.uGlowEnv.value  = ps.get('sdf.glowEnv').value;
    u.uEnvAmt.value   = ps.get('sdf.envAmt').value;
    u.uDepthRange.value = ps.get('sdf.depthRange').value;
    // Same spherical convention as the camera, so azimuth 0 puts the light
    // behind the viewer at elevation 0 and the two controls read alike.
    const laz = ps.get('sdf.lightAz').value * DEG;
    const lel = ps.get('sdf.lightEl').value * DEG;
    u.uLightDir.value.set(
      Math.cos(lel) * Math.sin(laz),
      Math.sin(lel),
      Math.cos(lel) * Math.cos(laz),
    );
    u.uKifsIter.value  = ps.get('sdf.kifsIter').value;
    u.uKifsAngle.value = ps.get('sdf.kifsAngle').value * (Math.PI / 180);
    u.uKifsScale.value  = ps.get('sdf.kifsScale').value;
    u.uKifsOffset.value = ps.get('sdf.kifsOffset').value;
    u.uLumaWarp.value   = ps.get('sdf.lumaWarp').value;
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
    u.uFgTex.value = fgTex || this._black;
    u.uBgTex.value = bgTex || this._black;

    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
  }

  get texture() { return this._rt.texture; }

  /**
   * Expand the depth packed into the colour target's alpha into a greyscale
   * texture, for the "SDF Depth" source.
   *
   * A separate pass rather than a second render target written by the
   * raymarcher: WebGL 1 has no MRT without EXT_draw_buffers, so the alternative
   * was marching the whole field twice. This is one full-screen blit over a
   * texture that already exists.
   *
   * Allocated lazily and rendered only when main.js says the source is used, so
   * a project that never routes SDF Depth pays neither the VRAM nor the pass.
   */
  renderDepth() {
    if (!this._depthRt) {
      this._depthRt = new THREE.WebGLRenderTarget(this._rt.width, this._rt.height, {
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        format:    THREE.RGBAFormat,
      });
    }
    if (this._depthRt.width !== this._rt.width || this._depthRt.height !== this._rt.height) {
      this._depthRt.setSize(this._rt.width, this._rt.height);
    }
    // A SECOND MARCH, not a blit over the colour target's alpha. Alpha now
    // carries coverage, which the compositor needs to know where this source
    // is; depth had been squatting there for free and is worth less than that.
    //
    // The same material and the same uniforms — only uDepthPass differs — so
    // the two passes cannot drift apart the way a duplicated shader would.
    // Restored immediately after, because tick() sets every other uniform but
    // would not know to clear this one.
    this._mat.uniforms.uDepthPass.value = 1;
    this.renderer.setRenderTarget(this._depthRt);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
    this._mat.uniforms.uDepthPass.value = 0;
  }

  /** Null until renderDepth() has run at least once — callers fall back. */
  get depthTexture() { return this._depthRt ? this._depthRt.texture : null; }

  resize(w, h) {
    this._w = w;
    this._h = h;
    const rtW = Math.max(1, Math.round(w * this._scale));
    const rtH = Math.max(1, Math.round(h * this._scale));
    this._rt.setSize(rtW, rtH);
    this._mat.uniforms.uResolution.value.set(rtW, rtH);
  }

  /** Detail (sdf.rscale) changed — re-derive the target from the cached size. */
  setScale(s) {
    if (s === this._scale) return;
    this._scale = s;
    this.resize(this._w, this._h);
  }

  dispose() {
    this._rt.dispose();
    this._black.dispose();
    this._mat.dispose();
    this._scene.children[0].geometry.dispose();
    if (this._depthRt) this._depthRt.dispose();
  }
}
