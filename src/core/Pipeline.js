/**
 * ImWeb Compositing Pipeline
 *
 * Manages a chain of WebGL render passes using Three.js WebGLRenderTarget.
 * Each pass is a full-screen quad with a ShaderMaterial.
 *
 * Architecture:
 *   Input textures → Pass 0 → RenderTarget A
 *                  → Pass 1 (reads A) → RenderTarget B
 *                  → Pass 2 (reads B) → RenderTarget A
 *                  → ...
 *                  → final blit to screen canvas
 *
 * WebGPU upgrade path: replace each ShaderMaterial with a GPURenderPipeline
 * using equivalent WGSL shaders. Same data flow, different API.
 */

import * as THREE from 'three';
import {
  VERT, KEYER, DISPLACE, BLEND, FEEDBACK,
  TRANSFERMODE, COLORSHIFT, NOISE_GEN, INTERLACE, MIRROR, SOLID_COLOR, WARP, FADE, PASSTHROUGH,
  BUFFER_TRANSFORM,
} from '../shaders/index.js';

export class Pipeline {
  constructor(renderer, width, height) {
    this.renderer  = renderer;
    this.width     = width;
    this.height    = height;

    // Ping-pong render targets
    this.targets = [
      this._makeTarget(width, height),
      this._makeTarget(width, height),
    ];
    this.prev = this._makeTarget(width, height); // previous frame (for blend)
    this._current = 0;

    // Full-screen quad geometry (reused by all passes)
    this._quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      null
    );
    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(this._quad);

    // Pre-build all effect materials
    this._buildMaterials();

