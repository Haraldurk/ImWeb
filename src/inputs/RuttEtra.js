/**
 * ImWeb Rutt-Etra Scan Processor — Phase 26
 *
 * Steve Rutt and Bill Etra's Scan Processor (1972), the third machine in the
 * lineage this instrument claims and the only one that had no representation in
 * it. N horizontal scanlines are deflected by the luminance of a source image
 * and viewed through an orbiting perspective camera.
 *
 * FAITHFUL BEFORE GENERAL, deliberately (Blueprint §6). The machine is beautiful
 * BECAUSE IT LIES ABOUT DEPTH — luminance is not distance, and the whole
 * character of the thing comes from that error: faces become ridges, shadows
 * become holes. Generalising to "any channel displaces any primitive" before
 * living with the historical instrument produces something configurable that
 * nobody plays. Generalise later, along the axes actually reached for.
 *
 * Parameters:
 *   rutt.active    — toggle rendering (the render gate is _srcUsed() in main.js)
 *   rutt.source    — what gets scanned; any source, incl. FG/BG/DS Src
 *   rutt.lines     — scanline count
 *   rutt.zgain     — deflection amount; SIGNED, so the relief can be inverted
 *   rutt.thickness — beam width in PIXELS, constant under perspective
 *   rutt.angle     — camera azimuth
 *   rutt.elev      — camera elevation
 *   rutt.dist      — camera distance
 *   rutt.decay     — phosphor persistence; 0 = none
 *
 * Three notes for whoever reads this next:
 *
 * 1. THICKNESS IS A REAL CONTROL, NOT `linewidth`. THREE.LineBasicMaterial's
 *    linewidth is capped at 1 by ANGLE and every major browser — wiring the knob
 *    to it would ship a control that silently does nothing, which is the hardest
 *    class of defect to report. Each scanline is therefore a triangle ribbon
 *    expanded in CLIP space (`clip.y += aSide * px * clip.w / (resY*0.5)`), so
 *    the beam holds its pixel width regardless of how far the camera has orbited.
 *    The expansion is vertical only: scanlines are horizontal sweeps, so a
 *    perpendicular offset would differ from a vertical one only where the relief
 *    is near-vertical on screen, and there the beam thins — which is what a real
 *    deflected beam does anyway.
 *
 * 2. NO DEPTH TEST, ADDITIVE BLEND. Not an oversight and not a perf shortcut:
 *    the Scan Processor drove a CRT beam and had no hidden-line removal. Back
 *    lines showing through front ones is the instrument, not an artefact.
 *
 * 3. VERTEX-STAGE TEXTURE FETCH. Required to deflect by luminance, fine under
 *    WebGL2 (three r168's default). This does NOT violate the CLAUDE.md "strict
 *    WebGL 1.0 / GLSL ES 1.00" rule — that rule constrains AI-GENERATED shaders
 *    in the Live GLSL pass, where the user's browser and the model's habits are
 *    both unknown. The pipeline's own materials are not bound by it (Blueprint
 *    §6, recorded there precisely so a later session does not "fix" this).
 */

import * as THREE from 'three';

const SCAN_VERT = `
uniform sampler2D uSrc;
uniform float uZGain;
uniform float uZCurve;
uniform float uZPivot;
uniform float uThickness;
uniform float uPointSize;
uniform vec2  uResolution;
attribute float aSide;
varying float vLuma;
varying vec3  vColor;

void main() {
  // uv and normal arrive as real attributes now that the lattice is not
  // necessarily a plane — three's ShaderMaterial declares both for us. uv still
  // follows the convention every other pass samples with, so a source upright
  // in the compositor is upright here whatever surface it is wrapped on.
  vec3 src = texture2D(uSrc, uv).rgb;
  float luma = dot(src, vec3(0.2126, 0.7152, 0.0722));
  vColor = src;

  // vLuma stays the RAW luminance: the beam is as bright as the signal that
  // deflected it, and shaping the depth must not also dim the picture. Curve
  // and pivot act on geometry only — which is what the harness asserts by
  // driving them at uZGain 0 and requiring no change at all.
  vLuma = luma;

  // The transfer function, following td.delayCurve's precedent: gamma on the
  // normalised value BEFORE it is scaled. Luminance-as-depth flattens midtones
  // into a slab, and this is the knob that makes a face read as a face.
  // Branched rather than pow(x, 1.0) so the default is bit-exact, for the same
  // reason td.angle's default rotation is (Blueprint §3d).
  float shaped = (uZCurve == 1.0) ? luma : pow(max(luma, 0.0), uZCurve);

  // Pivot moves the zero plane, so the relief can sit AROUND the sheet instead
  // of only in front of it — valleys as well as ridges. Default 0 keeps the
  // one-sided behaviour every existing patch was built on.
  float z = (shaped - uZPivot) * uZGain;

  // Displace along the SURFACE NORMAL. On the plane the normal is (0,0,1), so
  // this is (x, y, 0) + (0,0,z) — bit-identical to the flat-only version it
  // replaces, which is what keeps every pre-shape patch rendering unchanged.
  vec3 p = position + normal * z;

  vec4 clip = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  // Ribbon expansion in clip space — see note 1 in the header.
  clip.y += aSide * uThickness * clip.w / max(uResolution.y * 0.5, 1.0);
  gl_Position = clip;

  // Points draw from this same material and shader. aSide is 0 in the point
  // geometry, so the ribbon term above contributes nothing there, and setting
  // gl_PointSize is simply ignored when the draw is triangles — which is what
  // lets one material serve both modes instead of two that must be kept in step.
  //
  // Its own uniform, NOT uThickness: in Both mode the useful setting is a thin
  // ribbon under prominent dots, which a shared width cannot express.
  gl_PointSize = uPointSize;
}
`;

