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
  // Promotion pressure on LEARNED.md
  //
  // These mutate the DATA rather than the code, because the data is what this
  // audit polices — and it means a PR touching LEARNED.md re-proves the audit
  // that guards it, via `mutate-affected.mjs`.
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'advisory: an entry written without a date',
    audit: 'audit-learned-advisory-age.mjs',
    file: 'docs/LEARNED.md',
    why: 'the easiest way to silence a promotion-pressure audit forever — the parser matches only dated entries, so an undated one is not exempt, it is INVISIBLE, and it ages without ever being counted',
    find: '- 2026-07-12 [advisory]: Before writing any integration',
    replace: '- [advisory]: Before writing any integration',
  },
  {
    name: 'advisory: an entry that has aged past the boundary',
    audit: 'audit-learned-advisory-age.mjs',
    file: 'docs/LEARNED.md',
    why: 'the whole point of the audit — a lesson carried in prose past 90 days is one the repo has agreed to keep re-learning, and it must go red rather than quietly persist',
    find: '- 2026-07-12 [advisory]: Before writing any integration',
    replace: '- 2020-01-01 [advisory]: Before writing any integration',
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Structural edits a running zone cannot honour (§4.3 / §4.4)
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'rec: a running recorder parks the partition change again',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'FOUND BY A PERFORMER, not by a test — "recording to P0, P1, P2, P3, it all goes to P0". Nothing drains `pend` for a rec zone, so the change parks forever: the UI moves, the take does not, and nothing is reported',
    find: '    if (type === \'rec\' && z.on) {\n      return this._refuse(REFUSE_LAYOUT_LOCKED,\n        `rec zone ${i} is recording; stop it to change partition`);\n    }\n',
    replace: '',
  },
  {
    name: 'rec: the refusal fires but the change is applied anyway',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'refusing and then doing it is worse than either — writePos would be reinterpreted against the new span mid-take, so the recording resumes in the MIDDLE of the new region',
    find: '      return this._refuse(REFUSE_LAYOUT_LOCKED,\n        `rec zone ${i} is recording; stop it to change partition`);',
    replace: '      this._refuse(REFUSE_LAYOUT_LOCKED,\n        `rec zone ${i} is recording; stop it to change partition`);\n      z.part = slot; return;',
  },
  {
    name: 'rec: the branch swallows stopped zones too',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'refusing a change to a stopped recorder makes the documented workaround — stop it, move it, start it — stop working, so there would be no way to change partition at all',
    find: 'if (type === \'rec\' && z.on) {',
    replace: 'if (type === \'rec\') {',
  },
  {
    name: 'rec: the branch is placed before the range check',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'an out-of-range slot on a running recorder would report the wrong reason — "stop it to change partition" for a partition that does not exist',
    // Scoped to the METHOD, because the range check's text occurs three times in
    // this file and a whole-file `String.replace` takes the first — which is how
    // the first draft of this entry inserted the branch into `_render` instead,
    // got caught anyway, and tested nothing. `expect` below is what noticed.
    apply(src) {
      const head = '  _zonePart(type, i, slot) {';
      const a = src.indexOf(head);
      if (a < 0) return src;
      const b = src.indexOf('\n  }\n', a);
      const body = src.slice(a, b);
      const range = '    if (!(slot >= 0 && slot < MAX_PARTITIONS)) {\n';
      const rec = '    if (type === \'rec\' && z.on) {\n      return this._refuse(REFUSE_LAYOUT_LOCKED,\n        `rec zone ${i} is recording; stop it to change partition`);\n    }\n';
      if (!body.includes(range) || !body.includes(rec)) return src;
      const moved = body.replace(rec, '').replace(range, rec + range);
      return src.slice(0, a) + moved + src.slice(b);
    },
    expect(out) {
      const a = out.indexOf('  _zonePart(type, i, slot) {');
      const body = out.slice(a, out.indexOf('\n  }\n', a));
      const iRec = body.indexOf('stop it to change partition');
      const iRange = body.indexOf('MAX_PARTITIONS');
      // Both still inside THIS method, and the rec branch now precedes the check.
      return iRec > 0 && iRange > 0 && iRec < iRange;
    },
  },
  {
    name: 'rec: the client stops reverting a refused partition',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'REPORTED TWICE. The engine refusal keeps the audio right but the param has already moved, so the button, the tape display and the recording disagree — "recording into P1, it still goes into P0", now with a message nobody reads',
    find: '        if (type === \'rec\' && this.ps.get(\'arec.on\').value) {\n          this._applyFromEngine(\'arec.part\', this._recPart);\n          return this._say(\'recording — stop Run Rec to change its partition\');\n        }\n',
    replace: '',
  },
  {
    name: 'rec: the client reverts but sends anyway',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'the param springs back but the engine still gets the refused value, so the status line fills with refusals during ordinary use and the two halves disagree about what was asked',
    find: '          return this._say(\'recording — stop Run Rec to change its partition\');',
    replace: '          this._say(\'recording — stop Run Rec to change its partition\');',
  },
  {
    name: 'rec: the revert goes through a plain set',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'without the echo suppression the revert re-enters its own handler with the old value and sends it to the engine again — a write loop on every refused click',
    find: '          this._applyFromEngine(\'arec.part\', this._recPart);',
    replace: '          this.ps.set(\'arec.part\', this._recPart);',
  },
  {
    name: 'rec: the mirror stops tracking what was sent',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/AudioBinding.js',
    why: 'the revert would restore a stale slot, putting the client and engine out of step in the other direction — the same bug mirrored',
    find: '    if (type === \'rec\') this._recPart = slot;',
    replace: '',
  },

  {
    name: 'rec: playback loses its duck as collateral',
    audit: 'audit-audio-dsp.mjs',
    file: 'src/audio/engine/tape-processor.js',
    why: 'the fix is a branch for ONE type, not a blanket rule — a playback zone must still defer through the gain ramp rather than jumping mid-read',
    find: 'if (type === \'rec\' && z.on) {',
    replace: 'if (z.on) {',
  },

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
    expect(out) {
      const i = out.indexOf('this.engine.specData(0, rows, frames, mag)');
      const j = out.indexOf('this.engine.specPan(0, rows, frames, pan)');
      return i > 0 && j > 0 && j < i;   // pan now precedes data, which is the defect
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
