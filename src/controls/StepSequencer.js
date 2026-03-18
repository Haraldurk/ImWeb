/**
 * ImWeb Step Sequencer
 *
 * A beat-synced step sequencer that triggers preset / display-state changes
 * on each step. Steps cycle forward (or in a user-defined order).
 *
 * Usage:
 *   const seq = new StepSequencer(presetMgr);
 *   seq.setSteps([0, 1, 3, 0, 2, 1, 0, 3]); // preset indices
 *   seq.rate = 4;   // advance every 4 beats
 *   seq.active = true;
 *   // each frame:
 *   seq.tick(beatPhase);  // pass accumulated beat counter
 */

export class StepSequencer {
  constructor(presetMgr) {
    this.presets  = presetMgr;
    this.steps    = new Array(8).fill(-1); // -1 = skip this step
    this.rate     = 4;       // beats per step advance
    this.active   = false;
    this.step     = 0;       // current step index
    this._lastBeat = 0;      // beat counter at last advance
    this._lastTickBeat = -1; // prevents double-firing within same render frame

    this.onStep   = null;    // optional callback(stepIdx, presetIdx) on each step
  }

  get stepCount() { return this.steps.length; }

  setStepCount(n) {
    this.steps = this.steps.slice(0, n);
    while (this.steps.length < n) this.steps.push(-1);
    this.step = Math.min(this.step, n - 1);
  }

  setStep(idx, presetIdx) {
    if (idx >= 0 && idx < this.steps.length) {
      this.steps[idx] = presetIdx;
    }
  }

  reset() {
    this.step = 0;
    this._lastBeat = 0;
  }

  /**
   * Called every frame with the accumulated beat counter.
   * beatPhase increases by 1 each beat.
   */
  tick(beatPhase) {
    if (!this.active || !this.steps.length) return;

    // Quantise to grid: compute how many steps have elapsed
    const stepsElapsed = Math.floor(beatPhase / this.rate);
    if (stepsElapsed === this._lastTickBeat) return;
    this._lastTickBeat = stepsElapsed;

    const newStep = stepsElapsed % this.steps.length;
    if (newStep === this.step && stepsElapsed > 0) return; // no change

    this.step = newStep;
    const presetIdx = this.steps[this.step];

    if (presetIdx >= 0) {
      this.presets.activatePreset(presetIdx);
    }
    this.onStep?.(this.step, presetIdx);
  }

  /**
   * Manually advance to the next step (for manual trigger).
   */
  advance() {
    this.step = (this.step + 1) % this.steps.length;
    const presetIdx = this.steps[this.step];
    if (presetIdx >= 0) this.presets.activatePreset(presetIdx);
    this.onStep?.(this.step, presetIdx);
  }

  toJSON() {
    return { steps: [...this.steps], rate: this.rate, active: this.active };
  }

  fromJSON(data) {
    if (data.steps) this.steps = [...data.steps];
    if (data.rate  !== undefined) this.rate   = data.rate;
    if (data.active !== undefined) this.active = data.active;
    this.setStepCount(this.steps.length);
  }
}
