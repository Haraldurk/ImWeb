export const ANALOG_SOURCE_SIGNAL = /* glsl */ `
  uniform sampler2D uTexture;
  uniform vec2 uResolution;
  uniform float uBrightness;    // -1..1
  uniform float uContrast;      // 0..2
  uniform float uSaturation;    // 0..2
  uniform float uHueOffset;     // -180..180 degrees
  uniform float uCrop43;        // 0=actual size, 1=crop to 4:3

  varying vec2 vUv;

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

  void main() {
    vec2 uv = vUv;

    if (uCrop43 > 0.5) {
      float aspect = uResolution.x / uResolution.y;
      float target = 4.0 / 3.0;
      if (aspect > target) {
        float w = target / aspect;
        uv.x = (uv.x - 0.5) / w + 0.5;
      } else {
        float h = aspect / target;
        uv.y = (uv.y - 0.5) / h + 0.5;
      }
      if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
      }
    }

    vec4 col = texture2D(uTexture, uv);

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
