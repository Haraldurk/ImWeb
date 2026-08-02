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

**Check `document.hidden` FIRST, before anything else.** Hidden means the render
loop is stopped, so 0 fps, stale param readouts and a black canvas are all
expected — and every in-app observation you make is void. Establish this before
forming any hypothesis, or you will debug the app instead of the tab.

**Never `await` a bare `requestAnimationFrame` from a probe.** A backgrounded
tab suspends rAF, the promise never settles, and the CDP call dies at its 45 s
timeout looking exactly like a frozen renderer. Two "renderer wedges" in one
session were this, and the second nearly got blamed on a large unrolled shader.
Race every rAF against a `setTimeout`:

```js
await Promise.race([
  new Promise(r => requestAnimationFrame(r)),
  new Promise(r => setTimeout(r, 250)),
]);
```

## Driving the custom `.imw-sel` dropdowns

These are not `<select>` elements, and two properties of them have each cost a
session.

**Scope every click to the one open menu.** Matching option text with a
document-wide query lands in the wrong menu — several can be in the DOM at once.
Three scripted picks in a row once hit the wrong selector and left the owner's
live tab on `Foreground = Fractal`. Use `.imw-sel-menu .imw-sel-item` scoped to
the menu you just opened, or click by screenshot coordinates.

**`.imw-sel-trigger` TOGGLES.** A probe that opens a menu and then fails leaves
it open, so the next attempt *closes* it and reports `menus=0` — forever, across
retries that all look like "the dropdown will not open". Reset any visible menu
before opening one.

**Testing visibility: `offsetParent !== null` is always false here.** The menu is
`position: fixed`, so that check can never succeed. Test `style.display` plus a
non-zero bounding rect instead.

## Readings that lie

Numbers that look plausible are the failure mode this app specialises in. Two
readbacks are dead by construction:

- **A service worker (`imweb-v0.7`) serves a CACHED `index.html` on localhost.**
  `curl` returns the new markup while the tab renders the old one, so every new
  container id reads as MISSING. Unregister the SW and clear caches before
  concluding a DOM change did not land.
- **`drawImage(webglCanvas)` into a 2D canvas returns a STALE frame** without
  `preserveDrawingBuffer`. Four different source selections once gave
  bit-identical luma/chroma to 0.1 while the field was visibly animating.

The general rule: **identical readings across a control that visibly moves means
the READBACK is dead, not the control.** Fall back to the screenshot tool.

**And a failing headless check is a real signal until proven otherwise.** Verify
with a positive control before blaming the environment — zero CodeMirror
highlight spans were dismissed as a headless artifact, and the legacy clike mode
turned out to be genuinely broken in real Chrome too. "It's just the automation"
is a conclusion, not a starting assumption.

## Known-good check sequence (Draw features)

1. Draw tab → expand DRAW LAYER → click Pen → drag on preview → stroke appears smooth.
2. Fade → strokes decay (needs forced frames).
3. L1 ●, drag stroke, screenshot (forces drain), L1 ● again → ▶ accents, stroke replays.
4. ⇢ Warp → left readout shows `DisplaceSrc: Draw`, `Displace: 20.0`.
5. ⊕ Canvas → "MODE: DRAW" OSD; drag on main output → stroke lands in preview; click again to exit.
6. `read_console_messages onlyErrors` sweep at the end.
