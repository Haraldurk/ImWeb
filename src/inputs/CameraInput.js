/**
 * ImWeb Camera Input
 * WebRTC getUserMedia → Three.js VideoTexture
 */

import * as THREE from 'three';

export class CameraInput {
  constructor() {
    this.texture  = null;
    this.video    = null;
    this.active   = false;
    this.devices  = [];
    this._stream  = null;
    this.facing   = 'environment'; // 'environment' (back) | 'user' (front)
  }

  /** Toggle front/back camera. If a stream is live, restart with the new
   *  facing — start() stops the old tracks first, so the hardware is
   *  released before the new getUserMedia request. */
  async switchFacing() {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    if (this.active) await this.start(null); // null deviceId → facingMode governs
    return this.facing;
  }

  async init() {
    await this._enumerateDevices();
  }

  async _enumerateDevices() {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      this.devices = devices.filter(d => d.kind === 'videoinput');
    } catch (e) {
      console.warn('[Camera] Could not enumerate devices');
    }
  }

  async start(deviceId = null) {
    if (this._stream) this.stop();

    // iOS Safari requires HTTPS (except localhost for dev)
    if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
      this.lastError = 'InsecureContext';
      return false;
    }

    // Progressive constraint fallback — iOS fails hard on { exact } deviceId
    const facing = this.facing;
    const constraintSets = deviceId
      ? [
          { video: { deviceId: { ideal: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          { video: { deviceId: { ideal: deviceId } } },
          { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          { video: { facingMode: { ideal: facing } } },
          { video: true },
        ]
      : [
          { video: { facingMode: { ideal: facing }, width: { ideal: 1280 }, height: { ideal: 720 } } },
          { video: { facingMode: { ideal: facing } } },
          { video: { width: { ideal: 1280 }, height: { ideal: 720 } } },
          { video: true },
        ];

    let lastErr = null;
    for (const constraints of constraintSets) {
      try {
        this._stream = await navigator.mediaDevices.getUserMedia({ ...constraints, audio: false });
        break;
      } catch (err) {
        lastErr = err;
        if (err.name === 'NotAllowedError') break; // No point retrying permission errors
      }
    }

    if (!this._stream) {
      this.lastError = lastErr?.name ?? 'NotFoundError';
      console.warn('[Camera] All constraint sets failed:', lastErr?.message);
      this.active = false;
      return false;
    }

    try {
      this.video = document.createElement('video');
      this.video.srcObject = this._stream;
      this.video.playsInline = true;
      // iOS: attribute form + webkit- prefix needed alongside the DOM property,
      // and pointer-events:none so no touch path can reach native media controls
      this.video.setAttribute('playsinline', '');
      this.video.setAttribute('webkit-playsinline', '');
      this.video.style.pointerEvents = 'none';
      this.video.muted = true;
      await this.video.play();

      this.texture = new THREE.VideoTexture(this.video);
      this.texture.minFilter = THREE.LinearFilter;
      this.texture.magFilter = THREE.LinearFilter;
      this.texture.format    = THREE.RGBAFormat;
      this.active = true;

      console.info('[Camera] Started:', this._stream.getVideoTracks()[0].label);
      return true;
    } catch (err) {
      console.warn('[Camera] Video play failed:', err.message);
      this.lastError = err.name;
      this.active = false;
      return false;
    }
  }

  stop() {
    if (this._stream) {
      this._stream.getTracks().forEach(t => t.stop());
      this._stream = null;
    }
    if (this.video) {
      this.video.srcObject = null;
      this.video = null;
    }
    if (this.texture) {
      this.texture.dispose();
      this.texture = null;
    }
    this.active = false;
  }

  tick() {
    // three r160+ VideoTexture self-gates GPU uploads to the camera's real
    // frame rate via requestVideoFrameCallback — forcing needsUpdate here
    // every render frame defeats that and re-uploads 720p at 60Hz (double
    // the camera rate). Only force it on browsers without rVFC.
    if (!this.video || 'requestVideoFrameCallback' in this.video) return;
    if (this.texture && this.video.readyState >= this.video.HAVE_CURRENT_DATA) {
      this.texture.needsUpdate = true;
    }
  }

  get currentTexture() {
    return this.active ? this.texture : null;
  }

  getDeviceList() { return this.devices; }
}
