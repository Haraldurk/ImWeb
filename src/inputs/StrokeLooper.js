/**
 * ImWeb StrokeLooper — 4-slot stroke record/playback (looper-pedal grammar).
 *
 * Records resolved stroke segments from DrawLayer.onSegment as time-stamped
 * vector points. Brush state (size/opacity/color, pressure already applied)
 * is snapshotted per point, so playback is independent of the current pen
 * settings. Playback re-injects points through drawLayer.queuePoint with
 * origin 'loop{n}' — the same render path as live drawing, with its own
 * segment chain so loops and live strokes interleave cleanly in one frame.
 *
 * Loop-feedback guard: the recorder skips points whose origin starts with
 * 'loop' — arming a slot while another plays must not re-record playback
 * (origin is 'live'/'param' for user strokes, 'loop{n}' for playback:
 * the value varies at the check site).
 *
 * Slots free-run at independent playheads (different lengths polyrhythm
 * naturally). With draw.fade > 0 loops repaint each cycle while the canvas
 * decays — animated drawings by design.
 *
 * Params (registered in ParameterSystem, wired in main.js):
 *   drawloop{n}.rec    TRIGGER — press: arm+record, press again: stop+play
 *   drawloop{n}.play   TOGGLE
 *   drawloop{n}.clear  TRIGGER
 *   drawloop{n}.speed  CONTINUOUS 10–400 %
 */

export const LOOP_SLOTS = 4;

export class StrokeLooper {
  constructor(drawLayer, ps) {
    this.drawLayer = drawLayer;
    this.ps = ps;
    this.slots = Array.from({ length: LOOP_SLOTS }, () => this._emptySlot());
    this.onSlotChange = null; // (index) => void — param/UI sync hook

    // Tap the shared segment path (chain any existing callback)
    const prevCb = drawLayer.onSegment;
    drawLayer.onSegment = (raw, pt) => {
      prevCb?.(raw, pt);
      this._record(raw, pt);
    };
  }

  _emptySlot() {
    return {
      points: [],     // [{t, x, y, size, opacity, style, erase, start}]
      length: 0,      // seconds
      recording: false,
      playing: false,
      playhead: 0,
      recStart: 0,
      _idx: 0,        // next point to emit (points are time-ordered)
    };
  }

  _record(raw, pt) {
    const origin = raw.origin || 'live';
    if (origin.startsWith('loop')) return; // feedback guard
    const now = performance.now() / 1000;
    const size = this.drawLayer.canvas.width;
    for (const slot of this.slots) {
      if (!slot.recording) continue;
      slot.points.push({
        t: now - slot.recStart,
        x: pt.cx / size,
        y: pt.cy / size,
        size: (pt.lineW / size) * 100,   // pressure already applied
        opacity: pt.alpha * 100,
        style: pt.style,
        erase: pt.erase,
        start: !!raw.start || slot.points.length === 0,
      });
    }
  }

  /** rec trigger: not recording → arm+record; recording → stop and play. */
  toggleRecord(i) {
    const slot = this.slots[i];
    if (!slot.recording) {
      slot.points = [];
      slot.length = 0;
      slot.recording = true;
      slot.playing = false;
      slot.recStart = performance.now() / 1000;
    } else {
      slot.recording = false;
      slot.length = Math.max(0.1, performance.now() / 1000 - slot.recStart);
      slot.playhead = 0;
      slot._idx = 0;
      slot.playing = slot.points.length > 0;
    }
    this.onSlotChange?.(i);
  }

  setPlaying(i, on) {
    const slot = this.slots[i];
    const want = !!on && slot.points.length > 0;
    if (want === slot.playing) return;
    slot.playing = want;
    if (want) {
      slot.playhead = 0;
      slot._idx = 0;
    }
    this.onSlotChange?.(i);
  }

  clear(i) {
    this.slots[i] = this._emptySlot();
    this.onSlotChange?.(i);
  }

  /** Advance playheads and queue due points. Call before drawLayer.tick. */
  tick(dt) {
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      if (!slot.playing || !slot.points.length || slot.length <= 0) continue;
      const speed = (this.ps.get(`drawloop${i + 1}.speed`)?.value ?? 100) / 100;
      let head = slot.playhead + dt * speed;
      this._emit(slot, i, Math.min(head, slot.length), false);
      if (head >= slot.length) {
        head = head % slot.length;
        slot._idx = 0;
        // wrapped: force a fresh segment chain so the loop doesn't
        // connect its last point back to its first
        this._emit(slot, i, head, true);
      }
      slot.playhead = head;
    }
  }

  _emit(slot, i, to, wrapped) {
    let forceStart = wrapped;
    while (slot._idx < slot.points.length && slot.points[slot._idx].t <= to) {
      const p = slot.points[slot._idx++];
      this.drawLayer.queuePoint({
        x: p.x,
        y: p.y,
        size: p.size,
        opacity: p.opacity,
        style: p.style,
        erase: p.erase,
        start: p.start || forceStart,
        origin: `loop${i + 1}`,
      });
      forceStart = false;
    }
  }

  // ── Persistence (ProjectFile) ─────────────────────────────────────────

  serialize() {
    return {
      version: 1,
      slots: this.slots.map((s) => ({ points: s.points, length: s.length })),
    };
  }

  restore(data) {
    if (!data?.slots) return;
    data.slots.forEach((s, i) => {
      if (i >= this.slots.length) return;
      this.slots[i] = {
        ...this._emptySlot(),
        points: Array.isArray(s.points) ? s.points : [],
        length: s.length ?? 0,
      };
      this.onSlotChange?.(i);
    });
  }
}
