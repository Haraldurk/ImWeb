/**
 * ImWeb Shaders
 * All effects shaders as GLSL strings.
 * WebGPU / WGSL equivalents are annotated with // WGSL: comments.
 * These run as Three.js ShaderMaterial fragment shaders on a full-screen quad.
 */

// ── Shared vertex shader (used by all passes) ─────────────────────────────────

export const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

// ── Passthrough ───────────────────────────────────────────────────────────────

export const PASSTHROUGH = /* glsl */ `
  uniform sampler2D uTexture;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

// ── Luminance keyer ───────────────────────────────────────────────────────────

export const KEYER = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uBG;
  uniform sampler2D uEK;       // external key source (DS texture when extkey=1)
  uniform float uKeyWhite;
  uniform float uKeyBlack;
  uniform float uKeySoftness;
  uniform int   uKeyActive;
  uniform int   uAlpha;
  uniform int   uAlphaInvert;
  uniform int   uExtKey;       // 1 = key on uEK luminance instead of uFG

  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec4 fg = texture2D(uFG, vUv);
    vec4 bg = texture2D(uBG, vUv);

    if (uKeyActive == 0) {
      gl_FragColor = fg;
      return;
    }

    float alpha;

    if (uAlpha == 1) {
      alpha = uAlphaInvert == 1 ? (1.0 - fg.a) : fg.a;
    } else {
      vec4 keySrc   = uExtKey == 1 ? texture2D(uEK, vUv) : fg;
      float lumaVal = luma(keySrc.rgb);
      float soft    = max(uKeySoftness, 0.001);
      // Pass band between black and white thresholds; soft edges on both
      float lo = smoothstep(uKeyBlack - soft, uKeyBlack + soft, lumaVal);
      float hi = 1.0 - smoothstep(uKeyWhite - soft, uKeyWhite + soft, lumaVal);
      alpha = lo * hi;
    }

    gl_FragColor = mix(bg, fg, alpha);
  }
`;

// ── Displacement ──────────────────────────────────────────────────────────────

export const DISPLACE = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uDS;
  uniform float uAmount;
  uniform float uAngle;
  uniform float uOffset;
  uniform int   uRotateGrey;

  varying vec2 vUv;

  void main() {
    if (uAmount == 0.0) {
      gl_FragColor = texture2D(uFG, vUv);
      return;
    }

    vec4 ds = texture2D(uDS, vUv);
    float lumaVal = dot(ds.rgb, vec3(0.2126, 0.7152, 0.0722));
    float strength = (lumaVal + uOffset - 0.5) * uAmount * 0.1;

    vec2 offset;
    if (uRotateGrey == 1) {
      float theta = (lumaVal - 0.5) * 2.0 * 3.14159265;
      offset = vec2(cos(theta), sin(theta)) * uAmount * 0.05;
    } else {
      vec2 dir = vec2(cos(uAngle), sin(uAngle));
      offset = dir * strength;
    }

    gl_FragColor = texture2D(uFG, clamp(vUv + offset, 0.0, 1.0));
  }
`;

// ── Blend ─────────────────────────────────────────────────────────────────────

export const BLEND = /* glsl */ `
  uniform sampler2D uCurrent;
  uniform sampler2D uPrev;
  uniform int       uActive;
  uniform float     uAmount;

  varying vec2 vUv;

  void main() {
    vec4 curr = texture2D(uCurrent, vUv);
    if (uActive == 0) { gl_FragColor = curr; return; }
    vec4 prev = texture2D(uPrev, vUv);
    gl_FragColor = mix(curr, prev, uAmount);
  }
`;

// ── Feedback ──────────────────────────────────────────────────────────────────

export const FEEDBACK = /* glsl */ `
  uniform sampler2D uOutput;
  uniform float uHorOffset;
  uniform float uVerOffset;
  uniform float uScale;
  uniform vec2  uResolution;

  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    if (uScale != 0.0) {
      vec2 center = vec2(0.5);
      float s = 1.0 + uScale * 0.1;
      uv = (uv - center) / s + center;
    }
    uv.x += uHorOffset * 0.1;
    uv.y += uVerOffset * 0.1;
    gl_FragColor = texture2D(uOutput, clamp(uv, 0.0, 1.0));
  }
