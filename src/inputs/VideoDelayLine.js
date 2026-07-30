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
    if (this._count === 0) return null;      // nothing captured yet

    // SATURATE, do not fall off a cliff. delay.frames goes to 480 while the ring
    // may hold 30, and the history is shorter still for the first seconds after a
    // realloc — this used to `return null` for any request past the end, so
    // pushing the knob up dropped the source entirely instead of reaching the
    // oldest frame available. Clamping keeps the control continuous: it stops
    // getting deeper, rather than stopping working.
    const want = Math.round(Math.max(1, framesAgo));
    const n = Math.min(want, this._count);
    if (want > this._count && this._satWarnedAt !== this._count) {
      console.warn(
        `[VideoDelay] ${want} frames requested, ${this._count} captured ` +
        `(ring holds ${this.maxFrames}) — holding at the oldest frame. ` +
        'Raise Ring depth, or wait for the ring to fill.',
      );
      this._satWarnedAt = this._count;
    }
    // _writeIdx points to the *next* slot to write — step back n slots
    const idx = (this._writeIdx - n + this.maxFrames * 2) % this.maxFrames;
    return this._ring[idx].texture;
  }

  /**
   * Display resize — NO-OP, as in TimeDisplaceEngine.
   *
   * The ring runs at its own buffer resolution (setBufferResolution), decoupled
   * from the canvas, so a display change must not wipe the history. It used to
   * follow the canvas, which both destroyed the echo on any resolution change
   * and pinned the ring to full canvas size — 30 frames at 1920x1080 is 237 MB
   * for half a second of delay, the most expensive buffer in the instrument.
   */
  resize(_w, _h) { /* intentionally empty — see setBufferResolution */ }

  /** Frames × width × height × RGBA8, in MB. */
  static vramMB(frames, w, h) { return (frames * w * h * 4) / 1048576; }

  /**
   * Reallocate the ring. History is discarded either way, so depth and
   * resolution share one path.
   *
   * Clamped to a VRAM budget: the exposed combinations reach 3.8 GB (480 frames
   * at Native), which would take the tab down rather than merely run slowly. The
   * frame count is reduced to fit and the clamp is reported, because a silently
   * shorter echo is indistinguishable from the parameter not working.
   */
  _realloc(frames, w, h) {
    const BUDGET_MB = 768;
    // Remember what was ASKED for, not what fitted. The budget clamp depends on
    // resolution, so without this the two controls would compose differently
    // depending on the order you touched them: asking for 480 frames at Native
    // clamps to 97, and then lowering the resolution would leave you stuck at 97
    // instead of finally granting the 480 that now fits. Re-deriving from the
    // request on every realloc makes them commute.
    this._requestedFrames = Math.max(2, Math.floor(frames));

    let n = this._requestedFrames;
    if (VideoDelayLine.vramMB(n, w, h) > BUDGET_MB) {
      const fit = Math.max(2, Math.floor((BUDGET_MB * 1048576) / (w * h * 4)));
      console.warn(
        `[VideoDelay] ${n} frames at ${w}x${h} needs ` +
        `${VideoDelayLine.vramMB(n, w, h).toFixed(0)} MB; clamped to ${fit} frames ` +
        `(${BUDGET_MB} MB budget). Lower the buffer resolution for a longer echo.`,
      );
      n = fit;
    }

    this._ring.forEach((t) => t.dispose());
    this._ring = [];
    for (let i = 0; i < n; i++) this._ring.push(this._makeTarget(w, h));
    this.maxFrames = n;
    this.width  = w;
    this.height = h;
    this._count    = 0;   // history is stale
    this._writeIdx = 0;
    this._satWarnedAt = undefined;   // the saturation ceiling just moved
  }

  /** Ring depth in frames (delay.size). May be clamped by the VRAM budget. */
  setFrames(n) {
    if (n === this._requestedFrames) return;
    this._realloc(n, this.width, this.height);
  }

  /**
   * Working resolution (delay.bufferResolution), decoupled from the canvas.
   * Re-applies the REQUESTED depth, so lowering the resolution grants a depth
   * the budget had previously refused.
   */
  setBufferResolution(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this.width && h === this.height) return;
    this._realloc(this._requestedFrames ?? this.maxFrames, w, h);
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
