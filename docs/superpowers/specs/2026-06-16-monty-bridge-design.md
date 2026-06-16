# Monty Bridge — Phase 2 Design Spec
**Date:** 2026-06-16
**Status:** Approved for implementation

---

## Context

Phase 1 gave the Stills Buffer a granular identity: `buffer.scatter` and `buffer.grainrate` turn frame reads into a video sampler. Phase 2 connects that sampler to a perceptual signal — Numenta's Monty cortical learning system — through a clean WebSocket bridge.

Phase 2 is **mock-only**. The JSON contract is designed as though `--live` already existed, but the Python emitter generates synthetic signals. Reasons: Monty's internal state (saccade position, evidence accumulators, feature mismatch) isn't a stable public API; the artistic question of which Monty values produce interesting ImWeb behaviour is unanswered until we can tune against real output; and the phase-by-phase discipline is the same as the 60fps sprint — ship the architecture, validate the loop, swap in the real component.

Phase 3 is "wire up real Monty internals against this contract."

---

## Scope

Two new components:

| Component | Where | What |
|---|---|---|
| `monty-bridge.py` | project root (gitignored) | Python WebSocket server; emits mock Monty signals at 15 Hz |
| `src/io/MontyBridge.js` | ImWeb source | WebSocket client; maps Monty JSON to ParameterSystem calls |

No changes to Pipeline, ParameterSystem, or existing buffer params.

---

## JSON Schema — v1

Every message is one JSON object, UTF-8, terminated by WebSocket frame boundary.

```json
{
  "v": 1,
  "t": 1718567234123,
  "saccade": [0.42, 0.71],
  "confidence": 0.83,
  "prediction_error": 0.12,
  "source": "mock"
}
```

| Field | Type | Range | Contract |
|---|---|---|---|
| `v` | int | 1 | Schema version. Receivers reject unknown versions with a single `console.warn` per session (not per message). |
| `t` | int | unix ms | Emission timestamp. Receivers discard messages where `Date.now() - t > 500`. |
| `saccade` | [float, float] | [0–1, 0–1] | Normalised focal point. `[0]` = x-axis, `[1]` = y-axis. Both 0 = top-left, 1 = bottom-right. |
| `confidence` | float | 0–1 | 1.0 = full column consensus. **Normalised on the emitter side.** Phase 3 must map raw Monty evidence scores to 0–1 in Python before sending; the `> 0.7` threshold in MontyBridge.js is calibrated against this range. |
| `prediction_error` | float | 0–1 | Instantaneous feature mismatch. **Normalised on the emitter side** for the same reason. Values above 0.7 trigger `buffer.capture`. |
| `source` | string | `"mock"` or `"live"` | Informational only. MontyBridge.js displays it in a UI badge; never affects routing. |

Schema is versioned at the top level. When Phase 3 needs new fields, bump to `v: 2` and update MontyBridge.js together. The `console.warn` on mismatch makes version drift immediately visible.

---

## Python — `monty-bridge.py`

Local-only script. Added to `.gitignore` alongside `dev-catcher.js`. Dependencies: `websockets`, `asyncio` (stdlib), `math`, `random`.

### Invocation

```bash
python monty-bridge.py          # default: 15 Hz, port 8765
python monty-bridge.py --hz 10 --port 8765
python monty-bridge.py --live   # prints "Phase 2: --live not implemented" and exits cleanly
```

### Mock signal generation

All signals are functions of elapsed time `t` (float, seconds since start). Computed once per tick, broadcast to all connected clients.

#### Saccade

```python
sx = 0.5 + 0.5 * math.sin(t * 0.3)      # period 2π/0.3 ≈ 21 s
sy = 0.5 + 0.5 * math.sin(t * 0.17 + 1.2)  # period 2π/0.17 ≈ 37 s
```

Incommensurate periods produce Lissajous-style non-repeating coverage of the frame space. `saccade[1]` is emitted but not mapped in Phase 2 — it's in the contract for Phase 3.

#### Confidence (correlated with saccade velocity)

