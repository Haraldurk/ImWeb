/**
 * MontyBridge — connects ImWeb to the Monty brain-model WebSocket server.
 *
 * Receives JSON v1 messages: { v, t, saccade:[x,y], confidence, prediction_error, source }
 * Maps them to ParameterSystem:
 *   saccade[0] × (frameCount-1) → buffer.fs1
 *   (1 - confidence) × 32      → buffer.scatter
 *   prediction_error > 0.7     → buffer.capture (trigger)
 *
 * Smoothing: ps.set() respects per-param slew configured in the UI — no
 * separate lerp needed here.
 *
 * frameCount is read live from stillsBuffer on each message so buffer
 * resizes mid-session are handled correctly.
 */
export class MontyBridge {
  constructor(ps, stillsBuffer, { url = 'ws://localhost:8765' } = {}) {
    this._ps           = ps;
    this._stillsBuffer = stillsBuffer;
    this._url          = url;
    this._ws           = null;
    this._active       = false;
    this._versionWarned = false;
    this._source       = '—';
    this._backoff      = 1000;
    this._retryTimer   = null;
    this._statusEl     = null;
  }

  get active() { return this._active; }
  get url()    { return this._url; }

  /** Attach a DOM element whose .querySelector('.monty-dot') and
   *  .querySelector('.monty-source') will be updated on status change. */
  setStatusEl(el) { this._statusEl = el; }

  connect(url = this._url) {
    this._url    = url;
    this._active = true;
    this._openWs();
  }

  disconnect() {
    this._active = false;
    clearTimeout(this._retryTimer);
    if (this._ws) { this._ws.close(); this._ws = null; }
    this._updateBadge('disconnected');
  }

  _openWs() {
    this._versionWarned = false;
    let ws;
    try {
      ws = new WebSocket(this._url);
    } catch (e) {
      console.warn('MontyBridge: bad URL', this._url, e.message);
      this._scheduleRetry();
      return;
    }
    this._ws = ws;

    ws.onopen = () => {
      this._backoff = 1000;
      this._updateBadge('connected');
    };

    ws.onmessage = ({ data }) => this._onMessage(data);

    ws.onclose = ws.onerror = () => {
      this._ws = null;
      this._updateBadge('disconnected');
      if (this._active) this._scheduleRetry();
    };
  }

  _scheduleRetry() {
    this._retryTimer = setTimeout(() => this._openWs(), this._backoff);
    this._backoff    = Math.min(this._backoff * 2, 30_000);
  }

  _onMessage(raw) {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.v !== 1) {
      if (!this._versionWarned) {
        console.warn(`MontyBridge: unknown schema v${msg.v}, expected 1. Ignoring until reconnect.`);
        this._versionWarned = true;
      }
      return;
    }

    if (Date.now() - msg.t > 500) return; // stale

    const n = this._stillsBuffer.frameCount; // live — correct after buffer resize
    this._ps.set('buffer.fs1',     msg.saccade[0] * (n - 1));
    this._ps.set('buffer.scatter', (1 - msg.confidence) * 32);
    if (msg.prediction_error > 0.7) this._ps.trigger('buffer.capture');

    this._source = msg.source ?? '—';
    this._updateBadge('connected');
  }

  _updateBadge(state) {
    if (!this._statusEl) return;
    const dot = this._statusEl.querySelector('.monty-dot');
    const src = this._statusEl.querySelector('.monty-source');
    if (dot) {
      dot.style.color = state === 'connected'
        ? (this._source === 'live' ? '#c8a020' : '#40c060')
        : '#404050';
    }
    if (src) src.textContent = state === 'connected' ? this._source.toUpperCase() : '—';
  }
}
