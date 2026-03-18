/**
 * ImWeb Stills Buffer — Phase 2
 *
 * Captures 16 still frames from any source into WebGLRenderTargets.
 * FrameSelect (buffer.fs1) picks which captured frame to route as the Buffer source.
 * Thumbnails are generated on capture via a small CPU readback (80×45).
 *
 * Flow:
 *   trigger(buffer.cap_screen/video/movie) → capture(tex)
 *   → frames[writeIndex] (full-res RT) + thumbnailCanvases[idx] (80×45)
 *   → tick() reads buffer.fs1 → readIndex
 *   → texture getter → Pipeline source
 */

import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

const FRAME_COUNT = 16;
const THUMB_W     = 80;
const THUMB_H     = 45;

export class StillsBuffer {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.width    = width;
    this.height   = height;

    // 16 full-resolution capture slots
    this.frames     = Array.from({ length: FRAME_COUNT }, () => this._makeTarget(width, height));
    this._hasFrame  = new Array(FRAME_COUNT).fill(false);
    this.writeIndex = 0;
    this.readIndex  = 0;

    // Per-slot thumbnail canvases (80×45), updated on capture
    this.thumbnailCanvases = Array.from({ length: FRAME_COUNT }, () => {
      const c = document.createElement('canvas');
      c.width  = THUMB_W;
      c.height = THUMB_H;
      return c;
    });

    // Small render target for cheap CPU readback
    this._thumbTarget = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });

    // Internal passthrough blit (no dependency on Pipeline)
    this._mat    = new THREE.ShaderMaterial({
      uniforms:       { uTexture: { value: null } },
      vertexShader:   VERT,
      fragmentShader: PASSTHROUGH,
      depthTest:  false,
      depthWrite: false,
    });
    this._quad   = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat);
    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(this._quad);
  }

  /**
   * Capture a texture into the current write slot.
   * Returns the slot index that was written.
   */
  capture(tex) {
    if (!tex) return -1;

    this._mat.uniforms.uTexture.value = tex;

    // Write full-res to capture slot
    this.renderer.setRenderTarget(this.frames[this.writeIndex]);
    this.renderer.render(this._scene, this._camera);

    this._hasFrame[this.writeIndex] = true;

    // Generate thumbnail (cheap: render to 80×45, then readback)
    this._updateThumbnail(this.writeIndex);

    this.renderer.setRenderTarget(null);

    const captured = this.writeIndex;
    this.writeIndex = (this.writeIndex + 1) % FRAME_COUNT;
    return captured;
  }

  /**
   * Called each frame from the render loop.
   * Reads buffer.fs1 to select which frame to expose as texture.
   */
  tick(ps) {
    const fs1 = Math.round(ps.get('buffer.fs1').value);
    this.readIndex = Math.max(0, Math.min(FRAME_COUNT - 1, fs1));
  }

  /**
   * The texture to route into the compositing pipeline as the Buffer source.
   * Returns null if no frames have been captured yet.
   */
  get texture() {
    if (this._hasFrame[this.readIndex]) {
      return this.frames[this.readIndex].texture;
    }
    // Fall back to most recently written frame
    const last = (this.writeIndex - 1 + FRAME_COUNT) % FRAME_COUNT;
    return this._hasFrame[last] ? this.frames[last].texture : null;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this.frames.forEach(f => f.setSize(w, h));
    // Thumbnails become stale but remain visible until re-captured
  }

  dispose() {
    this.frames.forEach(f => f.dispose());
    this._thumbTarget.dispose();
    this._mat.dispose();
  }

  // ── Private ────────────────────────────────────────────────────────────────

  _makeTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });
  }

  /**
   * Render the current _mat texture to the small thumb target, read back pixels,
   * flip Y (GL origin is bottom-left), and paint into thumbnailCanvases[idx].
   * The _mat texture must already be set before calling this.
   */
  _updateThumbnail(idx) {
    this.renderer.setRenderTarget(this._thumbTarget);
    this.renderer.render(this._scene, this._camera);

    const pixels = new Uint8Array(THUMB_W * THUMB_H * 4);
    this.renderer.readRenderTargetPixels(this._thumbTarget, 0, 0, THUMB_W, THUMB_H, pixels);

    const ctx     = this.thumbnailCanvases[idx].getContext('2d');
    const imgData = ctx.createImageData(THUMB_W, THUMB_H);

    // GL y=0 = bottom of image; canvas y=0 = top — flip rows
    for (let y = 0; y < THUMB_H; y++) {
      const srcRow = (THUMB_H - 1 - y) * THUMB_W * 4;
      imgData.data.set(pixels.subarray(srcRow, srcRow + THUMB_W * 4), y * THUMB_W * 4);
    }

    ctx.putImageData(imgData, 0, 0);
  }
}
