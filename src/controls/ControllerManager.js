/**
 * ImWeb Controller Manager
 *
 * Manages all controller instances and drives them each frame.
 * Controllers write to ParameterSystem via setNormalized().
 *
 * Supported: Mouse, Keyboard, MIDI, LFO, Sound, Random, Fixed, Nudge
 * Planned:   OSC (WebSocket), HID (Gamepad), Wacom (PointerEvents pressure)
 */

import { LFOController } from './LFO.js';
import { BeatDetector }  from './BeatDetector.js';

export class ControllerManager {
  constructor(ps) {
    this.ps      = ps;          // ParameterSystem
    this.lfos    = new Map();   // paramId → LFOController (for LFO-assigned params)
    this.randoms = new Map();   // paramId → { hz, lastTick, value }
    this.midi    = null;
    this.sound   = null;
    this.mouse   = { x: 0.5, y: 0.5 };
    this.modifiers = { capsLock: false, shift: false, ctrl: false, alt: false, meta: false };

    this._gamepadBtnPrev = []; // tracks button press edges for toggle/trigger params
    this._midiLearnParam = null; // paramId waiting for MIDI learn
    this._midiLearnTimer = null;

    // MIDI clock sync (0xF8 = 24 pulses per quarter note)
    this._midiClockEnabled  = false;
    this._midiClockTimes    = []; // timestamps of recent 0xF8 messages
    this._midiClockCallback = null; // called with derived bpm

    // MIDI Program Change → preset recall
    // Set to a function(pcNumber) to receive PC messages globally
    this.onMIDIPC = null;

    // Expression controllers: paramId → { fn: Function, t: 0 }
    this.exprs = new Map();
    this._exprTime = 0; // cumulative time in seconds

    this._initKeyboard();
    this._initMouse();
    this._initMIDI();
    this._initSound();
    this._initGamepad();
  }

  // ── Frame tick ────────────────────────────────────────────────────────────

  tick(dt) {
    // Tick all LFO controllers
    this.lfos.forEach((lfo, paramId) => {
      const v = lfo.tick(dt);
      this.ps.setNormalized(paramId, v);
    });

    // Tick expression controllers
    this._exprTime += dt;
    const t = this._exprTime;
    this.exprs.forEach((expr, paramId) => {
      try {
        const raw = expr.fn(t);
        if (typeof raw === 'number' && isFinite(raw)) {
          const p = this.ps.get(paramId);
          if (p) p.value = raw; // raw is in param's natural range
        }
      } catch (_) { /* silent */ }
    });

    // Tick random controllers
    const now = performance.now() / 1000;
    this.randoms.forEach((r, paramId) => {
      if (now - r.lastTick > 1 / r.hz) {
        r.value = Math.random();
        r.lastTick = now;
        this.ps.setNormalized(paramId, r.value);
      }
    });

    // Update sound controller if active
    if (this.sound) this.sound.tick();

    // Poll gamepads
    this._tickGamepad();
  }

  // ── Assign controller to parameter ───────────────────────────────────────

  assign(paramId, controllerConfig) {
    const p = this.ps.get(paramId);
    if (!p) { console.warn(`[ControllerManager] Unknown param: ${paramId}`); return; }

    // Clean up old controller
    this._removeController(paramId);

    if (!controllerConfig || controllerConfig.type === 'none') {
      p.controller = null;
      return;
    }

    p.controller = { ...controllerConfig };
    const t = controllerConfig.type;

    if (t.startsWith('lfo-')) {
      const lfo = new LFOController({
        shape: t.replace('lfo-', ''),
        hz:    controllerConfig.hz    ?? 0.5,
        phase: controllerConfig.phase ?? 0,
        mode:  controllerConfig.mode  ?? 'norm',
        width: controllerConfig.width ?? 0.5,
      });
      lfo.bpmDiv = controllerConfig.bpmDiv ?? null; // null = free Hz mode
      this.lfos.set(paramId, lfo);

    } else if (t === 'random') {
      this.randoms.set(paramId, {
        hz: controllerConfig.hz ?? 1,
        lastTick: 0,
        value: Math.random(),
      });

    } else if (t === 'fixed') {
      p.setNormalized(controllerConfig.value ?? 0);
    } else if (t === 'expr') {
      const src = controllerConfig.expr ?? '0';
      try {
        // Build a safe evaluator with common math functions in scope
        // eslint-disable-next-line no-new-func
        const fn = new Function('t','sin','cos','tan','abs','floor','ceil','round','mod','fract','clamp','mix','pow','sqrt','noise',
          `"use strict"; return (${src});`
        );
        const bound = t2 => fn(t2,
          Math.sin, Math.cos, Math.tan, Math.abs,
          Math.floor, Math.ceil, Math.round,
          (a,b) => ((a % b) + b) % b,    // mod
          a => a - Math.floor(a),          // fract
          (a,lo,hi) => Math.max(lo, Math.min(hi, a)), // clamp
          (a,b,t3) => a + (b-a)*t3,       // mix
          Math.pow, Math.sqrt,
          () => Math.random(),             // noise
        );
        this.exprs.set(paramId, { fn: bound });
      } catch (e) {
        console.warn(`[Expr] Compile error for ${paramId}: ${e.message}`);
      }
    } else if (t === 'sound' || t === 'sound-bass' || t === 'sound-mid' || t === 'sound-high') {
      this.enableSound(); // lazy-init audio input on first assignment
    }
    // mouse, midi, key are handled reactively in their event handlers
  }

