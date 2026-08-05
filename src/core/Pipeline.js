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
  SHARPEN, MIXBUS,
} from '../shaders/index.js';
import { SOURCE_KEYS } from '../controls/ParameterSystem.js';

/** Mix bus param prefixes, index-aligned to MIXBUS_IDX (source 26/27/28). */
const MIX_PREFIX = ['mix', 'mix2', 'mix3'];

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
    });
  },
  edge: (pipe, tex, p) => {
    const amt = p.get('effect.edge').value / 100;
    if (amt <= 0) return tex;
    return pipe._pass(pipe.m.edge, {
      uTexture: tex, uAmount: amt,
      uInvert: p.get('effect.edge_inv').value,
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
    const hw = Math.ceil(pipe.width  / 2);
    const hh = Math.ceil(pipe.height / 2);

    // 1. Extract bright pixels at full resolution (uses ping-pong: 1 flip)
    const bright = pipe._pass(pipe.m.bloomExtract, { uTexture: tex, uThreshold: thresh });

    // 2. BlurH at half-res → dedicated target (no ping-pong flip).
    //    Resolution uniform uses full dimensions so the Gaussian kernel step
    //    (texel = direction / resolution) stays identical to the original,
    //    preserving bloom radius. Half-res render gives 4× fewer fragments.
    pipe._passTo(pipe.m.bloomBlurH, { uTexture: bright }, pipe._bloomTargetH);

    // 3. BlurV at half-res → dedicated target (no ping-pong flip)
    pipe._passTo(pipe.m.bloomBlurV, { uTexture: pipe._bloomTargetH.texture }, pipe._bloomTargetV);

    // 4. Composite at full res — upsamples blur back onto original scene.
    //    After 1 flip (extract) + 0 (blur passes), ping-pong parity would cause
    //    tex to alias the composite output target. One manual flip restores the
    //    same final _current state as the original 4-flip path, and eliminates
    //    the feedback-loop conflict on uTexture.
    pipe._current ^= 1;
    return pipe._pass(pipe.m.bloomComposite, {
      uTexture: tex,
      uBloom:   pipe._bloomTargetV.texture,
      uStrength: amt * 3,
    });
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
    // Second 512×512 target for the optional noise-sharpen pass (ping-pong
    // independent of the main pipeline's targets).
    this._noiseSharpTarget = this._makeTarget(512, 512);

    // Dedicated half-resolution targets for bloom blur passes.
    // BlurH and BlurV render at w/2 × h/2; composite upsamples back to full-res.
    const hw = Math.ceil(width / 2);
    const hh = Math.ceil(height / 2);
    this._bloomTargetH = this._makeTarget(hw, hh);
    this._bloomTargetV = this._makeTarget(hw, hh);

    // Feedback transform targets — dedicated, OUTSIDE the ping-pong pool, for
    // the same reason the mix buses are: a second target beats a guard.
    //
    // The prev-frame transform passes used to ping-pong through this.targets
    // while the composited live frame was ALSO parked in one of them. Two
    // targets, and the composite plus up to two transform passes in flight, so
    // whether the second transform overwrote the live frame came down to how
    // many passes the keyer/chroma/warp/displace chain had run before it —
    // parity, not intent. When it landed wrong the blend received the
    // transformed prev frame as BOTH its inputs and the live picture vanished
    // from the output entirely, which reads as "feedback ate my image" rather
    // than as a buffer bug.
    //
    // The identity guard in _pass() cannot catch this: it fires when a pass
    // reads the texture it is about to write, and here the clobbered texture is
    // read by a LATER pass. Nothing is aliased at the moment of the write.
    // Allocated lazily — a project that never transforms its feedback pays no
    // VRAM for these.
    this._fbRT = null;

    // Mix buses ×3 — dedicated full-res targets, outside the ping-pong pool
    // because layer resolution reads them later in the frame (and main.js
    // reads them for secondary lookups).
    //
    // Each bus is DOUBLE-BUFFERED. The back buffer holds last frame's output,
    // which is what lets a bus be read by itself (or by an earlier bus)
    // without sampling the texture currently being written — the WebGL
    // feedback hazard. Allocated lazily: a project that never routes a bus
    // pays no VRAM, which matters at 2 targets × 3 buses × full res.
    this._mixRT  = [null, null, null]; // each: [RenderTarget, RenderTarget]
    this._mixCur = [0, 0, 0];          // buffer index holding the LATEST output

    // Live GLSL custom effect (hot-swappable)
    this._customMat    = null;  // set by setCustomShader()
    this._customError  = null;  // last compile error string, or null
    this._customActive = false; // whether to run the custom pass
    this._vj           = null;  // per-frame VJ data from setCustomVJ()
    this._vjBlackTex   = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this._vjBlackTex.needsUpdate = true; // tAudio fallback when sound is off

    // 3D LUT colour grade
    this._lutTex    = null;   // THREE.DataTexture
    this._lutActive = false;
    this._lutSize   = 17;
    this._lutAmount = 1;

    // Reorderable post-FX chain
    this.fxOrder = [...DEFAULT_FX_ORDER];

    // Pre-allocated inputs overlay — avoids { ...inputs } spread allocation each frame
    this._pInputs = Object.create(null);

    this._lastResW = 0;
    this._lastResH = 0;
    this._noiseTime = 0;
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
    // Encode as 2D texture: width = N*N, height = N (horizontal slices).
    //
    // NOT RGBFormat+FloatType. three still defines RGBFormat, but it picks no
    // sized internal format for it (getInternalFormat only upgrades RGB for
    // UNSIGNED_INT_5_9_9_9_REV), so the upload is unsized RGB + FLOAT — an
    // invalid WebGL2 combination. texImage2D throws INVALID_OPERATION, the
    // texture stays incomplete, every texture2D() returns (0,0,0,1), and the
    // whole picture goes black the moment LUT amount comes off zero.
    //
    // Half-float, not float: RGBA16F is filterable in core WebGL2, while
    // RGBA32F needs OES_texture_float_linear and samples black without it —
    // the same black screen with a narrower blast radius.
    const src = lut.data;
    const rgba = new Uint16Array(N * N * N * 4);
    for (let i = 0, o = 0; i < src.length; i += 3, o += 4) {
      rgba[o]     = THREE.DataUtils.toHalfFloat(src[i]);
      rgba[o + 1] = THREE.DataUtils.toHalfFloat(src[i + 1]);
      rgba[o + 2] = THREE.DataUtils.toHalfFloat(src[i + 2]);
      rgba[o + 3] = 0x3c00; // 1.0
    }
    const tex = new THREE.DataTexture(rgba, N * N, N, THREE.RGBAFormat, THREE.HalfFloatType);
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
      Object.assign(this._pInputs, inputs);
      this._pInputs.buffer = bufTex;
      processedInputs = this._pInputs;
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
      if (processedInputs === inputs) {
        // bufferTransform branch did not run — populate _pInputs now
        Object.assign(this._pInputs, inputs);
        processedInputs = this._pInputs;
      }
      this._pInputs.buffer = blended;
    }

    // ── Mix buses ×3 (Phase 23 Steps 2 & 4) ──────────────────────────────────
    // Rendered in evaluation order 1 → 2 → 3, BEFORE layer resolution, so any
    // bus is selectable as FG/BG/DS this frame. srcA/srcB select ANY source,
    // resolved through the same _resolveSource() the layers use, so a bus is a
    // real graph node rather than a hardwired deck crossfader.
    //
    // Gated per bus on inputs.mixbusNeeded[k] (main.js consumption analysis),
    // NOT on input presence: mixing Camera against Noise with no movie loaded
    // must still render, so the old `inputs.movie || inputs.movieB` test would
    // have been actively wrong here.
    //
    // Each pass writes the BACK buffer and flips _mixCur only afterwards. One
    // rule falls out of that, with no special cases and no feedback flag:
    //   • a later bus reading an earlier one → THIS frame (it already flipped)
    //   • an earlier bus reading a later one → LAST frame
    //   • a bus reading ITSELF               → LAST frame
    // The self case is safe because the sampled texture is physically a
    // different target from the one being written.
    for (let k = 0; k < MIX_PREFIX.length; k++) {
      if (!inputs.mixbusNeeded?.[k]) continue;
      const pfx = MIX_PREFIX[k];
      const rt  = this._ensureMixRT(k);          // before _resolveSource: a
      const dst = rt[this._mixCur[k] ^ 1];       // self-read needs the pair
      this._passTo(this.m.mixbus, {
        uFG:      this._resolveSource(processedInputs, p.get(`${pfx}.srcA`).value),
        uBG:      this._resolveSource(processedInputs, p.get(`${pfx}.srcB`).value),
        uMode:    p.get(`${pfx}.mode`).value,
        uXfade:   p.get(`${pfx}.xfade`).value,
        uDispAmt: p.get(`${pfx}.dispAmt`).value,
        uMaskLo:  p.get(`${pfx}.maskLo`).value,
        uMaskHi:  p.get(`${pfx}.maskHi`).value,
      }, dst);
      this._mixCur[k] ^= 1;
    }

    // Resolve input textures
    const fgIdx  = p.get('layer.fg').value;
    let fgTex  = this._resolveSource(processedInputs, fgIdx);
    let bgTex  = this._resolveSource(processedInputs, p.get('layer.bg').value);
    let dsTex  = this._resolveSource(processedInputs, p.get('layer.ds').value);

    // ── Custom GLSL insert routing ────────────────────────────────────────
    // 0 Master (post-fade, below) · 1 FG · 2 BG · 3 Displace. FG/BG inserts
    // run before per-layer color correction, so blends and the keyer's raw
    // key see the shader output; dsTex also feeds the ext key (uEK).
    const glslTarget = p.get('glsl.target')?.value ?? 0;
    if (glslTarget === 1) fgTex = this._applyCustomPass(fgTex);
    else if (glslTarget === 2) bgTex = this._applyCustomPass(bgTex);
    else if (glslTarget === 3) dsTex = this._applyCustomPass(dsTex);

    // Per-layer color correction (HSB) + slot mirror, folded into ONE pass.
    // Mirror is a uFlipH uniform on the colorcorrect shader: no extra
    // ping-pong pass (the two-target pool cannot collide), and mirror
    // composes with hue/sat/bright instead of bypassing them.
    const fgHue    = p.get('fg.hue').value    / 360;
    const fgSat    = p.get('fg.sat').value    / 100;
    const fgBright = p.get('fg.bright').value / 100;
    const fgOpacity = (p.get('fg.opacity')?.value ?? 100) / 100;
    const fgMirror = p.get('mirror.fg')?.value ? 1 : 0;
    const fgColorChanged = fgHue !== 0 || fgSat !== 1 || fgBright !== 1;
    let correctedFG = (fgColorChanged || fgMirror)
      ? this._pass(this.m.colorcorrect, { uTexture: fgTex, uHue: fgHue, uSat: fgSat, uBright: fgBright, uFlipH: fgMirror })
      : fgTex;
    if (fgOpacity < 1) {
      correctedFG = this._pass(this.m.fade, { uTexture: correctedFG, uAmount: fgOpacity });
    }

    const bgHue    = p.get('bg.hue').value    / 360;
    const bgSat    = p.get('bg.sat').value    / 100;
    const bgBright = p.get('bg.bright').value / 100;
    const bgOpacity = (p.get('bg.opacity')?.value ?? 100) / 100;
    const bgMirror = p.get('mirror.bg')?.value ? 1 : 0;
    const bgColorChanged = bgHue !== 0 || bgSat !== 1 || bgBright !== 1;
    let correctedBG = (bgColorChanged || bgMirror)
      ? this._pass(this.m.colorcorrect, { uTexture: bgTex, uHue: bgHue, uSat: bgSat, uBright: bgBright, uFlipH: bgMirror })
      : bgTex;
    if (bgOpacity < 1) {
      correctedBG = this._pass(this.m.fade, { uTexture: correctedBG, uAmount: bgOpacity });
    }

    let workingFG = correctedFG;
    let bgTexFinal = correctedBG;

    // Per-layer blend (BG self-process tone treatment, FG composited over BG)
    const fgBlend = Math.round(p.get('layer.fg.blend')?.value ?? 0);
    const bgBlend = Math.round(p.get('layer.bg.blend')?.value ?? 0);
    // Self-blend is degenerate for Difference/Exclude/Subtract/Divide — skip
    const BG_DEGENERATE = bgBlend === 7 || bgBlend === 8 || bgBlend === 14 || bgBlend === 15;
    // uBlendAmount MUST be passed explicitly. _pass() only writes the uniforms
    // it is given, and this material is shared with the FG blend and with the
    // feedback blend — omitting it left the BG self-blend running at whichever
    // strength another pass set last frame. Harmless-looking while the bitwise
    // modes ignored uBlendAmount entirely; now that they honour it, a stale
    // value would be visible in BG XOR/OR/AND.
    if (bgBlend > 0 && !BG_DEGENERATE) bgTexFinal  = this._pass(this.m.transfermode, {
      uFG: bgTexFinal, uBG: bgTexFinal, uMode: bgBlend, uBlendAmount: 1,
    });
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
        // The external key follows keyer.keysrc, resolved in main.js because
        // CAPTURE_SOURCES carries the indirect FG/BG/DS Src entries that only
        // _captureIdx knows how to follow. Falling back to dsTex keeps the
        // pre-keysrc wiring for any caller that does not supply one.
        uEK:          inputs.keysrc ?? dsTex,
        uFGRaw:       fgTex,
        uKeyWhite:    p.get('keyer.white').value / 100,
        uKeyBlack:    p.get('keyer.black').value / 100,
        uKeySoftness: p.get('keyer.softness').value / 100,
        uKeyActive:   1,
        uAlpha:       p.get('keyer.alpha').value,
        uAlphaInvert: p.get('keyer.alpha_inv').value,
        uExtKey:      p.get('keyer.extkey').value,
        uAlphaEmissive: p.get('keyer.alpha_emissive')?.value ?? 0,
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
    if (!p.get('blend.active').value) {
      /* blended = warped — blend disabled */
    } else if (!p.get('feedback.active').value) {
      /* blended = warped — feedback disabled */
    } else {
      // Apply feedback offset/scale to prev frame before blending
      const fbHor    = p.get('feedback.hor').value   / 100;
      const fbVer    = p.get('feedback.ver').value   / 100;
      const fbScale  = p.get('feedback.scale').value / 50;
      const fbAngle  = p.get('feedback.rotate').value / 100;
      const fbZoom   = p.get('feedback.zoom').value   / 100 + 1; // 0→1x, 100→2x
      const fbEdge   = p.get('feedback.edge').value;
      const fbDecay  = p.get('feedback.decay').value / 100;
      const fbBlur   = p.get('feedback.blur').value  / 100;
      const fbHue    = p.get('feedback.hue').value * Math.PI / 180;
      const fbMirror = p.get('feedback.mirror').value;
      let prevTex = this.prev.texture;
      // Both transform passes write to the dedicated feedback targets via
      // _passTo, never to the ping-pong pool — see _fbRT above. They alternate
      // between the two so the second pass never reads the target it writes.
      let fbSlot = 0;
      const fbTarget = () => {
        if (!this._fbRT) {
          this._fbRT = [
            this._makeTarget(this.width, this.height),
            this._makeTarget(this.width, this.height),
          ];
        }
        return this._fbRT[fbSlot++ & 1];
      };
      // Apply rotate/zoom first (about the chosen centre), then mirror/offset/
      // scale, then the colour work. Centre is read here but only matters when
      // one of angle/zoom is live, which is why it is not part of the gate.
      if (fbAngle !== 0 || fbZoom !== 1) {
        this.m.feedbackRotate.uniforms.uCenter.value.set(
          p.get('feedback.centerx').value / 100,
          p.get('feedback.centery').value / 100,
        );
        prevTex = this._passTo(this.m.feedbackRotate, {
          uTexture: prevTex,
          uAngle:   fbAngle,
          uZoom:    fbZoom,
          uEdge:    fbEdge,
        }, fbTarget());
      }
      // Decay, blur, hue and mirror live in this pass too, so the gate has to
      // ask about them as well — otherwise setting decay alone would skip the
      // only pass that applies it and do nothing at all. (Edge is NOT in the
      // gate: with no transform there is nothing sampling outside the frame.)
      if (fbHor !== 0 || fbVer !== 0 || fbScale !== 0 ||
          fbDecay !== 1 || fbBlur > 0 || fbHue !== 0 || fbMirror !== 0) {
        prevTex = this._passTo(this.m.feedback, {
          uOutput:    prevTex,
          uHorOffset: fbHor,
          uVerOffset: fbVer,
          uScale:     fbScale,
          uDecay:     fbDecay,
          uBlur:      fbBlur,
          uHue:       fbHue,
          uMirror:    fbMirror,
          uEdge:      fbEdge,
        }, fbTarget());
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

    // ── Custom GLSL pass (Master target only — inserts handled above) ─────
    const customOut = glslTarget === 0 ? this._applyCustomPass(faded) : faded;

    // Final blit — optionally through bicubic interpolation
    const interpMode = p.get('output.interp').value;
    if (interpMode > 0) {
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
  /**
   * Run the custom GLSL material over a texture as an insert pass.
   * Returns the input unchanged when the custom shader is inactive or
   * the texture is missing. uParam1..4 arrive via setCustomUniforms().
   */
  _applyCustomPass(tex) {
    if (!this._customActive || !this._customMat || !tex) return tex;
    const u = this._customMat.uniforms;
    u.uTexture.value = tex;
    u.uTime.value = this._noiseTime;
    u.uResolution.value.set(this.width, this.height);
    // VJ contract — tPrev is always the previous final output frame;
    // audio values fall back to black/0 when sound is off (guards keep
    // pre-contract materials from older sessions working)
    if (u.tPrev)  u.tPrev.value  = this.prev.texture;
    if (u.tAudio) u.tAudio.value = this._vj?.audio ?? this._vjBlackTex;
    if (u.uBPM)   u.uBPM.value   = this._vj?.bpm   ?? 0;
    if (u.uBeat)  u.uBeat.value  = this._vj?.beat  ?? 0;
    if (u.uLevel) u.uLevel.value = this._vj?.level ?? 0;
    if (u.uBass)  u.uBass.value  = this._vj?.bass  ?? 0;
    if (u.uMid)   u.uMid.value   = this._vj?.mid   ?? 0;
    if (u.uHigh)  u.uHigh.value  = this._vj?.high  ?? 0;
    return this._pass(this._customMat, {});
  }

  /** Per-frame VJ data for the custom shader: { audio, bpm, beat, level, bass, mid, high } */
  setCustomVJ(vj) {
    this._vj = vj;
  }

  setCustomUniforms(vals) {
    if (!this._customMat) return;
    for (let i = 0; i < 4; i++) {
      const key = `uParam${i + 1}`;
      if (this._customMat.uniforms[key] !== undefined) {
        this._customMat.uniforms[key].value = vals[i] ?? 0;
      }
    }
  }

  /**
   * Deterministic standalone fragment compile check — returns the GLSL
   * info log string on failure, null when the source compiles. Does not
   * touch the active custom material. (The renderer.compile/link-status
   * introspection in setCustomShader is unreliable — three r160 stores
   * WebGLShader objects, not source strings, in renderer.info.programs.)
   */
  validateShaderSource(fragmentSrc) {
    const gl = this.renderer.getContext();
    const test = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(test, 'precision highp float;\n' + fragmentSrc);
    gl.compileShader(test);
    const compiled = gl.getShaderParameter(test, gl.COMPILE_STATUS);
    const log = compiled ? null
      : (gl.getShaderInfoLog(test) || 'Shader compile failed');
    gl.deleteShader(test);
    return log;
  }

  setCustomShader(fragmentSrc) {
    const preErr = this.validateShaderSource(fragmentSrc);
    if (preErr) {
      this._customError = preErr;
      return this._customError;
    }

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
        // VJ uniform contract — fed per-frame in _applyCustomPass()
        tAudio:      { value: this._vjBlackTex },
        tPrev:       { value: null },
        uBPM:        { value: 0 },
        uBeat:       { value: 0 },
        uLevel:      { value: 0 },
        uBass:       { value: 0 },
        uMid:        { value: 0 },
        uHigh:       { value: 0 },
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
      // Last-good fallback: keep the previous shader running on compile
      // failure — report the error but leave _customActive/_customMat as-is.
      if (this._customMat) this._quad.material = this._customMat;
      this._customError = e.message;
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
    m.uniforms.uPhase.value      = p.phase;
    m.uniforms.uType.value       = p.type;
    m.uniforms.uScale.value      = p.scale;
    m.uniforms.uOctaves.value    = p.octaves;
    m.uniforms.uLacunarity.value = p.lacunarity;
    m.uniforms.uGain.value       = p.gain;
    m.uniforms.uSwirl.value      = p.swirl ?? 0;
    m.uniforms.uRidge.value      = p.ridge ?? 0;
    m.uniforms.uSpeed.value      = p.speed;
    m.uniforms.uOffsetX.value    = p.offsetX;
    m.uniforms.uOffsetY.value    = p.offsetY;
    m.uniforms.uContrast.value   = p.contrast;
    m.uniforms.uInvert.value     = p.invert;
    m.uniforms.uSeed.value       = p.seed;
    m.uniforms.uColor.value      = p.color;
    if (m.uniforms.uColor1) m.uniforms.uColor1.value = p.color1 ?? new THREE.Vector3(1,1,1);
    if (m.uniforms.uColor2) m.uniforms.uColor2.value = p.color2 ?? new THREE.Vector3(0,0,0);
    if (m.uniforms.uPeriodX) m.uniforms.uPeriodX.value = p.periodX ?? 0;
    if (m.uniforms.uPeriodY) m.uniforms.uPeriodY.value = p.periodY ?? 0;
    if (m.uniforms.uAlpha)   m.uniforms.uAlpha.value   = p.alpha   ?? 0;
    this._quad.material = m;
    this.renderer.setRenderTarget(this._noiseTarget);
    this.renderer.render(this._scene, this._camera);

    const sharpenAmt = (p.sharpen ?? 0) / 100;
    if (sharpenAmt <= 0) return this._noiseTarget.texture;
    return this._passTo(this.m.noiseSharpen, {
      uTexture: this._noiseTarget.texture,
      uAmount:  sharpenAmt * 8.0,
    }, this._noiseSharpTarget);
  }

  // ── Resize ────────────────────────────────────────────────────────────────

  resize(w, h) {
    this.width = w; this.height = h;
    this.targets.forEach(t => t.setSize(w, h));
    this.prev.setSize(w, h);
    const hw = Math.ceil(w / 2);
    const hh = Math.ceil(h / 2);
    this._bloomTargetH.setSize(hw, hh);
    this._bloomTargetV.setSize(hw, hh);
    this._mixRT.forEach(rt => rt && rt.forEach(t => t.setSize(w, h)));
    this._fbRT?.forEach(t => t.setSize(w, h));
    if (w !== this._lastResW || h !== this._lastResH) {
      this.m.pixelate.uniforms.uResolution.value.set(w, h);
      this.m.edge.uniforms.uResolution.value.set(w, h);
      this.m.bloomBlurH.uniforms.uResolution.value.set(w, h);
      this.m.bloomBlurV.uniforms.uResolution.value.set(w, h);
      this.m.pixelsort.uniforms.uResolution.value.set(w, h);
      this.m.feedback.uniforms.uResolution.value.set(w, h);
      this.m.interp.uniforms.uResolution.value.set(w, h);
      this._lastResW = w;
      this._lastResH = h;
    }
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
    for (const key in uniforms) {
      if (material.uniforms[key] !== undefined) {
        let val = uniforms[key];
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
    }

    // Ping-pong
    const target = this.targets[this._current];
    this._current ^= 1;

    this._quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this._scene, this._camera);

    return target.texture;
  }

  /**
   * Render to an explicit target without touching ping-pong state.
   * No feedback-loop guard — caller must ensure no read/write conflict.
   * Used by bloom blur passes which render to dedicated half-res targets.
   */
  _passTo(material, uniforms, target) {
    for (const key in uniforms) {
      if (material.uniforms[key] !== undefined) {
        material.uniforms[key].value = uniforms[key];
      }
    }
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

  /** Allocate a mix bus's double buffer on first use. */
  _ensureMixRT(k) {
    if (!this._mixRT[k]) {
      this._mixRT[k] = [
        this._makeTarget(this.width, this.height),
        this._makeTarget(this.width, this.height),
      ];
    }
    return this._mixRT[k];
  }

  /**
   * Latest output texture of mix bus k (0-based). Falls back to the blank
   * texture when the bus has never rendered, so routing to an idle bus is
   * black rather than undefined.
   */
  mixTextureAt(k) {
    const rt = this._mixRT[k];
    return rt ? rt[this._mixCur[k]].texture : this._getFallbackTexture();
  }

  /** Mix bus 1 output — back-compat accessor for main.js. */
  get mixTexture() {
    return this.mixTextureAt(0);
  }

  _resolveSource(inputs, sourceIdx) {
    // Derived from the canonical SOURCE_DEFS list — no hand-copy to drift.
    const key = SOURCE_KEYS[sourceIdx] ?? 'color';

    if (key === 'camera'  && inputs.camera)  return inputs.camera;
    if (key === 'movie'   && inputs.movie)   return inputs.movie;
    if (key === 'movieB'  && inputs.movieB)  return inputs.movieB;
    if (key === 'mixbus')                    return this.mixTextureAt(0);
    if (key === 'mixbus2')                   return this.mixTextureAt(1);
    if (key === 'mixbus3')                   return this.mixTextureAt(2);
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
    if (key === 'tdisp'     && inputs.tdisp)     return inputs.tdisp;
    if (key === 'rutt'      && inputs.rutt)      return inputs.rutt;
    if (key === 'sdfdepth'  && inputs.sdfdepth)  return inputs.sdfdepth;
    if (key === 'rgbdelay'  && inputs.rgbdelay)  return inputs.rgbdelay;
    if (key === 'motion'    && inputs.motion)    return inputs.motion;
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
        uAlphaEmissive: { value: 0 },
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
        uDecay:     { value: 1 },
        uBlur:      { value: 0 },
        uHue:       { value: 0 },
        uMirror:    { value: 0 },
        uEdge:      { value: 0 },
      }),
      transfermode: this._mat(TRANSFERMODE, { uMode: { value: 0 }, uBlendAmount: { value: 1.0 } }),
      mixbus:       this._mat(MIXBUS, {
        uMode:    { value: 0 },
        uXfade:   { value: 0 },
        uDispAmt: { value: 0.1 },
        uMaskLo:  { value: 0.25 },
        uMaskHi:  { value: 0.75 },
      }),
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
        uPhase:      { value: 0 },
        uType:       { value: 1 },   // default: Perlin
        uScale:      { value: 3.0 },
        uOctaves:    { value: 4.0 },
        uLacunarity: { value: 2.0 },
        uGain:       { value: 0.5 },
        uSwirl:      { value: 0.0 },
        uRidge:      { value: 0.0 },
        uSpeed:      { value: 0.2 },
        uOffsetX:    { value: 0.0 },
        uOffsetY:    { value: 0.0 },
        uContrast:   { value: 1.0 },
        uInvert:     { value: 0 },
        uSeed:       { value: 0.0 },
        uColor:      { value: 0 },
        uColor1:     { value: new THREE.Vector3(1, 1, 1) },
        uColor2:     { value: new THREE.Vector3(0, 0, 0) },
        uPeriodX:    { value: 0 },
        uPeriodY:    { value: 0 },
        uAlpha:      { value: 0 },
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
        uFlipH:  { value: 0 }, // layer mirror; both call sites always set it
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
      noiseSharpen: this._mat(SHARPEN, {
        uAmount:     { value: 0 },
        uResolution: { value: new THREE.Vector2(512, 512) },
      }),
      feedbackRotate: this._mat(FEEDBACK_ROTATE, {
        uAngle:  { value: 0 },
        uZoom:   { value: 1 },
        uCenter: { value: new THREE.Vector2(0.5, 0.5) },
        uEdge:   { value: 0 },
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
