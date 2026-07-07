# ImWeb — Particle Engine v2 · Architecture Spec

**Purpose:** Full redesign of the Mapping/Particles module as a GPU-accelerated, performable instrument.  
**Workflow:** Claude Chat (architecture) → Claude Code (implementation) · one feature per commit.

---

## New Module Files

```
src/
  particles/
    ParticleEngine.js       — orchestrator, public API
    ParticleGPU.js          — ping-pong FBO, position texture, update shader
    ForceField.js           — composable 4-layer force field, blend weights
    ForceFormulas.js        — formula library: 6 flow-field algorithms
    GhostNodes.js           — invisible force shapers (SDF volumes)
    PointerPerf.js          — performance surface: 6 pointer modes
    ParticleRender.js       — trail accumulation, color mapping, draw pass
    ParticleMIDI.js         — MIDI/OSC parameter binding
    VideoAnalysis.js        — frame analysis: luma gradient, motion, chroma peaks
```

---

## 1 · GPU Backend — `ParticleGPU.js`

### Concept

Particles never leave the GPU. Position and velocity are stored as RGBA float textures in a ping-pong pair of `WebGLRenderTarget`s. Each frame: read `textureA` → update shader → write `textureB` → swap.

### Texture layout

```glsl
// Each texel = one particle
// RG = position XY (normalized 0–1 screen space)
// BA = velocity XY
uniform sampler2D positionTex;  // current state
```

Texture dimensions: `ceil(sqrt(N)) × ceil(sqrt(N))` — e.g. 1024×1024 = ~1M particles.

### API

```js
class ParticleGPU {
  constructor(renderer, count = 100_000)

  // Textures
  positionTex   // WebGLRenderTarget — current
  prevTex       // WebGLRenderTarget — previous (for trail)

  // Per-frame
  update(forceFieldTexture, ghostBuffer, dt)  // runs update shader
  swap()                                       // ping-pong swap

  // Particle management
  respawn(mode)  // 'random' | 'center' | 'lorenz' | 'video'
  setCount(n)
}
```

### Update shader skeleton (`particle_update.glsl`)

```glsl
uniform sampler2D positionTex;
uniform sampler2D forceFieldTex;  // RGBA: force XY in RG, magnitude in B, type in A
uniform sampler2D ghostTex;       // signed distance field, 4 ghost channels

uniform float dt;
uniform float inertia;      // 0=pure force, 1=pure momentum
uniform float lifeDecay;    // per-frame age increment
uniform float worldWrap;    // 0=kill OOB, 1=wrap

void main() {
  vec2 uv = vUv;
  vec4 state = texture2D(positionTex, uv);
  vec2 pos = state.rg;
  vec2 vel = state.ba;

  // Sample composited force field at particle position
  vec4 field = texture2D(forceFieldTex, pos);
  vec2 force = field.rg * field.b;   // direction × magnitude

  // Ghost SDF repulsion/attraction
  float ghostDist = texture2D(ghostTex, pos).r;
  vec2 ghostGrad  = texture2D(ghostTex, pos).gb * 2.0 - 1.0;
  force += ghostGrad * ghostMode * ghostStrength / (ghostDist + 0.01);

  // Integrate
  vel = mix(force, vel, inertia);
  pos += vel * dt;

  // Boundary
  if (worldWrap > 0.5) pos = fract(pos);
  else if (pos.x < 0.0 || pos.x > 1.0 || pos.y < 0.0 || pos.y > 1.0) {
    pos = respawnPosition(uv);   // helper: random / center / lorenz seed
    vel = vec2(0.0);
  }

  gl_FragColor = vec4(pos, vel);
}
```

---

## 2 · Force Field Composition — `ForceField.js`

Four independently blendable layers. The compositor renders each layer to its own texture, then blends into a single `forceFieldTex` passed to the update shader.

### Blend weights

