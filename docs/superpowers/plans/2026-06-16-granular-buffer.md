# Granular Buffer Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `buffer.scatter` and `buffer.grainrate` params that make the Stills Buffer behave as a granular video sampler — scattering frame reads around a center position.

**Architecture:** Two new params declared in ParameterSystem.js → scatter logic added to `StillsBuffer.tick(ps, dt)` → `refreshBufferGrid()` overlays the scatter range in blue with a flash on grain jump → params auto-render as standard rows in the Buffer panel via the existing `ps.getGroup('buffer')` mechanism.

**Tech Stack:** Vanilla JS, Three.js r160+, WebGL, ParameterSystem reactive params, Canvas 2D API for grid overlay.

---

## File Map

| File | Change |
|---|---|
| `src/controls/ParameterSystem.js` | Add `buffer.scatter` and `buffer.grainrate` after `buffer.fs3` (line 1307) |
| `src/inputs/StillsBuffer.js` | Add 4 scatter state vars to constructor; replace `tick(ps)` with `tick(ps, dt)` |
| `src/main.js` | Change `stillsBuffer.tick(ps)` → `stillsBuffer.tick(ps, dt)` at line 4737; add scatter overlay to `refreshBufferGrid()` at line 3155 |

> **UI note:** `src/ui/UI.js` does NOT need changes. Line 812 maps `'buffer-controls': ps.getGroup('buffer')` which auto-renders all buffer-group params as standard rows in declaration order. Adding params to ParameterSystem.js is sufficient for them to appear in the panel.

---

### Task 1: Add `buffer.scatter` and `buffer.grainrate` params

**Files:**
- Modify: `src/controls/ParameterSystem.js:1307`

- [ ] **Step 1.1: Verify insertion point**

```bash
grep -n "buffer\.fs3\|buffer\.scan" src/controls/ParameterSystem.js
```

Expected: `buffer.fs3` around line 1300, `buffer.scan` around line 1309. We insert between them.

- [ ] **Step 1.2: Insert params after `buffer.fs3`'s closing brace**

Find the exact closing `});` of the `buffer.fs3` block (line ~1307) and insert immediately after:

```js
ps.register({
  id: 'buffer.scatter',
  label: 'Scatter',
  group: 'buffer',
  min: 0,
  max: 32,
  value: 0,
  step: 1,
});
ps.register({
  id: 'buffer.grainrate',
  label: 'GrainRate',
  group: 'buffer',
  min: 0.5,
  max: 30,
  value: 4,
  step: 0.5,
  unit: 'Hz',
});
```

- [ ] **Step 1.3: Verify**

```bash
grep -n "buffer\.scatter\|buffer\.grainrate" src/controls/ParameterSystem.js
```

Expected: two lines, consecutive, after the `buffer.fs3` block.

- [ ] **Step 1.4: Commit**

```bash
git add src/controls/ParameterSystem.js
git commit -m "feat(buffer): add scatter and grainrate params"
```

---

### Task 2: Add scatter state variables to StillsBuffer constructor

**Files:**
- Modify: `src/inputs/StillsBuffer.js:33`

- [ ] **Step 2.1: Verify insertion point**

```bash
grep -n "read2Index\|readIndex" src/inputs/StillsBuffer.js | head -5
```

Expected: `this.readIndex = 0;` around line 32, `this.read2Index = 0;` at line 33.

- [ ] **Step 2.2: Insert scatter state after `this.read2Index = 0;`**

Old:
```js
    this.read2Index        = 0; // for fs2 / frame blend
```

New (add four lines below it):
```js
    this.read2Index        = 0; // for fs2 / frame blend
    this._scatterOffset    = 0;
    this._grainAccum       = 0;
    this._grainFlashSlot   = -1;
    this._grainFlashTime   = 0;
```

- [ ] **Step 2.3: Verify**

```bash
grep -n "_scatter\|_grainAccum\|_grainFlash" src/inputs/StillsBuffer.js
```

Expected: 4 lines in the constructor block.

- [ ] **Step 2.4: Commit**

```bash
git add src/inputs/StillsBuffer.js
git commit -m "feat(buffer): add scatter state vars to StillsBuffer constructor"
```

---

### Task 3: Replace `tick(ps)` with scatter logic in StillsBuffer

**Files:**
- Modify: `src/inputs/StillsBuffer.js:143-148`

- [ ] **Step 3.1: Verify current tick() body**

```bash
sed -n '140,155p' src/inputs/StillsBuffer.js
```

Expected: the 6-line `tick(ps)` that reads fs1 → `readIndex` and fs2 → `read2Index`.

- [ ] **Step 3.2: Replace the entire `tick(ps)` method**

Old:
```js
  tick(ps) {
    const fs1 = Math.round(ps.get('buffer.fs1').value);
    this.readIndex  = Math.max(0, Math.min(this.frameCount - 1, fs1));
    const fs2 = Math.round(ps.get('buffer.fs2').value);
    this.read2Index = Math.max(0, Math.min(this.frameCount - 1, fs2));
  }
```

