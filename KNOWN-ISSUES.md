# KNOWN-ISSUES.md — ImWeb Active Issues

Claude Code: read this before touching any related code.
When an issue is fixed, move it to the Resolved table with version and commit.

---

## Active

### Chrome 148 ANGLE/Metal backend regression
**Affects:** Hypercube wireframe edges (LineSegments); imported GLB models (SkinnedMesh)
**Platform:** macOS, Chrome 148+, default Metal backend
**Safari / Firefox:** unaffected
**Workaround:** launch Chrome with `--use-angle=gl` (alias `chrome-gl` in `~/.zshrc`)
**Chromium bug:** https://issues.chromium.org/issues/513611558 (filed 2026-05-16, team investigating)
**Partial fix (commit 379d694):**
- aTB attribute replaces gl_VertexID in HypercubeObject edge shader
- highp sampler2D precision declared on vertex-stage samplers
- textureLod replaces texture() in vertex shader displacement and warp paths
- SkinnedMesh → plain Mesh conversion in SceneManager loadGLTF()
**Still needed:** Metal-compatible fix so users without the flag see correct rendering + user notice/banner
**Test method:** run Chrome normally (Metal, no flag) after each fix attempt

---

### HypercubeFaces mystery bug
**Symptom:** [document exact symptom when next encountered]
**Status:** deferred
**Related files:** HypercubeObject.js, SceneManager.js

---

### Texture source switching reliability
**Symptom:** [document exact symptom when next encountered]
**Status:** deferred
**Related files:** SceneManager.js, Pipeline.js

---

### Standard shader depth ordering
**Symptom:** [document exact symptom when next encountered]
**Status:** deferred
**Related files:** SceneManager.js, src/shaders/index.js

---

### VasulkaWarp architecture (design decision pending, not a crash bug)
**Current state:** VasulkaWarp.js and `vwarp.*` params exist and run; feature
intentionally hidden from UI pending architecture decision
**Problem:** strip-buffer approach conflicts with the pipeline source model
**Candidate direction:** treat as a Sequence slot backed by IndexedDB rather
than a live GPU ring buffer
**Related files:** src/inputs/VasulkaWarp.js, src/core/Pipeline.js

---

### Period X/Y sliders display even-only values
**Symptom:** Sliders display even-only values despite `step: 1` in `ParameterSystem.js`.
**Status:** Under investigation; suspected stale browser DOM from HMR — needs hard refresh (Cmd+Shift+R) and DOM inspection if it persists.
**Related files:** src/controls/ParameterSystem.js, src/ui/UI.js

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

## Resolved

| Issue | Fixed in | Commit | Notes |
|-------|----------|--------|-------|
| PsrdWarp tearing seam at period boundary | v0.8.9+ | 1b2ed0a | mod() wrapping removed from warped coordinates |
| Asymmetric period response (left-side / lower-side only) | v0.8.9+ | 3d5f6da, a56cdb7 | periodicP centering offset introduced in uType 39 and 40 |
| Animation stutter from wall-clock time | v0.8.9+ | 386b7fb | Replaced with capped-dt noiseTime accumulator |
| Speed slider phase jump | v0.8.9+ | — | uPhase uniform added, driven by noisePhase accumulator in JS; shader uses t = uPhase + uSeed |
| noisePhase not advancing behind render gates | v0.8.9+ | — | Moved before _captureMode and shouldRender early returns |
| Alpha cycling in non-periodic mode | v0.8.9+ | — | Unbounded alpha when period = 0, mod() bounding only when period > 0 |
| even-integer period constraint | v0.8.9+ | — | step:2 reverted to step:1; even-only enforcement was based on an incorrect diagnosis |
| Pipeline._noiseTime uninitialized | v0.8.9+ | — | NaN accumulator fixed with this._noiseTime = 0 in constructor |
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
