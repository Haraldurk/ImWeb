# WORKFLOW.md — ImWeb Development Workflow

Canonical multi-agent workflow, per the CLAUDE.md document hierarchy.
Sessions vary in shape — **the Invariants below apply to every session;
pick the Playbook that matches how this session is actually run.**
Update this file only in an owner-declared consolidation session.

---

## Invariants (every session, any shape)

### 1. Session open
```bash
git log --oneline -5
git status
cat KNOWN-ISSUES.md        # active issues — read before touching related code
cat docs/LEARNED.md        # lessons — wins over CLAUDE.md on conflict
```

### 2. Recon before any edit
```bash
grep -n "thing you're looking for" src/file.js | head -20
wc -l src/file.js          # stale line numbers are a common failure mode
sed -n '${start},${end}p' src/file.js
```
Never guess a variable name or reference. One wrong name (`this.sm` vs
`this.extras.scene3d` vs `sceneManager`) costs an entire session loop.

### 3. One task per prompt, one agent per task
If a task feels like it needs two prompts, it does. Split it.
Do not duplicate work across agents.

### 4. Never stack a patch on a broken fix
If a fix fails: `git revert` to the last clean commit, then retry from a
clean slate.

### 5. Session close
```bash
git log --oneline -3       # confirm commits landed
git status                 # confirm nothing unstaged
```
- New bug found → add to KNOWN-ISSUES.md Active
- Bug fixed → move to KNOWN-ISSUES.md Resolved table (version + commit)
- Owner correction or self-caught mistake → one line appended to docs/LEARNED.md

### 6. Verification boundary
```
edits → verdict: DOM / console / localStorage checks (headless Chromium)
      → human: visual confirmation in real Chrome on macOS (Metal backend)
      → diagnosis from screenshots/logs → next patch
      → update KNOWN-ISSUES.md if diagnosis reveals a new issue
```
verdict-cli **cannot** verify WebGL rendering, shader output, 3D geometry,
or Hypercube edges. Headless limits learned the hard way: no H.264 decode
(movie textures are black), setTimeout throttled to ~0.6–1 s observed
(use busy-waits for gesture timing), rAF at ~1 fps.
**Always kill leftover `chrome-headless-shell` processes after a
verification batch** — leaked instances burn ~9 CPU cores and masquerade
as ImWeb performance bugs.

Browser-automation checks in real Chrome have their own trap: an occluded
or backgrounded tab freezes rAF entirely, which halts the render loop AND
all controller ticks (LFO/Random/etc.) — sweep tests silently show nothing
while the code is fine. Check the app's FPS readout first; 0 fps means the
tab isn't really visible. Also: controller assignment via the context menu
uses blocking `prompt()` dialogs for most types — **Random** is the one
type assignable without a prompt, so use it for automated controller tests.

### 6b. Techniques that earned their keep (Phase 23)

**Prove behavioural equivalence by brute force, don't eyeball it.** Both
rewrites of the idle-deck upload gate were checked by enumerating every
combination of routing, capture source, mix mode, crossfade and legacy-reader
state in Node and diffing old logic against new — 270k then 359k combinations,
zero mismatches. A refactor that claims "no behaviour change" for existing
projects can be *proved*, in a few minutes, without a browser.

**Derive index-aligned lists; never hand-copy them.** Six copies of the 27-entry
source list existed and three had silently drifted, breaking TimeDisplace
capture and the AI Narrator for the newest sources. Lockstep comments did not
prevent it — only a single exported origin (`SOURCE_DEFS` →
`SOURCES`/`SOURCE_KEYS`) did. If two arrays must stay index-aligned, one of
them is a bug waiting to happen.

**Verify a decoupling by breaking the old coupling on purpose.** To confirm
auto-expand no longer depends on header text, the check was not "does it still
work" but "rename the header to something else and confirm it still works,
then move the marker to another tab and confirm it follows." Testing the
property, not the happy path.

