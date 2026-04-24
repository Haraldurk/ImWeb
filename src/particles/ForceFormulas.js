export class ForceFormulas {
  static CURL_NOISE = 'curl';
  static LORENZ     = 'lorenz';
  static MAGNETIC   = 'magnetic';
  // REACTION_DIFFUSION — deferred (requires its own ping-pong simulation, not a GLSL function)

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

    // rho <13: fixed point. 13–24: single lobe. 24–28: bifurcation. 28+: butterfly. >40: chaotic.
    lorenz: /* glsl */`
vec2 lorenzFlow(vec2 pos, float t, float rho, float sigma, float beta) {
  vec2 p = (pos-0.5)*40.0;
  float z = 20.0 + 10.0*sin(t*0.1 + pos.x*3.0 + pos.y*2.0);
  float dx = sigma*(p.y-p.x);
  float dy = p.x*(rho-z)-p.y;
  vec2 v = vec2(dx, dy);
  float m = length(v);
  return m > 0.001 ? v/m*0.8 : vec2(0.0);
}`,

    // Poles placed at videoAnalysis.brightPeaks; alternating polarity creates field-line structure.
    magnetic: /* glsl */`
uniform vec2  uPoles[8];
uniform float uPolarity[8];
uniform int   uPoleCount;
vec2 magneticFlow(vec2 pos) {
  vec2 total=vec2(0.0);
  for(int i=0;i<8;i++){
    if(i>=uPoleCount) break;
    vec2 r=pos-uPoles[i]; float d2=dot(r,r)+0.001;
    total+=uPolarity[i]*r/(d2*sqrt(d2));
  }
  float m=length(total);
  return m>0.001 ? total/m*0.6 : vec2(0.0);
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
      lorenz: [
        { name: 'rho',   min: 0.1, max: 60.0, default: 28.0 },
        { name: 'sigma', min: 1.0, max: 20.0, default: 10.0 },
        { name: 'beta',  min: 0.5, max: 8.0,  default: 2.67 },
      ],
      magnetic: [
        { name: 'poleCount', min: 0, max: 8, default: 0 },
      ],
    };
    return map[formula] ?? [];
  }
}
