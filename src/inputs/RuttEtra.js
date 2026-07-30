/**
 * ImWeb Rutt-Etra Scan Processor — Phase 26
 *
 * Steve Rutt and Bill Etra's Scan Processor (1972), the third machine in the
 * lineage this instrument claims and the only one that had no representation in
 * it. N horizontal scanlines are deflected by the luminance of a source image
 * and viewed through an orbiting perspective camera.
 *
 * FAITHFUL BEFORE GENERAL, deliberately (Blueprint §6). The machine is beautiful
 * BECAUSE IT LIES ABOUT DEPTH — luminance is not distance, and the whole
 * character of the thing comes from that error: faces become ridges, shadows
 * become holes. Generalising to "any channel displaces any primitive" before
 * living with the historical instrument produces something configurable that
 * nobody plays. Generalise later, along the axes actually reached for.
 *
 * Parameters:
 *   rutt.active    — toggle rendering (the render gate is _srcUsed() in main.js)
 *   rutt.source    — what gets scanned; any source, incl. FG/BG/DS Src
 *   rutt.lines     — scanline count
 *   rutt.zgain     — deflection amount; SIGNED, so the relief can be inverted
 *   rutt.thickness — beam width in PIXELS, constant under perspective
 *   rutt.angle     — camera azimuth
 *   rutt.elev      — camera elevation
 *   rutt.dist      — camera distance
 *   rutt.decay     — phosphor persistence; 0 = none
 *
 * Three notes for whoever reads this next:
 *
 * 1. THICKNESS IS A REAL CONTROL, NOT `linewidth`. THREE.LineBasicMaterial's
 *    linewidth is capped at 1 by ANGLE and every major browser — wiring the knob
 *    to it would ship a control that silently does nothing, which is the hardest
 *    class of defect to report. Each scanline is therefore a triangle ribbon
 *    expanded in CLIP space (`clip.y += aSide * px * clip.w / (resY*0.5)`), so
 *    the beam holds its pixel width regardless of how far the camera has orbited.
 *    The expansion is vertical only: scanlines are horizontal sweeps, so a
 *    perpendicular offset would differ from a vertical one only where the relief
 *    is near-vertical on screen, and there the beam thins — which is what a real
 *    deflected beam does anyway.
 *
 * 2. NO DEPTH TEST, ADDITIVE BLEND. Not an oversight and not a perf shortcut:
 *    the Scan Processor drove a CRT beam and had no hidden-line removal. Back
 *    lines showing through front ones is the instrument, not an artefact.
 *
 * 3. VERTEX-STAGE TEXTURE FETCH. Required to deflect by luminance, fine under
 *    WebGL2 (three r168's default). This does NOT violate the CLAUDE.md "strict
 *    WebGL 1.0 / GLSL ES 1.00" rule — that rule constrains AI-GENERATED shaders
 *    in the Live GLSL pass, where the user's browser and the model's habits are
 *    both unknown. The pipeline's own materials are not bound by it (Blueprint
 *    §6, recorded there precisely so a later session does not "fix" this).
 */

import * as THREE from 'three';

const SCAN_VERT = `
uniform sampler2D uSrc;
uniform float uZGain;
uniform float uThickness;
uniform vec2  uResolution;
attribute float aSide;
varying float vLuma;

void main() {
  // The lattice is authored in [-1,1]; uv follows the same convention every
  // other pass in the instrument samples with, so a source that is upright in
  // the compositor is upright here.
  vec2 uv = position.xy * 0.5 + 0.5;
  float luma = dot(texture2D(uSrc, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
  vLuma = luma;

  vec4 clip = projectionMatrix * modelViewMatrix
            * vec4(position.x, position.y, luma * uZGain, 1.0);

  // Ribbon expansion in clip space — see note 1 in the header.
  clip.y += aSide * uThickness * clip.w / max(uResolution.y * 0.5, 1.0);
  gl_Position = clip;
}
`;

const SCAN_FRAG = `
varying float vLuma;
void main() {
  // Monochrome: the beam is as bright as the signal that deflected it, so the
  // lattice disappears into black where the source is black.
  gl_FragColor = vec4(vec3(vLuma), 1.0);
}
`;

const DECAY_VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const DECAY_FRAG = `
uniform sampler2D tPrev;
uniform float uDecay;
varying vec2 vUv;
void main() { gl_FragColor = vec4(texture2D(tPrev, vUv).rgb * uDecay, 1.0); }
`;

/** Horizontal sample count for a given line count. */
const colsFor = (lines) => Math.min(512, Math.max(32, Math.round(lines * 2)));