const SCAN_FRAG = `
varying float vLuma;
varying vec3  vColor;
uniform vec3  uTint;
uniform float uColorAmt;

void main() {
  // The beam is as bright as the signal that deflected it, so the lattice
  // disappears into black where the source is black. What COLOUR it is runs
  // between two ends:
  //
  //   uColorAmt 0 — a phosphor of one colour, brightness carrying the signal.
  //                 uTint white (the default) is the original monochrome, exactly.
  //   uColorAmt 1 — the source's own colour, carried through per vertex.
  //
  // Tinting happens HERE, per line, rather than after accumulation. Under the
  // additive blend that means densely overlapped regions climb toward white
  // instead of holding the hue — which is what an over-driven CRT does when the
  // beam retraces the same phosphor, so it is the behaviour to want rather than
  // one to correct. It also keeps this a single pass.
  vec3 mono = uTint * vLuma;
  gl_FragColor = vec4(mix(mono, vColor, uColorAmt), 1.0);
}
`;

/**
 * Fragment shader for the POINT draw. Identical colour handling to SCAN_FRAG,
 * plus a spherical profile.
 *
 * It has to be a separate shader rather than a branch in the shared one:
 * gl_PointCoord is only defined while rasterising points, and reading it during
 * a triangle draw is undefined behaviour. Two materials over ONE shared uniforms
 * object costs nothing and keeps that boundary honest.
 *
 * No discard, and no alpha test. THREE.AdditiveBlending is (SrcAlpha, One), so
 * the contribution is rgb × a — scaling the colour by a profile that reaches 0
 * at the rim removes the corners for free, and the hemisphere term is 0 outside
 * the disc anyway because of the max().
 */
const SCAN_FRAG_POINT = `
varying float vLuma;
varying vec3  vColor;
uniform vec3  uTint;
uniform float uColorAmt;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  // Height of a unit hemisphere over the point sprite: 1 at the centre, 0 at
  // the rim, and exactly 0 beyond it. Round AND shaded, from one expression.
  float sphere = sqrt(max(0.0, 0.25 - dot(d, d))) * 2.0;
  vec3 mono = uTint * vLuma;
  gl_FragColor = vec4(mix(mono, vColor, uColorAmt) * sphere, 1.0);
}
`;

const DECAY_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DECAY_FRAG = `
uniform sampler2D tPrev;
uniform float uDecay;
uniform float uBleed;
uniform vec2  uTexel;
varying vec2 vUv;

void main() {
  // Spatial phosphor decay: the trail DIFFUSES as it fades instead of just
  // dimming in place, which is the difference between a ghost image and a glow.
  //
  // The weights sum to exactly 1.0, so this redistributes energy and cannot add
  // any. That matters more here than it looks: the lattice is drawn with
  // ADDITIVE blending on top of this buffer every frame, so a kernel with gain
  // above 1 would compound with the accumulation and run the buffer away to
  // white — the same failure rutt.decay is capped at 0.98 to avoid.
  //
  // At uBleed 0 every tap lands on the same texel and the sum is the centre
  // value back (exact but for float summation order), so the knob is its own
  // identity with no branch. At the default decay of 0 the pass outputs black
  // regardless, so nothing accumulates until trails are asked for.
  vec2 o = uTexel * uBleed;
  vec3 c = texture2D(tPrev, vUv).rgb                        * 0.4
         + texture2D(tPrev, vUv + vec2( o.x, 0.0)).rgb      * 0.15
         + texture2D(tPrev, vUv + vec2(-o.x, 0.0)).rgb      * 0.15
         + texture2D(tPrev, vUv + vec2( 0.0,  o.y)).rgb     * 0.15
         + texture2D(tPrev, vUv + vec2( 0.0, -o.y)).rgb     * 0.15;
  gl_FragColor = vec4(c * uDecay, 1.0);
}
`;

