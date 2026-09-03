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

## Critical gotcha: an AudioWorklet that answers the phone but is dead

Same family as the rAF suspension above, and nastier, because a frozen audio
thread has no fps readout to glance at.

Claude Code's in-app browser pane **may** run Chrome with `--disable-audio`.
With no output device the render thread never pulls, so `process()` is NEVER
CALLED — while everything you would check reports health:

- `AudioContext.state` is `'running'`
- `addModule()` resolves and the processor constructs
- `port.postMessage` works in **both** directions
- `onprocessorerror` stays silent, because nothing threw

So every check that talks to the engine over the port passes against a
completely frozen thread. One step-2 harness had 31 checks and 29 were green in
that state, including two that read like real DSP verification: "relayout is
refused while a zone runs" passes on the message thread alone, and "relayout
succeeds once the zone has faded out" passes because the gain it waits for
**starts** at 0 — a fade that never ran is indistinguishable from one that
completed.

**Lead with a liveness proof, not with an assumption.** The proof has to be a
message only `process()` can emit — in this codebase `/tape/env/dirty`, which
is flushed from the callback and nowhere else. Wait for it with a real timeout
and **skip** the audio-dependent checks when it does not arrive, rather than
letting thirty downstream assertions report misleading failures.

```js
const alive = await Promise.race([
  waitForMessage('/tape/env/dirty'),                       // callback-only
  new Promise(r => setTimeout(() => r(null), 2000)),
]);
if (!alive) { console.log('SKIP: audio callback never ran'); /* skip, do not fail */ }
```

**Do not harden this into "audio never works in the pane."** That is the mirror
of the original mistake and it throws away the strongest evidence available: a
later session had `--disable-audio` on no Chrome process at all, `process()`
genuinely ran, and an Off→On round trip verified a worklet-restart path no
message-level check could have reached. Let the proof tell you which
environment you are in.

One `ps` on the browser flags is still the fastest way to EXPLAIN a negative —
but it is the explanation, not the gate:

```bash
ps ax -o command | grep -o -- --disable-audio      # note the -- : grep parses a leading dash as an option
```

Sound itself is never verifiable from here. Say plainly which parts went
unverified, and hand audio work to the owner's own Chrome.

## Critical gotcha: `computer` input can land NOWHERE, silently

Known for keys since 2026-08-26. **It is also true of clicks** (2026-08-27):
two `left_click` calls at coordinates `document.elementFromPoint()` confirmed
were the right element produced ZERO events on a capture-phase listener. The
tool reports `Clicked at (x, y)` and succeeds either way, so there is nothing
to notice — it reads as "the app ignores this control".

**The tell is the screenshot.** When `screenshot` returns *"script injection
timed out — the page is busy"*, the render loop is saturating the main thread
and the whole input path is unreliable. Do not interpret a non-response to a
click while screenshots are timing out.

**Prove input arrives before testing behaviour:**

```js
window.__clicks = [];
document.addEventListener('click', e =>
  window.__clicks.push({ x: e.clientX, y: e.clientY, tag: e.target.tagName, trusted: e.isTrusted }),
  true);
// ...issue ONE computer left_click, then read window.__clicks.
// Empty array ⇒ the harness is the problem, not the app.
```

**Fall back to `el.click()` from `javascript_tool`.** Before assuming that is
insufficient, check whether the path under test actually needs a *trusted*
gesture — most do not. Audio is the usual worry and usually a false one: the
worklet-load failure happens at `addModule()`, before any
`AudioContext.resume()`, so a synthetic click verified it completely and the
autoplay policy never entered into it. Say plainly which parts went unverified
at OS level.

## Critical gotcha: panels build ~1.5 s AFTER `readyState: "complete"`

Read the DOM before that and every `*-params` container has 0 children and
`#output-canvas` is still at its default 300x150 — indistinguishable from the
"module graph failed to load" symptom CLAUDE.md warns about, and it sent one
session hunting a boot failure that did not exist. Console capture showed
nothing because there was no error.

Poll for a built panel before reading anything:

```js
for (let i = 0; i < 40 && !document.querySelector('#audio-engine-params')?.children.length; i++)
  await new Promise(r => setTimeout(r, 100));
```

To catch a REAL boot error, inject an error probe into `dist/index.html` ahead
of the module script — `dist` is gitignored, so instrumenting it touches no
source:

