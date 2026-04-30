// src/perf-logger.js
// Lightweight frame-timing logger for the perf sprint.
// Call perfFrame(now) once per RAF callback. Logs a summary every REPORT_INTERVAL_S seconds.
// Access window.__perfStats in DevTools for live data.

const REPORT_INTERVAL_S = 5;
const JANK_THRESHOLD_MS = 20; // >20ms = dropped frame at 60fps
const HISTORY = 120; // rolling window for avg/p95

let _prev = 0;
let _frameTimes = [];
let _jankCount = 0;
let _worstMs = 0;
let _reportTimer = 0;

export function perfFrame(now) {
  if (_prev === 0) { _prev = now; return; }
  const ms = now - _prev;
  _prev = now;

  _frameTimes.push(ms);
  if (_frameTimes.length > HISTORY) _frameTimes.shift();
  if (ms > JANK_THRESHOLD_MS) _jankCount++;
  if (ms > _worstMs) _worstMs = ms;

  _reportTimer += ms / 1000;
  if (_reportTimer >= REPORT_INTERVAL_S) {
    _reportTimer = 0;
    const avg = _frameTimes.reduce((a, b) => a + b, 0) / _frameTimes.length;
    const sorted = [..._frameTimes].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const fps = 1000 / avg;
    const stats = {
      fps: +fps.toFixed(1),
      avg_ms: +avg.toFixed(2),
      p95_ms: +(p95 ?? 0).toFixed(2),
      worst_ms: +_worstMs.toFixed(2),
      jank: _jankCount,
    };
    window.__perfStats = stats;
    console.log('[perf]', JSON.stringify(stats));
    _jankCount = 0;
    _worstMs = 0;
  }
}

export function getPerfStats() {
  return window.__perfStats ?? null;
}
