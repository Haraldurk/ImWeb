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
  uniform sampler2D uFGRaw;    // pre-color-correction FG source for raw keying
  uniform float uKeyWhite;
  uniform float uKeyBlack;
  uniform float uKeySoftness;
  uniform int   uKeyActive;
  uniform int   uAlpha;
  uniform int   uAlphaInvert;
  uniform int   uExtKey;       // 1 = key on uEK luminance instead of uFG
  uniform int   uRawKey;       // 1 = key on uFGRaw (pre-color-correction) luma

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
      vec4 keySrc   = uExtKey == 1 ? texture2D(uEK, vUv)
                    : uRawKey == 1 ? texture2D(uFGRaw, vUv)
                    : fg;
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
  uniform float     uBlendAmount;

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

    vec3 blended = clamp(r, 0.0, 1.0);
    gl_FragColor = vec4(mix(b, blended, uBlendAmount), fg.a);
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

// ── BFG — Basis Function Generator ───────────────────────────────────────────
// Inspired by Cycling '74 jit.bfg — resolution-independent GPU noise field.
// All types use 3D sampling with time as the 4th (z) dimension, enabling
// smooth continuous animation without per-frame seed discontinuities.
//
// Types: 0=Value  1=Perlin  2=Simplex  3=Cellular-F1  4=Cellular-F2
//        5=Ridged  6=Curl  7=DomainWarp

