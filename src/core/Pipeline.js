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
  BUFFER_TRANSFORM, INTERP,
  PIXELATE, EDGE, RGBSHIFT, POSTERIZE, SOLARIZE, COLOR_CORRECT, CHROMA_KEY,
  VIGNETTE, BLOOM_EXTRACT, BLOOM_BLUR, BLOOM_COMPOSITE, KALEIDOSCOPE, PIXEL_SORT,
  FILM_GRAIN, FEEDBACK_ROTATE,
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

    // Frame blend (mix fs1 and fs2)
    const frameBlendAmt = p.get('buffer.frameblend').value / 100;
    if (frameBlendAmt > 0 && inputs.buffer2) {
      const blended = this._pass(this.m.blend, {
        uCurrent: inputs.buffer ?? this._getFallbackTexture(),
        uPrev:    inputs.buffer2,
        uActive:  1,
        uAmount:  frameBlendAmt,
      });
      processedInputs = { ...processedInputs, buffer: blended };
    }

    // Resolve input textures
    const fgIdx  = p.get('layer.fg').value;
    const fgTex  = this._resolveSource(processedInputs, fgIdx);
    const bgTex  = this._resolveSource(processedInputs, p.get('layer.bg').value);
    const dsTex  = this._resolveSource(processedInputs, p.get('layer.ds').value);

    // Apply per-layer color correction (HSB) to FG and BG
    const fgHue    = p.get('fg.hue').value    / 360;
    const fgSat    = p.get('fg.sat').value    / 100;
    const fgBright = p.get('fg.bright').value / 100;
    const correctedFG = (fgHue !== 0 || fgSat !== 1 || fgBright !== 1)
      ? this._pass(this.m.colorcorrect, { uTexture: fgTex, uHue: fgHue, uSat: fgSat, uBright: fgBright })
      : fgTex;

    const bgHue    = p.get('bg.hue').value    / 360;
    const bgSat    = p.get('bg.sat').value    / 100;
    const bgBright = p.get('bg.bright').value / 100;
    const correctedBG = (bgHue !== 0 || bgSat !== 1 || bgBright !== 1)
      ? this._pass(this.m.colorcorrect, { uTexture: bgTex, uHue: bgHue, uSat: bgSat, uBright: bgBright })
      : bgTex;

    // Apply mirror to camera, movie, or buffer source if needed
    let workingFG = correctedFG;
    const bgTexFinal = correctedBG;
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
        uFG: workingFG, uBG: bgTexFinal, uMode: tm,
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
        uBG:          bgTexFinal,
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
        uFG: displaced, uBG: bgTexFinal, uEK: dsTex,
        uKeyWhite: 1, uKeyBlack: 0, uKeySoftness: 0,
        uKeyActive: 0, uAlpha: 0, uAlphaInvert: 0, uExtKey: 0,
      });
    }

    // ── Chroma Key (runs after luma keyer) ───────────────────────────────
    let chromaKeyed = keyed;
    if (p.get('keyer.chroma').value) {
      chromaKeyed = this._pass(this.m.chromakey, {
        uFG:          keyed,
        uBG:          bgTexFinal,
        uKeyHue:      p.get('keyer.chromahue').value  / 360,
        uKeyRange:    p.get('keyer.chromarange').value / 100,
        uKeySoftness: p.get('keyer.chromasoft').value  / 100,
        uKeyActive:   1,
      });
    }

    // ── WarpMap ───────────────────────────────────────────────────────────
    let warped = chromaKeyed;
    const warpIdx = p.get('displace.warp').value;
    if (warpIdx > 0 && inputs.warpMaps?.[warpIdx - 1]) {
      warped = this._pass(this.m.warp, {
        uFG:       chromaKeyed,
        uWarpMap:  inputs.warpMaps[warpIdx - 1],
        uStrength: displAmt,
      });
    }

    // ── Blend (with previous frame, optionally feedback-shifted) ─────────
    let blended = warped;
    if (p.get('blend.active').value) {
      // Apply feedback offset/scale to prev frame before blending
      const fbHor    = p.get('feedback.hor').value   / 100;
      const fbVer    = p.get('feedback.ver').value   / 100;
      const fbScale  = p.get('feedback.scale').value / 50;
      const fbAngle  = p.get('feedback.rotate').value / 100;
      const fbZoom   = p.get('feedback.zoom').value   / 100 + 1; // 0→1x, 100→2x
      let prevTex = this.prev.texture;
      // Apply rotate/zoom first (centred), then offset/scale (pan)
      if (fbAngle !== 0 || fbZoom !== 1) {
        prevTex = this._pass(this.m.feedbackRotate, {
          uTexture: prevTex,
          uAngle:   fbAngle,
          uZoom:    fbZoom,
        });
      }
      if (fbHor !== 0 || fbVer !== 0 || fbScale !== 0) {
        prevTex = this._pass(this.m.feedback, {
          uOutput:     prevTex,
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

    // ── Pixelate ──────────────────────────────────────────────────────────
    let pixelated = shifted;
    const pixAmt = p.get('effect.pixelate').value;
    if (pixAmt > 1) {
      pixelated = this._pass(this.m.pixelate, {
        uTexture: shifted, uAmount: pixAmt,
        uResolution: new THREE.Vector2(this.width, this.height),
      });
    }

    // ── Edge detect ───────────────────────────────────────────────────────
    let edged = pixelated;
    const edgeAmt = p.get('effect.edge').value / 100;
    if (edgeAmt > 0) {
      edged = this._pass(this.m.edge, {
        uTexture: pixelated, uAmount: edgeAmt,
        uInvert: p.get('effect.edge_inv').value,
        uResolution: new THREE.Vector2(this.width, this.height),
      });
    }

    // ── RGB shift ─────────────────────────────────────────────────────────
    let rgbShifted = edged;
    const rgbAmt = p.get('effect.rgbshift').value / 100;
    if (rgbAmt > 0) {
      rgbShifted = this._pass(this.m.rgbshift, {
        uTexture: edged, uAmount: rgbAmt * 0.05,
        uAngle: p.get('effect.rgbangle').value * Math.PI / 180,
      });
    }

    // ── Kaleidoscope ──────────────────────────────────────────────────────
    let kaleided = rgbShifted;
    const kaleSegs = p.get('effect.kaleidoscope').value;
    if (kaleSegs >= 2) {
      kaleided = this._pass(this.m.kaleidoscope, {
        uTexture:  rgbShifted,
        uSegments: kaleSegs,
        uRotation: p.get('effect.kalerot').value / 100,
      });
    }

    // ── Posterize ─────────────────────────────────────────────────────────
    let posterized = kaleided;
    const postLvl = p.get('effect.posterize').value;
    if (postLvl < 32) {
      posterized = this._pass(this.m.posterize, {
        uTexture: kaleided, uLevels: postLvl,
      });
    }

    // ── Solarize ──────────────────────────────────────────────────────────
    let solarized = posterized;
    const solThresh = p.get('effect.solarize').value / 100;
    if (solThresh < 1) {
      solarized = this._pass(this.m.solarize, {
        uTexture: posterized, uThreshold: solThresh,
      });
    }

    // ── Vignette ──────────────────────────────────────────────────────────
    let vignetted = solarized;
    const vigAmt = p.get('effect.vignette').value / 100;
    if (vigAmt > 0) {
      vignetted = this._pass(this.m.vignette, {
        uTexture: solarized,
        uAmount:  vigAmt,
        uRadius:  p.get('effect.vigradius').value / 100,
      });
    }

    // ── Bloom ─────────────────────────────────────────────────────────────
    let bloomed = vignetted;
    const bloomAmt = p.get('effect.bloom').value / 100;
    if (bloomAmt > 0) {
      const thresh = p.get('effect.bloomthresh').value / 100;
      const res    = new THREE.Vector2(this.width, this.height);
      const bright = this._pass(this.m.bloomExtract, { uTexture: vignetted, uThreshold: thresh });
      this.m.bloomBlurH.uniforms.uResolution.value.copy(res);
      this.m.bloomBlurV.uniforms.uResolution.value.copy(res);
      const blurH  = this._pass(this.m.bloomBlurH, { uTexture: bright });
      const blurV  = this._pass(this.m.bloomBlurV, { uTexture: blurH });
      bloomed = this._pass(this.m.bloomComposite, {
        uTexture: vignetted, uBloom: blurV, uStrength: bloomAmt * 3,
      });
    }

    // ── Pixel Sort ────────────────────────────────────────────────────────
    let pixsorted = bloomed;
    const psortAmt = p.get('effect.pixelsort').value / 100;
    if (psortAmt > 0) {
      const res = new THREE.Vector2(this.width, this.height);
      this.m.pixelsort.uniforms.uResolution.value.copy(res);
      pixsorted = this._pass(this.m.pixelsort, {
        uTexture:   bloomed,
        uThreshold: p.get('effect.psortthresh').value / 100,
        uLength:    p.get('effect.psortlen').value * psortAmt,
        uDirection: p.get('effect.psortdir').value,
        uMode:      p.get('effect.psortmode').value,
      });
    }

    // ── Film Grain ────────────────────────────────────────────────────────
    let grained = pixsorted;
    const grainAmt = p.get('effect.grain').value / 100;
    const scanAmt  = p.get('effect.scanlines').value / 100;
    if (grainAmt > 0 || scanAmt > 0) {
      grained = this._pass(this.m.filmgrain, {
        uTexture:   pixsorted,
        uGrain:     grainAmt,
        uScanlines: scanAmt,
        uTime:      this._noiseTime,
      });
    }

    // ── Interlace ─────────────────────────────────────────────────────────
    let interlaced = grained;
    const il = p.get('output.interlace').value;
    if (il > 0) {
      interlaced = this._pass(this.m.interlace, {
        uTexture: grained, uResY: this.height, uAmount: il, uTime: this._noiseTime,
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

    // Final blit — optionally through bicubic interpolation
    const interpMode = p.get('output.interp').value;
    if (interpMode > 0) {
      this.m.interp.uniforms.uResolution.value.set(this.width, this.height);
      this.m.interp.uniforms.uMode.value = interpMode;
      this.m.interp.uniforms.uTexture.value = faded;
      this._quad.material = this.m.interp;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this._scene, this._camera);
    } else {
      this._blit(faded);
    }

    // Save to prev buffer
    this._copyToPrev(faded);
  }

  // ── GPU noise generation ──────────────────────────────────────────────────

  /** Run the NOISE_GEN shader and return the resulting texture. */
  generateNoise(time, type) {
    return this._pass(this.m.noise, { uTime: time, uType: type });
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
    const SOURCES = ['camera', 'movie', 'buffer', 'color', 'noise', 'scene3d', 'draw', 'output', 'bg1', 'bg2', 'color2', 'text', 'sound', 'delay', 'scope'];
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
    if (key === 'color2'  && inputs.color2)  return inputs.color2;
    if (key === 'text'    && inputs.text)    return inputs.text;
    if (key === 'sound'   && inputs.sound)   return inputs.sound;
    if (key === 'delay'   && inputs.delay)   return inputs.delay;
    if (key === 'scope'   && inputs.scope)   return inputs.scope;
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
      interp: this._mat(INTERP, {
        uResolution: { value: new THREE.Vector2(1280, 720) },
        uMode:       { value: 0 },
      }),
      pixelate:  this._mat(PIXELATE, {
        uAmount: { value: 1 }, uResolution: { value: new THREE.Vector2(1280, 720) },
      }),
      edge:      this._mat(EDGE, {
        uAmount: { value: 0 }, uInvert: { value: 0 },
        uResolution: { value: new THREE.Vector2(1280, 720) },
      }),
      rgbshift:  this._mat(RGBSHIFT, { uAmount: { value: 0 }, uAngle: { value: 0 } }),
      posterize: this._mat(POSTERIZE, { uLevels: { value: 32 } }),
      solarize:  this._mat(SOLARIZE,  { uThreshold: { value: 1 } }),
      colorcorrect: this._mat(COLOR_CORRECT, {
        uHue:    { value: 0 },
        uSat:    { value: 1 },
        uBright: { value: 1 },
      }),
      chromakey: this._mat(CHROMA_KEY, {
        uKeyHue:      { value: 0.33 },
        uKeyRange:    { value: 0.15 },
        uKeySoftness: { value: 0.08 },
        uKeyActive:   { value: 0 },
      }),
      kaleidoscope: this._mat(KALEIDOSCOPE, {
        uSegments: { value: 4 },
        uRotation: { value: 0 },
      }),
      vignette: this._mat(VIGNETTE, {
        uAmount: { value: 0 },
        uRadius: { value: 0.65 },
      }),
      bloomExtract: this._mat(BLOOM_EXTRACT, { uThreshold: { value: 0.7 } }),
      bloomBlurH: this._mat(BLOOM_BLUR, {
        uDirection:  { value: new THREE.Vector2(1, 0) },
        uResolution: { value: new THREE.Vector2(1280, 720) },
      }),
      bloomBlurV: this._mat(BLOOM_BLUR, {
        uDirection:  { value: new THREE.Vector2(0, 1) },
        uResolution: { value: new THREE.Vector2(1280, 720) },
      }),
      bloomComposite: this._mat(BLOOM_COMPOSITE, {
        uBloom:    { value: null },
        uStrength: { value: 1 },
      }),
      pixelsort: this._mat(PIXEL_SORT, {
        uResolution: { value: new THREE.Vector2(1280, 720) },
        uThreshold:  { value: 0.3 },
        uLength:     { value: 64 },
        uDirection:  { value: 0 },
        uMode:       { value: 0 },
      }),
      filmgrain: this._mat(FILM_GRAIN, {
        uGrain:     { value: 0 },
        uScanlines: { value: 0 },
        uTime:      { value: 0 },
      }),
      feedbackRotate: this._mat(FEEDBACK_ROTATE, {
        uAngle: { value: 0 },
        uZoom:  { value: 1 },
      }),
    };
  }
}