```js
// Exposed as performable MIDI-mappable params (0.0–1.0 each, auto-normalized)
weights = {
  gradient: 0.4,   // w₁ — video luma gradient
  flow:     0.3,   // w₂ — algorithmic flow formula
  nbody:    0.1,   // w₃ — particle↔particle
  ghost:    0.2,   // w₄ — ghost nodes + pointer
}
// Compositor normalizes: Σwᵢ = 1
```

### Layer 1 — Gradient Field (`gradient_layer.glsl`)

```glsl
// Input: video frame (sampler2D videoTex)
// Output: force XY from luma gradient

vec2 gradientForce(vec2 uv, sampler2D videoTex, float strength, bool invert) {
  float eps = 0.002;
  float L  = dot(texture2D(videoTex, uv).rgb,          vec3(0.299, 0.587, 0.114));
  float Lx = dot(texture2D(videoTex, uv+vec2(eps,0)).rgb, vec3(0.299, 0.587, 0.114));
  float Ly = dot(texture2D(videoTex, uv+vec2(0,eps)).rgb, vec3(0.299, 0.587, 0.114));
  vec2 grad = vec2(Lx - L, Ly - L) / eps;
  return invert ? -grad * strength : grad * strength;
}
```

### Layer 2 — Flow Field (`ForceFormulas.js`)

Selectable formula. One active at a time; cross-fade blend supported.

```js
class ForceFormulas {
  // Each returns GLSL source for the flow function
  // Called formula(vec2 pos, float t, ...params) → vec2 force

  static CURL_NOISE   = 'curl'       // organic, divergence-free
  static LORENZ       = 'lorenz'     // strange attractor 2D projection
  static MAGNETIC     = 'magnetic'   // dipole/multipole field lines
  static REACTION_DIFF = 'rd'        // Gray-Scott concentration gradient
  static VORTEX_SHED  = 'karman'     // Kármán vortex street
  static BOIDS        = 'boids'      // flocking + video gradient steering

  static getGLSL(formula)   // returns GLSL snippet
  static getParams(formula) // returns { name, min, max, default }[]
}
```

#### Lorenz formula (GLSL)

```glsl
// Projects Lorenz attractor onto XY, uses particle Z-analog from noise
vec2 lorenzFlow(vec2 pos, float t, float rho, float sigma, float beta) {
  // Map screen coords to Lorenz phase space
  vec2 p = (pos - 0.5) * 40.0;
  float z = 20.0 + 10.0 * sin(t * 0.1 + pos.x * 3.0 + pos.y * 2.0);

  float dx = sigma * (p.y - p.x);
  float dy = p.x * (rho - z) - p.y;
  // dz omitted — used as modulation only

  return normalize(vec2(dx, dy)) * 0.8;
}
// Bifurcation: rho 1→24 single lobe, 24→28 transition, 28+ butterfly
// Live rho sweep = live phase transition — key performance gesture
```

#### Curl noise formula (GLSL)

```glsl
// Divergence-free flow — particles never pile up
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5); }

float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x),
             mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

vec2 curlNoise(vec2 pos, float t, float scale, float speed) {
  vec2 p = pos * scale;
  float eps = 0.01;
  float n1 = noise(vec2(p.x, p.y + eps) + t * speed);
  float n2 = noise(vec2(p.x, p.y - eps) + t * speed);
  float n3 = noise(vec2(p.x + eps, p.y) + t * speed);
  float n4 = noise(vec2(p.x - eps, p.y) + t * speed);
  return vec2((n1 - n2), -(n3 - n4)) / (2.0 * eps);
}
```

#### Magnetic dipole (GLSL)

```glsl
// poles[] driven by video brightness peaks (up to 8 poles)
// polarity: +1 attract, -1 repel
vec2 magneticFlow(vec2 pos, vec2 poles[8], float polarity[8], int poleCount) {
  vec2 total = vec2(0.0);
  for (int i = 0; i < 8; i++) {
    if (i >= poleCount) break;
    vec2 r = pos - poles[i];
    float d2 = dot(r, r) + 0.001;
    total += polarity[i] * r / (d2 * sqrt(d2));  // dipole falloff r⁻²
  }
  return normalize(total) * 0.6;
}
// Poles placed at video brightness peaks — video geometry IS the field
```

