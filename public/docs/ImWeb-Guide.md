# ImWeb — Guided Tour

The content of the in-app guided tour (**Shift+G**, the Guided Tour button on
the splash, or Project ▸ AI ▸ Documentation ▸ Guided Tour). This file *is* the
tour — the panel parses it at runtime, so editing the prose here changes what the
app says. It is also meant to read straight through as a document.

**The tour points; it never sets.** Each step names parameters, and the panel
gives you a button per name that switches to the right tab, opens the right
section, and flashes the row. Your hand moves the control. Nothing in this file
can change a value, which is why it is safe to open mid-performance.

Three tracks, chosen with the chips at the top of the panel:

- **Basics** — the panel, the parameter row, controllers, states, keys. What you
  need before anything else makes sense.
- **Principles** — six small patches, each demonstrating one idea the whole
  instrument is built on. Three or four moves each.
- **Instruments** — the machines: Rutt-Etra, SDF, Motion Extraction, RGB
  Channel Delay, Spacetime, mix buses, warp drawing, live GLSL.

Step grammar, for anyone editing: one `## ` heading per step, optionally
followed by a `<!-- guide … -->` block naming `track:`, `tab:`, `point:`
(parameter ids), `show:` (CSS selectors), and `keys:` (keycaps to display).
Everything above the first `## ` — including this preamble — is not part of the
tour.

---

## What this instrument is
<!-- guide
track: basics
tab: mix
show: #layer-params
-->

ImWeb composites video sources through a chain of effects and renders to a
WebGL canvas. Everything you can hear yourself thinking about — a camera, a
movie, a noise field, a raymarched solid, the picture from two seconds ago — is
a **source**, and there are 33 of them.

The whole instrument is three ideas:

1. **Sources are routed**, not wired. Any source can feed any input.
2. **Every value is a parameter**, and every parameter can be driven by
   something else — an LFO, a knob, a key, the sound in the room.
3. **The output is a source too**, so the picture can feed itself.

The Basics track covers how to work the controls. The Principles track is six
small patches that each demonstrate one of those three. Take them in order the
first time.

## Finding anything: the two keys
<!-- guide
track: basics
keys: ?, /
-->

**`?`** opens the keyboard shortcut overlay — every key the instrument has.

**`/`** opens parameter search. Type any part of a name, `↑`/`↓` to move,
`Enter` to jump. The results are **live parameter rows**: you can drag and edit
them right there without leaving the search. The **⌖** button on a result
scrolls the real panel to it and flashes it.

Learn `/` first. There are around a thousand parameters; nobody navigates that
by memory, and the panel is organised for performing, not for finding.

The five tabs run left to right in signal order — **Sources · Mix · Effects ·
Output · Project**. Click any section header to collapse or expand it; the
**⊟/⊞** button does all of them at once. If a panel looks empty, you are looking
at a collapsed header.

## The parameter row
<!-- guide
track: basics
tab: mix
point: blend.amount
-->

Every row is the same shape, and learning it once is learning the whole panel:

```
[ label ]  [ badge ]  [ min ]  [ max ]  [ value ]
                                        [── slider ──]
```

Two of these gestures are not what you would guess:

- **Drag the row left/right** to change the value. Horizontal, not vertical —
  about 200 px covers the full range. Vertical scrolls the panel instead.
- **Double-click resets to default.** To *type* a number, **Ctrl+click
  (⌘+click) the value**, then `Enter`. `Esc` cancels.
- **Alt+wheel** over a row is a fine adjust — 1% of range per notch, 5% with
  `Shift` held.
- The **thin slider** underneath is the same value, absolute instead of
  relative. On a tablet, a fast flick coasts to a stop.

Toggles and triggers take a plain **click** anywhere on the row. Selects with
eight options or fewer are a button strip; longer lists are a dropdown.

## Min and max are not limits
<!-- guide
track: basics
point: displace.amount
-->

The two small numbers between the badge and the value are the **controller
range** — the span something driving this parameter will sweep. They are not
the parameter's hard limits, and changing them does not change the current
value.

- **Drag a min/max field up/down** to adjust it — vertical here, 0.1 per pixel,
  `Shift` for one parameter step per pixel.
- **Double-click** to type. `Enter` commits, `Esc` cancels.
- A field that has been moved off its default shows highlighted.

This is where most of the musicianship lives. An LFO on a parameter whose range
is the full 0–100 is a special effect; the same LFO on 40–46 is a texture. Set
the range first, then assign the controller.

## Giving a parameter a controller
<!-- guide
track: basics
point: displace.amount, displace.angle
-->

**Right-click any row** (long-press on a tablet) to open the assignment menu.
The list is long; the ones to know first:

- **Random** — a new value at a chosen rate, with slew to smooth the jumps.
- **LFO Sine / Triangle / Saw ↑ / Saw ↓ / Square / S&H** — a shape at a chosen
  frequency.
- **MIDI Learn** — then move a knob on your controller and it binds itself.
  (**MIDI CC…** if you would rather type the number.)
