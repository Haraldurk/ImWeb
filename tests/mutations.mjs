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
  // Rearrangements that walk around a spelling
  //
  // LEARNED 2026-08-15: a regex over source asserts a SPELLING, and the defect
  // it guards against usually has more than one. These three mutate the code in
  // ways a reasonable person would write, chosen so the ORIGINAL regex stops
  // matching while the fault it names is fully present. Each one survived
  // before the audit it names was rewritten to ask about structure.
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'sw: a build-time constant reached for by another name',
    audit: 'audit-sw-cache-bump.mjs',
    file: 'public/sw.js',
    why: 'public/ is copied verbatim and never passes through Vite define, so ANY build-time constant throws a ReferenceError in the worker, install() never completes and the app silently stops working offline. The audit knew one spelling; this is an equally fatal one it could not see',
    find: "const CACHE = 'imweb-v0.22.1';",
    replace: "const CACHE = 'imweb-v' + import.meta.env.VITE_APP_VERSION;",
  },
  {
    name: 'sw: an app module pulled in by dynamic import',
    audit: 'audit-sw-cache-bump.mjs',
    file: 'public/sw.js',
    why: 'a service worker is not part of the bundle graph, so this fails at registration exactly as a static import would — but it is not at the start of a line, which is all the original check looked for',
    find: "const CACHE = ",
    replace: "const { helper } = await import('./assets/util.js');\nconst CACHE = ",
  },
  {
    name: 'autosave: serializeControllers called WITH an argument',
    audit: 'audit-mapping-autosave.mjs',
    file: 'src/state/MappingAutosave.js',
    why: 'NOTE: the audit behavioural check ("both mapped params were restored") catches this too, so it is not sole-source evidence for the text check — it was written to prove the text check, found it caught elsewhere, and the regex was made structural anyway. The autosave must never serialize controllers — doing so writes live controller state into the mapping file and it is restored over the project on load. Passing an argument is the ordinary way this call would evolve, and it defeats a regex anchored on the empty parens',
    find: 'return JSON.stringify(this.ps.serializeMappings());',
    replace: 'return JSON.stringify({ ...this.ps.serializeMappings(), c: this.ps.serializeControllers(this.ps) });',
  },
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
    name: 'advisory: a non-Claude agent file loses the pointer',
    audit: 'audit-learned-advisory-age.mjs',
    file: 'AGENTS.md',
    why: 'the gap this closed — "read docs/LEARNED.md" was ALREADY in AGENTS.md and the advisories still went unread, because nothing said which of the five tags has no mechanism behind it',
    // Removes the WHOLE pointer, which is the realistic regression: someone
    // trims the file and the paragraph goes with it. A first draft reworded one
    // sentence and survived — correctly, because AGENTS.md names the tag twice
    // and the file still did its job. A mutation has to represent a loss the
    // reader would actually suffer.
    apply(src) {
      const a = src.indexOf('   **Start with the');
      const b = src.indexOf('2. **Verify Line Numbers');
      if (a < 0 || b < 0 || a > b) return src;
      return src.slice(0, a) + src.slice(b);
    },
    expect(out) {
      const prose = out.replace(/```[\s\S]*?```/g, '');
      return !/\[advisory\]/.test(prose) && out.includes('docs/LEARNED.md');
    },
  },
  {
    name: 'advisory: the pull command is dropped from an agent file',
    audit: 'audit-learned-advisory-age.mjs',
    file: 'GEMINI.md',
    why: 'agents that cannot run session-advisory.sh have no other route to the list, so the pointer becomes advice to go and find something with no way to find it',
    find: 'grep -E \'^- [0-9]{4}-[0-9]{2}-[0-9]{2} \\[advisory\\]:\' docs/LEARNED.md',
    replace: 'grep advisory docs/LEARNED.md',
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

  // ═════════════════════════════════════════════════════════════════════════
  // Pixel ratio (audit-pixel-ratio.mjs)
  //
  // The regression these represent SHIPPED and went unnoticed for months,
  // because DPR = 2 renders an identical picture — the only symptom is an
  // instrument that became four times more expensive to draw at some moment
  // the user cannot correlate with anything. Found from the outside, by
  // reading frame timestamps out of the owner's own recordings.
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'dpr: the handler adopts the display ratio again',
    audit: 'audit-pixel-ratio.mjs',
    file: 'src/main.js',
    why: 'this is the original bug verbatim — one display move quadruples fill cost across 35+ shader passes, permanently, with an identical picture and no error to notice',
    // Anchored on the function signature, not on the line that used to follow
    // the call. The original pattern paired `setPixelRatio(1)` with the
    // `applyResolution(` beneath it, and PR #66 inserted an _applyUiScale()
    // call and a comment between the two — so the pattern matched nothing, the
    // audit passed because nothing had been broken, and the result was
    // indistinguishable from a genuine audit hole. Caught by property (a) of
    // the harness (LEARNED 2026-08-14): assert the mutation ACTUALLY APPLIED.
    // A declaration cannot drift the way an adjacent statement can, and there
    // is exactly one _onDPRChange.
    find: 'function _onDPRChange() {\n    renderer.setPixelRatio(1);',
    replace: 'function _onDPRChange() {\n    renderer.setPixelRatio(window.devicePixelRatio);',
  },
  {
    name: 'dpr: a variable ratio that happens to be 1 at boot',
    audit: 'audit-pixel-ratio.mjs',
    file: 'src/main.js',
    why: 'the plausible half-fix — reads correct on a non-Retina machine and reintroduces the whole defect on the owner\'s, which is exactly how it would come back',
    find: '  renderer.setPixelRatio(1); //',
    replace: '  renderer.setPixelRatio(_dpr); //',
  },
  {
    name: 'dpr: pinned the ratio by deleting the handler body',
    audit: 'audit-pixel-ratio.mjs',
    file: 'src/main.js',
    why: 'trades the ratio bug for two quieter ones — engine targets left stale after a display move, and a { once: true } listener that never re-arms, so a SECOND display change is invisible',
    find: '    applyResolution(ps.get(\'output.resolution\').value);\n    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`)\n      .addEventListener(\'change\', _onDPRChange, { once: true });\n  }',
    replace: '  }',
  },

  // ═════════════════════════════════════════════════════════════════════════
  // UI scale — the coordinate seam that `zoom` opens
  //
  // Every one of these is a defect that SHIPPED in the first cut of the UI
  // scale change and was found in review rather than testing, which is the
  // whole reason the audit exists: at scale 1 the two coordinate systems are
  // identical, so none of it is visible on the machine it was written on.
  //
  // Two of these mutations reproduce faults that were live in a pushed commit
  // (the zoomed scrim, and the raw viewport write), and one reproduces the
  // enumeration flaw in the audit's own first draft.
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'ui-scale: a full-viewport scrim joins the zoom set',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'this shipped — #mobile-state-modal was in the zoom list, and `inset: 0` at 2x is twice the viewport: the backdrop overflows the screen and the card it centres drifts off the bottom-right, unreachable',
    find: '#status-bar,\n#control-panel,',
    replace: '#kb-help,\n#status-bar,\n#control-panel,',
  },
  {
    name: 'ui-scale: a modal card loses its zoom',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'the inverse, and the reason the scrim/box split has two checks rather than one — the backdrop behaves but the shortcut card renders at 1x inside a 2x interface, i.e. unreadable on exactly the display the feature is for',
    find: '#onboarding-box,\n#kb-help-box,',
    replace: '#onboarding-box,',
  },
  {
    name: 'ui-scale: a raw viewport unit returns inside the zoom set',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'this shipped — 80vh inside a zoomed subtree resolves against the UNZOOMED viewport and is then multiplied, so at 2x the docs viewer is 160vh and its own titlebar and close button are clipped off the top of the screen',
    find: '    height: calc(80 * var(--vh));',
    replace: '    height: 80vh;',
  },
  {
    name: 'ui-scale: a scale-divided helper leaks outside the zoom set',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'the converse mistake, and the easier one to make once --vh exists: on an unzoomed element the division is never undone, so the value silently shrinks to half at 2x — here it would crop the picture rather than the chrome',
    // Anchored on the declaration too: `#output-panel {` alone matches twice,
    // the second inside a max-width media query.
    find: '#output-panel {\n    flex: 1;',
    replace: '#output-panel {\n    max-height: calc(90 * var(--vh));\n    flex: 1;',
  },
  {
    name: 'ui-scale: #app stops compensating for the chrome it does not scale with',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: '#app is the ONE element that is not zoomed but must clear chrome that is — drop the multiply and the whole app area sits tucked under the status bar at any scale above 1, hiding the first row of the panel and the top of the picture',
    find: '    top: calc(var(--status-h) * var(--ui-scale));',
    replace: '    top: var(--status-h);',
  },
  {
    name: 'ui-scale: the safe-area inset gets scaled with the type',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'an inset describing a physical bezel cutout is not a type-size preference — multiplying it strands a 68px dead band above the home indicator on iOS at 2x, and the plausible way to write it is exactly this, by folding env() inside the existing multiply',
    find: '        (var(--signal-h) + var(--state-h)) * var(--ui-scale) + env(safe-area-inset-bottom, 0px)',
    replace: '        (var(--signal-h) + var(--state-h) + env(safe-area-inset-bottom, 0px)) * var(--ui-scale)',
  },
  {
    name: 'ui-scale: the dead body font-size returns to the wide breakpoint',
    audit: 'audit-ui-scale.mjs',
    file: 'src/style.css',
    why: 'it looks like it fixes small type and was measured to reach ZERO elements, because all 198 font-size declarations are set on the elements themselves — re-adding it is how someone concludes the problem is handled and removes --ui-scale',
    find: '@media (min-width: 2560px) {\n    :root {',
    replace: '@media (min-width: 2560px) {\n    body {\n        font-size: 14px;\n    }\n    :root {',
  },
  {
    name: 'ui-scale: a zoomed surface is positioned from a raw viewport coordinate',
    audit: 'audit-ui-scale.mjs',
    file: 'src/ui/components/CtrlPopover.js',
    why: 'this shipped, five times over — gBCR is viewport px and style.left is element-local, so a zoomed popover lands at 2x the anchor: the controller editor opens far from the badge that summoned it, on the display the whole feature exists for',
    find: '  setViewportPos(popover, r.right + 4, r.top);',
    replace: '  popover.style.left = `${r.right + 4}px`;\n  popover.style.top  = `${r.top}px`;',
  },
  {
    name: 'ui-scale: a drag grabs its offset in the wrong coordinate space',
    audit: 'audit-ui-scale.mjs',
    file: 'src/main.js',
    why: 'the second form of the same fault and the more confusing one to debug — clientX is viewport, offsetLeft is element-local, so the panel jumps the moment you grab it and then tracks at twice the pointer speed',
    find: '      const b = panel.getBoundingClientRect();\n      ox = e.clientX - b.left;\n      oy = e.clientY - b.top;',
    replace: '      ox = e.clientX - panel.offsetLeft;\n      oy = e.clientY - panel.offsetTop;',
  },
  {
    name: 'ui-scale: the auto rule keys off viewport width instead of panel density',
    audit: 'audit-ui-scale.mjs',
    file: 'src/ui/layout/LayoutManager.js',
    why: 'this shipped and was caught in review — a width test doubles the interface on a 3440x1440 ultrawide, which is ordinary ~110 PPI desktop density that people run at 100%, and leaves a portrait 4K at 1x despite being the dense case it exists for',
    find: '  const physShort = Math.min(screenW, screenH) * dpr;\n  if (physShort < 2000) return 1;',
    replace: '  if (screenW < 3200) return 1;',
  },

  // ═════════════════════════════════════════════════════════════════════════
  // Output recorder (audit-recorder.mjs)
  //
  // Every one of these produces a file. That is the whole problem: the
  // recorder has no failing state to notice, only a slower, mis-named,
  // window-sized or wrongly-tapped one. Each mutation below is a change
  // someone would plausibly make on purpose, believing it was an improvement.
  // ═════════════════════════════════════════════════════════════════════════
  {
    name: 'recorder: VP8 promoted to first choice',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the merged investigation doc recommended exactly this, and a codec reference will agree that VP8 is cheaper than VP9 — it is, below ~2 MP, and it is 7x SLOWER at the 1440p preset the app ships (PR #72). The single most likely regression here, because it arrives as a documented performance fix',
    find: '          "video/mp4;codecs=avc1.640033,mp4a.40.2",',
    replace: '          "video/webm;codecs=vp8,opus",\n          "video/mp4;codecs=avc1.640033,mp4a.40.2",',
  },
  {
    name: 'recorder: WebM restored as first choice',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the pre-change order, and the one a merge conflict resolves to by taking "theirs" — VP9 has no hardware encoder on this machine, so this silently gives back the frames the whole upgrade was for',
    find: '          "video/mp4;codecs=avc1.640033,mp4a.40.2",\n          "video/mp4;codecs=avc1.640032,mp4a.40.2",\n          "video/webm;codecs=vp9,opus",',
    replace: '          "video/webm;codecs=vp9,opus",\n          "video/mp4;codecs=avc1.640033,mp4a.40.2",\n          "video/mp4;codecs=avc1.640032,mp4a.40.2",',
  },
  {
    name: 'recorder: H.264 level 5.0 offered before 5.1',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'looks like a harmless tidy-up putting the lower level first, and caps recording below 4K — L5.0 is refused at 3840x2160, so the 4K preset silently falls through to a software codec',
    find: '          "video/mp4;codecs=avc1.640033,mp4a.40.2",\n          "video/mp4;codecs=avc1.640032,mp4a.40.2",',
    replace: '          "video/mp4;codecs=avc1.640032,mp4a.40.2",\n          "video/mp4;codecs=avc1.640033,mp4a.40.2",',
  },
  {
    name: 'recorder: the download extension is hardcoded again',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the pre-change line, and the one anybody writes without thinking — an MP4 payload named .webm is a file some editors open and some silently refuse, and it reads as a codec fault rather than a naming one',
    find: '        a.download = `imweb-${Date.now()}.${ext}`;',
    replace: '        a.download = `imweb-${Date.now()}.webm`;',
  },
  {
    name: 'recorder: the Blob is labelled webm regardless of container',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the half-fix — extension derived, Blob type still assumed. Misleads every consumer of the Blob while the filename looks right',
    find: '        const blob = new Blob(recordChunks, { type });',
    replace: '        const blob = new Blob(recordChunks, { type: "video/webm" });',
  },
  {
    name: 'recorder: the Record select is re-linked to output.resolution',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'this was the SHIPPED state for two releases and its own comment admitted it — choosing a record size changes what the audience sees, and recording cost goes back to tracking window size',
    find: '  recSel.addEventListener("change", () => ps.set("output.recResolution", +recSel.value));',
    replace: '  recSel.addEventListener("change", () => ps.set("output.resolution", +recSel.value));',
  },
  {
    name: 'recorder: bitrate sized from the display canvas, not the capture',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the plausible half-fix after adding the record canvas — reads fine and is correct only while the two happen to be the same size, which is precisely the coupling this work removed',
    find: 'videoBitsPerSecond: _recVideoBitrate(surface.width, surface.height),',
    replace: 'videoBitsPerSecond: _recVideoBitrate(canvas.width, canvas.height),',
  },
  {
    name: 'recorder: the blit runs before the render gate',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'moving the copy "earlier so it is definitely fresh" makes the file follow the rAF clock instead of the rendered frames, so midisync/autosync gaps become duplicate frames — which reads as the instrument stuttering, not the recorder lying',
    find: '    noisePhase += ps.get(\'noise.speed\').value * dt;\n    if (_captureMode) return;',
    replace: '    noisePhase += ps.get(\'noise.speed\').value * dt;\n    _recBlit();\n    if (_captureMode) return;',
  },
  {
    name: 'recorder: the output recorder asks for a chunk cadence again',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the shipped state since v0.1 and the shape of every MediaRecorder example on the web — it reads as a streaming nicety and costs a 120-190 ms stall on a ~0.5 s period, about 12 fps, while nothing reads the chunks before onstop',
    find: '      mediaRecorder.start();',
    replace: '      mediaRecorder.start(100);',
  },
  {
    name: 'recorder: the clip recorder asks for a chunk cadence again',
    audit: 'audit-recorder.mjs',
    file: 'src/io/ClipLibrary.js',
    why: 'the same fossil in the second recorder — clips are short so the stall is easy to miss here, but it costs the same per second of recording',
    find: '      mr.start();',
    replace: '      mr.start(100);',
  },
  {
    name: 'recorder: the finished recording is never released',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'the shipped state, and it reads as ordinary download code — the URL keeps hundreds of MB alive for the life of the page, and the symptom is "the app gets slower the longer you use it", which nobody attributes to a download link',
    find: '        setTimeout(() => URL.revokeObjectURL(a.href), 5000);\n        mediaRecorder = null;',
    replace: '        mediaRecorder = null;',
  },
  {
    name: 'recorder: the audio tap moves off the limiter output',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'tapping the pre-limiter bus looks more "pure" and records a signal the audience never heard — one that can clip the file while the monitor sounded clean',
    find: '    _recAudioFrom = eng.node;',
    replace: '    _recAudioFrom = eng.ctx.destination;',
  },
  {
    name: 'recorder: a silent engine contributes a track anyway',
    audit: 'audit-recorder.mjs',
    file: 'src/main.js',
    why: 'dropping the guard looks like removing a special case, and produces a track of digital silence — worse than no track, because the file looks like it captured audio and came out empty',
    find: '    if (!eng?.ctx || !eng.node) return false;',
    replace: '    if (!eng?.ctx) return false;',
  },
];