export const NOISE_BFG = /* glsl */ `
  uniform float uTime;
  uniform int   uType;
  uniform float uScale;
  uniform float uOctaves;
  uniform float uLacunarity;
  uniform float uGain;
  uniform float uSpeed;
  uniform float uOffsetX;
  uniform float uOffsetY;
  uniform float uContrast;
  uniform int   uInvert;
  uniform float uSeed;
  uniform int   uColor;
  uniform vec3  uColor1;
  uniform vec3  uColor2;
  varying vec2  vUv;

  // ── Hash functions (iq-style, high quality) ────────────────────────────────

  float h1(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }

  vec3 h3(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return fract((p.xxy + p.yxx) * p.zyx);
  }

  // ── Value Noise — trilinear interpolation of random grid ──────────────────

  float vNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(h1(i),              h1(i+vec3(1,0,0)), u.x),
          mix(h1(i+vec3(0,1,0)), h1(i+vec3(1,1,0)), u.x), u.y),
      mix(mix(h1(i+vec3(0,0,1)), h1(i+vec3(1,0,1)), u.x),
          mix(h1(i+vec3(0,1,1)), h1(i+vec3(1,1,1)), u.x), u.y),
      u.z);
  }

  // ── Perlin Gradient Noise — quintic interpolation ─────────────────────────

  vec3 gHash(vec3 p) {
    p = fract(p * vec3(0.1031, 0.1030, 0.0973));
    p += dot(p, p.yxz + 33.33);
    return normalize(-1.0 + 2.0 * fract((p.xxy + p.yxx) * p.zyx));
  }

  float pNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    vec3 u = f*f*f*(f*(f*6.0-15.0)+10.0);
    float v000 = dot(gHash(i),              f);
    float v100 = dot(gHash(i+vec3(1,0,0)), f-vec3(1,0,0));
    float v010 = dot(gHash(i+vec3(0,1,0)), f-vec3(0,1,0));
    float v110 = dot(gHash(i+vec3(1,1,0)), f-vec3(1,1,0));
    float v001 = dot(gHash(i+vec3(0,0,1)), f-vec3(0,0,1));
    float v101 = dot(gHash(i+vec3(1,0,1)), f-vec3(1,0,1));
    float v011 = dot(gHash(i+vec3(0,1,1)), f-vec3(0,1,1));
    float v111 = dot(gHash(i+vec3(1,1,1)), f-vec3(1,1,1));
    return 0.5 + 0.5 * mix(
      mix(mix(v000,v100,u.x), mix(v010,v110,u.x), u.y),
      mix(mix(v001,v101,u.x), mix(v011,v111,u.x), u.y),
      u.z);
  }

  // ── Simplex Noise 3D — Stefan Gustavson ───────────────────────────────────

  vec3  _m289v3(vec3  x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4  _m289v4(vec4  x){return x-floor(x*(1.0/289.0))*289.0;}
  vec4  _prm(vec4   x){return _m289v4(((x*34.0)+1.0)*x);}
  vec4  _tiS(vec4   r){return 1.79284291400159-0.85373472095314*r;}

  float sNoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g  = step(x0.yzx, x0.xyz);
    vec3 l  = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = _m289v3(i);
    vec4 p = _prm(_prm(_prm(
               i.z + vec4(0.0,i1.z,i2.z,1.0))
             + i.y + vec4(0.0,i1.y,i2.y,1.0))
             + i.x + vec4(0.0,i1.x,i2.x,1.0));
    float n_ = 0.142857142857;
    vec3  ns = n_ * D.wyz - D.xzx;
    vec4  j  = p - 49.0*floor(p*ns.z*ns.z);
    vec4  x_ = floor(j*ns.z);
    vec4  y_ = floor(j - 7.0*x_);
    vec4  x  = x_*ns.x + ns.yyyy;
    vec4  y  = y_*ns.x + ns.yyyy;
    vec4  h  = 1.0 - abs(x) - abs(y);
    vec4  b0 = vec4(x.xy, y.xy);
    vec4  b1 = vec4(x.zw, y.zw);
    vec4  s0 = floor(b0)*2.0 + 1.0;
    vec4  s1 = floor(b1)*2.0 + 1.0;
    vec4  sh = -step(h, vec4(0.0));
    vec4  a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4  a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3  p0 = vec3(a0.xy, h.x);
    vec3  p1 = vec3(a0.zw, h.y);
    vec3  p2 = vec3(a1.xy, h.z);
    vec3  p3 = vec3(a1.zw, h.w);
    vec4  nm = _tiS(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
    p0 *= nm.x; p1 *= nm.y; p2 *= nm.z; p3 *= nm.w;
    vec4 m = max(0.5 - vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)), 0.0);
    m = m * m;
    return 0.5 + 52.0 * dot(m*m, vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
  }

  // ── Cellular / Worley Noise — 3×3×3 grid search ──────────────────────────

  vec2 wNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    float f1 = 9.0, f2 = 9.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 nb = vec3(float(x), float(y), float(z));
          vec3 pt = h3(i + nb);
          float d = length(nb + pt - f);
          if (d < f1) { f2 = f1; f1 = d; }
          else if (d < f2) { f2 = d; }
        }
      }
    }
    return vec2(f1, f2);
  }

  // ── fBm wrapper — up to 8 octaves, three basis types ─────────────────────

  float fbm(vec3 p, int oct, float lac, float gn, int basis) {
    float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      float n;
      if      (basis == 0) n = vNoise(p * freq);
      else if (basis == 1) n = pNoise(p * freq);
      else                 n = sNoise(p * freq);
      sum  += n * amp;
      norm += amp;
      amp  *= gn;
      freq *= lac;
    }
    return sum / norm;
  }

  // ── Ridged Multifractal — sharp crests, deep valleys ─────────────────────

  float ridged(vec3 p, int oct, float lac, float gn) {
    float sum = 0.0, amp = 0.5, freq = 1.0, prev = 1.0, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      float n = 1.0 - abs(pNoise(p * freq) * 2.0 - 1.0);
      n    = n * n * prev;
      sum += n * amp;
      norm += amp;
      prev  = n;
      amp  *= gn;
      freq *= lac;
    }
    return sum / norm;
  }

  // ── Turbulence — absolute-value Perlin fBm (Perlin 1985) ─────────────────
  float turbulence(vec3 p, int oct, float lac, float gn) {
    float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      float n = abs(pNoise(p * freq) * 2.0 - 1.0);
      sum  += n * amp;
      norm += amp;
      amp  *= gn;
      freq *= lac;
    }
    return sum / norm;
  }

  // ── Billowed — inverted-abs fBm, rounded bubbly peaks ────────────────────
  float billowed(vec3 p, int oct, float lac, float gn) {
    float sum = 0.0, amp = 0.5, freq = 1.0, norm = 0.0;
    for (int i = 0; i < 8; i++) {
      if (i >= oct) break;
      float n = 1.0 - abs(pNoise(p * freq) * 2.0 - 1.0);
      sum  += n * amp;
      norm += amp;
      amp  *= gn;
      freq *= lac;
    }
    return sum / norm;
  }

  // ── Curl Noise — numerically differentiated fBm → divergence-free field ──
  // Output: RG = flow vector (remapped 0–1), B = magnitude.
  // Use as DisplaceSrc for fluid video displacement.

  vec2 curlField(vec3 p, int oct, float lac, float gn) {
    const float e = 0.005;
    float n1 = fbm(p + vec3(0.0, e, 0.0), oct, lac, gn, 1);
    float n2 = fbm(p - vec3(0.0, e, 0.0), oct, lac, gn, 1);
    float n3 = fbm(p + vec3(e, 0.0, 0.0), oct, lac, gn, 1);
    float n4 = fbm(p - vec3(e, 0.0, 0.0), oct, lac, gn, 1);
    return vec2(n1 - n2, -(n3 - n4)) * (1.0 / (2.0 * e));
  }

  // ── Domain Warp — fBm(fBm(p)), Inigo Quilez ──────────────────────────────

  float domainWarp(vec3 p, int oct, float lac, float gn) {
    float ox = fbm(p + vec3(1.7, 9.2, 0.0), oct, lac, gn, 1);
    float oy = fbm(p + vec3(8.3, 2.8, 0.0), oct, lac, gn, 1);
    vec3  q  = p + 1.5 * vec3(ox, oy, 0.0);
    float rx = fbm(q + vec3(5.2, 1.3, 0.0), oct, lac, gn, 1);
    float ry = fbm(q + vec3(0.7, 4.1, 0.0), oct, lac, gn, 1);
    return fbm(p + 1.5 * vec3(rx, ry, 0.0), oct, lac, gn, 1);
  }

  // ── Voronoi — multi-metric, 3×3×3 neighborhood ───────────────────────────
  // metric: 0=Euclidean  1=Manhattan  2=Chebyshev
  // Returns vec2(F1, F2) — nearest and second-nearest seed distances.

  vec2 voronoi(vec3 p, int metric) {
    vec3 i = floor(p), f = fract(p);
    float f1 = 9.0, f2 = 9.0;
    for (int z = -1; z <= 1; z++) {
      for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
          vec3 nb = vec3(float(x), float(y), float(z));
          vec3 dv = nb + h3(i + nb) - f;
          float d = length(dv);
          if (metric == 1) d = abs(dv.x) + abs(dv.y) + abs(dv.z);
          if (metric == 2) d = max(max(abs(dv.x), abs(dv.y)), abs(dv.z));
          if (d < f1) { f2 = f1; f1 = d; }
          else if (d < f2) { f2 = d; }
        }
      }
    }
    return vec2(f1, f2);
  }

  // ── vec2 hash — for Gabor / Poisson kernels ──────────────────────────────
  vec2 h2(vec2 v) {
    return vec2(h1(vec3(v, 0.0)), h1(vec3(v + vec2(3.7, 1.9), 0.0)));
  }

  // ── Main ──────────────────────────────────────────────────────────────────

  void main() {
    int  oct = int(uOctaves + 0.5);
    // Time is the 3rd spatial dimension — smooth continuous animation
    float t  = uTime * uSpeed + uSeed;
    vec3  p  = vec3(vUv * uScale + vec2(uOffsetX, uOffsetY), t);

    float n     = 0.0;
    vec2  curlV = vec2(0.0);
    bool  isCurl = (uType == 7);  // Curl shifted from 6→7
    float r_rgb = 0.0, g_rgb = 0.0, b_rgb = 0.0;

    if (uType == 0) {
        // We use 'p' for Scale/Offset, and add 'uTime * uSpeed' to make it boil!
        n = fract(sin(dot(p.xy + vec2(uTime * uSpeed), vec2(12.9898, 78.233))) * 43758.5453);
    } else if (uType == 1) {
      n = fbm(p, oct, uLacunarity, uGain, 0);           // Value
    } else if (uType == 2) {
      n = fbm(p, oct, uLacunarity, uGain, 1);           // Perlin
    } else if (uType == 3) {
      n = fbm(p, oct, uLacunarity, uGain, 2);           // Simplex
    } else if (uType == 4) {
      vec2 c = wNoise(p);
      n = 1.0 - smoothstep(0.0, 0.9, c.x);             // Cellular F1
    } else if (uType == 5) {
      vec2 c = wNoise(p);
      n = smoothstep(0.0, 0.5, c.y - c.x);             // Cellular F2-F1
    } else if (uType == 6) {
      n = ridged(p, oct, uLacunarity, uGain);           // Ridged
    } else if (uType == 7) {
      curlV = curlField(p, oct, uLacunarity, uGain);
      n = length(curlV) * 0.5;                          // Curl
    } else if (uType == 8) {
      n = domainWarp(p, oct, uLacunarity, uGain);       // Domain Warp
    } else if (uType == 9) {
      n = h1(vec3(p.xy, uSeed));                        // White
    } else if (uType == 10) {
      float fr = floor(uTime * uSpeed * 24.0);
      float vig = 1.0 - smoothstep(0.3, 0.8, length(p.xy/uScale - 0.5) * 2.0);
      n = h1(vec3(p.xy, uSeed + fr)) * (0.75 + vig * 0.5); // Film Grain
    } else if (uType == 11) {
      float u1 = h1(vec3(p.xy, uSeed));
      float u2 = h1(vec3(p.xy + 17.0, uSeed));
      float gz = sqrt(-2.0 * log(max(u1, 0.0001))) * cos(6.2832 * u2);
      n = clamp(gz * 0.15 + 0.5, 0.0, 1.0);           // Gaussian
    } else if (uType == 12) {
      float fr = floor(uTime * 30.0 + uSeed);
      n = h1(vec3(p.xy, fr));                           // TV Static
    } else if (uType == 13) {
      n = mod(p.y * 20.0, 1.0) < 0.5 + sin(t) * 0.1 ? 1.0 : 0.0; // Scan Lines
    } else if (uType == 14) {
      float hv = h1(vec3(p.xy, uSeed));
      n = hv < 0.05 ? 0.0 : hv > 0.95 ? 1.0 : 0.5;   // Salt-and-Pepper
    } else if (uType == 15) {
      vec2 c = voronoi(p, 0);
      n = clamp(c.x * 1.5, 0.0, 1.0);                 // Voronoi F1
    } else if (uType == 16) {
      vec2 c = voronoi(p, 1);
      n = clamp(c.x * 0.8, 0.0, 1.0);                 // Manhattan Voronoi
    } else if (uType == 17) {
      vec2 c = voronoi(p, 2);
      n = clamp(c.x * 1.2, 0.0, 1.0);                 // Chebyshev Voronoi
    } else if (uType == 18) {
      vec2 ca = wNoise(p);
      vec2 cb = wNoise(p * 1.7 + vec3(3.1, 1.7, 0.0));
      vec2 cc = wNoise(p * 0.6 + vec3(0.0, 0.0, 1.3));
      n = 1.0 - clamp(ca.x * 0.6 + cb.x * 0.3 + cc.x * 0.1, 0.0, 1.0); // Caustics
    } else if (uType == 19) {
      float ang = t * 0.5;
      float cs = cos(ang), sn = sin(ang);
      vec3 rp = vec3(p.x * cs - p.y * sn, p.x * sn + p.y * cs, p.z);
      n = fbm(rp, oct, uLacunarity, uGain, 1);         // Flow Noise
    } else if (uType == 20) {
      vec2 c = wNoise(p);
      n = 1.0 - smoothstep(0.0, 0.3, c.y - c.x);      // Worley Veins
    } else if (uType == 21) {
      vec2 cell = floor(p.xy * 0.3);
      vec2 local = fract(p.xy * 0.3) - 0.5;
      float flip = step(0.5, h1(vec3(cell + uSeed + 37.3, 0.0)));
      vec2 corner = vec2(flip > 0.5 ? 0.5 : -0.5, 0.5);
      n = 1.0 - smoothstep(0.0, 0.08, abs(length(local - corner) - 0.5)); // Truchet
    } else if (uType == 22) {
      vec2 hUv = p.xy * 0.3;
      float q = hUv.x * 2.0 / 3.0;
      float r = (-hUv.x + sqrt(3.0) * hUv.y) / 3.0;
      vec2 hex = vec2(q, r);
      vec2 hid = floor(hex + 0.5);
      float cellN = h1(vec3(hid + uSeed + 73.1, 0.0));
      float dist = length(hex - hid);
      n = cellN * (1.0 - smoothstep(0.3, 0.5, dist));  // Hex Grid
    } else if (uType == 23) {
      float sum = 0.0;
      vec2 uv22 = p.xy * 0.2;
      for (int i = 0; i < 8; i++) {
        float a = h1(vec3(float(i), uSeed + 11.0, 0.0)) * 6.283;
        vec2 off = h2(vec2(float(i), uSeed + 23.0));
        vec2 gd = fract(uv22) - off;
        float env = exp(-dot(gd, gd) * 4.0);
        float wave = cos(dot(gd, vec2(cos(a), sin(a))) + t);
        sum += env * wave;
      }
      n = clamp(sum / 8.0 * 0.5 + 0.5, 0.0, 1.0);     // Gabor
    } else if (uType == 24) {
      vec2 uv23 = p.xy * 0.1 + uSeed;
      n = fract(52.9829189 * fract(dot(uv23, vec2(0.06711056, 0.00583715)))); // Blue Noise
    } else if (uType == 25) {
      vec2 cell = floor(p.xy * 0.2);
      vec2 local = fract(p.xy * 0.2);
      vec2 jitter = h2(cell + uSeed + 19.4) * 0.7 + 0.15;
      float d2 = length(local - jitter);
      n = 1.0 - smoothstep(0.1, 0.4, d2);              // Poisson Disc
    } else if (uType == 26) {
      float sp = h1(vec3(p.xy * 0.5 + uSeed, 0.0));
      n = clamp(0.5 * (1.0 + (sp - 0.5) * 2.0 * uGain), 0.0, 1.0); // Speckle
    } else if (uType == 27) {
      r_rgb = h1(vec3(p.xy * 0.2 + uSeed + vec2(0.1, 0.0), 0.0));
      g_rgb = h1(vec3(p.xy * 0.2 + uSeed + vec2(0.0, 0.1), 0.0));
      b_rgb = h1(vec3(p.xy * 0.2 + uSeed + vec2(0.1, 0.1), 0.0));
      n = (r_rgb + g_rgb + b_rgb) / 3.0;               // RGB Shift
    } else if (uType == 28) {
      float line = floor(p.y * 10.0);
      float shift = (h1(vec3(line, floor(uTime * uSpeed * 5.0) + uSeed, 0.0)) - 0.5) * 0.3;
      n = h1(vec3(p.x * 0.2 + shift + uSeed, line * 0.1 + uSeed, 0.0)); // Interlace
    } else if (uType == 29) {
      float bandY = fract(p.y * 2.0 + uTime * uSpeed * 0.08);
      float track = smoothstep(0.0, 0.15, bandY) * (1.0 - smoothstep(0.15, 0.4, bandY));
      float shift2 = (h1(vec3(floor(p.y * 8.0), floor(uTime * 4.0) + uSeed, 0.0)) - 0.5) * track * 0.4;
      float dropout = step(0.96, h1(vec3(p.y, floor(uTime * 8.0) + uSeed, 0.0)));
      float signal = h1(vec3(p.x * 0.3 + shift2 + uSeed, p.y * 0.3 + uSeed, floor(uTime * 30.0)));
      n = mix(signal, 1.0, dropout * 0.9);             // VCR Noise
    } else if (uType == 30) {
      r_rgb = 0.5 * (1.0 + (h1(vec3(p.xy * 0.5 + uSeed + vec2(0.3, 0.0), 0.0)) - 0.5) * 2.0 * uGain);
      g_rgb = 0.5 * (1.0 + (h1(vec3(p.xy * 0.5 + uSeed + vec2(0.0, 0.3), 0.0)) - 0.5) * 2.0 * uGain);
      b_rgb = 0.5 * (1.0 + (h1(vec3(p.xy * 0.5 + uSeed + vec2(0.3, 0.3), 0.0)) - 0.5) * 2.0 * uGain);
      n = (r_rgb + g_rgb + b_rgb) / 3.0;               // Speckle Colour
    } else if (uType == 31) {
      float bands = floor(h1(vec3(floor(p.y * 5.0) + uSeed, 0.0, 0.0)) * 8.0) / 8.0;
      float detail = h1(vec3(p.xy * 0.1 + uSeed, 0.0)) * 0.15;
      n = clamp(bands + detail, 0.0, 1.0);             // Pixel Sort
    } else if (uType == 32) {
      n = fbm(p, oct, uLacunarity, uGain, 1);          // fBm (Perlin)
    } else if (uType == 33) {
      n = turbulence(p, oct, uLacunarity, uGain);      // Turbulence
    } else if (uType == 34) {
      n = billowed(p, oct, uLacunarity, uGain);        // Billowed
    } else if (uType == 35) {
      n = domainWarp(p, oct, uLacunarity, uGain);      // Domain Warp 2
    } else if (uType == 36) {
      vec2 pos = p.xy;
      for (int i = 0; i < 3; i++) {
        vec2 cv = curlField(vec3(pos * 0.3, p.z), oct, uLacunarity, uGain);
        pos += cv * 0.02 * uGain;
      }
      curlV = curlField(vec3(pos * 0.3, p.z), oct, uLacunarity, uGain);
      n = length(curlV) * 0.5;
      isCurl = true;                                   // Velocity Field
    } else if (uType == 37) {
      vec2 vel = curlField(vec3(p.xy * 0.3, p.z), oct, uLacunarity, uGain);
      vec3 advP = vec3((p.xy - vel * 0.08) * 0.3, p.z);
      float n1 = fbm(advP, oct, uLacunarity, uGain, 1);
      float n2 = fbm(p * 0.3, oct, uLacunarity, uGain, 1);
      n = mix(n1, n2, 0.4);                            // Advection
    } else if (uType == 38) {
      float w = domainWarp(p, oct, uLacunarity, uGain);
      n = 0.5 + 0.5 * sin(1.5 * p.x + w * 6.0 + uTime * uSpeed * 0.3); // Marble
    }

    // ── Post-process ────────────────────────────────────────────────────────
    n = clamp(n, 0.0, 1.0);
    n = pow(n, uContrast);
    if (uInvert == 1) n = 1.0 - n;

    // ── Color output ────────────────────────────────────────────────────────
    vec3 col;
    if (isCurl) {
      // Encode flow vector in RG (0=left/down, 1=right/up), magnitude in B
      col = vec3(0.5 + 0.4 * curlV.x, 0.5 + 0.4 * curlV.y, n);
      if (uInvert == 1) col.xy = 1.0 - col.xy;
    } else if (uColor == 2) {
      col = mix(uColor1, uColor2, n);
    } else if (uColor == 1) {
      // Tri-channel colorization via spatially shifted fbm passes
      int colorOct = oct > 1 ? oct - 1 : 1;
      float r = fbm(p + vec3(1.0, 0.0, 0.5), colorOct, uLacunarity, uGain, 0);
      float g = fbm(p + vec3(0.0, 1.0, 0.5), colorOct, uLacunarity, uGain, 0);
      float b = fbm(p + vec3(0.5, 0.0, 1.0), colorOct, uLacunarity, uGain, 0);
      r = pow(clamp(r, 0.0, 1.0), uContrast);
      g = pow(clamp(g, 0.0, 1.0), uContrast);
      b = pow(clamp(b, 0.0, 1.0), uContrast);
      col = mix(vec3(n), vec3(r, g, b), 0.75);
    } else {
      // Default: mix between the two noise colors (color pickers always active)
      // With defaults white/black this is identical to grayscale vec3(n)
      col = mix(uColor1, uColor2, n);
    }

    if (uType == 27 || uType == 30) col = vec3(r_rgb, g_rgb, b_rgb);

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
    int halfLen = int(uLength * 0.5);
    vec4 best = src;
    float bestL = uMode < 0.5 ? -1.0 : 2.0; // looking for max (mode=0) or min (mode=1)

    for (int i = -128; i <= 128; i++) {
      if (i < -halfLen || i > halfLen) continue;
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

// ── TimeWarp ──────────────────────────────────────────────────────────────────
// Strip-based temporal slit-scan readout. Used by SequenceBuffer timewarp mode.
// Reads the strip RT (one column per captured frame) and assembles a full output
// frame with axis, flip, scroll-offset, and cubic time-warp controls.

export const TIMEWARP = /* glsl */ `
  uniform sampler2D tStrip;   // strip RT — one column per captured frame
  uniform sampler2D tLive;    // live input for mix-in
  uniform float uMix;         // 0 = all live, 1 = all strip
  uniform int   uAxis;        // 0 = Horizontal (time along X), 1 = Vertical (time along Y)
  uniform float uFlip;        // 1.0 = reverse time direction
  uniform float uOffset;      // temporal scroll offset [0, 1)
  uniform float uWarp;        // cubic time-warp 0..1
  varying vec2 vUv;

  void main() {
    float coord = (uAxis == 0) ? vUv.x : vUv.y;
    if (uFlip > 0.5) coord = 1.0 - coord;
    coord = fract(coord + uOffset);

    if (uWarp > 0.001) {
      float t    = coord * 2.0 - 1.0;
      float bent = t * (1.0 - uWarp * 0.5 * t * t);
      coord = clamp(bent * 0.5 + 0.5, 0.0, 1.0);
    }

    vec2 stripUv = (uAxis == 0)
      ? vec2(coord, vUv.y)
      : vec2(vUv.x, coord);

    vec4 warped = texture2D(tStrip, stripUv);
    vec4 live   = texture2D(tLive,  vUv);
    gl_FragColor = mix(live, warped, uMix);
  }
