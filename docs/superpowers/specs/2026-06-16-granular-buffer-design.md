# Granular Buffer — Phase 1 Design Spec
**Date:** 2026-06-16
**Status:** Approved for implementation

---

## Context

The Stills Buffer in ImWeb stores up to 64 captured frames in a grid. Its original use cases (temporal echo, large-image zoom/pan) have been largely superseded by Time Displace and other pipeline features. The Buffer has strong bones — three independent FrameSelects, FrameBlend between two readers, auto-capture, scan mode — but no artistic identity that makes it a first-class performance instrument.

This spec defines Phase 1 of a two-phase redesign. Phase 1 adds **granular playback** — the Buffer becomes a video sampler that scatters frame reads around a center position, producing shimmering, stuttering, time-fragmented imagery. Phase 2 (future) wires this to a Numenta Monty brain-model loop: Monty's saccade coordinates and consensus confidence drive FrameSelect and scatter in real time, creating a closed perceptual loop.

Phase 1 is useful and complete as a standalone feature. Phase 2 builds on top without changing Phase 1's architecture.

---

## What We're Building

Two new parameters + scatter logic in `StillsBuffer.tick()` + a Granular section in the Buffer panel UI + scatter range visualisation in the grid.

**Scope boundary:** No changes to Pipeline, ParameterSystem structure, or existing buffer params. No full UI redesign — that's Phase 2.

---

## New Parameters

Both added to the `buffer` namespace in `src/controls/ParameterSystem.js`, after the existing `buffer.fs3` block.

| ID | Label | Type | Min | Max | Default | Step | Notes |
|---|---|---|---|---|---|---|---|
| `buffer.scatter` | Scatter | CONTINUOUS | 0 | 32 | 0 | 1 | Random ±N frame offset around fs1 |
| `buffer.grainrate` | GrainRate | CONTINUOUS | 0.5 | 30 | 4 | 0.5 | Hz — how often offset re-rolls |

When `buffer.scatter = 0`, behaviour is identical to today. No guard needed — the scatter path simply produces a zero offset.

---

## Logic — StillsBuffer.tick()

**File:** `src/inputs/StillsBuffer.js`

`tick(ps)` currently reads `buffer.fs1` → `this.readIndex`. It needs a delta-time argument and scatter state.

### State added to constructor
```js
this._scatterOffset = 0;
this._grainAccum = 0;
```

### tick() signature change
```js
tick(ps, dt)   // dt = seconds since last frame (capped at 0.1 to avoid large jumps)
```

### Scatter logic (inserted before readIndex assignment)
```js
const scatter = Math.round(ps.get('buffer.scatter').value);
if (scatter > 0) {
    this._grainAccum += dt * ps.get('buffer.grainrate').value;
    if (this._grainAccum >= 1) {
        this._grainAccum -= 1;
        this._scatterOffset = Math.round((Math.random() * 2 - 1) * scatter);
    }
    const raw = Math.round(ps.get('buffer.fs1').value) + this._scatterOffset;
    this.readIndex = Math.max(0, Math.min(this.frameCount - 1, raw));
} else {
    this._scatterOffset = 0;
    this._grainAccum = 0;
    this.readIndex = Math.round(ps.get('buffer.fs1').value);
}
```

### Caller update
`main.js` calls `stillsBuffer.tick(ps)` once per render frame. Change to `stillsBuffer.tick(ps, dt)` where `dt = Math.min((now - lastTime) / 1000, 0.1)` — already computed in the RAF loop as the frame delta, capped to 0.1s to prevent large jumps after tab backgrounding.

---

## UI — Buffer Panel

**File:** `src/ui/UI.js` (Buffer panel builder) and `src/main.js` (grid refresh)

### New Granular section
Insert a collapsible **Granular** section at the top of the Buffer panel, above the existing FrameSelect rows. Contains two standard param rows:
- `buffer.scatter` — Scatter
- `buffer.grainrate` — GrainRate

Section is visible at all times (not gated on scatter > 0). Both params follow the standard `[label][ctrlBadge][min][max][value]` row pattern — MIDI/LFO-assignable like any other param.

### Grid scatter visualisation
In `refreshBufferGrid()` in `main.js`, after drawing thumbnails and labels, add a scatter range overlay:

When `buffer.scatter > 0`:
- Slots within `±scatter` of the current `fs1` position get a subtle **blue tint** overlay: `rgba(80, 140, 255, 0.12)`
- The currently-active scattered slot (the one actually reading) gets the existing gold highlight — no change
- When `_scatterOffset` re-rolls (grain jumps), briefly flash the new slot's background brighter for ~80ms. Implemented via a `_grainFlashSlot` index + `_grainFlashTime` timestamp on StillsBuffer; `refreshBufferGrid()` checks `performance.now() - _grainFlashTime < 80` to decide whether to draw the flash.

This makes the "grain window" visible in the grid without obscuring thumbnails.

---

## Interaction with Existing Params

- **Slew/lag on `buffer.fs1`** — smooths the center position. Scatter operates on top of the slewed value — you get a drifting center with granular noise around it.
- **LFO on `buffer.scatter`** — sweep scatter amount over time. Low → high → low = image crystallises and shatters on a cycle.
- **Sound level on `buffer.grainrate`** — loud sounds = faster grain jumps.
- **`buffer.fs2` + `buffer.frameblend`** — unchanged. fs2 provides a second reader for crossfading. Using fs2 with scatter on fs1 gives two independent temporal streams blending.
- **`buffer.scan`** — unchanged. Scan mode moves the write head; scatter is on the read head. They are independent.

---

## Phase 2 Hook (not built now)

When the Monty WebSocket bridge exists, it will send:
```json
{ "saccade_x": 0.4, "saccade_y": 0.7, "consensus_confidence": 0.3, "prediction_error": 0.8 }
```

These map onto Phase 1 params via OSCBridge:
- `saccade_x × frameCount` → `buffer.fs1`
- `1 - consensus_confidence` → `buffer.scatter`
- `prediction_error` spike → `buffer.capture` trigger

No Phase 1 code needs to change for this to work.

---

## Files Modified

| File | Change |
|---|---|
| `src/controls/ParameterSystem.js` | Add `buffer.scatter` and `buffer.grainrate` params |
| `src/inputs/StillsBuffer.js` | Add scatter state, update `tick(ps, dt)` |
| `src/main.js` | Pass `dt` to `tick()`; add scatter overlay to `refreshBufferGrid()` |
| `src/ui/UI.js` | Add Granular section to Buffer panel builder |

---

## Verification

1. `buffer.scatter = 0` — behaviour identical to before, no visual change
2. `buffer.scatter = 8, buffer.grainrate = 4` — frame jumps ~4 times/sec within ±8 of fs1; blue tint visible on those slots in grid
3. LFO on `buffer.scatter` (0→16→0, slow) — image shimmers and stabilises on LFO cycle
4. Sound level → `buffer.grainrate` — grain rate responds to audio
5. `buffer.fs1` with slew 0.5s + scatter 8 — smooth drifting center with granular noise
6. Flash feedback visible in grid on grain jump
