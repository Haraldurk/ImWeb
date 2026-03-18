/**
 * ImWeb Video Delay Line
 *
 * Ring buffer of WebGLRenderTargets that stores the last N rendered frames.
 * Any frame in the ring can be retrieved by age (framesAgo=1 = previous frame).
 *
 * Usage:
 *   delay.capture(renderer, tex)     — call each frame after pipeline.render()
 *   delay.getTexture(framesAgo)      — retrieve a frame N steps back
 *   delay.resize(w, h)               — call on canvas resize
 */

import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

export class VideoDelayLine {
  constructor(renderer, width, height, maxFrames = 30) {
    this.renderer   = renderer;
    this.width      = width;
    this.height     = height;
    this.maxFrames  = maxFrames;

    this._ring     = [];
    this._writeIdx = 0;
    this._count    = 0; // frames captured so far (saturates at maxFrames)

    // Passthrough blit material
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

    for (let i = 0; i < maxFrames; i++) {
      this._ring.push(this._makeTarget(width, height));
    }
  }

  /**
   * Write tex into the current ring slot and advance the write head.
   * Call once per frame after pipeline output is ready.
   */
  capture(tex) {
    if (!tex) return;
    this._mat.uniforms.uTexture.value = tex;
    this.renderer.setRenderTarget(this._ring[this._writeIdx]);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);

    this._writeIdx = (this._writeIdx + 1) % this.maxFrames;
    if (this._count < this.maxFrames) this._count++;
  }

  /**
   * Return the texture that is `framesAgo` frames behind the current frame.
   * framesAgo=1 → most recent capture; framesAgo=maxFrames → oldest.
   * Returns null if not enough frames have been captured yet.
   */
  getTexture(framesAgo) {
    const n = Math.round(Math.max(1, framesAgo));
    if (n > this._count) return null;
    // _writeIdx points to the *next* slot to write — step back n slots
    const idx = (this._writeIdx - n + this.maxFrames * 2) % this.maxFrames;
    return this._ring[idx].texture;
  }

  resize(w, h) {
    this.width  = w;
    this.height = h;
    this._ring.forEach(t => t.setSize(w, h));
    this._count    = 0; // frames are now stale; reset
    this._writeIdx = 0;
  }

  dispose() {
    this._ring.forEach(t => t.dispose());
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
