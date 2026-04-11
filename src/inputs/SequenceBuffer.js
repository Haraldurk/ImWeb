import * as THREE from 'three';
import { VERT, PASSTHROUGH, TIMEWARP } from '../shaders/index.js';

// ── IndexedDB helper for strip persistence ────────────────────────────────────
const STRIP_DB_NAME    = 'imweb-timewarp-strips';
const STRIP_DB_VERSION = 1;
const STRIP_STORE      = 'strips';

function _openStripDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(STRIP_DB_NAME, STRIP_DB_VERSION);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore(STRIP_STORE);
    };
    req.onsuccess = e => resolve(e.target.result);
    req.onerror   = e => reject(e.target.error);
  });
}

export class SequenceBuffer {
  constructor(renderer, width, height, frameCount = 60, instanceId = 'seq') {
    this.renderer    = renderer;
    this.width       = width;
    this.height      = height;
    this.frameCount  = 0;
    this._frames     = [];
    this._filled     = 0;     // how many frames have been written (saturates at frameCount)
    this._writeIdx   = 0;     // next slot to write
    this._readPos    = 0;     // fractional read position [0, frameCount)
    this.speed       = 1.0;   // read speed in frames/frame: 1.0 = realtime, -1.0 = reverse, 0 = frozen
    this._instanceId = instanceId;

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

    // ── Timewarp mode state ───────────────────────────────────────────────────
    this.mode          = 'loop';   // 'loop' | 'timewarp'
    this._stripRT      = null;     // strip RT: one column per captured frame
    this._outputRT     = null;     // rendered timewarp output frame
    this._twOutMat     = null;     // TIMEWARP shader material
    this._twOutScene   = null;     // scene for timewarp render pass
    this._twOutMesh    = null;
    this._stripWriteIdx = 0;       // column cursor [0, width)
    this._twFrameAcc   = 0;        // frame accumulator for tw.speed throttle
    this._twSpeed      = 1;        // frames per column (1 = realtime, 60 = 1 col/sec @ 60fps)

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

  // ── Timewarp mode ───────────────────────────────────────────────────────────

  /** Switch between 'loop' and 'timewarp' modes. Allocates/frees strip RT. */
  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    if (mode === 'timewarp') this._initTimewarp();
    else                     this._disposeTimewarp();
  }

  _initTimewarp() {
    if (this._stripRT) return; // already allocated
    this._stripRT = this._makeTarget(this.width, this.height);
    this._outputRT = this._makeTarget(this.width, this.height);

    this._twOutMat = new THREE.ShaderMaterial({
      uniforms: {
        tStrip:  { value: null },
        tLive:   { value: null },
        uMix:    { value: 1.0 },
        uAxis:   { value: 0 },
        uFlip:   { value: 0.0 },
        uOffset: { value: 0.0 },
        uWarp:   { value: 0.0 },
      },
      vertexShader:   VERT,
      fragmentShader: TIMEWARP,
      depthTest:  false,
      depthWrite: false,
    });
    this._twOutMesh  = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._twOutMat);
    this._twOutScene = new THREE.Scene();
    this._twOutScene.add(this._twOutMesh);

