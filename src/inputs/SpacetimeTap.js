/**
 * ImWeb Spacetime Tap — one plane through the frame history.
 *
 * A tap owns a per-pixel delay map, an output render target, and one read pass.
 * It owns NO history: it samples a `SpacetimeRing` it is handed. Several taps
 * read one ring at different orientations, which is what makes `tdisp`, `delay`,
 * `slitscan` and `vwarp` affordable as four sources over one buffer instead of
 * four private buffers. Blueprint: docs/ImWeb-Spacetime-Blueprint.md §2, §5.
 *
 * The delay map decides, per fragment, how far back in time that pixel reads.
 * Today it is the seven `td.mode` shapes; Phase 25 step 4 generalises it to a
 * continuously orientable plane, at which point `td.mode` becomes a set of
 * presets that write plane parameters rather than a shader branch.
 *
 * GLSL lives here rather than in src/shaders/index.js, matching the pre-existing
 * arrangement in this file's ancestor (TimeDisplaceEngine) and the sibling
 * buffer engines: these shaders are meaningless outside their engine and take
 * uniforms nothing else supplies.
 */

import * as THREE from 'three';
import { VERT } from '../shaders/index.js';

// ── GLSL3 array-texture read shader vertex stage ─────────────────────────────
const ARRAY_READ_VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

/**
 * The per-pixel delay map, m(uv) → 0..1, and the uniforms that shape it.
 *
 * ONE COPY, shared by both read shaders. The array path is GLSL3
 * (`sampler2DArray`) and the atlas path is GLSL1 (`sampler2D`), so the two
 * shaders differ in dialect — but the *logic* deciding how far back each pixel
 * reads must not. Six hand-synced copies of the source list once existed in this
 * project and three had drifted; this is that hazard at shader scale, so `m` has
 * exactly one definition and the callers pass in the one thing that must be
 * sampled dialect-locally (the map texture's luminance).
 *
 * Phase 3 semantics preserved verbatim: d(x,y) from screen UV by mode
 * (slitScanX/Y ramps, warpLine band, symmetric ramps, radial, noise), then
 * shaped by delayCurve/direction by the caller. Nearest frame (floor) —
 * frameBlend is Phase 5.
 */
const DELAY_MAP_CHUNK = /* glsl */ `
  uniform int   uMode;       // 0 slitScanX, 1 slitScanY, 2 warpLine,
                             // 3 slitScanXSym, 4 slitScanYSym, 5 radial, 6 noise
  uniform float uScanPos;    // warpLine band centre (0..1, along x); radial centre x
  uniform float uScanPosY;   // radial centre y (0..1)
  uniform float uScanWidth;  // warpLine band width (fraction of frame)
  uniform float uInvert;     // >0.5 flips map value

  // mapLum = luminance of the map source at uv, sampled by the caller.
  float tdDelayMap(vec2 uv, float mapLum) {
    float m;
    if (uMode == 0) {
      m = uv.x;                                            // slitScanX
    } else if (uMode == 1) {
      m = uv.y;                                            // slitScanY
    } else if (uMode == 2) {
      m = (abs(uv.x - uScanPos) < uScanWidth * 0.5)
          ? 0.0 : 1.0;                                      // warpLine: live band else full delay
    } else if (uMode == 3 || uMode == 4) {
      // slitScanX/Y symmetric: live band centred on uScanPos along the chosen
      // axis, curve ramps outward toward whichever edge is farther.
      float p       = (uMode == 3) ? uv.x : uv.y;
      float dist    = abs(p - uScanPos);
      float maxDist = max(uScanPos, 1.0 - uScanPos);
      m = clamp((dist - uScanWidth * 0.5) / max(maxDist - uScanWidth * 0.5, 1e-5), 0.0, 1.0);
    } else if (uMode == 5) {
      // radial: live circle centred on (uScanPos, uScanPosY), curve ramps
      // outward across both width and height
      float dist    = length(uv - vec2(uScanPos, uScanPosY));
      float maxDist = 0.70710678; // half-diagonal of unit square (0.5*sqrt(2))
      m = clamp((dist - uScanWidth * 0.5) / max(maxDist - uScanWidth * 0.5, 1e-5), 0.0, 1.0);
    } else {
      m = mapLum;             // noise: per-pixel delay from the map source
    }
    if (uInvert > 0.5) m = 1.0 - m;
    return clamp(m, 0.0, 1.0);
  }

  // Luminance weights, robust across noise.color modes.
  float tdLuma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

const ARRAY_READ_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler2DArray;
  uniform sampler2DArray tRing;
  uniform sampler2D uNoiseTex; // td.mode==6: per-pixel delay map source
  uniform int   uHead;       // next-write slot; newest capture = head-1
  uniform int   uN;          // ring depth (slots)
  uniform int   uCount;      // captured frames so far (clamp to real history)
  uniform int   uDirection;  // 0 forward, 1 backward (reflect window)
  uniform float uMaxDelay;   // frames
  uniform float uDelayCurve; // gamma on map value
  in  vec2 vUv;
  out vec4 outColor;
${DELAY_MAP_CHUNK}
  void main() {
    float m = tdDelayMap(vUv, tdLuma(texture(uNoiseTex, vUv).rgb));
    float d = pow(m, uDelayCurve) * uMaxDelay;
    if (uDirection == 1) d = uMaxDelay - d;                // backward = reflect window
    float maxBack = float(max(1, min(uN - 1, uCount - 1)));
    d = clamp(d, 0.0, maxBack);
    int layer = (uHead - 1 - int(floor(d))) % uN;          // 0 → newest captured
    layer = (layer + uN) % uN;                             // wrap negative (range [-N, N-2])
    outColor = texture(tRing, vec3(vUv, float(layer)));
  }
`;

