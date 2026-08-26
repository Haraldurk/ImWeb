#!/bin/bash
# Installs ImWeb's git hooks:
#   post-commit        — push when MasterProject.imweb changed (factory state ships)
#   pre-push           — npm test must be green before anything leaves the machine
#   prepare-commit-msg — stamp $AI_MODEL as a Co-Authored-By trailer
git remote | grep -q origin || { echo "ERROR: no 'origin' remote found"; exit 1; }

HOOK=".git/hooks/post-commit"
cat > "$HOOK" << 'EOF'
#!/bin/bash
CHANGED=$(git diff HEAD~1 HEAD --name-only 2>/dev/null)
if echo "$CHANGED" | grep -q "public/Projects/MasterProject.imweb"; then
  echo "[ImWeb] MasterProject changed — pushing to origin..."
  git push origin HEAD:$(git symbolic-ref --short HEAD)
fi
EOF
chmod +x "$HOOK"
echo "✓ post-commit hook installed"

HOOK=".git/hooks/pre-push"
cat > "$HOOK" << 'EOF'
#!/bin/bash
# A red tree that reaches origin fails CI there instead — after it has cost a
# review round. Cheaper to stop it here. CI is the backstop, not the gate.
echo "[ImWeb] pre-push: npm test..."
if npm test; then
  echo "[ImWeb] suite green — pushing"
  exit 0
fi
echo "[ImWeb] pre-push BLOCKED: npm test failed. Fix it, or push with --no-verify if you truly mean it."
exit 1
EOF
chmod +x "$HOOK"
echo "✓ pre-push hook installed"

HOOK=".git/hooks/prepare-commit-msg"
cat > "$HOOK" << 'EOF'
#!/bin/bash
# Records WHICH AI tool produced a change, as a Co-Authored-By trailer.
#
# Claude Code appends its own trailer; Gemini CLI, Kimi, DeepSeek, Qwen, Codex
# and opencode do not. The result was a contributor graph reading as if one
# model wrote 410 of 547 commits while five others left no trace at all — the
# graph was measuring which tool stamps itself, not who did the work.
#
# Prose in six different agent config files cannot hold that. This can:
#   export AI_MODEL="Gemini 3 Pro"      # in the shell that runs that tool
#
# Unset ⇒ no-op, so hand-typed commits stay clean.
#
# ALL addresses resolve to .invalid (RFC 2606, permanently unresolvable), and
# registered vendor noreply addresses are rewritten to match — see below. No
# model feeds GitHub's contributor graph, by design.
MSG_FILE="$1"
SOURCE="$2"

# Merge/squash messages are assembled by git from commits already stamped.
case "$SOURCE" in merge|squash) exit 0 ;; esac

if [ -n "$AI_MODEL" ]; then
  # An amend or a -c/-C reuse already carries the trailer — do not double it.
  if ! grep -qi '^Co-Authored-By:' "$MSG_FILE"; then
    # AI_MODEL is a NAME only. It deliberately cannot carry its own address —
    # an escape hatch for "Name <mail@host>" is an escape hatch for a live
    # address, which is the one thing this hook exists to prevent.
    NAME=$(printf '%s' "$AI_MODEL" | sed -E 's/[[:space:]]*<[^>]*>//g; s/[[:space:]]+$//')
    [ -z "$NAME" ] && exit 0
    # Trailers are the last block, separated from the body by a blank line.
    printf '\nCo-Authored-By: %s <noreply@ai-assisted.invalid>\n' "$NAME" >> "$MSG_FILE"
  fi
fi

# ---------------------------------------------------------------------------
# Neutralise registered vendor addresses. LAST, so it catches every trailer —
# Claude Code's own stamp and anything carried in by --amend alike. Ordering
# this before the append left a hole that AI_MODEL sailed straight through.
#
# Anthropic is the only AI vendor publishing a noreply address that GitHub
# resolves to an account, so a Claude trailer became a contributor-graph entry
# while an identical Gemini or DeepSeek trailer did not. That asymmetry is a
# fact about which vendor runs a mailbox, not about who wrote the code, and it
# produced a graph crediting one model with 410 of 547 commits.
#
# Two ways to even it up: invent addresses for the others, or stop using the
# one that resolves. The first fabricates identities to move a number on a
# chart. This does the second — every model is named in the history, none is
# counted in the graph, and the graph stops claiming to measure something it
# never measured.
#
# Gated on a `noreply` local part, so a real human with a vendor address is
# never rewritten.
sed -i.bak -E \
  's/^([Cc]o-[Aa]uthored-[Bb]y: .+) <noreply@[A-Za-z0-9.-]+>[[:space:]]*$/\1 <noreply@ai-assisted.invalid>/' \
  "$MSG_FILE" && rm -f "$MSG_FILE.bak"
EOF
chmod +x "$HOOK"
echo "✓ prepare-commit-msg hook installed"
