import * as THREE          from 'three';
import { ParticleGPU }    from './ParticleGPU.js';
import { ParticleRender } from './ParticleRender.js';
import { ForceField }     from './ForceField.js';
import { ForceFormulas }  from './ForceFormulas.js';
import { VideoAnalysis }  from './VideoAnalysis.js';
import { GhostNodes }     from './GhostNodes.js';
import { PointerPerf }    from './PointerPerf.js';
import { PARAM_TYPE }     from '../controls/ParameterSystem.js';

export class ParticleEngine {
  constructor(renderer, paramSystem) {
    this._renderer = renderer;
    this.gpu    = new ParticleGPU(renderer);
    this.render = new ParticleRender(
      renderer,
      renderer.domElement.width,
      renderer.domElement.height
    );
    this.videoAnalysis = new VideoAnalysis();
    this.forceField    = new ForceField(renderer);
    this.ghostNodes    = new GhostNodes(renderer);
    this.pointerPerf   = new PointerPerf(this.ghostNodes, renderer.domElement);
    this._time         = 0;

    // Named ghost slots — persistent nodes, parked offscreen until turned on via params
    this._namedGhosts = [1, 2, 3].map(() =>
      this.ghostNodes.add(-10, -10, { mode: 'attract', source: 'named', strength: 0 })
    );

    // Two user-selectable colors (wired to native color pickers in main.js)
    this.color1 = new THREE.Vector3(0.1, 0.2, 0.8); // default: cool blue
    this.color2 = new THREE.Vector3(1.0, 0.3, 0.1); // default: warm red

    const fb = new Float32Array([1, 1, 1, 1]);
    this._fallback1x1Tex = new THREE.DataTexture(fb, 1, 1, THREE.RGBAFormat, THREE.FloatType);
    this._fallback1x1Tex.needsUpdate = true;

    this.registerParams(paramSystem);
  }

  get texture() { return this.render.texture; }

  setPointerMode(mode) { this.pointerPerf.setMode(mode); }