- **Sound Level / Bass / Mid / High** — the room drives the parameter.
- **Key…** — a keyboard key drives it. Held for continuous parameters,
  toggled for switches.
- **Fixed Value** — a constant, which sounds pointless until you want the value
  captured and recalled without anything able to nudge it.
- **None** removes the controller and leaves the value where it was.

One parameter, one controller. The **badge** in the row then shows which — RND,
LFO, MIDI, KEY — and the row highlights as driven.

Under **Options** on the same menu: **Toggle Lock** freezes a parameter against
everything, **Toggle Invert** flips the controller's direction, and **Assign
Table…** is the next step.

## Editing the controller
<!-- guide
track: basics
point: displace.amount
-->

**Right-click the badge** (or Ctrl+click, or long-press) to open its settings —
a small dark panel next to the badge, closed with `Esc` or a click outside.

What is in it depends on the controller: **Rate** and **Slew** for Random;
**Shape**, **Freq**, **Phase** and **Slew** for an LFO; **Value** for Fixed. All
of those fields use the same drag / double-click-to-type grammar as the row
itself, so there is nothing new to learn.

**Slew** is worth dwelling on: it is the seconds a controller takes to reach its
new value. At 0 a Random is a stutter; at 2 seconds it is a drift. Same
controller, entirely different instrument.

## Response curves
<!-- guide
track: basics
tab: presets
show: #tables-list, #table-editor
-->

A controller produces a number from 0 to 1. A **response curve** reshapes that
number before it reaches the parameter — so an LFO can spend most of its time
near the bottom and snap through the top, or ease at both ends.

Curves are drawn in **Project ▸ Response Curves** and assigned per parameter
from the row's right-click menu (**Assign Table…**) or the badge popover's
**Table** field. One curve can be shared by many parameters, and there is a
`global` slot for the one you want everywhere.

Range decides *where* a controller moves; the curve decides *how* it gets
there.

## Saving what you find
<!-- guide
track: basics
tab: presets
show: #states-section, #morph-ctrl
keys: Shift+S, 0-9
-->

A **Display State** is a snapshot of the whole instrument.

- **`Shift`+`S`** saves the current look to the next empty slot.
- **`0`–`9`** recall states 0 to 9. The state bar along the bottom has the rest.
- **Morph** (bottom right) sets how long a recall takes. At 0 it cuts; at two
  seconds every parameter slides, and recalling states becomes a performance
  move rather than a reset.

Do this the moment something works. Rebuilding a patch from memory takes far
longer than you expect, and the state bar is the fastest instrument in the
program.

Banks, project save/load and the state step sequencer are all on the **Project**
tab. Projects are `.imweb` files; individual states are `.imstate`.

## The performance keys
<!-- guide
track: basics
point: global.keylock, global.tap, global.bpm
keys: q, a, z, v, m, k, c, h, f, t, g
-->

Single keys, no modifier — the reason the instrument is playable without looking
at the panel. `?` shows all of them; these are the ones you will use in the
first hour:

- **`q` / `a` / `z`** — cycle the Foreground / Background / DisplaceSrc source.
  This is how you audition 33 sources in a minute.
- **`v` / `m`** — camera on/off, movie on/off.
- **`k` / `x`** — keyer, external key.
- **`c`** — capture the screen into the Stills Buffer.
- **`h`** — hold / fade to black. The panic button.
- **`f`** — fullscreen output. `Esc` exits.
- **`t`** — tap tempo, for anything synced to BPM.
- **`g`** — cycle what a canvas drag does: Camera → Pad → Locked.
- **`i` / `u` / `d`** — parameter OSD, state bar, debug overlay.

**Keylock** (in the status bar) disables the single-key shortcuts. Turn it on
before typing into anything, and before handing the laptop to someone else.

## Principle 1 — a picture is two layers
<!-- guide
track: principles
tab: mix
point: layer.fg, layer.bg, layer.fg.blend, layer.fg.blendAmount
keys: v, q, a
-->

**Three moves.** Press `v` for the camera. Press `a` until **Background** reads
`Camera`. Press `q` until **Foreground** reads `Noise`.

You are looking at the composite: a Foreground over a Background. **FG Blend**
chooses how they meet — add, multiply, difference, screen — and **FG Blend Amt**
how much.

Drag FG Blend Amt from 0 to 1 slowly and watch one picture become the other.
That crossfade is the bottom of the instrument; everything else in this track
is a variation on what you can put in those two slots.

## Principle 2 — any source can drive any other
<!-- guide
track: principles
tab: mix
point: layer.ds, displace.amount, displace.angle
keys: z
-->

**Three moves.** Press `z` until **DisplaceSrc** reads `Noise`. Then find
**Displacement ▸ Displace** and drag it up from 0.

The noise is no longer something you look at — it is now a *map* that pushes the
picture around, brightness becoming distance. **DisplAngle** turns the direction
it pushes.

