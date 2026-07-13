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

    // Video-as-ink frame cache: snapshot the video to a small offscreen
    // canvas once per frame so every point in the queue reuses one cheap
    // bitmap instead of triggering N expensive video decodes.
    this._inkCache       = document.createElement('canvas');
    this._inkCacheCtx    = this._inkCache.getContext('2d', { willReadFrequently: false });
    this._inkCacheDirty  = true;   // force first snapshot
    this._lastVideoTime  = -1;     // skip duplicate video decodes (camera=30fps, rAF=60fps)
    this._inkFrameCount  = 0;      // fallback: update at least every 2nd frame
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
    // Video sources (1-3) need a live <video> to sample; Noise (4) and
    // Output (5) fill the cache themselves and don't use inkVideo at all —
    // gating on inkVideo for those meant they never used the cache and
    // silently fell back to solid color.
    const isVideoSrc = this.inkSource >= 1 && this.inkSource <= 3;
    const useInk = !pt.erase && this.inkSource > 0 && (!isVideoSrc || this.inkVideo);
    // Check the cached canvas has real pixel data — videoWidth is 0 until
    // the first frame arrives, and Safari may need the element in the DOM.
    const cacheReady = useInk && this._inkCache.width > 0 && this._inkCache.height > 0;

    // Video-as-ink: clip the brush shape and stamp the cached video frame
    // through it. The clip() path never paints visible pixels (no stroke/fill
    // beforehand), so a failed drawImage just leaves the canvas unchanged
    // instead of leaving white ghost strokes.
    if (cacheReady) {
      ctx.save();
      ctx.globalAlpha = pt.alpha;
      ctx.beginPath();
      if (prev) {
        ctx.moveTo(prev.cx, prev.cy);
        ctx.lineTo(pt.cx, pt.cy);
        ctx.lineWidth = pt.lineW;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      } else {
        ctx.arc(pt.cx, pt.cy, pt.lineW / 2, 0, Math.PI * 2);
      }
      ctx.clip(); // clip region IS the brush shape — no visible paint yet

      // The cache canvas covers the full video frame mapped to the draw
      // area, so we just blit a brush-sized patch from the matching spot.
      const cw = this._inkCache.width;
      const ch = this._inkCache.height;
      const stampW = Math.max(4, (pt.lineW / SIZE) * cw);
      const stampH = Math.max(4, (pt.lineW / SIZE) * ch);
      const sx = Math.max(0, Math.min(cw - stampW, (pt.cx / SIZE) * cw - stampW / 2));
      const sy = Math.max(0, Math.min(ch - stampH, (pt.cy / SIZE) * ch - stampH / 2));
      ctx.drawImage(
        this._inkCache,
        sx, sy, stampW, stampH,
        pt.cx - pt.lineW / 2, pt.cy - pt.lineW / 2, pt.lineW, pt.lineW,
      );
      ctx.restore();
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

    // ── Ink source frame cache ──────────────────────────────────────────
    // 0=Color (no cache), 1–3=Video (snapshot <video>), 4=Noise (random),
    // 5=Output (cache filled by main.js from Three.js canvas before tick).
    //
    // Only fill the cache when points will actually be drawn this frame —
    // `drawImage(video)` at 60fps with a 720p+ source kills iPad framerate
    // and the flickering comes from falling through to solid-colour when
    // the video frame momentarily isn't ready.
    const inkSrc = this.inkSource;

    if (inkSrc === 0) {
      if (this._inkCache.width > 0) this._inkCache.width = this._inkCache.height = 0;

    } else if (inkSrc <= 3) {
      // Video sources — only snapshot when the queue has points (or a
      // pointer is down and points are about to land). Half-resolution
      // cache (256px wide) — plenty for brush stamps, half the GPU cost.
      const hasWork = this._queue.length > 0 || this.liveStroke;
      if (hasWork && this.inkVideo) {
        const v = this.inkVideo;
        if (!v.parentNode) { v.style.display = 'none'; document.body.appendChild(v); }
        // Only snapshot when a NEW video frame is available. Camera feeds
        // are ~30fps but rAF ticks at 60fps — decoding the same frame twice
        // wastes GPU time and stalls the render loop on iOS. currentTime
        // advances only when a decoded frame is presented.
        // iOS Safari may not advance currentTime for MediaStream videos;
        // fall back to updating every 2nd rAF tick (~30fps) when the clock
        // appears stuck so the cache doesn't go stale permanently.
        this._inkFrameCount++;
        const newFrame = v.currentTime !== this._lastVideoTime;
        const staleEnough = this._inkFrameCount >= 2;
        if (v.videoWidth > 0 && v.videoHeight > 0 && (newFrame || staleEnough)) {
          if (newFrame) this._lastVideoTime = v.currentTime;
          this._inkFrameCount = 0;
          const cw = 256, ch = Math.round(256 * (v.videoHeight / v.videoWidth));
          if (this._inkCache.width !== cw || this._inkCache.height !== ch) {
            this._inkCache.width = cw; this._inkCache.height = ch;
          }
          this._inkCacheCtx.drawImage(v, 0, 0, cw, ch);
          this._inkCacheDirty = false;
        }
      }

    } else if (inkSrc === 4) {
      // Noise — only regenerate when points are landing
      if (this._queue.length > 0 || this.liveStroke) {
        const cw = 256, ch = 256;
        if (this._inkCache.width !== cw || this._inkCache.height !== ch) {
          this._inkCache.width = cw; this._inkCache.height = ch;
        }
        const img = this._inkCacheCtx.createImageData(cw, ch);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
          const v = Math.random() * 255 | 0;
          d[i] = d[i + 1] = d[i + 2] = v;
          d[i + 3] = 255;
        }
        this._inkCacheCtx.putImageData(img, 0, 0);
        this._inkCacheDirty = false;
      }

    } else if (inkSrc === 5) {
      // Output — filled by main.js from previous frame's Three.js canvas.
      // Keep SIZE×SIZE for 1:1 mapping with the draw area.
      if (this._inkCache.width !== SIZE || this._inkCache.height !== SIZE) {
        this._inkCache.width = SIZE; this._inkCache.height = SIZE;
      }
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
