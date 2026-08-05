# ImWeb — Guided Tour

The content of the in-app guided tour (**Shift+G**, or Project ▸ AI ▸
Documentation ▸ Guided Tour). This file *is* the tour — the panel parses it at
runtime, so editing the prose here changes what the app says. It is also meant
to read straight through as a document.

**The tour points; it never sets.** Each step names parameters, and the panel
gives you a button per name that switches to the right tab, opens the right
section, and flashes the row. Your hand moves the control. Nothing in this file
can change a value, which is why it is safe to open mid-performance.

Step grammar, for anyone editing: one `## ` heading per step, optionally
followed by a `<!-- guide … -->` block naming `tab:`, `point:` (parameter ids),
`show:` (CSS selectors), and `keys:` (keycaps to display). Everything above the
first `## ` — including this preamble — is not part of the tour.

---

## Two keys before anything else
<!-- guide
keys: ?, /
-->

**`?`** opens the keyboard shortcut overlay. **`/`** opens parameter search:
type any part of a name, `↑`/`↓` to move, `Enter` to jump. The search results
are live parameter rows — you can edit them right there — and the **⌖** button
on each scrolls the real panel to it.

That is the whole navigation story. Every "Sources ▸ From the Signal ▸ …" path
in this tour has a two-second version: press `/` and type three letters.

The panel's five tabs run left to right in signal order: **Sources · Mix ·
Effects · Output · Project**. Click any section header to collapse or expand it.
If a panel looks empty, you are looking at a collapsed header.

## How a parameter row works
<!-- guide
point: camera.active
-->

Every row is the same shape: **label · badge · min · max · value**, with a thin
slider underneath.

Two of these are not what you would guess:

- **Drag the row left/right** to change the value — horizontal, not vertical.
  About 200px of travel covers the full range. Vertical scrolls the panel.
- **Double-click resets to default.** To *type* a number, **Ctrl+click (⌘+click)
  the value**, then `Enter`. `Esc` cancels.
- **Alt+wheel** over a row is a fine adjust: 1% of range per notch, 5% with
  `Shift`.

The **min/max** fields are the *controller* range — the span a Random or LFO
will sweep, not the parameter's hard limits. Those drag vertically (0.1 per
pixel, `Shift` for one step per pixel) and type-in on double-click.

**Right-click any row** to assign a controller; **right-click the badge** to
edit the one already there. On a tablet, long-press is right-click and
double-tap is type-in.

## Get a picture
<!-- guide
tab: mix
point: camera.active, layer.bg
keys: v, a
-->

Press **`v`** and allow the camera prompt.

Then press **`a`** until **Background** reads `Camera` — `a` cycles the
Background source and the OSD names each one as it passes. **`q`** does the same
for Foreground, **`z`** for DisplaceSrc. That is how you audition 33 sources in
under a minute, and it is the single most useful habit in the instrument.

## Rutt-Etra Scan Processor
<!-- guide
point: rutt.active, rutt.source, rutt.zgain, rutt.lines, rutt.dist
keys: a
-->

Scanlines deflected by luminance, viewed through an orbiting camera. The one
machine of the trio — Sandin, Paik/Abe, Rutt/Etra — with no representation here
until v0.15. Built faithful before general, on the argument that the machine is
beautiful because it lies about depth.

Press **`a`** until Background reads `Rutt-Etra`, then find it in
**Sources ▸ From the Signal ▸ Rutt-Etra**. Four subsections: **Scan · Depth ·
Camera · Phosphor**.

Drag **Z Gain** right until the picture leaves the plane. It is signed —
negative inverts the relief, so highlights become valleys, and that is half the
expressive range of the machine. Then orbit with **Angle**, **Elev** and
**Dist**.

**Lines** is how many scanlines you are actually looking at. Low counts are the
1972 look; high counts stop being lines and become a surface.

For an orbit that runs itself: right-click **Angle** → LFO, then right-click the
LFO badge and set Freq around 0.05 Hz.

## SDF field renderer
<!-- guide
point: sdf.active, sdf.shape, sdf.glow, sdf.glowSize, sdf.texSrc, sdf.texBlend
keys: a, z
-->

Thirteen shapes, orbit camera, two-stop glow. Press **`a`** until Background
reads `SDF`.

**Glow** is deliberately two-stop — an inner and an outer with independent hue,
saturation and value. Set the inner tight and the outer wide and it stops
looking like a bloom filter.

**Video ▸ Tex Src** feeds any source onto the surface, so the raymarcher can
wear the camera.

Then the part worth staying for: `SDF Depth` is the same render's depth, packed
into the colour target's alpha and routable as its own source. Press **`z`**
until DisplaceSrc reads `SDF Depth` and the picture gets pushed around by a
solid you can no longer see.

## Motion Extraction into the keyer
<!-- guide
tab: mix
point: motion.source, keyer.active, keyer.keysrc, keyer.white, keyer.black
keys: k
-->

A matte of what moves: white where the picture moves, black where it does not.
Built to be routed into the keyer, not to be looked at.

Set **Motion src** to `Camera`, press **`k`** for the keyer, then set **Key
src** to `Motion`.

**Now set KeyLevelWhite to 100%** — Ctrl+click the value, type `100`, `Enter`.
The keyer passes a *band*: it rejects the very bright as well as the very dark,
so at the default 80% a fully lit matte is keyed out, which reads as the
strongest motion being the only thing that fails to show. Let **KeyLevelBlack**
alone do the cutting.

Put two different sources in Foreground and Background with `q` and `a`. Only
the moving part of the Foreground now shows over the Background.

## Tuning the motion matte
<!-- guide
point: motion.gain, motion.bgtime, motion.trail, motion.blur
-->

Four rows, worth taking in this order:

