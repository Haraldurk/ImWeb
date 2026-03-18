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
// ImOs9/ImX: KeyLevelWhite, KeyLevelBlack, KeySoftness
// Uses FG image luminance to key between FG and BG.
//
// WGSL equivalent would use @fragment with textureLoad/textureSample
// and the same luminance logic.

export const KEYER = /* glsl */ `
  uniform sampler2D uFG;          // Foreground input
  uniform sampler2D uBG;          // Background input
  uniform float uKeyWhite;        // 0–1: luminance threshold for FG visible (high)
  uniform float uKeyBlack;        // 0–1: luminance threshold for BG visible (low)
  uniform float uKeySoftness;     // 0–1: softness of the key transition
  uniform int   uKeyActive;       // 0=off, 1=on
  uniform int   uAlpha;           // use alpha channel keying
  uniform int   uAlphaInvert;     // invert alpha

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
      // Alpha channel keying (24-bit mode)
      alpha = uAlphaInvert == 1 ? (1.0 - fg.a) : fg.a;
    } else {
      // Luminance keying
      float lumaVal = luma(fg.rgb);
      float lo = uKeyBlack;
      float hi = uKeyWhite;
      float soft = max(uKeySoftness, 0.001);

      // Foreground visible where luma > hi, BG visible where luma < lo
      // Soft zone between lo and hi
      float fgAlpha = smoothstep(lo - soft, lo + soft, luma) *
                      (1.0 - smoothstep(hi - soft, hi + soft, luma));
      alpha = 1.0 - fgAlpha; // 1 = show FG, 0 = show BG

      // Classic luminance key: bright areas are transparent
      alpha = 1.0 - smoothstep(hi - soft, hi + soft, luma);
    }

    gl_FragColor = mix(bg, fg, alpha);
  }
`;

// ── Displacement ──────────────────────────────────────────────────────────────
// Uses DisplaceSrc luminance to offset FG pixels spatially.
// DisplaceAngle rotates the displacement direction.
// DisplaceOffset shifts the mapping center.

export const DISPLACE = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uDS;          // DisplaceSrc
  uniform float uAmount;          // 0–1 displacement strength
  uniform float uAngle;           // radians, direction of displacement
  uniform float uOffset;          // −1–1, center offset
  uniform int   uRotateGrey;      // RotateGrey mode

  varying vec2 vUv;

  void main() {
    if (uAmount == 0.0) {
      gl_FragColor = texture2D(uFG, vUv);
      return;
    }

    vec4 ds  = texture2D(uDS, vUv);
    float luma = dot(ds.rgb, vec3(0.2126, 0.7152, 0.0722));

    vec2 offset;
    float strength = (luma + uOffset - 0.5) * uAmount * 0.1;

    if (uRotateGrey == 1) {
      // Circular displacement: luminance maps to angle
      float theta = (luma - 0.5) * 2.0 * 3.14159265;
      offset = vec2(cos(theta), sin(theta)) * uAmount * 0.05;
    } else {
      // Linear displacement at angle
      vec2 dir = vec2(cos(uAngle), sin(uAngle));
      offset = dir * strength;
    }

    vec2 displaced = vUv + offset;
    gl_FragColor = texture2D(uFG, clamp(displaced, 0.0, 1.0));
  }
`;

// ── Blend (50/50 mix with previous frame) ────────────────────────────────────
// Creates motion blur / persistence / ghosting effect.

export const BLEND = /* glsl */ `
  uniform sampler2D uCurrent;     // current frame
  uniform sampler2D uPrev;        // previous output frame
  uniform int       uActive;      // 0=off, 1=on
  uniform float     uAmount;      // blend amount 0–1

  varying vec2 vUv;

  void main() {
    vec4 curr = texture2D(uCurrent, vUv);
    if (uActive == 0) { gl_FragColor = curr; return; }
    vec4 prev = texture2D(uPrev, vUv);
    gl_FragColor = mix(curr, prev, uAmount);
  }
