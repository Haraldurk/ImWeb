#!/bin/bash
# PreToolUse:Bash — refuse `git checkout <file>` / `git restore <file>` when the
# named path has changes that the command would destroy.
#
# This was an [advisory] in LEARNED.md and the advisory did not work. The reason
# it did not work is worth stating, because it is the whole argument for making
# it a hook: the failure mode is not forgetting the rule, it is having CHECKED
# the tree at the start of a session, concluded "clean", and then reused that
# stale conclusion an hour and several edits later. Prose cannot fix a belief
# that was true when it was formed. A check at the moment of the command can.
#
# Scope, deliberately narrow: only the pathspec forms, which overwrite the
# working tree from the index or from a tree-ish. Branch operations
# (`git checkout main`, `git checkout -b feat/x`) are untouched — they are not
# what ate the two fixes.
#
# Exit 2 = block, stderr shown to Claude. Exit 0 = allow.

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, os, re, shlex, sys

try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command") or ""

# Git options that take a SEPARATE value argument. Consuming these matters:
# without it, `git checkout --pathspec-from-file list.txt` would read `list.txt`
# as the pathspec and check the wrong thing.
VALUE_OPTS = {"-s", "--source", "--conflict", "--pathspec-from-file", "-c", "-C", "-b", "-B",
              "--orphan", "-t", "--track"}
# Options that mean "this is a branch operation", not a file restore.
BRANCH_OPTS = {"-b", "-B", "--orphan", "--detach", "--track", "-t", "--guess", "--no-guess"}


def parse(segment):
    """Return (paths, uses_source) for a git checkout/restore pathspec call, else None."""
    try:
        toks = shlex.split(segment)
    except ValueError:
        toks = segment.split()
    while toks and re.fullmatch(r"\w+=.*", toks[0]):        # env assignments
        toks.pop(0)
    while toks and toks[0] in ("command", "exec", "sudo"):
        toks.pop(0)
    if not toks or not (toks[0] == "git" or toks[0].endswith("/git")):
        return None
    toks.pop(0)

    # Options belonging to git itself, before the subcommand: -C <dir>, -c k=v.
    # NOTE: no apostrophes anywhere in this heredoc. bash 3.2 (what macOS
    # ships) scans $( ) for quote pairs without honouring a quoted heredoc, so
    # a single unpaired apostrophe in a Python comment makes the WHOLE FILE
    # fail to parse — and the line it names is ~90 lines further down, at the
    # next real quote it finds. Verified: the first draft of this very NOTE
    # contained one, and reintroduced the bug it was written to warn about.
    while toks:
        t = toks[0]
        if t in ("-C", "-c"):
            toks = toks[2:]
        elif t.startswith("-"):
            toks.pop(0)
        else:
            break
    if not toks:
        return None
    sub = toks.pop(0)
    if sub not in ("checkout", "restore"):
        return None

    # Split off an explicit pathspec separator first — after `--`, everything is
    # a path no matter what it looks like.
    if "--" in toks:
        i = toks.index("--")
        opts, paths, explicit = toks[:i], toks[i + 1:], True
    else:
        opts, paths, explicit = toks, [], False

    flags, rest = [], []
    skip = 0
    for t in opts:
        if skip:
            skip = 0
            continue
        if t.startswith("-"):
            flags.append(t.split("=", 1)[0])
            if t in VALUE_OPTS and "=" not in t:
                skip = 1
        else:
            rest.append(t)

    uses_source = any(f in ("-s", "--source") for f in flags) or \
                  any(f in ("--staged", "-S") for f in flags)

    if not explicit:
        if sub == "restore":
            # `git restore` is a pathspec command by definition — no ref form.
            paths = rest
        else:
            if any(f in BRANCH_OPTS for f in flags):
                return None                                  # branch operation
            if len(rest) >= 2:
                paths, uses_source = rest[1:], True           # git checkout <ref> <paths>
            elif len(rest) == 1:
                # One bare argument: a branch, or a path. Disambiguate the way
                # git does — by asking the filesystem, not by how it looks.
                if os.path.exists(rest[0]) or rest[0] in (".", ".."):
                    paths = rest
                else:
                    return None
            else:
                return None
    if not paths:
        return None
    return paths, uses_source


hits, uses_source = [], False
for seg in re.split(r"[;&|\n]+", cmd):
    r = parse(seg)
    if r:
        hits.extend(r[0])
        uses_source = uses_source or r[1]

print("PATHS=(%s)" % " ".join(shlex.quote(p) for p in dict.fromkeys(hits)))
print("USES_SOURCE=%d" % (1 if uses_source else 0))
print("CMD=%s" % shlex.quote(cmd[:300]))
PY
)"

[ "${#PATHS[@]}" -gt 0 ] || exit 0

# Unstaged work is what a plain `git checkout -- <path>` destroys. A form that
# names a source (a tree-ish, -s, --staged) overwrites the index too, so staged
# work is equally at risk and gets checked as well.
DIRTY=$(git diff --name-only -- "${PATHS[@]}" 2>/dev/null)
if [ "$USES_SOURCE" = "1" ]; then
  STAGED=$(git diff --cached --name-only -- "${PATHS[@]}" 2>/dev/null)
  DIRTY=$(printf '%s\n%s\n' "$DIRTY" "$STAGED" | grep -v '^$' | sort -u)
fi

[ -n "$DIRTY" ] || exit 0

# Built before the heredoc, not inside it: bash parses command substitution in
# an unquoted heredoc at parse time, and a quoted sed script in there trips it.
LIST=$(printf '%s\n' "$DIRTY" | sed 's/^/  - /')

cat >&2 <<EOF
BLOCKED: this would discard uncommitted changes.

  $CMD

Modified and about to be overwritten:
$LIST

A tree you verified clean earlier in the session is not evidence about now —
that stale conclusion is exactly what this hook exists to catch. Look at what
is actually there before deciding it is disposable:

  git diff -- ${PATHS[*]}

If the changes are wanted, keep them (\`git stash push -- ${PATHS[*]}\`, or commit).
If they really are junk, say so to the owner and let them run it, or re-run with
the hook disabled for the turn.
EOF
exit 2
