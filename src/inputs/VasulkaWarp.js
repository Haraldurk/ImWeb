/**
 * VasulkaWarp — Strip-Buffer Temporal Displacement
 *
 * A TAPE whose horizontal axis is time. Faithful to the original Image/ine
 * (ImOs9) mechanism:
 *   - one column of video is written per frame at a moving write head
 *   - the head advances by `speed` columns per frame, wrapping at bufSize
 *   - the output reads the whole tape as a frame:
 *       output column X → source column X, captured (writeIdx − X) frames ago
 *   - static content: untouched (every column holds the same pixels)
 *   - moving content: horizontal shear, because each column is a different moment
 *
 * ── NOT a slit-scan, despite the historical name ──
 * A slit-scan takes ONE FIXED source column and spreads it across every output
 * column (that is `SlitScanBuffer`, which remaps space). This offsets each column
 * in time at its own position, which is a time-displacement GRADIENT — the same
 * operation as `td.mode = "Slit X"` in TimeDisplaceEngine.
 *
 * ── Why it coexists with TimeDisplaceEngine (deliberate, 2026-07-30) ──
 * The two overlap functionally and neither should absorb the other:
 *   - This engine stores ONE COLUMN per time step. 1920×1080×4 ≈ 8.3 MB buys
 *     1920 time steps at full resolution.
 *   - TimeDisplaceEngine stores a WHOLE FRAME per time step, because its delay
 *     map is arbitrary per-pixel (radial, noise, any angle) and every pixel of a
 *     stored frame may be needed. 120 frames at 640×480 is ~147 MB.
 * So for an axis-aligned monotonic gradient this is ~18× cheaper and sharper;
 * for anything else it cannot express the map at all. This is the fast path, the
 * ring is the general case. Do not "consolidate" one into the other without
 * re-deriving those numbers — see docs/ImWeb-Spacetime-Blueprint.md §5d.
 *
 * ── Architecture ──
 *   - _stripRT: WebGLRenderTarget(bufSize, outputH) — the tape
 *   - capture(): scissor-render 1+ columns of live video into _stripRT (GPU-only)
 *   - render():  sample the tape across the full frame (GLSL1 shader)
 *
 * The tape is bufSize wide, NOT canvas width: bufSize is a TIME depth, so at
 * 480 columns on a 1920 canvas the tape is resampled up on read (softer, and 4×
 * faster through time). No CPU readback.
 */

import * as THREE from 'three';

// ── Blit shader (write one column into strip RT) ────────────────────────────
const BLIT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const BLIT_FRAG = `
  uniform sampler2D tSrc;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(tSrc, vUv);
  }
`;

