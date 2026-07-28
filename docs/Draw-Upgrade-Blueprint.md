# ImWeb Draw Upgrade — Phase 4 Architecture Blueprint

## 4a: Strokes → Particles (`draw.toParticles`)

### Mechanism

When `draw.toParticles` toggle is ON and `drawLayer.strokeActive` is true (ink landed this frame), the render loop copies `draw.x` / `draw.y` into `particle.emitx` / `particle.emity`.

### Integration point

`src/main.js` — inside the render loop, after `drawLayer.tick(ps)`:

```javascript
// Strokes → particles: while ink lands (live/param strokes, not loop
// playback) the pen drives the particle emitter. Both axes are y-up
// 0–100, so it's a straight copy; last writer wins if a controller is
// also assigned to the emit params.
if ((ps.get("draw.toParticles")?.value ?? 0) > 0.5 && drawLayer.strokeActive) {
  ps.set("particle.emitx", ps.get("draw.x").value);
  ps.set("particle.emity", ps.get("draw.y").value);
}
```

### Data flow

```
pointer event → drawLayer.queuePoint({x, y}) →
  drawLayer.tick(ps) drains queue, draws segments →
    drawLayer.strokeActive = true →
      main render loop copies draw.x/y → particle.emitx/emity →
        ParticleEngine reads particle.emitx/emity each frame →
          new particles spawn at pen position
```

### Y-flip convention

- `draw.x` / `draw.y`: 0–100, y-down (UI convention)
- `particle.emitx` / `emity`: 0–100, y-up (Three.js convention)
- Both axes are already y-up 0–100, so straight copy works

### Failure mode

If a MIDI controller is also assigned to `particle.emitx`, both the stroke and the MIDI controller write to the same param each frame. Last writer wins — no lock, by design (same as any two controller writers). Documented in tooltip.

---

## 4b: Draw as Displacement (`⇢ Warp`)

### Mechanism

The Pipeline already resolves `layer.ds` (DisplaceSrc) to any source texture including Draw (index 7). The ⇢ Warp button is a one-shot setter that routes Draw into the displacement pass with a sensible default amount.

### Integration point

`src/main.js` — in the Draw tab UI builder:

```javascript
const btnWarp = document.createElement("button");
btnWarp.textContent = "⇢ Warp";
btnWarp.addEventListener("click", () => {
  ps.set("layer.ds", 7); // Draw
  if (!(ps.get("displace.amount")?.value > 0)) ps.set("displace.amount", 20);
});
```

### Shader path (no changes needed)

`src/core/Pipeline.js:347` — `layer.ds` resolves any source:
```
SOURCES = ['camera','movie','buffer','color','color2','noise',
           'scene3d','draw','output',...]
key = SOURCES[layer.ds]  →  'draw' when ds=7
```

`Pipeline.js:417` — displacement pass reads `uDS` uniform:
```glsl
// displacement.frag (excerpt)
vec4 dsColor = texture2D(uDS, vUv);   // ← Draw texture when ds=7
vec2 offset = (dsColor.rg - 0.5) * uDisplaceAmount;
vec4 displaced = texture2D(uFG, vUv + offset);
```

The Draw canvas is 512×512 RGBA. The displacement shader reads the R and G channels as X/Y offset. White strokes → push pixels right+up, black → pull left+down. Grayscale strokes at 50% → no displacement.

### Zero shader work

This feature required zero WebGL changes. The Pipeline already routes any source into the displacement pass via `layer.ds`. The button just sets the param.

---

## 4d: Draw as Key/Mask (`⇢ Key`)

### Mechanism

Same as displacement — the Pipeline already supports external key via `keyer.extkey`. The ⇢ Key button sets Draw as the DisplaceSrc AND enables the keyer with external key mode.

### Integration point

```javascript
const btnKey = document.createElement("button");
btnKey.textContent = "⇢ Key";
btnKey.addEventListener("click", () => {
  ps.set("layer.ds", 7); // Draw
  ps.set("keyer.active", 1);
  ps.set("keyer.extkey", 1);
});
```

