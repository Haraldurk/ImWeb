# ImWeb Quick-Start: From Zero to Real-Time Performance

> Browser-based live video synthesis ecosystem · v0.17.0

Welcome to **ImWeb**. Think of this interface as a digital video instrument:
every slider can be performed live, automated, or mapped to your surroundings.

Here is how to get your first reactive patch running in under two minutes.

---

## 🛠️ Step 1: Learn the Safety Net & Immediate Presets

Before you tweak anything, locate your two biggest anchor points.

**The Thumbnail States (bottom bar).** The row of thumbnails across the very
bottom is the **State grid** — 32 tiles in two rows of 16. On first launch it is
seeded from the factory project, so several tiles already hold complete,
pre-configured visual ecosystems. Click a tile that **has a thumbnail** to
recall it instantly and see what the software can do.

> Clicking an **empty** (dark) tile does not recall — it *saves* your current
> state into that slot. That is the intended way to keep a look you like, but it
> is worth knowing before you start clicking around.

The leftmost **○** tile is the **Neutral State**: it resets every parameter value
without touching your controller assignments.

**The Panic Button (toolbar, top right).** If the screen goes entirely crazy or
breaks into extreme feedback, press the **↺** button in the toolbar at the right
end of the top status bar — or just hit **Shift+Esc**. It resets all parameters
to their defaults, which strips the heavy processing away and leaves your raw,
clean camera input on screen.

Two gentler versions of the same escape, when you want your settings kept:

| Escape | What it does |
|--------|--------------|
| **All FX** toggle (Effects tab) | Bypasses the entire post-FX chain. Every parameter keeps its value, so switching back on returns exactly the look you left |
| **S** | Solo — bypass effects and look at the raw composite |
| **H** | Fade to black (toggle) — the safest thing to press in front of an audience |

---

## 🎭 Step 2: Play with the 3 Layers

ImWeb composites three core video paths. They live in the right-hand control
panel, under the **Mix** tab ▸ **LAYERS**. You can cycle through the available
sources for each one using fast hotkeys, without touching the panel at all:

- Press **Q** to change the **Foreground** layer.
- Press **A** to change the **Background** layer.
- Press **Z** to change the **DisplaceSrc** (Displacement Source) layer.

Each press steps to the next source in exactly the order the LAYERS dropdowns
list them (Live In → Media → Generators → From the Signal → Mix), so the
keyboard and the menu always agree.

> **Panel orientation.** The control panel has five tabs, in signal order:
> **Sources · Mix · Effects · Output · Project**. Where a picture comes from,
> how pictures are combined, what is done to them, where they go — and Project
> for saving it all. The 3D, Analog and Draw editors are opened from their rows
> in **Sources**.

---

## 🌀 Step 3: Trigger a Real-Time Warp (Displacement)

Let's manually test one of the most powerful features in the app:

1. In the right-hand panel, go to the **Mix** tab and find the **Displacement**
   section. Click the header to expand it.
   *(Tip: click the small **⊞** icon at the right of any section header to detach
   it into its own floating, resizable window.)*
2. By default, **Displace** is set to `0.0`. Grab that slider and drag it up
   towards `100`. You will immediately see your pixels twist and shift, driven
   by whatever source the DisplaceSrc layer is set to.

Displacement reads the *brightness* of the DS layer as a push direction, so what
you route to DS with **Z** changes the character of the warp completely — try
Noise, then try Camera.

---

## 🎛️ Step 4: The Fundamental Trick (Automate with Right-Click)

Instead of moving sliders manually, you can make the system modulate itself:

1. **Right-click** (or **Ctrl-click**) directly on the **DisplOffset** row —
   the label, the value, anywhere in the row.
2. A long popup list of input controllers appears: **Mouse X / Mouse Y**,
   **Sound Level / Bass / Mid / High**, **MIDI CC…** and **MIDI Note…** (with
   MIDI learn if a controller is plugged in), **Tilt** and **Compass** on a
   tablet, gamepad axes, pen pressure, **Random**, **Expression…**, and the LFOs.
3. Select **LFO Sine**. A prompt asks for the LFO rate, pre-filled with `0.5` —
   press OK and leave it there for now.
4. Look at the row: between the label and the value there is now a small
   highlighted **badge** reading **`LFO~`**. That badge is the controller.
   (Every controller type gets its own badge — `RND`, `MX`, `SND`, `CC7`…)
5. **Right-click** (or **Ctrl-click**) directly on that badge. A secondary popover
   opens where you can fine-tune the LFO's shape, frequency, phase and slew, and
   set the min/max range it sweeps — so the distortion pulses smoothly on its own.

> **Beat-sync.** At the rate prompt you can type `1b` instead of a number to lock
> the LFO to one beat of the global BPM — `2b` for two beats, `0.5b` for half.
> Tap **T** to set the tempo by ear.

Any parameter in ImWeb accepts any controller. That is the whole instrument in
one sentence.

---

## 📂 Step 5: Drop in Your Own Materials

ImWeb is an open canvas for your own media. **Drag files from your desktop and
drop them anywhere on the video canvas:**

| You drop | What happens |
|----------|--------------|
| `.mp4`, `.webm`, `.mov`, `.avi`, `.mkv` | Loads into **Movie Deck A** and starts playing; FG switches to it. **⇧-drop** routes it to **Deck B** instead |
| `.png`, `.jpg`, `.gif`, `.webp`, `.bmp` | Loads as a still image source |
| `.glb`, `.gltf`, `.obj`, `.stl`, `.dae` | Loads into the 3D scene, which activates itself |
| `.imx` | An ImWeb effect-chain export |

Project files are *not* canvas drops — load `.imweb` with **Cmd+O**, and
`.imbank` / `.imstate` from the Project tab and the state-tile right-click menu.

Your imported videos are listed in the **Movie Library** (Sources tab ▸ Media) —
every movie you have, with thumbnails and a filter box. Drag a row onto a deck,
or use its `→A` / `→B` buttons, to assign it. `Shift+1–8` selects clips on Deck A,
`Option+1–8` on Deck B.

> Don't confuse the Movie Library with the **Clip Library** below it — that one
> holds short clips you *record* out of ImWeb's own live output.

---

## Notes for teaching with this

This structure works well in an education environment because of its order. It
hands students a safety net first (Step 1), gives them physical keyboard
interaction next (Step 2), and only then reveals the hidden depth of the
software's modulation engine (Steps 3 and 4) — without requiring them to write
a line of code.

The single idea worth landing before anything else: **a slider is not a setting,
it is a destination.** Once someone has right-clicked one parameter and watched
it move on its own, every other parameter in the instrument has been explained.

---

## Where to go next

- **[Quick Reference](ImWeb_Quick_Reference.md)** — every source, effect and
  shortcut on a few pages.
- **[Full Manual](ImWeb_Full_Manual.md)** — the complete parameter reference.
- Press **?** in the app for the keyboard shortcut overlay, and **/** to search
  for any parameter by name.