`;

// ── Transfer modes ────────────────────────────────────────────────────────────

export const TRANSFERMODE = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uBG;
  uniform int       uMode;

  varying vec2 vUv;

  // ── bitwise helpers ──────────────────────────────────────────────────────────
  ivec3 floatToInt8(vec3 c) { return ivec3(clamp(c * 255.0, 0.0, 255.0)); }
  vec3 int8ToFloat(ivec3 i)  { return vec3(i) / 255.0; }

  // ── photographic blend helpers ───────────────────────────────────────────────
  vec3 blendMultiply(vec3 a, vec3 b)   { return a * b; }
  vec3 blendScreen(vec3 a, vec3 b)     { return 1.0 - (1.0 - a) * (1.0 - b); }
  vec3 blendAdd(vec3 a, vec3 b)        { return min(a + b, 1.0); }
  vec3 blendDiff(vec3 a, vec3 b)       { return abs(a - b); }
  vec3 blendExclude(vec3 a, vec3 b)    { return a + b - 2.0 * a * b; }
  vec3 blendDodge(vec3 a, vec3 b)      { return min(a / max(1.0 - b, 0.001), 1.0); }
  vec3 blendBurn(vec3 a, vec3 b)       { return 1.0 - min((1.0 - a) / max(b, 0.001), 1.0); }

  float overlayF(float a, float b) {
    return b < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
  }
  vec3 blendOverlay(vec3 a, vec3 b) {
    return vec3(overlayF(a.r,b.r), overlayF(a.g,b.g), overlayF(a.b,b.b));
  }

  float hardlightF(float a, float b) {
    return b < 0.5 ? 2.0 * a * b : 1.0 - 2.0 * (1.0 - a) * (1.0 - b);
  }
  vec3 blendHardlight(vec3 a, vec3 b) {
    // hardlight = overlay with layers swapped
    return vec3(hardlightF(b.r,a.r), hardlightF(b.g,a.g), hardlightF(b.b,a.b));
  }

  float softlightF(float a, float b) {
    if (b < 0.5) return a - (1.0 - 2.0*b) * a * (1.0 - a);
    float d = a < 0.25 ? ((16.0*a - 12.0)*a + 4.0)*a : sqrt(a);
    return a + (2.0*b - 1.0) * (d - a);
  }
  vec3 blendSoftlight(vec3 a, vec3 b) {
    return vec3(softlightF(a.r,b.r), softlightF(a.g,b.g), softlightF(a.b,b.b));
  }

  // ── HSL helpers (for hue/sat/luma blend modes) ───────────────────────────────
  vec3 rgb2hsl(vec3 c) {
    float cmax = max(c.r, max(c.g, c.b));
    float cmin = min(c.r, min(c.g, c.b));
    float d = cmax - cmin;
    float l = (cmax + cmin) * 0.5;
    float s = d < 0.0001 ? 0.0 : d / (1.0 - abs(2.0*l - 1.0));
    float h = 0.0;
    if (d > 0.0001) {
      if      (cmax == c.r) h = mod((c.g - c.b) / d, 6.0) / 6.0;
      else if (cmax == c.g) h = ((c.b - c.r) / d + 2.0) / 6.0;
      else                  h = ((c.r - c.g) / d + 4.0) / 6.0;
    }
    return vec3(h, s, l);
  }

  vec3 hsl2rgb(vec3 hsl) {
    float h = hsl.x, s = hsl.y, l = hsl.z;
    float c = (1.0 - abs(2.0*l - 1.0)) * s;
    float x = c * (1.0 - abs(mod(h * 6.0, 2.0) - 1.0));
    float m = l - c * 0.5;
    vec3 rgb;
    int hi = int(h * 6.0);
    if      (hi == 0) rgb = vec3(c, x, 0);
    else if (hi == 1) rgb = vec3(x, c, 0);
    else if (hi == 2) rgb = vec3(0, c, x);
    else if (hi == 3) rgb = vec3(0, x, c);
    else if (hi == 4) rgb = vec3(x, 0, c);
    else              rgb = vec3(c, 0, x);
    return rgb + m;
  }

  // ── HSY (hue/sat from FG, luma from BG or vice-versa) ───────────────────────
  vec3 blendHue(vec3 a, vec3 b) {          // FG hue, BG sat+luma
    vec3 ha = rgb2hsl(a);
    vec3 hb = rgb2hsl(b);
    return hsl2rgb(vec3(ha.x, hb.y, hb.z));
  }
  vec3 blendSaturation(vec3 a, vec3 b) {   // FG sat, BG hue+luma
    vec3 ha = rgb2hsl(a);
    vec3 hb = rgb2hsl(b);
    return hsl2rgb(vec3(hb.x, ha.y, hb.z));
  }
  vec3 blendColor(vec3 a, vec3 b) {        // FG hue+sat, BG luma
    vec3 ha = rgb2hsl(a);
    vec3 hb = rgb2hsl(b);
    return hsl2rgb(vec3(ha.x, ha.y, hb.z));
  }
  vec3 blendLuminosity(vec3 a, vec3 b) {   // FG luma, BG hue+sat
    vec3 ha = rgb2hsl(a);
    vec3 hb = rgb2hsl(b);
    return hsl2rgb(vec3(hb.x, hb.y, ha.z));
  }
  vec3 blendSubtract(vec3 a, vec3 b)    { return max(a - b, 0.0); }
  vec3 blendDivide(vec3 a, vec3 b)      { return min(a / max(b, 0.001), 1.0); }
  vec3 blendPinLight(vec3 a, vec3 b) {
    return vec3(
      b.r < 0.5 ? min(a.r, 2.0*b.r) : max(a.r, 2.0*b.r - 1.0),
      b.g < 0.5 ? min(a.g, 2.0*b.g) : max(a.g, 2.0*b.g - 1.0),
      b.b < 0.5 ? min(a.b, 2.0*b.b) : max(a.b, 2.0*b.b - 1.0)
    );
  }
  vec3 blendVividLight(vec3 a, vec3 b) {
    return vec3(
      b.r < 0.5 ? 1.0 - min((1.0-a.r)/max(2.0*b.r,0.001),1.0) : min(a.r/max(2.0*(1.0-b.r),0.001),1.0),
      b.g < 0.5 ? 1.0 - min((1.0-a.g)/max(2.0*b.g,0.001),1.0) : min(a.g/max(2.0*(1.0-b.g),0.001),1.0),
      b.b < 0.5 ? 1.0 - min((1.0-a.b)/max(2.0*b.b,0.001),1.0) : min(a.b/max(2.0*(1.0-b.b),0.001),1.0)
    );
  }

  void main() {
    vec4 fg = texture2D(uFG, vUv);
    vec4 bg = texture2D(uBG, vUv);
    vec3 a = fg.rgb;
    vec3 b = bg.rgb;
    vec3 r;

    // modes 0-3: bitwise
    if (uMode < 4) {
      if (uMode == 0) { gl_FragColor = fg; return; }
      ivec3 ia = floatToInt8(a);
      ivec3 ib = floatToInt8(b);
      ivec3 ir;
      if      (uMode == 1) ir = ia ^ ib;
      else if (uMode == 2) ir = ia | ib;
      else                 ir = ia & ib;
      gl_FragColor = vec4(int8ToFloat(ir), fg.a);
      return;
    }

    // modes 4+: photographic
    if      (uMode ==  4) r = blendMultiply(a, b);
    else if (uMode ==  5) r = blendScreen(a, b);
    else if (uMode ==  6) r = blendAdd(a, b);
    else if (uMode ==  7) r = blendDiff(a, b);
    else if (uMode ==  8) r = blendExclude(a, b);
    else if (uMode ==  9) r = blendOverlay(a, b);
    else if (uMode == 10) r = blendHardlight(a, b);
    else if (uMode == 11) r = blendSoftlight(a, b);
    else if (uMode == 12) r = blendDodge(a, b);
    else if (uMode == 13) r = blendBurn(a, b);
    else if (uMode == 14) r = blendSubtract(a, b);
    else if (uMode == 15) r = blendDivide(a, b);
    else if (uMode == 16) r = blendPinLight(a, b);
    else if (uMode == 17) r = blendVividLight(a, b);
    else if (uMode == 18) r = blendHue(a, b);
    else if (uMode == 19) r = blendSaturation(a, b);
    else if (uMode == 20) r = blendColor(a, b);
    else if (uMode == 21) r = blendLuminosity(a, b);
    else r = a;

    gl_FragColor = vec4(clamp(r, 0.0, 1.0), fg.a);
  }
`;