**A missing element is not an error — it is a silent hole.** Two near-misses
this phase: `getElementById("tab-mapping")?.prepend(...)` would have made the
whole I/O block vanish without a console message when that tab was retired,
and removing the hardcoded `active` class left the control panel blank because
panes are `display:none` until something is marked. Optional chaining and
CSS-driven visibility both fail quietly. After moving or renaming a container,
assert the thing that fills it actually rendered.

**First paint vs. JS authority.** HTML may legitimately duplicate state that JS
owns, as a paint hint — the module graph takes a real interval to evaluate, and
anything gated on it is invisible until then (and forever if the module fails
to load). Mark such duplication as a hint in a comment rather than deleting it.

### 7. Port discipline
| Command | Protocol | Use for |
|---------|----------|---------|
| `npm run dev` | http :5173 | Desktop work; Dev Capture (:5174) reachable |
| `npm run dev:https` | https :5173 | iPad sessions — camera/mic/motion need a secure origin (mkcert cert in `certs/`, regenerate on IP change — command in vite.config.js) |

Only one can hold :5173 — kill the other first, or the second silently
takes the next port and the iPad tests the wrong build.

localStorage (GLSL user presets, AI keys/config) is **per-origin**, and a
different port is a different origin. Data saved on :5173 is invisible on
:5174 or a `vite preview` on :4173 — "my presets are gone" almost always
means "wrong port". Recovery/audit if genuinely needed: grep Chrome's
leveldb (`~/Library/Application Support/Google/Chrome/Default/Local
Storage/leveldb`) for the key — old segments retain deleted values.

---

## Playbook A — Solo Claude Code session

Owner works directly with Claude Code (a common session shape). Claude Code
scopes its own recon and edits, within the rules in CLAUDE.md.

1. Non-trivial work goes through plan mode — present a plan, get owner
   approval before editing.
2. Recon is self-scoped but budgeted: max 5–10 tool calls before producing
   code (per CLAUDE.md Editing Rules).
3. Surgical str_replace edits only; never rewrite whole files.
4. Run `/codex:review` before committing core logic (see Codex Review below).
5. Commit per task with conventional messages; move to the next task.

## Playbook B — Chat-orchestrated session

Claude Chat plans; Claude Code executes pre-written prompts. Use for
cross-file architecture work where the planner needs the whole-repo view.

### Tool roster

| Agent                 | Terminal   | Role                                                                             | Hard limits                                                                          |
| --------------------- | ---------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| **Claude Chat**       | claude.ai  | Architecture, planning, cross-file reasoning, CLAUDE.md review, Obsidian updates. Has read-only MCP access to ImWeb repo — reads source files, KNOWN-ISSUES.md, docs/, and src/ directly before every prompt. | Never writes code directly to repo. Never executes terminal commands.                |
| **Claude Code**       | Ghostty ⌘3 | Surgical JS/CSS edits, multi-file wiring, Pipeline/shader work, recon, git       | In this playbook, receives a pre-written prompt — does not scope its own tasks       |
| **Antigravity (Agy)** | Ghostty ⌘2 | CHANGELOG.md, Quick Reference, README, all markdown/docs                         | Never touches JS; never feeds raw terminal output back to Claude Code                |
| **Kimi K2.6**         | Ghostty ⌘1 | Recon, exploration, reading large files, cross-module tracing                    | Never edits. Find-only. Feed results to Claude Chat, not directly to Claude Code     |
| **DeepSeek v4-Pro**   | Ghostty ⌘4 | Shader math, GLSL logic, algorithmic deep-dives                                  | Never edits. Consult for hard shader/math problems; route output through Claude Chat |
| **Browser (you)**     | —          | Visual confirmation after every patch                                            | Only tool that can verify WebGL / Metal rendering                                    |

Use **Kimi K3** when investigation spans many files or requires reading
main.js in full (~6400 lines) — its 262K context handles the whole file in
one pass. Use **Claude Code** for recon when it's about to edit in the same
session — it must see the exact current state itself. Never feed Kimi
output directly into a Claude Code prompt without Claude Chat reviewing
and reformulating it first.

