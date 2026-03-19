/**
 * ImWeb Stills Buffer — Phase 2
 *
 * Captures still frames from any source into WebGLRenderTargets.
 * Supports 4 / 8 / 16 / 32 slot counts (setFrameCount).
 * FrameSelect (buffer.fs1) picks which frame to route as the Buffer source.
 * Thumbnails are generated on capture via a small CPU readback (80×45).
 *
 * Flow:
 *   capture(tex) → frames[writeIndex] (full-res RT) + thumbnailCanvases[idx] (80×45)
 *   tick() reads buffer.fs1 → readIndex → texture getter → Pipeline source
 */

import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

const THUMB_W = 80;
const THUMB_H = 45;

export class StillsBuffer {
  constructor(renderer, width, height, initialCount = 16) {
    this.renderer   = renderer;
    this.width      = width;
    this.height     = height;
    this.frameCount = 0; // set properly by setFrameCount below

    this.frames            = [];
    this._hasFrame         = [];
    this._protected        = new Set(); // slot indices protected from auto-capture overwrite
    this.thumbnailCanvases = [];
    this.writeIndex        = 0;
    this.readIndex         = 0;
    this.read2Index        = 0; // for fs2 / frame blend

    // Small render target for cheap CPU readback
    this._thumbTarget = new THREE.WebGLRenderTarget(THUMB_W, THUMB_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });

    // Two persistent named background slots (screen.bg1 / screen.bg2)
    this._bgSlots    = [this._makeTarget(width, height), this._makeTarget(width, height)];
    this._bgHasFrame = [false, false];

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