/**
 * Atlas read shader (GLSL1). Same delay map, same age arithmetic; the ring is a
 * cols×rows grid of frames in ONE sampler2D, so a frame index becomes a tile
 * offset.
 *
 * `uInset` clamps tile-local uv by half an atlas texel so LinearFilter cannot
 * bleed a neighbouring tile in at the edges — that seam is a thin wrong-coloured
 * line, easy to miss in motion and hard to attribute later.
 *
 * Index math is deliberately float: GLSL1 integer support is minimal, and
 * `SpacetimeRing._tileOf()` mirrors this exactly so write and read agree.
 */
const ATLAS_READ_FRAG = /* glsl */ `
  precision highp float;
  uniform sampler2D tRing;
  uniform sampler2D uNoiseTex;
  uniform float uHead;       // next-write slot
  uniform float uN;          // slot count (atlas capacity, NOT frames)
  uniform float uCount;      // captured frames so far
  uniform float uCols;       // tiles per row
  uniform vec2  uTileScale;  // (1/cols, 1/rows)
  uniform vec2  uInset;      // half-texel inset in tile-local uv
  uniform int   uDirection;
  uniform float uMaxDelay;
  uniform float uDelayCurve;
  varying vec2 vUv;
${DELAY_MAP_CHUNK}
  void main() {
    float m = tdDelayMap(vUv, tdLuma(texture2D(uNoiseTex, vUv).rgb));
    float d = pow(m, uDelayCurve) * uMaxDelay;
    if (uDirection == 1) d = uMaxDelay - d;
    float maxBack = max(1.0, min(uN - 1.0, uCount - 1.0));
    d = clamp(d, 0.0, maxBack);
    // + 2.0*uN keeps the operand positive before mod(): GLSL mod() on a
    // negative left operand is implementation-defined in practice.
    float idx   = mod(uHead - 1.0 - floor(d) + 2.0 * uN, uN);
    vec2  tile  = vec2(mod(idx, uCols), floor(idx / uCols));
    vec2  local = clamp(vUv, uInset, 1.0 - uInset);
    gl_FragColor = texture2D(tRing, (tile + local) * uTileScale);
  }
`;

/** Shape of the per-frame read options. All fields optional; defaults are neutral. */
const DEFAULTS = {
  mode: 0, direction: 0, maxDelay: 0, delayCurve: 1.0,
  scanPos: 0.5, scanPosY: 0.5, scanWidth: 0.05, invert: 0,
};

