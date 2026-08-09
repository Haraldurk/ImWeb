/**
 * Guide — the in-app guided tour.
 *
 * POINTING ONLY. This module never writes a parameter, never triggers, never
 * toggles. It reveals: switches to the owning tab, expands the owning section,
 * scrolls the row into view and flashes it. That constraint is the whole design
 * — a tour that sets values for you would wreck a patch someone is halfway
 * through, and it teaches nothing, because the hand that moved the control was
 * not theirs. If you are tempted to add `ps.set()` here, add a sentence to the
 * step text instead.
 *
 * CONTENT LIVES IN ONE PLACE: docs/ImWeb-Guide.md (served from public/docs, see
 * the sync-docs npm script). It is ordinary markdown — readable on GitHub,
 * sendable as an email — carrying one `<!-- guide ... -->` block per step that
 * names what the step points at. Steps are NOT duplicated as a JS array here;
 * that second copy is exactly how six copies of the source list once drifted
 * apart.
 *
 * Step grammar — one `## ` heading per step:
 *
 *     ## Rutt-Etra Scan Processor
 *     <!-- guide
 *     track: instruments
 *     tab: sources
 *     point: rutt.active, rutt.zgain, rutt.lines
 *     show: #movie-a-section
 *     keys: a
 *     -->
 *     Body markdown…
 *
 * All fields are optional. `point:` takes parameter ids, `show:` takes CSS
 * selectors for things that are not parameters (a whole section, a button),
 * `tab:` activates a tab on step entry, `keys:` renders keycaps for reference.
 *
 * `track:` sorts the step into one of three tracks, because the three are
 * different kinds of not-knowing and mixing them serves neither: someone who
 * cannot work a parameter row is not helped by a tour of the Rutt-Etra, and
 * someone who has used the instrument for a year should not have to page
 * through the drag directions to reach it. A step with no track falls into
 * TRACKS[0] rather than vanishing.
 */

import { marked } from 'marked';

const STORE_KEY = 'imweb.guideStep';
// Must match the .guide-flash animation duration in style.css. Testers reported
// missing the flash at 1.6s and one pulse; it is three pulses over 2.6s now.
const FLASH_MS = 2600;

/** Track key → chip label. Order here is the order in the panel. */
export const TRACKS = [
  ['basics',      'Basics'],
  ['principles',  'Principles'],
  ['instruments', 'Instruments'],
];

let _steps = null;      // ALL parsed steps, in file order
let _track = TRACKS[0][0];
let _idx = 0;           // index within the current track, not into _steps
let _panel = null;
let _ps = null;
let _openWorkspace = null; // injected: workspace panes are not plain tabs
let _loadPromise = null;

// ── Reveal ───────────────────────────────────────────────────────────────────

/**
 * Bring an element into view: workspace/tab, expand its section and
 * subsection, scroll, flash. Returns false if the element is not in the DOM.
 *
 * Exported because the `/` parameter search wants exactly this and used to do a
 * weaker version of it inline (scroll + outline, no tab switch, no expand) —
 * which silently did nothing whenever the target sat on another tab or inside a
 * collapsed section, i.e. most of the time.
 */
export function revealElement(el) {
  if (!el) return false;

  // 1. The pane. Workspace panes (Live GLSL, 3D, Analog, Draw) are .tab-content
  //    but have no .tab button of their own — they need the router.
  const pane = el.closest('.tab-content');
  if (pane) {
    const wsBtn = document.querySelector(`[data-workspace][data-pane="${pane.id}"]`);
    const wsKey = wsBtn?.dataset.workspace ?? _paneWorkspaceKey(pane.id);
    if (wsKey && _openWorkspace) {
      _openWorkspace(wsKey);
    } else {
      const name = pane.id.replace(/^tab-/, '');
      document.querySelectorAll('.tab').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === name));
      document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c === pane));
    }
  }

  // 2. Expand every collapsed container between the element and the pane.
  //    Both the wrapper and its header carry .collapsed — style.css keys off
  //    the header for the chevron and off the wrapper for the body.
  for (const [wrap, hdr] of [
    ['.panel-section', '.section-header'],
    ['.panel-subsection', '.subsection-header'],
  ]) {
    const w = el.closest(wrap);
    if (!w) continue;
    w.classList.remove('collapsed');
    w.querySelector(hdr)?.classList.remove('collapsed');
  }

  // 3. Scroll and flash. rAF because the tab we just switched to had
  //    display:none a moment ago, and an element in a display:none subtree has
  //    no box to scroll to.
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('guide-flash');
    setTimeout(() => el.classList.remove('guide-flash'), FLASH_MS);
  });
  return true;
}

/** Map a workspace pane id back to its router key. */
function _paneWorkspaceKey(paneId) {
  return { 'tab-scene3d': 'scene3d', 'tab-analog': 'analog',
           'tab-draw': 'draw', 'tab-glsl': 'glsl' }[paneId] ?? null;
}

