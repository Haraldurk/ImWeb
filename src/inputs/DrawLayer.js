/**
 * ImWeb DrawLayer
 *
 * A 512×512 canvas texture the user paints on in real time.
 * Controlled entirely via parameters:
 *
 *   draw.pensize      > 0  → paint at (draw.x, draw.y)
 *   draw.erasesize    > 0  → erase at (draw.x, draw.y)
 *   draw.x / draw.y        → cursor position 0–100
 *   draw.color.h/s/v       → pen color (HSV, defaults to white when sat=0)
 *   draw.opacity           → stroke alpha 1–100 %
 *   draw.fade              → per-frame decay 0 (none) → 1 (instant clear)
 *   draw.clear             → TRIGGER — wipes canvas to black
 *
 * The canvas is exposed as `drawLayer.texture` (THREE.CanvasTexture)
 * and `drawLayer.canvas` for direct DOM embedding (live preview in UI).
 */

import * as THREE from 'three';

const SIZE = 512;

export class DrawLayer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = SIZE;

    this.ctx = this.canvas.getContext('2d', { willReadFrequently: false });

    // Start with opaque black
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    // Stroke state (param-driven chain continuity)
    this._wasActive = false;

    // Pre-allocated fade rect (avoid per-frame object creation)
    this._fadeTick  = 0;

    // Point queue (pointer events / loop playback). Segment chains are kept
    // per origin so live strokes and loop playback can interleave in one
    // frame without connecting to each other.
    this._queue        = [];
    this._prevByOrigin = {};
    this.onSegment     = null;   // callback(rawPt, resolvedPt) — stroke recorder tap
    this.strokeActive  = false;  // true while any ink landed this frame
    this.liveStroke    = false;  // set by pointer handlers while a pointer is down;
                                 // suppresses the param fallback between pointer events
    this.inkVideo      = null;   // <video> element for Camera/Movie ink source
    this.inkSource     = 0;      // draw.inkSource value (0=Color, 1=Camera, 2=Movie)
  }

  /**
   * Queue a stroke point (0–1 canvas space, y down).
   * pt: { x, y, pressure?, erase?, size?, opacity?, color?:{h,s,v}, start?, origin? }
   * Missing brush fields resolve from current draw.* params at drain time;
   * explicit fields (loop playback) override them. `start:true` breaks the
   * segment chain for that origin.
   */
  queuePoint(pt) {
    this._queue.push(pt);
  }

  /**
   * Draw one resolved point: a segment from `prev` or a dot when starting.
   * Shared by live pointer input, param-driven drawing, and loop playback.
   * pt: { cx, cy, lineW, alpha, style, erase }
   */
  drawSegment(pt, prev) {
    const ctx = this.ctx;
    const video = (!pt.erase && this.inkSource > 0) ? this.inkVideo : null;

    // When using a video ink source AND the video is ready, the brush
    // path acts as a stencil: clip to the brush shape, then stamp video
    // pixels through it. Erasing always uses solid black regardless.
    if (video && video.readyState >= 2) {
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = pt.alpha;
      ctx.save();
      ctx.beginPath();
      if (prev) {
        ctx.moveTo(prev.cx, prev.cy);
        ctx.lineTo(pt.cx, pt.cy);
      } else {
        ctx.arc(pt.cx, pt.cy, pt.lineW / 2, 0, Math.PI * 2);
      }
      // Round-cap strokes: thicken the stencil so it fully contains the
      // line geometry — clip() with a stroked path only clips the stroke
      // itself. Fill the equivalent shape instead.
      ctx.lineWidth = pt.lineW;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      ctx.clip();

      // Map draw-space position to video pixel coordinates.
      // The draw canvas is SIZE×SIZE; the video is video.videoWidth ×
      // video.videoHeight. We stamp a region proportional to the brush
      // size so that small brushes capture a tight crop and large brushes
      // spread a wider area of the video frame.
      const vw = video.videoWidth;
      const vh = video.videoHeight;
      const stampW = Math.max(1, (pt.lineW / SIZE) * vw);
      const stampH = Math.max(1, (pt.lineW / SIZE) * vh);
      const sx = Math.max(0, Math.min(vw - stampW, (pt.cx / SIZE) * vw - stampW / 2));
      const sy = Math.max(0, Math.min(vh - stampH, (pt.cy / SIZE) * vh - stampH / 2));
      ctx.drawImage(
        video,
        sx, sy, stampW, stampH,
        pt.cx - pt.lineW / 2, pt.cy - pt.lineW / 2, pt.lineW, pt.lineW,
      );
      ctx.restore();
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
      return;
    }

    // Solid-color brush (original path)
    ctx.globalCompositeOperation = pt.erase ? 'destination-out' : 'source-over';
    ctx.globalAlpha = pt.erase ? 1 : pt.alpha;
    ctx.strokeStyle = pt.style;
    ctx.fillStyle   = pt.style;
    ctx.lineWidth   = pt.lineW;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';

    ctx.beginPath();
    if (prev) {
      ctx.moveTo(prev.cx, prev.cy);
      ctx.lineTo(pt.cx, pt.cy);
      ctx.stroke();
    } else {
      ctx.arc(pt.cx, pt.cy, pt.lineW / 2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  }

  /**
   * Fill a queued point's missing brush fields from draw.* params and apply
   * pressure scaling. Returns a resolved point for drawSegment().
   */
  _resolve(raw, ps) {
    const erase = !!raw.erase;
    const baseSize = raw.size ??
      (erase ? ps.get('draw.erasesize').value : ps.get('draw.pensize').value);
    const baseOpacity = raw.opacity ?? (ps.get('draw.opacity')?.value ?? 100);

    const pr    = raw.pressure ?? 1;
    const pAmtS = (ps.get('draw.pressure.size')?.value ?? 100) / 100;
    const pAmtO = (ps.get('draw.pressure.opacity')?.value ?? 0) / 100;
    const size  = Math.max(0.5, baseSize * (1 + (pr - 1) * pAmtS));
    const alpha = Math.min(1, Math.max(0.01, (baseOpacity / 100) * (1 + (pr - 1) * pAmtO)));

    let style;
    if (erase) {
      style = 'rgba(0,0,0,1)';
    } else if (raw.style) {
      style = raw.style; // pre-resolved CSS color (loop playback)
    } else if (raw.color) {
      style = _hsvToHsl(raw.color.h, raw.color.s, raw.color.v);
    } else {
      style = _hsvToHsl(
        ps.get('draw.color.h')?.value ?? 0,
        ps.get('draw.color.s')?.value ?? 0,
        ps.get('draw.color.v')?.value ?? 100,
      );
    }

    return {
      cx: raw.x * SIZE,
      cy: raw.y * SIZE,
      lineW: Math.max(1, size * SIZE / 100),
      alpha,
      style,
      erase,
      start: !!raw.start,
      origin: raw.origin || 'live',
    };
  }

  /**
   * Called every frame. Reads draw.* params and updates canvas.
   */
  tick(ps) {
    const penSize   = ps.get('draw.pensize').value;
    const eraseSize = ps.get('draw.erasesize').value;
    const nx = ps.get('draw.x').value / 100;
    const ny = 1 - (ps.get('draw.y').value / 100); // flip Y

    // ── Fade / decay ──────────────────────────────────────────────────────
    let dirty = false;
    const fade = ps.get('draw.fade')?.value ?? 0;
    if (fade > 0) {
      // Apply fade every frame: draw a semi-transparent black rectangle
      // fade=1 → opacity 1 (instant clear), fade=0.01 → very slow decay
      const alpha = Math.min(1, fade * 0.5); // scale so small values feel gentle
      this.ctx.globalCompositeOperation = 'source-over';
      this.ctx.globalAlpha = alpha;
      this.ctx.fillStyle = '#000000';
      this.ctx.fillRect(0, 0, SIZE, SIZE);
      this.ctx.globalAlpha = 1;
      dirty = true;
    }

    // ── Param-driven drawing (LFO/MIDI/Automation on draw.x/draw.y) ──────
    //    Queued like pointer input — one shared render path with its own
    //    'param' segment chain, so it coexists with loop playback.
    //    Suppressed while a pointer stroke is in progress (liveStroke
    //    varies with pointer state) so pointer strokes don't double-draw
    //    through their own draw.x/draw.y writes.
    const isActive = (penSize > 0 || eraseSize > 0) && !this.liveStroke;
    if (isActive) {
      this.queuePoint({
        x: nx,
        y: ny,
        erase: eraseSize > 0 && !(penSize > 0),
        start: !this._wasActive,
        origin: 'param',
      });
    }
    this._wasActive = isActive;

    // ── Drain point queue (live pointers, param drawing, loop playback) ──
    let liveInk = false;
    if (this._queue.length > 0) {
      for (const raw of this._queue) {
        const pt   = this._resolve(raw, ps);
        const prev = pt.start ? null : (this._prevByOrigin[pt.origin] ?? null);
        this.drawSegment(pt, prev);
        this._prevByOrigin[pt.origin] = pt;
        if (!pt.origin.startsWith('loop')) liveInk = true;
        if (this.onSegment) this.onSegment(raw, pt);
      }
      this._queue.length = 0;
      dirty = true;
    }

    this.strokeActive = liveInk || this.liveStroke;
    // Only upload the texture to GPU when something actually changed.
    // Before this guard, needsUpdate fired every frame — 1MB GPU upload
    // at 60fps tanked iPad to 39-42fps.
    if (dirty || this.liveStroke) this.texture.needsUpdate = true;
  }

  /**
   * Wipe canvas to black.
   */
  clear() {
    this.ctx.globalAlpha = 1;
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.fillStyle = '#000000';
    this.ctx.fillRect(0, 0, SIZE, SIZE);
    this.texture.needsUpdate = true;
  }
}

/**
 * Convert HSV (0-360, 0-100, 0-100) to CSS hsl() string.
 * Canvas uses HSL natively; this converts so saturation=0 → grey, not HSL grey.
 */
function _hsvToHsl(h, s, v) {
  // Normalise
  const sv = s / 100, vv = v / 100;
  const l  = vv * (1 - sv / 2);
  const sl = (l === 0 || l === 1) ? 0 : (vv - l) / Math.min(l, 1 - l);
  return `hsl(${h},${(sl * 100).toFixed(1)}%,${(l * 100).toFixed(1)}%)`;
}