    // Noise textures (updated each frame)
    this._noiseTime = 0;
  }

  // ── Public: render one frame ──────────────────────────────────────────────

  render(inputs, params, dt) {
    this._noiseTime += dt;
    const p = params;

    // Pre-process buffer source with pan/scale transform
    let processedInputs = inputs;
    if (inputs.buffer) {
      const panX  = (p.get('buffer.panX').value / 100) - 0.5;
      const panY  = (p.get('buffer.panY').value / 100) - 0.5;
      const scale = p.get('buffer.scale').value;
      const bufTex = this._pass(this.m.bufferTransform, {
        uTexture: inputs.buffer, uPanX: panX, uPanY: panY, uScale: scale,
      });
      processedInputs = { ...inputs, buffer: bufTex };
    }

    // Resolve input textures
    const fgIdx  = p.get('layer.fg').value;
    const fgTex  = this._resolveSource(processedInputs, fgIdx);
    const bgTex  = this._resolveSource(processedInputs, p.get('layer.bg').value);
    const dsTex  = this._resolveSource(processedInputs, p.get('layer.ds').value);

    // Apply mirror to camera, movie, or buffer source if needed
    let workingFG = fgTex;
    if (p.get('mirror.camera').value && fgIdx === 0 && inputs.camera) {
      workingFG = this._pass(this.m.mirror, {
        uTexture: fgTex, uFlipH: 1, uFlipV: 0,
      });
    } else if (p.get('movie.mirror').value && fgIdx === 1 && inputs.movie) {
      workingFG = this._pass(this.m.mirror, {
        uTexture: fgTex, uFlipH: 1, uFlipV: 0,
      });
    } else if (p.get('mirror.buffer').value && fgIdx === 2 && processedInputs.buffer) {
      workingFG = this._pass(this.m.mirror, {
        uTexture: fgTex, uFlipH: 1, uFlipV: 0,
      });
    }

    // Solo mode — bypass all effects
    if (p.get('output.solo').value) {
      this._blit(workingFG);
      return;
    }

    // ── TransferMode pre-composite (FG + BG) ──────────────────────────────
    let composite;
    const tm = p.get('output.transfer').value;

    if (tm > 0) {
      composite = this._pass(this.m.transfermode, {
        uFG: workingFG, uBG: bgTex, uMode: tm,
      });
    } else {
      // Default: FG over BG (keyer decides which wins)
      composite = workingFG;
    }

    // ── Displacement ──────────────────────────────────────────────────────
    const displAmt = p.get('displace.amount').value / 100;
    let displaced = composite;

    if (displAmt > 0) {
      displaced = this._pass(this.m.displace, {
        uFG:         composite,
        uDS:         dsTex,
        uAmount:     displAmt,
        uAngle:      p.get('displace.angle').value * Math.PI / 180,
        uOffset:     p.get('displace.offset').value / 100,
        uRotateGrey: p.get('displace.rotateg').value,
      });
    }

    // ── Keyer ─────────────────────────────────────────────────────────────
    let keyed;
    if (p.get('keyer.active').value) {
      const keyedFG = (displAmt > 0 && p.get('keyer.and_displace').value) ? displaced : composite;
      keyed = this._pass(this.m.keyer, {
        uFG:          keyedFG,
        uBG:          bgTex,
        uEK:          dsTex,
        uKeyWhite:    p.get('keyer.white').value / 100,
        uKeyBlack:    p.get('keyer.black').value / 100,
        uKeySoftness: p.get('keyer.softness').value / 100,
        uKeyActive:   1,
        uAlpha:       p.get('keyer.alpha').value,
        uAlphaInvert: p.get('keyer.alpha_inv').value,
        uExtKey:      p.get('keyer.extkey').value,
      });
    } else {
      // No keyer — pass FG through
      keyed = this._pass(this.m.keyer, {
        uFG: displaced, uBG: bgTex, uEK: dsTex,
        uKeyWhite: 1, uKeyBlack: 0, uKeySoftness: 0,
        uKeyActive: 0, uAlpha: 0, uAlphaInvert: 0, uExtKey: 0,
      });
    }

    // ── WarpMap ───────────────────────────────────────────────────────────
    let warped = keyed;
    const warpIdx = p.get('displace.warp').value;
    if (warpIdx > 0 && inputs.warpMaps?.[warpIdx - 1]) {
      warped = this._pass(this.m.warp, {
        uFG:       keyed,
        uWarpMap:  inputs.warpMaps[warpIdx - 1],
        uStrength: displAmt,
      });
    }

    // ── Blend (with previous frame, optionally feedback-shifted) ─────────
    let blended = warped;
    if (p.get('blend.active').value) {
      // Apply feedback offset/scale to prev frame before blending
      const fbHor   = p.get('feedback.hor').value   / 100;
      const fbVer   = p.get('feedback.ver').value   / 100;
      const fbScale = p.get('feedback.scale').value / 50;
      let prevTex = this.prev.texture;
      if (fbHor !== 0 || fbVer !== 0 || fbScale !== 0) {
        prevTex = this._pass(this.m.feedback, {
          uOutput:     this.prev.texture,
          uHorOffset:  fbHor,
          uVerOffset:  fbVer,
          uScale:      fbScale,
          uResolution: new THREE.Vector2(this.width, this.height),
        });
      }
      blended = this._pass(this.m.blend, {
        uCurrent: warped,
        uPrev:    prevTex,
        uActive:  1,
        uAmount:  p.get('blend.amount').value / 100,
      });
    }

    // ── Color shift ───────────────────────────────────────────────────────
    let shifted = blended;
    const cs = p.get('output.colorshift').value / 100;
    if (cs > 0) {
      shifted = this._pass(this.m.colorshift, {
        uTexture: blended, uShift: cs,
      });
    }

    // ── Interlace ─────────────────────────────────────────────────────────
    let interlaced = shifted;
    const il = p.get('output.interlace').value;
    if (il > 0) {
      interlaced = this._pass(this.m.interlace, {
        uTexture: shifted, uResY: this.height, uAmount: il, uTime: this._noiseTime,
      });
    }

    // ── Fade ──────────────────────────────────────────────────────────────
    let faded = interlaced;
    const fadeAmt = 1 - (p.get('output.fade').value / 100);
    if (fadeAmt < 1) {
      faded = this._pass(this.m.fade, {
        uTexture: interlaced, uAmount: fadeAmt,
      });
    }

    // Blit to screen first (faded texture still valid in ping-pong)
    this._blit(faded);

    // Then save to prev buffer (safe: _blit already consumed faded)
    this._copyToPrev(faded);
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  resize(w, h) {
    this.width = w; this.height = h;
    this.targets.forEach(t => t.setSize(w, h));
    this.prev.setSize(w, h);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  _makeTarget(w, h) {
    return new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      generateMipmaps: false,
    });
  }

  /** Run a shader pass, returns the output texture */
  _pass(material, uniforms) {
    // Update uniforms — skip null textures (use fallback to avoid WebGL errors)
    const fallback = this._getFallbackTexture();
    Object.entries(uniforms).forEach(([key, val]) => {
      if (material.uniforms[key] !== undefined) {
        // Replace null textures with fallback so WebGL never gets a null sampler
        if (val === null && key.startsWith('u') && key !== 'uKeyActive' &&
            key !== 'uAlpha' && key !== 'uAlphaInvert' && key !== 'uMode' &&
            key !== 'uActive' && key !== 'uRotateGrey' && key !== 'uFlipH' &&
            key !== 'uFlipV' && key !== 'uType') {
          val = fallback;
        }
        material.uniforms[key].value = val;
      }
    });

    // Ping-pong
    const target = this.targets[this._current];
    this._current ^= 1;

    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._scene, this._camera);

    return target.texture;
  }

  /** Copy a texture to the previous-frame buffer (direct write, no ping-pong) */
  _copyToPrev(tex) {
    this.m.passthrough.uniforms.uTexture.value = tex;
    this._quad.material = this.m.passthrough;
    this.renderer.setRenderTarget(this.prev);
    this.renderer.render(this._scene, this._camera);
    // Restore render target to null so Three.js state is clean
    this.renderer.setRenderTarget(null);
  }

  /** Final blit to screen (null render target) */
  _blit(tex) {
    this.m.passthrough.uniforms.uTexture.value = tex;
    this._quad.material = this.m.passthrough;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this._scene, this._camera);
  }

  _resolveSource(inputs, sourceIdx) {
    const SOURCES = ['camera', 'movie', 'buffer', 'color', 'noise', 'scene3d', 'draw', 'output', 'bg1', 'bg2'];
    const key = SOURCES[sourceIdx] ?? 'color';

    if (key === 'camera'  && inputs.camera)  return inputs.camera;
    if (key === 'movie'   && inputs.movie)   return inputs.movie;
    if (key === 'buffer'  && inputs.buffer)  return inputs.buffer;
    if (key === 'scene3d' && inputs.scene3d) return inputs.scene3d;
    if (key === 'draw'    && inputs.draw)    return inputs.draw;
    if (key === 'output')                    return this.prev.texture;
    if (key === 'noise')                     return inputs.noise ?? this._getNoiseTexture(0);
    if (key === 'bg1'     && inputs.bg1)     return inputs.bg1;
    if (key === 'bg2'     && inputs.bg2)     return inputs.bg2;
    return inputs.color ?? this._getFallbackTexture();
  }

  _getFallbackTexture() {
    if (!this._fallback) {
      const d = new Uint8Array([20, 20, 30, 255]);
      this._fallback = new THREE.DataTexture(d, 1, 1, THREE.RGBAFormat);
      this._fallback.needsUpdate = true;
    }
    return this._fallback;
  }

  _getNoiseTexture(type) {
    return this._getFallbackTexture(); // Noise rendered separately by NoiseInput
  }

  _mat(fragmentShader, extraUniforms = {}) {
    const uniforms = {
      uTexture:  { value: null },
      uFG:       { value: null },
      uBG:       { value: null },
      uDS:       { value: null },
      ...extraUniforms,
    };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader:   VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
  }

  _buildMaterials() {
    this.m = {
      passthrough:  this._mat(PASSTHROUGH),
      keyer:        this._mat(KEYER, {
        uKeyWhite:    { value: 0.8 },
        uKeyBlack:    { value: 0.1 },
        uKeySoftness: { value: 0.05 },
        uKeyActive:   { value: 0 },
        uAlpha:       { value: 0 },
        uAlphaInvert: { value: 0 },
        uEK:          { value: null },
        uExtKey:      { value: 0 },
      }),
      displace:    this._mat(DISPLACE, {
        uAmount:     { value: 0 },
        uAngle:      { value: 0 },
        uOffset:     { value: 0 },
        uRotateGrey: { value: 0 },
      }),
      blend:       this._mat(BLEND, {
        uCurrent:  { value: null },
        uPrev:     { value: null },
        uActive:   { value: 0 },
        uAmount:   { value: 0.5 },
      }),
      feedback:    this._mat(FEEDBACK, {
        uOutput:    { value: null },
        uHorOffset: { value: 0 },
        uVerOffset: { value: 0 },
        uScale:     { value: 0 },
        uResolution: { value: new THREE.Vector2(1280, 720) },
      }),
      transfermode: this._mat(TRANSFERMODE, { uMode: { value: 0 } }),
      colorshift:   this._mat(COLORSHIFT,   { uShift: { value: 0 } }),
      interlace:    this._mat(INTERLACE, {
        uResY: { value: 720 }, uAmount: { value: 0 }, uTime: { value: 0 },
      }),
      mirror:      this._mat(MIRROR, { uFlipH: { value: 0 }, uFlipV: { value: 0 } }),
      warp:        this._mat(WARP, {
        uWarpMap:  { value: null },
        uStrength: { value: 0 },
      }),
      fade:        this._mat(FADE, { uAmount: { value: 1 } }),
      solidcolor:  this._mat(SOLID_COLOR, {
        uHue: { value: 0 }, uSat: { value: 0.8 }, uVal: { value: 0.6 },
      }),
      noise:       this._mat(NOISE_GEN, {
        uTime: { value: 0 }, uType: { value: 0 },
      }),
      bufferTransform: this._mat(BUFFER_TRANSFORM, {
        uPanX:  { value: 0 },
        uPanY:  { value: 0 },
        uScale: { value: 1 },
      }),
    };
  }
}