export class RuttEtra {
  constructor(renderer, width, height) {
    this.renderer = renderer;
    this.active   = false;

    const opts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format:    THREE.RGBAFormat,
    };
    // Ping-pong for phosphor persistence. Two targets rather than a feedback
    // guard, per the mix-bus precedent in CLAUDE.md: this is the case where a
    // second target beats a guard.
    this._rtA = new THREE.WebGLRenderTarget(width, height, opts);
    this._rtB = new THREE.WebGLRenderTarget(width, height, opts);
    this._cur = this._rtA;

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        uSrc:        { value: new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1) },
        uZGain:      { value: 0.5 },
        uThickness:  { value: 1.5 },
        uResolution: { value: new THREE.Vector2(width, height) },
      },
      vertexShader:   SCAN_VERT,
      fragmentShader: SCAN_FRAG,
      blending:   THREE.AdditiveBlending,
      depthTest:  false,
      depthWrite: false,
      // MANDATORY, not a default worth trimming. The ribbon is expanded after
      // projection, which makes its screen-space winding a function of where the
      // camera is: at azimuth 0 every triangle comes out clockwise and FrontSide
      // culls the entire lattice, then it reappears once the orbit flips the x
      // ordering. Since rutt.angle defaults to 0, that reads as "the source is
      // broken" rather than "the winding is backwards". A beam has no facing.
      side: THREE.DoubleSide,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 100);

    // The lattice is authored square and scaled to the frame's aspect, so a
    // 16:9 source is scanned at 16:9 instead of being squeezed into a square
    // raster floating in a wide frame. uv comes from the UNSCALED attribute, so
    // this changes the shape of the raster without reaching the sampling.
    this._aspect = width / height;
    this._lines  = 0;              // forces the first _rebuild()
    this._mesh   = null;
    this._rebuild(120);

    // Decay pass — its own tiny scene, drawn before the lattice each frame.
    this._decayMat = new THREE.ShaderMaterial({
      uniforms: { tPrev: { value: null }, uDecay: { value: 0 } },
      vertexShader:   DECAY_VERT,
      fragmentShader: DECAY_FRAG,
      depthTest:  false,
      depthWrite: false,
    });
    this._decayScene = new THREE.Scene();
    this._decayCam   = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._decayScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._decayMat));
  }

  /**
   * Rebuild the scanline lattice. Only on a line-count change — this allocates,
   * so calling it per frame would churn buffers for a knob that rarely moves.
   */
  _rebuild(lines) {
    if (lines === this._lines) return;
    this._lines = lines;
    const cols = colsFor(lines);

    const verts = lines * cols * 2;
    const pos   = new Float32Array(verts * 3);
    const side  = new Float32Array(verts);
    // Two triangles per span, per line.
    const idx   = new Uint32Array(lines * (cols - 1) * 6);

    let v = 0, t = 0;
    for (let li = 0; li < lines; li++) {
      const y = lines === 1 ? 0 : 1 - (2 * li) / (lines - 1);
      for (let ci = 0; ci < cols; ci++) {
        const x = -1 + (2 * ci) / (cols - 1);
        for (const s of [-1, 1]) {
          pos[v * 3]     = x;
          pos[v * 3 + 1] = y;
          pos[v * 3 + 2] = 0;   // replaced by the vertex shader
          side[v]        = s;
          v++;
        }
      }
      for (let ci = 0; ci < cols - 1; ci++) {
        const b = (li * cols + ci) * 2;
        idx[t++] = b;     idx[t++] = b + 1; idx[t++] = b + 2;
        idx[t++] = b + 1; idx[t++] = b + 3; idx[t++] = b + 2;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSide',    new THREE.BufferAttribute(side, 1));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    // The lattice is displaced in the vertex stage, so three cannot cull it from
    // the authored positions — it would vanish the moment the relief left the
    // flat plane's bounds.
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);

    if (this._mesh) {
      this._scene.remove(this._mesh);
      this._mesh.geometry.dispose();
    }
    this._mesh = new THREE.Mesh(geo, this._mat);
    this._mesh.frustumCulled = false;
    this._mesh.scale.x = this._aspect;
    this._scene.add(this._mesh);
  }

  /**
   * @param {object} ps      ParameterSystem
   * @param {number} dt      unused; kept on the signature every source tick uses
   * @param {THREE.Texture} srcTex  resolved by _resolveLayerTex() in main.js
   */
  tick(ps, dt, srcTex) {
    this.active = !!ps.get('rutt.active').value;
    if (!this.active) return;

    this._rebuild(Math.max(2, Math.round(ps.get('rutt.lines').value)));

    const u = this._mat.uniforms;
    if (srcTex) u.uSrc.value = srcTex;
    u.uZGain.value     = ps.get('rutt.zgain').value;
    u.uThickness.value = ps.get('rutt.thickness').value;

    const az   = ps.get('rutt.angle').value * (Math.PI / 180);
    const el   = ps.get('rutt.elev').value  * (Math.PI / 180);
    const dist = ps.get('rutt.dist').value;
    this._camera.position.set(
      dist * Math.cos(el) * Math.sin(az),
      dist * Math.sin(el),
      dist * Math.cos(el) * Math.cos(az),
    );
    this._camera.lookAt(0, 0, 0);

    // Ping-pong: last frame decayed into the back buffer, this frame's lattice
    // additively on top, then flip. Reading _cur while writing the other target
    // is why this needs no feedback guard.
    const prev = this._cur;
    const next = prev === this._rtA ? this._rtB : this._rtA;

    const r = this.renderer;
    const prevAutoClear = r.autoClear;
    r.autoClear = false;

    r.setRenderTarget(next);
    r.clear(true, true, true);
    this._decayMat.uniforms.tPrev.value  = prev.texture;
    this._decayMat.uniforms.uDecay.value = ps.get('rutt.decay').value;
    r.render(this._decayScene, this._decayCam);
    r.render(this._scene, this._camera);
    r.setRenderTarget(null);

    r.autoClear = prevAutoClear;
    this._cur = next;
  }

  get texture() { return this._cur.texture; }

  resize(w, h) {
    this._rtA.setSize(w, h);
    this._rtB.setSize(w, h);
    this._mat.uniforms.uResolution.value.set(w, h);
    this._aspect = w / h;
    if (this._mesh) this._mesh.scale.x = this._aspect;
    this._camera.aspect = this._aspect;
    this._camera.updateProjectionMatrix();
  }

  dispose() {
    this._rtA.dispose();
    this._rtB.dispose();
    this._mat.dispose();
    this._decayMat.dispose();
    this._decayScene.children[0].geometry.dispose();
    if (this._mesh) this._mesh.geometry.dispose();
  }
}