// ── Color Shift ───────────────────────────────────────────────────────────────

export const COLORSHIFT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uShift;

  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 color = texture2D(uTexture, vUv);
    if (uShift == 0.0) { gl_FragColor = color; return; }
    vec3 hsv = rgb2hsv(color.rgb);
    hsv.x = fract(hsv.x + uShift);
    gl_FragColor = vec4(hsv2rgb(hsv), color.a);
  }
`;

// ── Noise ─────────────────────────────────────────────────────────────────────

export const NOISE_GEN = /* glsl */ `
  uniform float uTime;
  uniform int   uType;
  uniform float uScale;  // grain size: 1=pixel, >1=coarser
  uniform int   uColor;  // 0=mono, 1=colour
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }
  float hash3(vec2 p, float seed) {
    return fract(sin(dot(p + seed, vec2(127.1, 311.7))) * 43758.5453);
  }

  // Smooth value noise (bilinear interpolation of hash grid)
  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i + vec2(0,0)), hash(i + vec2(1,0)), u.x),
               mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x), u.y);
  }

  // Box-Muller: uniform → gaussian approximation
  float gaussian(vec2 uv, float seed) {
    float u1 = hash(uv + seed);
    float u2 = hash(uv + seed + 0.5);
    u1 = clamp(u1, 0.0001, 0.9999);
    float g = sqrt(-2.0 * log(u1)) * cos(6.28318 * u2);
    return clamp(g * 0.2 + 0.5, 0.0, 1.0);
  }

  void main() {
    float frame = floor(uTime * 60.0);
    vec2 seed   = vec2(frame * 0.001, frame * 0.0007);
    // Apply grain scale: coarser scale by flooring UV
    vec2 scaledUv = floor(vUv * 1024.0 / uScale) / (1024.0 / uScale);

    float n;
    if (uType == 0) {
      // White noise (all frequencies, pixel-grain)
      n = hash(scaledUv + seed);

    } else if (uType == 1) {
      // Smooth / value noise (low-frequency blobs)
      n = valueNoise(scaledUv * (8.0 / uScale) + seed * 37.0);

    } else if (uType == 2) {
      // Pink-ish: sum 4 octaves of value noise (1/f approximation)
      float amp = 0.5, freq = 1.0, acc = 0.0, tot = 0.0;
      for (int i = 0; i < 4; i++) {
        acc += valueNoise(scaledUv * freq * (4.0 / uScale) + seed * (3.7 + float(i))) * amp;
        tot += amp; amp *= 0.5; freq *= 2.0;
      }
      n = acc / tot;

    } else if (uType == 3) {
      // Brown (integrated): very low freq, warm rumble
      float amp = 0.5, freq = 0.5, acc = 0.0, tot = 0.0;
      for (int i = 0; i < 3; i++) {
        acc += valueNoise(scaledUv * freq * (2.0 / uScale) + seed * (1.3 + float(i))) * amp;
        tot += amp; amp *= 0.7; freq *= 1.5;
      }
      n = acc / tot;

    } else if (uType == 4) {
      // Gaussian (electronic) — normal distribution centred at 0.5
      n = gaussian(scaledUv, frame * 0.0013);

    } else if (uType == 5) {
      // Salt & Pepper — sparse impulse noise
      float r = hash(scaledUv + seed);
      n = (r < 0.04) ? 1.0 : (r < 0.08) ? 0.0 : 0.5;

    } else if (uType == 6) {
      // Speckle (multiplicative) — mid-grey with random fluctuation
      float base = 0.5;
      float speckle = hash(scaledUv + seed) * 2.0 - 1.0;
      n = clamp(base + base * speckle, 0.0, 1.0);

    } else {
      // H-lines
      n = hash(vec2(scaledUv.x, 0.5) + seed);
    }

    vec3 col;
    if (uColor == 1) {
      col = vec3(hash3(scaledUv, 0.0 + frame * 0.001),
                 hash3(scaledUv, 0.3 + frame * 0.001),
                 hash3(scaledUv, 0.7 + frame * 0.001));
      col = mix(vec3(n), col, 0.8);
    } else {
      col = vec3(n);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

// ── Interlace ─────────────────────────────────────────────────────────────────

export const INTERLACE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uResY;
  uniform float uAmount;
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    if (uAmount < 1.0) {
      gl_FragColor = texture2D(uTexture, vUv);
      return;
    }
    float line = floor(vUv.y * uResY);
    float field = mod(floor(uTime * 30.0), 2.0);
    if (mod(line + field, 2.0) < 1.0) {
      gl_FragColor = texture2D(uTexture, vUv);
    } else {
      vec4 above = texture2D(uTexture, vec2(vUv.x, vUv.y + 1.0/uResY));
      vec4 below = texture2D(uTexture, vec2(vUv.x, vUv.y - 1.0/uResY));
      gl_FragColor = (above + below) * 0.5;
    }
  }
`;

// ── Mirror ────────────────────────────────────────────────────────────────────

export const MIRROR = /* glsl */ `
  uniform sampler2D uTexture;
  uniform int uFlipH;
  uniform int uFlipV;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;
    if (uFlipH == 1) uv.x = 1.0 - uv.x;
    if (uFlipV == 1) uv.y = 1.0 - uv.y;
    gl_FragColor = texture2D(uTexture, uv);
  }
