# ImWeb v0.12.0 — Dual-Deck & Touch Polish

*Released 2026-07-10*

## Dual-Deck A/B Video

The headline feature: two independent movie decks playing at once, mixed
through a dedicated MixBus.

- **Deck B** — a full second movie engine (`movieB.*` params) with its own
  speed, scrub, loop range, BPM sync, and mute. Selectable everywhere as the
  **Movie B** source.
- **MixBus** — crossfade the decks or combine them with **Add, Multiply,
  Luma Mask, and Displace** modes (`mix.*` params). The mixed signal is
  itself a source (**Mix Bus**), so it can be composited, captured, and
  time-displaced like anything else. `mix.xfade` at 0 is always pure Deck A —
  every pre-v0.12 project renders identically.
- **Clip routing** — ⇧-click a Clip Library slot or Deck A clip (or ⇧-drop a
  video file) to load Deck B; on touch, use the **Target: A / B** toggle in
  the Clip Library. The Movie B panel shows the cued clip's thumbnail and
  name at a glance.
- **Idle-deck gating** — a deck that provably can't contribute to the frame
  skips its GPU texture upload (playback keeps running for cue), so
  single-deck performance stays at pre-dual-deck levels.

## Device-Adaptive UI

- **Restructured tab bar** — Mapping | Movies | 3D | Analog | Draw | Project.
  Stills Buffer lives with the media in Movies; Text joins Draw; Response
  Curves and the Live GLSL editor join Project.
- **Desktop state bar ＋ tile** — quick-save a state from the bottom bar
  (same action as ⇧S and the mobile ＋).
- **Movie playback polish** — speed range extended to ±3×, seamless loop
  wrapping (lookahead seek eliminates the boundary stutter), and autoplay
  recovery on first interaction under Chrome's engagement policy.

## iPad / iOS Fixes

- **Controller assignment menu works by touch** — including the LFO, Fixed
  Value, and MIDI options, whose entry dialogs iOS only authorizes from a
  native tap. Scroll-releases over menu items can no longer trigger
  accidental assignments.
- **Camera diagnostics** — camera activation failures now say why
  (permission denied / in use / not found / needs HTTPS) instead of failing
  silently. Camera and mic still require a secure origin on iPad
  (`npm run dev:https` for development).
- **Touch XY performance** — reminder: the output canvas drives
  `mouse-x`/`mouse-y` assignments in **Pad** mode (3-finger-tap cycles
  Camera → Pad → Locked).

## Stability

- **TimeDisplace "Native" VRAM clamp** — Native buffer resolution is capped
  at 1280 wide (aspect preserved). The 120-frame delay ring multiplies
  resolution by ~500 bytes per pixel; unclamped large desktop panels
  silently exhausted GPU memory.
- **Repo hygiene** — user bank/project saves can no longer slip into
  commits; only the factory MasterProject ships.

---

Full detail per change in `CHANGELOG.md`. Dual-deck build plan and
architecture notes in `docs/ImWeb-DualDeck-v0.12-BuildPlan.md`.
