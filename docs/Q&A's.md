Another wonder. For Installation purposes with ImWeb, would a Raspberry Pi computer be efficient enough to run ImWeb in an installation for months?

## Gemini said

This is a fantastic question. Running a web-based visual instrument in a permanent or semi-permanent museum/gallery installation is a whole different beast than running it on your laptop for a two-hour performance.

The short answer is: **Yes, a Raspberry Pi can run ImWeb, but you must use the latest hardware and configure it specifically for "Kiosk" survival.** Because ImWeb relies heavily on WebGL, Three.js, and real-time video texture updating, it is very demanding on the GPU. Here is the exact breakdown of how to make an ImWeb installation survive for months on a Pi.

## 1. The Hardware: You Need a Raspberry Pi 5

Do not attempt this on a Raspberry Pi 3 or 4. The **Raspberry Pi 5 (8GB)** is the only model with a GPU (the VideoCore VII) powerful enough to handle a continuous WebGL rendering pipeline and multiple video streams at a decent frame rate.

- **Active Cooling is Mandatory:** Running WebGL 24/7 will push the Pi's processor to its limits. If you use a passive case (just a heatsink), the Pi will thermally throttle after a few hours, and your frame rate will drop to a crawl. You **must** use the official Raspberry Pi Active Cooler or a case with a built-in fan (like the Argon ONE).
    
- **Storage:** Use a high-quality, high-endurance MicroSD card (like a SanDisk High Endurance), or better yet, boot the Pi off an external NVMe SSD using an M.2 HAT. SD cards die quickly when read/written to constantly for months.
    

## 2. The Browser Setup: Chromium Kiosk Mode

You will run ImWeb in Chromium (the open-source backbone of Chrome) in a locked-down, full-screen mode.

To get the most out of the Pi's GPU, you have to launch Chromium from the command line with specific flags to force hardware acceleration. A typical launch script for your installation would look like this:

Bash

```
chromium-browser --kiosk --incognito --ignore-gpu-blocklist --enable-gpu-rasterization --enable-zero-copy https://imweb.image-ine.org
```

- `--kiosk`: Locks it in full-screen with no menus.
    
- `--incognito`: Prevents cache buildup and stops the "Restore Pages?" popup if the power cuts out.
    
- `--ignore-gpu-blocklist`: Forces the browser to use the Pi's GPU for WebGL, even if Google hasn't officially whitelisted it.
    

## 3. The "Museum Secret": The Daily Auto-Reboot

Browsers (Chrome, Safari, Firefox) are not designed to run a single web page for three months straight. Even with perfectly written code, WebGL contexts and video decoders will slowly leak memory over days and weeks until the browser eventually crashes.

**The industry standard for web-based installations is a daily automated reboot.** You set up a `cron` job on the Raspberry Pi to restart the computer at a time when the gallery is empty (e.g., 4:00 AM).

1. Open the crontab: `crontab -e`
    
2. Add this line: `0 4 * * * /sbin/shutdown -r now`
    
3. Set the Pi to auto-login and auto-launch the Chromium script on boot.
    

The Pi will wake up fresh every single morning, load ImWeb, and never crash during gallery hours.

## 4. ImWeb Content Optimizations for the Pi

To keep the Pi running at a smooth 30 to 60 FPS, you should pre-optimize the content specific to that installation:

- **Resolution:** Run the Pi output at **720p (1280x720)** or maybe 1080p, but absolutely _do not_ try to output 4K. The visual difference on a gallery projector is often negligible, but the performance difference for the Pi's GPU is massive.
    
- **Clip Formatting:** As discussed previously, ensure every single video clip loaded into the installation is encoded via FFmpeg with a **GOP of 1 (All-Intra)** and no audio track. This takes the decompression load off the Pi's CPU.
    

## The Alternative: Mini PCs

If you build the installation and find that the Raspberry Pi 5 is still dropping frames when you add heavy 3D geometry or multiple displacement shaders, the next step up is an **Intel N100 Mini PC** (like a Beelink or Minisforum). They cost roughly the same as a fully outfitted Raspberry Pi 5 (about $150–$200), run Windows or Linux, and have significantly better Intel UHD graphics for WebGL handling.

For an ImWeb installation, a Pi 5 will definitely work if optimized, but an Intel N100 Mini PC gives you much more breathing room for those heavy generative shaders!