`;

// ── Solid color ───────────────────────────────────────────────────────────────

export const SOLID_COLOR = /* glsl */ `
  uniform float uHue;
  uniform float uSat;
  uniform float uVal;
  varying vec2 vUv;

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    gl_FragColor = vec4(hsv2rgb(vec3(uHue, uSat, uVal)), 1.0);
  }
`;

// ── WarpMap ───────────────────────────────────────────────────────────────────

export const WARP = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uWarpMap;
  uniform float uStrength;

  varying vec2 vUv;

  void main() {
    if (uStrength == 0.0) {
      gl_FragColor = texture2D(uFG, vUv);
      return;
    }
    vec4 warp = texture2D(uWarpMap, vUv);
    vec2 displacement = (warp.rg - 0.5) * uStrength * 0.3;
    gl_FragColor = texture2D(uFG, clamp(vUv + displacement, 0.0, 1.0));
  }
`;

// ── Fade ──────────────────────────────────────────────────────────────────────

export const FADE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uTexture, vUv) * uAmount;
  }
`;

// ── Bicubic interpolation blit ────────────────────────────────────────────────
// Mitchell-Netravali cubic filter for smooth upscaling on the final blit.
// uMode: 0=nearest/linear (passthrough), 1=bicubic
// WGSL: equivalent textureSample with custom filter kernel

export const INTERP = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2      uResolution; // output resolution
  uniform int       uMode;       // 0=linear, 1=bicubic
  varying vec2 vUv;

  vec4 cubic(float v) {
    vec4 n  = vec4(1.0, 2.0, 3.0, 4.0) - v;
    vec4 s  = n * n * n;
    float x = s.x;
    float y = s.y - 4.0 * s.x;
    float z = s.z - 4.0 * s.y + 6.0 * s.x;
    float w = 6.0 - x - y - z;
    return vec4(x, y, z, w) * (1.0 / 6.0);
  }

  vec4 textureBicubic(sampler2D tex, vec2 uv, vec2 texSize) {
    uv = uv * texSize - 0.5;
    vec2 fxy = fract(uv);
    uv -= fxy;
    vec4 xcubic = cubic(fxy.x);
    vec4 ycubic = cubic(fxy.y);
    vec4 c = uv.xxyy + vec4(-0.5, 1.5, -0.5, 1.5);
    vec4 s = vec4(xcubic.xz + xcubic.yw, ycubic.xz + ycubic.yw);
    vec4 offset = c + vec4(xcubic.yw, ycubic.yw) / s;
    vec4 sample0 = texture2D(tex, vec2(offset.x, offset.z) / texSize);
    vec4 sample1 = texture2D(tex, vec2(offset.y, offset.z) / texSize);
    vec4 sample2 = texture2D(tex, vec2(offset.x, offset.w) / texSize);
    vec4 sample3 = texture2D(tex, vec2(offset.y, offset.w) / texSize);
    float sx = s.x / (s.x + s.y);
    float sy = s.z / (s.z + s.w);
    return mix(mix(sample3, sample2, sx), mix(sample1, sample0, sx), sy);
  }

  void main() {
    if (uMode == 1) {
      gl_FragColor = textureBicubic(uTexture, vUv, uResolution);
    } else {
      gl_FragColor = texture2D(uTexture, vUv);
    }
  }
`;