### Layer 3 — N-body (`nbody_layer.glsl`)

```glsl
// Approximate: sample N random texels from positionTex each frame
// Full N-body at 100k is O(N²) — use spatial hash or Barnes-Hut approximation

uniform sampler2D positionTex;
uniform float attractRadius;
uniform float falloffExp;     // 1=linear, 2=gravity, 3=strong nuclear

vec2 nbodyForce(vec2 pos, vec2 vel) {
  vec2 acc = vec2(0.0);
  for (int i = 0; i < 32; i++) {   // sample 32 neighbors per frame
    vec2 randUV = hash2(vec2(float(i), time));
    vec2 otherPos = texture2D(positionTex, randUV).rg;
    vec2 delta = otherPos - pos;
    float d = length(delta);
    if (d < attractRadius && d > 0.001) {
      acc += normalize(delta) / pow(d, falloffExp);
    }
  }
  return acc * 0.01;
}
```

### Layer 4 — Ghost / User (see Section 3)

---

## 3 · Ghost Node System — `GhostNodes.js`

### Concept (from `jit.phys.ghost`)

Invisible physics bodies. Each ghost has:
- `position` (vec2)
- `shape`: `sphere` | `box` | `plane` | `torus` | `sdf_custom`
- `mode`: `attract` | `repel` | `vortex` | `turbulence` | `channel`
- `strength` (float)
- `radius` (float)
- `source`: `'manual'` | `'video'` | `'pointer'`

### API

```js
class GhostNodes {
  nodes = []           // GhostNode[]

  add(x, y, options)   // place ghost at screen coords
  remove(id)
  clear()
  setMode(mode)        // global default mode
  setStrength(s)       // global default strength

  // Video-driven ghost placement
  updateFromVideo(videoAnalysis) {
    // videoAnalysis.brightnessPeaks → place attract ghosts
    // videoAnalysis.motionVectors  → create turbulence ghosts
    // videoAnalysis.edges          → create plane ghosts along edges
  }

  // Bakes current ghost configuration to SDF texture for GPU
  buildSDFTexture(renderer) → WebGLRenderTarget
}
```

### Ghost SDF shader

```glsl
// For each ghost, compute signed distance and gradient at UV
// Output: R = nearest distance, GB = gradient (encoded 0.5+0.5*n), A = mode

float sdSphere(vec2 p, vec2 center, float r) { return length(p - center) - r; }
float sdBox(vec2 p, vec2 center, vec2 size) { /* ... */ }
float sdTorus2D(vec2 p, vec2 center, float R, float r) { /* ... */ }

// Composited: nearest ghost wins, gradient from finite difference
```

### Pointer mode → ghost creation mapping

```
~ Flow       → temporary turbulence ghost at pointer, fades on release
⊕ Source     → emission ghost: spawns particles at pointer position
⊗ Sink       → attract ghost with high decay rate (particles absorbed)
↺ Vortex     → vortex ghost: strength = pointer hold duration
∿ Turbulence → turbulence ghost: radius = gesture radius
✦ Freeze     → zero-force ghost: particles inside freeze in place
```

---

## 4 · Performance Surface — `PointerPerf.js`

```js
class PointerPerf {
  mode = 'flow'           // current active mode
  activeGhost = null      // current pointer ghost node

  // Mode switch — keyboard shortcut or UI button
  setMode(mode)           // '~' | '⊕' | '⊗' | '↺' | '∿' | '✦'

  // Pointer events
  onPointerDown(x, y, pressure)
  onPointerMove(x, y, pressure)
  onPointerUp(x, y)

  // Multi-touch: each touch point independently creates a ghost
  onTouchStart(touches)
  onTouchMove(touches)
  onTouchEnd(touches)
}
```

### Vortex mode — pressure/hold mapping

