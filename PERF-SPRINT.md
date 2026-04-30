# ImWeb — Performance Findings

Generated: 2026-04-30

---

## Sprint 1 — Forced Reflow

### requestAnimationFrame loops containing DOM reads

| File | Line | DOM reads |
|---|---|---|
| `src/main.js` | 4566 | `canvas.getBoundingClientRect()` @ 5006 (warp grid overlay, conditional) |
| `src/ui/ColorPicker.js` | 160 | `offsetWidth` / `offsetHeight` in `_drawSV()` @ 175, 177 and `_drawHue()` @ 219, 221 — runs per-pointermove |

### setInterval loops containing DOM reads

| File | Line | DOM reads |
|---|---|---|
| `src/main.js` | 1223 | `panel.querySelector(".cm-list")`, `list.querySelectorAll(".cm-remove")` — controller mapping panel, 1s poll |

### Animation loops without DOM reads (audited, clear)

`src/main.js:1513`, `src/controls/ControllerManager.js:703`, `src/inputs/TeletextSource.js:85`, `src/inputs/TeletextUI.js:93`, `src/scene3d/HypercubeUI.js:230`

---

## Sprint 2 — scene3d Investigation — COMPLETE

Finding: scene3d uses shared renderer (no dual-context cost), no parallel 
RAF loop, no shadow map overhead. Full frame cost: DC:13 / Tri:520K at 
locked 60fps / 0 jank. No optimization needed.

Measurement fix: renderer.info.autoReset = false with manual reset before 
first render pass — accumulates all passes correctly.

Status: ✅ Closed — architecture healthy, cost acceptable.

---

## Sprint 3 — Shader Uniform Upload

### Q1: How many shader passes exist total?

**38.** 37 materials built in `_buildMaterials()` at line 817, plus 1 hot-swappable custom GLSL pass (`this._customMat`, set via `setCustomShader()`). Materials enumerated at lines 818–971.

Material list: passthrough, keyer, displace, blend, feedback, transfermode, transfercopy, colorshift, interlace, mirror, warp, fade, solidcolor, noise (BFG), bufferTransform, interp, pixelate, edge, rgbshift, posterize, solarize, colorcorrect, chromakey, kaleidoscope, vignette, bloomExtract, bloomBlurH, bloomBlurV, bloomComposite, pixelsort, filmgrain, feedbackRotate, quadmirror, levels, lut3d, whitebal, vasulka. Plus custom pass.

### Q2: Uniforms set on ALL passes or only active passes?

**Only active passes.** Every shader stage in `render()` (lines 279–542) is individually gated by parameter thresholds. Examples:

| Guard | Line |
|---|---|
| `if (inputs.buffer)` → bufferTransform | 285 |
| `if (frameBlendAmt > 0 && inputs.buffer2)` → blend | 299 |
| `fgColorChanged ? this._pass(...) : fgTex` → colorcorrect | 326 |
| `fgOpacity < 1` → fade | 329 |
| `bgColorChanged ? this._pass(...) : bgTex` → colorcorrect | 338 |
| `bgOpacity < 1` → fade | 341 |
| `if (displAmt > 0)` → displace | 385 |
| `if (p.get('keyer.active').value)` → keyer | 398 |
| `if (p.get('keyer.chroma').value)` → chromakey | 420 |
| `if (warpIdx > 0 && warpAmt > 0 && inputs.warpMaps?.[...])` → warp | 435 |
| `if (p.get('blend.active').value)` → feedback+blend | 445 |
| `if (cs > 0)` → colorshift | 485 |
| `for (const fx of this.fxOrder)` → each FX has threshold early-return | 494 |
| `if (il > 0)` → interlace | 500 |
| `if (fadeAmt < 1)` → fade | 509 |
| `if (this._customActive && this._customMat)` → custom | 518 |

### Q3: Is there any guard that skips uniform upload for inactive passes?

**Yes.** See Q2 — every pass is individually gated. When inactive, no `_pass()` call occurs, so no uniform traversal, no render, no ping-pong buffer flip. Post-FX chain (`fxOrder` loop at line 494) also has per-FX early-return thresholds inside each `_FX` handler (e.g., line 37: `if (amt <= 1) return tex;`).

One notable case: the keyer, when inactive at line 414, uses `keyed = displaced` — a true pointer skip with zero GPU work. Line 399 reads `p.get('keyer.and_displace').value` to decide routing but this is a parameter read, not a shader path.

### Q4: Top 5 uniforms by material count

Every material inherits base uniforms from `_mat()` (line 800): `uTexture`, `uFG`, `uBG`, `uDS`. All 37 materials declare these four. Counting only *extra* uniforms (beyond the base four), top 5 by material count:

