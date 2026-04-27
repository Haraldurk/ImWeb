# ImWeb Memory System Redesign — Spec v1.1
*Authored: 2026-04-19 | Updated: 2026-04-19 | Status: Ready for implementation*

---

## 1. Conceptual Model

Three levels, strictly nested:

```
Project  (.imweb file)
  └── Bank  (named group; holds controller assignments + its States)
       └── State  (parameter value snapshot + fx order + thumbnail)
```

**Project** — everything. One .imweb file = one project. A new project ships with one
default Bank ("Bank 1") and no States (States are created by the user as they work).

**Bank** — a named performance patch. Controller assignments (LFO, MIDI, Random, etc.)
belong to the Bank — they are loaded when you switch Banks. A Bank holds up to 32 States.
Banks are numbered 1–N and can be renamed. Default name: "Bank 1", "Bank 2", etc.

**State** — a frozen snapshot of all continuous parameter values + the current fx chain
order. Think of it as a bookmark. States live inside one Bank. Recalling a State does
not change controller assignments. Saving a State always overwrites the slot it occupies
(or creates a new one in the next empty slot).

---

## 2. Naming Cleanup

Every instance of "Preset" in UI-facing strings, CSS classes, HTML ids, and exported
file formats must be renamed. Internal JS class/function names can be renamed in a
separate refactor session if desired, but the user-visible surface is the priority.

| Old (remove) | New (use) |
|---|---|
| Preset (UI label) | Bank |
| `status-preset` (id) | `status-bank` |
| `bank-select` (id) | stays `bank-select` ✓ |
| `banks-section` (id) | stays `banks-section` ✓ |
| `preset-item` (CSS class) | `state-item` |
| `preset-name` (CSS class) | `state-name` |
| `preset-num` (CSS class) | `state-num` |
| `preset-thumb` (CSS class) | `state-thumb` |
| `preset-thumb--has` (CSS class) | `state-thumb--has` |
| `preset-name-input` (CSS class) | `state-name-input` |
| `Bank N` (Preset.js fallback label) | `Bank N` ✓ already |
| `Preset ${index}` (Preset constructor) | `Bank ${index + 1}` |
| `DemoPresets.js` variable names | Update display names only |
| `.imweb` file extension | keep — it is the Project format |
| `presets` (IndexedDB store name + JSON key in .imweb) | `banks` |

**Backwards compatibility: deliberately dropped.**
The project is in early development and no important data has been committed to Banks or
States yet. Bump `DB_VERSION` to `2` in Preset.js. The `onupgradeneeded` handler for v2
should delete the old `presets` object store and create a fresh `banks` object store.
This forces a clean slate — factory demo presets seed fresh on first load after the
upgrade, exactly as on a new install. No migration code needed.

New file extensions for sub-project exchange:
- `.imbank` — a single exported Bank (JSON; contains controllers + all its States)
- `.imstate` — a single exported State (JSON; contains values + fxOrder + thumbnail)

---

## 3. Bottom Bar — State Thumbnail Grid

Replace the current `#state-bar` (128 tiny dots + one dropdown) with:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  [○] [1][2][3][4][5][6][7][8][9][10][11][12][13][14][15][16]  ← row 1  │
│      [17][18]..............................................  [32] ← row 2 │ ← #state-bar
│                                                        [Bank 1 ▾]        │
└─────────────────────────────────────────────────────────────────────────┘
```

The `[○]` tile is the **Neutral State** button — a special, always-present tile to the
left of the numbered grid (see §3a below).

### Neutral State tile (§3a)
- Element: `<button id="state-neutral" class="state-tile state-tile--neutral">○</button>`
- Always visible, not numbered, cannot be overwritten or deleted.
- **Click** = reset all parameters to their default values (same behaviour as `Shift+Esc`,
  which already calls `ps.resetAll()` or equivalent — reuse that logic exactly).
- Style: slightly wider than a state tile (~44px), circular glyph centered, dimmer accent
  colour (`var(--accent-dim)`). On hover: brightens to `var(--accent)` with tooltip
  "Neutral — reset all parameters to default".
- Is **MIDI-assignable** as a TRIGGER parameter: `ps.register({ id: 'memory.neutral',
  type: 'trigger', label: 'Neutral State' })` → fires the reset on trigger.
- Does **not** affect controller assignments (LFO/MIDI remain active after reset).

### State tile behaviour (numbered slots)
- Each tile is a `<button class="state-tile">` — 32 total, built by `StateDots` (or renamed
  `StateBar`).
- Size: ~38px wide × 28px tall. Two rows of 16.
- **Empty slot**: dim, no thumbnail, faint slot number. Click does nothing (or shows tooltip
  "Right-click to save here").
- **Stored slot**: shows thumbnail as `background-image`. Number overlaid bottom-left (10px,
  white, 50% opacity). Name overlaid bottom (truncated, 9px) on hover.
- **Active slot**: yellow border (`2px solid var(--accent)`).
- **Click** = recall State.
- **Right-click** = context menu: "Save here", "Clear", "Export .imstate", "Rename".
- **Hover** = larger tooltip preview (thumbnail + name + slot number).

### Bank selector (right end of bar)
- A `<button id="bank-name-btn">Bank 1 ▾</button>` — shows current bank name.
- Click → `<div id="bank-dropdown">` appears above it listing all banks. Click a bank name
  to switch. At the bottom of the dropdown: "+ New Bank" and "Import Bank…" actions.
- The dropdown replaces the current `<select id="bank-select">`. The select element can stay
  in the DOM as a hidden MIDI-assignable proxy (see §6) but should not be visible.
- Double-click the bank name button → inline rename (contenteditable or input swap).

### Layout / CSS notes
- `#state-bar` gets `display: grid; grid-template-rows: 1fr 1fr; align-items: center;`
  with the bank selector pinned to the right via a flex wrapper.
