/**
 * ImWeb Spacetime Ring — the frame history, and nothing else.
 *
 * A GPU rolling buffer of the last N frames: a volume in (x, y, t). One
 * instance, written once per frame. Reading it is somebody else's job — see
 * `SpacetimeTap`, of which there may be many.
 *
 * The split exists because the two halves have completely different costs. The
 * history is VRAM and there should be exactly one of it; a read is one
 * fullscreen pass into one small render target and there can be several. Before
 * Phase 25, four engines (TimeDisplace, VideoDelay, SlitScan, VasulkaWarp) each
 * owned both halves, so four private histories of the same frames sat in
 * memory. Blueprint: docs/ImWeb-Spacetime-Blueprint.md §2.
 *
 * ── Storage strategy ──
 * `WebGLArrayRenderTarget` (z = time) preferred; if the render-to-layer probe
 * fails (ANGLE/Metal-on-Intel risk), fall back to a TILED ATLAS — one 2D
 * texture holding a cols×rows grid of frames.
 *
 * The array path is PRIMARY and must stay so: array layers are bounded by
 * MAX_ARRAY_TEXTURE_LAYERS (~2048), which `frames` never approaches, while the
 * atlas is bounded by MAX_TEXTURE_SIZE in BOTH axes — about 6 frames at Native
 * resolution on the 4096 spec floor. The atlas is the compatibility path, never
 * the preferred one.
 *
 * The atlas replaced an N-render-target fallback that could not express a
 * per-pixel delay at all (N separate sampler2Ds admit no per-fragment variable
 * binding), and so silently degraded to a fixed 1-frame delay.
 *
 * ── Depth ──
 * `slots` is the ACHIEVABLE depth: `frames` on the array path, possibly less on
 * the atlas. Every modulus and every delay clamp reads it, never `frames`, or
 * the head wraps past the end of the atlas.
 *
 * ── Index convention (matches VideoDelayLine, so the off-by-one check holds) ──
 *   `head` points at the NEXT slot to write. After capture(), head advances.
 *   k-steps-back (k>=1): idx = (head - k + N) % N  →  k=1 is the most recent.
 *   This equals videoDelay.getTexture(1) read at the same point in the frame.
 *
 * ── Frame ordering (must match the proven sequence in main.js) ──
 *   taps read  — BEFORE pipeline.render()
 *   capture()  — AFTER  pipeline.render(), beside videoDelay.capture
 */

import * as THREE from 'three';
import { VERT, PASSTHROUGH } from '../shaders/index.js';

