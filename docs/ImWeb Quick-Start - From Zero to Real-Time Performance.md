# ImWeb Quick-Start: From Zero to Real-Time Performance

Welcome to **ImWeb**, a browser-based live video synthesis and 3D compositing environment. Think of this interface as a digital video instrument: every slider can be performed live, automated, or mapped to your surroundings. 

Here is how to get your first reactive patch running in under two minutes:

### 🛠️ Step 1: Learn the Safety Net & Immediate Presets
Before you tweak anything, locate your two biggest anchor points:
*   **The Thumbnail Presets (Bottom Bar):** Look at the row of thumbnails at the very bottom. Click any of these squares to instantly load a pre-configured live visual ecosystem and see what the software can do.
*   **The Panic Button (Top Left):** If the screen goes entirely crazy or breaks into extreme feedback, find the refresh/reset icon on the top menu bar (left side, next to the bank settings). Clicking this immediately strips all heavy processing away, leaving just your raw, clean camera input on screen.

### 🎭 Step 2: Play with the 3 Layers
ImWeb relies on three core video paths, visible in the **Mapping** menu at the top right. You can alternate or cycle through them using fast hotkeys on your keyboard:
*   Press **Q** to adjust the **Foreground** layer.
*   Press **A** to adjust the **Background** layer.
*   Press **Z** to change the **DisplaceSrc** (Displacement Source) layer.

### 📂 Step 3: Drop in Your Own Materials
ImWeb is a completely open canvas for your personal media assets:
*   **Drag-and-Drop:** Drag images, `.mp4` videos, and 3D objects directly from your desktop and drop them anywhere right onto the video canvas.
*   **Managing Video:** Turn on the movie function manually, and locate your imported video files in the **Clips** menu to assign them to your layers.

### 🌀 Step 4: Trigger a Real-Time Warp (Displacement)
Let's manually test one of the most powerful features in the app:
1. In the right-hand panel under **Mapping**, find the **DISPLACEMENT** section and click it to expand the menu. *(Tip: Click the small box icon on the right of any section to detach it into its own floating window!)*
2. By default, **Displace** is set to `0.0`. Grab that slider and slide it up towards `100`. You will see your pixels start to twist and shift based on the source layer.

### 🎛️ Step 5: The Fundamental Trick (Automate with Right-Click)
Instead of moving sliders manually, you can make the system modulate itself:
1. **Right-click** (or *Control-click*) directly on the **DisplOffset** slider or value.
2. A long popup list of input controllers will appear. You can select **Mouse**, **Audio**, an external **MIDI assignment** (if a controller is plugged in, you can use MIDI learn), or internal **Generators**.
3. Select **LFO Sine** from the list. A default value of `0.5` will pop up—leave it there for now.
4. Look closely above the slider: you will see a small green indicator text that says **LFO-**.
5. **Right-click** (or *Control-click*) directly on that green text. A secondary popup window will open where you can fine-tune the LFO's speed and depth to make your distortion pulse smoothly on its own.