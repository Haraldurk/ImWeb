/**
 * VasulkaWarp — Temporal Slit-Scan
 *
 * Inspired by Steina Vasulka's WARP (2000): each pixel column (or row)
 * samples from a different moment in time. The result maps time to space.
 *
 * Architecture:
 *  - Downsample incoming frames to a small resolution (save VRAM)
 *  - Store in a ring buffer using a DataArrayTexture (sampler2DArray)
 *  - Reconstruct full-res output by sampling different temporal slices
 *    per UV coordinate, with bilinear blending between adjacent frames
 */

import * as THREE from 'three';

// Quality presets: [width, height]
const QUALITY = {
  low:    [480, 270],
  normal: [480, 270],
  high:   [960, 540],
};

// ── Downsample shader ───────────────────────────────────────────────────────
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

// ── Temporal slit-scan output shader (GLSL3 — required for sampler2DArray) ──
const WARP_VERT = `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const WARP_FRAG = `
  precision highp float;
  precision highp sampler2DArray;

  in vec2 vUv;
  out vec4 fragColor;

  uniform sampler2DArray uFrames;
  uniform int   uWriteIndex;
  uniform int   uDepth;
  uniform float uStrength;
  uniform float uFlip;
  uniform int   uAxis;
  uniform float uMix;
  uniform sampler2D tLive;

  void main() {
    float coord = uAxis == 0
      ? (uFlip > 0.5 ? 1.0 - vUv.x : vUv.x)
      : (uFlip > 0.5 ? 1.0 - vUv.y : vUv.y);

    float delay = coord * float(uDepth - 1) * uStrength;
    float readF = mod(float(uWriteIndex) - delay + float(uDepth), float(uDepth));
    int   fA    = int(floor(readF));
    int   fB    = int(mod(float(fA + 1), float(uDepth)));
    float bl    = fract(readF);

    vec4 a      = texture(uFrames, vec3(vUv, float(fA)));
    vec4 b      = texture(uFrames, vec3(vUv, float(fB)));
    vec4 warped = mix(a, b, bl);

    vec4 live   = texture(tLive, vUv);
    fragColor   = mix(live, warped, uMix);
  }
`;

export class VasulkaWarp {
  constructor(renderer, fullW, fullH, depth = 30, quality = 'low') {
    this._renderer  = renderer;
    this._fullW     = fullW;
    this._fullH     = fullH;
    this._depth     = depth;
    this._quality   = quality;
    this._writeIdx  = 0;
    this._active    = false;
    this._texInited = false;

    const [sw, sh] = QUALITY[quality] ?? QUALITY.low;
    this._sw = sw;
    this._sh = sh;

    this._build(sw, sh, depth, fullW, fullH);
  }

  _build(sw, sh, depth, fullW, fullH) {
    // Downsample target
    this._downsampleRT = new THREE.WebGLRenderTarget(sw, sh, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
    });

    // DataArrayTexture ring buffer
    const data = new Uint8Array(sw * sh * 4 * depth);
    this._arrayTex = new THREE.DataArrayTexture(data, sw, sh, depth);
    this._arrayTex.format  = THREE.RGBAFormat;
    this._arrayTex.type    = THREE.UnsignedByteType;
    this._arrayTex.minFilter = THREE.LinearFilter;
    this._arrayTex.magFilter = THREE.LinearFilter;
    this._arrayTex.needsUpdate = true;

    // Full-res output render target
    this.outputRT = new THREE.WebGLRenderTarget(fullW, fullH, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    // Shared orthographic camera + plane
    this._cam    = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geom   = new THREE.PlaneGeometry(2, 2);

    // Blit material (downsample pass)
    this._blitMat = new THREE.ShaderMaterial({
      vertexShader:   BLIT_VERT,
      fragmentShader: BLIT_FRAG,
      uniforms: { tSrc: { value: null } },
      depthTest: false, depthWrite: false,
    });

    // Warp output material — GLSL3 required for sampler2DArray
    this._warpMat = new THREE.ShaderMaterial({
      glslVersion:    THREE.GLSL3,
      vertexShader:   WARP_VERT,
      fragmentShader: WARP_FRAG,
      uniforms: {
        uFrames:     { value: this._arrayTex },
        uWriteIndex: { value: 0 },
        uDepth:      { value: depth },
        uStrength:   { value: 0.8 },
        uFlip:       { value: 0.0 },
        uAxis:       { value: 0 },
        uMix:        { value: 1.0 },
        tLive:       { value: null },
      },
      depthTest: false, depthWrite: false,
    });

    this._blitMesh = new THREE.Mesh(this._geom, this._blitMat);
    this._warpMesh = new THREE.Mesh(this._geom, this._warpMat);
    this._scene    = new THREE.Scene();
    this._scene.add(this._blitMesh);
  }

  /**
   * Call once per render frame when vwarp is active.
   * @param {THREE.Texture} srcTexture — pipeline output texture
   */
  capture(srcTexture) {
    const renderer = this._renderer;
    const gl = renderer.getContext();

    // Force GPU upload of the array texture on first use
    if (!this._texInited) {
      renderer.initTexture(this._arrayTex);
      this._texInited = true;
    }

    // 1. Downsample pipeline output → _downsampleRT
    this._blitMat.uniforms.tSrc.value = srcTexture;
    this._scene.overrideMaterial = this._blitMat;
    renderer.setRenderTarget(this._downsampleRT);
    renderer.render(this._scene, this._cam);

    // 2. Copy _downsampleRT framebuffer → DataArrayTexture at current write slice
    //    _downsampleRT is still bound as the draw framebuffer; read from it.
    const glTex = renderer.properties.get(this._arrayTex).__webglTexture;
    if (!glTex) { renderer.setRenderTarget(null); return; }

    gl.bindTexture(gl.TEXTURE_2D_ARRAY, glTex);
    gl.copyTexSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0,
      0, 0, this._writeIdx,  // dst x, y, slice
      0, 0,                  // src x, y in framebuffer
      this._sw, this._sh
    );
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, null);
    renderer.setRenderTarget(null);

    this._writeIdx = (this._writeIdx + 1) % this._depth;
  }

  /**
   * Render the temporal warp output to this.outputRT.
   * @param {THREE.Texture} liveTex — live pipeline texture (for uMix blend)
   */
  render(liveTex) {
    const u = this._warpMat.uniforms;
    u.uFrames.value     = this._arrayTex;
    u.uWriteIndex.value = this._writeIdx;
    u.tLive.value       = liveTex;

    this._scene.overrideMaterial = this._warpMat;
    this._renderer.setRenderTarget(this.outputRT);
    this._renderer.render(this._scene, this._cam);
    this._renderer.setRenderTarget(null);
  }

  /** Apply param values from ParameterSystem. */
  applyParams(ps) {
    const u = this._warpMat.uniforms;
    u.uStrength.value = ps.get('vwarp.strength').value;
    u.uAxis.value     = ps.get('vwarp.axis').value;
    u.uFlip.value     = ps.get('vwarp.flip').value ? 1.0 : 0.0;
    u.uMix.value      = ps.get('vwarp.mix').value;
  }

  /** Resize output to match canvas. */
  resize(w, h) {
    this._fullW = w; this._fullH = h;
    this.outputRT.setSize(w, h);
  }

  dispose() {
    this._downsampleRT.dispose();
    this._arrayTex.dispose();
    this.outputRT.dispose();
    this._blitMat.dispose();
    this._warpMat.dispose();
    this._geom.dispose();
  }
}
