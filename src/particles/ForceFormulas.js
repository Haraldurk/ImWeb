export class ForceFormulas {
  static CURL_NOISE = 'curl';
  // LORENZ, MAGNETIC, VORTEX_SHED — Phase D

  static GLSL = {
    curl: /* glsl */`
float _ff_hash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5); }
float _ff_noise(vec2 p) {
  vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(_ff_hash(i),_ff_hash(i+vec2(1,0)),f.x),
             mix(_ff_hash(i+vec2(0,1)),_ff_hash(i+vec2(1,1)),f.x),f.y);
}
vec2 curlNoise(vec2 pos, float t, float scale, float speed) {
  vec2 p=pos*scale; float eps=0.01;
  float n1=_ff_noise(vec2(p.x,p.y+eps)+t*speed), n2=_ff_noise(vec2(p.x,p.y-eps)+t*speed);
  float n3=_ff_noise(vec2(p.x+eps,p.y)+t*speed), n4=_ff_noise(vec2(p.x-eps,p.y)+t*speed);
  return vec2((n1-n2),-(n3-n4))/(2.0*eps);
}`,
  };

  static getGLSL(formula) {
    return ForceFormulas.GLSL[formula] ?? '';
  }

  static getParams(formula) {
    const map = {
      curl: [
        { name: 'scale', min: 0.1, max: 20.0, default: 3.0 },
        { name: 'speed', min: 0.0, max: 5.0,  default: 0.5 },
      ],
    };
    return map[formula] ?? [];
  }
}
