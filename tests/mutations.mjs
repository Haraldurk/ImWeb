/**
 * The mutation registry — one entry per defect an audit claims to catch.
 *
 * Run by `tests/mutate.mjs` (`npm run mutate`). Each entry breaks the code in a
 * specific, plausible way and asserts the named audit goes red. An audit that
 * stays green is a hole; a mutation that no longer applies is asserting nothing.
 *
 * **These are not invented.** Every entry here was run by hand while building the
 * feature it covers, and the two marked `FOUND A REAL DEFECT` did not confirm an
 * existing check — they broke code that was shipped-ready and revealed a fault.
 * That is the argument for keeping them: on both PRs where mutation runs happened,
 * they found something the behaviour tests had missed.
 *
 * ── Writing a good mutation ────────────────────────────────────────────────
 *
 * It should be something a reasonable person might actually write, not vandalism.
 * `return null` at the top of a function proves nothing; swapping `<` for `<=` in
 * an interval test, or comparing indices where spans were meant, is the kind of
 * thing that ships. `why` says what would reach a performer if it did.
 *
 * Prefer `find`/`replace`. Use `apply(src)` only when the defect is not a
 * substring swap — a reordering, or a deletion plus an insertion elsewhere.
 */

/** Ordinary quotes throughout: `${}` inside a single-quoted string is literal. */
export const MUTATIONS = [
  // ═════════════════════════════════════════════════════════════════════════
  // The spectral writer's pan image (§8.14)
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'pan: linear law instead of equal power',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'a centred stroke would be 3 dB quieter than the same stroke pushed to one side — the picture changing loudness while claiming to change place',
    find: '      this._panL[i] = Math.cos(th);\n      this._panR[i] = Math.sin(th);',
    replace: '      const u = i / (SPEC_PAN_SIZE - 1);\n      this._panL[i] = 1 - u;\n      this._panR[i] = u;',
  },
  {
    name: 'pan: even-sized gain table',
    audit: 'audit-audio-pan.mjs',
    why: 'FOUND A REAL DEFECT. True centre falls between two entries, truncation lands low, and a pan of exactly 0 leans 0.15% left — inaudible, and still wrong in the one place a listener has a reference for',
    file: 'src/audio/engine/tape-processor.js',
    find: 'const SPEC_PAN_SIZE = (1 << 10) + 1;',
    replace: 'const SPEC_PAN_SIZE = 1 << 10;',
  },
  {
    name: 'pan: left and right swapped',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'every painted stroke comes out of the wrong speaker, which still sounds like music and is invisible unless you know what you drew',
    find: '            accL += v * panL[pi];\n            accR += v * panR[pi];',
    replace: '            accL += v * panR[pi];\n            accR += v * panL[pi];',
  },
  {
    name: 'pan: position switched between columns instead of crossfaded',
    audit: 'audit-audio-pan.mjs',
    why: 'FOUND A REAL DEFECT — in the TEST. The first crossfade check passed with this applied, because two beating partials moved its RMS windows more than the pan did. A click at the column rate would have shipped',
    file: 'src/audio/engine/tape-processor.js',
    find: '            const pv = p0 + (pan[b1 + r] - p0) * f;',
    replace: '            const pv = p0;',
  },
  {
    name: 'pan: paced budget not charged for the extra work',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'a 256-row image runs at double the intended cost per quantum, so §8.3s promise about never making a quantum late is priced in units that stopped meaning what they said',
    find: 'budget / (pan ? rows * 2 : rows)',
    replace: 'budget / rows',
  },
  {
    name: 'pan: a new image keeps the old positions',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'a new picture of the SAME shape renders using the previous one\'s positions, silently — no size check can catch it',
    find: '    // is the client\'s job, and `_specRender` is where forgetting shows up.\n    s.pan = null;',
    replace: '    // is the client\'s job, and `_specRender` is where forgetting shows up.',
  },
  {
    name: 'pan: colour axis mirrored',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/spectral-image.js',
    why: 'blue and red swap sides — arbitrary, but every project authored against the old direction is silently mirrored',
    find: 'out[i] = (rgba[p] - rgba[p + 2]) / 255;',
    replace: 'out[i] = (rgba[p + 2] - rgba[p]) / 255;',
  },
  {
    name: 'pan: colour averaged without luma weighting',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/spectral-image.js',
    why: 'a bright stroke drifts toward centre in proportion to how much black surrounds it, so the same stroke sits somewhere else on a darker background',
    find: 'const c = boxAverage(pic.chroma, pic.width, pic.height, rows, frames, pic.luma);',
    replace: 'const c = boxAverage(pic.chroma, pic.width, pic.height, rows, frames);',
  },
  {
    name: 'pan: Spread inverted',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/spectral-image.js',
    why: 'high pitches go left instead of right — the pan image disagrees with the magnitudes about which way up the picture is',
    find: '      const i = mode === PAN.SPREAD ? r : f;',
    replace: '      const i = mode === PAN.SPREAD ? (rows - 1 - r) : f;',
  },
  {
    name: 'pan: the shared y-flip removed',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/spectral-image.js',
    why: 'screen up stops being pitch up for BOTH images at once — the reason the flip is shared is that two copies could disagree',
    find: '      const top = rows - 1 - r;',
    replace: '      const top = r;',
  },
  {
    name: 'pan: width ignored',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/spectral-image.js',
    why: 'the Pan Width control does nothing and every image is full width',
    find: '      out[f * rows + r] = p * amount;',
    replace: '      out[f * rows + r] = p;',
  },
  {
    name: 'pan: uploaded before the image it describes',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'the engine refuses a pan image for an empty slot, so every render comes out mono with a refusal the performer has to notice',
    apply(src) {
      const data = '    this.engine.specData(0, rows, frames, mag);';
      const pan = '    if (pan) this.engine.specPan(0, rows, frames, pan);';
      const i = src.indexOf(data), j = src.indexOf(pan);
      if (i < 0 || j < 0 || i > j) return src;
      return src.slice(0, i) + pan + '\n' + data + src.slice(i + data.length, j) + src.slice(j + pan.length);
    },
  },
  {
    name: 'pan: the specPan call removed entirely',
    audit: 'audit-audio-pan.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'every render is mono and nothing says so — the ordering check passed on this before it guarded indexOf for -1',
    find: '    if (pan) this.engine.specPan(0, rows, frames, pan);\n',
    replace: '',
  },
  {
    name: 'pan: colour grabbed on every render',
    audit: 'audit-audio-pan.mjs',
    file: 'src/main.js',
    why: 'a per-pixel pass over the whole frame on every render, for a channel three of the four modes ignore',
    find: 'chroma: wantChroma ? chromaFromRGBA(rgba, w, h) : null,',
    replace: 'chroma: chromaFromRGBA(rgba, w, h),',
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Drawing the loop in the signal path display (§8.6, §8.13)
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'loop: graph-view re-derives loopLive instead of trusting the predicate',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'two answers to "is the loop closed", and the copy that drifts is the one drawing a safety marking',
    find: 'const loop = !s.loopLive',
    replace: 'const loop = !(s.running && s.micOpen && s.monitorLabel === \'Speakers\')',
  },
  {
    name: 'loop: carrying compares slot indices instead of spans',
    audit: 'audit-audio-signalpath.mjs',
    why: 'FOUND A REAL DEFECT — this is what shipped in the first draft. Nothing makes partitions disjoint, so a recorder and a reader over identical material on different slots is a live howl drawn dashed-grey',
    file: 'src/audio/graph-view.js',
    find: '|| overlaps(r.part, rec.part)',
    replace: '|| r.part === rec.part',
  },
  {
    name: 'loop: carrying always true',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'the red marking never goes away, so it stops meaning anything',
    find: 'r.unsafe || rec.unsafe || overlaps(r.part, rec.part)',
    replace: 'true',
  },
  {
    name: 'loop: partition overlap uses a closed interval',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'the default abutting quarters all "overlap" at their shared edge, so every layout reads as carrying',
    find: 'return pa.start < pb.start + pb.len && pb.start < pa.start + pa.len;',
    replace: 'return pa.start <= pb.start + pb.len && pb.start <= pa.start + pa.len;',
  },
  {
    name: 'loop: unknown partition bounds treated as disjoint',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'errs toward saying the loop is not carrying, which is the unsafe direction for a safety marking',
    find: 'if (!pa || !pb) return true;',
    replace: 'if (!pa || !pb) return false;',
  },
  {
    name: 'loop: return edge anchored the wrong way round',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'the bracket is drawn from the mic to the monitors, which is the forward path already shown as arrows',
    find: '    from: \'out\',\n    to: \'mic\',',
    replace: '    from: \'mic\',\n    to: \'out\',',
  },
  {
    name: 'loop: the limiter node dropped',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: '§4.11s non-bypassable ceiling vanishes from the one picture where a performer is looking at feedback',
    find: '  nodes.push({ key: \'limit\', label: \'limit\', type: \'active\' });\n',
    replace: '',
  },
  {
    name: 'loop: the row is drawn with the engine stopped',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'a strip about what the instrument is doing gains a row about something it is not doing',
    find: '  if (!s.running) return { nodes: [], loop: null };',
    replace: '  if (false) return { nodes: [], loop: null };',
  },
  {
    name: 'loop: the mic node stops reporting the device',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'the mic always draws live, so the row cannot say which link is open',
    find: 'type: s.micOpen ? \'source\' : \'node\'',
    replace: 'type: \'source\'',
  },
  {
    name: 'loop: the recorder stops naming its partition',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'you can no longer see WHICH partition is being written, which is half of reading whether the loop carries',
    find: 'label: s.rec.on ? `rec P${s.rec.part}` : \'rec\',',
    replace: 'label: \'rec\',',
  },
  {
    name: 'loop: one tooltip for every idle reason',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/graph-view.js',
    why: 'points at the wrong end of the chain in the most common case, in the one sentence whose only job is pointing at the right one',
    find: '    const why = !s.rec.on',
    replace: '    const why = false ? \'\'',
  },
  {
    name: 'loop: the measured bracket is never drawn',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/ui/UI.js',
    why: 'the drawing half of "draw the loop" silently disappears and only the label remains',
    find: '        if (b > a) {',
    replace: '        if (false) {',
  },
  {
    name: 'loop: the label shares the bracket\'s failure',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/ui/UI.js',
    why: 'a layout query returning zero takes the safety marking down with it — the two are deliberately on separate failures',
    find: '    if (loop) {\n      const tag = document.createElement(\'div\');',
    replace: '    if (loop && false) {\n      const tag = document.createElement(\'div\');',
  },
  {
    name: 'loop: the strip grows but never shrinks',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/ui/UI.js',
    why: 'Audio Off leaves 24px of empty strip forever',
    find: 'document.body.classList.toggle(\'sp-audio\', nodes.length > 0);',
    replace: 'if (nodes.length) document.body.classList.add(\'sp-audio\');',
  },
  {
    name: 'loop: no re-measure on window resize',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/ui/UI.js',
    why: 'the bracket spans the wrong two points until the next param change, because .sp-node flex-shrinks',
    find: '    window.addEventListener(\'resize\', () => this._render());\n',
    replace: '',
  },
  {
    name: 'loop: a typo in a subscribed partition id',
    audit: 'audit-audio-signalpath.mjs',
    why: 'FOUND A REAL GAP in the audit. `ps.get(id)?.onChange` swallows a miss, so dragging that partition silently stops re-measuring — and the hand-copied coverage list did not include these ids',
    file: 'src/ui/UI.js',
    find: '\'apart2.start\', \'apart2.len\'',
    replace: '\'apart2.start\', \'apart2.lenn\'',
  },
  {
    name: 'loop: a typo in a subscribed zone id',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/ui/UI.js',
    why: 'the same silent no-op, on an id the old hand-copied list did cover',
    find: '\'agrain.on\', \'agrain.part\', \'agrain.unsafe\',',
    replace: '\'agrain.on\', \'agrain.part\', \'agrain.unsaf\',',
  },
  {
    name: 'loop: the binding rebuilds the conjunction itself',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'the one predicate stops being the one predicate, and the two can now disagree',
    find: 'loopLive: this._loopLive(),',
    replace: 'loopLive: this.running && this.engine.micOpen,',
  },
  {
    name: 'loop: the binding stops sending partition spans',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'carrying falls back to the cautious default for every pair, so the red marking never appears',
    find: '      partBounds: Array.from({ length: PARTITION_SLOTS }, (_, i) => ({\n        start: v(`apart${i}.start`), len: v(`apart${i}.len`),\n      })),\n',
    replace: '',
  },
  {
    name: 'loop: no re-render on the microphone device edge',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/main.js',
    why: 'the mic opening is not a param change, so the drawn loop would never appear at all',
    find: '      signalPath?._render();\n      if (!loopEl) return;',
    replace: '      if (!loopEl) return;',
  },
  {
    name: 'loop: no re-measure when the hidden strip is shown',
    audit: 'audit-audio-signalpath.mjs',
    file: 'src/main.js',
    why: 'the strip is hidden by default, so the bracket is missing on its first showing for every user, every session',
    find: '      if (!_spHidden) signalPath?._render();\n',
    replace: '',
  },
];
