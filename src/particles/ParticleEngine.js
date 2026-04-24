import * as THREE          from 'three';
import { ParticleGPU }    from './ParticleGPU.js';
import { ParticleRender } from './ParticleRender.js';
import { ForceField }     from './ForceField.js';
import { ForceFormulas }  from './ForceFormulas.js';
import { VideoAnalysis }  from './VideoAnalysis.js';
import { GhostNodes }     from './GhostNodes.js';
import { PointerPerf }    from './PointerPerf.js';

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
  }

  get texture() { return this.render.texture; }

  tick(ps, dt, maskTex) {
    this._time += dt;

    this.ghostNodes.tick(performance.now());
    this.videoAnalysis.update(null); // videoElement wired in a later phase
    this.ghostNodes.updateFromVideo(this.videoAnalysis.brightPeaks);

    const sourceTex  = maskTex ?? this._fallback1x1Tex;
    const sourceDims = {
      w: this._renderer.domElement.width,
      h: this._renderer.domElement.height,
    };
    const ghostSDFRT = this.ghostNodes.buildSDFTexture(this._renderer);
    const forceRT    = this.forceField.composite({
      sourceTex,
      sourceDims,
      posAgeTex: this.gpu.posAgeTex,
      velTex:    this.gpu.velTex,
      weights:   { gradient: 0.6, flow: 0.4 },
      time:      this._time,
    });
    this.gpu.update(dt, forceRT.texture, ghostSDFRT.texture);
    this.gpu.swap();
    this.render.draw(this.gpu.posAgeTex, this.gpu.velTex);
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
