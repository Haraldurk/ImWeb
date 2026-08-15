# KNOWN-ISSUES.md — ImWeb Active Issues

Claude Code: read this before touching any related code.
When an issue is fixed, move it to the Resolved table with version and commit.

---

## Active

### One preload clip times out racking, but scans fine
**Symptom:** on startup, `200628_155535_mirror clip_ALL-I.mp4` logs
`Timed out loading … after 8s` and Deck A racks 7 clips instead of 8. The clip
appears in the Movie Library with a correct duration (10.0s) and thumbnail, so
the *scan* path succeeds and only the *rack* path fails.
**Suspicion:** it is the only filename in `_imweb_ready/` containing a space.
`main.js:7901` builds the src with `encodeURIComponent(name)`, and v0.14 already
fixed one percent-encoding bug on this exact file (a clip showing as
`mirror%20clip`). Verified NOT a server problem: a range request for
`200628_155535_mirror%20clip_ALL-I.mp4` returns 206 with a correct
`Content-Range` and `ftyp` as the first atom, on both dev and preview.
**Not** the byte ceiling — that explains 7-of-8 racking in general, but not why
this specific clip is the one that fails while 16 others scan.
**Status:** deferred 2026-07-29, owner's call. Reproduces on dev and preview.
**Related files:** src/inputs/MovieInput.js (`addClip`), src/main.js:7891–7930

---

### xController override re-applies response table (double-shaping)
**Symptom:** a param with both a table and an xController gets the curve
applied twice on the override write — response feels steeper than the curve.
**Cause:** since 5a3cd15 table resolution lives in `Parameter.setNormalized`;
the xController path (ControllerManager ~:188) re-writes through it after the
primary controller already shaped the value.
**Status:** edge case, low priority; fix would pass an explicit no-table
sentinel from the xController write.
**Related files:** src/controls/ParameterSystem.js, src/controls/ControllerManager.js

---

### ~~VasulkaWarp architecture (design decision pending)~~ — RESOLVED 2026-07-30
**Every claim in the old entry was wrong**, which is why it sat open since before
v0.9. It read: *"intentionally hidden from UI pending architecture decision;
strip-buffer approach conflicts with the pipeline source model; candidate
direction: treat as a Sequence slot backed by IndexedDB."*

- **Not hidden** — the panel was restored in Phase 24 (`index.html`), and the
  source has been live in the inputs bag throughout.
- **The strip buffer is the CORRECT structure, not a conflict.** It stores one
  column per time step: 8.3 MB buys ~1920 steps at full resolution, where the
  frame ring stores a whole frame per step (~147 MB for 120). For an axis-aligned
  shear it is ~18× cheaper and sharper. It is the fast path; TimeDisplaceEngine is
  the general case. The IndexedDB candidate is struck.
- **It is not a slit-scan** despite the name. A slit-scan multiplies ONE fixed
  column across space (`SlitScanBuffer`); this offsets each column in time at its
  own position — a shear, the same operation as `td.mode = "Shear X"`.

Renamed to **Warp Tape**, under the new `Warp` panel family that also holds Time
Displace, Slit Scan and Video Delay. See `docs/ImWeb-Spacetime-Blueprint.md` §5d.

Real bugs found and fixed while resolving it: the tape was allocated at canvas
width while the head wrapped at `bufSize`, so any setting below 1920 swept only
part of the frame; `resize()` overwrote the time depth; the boot construction
ignored the saved `vwarp.bufsize`; capture had no null guard, so an inactive
source erased the tape one column per frame; and the write head never reached the
read shader. Gained `vwarp.source`, `anchor`, `pos`, `span`, `clear`.

**Still open, deliberately:** a *vertical time* axis, and `vwarp.angle`. Both need
`capture()` to scissor along a different axis — the tape conflates "which source
column" with "which moment" on one axis, so rotating the read rotates the picture
and time together. Capture-side work, not a uniform. Note the existing
`Warp axis` control is NOT that: it redirects the read controls onto the picture's
y, which is a second geometric axis and works as intended.
**Related files:** src/inputs/VasulkaWarp.js, tests/vasulka-tape.html

---

### Rutt-Etra stalls while dragging Lines near the top of its range
**Symptom:** With `rutt.lines` above roughly 700, dragging the Lines control
stutters or briefly freezes the instrument. Setting a value by double-click and
typing it is smooth; it is the drag that hurts, because every step is a new
value.
**Status:** Known cost, accepted deliberately in v0.21.0 rather than a defect to
fix blind. `_rebuild()` walks the whole lattice in JS and reallocates its buffers
on any change of line count — at the 1080 maximum that is a 1080×2048 grid,
~4.4M vertices and a 51MB index buffer, per step. The range was raised because
the knob's top half previously did nothing at all (horizontal sampling was
pinned at 512), and a knob that is slow at its extreme is better than one that
is inert there. The default is unchanged at 120.
**If it is worth fixing:** debounce the rebuild while a drag is in flight and
rebuild once on release, or grow the lattice in place rather than reallocating.
Neither was done because nobody has yet reported it from real use — the range
only reached 1080 in v0.21.0.
**Related files:** src/inputs/RuttEtra.js (`_rebuild`, `colsFor`)

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
