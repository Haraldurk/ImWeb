# Monty Bridge Phase 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a WebSocket bridge that connects a synthetic Monty brain-model signal generator (Python) to ImWeb's Stills Buffer params, completing a perceptual loop in mock form.

**Architecture:** `monty-bridge.py` runs a `websockets` async server on port 8765, broadcasting correlated mock signals at 15 Hz. `MontyBridge.js` is a new ImWeb module (parallel to `OSCBridge.js`) that receives these messages and drives `buffer.fs1`, `buffer.scatter`, and `buffer.capture` via ParameterSystem. A minimal status row in the Buffer panel shows connection state and source (`MOCK`/`LIVE`).

**Tech Stack:** Python 3.10+, `websockets` library, asyncio, vanilla JS ES modules, ImWeb ParameterSystem, Three.js r160+ (no changes to renderer).

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `monty-bridge.py` | Create | Python WS server, mock signal generation, `--live` stub |
| `src/io/MontyBridge.js` | Create | WS client, schema validation, param mapping, status badge |
| `src/main.js` | Modify | Import MontyBridge; instantiate after OSCBridge; build status UI in `#buffer-params` |
| `.gitignore` | Modify | Add `monty-bridge.py` |

No changes to `index.html`, `UI.js`, `ParameterSystem.js`, or any shader/pipeline files.

---

### Task 1: Gitignore + Python mock server

**Files:**
- Modify: `/Users/haraldurkarlsson/Documents/GitHub/ImWeb/.gitignore`
- Create: `/Users/haraldurkarlsson/Documents/GitHub/ImWeb/monty-bridge.py`

- [ ] **Step 1.1: Add monty-bridge.py to .gitignore**

Find the section in `.gitignore` that already lists `dev-catcher.js`:

```bash
grep -n "dev-catcher" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/.gitignore
```

Add `monty-bridge.py` on the next line after `dev-catcher.js`:

Old:
```
dev-catcher.js
```

New:
```
dev-catcher.js
monty-bridge.py
```

- [ ] **Step 1.2: Create monty-bridge.py**

```python
"""
monty-bridge.py — Phase 2 mock Monty signal server for ImWeb.

Emits synthetic saccade / confidence / prediction_error signals over WebSocket.
Confidence is correlated with saccade velocity (drops while sweeping, rises when
settled) to mirror real Monty column-voting behaviour. Prediction-error spikes
are biased toward moments of high saccade velocity.

Periods: saccade[0] ≈ 21 s, saccade[1] ≈ 37 s (incommensurate Lissajous pattern).

Usage:
  pip install websockets
  python monty-bridge.py              # 15 Hz, port 8765
  python monty-bridge.py --hz 10
  python monty-bridge.py --live       # exits: Phase 2 stub
"""

import argparse
import asyncio
import json
import math
import random
import time


def parse_args():
    p = argparse.ArgumentParser()
    p.add_argument("--hz",   type=float, default=15.0, help="Emission rate (default 15)")
    p.add_argument("--port", type=int,   default=8765, help="WebSocket port (default 8765)")
    p.add_argument("--live", action="store_true",      help="Use real Monty (Phase 3 — not implemented)")
    return p.parse_args()


def compute_message(t: float, prev_sx: float, hz: float) -> dict:
    sx = 0.5 + 0.5 * math.sin(t * 0.3)          # period 2π/0.3 ≈ 21 s
    sy = 0.5 + 0.5 * math.sin(t * 0.17 + 1.2)   # period 2π/0.17 ≈ 37 s

    # Discrete velocity of saccade[0]; expected max = amplitude × angular_freq = 0.5 × 0.3 = 0.15
    vel     = abs(sx - prev_sx) * hz
    vel_norm = min(vel / 0.15, 1.0)

    # Confidence drops while saccade sweeps, rises when settled
    confidence = max(0.0, min(1.0,
        (1.0 - vel_norm) + random.uniform(-0.05, 0.05)
    ))

    # Prediction error: baseline + Poisson spikes biased toward high saccade velocity
    spike_prob = (0.5 / hz) + vel_norm * (1.5 / hz)
    prediction_error = 0.05 + random.uniform(-0.02, 0.02)
    if random.random() < spike_prob:
        prediction_error = 0.9 + random.uniform(-0.05, 0.05)
    prediction_error = max(0.0, min(1.0, prediction_error))

    return {
        "v": 1,
        "t": int(time.time() * 1000),
        "saccade":          [round(sx, 4), round(sy, 4)],
        "confidence":        round(confidence, 4),
        "prediction_error":  round(prediction_error, 4),
        "source":           "mock",
    }


async def run(hz: float, port: int):
    import websockets

    connected: set = set()

    async def handler(ws):
        connected.add(ws)
        try:
            await ws.wait_closed()
        finally:
            connected.discard(ws)

    async def broadcast():
        t        = 0.0
        prev_sx  = 0.5
        dt       = 1.0 / hz
        while True:
            msg     = compute_message(t, prev_sx, hz)
            prev_sx = msg["saccade"][0]
            payload = json.dumps(msg)
            if connected:
                await asyncio.gather(
                    *[ws.send(payload) for ws in connected.copy()],
                    return_exceptions=True,
                )
            t  += dt
            await asyncio.sleep(dt)

    async with websockets.serve(handler, "localhost", port):
        print(f"Monty bridge listening on ws://localhost:{port}  ({hz} Hz, mock mode)", flush=True)
        await broadcast()


def main():
    args = parse_args()
    if args.live:
        print("Phase 2: --live not implemented. Use Phase 3 for real Monty integration.", flush=True)
        raise SystemExit(1)
    asyncio.run(run(args.hz, args.port))


if __name__ == "__main__":
    main()
```

