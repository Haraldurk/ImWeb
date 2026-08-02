#!/bin/bash
# PreToolUse:Bash — refuse to start a SECOND Vite dev server.
#
# A parallel dev server splits localStorage per origin: API keys, GLSL user
# presets and warp slots saved on :5173 are invisible on :5174, and the symptom
# reads as an app bug rather than as two servers. One session was spent on a
# "test-connection paradox" that was config split across two ports.
#
# `vite preview` is NOT a dev server and is the sanctioned verification path
# (see the verify skill) — always allowed.
#
# Exit 2 = block, stderr shown to Claude. Exit 0 = allow.

OWNER_PORT=5173

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, re, shlex, sys
try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command") or ""

# Only care about commands that actually START a vite dev server. Tokenise per
# segment rather than pattern-matching the whole string: `grep vite ...` must
# not trigger, and an env-var prefix (IMWEB_HTTPS=1 npx vite ...) must not hide
# the invocation from an anchored regex.
def starts_dev_server(segment):
    try:
        toks = shlex.split(segment)
    except ValueError:
        toks = segment.split()
    while toks and re.fullmatch(r'\w+=.*', toks[0]):   # env assignments
        toks.pop(0)
    while toks and toks[0] in ('npx', 'pnpm', 'yarn', 'command', 'exec'):
        toks.pop(0)
    if not toks:
        return False
    if toks[0] in ('npm', 'pnpm', 'yarn') and len(toks) >= 3 \
       and toks[1] == 'run' and toks[2].startswith('dev'):
        return True
    if toks[0] == 'vite' or toks[0].endswith('/vite'):
        return not (len(toks) >= 2 and toks[1] in ('preview', 'build', 'optimize'))
    return False

starts_dev = any(starts_dev_server(s) for s in re.split(r'[;&|]+', cmd))

port = ""
m = re.search(r'--port[= ]\s*(\d+)', cmd)
if m:
    port = m.group(1)

print("STARTS_DEV=%d" % (1 if starts_dev else 0))
print("PORT=%s" % shlex.quote(port))
print("CMD=%s" % shlex.quote(cmd[:200]))
PY
)"

[ "$STARTS_DEV" = "1" ] || exit 0

# Is the owner's server already up?
OCCUPIED=0
if command -v lsof >/dev/null 2>&1; then
  lsof -i ":$OWNER_PORT" -sTCP:LISTEN >/dev/null 2>&1 && OCCUPIED=1
fi

if [ "$OCCUPIED" = "1" ]; then
  cat >&2 <<EOF
BLOCKED: a dev server is already listening on :$OWNER_PORT — share it.

  $CMD

Starting a second one splits localStorage per origin. API keys, GLSL user
presets and warp slot contents saved on :$OWNER_PORT are invisible to the new
port, and the result reads as an app bug, not as two servers.

Use http://localhost:$OWNER_PORT/ directly. To verify a BUILD instead, use the
sanctioned path from the verify skill:

  npm run build && npx vite preview --port 4173 --strictPort
EOF
  exit 2
fi

if [ -n "$PORT" ] && [ "$PORT" != "$OWNER_PORT" ]; then
  cat >&2 <<EOF
BLOCKED: dev server requested on :$PORT rather than :$OWNER_PORT.

  $CMD

Even with nothing running, a different port is a different origin, so anything
already saved to localStorage on :$OWNER_PORT will look missing. "Lost presets"
almost always means "different origin".

Start it on :$OWNER_PORT, or use \`npx vite preview --port 4173\` to check a build.
EOF
  exit 2
fi

exit 0
