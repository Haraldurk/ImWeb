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
