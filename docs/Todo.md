**Chromium bug:** https://issues.chromium.org/issues/513611558 (filed 2026-05-16)
**Status:** Active — Chromium team investigating. hopefully fixed in Cromes next version. It is fixed.

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
- ~~Noise Phase 2: psrdnoise / Periodic family~~
- ~~PsrdWarp~~
  * Note: tearing fixed; phase jump fixed; organic non-periodic mode
    restored. Remaining: period tile-count semantics, gradient
    discontinuity seams at small period with Gain > 0 (deferred).

**PSRDnoise extensions — next session:**
- [x] Swirl parameter — blend gradient warp ↔ perpendicular curl warp
      (uSwirl=0: billowing clouds, uSwirl=1: vortex/cyclone). One
      uniform, one line: mix(gsum, vec2(-gsum.y, gsum.x), uSwirl)
- [x] Ridge mode — abs() on noise accumulation for turbulent ridge
      and tendril patterns
- [ ] Period-as-tile-count redesign — pass uScale/uPeriod to psrdnoise
      so range 0–8 is always visually meaningful regardless of Scale
- [ ] Investigate Period slider even-only display — step:1 confirmed
      in ParameterSystem; check DOM range input step attribute after
      hard refresh (Cmd+Shift+R)
- [ ] Speed range -10..10 — confirm ParameterSystem change landed
- [x] FIX FIRST: 3D objects still appear gray by default
- [ ] Textured 3D objects darker than 2D pipeline — see KNOWN-ISSUES.md
- [ ] 3D procedural noise on mesh — psrdnoise3D injected into material
  shader using object-space position (future enhancement)


