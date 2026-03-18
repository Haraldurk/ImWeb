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

  ivec3 floatToInt8(vec3 c) {
    return ivec3(clamp(c * 255.0, 0.0, 255.0));
  }

  vec3 int8ToFloat(ivec3 i) {
    return vec3(i) / 255.0;
  }

  void main() {
    vec4 fg = texture2D(uFG, vUv);
    vec4 bg = texture2D(uBG, vUv);
    if (uMode == 0) { gl_FragColor = fg; return; }
    ivec3 a = floatToInt8(fg.rgb);
    ivec3 b = floatToInt8(bg.rgb);
    ivec3 r;
    if (uMode == 1)      r = a ^ b;
    else if (uMode == 2) r = a | b;
    else if (uMode == 3) r = a & b;
    else                 r = a;
    gl_FragColor = vec4(int8ToFloat(r), fg.a);
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
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  void main() {
    float n;
    if (uType == 0) {
      n = hash(vUv + floor(uTime * 60.0) * 0.001);
    } else if (uType == 1) {
      n = hash(vec2(0.5, vUv.y) + floor(uTime * 60.0) * 0.001);
    } else {
      n = hash(vec2(vUv.x, 0.5) + floor(uTime * 60.0) * 0.001);
    }
    gl_FragColor = vec4(vec3(n), 1.0);
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
