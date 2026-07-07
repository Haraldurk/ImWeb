# WORKFLOW.md — ImWeb Development Workflow

Single canonical reference. Supersedes all previous workflow docs.
Read before any session. Update when the workflow actually changes.

---

## The Tool Roster

| Agent                 | Terminal   | Role                                                                             | Hard limits                                                                          |
| --------------------- | ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Claude Chat**       | claude.ai  | Architecture, planning, cross-file reasoning, CLAUDE.md review, Obsidian updates. Has read-only MCP access to ImWeb repo — reads source files, KNOWN-ISSUES.md, docs/, and src/ directly before every prompt. | Never writes code directly to repo. Never executes terminal commands.                |
| **Claude Code**       | Ghostty ⌘3 | Surgical JS/CSS edits, multi-file wiring, Pipeline/shader work, recon, git       | Never scopes its own tasks — receives a pre-written prompt                           |
| **Antigravity (Agy)** | Ghostty ⌘2 | CHANGELOG.md, Quick Reference, README, all markdown/docs                         | Never touches JS; never feeds raw terminal output back to Claude Code                |
| **Kimi K2**           | Ghostty ⌘1 | Recon, exploration, reading large files, cross-module tracing                    | Never edits. Find-only. Feed results to Claude Chat, not directly to Claude Code     |
| **DeepSeek v4-Pro**   | Ghostty ⌘4 | Shader math, GLSL logic, algorithmic deep-dives                                  | Never edits. Consult for hard shader/math problems; route output through Claude Chat |
| **Browser (you)**     | —          | Visual confirmation after every patch                                            | Only tool that can verify WebGL / Metal rendering                                    |
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

**In Ghostty (⌘3 — Claude Code terminal):**
```bash
git log --oneline -5
git status
cat KNOWN-ISSUES.md        # check active issues before touching related code
```

**In Claude Chat (claude.ai):**

**1. Verify Filesystem Connection:**
Ensure the `imweb-filesystem` MCP is live and the planner has direct
repository access. Run the following check:
`list /Users/haraldurkarlsson/Documents/GitHub/ImWeb/src`
> **CRITICAL:** If this command fails, stop immediately. Reconnect the
> filesystem integration before drafting any prompts or planning any fixes.

Claude Chat reads KNOWN-ISSUES.md, docs/WORKFLOW.md, and relevant src/ files
directly via the read-only filesystem MCP — no copy-paste required.
Run `imweb-session-open` in any Ghostty tab and paste the output into Claude Chat
only when git log / git status context is needed for planning.

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

## Prompt Relay

Claude Chat writes the finished Claude Code prompt to `/tmp/imweb-next-prompt.txt`.
Claude Code reads it from there. No manual transcription.

**Workflow:**
1. Claude Chat plans the task and drafts the full prompt (with all variable names
   verified via MCP recon)
2. Claude Chat outputs the prompt with header: `SAVE TO: /tmp/imweb-next-prompt.txt`
3. You save it: `pbpaste > /tmp/imweb-next-prompt.txt` — or use the `imweb-prompt`
   shell function in ~/.zshrc
4. In Ghostty ⌘3: `cat /tmp/imweb-next-prompt.txt` — review, then paste to Claude Code

**Why this matters:**
Variable names verified by Chat via MCP are exact. Transcription errors are the
most common source of "wrong name costs a whole session" failures. The file relay
eliminates that failure mode.

---

## Recon Pattern

Two distinct recon phases. Both are mandatory. Neither replaces the other.

**Phase 1 — Claude Chat recon (before writing any prompt)**
Claude Chat reads relevant files via the filesystem MCP before drafting a Claude Code
prompt. This eliminates wrong variable names, stale line numbers, and bad assumptions
from prompts before they reach Claude Code.

What Chat reads: KNOWN-ISSUES.md, the target .js file (or the relevant section),
ParameterSystem registrations, and any related module the task touches.

**Phase 2 — Claude Code recon (before any str_replace edit)**
Claude Code always verifies the exact target block in the live file before editing.
It cannot rely on Chat's reading — HMR may have changed the file.

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
requires a human in real Chrome on macOS. Additional headless limits
learned the hard way: no H.264 decode (movie textures are black),
setTimeout throttled to ~600 ms (use busy-waits for gesture timing),
rAF at ~1 fps. **Always kill leftover `chrome-headless-shell` processes
after a verification batch** — leaked instances burn ~9 CPU cores and
masquerade as ImWeb performance bugs.

### Dev servers

| Command | Protocol | Use for |
|---------|----------|---------|
| `npm run dev` | http :5173 | Desktop work; Dev Capture (:5174) reachable |
| `npm run dev:https` | https :5173 | iPad sessions — camera/mic/motion need a secure origin (mkcert cert in `certs/`, regenerate on IP change — command in vite.config.js) |

Only one can hold :5173 — kill the other first, or the second silently
takes the next port and the iPad tests the wrong build.

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
6. No session starts without `git log` + `git status` (Claude Code); Claude Chat
   reads KNOWN-ISSUES.md directly via MCP before drafting any prompt
7. No session ends without CHANGELOG, Quick Reference, and imweb-obsidian.md sync
