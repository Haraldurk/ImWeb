import { ParticleGPU }    from './ParticleGPU.js';
import { ParticleRender } from './ParticleRender.js';

export class ParticleEngine {
  constructor(renderer, paramSystem) {
    this.gpu    = new ParticleGPU(renderer);
    this.render = new ParticleRender(
      renderer,
      renderer.domElement.width,
      renderer.domElement.height
    );
  }

  get texture() { return this.render.texture; }

  // maskTex ignored in Phase A
  tick(ps, dt, maskTex) {
    this.gpu.update(dt);
    this.gpu.swap();
    this.render.draw(this.gpu.posAgeTex, this.gpu.velTex);
  }

  resize(w, h) {
    this.render.resize(w, h);
  }

  dispose() {
    this.gpu.dispose();
    this.render.dispose();
  }
}
