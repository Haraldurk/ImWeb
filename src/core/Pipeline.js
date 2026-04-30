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
  TRANSFERMODE, TRANSFER_COPY, COLORSHIFT, NOISE_BFG, INTERLACE, MIRROR, SOLID_COLOR, WARP, FADE, PASSTHROUGH,
  BUFFER_TRANSFORM, INTERP,
  PIXELATE, EDGE, RGBSHIFT, POSTERIZE, SOLARIZE, COLOR_CORRECT, CHROMA_KEY,
  VIGNETTE, BLOOM_EXTRACT, BLOOM_BLUR, BLOOM_COMPOSITE, KALEIDOSCOPE, PIXEL_SORT,
  FILM_GRAIN, FEEDBACK_ROTATE, QUAD_MIRROR, LEVELS, LUT3D, WHITE_BALANCE, VASULKA_WARP,
} from '../shaders/index.js';

export const DEFAULT_FX_ORDER = [
  // VasulkaWarp — hidden, experimental, architecture unresolved. See dev notes.
  'pixelate','edge',/*'vasulka',*/'rgbshift','kaleidoscope','quadmirror',
  'posterize','solarize','vignette','bloom','levels','lut','whitebal','pixelsort','grain',
];

const _FX = {
  pixelate: (pipe, tex, p) => {
    const amt = p.get('effect.pixelate').value;
    if (amt <= 1) return tex;
    return pipe._pass(pipe.m.pixelate, {
      uTexture: tex, uAmount: amt,
      uResolution: new THREE.Vector2(pipe.width, pipe.height),
    });
  },
  edge: (pipe, tex, p) => {
    const amt = p.get('effect.edge').value / 100;
    if (amt <= 0) return tex;
    return pipe._pass(pipe.m.edge, {
      uTexture: tex, uAmount: amt,
      uInvert: p.get('effect.edge_inv').value,
      uResolution: new THREE.Vector2(pipe.width, pipe.height),
    });
  },
  // DEPRECATED — vasulka (VASULKA_WARP shader effect) is hidden from DEFAULT_FX_ORDER.
  // SequenceBuffer timewarp mode supersedes this for temporal slit-scan.
  // Keep the handler so saved presets that somehow reference it don't crash.
  vasulka: (pipe, tex, p) => {
    if (!p.get('vasulka.active')?.value) return tex;
    return pipe._pass(pipe.m.vasulka, {
      uTexture: tex,
      uFreqH:  p.get('vasulka.freqh').value,
      uFreqV:  p.get('vasulka.freqv').value,
      uAmpH:   p.get('vasulka.amph').value  / 100 * 0.15,
      uAmpV:   p.get('vasulka.ampv').value  / 100 * 0.10,
      uPhase:  p.get('vasulka.phase').value / 100 * Math.PI * 2,
      uFreq2:  p.get('vasulka.freq2').value,
      uAmp2:   p.get('vasulka.amp2').value  / 100 * 0.08,
      uColor:  p.get('vasulka.color').value / 100,
    });
  },
  rgbshift: (pipe, tex, p) => {
    const amt = p.get('effect.rgbshift').value / 100;
    if (amt <= 0) return tex;
    return pipe._pass(pipe.m.rgbshift, {
      uTexture: tex, uAmount: amt * 0.05,
      uAngle: p.get('effect.rgbangle').value * Math.PI / 180,
    });
  },
  kaleidoscope: (pipe, tex, p) => {
    const segs = p.get('effect.kaleidoscope').value;
    if (segs < 2) return tex;
    return pipe._pass(pipe.m.kaleidoscope, {
      uTexture: tex, uSegments: segs,
      uRotation: p.get('effect.kalerot').value / 100,
    });
  },
  quadmirror: (pipe, tex, p) => {
    const mode = p.get('effect.quadmirror').value;
    if (mode <= 0) return tex;
    return pipe._pass(pipe.m.quadmirror, { uTexture: tex, uMode: mode - 1 });
  },
  posterize: (pipe, tex, p) => {
    const lvl = p.get('effect.posterize').value;
    if (lvl >= 32) return tex;
    return pipe._pass(pipe.m.posterize, { uTexture: tex, uLevels: lvl });
  },
  solarize: (pipe, tex, p) => {
    const thresh = p.get('effect.solarize').value / 100;
    if (thresh >= 1) return tex;
    return pipe._pass(pipe.m.solarize, { uTexture: tex, uThreshold: thresh });
  },
  vignette: (pipe, tex, p) => {
    const amt = p.get('effect.vignette').value / 100;
    if (amt <= 0) return tex;
    return pipe._pass(pipe.m.vignette, {
      uTexture: tex, uAmount: amt,
      uRadius: p.get('effect.vigradius').value / 100,
    });
  },
  bloom: (pipe, tex, p) => {
    const amt = p.get('effect.bloom').value / 100;
    if (amt <= 0) return tex;
    const thresh = p.get('effect.bloomthresh').value / 100;
    const res = new THREE.Vector2(pipe.width, pipe.height);
    const bright = pipe._pass(pipe.m.bloomExtract, { uTexture: tex, uThreshold: thresh });
    pipe.m.bloomBlurH.uniforms.uResolution.value.copy(res);
    pipe.m.bloomBlurV.uniforms.uResolution.value.copy(res);
    const blurH = pipe._pass(pipe.m.bloomBlurH, { uTexture: bright });
    const blurV = pipe._pass(pipe.m.bloomBlurV, { uTexture: blurH });
    return pipe._pass(pipe.m.bloomComposite, { uTexture: tex, uBloom: blurV, uStrength: amt * 3 });
  },
  levels: (pipe, tex, p) => {
    const lvBlack = p.get('effect.lvblack').value / 100;
    const lvWhite = p.get('effect.lvwhite').value / 100;
    const lvGamma = p.get('effect.lvgamma').value / 100;
    if (lvBlack <= 0 && lvWhite >= 1 && Math.abs(lvGamma - 1) < 0.001) return tex;
    return pipe._pass(pipe.m.levels, {
      uTexture: tex,
      uBlack: lvBlack,
      uWhite: Math.max(lvBlack + 0.001, lvWhite),
      uGamma: Math.max(0.1, lvGamma),
    });
  },
  lut: (pipe, tex, p) => {
    if (!pipe._lutTex || !pipe._lutActive) return tex;
    const lutAmt = (p.get('effect.lutamount')?.value ?? 100) / 100;
    return pipe._pass(pipe.m.lut3d, {
      uTexture: tex, uLUT: pipe._lutTex, uLUTSize: pipe._lutSize, uAmount: lutAmt,
    });
  },
  whitebal: (pipe, tex, p) => {
    const wbTemp = p.get('effect.wbtemp')?.value ?? 0;
    const wbTint = p.get('effect.wbtint')?.value ?? 0;
    if (wbTemp === 0 && wbTint === 0) return tex;
    return pipe._pass(pipe.m.whitebal, { uTexture: tex, uTemperature: wbTemp, uTint: wbTint });
  },
  pixelsort: (pipe, tex, p) => {
    const amt = p.get('effect.pixelsort').value / 100;
    if (amt <= 0) return tex;
    const res = new THREE.Vector2(pipe.width, pipe.height);
    pipe.m.pixelsort.uniforms.uResolution.value.copy(res);
    return pipe._pass(pipe.m.pixelsort, {
      uTexture: tex,
      uThreshold: p.get('effect.psortthresh').value / 100,
      uLength: p.get('effect.psortlen').value * amt,
      uDirection: p.get('effect.psortdir').value,
      uMode: p.get('effect.psortmode').value,
    });
  },
  grain: (pipe, tex, p) => {
    const grainAmt = p.get('effect.grain').value / 100;
    const scanAmt  = p.get('effect.scanlines').value / 100;
    if (grainAmt <= 0 && scanAmt <= 0) return tex;
    return pipe._pass(pipe.m.filmgrain, {
      uTexture: tex, uGrain: grainAmt, uScanlines: scanAmt, uTime: pipe._noiseTime,
    });
  },
};

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

    // Dedicated noise render target — fixed 512×512 so complex BFG types
    // (DomainWarp, Curl) stay fast regardless of output resolution.
    this._noiseTarget = this._makeTarget(512, 512);

    // Live GLSL custom effect (hot-swappable)
    this._customMat    = null;  // set by setCustomShader()
    this._customError  = null;  // last compile error string, or null
    this._customActive = false; // whether to run the custom pass

    // 3D LUT colour grade
    this._lutTex    = null;   // THREE.DataTexture
    this._lutActive = false;
    this._lutSize   = 17;
    this._lutAmount = 1;

    // Reorderable post-FX chain
    this.fxOrder = [...DEFAULT_FX_ORDER];
  }

  // ── 3D LUT ───────────────────────────────────────────────────────────────

  /**
   * Load a parsed LUT (from parseCubeFile) into GPU memory.
   * @param {{ data: Float32Array, size: number }} lut
   * @param {number} amount 0–1 blend
   */
  setLUT(lut, amount = 1) {
    this._lutTex?.dispose();
    const N = lut.size;
    // Encode as 2D texture: width = N*N, height = N (horizontal slices)
    const tex = new THREE.DataTexture(lut.data, N * N, N, THREE.RGBFormat, THREE.FloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS     = THREE.ClampToEdgeWrapping;
    tex.wrapT     = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    this._lutTex    = tex;
    this._lutSize   = N;
    this._lutAmount = amount;
    this._lutActive = true;
  }

  clearLUT() {
    this._lutTex?.dispose();
    this._lutTex    = null;
    this._lutActive = false;
  }

  /** Set the post-FX execution order. Unknown IDs are silently dropped. */
  setFxOrder(order) {
    this.fxOrder = order.filter(id => id in _FX);
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
    let dsTex  = this._resolveSource(processedInputs, p.get('layer.ds').value);

    // Apply per-layer color correction (HSB) to FG and BG
    const fgHue    = p.get('fg.hue').value    / 360;
    const fgSat    = p.get('fg.sat').value    / 100;
    const fgBright = p.get('fg.bright').value / 100;
    const fgOpacity = (p.get('fg.opacity')?.value ?? 100) / 100;
    const fgColorChanged = fgHue !== 0 || fgSat !== 1 || fgBright !== 1;
    let correctedFG = fgColorChanged
      ? this._pass(this.m.colorcorrect, { uTexture: fgTex, uHue: fgHue, uSat: fgSat, uBright: fgBright })
      : fgTex;
    if (fgOpacity < 1) {
      correctedFG = this._pass(this.m.fade, { uTexture: correctedFG, uAmount: fgOpacity });
    }

    const bgHue    = p.get('bg.hue').value    / 360;
    const bgSat    = p.get('bg.sat').value    / 100;
    const bgBright = p.get('bg.bright').value / 100;
    const bgOpacity = (p.get('bg.opacity')?.value ?? 100) / 100;
    const bgColorChanged = bgHue !== 0 || bgSat !== 1 || bgBright !== 1;
    let correctedBG = bgColorChanged
      ? this._pass(this.m.colorcorrect, { uTexture: bgTex, uHue: bgHue, uSat: bgSat, uBright: bgBright })
      : bgTex;
    if (bgOpacity < 1) {
      correctedBG = this._pass(this.m.fade, { uTexture: correctedBG, uAmount: bgOpacity });
    }

    // Apply mirror to camera, movie, or buffer source if needed
    let workingFG = correctedFG;
    let bgTexFinal = correctedBG;
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

    // Per-layer blend (BG self-process tone treatment, FG composited over BG)
    const fgBlend = Math.round(p.get('layer.fg.blend')?.value ?? 0);
    const bgBlend = Math.round(p.get('layer.bg.blend')?.value ?? 0);
    // Self-blend is degenerate for Difference/Exclude/Subtract/Divide — skip
    const BG_DEGENERATE = bgBlend === 7 || bgBlend === 8 || bgBlend === 14 || bgBlend === 15;
    if (bgBlend > 0 && !BG_DEGENERATE) bgTexFinal  = this._pass(this.m.transfermode, { uFG: bgTexFinal,  uBG: bgTexFinal,  uMode: bgBlend });
    if (fgBlend > 0) workingFG   = this._pass(this.m.transfermode, {
      uFG: workingFG, uBG: bgTexFinal, uMode: fgBlend,
      uBlendAmount: (p.get('layer.fg.blendAmount')?.value ?? 1),
    });

    // Solo mode — bypass all effects
    if (p.get('output.solo').value) {
      this._blit(workingFG);
      return;
    }

    let composite = workingFG;

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
        uFGRaw:       fgTex,
        uKeyWhite:    p.get('keyer.white').value / 100,
        uKeyBlack:    p.get('keyer.black').value / 100,
        uKeySoftness: p.get('keyer.softness').value / 100,
        uKeyActive:   1,
        uAlpha:       p.get('keyer.alpha').value,
        uAlphaInvert: p.get('keyer.alpha_inv').value,
        uExtKey:      p.get('keyer.extkey').value,
        uRawKey:      p.get('keyer.rawkey')?.value ?? 0,
      });
    } else {
      keyed = displaced; // true skip — no GPU pass when keyer inactive
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
    const warpAmt = (p.get('displace.warpamt')?.value ?? 50) / 100;
    if (warpIdx > 0 && warpAmt > 0 && inputs.warpMaps?.[warpIdx - 1]) {
      warped = this._pass(this.m.warp, {
        uFG:       chromaKeyed,
        uWarpMap:  inputs.warpMaps[warpIdx - 1],
        uStrength: warpAmt,
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
      const fbMode = p.get('feedback.mode').value;
      if (fbMode === 0) {
        blended = warped;
      } else {
        blended = this._pass(this.m.transfermode, {
          uFG:          prevTex,
          uBG:          warped,
          uMode:        fbMode,
          uBlendAmount: p.get('blend.amount').value / 100,
        });
      }
    }

    // ── Color shift ───────────────────────────────────────────────────────
    let shifted = blended;
    const cs = p.get('output.colorshift').value / 100;
    if (cs > 0) {
      shifted = this._pass(this.m.colorshift, {
        uTexture: blended, uShift: cs,
      });
    }

    // ── Post-FX chain (reorderable) ───────────────────────────────────────
    let postOut = shifted;
    for (const fx of this.fxOrder) {
      postOut = _FX[fx]?.(this, postOut, p) ?? postOut;
    }

    // ── Interlace ─────────────────────────────────────────────────────────
    let interlaced = postOut;
    const il = p.get('output.interlace').value;
    if (il > 0) {
      interlaced = this._pass(this.m.interlace, {
        uTexture: postOut, uResY: this.height, uAmount: il, uTime: this._noiseTime,
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

    // ── Custom GLSL pass ──────────────────────────────────────────────────
    let customOut = faded;
    if (this._customActive && this._customMat) {
      this._customMat.uniforms.uTexture.value    = faded;
      this._customMat.uniforms.uTime.value       = this._noiseTime;
      this._customMat.uniforms.uResolution.value.set(this.width, this.height);
      // uParam1..4 are set externally via setCustomUniforms()
      customOut = this._pass(this._customMat, {});
    }

    // Final blit — optionally through bicubic interpolation
    const interpMode = p.get('output.interp').value;
    if (interpMode > 0) {
      this.m.interp.uniforms.uResolution.value.set(this.width, this.height);
      this.m.interp.uniforms.uMode.value = interpMode;
      this.m.interp.uniforms.uTexture.value = customOut;
      this._quad.material = this.m.interp;
      this.renderer.setRenderTarget(null);
      this.renderer.render(this._scene, this._camera);
    } else {
      this._blit(customOut);
    }

    // Save to prev buffer
    if (this.m.blend?.uniforms?.uPrev) this.m.blend.uniforms.uPrev.value = null;
    this._copyToPrev(customOut);
  }

  // ── Live GLSL custom shader ───────────────────────────────────────────────

  /**
   * Compile and install a custom fragment shader.
   * Returns null on success, or an error string on compile failure.
   * The shader receives: uTexture (sampler2D), uTime (float), uResolution (vec2),
   * and the standard vUv varying.
   */
  /**
   * Update the 4 user-bindable parameter uniforms (uParam1..uParam4).
   * Called each frame from main.js with current param values.
   */
  setCustomUniforms(vals) {
    if (!this._customMat) return;
    for (let i = 0; i < 4; i++) {
      const key = `uParam${i + 1}`;
      if (this._customMat.uniforms[key] !== undefined) {
        this._customMat.uniforms[key].value = vals[i] ?? 0;
      }
    }
  }

  setCustomShader(fragmentSrc) {
    // Build a test material to detect compile errors via WebGL
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture:    { value: null },
        uTime:       { value: 0 },
        uResolution: { value: new THREE.Vector2(this.width, this.height) },
        uParam1:     { value: 0 },
        uParam2:     { value: 0 },
        uParam3:     { value: 0 },
        uParam4:     { value: 0 },
      },
      vertexShader:   VERT,
      fragmentShader: fragmentSrc,
      depthTest:  false,
      depthWrite: false,
    });

    // Force compile and detect errors via WebGL program link status
    try {
      const gl = this.renderer.getContext();
      // Drain any pre-existing GL errors so stale errors don't cause false failure
      while (gl.getError() !== gl.NO_ERROR) {}

      this._quad.material = mat;
      this.renderer.compile(this._scene, this._camera);

      // Check program link status directly for accurate error detection
      const progInfo = this.renderer.info.programs;
      let linkError = null;
      if (progInfo) {
        for (const p of progInfo) {
          if (p.fragmentShader === mat.fragmentShader || p.vertexShader === mat.vertexShader) {
            // Try to get info log from WebGL
            const glProg = p.program;
            if (glProg && !gl.getProgramParameter(glProg, gl.LINK_STATUS)) {
              linkError = gl.getProgramInfoLog(glProg) ?? 'Shader link failed';
            }
            break;
          }
        }
      }
      if (linkError) throw new Error(linkError);

      // Also catch any new GL errors after compile
      const err = gl.getError();
      if (err !== 0) throw new Error(`WebGL error ${err} — check shader syntax`);
    } catch (e) {
      mat.dispose();
      this._customError  = e.message;
      this._customActive = false;
      return this._customError;
    }

    // Dispose old custom material
    this._customMat?.dispose();
    this._customMat    = mat;
    this._customActive = true;
    this._customError  = null;
    return null;
  }

  disableCustomShader() {
    this._customActive = false;
  }

  // ── BFG noise generation ──────────────────────────────────────────────────

  /**
   * Render the BFG noise shader to a dedicated 512×512 target each frame.
   * Returns the noise texture for use as inputs.noise in the pipeline.
   * @param {object} p  All BFG params from ParameterSystem
   */
  generateNoise(p) {
    const m = this.m.noise;
    m.uniforms.uTime.value       = p.time;
    m.uniforms.uType.value       = p.type;
    m.uniforms.uScale.value      = p.scale;
    m.uniforms.uOctaves.value    = p.octaves;
    m.uniforms.uLacunarity.value = p.lacunarity;
    m.uniforms.uGain.value       = p.gain;
    m.uniforms.uSpeed.value      = p.speed;
    m.uniforms.uOffsetX.value    = p.offsetX;
    m.uniforms.uOffsetY.value    = p.offsetY;
    m.uniforms.uContrast.value   = p.contrast;
    m.uniforms.uInvert.value     = p.invert;
    m.uniforms.uSeed.value       = p.seed;
    m.uniforms.uColor.value      = p.color;
    if (m.uniforms.uColor1) m.uniforms.uColor1.value = p.color1 ?? new THREE.Vector3(1,1,1);
    if (m.uniforms.uColor2) m.uniforms.uColor2.value = p.color2 ?? new THREE.Vector3(0,0,0);
    this._quad.material = m;
    this.renderer.setRenderTarget(this._noiseTarget);
    this.renderer.render(this._scene, this._camera);
    return this._noiseTarget.texture;
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
    const fallback = this._getFallbackTexture();
    const outTex  = this.targets[this._current].texture;
    Object.entries(uniforms).forEach(([key, val]) => {
      if (material.uniforms[key] !== undefined) {
        // Replace null textures with fallback so WebGL never gets a null sampler
        if (val === null && key.startsWith('u') && key !== 'uKeyActive' &&
            key !== 'uAlpha' && key !== 'uAlphaInvert' && key !== 'uMode' &&
            key !== 'uActive' && key !== 'uRotateGrey' && key !== 'uFlipH' &&
            key !== 'uFlipV' && key !== 'uType') {
          val = fallback;
        }
        // Identity guard: if this texture is the render target we're about
        // to write to, WebGL throws GL_INVALID_OPERATION. Substitute fallback.
        if (val && val === outTex) {
          val = fallback;
          if (typeof this._fbWarnCount === 'undefined') this._fbWarnCount = 0;
          if (this._fbWarnCount++ < 10) console.warn('[Pipeline] feedback loop guard fired on', key);
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
    const SOURCES = ['camera', 'movie', 'buffer', 'color', 'color2', 'noise', 'scene3d', 'draw', 'output', 'bg1', 'bg2', 'text', 'sound', 'delay', 'scope', 'slitscan', 'particles', 'seq1', 'seq2', 'seq3', 'depth3d', 'sdf', 'vwarp', 'analog'];
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
    if (key === 'scope'    && inputs.scope)    return inputs.scope;
    if (key === 'slitscan'  && inputs.slitscan)  return inputs.slitscan;
    if (key === 'particles' && inputs.particles) return inputs.particles;
    if (key === 'seq1'      && inputs.seq1)      return inputs.seq1;
    if (key === 'seq2'      && inputs.seq2)      return inputs.seq2;
    if (key === 'seq3'      && inputs.seq3)      return inputs.seq3;
    if (key === 'depth3d'   && inputs.depth3d)   return inputs.depth3d;
    if (key === 'sdf'       && inputs.sdf)       return inputs.sdf;
    if (key === 'vwarp'     && inputs.vwarp)     return inputs.vwarp;
    if (key === 'analog'    && inputs.analog)    return inputs.analog;
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
        uFGRaw:       { value: null },
        uRawKey:      { value: 0 },
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
      transfermode: this._mat(TRANSFERMODE, { uMode: { value: 0 }, uBlendAmount: { value: 1.0 } }),
      transfercopy: this._mat(TRANSFER_COPY, { uBlendAmount: { value: 1.0 } }),
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
      noise: this._mat(NOISE_BFG, {
        uTime:       { value: 0 },
        uType:       { value: 1 },   // default: Perlin
        uScale:      { value: 3.0 },
        uOctaves:    { value: 4.0 },
        uLacunarity: { value: 2.0 },
        uGain:       { value: 0.5 },
        uSpeed:      { value: 0.2 },
        uOffsetX:    { value: 0.0 },
        uOffsetY:    { value: 0.0 },
        uContrast:   { value: 1.0 },
        uInvert:     { value: 0 },
        uSeed:       { value: 0.0 },
        uColor:      { value: 0 },
        uColor1:     { value: new THREE.Vector3(1, 1, 1) },
        uColor2:     { value: new THREE.Vector3(0, 0, 0) },
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
      quadmirror: this._mat(QUAD_MIRROR, { uMode: { value: 0 } }),
      levels:     this._mat(LEVELS, {
        uBlack: { value: 0 },
        uWhite: { value: 1 },
        uGamma: { value: 1 },
      }),
      lut3d:      this._mat(LUT3D, {
        uLUT:     { value: null },
        uLUTSize: { value: 17 },
        uAmount:  { value: 1 },
      }),
      whitebal:   this._mat(WHITE_BALANCE, {
        uTemperature: { value: 0 },
        uTint:        { value: 0 },
      }),
      vasulka:    this._mat(VASULKA_WARP, {
        uFreqH: { value: 3 }, uFreqV: { value: 0 },
        uAmpH:  { value: 0.03 }, uAmpV: { value: 0 },
        uPhase: { value: 0 },
        uFreq2: { value: 7 }, uAmp2:  { value: 0 },
        uColor: { value: 0 },
      }),
    };
  }
}
