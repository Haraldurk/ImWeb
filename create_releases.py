#!/usr/bin/env python3
"""Create GitHub releases for ImWeb from CHANGELOG.md.
Run from the repo root: python3 create_releases.py
Dry run (no releases created): python3 create_releases.py --dry-run
"""

import re
import subprocess
import sys

CHANGELOG = "CHANGELOG.md"

# (changelog_key, tag, prerelease, latest)
RELEASES = [
    ("0.1.0",  "v0.1.0",        True,  False),
    ("0.2.0",  "v0.2.0",        True,  False),
    ("0.3.0",  "v0.3.0",        True,  False),
    (None,     "v0.3.0-stable", True,  False),
    ("0.4.0",  "v0.4.0",        False, False),
    ("0.4.2",  "v0.4.2",        False, False),
    ("0.5.0",  "v0.5.0",        False, False),
    ("0.5.1",  "v0.5.1",        False, False),
    ("0.6.0",  "v0.6.0",        False, False),
    ("0.6.1",  "v0.6.1",        False, False),
    ("0.7.0",  "v0.7.0",        False, False),
    ("0.8.0",  "v0.8.0",        False, False),
    ("0.8.1",  "v0.8.1",        False, False),
    ("0.8.2",  "v0.8.2",        False, False),
    ("0.8.3",  "v0.8.3",        False, False),
    ("0.8.5",  "v0.8.5",        False, True),
]

STABLE_NOTE = (
    "Stable checkpoint of v0.3.0. "
    "Full Phase 3 features, BFG noise system, and second screen output."
)


def parse_changelog(path):
    with open(path) as f:
        content = f.read()

    sections = {}
    pattern = re.compile(r'^## \[([^\]]+)\]', re.MULTILINE)
    matches = list(pattern.finditer(content))

    for i, match in enumerate(matches):
        version = match.group(1)
        if version.lower() == "unreleased":
            continue
        start = match.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(content)
        notes = content[start:end].strip()
        notes = re.sub(r'\n---\s*$', '', notes).strip()
        sections[version] = notes

    return sections


def run(cmd, dry_run=False):
    print(f"  $ {' '.join(repr(c) if ' ' in c else c for c in cmd)}")
    if dry_run:
        return True
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"  ERROR: {result.stderr.strip()}")
        return False
    out = result.stdout.strip()
    if out:
        print(f"  {out[:120]}")
    return True


def main():
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        print("=== DRY RUN — no releases will be created ===\n")

    changelog = parse_changelog(CHANGELOG)
    print(f"Parsed {len(changelog)} versions from CHANGELOG.md")
    print(f"Found: {', '.join(changelog.keys())}\n")

    errors = []

    for (cl_key, tag, prerelease, latest) in RELEASES:
        label = "(pre-release)" if prerelease else "(Beta)"
        title = f"ImWeb {tag}" if prerelease else f"ImWeb {tag} (Beta)"
        print(f"→ {tag}  {label}")

        # Get notes
        if cl_key is None:
            notes = STABLE_NOTE
        elif cl_key in changelog:
            notes = changelog[cl_key]
        else:
            print(f"  WARNING: no changelog entry for [{cl_key}] — using placeholder")
            notes = f"See CHANGELOG.md for full details."

        cmd = ["gh", "release", "create", tag,
               "--title", title,
               "--notes", notes]

        if prerelease:
            cmd.append("--prerelease")
        if latest:
            cmd.append("--latest")

        ok = run(cmd, dry_run)
        if not ok:
            errors.append(tag)

    print(f"\n{'DRY RUN complete' if dry_run else 'Done'}.")
    if errors:
        print(f"Failed: {', '.join(errors)}")
    else:
        print("All releases created successfully." if not dry_run else "Run without --dry-run to create releases.")


if __name__ == "__main__":
    main()