export class SpacetimeRing {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} width   tile/frame width (the engine's working resolution)
   * @param {number} height  tile/frame height
   * @param {number} frames  requested ring depth N
   */
  constructor(renderer, width, height, frames = 60) {
    this.renderer = renderer;
    this._bufW  = Math.max(1, Math.floor(width));
    this._bufH  = Math.max(1, Math.floor(height));
    this.frames = Math.max(2, Math.floor(frames));

    this._head  = 0;   // next slot to write
    this._count = 0;   // captured frames so far (saturates at _slots)

    this._useArray = false;  // set by _allocate()/_probe()
    this._arrayRT  = null;   // WebGLArrayRenderTarget (array path)
    this._atlasRT  = null;   // WebGLRenderTarget, cols×rows tiles (atlas path)

    this._slots = this.frames;
    this._cols  = 0;
    this._rows  = 0;

    /**
     * Bumped on every (re)allocation. Taps cache the value they last applied
     * layout uniforms for, so a grid recompute cannot leave a tap reading tiles
     * from the previous geometry. Making that structural rather than remembered
     * matters: capture() and the read agreeing about tile layout is precisely
     * the failure the ring test in tests/spacetime-ring.html exists to catch.
     */
    this._rev = 0;

    // Fullscreen-quad rig. Deliberately private rather than shared with the
    // taps: the five sibling buffer engines each own theirs (VideoDelayLine,
    // SequenceBuffer, StillsBuffer…), it is four vertices, and sharing would
    // couple lifetimes so one dispose() could blank another object's geometry.
    this._cam  = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._geom = new THREE.PlaneGeometry(2, 2);

    // Write material — GLSL1 passthrough, blits a source into the head slot.
    // Reused for the render-to-layer probe.
    this._writeMat = new THREE.ShaderMaterial({
      uniforms:       { uTexture: { value: null } },
      vertexShader:   VERT,
      fragmentShader: PASSTHROUGH,
      depthTest:  false,
      depthWrite: false,
    });
    this._writeScene = new THREE.Scene();
    this._writeScene.add(new THREE.Mesh(this._geom, this._writeMat));

    // 1×1 known-colour source for the probe (green).
    this._probeTex = new THREE.DataTexture(
      new Uint8Array([0, 255, 0, 255]), 1, 1, THREE.RGBAFormat,
    );
    this._probeTex.needsUpdate = true;

    this._allocate();
  }

  // ── Allocation + probe ────────────────────────────────────────────────────

  _makeRT(w, h, filter = THREE.LinearFilter) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: filter,
      magFilter: filter,
      format:    THREE.RGBAFormat,
      type:      THREE.UnsignedByteType,
      depthBuffer: false,
      generateMipmaps: false,
    });
  }

  /** Try the array-texture path; probe it; fall back to a tiled atlas. */
  _allocate() {
    this._head  = 0;
    this._count = 0;
    this._rev++;

    let arrayOK = false;
    try {
      this._arrayRT = new THREE.WebGLArrayRenderTarget(this._bufW, this._bufH, this.frames);
      const t = this._arrayRT.texture;
      t.format    = THREE.RGBAFormat;
      t.type      = THREE.UnsignedByteType;
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      arrayOK = this._probe();
    } catch (e) {
      console.warn('[Spacetime] array-texture allocation threw:', e?.message ?? e);
      arrayOK = false;
    }

    if (arrayOK) {
      this._useArray = true;
      this._disposeAtlas();
      this._slots = this.frames;
      console.log('[Spacetime] buffer strategy: ARRAY-TEXTURE (render-to-layer probe passed) — N=' + this._slots);
    } else {
      this._useArray = false;
      if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
      this._allocateAtlas();
      console.warn(
        '[Spacetime] buffer strategy: TILED-ATLAS FALLBACK (render-to-layer probe failed) — ' +
        `grid ${this._cols}×${this._rows}, N=${this._slots}` +
        (this._slots < this.frames
          ? ` (capped from ${this.frames} by MAX_TEXTURE_SIZE at ${this._bufW}×${this._bufH} — ` +
            'lower td.bufferResolution for a longer history)'
          : ''),
      );
    }
  }

  /**
   * Lay the ring out as a cols×rows grid of tiles in one 2D texture.
   * Near-square, then clamped so neither atlas axis exceeds MAX_TEXTURE_SIZE.
   * Capacity may come out below `frames`; that is reported, and `_slots` carries
   * the truth.
   */
  _allocateAtlas() {
    const gl  = this.renderer.getContext();
    const max = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 4096;

    const maxCols = Math.max(1, Math.floor(max / this._bufW));
    const maxRows = Math.max(1, Math.floor(max / this._bufH));

    let cols = Math.min(maxCols, Math.max(1, Math.ceil(Math.sqrt(this.frames))));
    let rows = Math.min(maxRows, Math.ceil(this.frames / cols));
    // If the row clamp left capacity on the table, widen back out.
    if (cols * rows < this.frames) cols = Math.min(maxCols, Math.ceil(this.frames / rows));

    this._cols  = cols;
    this._rows  = rows;
    this._slots = Math.max(2, Math.min(this.frames, cols * rows));
    this._atlasRT = this._makeRT(cols * this._bufW, rows * this._bufH, THREE.LinearFilter);
  }

  /**
   * Tile (col, row) holding ring slot `idx`. MUST match the read shader's
   * `vec2(mod(idx, uCols), floor(idx / uCols))` — a disagreement here writes
   * frames to one tile and reads them from another, which presents as a broken
   * delay rather than as a layout bug.
   */
  _tileOf(idx) {
    return [idx % this._cols, Math.floor(idx / this._cols)];
  }

  _disposeAtlas() {
    if (this._atlasRT) { this._atlasRT.dispose(); this._atlasRT = null; }
  }

  /**
   * Render the known-colour source into layer 1, read it back, confirm.
   * @returns {boolean} whether render-to-layer works on this backend
   */
  _probe() {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    try {
      this._writeMat.uniforms.uTexture.value = this._probeTex;
      r.setRenderTarget(this._arrayRT, 1);   // 2nd arg = layer index for array RT
      r.render(this._writeScene, this._cam);

      const buf = new Uint8Array(4);
      r.readRenderTargetPixels(this._arrayRT, 0, 0, 1, 1, buf, 1); // last arg = layer
      r.setRenderTarget(prevRT);

      const ok = buf[1] > 200 && buf[0] < 60 && buf[2] < 60; // expect ~green
      if (!ok) {
        console.warn('[Spacetime] probe read-back =', Array.from(buf), '(expected ~0,255,0,255)');
      }
      return ok;
    } catch (e) {
      r.setRenderTarget(prevRT);
      console.warn('[Spacetime] probe threw:', e?.message ?? e);
      return false;
    }
  }

  // ── Write path (after pipeline.render, beside videoDelay.capture) ─────────

  /**
   * Write `srcTex` into the head slot and advance the head.
   * @param {THREE.Texture} srcTex
   */
  capture(srcTex) {
    if (!srcTex) return;
    const r = this.renderer;
    const prevRT = r.getRenderTarget();

    this._writeMat.uniforms.uTexture.value = srcTex;
    if (this._useArray) {
      r.setRenderTarget(this._arrayRT, this._head);
      r.render(this._writeScene, this._cam);
    } else {
      // Atlas: blit the quad into just this frame's tile. Scissor as well as
      // viewport — the viewport alone scales the quad into the tile but does not
      // stop a clear or an out-of-range fragment touching neighbours.
      const [col, row] = this._tileOf(this._head);
      const x = col * this._bufW;
      const y = row * this._bufH;
      r.setRenderTarget(this._atlasRT);
      r.setViewport(x, y, this._bufW, this._bufH);
      r.setScissor(x, y, this._bufW, this._bufH);
      r.setScissorTest(true);
      r.render(this._writeScene, this._cam);
      r.setScissorTest(false);
      // Restore the full-target viewport: three.js only re-derives it when the
      // render target changes, so leaving it tile-sized would clip whatever
      // renders next into this same target.
      r.setViewport(0, 0, this._atlasRT.width, this._atlasRT.height);
    }
    r.setRenderTarget(prevRT);

    this._head = (this._head + 1) % this._slots;
    if (this._count < this._slots) this._count++;
  }

  // ── Read-side interface (consumed by SpacetimeTap) ────────────────────────

  /** The sampler holding the history — sampler2DArray or sampler2D by strategy. */
  get texture() { return this._useArray ? this._arrayRT?.texture : this._atlasRT?.texture; }

  /** 'array' | 'atlas' */
  get strategy() { return this._useArray ? 'array' : 'atlas'; }

  get useArray() { return this._useArray; }
  get head()  { return this._head; }
  get count() { return this._count; }
  /** Achievable depth — `frames` on array, possibly less on atlas. */
  get slots() { return this._slots; }
  get cols()  { return this._cols; }
  get rows()  { return this._rows; }
  get bufW()  { return this._bufW; }
  get bufH()  { return this._bufH; }
  /** Allocation revision — taps re-apply layout uniforms when this changes. */
  get rev()   { return this._rev; }

  /**
   * Clamp a requested frame offset to what the ring can actually serve.
   * Public because every tap needs the same ceiling — including `delay.frames`
   * once it is an offset into this shared ring — and because on the atlas path
   * it is a runtime value rather than a constant. Warns once per ceiling, so a
   * knob that stops responding has a reason in the console.
   */
  clampDelay(frames) {
    const ceiling = this._slots - 1;
    if (frames > ceiling && this._delayCapWarnedAt !== ceiling) {
      console.warn(
        `[Spacetime] delay request ${frames} exceeds ring depth; clamped to ${ceiling} ` +
        `(strategy=${this.strategy}, buffer=${this._bufW}×${this._bufH}).`,
      );
      this._delayCapWarnedAt = ceiling;
    }
    return Math.max(0, Math.min(frames, ceiling));
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Reallocate after WebGL context restore (GPU/display switch). Re-probes. */
  reinit() {
    if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
    this._disposeAtlas();
    this._delayCapWarnedAt = undefined;
    this._allocate();
  }

  /**
   * Set the working resolution. Reallocates; history is stale, so _allocate()
   * resets head/count and bumps `rev`. Re-probes array support (cheap 1×1).
   * @returns {boolean} whether anything changed
   */
  setBufferResolution(w, h) {
    w = Math.max(1, Math.floor(w));
    h = Math.max(1, Math.floor(h));
    if (w === this._bufW && h === this._bufH) return false;
    this._bufW = w;
    this._bufH = h;
    if (this._arrayRT) { this._arrayRT.dispose(); this._arrayRT = null; }
    this._disposeAtlas();
    this._delayCapWarnedAt = undefined;  // ceiling moves with buffer resolution
    this._allocate();
    return true;
  }

  dispose() {
    if (this._arrayRT) this._arrayRT.dispose();
    this._disposeAtlas();
    this._writeMat.dispose();
    this._geom.dispose();
    this._probeTex.dispose();
  }
}
