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
//
// Six modes encoded in uGhostA[i].w:
//   0.0 attract  0.2 repel  0.4 flow  0.6 vortex  0.8 turbulence  1.0 freeze
const GHOST_SDF_FRAG = /* glsl */`
precision highp float;
uniform vec4  uGhostA[16];   // .xy=pos, .z=radius, .w=mode
uniform vec4  uGhostB[16];   // .x=strength (signed, signed-squared from CPU), .y=shape (0=sphere,1=box)
uniform int   uGhostCount;
uniform vec2  uFlowVec;      // current pointer velocity (for flow mode)
uniform float uTime;         // elapsed seconds (for turbulence animation)
varying vec2  vUv;

float sdSphere(vec2 p, vec2 c, float r) { return length(p - c) - r; }
float sdBox(vec2 p, vec2 c, float r) {
  vec2 d = abs(p - c) - vec2(r);
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// Cheap 2D hash for turbulence
vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}

void main() {
  vec2  acc     = vec2(0.0);
  float freezeW = 0.0;

  for (int i = 0; i < 16; i++) {
    if (i < uGhostCount) {
      vec2  c    = uGhostA[i].xy;
      float r    = max(uGhostA[i].z, 0.001);
      float mode = uGhostA[i].w;
      float str  = uGhostB[i].x;   // signed (signed-squared from CPU)

      float d     = uGhostB[i].y > 0.5 ? sdBox(vUv, c, r) : sdSphere(vUv, c, r);
      float dSoft = max(abs(d), 0.001);
      // Softer singularity (0.05 vs 0.01) keeps source/sink usable at high strength
      float gF    = abs(str) / (dSoft * dSoft + 0.05);

      vec2 diff = vUv - c;
      vec2 grad = length(diff) > 0.0001 ? normalize(diff) : vec2(0.0, 1.0);
      float s   = str >= 0.0 ? 1.0 : -1.0;

      if (mode < 0.1) {
        // ATTRACT / SINK — gravitational pull toward centre
        acc -= grad * gF * s;

      } else if (mode < 0.3) {
        // REPEL / SOURCE — radial explosion outward
        acc += grad * gF * s;

      } else if (mode < 0.5) {
        // FLOW — directional sweep in pointer velocity direction, same gF scale as attract/repel
        float spd = length(uFlowVec);
        if (spd > 0.0001) {
          // saturate: slow pointer = proportional force, fast pointer = full gF
          acc += (uFlowVec / spd) * gF * clamp(spd * 6.0, 0.0, 1.0);
        }

      } else if (mode < 0.7) {
        // VORTEX — tangential spin; 1/d² makes inner particles spin faster (whirlpool)
        acc += vec2(-grad.y, grad.x) * gF * s;

      } else if (mode < 0.9) {
        // TURBULENCE — random noise direction × same gF scale as attract/repel
        vec2 noiseCoord = vUv * 18.0 + vec2(uTime * 0.6, -uTime * 0.4);
        acc += hash2(noiseCoord) * gF;

      } else {
        // FREEZE — accumulate velocity-damping weight
        freezeW += gF;
      }
    }
  }

  gl_FragColor = vec4(acc.x, acc.y, freezeW, 0.0);
}
`;

// Six pointer modes — values must match shader thresholds above
const MODE_MAP = { attract: 0.0, repel: 0.2, flow: 0.4, vortex: 0.6, turbulence: 0.8, freeze: 1.0 };

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
        uFlowVec:    { value: new THREE.Vector2(0, 0) },
        uTime:       { value: 0 },
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
    if (!node) return;
    const now = performance.now();
    node._fadeStart    = now;
    node._fadeEnd      = now + ms;
    node._fadeStrength = node.strength; // snapshot strength at lift so we interpolate from here
  }

  clear(source) {
    let changed = false;
    for (const [id, node] of this._nodes) {
      if (node.source === source) { this._nodes.delete(id); changed = true; }
    }
    if (changed) this._dirty = true;
  }

  setMode(mode)        { this._defaultMode = mode; }
  setStrength(s)       { this._defaultStrength = s; }
  // Called by PointerPerf each move event when in flow mode
  setFlowVec(x, y)     { this._sdfMat.uniforms.uFlowVec.value.set(x, y); this._dirty = true; }

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
      if (node._fadeEnd === null) continue;
      if (now >= node._fadeEnd) {
        this._nodes.delete(id);
        changed = true;
      } else if (node._fadeStart !== undefined) {
        // Interpolate strength → 0 over the fade window so only particle forces taper,
        // not the frame trail. Use ease-out cubic so the tail lingers naturally.
        const t = (now - node._fadeStart) / (node._fadeEnd - node._fadeStart); // 0→1
        const ease = 1 - t * t * t; // cubic ease-out
        node.strength = node._fadeStrength * ease;
        changed = true; // rebuild SDF every tick while fading
      }
    }
    if (changed) this._dirty = true;
  }

  // Returns cached RT; accepts time for flow/turbulence modes which need per-frame re-render.
  buildSDFTexture(renderer, time = 0) {
    // Flow and turbulence change every frame (velocity / noise animation) — always rebuild
    const allNodes = Array.from(this._nodes.values());
    if (allNodes.some(n => n.mode >= 0.35 && n.mode < 0.85)) this._dirty = true;

    if (!this._dirty) return this._sdfRT;
    this._sdfMat.uniforms.uTime.value = time;

    const nodes = allNodes.slice(0, GhostNodes.MAX);

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
