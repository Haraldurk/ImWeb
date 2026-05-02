export const ANALOG_CRT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uPrevTex;
  uniform vec2 uResolution;
  uniform float uTime;
  uniform float uScanlines;
  uniform float uBloom;
  uniform float uVignette;
  uniform float uCurvature;
  uniform float uYokeRing;
  uniform float uSVM;
  uniform float uBowl;
  uniform float uRipple;
  uniform float uDecay;
  uniform float uHalation;
  uniform float uBW;
  uniform float uBeamScan;
  uniform float uWaterLens;
  uniform float uPhosphor;
  uniform float uMaskType;
  // RF Interference
  uniform float uGhost1Str;
  uniform float uGhost1Delay;
  uniform float uGhost2Str;
  uniform float uGhost2Delay;
  uniform float uGhost3Str;
  uniform float uGhost3Delay;
  uniform float uFlutter;
  uniform float uImpulse;
  uniform float uRinging;
  uniform float uHum;
  uniform float uCoChannel;
  // Tuner
  uniform float uHHold;
  uniform float uVHold;
  uniform float uHPos;
  uniform float uVPos;
  uniform float uRFTune;
  uniform float uInterlaced;
  uniform float uStandard;
  uniform float uVariant;
  uniform float uHanoverBars;
  uniform float uDelayLineErr;
  uniform float uDecoder;
  uniform float uCrop43;
  // Composite artifacts
  uniform float uDotCrawl;
  uniform float uCrossColor;
  uniform float uChromaBleed;
  uniform float uRainbow;

  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    vec2 uv = vUv;
    vec2 origUv = vUv;
    float r = length(uv - 0.5);

    if (uCurvature > 0.0) {
      vec2 c = uv - 0.5;
      uv += c * dot(c, c) * uCurvature * 0.35;
    }
    if (uBowl > 0.5) {
      uv.x -= (uv.y - 0.5) * (uv.y - 0.5) * 0.1 * (uv.x - 0.5) * 2.0;
    }
    if (uYokeRing > 0.0) {
      vec2 c = uv - 0.5;
      float a = uYokeRing * 0.02 * r;
      float ca = cos(a), sa = sin(a);
      uv = 0.5 + vec2(c.x * ca - c.y * sa, c.x * sa + c.y * ca);
    }
    if (uRipple > 0.0) {
      uv.x += sin(uv.y * 40.0 + uTime * 2.5) * uRipple * 0.004;
    }
    if (uWaterLens > 0.5) {
      uv += sin(uv.y * 14.0 + uTime * 1.5) * cos(uv.x * 18.0 + uTime * 0.8) * 0.007;
    }

    // ── Tuner: H/V position + hold ────────────────────────────────────
    uv.x += (uHPos - 0.5) * 0.06;
    uv.y += (uVPos - 0.5) * 0.06;

    if (uHHold > 0.0) {
      float tear = hash(vec2(floor(vUv.y * uResolution.y * 0.02), uTime * 0.3));
      uv.x += (tear - 0.5) * uHHold * 0.08;
    }
    if (uVHold > 0.0) {
      uv.y = fract(uv.y + uTime * uVHold * 0.15);
    }

    // ── Interlaced (only every other scanline) ────────────────────────
    if (uInterlaced > 0.5) {
      if (mod(gl_FragCoord.y, 2.0) < 1.0) {
        gl_FragColor = vec4(0.0);
        return;
      }
    }

    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
      gl_FragColor = vec4(0.0);
      return;
    }

    vec4 col = texture2D(uTexture, uv);

    if (uBW > 0.5) {
      col.rgb = vec3(luma(col.rgb));
    }

    if (uSVM > 0.0) {
      vec2 tp = 1.0 / uResolution;
      float L  = luma(col.rgb);
      float Ll = luma(texture2D(uTexture, uv + vec2(-tp.x, 0.0)).rgb);
      float Lr = luma(texture2D(uTexture, uv + vec2( tp.x, 0.0)).rgb);
      float edge = abs(Lr - Ll);
      col.rgb *= 1.0 + smoothstep(0.002, 0.1, edge) * uSVM * 1.5;
    }

    if (uBloom > 0.0) {
      float bright = max(0.0, luma(col.rgb) - 0.3);
      col.rgb += bright * uBloom * 0.8;
    }

    if (uMaskType > 0.5) {
      vec2 fc = vUv * uResolution;
      if (uMaskType < 1.5) {
        float s = mod(fc.x, 3.0);
        col.rgb *= 0.85 + 0.15 * smoothstep(0.3, 0.7, s);
      } else {
        vec2 t = mod(fc, 3.0) - 1.5;
        col.rgb *= 0.80 + 0.20 * smoothstep(1.0, 1.5, length(t));
      }
    }

    if (uScanlines > 0.0) {
      float s = 1.0 - uScanlines * mod(gl_FragCoord.y, 2.0);

      vec3 pt;
      if (uPhosphor < 0.5) pt = vec3(0.86, 0.89, 0.82);
      else if (uPhosphor < 1.5) pt = vec3(0.76, 0.90, 0.72);
      else if (uPhosphor < 2.5) pt = vec3(0.95, 0.92, 0.70);
      else if (uPhosphor < 3.5) pt = vec3(0.80, 0.80, 0.95);
      else if (uPhosphor < 4.5) pt = vec3(0.95, 0.70, 0.60);
      else if (uPhosphor < 5.5) pt = vec3(0.70, 0.88, 0.78);
      else if (uPhosphor < 6.5) pt = vec3(0.65, 0.70, 0.95);
      else pt = vec3(0.90, 0.85, 0.60);

      col.rgb *= s * pt;
    }

    if (uBeamScan > 0.5) {
      col.rgb += exp(-abs(vUv.y - fract(uTime * 0.3)) * 30.0) * 0.12;
    }

    // ── Tuner: color processing ───────────────────────────────────────

    // RF Tune — sharpness / blur
    if (uRFTune < 0.45) {
      float blur = (0.5 - uRFTune) * 4.0;
      vec2 bp = blur / uResolution;
      col.rgb = (col.rgb + texture2D(uTexture, uv + vec2(-bp.x, 0.0)).rgb + texture2D(uTexture, uv + vec2(bp.x, 0.0)).rgb) / 3.0;
    } else if (uRFTune > 0.55) {
      float sharpen = (uRFTune - 0.5) * 2.0;
      vec2 sp = 1.0 / uResolution;
      col.rgb += (col.rgb - texture2D(uTexture, uv + vec2(-sp.x, 0.0)).rgb * 0.5 - texture2D(uTexture, uv + vec2(sp.x, 0.0)).rgb * 0.5) * sharpen;
    }

    // Hanover bars — PAL chroma phase error (alternating lines tint shift)
    if (uHanoverBars > 0.5) {
      float line = mod(gl_FragCoord.y, 2.0);
      col.r += line * 0.06;
      col.b -= line * 0.06;
    }

    // Delay line error — PAL comb filter chroma smearing
    if (uDelayLineErr > 0.0) {
      vec2 dp = uDelayLineErr * 0.15 / uResolution;
      float cb = texture2D(uTexture, uv + vec2(-dp.x, 0.0)).b;
      float cr = texture2D(uTexture, uv + vec2( dp.x, 0.0)).r;
      col.rg = mix(col.rg, vec2(cr, col.g + cb - col.b), uDelayLineErr);
    }

    // Decoder — color decode mode
    if (uDecoder > 0.5) {
      if (uDecoder < 1.5) {
        // Simple decoder — reduced chroma resolution
        float cb = texture2D(uTexture, uv + vec2(-0.002, 0.0)).b;
        col.gb = mix(col.gb, vec2(col.g, cb), 0.5);
      } else {
        // Comb filter — slight horizontal chroma blur
        vec2 cp = 2.0 / uResolution;
        float cb2 = texture2D(uTexture, uv + vec2(-cp.x, 0.0)).b;
        float cr2 = texture2D(uTexture, uv + vec2( cp.x, 0.0)).r;
        col.r = (col.r + cr2) * 0.5;
        col.b = (col.b + cb2) * 0.5;
      }
    }

    // Standard — broadcast color matrix
    if (uStandard < 0.5) {
      // B&W
      col.rgb = vec3(luma(col.rgb));
    } else if (uStandard < 1.5) {
      // NTSC — slight red push
      col.r *= 1.02;
      col.b *= 0.98;
    } else if (uStandard < 2.5) {
      // PAL — slight green push
      col.g *= 1.02;
      col.r *= 0.99;
    } else if (uStandard < 3.5) {
      // SECAM — slight blue push + reduced chroma
      col.b *= 1.03;
      col.g *= 0.99;
      col.rg *= 0.95;
    }
    // MAC/HD: no tint adjustment

    // Variant refinements — apply to all standards
    if (uVariant > 0.5) {
      if (uVariant < 1.5) {
        // PAL-M / NTSC-J — 525-line, slight desaturation
        col.rgb = mix(col.rgb, vec3(luma(col.rgb)), 0.08);
      } else if (uVariant < 2.5) {
        // PAL-N — narrower bandwidth, dimmer
        col.rgb *= 0.92;
        col.rgb = mix(col.rgb, vec3(luma(col.rgb)), 0.05);
      } else if (uVariant < 3.5) {
        // PAL-60 — 60Hz, slight green tint
        col.g *= 1.04;
        col.rg = mix(col.rg, vec2(luma(col.rgb)), 0.06);
      } else if (uVariant < 4.5) {
        // NTSC-J — raised black level
        col.rgb += 0.03;
      } else if (uVariant < 5.5) {
        // NTSC-4.43 — PAL subcarrier, chroma shift
        col.r *= 1.03;
        col.b *= 0.95;
      }
    }

    // ── Composite Artifacts ───────────────────────────────────────────
    if (uDotCrawl > 0.0 || uCrossColor > 0.0 || uChromaBleed > 0.0 || uRainbow > 0.0) {
      vec2 px = 1.0 / uResolution;
      float y = luma(col.rgb);

      // NTSC subcarrier ~0.25 cycles/pixel at 720 res (~180 cycles/line)
      float subPhase = vUv.x * uResolution.x * 0.785 + uTime * 12.0;

      if (uDotCrawl > 0.0) {
        float crawl = sin(subPhase) * uDotCrawl * 0.15;
        col.rgb += crawl * sign(col.rgb - y);
      }

      if (uCrossColor > 0.0) {
        float hf = y - luma(texture2D(uTexture, uv + vec2(px.x * 2.0, 0.0)).rgb);
        float cross = hf * cos(subPhase * 1.1) * uCrossColor * 0.60;
        col.r += cross;
        col.b -= cross;
      }

      if (uChromaBleed > 0.0) {
        float bx = uChromaBleed * 6.0 / uResolution.x;
        col.r = mix(col.r, texture2D(uTexture, uv + vec2( bx, 0.0)).r, uChromaBleed * 0.7);
        col.b = mix(col.b, texture2D(uTexture, uv + vec2(-bx, 0.0)).b, uChromaBleed * 0.7);
      }

      if (uRainbow > 0.0) {
        float moire = sin(vUv.y * uResolution.y * 0.15 + uTime * 3.0 + vUv.x * 80.0) * 0.5 + 0.5;
        float detail = abs(luma(col.rgb) - luma(texture2D(uTexture, uv + vec2(px.x, 0.0)).rgb));
        col.rgb += moire * detail * uRainbow * 0.55 * vec3(1.0, -0.5, -0.5);
      }
    }

    float dk = clamp(uDecay, 0.0, 0.95);
    if (dk > 0.0) {
      vec4 prev = texture2D(uPrevTex, vUv);
      col = mix(col, prev, dk);
    }

    if (uHalation > 0.0) {
      float hl = luma(col.rgb);
      col.rgb += smoothstep(0.5, 1.0, hl) * uHalation * 0.5 * exp(-r * 3.0);
    }

    if (uVignette > 0.0) {
      vec2 d = abs(vUv - 0.5) * 2.0;
      float v = dot(d * d, vec2(0.5));
      col.rgb *= 1.0 - uVignette * 1.2 * v;
    }

    // ── RF Interference ───────────────────────────────────────────────

    // Ghost (delayed prev-frame reflections — up to 3 ghosts)
    vec2 px = 1.0 / uResolution;
    if (uGhost1Str > 0.0) {
      vec4 g1 = texture2D(uPrevTex, vUv - vec2(uGhost1Delay * px.x * 4.0, 0.0));
      col.rgb = mix(col.rgb, g1.rgb, uGhost1Str * 0.5);
    }
    if (uGhost2Str > 0.0) {
      vec4 g2 = texture2D(uPrevTex, vUv - vec2(uGhost2Delay * px.x * 4.0, 0.0));
      col.rgb = mix(col.rgb, g2.rgb, uGhost2Str * 0.4);
    }
    if (uGhost3Str > 0.0) {
      vec4 g3 = texture2D(uPrevTex, vUv - vec2(uGhost3Delay * px.x * 4.0, 0.0));
      col.rgb = mix(col.rgb, g3.rgb, uGhost3Str * 0.3);
    }

    // Flutter — horizontal jitter
    if (uFlutter > 0.0) {
      float jit = (hash(vec2(uTime * 0.7, vUv.y * 97.0)) - 0.5) * uFlutter * 0.03;
      vec4 flut = texture2D(uTexture, clamp(uv + vec2(jit, 0.0), 0.0, 1.0));
      col.rgb = mix(col.rgb, flut.rgb, uFlutter * 0.6);
    }

    // Impulse noise — random white/black specks
    if (uImpulse > 0.0) {
      float rnd = hash(vUv * uResolution + uTime * 123.4);
      if (rnd < uImpulse * 0.008) {
        col.rgb = vec3(step(0.5, hash(vec2(rnd, uTime))));
      }
    }

    // Ringing — high-frequency edge oscillation
    if (uRinging > 0.0 && uSVM < 0.01) {
      vec2 rp = 1.0 / uResolution * 2.0;
      float Lc = luma(col.rgb);
      float Ll = luma(texture2D(uTexture, uv + vec2(-rp.x, 0.0)).rgb);
      float Lr = luma(texture2D(uTexture, uv + vec2( rp.x, 0.0)).rgb);
      float ring = abs(Lr - Ll) * sin(r * 60.0 + uTime * 4.0) * uRinging * 0.2;
      col.rgb += ring;
    }

    // Hum — horizontal luminance bar
    if (uHum > 0.0) {
      float bar = sin(vUv.y * uResolution.y * 0.15 + uTime * 0.5) * 0.5 + 0.5;
      col.rgb *= 1.0 - uHum * 0.12 * bar;
    }

    // Co-Channel — diagonal interference
    if (uCoChannel > 0.0) {
      float diag = sin((vUv.x + vUv.y * 0.6) * uResolution.x * 0.4) * 0.5 + 0.5;
      col.rgb += uCoChannel * 0.04 * diag;
    }

    if (uCrop43 > 0.5) {
      float aspect = uResolution.x / uResolution.y;
      float target = 4.0 / 3.0;
      if (aspect > target) {
        float w = target / aspect;
        float left = (1.0 - w) * 0.5;
        if (origUv.x < left || origUv.x > 1.0 - left) {
          gl_FragColor = vec4(0.0);
          return;
        }
      } else {
        float h = aspect / target;
        float top = (1.0 - h) * 0.5;
        if (origUv.y < top || origUv.y > 1.0 - top) {
          gl_FragColor = vec4(0.0);
          return;
        }
      }
    }

    gl_FragColor = vec4(clamp(col.rgb, vec3(0.0), vec3(1.0)), 1.0);
  }
`;