`;

// ── Feedback ──────────────────────────────────────────────────────────────────
// Offsets and scales the output before feeding back as a source.

export const FEEDBACK = /* glsl */ `
  uniform sampler2D uOutput;
  uniform float uHorOffset;       // −1–1 horizontal offset in UV space
  uniform float uVerOffset;       // −1–1 vertical offset
  uniform float uScale;           // scale factor (0 = none)
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

    vec4 color = texture2D(uOutput, clamp(uv, 0.0, 1.0));
    gl_FragColor = color;
  }
`;

// ── Transfer modes (XOR / OR / AND) ──────────────────────────────────────────
// Bitwise pixel operations between FG and BG.
// Note: true bitwise ops on floats require encoding to uint8.

export const TRANSFERMODE = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uBG;
  uniform int       uMode;        // 0=copy, 1=xor, 2=or, 3=and

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

    if (uMode == 0) {
      gl_FragColor = fg;
      return;
    }

    ivec3 a = floatToInt8(fg.rgb);
    ivec3 b = floatToInt8(bg.rgb);
    ivec3 r;

    if (uMode == 1) r = a ^ b;       // XOR
    else if (uMode == 2) r = a | b;  // OR  (brighter)
    else if (uMode == 3) r = a & b;  // AND (darker)
    else r = a;

    gl_FragColor = vec4(int8ToFloat(r), fg.a);
  }
`;

// ── Color Shift ───────────────────────────────────────────────────────────────
// Global hue rotation. Unusual/unpredictable — as per the original.

export const COLORSHIFT = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uShift;           // 0–1, amount of hue shift

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

// ── Noise generators (rand1/2/3) ──────────────────────────────────────────────
// Three built-in noise textures matching ImOs9's rand1/2/3.
// Type 0 = pixel noise, 1 = horizontal bands, 2 = vertical bands.

export const NOISE_GEN = /* glsl */ `
  uniform float uTime;
  uniform int   uType;   // 0=pixel, 1=horiz, 2=vert
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

// ── Interlace effect ──────────────────────────────────────────────────────────
// Skips scan lines for a CRT/interlaced look (also a speed optimization).

export const INTERLACE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uResY;
  uniform float uAmount;          // 0 = off, 1+ = lines to skip
  uniform float uTime;

  varying vec2 vUv;

  void main() {
    if (uAmount < 1.0) {
      gl_FragColor = texture2D(uTexture, vUv);
      return;
    }
    float line = floor(vUv.y * uResY);
    float field = mod(floor(uTime * 30.0), 2.0); // 30fps field alternation
    if (mod(line + field, 2.0) < 1.0) {
      gl_FragColor = texture2D(uTexture, vUv);
    } else {
      // Blank alternate lines
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

// ── Solid color (HSV→RGB) ─────────────────────────────────────────────────────

export const SOLID_COLOR = /* glsl */ `
  uniform float uHue;       // 0–1
  uniform float uSat;       // 0–1
  uniform float uVal;       // 0–1
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
// Reads from a stored warp displacement map texture.
// The warp map texture encodes (dx, dy) in RG channels.

export const WARP = /* glsl */ `
  uniform sampler2D uFG;
  uniform sampler2D uWarpMap;     // RG = displacement vector, encoded 0–1 (0.5=center)
  uniform float uStrength;        // 0–1

  varying vec2 vUv;

  void main() {
    if (uStrength == 0.0) {
      gl_FragColor = texture2D(uFG, vUv);
      return;
    }
    vec4 warp = texture2D(uWarpMap, vUv);
    vec2 displacement = (warp.rg - 0.5) * uStrength * 0.3;
    vec2 warped = vUv + displacement;
    gl_FragColor = texture2D(uFG, clamp(warped, 0.0, 1.0));
  }
`;

// ── Fade ─────────────────────────────────────────────────────────────────────

export const FADE = /* glsl */ `
  uniform sampler2D uTexture;
  uniform float uAmount;   // 0=full black, 1=full image
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uTexture, vUv) * uAmount;
  }
`;
