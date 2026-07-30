# LEARNED.md — Append-Only Lessons Log

Lessons from owner corrections and self-caught mistakes, appended by AI agents
per the Self-Learning section of CLAUDE.md. One line per lesson. Never rewrite
or delete existing entries — refine a similar lesson in place instead of
duplicating it. On conflict with CLAUDE.md, this file wins.

Entry format:
`- YYYY-MM-DD: <rule> (trigger: <what went wrong>)`

---

## Lessons

- 2026-07-10: Never `git add -A` in this repo — check `git status` for untracked files first; the `!public/**` gitignore negation lets user bank saves slip into commits (trigger: committed and pushed Bank 1.imweb with a Phase 10 fix).
- 2026-07-11: After npm-installing a dep, check `npm ls <pkg>` for hoisted forks (obsidian-dataview pins lishid's @codemirror/language fork) and restart the Vite dev server — its pre-bundled deps cache (node_modules/.vite) goes stale and silently mixes old/new module instances (trigger: CodeMirror highlighting produced zero token spans; parse tree was fine).
- 2026-07-11: A failing headless DOM check is a real signal until proven otherwise — verify with a positive control before blaming the environment (trigger: dismissed zero CodeMirror highlight spans as a headless artifact; the legacy clike mode was genuinely broken in real Chrome too).
- 2026-07-12: Before writing any integration against an external AI provider API, read the current API reference/skill FIRST — model IDs, response shapes (thinking-first content blocks), and token semantics drift; building from memory cost five reactive bugfix phases (trigger: content[0].text parse bug + stale model list found only after real-provider failures).
- 2026-07-12: Never start a second dev server — share the owner's on 5173. A parallel server splits localStorage per port (API keys, presets invisible across origins) and masquerades as app bugs (trigger: killed owner's vite, spawned my own; test-connection 'paradox' was config split across 5173/5174).
- 2026-07-12: When adding behavior to a system-level entry point, grep for sibling paths that bypass it before claiming coverage — ps.setNormalized resolved tables but nearly every controller called p.setNormalized directly, so tables silently never applied to MIDI/mouse/sound (trigger: owner asked "do tables auto-scale?"; the honest answer was "they mostly don't run").
- 2026-07-30: "Append-only" protects a list's own indices, not indices in a list built by appending something AFTER it — before appending to SOURCE_DEFS, check every derived array with a tail (CAPTURE_SOURCES pins FG/BG/DS Src at SOURCES.length, so source 29 would have rotated them to 30/31/32 in five saved capture params). Stamp the base in the file and migrate on load; a frozen high base puts holes in dropdowns and controller travel (trigger: Blueprint §6 instructed "append at index 29" and nothing in the append-only rule flagged the collision).
- 2026-07-12: An occluded/backgrounded Chrome tab freezes rAF entirely — render loop AND controller ticks stop; automated sweep tests read as failures while the code is fine. Check the app's FPS readout (0 fps = invalid test) before debugging the code (trigger: two "broken" recall-range test runs were just a hidden window).
