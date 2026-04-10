/**
 * VasulkaWarp — Strip-Buffer Temporal Slit-Scan
 *
 * Faithful to the original Image/Ine (ImOs9) mechanism:
 *   - A strip buffer stores one column (or row) of video per frame
 *   - writeIdx advances by `speed` strips per frame, cycling over bufSize positions
 *   - Output reads the entire strip buffer as a full frame:
 *       column X → video captured (bufSize - X) frames ago
 *   - Static content: no distortion (same pixel value every frame)
 *   - Moving content: temporal smear proportional to speed of movement
 *
 * Architecture:
 *   - _stripRT: WebGLRenderTarget(bufSize, outputH)  — the tape
 *   - capture(): scissor-render 1+ columns of live video into _stripRT (GPU-only)
 *   - render():  sample _stripRT with writeIdx-based UV offset (GLSL1 shader)
 *
 * Memory: 1920×1080×4 = 8.3 MB. No CPU readback. No downsampling.
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
  uniform float uWriteNorm;   // writeIdx / bufSize  [0,1)
  uniform float uMix;
  uniform int   uAxis;        // 0=H (columns), 1=V (rows)
  uniform float uFlip;        // 1.0 = reverse time direction

  varying vec2 vUv;

  void main() {
    float coord = (uAxis == 0) ? vUv.x : vUv.y;
    if (uFlip > 0.5) coord = 1.0 - coord;

    // Oldest slot is at writeIdx; map coord=0 → oldest, coord=1 → newest
    float readOffset = uWriteNorm + coord;
    readOffset = readOffset - floor(readOffset);  // fract(), avoiding mod precision issues

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
    this._bufSize  = bufSize;
    this._writeIdx = 0;

    this._build(fullW, fullH, bufSize);
  }

  _build(fullW, fullH, bufSize) {
    // Strip render target: bufSize wide, full height — one column = one time step
    this._stripRT = new THREE.WebGLRenderTarget(bufSize, fullH, {
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
        uWriteNorm: { value: 0.0 },
        uMix:       { value: 1.0 },
        uAxis:      { value: 0 },
        uFlip:      { value: 0.0 },
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
   * @param {number} speed  — columns to advance per frame (default 1)
   */
  capture(srcTexture, speed = 1) {
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
    u.tStrip.value     = this._stripRT.texture;
    u.tLive.value      = liveTex;
    u.uWriteNorm.value = this._writeIdx / this._bufSize;

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
  }

  /** Resize output to match canvas. */
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