`;

// ── Vasulka Warp ──────────────────────────────────────────────────────────────
// Dual-oscillator scan-line UV warp inspired by Steina Vasulka's Wobbulator.
// Two independent H oscillators + one V oscillator distort the UV coordinates.
// Optional color modulation tints based on displacement magnitude.

export const VASULKA_WARP = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uFreqH;  // H oscillator 1 frequency (cycles)
  uniform float uFreqV;  // V oscillator frequency (cycles)
  uniform float uAmpH;   // H oscillator 1 amplitude (UV units)
  uniform float uAmpV;   // V oscillator amplitude (UV units)
  uniform float uPhase;  // primary phase offset (radians)
  uniform float uFreq2;  // H oscillator 2 frequency
  uniform float uAmp2;   // H oscillator 2 amplitude (UV units)
  uniform float uColor;  // color modulation strength 0–1
  varying vec2 vUv;

  void main() {
    float tau = 6.2831853;
    // Horizontal warp: two scan-line oscillators summed (Lissajous-like)
    float wH = sin(vUv.y * uFreqH * tau + uPhase) * uAmpH
             + sin(vUv.y * uFreq2 * tau + uPhase * 1.6180) * uAmp2;
    // Vertical warp: one oscillator across horizontal scanlines
    float wV = sin(vUv.x * uFreqV * tau + uPhase * 0.7) * uAmpV;

    vec2 uv = vec2(fract(vUv.x + wH), fract(vUv.y + wV));
    vec4 col = texture2D(uTexture, uv);

    if (uColor > 0.001) {
      float maxAmp = uAmpH + uAmp2;
      float t = (maxAmp > 0.0) ? (wH / maxAmp) * 0.5 + 0.5 : 0.5;
      vec3 tint = vec3(t, 1.0 - t * 0.7, 0.5 + wV * 2.0);
      col.rgb = mix(col.rgb, col.rgb * tint, uColor);
    }

    gl_FragColor = col;
  }
`;
