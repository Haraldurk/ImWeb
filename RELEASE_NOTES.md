# ImWeb v0.19.0 — The Second Pair of Hands

*Released 2026-08-10*

The guide describes a parameter with a controller on it as "a second pair of
hands that never gets tired and never gets bored". This release is about those
hands: being able to *assign* one at all, and the shape of how it moves once
assigned.

Both halves came from someone else using the instrument. The slew work started
from a report that slow LFOs stuttered; the reachability work started from a beta
tester who could not assign a single controller and said so.

---

## Ctrl+click reaches the controller menus

If your pointer has no secondary button — every Mac trackpad at its default
settings — you could open the assignment menu and never reach an item in it. It
closed the instant you let go.

macOS fires `contextmenu` on the **mousedown** of a Ctrl+click and then still
delivers a `click` on the release, so a close-on-outside-click handler shuts the
menu before it can be used. Four surfaces had it: the parameter assignment menu,
the controller badge popover, the state tile menu and the Stills Buffer slot
menu. Between them, that is the entire controller-assignment grammar plus the
state bar.

Two of those did worse than close. A state tile's plain click **recalls the
state**, so Ctrl+clicking a tile to reach *Save here* or *Export* jumped the
whole instrument to that state, mid-performance. A buffer cell selected a
different frame.

It survived years of daily use because it is invisible from the inside: a
button-2 press emits no `click` at all, so anyone with two-finger secondary click
enabled — which is every maintainer — can never reproduce it. It took an outside
tester on a default trackpad.

`tests/audit-contextmenu-dismissal.mjs` now enforces the rule: pair the close
gesture with the phase the open gesture used.

## Slew curves

Slew gains a response curve, set in the badge popover or by appending a word to
Set Slew (`0.4 bounce`). The menu is in two groups because the split is
structural rather than cosmetic:

- ***Any source*** — **Lag**, **Ease in/out**, **Elastic**. Filters, with no
  clock and no fixed endpoint, so they behave the same on a stepped source and a
  swept one.
- ***Stepped sources*** — timed curves running from a captured start to the
  target over exactly the slew time. That clock is the only way to overshoot,
  ring or bounce, and also the limitation: on a continuously sweeping source they
  add ripple instead of removing it.

**Elastic** is an underdamped spring rather than the textbook `easeOutElastic`,
which covered **39% of the whole move in its first frame** at 60 fps — a snap
with a wobble after it, and the one curve in the set that did not ease in at all.
It now bounces off `min` and `max` instead of pressing flat against them, which
is where S+H lands most often. **Back** no longer stalls for ten frames when a
move starts on a rail. Both gained **Strength**, and Elastic a **Damp**.

## Modulation that is actually slow

- **Rate floor is now 0.001 Hz** — one cycle per ~17 minutes.
- **Slow modulation no longer stutters.** `step` was doing double duty as the UI
  drag increment *and* a value quantum, so a 0.001 Hz sine moved the value on 4
  frames out of 600 while the fps counter read a healthy 60. Controller-driven
  writes bypass sub-unit snapping now; integer steps still snap.
- **X-Map onto an LFO's rate is logarithmic**, over 0.05–20 Hz. Linear put every
  rate under 0.5 Hz inside the bottom 2.5% of the travel.
- **Phase** did nothing on a free-running LFO. It does now.

## Finding things, on any keyboard

**`⌘K` / `Ctrl+K`** opens parameter search whatever your layout. `/` cannot work
on Nordic keyboards — there it is `Shift`+`7`, which clip select claims first —
and the `þ` alias was only ever discoverable by accident. Matched on the physical
key, so it follows the key rather than the character printed on it.

An empty filter now says *why* it is empty. *Active* on a fresh session is empty
by definition, and it is the first chip most people press.

## The guided tour, rewritten from tester notes

Rewritten wherever a first-time reader got lost: source and input each defined
plainly instead of "routed, not wired"; **LFO** expanded on first use; the drag
directions disambiguated (the row drags sideways, the min/max fields vertically);
`⌥` named as the alt/option key and located on the keyboard; the state step
sequencer described rather than alluded to.

The tour's highlight is visible now. It was one 1.6 s pulse of the same yellow
that already means "this row has a controller", so it both said the wrong thing
and vanished into the rows that are legitimately yellow. Three pulses of blue
over 2.6 s, with an outline and a glow.

Sub-headings in **Effects** and **LUT** collapse when you click the arrow. They
had been flipping the arrow and moving nothing, which reads as broken rather than
as unsupported.

## Under the hood

`tests/audit-contextmenu-dismissal.mjs` was confirmed to fail with each of seven
faults injected rather than merely passing on correct code: four
`pointerdown`→`click` reversions, both modifier guards removed, and an unreviewed
listener appended.

---

## Upgrading

No project or state file changes. `.imweb`, `.imbank` and `.imstate` files from
v0.18.0 load unchanged.

The service worker cache is bumped to `imweb-v0.15`. **If you self-host, deploy a
fresh `npm run build`** — a returning visitor's browser serves the cached
`index.html` until that constant changes, and a stale one points at a bundle hash
that no longer exists on disk.

## Credits

Reachability and guide feedback from a beta tester working on an M1 MacBook Air
with an Icelandic keyboard, who found in one afternoon what the project had
walked past for a year.

ImWeb is a reimagining of *Image/ine* by Tom Demeyer and Steina Vasulka
(STEIM Amsterdam, 1997/2008). See [CREDITS.md](CREDITS.md).