```html
<script>
window.__errs = [];
addEventListener('error', e => window.__errs.push({ msg: e.message, src: e.filename, line: e.lineno }));
addEventListener('unhandledrejection', e => window.__errs.push({ msg: String(e.reason?.message ?? e.reason) }));
</script>
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

- **A service worker serves a CACHED `index.html` on localhost.** `curl` returns
  the new markup while the tab renders the old one, so every new container id
  reads as MISSING. The cache name is bumped per release — read it from
  `public/sw.js` (`const CACHE = …`) rather than trusting any version written
  down here, this one included.

  **Unregistering is not enough on its own — you must also RELOAD.** The
  existing controller stays attached to the current page, so `getRegistrations()
  → unregister()` plus `caches.delete()` leaves the *already-loaded* tab still
  being served by the old worker. A file added to `dist/` mid-session read as
  "not served" through three retries until the page was reloaded:

  ```js
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  for (const k of await caches.keys()) await caches.delete(k);
  // then navigate/reload — and confirm navigator.serviceWorker.controller === null
  ```
- **`drawImage(webglCanvas)` into a 2D canvas returns a STALE frame** without
  `preserveDrawingBuffer`. Four different source selections once gave
  bit-identical luma/chroma to 0.1 while the field was visibly animating.
- **`vite preview` will serve a bundle that is no longer in `dist/`.** Rebuild,
  navigate, and the browser can still be running a cached chunk with a hash that
  no longer exists on disk — which reads exactly like "the fix did not work", and
  cost a real fix an hour of being disbelieved. Before trusting any negative
  result, check what the page actually loaded:

  ```js
  [...document.scripts].map(s => s.src.split('/').pop())   // vs `ls dist/assets`
  ```

  Navigating with a fresh query string (`?cb=<something new>`) forces the issue.

  Do NOT answer this by starting a dev server of your own — `guard-dev-server.sh`
  blocks that, and for a better reason than this one is worth: a second port is a
  second origin, so presets, warp slots and API keys saved on the owner's :5173
  read as missing and the whole thing looks like an app bug. Rebuild and
  cache-bust instead.

The general rule: **identical readings across a control that visibly moves means
the READBACK is dead, not the control.** Fall back to the screenshot tool.

**And a failing headless check is a real signal until proven otherwise.** Verify
with a positive control before blaming the environment — zero CodeMirror
highlight spans were dismissed as a headless artifact, and the legacy clike mode
turned out to be genuinely broken in real Chrome too. "It's just the automation"
is a conclusion, not a starting assumption.

## Fixtures that cannot fail

A dead readback and a dead *fixture* look identical from here — both give you
the same picture whether or not the fix is present. The rule above catches the
first. This catches the second: **choose the input so that "applied" and "not
applied" cannot be mistaken for each other.**

Colour transforms are where this bites, because the default sources are the
worst possible fixtures:

- **The Noise source is greyscale** (`r == g == b`), so any channel-swap LUT is
  the *identity* on it. An R↔B swap verified against Noise proves nothing.
- **Inverting greyscale noise still looks like greyscale noise.** Symmetric
  around mid-grey, so the before and after screenshots are indistinguishable
  by eye.

Both of those read as "the effect isn't doing anything" — which is the exact
symptom of the bug you're trying to confirm you fixed.

**Use a saturating fixture instead.** For a LUT, a constant-colour `.cube` —
every one of the N³ entries the same magenta — settles it in one screenshot:
the whole canvas must become that colour regardless of input. Then sweep the
amount **0 → 50 → 100** rather than checking one endpoint, which proves the
blend as well as the application.

```js
// constant-magenta .cube, N=17
let cube = `TITLE "Magenta"\nLUT_3D_SIZE 17\n`;
for (let i = 0; i < 17 ** 3; i++) cube += `1.0 0.0 1.0\n`;
```

**Do the numeric half outside the app.** Drive the exact shader over known
input colours in a raw WebGL2 context and read pixels back — that gives exact
values (six colours, maxErr 0/255) instead of an impression, and it works while
the tab is hidden. For an upload, `gl.getError()` immediately after
`texImage2D` is the direct evidence: the LUT's old `RGBFormat + FloatType` path
reproduces as `INVALID_OPERATION` with every output pixel `0,0,0`. Reproduce
the *old* path too — a probe that only passes on the new code has not shown you
that it was ever broken.

**Loading a file without the native picker.** File inputs are created on demand
and `inp.click()` opens a picker automation can't see. Patch the prototype, let
the app's own handler run, then restore it — this exercises the real load path
rather than a reimplementation of it:

```js
const orig = HTMLInputElement.prototype.click;
HTMLInputElement.prototype.click = function () {
  if (this.type === 'file') {
    Object.defineProperty(this, 'files', { value: [file], configurable: true });
    this.onchange({ target: this });          // handler is async — await it below
    return;
  }
  return orig.call(this);
};
document.getElementById('btn-load-lut').click();
HTMLInputElement.prototype.click = orig;
// the handler awaits file.text(), so the name element updates a tick later
```

## Gestures the automation cannot speak for

Synthetic events model the SEQUENCE faithfully and the DEVICE not at all. Where a
bug lives in the difference between two ways of performing the same gesture, a
green check here means nothing — hand the last thirty seconds to a real trackpad.

**Ctrl+click is not the same event stream as a right-click, and the whole team is
blind to the difference.** macOS fires `contextmenu` on the MOUSEDOWN of a
Ctrl+click and then still delivers a `click` on the release. A two-finger
secondary click sends button 2 and emits **no `click` at all**. So any menu that
closes on an outside click works perfectly for anyone with secondary click
enabled — which is every maintainer — and is unusable for anyone without it. Four
menus shipped that way for years and it took an outside beta tester to find it.
`tests/audit-contextmenu-dismissal.mjs` now guards the code, but the general
point stands: **when checking a pointer gesture by hand, deliberately use the
gesture you do NOT normally use.**

Do not "fix" this by asking users to turn on secondary click. Ctrl+click and
two-finger click both work, the guide says so, and a workaround in the docs
outlives the bug it was written for.

## Known-good check sequence (Draw features)

1. Draw tab → expand DRAW LAYER → click Pen → drag on preview → stroke appears smooth.
2. Fade → strokes decay (needs forced frames).
3. L1 ●, drag stroke, screenshot (forces drain), L1 ● again → ▶ accents, stroke replays.
4. ⇢ Warp → left readout shows `DisplaceSrc: Draw`, `Displace: 20.0`.
5. ⊕ Canvas → "MODE: DRAW" OSD; drag on main output → stroke lands in preview; click again to exit.
6. `read_console_messages onlyErrors` sweep at the end.