- **Sensitivity** — a raw frame-to-frame difference is a few percent, so this is
  what lifts it into the keyer's useful range.
- **Bg adapt** — background half-life in seconds. Long values keep a subject who
  stops moving *in* the matte. Zero makes the background exactly the previous
  frame, which is plain frame differencing: stop moving and you vanish. The
  interesting settings are in between, which is why it is one knob and not a
  mode switch.
- **Trail** — seconds until a wake is gone.
- **Smoothness** — blurs the source *before* the comparison. Kills sensor grain,
  and fills interiors, so silhouettes come out solid rather than hollow.

## RGB Channel Delay
<!-- guide
point: rgbdelay.r, rgbdelay.g, rgbdelay.b, delay.source
keys: a
-->

Red, green and blue each read a different frame of history. Press **`a`** until
Background reads `RGB Delay`.

Equal values on all three are a bit-exact passthrough, so neutral is always one
drag away. Small spreads (1 / 5 / 9) smear; wide spreads separate into three
distinct ghosts of the same gesture.

It reads the Video Delay ring, so **Video Delay ▸ Source** decides *what*
history is being delayed.

## Spacetime — time as a first-class axis
<!-- guide
point: td.captureSource, td.angle, td.mapSource, vwarp.source, slitscan.source, delay.source
-->

Every temporal engine — Time Displace, Slit Scan, Video Delay, Warp Tape — used
to be hardwired to the composite. Since v0.15 they share one frame history and
each picks its own way in, and Time Displace additionally gets an arbitrary
angle and a **map source**.

They all live in **Sources ▸ From the Signal ▸ Warp**. Warp Tape defaults to the
camera rather than the composite, which matches the lineage: Steina performed to
a camera.

One deliberate experiment: set Time Displace's **map source** to `Motion`. Time
then bends only where the picture moved.

## Three mix buses
<!-- guide
tab: mix
point: mix.srcA, mix.srcB, mix.xfade, mix.mode, mix2.srcA
keys: a
-->

**srcA** and **srcB** are free source selectors resolved through the same
resolver the layers use — a bus is a real graph node, not a hardwired deck
crossfader. Pick any two of the 33.

Press **`a`** until Background reads `Mix 1`. Then set **Mix 2 ▸ srcA** to
`Mix 1`: buses can read each other.

Each bus is double-buffered, and the rule has no special cases. A bus reading an
*earlier* bus sees this frame; reading a *later* bus, or itself, sees last
frame — which is a feedback path, deliberately, not a bug to guard against.

## Warp drawing
<!-- guide
tab: mix
point: touch.mode, displace.warpDrawRadius, displace.warpDrawAmt, displace.warpSlot, displace.warpPreset
show: #warp-editor-container
keys: g
-->

Draw the displacement map straight onto the output canvas.

**First press `g`** until the mode OSD reads **Pad** or **Locked**. In Camera
mode a drag on the canvas orbits the 3D camera instead of drawing — that is the
first thing to trip over here.

Now drag on the main output canvas. The picture smears where you drag, in the
direction you drag.

**Radius** and **Strength** are single parameters shared by all three drawing
surfaces — the mini editor, the main canvas, and the WarpDrawX/Y controllers —
so setting them once sets them everywhere. The editor's sliders are views onto
the same two values, not a local copy.

There are **16 slots** to store maps in and **8 preset shapes** to start from.
Slot *contents* live in per-origin browser storage, so the slot index is
deliberately not captured by Display States; the preset shapes are, because
those live in code and an index means the same thing on every machine.

## Making the stroke draw itself
<!-- guide
point: displace.warpDrawX, displace.warpDrawY
-->

**WarpDrawX** and **WarpDrawY** are the drawing head as parameters. Right-click
each → LFO, at frequencies that do not divide evenly into one another, and the
instrument draws its own displacement map while you play something else.

Random with a long slew is the other good choice — it wanders instead of
tracing.

## Live GLSL
<!-- guide
tab: effects
point: glsl.preset
show: #tab-glsl
-->

CodeMirror in the app, compiling as you type.

Break it on purpose — delete a semicolon. The render loop does not drop; it
holds the last good compile. That safety net is what makes it usable
mid-performance rather than only at the desk.

Natural-language shader generation needs an API key, set in **Project ▸ AI**. It
is stored in browser storage on this origin and never written into a saved
project file.

On the **Preset:** row, right-click the *label* for the badge menu, click the
badge to edit it, and the min/max fields set the recall range — so a controller
can sweep through presets as a performance move.

## Movie Library
<!-- guide
tab: sources
point: movie.active, movieB.active
show: #movie-library, #movie-a-section
keys: m
-->

An unlimited catalogue with two racks. Drag a row onto either deck — **Movie A**
or **Movie B** — and press **`m`** to run them.

Both decks are ordinary sources, so a mix bus with srcA/srcB pointing at them is
your A/B — and so is anything else you might want to crossfade against them.

## Save what you liked
<!-- guide
tab: presets
keys: Shift+S, 0-9
-->

**`Shift`+`S`** drops the current look into the next empty Display State slot.
**`0`–`9`** recall them. Do this the moment something works: rebuilding a patch
from memory takes far longer than you expect.

Full save/load, banks, and the state step sequencer are on the **Project** tab,
along with the Quick Reference and the Full Manual, which open inside the app.

## Where to go next
<!-- guide
keys: q, a, z
-->

Thirty-three routable sources, any of which can drive any other.

The patches worth finding are the ones where an engine's *output* becomes
another engine's *displacement*, *key*, or *time map* — not the ones where you
look at an engine directly. `q` / `a` / `z` and a couple of minutes is the whole
method.

`KNOWN-ISSUES.md` is honest about the loose ends.
