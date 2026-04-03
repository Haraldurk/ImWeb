/**
 * ImWeb Movie Input — Phase 2
 * Loads video files → Three.js VideoTexture with playback control.
 *
 * Supports multiple clips (up to 8). One clip is "active" at a time.
 * Parameters drive speed, position scrub, loop range, and mirror.
 *
 * Flow:
 *   File → <video> element → THREE.VideoTexture → Pipeline source
 *   ParameterSystem controls: movie.speed, movie.pos, movie.start, movie.end, movie.loop, movie.mirror
 */

import * as THREE from 'three';

const MAX_CLIPS = 8;

export class MovieInput {
  constructor() {
    this.clips    = [];      // [{ name, url, video, texture, duration }]
    this.active   = false;
    this._current = -1;      // index of active clip
    this._pingDir  = 1;       // ping-pong direction: 1 = forward, -1 = backward
    this._lastPos  = -1;     // last seen movie.pos value (for change detection)
    this._revAccum = 0;      // accumulator for reverse frame stepping (seconds)
  }

  /**
   * Load a video file (from File input or URL).
   * Returns the clip index.
   */
  async addClip(file) {
    if (this.clips.length >= MAX_CLIPS) {
      console.warn('[Movie] Max clips reached');
      return -1;
    }

    const url = file instanceof File ? URL.createObjectURL(file) : file;
    const name = file instanceof File ? file.name : url.split('/').pop();

    // Check browser codec support before attempting load
    const ext = name.split('.').pop().toLowerCase();
    const mimeMap = { mp4: 'video/mp4', webm: 'video/webm', mov: 'video/mp4; codecs="avc1"', avi: 'video/x-msvideo', mkv: 'video/x-matroska' };
    const mimeHint = mimeMap[ext] ?? 'video/mp4';
    const probe = document.createElement('video');
    if (probe.canPlayType(mimeHint) === '') {
      throw new Error(`Unsupported format: .${ext} — try H.264 MP4 or WebM`);
    }

    const video = document.createElement('video');
    video.crossOrigin = 'anonymous'; // must be set before src
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.preload = 'auto';
    video.src = url;

    // Wait for metadata so we know duration
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = e => reject(new Error(`Failed to load "${name}" — unsupported codec or corrupt file`));
    });

    const texture = new THREE.VideoTexture(video);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.format    = THREE.RGBAFormat;

    // Capture a thumbnail frame (seek to 10% or 0.5s, whichever is earlier)
    let thumb = null;
    try {
      const seekTo = Math.min(video.duration * 0.1, 0.5);
      video.currentTime = seekTo;
      await new Promise(res => video.addEventListener('seeked', res, { once: true }));
      const tc = document.createElement('canvas');
      tc.width = 160; tc.height = 90;
      tc.getContext('2d').drawImage(video, 0, 0, 160, 90);
      thumb = tc.toDataURL('image/jpeg', 0.75);
      video.currentTime = 0; // reset
    } catch (e) { /* thumbnail optional */ }

    const idx = this.clips.length;
    this.clips.push({
      name,
      url,
      video,
      texture,
      duration: video.duration,
      thumb,
    });

    console.info(`[Movie] Loaded clip ${idx}: "${name}" (${video.duration.toFixed(1)}s)`);

    // Auto-activate first clip
    if (this._current < 0) this.selectClip(0);

    return idx;
  }

  /**
   * Select which clip is active.
   */
  selectClip(idx) {
    if (idx < 0 || idx >= this.clips.length) return;
    // Pause the old clip
    if (this._current >= 0) {
      this.clips[this._current].video.pause();
    }
    this._current = idx;
    this._lastPos  = -1; // reset so pos scrub applies immediately on new clip
    this._revAccum = 0;
  }

  removeClip(idx) {
    if (idx < 0 || idx >= this.clips.length) return;
    const clip = this.clips[idx];
    clip.video.pause();
    clip.video.src = '';
    clip.texture.dispose();
    if (clip.url.startsWith('blob:')) URL.revokeObjectURL(clip.url);
    this.clips.splice(idx, 1);
    if (this._current >= this.clips.length) this._current = this.clips.length - 1;
    if (this._current < 0) this.active = false;
  }

  /**
   * Called each frame from the render loop.
   * @param {ParameterSystem} params
   * @param {number} beatPhase - accumulated beat counter (increases at BPM rate)
   * @param {number} dt - delta time in seconds
   */
  tick(params, beatPhase = 0, dt = 0.016) {
    if (!this.active || this._current < 0) return;

    const clip = this.clips[this._current];
    if (!clip) return;
    const v = clip.video;

    // BPM sync mode: lock clip position to beat phase
    const bpmSync = params.get('movie.bpmsync')?.value;
    if (bpmSync) {
      const beatLenOptions = [1, 2, 4, 8, 16];
      const beatLenIdx     = params.get('movie.bpmbeats')?.value ?? 2;
      const beatLen        = beatLenOptions[beatLenIdx] ?? 4;
      const phase          = (beatPhase % beatLen) / beatLen; // 0..1
      const targetT        = phase * clip.duration;
      if (Math.abs(v.currentTime - targetT) > 0.05) {
        v.currentTime = targetT;
      }
      if (v.readyState >= v.HAVE_CURRENT_DATA) clip.texture.needsUpdate = true;
      return;
    }

    // Range bounds
    const startT = (params.get('movie.start').value / 100) * clip.duration;
    const endT   = (params.get('movie.end').value   / 100) * clip.duration;
    const range  = Math.max(endT - startT, 0.001);

    // ── Pos-drive mode ───────────────────────────────────────────────────────
    // When a controller (LFO, MIDI, etc.) is assigned to movie.pos, pos owns
    // the scrub entirely — speed and loop are bypassed. This is the frame-scan
    // / LFO scrub use case (independent of MovieSpeed).
    const posParam = params.get('movie.pos');
    if (posParam.controller) {
      if (!v.paused) v.pause();
      const targetT = startT + (posParam.value / 100) * range;
      if (Math.abs(v.currentTime - targetT) > 0.001) v.currentTime = targetT;
      if (v.readyState >= v.HAVE_CURRENT_DATA) clip.texture.needsUpdate = true;
      return;
    }

    // ── Normal playback: speed + loop ────────────────────────────────────────
    // Loop mode: 0=Off, 1=Loop (bidirectional), 2=Ping-pong
    const loopMode = params.get('movie.loop').value;
    let speed = params.get('movie.speed').value;

    // Ping-pong: flip direction at boundaries
    if (loopMode === 2) {
      const absSpeed = Math.abs(speed) || 1;
      if (v.currentTime >= endT)   this._pingDir = -1;
      if (v.currentTime <= startT) this._pingDir =  1;
      speed = absSpeed * this._pingDir;
    }

    if (speed < 0) {
      // Reverse: accumulate and seek at ~15fps to avoid decode stutter
      if (!v.paused) v.pause();
      this._revAccum += Math.abs(speed) * dt;
      if (this._revAccum >= 1 / 15) {
        v.currentTime = Math.max(startT, v.currentTime - this._revAccum);
        this._revAccum = 0;
      }
    } else {
      this._revAccum = 0;
      v.playbackRate = Math.max(0.01, speed);
      if (v.paused && speed > 0) v.play().catch(() => {});
    }

    // Loop boundaries — Loop mode wraps in whichever direction speed points
    v.loop = false;
    if (loopMode === 1) { // Loop
      if (speed >= 0 && v.currentTime >= endT)   v.currentTime = startT;
      if (speed <  0 && v.currentTime <= startT) v.currentTime = endT;
    } else if (loopMode === 2) { // Ping-pong — boundaries handled above
      // clamp to range
      if (v.currentTime > endT)   v.currentTime = endT;
      if (v.currentTime < startT) v.currentTime = startT;
    }
    // loopMode === 0: Off — play once, stop at natural end

    // ── Manual pos seek (no controller) ─────────────────────────────────────
    // Seek when the value changes (nudge mode); has no effect once released.
    const posVal = posParam.value;
    if (posVal !== this._lastPos) {
      this._lastPos = posVal;
      v.currentTime = startT + (posVal / 100) * range;
    }

    // Update texture
    if (v.readyState >= v.HAVE_CURRENT_DATA) {
      clip.texture.needsUpdate = true;
    }
  }

  /**
   * Returns the current clip's texture, or null.
   */
  get currentTexture() {
    if (!this.active || this._current < 0) return null;
    return this.clips[this._current]?.texture ?? null;
  }

  get currentClip() {
    return this._current >= 0 ? this.clips[this._current] : null;
  }

  get currentIndex() {
    return this._current;
  }

  dispose() {
    this.clips.forEach((clip, i) => this.removeClip(i));
    this.clips = [];
    this._current = -1;
    this.active = false;
  }
}
