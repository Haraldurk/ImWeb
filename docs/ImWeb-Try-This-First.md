# ImWeb — Try This First

Ten minutes, ten things. Do them in order; each one leaves the instrument in a
state the next one uses. Nothing here needs the Quick-Start or the manual.

Part A teaches the two gestures and the one key that make everything else
findable. Part B is the tour.

---

# Part A — driving the panel

## Two keys worth learning before anything else

| Key | What it does |
|---|---|
| **`?`** | Keyboard shortcut overlay. Everything below is on it. `Esc` closes. |
| **`/`** | Parameter search. Type any part of a name, `↑`/`↓` to move, `Enter` to jump. `Esc` closes. |

**`/` is the real navigation tool.** Every instruction below of the form
"Sources ▸ From the Signal ▸ Rutt-Etra ▸ Depth" can also be done as: press `/`,
type `depth`, and edit the row right there in the results — the search results
are live parameter rows, not links. Click the **⌖** button on a result to scroll
the actual panel to it and flash it, which is the fastest way to learn where
something lives.

## The panel

Five tabs, left to right in signal order:
**Sources · Mix · Effects · Output · Project**.

- **Click a section header** to collapse/expand it. Subsection headers too.
- The **⊟ / ⊞ button** collapses or expands everything at once.
- Sections start collapsed except the one the app lands on, so if a panel looks
  empty you are probably looking at a collapsed header.

## The parameter row

Every row is the same shape, left to right:

```
[ label ]  [ badge ]  [ min ]  [ max ]  [ value ]
                                        [── slider ──]
```

**Setting the value** — and note these, because two of them are not what you'd
guess:

