/**
 * ImWeb Time-Displacement Engine — the `tdisp` source (index 24, "TimeDisp").
 *
 * Since Phase 25 this is a THIN COMPOSITION: one `SpacetimeRing` (the frame
 * history) plus one `SpacetimeTap` (a plane through it). All the machinery moved
 * out — see `SpacetimeRing.js` for the storage strategy and index convention,
 * `SpacetimeTap.js` for the delay map and the two read dialects.
 *
 * What remains here is the parameter binding: translating the `td.*` parameter
 * group into a tap read, which is the one job that is genuinely specific to this
 * source. The ring will be shared with `delay`, `slitscan` and `vwarp` in the
 * following steps, at which point it is hoisted out of this class and passed in.
 * Blueprint: docs/ImWeb-Spacetime-Blueprint.md §2, §5.
 *
 * The public API is unchanged from before the split, deliberately — main.js
 * calls `capture`/`tick`/`texture`/`resize`/`setBufferResolution`/
 * `setUpscaleFilter`/`reinit`/`strategy` and none of those call sites moved.
 *
 * Frame ordering (must match the proven sequence in main.js):
 *   tick()    — READ + PUBLISH, runs BEFORE pipeline.render()
 *   capture() — WRITE into ring, runs AFTER pipeline.render(), immediately
 *               beside videoDelay.capture
 *
 * Usage:
 *   const td = new TimeDisplaceEngine(renderer, W, H, 120);
 *   td.tick(ps, dt, noiseTexture);   // before pipeline.render()
 *   inputs.tdisp = td.texture;
 *   td.capture(srcTex);              // after pipeline.render()
 */

import * as THREE from 'three';
import { SpacetimeRing } from './SpacetimeRing.js';
import { SpacetimeTap } from './SpacetimeTap.js';

export class TimeDisplaceEngine {
  /**
   * @param {THREE.WebGLRenderer} renderer
   * @param {number} width   buffer + output width
   * @param {number} height  buffer + output height
   * @param {number} frames  requested ring depth N
   */
  constructor(renderer, width, height, frames = 60) {
    this.renderer = renderer;
    this._upscaleFilter = THREE.LinearFilter;   // td.upscaleFilter (Linear default)

    this.ring = new SpacetimeRing(renderer, width, height, frames);
    this.tap  = new SpacetimeTap(renderer, width, height, this._upscaleFilter);

    // Reused so the read options are not a fresh allocation every frame.
    this._opts = {
      mode: 0, direction: 0, maxDelay: 0, delayCurve: 1.0,
      scanPos: 0.5, scanPosY: 0.5, scanWidth: 0.05, invert: 0,
      angle: 0, mapAmount: 0,
    };
  }

  // ── Write path ────────────────────────────────────────────────────────────

  /** Write `srcTex` into the ring head. @param {THREE.Texture} srcTex */
  capture(srcTex) { this.ring.capture(srcTex); }

  // ── Read path ─────────────────────────────────────────────────────────────

  /**
   * Bind `td.*` to a tap read. Per-pixel analytic delay works on BOTH storage
   * strategies since Phase 25.
   * @param {THREE.Texture|null} mapTex  the delay-map source, resolved by the
   *   caller from `td.mapSource` (defaults to Noise). Sampled when
   *   td.mode === "Noise" (6), and blended in by td.mapAmount otherwise.
   */
  tick(ps, dt, mapTex = null) {
    if (!ps.get('td.enabled').value) return;   // bypass: keep last output

    const o = this._opts;
    o.mode       = ps.get('td.mode')?.value ?? 0;
    o.direction  = ps.get('td.direction')?.value ?? 0;
    // Requested value — the ring clamps it to the achievable depth, which on the
    // atlas path is a runtime number rather than a constant.
    o.maxDelay   = ps.get('td.maxDelay')?.value ?? (this.ring.slots - 1);
    o.delayCurve = ps.get('td.delayCurve')?.value ?? 1.0;
    o.scanPos    = ps.get('td.scanPosition')?.value ?? 0.5;
    o.scanPosY   = ps.get('td.scanPosY')?.value ?? 0.5;
    o.scanWidth  = ps.get('td.scanWidth')?.value ?? 0.05;
    o.invert     = ps.get('td.invertMap')?.value ? 1 : 0;
    // Degrees in the parameter (matching displace.warpDrawAngle), radians in the
    // shader. 0 stays exactly 0 through the conversion, which is what keeps the
    // rotation a bit-exact identity for every pre-step-4 state.
    o.angle      = (ps.get('td.angle')?.value ?? 0) * Math.PI / 180;
    o.mapAmount  = ps.get('td.mapAmount')?.value ?? 0;

    this.tap.render(this.ring, o, mapTex);
  }

  // ── Published state ───────────────────────────────────────────────────────

  /** Published source texture. */
  get texture() { return this.tap.texture; }

  /** Which buffer path is live ('array' | 'atlas'). */
  get strategy() { return this.ring.strategy; }

  /** Usable ring depth — requested `frames` on array, possibly less on atlas. */
  get slots() { return this.ring.slots; }

  /** Requested ring depth, as constructed. */
  get frames() { return this.ring.frames; }

  /** Clamp a frame offset to what the ring can serve. Delegates to the ring. */
  clampDelay(frames) { return this.ring.clampDelay(frames); }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Reallocate after WebGL context restore (GPU/display switch). Re-probes. */
  reinit() { this.ring.reinit(); }

  /**
   * Display resize — NO-OP for buffers: the ring and the tap output are at
   * buffer resolution, decoupled from display, so a display change must not wipe
   * the history. Buffer (re)alloc is driven by setBufferResolution()/reinit().
   * Kept for the applyResolution call-site signature.
   */
  resize(_w, _h) { /* intentionally empty — see setBufferResolution */ }

  /**
   * Set the engine's working resolution (td.bufferResolution). Reallocates the
   * ring at the new tile size and resizes the tap output to match.
   */
  setBufferResolution(w, h) {
    if (!this.ring.setBufferResolution(w, h)) return;
    this.tap.setSize(this.ring.bufW, this.ring.bufH);
  }

  /**
   * Set the output upscale filter (td.upscaleFilter).
   * @param {number} idx 0 = Nearest, 1 = Linear
   */
  setUpscaleFilter(idx) {
    const filter = (idx === 0) ? THREE.NearestFilter : THREE.LinearFilter;
    if (filter === this._upscaleFilter) return;
    this._upscaleFilter = filter;
    this.tap.setFilter(filter);
  }

  dispose() {
    this.ring.dispose();
    this.tap.dispose();
  }
}