/**
 * Reveal a parameter by id. Skips the copy of the row that lives inside the
 * search-results list — those rows carry .param-row and data-param-id too, so
 * an unqualified query finds the wrong one whenever the search is open.
 */
export function revealParam(id) {
  // `[data-param-id]` rather than `.param-row[data-param-id]`: a few rows are
  // hand-built rather than produced by buildParamRow (the GLSL Preset row), and
  // they carry the id without the class.
  const row = Array.from(document.querySelectorAll(`[data-param-id="${CSS.escape(id)}"]`))
    .find(el => !el.closest('#param-search-results'));
  return revealElement(row);
}

/** Reveal by CSS selector, for targets that are not parameter rows. */
export function revealSelector(sel) {
  let el = null;
  try { el = document.querySelector(sel); } catch { return false; }
  return revealElement(el);
}

// ── Content ──────────────────────────────────────────────────────────────────

/**
 * Split the guide markdown into steps. Everything before the first `## ` (the
 * title and any preamble) is dropped: it is there for the reader of the file.
 */
export function parseGuide(md) {
  const steps = [];
  // Split on level-2 headings only, at line start, so `###` inside a step body
  // and any `##` inside a fenced block stay put.
  const parts = md.split(/^##[ \t]+/m).slice(1);
  for (const part of parts) {
    const nl = part.indexOf('\n');
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    let body = nl === -1 ? '' : part.slice(nl + 1);

    const meta = { track: TRACKS[0][0], tab: null, point: [], show: [], keys: [] };
    body = body.replace(/<!--\s*guide\b([\s\S]*?)-->/, (_, block) => {
      for (const line of block.split('\n')) {
        const m = line.match(/^\s*(track|tab|point|show|keys)\s*:\s*(.+?)\s*$/);
        if (!m) continue;
        const [, k, v] = m;
        if (k === 'track' || k === 'tab') meta[k] = v.trim();
        else meta[k] = v.split(',').map(s => s.trim()).filter(Boolean);
      }
      return '';
    });

    steps.push({ title, body: body.trim(), ...meta });
  }
  return steps;
}

async function loadSteps() {
  if (_steps) return _steps;
  if (_loadPromise) return _loadPromise;
  _loadPromise = (async () => {
    const res = await fetch('docs/ImWeb-Guide.md');
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    _steps = parseGuide(await res.text());
    return _steps;
  })();
  return _loadPromise;
}

// ── Panel ────────────────────────────────────────────────────────────────────

function buildPanel() {
  const el = document.createElement('div');
  el.id = 'guide-panel';
  el.className = 'hidden';
  el.innerHTML = `
    <div id="guide-titlebar">
      <span id="guide-title">Guided Tour</span>
      <span id="guide-count"></span>
      <button id="guide-close" title="Close (Esc)">✕</button>
    </div>
    <div id="guide-tracks">${TRACKS.map(([k, label]) =>
      `<button class="guide-track" data-track="${k}">${label}</button>`).join('')}</div>
    <div id="guide-body"></div>
    <div id="guide-points"></div>
    <div id="guide-nav">
      <button id="guide-prev" title="Previous step (←)">‹ Back</button>
      <button id="guide-next" title="Next step (→)">Next ›</button>
    </div>`;
  document.body.appendChild(el);

  el.querySelector('#guide-close').addEventListener('click', closeGuide);
  el.querySelector('#guide-prev').addEventListener('click', () => go(_idx - 1));
  el.querySelector('#guide-next').addEventListener('click', () => go(_idx + 1));
  el.querySelector('#guide-tracks').addEventListener('click', e => {
    const btn = e.target.closest('.guide-track');
    if (btn) goTrack(btn.dataset.track);
  });

  // Arrow keys drive the tour while it is open. Deliberately NOT bound to the
  // single-key performance shortcuts (b/s/k/q/a/z…): those keys must keep
  // working with the guide open, which is the point of a panel rather than a
  // modal.
  document.addEventListener('keydown', e => {
    if (el.classList.contains('hidden')) return;
    if (e.target.closest('input, textarea')) return;
    if (e.key === 'Escape')     { closeGuide();  e.preventDefault(); }
    if (e.key === 'ArrowRight') { go(_idx + 1);  e.preventDefault(); }
    if (e.key === 'ArrowLeft')  { go(_idx - 1);  e.preventDefault(); }
  });

  return el;
}

/** Human label for a point target: the parameter's own label, when it has one. */
function pointLabel(id) {
  return _ps?.get?.(id)?.label ?? id;
}

/** Human label for a show target: its section header text, or the selector. */
function showLabel(sel) {
  let el = null;
  try { el = document.querySelector(sel); } catch { /* bad selector */ }
  const hdr = el?.querySelector?.('.section-header, .subsection-header')
           ?? el?.closest?.('.panel-section')?.querySelector('.section-header');
  return hdr?.childNodes[0]?.textContent?.trim() || sel;
}

/** The steps of the current track, in file order. */
function trackSteps() {
  return _steps.filter(s => s.track === _track);
}

function render() {
  const steps = trackSteps();
  const step = steps[_idx];
  if (!step) return;

  _panel.querySelector('#guide-title').textContent = step.title;
  _panel.querySelector('#guide-count').textContent = `${_idx + 1} / ${steps.length}`;
  _panel.querySelectorAll('.guide-track').forEach(b =>
    b.classList.toggle('active', b.dataset.track === _track));
  _panel.querySelector('#guide-body').innerHTML = marked.parse(step.body);

  const pts = _panel.querySelector('#guide-points');
  pts.innerHTML = '';
  const targets = [
    ...step.point.map(id  => ({ kind: 'point', target: id,  label: pointLabel(id) })),
    ...step.show .map(sel => ({ kind: 'show',  target: sel, label: showLabel(sel) })),
  ];
  for (const t of targets) {
    const btn = document.createElement('button');
    btn.className = 'guide-point';
    btn.textContent = t.label;
    btn.title = `Show me: ${t.target}`;
    btn.addEventListener('click', () => {
      const ok = t.kind === 'point' ? revealParam(t.target) : revealSelector(t.target);
      // A target that is not in the DOM is a content bug, not a user error —
      // say so on the chip rather than doing nothing and looking broken.
      btn.classList.toggle('missing', !ok);
    });
    pts.appendChild(btn);
  }
  pts.classList.toggle('hidden', targets.length === 0);

  _panel.querySelector('#guide-prev').disabled = _idx === 0;
  _panel.querySelector('#guide-next').disabled = _idx === steps.length - 1;

  // Land the panel on the right tab, then point at the first target. Both are
  // navigation, not authorship: nothing here changes a value.
  if (step.tab) {
    document.querySelectorAll('.tab').forEach(b =>
      b.classList.toggle('active', b.dataset.tab === step.tab));
    document.querySelectorAll('.tab-content').forEach(c =>
      c.classList.toggle('active', c.id === `tab-${step.tab}`));
  }
  if (targets.length) {
    const first = targets[0];
    if (first.kind === 'point') revealParam(first.target);
    else revealSelector(first.target);
  }
}

function go(i) {
  if (!_steps || i < 0 || i >= trackSteps().length) return;
  _idx = i;
  _save();
  render();
}

/** Switch track, landing on its first step. */
function goTrack(key) {
  if (!TRACKS.some(([k]) => k === key)) return;
  _track = key;
  _idx = 0;
  _save();
  render();
}

function _save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ track: _track, idx: _idx }));
  } catch { /* private mode */ }
}

