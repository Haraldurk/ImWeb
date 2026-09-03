#!/bin/bash
# Answer "is this branch merged?" correctly, under squash merges.
#
# Promotes 2026-08-13 and the mechanical half of 2026-08-27 in docs/LEARNED.md.
#
# A squash discards the branch commits and lands ONE NEW commit with a new sha,
# which severs ancestry. Every intuitive check then lies, and they lie in the
# direction that leaves work sitting open:
#
#   git merge-base --is-ancestor <tip> main   false on a fully merged branch
#   git cherry                                reports everything unmerged
#   git log main..branch                      shows a full history
#   git branch -d                             refuses to delete
#   "N commits ahead"                         counts work already in main
#   git diff main <branch>                    reports main having moved AHEAD
#                                             as if the branch held work
#
# PR #44 sat open for a day holding nothing, because the branch it was cut from
# had been squash-merged into main as part of #45.
#
# What actually answers it, in order: the forge record, then a line-level check
# that the branch content survives in main. Both are below. This is a [tool] and
# not an [audit] on purpose — it asks GitHub, so it needs network and cannot run
# in npm test.
#
# Usage:  scripts/branch-merged.sh [--all] [branch ...]
#         npm run branch-check
set -u

MAIN=${MAIN_BRANCH:-main}
REMOTE_MAIN="origin/$MAIN"

targets=()
all=0
for a in "$@"; do
  case "$a" in
    --all) all=1 ;;
    -h|--help) sed -n '2,30p' "$0"; exit 0 ;;
    *) targets+=("$a") ;;
  esac
done

if [ "$all" = "1" ]; then
  while IFS= read -r b; do
    [ "$b" = "$MAIN" ] || targets+=("$b")
  done < <(git for-each-ref --format='%(refname:short)' refs/heads/)
elif [ "${#targets[@]}" -eq 0 ]; then
  targets=("$(git rev-parse --abbrev-ref HEAD)")
fi

git fetch --quiet origin "$MAIN" 2>/dev/null || true

have_gh=1
command -v gh >/dev/null 2>&1 || have_gh=0
[ "$have_gh" = "1" ] || echo "note: gh not found — falling back to content evidence only" >&2

exit_code=0

for BR in "${targets[@]}"; do
  echo
  echo "── $BR ────────────────────────────────────────────"

  STATE=""; MERGE_OID=""; BASE=""; NUM=""
  if [ "$have_gh" = "1" ]; then
    read -r NUM STATE MERGE_OID BASE < <(
      gh pr list --head "$BR" --state all --limit 5 \
        --json number,state,mergeCommit,baseRefName 2>/dev/null |
      python3 -c '
import json, sys
try:
    rows = json.load(sys.stdin)
except Exception:
    rows = []
# Prefer a MERGED record, then OPEN, then whatever is newest.
rows.sort(key=lambda r: (r.get("state") != "MERGED", r.get("state") != "OPEN"))
if not rows:
    print("- - - -")
else:
    r = rows[0]
    mc = (r.get("mergeCommit") or {}).get("oid") or "-"
    print(r.get("number","-"), r.get("state","-"), mc, r.get("baseRefName","-"))
' 2>/dev/null
    ) || true
  fi

  case "$STATE" in
    MERGED)
      echo "  forge:   PR #$NUM MERGED into $BASE"
      if [ "$MERGE_OID" != "-" ] && [ -n "$MERGE_OID" ]; then
        if git merge-base --is-ancestor "$MERGE_OID" "$REMOTE_MAIN" 2>/dev/null; then
          echo "  commit:  $MERGE_OID is an ancestor of $REMOTE_MAIN"
          echo "  VERDICT: MERGED — safe to delete."
          echo "           (git branch -d will still refuse; that is the squash, not your work)"
          continue
        fi
        echo "  commit:  $MERGE_OID is NOT an ancestor of $REMOTE_MAIN"
        echo "  VERDICT: CHECK — the forge says merged, the graph disagrees."
        echo "           Fetch, or the PR landed on a branch other than $MAIN."
        exit_code=1
        continue
      fi
      echo "  VERDICT: MERGED per the forge, but no merge commit recorded — content check below."
      ;;
    OPEN)
      echo "  forge:   PR #$NUM OPEN against $BASE"
      if [ "$BASE" != "$MAIN" ] && [ -n "$BASE" ] && [ "$BASE" != "-" ]; then
        echo "  STACKED: this PR is based on $BASE, not $MAIN."
        BSTATE=$(gh pr list --head "$BASE" --state all --limit 1 --json state \
                  --jq '.[0].state' 2>/dev/null || echo "")
        if [ "$BSTATE" = "MERGED" ]; then
          echo "  VERDICT: NEEDS REBASE — the base has been squash-merged, so this branch"
          echo "           now carries a DUPLICATE of work already in $MAIN. GitHub"
          echo "           auto-retarget does not fix that; it only moves the base ref."
          echo "           Fix:  git rebase --onto $REMOTE_MAIN \$(git rev-parse $BASE) $BR"
          echo "                 git push --force-with-lease"
          echo "           If the base branch was DELETED, this PR is closed and cannot be"
          echo "           reopened — open a fresh one after the rebase."
          exit_code=1
          continue
        fi
        echo "           Base has not merged yet. Merge base-first and rebase this"
        echo "           IMMEDIATELY, or branch both off $MAIN if they do not truly depend."
      fi
      echo "  VERDICT: OPEN — work in flight."
      continue
      ;;
    CLOSED)
      echo "  forge:   PR #$NUM CLOSED without merging — content check below."
      ;;
    *)
      echo "  forge:   no PR found for this branch — content check below."
      ;;
  esac

  # ── Content evidence, for anything the forge cannot settle ──────────────────
  #
  # The set comparison runs in python, NOT grep. Feeding markdown bullets to
  # grep makes it parse a leading "-" as an option; that errored once and
  # inflated a "missing lines" count with garbage that was one report away from
  # being presented as lost work. Python has no option parsing to trip over.
  BASE_SHA=$(git merge-base "$REMOTE_MAIN" "$BR" 2>/dev/null)
  if [ -z "$BASE_SHA" ]; then
    echo "  VERDICT: UNKNOWN — no merge base with $REMOTE_MAIN."
    exit_code=1
    continue
  fi

  git diff --unified=0 "$BASE_SHA" "$BR" |
  python3 -c '