- [ ] **Step 1.3: Verify Python script starts correctly**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb
pip install websockets 2>&1 | tail -3
python monty-bridge.py --hz 5 &
sleep 1
python -c "
import asyncio, json, websockets
async def t():
    async with websockets.connect('ws://localhost:8765') as ws:
        msg = json.loads(await ws.recv())
        assert msg['v'] == 1, 'bad v'
        assert 'saccade' in msg, 'no saccade'
        assert msg['source'] == 'mock', 'bad source'
        print('OK:', msg)
asyncio.run(t())
"
kill %1 2>/dev/null || true
```

Expected: prints `OK: {'v': 1, 't': ..., 'saccade': [...], ...}` with no assertion errors.

- [ ] **Step 1.4: Verify --live exits with code 1**

```bash
python monty-bridge.py --live; echo "Exit code: $?"
```

Expected: prints `Phase 2: --live not implemented.` and `Exit code: 1`.

- [ ] **Step 1.5: Commit**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb
git add .gitignore monty-bridge.py
git commit -m "feat(monty): add monty-bridge.py mock WS server"
```

---

### Task 2: MontyBridge.js

**Files:**
- Create: `/Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/io/MontyBridge.js`

- [ ] **Step 2.1: Verify the trigger API exists in ParameterSystem**

```bash
grep -n "trigger(" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/io/OSCBridge.js | head -5
```

Expected: `this.ps.trigger(id)` — confirming `ps.trigger(paramId)` is the correct call.

- [ ] **Step 2.2: Create MontyBridge.js**

```js
/**
 * MontyBridge — connects ImWeb to the Monty brain-model WebSocket server.
 *
 * Receives JSON v1 messages: { v, t, saccade:[x,y], confidence, prediction_error, source }
 * Maps them to ParameterSystem:
 *   saccade[0] × (frameCount-1) → buffer.fs1
 *   (1 - confidence) × 32      → buffer.scatter
 *   prediction_error > 0.7     → buffer.capture (trigger)
 *
 * Smoothing: ps.set() respects per-param slew configured in the UI — no
 * separate lerp needed here.
 *
 * frameCount is read live from stillsBuffer on each message so buffer
 * resizes mid-session are handled correctly.
 */
export class MontyBridge {
  constructor(ps, stillsBuffer, { url = 'ws://localhost:8765' } = {}) {
    this._ps           = ps;
    this._stillsBuffer = stillsBuffer;
    this._url          = url;
    this._ws           = null;
    this._active       = false;
    this._versionWarned = false;
    this._source       = '—';
    this._backoff      = 1000;
    this._retryTimer   = null;
    this._statusEl     = null;
  }

  get active() { return this._active; }
  get url()    { return this._url; }

  /** Attach a DOM element whose .querySelector('.monty-dot') and
   *  .querySelector('.monty-source') will be updated on status change. */
  setStatusEl(el) { this._statusEl = el; }

  connect(url = this._url) {
    this._url    = url;
    this._active = true;
    this._openWs();
  }

  disconnect() {
    this._active = false;
    clearTimeout(this._retryTimer);
    if (this._ws) { this._ws.close(); this._ws = null; }
    this._updateBadge('disconnected');
  }

  _openWs() {
    this._versionWarned = false;
    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch (e) {
      console.warn('MontyBridge: bad URL', this._url, e.message);
      this._scheduleRetry();
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      this._backoff = 1000;
      this._updateBadge('connected');
    };

    ws.onmessage = ({ data }) => this._onMessage(data);

    ws.onclose = ws.onerror = () => {
      this._ws = null;
      this._updateBadge('disconnected');
      if (this._active) this._scheduleRetry();
    };
  }

  _scheduleRetry() {
    this._retryTimer = setTimeout(() => this._openWs(), this._backoff);
    this._backoff    = Math.min(this._backoff * 2, 30_000);
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.v !== 1) {
      if (!this._versionWarned) {
        console.warn(`MontyBridge: unknown schema v${msg.v}, expected 1. Ignoring until reconnect.`);
        this._versionWarned = true;
      }
      return;
    }

    if (Date.now() - msg.t > 500) return; // stale

    const n = this._stillsBuffer.frameCount; // live — correct after buffer resize
    this._ps.set('buffer.fs1',     msg.saccade[0] * (n - 1));
    this._ps.set('buffer.scatter', (1 - msg.confidence) * 32);
    if (msg.prediction_error > 0.7) this._ps.trigger('buffer.capture');

    this._source = msg.source ?? '—';
    this._updateBadge('connected');
  }

  _updateBadge(state) {
    if (!this._statusEl) return;
    const dot = this._statusEl.querySelector('.monty-dot');
    const src = this._statusEl.querySelector('.monty-source');
    if (dot) {
      dot.style.color = state === 'connected'
        ? (this._source === 'live' ? '#c8a020' : '#40c060')
        : '#404050';
    }
    if (src) src.textContent = state === 'connected' ? this._source.toUpperCase() : '—';
  }
}
```

