export const ANALOG_SOURCE_SIGNAL = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uBrightness;
  uniform float uContrast;
  uniform float uSaturation;
  uniform float uHueOffset;
  uniform float uCrop43;
  uniform float uPattern;
  uniform float uTime;

  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
  }

  vec3 rgb2hsv(vec3 c) {
    vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
    vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
    vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
  }

  vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
  }

  // SMPTE color bars (75% or 100% amplitude)
  vec3 smpteBars(vec2 uv, float amp) {
    float x = uv.x;
    if (x < 0.0 || x > 1.0) return vec3(0.0);
    // 7 bars + black reference
    if (x < 0.125) return vec3(0.75, 0.75, 0.75) * amp;          // gray
    if (x < 0.250) return vec3(0.75, 0.75, 0.0) * amp;           // yellow
    if (x < 0.375) return vec3(0.0, 0.75, 0.75) * amp;           // cyan
    if (x < 0.500) return vec3(0.0, 0.75, 0.0) * amp;            // green
    if (x < 0.625) return vec3(0.75, 0.0, 0.75) * amp;           // magenta
    if (x < 0.750) return vec3(0.75, 0.0, 0.0) * amp;            // red
    if (x < 0.875) return vec3(0.0, 0.0, 0.75) * amp;            // blue
    return vec3(0.0);                                             // black
  }

  vec3 genPattern(vec2 uv, float t, float pat) {
    if (pat < 0.5) return vec3(-1.0); // use source texture

    // Snow
    if (pat < 1.5) {
      return vec3(hash(uv * uResolution + t));
    }

    // SMPTE 75%
    if (pat < 2.5) {
      return smpteBars(uv, 0.75);
    }

    // SMPTE 100%
    if (pat < 3.5) {
      return smpteBars(uv, 1.0);
    }

    // Rainbow — hue sweep
    if (pat < 4.5) {
      return hsv2rgb(vec3(uv.x, 1.0, uv.y * 0.6 + 0.4));
    }

    // Gray Steps — 11 vertical steps
    if (pat < 5.5) {
      float step = floor(uv.x * 11.0) / 10.0;
      return vec3(step);
    }

    // Multiburst — horizontal frequency sweep
    if (pat < 6.5) {
      float freq = mix(2.0, 40.0, uv.x);
      float burst = sin(uv.y * freq * 3.14159 * 2.0) * 0.5 + 0.5;
      return vec3(burst);
    }

    // Crosshatch — grid
    if (pat < 7.5) {
      float gx = abs(fract(uv.x * 16.0) - 0.5) * 2.0;
      float gy = abs(fract(uv.y * 12.0) - 0.5) * 2.0;
      float g = 1.0 - smoothstep(0.85, 1.0, max(gx, gy));
      float dot = smoothstep(0.2, 0.25, length(fract(uv * vec2(16.0, 12.0)) - 0.5));
      return vec3(g * 0.8 + dot * 0.3);
    }

    return vec3(0.0);
  }

  void main() {
    vec2 uv = vUv;

    if (uCrop43 > 0.5) {
      float aspect = uResolution.x / uResolution.y;
      float target = 4.0 / 3.0;
      if (aspect > target) {
        float w = target / aspect;
        float left = (1.0 - w) * 0.5;
        if (uv.x < left || uv.x > 1.0 - left) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
      } else {
        float h = aspect / target;
        float top = (1.0 - h) * 0.5;
        if (uv.y < top || uv.y > 1.0 - top) {
          gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
      }
    }

    vec4 col;

    // Test pattern or source texture
    if (uPattern > 0.5) {
      col = vec4(genPattern(uv, uTime, uPattern), 1.0);
    } else {
      col = texture2D(uTexture, uv);
    }

    col.rgb = (col.rgb - 0.5) * uContrast + 0.5 + uBrightness;

    if (uSaturation != 1.0 || uHueOffset != 0.0) {
      vec3 hsv = rgb2hsv(col.rgb);
      hsv.y *= uSaturation;
      hsv.x = fract(hsv.x + uHueOffset / 360.0);
      col.rgb = hsv2rgb(hsv);
    }

    gl_FragColor = col;
  }
`;
