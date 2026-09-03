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

## Preflight: prove the instrument before you trust it

Six entries in `docs/LEARNED.md` are the same mistake — a reading was believed
without checking that the thing producing it could answer the question. It is
the most expensive recurring class in this project, because a broken instrument
does not error: it returns a plausible number, and the session goes on to debug
the app instead. Run these before forming any hypothesis. Each is one command.

**Is anything listening on that port?** A stale tab is indistinguishable from a
regression — the app renders, panels respond, numbers look right, and the only
tell is the URL bar. Three misdiagnoses in one session came from screenshots of
a build that no longer existed, in tabs pointed at a preview server already shut
down. Read the port out of the report and check it:

```bash
lsof -nP -iTCP:4173 -sTCP:LISTEN        # listener only
```

Then confirm a control the change ADDED is actually in the panel. Two commands,
settled instantly. Prefer verifying on the port the owner already uses; if a
throwaway server must exist, say out loud that it is temporary and shut it down
where they can see. And never `lsof -ti:<port> | xargs kill` — that returns
CLIENTS as well as the listener, so it can kill the owner's browser. Keep
`-sTCP:LISTEN`.

**Does the readback clear?** `read_console_messages` accumulates ACROSS
navigations, so a log you deleted and rebuilt without still comes back — 200
lines of it, over two fresh loads. Re-reading the same channel cannot settle
this. Use evidence the old build *cannot* produce: the loaded bundle's content
hash against the build output, or a symbol that exists only in the new code.

**Can the metric move at all?** A metric that is CAPPED cannot answer a question
about cost. Four soak phases returned avg_ms 16.675 / 16.670 / 16.670 / 16.670 —
all pinned at the vsync ceiling, so "the idle-deck gate fires" and "there is
headroom to absorb the upload" were indistinguishable *by construction*, and the
comparison the protocol was built around could only ever produce a meaningless
pass. Check the ceiling BEFORE the run, not after. Then count the EVENT you care
about rather than inferring it from an aggregate something else is clamping:
three integer counters settled in 65 s what 55 minutes of frame timing could not.

**Can the readout resolve the effect?** A readout is a valid probe only if its
resolution is finer than the thing you are looking for. `agrain.pos` carried
`step: 0.001` under a row that printed 2 decimals, and the verification plan
written for it ("click two grains and watch the row") could not have shown the
fix working *or* failing. `tests/audit-readout-resolution.mjs` now holds the line
for parameter rows, but the general form is still yours to check: an fps counter
averaged over a second cannot show one dropped frame; a 2-decimal gain readout
cannot show a −0.001 trim. State also the conditions under which the bug is even
REACHABLE — a clean run on a 10-second tape gets recorded as a pass for a
collision that needs 45 seconds to occur.

**Are the preconditions machine-read?** Preconditions verified BY EYE are not
verified. Three soak runs were invalidated by a patch nobody could read back —
`layer.ds` on a dead camera source, `displace.amount` still 0, `mix.xfade` at
0.427 where the phase required 0 — each confirmed "set correctly" by a human
looking at sliders. Two cheap fixes: one debug handle that returns every
precondition in a SINGLE call, and the phase-defining values carried on EVERY
telemetry row, so a run proves its own conditions instead of depending on
memory. See `src/soak.js`.

**Alternate the conditions; never measure A then B.** A fixed order cannot tell
the condition apart from anything that drifts across the session, and "measure
A, then measure B" is the natural way to write it. Long-timeslice takes went
first and came in at 57 fps, short ones after at 43–45, and the conclusion wrote
itself — it was published in a PR and a commit message as "the single largest
frame-rate win". It was wrong: performance degraded monotonically all session
for an unrelated reason, so *whatever ran first would have won*. Run **A B A B**
or randomise, which turns a session-wide drift from a confound that INVENTS an
effect into noise that merely widens the error bars. Two corollaries: **report
the running order with the result** — a table of conditions with no time column
hides this — and remember that a confound big enough to invent an effect is
usually big enough to see directly, so plot each take's own progression rather
than one number per take. That is what showed the first take falling 46 → 21 fps
*within itself*, which no cross-condition table could have.

**A performance recommendation is a claim, and an unmeasured one belongs in no
document.** A merged investigation doc correctly diagnosed the recorder's frame
rate as encoder throughput, then recommended promoting VP8 over VP9 as a
one-line change because VP8 is the cheaper codec. True — up to a point. Measured
at 8 Mbit/s: VP8 is 1.75× faster at 0.58 MP and 1.62× at 2.06 MP, then falls off
a cliff — **7.7 fps against VP9's 26.8 at 2048×1280**. Between writing the
recommendation and acting on it, 1440p and 4K presets shipped, so the "cheap
performance fix" would have landed as a **7× regression at a headline resolution
of the release that introduced it**. Three rules follow. **The window between
writing a recommendation and acting on it is where it goes stale** — re-measure a
parked one against the CURRENT feature set, not the one that produced it.
**Scale the measurement to the whole supported range, not the case that prompted
it**: every real recording measured was under 2.06 MP, exactly the region where
VP8 wins, so measuring "the sizes we have files for" would have confirmed the
wrong answer with clean data. **State what the measurement does not establish** —
naming the untested path, the single machine, and the one unexplained
non-monotonic row is what lets a reader know how far to trust a 7× margin.

**And read a red result as a claim about the instrument too.** Three times in
one session the check was the broken thing: an audit that failed a correct
refactor because it matched a syntactic accident; a source scrape anchored on a
bare name that hit the call site instead of the definition; a render harness
measuring an annulus around image centre, where there was no disc at all. Before
believing a failure, confirm the check can distinguish the two states it judges,
and that it is looking where the effect actually is. A metric that scores both
states the same is not weak evidence — it is no evidence, in either direction.
An audit that fails on correct code teaches people to delete audits, which costs
more than the audit ever saved.

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
