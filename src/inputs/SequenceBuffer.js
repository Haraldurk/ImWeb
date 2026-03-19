import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

export class SequenceBuffer {
  constructor(renderer, width, height, frameCount = 60) {
    this.renderer   = renderer;
    this.width      = width;
    this.height     = height;
    this.frameCount = 0;
    this._frames    = [];
    this._filled    = 0;     // how many frames have been written (saturates at frameCount)
    this._writeIdx  = 0;     // next slot to write
    this._readPos   = 0;     // fractional read position [0, frameCount)
    this.speed      = 1.0;   // read speed in frames/frame: 1.0 = realtime, -1.0 = reverse, 0 = frozen

    // Internal blit material (same pattern as StillsBuffer)
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

    this.setFrameCount(frameCount);
  }

  setFrameCount(n) {
    n = Math.max(4, Math.min(512, Math.round(n)));
    if (n === this.frameCount) return;
    const oldLen = this._frames.length;
    if (n < oldLen) {
      // Dispose extra frames
      for (let i = n; i < oldLen; i++) this._frames[i].dispose();
      this._frames.length = n;
    } else {
      // Allocate new frames
      for (let i = oldLen; i < n; i++) {
        this._frames[i] = this._makeTarget(this.width, this.height);
      }
    }
    this.frameCount = n;
    this._writeIdx  = this._writeIdx % n;
    this._readPos   = this._readPos % n;
    this._filled    = Math.min(this._filled, n);
  }

  /** Capture tex into the current write slot and advance write head. */
  capture(tex) {
    if (!tex || this.frameCount === 0) return;
    this._mat.uniforms.uTexture.value = tex;
    this.renderer.setRenderTarget(this._frames[this._writeIdx]);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
    this._writeIdx = (this._writeIdx + 1) % this.frameCount;
    if (this._filled < this.frameCount) this._filled++;
  }

  /** Advance read position by speed (call once per frame). */
  tick() {
    if (this._filled === 0) return;
    this._readPos = (this._readPos + this.speed + this.frameCount) % this.frameCount;
  }

  /** Current read texture (nearest-neighbour frame). */
  get texture() {
    if (this._filled === 0) return null;
    const idx = Math.round(this._readPos) % this.frameCount;
    return this._frames[idx].texture;
  }

  /** Set read position as 0–1 normalized (scrub). */
  setNormPos(n) {
    this._readPos = n * this.frameCount;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this._frames.forEach(f => f.setSize(w, h));
    this._filled = 0;
    this._writeIdx = 0;
    this._readPos  = 0;
  }

  dispose() {
    this._frames.forEach(f => f.dispose());
    this._mat.dispose();
  }

  _makeTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      generateMipmaps: false,
    });
  }
}
