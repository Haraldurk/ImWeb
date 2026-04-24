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
    cs({ id: 'particle.ghost.strength', label: 'Ghost strength', min: 0, max: 4, value: 0.4 }, 0.05);
    const modeP = c({ id: 'particle.ghost.mode', label: 'Pointer mode', type: PARAM_TYPE.SELECT,
         min: 0, max: 5, value: 0, step: 1,
         options: ['Flow','Source','Sink','Vortex','Turb','Freeze'] });
    const _pointerModes = ['flow','source','sink','vortex','turbulence','freeze'];
    modeP.onChange(v => this.pointerPerf.setMode(_pointerModes[v] ?? 'flow'));

    // ── Triggers ──────────────────────────────────────────────────────────────
    let p;
    p = ps.register({ id: 'particle.respawn', group: G, type: PARAM_TYPE.TRIGGER, label: 'Respawn' });
    p.onTrigger(() => this.gpu.respawn('random'));
    p = ps.register({ id: 'particle.freeze', group: G, type: PARAM_TYPE.TRIGGER, label: 'Freeze' });
    p.onTrigger(() => this.pointerPerf.setMode('freeze'));
  }

  tick(ps, dt, maskTex) {
    this._time += dt;

    this.ghostNodes.tick(performance.now());
    this.videoAnalysis.update(null); // videoElement wired in a later phase
    this.ghostNodes.updateFromVideo(this.videoAnalysis.brightPeaks);

    const get = (id, def) => ps?.get(id)?.value ?? def;

    const sourceTex  = maskTex ?? this._fallback1x1Tex;
    const sourceDims = {
      w: this._renderer.domElement.width,
      h: this._renderer.domElement.height,
    };
    const ghostSDFRT = this.ghostNodes.buildSDFTexture(this._renderer);
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
    uA.uSpread.value         = get('particle.spread',         10) / 100;
    uB.uBoundaryMode.value   = uA.uBoundaryMode.value;
    uB.uFieldStrength.value  = get('particle.fieldStrength',  1.0);
    uB.uInertia.value        = get('particle.inertia',        0.3);
    uB.uGhostStrength.value  = get('particle.ghost.strength', 0.4);
    this.render._fadeMat.uniforms.uTrailDecay.value  = get('particle.trailDecay', 0.93);
    this.render._pointsMat.uniforms.uPointSize.value = get('particle.size',       2.0);

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