    // Allocate initial frames
    this.setFrameCount(initialCount);
  }

  // ── Frame count (dynamic) ─────────────────────────────────────────────────

  /**
   * Resize the slot array to n frames (4 / 8 / 16 / 32).
   * Existing captured frames within the new range are preserved.
   */
  setFrameCount(n) {
    if (n === this.frameCount) return;

    if (n < this.frameCount) {
      // Dispose extra render targets
      for (let i = n; i < this.frameCount; i++) {
        this.frames[i].dispose();
      }
      this.frames.length            = n;
      this._hasFrame.length         = n;
      this.thumbnailCanvases.length = n;
    } else {
      // Allocate new slots
      for (let i = this.frameCount; i < n; i++) {
        this.frames.push(this._makeTarget(this.width, this.height));
        this._hasFrame.push(false);
        const c = document.createElement('canvas');
        c.width  = THUMB_W;
        c.height = THUMB_H;
        this.thumbnailCanvases.push(c);
      }
    }

    this.frameCount = n;
    this.writeIndex = this.writeIndex % n;
    this.readIndex  = Math.min(this.readIndex, n - 1);
    // Remove protection marks for slots that no longer exist
    for (const idx of this._protected) {
      if (idx >= n) this._protected.delete(idx);
    }
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  /**
   * Capture a texture into the current write slot.
   * Returns the slot index that was written, or -1 if tex is null.
   */
  capture(tex) {
    if (!tex) return -1;

    // Skip protected slots — advance writeIndex to next unprotected slot
    let safety = this.frameCount;
    while (this._protected.has(this.writeIndex) && safety-- > 0) {
      this.writeIndex = (this.writeIndex + 1) % this.frameCount;
    }
    if (safety <= 0) return -1; // all slots protected

    this._mat.uniforms.uTexture.value = tex;

    // Write full-res to capture slot
    this.renderer.setRenderTarget(this.frames[this.writeIndex]);
    this.renderer.render(this._scene, this._camera);

    this._hasFrame[this.writeIndex] = true;

    // Generate thumbnail (cheap: render to 80×45, then readback)
    this._updateThumbnail(this.writeIndex);

    this.renderer.setRenderTarget(null);

    const captured = this.writeIndex;
    this.writeIndex = (this.writeIndex + 1) % this.frameCount;
    return captured;
  }

  // ── Tick ──────────────────────────────────────────────────────────────────

  /**
   * Called each frame from the render loop.
   * Reads buffer.fs1 and fs2 to select frames for blend.
   */
  tick(ps) {
    const fs1 = Math.round(ps.get('buffer.fs1').value);
    this.readIndex  = Math.max(0, Math.min(this.frameCount - 1, fs1));
    const fs2 = Math.round(ps.get('buffer.fs2').value);
    this.read2Index = Math.max(0, Math.min(this.frameCount - 1, fs2));
  }

  // ── Texture access ────────────────────────────────────────────────────────

  /**
   * The texture to route into the compositing pipeline as the Buffer source.
   * Returns null if no frames have been captured yet.
   */
  get texture() {
    if (this._hasFrame[this.readIndex]) {
      return this.frames[this.readIndex].texture;
    }
    // Fall back to most recently written frame
    const last = (this.writeIndex - 1 + this.frameCount) % this.frameCount;
    return this._hasFrame[last] ? this.frames[last].texture : null;
  }

  /** The second frame texture (for blending fs1→fs2). */
  get texture2() {
    if (this._hasFrame[this.read2Index]) {
      return this.frames[this.read2Index].texture;
    }
    return null;
  }

  /**
   * Capture a texture into a specific slot without advancing writeIndex.
   * Useful for pinned-slot capture buttons.
   */
  captureToSlot(tex, idx) {
    if (!tex || idx < 0 || idx >= this.frameCount) return -1;
    this._mat.uniforms.uTexture.value = tex;
    this.renderer.setRenderTarget(this.frames[idx]);
    this.renderer.render(this._scene, this._camera);
    this._hasFrame[idx] = true;
    this._updateThumbnail(idx);
    this.renderer.setRenderTarget(null);
    return idx;
  }

  // ── Zone protection ────────────────────────────────────────────────────────

  /** Toggle protection on a slot. Protected slots are skipped by auto-capture. */
  toggleProtect(idx) {
    if (idx < 0 || idx >= this.frameCount) return;
    if (this._protected.has(idx)) this._protected.delete(idx);
    else this._protected.add(idx);
  }

  isProtected(idx) { return this._protected.has(idx); }

  /** Capture tex into a named background slot (0 = bg1, 1 = bg2). */
  captureBG(idx, tex) {
    if (!tex || idx < 0 || idx > 1) return;
    this._mat.uniforms.uTexture.value = tex;
    this.renderer.setRenderTarget(this._bgSlots[idx]);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
    this._bgHasFrame[idx] = true;
  }

  /** Returns the texture for background slot idx, or null if not yet captured. */
  bgTexture(idx) {
    return this._bgHasFrame[idx] ? this._bgSlots[idx].texture : null;
  }

  // ── Resize (canvas dimensions) ────────────────────────────────────────────

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this.frames.forEach(f => f.setSize(w, h));
    this._bgSlots.forEach(f => f.setSize(w, h));
    // Thumbnails become stale but remain visible until re-captured
  }

  dispose() {
    this.frames.forEach(f => f.dispose());
    this._bgSlots.forEach(f => f.dispose());
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
   */
  _updateThumbnail(idx) {
    this.renderer.setRenderTarget(this._thumbTarget);
    this.renderer.render(this._scene, this._camera);

    const pixels = new Uint8Array(THUMB_W * THUMB_H * 4);
    this.renderer.readRenderTargetPixels(this._thumbTarget, 0, 0, THUMB_W, THUMB_H, pixels);

    const ctx     = this.thumbnailCanvases[idx].getContext('2d');
    const imgData = ctx.createImageData(THUMB_W, THUMB_H);

    // GL y=0 = bottom; canvas y=0 = top — flip rows
    for (let y = 0; y < THUMB_H; y++) {
      const srcRow = (THUMB_H - 1 - y) * THUMB_W * 4;
      imgData.data.set(pixels.subarray(srcRow, srcRow + THUMB_W * 4), y * THUMB_W * 4);
    }

    ctx.putImageData(imgData, 0, 0);
  }
}