    this._stripWriteIdx = 0;
    this._twFrameAcc    = 0;
  }

  _disposeTimewarp() {
    this._stripRT?.dispose();
    this._outputRT?.dispose();
    this._twOutMat?.dispose();
    this._twOutMesh?.geometry?.dispose();
    this._stripRT = this._outputRT = this._twOutMat = this._twOutMesh = this._twOutScene = null;
  }

  /**
   * Render the strip buffer through the TIMEWARP shader to outputRT.
   * Follow VasulkaWarp.render() pattern — called from main.js after pipeline.render().
   *
   * @param {THREE.Texture} liveTex — current pipeline output (for uMix blend)
   * @param {ParameterSystem} ps
   * @param {number} n — seq instance number (1, 2, or 3) for param lookup
   */
  renderTimewarp(liveTex, ps, n) {
    if (!this._stripRT || !this._outputRT) return;
    const u = this._twOutMat.uniforms;
    u.tStrip.value   = this._stripRT.texture;
    u.tLive.value    = liveTex;
    u.uMix.value     = ps.get(`seq${n}.tw.mix`).value    / 100;
    u.uAxis.value    = ps.get(`seq${n}.tw.axis`).value;
    u.uFlip.value    = ps.get(`seq${n}.tw.flip`).value ? 1.0 : 0.0;
    u.uOffset.value  = ps.get(`seq${n}.tw.offset`).value / 100;
    u.uWarp.value    = ps.get(`seq${n}.tw.warp`).value   / 100;

    this._twOutScene.overrideMaterial = this._twOutMat;
    this.renderer.setRenderTarget(this._outputRT);
    this.renderer.render(this._twOutScene, this._camera);
    this.renderer.setRenderTarget(null);
    this._twOutScene.overrideMaterial = null;
  }

  // ── Loop mode ────────────────────────────────────────────────────────────────

  /** Capture tex — routes to loop or timewarp implementation. */
  capture(tex) {
    if (!tex) return;
    if (this.mode === 'timewarp') {
      this._captureTimewarp(tex);
    } else {
      this._captureLoop(tex);
    }
  }

  _captureLoop(tex) {
    if (this.frameCount === 0) return;
    this._mat.uniforms.uTexture.value = tex;
    this.renderer.setRenderTarget(this._frames[this._writeIdx]);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
    this._writeIdx = (this._writeIdx + 1) % this.frameCount;
    if (this._filled < this.frameCount) this._filled++;
  }

  /**
   * Scissor-blit one column from tex into _stripRT every _twSpeed frames.
   * Pure GPU, no CPU readback. Follows VasulkaWarp.capture() pattern.
   *
   * tw.speed=1 → 1 column/frame (realtime)
   * tw.speed=60 → 1 column/second at 60 fps
   */
  _captureTimewarp(tex) {
    if (!this._stripRT) this._initTimewarp();

    this._twFrameAcc++;
    if (this._twFrameAcc < this._twSpeed) return;
    this._twFrameAcc = 0;

    const renderer = this.renderer;
    const gl       = renderer.getContext();

    this._mat.uniforms.uTexture.value = tex;
    this._scene.overrideMaterial      = this._mat;

    renderer.setRenderTarget(this._stripRT);
    gl.enable(gl.SCISSOR_TEST);
    gl.scissor(this._stripWriteIdx, 0, 1, this._stripRT.height);
    renderer.render(this._scene, this._camera);
    gl.disable(gl.SCISSOR_TEST);
    renderer.setRenderTarget(null);
    this._scene.overrideMaterial = null;

    this._stripWriteIdx = (this._stripWriteIdx + 1) % this.width;
  }

  /** Advance read position by speed (loop mode only; no-op in timewarp). */
  tick() {
    if (this.mode === 'timewarp') return;
    if (this._filled === 0) return;
    this._readPos = (this._readPos + this.speed + this.frameCount) % this.frameCount;
  }

  /**
   * Current output texture.
   * Loop mode: nearest-neighbour frame from ring buffer.
   * Timewarp mode: rendered strip output from renderTimewarp() (updated last frame).
   */
  get texture() {
    if (this.mode === 'timewarp') return this._outputRT?.texture ?? null;
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
    if (this._stripRT) {
      this._stripRT.setSize(w, h);
      this._outputRT.setSize(w, h);
      this._stripWriteIdx = 0;
      this._twFrameAcc    = 0;
    }
  }

  // ── Strip persistence (IndexedDB) ────────────────────────────────────────────

  /**
   * Read _stripRT pixels → save raw RGBA bytes + write cursor to IndexedDB.
   * Key: `timewarp-strip-${instanceId}`. No-op if not in timewarp mode.
   */
  async saveStrip() {
    if (!this._stripRT) return;
    const gl = this.renderer.getContext();
    const w  = this._stripRT.width;
    const h  = this._stripRT.height;

    const pixels = new Uint8Array(w * h * 4);
    this.renderer.setRenderTarget(this._stripRT);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    this.renderer.setRenderTarget(null);

    const db = await _openStripDB();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(STRIP_STORE, 'readwrite');
      tx.objectStore(STRIP_STORE).put(
        { pixels, width: w, height: h, writeIdx: this._stripWriteIdx },
        `timewarp-strip-${this._instanceId}`
      );
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror    = () => { db.close(); reject(tx.error); };
    });
  }

  /**
   * Load saved strip bytes from IndexedDB → upload as DataTexture → blit into _stripRT.
   * Initialises timewarp mode if not already active.
   * No-op if nothing is stored for this instanceId.
   */
  async restoreStrip() {
    const db = await _openStripDB();
    const record = await new Promise((resolve, reject) => {
      const tx  = db.transaction(STRIP_STORE, 'readonly');
      const req = tx.objectStore(STRIP_STORE).get(`timewarp-strip-${this._instanceId}`);
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror   = () => { db.close(); reject(req.error); };
    });
    if (!record) return;

    if (!this._stripRT) this._initTimewarp();

    const { pixels, width: w, height: h, writeIdx } = record;
    // DataTexture defaults to flipY=false — matches readPixels bottom-to-top convention
    const tex = new THREE.DataTexture(
      new Uint8Array(pixels.buffer ?? pixels),
      w, h,
      THREE.RGBAFormat,
      THREE.UnsignedByteType
    );
    tex.needsUpdate = true;

    this._mat.uniforms.uTexture.value = tex;
    this._scene.overrideMaterial      = this._mat;
    this.renderer.setRenderTarget(this._stripRT);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
    this._scene.overrideMaterial = null;
    tex.dispose();

    this._stripWriteIdx = writeIdx ?? 0;
  }

  dispose() {
    this._frames.forEach(f => f.dispose());
    this._mat.dispose();
    this._disposeTimewarp();
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