This is the idea the whole instrument rests on: a source's output can be another
source's control. Try `z` through a few others — `Camera` displacing itself is a
different machine again, and `SDF Depth` pushes the picture with a solid you
cannot see.

Nothing here was rewired. Displacement takes a source, and a source is a source.

## Principle 3 — any parameter can be driven
<!-- guide
track: principles
point: displace.amount
-->

**Three moves.** On the **Displace** row: set **min** to 0 and **max** to about
0.3 by dragging the two small numbers. Right-click the row → **LFO Sine**.
Right-click the badge and set **Freq** to 0.1 Hz.

The displacement now breathes on its own, between the bounds you set, and your
hands are free for something else.

Now change one thing at a time and watch what it does to the character:

- Raise **max** — the same LFO becomes a special effect instead of a texture.
- Swap the shape to **S&H** — it stutters instead of sliding.
- Add **Slew** — the stutter becomes a stagger.

A parameter with a controller is not automation. It is a second pair of hands
that never gets tired and never gets bored, and the range fields are how you
tell it how much rope it gets.

## Principle 4 — the output is a source
<!-- guide
track: principles
tab: effects
point: blend.active, feedback.active, feedback.decay, feedback.zoom, feedback.rotate
keys: b
-->

**Three moves.** Press `b` for Blend. Switch **Feedback** on. Drag **Zoom**
slightly off 1.0.

The picture now contains the previous frame, zoomed — which contains the frame
before that, and so on into a tunnel. **Rotate** turns the tunnel into a spiral.
**Decay** decides how long the trail survives.

This is not an effect with a memory. It is the output routed back in as a
source: `Output` is number 8 in the same list `q` and `a` cycle through.

Keep one hand on **Decay**. Feedback is the one part of the instrument that can
run away from you, and pulling decay down is how you catch it.

## Principle 5 — time is an axis you can point at
<!-- guide
track: principles
point: delay.source, rgbdelay.r, rgbdelay.g, rgbdelay.b
keys: a
-->

**Three moves.** Press `a` until Background reads `RGB Delay`. Set **Video
Delay ▸ Source** to `Camera`. Then pull the three channel delays apart — try
1 / 12 / 24.

Red, green and blue are now reading three different moments. Move in front of
the camera and your gesture separates into three coloured ghosts of itself.

Every temporal engine — Time Displace, Slit Scan, Video Delay, Warp Tape —
shares one frame history and each picks its own way in. Time is not a global
setting here; it is a direction you can point an engine at, the same way
Principle 2 pointed displacement at a source.

## Principle 6 — build a patch out of the five
<!-- guide
track: principles
tab: mix
point: mix.srcA, mix.srcB, mix.xfade, layer.bg
keys: a, Shift+S
-->

Nothing new. Just the five together, which is what a piece is:

1. **Mix 1 ▸ srcA** = `Camera`, **srcB** = `RGB Delay` — two sources into a bus
   *(Principle 1)*.
2. Press `a` until Background reads `Mix 1`, and `z` until DisplaceSrc reads
   `Noise` *(Principle 2)*.
3. Right-click **Crossfade** → **LFO Triangle**, slow *(Principle 3)*.
4. Switch **Feedback** on with a little Zoom *(Principle 4)*.
5. Pull the RGB delays apart *(Principle 5)*.
6. **`Shift`+`S`** to keep it. Change four things and save it again.

Two saved states and a slow **Morph** between them is a piece. That is the whole
method — the rest of this tour is which machines you can put in the slots.

## Rutt-Etra Scan Processor
<!-- guide
track: instruments
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

## SDF field renderer
<!-- guide
track: instruments
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
track: instruments
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
track: instruments
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
track: instruments
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
track: instruments
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
track: instruments
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
track: instruments
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
track: instruments
point: displace.warpDrawX, displace.warpDrawY
-->

**WarpDrawX** and **WarpDrawY** are the drawing head as parameters. Right-click
each → LFO, at frequencies that do not divide evenly into one another, and the
instrument draws its own displacement map while you play something else.

Random with a long slew is the other good choice — it wanders instead of
tracing.

## Live GLSL
<!-- guide
track: instruments
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
track: instruments
tab: sources
point: movie.active, movieB.active
show: #movie-library, #movie-a-section
keys: m
-->

An unlimited catalogue with two racks. Drag a row onto either deck — **Movie A**
or **Movie B** — and press **`m`** to run them.

Both decks are ordinary sources, so a mix bus with srcA/srcB pointing at them is
your A/B — and so is anything else you might want to crossfade against them.

## Where to go next
<!-- guide
track: instruments
keys: q, a, z
-->

Thirty-three routable sources, any of which can drive any other.

The patches worth finding are the ones where an engine's *output* becomes
another engine's *displacement*, *key*, or *time map* — not the ones where you
look at an engine directly. `q` / `a` / `z` and a couple of minutes is the whole
method.

`KNOWN-ISSUES.md` is honest about the loose ends.