const SLEW_FRAG = `
uniform sampler2D uSrc;
uniform sampler2D tPrev;
uniform float uCoefUp;
uniform float uCoefDown;
varying vec2 vUv;

void main() {
  // Asymmetric temporal slew — jit.slide semantics, with the coefficients
  // derived from dt on the CPU so the times are in SECONDS and the feel does
  // not change between 30 and 60 fps. The discrete step is exact about this:
  // each frame multiplies the remaining distance by exp(-dt/tau), so n steps
  // land on exp(-n·dt/tau) no matter how n and dt were divided up.
  //
  // mix(prev, src, k) rather than prev + (src-prev)*k: at k = 1 the former is
  // exactly src, while the latter is only nearly so in floating point, and
  // "nearly" would leave a permanent residue at the default.
  //
  // Per channel, so R, G and B glide independently — which is also what real
  // phosphors do, their persistences differing by colour.
  vec3 src = texture2D(uSrc, vUv).rgb;
  vec3 prv = texture2D(tPrev, vUv).rgb;
  vec3 rising = vec3(greaterThan(src, prv));
  vec3 k = mix(vec3(uCoefDown), vec3(uCoefUp), rising);

  // GUARANTEED PROGRESS. An exponential approach takes ever smaller steps, and
  // the buffer is half float: near 1.0 one ulp is about 1e-3, so once the step
  // falls below that it rounds to nothing and the glide FREEZES short of its
  // target — measured stuck at 98.5 against 100.9, identical at frame 300 and
  // frame 2000. Not a rounding curiosity: a slow slide that visibly never
  // arrives. So any step smaller than an ulp is replaced by exactly one ulp in
  // the right direction, then clamped so it cannot overshoot.
  //
  // The tail therefore approaches linearly over its last ~1e-3 rather than
  // exponentially. Invisible, and it only engages where the exponential has
  // already stopped moving. sign(0) is 0, so a converged pixel stays put.
  vec3 d = src - prv;
  vec3 stepv = d * k;
  const float ULP = 0.001;
  vec3 progressed = mix(stepv, sign(d) * ULP, vec3(lessThan(abs(stepv), vec3(ULP))));
  gl_FragColor = vec4(prv + clamp(progressed, -abs(d), abs(d)), 1.0);
}
`;

// ─────────────────────────────────────────────────────────────────────────────
// Surfaces
// ─────────────────────────────────────────────────────────────────────────────
// Each writes a position and a unit normal for (u, v) ∈ [0,1]² into a scratch
// object — no per-vertex allocation, at up to 245k vertices.
//
// v indexes the SCANLINE and u the sample along it, so every surface here must
// have a natural family of curves at constant v: latitude rings on a sphere,
// stacked rings on a cylinder, loops round a torus, nested helices on a
// helicoid. That is the whole reason these are worth having and an imported
// mesh is not — the scan structure is the instrument, not the shape.
//
// uv is (u, 1−v) throughout, matching the plane's original mapping, so a source
// stays upright and the video wraps the same way on every surface.

const TAU = Math.PI * 2;

/**
 * Gyroid: sin x cos y + sin y cos z + sin z cos x = 0.
 *
 * The odd one out — a triply periodic minimal surface with NO closed-form
 * parameterisation, so there is no (u,v) grid to hang scanlines on. Solved here
 * as a height field: march z at each grid point, take the first sign change and
 * bisect. That yields ONE SHEET of the gyroid rather than the full labyrinth,
 * which is the honest trade for keeping the scan structure — and it is the real
 * surface, with the real saddles, not an approximation of one.
 *
 * The gradient is analytic, so normals cost nothing and are exact.
 */
const gyroidF = (x, y, z) =>
  Math.sin(x) * Math.cos(y) + Math.sin(y) * Math.cos(z) + Math.sin(z) * Math.cos(x);

function gyroidZ(x, y) {
  const STEPS = 24, LO = -Math.PI, HI = Math.PI;
  let z0 = LO, f0 = gyroidF(x, y, z0);
  for (let i = 1; i <= STEPS; i++) {
    const z1 = LO + ((HI - LO) * i) / STEPS;
    const f1 = gyroidF(x, y, z1);
    if ((f0 <= 0 && f1 >= 0) || (f0 >= 0 && f1 <= 0)) {
      let a = z0, b = z1, fa = f0;
      for (let k = 0; k < 18; k++) {          // bisect to well under a pixel
        const m = (a + b) * 0.5, fm = gyroidF(x, y, m);
        if ((fa <= 0 && fm >= 0) || (fa >= 0 && fm <= 0)) b = m;
        else { a = m; fa = fm; }
      }
      return (a + b) * 0.5;
    }
    z0 = z1; f0 = f1;
  }
  return 0;                                    // no crossing on this ray
}

