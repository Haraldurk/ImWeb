#!/bin/bash
# SessionStart — inject the still-live [advisory] lessons from docs/LEARNED.md.
#
# The LEARNED.md tag taxonomy makes promoted lessons self-enforcing: [audit]
# runs in npm test, [hook] IS a hook, [skill] is a step in a skill, [tool] is
# on-demand but executable. An [advisory] entry has no mechanism — it only
# works if the agent happens to read it, and an 80KB log is not reliably
# re-read. So the unpromoted entries are the ones worth putting in context at
# session start; everything else has already become a fence somewhere else.
#
# Stays silent when there is nothing to say. Always exits 0 — a lesson log
# must never block a session.

read -r -d '' INPUT || true

ROOT="${CLAUDE_PROJECT_DIR:-.}"
FILE="$ROOT/docs/LEARNED.md"
[ -f "$FILE" ] || exit 0

ENTRIES=$(grep -E '^- [0-9]{4}-[0-9]{2}-[0-9]{2} \[advisory\]:' "$FILE")
[ -n "$ENTRIES" ] || exit 0

COUNT=$(printf '%s\n' "$ENTRIES" | wc -l | tr -d ' ')
cat <<EOF
LEARNED.md carries $COUNT unpromoted [advisory] lesson(s) — prose only, still live risk. Apply them where they bite; promote them when you can:

$ENTRIES
EOF
exit 0