```python
# Discrete velocity of saccade[0] across ticks
vel = abs(sx - prev_sx) * hz          # units: normalised-position / sec

# Expected max velocity: amplitude × angular_freq = 0.5 × 0.3 = 0.15
vel_norm = min(vel / 0.15, 1.0)       # 0 when stationary, 1 at peak speed

confidence = max(0.0, min(1.0,
    (1.0 - vel_norm) + random.uniform(-0.05, 0.05)
))
prev_sx = sx
```

Confidence drops while the saccade is sweeping and rises when it settles — matching real Monty column-voting behaviour, where consensus accumulates during fixation. This correlation makes the visual mapping tunable: if `buffer.scatter` feels right at rest but chaotic in motion, the cause is visible in the confidence signal.

#### Prediction error (spikes biased toward high saccade velocity)

```python
# Baseline + Poisson spikes; spike probability scales with saccade velocity
# Novelty is highest at jump onsets in real Monty — mock mirrors this
spike_prob = (0.5 / hz) + vel_norm * (1.5 / hz)
prediction_error = 0.05 + random.uniform(-0.02, 0.02)
if random.random() < spike_prob:
    prediction_error = 0.9 + random.uniform(-0.05, 0.05)
prediction_error = max(0.0, min(1.0, prediction_error))
```

At 15 Hz with `vel_norm = 0`: ~0.5 spikes/sec. At peak velocity: ~2 spikes/sec.

### Server loop

```python
async def handler(websocket):
    connected.add(websocket)
    try:
        await websocket.wait_closed()
    finally:
        connected.discard(websocket)

async def broadcast_loop():
    t = 0.0
    prev_sx = 0.5
    dt = 1.0 / hz
    while True:
        msg = compute_message(t, prev_sx, hz)
        prev_sx = msg["saccade"][0]
        payload = json.dumps(msg)
        if connected:
            await asyncio.gather(*[ws.send(payload) for ws in connected],
                                 return_exceptions=True)
        t += dt
        await asyncio.sleep(dt)
```

Single event loop; broadcast is fire-and-forget (`return_exceptions=True` prevents one slow client from blocking others).

---

## JS — `src/io/MontyBridge.js`

New file. Follows the same pattern as `OSCBridge.js`: constructor takes `ps` and references to required runtime objects; auto-reconnects; no dependency on Pipeline or renderer.

### Constructor signature

```js
export class MontyBridge {
  constructor(ps, stillsBuffer, { url = 'ws://localhost:8765' } = {}) { ... }
```

`stillsBuffer` reference is held for live `frameCount` access. URL is configurable.

### Message handling

```js
_onMessage(raw) {
  let msg;
  try { msg = JSON.parse(raw); } catch { return; }

  if (msg.v !== 1) {
    if (!this._versionWarned) {
      console.warn(`MontyBridge: unknown schema v${msg.v}, expected 1`);
      this._versionWarned = true;
    }
    return;
  }
  if (Date.now() - msg.t > 500) return;  // stale

  const n = this._stillsBuffer.frameCount;   // live value — not a closure
  this._ps.set('buffer.fs1',   msg.saccade[0] * (n - 1));
  this._ps.set('buffer.scatter', (1 - msg.confidence) * 32);
  if (msg.prediction_error > 0.7) this._ps.trigger('buffer.capture');

  this._source = msg.source;
  this._updateStatusBadge();
}
```

`_versionWarned` is reset to `false` on each new connection so that reconnecting after a version bump warns once again.

### Smoothing

`ps.set()` is the interpolation layer. ParameterSystem slew (per-param, user-configurable in the UI) interpolates between sparse Monty updates and the 60 fps render loop. No separate lerp in MontyBridge.js — slew is already automatable, MIDI-assignable, and visible in the param row. At 15 Hz input, a slew of 0.3–0.5 s on `buffer.fs1` produces smooth motion; users tune this against the mock, and the values transfer directly to Phase 3 live output at the same emission rate.

### Auto-reconnect

Exponential backoff: 1s → 2s → 4s → 8s → capped at 30s. Resets on successful connection.

---

## Param Mapping