New:
```js
  tick(ps, dt = 0) {
    const scatter = Math.round(ps.get('buffer.scatter').value);
    if (scatter > 0) {
      this._grainAccum += dt * ps.get('buffer.grainrate').value;
      if (this._grainAccum >= 1) {
        this._grainAccum -= 1;
        this._scatterOffset = Math.round((Math.random() * 2 - 1) * scatter);
        this._grainFlashSlot = Math.max(0, Math.min(this.frameCount - 1,
          Math.round(ps.get('buffer.fs1').value) + this._scatterOffset));
        this._grainFlashTime = performance.now();
      }
      const raw = Math.round(ps.get('buffer.fs1').value) + this._scatterOffset;
      this.readIndex = Math.max(0, Math.min(this.frameCount - 1, raw));
    } else {
      this._scatterOffset = 0;
      this._grainAccum    = 0;
      this.readIndex      = Math.round(ps.get('buffer.fs1').value);
    }
    const fs2 = Math.round(ps.get('buffer.fs2').value);
    this.read2Index = Math.max(0, Math.min(this.frameCount - 1, fs2));
  }
```

> **Key invariant:** `dt` defaults to `0` so any call site that hasn't been updated yet still works correctly — scatter accumulator won't advance, behaviour stays identical to before.

- [ ] **Step 3.3: Verify**

```bash
grep -n "tick\|_grainAccum\|_scatterOffset" src/inputs/StillsBuffer.js | head -20
```

Expected: new signature `tick(ps, dt = 0)` at the old line ~143.

- [ ] **Step 3.4: Commit**

```bash
git add src/inputs/StillsBuffer.js
git commit -m "feat(buffer): implement scatter logic in StillsBuffer.tick()"
```

---

### Task 4: Pass `dt` to `stillsBuffer.tick()` in main.js

**Files:**
- Modify: `src/main.js:4737`

- [ ] **Step 4.1: Verify call site and dt variable**

```bash
grep -n "stillsBuffer\.tick\|const dt" src/main.js | head -10
```

Expected: `stillsBuffer.tick(ps)` around line 4737, `const dt = Math.min(...)` around line 4663.

- [ ] **Step 4.2: Update the call**

Old:
```js
    stillsBuffer.tick(ps);
```

New:
```js
    stillsBuffer.tick(ps, dt);
```

- [ ] **Step 4.3: Verify**

```bash
grep -n "stillsBuffer\.tick" src/main.js
```

Expected: `stillsBuffer.tick(ps, dt)` — one occurrence.

- [ ] **Step 4.4: Commit**

```bash
git add src/main.js
git commit -m "feat(buffer): pass dt to stillsBuffer.tick() in render loop"
```

---

### Task 5: Add scatter range overlay to `refreshBufferGrid()`

**Files:**
- Modify: `src/main.js:3155` (inside `refreshBufferGrid()`)

- [ ] **Step 5.1: Verify insertion point**

```bash
sed -n '3150,3165p' src/main.js
```

Expected: lines 3151-3155 show the protected-slot tint block ending with `bufferCtx.fillRect(...)`. The frame index label starts at line 3157. We insert between them.

- [ ] **Step 5.2: Insert scatter overlay block after the protected tint (after `}` on line ~3155)**

Old (the closing brace of the protected tint + the comment that follows):
```js
      // Frame index label (only if cell tall enough)
```

New (insert the scatter overlay block before that comment):
```js
      // Scatter range overlay — blue tint for slots within ±scatter of fs1
      const _scatter = Math.round(ps.get('buffer.scatter').value);
      if (_scatter > 0) {
        const _center = Math.round(ps.get('buffer.fs1').value);
        const _dist   = Math.abs(i - _center);
        if (_dist > 0 && _dist <= _scatter) {
          bufferCtx.fillStyle = 'rgba(80,140,255,0.12)';
          bufferCtx.fillRect(x, y, cw - 1, ch - 1);
        }
        if (i === stillsBuffer._grainFlashSlot &&
            performance.now() - stillsBuffer._grainFlashTime < 80) {
          bufferCtx.fillStyle = 'rgba(80,140,255,0.40)';
          bufferCtx.fillRect(x, y, cw - 1, ch - 1);
        }
      }

      // Frame index label (only if cell tall enough)
```

> **Note:** `ps` is a closure variable in `refreshBufferGrid()` — it's in scope because the function lives inside main.js where `ps` is declared. `_scatter`, `_center`, `_dist` use the `_` prefix to avoid shadowing any outer variable with the same name.

- [ ] **Step 5.3: Verify the new block is syntactically correct**

```bash
node --input-type=module < /dev/null 2>&1 || true
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb && npx vite build --mode development 2>&1 | tail -20
```

If Vite build errors appear, fix them before continuing.

- [ ] **Step 5.4: Commit**

```bash
git add src/main.js
git commit -m "feat(buffer): add scatter range overlay to buffer grid canvas"
```

---

### Task 6: Smoke-test in browser

Start dev server if not running:

```bash
npm run dev
```

Open `http://localhost:5173` and test the verification checklist from the spec:

- [ ] `buffer.scatter = 0` → behaviour identical to before, no blue tint visible in grid
- [ ] `buffer.scatter = 8, buffer.grainrate = 4` → frame jumps ~4×/sec within ±8 of fs1; blue tint on those slots
- [ ] Assign an LFO to `buffer.scatter` (0→16→0, slow) → image shimmers and stabilises on LFO cycle
- [ ] Assign Sound level to `buffer.grainrate` → grain rate responds to audio
- [ ] Flash feedback visible in grid on each grain jump (brief bright blue)
- [ ] `buffer.fs2` + `buffer.frameblend` unchanged — second reader still works

If all pass, the feature is complete.

---

## Rollback

Any task can be reverted with `git revert <sha>` since each task has its own commit. The `dt = 0` default in the tick signature means earlier tasks are safe to revert in isolation without breaking the render loop.