- Remove the `#preset-nav` wrapper — bank button goes directly into `#state-bar`.
- `#state-dots` becomes `#state-grid` — a `display: grid; grid-template-columns: repeat(16, 1fr);
  grid-template-rows: repeat(2, 1fr);` container inside `#state-bar`.

---

## 4. Left Panel — Memory Section

The current three sections (Project / Banks / States) become two:

### Section A: Project
*Unchanged in function. Rename nothing here.*
- File controls: New Project, Open (.imweb), Save, Save As
- AI Preset Generator (already exists under `#ai-preset-ui`)

### Section B: Memory  *(replaces Banks + States sections)*
Header: **Memory**

Content, top to bottom:

```
[  Bank 1  ▾ ]  [ + New Bank ]  [ ⬆ Import Bank ]  [ ⬇ Export Bank ]
─────────────────────────────────────────────────────────────────────
State 1  [thumb]  name…   [▶ Recall]  [⬇ Export]
State 3  [thumb]  name…   [▶ Recall]  [⬇ Export]
State 7  [thumb]  name…   [▶ Recall]  [⬇ Export]
  (only occupied slots listed; empty label: "No states in this Bank.")
─────────────────────────────────────────────────────────────────────
[ ⬆ Import State ]
```

- The bank selector here and the bottom-bar button are kept in sync via the same
  `presetActivated` event.
- State rows: same data as the old `PresetsPanel._build()` loop, but using the new
  CSS class names from §2.
- "Export Bank" → saves the current Bank as `BankName.imbank` (JSON).
- "Import Bank" → opens file picker for `.imbank`; appends as a new Bank to the project.
- "Export State" (per row) → saves that State as `State-N.imstate` (JSON).
- "Import State" → opens file picker for `.imstate`; places it in the next empty slot of
  the current Bank.

---

## 5. Data Model Changes (Preset.js)

### MAX_STATES constant
Add `export const MAX_STATES = 32;` at the top of Preset.js.
Replace all `128` references with `MAX_STATES`.

### Preset constructor
```js
this.name = `Bank ${index + 1}`; // was: `Preset ${index}`
```

### What a State now captures — full snapshot

A State is a **complete, self-contained snapshot**. Recalling it reproduces the full
instrument state: parameter values, effect chain order, and controller wiring.

```js
// State object shape (stored in bank.states[i])
{
  values:      { paramId: value, … },   // all ParameterSystem values
  fxOrder:     [ 'blur', 'hue', … ],    // Pipeline effect chain order
  controllers: { paramId: serialized, … }, // full controller assignments
                                           // (LFO, MIDI, Random, xCtrl, etc.)
  mediaRefs:   {                         // filename strings — informational only
    movie:   'myfilm.mp4' | null,        // name of loaded movie clip at save time
    scene3d: 'skull.glb'  | null,        // name of loaded 3D model
    text:    null,                        // reserved
    buffer:  null,                        // reserved
  },
  name:        null,                     // user-assigned name
  thumbnail:   null,                     // base64 JPEG data URL
  created:     Date.now(),
}
```

