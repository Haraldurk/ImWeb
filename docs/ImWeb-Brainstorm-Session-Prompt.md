# ImWeb — Brainstorm Session Opening Prompt

Written 2026-07-29, at v0.14.0.

Paste the block below as the first message of a **new** session. It is built for
a cold start: a fresh session has no memory of what shipped, and `CLAUDE.md`
instructs it to stop exploring after 5–10 tool calls and start writing code —
which is right for implementation and wrong for this. The prompt suspends that
rule explicitly, or you get patches when you wanted ideas.

Revise it as the instrument changes. The "Where we are" section is the part that
goes stale first.

---

```
This is a BRAINSTORMING session. No code, no patches, no file edits until I
say so.

Explicitly suspending the CLAUDE.md rule about writing code after 5-10 recon
calls — that rule exists to stop aimless exploration before implementation.
This session IS the exploration. Read as widely as you need.

## Read first

- docs/imweb-obsidian.md — the knowledge base; the phase roadmap near
  "Implementation roadmap" is the honest status
- CHANGELOG.md — the last three entries (v0.12-v0.14) are where the
  instrument's shape actually changed
- KNOWN-ISSUES.md and docs/Todo.md — open threads and deferred decisions
  (note: KNOWN-ISSUES still calls VasulkaWarp "hidden from UI"; CLAUDE.md
  says it was restored in Phase 24 — verify before trusting either)
- Brainstorms/ — .txt notes and .json states from past sessions at the
  instrument

## Where we are

v0.14.0, phases 1-24 shipped. The instrument has: a 29-source graph, three
mix buses, two movie decks with a library, a full effects chain, live GLSL
with AI shader generation, performative warp drawing, 3D/hypercube/SDF
generators, MIDI/OSC/LFO/audio/tilt controllers, and a Project > Bank >
State performance model.

What that means: the obvious features are done. I'm not looking for the next
increment.

## What I want from this session

ImWeb is a reimagining of Image/ine — Tom Demeyer and Steina Vasulka's
instrument, STEIM, 1997. Not a port. The question I want to think hard about
is what this instrument should BECOME, given that it now runs in a browser
with a GPU, a network, and an LLM in it — things Image/ine never had.

Work in two passes, and tell me when you switch:

PASS 1 — diverge. Generate widely. I want ideas that would change what the
instrument IS, not what it has. Include ideas you think are probably wrong.
Draw on the Vasulkas' actual practice and the electronic-image lineage
(Rutt-Etra, Sandin, Paik/Abe, Snowden), on where real-time graphics has gone
since, and on what a browser can do that a 1997 Mac could not. Do not
self-censor for feasibility yet.

PASS 2 — converge. Rank them. For each survivor: what it would feel like to
play, what in the current architecture makes it cheap or expensive (be
specific — name the files and the constraints), and what it would displace.
Then tell me which ones you would NOT do and why.

## How to behave

- Be opinionated. I want your judgment, not a menu.
- Disagree with me and with the existing design where you think it's wrong.
  The taxonomy, the source-graph model, the ParameterSystem-as-state
  decision — all of it is fair game to question in this session.
- Where an idea contradicts a rule in CLAUDE.md, say so explicitly and
  argue the case; don't quietly route around it.
- Ask me questions when my taste is the deciding input. I'd rather answer
  five good questions than read a hedge.

Hard constraints that are NOT up for debate: browser-based, no React/Vue/
component framework, no TypeScript, Three.js + raw GLSL.

Write nothing to disk until we've talked. When we're ready, the output goes
to docs/ as a blueprint in the style of the existing ones.
```

---

## Notes for the session

- **Rutt-Etra is an unstarted intention.** There is a `pre-rutt-etra` tag in
  the repo but no Rutt-Etra code, docs or changelog entry anywhere — the idea
  exists only in the tag name. Raise it if it is still live.
- **The feature surface is saturated, the taxonomy is not.** Phase 23 already
  reorganised the panels once around signal flow. If the instrument grows
  again, that is the thing that breaks next.
- **Two open verification debts** worth naming: the iPad soak test of the
  dual-deck engine, and the 8-tab bar on real hardware.