```js
onPointerDown(x, y) {
  this.vortexStart = performance.now()
  this.activeGhost = ghostNodes.add(x, y, { mode: 'vortex', strength: 0 })
}
onPointerMove(x, y) {
  const holdTime = (performance.now() - this.vortexStart) / 1000
  const strength = Math.min(holdTime * 2.0, 4.0)  // grows with hold
  this.activeGhost.strength = strength
  this.activeGhost.position = [x, y]
}
onPointerUp() {
  // Vortex persists for 3s then fades — it has inertia
  ghostNodes.scheduleFade(this.activeGhost, 3000)
}
```

---

## 5 · MIDI / OSC Parameter Table — `ParticleMIDI.js`

| Parameter | Type | Range | Instrument analogy |
|---|---|---|---|
| `weight.gradient` | CC | 0–1 | — |
| `weight.flow` | CC | 0–1 | — |
| `weight.nbody` | CC | 0–1 | — |
| `weight.ghost` | CC | 0–1 | — |
| `trailDecay` | CC | 0.70–0.99 | Reverb time |
| `fieldStrength` | CC | 0–4 | Gain |
| `inertia` | CC | 0–1 | Resonance |
| `birthRate` | CC | 0–1 | Attack/sustain |
| `lifespan` | CC | 0.1–10s | Envelope |
| `particleCount` | CC | 1k–1M | Texture density |
| `lorenz.rho` | CC | 1–60 | Timbre (bifurcation) |
| `lorenz.sigma` | CC | 1–20 | — |
| `lorenz.beta` | CC | 0.1–8 | — |
| `flowFormula` | CC | 0–5 | Oscillator type |
| `colorMode` | CC | 0–3 | — |
| `ghostStrength` | CC | 0–4 | Filter cutoff |
| `attractRadius` | CC | 0–0.5 | Chorus width |
| `pointerMode` | CC | 0–5 | — |
| `freeze` | Note | — | Freeze trigger |
| `respawn` | Note | — | Reset trigger |

```js
class ParticleMIDI {
  bind(ccNumber, paramPath, options = {})
  // options: { min, max, curve: 'linear'|'exp', smooth: 0.05 }
  // smooth: lerp factor per frame — prevents zipper noise (like Barlowgen tonality)

  // OSC via WebSocket bridge
  bindOSC(address, paramPath, options)

  // MIDI learn: right-click any slider → next CC binds
  startLearn(paramPath)
  stopLearn()
}
```

---

## 6 · Render Pipeline — `ParticleRender.js`

### Trail accumulation

```js
// Each frame:
// 1. Draw fade rect over trail buffer (alpha = 1 - trailDecay)
// 2. Render current particle positions as points onto trail buffer
// 3. Blit trail buffer to screen

// Fade shader: single fullscreen quad
// gl_FragColor = texture2D(trailTex, vUv) * vec4(trailDecay);

// Point render shader:
// - reads position from positionTex (indexed by vertex ID)
// - outputs colored point (size 1–3px based on velocity)
```

### Color modes

```glsl
// Mode 0: velocity
vec3 colorFromVelocity(vec2 vel) {
  float speed = length(vel);
  return mix(vec3(0.1, 0.2, 0.8), vec3(1.0, 0.3, 0.1), clamp(speed / 3.0, 0.0, 1.0));
}

// Mode 1: age
vec3 colorFromAge(float age) {
  // age: 0=new (bright), 1=old (faded)
  return mix(vec3(1.0, 0.9, 0.7), vec3(0.1, 0.1, 0.3), age);
}

// Mode 2: field alignment
vec3 colorFromAlignment(vec2 vel, vec2 fieldDir) {
  float align = dot(normalize(vel), fieldDir) * 0.5 + 0.5;
  return mix(vec3(0.0, 0.5, 1.0), vec3(1.0, 0.8, 0.0), align);
}

// Mode 3: video sample at particle position
vec3 colorFromVideo(vec2 pos, sampler2D videoTex) {
  return texture2D(videoTex, pos).rgb;
}
```