### Shader path (no changes needed)

`Pipeline.js:432` — keyer reads `uEK` (external key) uniform:
```glsl
// keyer.frag (excerpt)
float ek = texture2D(uEK, vUv).r;  // ← Draw R channel when extkey=1
float key = smoothstep(uKeyWhite - uKeySoftness, uKeyWhite, ek);
// White strokes → key = 1 (reveal FG), black → key = 0 (reveal BG)
```

White drawing reveals the Foreground source over the Background. Black/empty areas show Background. Gray edges get a soft transition controlled by `keyer.softness`.

---

## 4c: Stroke → LFO Controller Driver

### Type encoding

`stroke-{slot}-{axis}` — e.g. `stroke-1-x`, `stroke-4-y`
- Slot: 1–4, axis: x or y
- Stored in `p.controller.type`
- Assigned via right-click context menu → "Stroke Looper" section

### Per-assignment driver state (ControllerManager.strokes Map)

```javascript
// paramId → driver state
{
  slot: 0,        // StrokeLooper slot index (0–3)
  axis: 'x',      // 'x' | 'y'
  rate: 1,        // playhead speed multiplier (0.1–10)
  playhead: 0,    // independent playhead in seconds
  _idx: 0,        // next point index for efficient scanning
}
```

### Tick algorithm (ControllerManager.tick)

```javascript
// Tick stroke controllers — independent playhead per assignment
if (this._strokeLooper) {
  this.strokes.forEach((s, paramId) => {
    const slot = this._strokeLooper.slots[s.slot];
    if (!slot || !slot.length || !slot.points.length) return;

    s.playhead += dt * s.rate;

    // Wrap at slot length
    if (s.playhead >= slot.length) {
      s.playhead = s.playhead % slot.length;
      s._idx = 0;
    }

    // Scan forward to find the last point ≤ playhead
    let val = null;
    while (s._idx < slot.points.length && slot.points[s._idx].t <= s.playhead) {
      val = slot.points[s._idx][s.axis];
      s._idx++;
    }

    // Hold last known value
    if (val !== null) this.ps.setNormalized(paramId, val);
  });
}
```

### StrokeLooper point format

```javascript
// slot.points[] entries:
{
  t: 0.5,        // seconds from recording start
  x: 0.42,       // normalized 0–1 (canvas space)
  y: 0.73,       // normalized 0–1
  size: 12,      // brush size (0–100)
  opacity: 80,   // opacity (0–100)
  style: "hsl(0,0%,80%)",  // CSS color
  erase: false,
  start: false,
}
```

The driver reads `point.x` or `point.y` — already 0–1, so it maps directly through `setNormalized()`. The param's `ctrlMin`/`ctrlMax` clamp the output range.

### Independent playhead design

Each assignment has its own playhead — NOT shared with the StrokeLooper's audio-visual playback. This means:
- L1 can drive `displace.amount` at rate 1.0 (synced with visual loop)
- L1 can ALSO drive `color.h` at rate 0.5 (half-speed color sweep)
- L2 can drive `sdf.camX` at rate 2.0 (double-speed camera sweep)

All four slots can drive unlimited params independently.

### Serialization

Automatic — `p.controller` is a plain object `{ type:'stroke-1-x', rate:1.5 }`. Saved/restored with presets and .imweb files via existing `ParameterSystem.serializeControllers()` / `deserializeControllers()`.

---

## Summary: no WebGL changes

Phases 4a, 4b, 4d required ZERO shader work. The Pipeline already supported:
- Any source routed to displacement (`layer.ds` → `uDS` uniform)
- Any source routed to external key (`layer.ds` → `uEK` uniform when `keyer.extkey=1`)
- Parameter writes to `particle.emitx/emity` (existing param names)

Phase 4c added a new controller driver type that reads StrokeLooper data and writes to params — also zero shader work, following the existing ControllerManager driver pattern (LFO, Random, Sound, etc.).