| Uniform | Materials declaring it | Count |
|---|---|---|
| `uResolution` | feedback, interp, pixelate, edge, bloomBlurH, bloomBlurV, custom, pixelsort | 8 |
| `uAmount` | pixelate, edge, rgbshift, vignette, fade, interlace | 6 |
| `uMode` | transfermode, interp, quadmirror, pixelsort | 4 |
| `uTime` | interlace, filmgrain, noise, custom | 4 |
| `uThreshold` / `uStrength` / `uShift` | solarize, bloomExtract, pixelsort, colorshift, warp | 5 (varying names) |

`uResolution` is the most frequently set per-frame uniform across the extra set — written on 8 materials even when `this.width`/`this.height` haven't changed. Each set calls `Vector2.set()` (line 39, 46, 122, 126, 169, 462, 521, 529).

### Q5: Is there a per-frame loop that iterates all materials?

**No.** No loop iterates all 37 materials. The `render()` function is a sequential chain where each stage is individually gated. The only loop is the `fxOrder` iteration at line 494, which visits only the entries in `DEFAULT_FX_ORDER` (line 28: 15 entries) and each handler early-returns if its threshold is at the "off" value — no `_pass()`, no uniform set, no render.

---

## Sprint 3b — Controller GC Audit

### Q1: How many controller types iterate per frame in `tick()`?

**7 controller categories** processed in `tick()` (lines 61–122):

| # | Controller type | Loop | Line |
|---|---|---|---|
| 1 | LFO | `this.lfos.forEach(...)` | 63 |
| 2 | Expression | `this.exprs.forEach(...)` | 71 |
| 3 | Random | `this.randoms.forEach(...)` | 83 |
| 4 | Global rand (rand1/2/3) | `this.ps.getAll().forEach(...)` — gated on `p.controller` | 100 |
| 5 | xControllers | Same `ps.getAll()` loop — gated on `p.xControllers?.length` | 107 |
| 6 | Sound | `if (this.sound) this.sound.tick()` — single call | 118 |
| 7 | Gamepad | `this._tickGamepad()` → `this.ps.getAll().forEach(...)` | 121, 619 |

Additionally, `enableSound()` installs a **separate** `setInterval(fn, 16)` at line 703 that does its own `ps.getAll().forEach(...)` for sound-assigned params — runs at ~60fps outside the main `tick()` path.

### Q2: Are inactive/unassigned controllers skipped?

**Partially.** There are two iteration strategies:

- **Sparse maps** (LFOs at line 63, expressions at line 71, randoms at line 83): only assigned entries exist in the Map — naturally zero-cost for inactive params. **Fully skipped.**

- **Full `ps.getAll()` scans** (line 100, line 619 gamepad): iterate **all ~210 parameters** regardless of assignment. Each param has a guard check:
  - Line 101: `if (p.controller)` — skips body for params with no controller
  - Line 107: `if (p.xControllers?.length)` — skips body for params with no xControllers
  - Gamepad line 620: `if (!p.controller) return;` — same pattern
  
  So the outer iteration visits all 210 params, but inner work is gated. The iteration overhead itself (function call + property access + guard check) runs for every param every frame.

### Q3: Per-frame allocations

**Three allocations per frame in the `tick()` path:**

| Allocation | Line | Details |
|---|---|---|
| `[...this.params.values()]` — new Array | `ParameterSystem.js:322` | Called via `ps.getAll()` at `ControllerManager.js:100` (main tick), line 619 (gamepad), and line 708 (sound setInterval). Spread operator allocates a new Array of ~210 Parameter objects **every call**. |
| `` `${p.id}:${idx}` `` — template literal string | `ControllerManager.js:111` | New string per xController per frame. For params with multiple xControllers, this allocates one string each. |
| `t.replace('gamepad-axis-', '')` / `t.replace('gamepad-btn-', '')` — new string | `ControllerManager.js:625, 631` | Per gamepad-assigned param per frame. |

**Per-frame allocation summary (worst case with gamepad + active xControllers):**
- 2 × `getAll()` = **420 element references** in new arrays (lines 100 + 619)
- n × template literal strings (line 111) where n = total xController count
- m × `.replace()` strings (lines 625, 631) where m = gamepad-assigned param count

**Not per-frame (safe):**
- `syncBPM` line 335: `[...this.lfos.entries()]` — only on BPM change
- `_attachMIDIInput` at line 555: `ps.getAll().forEach(...)` — event-driven, not per frame
- `_initKeyboard` at line 409/421: `ps.getAll().forEach(...)` — event-driven, not per frame
- `_initMouse` at line 365/378: `ps.getAll().forEach(...)` — event-driven, not per frame

### Q4: Maximum iteration count per `tick()`

`ps.getAll()` returns all registered parameters. With ~210 params (from AGENTS.md):

| Loop | Items iterated | Condition |
|---|---|---|
| `this.lfos.forEach` | Only assigned LFOs (0–N) | Always |
| `this.exprs.forEach` | Only assigned expressions (0–N) | Always |
| `this.randoms.forEach` | Only assigned randoms (0–N) | Always |
| `this.rand.forEach` | Exactly 3 (fixed) | Always |
| `ps.getAll().forEach` | **~210** (all params) | Always |
| `_tickGamepad.ps.getAll().forEach` | **~210** (all params) | If gamepad connected |

