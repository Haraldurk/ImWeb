import * as THREE from "three";

const GHOST_SDF_VERT = /* glsl */`
precision highp float;
attribute vec3 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// Outputs accumulated force from ALL ghosts (additive — every ghost contributes):
//   R/G = summed force vector (raw float, unbounded)
//   B   = accumulated freeze weight
//   A   = unused
// uGhostA[i].w encodes mode: 0.0=attract  0.33=repel  0.66=vortex  1.0=freeze
const GHOST_SDF_FRAG = /* glsl */`
precision highp float;
uniform vec4  uGhostA[16];   // .xy=pos, .z=radius, .w=mode (0=attract,0.33=repel,0.66=vortex,1.0=freeze)
uniform vec4  uGhostB[16];   // .x=strength (signed, signed-squared from CPU), .y=shape (0=sphere,1=box)
uniform int   uGhostCount;
varying vec2  vUv;

float sdSphere(vec2 p, vec2 c, float r) {
  return length(p - c) - r;
}
float sdBox(vec2 p, vec2 c, float r) {
  vec2 d = abs(p - c) - vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

void main() {
  vec2  acc     = vec2(0.0);
  float freezeW = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i < uGhostCount) {
      vec2  c    = uGhostA[i].xy;
      float r    = uGhostA[i].z;
      float mode = uGhostA[i].w;   // 0.0=attract 0.33=repel 0.66=vortex 1.0=freeze
      float str  = uGhostB[i].x;   // signed (already signed-squared from CPU)

      float d    = uGhostB[i].y > 0.5 ? sdBox(vUv, c, r) : sdSphere(vUv, c, r);
      float dSoft = max(abs(d), 0.001);
      float gF   = abs(str) / (dSoft * dSoft + 0.01);

      vec2 diff  = vUv - c;
      vec2 grad  = length(diff) > 0.0001 ? normalize(diff) : vec2(0.0, 1.0); // outward from ghost

      float s    = str >= 0.0 ? 1.0 : -1.0;

      if (mode < 0.2) {
        acc -= grad * gF * s;                     // attract: pull toward ghost
      } else if (mode < 0.5) {
        acc += grad * gF * s;                     // repel: push away from ghost
      } else if (mode < 0.8) {
        acc += vec2(-grad.y, grad.x) * gF * s;   // vortex: tangential spin
      } else {
        freezeW += gF;                            // freeze: accumulate damping weight
      }
    }
  }

  gl_FragColor = vec4(acc.x, acc.y, freezeW, 0.0);
}
`;

const MODE_MAP = { attract: 0.0, repel: 0.33, vortex: 0.66, freeze: 1.0 };

export class GhostNodes {
  static MAX = 16;

  constructor(renderer) {
    this._renderer = renderer;
    this._nodes    = new Map();
    this._nextId   = 0;
    this._dirty    = true;

    this._defaultMode     = 'vortex';
    this._defaultStrength = 1.0;

    this._sdfRT = new THREE.WebGLRenderTarget(128, 128, {
      format:        THREE.RGBAFormat,
      type:          THREE.FloatType,
      minFilter:     THREE.LinearFilter,
      magFilter:     THREE.LinearFilter,
      depthBuffer:   false,
      stencilBuffer: false,
    });
    this._sdfScene  = new THREE.Scene();
    this._sdfCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    // Persistent typed arrays mutated in-place — Three.js uploads via gl.uniform4fv
    this._ghostA = new Float32Array(64); // 16 × vec4
    this._ghostB = new Float32Array(64);

    this._sdfMat = new THREE.RawShaderMaterial({
      vertexShader:   GHOST_SDF_VERT,
      fragmentShader: GHOST_SDF_FRAG,
      uniforms: {
        uGhostA:     { value: this._ghostA },
        uGhostB:     { value: this._ghostB },
        uGhostCount: { value: 0 },
      },
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._sdfMat);
    this._sdfScene.add(quad);
  }

  _modeToFloat(mode) {
    if (typeof mode === 'number') return mode;
    return MODE_MAP[mode] ?? 0.0;
  }

  add(x, y, options = {}) {
    const id = this._nextId++;
    this._nodes.set(id, {
      id,
      pos:      [x, y],
      radius:   options.radius   ?? 0.05,
      shape:    options.shape    ?? 0,
      mode:     this._modeToFloat(options.mode ?? this._defaultMode),
      strength: options.strength ?? this._defaultStrength,
      source:   options.source   ?? 'manual',
      _fadeEnd: null,
    });
    this._dirty = true;
    return id;
  }

  update(id, options) {
    const node = this._nodes.get(id);
    if (!node) return;
    if (options.pos      !== undefined) node.pos      = options.pos;
    if (options.strength !== undefined) node.strength = options.strength;
    if (options.radius   !== undefined) node.radius   = options.radius;
    if (options.mode     !== undefined) node.mode     = this._modeToFloat(options.mode);
    this._dirty = true;
  }

  remove(id) {
    if (this._nodes.delete(id)) this._dirty = true;
  }

  scheduleFade(id, ms) {
    const node = this._nodes.get(id);
    if (node) node._fadeEnd = performance.now() + ms;
  }

  clear(source) {
    let changed = false;
    for (const [id, node] of this._nodes) {
      if (node.source === source) { this._nodes.delete(id); changed = true; }
    }
    if (changed) this._dirty = true;
  }

  setMode(mode) { this._defaultMode = mode; }
  setStrength(s) { this._defaultStrength = s; }

  updateFromVideo(brightPeaks) {
    this.clear('video');
    const peaks = brightPeaks.slice(0, 8);
    for (const p of peaks) {
      this.add(p.x, p.y, { mode: 'attract', source: 'video', radius: 0.04 });
    }
  }

  tick(now) {
    let changed = false;
    for (const [id, node] of this._nodes) {
      if (node._fadeEnd !== null && now >= node._fadeEnd) {
        this._nodes.delete(id);
        changed = true;
      }
    }
    if (changed) this._dirty = true;
  }

  // Returns cached RT; only re-renders when nodes changed (_dirty).
  buildSDFTexture(renderer) {
    if (!this._dirty) return this._sdfRT;

    const nodes = Array.from(this._nodes.values()).slice(0, GhostNodes.MAX);

    this._ghostA.fill(0);
    this._ghostB.fill(0);
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      this._ghostA[i*4+0] = n.pos[0];
      this._ghostA[i*4+1] = n.pos[1];
      this._ghostA[i*4+2] = n.radius;
      this._ghostA[i*4+3] = n.mode;
      this._ghostB[i*4+0] = n.strength;
      this._ghostB[i*4+1] = n.shape;
    }
    this._sdfMat.uniforms.uGhostCount.value = nodes.length;

    renderer.setRenderTarget(this._sdfRT);
    renderer.render(this._sdfScene, this._sdfCamera);
    renderer.setRenderTarget(null);

    this._dirty = false;
    return this._sdfRT;
  }

  dispose() {
    this._sdfRT.dispose();
    this._sdfMat.dispose();
    this._sdfScene.children[0]?.geometry.dispose();
  }
}