// ── Buffer pan / zoom ─────────────────────────────────────────────────────────
// uPanX/uPanY: offset from center in UV units (-0.5..0.5; 0 = centered)
// uScale: zoom factor (1 = identity, 2 = 2× zoom in)
// WGSL: equivalent textureLoad with computed coords

// ── Pixelate / Mosaic ─────────────────────────────────────────────────────────
// uAmount: pixel block size in pixels (1 = no effect, 2–200)
// uResolution: output size in pixels

export const PIXELATE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform vec2  uResolution;
  varying vec2 vUv;
  void main() {
    if (uAmount <= 1.0) { gl_FragColor = texture2D(uTexture, vUv); return; }
    vec2 blockSize = vec2(uAmount) / uResolution;
    vec2 snapped   = floor(vUv / blockSize) * blockSize + blockSize * 0.5;
    gl_FragColor   = texture2D(uTexture, clamp(snapped, 0.0, 1.0));
  }
`;

// ── Edge detection (Sobel) ────────────────────────────────────────────────────
// uAmount: strength 0–1; uInvert: show edges on black (0) or white (1) bg

export const EDGE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform int   uInvert;
  uniform vec2  uResolution;
  varying vec2 vUv;

  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

  void main() {
    if (uAmount == 0.0) { gl_FragColor = texture2D(uTexture, vUv); return; }
    vec2 px = 1.0 / uResolution;
    float tl = luma(texture2D(uTexture, vUv + vec2(-px.x,  px.y)).rgb);
    float t  = luma(texture2D(uTexture, vUv + vec2( 0.0,   px.y)).rgb);
    float tr = luma(texture2D(uTexture, vUv + vec2( px.x,  px.y)).rgb);
    float l  = luma(texture2D(uTexture, vUv + vec2(-px.x,  0.0 )).rgb);
    float r  = luma(texture2D(uTexture, vUv + vec2( px.x,  0.0 )).rgb);
    float bl = luma(texture2D(uTexture, vUv + vec2(-px.x, -px.y)).rgb);
    float b  = luma(texture2D(uTexture, vUv + vec2( 0.0,  -px.y)).rgb);
    float br = luma(texture2D(uTexture, vUv + vec2( px.x, -px.y)).rgb);
    float gx = -tl - 2.0*l - bl + tr + 2.0*r + br;
    float gy = -tl - 2.0*t - tr + bl + 2.0*b + br;
    float edge = clamp(sqrt(gx*gx + gy*gy) * uAmount * 4.0, 0.0, 1.0);
    float v    = uInvert == 1 ? (1.0 - edge) : edge;
    vec4 orig  = texture2D(uTexture, vUv);
    gl_FragColor = mix(orig, vec4(vec3(v), orig.a), uAmount);
  }
`;

// ── RGB Shift (chromatic aberration) ──────────────────────────────────────────
// uAmount: shift in UV units (0–0.05); uAngle: direction in radians

export const RGBSHIFT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;
  uniform float uAngle;
  varying vec2 vUv;
  void main() {
    if (uAmount == 0.0) { gl_FragColor = texture2D(uTexture, vUv); return; }
    vec2 dir = vec2(cos(uAngle), sin(uAngle)) * uAmount;
    float r  = texture2D(uTexture, clamp(vUv + dir,        0.0, 1.0)).r;
    float g  = texture2D(uTexture, vUv).g;
    float b  = texture2D(uTexture, clamp(vUv - dir,        0.0, 1.0)).b;
    float a  = texture2D(uTexture, vUv).a;
    gl_FragColor = vec4(r, g, b, a);
  }
