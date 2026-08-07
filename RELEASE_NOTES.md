# ImWeb v0.18.0 — The Way In

*Released 2026-08-07*

A release about getting in. The guided tour ships, the documentation gets a
front door, and the one control the tour asks you to touch first has been made
to behave the way the tour always said it did.

Most of what follows was found by reading the panel rather than by running the
tests. The suite was green throughout — including while the tour pointed at a
control nobody could reach, and while a knob that saved, recalled and MIDI-mapped
perfectly moved nothing at all.

## The guided tour

**27 steps in three tracks**, opened with `⇧G`, the new `?` menu, or the button
on the first-run splash.

- **Basics** (9) — the panel, the parameter row, what min and max actually mean,
  assigning and editing a controller, response curves, states and morph, the
  performance keys.
- **Principles** (6) — small patches, three or four moves each, one idea apiece:
  a composite is two layers; any source can drive any other; any parameter can
  be driven; the output is a source; time is an axis you point at; then all five
  in one patch.
- **Instruments** (12) — the machines.

**It points; it never sets.** Each step names its targets and gives you a chip
per name that switches to the owning tab, expands the collapsed section, scrolls
the row into view and flashes it. Your hand moves the control. A tour that set
values would wreck a patch someone was halfway through, and it teaches nothing,
because the hand that moved the control was not theirs.

The content is one markdown file, `docs/ImWeb-Guide.md`, parsed at runtime —
readable on GitHub, sendable as an email, editable without touching JavaScript.

## A Help menu

A **`?` button in the status bar**: Guided Tour, Keyboard Shortcuts, Quick Start,
Quick Reference, Full Manual, About.

This is the first release in which the documentation has a persistent front door.
The splash offers the tour once per browser and then never again, and the manual
links used to live at the bottom of the AI provider settings panel — nobody
configuring an API key is looking for a guided tour.

## Blend Amt is a three-stop crossfade

`0 %` Background alone → `50 %` the blend mode at full strength → `100 %`
Foreground alone. **The default is now 50 %**, the centre detent.

It was a plain layer opacity, which is what every compositing program means by
the word, but it left no way to fade the Background out at all — with `Screen`
at 100 % the Background was still plainly there. One knob now fades out either
layer with the blend in the middle, which is what the tour had been describing
all along.

Only the Foreground layer takes the new curve. The Background's control is a
**self-process** — it blends the Background against itself, a tone treatment of
one picture rather than a meeting of two — and it is now labelled as one instead
of masquerading as a second blend mode. The two amounts also moved out of Layer
Color to sit with the mode they scale, under `SOURCE` / `BLEND` column captions.

### If you have saved work

Layer blend amounts moved from `0–1` to `0–100 %`. Every `.imweb`, `.imbank`,
`.imstate` and stored bank migrates automatically on load, controller recall
bounds included.

Foreground values scale by 50 rather than 100, because the old maths was exactly
the first half of the new curve — so a patch saved at full blend lands on the
50 % detent at full blend, not at 100 % showing a raw Foreground.

Checked against the factory project and bank: 108 values, every one landing on
the blend detent. **Nothing you have saved should look different.** What changes
is where the knob travels the next time you move it.

## Fixes

- **The Background's blend amount had never done anything.** The self-blend
  hardcoded its strength, so a control that was registered, documented, captured
  by Display States and MIDI-mappable moved nothing at all.
- **Touching a slider disabled the performance keys.** Any focused input killed
  every single-key shortcut, and every parameter slider is one — so a single
  click silenced `q` / `a` / `z` / `v` / `m` for the rest of the session. It read
  as "the keys don't work on this tab", the tab being whichever one you happened
  to touch a slider on.
- **The service worker could invent a network failure.** Unguarded cache lookups
  meant a storage hiccup surfaced as a bare `Failed to fetch` with no status
  behind it, indistinguishable from the server being down.
- **The service worker was failing to install on the deployed site.** Its app
  shell listed development-only paths against an all-or-nothing cache call, so a
  single missing file rejected the entire install and the worker never activated.
  Offline support has been broken in production longer than anyone noticed.
- **Documentation is served network-first**, so an edited manual reaches a reader
  who has already opened the old one. It was previously cached indefinitely.
- **`ImWeb_Quick_Start.md`** was served to readers but left out of the docs sync,
  so the copy inside the app had been quietly drifting from the edited one.
- **Tour corrections.** Principle 1 claimed the blend amount crossfaded one
  picture into the other, and never mentioned that the default `Copy` mode
  bypasses the blend entirely — so following the step exactly left the control
  inert. `g` was documented as cycling three canvas modes when there are five,
  and the warp-drawing step asked for the wrong one.

## Under the hood

`tests/audit-blend-percent.mjs` covers the migration end to end: the conversion,
the version stamp that gates it, every file format's read and write path, the
curve's three endpoints, and the guarantee that the shared blend material is
never left holding a stale curve uniform. It was confirmed to fail with each
fault injected rather than merely passing on correct code.

The suite is 240 assertions.
