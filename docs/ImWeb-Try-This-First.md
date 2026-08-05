# ImWeb — Try This First

Ten minutes, ten things. Do them in order; each one leaves the instrument in a
state the next one uses. Nothing here needs the Quick-Start or the manual.

The panel has five tabs, left to right in signal order:
**Sources · Mix · Effects · Output · Project**.

Every parameter row is the same shape: label, controller badge, min field, max
field, value. Drag a field up/down to change it, double-click to type a number,
right-click the badge to assign a controller (RND, LFO, MIDI…).

---

## 0. Get a picture

1. **Sources ▸ Live In ▸ Camera** — turn the camera on and allow the browser
   prompt.
2. **Mix ▸ Layers** — set **Background** to `Camera`.

You should now see yourself. Everything below routes something else into
**Foreground** or **Background** and you can always come back to `Camera`.

---

## 1. Rutt-Etra Scan Processor

Scanlines deflected by luminance, seen through an orbiting camera.

1. **Mix ▸ Layers ▸ Background** → `Rutt-Etra`.
2. **Sources ▸ From the Signal ▸ Rutt-Etra**. Four groups: **Scan · Depth ·
   Camera · Phosphor**.
3. Push **Depth** up until the picture leaves the plane, then orbit with the
   **Camera** group.
4. **Scan** sets how many lines you are actually looking at — low counts are the
   1972 look, high counts turn into a surface.

The machine lies about depth. That is the point; drive the lie.

---

## 2. SDF field renderer

1. **Mix ▸ Layers ▸ Background** → `SDF`.
2. **Sources ▸ From the Signal ▸ SDF** — thirteen shapes under **Shape**, then
   **Space · Camera · Material · Light · Glow · Glass · Video · Quality**.
3. **Glow** is two-stop — set the inner tight and the outer wide and it stops
   looking like a bloom filter.
4. **Video** feeds a source into the surface, so the raymarcher can wear the
   camera.
5. Source `SDF Depth` is the same render's depth, routable on its own — try it
   as a displacement source (step 7).

---

## 3. Motion Extraction → the keyer

A matte of what moves. Built for the keyer, not for looking at.

1. **Sources ▸ From the Signal ▸ Warp ▸ Motion Extraction** — set **Motion src**
   to `Camera`.
2. **Mix ▸ Keyer** — **Keyer ON**, **Key src** → `Motion`.
3. **Set KeyLevelWhite to 100%.** At the default 80% the keyer rejects the
   brightest part of the matte, which looks like the strongest motion being the
   only thing that fails to show. Cut with **KeyLevelBlack** alone.
4. **Mix ▸ Layers** — Foreground and Background to two different sources. Only
   the moving part of the Foreground now shows over the Background.
5. Back in Motion Extraction: **Sensitivity** for how much movement counts,
   **Bg adapt** for whether someone who stops moving stays in the matte (long =
   stays, 0 = plain frame differencing, they vanish), **Trail** for how long
   movement leaves a wake, **Smoothness** to kill sensor grain and fill
   silhouettes solid instead of hollow.

---

## 4. RGB Channel Delay

Red, green and blue each read a different frame of history.

1. **Mix ▸ Layers ▸ Background** → `RGB Delay`.
2. **Sources ▸ From the Signal ▸ Warp ▸ RGB Channel Delay** — three fields,
   1–480 frames.
3. Equal values on all three are a bit-exact passthrough, so neutral is one drag
   away. Small spreads (1/5/9) give a smear; large spreads separate into three
   distinct ghosts of the same gesture.
4. It reads the Video Delay ring, so **Video Delay**'s source selector decides
   what history it is delaying (step 5).

---

## 5. Spacetime — every temporal engine gets a source

Previously each of these was hardwired to the composite. Now they share one
frame history and each picks its own way in.

**Sources ▸ From the Signal ▸ Warp** holds all of them:

| Subsection | What to try |
|---|---|
| **Time Displace** | free source selector, **plus an arbitrary angle and a map source** — the map can be any of the 33 sources, so `Noise`, `SDF Depth` or `Motion` all drive time directly |
| **Tape** (Warp Tape) | its own source; defaults to the camera because Steina performed to a camera |
| **Slit Scan** | its own source |
| **Video Delay** | its own source, and it is the ring RGB Channel Delay reads |

Worth one deliberate experiment: set Time Displace's **map source** to `Motion`.
Time then bends only where the picture moved.

---

## 6. Three mix buses

1. **Mix ▸ Mix 1** — **srcA** and **srcB** are free source selectors, not a
   hardwired deck crossfader. Pick any two of the 33.
2. Set a blend mode and amount.
3. **Mix ▸ Layers ▸ Background** → `Mix 1`.
4. Repeat on **Mix 2** and **Mix 3**, and feed `Mix 1` into `Mix 2`'s srcA. A bus
   is a real graph node; buses can read each other. Reading a *later* bus (or
   itself) gives you last frame rather than this one — which is a feedback path,
   deliberately.

---

## 7. Warp drawing — draw straight onto the output

1. **Mix ▸ Displacement Map Editor**. There is a mini editor, and under it
   **Performative Draw** with **Radius** and **Strength**.
2. Drag directly on the **main output canvas**. The picture smears where you
   drag, in the direction you drag.
3. Radius and Strength are shared by all three drawing surfaces — mini editor,
   main canvas, and the WarpDrawX/Y parameters — so setting them once sets them
   everywhere.
4. **16 slots** to store maps in, **8 preset shapes** to start from.
5. Assign controllers to **WarpDrawX/Y** and the stroke draws itself.

Note: slot *contents* live in browser storage per origin, and slot index is
deliberately not captured by Display States — the preset shapes are, because
those live in code.

---

## 8. Live GLSL editor

1. **Effects ▸ Live GLSL**. CodeMirror, in the app, compiling as you type.
2. Break the shader on purpose — delete a semicolon. The render loop does not
   drop; it holds the last good compile. You can do this mid-performance.
3. Type a description in plain language and let it generate the shader (needs an
   API key — **Project ▸ AI**; the key is stored locally and never in the file).
4. **Preset:** row — right-click the label to assign a badge, click the badge to
   edit, and the min/max fields set the recall range so a controller can sweep
   presets.

---

## 9. Movie Library

1. **Sources ▸ Media ▸ Movie Library** — unlimited catalogue, two racks.
2. Drag a row onto either deck: **Movie A** or **Movie B**.
3. Both decks are ordinary sources (`Movie A`, `Movie B`), so a mix bus with
   srcA/srcB pointing at them is your A/B — and so is anything else you want to
   crossfade against them.

---

## Where to go after this

- **33 routable sources**, and any of them can drive any other. The interesting
  patches are the ones where an engine's *output* becomes another engine's
  *displacement*, *key*, or *time map* — not the ones where you look at an
  engine directly.
- **Project** tab holds save/load, banks, Display States, and the state step
  sequencer. Save early; a state recall is the fastest way to get back to a look
  you liked.
- `KNOWN-ISSUES.md` is honest about the loose ends.