`;

// ── Posterize ─────────────────────────────────────────────────────────────────
// uLevels: number of colour levels per channel (2–16)

export const POSTERIZE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uLevels;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uTexture, vUv);
    if (uLevels >= 255.0) { gl_FragColor = c; return; }
    float lvl = max(uLevels, 2.0);
    gl_FragColor = vec4(floor(c.rgb * lvl) / (lvl - 1.0), c.a);
  }
`;

// ── Solarize ──────────────────────────────────────────────────────────────────
// uThreshold: invert values above this luminance (0–1)

export const SOLARIZE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThreshold;
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec4 c = texture2D(uTexture, vUv);
    float l = luma(c.rgb);
    gl_FragColor = l > uThreshold ? vec4(1.0 - c.rgb, c.a) : c;
  }
`;

export const CHROMA_KEY = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uBG;
  uniform float uKeyHue;       // 0-1 target hue
  uniform float uKeyRange;     // 0-1 half-width of hue range
  uniform float uKeySoftness;  // 0-1 feather
  uniform int   uKeyActive;    // 0 = bypass
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  void main() {
    vec4 fg = texture2D(uFG, vUv);
    vec4 bg = texture2D(uBG, vUv);
    if (uKeyActive == 0) { gl_FragColor = fg; return; }

    vec3 hsv = rgb2hsv(fg.rgb);
    // Hue distance: 0 = exact match, 1 = opposite side of wheel
    float hueDist = abs(fract(hsv.x - uKeyHue + 0.5) - 0.5) * 2.0;
    // Alpha: 1 = keep FG, 0 = show BG (keyed out)
    float alpha = smoothstep(uKeyRange, uKeyRange + max(uKeySoftness, 0.001), hueDist);
    // Desaturated areas are not keyed out
    alpha = max(alpha, 1.0 - clamp(hsv.y * 4.0, 0.0, 1.0));
    gl_FragColor = mix(bg, fg, clamp(alpha, 0.0, 1.0));
  }
`;

export const COLOR_CORRECT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uHue;    // hue shift in turns (-0.5 to 0.5)
  uniform float uSat;    // saturation multiplier (1 = unchanged)
  uniform float uBright; // brightness multiplier (1 = unchanged)
  varying vec2 vUv;

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0/3.0, 2.0/3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    return vec3(abs(q.z + (q.w - q.y) / (6.0*d + 1e-10)), d / (q.x + 1e-10), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0/3.0, 1.0/3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  void main() {
    vec4 col = texture2D(uTexture, vUv);
    vec3 hsv = rgb2hsv(col.rgb);
    hsv.x = fract(hsv.x + uHue);
    hsv.y = clamp(hsv.y * uSat, 0.0, 1.0);
    hsv.z = clamp(hsv.z * uBright, 0.0, 1.0);
    gl_FragColor = vec4(hsv2rgb(hsv), col.a);
  }
`;

export const KALEIDOSCOPE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uSegments;  // number of mirror segments (2-16)
  uniform float uRotation;  // 0-1 rotation of the pattern
  varying vec2 vUv;
  void main() {
    vec2 uv = vUv - 0.5;
    float angle = atan(uv.y, uv.x);
    float r     = length(uv);
    float seg   = 3.14159265 / max(1.0, uSegments);
    angle = mod(angle + uRotation * 3.14159265 * 2.0, seg * 2.0);
    if (angle > seg) angle = seg * 2.0 - angle; // mirror
    vec2 nuv = vec2(cos(angle), sin(angle)) * r + 0.5;
    gl_FragColor = texture2D(uTexture, fract(nuv));
  }
`;

export const VIGNETTE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;   // 0=none, 1=full black edges
  uniform float uRadius;   // 0=center point, 1=edges (default ~0.6)
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(uTexture, vUv);
    vec2 uv = vUv - 0.5;
    float d  = length(uv * vec2(1.0, 0.85)); // slightly oval
    float vig = smoothstep(uRadius, uRadius - uAmount * 0.5, d);
    gl_FragColor = vec4(c.rgb * vig, c.a);
  }
`;

// Bloom: two-pass separable Gaussian blur for bright pixels
export const BLOOM_EXTRACT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uThreshold;  // 0-1 luminance threshold
  varying vec2 vUv;
  float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
  void main() {
    vec4 c = texture2D(uTexture, vUv);
    float l = luma(c.rgb);
    float w = smoothstep(uThreshold - 0.1, uThreshold + 0.1, l);
    gl_FragColor = vec4(c.rgb * w, 1.0);
  }
`;

export const BLOOM_BLUR = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2      uDirection;  // (1,0) or (0,1)
  uniform vec2      uResolution;
  varying vec2 vUv;
  void main() {
    vec2 texel = uDirection / uResolution;
    vec4 c = vec4(0.0);
    // 9-tap Gaussian
    float w[5];
    w[0]=0.2270; w[1]=0.1945; w[2]=0.1216; w[3]=0.0540; w[4]=0.0162;
    c += texture2D(uTexture, vUv) * w[0];
    for (int i = 1; i <= 4; i++) {
      c += texture2D(uTexture, vUv + texel * float(i)) * w[i];
      c += texture2D(uTexture, vUv - texel * float(i)) * w[i];
    }
    gl_FragColor = c;
  }