| Monty field | Calculation | Target param | Notes |
|---|---|---|---|
| `saccade[0]` | `× (frameCount - 1)` | `buffer.fs1` | `frameCount` read at message time |
| `confidence` | `(1 - confidence) × 32` | `buffer.scatter` | High confidence → low scatter (settled gaze) |
| `prediction_error` | `> 0.7` → trigger | `buffer.capture` | Spike → capture current frame |
| `saccade[1]` | — | unmapped | Reserved; Phase 3 may route to `buffer.fs2` or another param |

**Hardwired for Phase 2.** This is intentional — it demonstrates one coherent artistic mapping and keeps the code minimal. See Phase 3 boundary below for the architectural path to full routability.

---

## UI

A single status row added to the **Buffer panel**, below the Granular section:

```
MONTY  [●]  ws://localhost:8765  [Connect]
```

- `●` green = connected, grey = disconnected, amber = `source === "live"`
- URL field: editable text, same drag/double-click pattern as other fields; stored in localStorage
- Connect/Disconnect button toggles the WebSocket connection
- When connected, badge shows `source` value from last message: `MOCK` or `LIVE`

The status row is built in `UI.js` and wired in `main.js` alongside the OSCBridge toggle.

---

## Wiring — `main.js`

```js
import { MontyBridge } from './io/MontyBridge.js';

// After OSCBridge instantiation:
const montyBridge = new MontyBridge(ps, stillsBuffer);
```

No tick-loop wiring needed — MontyBridge is entirely event-driven (WebSocket onmessage).

---

## Phase 3 Boundary

When real Monty internals are wired, Phase 3 replaces the Python signal generator only. MontyBridge.js and the JSON contract are unchanged.

**Phase 3 architectural option:** Register Monty outputs as named controller sources in `ControllerManager` — `monty.saccade_x`, `monty.confidence`, `monty.prediction_error` — alongside existing sources (LFO, MIDI, Random, OSC). Any parameter could then be routed to a Monty signal through the existing badge/popover UI, and the hardwired mapping in MontyBridge.js becomes a default preset rather than the only path. This architectural step happens once in Phase 3 if the hardwire proves limiting; it does not need to happen in Phase 2.

---

## Files

| File | Change |
|---|---|
| `monty-bridge.py` | New — Python WebSocket server (gitignored) |
| `src/io/MontyBridge.js` | New — WebSocket client, param mapping |
| `src/main.js` | Wire MontyBridge instantiation + UI toggle |
| `src/ui/UI.js` | Add MONTY status row to Buffer panel |
| `.gitignore` | Add `monty-bridge.py` |

---

## Verification

1. `python monty-bridge.py` starts, logs `Monty bridge listening on ws://localhost:8765`
2. `python monty-bridge.py --live` exits with message, non-zero code
3. Open ImWeb → Buffer tab → Connect → badge turns green, shows `MOCK`
4. `buffer.fs1` moves in a slow ~21s sweep; grid highlight tracks it
5. `buffer.scatter` pulses with saccade velocity — rises when saccade sweeps, drops when settled
6. `buffer.capture` triggers ~0.5–2×/sec correlated with sweep velocity
7. Disconnect Python → badge turns grey within 1s; params freeze at last value
8. Restart Python → badge turns green within reconnect backoff; motion resumes
9. Send `{"v":2,...}` manually → one `console.warn` in browser DevTools, no further warnings
10. Resize buffer grid mid-session → `buffer.fs1` immediately re-scales to new `frameCount`

**Verification note — 1D vs 2D velocity (decide during step 5):**
The confidence formula uses only `saccade[0]` velocity. At the turning points of `sx` (every ~10.5 s), `vel ≈ 0` for one or two ticks even though `sy` is mid-sweep, producing brief confidence spikes — brief scatter drops. If these read as distracting "false fixation" pulses, switch to 2D velocity in `monty-bridge.py`:
```python
vel = math.hypot(sx - prev_sx, sy - prev_sy) * hz
vel_norm = min(vel / math.hypot(0.5 * 0.3, 0.5 * 0.17), 1.0)  # max ≈ 0.172
```
If the pulses feel like moments of stillness in the chaos — leave 1D as-is. Step 5 of verification will tell you which.