  registerParams(ps) {
    if (!ps) return;
    const G = 'particle';
    const c  = (cfg) => { const p = ps.register({ group: G, ...cfg }); return p; };
    const cs = (cfg, slew) => { const p = c(cfg); p.slew = slew; return p; };

    // ── Weights ──────────────────────────────────────────────────────────────
    cs({ id: 'particle.w.gradient',  label: 'Gradient weight',   min: 0, max: 1, value: 0.4 }, 0.05);
    cs({ id: 'particle.w.flow',      label: 'Flow weight',        min: 0, max: 1, value: 0.3 }, 0.05);
    cs({ id: 'particle.w.nbody',     label: 'N-body weight',      min: 0, max: 1, value: 0.1 }, 0.05);
    cs({ id: 'particle.w.ghost',     label: 'Ghost weight',       min: 0, max: 1, value: 0.2 }, 0.05);

    // ── Simulation ───────────────────────────────────────────────────────────
    cs({ id: 'particle.trailDecay',    label: 'Trail decay',    min: 0.70, max: 0.99, value: 0.93 }, 0.02);
    c ({ id: 'particle.colorMode',     label: 'Color mode',     type: PARAM_TYPE.SELECT, min: 0, max: 3, value: 0, step: 1,
         options: ['Velocity','Age','Alignment','Video'] });
    cs({ id: 'particle.fieldStrength', label: 'Field strength', min: 0, max: 4, value: 1.0 }, 0.05);
    cs({ id: 'particle.inertia',       label: 'Inertia',        min: 0, max: 1, value: 0.3 }, 0.05);
    cs({ id: 'particle.lifeDecay',     label: 'Life decay',     min: 0.001, max: 0.05, value: 0.005 }, 0.02);
    c ({ id: 'particle.boundaryMode',  label: 'Boundary',       type: PARAM_TYPE.SELECT, min: 0, max: 2, value: 1, step: 1,
         options: ['Wrap','Bounce','Respawn'] });

    // ── Formula ───────────────────────────────────────────────────────────────
    c ({ id: 'particle.flowFormula', label: 'Formula', type: PARAM_TYPE.SELECT, min: 0, max: 2, value: 0, step: 1,
         options: ['Curl','Lorenz','Magnetic'] });

    // ── Lorenz ────────────────────────────────────────────────────────────────
    cs({ id: 'particle.lorenz.rho',   label: 'ρ (chaos)', min: 1,   max: 60, value: 28   }, 0.03);
    cs({ id: 'particle.lorenz.sigma', label: 'σ',         min: 1,   max: 20, value: 10   }, 0.05);
    cs({ id: 'particle.lorenz.beta',  label: 'β',         min: 0.1, max: 8,  value: 2.67 }, 0.05);

    // ── N-body ────────────────────────────────────────────────────────────────
    cs({ id: 'particle.nbody.radius',  label: 'Attract radius', min: 0, max: 0.5, value: 0.1 }, 0.05);
    cs({ id: 'particle.nbody.falloff', label: 'Falloff exp',    min: 1, max: 3,   value: 2.0 }, 0.05);
    cs({ id: 'particle.nbody.mode',    label: 'N-body mode',    min: 0, max: 1,   value: 0   }, 0.05);

    // ── Ghost / pointer ───────────────────────────────────────────────────────
    // particle.ghost.strength → uGhostStrength in PASS_B (global multiplier for all ghost forces).
    // Do NOT also feed it to per-ghost strength — that would apply the value twice (quadratic).
    const strP = cs({ id: 'particle.ghost.strength', label: 'Pointer strength', min: 0, max: 4, value: 0.4 }, 0.05);
    strP.onChange(v => this.pointerPerf.setStrength(v));
    const modeP = c({ id: 'particle.ghost.mode', label: 'Pointer mode', type: PARAM_TYPE.SELECT,
         min: 0, max: 6, value: 0, step: 1,
         options: ['Flow','Source','Sink','Vortex','Turb','Freeze','Off'] });
    const _pointerModes = ['flow','source','sink','vortex','turbulence','freeze','none'];
    modeP.onChange(v => this.pointerPerf.setMode(_pointerModes[v] ?? 'flow'));
    const radP = cs({ id: 'particle.ghost.radius', label: 'Pointer radius', min: 0.01, max: 0.5, value: 0.08 }, 0.03);
    radP.onChange(v => this.pointerPerf.setRadius(v));
    const fadeP = cs({ id: 'particle.ghost.fadetime', label: 'Pointer fade', min: 0.05, max: 60.0, value: 0.8, step: 0.05 }, 0.05);
    fadeP.onChange(v => this.pointerPerf.setFadeTime(v));

    // ── Named ghost slots (controller-driven) ─────────────────────────────────
    for (let i = 1; i <= 3; i++) {
      c ({ id: `particle.ng${i}.on`,       label: `Ghost ${i} on`,       type: PARAM_TYPE.TOGGLE, value: 0 });
      cs({ id: `particle.ng${i}.x`,        label: `Ghost ${i} X`,        min: 0,    max: 100,  value: 50  }, 0.02);
      cs({ id: `particle.ng${i}.y`,        label: `Ghost ${i} Y`,        min: 0,    max: 100,  value: 50  }, 0.02);
      c ({ id: `particle.ng${i}.mode`,     label: `Ghost ${i} mode`,     type: PARAM_TYPE.SELECT,
           min: 0, max: 3, value: 0, step: 1, options: ['Attract','Repel','Vortex','Freeze'] });
      cs({ id: `particle.ng${i}.strength`, label: `Ghost ${i} strength`, min: -2,   max: 2,    value: 1.0 }, 0.03);
      cs({ id: `particle.ng${i}.radius`,   label: `Ghost ${i} radius`,   min: 0.01, max: 0.5,  value: 0.1 }, 0.03);
    }

    // ── Wire legacy PCount to GPU engine resize ───────────────────────────────
    const _countVals = [1024, 4096, 16384, 65536, 262144];
    ps.get('particle.count')?.onChange(v => this.gpu.setCount(_countVals[Math.round(v)] ?? 262144));

    // ── Triggers ──────────────────────────────────────────────────────────────
    let p;
    p = ps.register({ id: 'particle.respawn',   group: G, type: PARAM_TYPE.TRIGGER, label: 'Respawn' });
    p.onTrigger(() => this.gpu.respawn('random'));
    p = ps.register({ id: 'particle.freeze',    group: G, type: PARAM_TYPE.TRIGGER, label: 'Freeze mode' });
    p.onTrigger(() => this.pointerPerf.setMode('freeze'));
    p = ps.register({ id: 'particle.clearPins', group: G, type: PARAM_TYPE.TRIGGER, label: 'Clear pins' });
    p.onTrigger(() => this.ghostNodes.clear('pinned'));
  }