### Chat session open
1. Verify the `imweb-filesystem` MCP is live:
   `list src`
   If this fails, stop — reconnect before drafting any prompts.
2. Claude Chat reads KNOWN-ISSUES.md, docs/WORKFLOW.md, and relevant src/
   files directly via MCP — no copy-paste. Run `imweb-session-open` in any
   Ghostty tab and paste output only when git context is needed.
3. Read CLAUDE.md if the session touches architecture or a new pattern.

### Two-phase recon (both mandatory in this playbook)
- **Phase 1 — Chat recon**: Chat reads target files via MCP before drafting
  the prompt — eliminates wrong names, stale line numbers, bad assumptions.
- **Phase 2 — Claude Code recon**: always verify the exact target block in
  the live file before editing. HMR may have changed it since Chat read it.

### Prompt relay
Claude Chat writes the finished prompt with header `SAVE TO:
/tmp/imweb-next-prompt.txt`. Save it (`pbpaste > /tmp/imweb-next-prompt.txt`
or the `imweb-prompt` zsh function), review with `cat`, paste to Claude
Code. Variable names verified by Chat via MCP are exact — the file relay
eliminates transcription errors, the most common source of "wrong name
costs a whole session" failures.

### Standard prompt template
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
The **Do not touch** list is not optional — it prevents scope creep.

### Chat session close (in order)
1. KNOWN-ISSUES.md — new bugs added, fixed bugs moved to Resolved
2. docs/imweb-obsidian.md — session log entry (date, version, what changed)
3. Antigravity — update CHANGELOG.md from the session commits
4. Antigravity — update docs/ImWeb_Quick_Reference.md if any source,
   effect, shortcut, or key binding changed
5. Todo.md — cross off completed items, add anything deferred

## Playbook C — New module pattern (recommended, not mandatory)

Each session is a clean rollback point if the next one breaks something.

- **Session 1 — Create new files only**: new `.js` files in their target
  directory; max 2 surgical edits to one existing file (e.g. SceneManager.js);
  do not touch main.js or UI.js. Commit: `feat(scope): add [module name]`
- **Session 2 — Wire into main.js**: one import, one init call, one UI
  tab/panel mount; ParameterSystem registrations.
  Commit: `feat(ui): wire [module name] panel and params`
- **Session 3 — Polish (if needed)**: preset save/load schema, CSS/layout,
  edge cases. Commit: `fix(scope): [specific issue]`

## Playbook D — Debugging flow

Solo shape (default): Claude Code investigates directly — reproduce, grep,
trace, state one way the fix could still fail (Guard Logic Rules in
CLAUDE.md), fix, `/codex:review`, verify.

Orchestrated shape (when the bug spans many modules):
```
Claude Code: fails or regresses
  → Kimi K3: trace execution, find root cause across files
  → Claude Chat: re-plan the fix with full context
  → Claude Code: execute fix + /codex:review
```

For GPU/WebGL-specific failures: patch → human browser test → revert if
wrong. Never stack a new patch on a broken fix (Invariant 4).

---

## Codex Review (`/codex:review`, GPT-5.6)

Cross-model review — a different model family catches a different class of
bugs than the one that wrote the code. It is a cheap extra filter, **not
verification**: running the app, verdict checks, and human visual
confirmation outrank any static review.

- **Run it**: after any core logic change, before committing.
- **Skip it**: CSS-only changes, markdown edits.
- **Accept**: critical security or correctness/syntax fixes it flags.
- **Ignore**: style suggestions that conflict with existing paradigms.

---

## Doc-sync cadence

| When | Update |
|---|---|
| Every session | KNOWN-ISSUES.md, docs/LEARNED.md (if lessons), commits pushed |
| User-facing behavior changed | CHANGELOG.md (Antigravity in Playbook B) |
| Keys / sources / effects / shortcuts changed | docs/ImWeb_Quick_Reference.md, then `npm run sync-docs` |
| Release / milestone close | docs/imweb-obsidian.md session log, manuals, README badge |

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
