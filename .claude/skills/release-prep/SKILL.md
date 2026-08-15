---
name: release-prep
description: Cut an ImWeb release — CHANGELOG, RELEASE_NOTES, version bump, README, tag and GitHub publish. Use when shipping a new version. CI runs the tests but never publishes; the release itself is hand-published.
disable-model-invocation: true
---

# Cutting an ImWeb release

**CI runs `npm test` and mutation calibration on PRs (since #58), but it does
not publish anything.** Every step below is manual, and several are easy to get
wrong in ways only visible after publishing — a tag with no Release object, a
README anchor pointing at a heading that no longer exists, a lockfile left two
versions behind. Where a step can be enforced it now is, and the audit that
enforces it is named at that step; the rest is on whoever runs this.

## 0. What is actually unreleased

```bash
git describe --tags --abbrev=0
git log --oneline $(git describe --tags --abbrev=0)..HEAD
grep -n '^## \[' CHANGELOG.md | head -5
```

Read the commit *bodies*, not just the subjects — this project writes the
reasoning into them, and that reasoning is what the CHANGELOG entry should say:

```bash
git log $(git describe --tags --abbrev=0)..HEAD --format='── %h %s%n%b' | head -200
```

**Check what the CHANGELOG already covers before writing anything.** Entries are
often written as the work lands, so the job is usually filling gaps and releasing
the header — not writing from scratch. Grep the `[Unreleased]` block for each
phase name; a phase with zero hits is a real gap.

## 1. CHANGELOG.md

- One `##` block per phase, newest first. **A version may have several blocks** —
  v0.13.0 has three. Format:
  `## [0.15.0] — 2026-08-02 — The Scan Processor (Phase 26)`
- Open each with an italic framing paragraph saying what was wrong before, then
  `### Added` / `### Changed` / `### Fixed`.
- Release the header: `## [Unreleased] — …` becomes `## [0.15.0] — <date> — …`.
- Verify every parameter id you cite actually exists — enumerate the live
  registry rather than trusting the prose:

```js
import { ParameterSystem, registerCoreParameters } from './src/controls/ParameterSystem.js';
const ps = new ParameterSystem(); registerCoreParameters(ps);
// then check each `id` cited in the new block against ps.params
```

> There is a pre-existing `## [Unreleased] — Noise System Overhaul (D1)` further
> down the file. It is historical. Leave it.

## 2. RELEASE_NOTES.md

**This file holds the latest release ONLY, and must end up byte-identical to the
body published on GitHub.** It is not a copy of the CHANGELOG — it is a curated
highlight reel, roughly 90–100 lines, in the same voice.

Shape:

```markdown
# ImWeb v0.15.0 — <Title>

*Released YYYY-MM-DD*

<framing paragraph: what was missing, why it matters>

## <Headline feature>
## <Second feature>
## Also fixed
## Under the hood

---

Design doc: `docs/<Blueprint>.md`. Full detail in
[CHANGELOG.md](https://github.com/imweb-project/ImWeb/blob/main/CHANGELOG.md).
```

## 3. Version bump

```bash
npm version <x.y.z> --no-git-tag-version
```

`--no-git-tag-version` matters: the tag is created in step 5, after the commit,
so it points at the release commit rather than the one before it. This updates
`package.json` **and** `package-lock.json` — both must move together.

**Use the command; do not hand-edit the version.** This is the whole reason the
step is written as a command rather than "set the version to x.y.z". Editing
`package.json` directly — with an editor, a script, a find-and-replace — updates
one file and silently leaves the lockfile behind, and nothing about the result
looks wrong: the build works, `npm ci` works, the release publishes. The lockfile
sat at 0.19.0 through **both** the v0.20.0 and v0.21.0 releases that way, found
only by accident while cleaning up an unrelated change.

`audit-sw-cache-bump.mjs` now enforces it, so a hand-edited bump fails `npm test`
rather than shipping. If you find them already out of step:

```bash
npm install --package-lock-only    # syncs the version, touches no dependency
```

## 4. README — three places move, two do not

| Line | Change |
|---|---|
| Version badge | `badge/version-vX.Y.Z-brightgreen` |
| `## Features (vX.Y.Z)` heading | new version |
| `Phases 1–N complete, through vX.Y.Z.` + roadmap list | new version, add shipped items |

**Do not touch historical version references.** "As of v0.14.0 this writes
faststart MP4s" is a statement about when something changed and stays true
forever. Grep and read each hit before editing:

```bash
grep -n 'v0\.[0-9]*\.[0-9]*' README.md
```

## 5. Verify, commit, tag

```bash
npm test          # all invariant audits must pass
npm run build     # the INEFFECTIVE_DYNAMIC_IMPORT warning is expected
npm run sync-docs # only if the manual changed — public/docs is what ships in-app
```

Stage explicitly. **Never `git add -A`** — the `!public/**` negation in
`.gitignore` has let a user bank save into a commit before, and this repo is
public. `tests/audit-gitignore-banks.mjs` guards the rule, but staging by name
guards the moment.

```bash
git add CHANGELOG.md RELEASE_NOTES.md README.md package.json package-lock.json
git commit -m "release: vX.Y.Z — <title>"
git tag -a vX.Y.Z -m "vX.Y.Z — <title>"
git push origin main --follow-tags
```

## 6. Publish

The body **must match RELEASE_NOTES.md exactly** — pass the file, never retype it:

```bash
gh release create vX.Y.Z --title "vX.Y.Z — <title>" --notes-file RELEASE_NOTES.md
```

Then confirm what actually went out:

```bash
gh release view vX.Y.Z --json name,tagName,isDraft --jq '.name, .tagName, .isDraft'
```

**GitHub appends a trailing newline to the body**, so a raw `diff` against
RELEASE_NOTES.md always reports a difference of exactly one byte and one line.
That is normalisation, not a content mismatch — do not chase it. Compare with
trailing blank lines stripped from both sides:

```bash
gh release view vX.Y.Z --json body --jq .body | sed 's/\r$//' > /tmp/pub.md
diff <(sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba' /tmp/pub.md) \
     <(sed -e :a -e '/^\n*$/{$d;N;};/\n$/ba' RELEASE_NOTES.md) \
  && echo "content identical"
```

A difference of more than one byte IS real: either the body was retyped instead
of passed with `--notes-file`, or one side was edited after publishing. Fix it
from the file, never by hand:

```bash
gh release edit vX.Y.Z --notes-file RELEASE_NOTES.md
```

## 7. After

- The live site at imweb.image-ine.org is **Tom's deploy, not this repo** —
  publishing here does not update it.
- Move any roadmap item you shipped out of "Still open" in the README.
- If the release surfaced a lesson, append it to `docs/LEARNED.md` per the
  `imweb-debugging` skill.