---

## 7 · Video Analysis — `VideoAnalysis.js`

```js
class VideoAnalysis {
  // Called once per frame, reads video texture via offscreen canvas
  update(videoElement) {
    this.frame        // ImageData
    this.lumaGrad     // Float32Array — gradient magnitude per pixel
    this.motionVecs   // vec2[] — frame diff vectors
    this.brightPeaks  // vec2[] — top-N local maxima (ghost attractor positions)
    this.edgeMap      // Float32Array — Sobel edge strength
    this.chromaPeaks  // { hue, pos }[] — dominant color regions
  }

  // Returns GPU texture for gradient layer
  getLumaGradientTexture(renderer) → WebGLRenderTarget
}
```

---

## 8 · Integration with Existing ImWeb

### In `ParticleEngine.js` (orchestrator)

```js
// Replaces current Particles.js
class ParticleEngine {
  constructor(renderer, videoElement, midiAccess)

  // Called from main render loop
  update(dt) {
    this.videoAnalysis.update(this.videoElement)
    this.ghostNodes.updateFromVideo(this.videoAnalysis)
    this.forceField.composite()           // bake 4-layer blend to forceFieldTex
    this.gpu.update(forceFieldTex, ghostSDFTex, dt)
    this.gpu.swap()
    this.render.draw()
  }

  // Public API (same interface as old Particles.js for UI compatibility)
  setParam(key, value)
  getParam(key)
  respawn(mode)
  setPointerMode(mode)
}
```

### Files to modify in existing ImWeb

```
src/Particles.js              → replace with ParticleEngine.js (keep same export name)
src/UI/ParticleControls.js    → add blend sliders, formula selector, MIDI learn
src/UI/PerformanceSurface.js  → add mode switcher (6 buttons, keyboard shortcuts 1–6)
src/mapping.js                → register ParticleMIDI bindings
```

---

## 9 · Implementation Phases

### Phase A — GPU foundation (commit: `feat: particle GPU ping-pong FBO`)
- `ParticleGPU.js`: position texture, basic update shader (inertia + damping only)
- `ParticleRender.js`: point rendering + trail accumulation
- Verify: 100k particles at 60fps

### Phase B — Force layers (commit: `feat: particle force field composition`)
- `ForceField.js`: 4-layer compositor
- `ForceFormulas.js`: curl noise + Lorenz only (others add incrementally)
- `VideoAnalysis.js`: luma gradient texture
- Verify: gradient + curl blend, video driving field

### Phase C — Ghost nodes (commit: `feat: particle ghost node system`)
- `GhostNodes.js`: SDF texture bake, attract/repel/vortex modes
- `PointerPerf.js`: 6 pointer modes
- Verify: place ghost, see particle response

### Phase D — MIDI + remaining formulas (commit: `feat: particle MIDI OSC mapping`)
- `ParticleMIDI.js`: full parameter table, smooth lerp
- `ForceFormulas.js`: magnetic, R-D, vortex shedding, boids
- Video-driven ghost placement

### Phase E — UI integration (commit: `feat: particle performance surface UI`)
- Blend sliders with same feel as Barlowgen tonality slider
- Formula selector (like oscillator type switch)
- Color mode toggle
- MIDI learn right-click

---

## 10 · Key Design Invariants

1. **Video IS the field** — not just color source. Luma gradient drives Layer 1 at all times.
2. **Ghost nodes are always invisible** — they leave no visual artifact, only particle traces.
3. **All continuous params go through smooth lerp** — `currentVal = lerp(currentVal, targetVal, 0.05)` per frame. No zipper noise.
4. **Lorenz rho is the primary timbral control** — map it to the most accessible MIDI fader.
5. **Trail decay is reverb** — treat it with the same respect as a reverb send in a mix.
6. **The Lorenz → Ghost → Video chain** is the conceptual core:  
   Lorenz field (global physics) ←→ Ghost nodes (local edit) ←→ Video analysis (dynamic input)