// ── Output shader (read strip buffer as temporal full frame) ─────────────────
const OUT_VERT = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const OUT_FRAG = `
  uniform sampler2D tStrip;
  uniform sampler2D tLive;
  uniform float uMix;
  // Which axis the READ CONTROLS act on — not which axis time runs along.
  // capture() always scissors columns, so time always runs along the tape's x and
  // the temporal shear is always horizontal. uAxis only decides whether
  // readOffset (anchor/pos/span/flip) indexes the tape's x or its y. The tape's y
  // is plain frame-row space, so:
  //   0  readOffset → tape x: the controls scrub TIME
  //   1  readOffset → tape y: the controls warp the picture VERTICALLY, while the
  //      horizontal temporal shear carries on underneath
  // Verified numerically in tests/vasulka-tape.html: at span 0.25, axis 0
  // compresses a horizontal probe and leaves a vertical one alone, axis 1 the
  // exact reverse. Not a bug — a second, geometric axis of control that the H/V
  // labelling undersells. A true VERTICAL TIME axis would need capture() to
  // scissor rows into a fullW × bufSize tape, which is a capture-side change.
  uniform int   uAxis;
  uniform float uFlip;        // 1.0 = reverse time direction
  uniform float uHeadNorm;    // write head as a fraction of the tape (0..1)
  uniform float uAnchor;      // 0 = picture fixed, tear sweeps; 1 = age fixed, picture slides
  uniform float uPos;         // scrub: rotate which moment sits at which column
  uniform float uSpan;        // how much of the tape covers the frame (0..1)

  varying vec2 vUv;

  void main() {
    float coord = (uAxis == 0) ? vUv.x : vUv.y;
    if (uFlip > 0.5) coord = 1.0 - coord;

    // ── uAnchor: which of the two things you want held still ─────────────────
    // NOTE: no backticks in this comment. It lives inside a JS template literal,
    // so one would close the string and break the module at import time.
    //
    // A tape column holds SOURCE column c captured when the head was at c, so the
    // read picks both WHICH COLUMN you see and HOW OLD it is. You cannot hold
    // both still. The two ends of uAnchor are the two ways to spend that:
    //
    //   uAnchor = 0  readOffset = coord. Output column x always shows source
    //                column x, so the picture is spatially TRUE. Age is
    //                ((head - x - 1) mod B) + 1, so a wave of freshness sweeps
    //                across and the tear between "one frame old" and "a whole
    //                tape old" travels with the head. This is the historical
    //                Image/ine behaviour and the default.
    //
    //   uAnchor = 1  readOffset = head + coord. Age becomes B*(1 - coord) with no
    //                head term, so the temporal gradient is stationary — oldest
    //                at one edge, newest at the other, wrap on the boundary. The
    //                cost is that output column x now shows source column
    //                (head + x), so the PICTURE slides sideways as the head runs.
    //
    // Shipped as 1 by mistake in 3db09f2, on a misreading of a bug report: the
    // travelling tear was assumed to be the defect when the actual defect was
    // that it only crossed part of the frame (the bufSize coverage bug, 8e31bbf).
    // Default restored to 0. Kept as a continuous control rather than a toggle
    // because intermediate values drift the gradient slowly, which is playable.
    //
    // ── uSpan / uPos ─────────────────────────────────────────────────────────
    // uSpan narrows the window: 1.0 spreads the whole tape across the frame, 0.1
    // spreads a tenth of it (a ~3s slice of a 32s tape), so the shear steepens
    // without the tape getting shorter. The window is anchored at the NEWEST end
    // and extends backwards -- hence the -uSpan. Anchoring it at the head and
    // extending forwards would show the OLDEST slice, the opposite of what
    // narrowing a window is for.
    //
    // uPos slides that window through the recording: an LFO on it scrubs time.
    //
    // At uAnchor = 0, uSpan = 1, uPos = 0 this is fract(-1 + coord) = coord --
    // bit-identical to the pre-Phase-25 read.
    float readOffset = fract(uAnchor * uHeadNorm + uPos - uSpan + coord * uSpan);

    vec2 stripUv = (uAxis == 0)
      ? vec2(readOffset, vUv.y)
      : vec2(vUv.x, readOffset);

    vec4 warped = texture2D(tStrip, stripUv);
    vec4 live   = texture2D(tLive, vUv);
    gl_FragColor = mix(live, warped, uMix);
  }
`;