**Worst case per `tick()`: ~210 + ~210 + 3 + active LFOs + active exprs + active randoms ≈ 423+ entries iterated.**

Plus the sound `setInterval` at line 703 adds another ~210 iteration every 16ms on its own independent timer.

---

## Sprint 3c — IndexedDB Write Pressure

### Q1: How frequently does IndexedDB write occur?

**Manually triggered only.** There is no auto-save, no timer-based save, and no parameter-change hook. All writes are initiated by explicit user actions:

| Trigger | Method | Location |
|---|---|---|
| Shift+S (quick-save state) | `saveCurrentState(null)` | `main.js:4100` |
| `*` + digit (save to slot) | `saveCurrentState(idx)` | `main.js:4164` |
| Cmd/Ctrl+S (save bank) | `saveCurrentPreset(thumbnail)` | `main.js:4250` |
| Right-click state tile "Save here" | `saveCurrentState(idx)` | `UI.js:1455` |
| Bank create / switch | `activatePreset()` → `p.save()` | `Preset.js:195, 497` |
| Save As new bank | `saveAsBank()` → `copy.save()` | `Preset.js:490` |
| Project import | `importAll()` → `p.save()` per bank | `Preset.js:520` |

No write occurs in the render loop. No write occurs on parameter change.

### Q2: Is there any debounce or batch guard on writes?

**No.** Each write triggers a direct `await dbPut(...)` call with no debounce, throttle, queue, or coalescing:

- `saveCurrentState()` at line 317 → calls `p.save()` at line 327 — no debounce
- `saveCurrentPreset()` at line 465 → calls `p.save()` at line 470 — no debounce
- `saveCurrentBank()` at line 473 → calls `p.save()` at line 477 — no debounce

Each `Preset.save()` (line 133) calls `dbPut('banks', this.serialize())` which opens IndexedDB, starts a `readwrite` transaction, and serializes the full preset. Spamming Shift+S fires one transaction per keypress with no coalescing.

The `dbPut()` helper (line 32) opens the database *fresh* on every call via `await openDB()` — there's no cached/long-lived DB handle. Each write opens a new connection, starts a transaction, writes, and reaps the connection via garbage collection of the local `db` variable.

### Q3: Synchronous in the render loop, or separate async path?

**Separate async path.** All IndexedDB writes use `async/await` and Promises. They never block the `requestAnimationFrame` render loop:

- `saveCurrentState()` at line 317: `async`, calls `await p.save()` at line 327
- Call site at `main.js:4100`: uses `.then()` — non-blocking promise chain
- Call site at `main.js:4164`: fire-and-forget — async call without `await`
- `dbPut()` at line 32: `async`, returns `Promise`, uses IndexedDB transaction callbacks

The IndexedDB transaction itself runs asynchronously in the browser's storage thread. The only synchronous work in the main thread is `this.serialize()` (line 135, calls `serialize()` at line 101) which creates a plain object copy — this is fast but includes spreading `this.states` array.

### Q4: Maximum write payload size

**Full bank — up to 32 display states + controllers + optional thumbnail.** Every `save()` call serializes the entire `Preset` object (line 101–112):

```
{
  index, name,                                            // ~small
  controllers: { paramId: { controller: {...}, xControllers: [...] } },  // all assignments
  states: [ up to 32 × {                                  // each state contains:
    values:      { ...spread of ~210 params },            // ~210 key/value pairs
    fxOrder:     [...fxOrder array],                      // 15 strings
    controllers: { ...copy of assignments },               // per-state assignments
    mediaRefs:   { movie, scene3d, text, buffer },        // filenames
    pins:        [...pin array] | null,                   // pin positions
    extra:       { ...extra data } | null,                 // text content etc.
    name, thumbnail, created                              // metadata
  } ],
  activeState, created, modified,
  thumbnail: <data URL of output canvas> | null           // optional, can be large
}
```

**Key payload facts:**
- Minimum: empty bank with 0 states — ~200 bytes
- Typical: 4–8 populated states — ~10–50 KB
- Maximum: 32 fully populated states + canvas thumbnail (base64 RGBA data URL) — **could exceed 500 KB** depending on thumbnail resolution
- `saveCurrentPreset()` (line 465, Cmd+S) writes the *largest* payload because it optionally attaches a `thumbnail` (data URL from `capturePresetThumb()` at `main.js:4250`)

The `dbPut` opens a new DB connection per write** (line 32–33): `const db = await openDB()` inside `dbPut()`. Each write creates a fresh `indexedDB.open()` call. The old connection is collected by GC when the local `db` variable falls out of scope.

Status: ✅ Closed — 2 fixes shipped, 2 no-action.

