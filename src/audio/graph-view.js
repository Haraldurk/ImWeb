/**
 * The audio graph, as a row of nodes for the signal path display (§8.6).
 *
 * §8.6 chose "draw the loop" over every other mitigation it considered, and gave
 * the reason: it is *"the only one that turns the hazard into an object the
 * performer can reason about, and it reuses a surface that already exists"*. A
 * warning line says a loop exists. A drawn graph says **which link to open** —
 * and that difference is the whole argument, so this module's job is to name the
 * links, not to restate the warning.
 *
 * **Zero imports, by the same rule that shaped `spectral-image.js` and
 * `corpus-index.js`.** It takes a plain snapshot of numbers and booleans and
 * returns plain objects. Nothing here knows what a Parameter is, what an
 * AudioContext is, or what a DOM node is, which is what lets the audit drive it
 * directly — `AudioBinding` cannot be imported in Node at all (it reaches
 * `AudioEngine`, which reaches a Vite `?url` import), and that is exactly how the
 * step-10 audit ended up censusing source text with regexes that were wrong
 * twice. Pure function, observable outcome, no regex.
 *
 * **`loopLive` is an INPUT and is never re-derived here.** `AudioBinding._loopLive()`
 * is the one definition of "is `mic → tape → monitors → mic` a real acoustic
 * path", and it reads the DEVICE rather than `audio.mic` for a reason this module
 * has no way to know. A second implementation would be a second answer to one
 * question — the six-copies-of-SOURCE_DEFS failure at a smaller scale, and the
 * copy that drifts would be the one drawing a safety marking. The audit asserts
 * that nothing in this file mentions a monitoring mode.
 */

/**
 * Does the tape actually carry the microphone to the output right now?
 *
 * Distinct from `loopLive`, and the distinction is the point of drawing at all.
 * `loopLive` answers "is the room a wire" — engine running, mic open, speakers.
 * This answers "is there gain around that wire": a recording zone writing what
 * the mic hears, and a reader reading the same material back out. With the room
 * closed but nothing carrying, the performer is one Run toggle away from a
 * howl and can see which toggle it is; with both, they are in it.
 *
 * **Partition-level, deliberately.** Two zones on one partition whose regions do
 * not overlap carry nothing, and this still says they do. That is the cautious
 * direction — the same direction `audio.monitor` defaults to Speakers in — and a
 * 60-pixel strip is the wrong surface on which to litigate region arithmetic.
 * An `unsafe` zone ignores partition bounds entirely (§4.3), so any unsafe zone
 * on either side counts as a match for the same reason.
 */
function carries(rec, readers) {
  if (!rec.on) return false;
  return readers.some(r => r.on && (r.unsafe || rec.unsafe || r.part === rec.part));
}

/**
 * Build the audio row.
 *
 * @param {object} s snapshot — all plain values, all supplied by the caller:
 *   `running`, `micOpen`, `loopLive`, `monitorLabel`, `tapeSec`,
 *   `rec`/`play`/`grain` as `{ on, part, unsafe }`, and `voiceOn`.
 * @returns {{nodes: Array, loop: object|null}} `nodes` carry the same
 *   `{ label, type }` vocabulary the video chain already uses, plus a `key` on
 *   the two the return edge anchors to. `loop` is null when there is nothing to
 *   draw.
 */
export function describeAudioGraph(s) {
  // Nothing flows through a stopped engine, so there is no row — the same rule
  // the sequence rows already follow (they appear only for a running sequencer).
  // Drawing a dead audio graph in a strip about what the instrument is doing
  // would be the first row in it that is not about that.
  if (!s.running) return { nodes: [], loop: null };

  const nodes = [];
  nodes.push({ key: 'mic', label: 'mic', type: s.micOpen ? 'source' : 'node' });
  nodes.push({
    key: 'rec',
    label: s.rec.on ? `rec P${s.rec.part}` : 'rec',
    type: s.rec.on ? 'active' : 'node',
  });
  // The tape is storage, not a signal (§8.6's own correction: "you cannot tap a
  // partition; you tap a zone's output"). It is drawn because it is the link the
  // loop passes through and the one the performer opens, not because it emits.
  nodes.push({ key: 'tape', label: `tape ${Math.round(s.tapeSec)}s`, type: 'node' });

  const readers = [
    { on: s.play.on, label: `play P${s.play.part}` },
    { on: s.grain.on, label: `grain P${s.grain.part}` },
  ].filter(r => r.on);
  if (readers.length === 0) {
    nodes.push({ key: 'read', label: 'play', type: 'node' });
  } else {
    readers.forEach((r, i) => {
      if (i > 0) nodes.push({ label: '/', type: 'merge' });
      nodes.push({ key: 'read', label: r.label, type: 'active' });
    });
  }

  // A Voice has no buffer region (§4.4) — it joins the bus beside the readers
  // rather than after the tape, which is what the merge glyph already means in
  // the video row above.
  if (s.voiceOn) {
    nodes.push({ label: '/', type: 'merge' });
    nodes.push({ key: 'voice', label: 'voice', type: 'active' });
  }

  // Always active and never bypassable (§4.11). Drawn for that reason: in a
  // feedback instrument the thing that bounds the damage should be visible in
  // the same picture as the thing that causes it.
  nodes.push({ key: 'limit', label: 'limit', type: 'active' });
  nodes.push({ key: 'out', label: `▶ ${s.monitorLabel.toLowerCase()}`, type: 'active' });

  const loop = !s.loopLive ? null : {
    from: 'out',
    to: 'mic',
    carried: carries(s.rec, [s.play, s.grain]),
  };
  if (loop) {
    loop.label = loop.carried ? '⚠ room' : 'room';
    loop.title = loop.carried
      ? `acoustic loop closed AND carrying: mic → rec P${s.rec.part} → tape → reader → ${s.monitorLabel.toLowerCase()} → mic`
      : `acoustic loop closed: mic → ${s.monitorLabel.toLowerCase()} → mic. The tape is not carrying it — no reader is on the recorded partition.`;
  }
  return { nodes, loop };
}
