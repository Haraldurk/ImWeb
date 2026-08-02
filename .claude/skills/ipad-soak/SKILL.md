---
name: ipad-soak
description: Run the pending iPad soak tests on real hardware — dual-deck thermal/decoder budget and the 8-tab bar. Device checklist with defined pass criteria. Use when an iPad is available and the open verification debts need closing.
---

# iPad soak test

Two verification debts have been open since v0.12, both recorded in
`docs/imweb-obsidian.md` (lines 375, 415, 568):

1. **Dual-deck thermal + decoder budget** — two 1080p ALL-I clips through the
   WebGL chain. The blueprint is explicit that this is "a device-measured
   question, not a bench guess."
2. **The 8-tab bar on real hardware** — Phase 23 took the tab bar to 8 tabs.

They stay open because they need a physical iPad. An agent cannot run these:
the iOS Simulator shares the Mac's CPU/GPU and has no hardware video decoder,
so it cannot answer either question. **This is an owner task.** The point of
this file is that it should take 30 minutes, not an afternoon.

---

## Setup

**Serve the built app to the LAN.** Soak the production build, not the dev
server — HMR and unminified modules distort the numbers.

```bash
npm run build
npx vite preview --host --port 4173 --strictPort
```

`--host` is required: `vite.config.js` sets `host: true` on the **dev** server
only, so preview stays on localhost without it.

Find the address to type into the iPad:

```bash
ipconfig getifaddr en0
```

Then open `http://<that-ip>:4173/` in iPad Safari. Preview is HTTP-only (the
mkcert HTTPS block is under `server`, not `preview`) — fine here, because
neither test needs the camera. If you do need `getUserMedia`, use
`npm run dev:https` instead, which needs `certs/dev-cert.pem` + `dev-key.pem`.

**Attach Safari Web Inspector.** Cable the iPad to the Mac, enable
Settings → Safari → Advanced → Web Inspector on the device, then Mac Safari →
Develop → <iPad> → the page. Without this there is no console and no numbers.

**Clips.** Two 1080p ALL-I files, produced by the prep pipeline
(`npm run prep-video` writes `*_ALL-I.mp4` into `_imweb_ready/`). ALL-I matters:
long-GOP clips hide decoder cost behind keyframe spacing, which is the opposite
of what this test is trying to measure. Load one onto Deck A and one onto Deck B.

---

## Reading the numbers

`src/perf-logger.js` already tracks frame timing and publishes
`window.__perfStats` every 5 s — `{ fps, avg_ms, p95_ms, worst_ms, jank }`,
where jank counts frames over 20 ms.

**It does not accumulate.** `jank` and `worst_ms` reset after every report, and
`__perfStats` only ever holds the most recent 5-second window, so polling by
hand loses everything in between. Paste this into the Web Inspector console
first and leave it running:

```js
window.__soak = { samples: [], worst: 0, jank: 0, t0: Date.now() };
setInterval(() => {
  const s = window.__perfStats; if (!s) return;
  const k = window.__soak;
  if (k.samples.at(-1) && k.samples.at(-1).worst_ms === s.worst_ms
      && k.samples.at(-1).jank === s.jank) return;   // same window, skip
  k.samples.push({ ...s, min: ((Date.now() - k.t0) / 60000).toFixed(1) });
  k.worst = Math.max(k.worst, s.worst_ms);
  k.jank += s.jank;
}, 2000);
// later:  copy(JSON.stringify(window.__soak))
```

Note `ENABLED = false` in perf-logger.js gates only the `console.log`;
`window.__perfStats` is published either way, so no rebuild is needed.

---

## Test A — dual-deck thermal + decoder budget

The question is not "what fps do we get." It is **whether idle-deck upload
gating works**: when `mix.xfade` sits at 0 or 1, the hidden deck's `texImage2D`
upload is supposed to stop, so performing on one deck should cost about what
v0.11 did. Assert that relationship, with a direction.

Run each phase for a **full 5 minutes** and record `window.__soak` at the end of
each. Do not judge anything in the first 3 minutes — thermal effects are the
point, and the device is cold.

| Phase | Setup | What it establishes |
|---|---|---|
| 1 | Deck A playing, Deck B empty, `xfade = 0` | Baseline, single stream |
| 2 | Both decks loaded, `xfade = 0` | **Gating works?** Should be close to phase 1 |
| 3 | Both decks loaded, `xfade = 0.5` | Worst case — both uploading every frame |
| 4 | Back to `xfade = 0` for 5 min | **Does it recover, or has it thermally throttled?** |

Add the usual chain on top — a keyer, displacement, one post-FX — so this
measures the instrument rather than two video textures.

### Pass criteria

- **Phase 2 ≈ Phase 1.** Within ~15% on `avg_ms`. If phase 2 tracks phase 3
  instead, the gating is not firing and the idle deck is still uploading.
- **Phase 3 sustains ≥ 30 fps** with `p95_ms` under 40 ms. Below that, two
  1080p ALL-I streams are simply past the device's budget and the answer is a
  documented limit, not a bug.
- **Phase 4 returns to within ~10% of phase 2.** If it does not, the device
  thermally throttled and the ceiling is thermal rather than architectural —
  which is a different finding and worth recording as such.
- **No unbounded growth** in `avg_ms` across a phase. A slow climb over 5
  minutes is a leak, not a budget problem.

---

## Test B — the 8-tab bar

Sources · Mix · Effects · Output | 3D · Analog · Draw · Project, on a real
touchscreen rather than a trackpad.

- Can you hit each tab first time, one-handed, holding the iPad? Note any that
  need a second attempt.
- Do the labels truncate in portrait? In landscape?
- Does the open `MixBus-Rethink-Blueprint` question resolve — should **Output**
  fold into another tab to get back to 7?
- Section headers inside each tab are collapsing accordions: does expanding one
  push the rest off-screen?

This is a judgement call, not a measurement. Record the verdict either way —
"8 tabs are fine" is a result and closes the debt.

---

## Traps

- **Backgrounding Safari suspends rAF**, exactly as a hidden desktop tab does
  (see `docs/LEARNED.md`, and the `verify` skill). Do not switch apps mid-phase
  and then read the numbers — the gap is not a stall. Restart the phase.
- **Auto-Lock will end your soak.** Settings → Display & Brightness →
  Auto-Lock → Never before starting.
- **Low Power Mode caps the GPU** and invalidates every number. Check it is off.
- **The first run after a build is not representative** — shader compilation and
  texture upload happen once. Discard the first minute.

---

## Recording the result

Both debts are tracked in `docs/imweb-obsidian.md` (lines 375, 415, 568) as
`⏳ pending`. Update them with the outcome and the date, add a CHANGELOG entry
if anything changed, and if the run produced a lesson worth keeping, append it
to `docs/LEARNED.md` per the `imweb-debugging` skill.

If the gating turns out not to fire, that is a real bug in the Step 5 work and
should get its own entry — with the phase-1-vs-phase-2 numbers as evidence.
