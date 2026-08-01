#!/bin/bash
# PreToolUse:Read — refuse unbounded reads of very large files.
#
# One rule, no special cases: if the file is big and no offset/limit was given,
# block and name the cheaper route. Serialized ImWeb state gets the extraction
# recipe from the imweb-debugging skill; source gets grep/offset.
#
# Exit 2 = block, stderr shown to Claude. Exit 0 = allow.

THRESHOLD_KB=120

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, shlex, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
ti = d.get("tool_input") or {}
path = ti.get("file_path") or ""
bounded = ti.get("offset") is not None or ti.get("limit") is not None
print("FILE=%s" % shlex.quote(path))
print("BOUNDED=%d" % (1 if bounded else 0))
PY
)"

[ -z "$FILE" ] && exit 0
[ "$BOUNDED" = "1" ] && exit 0
[ -f "$FILE" ] || exit 0

SIZE_KB=$(du -k "$FILE" | cut -f1)
[ "$SIZE_KB" -lt "$THRESHOLD_KB" ] && exit 0

TOKENS=$(( SIZE_KB * 1024 / 4 ))

case "$FILE" in
  *.imweb|*.imbank|*.imstate)
    cat >&2 <<EOF
BLOCKED: $FILE is ${SIZE_KB}KB (~${TOKENS} tokens) — reading it whole would
consume most or all of the context window.

This is serialized ImWeb state. Extract the fields you need instead. From the
imweb-debugging skill:

  python3 -c "import json;d=json.load(open('$FILE'));
    print('banks:', len(d.get('presets',[])));
    print('scene3d:', d.get('scene3d',{}));
    print('activePreset:', d.get('activePreset'))"

Or list top-level keys first:
  python3 -c "import json;print(list(json.load(open('$FILE')).keys()))"
EOF
    exit 2
    ;;
esac

cat >&2 <<EOF
BLOCKED: $FILE is ${SIZE_KB}KB (~${TOKENS} tokens) for an unbounded read.

Project rule is grep-first, then surgical edit. Use one of:
  - Grep for the symbol, then Read with offset/limit around the hit
  - mcp__codebase-memory-mcp__search_graph / get_code_snippet
  - Read with an explicit offset+limit (this guard only blocks unbounded reads)
EOF
exit 2
