#!/bin/bash
# PostToolUse:Edit|Write — run the invariant audits after touching pipeline-critical
# files. These are the four scripts behind `npm test`: source resolution, capture
# base, panel coverage, SDF migration. They exist to catch a source appended
# without every consumer updated.
#
# Stays quiet on pass (one line). Surfaces full output only on failure.
# Exit 2 = feedback to Claude. Exit 0 = silent success.

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
  src/controls/ParameterSystem.js|src/main.js|src/core/Pipeline.js|src/inputs/*|src/shaders/*) ;;
  *) exit 0 ;;
esac

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

OUT=$(npm test 2>&1)
if [ $? -eq 0 ]; then
  echo "invariant audits: pass ($REL)"
  exit 0
fi

cat >&2 <<EOF
INVARIANT AUDIT FAILED after editing $REL

$OUT

Fix this before continuing. If a source was appended, check the consumption
fixpoint (_srcUsed in src/main.js) and SOURCE_DEFS consumers — CLAUDE.md,
"Source list & mix buses".
EOF
exit 2
