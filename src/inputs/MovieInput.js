/**
 * ImWeb Movie Input — Phase 2
 * Loads video files → Three.js VideoTexture with playback control.
 *
 * Supports multiple clips (up to 8). One clip is "active" at a time.
 * Parameters drive speed, position scrub, loop range, and mirror.
 *
 * Flow:
 *   File → <video> element → THREE.VideoTexture → Pipeline source
 *   ParameterSystem controls: movie.speed, movie.pos, movie.start, movie.loop, movie.mirror
 */

import * as THREE from 'three';

const MAX_CLIPS = 8;

export class MovieInput {
  constructor() {
    this.clips    = [];      // [{ name, url, video, texture, duration }]
    this.active   = false;
    this._current = -1;      // index of active clip
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

    const video = document.createElement('video');
    video.src = url;
    video.crossOrigin = 'anonymous';
    video.playsInline = true;
    video.muted = true;
    video.loop = true;
    video.preload = 'auto';

    // Wait for metadata so we know duration
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error(`Failed to load: ${name}`));
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
   */
  tick(params, beatPhase = 0) {
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

    // Speed control: movie.speed [-1..3], 1 = normal
    const speed = params.get('movie.speed').value;
    v.playbackRate = Math.max(0.01, Math.abs(speed));

    // Ensure playing when active
    if (v.paused && speed !== 0) {
      v.play().catch(() => {});
    }

    // Loop range: movie.start (0–100%) and movie.loop (0–100%)
    const startPct = params.get('movie.start').value / 100;
    const loopPct  = params.get('movie.loop').value / 100;
    const startT   = startPct * clip.duration;
    const endT     = loopPct  * clip.duration;

    // Enforce loop boundaries
    if (endT > startT && v.currentTime >= endT) {
      v.currentTime = startT;
    }
    if (v.currentTime < startT) {
      v.currentTime = startT;
    }

    // Position scrub: movie.pos (0–100%) — direct scrub overrides playback
    // Only scrub when controlled (non-zero controller assignment)
    const posParam = params.get('movie.pos');
    if (posParam.controller) {
      const posPct = posParam.value / 100;
      const targetT = startT + posPct * (endT - startT || clip.duration);
      // Only scrub if significantly different (avoid jitter)
      if (Math.abs(v.currentTime - targetT) > 0.05) {
        v.currentTime = targetT;
      }
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
