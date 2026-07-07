Here's how to play with Monty now, with everything that's been built:

**Three terminals, run in order:**

**Terminal 1 — ImWeb dev server:**

bash

```bash
cd ~/Documents/GitHub/ImWeb
npm run dev
```

Open browser at `http://localhost:5173`

**Terminal 2 — Monty bridge (pick a mode):**

bash

```bash
conda activate tbp.monty

# Mock mode (no Monty, safe to test UI):
python monty-bridge.py

# Live mode, YCB pretrained (brain hallucinates household objects):
python monty-bridge.py --live

# Live mode, self-supervised (brain learns your footage):
python monty-bridge.py --live --model self

# Live + adaptive governor:
python monty-bridge.py --live --governor adaptive
```

**Then in ImWeb:**

1. Go to the **Buffer tab** → find the MONTY row → click Connect
2. Dot turns green, badge shows MOCK or LIVE
3. FrameSelect 1 (`buffer.fs1`) starts moving with saccade
4. Buffer scatter responds to confidence
5. Captures fire on prediction error spikes

**To route Monty to other parameters:**  
Right-click any parameter badge → you'll see MX / MY / MC / MP in the menu. Assign `monty-pe` to something like `displace.amount` and watch the displacement respond to Monty's surprise.

**Most interesting starting experiment:**

bash

```bash
python monty-bridge.py --live --model self --governor adaptive
```

Point ImWeb at a camera or video feed. The brain starts blank, learns your content over the session, confidence climbs on familiar patterns, PE spikes on cuts and changes. The buffer becomes a scrapbook of what surprised it.