#!/bin/bash
# PreToolUse:Bash — refuse `git add` forms that stage the WHOLE TREE.
#
# Promotes 2026-08-16 in docs/LEARNED.md. `git add -A` stages what the tree
# contains, not what you were working on, and in this repo the tree is not
# reliably yours. Two failures in one session, neither visible in review:
#
#   (1) a second agent editing the same checkout had its `agrain.pos` commit
#       land on the branch created for recorder work, sweeping an in-progress
#       doc in with it — both agents running `-A` against one HEAD and one
#       index. Untangling it took stashes, a cherry-pick and a branch reset.
#   (2) a node_modules SYMLINK reached main, because .gitignore said
#       `node_modules/` and a trailing slash matches a directory, not a link.
#
# There is an older, sharper reason too (2026-07-10, now audit-gitignore-banks):
# the `!public/**` negation in .gitignore lets user bank saves slip in, and a
# committed Bank 1.imweb was pushed exactly that way.
#
# Why a hook rather than prose: the rule is not hard to remember, it is easy
# not to THINK about. `-A` is muscle memory at the end of a piece of work, and
# both failures above were staged by an -A nobody thought twice about.
#
# Scope, deliberately narrow: only the forms with no limiting pathspec. An
# explicit `git add src/main.js`, and `git add -A -- src/main.js` where the
# pathspec bounds the blast radius, both pass untouched.
#
# Exit 2 = block, stderr shown to Claude. Exit 0 = allow.

read -r -d '' INPUT

eval "$(python3 - "$INPUT" <<'PY'
import json, re, shlex, sys

# NOTE: no apostrophes anywhere in this heredoc. bash 3.2 (what macOS ships)
# scans $( ) for quote pairs without honouring a quoted heredoc, so one
# unpaired apostrophe in a comment breaks the WHOLE FILE, and the error names
# a line ~90 lines below at the next real quote. guard-checkout.sh learned
# this the hard way; do not reintroduce it here.

try:
    d = json.loads(sys.argv[1])
except Exception:
    sys.exit(0)
cmd = (d.get("tool_input") or {}).get("command") or ""

# Flags meaning "the whole tree", and options that consume a separate value.
ALL_FLAGS = {"-A", "--all", "--no-ignore-removal", "-u", "--update"}
VALUE_OPTS = {"--pathspec-from-file", "--chmod"}
# A pathspec that is not a limit at all — it names the entire tree or cwd.
WHOLE = {".", "./", ":/", ":", "*", ":/*"}


def parse(segment):
    """Return the pathspecs for a whole-tree `git add`, or None if it is bounded."""
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

    while toks:                                              # git-level options
        t = toks[0]
        if t in ("-C", "-c"):
            toks = toks[2:]
        elif t.startswith("-"):
            toks.pop(0)
        else:
            break
    if not toks or toks.pop(0) != "add":
        return None

    if "--" in toks:
        i = toks.index("--")
        opts, paths = toks[:i], toks[i + 1:]
    else:
        opts, paths = toks, []

    flags, rest = [], []
    skip = 0
    for t in opts:
        if skip:
            skip = 0
            continue
        if t.startswith("-") and t != "-":
            base = t.split("=", 1)[0]
            if base.startswith("--"):
                flags.append(base)
            else:
                # Short options BUNDLE: -Av is -A plus -v, and -uv is -u plus
                # -v. Expanding every letter rather than matching the whole
                # token keeps the bundled forms indistinguishable from the
                # plain ones, which is the point — a guard that -A trips and
                # -Av walks past is not a guard.
                flags.extend("-" + c for c in base[1:])
            if base in VALUE_OPTS and "=" not in t:
                skip = 1
        else:
            rest.append(t)
    paths = paths + rest

    # Interactive forms stage nothing without a human choosing; leave them be.
    if any(f in ("-p", "--patch", "-i", "--interactive") for f in flags):
        return None

    specific = [p for p in paths if p not in WHOLE]
    if specific:
        return None                                          # bounded — allowed
    all_flag = any(f in ALL_FLAGS for f in flags)
    whole_token = any(p in WHOLE for p in paths)
    if not (all_flag or whole_token):
        return None                                          # bare `git add`
    return [t for t in (["".join(flags[:1])] if flags else []) + paths if t]


hits = []
for seg in re.split(r"[;&|\n]+", cmd):
    r = parse(seg)
    if r is not None:
        hits.append(" ".join(r) or "-A")

print("HITS=%s" % shlex.quote(", ".join(hits)))
print("CMD=%s" % shlex.quote(cmd[:300]))
PY
)"

[ -n "$HITS" ] || exit 0

STAGEABLE=$(git status --short --untracked-files=all 2>/dev/null | head -40)
[ -n "$STAGEABLE" ] || STAGEABLE="  (working tree is clean — nothing would be staged)"

cat >&2 <<EOF
BLOCKED: whole-tree staging ($HITS).

  $CMD

This would stage everything below, not the work you have in mind:

$STAGEABLE

Stage explicit paths instead — the blast radius is then what you name:

  git add src/main.js tests/audit-recorder.mjs

Two things this repo has actually lost to a whole-tree add: another agent
working the same checkout had its commit swept onto the wrong branch, and a
node_modules symlink reached main because .gitignore said node_modules/ and a
trailing slash matches a directory, not a link. The !public/** negation also
lets user bank saves through.

Read the paths above, not the count. A dirty tree you did not dirty is the
tell that someone else is in this checkout — and it can become dirty while you
work. If two agents genuinely need this repo, git worktree gives each its own
HEAD and index, which is the fix rather than a discipline.

If you really do want all of it, name the paths, or re-run with the hook
disabled for the turn.
EOF
exit 2
