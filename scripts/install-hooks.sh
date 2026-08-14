#!/bin/bash
# Installs ImWeb's git hooks:
#   post-commit — push when MasterProject.imweb changed (factory state ships)
#   pre-push    — npm test must be green before anything leaves the machine
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
