/**
 * ImWeb Beat Detector
 *
 * Energy-based beat detection from a Web Audio AnalyserNode.
 * Works by comparing instantaneous sub-bass energy to a running average.
 *
 * Usage:
 *   const bd = new BeatDetector(analyserNode, audioContext);
 *   // each frame:
 *   bd.tick();
 *   if (bd.beat) { ... }   // true for one frame on a beat
 *   bd.bpm                  // derived BPM (0 if not enough data)
 *
 * Algorithm:
 *   - Compute RMS of low-frequency bins (0–200 Hz)
 *   - Maintain a 1-second history of energy values
 *   - Beat when energy > threshold × running average
 *   - Derive BPM by averaging interval between recent beats
 */

const HISTORY_SIZE  = 43;   // ~1 second at 60fps
const BEAT_THRESH   = 1.4;  // energy must exceed 1.4× local average
const MIN_INTERVAL  = 0.3;  // seconds — ignore beats < 300ms apart (> 200BPM)
const BPM_SAMPLES   = 8;    // use last N beat intervals to average BPM

export class BeatDetector {
  constructor(analyser, audioCtx) {
    this._analyser  = analyser;
    this._audioCtx  = audioCtx;
    this._freqBuf   = new Uint8Array(analyser.frequencyBinCount);
    this._history   = new Float32Array(HISTORY_SIZE);
    this._histIdx   = 0;

    this._beatTimes = [];   // timestamps of recent beats
    this._lastBeat  = 0;    // time of last beat (seconds, audioCtx time)

    this.beat = false;      // true for one tick when a beat is detected
    this.bpm  = 0;          // derived BPM
    this.energy = 0;        // current normalised bass energy (0–1)
  }

  tick() {
    this.beat = false;
    if (!this._analyser) return;

    this._analyser.getByteFrequencyData(this._freqBuf);

    // Compute RMS energy of bass bins (roughly 0–200 Hz for 44.1kHz / 1024 FFT)
    // sampleRate / fftSize = Hz per bin
    const sampleRate  = this._audioCtx?.sampleRate ?? 44100;
    const hzPerBin    = sampleRate / (this._analyser.fftSize);
    const bassEndBin  = Math.round(200 / hzPerBin);
    let   sum         = 0;
    const end         = Math.min(bassEndBin, this._freqBuf.length);
    for (let i = 0; i < end; i++) {
      const v = this._freqBuf[i] / 255;
      sum += v * v;
    }
    const energy = end > 0 ? Math.sqrt(sum / end) : 0;
    this.energy  = energy;

    // Push into history ring
    this._history[this._histIdx] = energy;
    this._histIdx = (this._histIdx + 1) % HISTORY_SIZE;

    // Local average
    let avg = 0;
    for (let i = 0; i < HISTORY_SIZE; i++) avg += this._history[i];
    avg /= HISTORY_SIZE;

    // Beat threshold check
    const now = this._audioCtx?.currentTime ?? performance.now() / 1000;
    if (energy > BEAT_THRESH * avg && energy > 0.05 &&
        (now - this._lastBeat) > MIN_INTERVAL) {
      this.beat      = true;
      this._lastBeat = now;

      this._beatTimes.push(now);
      if (this._beatTimes.length > BPM_SAMPLES + 1) {
        this._beatTimes.shift();
      }

      // Derive BPM from beat intervals
      if (this._beatTimes.length >= 3) {
        let totalInterval = 0;
        for (let i = 1; i < this._beatTimes.length; i++) {
          totalInterval += this._beatTimes[i] - this._beatTimes[i - 1];
        }
        const avgInterval = totalInterval / (this._beatTimes.length - 1);
        const bpm = 60 / avgInterval;
        if (bpm > 40 && bpm < 240) {
          this.bpm = Math.round(bpm * 10) / 10;
        }
      }
    }
  }

  reset() {
    this._history.fill(0);
    this._beatTimes = [];
    this._lastBeat  = 0;
    this.beat       = false;
    this.bpm        = 0;
  }
}