  tick(ps, dt, maskTex) {
    this._time += dt;

    this.ghostNodes.tick(performance.now());
    this.videoAnalysis.update(null); // videoElement wired in a later phase
    this.ghostNodes.updateFromVideo(this.videoAnalysis.brightPeaks);

    const get = (id, def) => ps?.get(id)?.value ?? def;

    // Update named ghost slots from controller params.
    // When off: park at (-10,-10) — always loses SDF min-dist check, never influences field.
    const _ngModes = ['attract','repel','vortex','freeze'];
    this._namedGhosts.forEach((ghostId, i) => {
      const n  = i + 1;
      const on = get(`particle.ng${n}.on`, 0) > 0.5;
      if (on) {
        this.ghostNodes.update(ghostId, {
          pos:      [get(`particle.ng${n}.x`,        50)  / 100,
                     1.0 - get(`particle.ng${n}.y`,  50)  / 100], // flip Y
          mode:     _ngModes[Math.round(get(`particle.ng${n}.mode`, 0))] ?? 'attract',
          strength: (() => { const v = get(`particle.ng${n}.strength`, 1.0); return v * Math.abs(v); })(), // signed-square: v²·sign(v), gives log-like resolution at small values
          radius:   get(`particle.ng${n}.radius`,   0.1), // per-ghost impact zone
        });
      } else {
        this.ghostNodes.update(ghostId, { pos: [-10, -10], strength: 0 });
      }
    });

    const sourceTex  = maskTex ?? this._fallback1x1Tex;
    const sourceDims = {
      w: this._renderer.domElement.width,
      h: this._renderer.domElement.height,
    };
    const ghostSDFRT = this.ghostNodes.buildSDFTexture(this._renderer, this._time);
    const forceRT    = this.forceField.composite({
      sourceTex,
      sourceDims,
      posAgeTex:   this.gpu.posAgeTex,
      velTex:      this.gpu.velTex,
      weights:     { gradient: get('particle.w.gradient', 0.4), flow: get('particle.w.flow', 0.3), nbody: get('particle.w.nbody', 0.1), ghost: get('particle.w.ghost', 0.2) },
      time:        this._time,
      flowFormula: get('particle.flowFormula', 0),
      lorenz:      { rho: get('particle.lorenz.rho', 28), sigma: get('particle.lorenz.sigma', 10), beta: get('particle.lorenz.beta', 2.67) },
      poles:       this.videoAnalysis.brightPeaks,
      nbody:       { attractRadius: get('particle.nbody.radius', 0.1), falloffExp: get('particle.nbody.falloff', 2.0), mode: get('particle.nbody.mode', 0) },
    });

    // Push live params into GPU simulation uniforms
    const uA = this.gpu._matA.uniforms;
    const uB = this.gpu._matB.uniforms;
    uA.uLifeDecay.value      = get('particle.lifeDecay',      0.005);
    uA.uBoundaryMode.value   = get('particle.boundaryMode',   1);
    uA.uEmitter.value        = get('particle.emitter',        0);
    uA.uEmitX.value          = get('particle.emitx',          50) / 100;
    uA.uEmitY.value          = 1.0 - get('particle.emity',   50) / 100; // flip Y: UI 0=top, GL 0=bottom
    uA.uSpread.value         = get('particle.spread',         90) / 100;
    uB.uBoundaryMode.value   = uA.uBoundaryMode.value;
    uB.uFieldStrength.value  = get('particle.fieldStrength',  1.0);
    uB.uInertia.value        = get('particle.inertia',        0.3);
    uB.uGhostStrength.value  = 1.0; // per-node strength is now the primary control; global multiplier is constant
    this.render._fadeMat.uniforms.uTrailDecay.value  = get('particle.trailDecay', 0.93);
    this.render._pointsMat.uniforms.uPointSize.value = get('particle.size',       2.0);

    this.render._pointsMat.uniforms.uColor1.value = this.color1;
    this.render._pointsMat.uniforms.uColor2.value = this.color2;

    this.gpu.update(dt, forceRT.texture, ghostSDFRT.texture);
    this.gpu.swap();
    this.render.draw(this.gpu.posAgeTex, this.gpu.velTex, get('particle.colorMode', 0), sourceTex, forceRT.texture);
  }

  resize(w, h) {
    this.render.resize(w, h);
  }

  dispose() {
    this.gpu.dispose();
    this.render.dispose();
    this.forceField.dispose();
    this.ghostNodes.dispose();
    this.pointerPerf.dispose();
    this._fallback1x1Tex.dispose();
  }
}