const SURFACES = [
  // 0 — Plane. The original lattice, and the identity case: normal (0,0,1)
  // makes `position + normal * z` exactly the old `(x, y, z)`.
  (u, v, o) => {
    o.px = 2 * u - 1; o.py = 1 - 2 * v; o.pz = 0;
    o.nx = 0; o.ny = 0; o.nz = 1;
  },
  // 1 — Sphere. Scanlines are lines of latitude; on a unit sphere the outward
  // normal is the position.
  (u, v, o) => {
    const th = v * Math.PI, ph = u * TAU;
    const st = Math.sin(th);
    o.px = st * Math.cos(ph); o.py = Math.cos(th); o.pz = st * Math.sin(ph);
    o.nx = o.px; o.ny = o.py; o.nz = o.pz;
  },
  // 2 — Cylinder. Rings stacked up the axis; the normal is radial, so the caps
  // are open by construction — which is right for a scan, not a solid.
  (u, v, o) => {
    const ph = u * TAU, c = Math.cos(ph), s = Math.sin(ph);
    o.px = c; o.py = 1 - 2 * v; o.pz = s;
    o.nx = c; o.ny = 0; o.nz = s;
  },
  // 3 — Torus. Each scanline is a full loop round the major circle, at a fixed
  // angle round the tube.
  (u, v, o) => {
    const R = 0.72, r = 0.34;
    const ph = u * TAU, th = v * TAU;
    const ct = Math.cos(th), st = Math.sin(th);
    const cp = Math.cos(ph), sp = Math.sin(ph);
    o.px = (R + r * ct) * cp; o.py = r * st; o.pz = (R + r * ct) * sp;
    o.nx = ct * cp; o.ny = st; o.nz = ct * sp;
  },
  // 4 — Catenoid. The minimal surface of revolution: r(t) = c·cosh(t/c), a
  // waist that flares at both ends. Normal from the revolution's partials,
  // which reduce to (cos φ, −r′, sin φ)/√(1+r′²) with r′ = sinh(t/c).
  (u, v, o) => {
    const c = 0.6, t = (v - 0.5) * 1.8;
    const ph = u * TAU, cp = Math.cos(ph), sp = Math.sin(ph);
    const r = c * Math.cosh(t / c), rp = Math.sinh(t / c);
    const k = 1 / Math.sqrt(1 + rp * rp);
    o.px = r * cp; o.py = t; o.pz = r * sp;
    o.nx = cp * k; o.ny = -rp * k; o.nz = sp * k;
  },
  // 5 — Helicoid. Scanlines are NESTED HELICES — constant radius, sweeping
  // round as they rise — rather than the straight rulings, which would read as
  // a fan of spokes instead of a raster.
  (u, v, o) => {
    const turns = 1, b = 1 / Math.PI;
    const s = u * TAU * turns, t = (v - 0.5) * 2;
    const cs = Math.cos(s), ss = Math.sin(s);
    o.px = t * cs; o.py = b * s - 1; o.pz = t * ss;
    const nx = b * ss, ny = t, nz = -b * cs;
    const k = 1 / Math.max(1e-6, Math.hypot(nx, ny, nz));
    o.nx = nx * k; o.ny = ny * k; o.nz = nz * k;
  },
  // 6 — Gyroid, as a height field over the scan grid (see gyroidZ).
  (u, v, o) => {
    const x = (2 * u - 1) * Math.PI, y = (1 - 2 * v) * Math.PI;
    const z = gyroidZ(x, y);
    const IP = 1 / Math.PI;
    o.px = x * IP; o.py = y * IP; o.pz = z * IP;
    const gx = Math.cos(x) * Math.cos(y) - Math.sin(z) * Math.sin(x);
    const gy = -Math.sin(x) * Math.sin(y) + Math.cos(y) * Math.cos(z);
    const gz = -Math.sin(y) * Math.sin(z) + Math.cos(z) * Math.cos(x);
    const k = 1 / Math.max(1e-6, Math.hypot(gx, gy, gz));
    o.nx = gx * k; o.ny = gy * k; o.nz = gz * k;
  },
];

