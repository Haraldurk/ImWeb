**Chromium bug:** https://issues.chromium.org/issues/513611558 (filed 2026-05-16)
**Status:** Active — Chromium team investigating. hopefully fixed in Cromes next version

**Defer to next Claude Code session:**

- GitHub cleanup (personal .imweb files, junk folders)
- public/docs/ deduplication
- Teletext full documentation

TASK for claude code: remove public/docs/ duplication
- Check how vite.config.js serves static assets
- Either alias /docs → docs/ in Vite config
- Or update in-app links to point to GitHub URLs
- Then: rm -r public/docs/
- Do not touch: docs/, public/assets/

Cleaning up the MasterProject.imweb that starts up with new project.  MasterProject.imweb is not always starting up in the beginning?  with Restore MasterProject? 

All current banks, states, and tables will be permanently replaced with the factory MasterProject defaults.  
  
**This cannot be undone.**

- ~~Redesign the Noise~~ — Phase 1 done: family→type selector
- ~~Noise: scale from center (shader fix)~~
- Noise Phase 2: psrdnoise / Periodic family
