## Surgical Edit Workflow
1. git log --oneline -5 && git status
2. Grep for the exact target block (max 5 searches)
3. State one way this fix could still fail — if you can't, stop and rethink
4. Make the minimal str_replace edit
5. Run: node --check <filename>
6. verdict console / verdict js to verify DOM/logic
7. git commit -m "type(scope): description"
Never rewrite entire files. One task per prompt.