/**
 * Horizontal sample count for a given line count.
 *
 * The ceiling was 512, which meant every line count above 256 sampled the SAME
 * 512 columns — the scan got denser vertically and stayed exactly as coarse
 * horizontally, so the relief stopped gaining detail long before the Lines
 * knob ran out. 2048 keeps the 2:1 ratio honest across the whole (raised)
 * range: at the 1080-line maximum the lattice is 1080×2160, ~2.3M grid points.
 * That is a real cost — _rebuild() walks the grid in JS and reallocates, so a
 * drag across the top of the Lines range stutters. It is paid only by whoever
 * asks for it, and the alternative is a knob whose top half does nothing.
 */
const colsFor = (lines) => Math.min(2048, Math.max(32, Math.round(lines * 2)));

/**
 * Resolution of the slew history. FIXED, and deliberately decoupled from both
 * the canvas and the line count: sizing it to the lattice would mean every
 * change of rutt.lines reallocated the buffer and wiped the momentum mid-glide.
 * Sized to the maximum horizontal sampling density colsFor() can ask for, so
 * the slew field is never the thing that limits detail. 2048² RGBA half-float
 * is ~34MB, ~67MB for the ping-pong pair — 16× the old footprint, but _ensureSlew()
 * allocates on first use, so a project that never engages slew never pays it.
 */
const SLEW_RES = 2048;