/**
 * Restore {track, idx}, tolerating the bare step number this key held before
 * tracks existed — a stale value must not strand someone on a blank panel.
 */
function _restore() {
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch { return; }
  if (!raw) return;
  let saved = null;
  try { saved = JSON.parse(raw); } catch { return; } // legacy bare number parses fine
  if (typeof saved !== 'object' || saved === null) return;
  if (TRACKS.some(([k]) => k === saved.track)) _track = saved.track;
  const n = trackSteps().length;
  _idx = Number.isInteger(saved.idx) && saved.idx < n ? saved.idx : 0;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Wire the guide. `openWorkspace` is injected rather than imported because the
 * workspace router is a closure inside main()'s scope — passing it keeps this
 * module free of a reach-back into main.js.
 */
export function initGuide({ ps, openWorkspace } = {}) {
  _ps = ps ?? null;
  _openWorkspace = openWorkspace ?? null;
}

/**
 * Open the tour, resuming where this origin left off. Pass a track key to start
 * that track from the top instead (the onboarding splash does — a first-time
 * reader has no progress worth resuming).
 */
export async function openGuide(track = null) {
  _panel ??= buildPanel();
  try {
    await loadSteps();
  } catch (err) {
    _panel.querySelector('#guide-body').textContent =
      `Could not load docs/ImWeb-Guide.md — ${err.message}`;
    _panel.classList.remove('hidden');
    return;
  }
  if (!_steps.length) return;
  if (track && TRACKS.some(([k]) => k === track)) { _track = track; _idx = 0; }
  else _restore();
  // A track whose steps all vanished from the markdown would render blank.
  if (!trackSteps().length) { _track = TRACKS[0][0]; _idx = 0; }
  _panel.classList.remove('hidden');
  go(_idx);
}

export function closeGuide() {
  _panel?.classList.add('hidden');
}

export function toggleGuide() {
  if (!_panel || _panel.classList.contains('hidden')) openGuide();
  else closeGuide();
}
