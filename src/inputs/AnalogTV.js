import * as THREE from "three";
import { ANALOG_SOURCE_SIGNAL } from "../shaders/analog_source_signal.frag";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const INTERNAL_W = 720;
const INTERNAL_H = 480;

export class AnalogTV {
  constructor(renderer) {
    this.renderer = renderer;

    this._rt = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    });

    this._mat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture:    { value: null },
        uResolution: { value: new THREE.Vector2(INTERNAL_W, INTERNAL_H) },
        uBrightness: { value: 0 },
        uContrast:   { value: 1 },
        uSaturation: { value: 1 },
        uHueOffset:  { value: 0 },
        uCrop43:     { value: 1 },
      },
      vertexShader:   VERT,
      fragmentShader: ANALOG_SOURCE_SIGNAL,
      depthTest:  false,
      depthWrite: false,
    });

    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this._mat));
  }

  get texture() { return this._rt.texture; }

  tick(ps, dt, sourceTexture) {
    if (!sourceTexture) return;

    this._mat.uniforms.uTexture.value    = sourceTexture;
    this._mat.uniforms.uCrop43.value     = ps.get("analog.crop43").value;
    this._mat.uniforms.uBrightness.value = ps.get("analog.brightness").value / 100;
    this._mat.uniforms.uContrast.value   = ps.get("analog.contrast").value   / 100;
    this._mat.uniforms.uSaturation.value = ps.get("analog.saturation").value / 100;
    this._mat.uniforms.uHueOffset.value  = ps.get("analog.hueOffset").value;

    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._camera);
    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this._rt.dispose();
    this._mat.dispose();
    this._scene.children[0]?.geometry?.dispose();
  }
}
