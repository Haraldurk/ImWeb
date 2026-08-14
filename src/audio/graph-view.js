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
 * **Partition-level, deliberately** — the test asks whether the two zones'
 * PARTITIONS overlap on the tape, not whether their regions within those
 * partitions do. Two zones on one partition whose regions do not overlap carry
 * nothing, and this still says they do. That is the cautious direction, the same
 * one `audio.monitor` defaults to Speakers in, and a 60-pixel strip is the wrong
 * surface on which to litigate region arithmetic. An `unsafe` zone ignores
 * partition bounds entirely (§4.3), so any unsafe zone on either side counts.
 *
 * **It compares SPANS, not slot indices, and the first draft did not.** Nothing
 * makes partitions disjoint — `_partBounds` in the worklet validates the range
 * and refuses while a zone is running, and that is all — so P0 and P1 can be
 * dragged onto the same tape. Comparing `r.part === rec.part` then reported a
 * recorder and a reader over identical material as NOT carrying: a live howl
 * drawn dashed-grey, and an under-claim in a test whose whole justification is
 * that it over-claims. Overlap of the two spans is the same question asked of
 * the thing that actually decides it.
 *
 * **The one divergence from the engine, and its direction is checked.** The
 * worklet's `_computeSpan` clamps a zone's region INTO its partition, so what a
 * zone actually touches is a subset of the partition drawn here. Comparing whole
 * partitions therefore over-claims relative to the engine — which is the safe
 * direction, and is the same approximation as ignoring the regions within one
 * partition. It is written down because the previous version of this comment
 * asserted a direction it had not checked, and that was the bug.
 *
 * @param {Array<{start:number,len:number}>} bounds partition spans, as fractions
 *   of the tape. A slot with no entry is treated as OVERLAPPING — the cautious
 *   direction again, and it cannot arise today because the zone selectors offer
 *   exactly the slots that are registered.
 */
function carries(rec, readers, bounds) {
  if (!rec.on) return false;
  const span = (i) => bounds?.[i] ?? null;
  const overlaps = (a, b) => {
    const pa = span(a), pb = span(b);
    if (!pa || !pb) return true;
    return pa.start < pb.start + pb.len && pb.start < pa.start + pa.len;
  };
  return readers.some(r => r.on
    && (r.unsafe || rec.unsafe || overlaps(r.part, rec.part)));
}

/**
 * Build the audio row.
 *
 * @param {object} s snapshot — all plain values, all supplied by the caller:
 *   `running`, `micOpen`, `loopLive`, `monitorLabel`, `tapeSec`,
 *   `rec`/`play`/`grain` as `{ on, part, unsafe }`, `partBounds` as an array of
 *   `{ start, len }` fractions, and `voiceOn`.
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
    carried: carries(s.rec, [s.play, s.grain], s.partBounds),
  };
  if (loop) {
    loop.label = loop.carried ? '⚠ room' : 'room';
    const mon = s.monitorLabel.toLowerCase();
    // The idle tooltip names the link that is OPEN, which is the whole reason
    // the loop is drawn rather than announced. It used to say "no reader is on
    // the recorded partition" in every idle case, including the common one where
    // the recorder is simply off — telling the performer to look at the wrong
    // end of the chain, in the sentence whose only job is pointing at the right
    // one.
    const why = !s.rec.on
      ? 'no recorder is writing the mic — Run Rec is off'
      : !(s.play.on || s.grain.on)
        ? 'nothing is reading the tape back — Run Play and Run Grain are both off'
        : 'the reader is on material the recorder is not writing';
    loop.title = loop.carried
      ? `acoustic loop closed AND carrying: mic → rec P${s.rec.part} → tape → reader → ${mon} → mic`
      : `acoustic loop closed: mic → ${mon} → mic. The tape is not carrying it — ${why}.`;
  }
  return { nodes, loop };
}