import subprocess, sys

remote_main = sys.argv[1]
added = {}                       # path -> [line, ...]
path = None
for raw in sys.stdin.read().split("\n"):
    if raw.startswith("+++ b/"):
        path = raw[6:]
        continue
    if raw.startswith("+") and not raw.startswith("+++") and path:
        line = raw[1:].strip()
        if len(line) > 3:        # skip braces and blanks, which match anywhere
            added.setdefault(path, []).append(line)

if not added:
    print("  content: this branch adds no lines over the merge base.")
    print("  VERDICT: EMPTY — nothing here to lose.")
    raise SystemExit(0)

cache = {}
def main_text(p):
    if p not in cache:
        try:
            cache[p] = subprocess.run(
                ["git", "show", f"{remote_main}:{p}"],
                capture_output=True, text=True, check=True).stdout
        except subprocess.CalledProcessError:
            cache[p] = None
    return cache[p]

total = survived = 0
missing = {}
for p, lines in added.items():
    text = main_text(p)
    for ln in lines:
        total += 1
        if text is not None and ln in text:
            survived += 1
        else:
            missing.setdefault(p, []).append(ln)

pct = 100.0 * survived / total if total else 0.0
print(f"  content: {survived}/{total} added lines ({pct:.0f}%) are present in {remote_main}")
if not missing:
    print("  VERDICT: MERGED BY CONTENT — every added line survives in main.")
    raise SystemExit(0)

n_missing = sum(len(v) for v in missing.values())
if pct < 20:
    print(f"  {n_missing} of {total} added lines are absent from {remote_main}.")
    print("  VERDICT: UNMERGED — this branch holds work that is not in main.")
    raise SystemExit(0)

print(f"  {n_missing} line(s) not found, in {len(missing)} file(s):")
for p, lines in sorted(missing.items()):
    print(f"    {p}  ({len(lines)})")
    for ln in lines[:3]:
        print(f"      {ln[:96]}")
    if len(lines) > 3:
        print(f"      ... and {len(lines) - 3} more")
verdict = "MOSTLY IN MAIN" if pct >= 80 else "MIXED"
print(f"  VERDICT: {verdict} — TRACE EACH MISSING LINE before calling this unmerged.")
print("  A line absent from main is usually a passage a LATER commit revised, not")
print("  lost work — on the doc branches every single one turned out to be that,")
print("  including a passage a corrections PR deliberately narrowed. Run:")
print(f"    git log -S <a distinctive fragment> --oneline {remote_main}")
raise SystemExit(1)
' "$REMOTE_MAIN" || exit_code=1
done

echo
echo "Reminder: git branch -d, \"N commits ahead\" and a $MAIN...branch diff all"
echo "reason from ancestry, and a squash severs it. None of them answer this."
exit "$exit_code"
