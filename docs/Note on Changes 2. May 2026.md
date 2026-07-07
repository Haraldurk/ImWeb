
readme.md Updates: 
Signal-Path:
## Features
### Input Sources etc.

## Keyboard Reference

## Architecture
## Roadmap

Changelog.htm ?

Claude.md  Lets discuss and  change the : ## What this project is 

[](https://github.com/imweb-project/ImWeb/blob/main/CLAUDE.md#what-this-project-is)

**ImWeb** is a browser-based real-time video synthesis instrument — a ground-up reimagining of Tom Demeyer and Steina Vasulka's _Image/ine_ (STEIM Amsterdam, 1997/2008) in the modern browser.

ImWeb is **not a faithful recreation or reimplementation**. It is a new instrument with deep roots. Haraldur Karlsson learned Image/ine from the beginning, taught it for years, and used it extensively in installation art and live performance. He has also absorbed years of practice with tools like Max/MSP, Jitter, and others. Everything learned from those instruments is being brought into ImWeb. It will never be the same as Image/ine — it is where Image/ine's lineage goes next.

The instrument composites video sources through a signal chain of effects and renders to a WebGL canvas. Every visual parameter is mappable to a controller (MIDI, LFO, audio, mouse, key, random, expression). The interface is also the performance — no edit/perform mode split.




There are so many files and folders on [g](https://github.com/imweb-project/ImWeb) GitHub online. What are the strictly necessary file and folders needed there? I belive files have been uploaded that should not been uploaded. 

**Should NOT be in the repo root:**

Personal project/state files:

- `Ha.imweb`, `Halli_project_1.imweb`, `Haraldur.imweb`, `Haraldur (1).imweb`
- `SDF Metaballs.imweb`, `SDF Metaballs (1).imweb`, `SDF Metaballs (2).imweb`
- `Fly-inn.imstate`, `StatexportTest.imstate`

Folders that look like they shouldn't be tracked:

- `Brainstorms/` — internal notes
- `CHANGELOG_files/`, `Haraldur.imweb_files/`, `ImWeb ha_files/`, `ImWeb_files/`, `ImWebha_files/` — these look like auto-generated HTML export artifacts
- `Recordings/` — likely large video files
- `_imweb_ready/` — test clips, large files

Internal planning docs:

- `MEMORY-REDESIGN.md`, `PERF-SPRINT.md`, `deepseek.md`, `AGENTS.md`

Dev scripts (borderline — keep locally, not necessarily public):

- `dev-catcher.js`, `make_seamless.sh`, `process-ideas.sh`, `create_releases.py`

---

**Should stay:** `.github/`, `assets/`, `docs/`, `public/`, `src/`, `.gitignore`, `CHANGELOG.md`, `CLAUDE.md`, `CONTRIBUTING.md`, `CREDITS.md`, `GEMINI.md`, `LICENSE`, `README.md`, `index.html`, `package.json`, `package-lock.json`, `vite.config.js`, `imweb-prep.js`

---
 remove and update `.gitignore` so these don't creep back in.

**Next session plan**

**Task 1 — GitHub review** Open `github.com/imweb-project/ImWeb` in Brave. Read README, check all visible files (CONTRIBUTING.md, CHANGELOG.md, CLAUDE.md, LICENSE). Note anything wrong or missing. This is eyes-only — no tools needed, just a notepad or Obsidian note.

**Task 2 — Obsidian update** Before opening Claude Code, open your Til Minnis vault and find the ImWeb note. Then hand it to **Gemini CLI** — it's your designated CHANGELOG/docs handler. Starting prompt:

> Here is my current ImWeb Obsidian note. Here is CHANGELOG.md from the repo. Update the Obsidian note to reflect all changes from v0.5 to v0.8.5. Keep my voice and structure.

**Task 3 — Project folder cleanup** Use **Claude Code in Ghostty**. Starting prompt:

> Recon only. List all files in ~/Documents/GitHub/ImWeb that are not tracked by git or are in .gitignore. Do not delete anything yet. Report only.

Then decide what to remove based on the list.

---

**Files to have ready at session start**

- Your current Obsidian ImWeb note (export as .md)
- CHANGELOG.md from the repo
- A fresh `git status` output