export class RuttEtra {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.active   = false;

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    };
    // Ping-pong for phosphor persistence. Two targets rather than a feedback
    // guard, per the mix-bus precedent in CLAUDE.md: this is the case where a
    // second target beats a guard.
    this._rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this._rtB = new THREE.WebGLRenderTarget(width, height, opts);
    this._cur = this._rtA;

    // ONE uniforms object, shared by reference between the two materials, so
    // tick() writes it once and both draws see it. three assigns the object
    // straight through — cloning is opt-in via UniformsUtils, which is exactly
    // what we do not want here.
    const shared = {
      uSrc:        { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) },
      uZGain:      { value: 0.5 },
      uZCurve:     { value: 1.0 },
      uZPivot:     { value: 0.0 },
      uThickness:  { value: 1.5 },
      uPointSize:  { value: 3 },
      uTint:       { value: new THREE.Color(1, 1, 1) },
      uColorAmt:   { value: 0 },
      uResolution: { value: new THREE.Vector2(width, height) },
    };

    this._mat = new THREE.ShaderMaterial({
      uniforms: shared,
      vertexShader:   SCAN_VERT,
      fragmentShader: SCAN_FRAG,
      blending:   THREE.AdditiveBlending,
      depthTest:  false,
      depthWrite: false,
      // MANDATORY, not a default worth trimming. The ribbon is expanded after
      // projection, which makes its screen-space winding a function of where the
      // camera is: at azimuth 0 every triangle comes out clockwise and FrontSide
      // culls the entire lattice, then it reappears once the orbit flips the x
      // ordering. Since rutt.angle defaults to 0, that reads as "the source is
      // broken" rather than "the winding is backwards". A beam has no facing.
      side: THREE.DoubleSide,
    });

    this._matPoints = new THREE.ShaderMaterial({
      uniforms: shared,                 // same object, not a copy
      vertexShader:   SCAN_VERT,
      fragmentShader: SCAN_FRAG_POINT,
      blending:   THREE.AdditiveBlending,
      depthTest:  false,
      depthWrite: false,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);
    // YXZ so that y reads as orbit and x as elevation, applied in that order.
    // Set once: assigning .order re-derives the quaternion, and doing it per
    // frame would be churn for a constant.
    this._camera.rotation.order = 'YXZ';

    // Both lattices live under one group, which carries the aspect scale and
    // the Move offset. Two objects that must agree on placement is two chances
    // to forget one — and _rebuild() replaces them, so per-object transforms
    // would have to be reapplied on every line-count change.
    this._rig = new THREE.Group();
    this._scene.add(this._rig);

    // The PLANE is authored square and scaled to the frame's aspect, so a 16:9
    // source is scanned at 16:9 rather than squeezed into a square raster
    // floating in a wide frame. The 3D surfaces are NOT stretched — an aspect
    // scale would make a sphere an ellipsoid — so tick() applies it per shape.
    // uv comes from the unscaled attribute either way.
    this._aspect = width / height;
    this._lines  = 0;              // forces the first _rebuild()
    this._shape  = -1;             // ditto
    this._mesh   = null;
    this._points = null;
    this._hueCol = new THREE.Color(); // scratch, so tick() allocates nothing
    this._surf   = { px: 0, py: 0, pz: 0, nx: 0, ny: 0, nz: 1 };
    this._rebuild(120, 0);

    // Decay pass — its own tiny scene, drawn before the lattice each frame.
    this._decayMat = new THREE.ShaderMaterial({
      uniforms: {
        tPrev:  { value: null },
        uDecay: { value: 0 },
        uBleed: { value: 0 },
        uTexel: { value: new THREE.Vector2(1 / width, 1 / height) },
      },
      vertexShader:   DECAY_VERT,
      fragmentShader: DECAY_FRAG,
      depthTest:  false,
      depthWrite: false,
    });
    this._decayScene = new THREE.Scene();
    this._decayCam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._decayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._decayMat));

    // Slew history. HalfFloat, not UnsignedByte: at long time constants a single
    // frame moves the value by a fraction of a 1/255 step, which would round to
    // zero and stall the glide short of its target — a slow slide that visibly
    // never arrives. Allocated lazily, so a patch that never asks for slew pays
    // nothing for it.
    this._slewMat = new THREE.ShaderMaterial({
      uniforms: {
        uSrc:      { value: null },
        tPrev:     { value: null },
        uCoefUp:   { value: 1 },
        uCoefDown: { value: 1 },
      },
      vertexShader:   DECAY_VERT,
      fragmentShader: SLEW_FRAG,
      depthTest:  false,
      depthWrite: false,
    });
    this._slewScene = new THREE.Scene();
    this._slewScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._slewMat));
    this._slewA = null;
    this._slewB = null;
    this._slewCur  = null;
    this._slewWarm = false;
  }

  /** Allocate the slew pair on first use. */
  _ensureSlew() {
    if (this._slewA) return;
    const o = {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, type: THREE.HalfFloatType, depthBuffer: false,
    };
    this._slewA = new THREE.WebGLRenderTarget(SLEW_RES, SLEW_RES, o);
    this._slewB = new THREE.WebGLRenderTarget(SLEW_RES, SLEW_RES, o);
    this._slewCur = this._slewA;
  }

  /**
   * Seed both buffers with the current source, so enabling slew glides from what
   * is on screen now rather than from whatever frame was left in the history the
   * last time it was switched off.
   */
  _primeSlew(srcTex) {
    const r = this.renderer;
    const u = this._slewMat.uniforms;
    u.uSrc.value = srcTex;
    u.tPrev.value = srcTex;
    u.uCoefUp.value = 1;
    u.uCoefDown.value = 1;
    for (const rt of [this._slewA, this._slewB]) {
      r.setRenderTarget(rt);
      r.render(this._slewScene, this._decayCam);
    }
    r.setRenderTarget(null);
    this._slewCur = this._slewA;
    this._slewWarm = true;
  }

  /**
   * Rebuild the scanline lattice. Only on a line-count change — this allocates,
   * so calling it per frame would churn buffers for a knob that rarely moves.
   */
  _rebuild(lines, shape) {
    if (lines === this._lines && shape === this._shape) return;
    this._lines = lines;
    this._shape = shape;
    const cols = colsFor(lines);

    const verts = lines * cols * 2;
    const surf = SURFACES[shape] ?? SURFACES[0];
    const o = this._surf;

    const pos   = new Float32Array(verts * 3);
    const nrm   = new Float32Array(verts * 3);
    const uvs   = new Float32Array(verts * 2);
    const side  = new Float32Array(verts);
    // Two triangles per span, per line.
    const idx   = new Uint32Array(lines * (cols - 1) * 6);

    let v = 0, t = 0;
    for (let li = 0; li < lines; li++) {
      const vv = lines === 1 ? 0.5 : li / (lines - 1);
      for (let ci = 0; ci < cols; ci++) {
        const uu = ci / (cols - 1);
        surf(uu, vv, o);
        // The ±aSide pair shares one surface sample: same position, normal and
        // uv, separated only in clip space by the ribbon expansion.
        for (const s of [-1, 1]) {
          pos[v * 3] = o.px; pos[v * 3 + 1] = o.py; pos[v * 3 + 2] = o.pz;
          nrm[v * 3] = o.nx; nrm[v * 3 + 1] = o.ny; nrm[v * 3 + 2] = o.nz;
          uvs[v * 2] = uu;   uvs[v * 2 + 1] = 1 - vv;
          side[v]    = s;
          v++;
        }
      }
      for (let ci = 0; ci < cols - 1; ci++) {
        const b = (li * cols + ci) * 2;
        idx[t++] = b;     idx[t++] = b + 1; idx[t++] = b + 2;
        idx[t++] = b + 1; idx[t++] = b + 3; idx[t++] = b + 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal',   new THREE.BufferAttribute(nrm, 3));
    geo.setAttribute('uv',       new THREE.BufferAttribute(uvs, 2));
    geo.setAttribute('aSide',    new THREE.BufferAttribute(side, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // The lattice is displaced in the vertex stage, so three cannot cull it from
    // the authored positions — it would vanish the moment the relief left the
    // flat plane's bounds.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);

    if (this._mesh) {
      this._rig.remove(this._mesh);
      this._mesh.geometry.dispose();
    }
    this._mesh = new THREE.Mesh(geo, this._mat);
    this._mesh.frustumCulled = false;
    this._rig.add(this._mesh);

    // Point lattice: one vertex per sample rather than the ribbon's pair, so
    // Points mode does not draw every dot twice at the ±aSide offsets. aSide is
    // 0 throughout, which is what makes the shared material behave.
    const pPos  = new Float32Array(lines * cols * 3);
    const pNrm  = new Float32Array(lines * cols * 3);
    const pUv   = new Float32Array(lines * cols * 2);
    const pSide = new Float32Array(lines * cols);   // all zero
    let q = 0;
    for (let li = 0; li < lines; li++) {
      const vv = lines === 1 ? 0.5 : li / (lines - 1);
      for (let ci = 0; ci < cols; ci++) {
        const uu = ci / (cols - 1);
        surf(uu, vv, o);
        pPos[q * 3] = o.px; pPos[q * 3 + 1] = o.py; pPos[q * 3 + 2] = o.pz;
        pNrm[q * 3] = o.nx; pNrm[q * 3 + 1] = o.ny; pNrm[q * 3 + 2] = o.nz;
        pUv[q * 2]  = uu;   pUv[q * 2 + 1]  = 1 - vv;
        q++;
      }
    }
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pGeo.setAttribute('normal',   new THREE.BufferAttribute(pNrm, 3));
    pGeo.setAttribute('uv',       new THREE.BufferAttribute(pUv, 2));
    pGeo.setAttribute('aSide',    new THREE.BufferAttribute(pSide, 1));
    pGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);

    if (this._points) {
      this._rig.remove(this._points);
      this._points.geometry.dispose();
    }
    this._points = new THREE.Points(pGeo, this._matPoints);
    this._points.frustumCulled = false;
    this._rig.add(this._points);
  }

  /**
   * @param {object} ps      ParameterSystem
   * @param {number} dt      seconds since the last tick; drives the slew coefficients
   * @param {THREE.Texture} srcTex  resolved by _resolveLayerTex() in main.js
   */
  tick(ps, dt, srcTex) {
    this.active = !!ps.get('rutt.active').value;
    if (!this.active) return;

    const shape = ps.get('rutt.shape').value | 0;
    this._rebuild(Math.max(2, Math.round(ps.get('rutt.lines').value)), shape);

    // Aspect stretch is a PLANE affordance — it makes a 16:9 source scan at
    // 16:9. Applying it to a sphere would just make an ellipsoid.
    this._rig.scale.x = shape === 0 ? this._aspect : 1;

    // 0 Lines · 1 Points · 2 Both. Both is free — the two draws share a
    // material and the same additive target.
    const mode = ps.get('rutt.drawMode').value;
    this._mesh.visible   = mode !== 1;
    this._points.visible = mode !== 0;

    const u = this._mat.uniforms;

    // ── Temporal slew ────────────────────────────────────────────────────────
    // Off is a BYPASS, not a pass-through at coefficient 1: routing the source
    // through a fixed 512² history would resample it and soften the picture even
    // while the effect did nothing. At rise = fall = 0 the vertex shader reads
    // the source exactly as it did before this existed.
    const rise = ps.get('rutt.rise').value;
    const fall = ps.get('rutt.fall').value;
    let scanTex = srcTex;

    if (srcTex && (rise > 0 || fall > 0)) {
      this._ensureSlew();
      if (!this._slewWarm) this._primeSlew(srcTex);

      // Clamp dt: a backgrounded tab resumes with a huge one, and a snap is the
      // right answer there — but the clamp keeps exp() out of denormal territory
      // rather than leaving it to chance.
      const d = Math.min(Math.max(dt, 0), 0.25);
      const su = this._slewMat.uniforms;
      su.uCoefUp.value   = rise > 0 ? 1 - Math.exp(-d / rise) : 1;
      su.uCoefDown.value = fall > 0 ? 1 - Math.exp(-d / fall) : 1;
      su.uSrc.value  = srcTex;
      su.tPrev.value = this._slewCur.texture;

      const next = this._slewCur === this._slewA ? this._slewB : this._slewA;
      this.renderer.setRenderTarget(next);
      this.renderer.render(this._slewScene, this._decayCam);
      this.renderer.setRenderTarget(null);
      this._slewCur = next;
      scanTex = next.texture;
    } else {
      this._slewWarm = false;
    }

    if (scanTex) u.uSrc.value = scanTex;
    u.uZGain.value     = ps.get('rutt.zgain').value;
    u.uZCurve.value    = ps.get('rutt.zcurve').value;
    u.uZPivot.value    = ps.get('rutt.zpivot').value;
    u.uThickness.value = ps.get('rutt.thickness').value;
    u.uPointSize.value = ps.get('rutt.pointSize').value;

    // Tint is a lerp from WHITE toward the pure hue, not an HSL colour: at
    // saturation 0 it must be exactly (1,1,1) so the default is the original
    // monochrome, and setHSL(h, 0, 0.5) would give mid grey instead. A
    // consequence worth knowing: hue is inert while saturation is 0, which the
    // harness asserts rather than leaving to be discovered.
    u.uColorAmt.value = ps.get('rutt.colorAmt').value;
    const sat = ps.get('rutt.sat').value;
    this._hueCol.setHSL(ps.get('rutt.hue').value / 360, 1, 0.5);
    u.uTint.value.setRGB(
      1 + (this._hueCol.r - 1) * sat,
      1 + (this._hueCol.g - 1) * sat,
      1 + (this._hueCol.b - 1) * sat,
    );

    // Orientation from Euler angles, NOT lookAt.
    //
    // lookAt needs an up vector, and at ±90° elevation the camera's forward is
    // colinear with it: the orientation is undefined and the picture flips or
    // goes to NaN. That is the only reason Orbit Y was ever clamped to ±89 —
    // a wall in the middle of a control that should turn freely.
    //
    // Rotating the camera and then backing it off along its own +Z instead is
    // defined everywhere, poles included, and it is not an approximation of the
    // old rig: for order YXZ, R = Ry(az)·Rx(-el) sends local +Z to
    // (cos el·sin az, sin el, cos el·cos az) — the exact spherical position the
    // previous code wrote by hand. Every angle that worked before is unchanged;
    // the rest simply now exist. Past 90° the picture inverts as you pass over
    // the top, which is the point of letting it go round.
    const az   = ps.get('rutt.angle').value * (Math.PI / 180);
    const el   = ps.get('rutt.elev').value  * (Math.PI / 180);
    const dist = ps.get('rutt.dist').value;
    const cam  = this._camera;
    cam.rotation.set(-el, az, 0);      // order 'YXZ', set once in the constructor
    cam.position.set(0, 0, 0);
    cam.translateZ(dist);

    // Placement. Moves the lattice rather than the camera, so it swings through
    // perspective as it goes rather than sliding flatly across — and it composes
    // with the orbit instead of fighting it. Z is distinct from Distance: this
    // pushes the object through the scene, Distance dollies the camera.
    this._rig.position.set(
      ps.get('rutt.moveX').value,
      ps.get('rutt.moveY').value,
      ps.get('rutt.moveZ').value,
    );

    // Ping-pong: last frame decayed into the back buffer, this frame's lattice
    // additively on top, then flip. Reading _cur while writing the other target
    // is why this needs no feedback guard.
    const prev = this._cur;
    const next = prev === this._rtA ? this._rtB : this._rtA;

    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;

    r.setRenderTarget(next);
    r.clear(true, true, true);
    this._decayMat.uniforms.tPrev.value  = prev.texture;
    this._decayMat.uniforms.uDecay.value = ps.get('rutt.decay').value;
    this._decayMat.uniforms.uBleed.value = ps.get('rutt.bleed').value;
    r.render(this._decayScene, this._decayCam);
    r.render(this._scene, this._camera);
    r.setRenderTarget(null);

    r.autoClear = prevAutoClear;
    this._cur = next;
  }

  get texture() { return this._cur.texture; }

  resize(w, h) {
    this._rtA.setSize(w, h);
    this._rtB.setSize(w, h);
    this._mat.uniforms.uResolution.value.set(w, h);
    this._decayMat.uniforms.uTexel.value.set(1 / w, 1 / h);
    this._aspect = w / h;          // applied per shape in tick()
    this._camera.aspect = this._aspect;
    this._camera.updateProjectionMatrix();
  }

  dispose() {
    this._rtA.dispose();
    this._rtB.dispose();
    this._slewA?.dispose();
    this._slewB?.dispose();
    this._slewMat.dispose();
    this._slewScene.children[0].geometry.dispose();
    this._mat.dispose();
    this._matPoints.dispose();
    this._decayMat.dispose();
    this._decayScene.children[0].geometry.dispose();
    if (this._mesh) this._mesh.geometry.dispose();
    if (this._points) this._points.geometry.dispose();
  }
}
