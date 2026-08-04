// src/soak.js
// Soak-test instrumentation. Inert unless the page is loaded with `?soak=1`.
//
// Exists because a soak run had no readout. ParameterSystem is module-scoped,
// so every precondition — is displacement actually in the chain, is Movie B
// routed through the bus or straight at a layer — was verified by eye, and the
// numbers came back through a human retyping them out of Safari's remote
// inspector. Two runs were lost to a patch that was never what it looked like,
// and two more to the inspector dropping mid-phase.
//
// Gated on a URL PARAM, never on `import.meta.env.DEV`. Soak runs are verified
// against `vite preview`, which builds in production mode, so a DEV guard would
// hold `false` at the only line that ever evaluates it — a dead guard, which
// CLAUDE.md's Guard Logic Rules exist to prevent.

import { SOURCE_DEFS } from "./controls/ParameterSystem.js";

const ENDPOINT = "/__soak";
// perf-logger publishes a fresh window.__perfStats object every 5s. Poll faster
// than that and dedupe by IDENTITY: each report is a new object, so `s !== last`
// catches every window exactly once. This is why the poll does not compare
// worst_ms/jank the way the hand-pasted console sampler did — that test drops a
// genuine window whenever two in a row happen to agree, which silently threw
// away about two thirds of a 27-minute baseline.
const POLL_MS = 1000;

const srcLabel = (i) => SOURCE_DEFS[i]?.label ?? `?${i}`;

/**
 * @param {object} h - live handles from main.js
 * @returns {boolean} whether soak mode engaged
 */
export function initSoak(h) {
  const q = new URLSearchParams(location.search);
  if (!q.has("soak")) return false;

  const { ps, pipeline, movieInput, movieInputB } = h;
  const val = (id) => ps.get(id)?.value;
  const deck = (d) => ({
    clips: d?.clips?.length ?? 0,
    current: d?._current ?? -1,
    active: !!d?.active,
  });

  // Every precondition a phase depends on, in ONE call. Read-only by intent —
  // this is a window onto the patch, not a second way to set it.
  const state = () => ({
    displace: val("displace.amount"),
    keyer: val("keyer.active"),
    layer: {
      fg: srcLabel(val("layer.fg")),
      bg: srcLabel(val("layer.bg")),
      ds: srcLabel(val("layer.ds")),
    },
    mix: {
      srcA: srcLabel(val("mix.srcA")),
      srcB: srcLabel(val("mix.srcB")),
      xfade: val("mix.xfade"),
      mode: val("mix.mode"),
    },
    deckA: deck(movieInput),
    deckB: deck(movieInputB),
    perf: window.__perfStats ?? null,
  });

  // The phase-defining variables, carried on EVERY telemetry row. The point is
  // that the log answers "which phase was this" by itself — a run cannot be
  // mislabelled after the fact, which is exactly how two phases got confused.
  const stamp = () => ({
    xfade: val("mix.xfade"),
    displace: val("displace.amount"),
    ds: srcLabel(val("layer.ds")),
    fg: srcLabel(val("layer.fg")),
    deckB: movieInputB?.clips?.length ?? 0,
  });

  let phase = q.get("soak") || "unlabelled";
  let sent = 0;
  let failed = 0;
  let last = null;

  const post = (row) =>
    fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(row),
    })
      .then(() => { sent++; })
      .catch(() => { failed++; });   // a dropped sink must never break the run

  const tick = () => {
    const s = window.__perfStats;
    if (!s || s === last) return;
    last = s;
    post({ t: Date.now(), phase, kind: "perf", ...s, ...stamp() });
  };
  setInterval(tick, POLL_MS);

  window.__dbg = {
    ps,
    pipeline,
    movieInput,
    movieInputB,
    state,
    srcLabel,
    /** Label everything logged from here on. Call at the start of each phase. */
    phase(name) {
      phase = String(name);
      post({ t: Date.now(), phase, kind: "phase-start", state: state() });
      return `phase → ${phase}`;
    },
    /** Drop a labelled marker into the log (e.g. "raised xfade"). */
    mark(note) {
      post({ t: Date.now(), phase, kind: "mark", note: String(note), ...stamp() });
      return `marked: ${note}`;
    },
    /** Is telemetry actually reaching the host? */
    status: () => ({ phase, sent, failed, perf: window.__perfStats ?? null }),
  };

  post({ t: Date.now(), phase, kind: "session-start", state: state() });
  console.log(
    `%c[soak] armed — phase "${phase}". __dbg.state() / .phase(n) / .mark(s) / .status()`,
    "color:#7ac",
  );
  return true;
}
