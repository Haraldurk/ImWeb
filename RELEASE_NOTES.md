# ImWeb v0.14.0 — The Movie Library

*Released 2026-07-29*

Movies had no home. There was a list of clips inside Deck A, a second deck with
the same list and no way to see it, and a recorder confusingly named "Clip
Library". Now there is one **Movie Library** — everything you have, unlimited,
thumbnails loading as you scroll — and two decks that load from it.

## The Movie Library

- **Movie Library panel** (Sources ▸ Media) — every clip that exists, with
  thumbnail, duration, origin badge, a filter box, and `→A` / `→B` to load. It
  holds *descriptors*, not players, so its size is unlimited; duration and
  thumbnail are read only when a row scrolls into view.
- **Drag a Library row onto the Movie A or Movie B panel** to rack it. The whole
  panel is the target, because an empty Deck B renders no list to aim at.
- **Deck B finally has a rack UI.** It always had the 8-clip array, just nothing
  to show it — both decks now render through one code path.
- **`Option+1-8`** selects on Deck B's rack, mirroring `Shift+1-8` on Deck A.
- **A full rack evicts its oldest clip** instead of refusing, so loading never
  interrupts a set — and never the clip that is *playing*, which would drop the
  live output at the worst possible moment.
- **`✕` on a Library row** removes the catalogue entry; a racked clip keeps
  playing and nothing on disk is touched. That is the mirror of Clear, which
  unloads a rack without deleting entries. Adding a movie says "this exists";
  clearing a rack says "unload these".
- **Detached, the Library fills its window.** Its list was capped at 240px, so a
  floating panel showed about six rows however large you made it.

## Two long-standing media bugs died with it

- **`imweb-prep.js` now writes faststart MP4s.** Without `-movflags +faststart`
  the `moov` atom lands at the *end* of the file, so a browser cannot report a
  duration until it has read to EOF — seconds on a 237 MB All-Intra clip, or
  never under load. This is why the movie rack had always hung on its eighth
  clip.

  > **Clips prepped before this release need a one-off lossless remux.** No
  > re-encode, no quality loss — see the manual for the command.

- **Only the clip being played buffers ahead.** A rack is bounded by *bytes*, not
  slots: `preload='auto'` on every racked clip spends the media budget (~837 MB
  on this machine) on clips nobody is watching, and the clip you switch to then
  holds its first frame forever. Loading now uses `preload='metadata'`, and
  selecting a clip promotes the incoming one and demotes the outgoing one.

## Also fixed

- **Removing a clip kept the playhead on its own clip.** The current index was
  only corrected when the playhead ran off the end of the array, so removing any
  clip *below* it silently switched the output to a different movie.
- **Routing a layer to a movie deck switches that deck on.** Both decks are
  forced off at launch so a project never starts blasting video, but Deck B's
  toggle is buried in its panel — selecting Movie B as a Background showed
  nothing, with no visible cause.
- **`q`/`a`/`z` cycle layer sources in the LAYERS dropdown's order** rather than
  raw index order. Presentation only — the stored value is still the true source
  index.
- **The clip list appears as clips load**, instead of after the whole manifest
  finishes; one stalled file no longer hides every clip behind it.
- **Percent-encoded clip names are decoded** — a file with a space showed as
  `mirror%20clip`.
- **The startup console banner reads the real version**, having announced v0.6.0
  through seven releases.

## Project import no longer destroys banks

Import pruned every bank in the database whose index the incoming file did not
claim — no prompt, no undo — and it sat behind three call sites, including a
drag-dropped project. The local MasterProject went from six banks to two before
anyone noticed.

- **The prune is gone.** Import merges: banks already in the store are left
  alone, and the project's own banks are written alongside them.
- **Nor does it silently overwrite them.** Banks are keyed by index, so deletion
  was only half the blast radius — an incoming bank at index 8 destroyed a local
  bank 8 just as thoroughly. A colliding incoming bank is now **reindexed** to
  the lowest free slot, and the active bank follows the reindexing.
- **Destructive import is now opt-in**, used only by "Restore MasterProject",
  which already warns that the action cannot be undone, and by the first-ever
  launch, where the store is empty.
- **Loading the same project twice now duplicates its banks** rather than
  replacing them. That is the deliberate trade: duplicate banks can be deleted,
  deleted banks cannot be recovered.

---

Design doc: `docs/ImWeb-MovieLibrary-Blueprint.md`. Full detail in
[CHANGELOG.md](https://github.com/imweb-project/ImWeb/blob/main/CHANGELOG.md).