- [ ] **Step 2.3: Verify the file was created**

```bash
grep -n "export class MontyBridge" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/io/MontyBridge.js
```

Expected: line 1 (or close), `export class MontyBridge {`.

- [ ] **Step 2.4: Commit**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb
git add src/io/MontyBridge.js
git commit -m "feat(monty): add MontyBridge.js WS client"
```

---

### Task 3: Wire MontyBridge in main.js

**Files:**
- Modify: `/Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/main.js`

- [ ] **Step 3.1: Find the OSCBridge import line**

```bash
grep -n "OSCBridge\|import.*io/" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/main.js | head -10
```

Expected: something like `import { OSCBridge } from "./io/OSCBridge.js";` at around line 61.

- [ ] **Step 3.2: Add MontyBridge import after the OSCBridge import**

Old:
```js
import { OSCBridge } from "./io/OSCBridge.js";
```

New:
```js
import { OSCBridge } from "./io/OSCBridge.js";
import { MontyBridge } from "./io/MontyBridge.js";
```

- [ ] **Step 3.3: Find the OSCBridge instantiation line**

```bash
grep -n "new OSCBridge\|const oscBridge" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/main.js
```

Expected: `const oscBridge = new OSCBridge(ps, presetMgr);` at around line 1763.

- [ ] **Step 3.4: Instantiate MontyBridge after OSCBridge**

Old:
```js
  const oscBridge = new OSCBridge(ps, presetMgr);
```

New:
```js
  const oscBridge   = new OSCBridge(ps, presetMgr);
  const montyBridge = new MontyBridge(ps, stillsBuffer);
```

> **Note:** `stillsBuffer` is already in scope at this point — confirm with:
> `grep -n "const stillsBuffer\|stillsBuffer =" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/main.js | head -5`

- [ ] **Step 3.5: Find the OSCBridge click-handler block**

```bash
grep -n "status-osc\|oscBridge.active\|oscBridge.connect\|oscBridge.disconnect" /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src/main.js | head -10
```

Expected: the `document.getElementById("status-osc")?.addEventListener` block around line 1791.

- [ ] **Step 3.6: Add MontyBridge UI row and click handler after the OSCBridge block**

Find the closing `});` of the `status-osc` click handler and insert immediately after it:

Old (the comment that follows the OSC block):
```js
  // Project file UI — #project-file-ui container in Presets tab
```

New (insert the MONTY UI block before that comment):
```js
  // MontyBridge status row — injected into #buffer-params in Buffer tab
  (() => {
    const container = document.getElementById('buffer-params');
    if (!container) return;

    const savedUrl = localStorage.getItem('imweb-monty-url') || 'ws://localhost:8765';
    container.innerHTML = `
      <div class="param-row" style="padding:4px 10px;display:flex;align-items:center;gap:8px;border-top:1px solid var(--border);">
        <span style="font-size:10px;color:var(--text-2);letter-spacing:.05em;flex-shrink:0;">MONTY</span>
        <span class="monty-dot" style="font-size:14px;line-height:1;color:#404050;">●</span>
        <span class="monty-source" style="font-size:9px;color:var(--text-2);flex:1;">—</span>
        <button id="btn-monty-connect" style="
          background:var(--bg-3);border:1px solid var(--border);border-radius:3px;
          color:var(--text-1);font-size:9px;padding:2px 7px;cursor:pointer;">Connect</button>
      </div>`;

    montyBridge.setStatusEl(container.querySelector('.param-row'));

    document.getElementById('btn-monty-connect')?.addEventListener('click', () => {
      if (montyBridge.active) {
        montyBridge.disconnect();
        document.getElementById('btn-monty-connect').textContent = 'Connect';
      } else {
        const url = prompt('Monty WebSocket URL:', savedUrl);
        if (!url) return;
        localStorage.setItem('imweb-monty-url', url);
        montyBridge.connect(url);
        document.getElementById('btn-monty-connect').textContent = 'Disconnect';
      }
    });
  })();

  // Project file UI — #project-file-ui container in Presets tab