  _removeController(paramId) {
    this.lfos.delete(paramId);
    this.randoms.delete(paramId);
    this.exprs.delete(paramId);
  }

  // ── Retrigger all LFOs (on DisplayState recall) ───────────────────────────

  retriggerLFOs() {
    this.lfos.forEach(lfo => lfo.retrigger());
  }

  // ── BPM sync ──────────────────────────────────────────────────────────────

  /**
   * Update hz for all BPM-synced LFOs.
   * Called whenever global.bpm changes.
   */
  syncBPM(bpm) {
    this.lfos.forEach(lfo => {
      if (lfo.bpmDiv != null) {
        lfo.lfo.hz = (bpm / 60) * lfo.bpmDiv;
        // Persist to controller config so it serializes correctly
        const paramId = [...this.lfos.entries()].find(([, v]) => v === lfo)?.[0];
        if (paramId) {
          const p = this.ps.get(paramId);
          if (p?.controller) p.controller.hz = lfo.lfo.hz;
        }
      }
    });
  }

  // ── Mouse ─────────────────────────────────────────────────────────────────

  _initMouse() {
    const canvas = document.getElementById('output-canvas');
    if (!canvas) return;

    canvas.addEventListener('mousemove', e => {
      const r = canvas.getBoundingClientRect();
      this.mouse.x = (e.clientX - r.left) / r.width;
      this.mouse.y = 1 - (e.clientY - r.top) / r.height; // y=0 at bottom (ImOs9 convention)

      // Drive all mouse-X/Y assigned params
      this.ps.getAll().forEach(p => {
        if (!p.controller) return;
        const { type, modifiers } = p.controller;
        if (!this._checkModifiers(modifiers)) return;
        if (type === 'mouse-x') p.setNormalized(this.mouse.x);
        if (type === 'mouse-y') p.setNormalized(this.mouse.y);
      });
    });

    // Pointer pressure (Wacom / stylus)
    canvas.addEventListener('pointermove', e => {
      const pressure = e.pressure ?? 0;
      if (pressure === 0 || e.pointerType === 'mouse') return;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type === 'wacom-pressure') p.setNormalized(pressure);
      });
    });
  }

  _checkModifiers(combo) {
    if (!combo) return true; // no modifier needed
    const m = this.modifiers;
    if (combo.includes('l') && !m.capsLock) return false;
    if (combo.includes('s') && !m.shift)    return false;
    if (combo.includes('c') && !m.ctrl)     return false;
    if (combo.includes('o') && !m.alt)      return false;
    if (combo.includes('d') && !m.meta)     return false;
    return true;
  }

  // ── Keyboard ──────────────────────────────────────────────────────────────

  _initKeyboard() {
    window.addEventListener('keydown', e => {
      this._updateModifiers(e);

      // Global keybindings
      if (e.metaKey || e.ctrlKey) {
        if (e.key === 'f') { e.preventDefault(); document.body.classList.toggle('fullscreen-output'); }
        return;
      }

      // Drive key-assigned params
      const key = e.key;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type !== 'key') return;
        if (p.controller.key !== key) return;
        if (p.type === 'toggle') p.toggle();
        else if (p.type === 'trigger') p.trigger();
        else p.setNormalized(1);
      });
    });

    window.addEventListener('keyup', e => {
      this._updateModifiers(e);
      const key = e.key;
      this.ps.getAll().forEach(p => {
        if (p.controller?.type === 'key' && p.controller.key === key) {
          if (p.type === 'continuous') p.setNormalized(0);
        }
      });
    });
  }

  _updateModifiers(e) {
    this.modifiers.capsLock = e.getModifierState?.('CapsLock') ?? false;
    this.modifiers.shift    = e.shiftKey;
    this.modifiers.ctrl     = e.ctrlKey;
    this.modifiers.alt      = e.altKey;
    this.modifiers.meta     = e.metaKey;
  }

  // ── MIDI ──────────────────────────────────────────────────────────────────

  async _initMIDI() {
    if (!navigator.requestMIDIAccess) return;
    try {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      this.midi = access;
      access.inputs.forEach(input => this._attachMIDIInput(input));
      access.onstatechange = e => {
        if (e.port.type === 'input' && e.port.state === 'connected') {
          this._attachMIDIInput(e.port);
        }
      };
      document.getElementById('status-midi')?.classList.add('active');
    } catch (err) {
      console.info('[MIDI] Not available:', err.message);
    }
  }

  // ── MIDI Learn ────────────────────────────────────────────────────────────

  startMIDILearn(paramId) {
    this._midiLearnParam = paramId;

    // Flash the MIDI indicator
    const el = document.getElementById('status-midi');
    if (el) {
      el.classList.add('learning');
      clearTimeout(this._midiLearnTimer);
      // Auto-cancel after 10s
      this._midiLearnTimer = setTimeout(() => this.cancelMIDILearn(), 10000);
    }
  }

  cancelMIDILearn() {
    this._midiLearnParam = null;
    clearTimeout(this._midiLearnTimer);
    const el = document.getElementById('status-midi');
    el?.classList.remove('learning');
  }

  /**
   * Enable MIDI clock sync. `callback(bpm)` is called whenever BPM is derived
   * from incoming 0xF8 timing clock messages (24 pulses/quarter note).
   */
  enableMIDIClock(callback) {
    this._midiClockEnabled  = true;
    this._midiClockCallback = callback;
    this._midiClockTimes    = [];
  }

  disableMIDIClock() {
    this._midiClockEnabled  = false;
    this._midiClockCallback = null;
    this._midiClockTimes    = [];
  }

  _attachMIDIInput(input) {
    input.onmidimessage = e => {
      const [status, data1, data2] = e.data;

      // MIDI clock: 0xF8 = timing tick (24 per quarter note)
      if (status === 0xF8 && this._midiClockEnabled) {
        const now = performance.now();
        this._midiClockTimes.push(now);
        if (this._midiClockTimes.length > 24) this._midiClockTimes.shift();
        if (this._midiClockTimes.length >= 4) {
          // Average interval of last N ticks
          const n   = this._midiClockTimes.length;
          const avg = (this._midiClockTimes[n - 1] - this._midiClockTimes[0]) / (n - 1);
          const bpm = 60000 / (avg * 24); // 24 ticks per quarter note
          if (bpm > 20 && bpm < 300) this._midiClockCallback?.(Math.round(bpm * 10) / 10);
        }
        return;
      }

      const type    = status & 0xF0;
      const channel = (status & 0x0F) + 1;
      const norm    = data2 / 127;

      // MIDI Learn: intercept next CC
      if (this._midiLearnParam && type === 0xB0) {
        this.assign(this._midiLearnParam, { type: 'midi-cc', cc: data1, channel });
        this.cancelMIDILearn();
        // Activity flash
        const el = document.getElementById('status-midi');
        if (el) { el.classList.add('active'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('active'), 200); }
        return;
      }

      this.ps.getAll().forEach(p => {
        if (!p.controller) return;
        const c = p.controller;
        if (c.channel && c.channel !== channel) return;

        if (type === 0xB0 && c.type === 'midi-cc' && c.cc === data1) {
          p.setNormalized(norm);
        } else if (type === 0x90 && c.type === 'midi-note' && c.note === data1) {
          if (p.type === 'toggle') { if (data2 > 0) p.toggle(); }
          else if (p.type === 'trigger') { if (data2 > 0) p.trigger(); }
          else p.setNormalized(data2 > 0 ? data2 / 127 : 0);
        } else if (type === 0xC0 && c.type === 'midi-pc') {
          if (this.onMIDIPC) this.onMIDIPC(data1); // global PC callback (preset recall)
          p.value = data1;
        }
      });

      // Global MIDI PC callback (fires for any PC message regardless of param mapping)
      if (type === 0xC0 && this.onMIDIPC) {
        this.onMIDIPC(data1);
      }

      // Show MIDI activity
      const el = document.getElementById('status-midi');
      if (el) {
        el.classList.add('active');
        clearTimeout(el._t);
        el._t = setTimeout(() => el.classList.remove('active'), 100);
      }
    };
  }

  // ── Gamepad ───────────────────────────────────────────────────────────────

  _initGamepad() {
    window.addEventListener('gamepadconnected', e => {
      console.info(`[Gamepad] Connected: ${e.gamepad.id}`);
    });
    window.addEventListener('gamepaddisconnected', e => {
      console.info(`[Gamepad] Disconnected: ${e.gamepad.id}`);
    });
  }

  _tickGamepad() {
    const gamepads = navigator.getGamepads ? navigator.getGamepads() : [];
    // Use the first connected gamepad
    let gp = null;
    for (const g of gamepads) { if (g) { gp = g; break; } }
    if (!gp) return;

    this.ps.getAll().forEach(p => {
      if (!p.controller) return;
      const c = p.controller;
      const t = c.type;

      if (t?.startsWith('gamepad-axis-')) {
        const idx  = parseInt(t.replace('gamepad-axis-', ''));
        const raw  = gp.axes[idx] ?? 0;
        const norm = (raw + 1) / 2; // -1..1  →  0..1
        p.setNormalized(norm);

      } else if (t?.startsWith('gamepad-btn-')) {
        const idx = parseInt(t.replace('gamepad-btn-', ''));
        const btn = gp.buttons[idx];
        if (!btn) return;

        const prev    = this._gamepadBtnPrev[idx] ?? false;
        const pressed = btn.pressed;

        if (p.type === 'toggle') {
          if (pressed && !prev) p.toggle();     // rising edge only
        } else if (p.type === 'trigger') {
          if (pressed && !prev) p.trigger();    // rising edge only
        } else {
          p.setNormalized(btn.value);           // analog (0 or 1 for digital)
        }

        this._gamepadBtnPrev[idx] = pressed;
      }
    });
  }

  // ── Sound ─────────────────────────────────────────────────────────────────

  async _initSound() {
    // Sound controller initialized lazily when a sound-controlled param exists
    // or when explicitly enabled
  }

  async enableSound() {
    if (this.sound) return;
    try {
      const ctx  = new AudioContext();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const source  = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512; // 256 bins
      source.connect(analyser);
      const timeBuf = new Float32Array(analyser.fftSize);
      const freqBuf = new Uint8Array(analyser.frequencyBinCount); // 256 bins

      const beatDetector = new BeatDetector(analyser, ctx);

      this.sound = {
        ctx, analyser, timeBuf, freqBuf,
        beatDetector,
        level: 0, bass: 0, mid: 0, high: 0,
        tick() {
          analyser.getFloatTimeDomainData(timeBuf);
          let rms = 0;
          for (let i = 0; i < timeBuf.length; i++) rms += timeBuf[i] * timeBuf[i];
          this.level = Math.sqrt(rms / timeBuf.length);

          analyser.getByteFrequencyData(freqBuf);
          const N = freqBuf.length;
          // Bass: 0-10% of bins (~0-1kHz for 44kHz sample rate)
          const bassEnd = Math.floor(N * 0.04);
          const midEnd  = Math.floor(N * 0.25);
          let b = 0, m = 0, h = 0;
          for (let i = 0; i < bassEnd; i++) b += freqBuf[i];
          for (let i = bassEnd; i < midEnd; i++) m += freqBuf[i];
          for (let i = midEnd; i < N; i++) h += freqBuf[i];
          this.bass = Math.min(1, (b / bassEnd) / 200);
          this.mid  = Math.min(1, (m / (midEnd - bassEnd)) / 160);
          this.high = Math.min(1, (h / (N - midEnd)) / 120);

          // Beat detection
          beatDetector.tick();
        }
      };

      // Wire sound-assigned params
      setInterval(() => {
        if (!this.sound) return;
        const s = this.sound;
        const level = Math.min(1, s.level * 4);
        this.ps.getAll().forEach(p => {
          if (!p.controller) return;
          const t = p.controller.type;
          if (t === 'sound')      p.setNormalized(level);
          if (t === 'sound-bass') p.setNormalized(s.bass);
          if (t === 'sound-mid')  p.setNormalized(s.mid);
          if (t === 'sound-high') p.setNormalized(s.high);
        });
      }, 16);

    } catch (err) {
      console.warn('[Sound] Could not init audio input:', err.message);
    }
  }
}