`;

export const BLOOM_COMPOSITE = /* glsl */ `
  uniform sampler2D uTexture;   // original
  uniform sampler2D uBloom;     // blurred bright
  uniform float     uStrength;  // blend amount
  varying vec2 vUv;
  void main() {
    vec4 orig  = texture2D(uTexture, vUv);
    vec4 bloom = texture2D(uBloom,   vUv);
    gl_FragColor = vec4(orig.rgb + bloom.rgb * uStrength, orig.a);
  }
`;

export const BUFFER_TRANSFORM = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uPanX;
  uniform float uPanY;
  uniform float uScale;
  varying vec2 vUv;
  void main() {
    vec2 uv = (vUv - 0.5 - vec2(uPanX, uPanY)) / max(uScale, 0.001) + 0.5;
    gl_FragColor = texture2D(uTexture, uv);
  }
`;

// ─── Pixel Sort ────────────────────────────────────────────────────────────────
// Approximates pixel-sorting by reading a strip of N pixels from the input
// and replacing each sample with the min/max brightness pixel in a window.
// uDirection: 0=vertical columns, 1=horizontal rows
// uThreshold: luminance threshold — pixels below threshold are unsorted "anchors"
// uLength:    sort window length (1–512 px)
export const PIXEL_SORT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2  uResolution;
  uniform float uThreshold;   // 0–1 luminance anchor point
  uniform float uLength;      // sort window size in pixels
  uniform float uDirection;   // 0=vertical, 1=horizontal
  uniform float uMode;        // 0=light→dark, 1=dark→light
  varying vec2 vUv;

  float luma(vec3 c) {
    return dot(c, vec3(0.2126, 0.7152, 0.0722));
  }

  void main() {
    vec2 res  = uResolution;
    vec2 step = uDirection < 0.5
      ? vec2(0.0, 1.0 / res.y)   // vertical
      : vec2(1.0 / res.x, 0.0);  // horizontal

    vec4 src  = texture2D(uTexture, vUv);
    float l   = luma(src.rgb);

    // If this pixel is below threshold → it's an anchor, no sort
    if (l < uThreshold) {
      gl_FragColor = src;
      return;
    }

    // Sample a window of ±N/2 pixels and find the sorted replacement
    int half = int(uLength * 0.5);
    vec4 best = src;
    float bestL = uMode < 0.5 ? -1.0 : 2.0; // looking for max (mode=0) or min (mode=1)

    for (int i = -128; i <= 128; i++) {
      if (i < -half || i > half) continue;
      vec2 uv2 = vUv + float(i) * step;
      if (uv2.x < 0.0 || uv2.x > 1.0 || uv2.y < 0.0 || uv2.y > 1.0) continue;
      vec4 s  = texture2D(uTexture, uv2);
      float sl = luma(s.rgb);
      if (sl < uThreshold) break; // hit an anchor — stop window
      if (uMode < 0.5) {
        if (sl > bestL) { bestL = sl; best = s; } // brightest
      } else {
        if (sl < bestL) { bestL = sl; best = s; } // darkest
      }
    }

    gl_FragColor = best;
  }
`;

// ─── Film Grain ────────────────────────────────────────────────────────────────
// Adds animated film grain and optional scanlines overlay.
// uGrain:     0–1 grain amount
// uScanlines: 0–1 scanline intensity
// uTime:      frame time for animated noise
export const FILM_GRAIN = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uGrain;
  uniform float uScanlines;
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(443.897, 441.423));
    p += dot(p, p + 19.19);
    return fract(p.x * p.y);
  }

  void main() {
    vec4 col = texture2D(uTexture, vUv);

    // Grain
    if (uGrain > 0.0) {
      float n = hash(vUv + fract(uTime * 0.017));
      n = (n - 0.5) * 2.0; // centre around 0
      col.rgb += n * uGrain * 0.25;
    }

    // Scanlines
    if (uScanlines > 0.0) {
      float line = sin(vUv.y * 400.0) * 0.5 + 0.5;
      float mask = 1.0 - uScanlines * (1.0 - line) * 0.4;
      col.rgb *= mask;
    }

    gl_FragColor = vec4(clamp(col.rgb, 0.0, 1.0), col.a);
  }
`;

// ─── Feedback Rotate/Zoom ─────────────────────────────────────────────────────
// Applies a centred rotation and/or zoom to the feedback (prev) texture
// before it is blended, creating spiral and vortex effects.
// uAngle: rotation in turns (0–1 = 0–360°)
// uZoom:  zoom factor centred on 0.5,0.5 (1=no change, >1=zoom in, <1=zoom out)
export const FEEDBACK_ROTATE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAngle;  // turns
  uniform float uZoom;
  varying vec2 vUv;

  void main() {
    float a   = uAngle * 6.28318530718;
    float ca  = cos(a);
    float sa  = sin(a);
    vec2  uv  = vUv - 0.5;
    uv = vec2(ca * uv.x - sa * uv.y, sa * uv.x + ca * uv.y);
    float z   = max(0.001, uZoom);
    uv  = uv / z + 0.5;
    gl_FragColor = texture2D(uTexture, uv);
  }
