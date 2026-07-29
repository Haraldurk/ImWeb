/**
 * ImWeb Time-Displacement Engine — Phase 1
 *
 * A GPU rolling ring of the last N input frames. Each frame is written into the
 * ring "head"; the read path samples a frame some number of steps back. The
 * displaced result is published as a pipeline source slot (`inputs.tdisp`,
 * label "TimeDisp", index 24) so any module can read it.
 *
 * Lineage: general successor to the deprecated VasulkaWarp strip-buffer. Range-
 * first design — every quality axis becomes a live parameter (wired in later
 * phases). Phase 1 delivers: ring allocation, GPU write path, output slot, a
 * temporary k-steps-back debug read, and a render-to-layer PROBE that decides
 * between the WebGL2 array-texture path and the proven N-render-target fallback.
 *
 * Buffer strategy: WebGLArrayRenderTarget (z = time) preferred; if the probe
 * shows render-to-layer is broken (ANGLE/Metal-on-Intel risk), fall back to a
 * TILED ATLAS — one 2D texture holding a cols×rows grid of frames.
 *
 * Phase 25 changed that fallback. It was a ring of N WebGLRenderTargets
 * (VideoDelayLine pattern), which cannot express a per-pixel delay at all: N
 * separate sampler2Ds admit no per-fragment variable binding, so the path
 * silently degraded to a fixed 1-frame delay. The atlas makes one sampler2D
 * hold every frame, turning a frame index into a tile offset, so the gradient
 * modes work on every backend. The array path stays PRIMARY and is unchanged —
 * its layer count is bounded by MAX_ARRAY_TEXTURE_LAYERS (~2048) while the
 * atlas is bounded by MAX_TEXTURE_SIZE in both axes (~6 frames at Native
 * resolution on the 4096 spec floor), so the atlas is the compatibility path,
 * never the preferred one. `_slots` carries the achievable depth; read it
 * instead of `frames` anywhere a modulus or a delay clamp is involved.
 *
 * Index convention matches VideoDelayLine so the Phase-1 off-by-one check holds:
 *   _head points at the NEXT slot to write. After capture(), _head advances.
 *   k-steps-back (k>=1): idx = (_head - k + N) % N  →  k=1 is the most recent.
 *   This equals videoDelay.getTexture(1) read at the same point in the frame.
 *
 * Frame ordering (must match the proven sequence in main.js):
 *   tick()    — READ + PUBLISH, runs BEFORE pipeline.render() (~main.js:4887)
 *   capture() — WRITE into ring, runs AFTER pipeline.render() (~main.js:5033,
 *               immediately beside videoDelay.capture)
 *
 * Usage (Phase 1):
 *   const td = new TimeDisplaceEngine(renderer, W, H, 60);
 *   // per frame, before pipeline.render():
 *   td.tick(ps, dt);                       // renders k-back frame to outputRT
 *   inputs.tdisp = td.texture;
 *   // per frame, after pipeline.render(), beside videoDelay.capture:
 *   td.capture(pipeline.prev.texture);
 */

import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

// ── GLSL3 array-texture read shader (samples one time layer) ─────────────────
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
 * shaders differ in dialect — but the *logic* that decides how far back in time
 * each pixel reads must not. Six hand-synced copies of the source list once
 * existed in this project and three had drifted; this is the same hazard at
 * shader scale, so `m` gets exactly one definition and the callers pass in the
 * one thing that has to be sampled dialect-locally (the map texture's
 * luminance).
 *
 * Phase 3 semantics preserved verbatim: d(x,y) derived from screen UV by mode
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
  uniform int   uN;          // ring depth
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
 * Atlas read shader (GLSL1). Same delay map, same age arithmetic; the ring is
 * a cols×rows grid of frames in ONE sampler2D instead of an array texture, so
 * a frame index becomes a tile offset.
 *
 * `uInset` clamps tile-local uv by half an atlas texel so LinearFilter cannot
 * bleed a neighbouring tile in at the edges — the seam artefact is a thin
 * wrong-coloured line, easy to miss in motion and hard to attribute later.
 *
 * Index math is deliberately float: GLSL1 integer support is minimal, and
 * `_tileOf()` in JS mirrors this exactly so capture() and the read agree.
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

