/**
 * ImWeb Motion Extraction
 *
 * Produces a MATTE: white where the picture is moving, black where it is not.
 * It is not meant to be looked at directly. Route it to the keyer's key source
 * and the moving part of one layer shows over another, the rest transparent —
 * which is the whole point, and the reason this is one source rather than a
 * subsystem. Layers do not composite by alpha in ImWeb (`BLEND` is a
 * `mix(curr, prev, amount)`), so transparency only ever comes from the keyer.
 *
 * ── One mechanism, not two modes ────────────────────────────────────────────
 * The background is an exponential running average of the source. Comparing
 * the live frame against it gives background subtraction — a subject who
 * pauses stays visible, because the background has not caught up with them
 * yet. Shorten the adapt time to zero and the background becomes exactly the
 * previous frame, which is frame differencing. Same shader, no branch: the two
 * "algorithms" are the ends of one control.
 *
 * That matters for the intended use. Frame differencing alone shows only the
 * EDGES of change and collapses to nothing the moment motion stops, so a
 * person who stands still disappears — which reads as the effect breaking
 * rather than as a property of the method.
 *
 * ── The trail ───────────────────────────────────────────────────────────────
 * `max(motion, trail * decay)`, never `+=`. Instant attack, exponential
 * release. Bounded by construction: where two moving things cross, the matte
 * holds at 1 instead of compounding toward white the way an additive
 * accumulation would.
 *
 * Both time constants are in SECONDS and converted per frame against the real
 * `dt`, following `rutt.rise` / `rutt.fall`. Frame-count constants would mean
 * different things on a 60fps desktop and a throttled tab, and dt here is not
 * trustworthy — a backgrounded tab suspends rAF entirely.
 *
 * The trail rides on the MATTE, not on the picture: the streak reveals whatever
 * the foreground shows *now* at those pixels, rather than a frozen copy of what
 * passed through. Carrying the past picture would make this an RGB engine and
 * three times the memory, for a different effect that was not the one asked for.
 */

import * as THREE from 'three';
import { VERT, MOTION_MATTE, MOTION_BG, PASSTHROUGH } from '../shaders/index.js';

export class MotionExtract {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this._w = Math.max(1, width);
    this._h = Math.max(1, height);

    this._matteMat = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null }, uBg: { value: null }, uTrail: { value: null },
        uGain: { value: 8 }, uDecay: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: MOTION_MATTE,
      depthTest: false, depthWrite: false,
    });
    this._bgMat = new THREE.ShaderMaterial({
      uniforms: {
        uCurrent: { value: null }, uBg: { value: null }, uAdapt: { value: 1 },
      },
      vertexShader: VERT, fragmentShader: MOTION_BG,
      depthTest: false, depthWrite: false,
    });
    this._copyMat = new THREE.ShaderMaterial({
      uniforms: { uTexture: { value: null } },
      vertexShader: VERT, fragmentShader: PASSTHROUGH,
      depthTest: false, depthWrite: false,
    });

    this._geom  = new THREE.PlaneGeometry(2, 2);
    this._scene = new THREE.Scene();
    this._mesh  = new THREE.Mesh(this._geom, this._matteMat);
    this._scene.add(this._mesh);
    this._cam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this._bg    = [this._makeTarget(), this._makeTarget()];
    this._trail = [this._makeTarget(), this._makeTarget()];
    this._cur   = 0;

    // The background starts empty, so the first comparison would be against
    // black and the entire frame would read as motion — one full-white flash on
    // the first frame after startup, a source change, or a resize. Seeding the
    // background with the first frame makes the first matte legitimately empty.
    // This is false exactly once per (re)initialisation, so it is not a
    // permanently-taken branch.
    this._primed = false;
  }

  _makeTarget() {
    return new THREE.WebGLRenderTarget(this._w, this._h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  _blit(mat, target) {
    this._mesh.material = mat;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._scene, this._cam);
    this.renderer.setRenderTarget(prev);
  }

  /**
   * Advance one frame.
   *
   * @param {THREE.Texture} srcTex  the source being watched
   * @param {number} dt             seconds since the last frame
   * @param {object} opts
   * @param {number} opts.gain      difference multiplier
   * @param {number} opts.bgSeconds background half-life; 0 = frame differencing
   * @param {number} opts.trailSeconds  time until a trail is visually gone; 0 = none
   */
  render(srcTex, dt, { gain, bgSeconds, trailSeconds }) {
    if (!srcTex) return;

    const cur  = this._cur;
    const next = cur ^ 1;

    if (!this._primed) {
      this._copyMat.uniforms.uTexture.value = srcTex;
      this._blit(this._copyMat, this._bg[cur]);
      this._blit(this._copyMat, this._bg[next]);
      this._primed = true;
      return;                       // no matte from a frame with no history
    }

    // Clamp dt: a hidden tab can hand back a multi-second step, which would
    // wipe the whole trail and slam the background to the live frame in one
    // go — the effect appears to reset itself whenever the tab regains focus.
    const step = Math.min(Math.max(dt, 0), 0.1);

    // Half-life in seconds → per-frame coefficients. bgSeconds 0 collapses to
    // adapt 1 (background := this frame ⇒ frame differencing next frame), and
    // trailSeconds 0 to decay 0 (no persistence), so both knobs reach their
    // degenerate ends exactly rather than approaching them.
    const adapt = bgSeconds    > 0 ? 1 - Math.pow(0.5,  step / bgSeconds)    : 1;
    const decay = trailSeconds > 0 ?     Math.pow(0.02, step / trailSeconds) : 0;

    this._matteMat.uniforms.uCurrent.value = srcTex;
    this._matteMat.uniforms.uBg.value      = this._bg[cur].texture;
    this._matteMat.uniforms.uTrail.value   = this._trail[cur].texture;
    this._matteMat.uniforms.uGain.value    = gain;
    this._matteMat.uniforms.uDecay.value   = decay;
    this._blit(this._matteMat, this._trail[next]);

    // Background update reads the SAME state the matte just compared against,
    // so the two agree on what "the background" was this frame.
    this._bgMat.uniforms.uCurrent.value = srcTex;
    this._bgMat.uniforms.uBg.value      = this._bg[cur].texture;
    this._bgMat.uniforms.uAdapt.value   = adapt;
    this._blit(this._bgMat, this._bg[next]);

    this._cur = next;
  }

  /** The matte. Greyscale; the keyer reads its luminance. */
  get texture() { return this._trail[this._cur].texture; }

  setSize(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this._w && h === this._h) return;
    this._w = w;
    this._h = h;
    for (const t of [...this._bg, ...this._trail]) t.setSize(w, h);
    this._primed = false;           // history is meaningless at a new size
  }

  /** Drop the background estimate — the next frame re-seeds it. */
  reset() { this._primed = false; }

  dispose() {
    for (const t of [...this._bg, ...this._trail]) t.dispose();
    this._geom.dispose();
    this._matteMat.dispose();
    this._bgMat.dispose();
    this._copyMat.dispose();
  }
}
