/**
 * ImWeb OSC Bridge
 *
 * Connects to a local WebSocket-to-OSC relay server (e.g. osc-relay, node-osc).
 * Default: ws://localhost:8080
 *
 * Incoming OSC messages are mapped to parameters by address:
 *   /imweb/<paramId>   value  →  param.setNormalized(value)
 *   /imweb/trigger/<id>       →  param.trigger()
 *   /imweb/preset/<n>         →  presetMgr.loadPreset(n)
 *
 * Outgoing: whenever a parameter changes its value is broadcast as:
 *   /imweb/<paramId>   value(normalized)
 *
 * The relay server format is simple JSON over WebSocket:
 *   { address: "/imweb/foo", args: [0.5] }
 */

const DEFAULT_URL = 'ws://localhost:8080';

export class OSCBridge {
  constructor(ps, presetMgr) {
    this.ps        = ps;
    this.presets   = presetMgr;
    this._ws       = null;
    this._url      = DEFAULT_URL;
    this._active   = false;
    this._retryTimer = null;
  }

  get active() { return this._active; }

  // ── Connect / Disconnect ──────────────────────────────────────────────────

  connect(url = DEFAULT_URL) {
    this._url = url;
    this._open();
  }

  disconnect() {
    clearTimeout(this._retryTimer);
    if (this._ws) {
      this._ws.onclose = null; // suppress auto-reconnect
      this._ws.close();
      this._ws = null;
    }
    this._active = false;
    this._updateIndicator(false);
  }

  // ── Send outgoing ─────────────────────────────────────────────────────────

  send(address, ...args) {
    if (!this._ws || this._ws.readyState !== WebSocket.OPEN) return;
    try {
      this._ws.send(JSON.stringify({ address, args }));
    } catch { /* ignore */ }
  }

  sendParam(param) {
    this.send(`/imweb/${param.id}`, param.normalized);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  _open() {
    if (this._ws) { this._ws.onclose = null; this._ws.close(); }

    try {
      this._ws = new WebSocket(this._url);
    } catch (err) {
      console.warn('[OSC] WebSocket open failed:', err.message);
      this._scheduleRetry();
      return;
    }

    this._ws.onopen = () => {
      console.info(`[OSC] Connected to ${this._url}`);
      this._active = true;
      this._updateIndicator(true);
    };

    this._ws.onclose = () => {
      this._active = false;
      this._updateIndicator(false);
      this._scheduleRetry();
    };

    this._ws.onerror = () => { /* handled by onclose */ };

    this._ws.onmessage = e => {
      try {
        const msg = JSON.parse(e.data);
        this._dispatch(msg.address, msg.args ?? []);
      } catch { /* ignore malformed */ }
    };
  }

  _scheduleRetry() {
    clearTimeout(this._retryTimer);
    this._retryTimer = setTimeout(() => this._open(), 3000);
  }

  _dispatch(address, args) {
    // /imweb/<paramId>  [value 0-1]
    const m = address.match(/^\/imweb\/(.+)$/);
    if (!m) return;

    const rest = m[1];

    // /imweb/preset/<n>
    if (rest.startsWith('preset/')) {
      const n = parseInt(rest.split('/')[1]);
      if (!isNaN(n)) this.presets?.loadPreset(n);
      return;
    }

    // /imweb/trigger/<id>
    if (rest.startsWith('trigger/')) {
      const id = rest.slice(8);
      this.ps.trigger(id);
      return;
    }

    // /imweb/<paramId>  [value]
    const p = this.ps.get(rest);
    if (!p) return;

    const val = typeof args[0] === 'number' ? args[0] : parseFloat(args[0]);
    if (!isNaN(val)) {
      if (p.type === 'toggle')  p.value = val > 0.5 ? 1 : 0;
      else if (p.type === 'trigger') p.trigger();
      else p.setNormalized(Math.max(0, Math.min(1, val)));
    }
  }

  _updateIndicator(on) {
    const el = document.getElementById('status-osc');
    el?.classList.toggle('active', on);
  }
}
