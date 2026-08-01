---
name: verify
description: Build, launch, and drive ImWeb in a real browser to verify changes end-to-end (vite preview + Chrome automation).
---

# Verifying ImWeb changes

## Build + launch

```bash
npm run build                 # ~25s; chunk-size warning is normal
npx vite preview --port 4173 --strictPort   # serves dist/; dev server https cert is rejected by automation — use preview
```

## Drive

Use claude-in-chrome (real Chrome, CDP input — synthetic JS pointer events
break on `setPointerCapture`, CDP input works). Navigate to
http://localhost:4173/, wait ~2s for boot.

- Right panel tabs (Mapping / Movies / 3D / Analog / Draw / …) select feature panels;
  section headers inside are collapsed accordions — click to expand.
- Left edge param readout chips (DisplaceSrc, Displace, Keyer ON…) are the fastest
  way to confirm param writes — zoom region (0,60)-(300,160).
- Draw tab: preview canvas sits under DRAW LAYER; buttons Pen/Erase/Clear/color/Fade,
  ⊕ Canvas, ⇢ Warp, ⇢ Key, then the L1–L4 looper strip (● ▶ ✕).

## Critical gotcha: hidden-tab rAF suspension

The automation tab usually reports `document.visibilityState === "hidden"` —
Chrome then suspends requestAnimationFrame entirely, and ImWeb's whole engine
(render loop, DrawLayer queue drain, fade, loop playback, fps meter) runs a
frame ONLY when a CDP screenshot forces one. Consequences:

- fps meter shows 0–1 fps — environment artifact, not a perf bug
  (see also memory: GPU switching / headless Chromium masquerade).
- Anything that needs frames BETWEEN two inputs (e.g. queue drain between
  drawing a stroke and stopping a looper recording) will silently miss —
  **interleave a `screenshot` action to force a frame** before the
  state-dependent click.
- Time-based behavior (fade decay, loop cycles) advances ~1 frame per
  screenshot; don't judge speeds/durations in this state.

## Known-good check sequence (Draw features)

1. Draw tab → expand DRAW LAYER → click Pen → drag on preview → stroke appears smooth.
2. Fade → strokes decay (needs forced frames).
3. L1 ●, drag stroke, screenshot (forces drain), L1 ● again → ▶ accents, stroke replays.
4. ⇢ Warp → left readout shows `DisplaceSrc: Draw`, `Displace: 20.0`.
5. ⊕ Canvas → "MODE: DRAW" OSD; drag on main output → stroke lands in preview; click again to exit.
6. `read_console_messages onlyErrors` sweep at the end.