**Why controllers are now in State, not just Bank:**
Previously, controller assignments (LFO rates, MIDI CC mappings, Random settings) lived
only at the Bank level — shared across all States in that Bank. This made States feel
incomplete: recalling a State changed values but not the wiring that drives them. Now each
State stores its own controller snapshot. Recalling a State is a full restore.

**Bank.controllers** becomes redundant. It is kept in the serialized Bank object for
reference (e.g. "what controllers were active when this Bank was last saved") but is no
longer the authoritative source on recall — the active State's controllers are used instead.

**Media refs — annotation only:**
The File API requires a user gesture to open files; media cannot be re-loaded
automatically. `mediaRefs` stores the filenames of whatever was loaded at save time.
On recall, if the currently loaded media filenames don't match, a toast is shown.
Full auto-reload from storage is deferred to a future asset-manager feature.

### Updated `addState()` signature
`addState()` on the `Preset` class gains a `controllers` and `mediaRefs` argument:

```js
addState(values, index = null, fxOrder = null, controllers = {}, mediaRefs = {}) {
  const ds = {
    values:      { ...values },
    fxOrder:     fxOrder ? [...fxOrder] : null,
    controllers: { ...controllers },
    mediaRefs:   { movie: null, scene3d: null, text: null, buffer: null, ...mediaRefs },
    name:        null,
    thumbnail:   null,
    created:     Date.now(),
  };
  if (index !== null && index >= 0 && index < MAX_STATES) {
    this.states[index] = ds; return index;
  }
  for (let i = 0; i < MAX_STATES; i++) {
    if (!this.states[i]) { this.states[i] = ds; return i; }
  }
  return null;
}
```

### Updated `saveCurrentState()` on PresetManager
Captures controllers and media refs alongside parameter values:

```js
async saveCurrentState(stateIndex = null) {
  const p = this.current;
  if (!p) return;
  const values      = this.ps.captureState();
  const fxOrder     = this.pipeline ? [...this.pipeline.fxOrder] : null;
  const controllers = this.ps.serializeControllers();
  const mediaRefs   = this._captureMediaRefs(); // see below
  const idx = p.addState(values, stateIndex, fxOrder, controllers, mediaRefs);
  await p.save();
  this.dispatchEvent(new CustomEvent('stateSaved',
    { detail: { presetIndex: this.currentIdx, stateIndex: idx } }));
  return idx;
}

// Collect currently loaded media filenames from the runtime
_captureMediaRefs() {
  // These refs are populated by main.js at load time.
  // BankManager exposes setMediaRef(key, filename) for main.js to call.
  return { ...this._mediaRefs }; // { movie, scene3d, text, buffer }
}
```

Add `this._mediaRefs = { movie: null, scene3d: null, text: null, buffer: null }` to the
PresetManager constructor, and a public `setMediaRef(key, filename)` setter that main.js
calls whenever a file is loaded (movie drop, 3D model import, etc.).

### Updated `recallState()` on PresetManager
Restores values, fxOrder, controllers, and checks media refs:

```js
async recallState(stateIndex) {
  const p = this.current;
  if (!p) return;
  const ds = p.getState(stateIndex);
  if (!ds) return;

  p.activeState = stateIndex;

  // 1. Restore parameter values
  this.ps.restoreState(ds.values);

  // 2. Restore fx chain order
  if (ds.fxOrder && this.pipeline) this.pipeline.setFxOrder(ds.fxOrder);

  // 3. Restore controller assignments
  if (ds.controllers && Object.keys(ds.controllers).length) {
    this.ps.deserializeControllers(ds.controllers);
    Object.entries(ds.controllers).forEach(([paramId, config]) => {
      if (config.controller) this.ctrl.assign(paramId, config.controller);
    });
    this.ctrl.rebuildXControllers();
    this.ctrl.retriggerLFOs();
  }

  // 4. Check media refs — warn if mismatch, don't block
  if (ds.mediaRefs) this._checkMediaRefs(ds.mediaRefs);

  // 5. Send MIDI feedback to motorized faders
  this.ps.getAll().forEach(p => this.ctrl.sendParamFeedback(p));

  document.getElementById('status-state').textContent = ds.name || `State ${stateIndex}`;
  this.dispatchEvent(new CustomEvent('stateRecalled',
    { detail: { presetIndex: this.currentIdx, stateIndex, state: ds } }));
}

_checkMediaRefs(saved) {
  const current = this._mediaRefs;
  const mismatches = [];
  if (saved.movie   && saved.movie   !== current.movie)   mismatches.push(`Movie: "${saved.movie}"`);
  if (saved.scene3d && saved.scene3d !== current.scene3d) mismatches.push(`3D model: "${saved.scene3d}"`);
  if (mismatches.length) {
    showToast(`⚠ State was saved with: ${mismatches.join(', ')} — please load manually`);
  }
}
```

