---
name: new-source
description: Append a new source to SOURCE_DEFS correctly — both resolvers, the capture-base slide, the consumption fixpoint, key-mapped menus, UI visibility, docs. Use when adding any new routable source to ImWeb.
---

# Adding a source to ImWeb

Appending to `SOURCE_DEFS` is the most dangerous routine change in this codebase,
because every way it goes wrong produces **a plausible-looking picture** rather
than an error. Work the steps in order. Do not skip step 8.

## 0. Understand what "append-only" does and does not protect

`SOURCE_DEFS` in `src/controls/ParameterSystem.js` is the single canonical list.
SELECT values persist as integer indices into it, so:

- **Append at the true end. Never insert, never reorder, never delete.**
- Append-only protects *this* list's indices. It does **not** protect indices in
  arrays built by appending something *after* it — see step 3.

## 1. Append the entry

Add `{ key: "yourkey", label: "Your Label" }` at the end of `SOURCE_DEFS`.
`SOURCES` (labels) and `SOURCE_KEYS` derive from it automatically. Never
hand-copy the list — six drifted copies once existed.

## 2. Wire BOTH resolvers

There are two, and each has a fall-through that renders something believable:

| Resolver | File | Used by | Falls through to |
|---|---|---|---|
| `_resolveSource()` | `src/core/Pipeline.js` | layers `fg`/`bg`/`ds`, mix buses | `inputs.color` |
| `_resolveLayerTex()` | `src/main.js` | `sdf.texSrc`, `td.mapSource`, `rutt.source`, slitscan, vwarp, particle luma, Analog, 3D texsrc | Output |

Wiring only the second is the Rutt-Etra bug: the audit read a clean 30/30 while
routing the source to Foreground painted a flat red frame. Take the expression
for the primary resolver from the inputs bag in the render loop so the two agree.

If the source genuinely has no texture, **name it and return null explicitly** —
a silent fall-through is indistinguishable from a working selection.

## 3. Handle the capture-base slide

`CAPTURE_SOURCES` appends "FG Src / BG Src / DS Src" *after* the source list, at
`CAPTURE_INDIRECT_BASE = SOURCES.length`. Appending one source slides that
indirect tail up by one, so every saved `td.captureSource`, `td.mapSource`,
`slitscan.source`, `vwarp.source`, `delay.source` holding an old tail index
silently re-reads as the **new** source.

The machinery already exists — `migrateCaptureBase`, `migrateStatesCaptureBase`,
`LEGACY_CAPTURE_BASE`. Your job is to confirm it stays wired:

- every write path stamps `sourceCount: CAPTURE_INDIRECT_BASE`
  (`Preset.serialize/exportBank/exportState`, `ProjectFile._collect`)
- every load path migrates
  (`Preset.deserialize`, `Preset.importBank`, `PresetManager.importState`,
  `ProjectFile._apply`)

`tests/audit-capture-base.mjs` was written *before* the first append while the
transform was still identity, precisely so it fails loudly the day you make it
real. If it fails now, that is the test doing its job — fix the wiring, do not
weaken the test.

## 4. Extend the consumption fixpoint

`_srcUsed(i)` in `src/main.js`. A source is used by a layer, by
`td.captureSource`, or by a live mix input; a bus is needed if any needed bus
reads it, transitively in both directions. **Extend that function** — do not
copy the pattern, which is how seven near-duplicates accrued.

## 5. Map short menus by KEY, never by number

Any param with its own short option menu that maps into `SOURCE_DEFS` must map
via `SOURCE_KEYS.indexOf('yourkey')`. A literal array of bare numbers drifts
silently under an append: `_sdfSrcToLayerIdx` once mapped "Draw"→3D Scene,
"3D"→Noise, "Noise"→Color2 and read as an effect bug, not a routing bug. Both
SDF source menus are in scope.

## 6. Give it visible UI

Phase 24 rule: **routable source ⇒ visible UI.** A source reachable from a
dropdown but with no panel is a trap. Section labels and order live in
`index.html`; `buildMappingPanels()` is a container-id → params map with no
labels, so regrouping needs no JS change if container ids are preserved.

## 7. Check the family it is joining

A new entry inherits an unwritten spec from its neighbours. Measure the family
before adding to it — bounding radius, value range, units. Five SDF shapes once
shipped at radii 0.64–unbounded against a family sitting between 0.50 and 0.73,
and two were wrong in *kind*, not degree.

## 8. Verify

```bash
npm test
```

All four audits must pass: source resolution (both resolvers), capture base,
panel coverage, SDF migration.

Then update the param table in `docs/ImWeb_Full_Manual.md` and, if the source is
performance-relevant, `docs/ImWeb_Quick_Reference.md` — followed by
`npm run sync-docs`, which is what actually ships docs into the app.

Finally, add a `CHANGELOG.md` entry.

## 9. If something broke that no audit caught

That is a new invariant. Use the `new-audit` skill to make it permanent.