| Gesture | Result |
|---|---|
| **Drag the row left/right** | Change the value. ~200 px of travel = the full range. Horizontal, not vertical — vertical scrolls the panel. |
| **Drag the thin slider** | Same thing, absolute rather than relative. |
| **Ctrl+click (⌘+click) the value** | Type a number. `Enter` commits, `Esc` cancels. |
| **Double-click the row** | **Reset to default.** (Not type-in — that's Ctrl+click.) |
| **Alt+wheel over the row** | Fine adjust, 1% of range per notch. Hold `Shift` for 5%. |

**Setting the range** — the `min`/`max` fields are the *controller* range, i.e.
the span a random/LFO/MIDI controller will sweep, not the parameter's hard limits:

| Gesture | Result |
|---|---|
| **Drag a min/max field up/down** | Adjust it. 0.1 per pixel; hold `Shift` for one parameter step per pixel. |
| **Double-click a min/max field** | Type a number. `Enter` / `Esc`. |

A field shown highlighted has been overridden from the default range.

**Other row types:** toggles and triggers just take a plain **click** on the row.
Selects with 8 or fewer options are a button strip; longer lists are a dropdown.

**Assigning a controller:**

| Gesture | Result |
|---|---|
| **Right-click the row** | Context menu — assign Random / LFO / Fixed / MIDI / Key / Audio. |
| **Right-click or Ctrl+click the badge** | Settings for the controller already there — Rate, Slew, Shape, Freq, Phase, response Table. |

Fields inside the badge popover use the same drag / double-click grammar as the
row, so there is nothing new to learn there.

**On a tablet:** long-press = right-click, double-tap = the type-in editor,
double-tap the row = reset, and a fast flick on a value coasts to a stop.

## Performance keys

These are single keys, no modifier, and they are the reason the instrument is
playable without looking at the panel. Full list on `?`.

| Key | |
|---|---|
| **`q` / `a` / `z`** | Cycle the **Foreground / Background / DisplaceSrc** source. This is how you audition the 33 sources fast. |
| **`0`–`9`** | Recall Display State 0–9. |
| **`Shift`+`S`** | Save the current look to the next empty State slot. |
| **`v` / `m`** | Camera on/off · Movie on/off |
| **`k` / `x`** | Keyer on/off · ExtKey on/off |
| **`b` / `s`** | Blend on/off · Solo |
| **`c`** | Capture the screen into the Stills Buffer |
| **`h`** | Hold / fade to black |
| **`t`** | Tap tempo |
| **`f`** | Fullscreen output. `Esc` exits. |
| **`i` / `u` / `d`** | Parameter OSD · state bar · debug overlay |
| **`g`** | Cycle canvas interaction mode: Camera → Pad → Locked |
| **`⌘/Ctrl`+`S`** | Quick-save to the active preset |

There is one thing to know about `g`: while the canvas is in **Camera** mode a
drag on the output orbits the 3D camera rather than drawing. Step 7 below needs
drawing, so that is where the mode matters.

---

# Part B — the tour

## 0. Get a picture

1. Press **`v`**. Allow the browser's camera prompt.
2. Press **`a`** repeatedly until **Background** reads `Camera` — the OSD names
   each source as you pass it. (Long way round: **Mix ▸ Layers ▸ Background**.)

You should now see yourself. Everything below routes something else into
**Foreground** or **Background**, and `q`/`a` always get you back to `Camera`.

---

## 1. Rutt-Etra Scan Processor

Scanlines deflected by luminance, seen through an orbiting camera.

1. Press **`a`** until Background reads `Rutt-Etra`.
2. **Sources** tab ▸ scroll to **From the Signal** ▸ click **Rutt-Etra**. Four
   subsections: **Scan · Depth · Camera · Phosphor**.
3. Drag the **Depth** row right until the picture leaves the plane.
4. Drag the **Camera** rows to orbit. Add the same to a controller if you want
   it to orbit itself: right-click the row → LFO, then Ctrl+click the LFO badge
   and set Freq around 0.05 Hz.
5. **Scan** is how many lines you are actually looking at. Low counts are the
   1972 look; high counts turn into a surface.

The machine lies about depth. That's the point — drive the lie.

---

## 2. SDF field renderer

1. Press **`a`** until Background reads `SDF`.
2. **Sources ▸ From the Signal ▸ SDF**. Thirteen shapes under **Shape**, then
   **Space · Camera · Material · Light · Glow · Glass · Video · Quality**.
3. **Glow** is two-stop — set the inner tight and the outer wide and it stops
   looking like a bloom filter.
4. **Video** feeds a source into the surface, so the raymarcher can wear the
   camera.
5. `SDF Depth` is the same render's depth as a source of its own. Press **`z`**
   until DisplaceSrc reads `SDF Depth` and the picture gets pushed around by the
   solid you can no longer see.

---

## 3. Motion Extraction → the keyer

A matte of what moves. Built for the keyer, not for looking at.

1. **Sources ▸ From the Signal ▸ Warp ▸ Motion Extraction**. Set **Motion src**
   to `Camera`.
2. Press **`k`** to switch the keyer on. Then **Mix ▸ Keyer ▸ Key src** →
   `Motion`.
3. **Set KeyLevelWhite to 100%.** Ctrl+click the value, type `100`, `Enter`. At
   the default 80% the keyer rejects the *brightest* part of the matte, which
   reads as the strongest motion being the only thing that fails to show. Cut
   with **KeyLevelBlack** alone.
4. Press **`q`** and **`a`** to put two different sources in Foreground and
   Background. Only the moving part of the Foreground now shows over the
   Background.
5. Back in Motion Extraction, four rows worth dragging in order:
   **Sensitivity** (how much movement counts) · **Bg adapt** (long = someone who
   stops moving stays in the matte, 0 = plain frame differencing, they vanish) ·
   **Trail** (how long movement leaves a wake) · **Smoothness** (kills sensor
   grain and fills silhouettes solid instead of hollow).

---

## 4. RGB Channel Delay

Red, green and blue each read a different frame of history.

1. Press **`a`** until Background reads `RGB Delay`.
2. Press **`/`**, type `delay`, and the three channel rows are right there —
   1 to 480 frames each.
3. Equal values on all three are a bit-exact passthrough, so neutral is one drag
   away. 1/5/9 smears; wide spreads separate into three distinct ghosts of the
   same gesture.
4. It reads the Video Delay ring, so **Video Delay**'s own source selector
   decides what history is being delayed — see step 5.

---

## 5. Spacetime — every temporal engine gets a source

Previously each of these was hardwired to the composite. Now they share one frame
history and each picks its own way in. All four live under
**Sources ▸ From the Signal ▸ Warp**:

| Subsection | What to try |
|---|---|
| **Time Displace** | free source selector, **plus an arbitrary angle and a map source** — the map can be any of the 33 sources |
| **Tape** (Warp Tape) | its own source; defaults to the camera, because Steina performed to a camera |
| **Slit Scan** | its own source |
| **Video Delay** | its own source, and it is the ring RGB Channel Delay reads |

One deliberate experiment: set Time Displace's **map source** to `Motion`. Time
then bends only where the picture moved.

---

## 6. Three mix buses

1. **Mix** tab ▸ **Mix 1**. **srcA** and **srcB** are free source selectors, not
   a hardwired deck crossfader — pick any two of the 33 from the dropdowns.
2. Drag the blend mode and amount rows.
3. Press **`a`** until Background reads `Mix 1`.
4. Now do the same on **Mix 2**, and set its **srcA** to `Mix 1`. A bus is a real
   graph node; buses can read each other. Reading a *later* bus, or itself, gives
   you last frame rather than this one — which is a feedback path, deliberately.

---

## 7. Warp drawing — draw straight onto the output

1. Press **`g`** until the mode OSD reads **Pad** or **Locked**. In Camera mode
   a canvas drag orbits the 3D camera instead of drawing.
2. **Mix ▸ Displacement Map Editor**. The mini editor is there, and under it
   **Performative Draw** with **Radius** and **Strength**.
3. Drag directly on the **main output canvas**. The picture smears where you
   drag, in the direction you drag.
4. Radius and Strength are shared by all three drawing surfaces — mini editor,
   main canvas, and the WarpDrawX/Y parameters — so setting them once sets them
   everywhere.
5. **16 slots** to store maps in, **8 preset shapes** to start from.
6. Right-click **WarpDrawX** and **WarpDrawY** → LFO, at different frequencies,
   and the stroke draws itself.

Slot *contents* live in browser storage per origin, and the slot index is
deliberately not captured by Display States — the preset shapes are, because
those live in code.

---

## 8. Live GLSL editor

1. **Effects** tab ▸ **Live GLSL**. CodeMirror, in the app, compiling as you
   type.
2. Break it on purpose — delete a semicolon. The render loop does not drop; it
   holds the last good compile. You can do this mid-performance.
3. Plain-language shader generation needs a key: **Project ▸ AI**. Stored
   locally, never in the saved file.
4. On the **Preset:** row — right-click the *label* for the badge menu, click the
   badge to edit, and the min/max fields set the recall range so a controller can
   sweep through presets.

---

## 9. Movie Library

1. **Sources ▸ Media ▸ Movie Library** — unlimited catalogue, two racks.
2. Drag a row onto either deck: **Movie A** or **Movie B**.
3. Press **`m`** to run them.
4. Both decks are ordinary sources, so a mix bus with srcA/srcB pointing at them
   is your A/B — and so is anything else you want to crossfade against them.

---

## Save what you liked

**`Shift`+`S`** drops the current look into the next empty Display State slot;
**`0`–`9`** recall them. Do this the moment something works — it is much faster
than trying to rebuild a patch from memory.

Full save/load, banks, and the state step sequencer are on the **Project** tab,
along with the Quick Reference and Full Manual, which open inside the app.

---

## Where to go next

**33 routable sources, any of which can drive any other.** The interesting
patches are the ones where an engine's *output* becomes another engine's
*displacement*, *key*, or *time map* — not the ones where you look at an engine
directly. `q`/`a`/`z` and a couple of minutes are the whole method.

`KNOWN-ISSUES.md` is honest about the loose ends.
