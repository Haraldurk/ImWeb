#!/bin/bash
HOOK=".git/hooks/post-commit"
git remote | grep -q origin || { echo "ERROR: no 'origin' remote found"; exit 1; }
cat > "$HOOK" << 'EOF'
#!/bin/bash
CHANGED=$(git diff HEAD~1 --name-only 2>/dev/null)
if echo "$CHANGED" | grep -q "public/Projects/MasterProject.imweb"; then
  echo "[ImWeb] MasterProject changed — pushing to origin..."
  git push origin HEAD:$(git symbolic-ref --short HEAD)
fi
EOF
chmod +x "$HOOK"
echo "✓ post-commit hook installed"