`;

// ─── Quad Mirror ───────────────────────────────────────────────────────────────
// 4-way symmetry: folds UV into the top-left quadrant and mirrors all four.
// uMode: 0=quad 4-way, 1=diagonal (top-left triangle reflected to all 4 triangles)
export const QUAD_MIRROR = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uMode;
  varying vec2 vUv;

  void main() {
    vec2 uv = vUv;

    if (uMode < 0.5) {
      // 4-way: fold into top-left quadrant
      vec2 f = abs(uv * 2.0 - 1.0);
      uv = f * 0.5;
    } else {
      // Diagonal: fold along both diagonals
      if (uv.x + uv.y > 1.0) uv = 1.0 - uv;
      if (uv.x > uv.y)       uv = vec2(uv.y, uv.x);
      uv = uv * 2.0;
    }

    gl_FragColor = texture2D(uTexture, clamp(uv, 0.0, 1.0));
  }
`;

// ─── 3D LUT colour grade ──────────────────────────────────────────────────────
// Applies a 3D colour look-up table encoded as a 2D texture strip.
// uLUT:    2D texture (N*N wide, N tall) — horizontal slices of the 3D cube
// uLUTSize: cube edge length N (e.g. 17 or 33)
// uAmount: 0–1 blend between original and graded colour
export const LUT3D = /* glsl */ `
  uniform sampler2D uTexture;
  uniform sampler2D uLUT;
  uniform float     uLUTSize;  // cube edge N
  uniform float     uAmount;   // blend 0–1
  varying vec2 vUv;

  vec3 sampleLUT(vec3 col) {
    float N   = uLUTSize;
    float scale = (N - 1.0) / N;
    float offset = 0.5 / N;

    // clamp to [0,1]
    col = clamp(col, 0.0, 1.0);

    // Map into [offset, scale+offset]
    float r = col.r * scale + offset;
    float g = col.g * scale + offset;
    float b = col.b * scale + offset;

    // The texture is laid out as N horizontal slices each N×N pixels.
    // Total texture size: (N*N) wide × N tall.
    // Slice index = floor(b * N) and b fraction within slice.
    float bSlice  = b * (N - 1.0);
    float bFloor  = floor(bSlice);
    float bFrac   = bSlice - bFloor;

    // UV for floor slice
    float sliceW  = 1.0 / N;
    float uBase0  = bFloor * sliceW + r * sliceW;
    float uBase1  = (bFloor + 1.0) * sliceW + r * sliceW;
    float vCoord  = g;

    vec3 c0 = texture2D(uLUT, vec2(uBase0, vCoord)).rgb;
    vec3 c1 = texture2D(uLUT, vec2(uBase1, vCoord)).rgb;
    return mix(c0, c1, bFrac);
  }

  void main() {
    vec4 col = texture2D(uTexture, vUv);
    vec3 graded = sampleLUT(col.rgb);
    gl_FragColor = vec4(mix(col.rgb, graded, uAmount), col.a);
  }
`;

// ─── Levels ───────────────────────────────────────────────────────────────────
// Adjusts black point, white point, gamma (lift-gamma-gain style).
export const LEVELS = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uBlack;  // 0–1 input black point
  uniform float uWhite;  // 0–1 input white point
  uniform float uGamma;  // gamma (1=neutral, <1=lighten, >1=darken)
  varying vec2 vUv;

  void main() {
    vec4 col = texture2D(uTexture, vUv);
    vec3 c = clamp((col.rgb - uBlack) / max(uWhite - uBlack, 0.001), 0.0, 1.0);
    c = pow(c, vec3(1.0 / max(uGamma, 0.001)));
    gl_FragColor = vec4(c, col.a);
  }
`;

// ─── White Balance / Temperature ──────────────────────────────────────────────
// uTemperature: -100 (warm/orange) to +100 (cool/blue)
// uTint:        -100 (green) to +100 (magenta)
export const WHITE_BALANCE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uTemperature; // -100..100
  uniform float uTint;        // -100..100
  varying vec2 vUv;

  void main() {
    vec4 col = texture2D(uTexture, vUv);
    vec3 c = col.rgb;

    // Temperature: shift red-blue axis
    float t = uTemperature / 100.0; // -1..1
    c.r += t * 0.2;
    c.b -= t * 0.2;

    // Tint: shift green-magenta axis
    float m = uTint / 100.0; // -1..1
    c.g -= m * 0.15;
    c.r += m * 0.07;
    c.b += m * 0.07;

    gl_FragColor = vec4(clamp(c, 0.0, 1.0), col.a);
  }
`;