export class SpacetimeTap {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} width   output width (normally the ring's tile size)
   * @param {number} height  output height
   * @param {THREE.TextureFilter} filter  output magnification filter
   */
  constructor(renderer, width, height, filter = THREE.LinearFilter) {
    this.renderer = renderer;
    this._w = Math.max(1, Math.floor(width));
    this._h = Math.max(1, Math.floor(height));
    this._filter = filter;
    this._seenRev = -1;   // ring allocation revision whose layout is applied

    this._cam  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geom = new THREE.PlaneGeometry(2, 2);

    // Array path — GLSL3 sampler2DArray, samples one time layer.
    this._arrayMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        tRing:       { value: null },
        uNoiseTex:   { value: null },
        uHead:       { value: 0 },
        uN:          { value: 2 },
        uCount:      { value: 0 },
        uMode:       { value: 0 },
        uDirection:  { value: 0 },
        uMaxDelay:   { value: 0 },
        uDelayCurve: { value: 1.0 },
        uScanPos:    { value: 0.5 },
        uScanPosY:   { value: 0.5 },
        uScanWidth:  { value: 0.05 },
        uInvert:     { value: 0.0 },
      },
      vertexShader:   ARRAY_READ_VERT,
      fragmentShader: ARRAY_READ_FRAG,
      depthTest:  false,
      depthWrite: false,
    });
    this._arrayScene = new THREE.Scene();
    this._arrayScene.add(new THREE.Mesh(this._geom, this._arrayMat));

    // Atlas path — GLSL1 sampler2D + tile arithmetic. Same DELAY_MAP_CHUNK, so
    // the two agree by construction rather than by inspection.
    this._atlasMat = new THREE.ShaderMaterial({
      uniforms: {
        tRing:       { value: null },
        uNoiseTex:   { value: null },
        uHead:       { value: 0 },
        uN:          { value: 2 },
        uCount:      { value: 0 },
        uCols:       { value: 1 },
        uTileScale:  { value: new THREE.Vector2(1, 1) },
        uInset:      { value: new THREE.Vector2(0, 0) },
        uMode:       { value: 0 },
        uDirection:  { value: 0 },
        uMaxDelay:   { value: 0 },
        uDelayCurve: { value: 1.0 },
        uScanPos:    { value: 0.5 },
        uScanPosY:   { value: 0.5 },
        uScanWidth:  { value: 0.05 },
        uInvert:     { value: 0.0 },
      },
      vertexShader:   VERT,
      fragmentShader: ATLAS_READ_FRAG,
      depthTest:  false,
      depthWrite: false,
    });
    this._atlasScene = new THREE.Scene();
    this._atlasScene.add(new THREE.Mesh(this._geom, this._atlasMat));

    this._outRT = this._makeRT(this._w, this._h, filter);
  }

  _makeRT(w, h, filter) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: false,
    });
  }

  /**
   * Sample `ring` through this tap's plane and publish the result.
   *
   * @param {import('./SpacetimeRing.js').SpacetimeRing} ring
   * @param {object} opts    read options; see DEFAULTS. `maxDelay` is clamped by
   *                         the ring, so callers may pass a requested value.
   * @param {THREE.Texture|null} mapTex  drives the map when mode === 6 (Noise)
   */
  render(ring, opts = {}, mapTex = null) {
    const tex = ring.texture;
    if (!tex) return;                       // ring not allocated yet

    const o = { ...DEFAULTS, ...opts };
    const useArray = ring.useArray;
    const mat   = useArray ? this._arrayMat   : this._atlasMat;
    const scene = useArray ? this._arrayScene : this._atlasScene;
    const u = mat.uniforms;

    // Layout uniforms only exist on the atlas path, and only change when the
    // ring reallocates. Gating on `rev` means a grid recompute cannot leave this
    // tap addressing the previous geometry — the failure the ring test covers.
    if (!useArray && this._seenRev !== ring.rev) {
      u.uCols.value = ring.cols;
      u.uTileScale.value.set(1 / ring.cols, 1 / ring.rows);
      // Half an atlas texel in tile-local uv: a tile spans 1/cols of the atlas,
      // so half an atlas texel is 0.5/bufW of a tile.
      u.uInset.value.set(0.5 / ring.bufW, 0.5 / ring.bufH);
      this._seenRev = ring.rev;
    }

    u.tRing.value       = tex;
    u.uNoiseTex.value   = mapTex ?? null;
    u.uHead.value       = ring.head;
    u.uN.value          = ring.slots;
    u.uCount.value      = ring.count;
    u.uMode.value       = o.mode;
    u.uDirection.value  = o.direction;
    u.uMaxDelay.value   = ring.clampDelay(o.maxDelay);
    u.uDelayCurve.value = o.delayCurve;
    u.uScanPos.value    = o.scanPos;
    u.uScanPosY.value   = o.scanPosY;
    u.uScanWidth.value  = o.scanWidth;
    u.uInvert.value     = o.invert ? 1.0 : 0.0;

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    r.setRenderTarget(this._outRT);
    r.render(scene, this._cam);
    r.setRenderTarget(prevRT);
  }

  /** Published source texture. */
  get texture() { return this._outRT.texture; }

  get width()  { return this._w; }
  get height() { return this._h; }

  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._outRT.setSize(w, h);
  }

  /**
   * Output magnification filter. Filter changes on a live RT texture are
   * unreliable to mutate in place, so reallocate the single RT.
   * @param {THREE.TextureFilter} filter
   */
  setFilter(filter) {
    if (filter === this._filter) return;
    this._filter = filter;
    this._outRT.dispose();
    this._outRT = this._makeRT(this._w, this._h, filter);
  }

  dispose() {
    this._outRT.dispose();
    this._arrayMat.dispose();
    this._atlasMat.dispose();
    this._geom.dispose();
  }
}
