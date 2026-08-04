/**
 * ImWeb RGB Channel Delay
 *
 * Per-channel time offset: red, green and blue are each read from a different
 * frame of history and packed into one picture. A moving edge separates into
 * coloured fringes trailing its own past, while anything still stays exactly
 * itself — where three frames agree, taking one channel from each reproduces
 * the pixel.
 *
 * It owns NO history. It reads the `VideoDelayLine` ring that is already being
 * captured every frame for Video Delay, so this source costs one render target
 * and one pass, not another ring. That is the whole reason it is cheap: the
 * expensive part of a time effect is the buffer, and this one is second-hand.
 *
 * Consequence worth knowing before it surprises someone: the channels come from
 * `delay.source`, shared with Video Delay. One ring, two views of it — pointing
 * Video Delay somewhere else re-points this too.
 *
 * Depth is whatever the ring holds. `getTexture()` SATURATES rather than
 * returning null past the real history, so a channel asking for more frames
 * than have been captured holds at the oldest available one instead of dropping
 * to black — the knob stops getting deeper rather than stopping working. It
 * also clamps the LOW end to 1, which is why the params start at 1: ages 0 and
 * 1 are the same frame, so a 0-based range would alias its bottom two steps and
 * quietly sample two frames while appearing to offer three.
 */

import * as THREE from 'three';
import { VERT, RGB_DELAY } from '../shaders/index.js';

export class RGBDelay {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this._w = width;
    this._h = height;

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        tR: { value: null },
        tG: { value: null },
        tB: { value: null },
      },
      vertexShader:   VERT,
      fragmentShader: RGB_DELAY,
      depthTest:  false,
      depthWrite: false,
    });

    this._scene = new THREE.Scene();
    this._geom  = new THREE.PlaneGeometry(2, 2);
    this._scene.add(new THREE.Mesh(this._geom, this._mat));
    this._cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._rt = this._makeTarget(width, height);
  }

  _makeTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter:   THREE.LinearFilter,
      magFilter:   THREE.LinearFilter,
      format:      THREE.RGBAFormat,
      type:        THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  /**
   * Compose one frame. Call after `delayLine.capture()` so the newest frame in
   * the ring is this frame's.
   *
   * @param {import('./VideoDelayLine.js').VideoDelayLine} delayLine
   * @param {number} rFrames  red channel age, in frames
   * @param {number} gFrames  green channel age
   * @param {number} bFrames  blue channel age
   */
  render(delayLine, rFrames, gFrames, bFrames) {
    const tR = delayLine.getTexture(rFrames);
    const tG = delayLine.getTexture(gFrames);
    const tB = delayLine.getTexture(bFrames);

    // Nothing captured yet — hold the last good frame rather than flashing a
    // black one for the first frames after a realloc or a source change.
    if (!tR || !tG || !tB) return;

    // Follow the ring's working resolution, which is the thing being
    // composited — `delay.bufferResolution` is decoupled from the canvas, so
    // compositing three 320×240 frames into a full-canvas target would only
    // upsample them at three times the cost.
    //
    // Read it from the ring each frame rather than mirroring it into a second
    // field that has to be kept in step: `setBufferResolution` fires only on
    // CHANGE, so anything sized once at construction inherits whatever the
    // canvas measured at boot — which is 0 when the page boots hidden, leaving
    // a 0×0 target that draws into nothing without ever erroring.
    if (delayLine.width > 0 && delayLine.height > 0) {
      this.setSize(delayLine.width, delayLine.height);
    }
    if (this._w <= 0 || this._h <= 0) return;

    this._mat.uniforms.tR.value = tR;
    this._mat.uniforms.tG.value = tG;
    this._mat.uniforms.tB.value = tB;

    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._cam);
    this.renderer.setRenderTarget(prev);
  }

  get texture() { return this._rt.texture; }
  get width()   { return this._w; }
  get height()  { return this._h; }

  setSize(w, h) {
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    this._rt.setSize(w, h);
  }

  dispose() {
    this._rt.dispose();
    this._geom.dispose();
    this._mat.dispose();
  }
}