`showToast()` reuses the existing `_showClipError` pattern (a div appended to body,
auto-removed after 5000ms). Extract it as a shared `showToast(msg, duration=5000)` utility
in main.js.

### Bank export/import helpers
```js
Preset.prototype.exportBank = function() {
  return { __type: 'imbank', version: 1, name: this.name,
           states: this.states, activeState: this.activeState, exported: Date.now() };
  // Note: Bank.controllers omitted — controllers now live in each State.
};

static importBank(data, targetIndex) {
  const p = new Preset(targetIndex);
  p.name        = data.name   || `Bank ${targetIndex + 1}`;
  p.states      = data.states || [];
  p.activeState = data.activeState ?? 0;
  return p;
}
```

### State export/import helpers
```js
// On PresetManager:
exportState(stateIndex) {
  const state = this.current?.getState(stateIndex);
  if (!state) return null;
  return { __type: 'imstate', version: 1, ...state, exported: Date.now() };
}

importState(data, targetSlot = null) {
  const { values, fxOrder, controllers, mediaRefs, name, thumbnail } = data;
  const idx = this.current?.addState(values, targetSlot, fxOrder, controllers, mediaRefs);
  if (idx !== null && name) this.current.states[idx].name = name;
  if (idx !== null && thumbnail) this.current.states[idx].thumbnail = thumbnail;
  return idx;
}
```

---

## 6. Keyboard Shortcuts

### Existing shortcuts to keep (document in CLAUDE.md)
| Key | Action |
|---|---|
| `0–9` | Recall State slot 0–9 |
| `Numpad +` | Next Bank |
| `Numpad −` | Prev Bank |
| `Numpad * → digit` | Store State to slot (two-key chord) |
| `Shift+1–8` | Select movie clip |

### New shortcut — Quick Save State
**Key: `Shift+S`**
- `s` alone (no shift) = Solo toggle (existing, keep).
- `Shift+S` gives `e.key === "S"` + `e.shiftKey === true` — not currently assigned.
  Verify: `grep -n "key === 'S'" src/main.js` should return nothing.
- Action: `presetMgr.saveCurrentState(null)` → saves to next empty slot. Flashes the
  newly filled tile in the state bar (100ms accent-color pulse, `animation: state-tile-flash`).
- Note: chosen over `\` (backslash) because backslash position varies on non-US keyboards
  (Icelandic, Nordic layouts place it differently or require AltGr).

### New shortcut — Neutral State
**Key: `Shift+0`**
- Currently `0` alone recalls State slot 0. `Shift+0` is not assigned (Shift+1–8 are movie
  clips, but Shift+0 and Shift+9 are free).
- Verify: `grep -n "Digit0" src/main.js` — confirm no Shift+Digit0 handler exists.
- Action: same as clicking the `[○]` Neutral tile — resets all parameters to defaults.

### MIDI — Bank Select
- Expose `bank-select` value as a MIDI-assignable parameter.
- Register: `ps.register({ id: 'memory.bank', type: 'select', options: bankNames,
  label: 'Bank', ... })` — updated dynamically as banks are added/removed.
- The `bank-select` hidden select element remains in DOM as the backing element for
  MIDI CC feedback.

---

## 7. Implementation Sessions

Follow the three-session pattern from the workflow doc.

### Session 1 — Data model ✅ DONE (877a3a1)

Files: `src/state/Preset.js`, `src/state/DemoPresets.js`, `src/state/PresetManager` (inside Preset.js)
- Bump `DB_VERSION` to `2`; drop old `presets` store, create `banks` store in `onupgradeneeded`.
- Add `MAX_STATES = 32` constant; replace 128 → MAX_STATES.
- Change default name from `Preset ${index}` to `Bank ${index + 1}`.
- Update `addState()` signature: add `controllers`, `mediaRefs` arguments (§5).
- Update `saveCurrentState()`: capture `ps.serializeControllers()` + `_captureMediaRefs()`.
- Update `recallState()`: restore controllers + call `_checkMediaRefs()`.
- Add `_mediaRefs` to PresetManager constructor + `setMediaRef(key, filename)` setter.
- Extract `showToast()` utility (reuse `_showClipError` pattern) — add to `main.js`.
- Add `exportBank()`, `importBank()`, `exportState()`, `importState()` methods.
- No UI changes yet.
- Commit: `refactor(state): States capture full snapshot — values+fxOrder+controllers+mediaRefs`

### Session 2 — Bottom bar redesign ✅ DONE (f5ab155)
Files: `index.html`, `src/ui/UI.js`, `src/style.css`
- Replace `#state-dots` 128-dot build with 32-tile `#state-grid` (2×16).
- Add thumbnail display to tiles.
- Replace `<select id="bank-select">` visible dropdown with `#bank-name-btn` + `#bank-dropdown`.
- Wire bank-name-btn to `presetActivated` event.
- CSS: new `.state-tile`, `.state-tile--stored`, `.state-tile--active`, `#bank-name-btn`,
  `#bank-dropdown` rules.