export class TimeDisplaceEngine {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} width   buffer + output width (Phase 1: display size)
   * @param {number} height  buffer + output height
   * @param {number} frames  ring depth N
   */
  constructor(renderer, width, height, frames = 60) {
    this.renderer = renderer;
    // Buffer dims = the engine's working resolution (ring + read), DECOUPLED
    // from display. The read renders at _bufW/_bufH and the compositor upscales.
    this._bufW    = width;
    this._bufH    = height;
    this._upscaleFilter = THREE.LinearFilter;   // td.upscaleFilter (Linear default)
    this.frames   = Math.max(2, Math.floor(frames));

    this._head  = 0;     // next slot to write
    this._count = 0;     // captured frames so far (saturates at this._slots)

    this._useArray = false;   // set by _allocate()/_probe()
    this._arrayRT  = null;    // WebGLArrayRenderTarget (array path)
    this._atlasRT  = null;    // WebGLRenderTarget, cols×rows tiles (atlas path)

    // Usable ring depth. Equals `frames` on the array path; on the atlas path it
    // is min(frames, cols*rows) — MAX_TEXTURE_SIZE bounds the grid, so a large
    // buffer resolution buys fewer slots. Every modulus and every delay clamp
    // reads THIS, never `frames`, or the head wraps past the end of the atlas.
    this._slots = this.frames;
    this._cols  = 0;
    this._rows  = 0;

    // Shared fullscreen-quad rig
    this._cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geom  = new THREE.PlaneGeometry(2, 2);

    // Write material — GLSL1 passthrough, blits a source texture into the head
    // layer/RT. Reused for the render-to-layer probe.
    this._writeMat = new THREE.ShaderMaterial({
      uniforms:       { uTexture: { value: null } },
      vertexShader:   VERT,
      fragmentShader: PASSTHROUGH,
      depthTest:  false,
      depthWrite: false,
    });
    this._writeScene = new THREE.Scene();
    this._writeScene.add(new THREE.Mesh(this._geom, this._writeMat));

    // Read material (array path) — GLSL3 sampler2DArray, samples one time layer.
    this._arrayReadMat = new THREE.ShaderMaterial({
      glslVersion:    THREE.GLSL3,
      uniforms: {
        tRing:       { value: null },
        uNoiseTex:   { value: null },
        uHead:       { value: 0 },
        uN:          { value: this.frames },
        uCount:      { value: 0 },
        uMode:       { value: 0 },
        uDirection:  { value: 0 },
        uMaxDelay:   { value: this.frames - 1 },
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
    this._arrayReadScene = new THREE.Scene();
    this._arrayReadScene.add(new THREE.Mesh(this._geom, this._arrayReadMat));

    // Read material (atlas path) — GLSL1 sampler2D + tile arithmetic. Same
    // delay map as the array path (DELAY_MAP_CHUNK), so the two agree by
    // construction rather than by inspection.
    this._atlasReadMat = new THREE.ShaderMaterial({
      uniforms: {
        tRing:       { value: null },
        uNoiseTex:   { value: null },
        uHead:       { value: 0 },
        uN:          { value: this.frames },
        uCount:      { value: 0 },
        uCols:       { value: 1 },
        uTileScale:  { value: new THREE.Vector2(1, 1) },
        uInset:      { value: new THREE.Vector2(0, 0) },
        uMode:       { value: 0 },
        uDirection:  { value: 0 },
        uMaxDelay:   { value: this.frames - 1 },
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
    this._atlasReadScene = new THREE.Scene();
    this._atlasReadScene.add(new THREE.Mesh(this._geom, this._atlasReadMat));

    // Output RT — the published source texture, at buffer res; the compositor
    // upscales it to display using _upscaleFilter.
    this._outRT = this._makeRT(this._bufW, this._bufH, this._upscaleFilter);

    // 1×1 known-colour source for the probe (green).
    this._probeTex = new THREE.DataTexture(
      new Uint8Array([0, 255, 0, 255]), 1, 1, THREE.RGBAFormat,
    );
    this._probeTex.needsUpdate = true;

    this._allocate();
  }

  // ── Allocation + probe ──────────────────────────────────────────────────

  _makeRT(w, h, filter = THREE.LinearFilter) {
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
   * Try the array-texture path; probe it; fall back to a TILED ATLAS.
   *
   * The array path is preferred and stays primary: array layers are bounded by
   * MAX_ARRAY_TEXTURE_LAYERS (~2048), which `frames` never approaches, so it
   * holds the full ring at any buffer resolution. The atlas is bounded by
   * MAX_TEXTURE_SIZE in BOTH axes — at Native resolution that is ~6 frames on
   * the 4096 spec floor — so promoting it to the only strategy would trade a
   * large capability loss on working hardware for a fix that only broken
   * hardware needs. It replaces the old N-render-target fallback instead, which
   * could not express a per-pixel delay at all (N separate sampler2Ds) and
   * silently degraded to a fixed 1-frame delay.
   */
  _allocate() {
    this._head = 0;
    this._count = 0;

    // Attempt array-texture ring first.
    let arrayOK = false;
    try {
      this._arrayRT = new THREE.WebGLArrayRenderTarget(this._bufW, this._bufH, this.frames);
      const t = this._arrayRT.texture;
      t.format    = THREE.RGBAFormat;
      t.type      = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      arrayOK = this._probe();
    } catch (e) {
      console.warn('[TimeDisplace] array-texture allocation threw:', e?.message ?? e);
      arrayOK = false;
    }

    if (arrayOK) {
      this._useArray = true;
      this._disposeAtlas();
      this._slots = this.frames;
      console.log('[TimeDisplace] buffer strategy: ARRAY-TEXTURE (render-to-layer probe passed) — N=' + this._slots);
    } else {
      this._useArray = false;
      if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
      this._allocateAtlas();
      console.warn(
        '[TimeDisplace] buffer strategy: TILED-ATLAS FALLBACK (render-to-layer probe failed) — ' +
        `grid ${this._cols}×${this._rows}, N=${this._slots}` +
        (this._slots < this.frames
          ? ` (capped from ${this.frames} by MAX_TEXTURE_SIZE at ${this._bufW}×${this._bufH} — ` +
            'lower td.bufferResolution for a longer history)'
          : ''),
      );
    }
  }

  /**
   * Lay the ring out as a cols×rows grid of tiles in one 2D texture.
   * Grid is chosen as close to square as the tile aspect allows, then clamped
   * so neither atlas dimension exceeds MAX_TEXTURE_SIZE. Capacity may come out
   * below `frames`; that is reported, and `_slots` carries the truth.
   */
  _allocateAtlas() {
    const gl  = this.renderer.getContext();
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    const maxCols = Math.max(1, Math.floor(max / this._bufW));
    const maxRows = Math.max(1, Math.floor(max / this._bufH));

    // Prefer a near-square grid, then clamp to what the axes allow.
    let cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(this.frames))));
    let rows = Math.min(maxRows, Math.ceil(this.frames / cols));
    // If the row clamp left capacity on the table, widen back out.
    if (cols * rows < this.frames) cols = Math.min(maxCols, Math.ceil(this.frames / rows));

    this._cols  = cols;
    this._rows  = rows;
    this._slots = Math.max(2, Math.min(this.frames, cols * rows));

    this._atlasRT = this._makeRT(cols * this._bufW, rows * this._bufH, THREE.LinearFilter);

    const u = this._atlasReadMat.uniforms;
    u.uCols.value = cols;
    u.uTileScale.value.set(1 / cols, 1 / rows);
    // Half an atlas texel, expressed in tile-local uv (a tile spans 1/cols of
    // the atlas, so half a texel of the atlas is 0.5/bufW of a tile).
    u.uInset.value.set(0.5 / this._bufW, 0.5 / this._bufH);
  }

  /**
   * Tile (col, row) holding ring slot `idx`. MUST match ATLAS_READ_FRAG's
   * `vec2(mod(idx, uCols), floor(idx / uCols))` — a disagreement here writes
   * frames to one tile and reads them from another, which looks like a broken
   * delay rather than a layout bug.
   */
  _tileOf(idx) {
    return [idx % this._cols, Math.floor(idx / this._cols)];
  }

  _disposeAtlas() {
    if (this._atlasRT) { this._atlasRT.dispose(); this._atlasRT = null; }
  }

  /**
   * Render the known-colour source into layer 1, read it back, and confirm.
   * Returns true if render-to-layer works on this backend.
   */
  _probe() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    try {
      this._writeMat.uniforms.uTexture.value = this._probeTex;
      r.setRenderTarget(this._arrayRT, 1);   // 2nd arg = layer index for array RT
      r.render(this._writeScene, this._cam);

      const buf = new Uint8Array(4);
      r.readRenderTargetPixels(this._arrayRT, 0, 0, 1, 1, buf, 1); // last arg = layer
      r.setRenderTarget(prevRT);

      const ok = buf[1] > 200 && buf[0] < 60 && buf[2] < 60; // expect ~green
      if (!ok) {
        console.warn('[TimeDisplace] probe read-back =', Array.from(buf), '(expected ~0,255,0,255)');
      }
      return ok;
    } catch (e) {
      r.setRenderTarget(prevRT);
      console.warn('[TimeDisplace] probe threw:', e?.message ?? e);
      return false;
    }
  }

  // ── Write path (after pipeline.render, beside videoDelay.capture) ─────────

  /**
   * Write `srcTex` into the head slot and advance the head.
   * @param {THREE.Texture} srcTex
   */
  capture(srcTex) {
    if (!srcTex) return;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();

    this._writeMat.uniforms.uTexture.value = srcTex;
    if (this._useArray) {
      r.setRenderTarget(this._arrayRT, this._head);
      r.render(this._writeScene, this._cam);
    } else {
      // Atlas: blit the full-screen quad into just this frame's tile. Scissor as
      // well as viewport — the viewport alone scales the quad into the tile but
      // does not stop a clear or an out-of-range fragment touching neighbours.
      const [col, row] = this._tileOf(this._head);
      const x = col * this._bufW;
      const y = row * this._bufH;
      r.setRenderTarget(this._atlasRT);
      r.setViewport(x, y, this._bufW, this._bufH);
      r.setScissor(x, y, this._bufW, this._bufH);
      r.setScissorTest(true);
      r.render(this._writeScene, this._cam);
      r.setScissorTest(false);
      // Restore the full-target viewport: three.js only re-derives it when the
      // render target changes, so leaving it tile-sized would clip whatever
      // renders next into this same target.
      r.setViewport(0, 0, this._atlasRT.width, this._atlasRT.height);
    }
    r.setRenderTarget(prevRT);

    this._head = (this._head + 1) % this._slots;
    if (this._count < this._slots) this._count++;
  }

  // ── Read path (before pipeline.render, beside sdfGen.tick) ────────────────

  /**
   * Read path. Per-pixel analytic gradient delay (td.mode shapes d(x,y)) on
   * BOTH strategies — the atlas path expresses it with tile arithmetic, so the
   * old "gradient modes are array-texture only" degradation is gone.
   * @param {THREE.Texture|null} noiseTex  current Noise generator output,
   *   sampled when td.mode === "Noise" (6).
   */
  tick(ps, dt, noiseTex = null) {
    if (!ps.get('td.enabled').value) return; // bypass: keep last output

    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    const scene = this._useArray ? this._arrayReadScene : this._atlasReadScene;
    const u     = this._useArray ? this._arrayReadMat.uniforms
                                 : this._atlasReadMat.uniforms;

    // Shared: the delay map and its shaping. `_slots`, not `frames` — on the
    // atlas path the achievable depth can be lower, and clamping to `frames`
    // would ask for a slot that does not exist (§9f in the blueprint).
    u.tRing.value       = this._useArray ? this._arrayRT.texture : this._atlasRT.texture;
    u.uNoiseTex.value   = noiseTex ?? null;
    u.uHead.value       = this._head;
    u.uN.value          = this._slots;
    u.uCount.value      = this._count;
    u.uMode.value       = ps.get('td.mode')?.value ?? 0;
    u.uDirection.value  = ps.get('td.direction')?.value ?? 0;
    u.uMaxDelay.value   = this.clampDelay(ps.get('td.maxDelay')?.value ?? (this._slots - 1));
    u.uDelayCurve.value = ps.get('td.delayCurve')?.value ?? 1.0;
    u.uScanPos.value    = ps.get('td.scanPosition')?.value ?? 0.5;
    u.uScanPosY.value   = ps.get('td.scanPosY')?.value ?? 0.5;
    u.uScanWidth.value  = ps.get('td.scanWidth')?.value ?? 0.05;
    u.uInvert.value     = ps.get('td.invertMap')?.value ? 1.0 : 0.0;

    r.setRenderTarget(this._outRT);
    r.render(scene, this._cam);
    r.setRenderTarget(prevRT);
  }

  /**
   * Clamp a requested frame offset to what the ring can actually serve.
   * Public because the taps (and `delay.frames`, once it is an offset into this
   * shared ring) need the same ceiling, and because on the atlas path it is a
   * runtime value rather than a constant. Warns once per ceiling so a knob that
   * stops responding has a reason in the console.
   */
  clampDelay(frames) {
    const ceiling = this._slots - 1;
    if (frames > ceiling && this._delayCapWarnedAt !== ceiling) {
      console.warn(
        `[TimeDisplace] delay request ${frames} exceeds ring depth; clamped to ${ceiling} ` +
        `(strategy=${this.strategy}, buffer=${this._bufW}×${this._bufH}).`,
      );
      this._delayCapWarnedAt = ceiling;
    }
    return Math.max(0, Math.min(frames, ceiling));
  }

  /** Usable ring depth — `frames` on the array path, possibly less on atlas. */
  get slots() { return this._slots; }

  /** Published source texture. */
  get texture() { return this._outRT.texture; }

  /** Which buffer path is live ('array' | 'atlas'). */
  get strategy() { return this._useArray ? 'array' : 'atlas'; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Reallocate after WebGL context restore (GPU/display switch). Re-probes. */
  reinit() {
    if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
    this._disposeAtlas();
    this._delayCapWarnedAt = undefined;
    this._allocate();
  }

  /**
   * Display resize — NO-OP for buffers (Phase 5a): the ring + output are at
   * buffer resolution, decoupled from display, so a display change must not
   * wipe the ring. Buffer (re)alloc is driven by setBufferResolution() and
   * reinit(). Kept for the applyResolution call-site signature.
   */
  resize(_w, _h) { /* intentionally empty — see setBufferResolution */ }

  /**
   * Set the engine's working resolution (td.bufferResolution). Reallocates the
   * ring + output RT at the new size; history is stale so _allocate() resets
   * head/count. Re-probes array support (cheap 1×1).
   */
  setBufferResolution(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this._bufW && h === this._bufH) return;
    this._bufW = w;
    this._bufH = h;
    if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
    this._disposeAtlas();
    this._delayCapWarnedAt = undefined;  // ceiling moves with buffer resolution
    this._outRT.setSize(w, h);
    this._allocate();
  }

  /**
   * Set the output upscale filter (td.upscaleFilter). The compositor magnifies
   * the buffer-res output with this filter. Filter changes on an existing RT
   * texture are unreliable to mutate in place, so reallocate the single RT.
   * @param {number} idx 0 = Nearest, 1 = Linear
   */
  setUpscaleFilter(idx) {
    const filter = (idx === 0) ? THREE.NearestFilter : THREE.LinearFilter;
    if (filter === this._upscaleFilter) return;
    this._upscaleFilter = filter;
    this._outRT.dispose();
    this._outRT = this._makeRT(this._bufW, this._bufH, filter);
  }

  dispose() {
    if (this._arrayRT) this._arrayRT.dispose();
    this._disposeAtlas();
    this._outRT.dispose();
    this._writeMat.dispose();
    this._arrayReadMat.dispose();
    this._atlasReadMat.dispose();
    this._geom.dispose();
    this._probeTex.dispose();
  }
}
