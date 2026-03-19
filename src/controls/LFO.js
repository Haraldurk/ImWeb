/**
 * ImWeb LFO System
 * Shapes: sine, triangle, sawtooth, rampdown, square (with pulse width), sh (sample & hold)
 * Modes:  norm (free-running), shot (one cycle), xmap (externally triggered)
 * Beat sync: when beatSync=true, phase is driven by external beatPhase (stays locked to BPM)
 * All LFOs retrigger on DisplayState recall.
 */

export const LFO_SHAPE = {
  SINE:         'sine',
  TRIANGLE:     'triangle',
  SAWTOOTH:     'sawtooth',
  RAMP_DOWN:    'rampdown',
  SQUARE:       'square',
  SAMPLE_HOLD:  'sh',
};
export const LFO_MODE  = { NORM: 'norm', SHOT: 'shot', XMAP: 'xmap' };

export class LFO {
  constructor({
    shape    = LFO_SHAPE.SINE,
    hz       = 0.5,
    phase    = 0,
    mode     = LFO_MODE.NORM,
    width    = 0.5,
    beatSync = false,
    beatDiv  = 1,
  } = {}) {
    this.shape    = shape;
    this.hz       = hz;
    this.phase    = phase; // 0–1 initial phase offset
    this.mode     = mode;
    this.width    = width;    // pulse width for square wave (0–1)
    this.beatSync = beatSync; // if true, tickBeat() drives phase from external clock
    this.beatDiv  = beatDiv;  // beats per cycle (1=one beat, 2=two beats, 0.5=half beat)

    this._t             = phase; // current phase accumulator 0–1
    this._running       = true;
    this._cycleComplete = false;
    this._shValue       = Math.random(); // held value for sample-and-hold
    this._prevBeatT     = -1;
  }

  // Free-running tick — called every frame with delta time in seconds. Returns 0–1.
  tick(dt) {
    if (!this._running) return this._sample(this._t);

    const prevT = this._t;
    this._t += this.hz * dt;

    if (this.mode === LFO_MODE.SHOT) {
      if (this._t >= 1) {
        this._t = 1;
        this._running = false;
        this._cycleComplete = true;
      }
    } else {
      // Detect cycle boundary for S&H
      if (this.shape === LFO_SHAPE.SAMPLE_HOLD && Math.floor(this._t) > Math.floor(prevT)) {
        this._shValue = Math.random();
      }
      this._t = this._t % 1;
    }

    return this._sample(this._t);
  }

  // Beat-synced tick — phase locked to external beatPhase counter. Returns 0–1.
  tickBeat(beatPhase) {
    const t = ((beatPhase / this.beatDiv) + this.phase) % 1;
    // Detect cycle boundary for S&H (when t wraps below previous t)
    if (this.shape === LFO_SHAPE.SAMPLE_HOLD) {
      if (this._prevBeatT >= 0 && t < this._prevBeatT - 0.5) {
        this._shValue = Math.random();
      }
    }
    this._prevBeatT = t;
    this._t = t;
    return this._sample(t);
  }

  retrigger() {
    this._t = this.phase;
    this._running = true;
    this._cycleComplete = false;
    this._prevBeatT = -1;
  }

  _sample(t) {
    switch (this.shape) {
      case LFO_SHAPE.SINE:
        return 0.5 + 0.5 * Math.sin(t * Math.PI * 2);
      case LFO_SHAPE.TRIANGLE:
        return t < 0.5 ? t * 2 : 2 - t * 2;
      case LFO_SHAPE.SAWTOOTH:
        return t;
      case LFO_SHAPE.RAMP_DOWN:
        return 1 - t;
      case LFO_SHAPE.SQUARE:
        return t < this.width ? 1 : 0;
      case LFO_SHAPE.SAMPLE_HOLD:
        return this._shValue;
      default:
        return t;
    }
  }

  serialize() {
    return {
      shape: this.shape, hz: this.hz, phase: this.phase,
      mode: this.mode, width: this.width,
      beatSync: this.beatSync, beatDiv: this.beatDiv,
    };
  }
}

// LFOController wraps an LFO for use with the parameter system
export class LFOController {
  constructor(config = {}) {
    this.type = `lfo-${config.shape ?? 'sine'}`;
    this.lfo  = new LFO(config);
    this.min  = config.min ?? 0;
    this.max  = config.max ?? 1;
  }

  // beatPhase is the global beat accumulator (beats since start)
  tick(dt, beatPhase = 0) {
    const raw = this.lfo.beatSync
      ? this.lfo.tickBeat(beatPhase)
      : this.lfo.tick(dt);
    return this.min + raw * (this.max - this.min);
  }

  retrigger() { this.lfo.retrigger(); }

  serialize() {
    return { type: this.type, ...this.lfo.serialize(), min: this.min, max: this.max };
  }
}
