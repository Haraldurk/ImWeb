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
# The synthesised address uses .invalid (RFC 2606, permanently unresolvable) on
# purpose. Only Anthropic publishes a registered noreply address, so only its
# trailer feeds GitHub's contributor graph. Inventing a plausible-looking
# vendor address to even that up would fake an identity to game a chart. These
# trailers are an honest record in the history; the graph stays skewed, and the
# fix for the graph is prose in the PR body, not a fabricated mailbox.
MSG_FILE="$1"
SOURCE="$2"

[ -z "$AI_MODEL" ] && exit 0

# Merge/squash messages are assembled by git from commits already stamped.
case "$SOURCE" in merge|squash) exit 0 ;; esac

# An amend or a -c/-C reuse already carries the trailer — do not double it.
grep -qi '^Co-Authored-By:' "$MSG_FILE" && exit 0

# Accept either "Name <mail@host>" or a bare "Name".
case "$AI_MODEL" in
  *\<*\>*) IDENT="$AI_MODEL" ;;
  *)       IDENT="$AI_MODEL <noreply@ai-assisted.invalid>" ;;
esac

# Trailers must be the last block, separated from the body by a blank line.
printf '\nCo-Authored-By: %s\n' "$IDENT" >> "$MSG_FILE"
EOF
chmod +x "$HOOK"
echo "✓ prepare-commit-msg hook installed"
