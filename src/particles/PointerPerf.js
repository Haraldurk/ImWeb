export class PointerPerf {
  constructor(ghostNodes, canvas) {
    this._ghostNodes     = ghostNodes;
    this._canvas         = canvas;
    this.mode            = 'flow';
    this._fadeSec        = 0.8;       // default, overridden by particle.ghost.fadetime param
    this._activePointers = new Map(); // pointerId → ghostId
    this._vortexT0       = new Map(); // pointerId → start timestamp

    this._onDown   = this._onPointerDown.bind(this);
    this._onMove   = this._onPointerMove.bind(this);
    this._onUp     = this._onPointerUp.bind(this);
    this._onCancel = this._onPointerUp.bind(this);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown',   this._onDown);
    canvas.addEventListener('pointermove',   this._onMove);
    canvas.addEventListener('pointerup',     this._onUp);
    canvas.addEventListener('pointerleave',  this._onCancel);
    canvas.addEventListener('pointercancel', this._onCancel);
  }

  setMode(mode)       { this.mode = mode; }
  setFadeTime(secs)   { this._fadeSec = secs; }

  // Mode → initial ghost options
  _ghostOptions() {
    const map = {
      flow:       { mode: 'vortex',  strength: 0.3, radius: 0.05 },
      sink:       { mode: 'attract', strength: 2.0, radius: 0.08 },
      vortex:     { mode: 'vortex',  strength: 0.0, radius: 0.08 },
      turbulence: { mode: 'vortex',  strength: 0.5, radius: 0.1  },
      freeze:     { mode: 'freeze',  strength: 1.0, radius: 0.06 },
      source:     { mode: 'repel',   strength: 1.0, radius: 0.06 },
    };
    return map[this.mode] ?? map.flow;
  }

  // Y-flipped: CSS y=0 is canvas top; particle space y=0 is canvas bottom.
  _normalize(clientX, clientY) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x:  (clientX - rect.left) / rect.width,
      y: 1.0 - (clientY - rect.top) / rect.height,
    };
  }

  _onPointerDown(e) {
    e.preventDefault();
    const { x, y } = this._normalize(e.clientX, e.clientY);

    // Option / Alt + click → permanent pin; not tracked, never faded
    if (e.altKey) {
      this._ghostNodes.add(x, y, { ...this._ghostOptions(), source: 'pinned' });
      return;
    }

    const ghostId = this._ghostNodes.add(x, y, { ...this._ghostOptions(), source: 'pointer' });
    this._activePointers.set(e.pointerId, ghostId);
    if (this.mode === 'vortex') this._vortexT0.set(e.pointerId, performance.now());
  }

  _onPointerMove(e) {
    const ghostId = this._activePointers.get(e.pointerId);
    if (ghostId === undefined) return;
    const { x, y } = this._normalize(e.clientX, e.clientY);

    if (this.mode === 'vortex') {
      const t0   = this._vortexT0.get(e.pointerId) ?? performance.now();
      const hold = (performance.now() - t0) / 1000;
      this._ghostNodes.update(ghostId, { pos: [x, y], strength: Math.min(hold * 2, 4) });
    } else {
      this._ghostNodes.update(ghostId, { pos: [x, y] });
    }
  }

  _onPointerUp(e) {
    const ghostId = this._activePointers.get(e.pointerId);
    if (ghostId === undefined) return;
    const fadeMs = this.mode === 'vortex' ? Math.max(this._fadeSec * 4000, 2000) : this._fadeSec * 1000;
    this._ghostNodes.scheduleFade(ghostId, fadeMs);
    this._activePointers.delete(e.pointerId);
    this._vortexT0.delete(e.pointerId);
  }

  dispose() {
    this._canvas.removeEventListener('pointerdown',   this._onDown);
    this._canvas.removeEventListener('pointermove',   this._onMove);
    this._canvas.removeEventListener('pointerup',     this._onUp);
    this._canvas.removeEventListener('pointerleave',  this._onCancel);
    this._canvas.removeEventListener('pointercancel', this._onCancel);
  }
}
