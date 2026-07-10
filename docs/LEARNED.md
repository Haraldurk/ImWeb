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