```

- [ ] **Step 3.7: Build check**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb && npx vite build --mode development 2>&1 | tail -10
```

Expected: `✓ built in` with no errors. Warnings about chunk size are pre-existing and OK.

- [ ] **Step 3.8: Commit**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb
git add src/main.js
git commit -m "feat(monty): wire MontyBridge in main.js with Buffer panel status row"
```

---

### Task 4: Smoke test

No automated tests are available for WebGL/WebSocket browser features. Use the verification checklist below.

**Prerequisites:**

```bash
# Terminal 1 — ImWeb dev server
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb && npm run dev

# Terminal 2 — Monty bridge
python monty-bridge.py
```

- [ ] **Step 4.1: Bridge server starts**

Terminal 2 shows: `Monty bridge listening on ws://localhost:8765  (15 Hz, mock mode)`

- [ ] **Step 4.2: Connect from ImWeb**

Open `http://localhost:5173` → Buffer tab → scroll to bottom of param list → see `MONTY ● —  [Connect]` row → click Connect → accept `ws://localhost:8765` in prompt → button changes to "Disconnect", dot turns green, source shows `MOCK`.

- [ ] **Step 4.3: buffer.fs1 moves**

In Buffer tab, watch the FrameSelect 1 slider — it should sweep slowly (≈21s period). The active slot highlight in the grid canvas tracks it.

- [ ] **Step 4.4: buffer.scatter pulses with velocity**

Watch the Scatter slider — it rises during the fast part of the saccade sweep and drops near the turning points (every ~10.5s). Add slew to `buffer.fs1` if the motion feels jerky (right-click or Ctrl-click the `—` badge on FrameSelect 1 → Fixed → drag Slew).

- [ ] **Step 4.5: buffer.capture triggers**

Enable auto-capture or ensure at least one frame is in the buffer. Watch `buffer.capture` — it should trigger ~0.5–2×/sec, correlated with fast saccade moments. Each trigger writes the current frame to the write slot.

- [ ] **Step 4.6: Disconnect and reconnect**

Click Disconnect → dot turns grey, source shows `—`, params freeze. Kill `monty-bridge.py` (Ctrl+C) → already disconnected. Restart `python monty-bridge.py` → click Connect → reconnects and motion resumes.

- [ ] **Step 4.7: Version mismatch warning**

In browser DevTools console, paste:

```js
// Simulate a v2 message arriving (requires access to ws — skip if not easily accessible)
// Instead, verify by reading the _onMessage source directly
```

Open DevTools → Sources → `src/io/MontyBridge.js` → confirm `console.warn` on `v !== 1` with `!this._versionWarned` guard.

- [ ] **Step 4.8: Mid-session buffer resize**

In the Buffer tab, change `buffer.rows` or `buffer.cols` (resizing the grid) while the bridge is running. Watch `buffer.fs1` — it should immediately re-scale its range to the new `frameCount` (e.g., if you shrink from 64 to 16 slots, the sweep stays within 0–15).

- [ ] **Step 4.9: Final commit**

```bash
cd /Users/haraldurkarlsson/Documents/GitHub/ImWeb && git push
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ JSON schema v1 with all 6 fields → Task 1 (compute_message)
- ✅ `--live` exits cleanly → Task 1 Step 1.4
- ✅ 15 Hz default, `--hz` flag → Task 1 monty-bridge.py
- ✅ Velocity-correlated confidence → Task 1 (vel_norm formula)
- ✅ Spike-biased prediction_error → Task 1 (spike_prob formula)
- ✅ `v !== 1` → single `console.warn`, not per-message → Task 2 `_onMessage`
- ✅ `_versionWarned` reset on reconnect → Task 2 `_openWs`
- ✅ `frameCount` read live, not from closure → Task 2 `_onMessage`
- ✅ Stale message discard (`> 500ms`) → Task 2 `_onMessage`
- ✅ Auto-reconnect with exponential backoff capped at 30s → Task 2 `_scheduleRetry`
- ✅ `source` shown in status badge → Task 2 `_updateBadge` + Task 3 UI
- ✅ URL stored in localStorage → Task 3 Step 3.6
- ✅ Build passes after wiring → Task 3 Step 3.7
- ✅ 2D velocity note → Verification Step 4.4 prompt (user decides during tuning)

**Phase 3 boundary:** `monty-bridge.py --live` slot exists and exits cleanly. MontyBridge.js and the JSON contract are unchanged for Phase 3.
