# WORKFLOW.md — ImWeb Development Workflow

Single canonical reference. Supersedes all previous workflow docs.
Read before any session. Update when the workflow actually changes.

---

## The Tool Roster

| Agent | Terminal | Role | Hard limits |
|-------|----------|------|-------------|
| **Claude Chat** | claude.ai | Architecture, planning, cross-file reasoning, CLAUDE.md review, Obsidian updates | Never writes code directly to repo |
| **Claude Code** | Ghostty ⌘3 | Surgical JS/CSS edits, multi-file wiring, Pipeline/shader work, recon, git | Never scopes its own tasks — receives a pre-written prompt |
| **Antigravity CLI** | Ghostty ⌘2 | CHANGELOG.md, Quick Reference, README, all markdown/docs | Never touches JS; never feeds raw terminal output back to Claude Code |
| **Kimi K2.6** | Ghostty ⌘1 | Recon, exploration, reading large files, cross-module tracing | Never edits. Find-only. Feed results to Claude Chat, not directly to Claude Code |
| **Browser (you)** | — | Visual confirmation after every patch | Only tool that can verify WebGL / Metal rendering |

### The Codex Review (inside Claude Code)

After any core logic change and before committing, trigger the GPT-5.5 subagent:

```
/codex:review
```

- **Accept:** critical security or syntax fixes it flags
- **Ignore:** style suggestions that conflict with existing paradigms
- Not required for CSS-only changes or markdown edits

### When to use Kimi K2.6 vs Claude Code for recon

Use **Kimi K2.6** when investigation spans many files or requires reading main.js
in full (5400+ lines). Its 262K token context handles the whole file in one pass
and its code comprehension is strong enough to trace execution across modules.

Use **Claude Code** for recon when you're about to make an edit in the same session
— it needs to see the exact current state itself before writing a str_replace.

Never feed Kimi K2.6 terminal output directly into a Claude Code prompt without
Claude Chat reviewing and reformulating it first.

---

## Session Open Ritual (mandatory)

```bash
git log --oneline -5
git status
cat KNOWN-ISSUES.md        # check active issues before touching related code
```

Read CLAUDE.md if the session touches architecture or introduces a new pattern.

---

## Session Close Ritual (mandatory)

```bash
git log --oneline -3       # confirm commits landed
git status                 # confirm nothing unstaged
```

Then, in order:

1. **KNOWN-ISSUES.md** — add any new bug found; move fixed issues to Resolved table
2. **docs/imweb-obsidian.md** — add session log entry (date, version, what changed)
3. **Antigravity CLI** — update CHANGELOG.md from the session commits
4. **Antigravity CLI** — update docs/ImWeb_Quick_Reference.md if any source, effect, shortcut, or key binding changed
5. **Todo.md** — cross off completed items, add anything deferred

---

## Standard Prompt Template

```
EXECUTOR: Claude Code

BEFORE:
  git log --oneline -5
  git status
  Read: src/[file].js  (full file, or lines N–M if large)

TASK:
  [One precise thing. Never two things in one prompt.]
  Use str_replace only. Do not rewrite the file.
  Do not touch: [list every file that must not change]

ACCEPTANCE:
  [What correct looks like — no console errors, specific visual, specific output]

REVIEW:
  Once ACCEPTANCE is met, run /codex:review on modified files.
  Integrate critical security/syntax fixes. Ignore style suggestions.

AFTER:
  git add [exact files changed — no wildcards]
  git commit -m "type(scope): description"
  git push
```

The **Do not touch** list is not optional. Naming files Claude Code must not
touch prevents scope creep during complex sessions.

One feature per prompt is a hard rule. If a task feels like it needs two
prompts, it does.

---

## Recon Pattern

Before any surgical edit, verify the exact target block in the actual file.

```bash
# 1. Find the thing
grep -n "thing you're looking for" src/file.js | head -20

# 2. Confirm file length (stale line numbers are a common failure mode)
wc -l src/file.js

# 3. Read the exact block
sed -n '${start},${end}p' src/file.js
```

Never guess a variable name or reference. One wrong name (`this.sm` vs
`this.extras.scene3d` vs `sceneManager`) costs an entire session loop.

---

## Verification Boundary

```
Claude Code edits
  → verdict: DOM / console / localStorage checks (headless Chromium)
  → human: visual confirmation in real Chrome on macOS (Metal backend)
  → Claude Chat: diagnosis from screenshots/logs → next patch plan
  → update KNOWN-ISSUES.md if diagnosis reveals a new issue
```

verdict-cli runs headless Chromium. It **cannot** verify WebGL rendering,
shader output, 3D geometry, or Hypercube edges. All visual confirmation
requires a human in real Chrome on macOS.

---

## New Module Session Architecture

**Session 1 — Create new files only**
- Create new `.js` files in their target directory
- Maximum 2 surgical str_replace edits to one existing file (e.g. SceneManager.js)
- Do not touch main.js or UI.js
- Commit: `feat(scope): add [module name]`

**Session 2 — Wire into main.js**
- One import, one init call, one UI tab or panel mount
- ParameterSystem registrations for the new module
- Commit: `feat(ui): wire [module name] panel and params`

**Session 3 — Polish (if needed)**
- Preset save/load schema additions
- CSS/layout, edge cases, error handling
- Commit: `fix(scope): [specific issue]`

Each session is a clean rollback point if the next one breaks something.

---

## Debugging Flow

```
Claude Code: fails or regresses
  → Kimi K2.6: trace execution, find root cause across files
  → Claude Chat: re-plan the fix with full context
  → Claude Code: execute fix + /codex:review
```

For GPU/WebGL-specific failures: patch → human browser test → revert if wrong.
Do not stack a new patch on a broken fix. git revert to last clean commit, then retry.

---

## Conventional Commit Reference

```
feat(scope):     new feature
fix(scope):      bug fix
refactor(scope): restructure without behaviour change
style(scope):    CSS / visual only
docs:            README, CHANGELOG, CLAUDE.md, GEMINI.md, docs/
chore:           build, deps, config
```

Scope examples: `ui`, `scene3d`, `shaders`, `midi`, `preset`, `inputs`, `hypercube`

---

## The Core Discipline

1. Chat never writes code directly into the repo
2. Claude Code never scopes its own tasks — it receives a pre-written prompt
3. Claude Code runs /codex:review before committing core logic
4. Kimi K2.6 never edits — find and report only
5. Antigravity never touches JS
6. No session starts without `git log` + `git status` + `KNOWN-ISSUES.md`
7. No session ends without CHANGELOG, Quick Reference, and imweb-obsidian.md sync
