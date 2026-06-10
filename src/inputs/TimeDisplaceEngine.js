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
 * Buffer strategy (decided): WebGLArrayRenderTarget (z = time) preferred; if the
 * Phase-1 probe shows render-to-layer is broken (ANGLE/Metal-on-Intel risk),
 * auto-fall back to a ring of N WebGLRenderTargets (VideoDelayLine pattern).
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
// Phase 3: per-pixel analytic gradient delay. d(x,y) derived from screen UV by
// mode (slitScanX/Y ramps, warpLine band), shaped by delayCurve/direction, then
// mapped to a ring layer. Nearest layer (floor) — frameBlend is Phase 5.
const ARRAY_READ_FRAG = /* glsl */ `
  precision highp float;
  precision highp sampler2DArray;
  uniform sampler2DArray tRing;
  uniform sampler2D uNoiseTex; // td.mode==6: per-pixel delay map source
  uniform int   uHead;       // next-write slot; newest capture = head-1
  uniform int   uN;          // ring depth
  uniform int   uCount;      // captured frames so far (clamp to real history)
  uniform int   uMode;       // 0 slitScanX, 1 slitScanY, 2 warpLine,
                              // 3 slitScanXSym, 4 slitScanYSym, 5 radial, 6 noise
  uniform int   uDirection;  // 0 forward, 1 backward (reflect window)
  uniform float uMaxDelay;   // frames
  uniform float uDelayCurve; // gamma on map value
  uniform float uScanPos;    // warpLine band centre (0..1, along x); radial centre x
  uniform float uScanPosY;   // radial centre y (0..1)
  uniform float uScanWidth;  // warpLine band width (fraction of frame)
  uniform float uInvert;     // >0.5 flips map value
  in  vec2 vUv;
  out vec4 outColor;
  void main() {
    float m;
    if (uMode == 0) {
      m = vUv.x;                                           // slitScanX
    } else if (uMode == 1) {
      m = vUv.y;                                           // slitScanY
    } else if (uMode == 2) {
      m = (abs(vUv.x - uScanPos) < uScanWidth * 0.5)
          ? 0.0 : 1.0;                                      // warpLine: live band else full delay
    } else if (uMode == 3 || uMode == 4) {
      // slitScanX/Y symmetric: live band centred on uScanPos along the chosen
      // axis, curve ramps outward toward whichever edge is farther.
      float p       = (uMode == 3) ? vUv.x : vUv.y;
      float dist    = abs(p - uScanPos);
      float maxDist = max(uScanPos, 1.0 - uScanPos);
      m = clamp((dist - uScanWidth * 0.5) / max(maxDist - uScanWidth * 0.5, 1e-5), 0.0, 1.0);
    } else if (uMode == 5) {
      // radial: live circle centred on (uScanPos, uScanPosY), curve ramps
      // outward across both width and height
      float dist    = length(vUv - vec2(uScanPos, uScanPosY));
      float maxDist = 0.70710678; // half-diagonal of unit square (0.5*sqrt(2))
      m = clamp((dist - uScanWidth * 0.5) / max(maxDist - uScanWidth * 0.5, 1e-5), 0.0, 1.0);
    } else {
      // noise: per-pixel delay driven by the Noise generator's output
      vec3 nc = texture(uNoiseTex, vUv).rgb;
      m = dot(nc, vec3(0.299, 0.587, 0.114)); // luminance, robust across noise.color modes
    }
    if (uInvert > 0.5) m = 1.0 - m;
    float d = pow(clamp(m, 0.0, 1.0), uDelayCurve) * uMaxDelay;
    if (uDirection == 1) d = uMaxDelay - d;                // backward = reflect window
    float maxBack = float(max(1, min(uN - 1, uCount - 1)));
    d = clamp(d, 0.0, maxBack);
    int layer = (uHead - 1 - int(floor(d))) % uN;          // 0 → newest captured
    layer = (layer + uN) % uN;                             // wrap negative (range [-N, N-2])
    outColor = texture(tRing, vec3(vUv, float(layer)));
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
    this._count = 0;     // captured frames so far (saturates at this.frames)

    this._useArray = false;   // set by _allocate()/_probe()
    this._arrayRT  = null;    // WebGLArrayRenderTarget (array path)
    this._ring     = null;    // WebGLRenderTarget[] (fallback path)

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

    // Read material (fallback path) — GLSL1 passthrough from the selected RT.
    this._rtReadMat = new THREE.ShaderMaterial({
      uniforms:       { uTexture: { value: null } },
      vertexShader:   VERT,
      fragmentShader: PASSTHROUGH,
      depthTest:  false,
      depthWrite: false,
    });
    this._rtReadScene = new THREE.Scene();
    this._rtReadScene.add(new THREE.Mesh(this._geom, this._rtReadMat));

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

  /** Try the array-texture path; probe it; fall back to N render targets. */
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
      this._disposeRing();
      console.log('[TimeDisplace] buffer strategy: ARRAY-TEXTURE (render-to-layer probe passed) — N=' + this.frames);
    } else {
      this._useArray = false;
      if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
      this._allocateRing();
      console.warn('[TimeDisplace] buffer strategy: N-RENDER-TARGET FALLBACK (render-to-layer probe failed) — N=' + this.frames);
    }
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

  _allocateRing() {
    this._ring = [];
    for (let i = 0; i < this.frames; i++) this._ring.push(this._makeRT(this._bufW, this._bufH));
  }

  _disposeRing() {
    if (this._ring) { this._ring.forEach(rt => rt.dispose()); this._ring = null; }
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
      r.setRenderTarget(this._ring[this._head]);
      r.render(this._writeScene, this._cam);
    }
    r.setRenderTarget(prevRT);

    this._head = (this._head + 1) % this.frames;
    if (this._count < this.frames) this._count++;
  }

  // ── Read path (before pipeline.render, beside sdfGen.tick) ────────────────

  /**
   * Read path. Array path: per-pixel analytic gradient delay (td.mode shapes
   * d(x,y) in the shader). Fallback path: fixed 1-frame delay only
   * (per-pixel gradient is not expressible with sampler2D).
   * @param {THREE.Texture|null} noiseTex  current Noise generator output,
   *   sampled when td.mode === "Noise" (6).
   */
  tick(ps, dt, noiseTex = null) {
    if (!ps.get('td.enabled').value) return; // bypass: keep last output

    const r = this.renderer;
    const prevRT = r.getRenderTarget();

    if (this._useArray) {
      const u = this._arrayReadMat.uniforms;
      u.tRing.value       = this._arrayRT.texture;
      u.uNoiseTex.value   = noiseTex ?? null;
      u.uHead.value       = this._head;
      u.uN.value          = this.frames;
      u.uCount.value      = this._count;
      u.uMode.value       = ps.get('td.mode')?.value ?? 0;
      u.uDirection.value  = ps.get('td.direction')?.value ?? 0;
      u.uMaxDelay.value   = Math.min(ps.get('td.maxDelay')?.value ?? (this.frames - 1), this.frames - 1);
      u.uDelayCurve.value = ps.get('td.delayCurve')?.value ?? 1.0;
      u.uScanPos.value    = ps.get('td.scanPosition')?.value ?? 0.5;
      u.uScanPosY.value   = ps.get('td.scanPosY')?.value ?? 0.5;
      u.uScanWidth.value  = ps.get('td.scanWidth')?.value ?? 0.05;
      u.uInvert.value     = ps.get('td.invertMap')?.value ? 1.0 : 0.0;
      r.setRenderTarget(this._outRT);
      r.render(this._arrayReadScene, this._cam);
    } else {
      // Fallback: fixed 1-frame delay; gradient modes unavailable here.
      if (!this._fallbackGradientWarned) {
        console.warn('[TimeDisplace] gradient modes are array-texture only; fallback path shows a fixed 1-frame delay.');
        this._fallbackGradientWarned = true;
      }
      const maxBack = Math.max(1, Math.min(this.frames - 1, this._count - 1));
      const k = Math.max(1, Math.min(maxBack, 1));
      const idx = (this._head - k + this.frames) % this.frames;
      this._rtReadMat.uniforms.uTexture.value = this._ring[idx].texture;
      r.setRenderTarget(this._outRT);
      r.render(this._rtReadScene, this._cam);
    }
    r.setRenderTarget(prevRT);
  }

  /** Published source texture. */
  get texture() { return this._outRT.texture; }

  /** Which buffer path is live ('array' | 'fallback'). */
  get strategy() { return this._useArray ? 'array' : 'fallback'; }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Reallocate after WebGL context restore (GPU/display switch). Re-probes. */
  reinit() {
    if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
    this._disposeRing();
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
    this._disposeRing();
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
    this._disposeRing();
    this._outRT.dispose();
    this._writeMat.dispose();
    this._arrayReadMat.dispose();
    this._rtReadMat.dispose();
    this._geom.dispose();
    this._probeTex.dispose();
  }
}
