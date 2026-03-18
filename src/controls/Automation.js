/**
 * ImWeb Automation Recorder
 *
 * Records parameter changes over time and loops them back.
 * A single automation clip can contain multiple parameters.
 *
 * Usage:
 *   auto.startRecord()  — begin capturing all param changes
 *   auto.stopRecord()   — end capture, loop the recorded clip
 *   auto.play()         — start playback
 *   auto.stop()         — stop playback
 *   auto.clear()        — erase recorded clip
 */

export class Automation {
  constructor(ps) {
    this.ps      = ps;
    this._events = [];       // [{ time, id, value }, ...]
    this._duration = 0;
    this._recording = false;
    this._playing   = false;
    this._recStart  = 0;
    this._playHead  = 0;    // current time in seconds
    this._nextEvt   = 0;    // index into _events during playback
    this._unsubscribers = [];
  }

  get recording() { return this._recording; }
  get playing()   { return this._playing; }
  get duration()  { return this._duration; }
  get eventCount(){ return this._events.length; }

  // ── Record ────────────────────────────────────────────────────────────────

  startRecord() {
    if (this._recording) return;
    this._events    = [];
    this._duration  = 0;
    this._recStart  = performance.now() / 1000;
    this._recording = true;
    this._playing   = false;
    this._playHead  = 0;

    // Subscribe to all continuous params
    this._unsubscribers = this.ps.getAll()
      .filter(p => p.type === 'continuous')
      .map(p => p.onChange((v, param) => {
        if (!this._recording) return;
        const t = performance.now() / 1000 - this._recStart;
        this._events.push({ time: t, id: param.id, value: v });
      }));
  }

  stopRecord() {
    if (!this._recording) return;
    this._recording = false;
    this._duration  = performance.now() / 1000 - this._recStart;
    this._unsubscribers.forEach(fn => fn());
    this._unsubscribers = [];
    // Sort by time (should already be sorted but ensure)
    this._events.sort((a, b) => a.time - b.time);
    this._playHead = 0;
    this._nextEvt  = 0;
  }

  // ── Playback ──────────────────────────────────────────────────────────────

  play() {
    if (!this._events.length || this._duration <= 0) return;
    this._playing  = true;
    this._playHead = 0;
    this._nextEvt  = 0;
  }

  stop() {
    this._playing = false;
  }

  clear() {
    this._events   = [];
    this._duration = 0;
    this._playing  = false;
    this._recording = false;
  }

  /**
   * Called from render loop with delta time in seconds.
   * Fires parameter updates for all events in the current time window.
   */
  tick(dt) {
    if (!this._playing || this._duration <= 0) return;

    this._playHead += dt;

    // Loop
    if (this._playHead >= this._duration) {
      this._playHead = this._playHead % this._duration;
      this._nextEvt  = 0;
    }

    // Fire all events up to current playhead
    while (this._nextEvt < this._events.length &&
           this._events[this._nextEvt].time <= this._playHead) {
      const evt = this._events[this._nextEvt];
      const p   = this.ps.get(evt.id);
      if (p && !p.controller) p.value = evt.value; // only if not controlled
      this._nextEvt++;
    }
  }
}
