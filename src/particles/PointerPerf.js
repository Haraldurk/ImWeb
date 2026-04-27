export class PointerPerf {
  constructor(ghostNodes, canvas) {
    this._ghostNodes      = ghostNodes;
    this._canvas          = canvas;
    this.mode             = 'flow';
    this._fadeSec         = 0.8;    // overridden by particle.ghost.fadetime
    this._pointerRadius   = 0.08;   // overridden by particle.ghost.radius
    this._pointerStrength = 1.0;    // overridden by particle.ghost.strength (pointer part)

    this._activePointers  = new Map(); // pointerId → ghostId
    this._vortexT0        = new Map(); // pointerId → start timestamp (for vortex ramp)
    this._lastPos         = new Map(); // pointerId → {x, y} for velocity tracking
    this._lastTime        = new Map(); // pointerId → timestamp

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

  setMode(mode)         { this.mode = mode; }
  setFadeTime(secs)     { this._fadeSec = secs; }
  setRadius(r)          { this._pointerRadius = r; }
  setStrength(s)        { this._pointerStrength = s; }

  // Map UI pointer mode → ghost node options (correct physics per mode)
  _ghostOptions() {
    const r = this._pointerRadius;
    const s = this._pointerStrength;
    // Per-ghost strength is always 1.0 — the global particle.ghost.strength param
    // (→ uGhostStrength in PASS_B) is the single sensitivity lever. Using _pointerStrength
    // here too would cause quadratic scaling (strength² effect).
    const map = {
      flow:       { mode: 'flow',        strength: 1.0,  radius: r       },
      source:     { mode: 'repel',       strength: 1.0,  radius: r       },
      sink:       { mode: 'attract',     strength: 1.0,  radius: r       },
      vortex:     { mode: 'vortex',      strength: 0.0,  radius: r * 1.5 }, // ramps with hold
      turbulence: { mode: 'turbulence',  strength: 1.0,  radius: r * 1.2 },
      freeze:     { mode: 'freeze',      strength: 1.0,  radius: r       },
    };
    return map[this.mode] ?? map.flow;
  }

  // Y-flipped: CSS y=0 is canvas top; particle space y=0 is canvas bottom.
  _normalize(clientX, clientY) {
    const rect = this._canvas.getBoundingClientRect();
    return {
      x:  (clientX - rect.left)  / rect.width,
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

    // Seed position for velocity on first move
    this._lastPos.set(e.pointerId, { x, y });
    this._lastTime.set(e.pointerId, e.timeStamp);
  }

  _onPointerMove(e) {
    const ghostId = this._activePointers.get(e.pointerId);
    if (ghostId === undefined) return;

    const { x, y }  = this._normalize(e.clientX, e.clientY);
    const prev      = this._lastPos.get(e.pointerId);
    const prevT     = this._lastTime.get(e.pointerId) ?? e.timeStamp;
    const dt        = Math.max((e.timeStamp - prevT) / 1000, 0.001);

    if (this.mode === 'flow' && prev) {
      // Flow: compute pointer velocity, cap it, and push it into the SDF uniform
      const vx   = (x - prev.x) / dt;
      const vy   = (y - prev.y) / dt;
      const spd  = Math.sqrt(vx * vx + vy * vy);
      const maxS = 3.0; // max normalised units/sec
      const sc   = spd > maxS ? maxS / spd : 1.0;
      this._ghostNodes.setFlowVec(vx * sc, vy * sc);
    }

    if (this.mode === 'vortex') {
      // Vortex: spin strength ramps up with hold time (feels like stirring)
      const t0   = this._vortexT0.get(e.pointerId) ?? performance.now();
      const hold = (performance.now() - t0) / 1000;
      this._ghostNodes.update(ghostId, { pos: [x, y], strength: Math.min(hold * 2, this._pointerStrength * 4) });
    } else {
      this._ghostNodes.update(ghostId, { pos: [x, y] });
    }

    this._lastPos.set(e.pointerId, { x, y });
    this._lastTime.set(e.pointerId, e.timeStamp);
  }

  _onPointerUp(e) {
    const ghostId = this._activePointers.get(e.pointerId);
    if (ghostId === undefined) return;

    const fadeMs = this.mode === 'vortex'
      ? Math.max(this._fadeSec * 4000, 2000)
      : this._fadeSec * 1000;
    this._ghostNodes.scheduleFade(ghostId, fadeMs);

    // Note: uFlowVec is NOT zeroed here — the ghost strength fades to 0, so
    // flow force naturally dies off. Zeroing immediately kills the fade effect.

    this._activePointers.delete(e.pointerId);
    this._vortexT0.delete(e.pointerId);
    this._lastPos.delete(e.pointerId);
    this._lastTime.delete(e.pointerId);
  }

  dispose() {
    this._canvas.removeEventListener('pointerdown',   this._onDown);
    this._canvas.removeEventListener('pointermove',   this._onMove);
    this._canvas.removeEventListener('pointerup',     this._onUp);
    this._canvas.removeEventListener('pointerleave',  this._onCancel);
    this._canvas.removeEventListener('pointercancel', this._onCancel);
  }
}