export class VasulkaWarp {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} fullW  — output width  (canvas resolution)
   * @param {number} fullH  — output height (canvas resolution)
   * @param {number} bufSize — strip buffer width (480 / 960 / 1920)
   */
  constructor(renderer, fullW, fullH, bufSize = 960) {
    this._renderer = renderer;
    this._fullW    = fullW;
    this._fullH    = fullH;
    /**
     * Tape length in columns = time depth. ONE value, used for both the strip
     * target's width and the write head's wrap.
     *
     * This used to be two: the target was allocated at canvas width while the
     * head wrapped at bufSize, and the output shader read the target's FULL
     * width. So any bufSize below the canvas width left every column past it
     * unwritten — the sweep ran from the left edge to column bufSize and
     * restarted, with black beyond. Only "1920 cols" on a 1920-wide canvas
     * happened to line up, which is why the effect appeared to work at exactly
     * one setting.
     */
    this._bufSize  = Math.max(1, Math.floor(bufSize));
    this._writeIdx = 0;

    this._build(fullW, fullH);
  }

  _build(fullW, fullH) {
    // The tape: bufSize columns wide. Narrower than the canvas means a shorter
    // tape resampled across the frame on read, not a partially-written one.
    this._stripRT = new THREE.WebGLRenderTarget(this._bufSize, fullH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
    });

    // Full-res output render target
    this.outputRT = new THREE.WebGLRenderTarget(fullW, fullH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    });

    this._cam  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geom = new THREE.PlaneGeometry(2, 2);

    this._blitMat = new THREE.ShaderMaterial({
      vertexShader:   BLIT_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { tSrc: { value: null } },
      depthTest: false, depthWrite: false,
    });

    this._outMat = new THREE.ShaderMaterial({
      vertexShader:   OUT_VERT,
      fragmentShader: OUT_FRAG,
      uniforms: {
        tStrip:     { value: this._stripRT.texture },
        tLive:      { value: null },
        uMix:       { value: 1.0 },
        uAxis:      { value: 0 },
        uFlip:      { value: 0.0 },
        uHeadNorm:  { value: 0.0 },
        uAnchor:    { value: 0.0 },
        uPos:       { value: 0.0 },
        uSpan:      { value: 1.0 },
      },
      depthTest: false, depthWrite: false,
    });

    this._blitMesh = new THREE.Mesh(this._geom, this._blitMat);
    this._outMesh  = new THREE.Mesh(this._geom, this._outMat);
    this._blitScene = new THREE.Scene();
    this._blitScene.add(this._blitMesh);
    this._outScene  = new THREE.Scene();
    this._outScene.add(this._outMesh);
  }

  /**
   * Capture `speed` columns from srcTexture into the strip buffer.
   * Uses WebGL scissor — pure GPU, no CPU readback.
   *
   * @param {THREE.Texture} srcTexture
   * @param {number} speed — columns to advance per frame (default 1)
   */
  capture(srcTexture, speed = 1) {
    // No source ⇒ do not advance the head. Without this the blit would run with
    // a null sampler and write BLACK columns onto the tape, which is worse than
    // holding: it actively erases history one column per frame. Reachable as soon
    // as vwarp.source names something inactive (Camera with the camera off).
    // Matches TimeDisplaceEngine.capture's guard.
    if (!srcTexture) return;

    const renderer = this._renderer;
    const gl       = renderer.getContext();

    this._blitMat.uniforms.tSrc.value = srcTexture;
    this._blitScene.overrideMaterial  = this._blitMat;

    renderer.setRenderTarget(this._stripRT);

    gl.enable(gl.SCISSOR_TEST);
    for (let s = 0; s < speed; s++) {
      const x = this._writeIdx;
      gl.scissor(x, 0, 1, this._stripRT.height);
      renderer.render(this._blitScene, this._cam);
      // Wraps at the tape's own width, so every column is reached.
      this._writeIdx = (this._writeIdx + 1) % this._bufSize;
    }
    gl.disable(gl.SCISSOR_TEST);

    renderer.setRenderTarget(null);
    this._blitScene.overrideMaterial = null;
  }

  /**
   * Render the strip buffer to outputRT as a temporally displaced full frame.
   *
   * @param {THREE.Texture} liveTex — pipeline output for uMix blend
   */
  render(liveTex) {
    const u = this._outMat.uniforms;
    u.tStrip.value = this._stripRT.texture;
    u.tLive.value  = liveTex;
    // Read AFTER capture() in main.js, so this is the post-write head — the
    // newest column is head−1 and lands just inside the trailing edge.
    u.uHeadNorm.value = this._writeIdx / this._bufSize;

    this._outScene.overrideMaterial = this._outMat;
    this._renderer.setRenderTarget(this.outputRT);
    this._renderer.render(this._outScene, this._cam);
    this._renderer.setRenderTarget(null);
    this._outScene.overrideMaterial = null;
  }

  /** Sync uniforms from ParameterSystem. */
  applyParams(ps) {
    const u = this._outMat.uniforms;
    u.uAxis.value = ps.get('vwarp.axis').value;
    u.uFlip.value = ps.get('vwarp.flip').value ? 1.0 : 0.0;
    u.uMix.value  = ps.get('vwarp.mix').value;
    u.uPos.value    = ps.get('vwarp.pos')?.value ?? 0.0;
    u.uAnchor.value = ps.get('vwarp.anchor')?.value ?? 0.0;
    // Guard the low end: span 0 would collapse the frame onto a single tape
    // column — a flat field, and indistinguishable from the effect having died.
    u.uSpan.value = Math.max(0.01, ps.get('vwarp.span')?.value ?? 1.0);
  }

  /** Wipe the tape (vwarp.clear). Parity with slitscan.clear. */
  clear() {
    const r = this._renderer;
    const prev = r.getRenderTarget();
    r.setRenderTarget(this._stripRT);
    r.setClearColor(0x000000, 1);
    r.clear(true, false, false);
    r.setRenderTarget(prev);
    this._writeIdx = 0;
  }

  /**
   * Resize output to match the canvas.
   *
   * The OUTPUT follows the canvas; the TAPE does not. Its width is a time depth
   * (vwarp.bufsize), so only its height tracks the canvas — the previous version
   * overwrote _bufSize with the canvas width here, which silently retuned the
   * time depth on every resolution change and left the head's wrap out of step
   * with it.
   */
  resize(w, h) {
    this._fullW = w;
    this._fullH = h;
    this.outputRT.setSize(w, h);
    this._stripRT.setSize(this._bufSize, h);
  }

  dispose() {
    this._stripRT.dispose();
    this.outputRT.dispose();
    this._blitMat.dispose();
    this._outMat.dispose();
    this._geom.dispose();
  }
}
