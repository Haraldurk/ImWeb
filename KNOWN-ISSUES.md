# KNOWN-ISSUES.md — ImWeb Active Issues

Claude Code: read this before touching any related code.
When an issue is fixed, move it to the Resolved table with version and commit.

---

## Active

### VasulkaWarp architecture (design decision pending, not a crash bug)
**Current state:** VasulkaWarp.js and `vwarp.*` params exist and run; feature
intentionally hidden from UI pending architecture decision
**Problem:** strip-buffer approach conflicts with the pipeline source model
**Candidate direction:** treat as a Sequence slot backed by IndexedDB rather
than a live GPU ring buffer
**Related files:** src/inputs/VasulkaWarp.js, src/core/Pipeline.js

---

### Period values above ~Scale have no visible effect
**Symptom:** Period values above the Scale value show no visual effect.
**Status:** Deferred; fundamental tile-size vs tile-count semantics mismatch. Requires passing uScale/uPeriod to psrdnoise (tile-count redesign).
**Related files:** src/shaders/index.js, src/core/Pipeline.js

---

### PsrdWarp gradient discontinuity seams at small period values with Gain > 0
**Symptom:** Seams/crease lines visible in warp at low period values when Gain is greater than 0.
**Status:** Deferred; root cause: mod() on Euclidean float vertices in `psrdnoise_grad` causes gradient hash jumps that propagate through the domain warp accumulation. Requires wrapping integer lattice indices instead of float Euclidean coordinates.
**Related files:** src/shaders/index.js

---

### Textured 3D objects darker than 2D background pipeline
**Symptom:** When a texture source (noise, camera, etc.) is assigned
to a 3D object, the PBR lighting darkens the texture in shadow regions,
creating a brightness mismatch with the flat 2D background pipeline.
Seamless keyer compositing is broken as a result.
**Status:** Deferred. emissiveMap runtime approach attempted and
abandoned — shader recompile path unreliable on live WebGLRenderTarget
textures without material reconstruction. A second emissiveMap session
(a85d909, b3c7737, 2ed4ea5) was reverted in 3da732f, restoring the
textured branch to its pre-session state.
**Future candidates:** MeshBasicMaterial swap on texture assign;
custom onBeforeCompile unlit shader injection.
**Related files:** src/scene3d/SceneManager.js

---


## Resolved

| Issue | Fixed in | Commit | Notes |
|-------|----------|--------|-------|
| HypercubeFaces mystery bug | ≤v0.11.0 | — | Symptom never documented; owner-confirmed resolved 2026-07-08 |
| Texture source switching reliability | ≤v0.11.0 | — | Symptom never documented; owner-confirmed resolved 2026-07-08 |
| Standard shader depth ordering | ≤v0.11.0 | — | Symptom never documented; owner-confirmed resolved 2026-07-08 |
| Period X/Y sliders display even-only values | ≤v0.11.0 | — | step:1 confirmed in ParameterSystem.js; original report attributed to stale HMR DOM |
| Chrome 148 ANGLE/Metal backend regression | v0.9.0 | — | Fixed upstream by Google (2026-06-10); --use-angle=gl workaround no longer required. Defensive fixes from commit 379d694 (aTB attribute, highp sampler2D/textureLod, SkinnedMesh→Mesh) remain in place |
| PsrdWarp tearing seam at period boundary | v0.9.0 | 1b2ed0a | mod() wrapping removed from warped coordinates |
| Asymmetric period response (left-side / lower-side only) | v0.9.0 | 3d5f6da, a56cdb7 | periodicP centering offset introduced in uType 39 and 40 |
| Animation stutter from wall-clock time | v0.9.0 | 386b7fb | Replaced with capped-dt noiseTime accumulator |
| Speed slider phase jump | v0.9.0 | — | uPhase uniform added, driven by noisePhase accumulator in JS; shader uses t = uPhase + uSeed |
| noisePhase not advancing behind render gates | v0.9.0 | — | Moved before _captureMode and shouldRender early returns |
| Alpha cycling in non-periodic mode | v0.9.0 | — | Unbounded alpha when period = 0, mod() bounding only when period > 0 |
| even-integer period constraint | v0.9.0 | — | step:2 reverted to step:1; even-only enforcement was based on an incorrect diagnosis |
| Pipeline._noiseTime uninitialized | v0.9.0 | — | NaN accumulator fixed with this._noiseTime = 0 in constructor |
| blend.active / feedback.active not gating pipeline passes | v0.8.9 | — | Both now registered in ParameterSystem |
| feedback.active not registered as parameter | v0.8.9 | — | Added to ParameterSystem |
| Active bank lookup used array position instead of index field | v0.8.9 | — | Uses bank.index field now |
| Bundled Models button used wrong SceneManager reference | v0.8.9 | — | Closure fix |
| 3D model lost on save/load | v0.8.8 | 1175e44 | currentModelUrl persisted as modelAsset in .imweb/.imbank |
| Second screen black output when window moved to external display | v0.8.8 | 45fbaa04 | DPR matchMedia listener + webglcontextlost/restored handlers |
| MasterProject not auto-pushed on commit | v0.8.8 | 726e0c0 | npm run push-master + optional post-commit hook |
| Splash version number missing | v0.8.8 | 98fecac | __APP_VERSION__ via Vite define |
| WebGL feedback loop GL_INVALID_OPERATION | v0.8.7 | — | Guard moved into _pass() using identity check; rate-limited warning |
| FG.blend was self-blend (blending texture against itself) | v0.8.7 | — | FG.blend now composites FG over BG using full TRANSFERMODE shader |
| Faces invisible in 3D Scene (visible only in 3D Depth) | v0.8.7 | — | Missing instanceMatrix in ShaderMaterial vertex shader |
