---
name: imweb-debugging
description: Debugging protocols for ImWeb — required reading before writing any fix. Use when investigating a bug, a save/load problem (.imweb/.imbank/.imstate files), a feature that stopped working, or before composing any fix prompt. Includes serialized-file inspection commands.
---

# ImWeb Debugging Protocols

These rules apply to all AI agents working on ImWeb. They come from hard-won
session experience and must be followed before writing any fix prompt.

## Read the lessons log first

`docs/LEARNED.md` is an append-only log of lessons from past corrections, each
carrying the bug that triggered it. **Read it before investigating anything.**
Several entries describe failures that present as app bugs and are not — a
backgrounded tab freezing rAF so every in-app reading is void, a service worker
serving a cached `index.html` while `curl` returns the new markup, a
`drawImage` readback going stale without `preserveDrawingBuffer`. A session was
lost to each of those.

**On conflict with CLAUDE.md, LEARNED.md wins.**

Entries are tagged with their enforcement status:

- `[audit]` / `[hook]` / `[skill]` — already mechanical; archival, no action
- `[advisory]` — carried in prose only, still live risk

`grep '\[advisory\]' docs/LEARNED.md` is the current risk register — read those
before forming a hypothesis. When a fix closes an advisory lesson for good,
promote it to `[audit]` using the `new-audit` skill. That promotion is the point
of the log; an advisory lesson only protects whoever remembers to read it.

Append a new entry whenever the owner corrects you, or you catch yourself in a
mistake worth not repeating. Refine a similar lesson in place rather than
duplicating it. Never delete one.

## Save / Load bugs

1. Ask for the serialized file FIRST (.imweb, .imbank, .imstate, .json).
   Read the data before reading any code. The file is the ground truth —
   if modelAsset is absent from the JSON, no amount of code reading will
   reveal why the model isn't loading.
2. Ask "how was the asset loaded?" before assuming anything about the
   loading method. Drag-drop and URL-load are different code paths with
   different persistence behaviour. One question saves three fix loops.

## Before writing any fix prompt

1. Verify every variable name in the actual source file before putting it
   in a prompt. Never guess a reference name (this.sm vs this.extras.scene3d
   vs sceneManager) — grep or read the file first. One wrong name costs
   an entire session loop.
2. State one way the fix could still fail before sending the prompt.
   Per the Guard Logic Rules in CLAUDE.md: if you cannot answer this, the fix
   is not fully understood.

## One task per prompt — hard rule

If a task feels like it needs two prompts, it does. Split it. A prompt
that touches two separate things produces one correct fix and one subtle
regression that costs twice as long to find.

## Serialized file inspection commands

Quick reads for common ImWeb file types:

```bash
# Check what a .imweb file actually contains:
cat file.imweb | python3 -c "import json,sys; d=json.load(sys.stdin);
  print('banks:', len(d.get('presets',[])));
  print('scene3d:', d.get('scene3d',{}));
  print('activePreset:', d.get('activePreset'))"
```

```bash
# Check if modelAsset is present:
cat file.imweb | python3 -c "import json,sys;
  t=sys.stdin.read(); print('modelAsset present:', 'modelAsset' in t)"
```

```bash
# Check all states in a bank for a specific param:
cat file.imweb | python3 -c "
import json,sys
d=json.load(sys.stdin)
for bank in d.get('presets',[]):
  for i,s in enumerate(bank.get('states',[])):
    v=s.get('params',s.get('values',{})).get('scene3d.geo','MISSING')
    print(f'{bank[\"name\"]} state {i}: scene3d.geo={v}')"
```
