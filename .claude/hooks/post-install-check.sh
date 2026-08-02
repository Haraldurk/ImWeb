#!/bin/bash
# PostToolUse:Bash — after an npm install, flag the two things that bite.
#
# 1. HOISTED FORKS. A transitive dep can pin a fork of a package you also use
#    directly (obsidian-dataview pins lishid's @codemirror/language fork). npm
#    installs both, and the two module instances mix silently — CodeMirror
#    highlighting produced zero token spans while the parse tree was fine.
#
# 2. STALE PRE-BUNDLE CACHE. Vite's node_modules/.vite holds pre-bundled deps
#    from before the install. Without a restart the running server keeps serving
#    the old copies, so the new version appears not to have taken effect.
#
# PostToolUse: the install already happened. Exit 2 = surface as feedback.

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, re, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command") or ""
hit = bool(re.search(
    r'(^|[;&|]\s*)(npm|pnpm|yarn)\s+(install|i|add|update|up|uninstall|remove)\b', cmd))
print("HIT=%d" % (1 if hit else 0))
PY
)"

[ "$HIT" = "1" ] || exit 0

cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0

NOTES=""

# 1. Duplicate copies of a direct dependency anywhere in the tree.
DUPES=$(python3 - <<'PY'
import json, os
try:
    deps = json.load(open('package.json'))
    names = set(deps.get('dependencies', {})) | set(deps.get('devDependencies', {}))
except Exception:
    raise SystemExit
found = []
for name in sorted(names):
    top = os.path.join('node_modules', name, 'package.json')
    if not os.path.exists(top):
        continue
    nested = []
    for dirpath, dirnames, _ in os.walk('node_modules'):
        if dirpath.count('node_modules') < 2:
            continue
        cand = os.path.join(dirpath, name, 'package.json')
        if os.path.exists(cand):
            nested.append(cand)
        if len(nested) > 2:
            break
    if nested:
        try:
            tv = json.load(open(top)).get('version', '?')
            nv = json.load(open(nested[0])).get('version', '?')
        except Exception:
            tv = nv = '?'
        found.append(f"    {name}: top-level {tv}, nested copy {nv} at {nested[0]}")
print('\n'.join(found))
PY
)
[ -n "$DUPES" ] && NOTES="$NOTES
  Duplicate copies of a direct dependency — check for a hoisted fork:
$DUPES
    Confirm with: npm ls <package>
"

# 2. Vite's pre-bundle cache is now stale.
if [ -d node_modules/.vite ]; then
  NOTES="$NOTES
  node_modules/.vite exists and is now STALE. A running dev server keeps
  serving the pre-bundled OLD copies, so the install looks like it did not
  take. Restart the server (and clear node_modules/.vite if it persists).
"
fi

[ -z "$NOTES" ] && exit 0

cat >&2 <<EOF
After the install — two things that fail silently here:
$NOTES
EOF
exit 2