- Remove old `.state-dot` rules (or repurpose).
- Commit: `feat(ui): state-bar redesign — 32 thumbnail tiles + bank name button`

### Session 3 — Left panel Memory section ✅ DONE
Files: `index.html`, `src/ui/UI.js`, `src/style.css`
- Replace "Banks" + "States" sections with single "Memory" section.
- Build bank row (selector + New / Import / Export Bank buttons).
- Rebuild state list using new CSS class names (§2).
- Add Import State / Export State controls.
- Wire file picker handlers in `main.js` (`.imbank`, `.imstate` read/write).
- Commit: `feat(ui): Memory panel — bank controls, state list, import/export`

### Session 3b — Section restructure ✅ DONE
- Project/AI/Banks/States/Seq sections split; bank name in header; status-bank rename; state row layout fixed.

### Session 4 — Shortcuts + MIDI bank select
Files: `src/main.js`, `src/controls/ParameterSystem.js`
- Add `Shift+S` quick-save shortcut (verify: `grep -n "key === 'S'" src/main.js` returns nothing).
- Register `memory.bank` as a MIDI-assignable SELECT parameter.
- Update `#status-bank` element (rename from `#status-preset` in HTML + all JS refs).
- Rename CSS class `preset-*` → `state-*` sweep across `style.css`.
- Commit: `feat(memory): backslash quick-save, MIDI bank select, status-bank rename`

---

## 8. Acceptance Criteria (per session)

**Session 1:** No visual change. `new Preset(0).name === 'Bank 1'`. `MAX_STATES === 32`.
Save a State, reload the page — confirm the recalled State restores both parameter values
and controller assignments. Trigger a media mismatch (load a movie, save a State, reload
without loading the movie) — confirm toast appears: "⚠ State was saved with: Movie: …".
`exportBank()` returns `{ __type: 'imbank' }`. No console errors.

**Session 2:** Bottom bar shows 2 rows × 16 tiles. Occupied tiles show thumbnails. Active
tile has yellow border. Right-click opens context menu with Save/Clear/Export/Rename.
Bank-name button shows current bank name and opens dropdown on click. Switching bank
updates all 32 tiles. No 128-dot references remain in DOM.

**Session 3:** Left panel "Memory" section shows bank controls + state list. "Export Bank"
downloads a valid `.imbank` JSON. "Import Bank" adds a new bank and switches to it. "Export
State" downloads a valid `.imstate` JSON. "Import State" places it in the next empty slot
and refreshes the tile bar.

**Session 4:** `Shift+S` saves to next empty slot and pulses the tile. `Shift+0` triggers
Neutral State reset. The `[○]` Neutral tile is present in the state bar and functions on
click. A MIDI CC can be assigned to switch banks. `memory.neutral` is MIDI-assignable as
a TRIGGER. `#status-bank` shows current bank name. No `status-preset` id remains in HTML
or JS. No `preset-item/name/num/thumb` CSS classes remain in `style.css`.

---

## 9. Files Not to Touch (protect list for each session)

- `src/core/Pipeline.js` — no changes needed
- `src/shaders/index.js` — no changes needed
- `src/controls/ControllerManager.js` — Session 4 only touches param registration, not internals
- `src/scene3d/*` — untouched
- `dev-catcher.js`, `process-ideas.sh` — **never touch** (Dev Capture pipeline, per CLAUDE.md)
- `.imweb` file format backwards compatibility — **intentionally not required** (see §2 note)
