#!/bin/bash
# PreToolUse:Edit|Write|NotebookEdit — enforce the read-only paths that CLAUDE.md
# declares in prose, and protect serialized performance state.
#
# Exit 2 = block, stderr shown to Claude. Exit 0 = allow.

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, os, shlex, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
path = (d.get("tool_input") or {}).get("file_path") or ""
root = os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
try:
    rel = os.path.relpath(os.path.realpath(path), os.path.realpath(root))
except Exception:
    rel = path
print("REL=%s" % shlex.quote(rel))
PY
)"

[ -z "$REL" ] && exit 0

case "$REL" in
  CLAUDE.md|docs/imweb-obsidian.md)
    cat >&2 <<EOF
BLOCKED: $REL is READ-ONLY for Claude Code.

CLAUDE.md, Editing Rules: "CLAUDE.md and imweb-obsidian.md are READ-ONLY for
Claude Code. Never modify either file unless the project owner explicitly
instructs it in the same conversation with the exact lines to change."

If the owner did just give exact lines to change, they can disable this hook
for the turn, or make the edit themselves.
EOF
    exit 2
    ;;
esac

case "$REL" in
  *.imweb|*.imbank|*.imstate)
    cat >&2 <<EOF
BLOCKED: $REL is serialized ImWeb performance state, not source.

These files are written by the app. A hand-edit is not reliably recoverable and
can corrupt saved banks and display states. Change the code that writes them, or
re-save from the running instrument.
EOF
    exit 2
    ;;
esac

exit 0
