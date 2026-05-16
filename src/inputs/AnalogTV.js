import * as THREE from "three";
import { ANALOG_SOURCE_SIGNAL } from "../shaders/analog_source_signal.frag";
import { ANALOG_CRT } from "../shaders/analog_crt.frag";

const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */ `
  uniform sampler2D uTexture;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(uTexture, vUv);
  }
`;

const INTERNAL_W = 720;
const INTERNAL_H = 480;

export class AnalogTV {
  constructor(renderer) {
    this.renderer = renderer;
    this._time = 0;

    const rtOpts = {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat,
    };

    // Render targets: signal pass output, CRT output, prev-frame for decay
    this._signalRt = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, rtOpts);
    this._rt       = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, rtOpts);
    this._prevRt   = new THREE.WebGLRenderTarget(INTERNAL_W, INTERNAL_H, rtOpts);

    // Source + Signal shader (Pass 1)
    this._signalMat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture:    { value: null },
        uResolution: { value: new THREE.Vector2(INTERNAL_W, INTERNAL_H) },
        uBrightness: { value: 0 },
        uContrast:   { value: 1 },
        uSaturation: { value: 1 },
        uHueOffset:  { value: 0 },
        uCrop43:     { value: 1 },
        uPattern:    { value: 0 },
        uTime:       { value: 0 },
      },
      vertexShader:   VERT,
      fragmentShader: ANALOG_SOURCE_SIGNAL,
      depthTest:  false,
      depthWrite: false,
    });

    // CRT shader (Pass 2)
    this._crtMat = new THREE.ShaderMaterial({
      uniforms: {
        uTexture:    { value: null },
        uPrevTex:    { value: null },
        uResolution: { value: new THREE.Vector2(INTERNAL_W, INTERNAL_H) },
        uTime:       { value: 0 },
        uScanlines:  { value: 0.3 },
        uBloom:      { value: 0.15 },
        uVignette:   { value: 0.4 },
        uCurvature:  { value: 0.25 },
        uYokeRing:   { value: 0 },
        uSVM:        { value: 0 },
        uBowl:       { value: 0 },
        uRipple:     { value: 0 },
        uDecay:      { value: 0.1 },
        uHalation:   { value: 0.1 },
        uBW:         { value: 0 },
        uBeamScan:   { value: 0 },
        uWaterLens:  { value: 0 },
        uPhosphor:   { value: 0 },
        uMaskType:   { value: 0 },
        // RF Interference
        uGhost1Str:   { value: 0 },
        uGhost1Delay: { value: 8 },
        uGhost2Str:   { value: 0 },
        uGhost2Delay: { value: 20 },
        uGhost3Str:   { value: 0 },
        uGhost3Delay: { value: 4 },
        uFlutter:     { value: 0 },
        uImpulse:     { value: 0 },
        uRinging:     { value: 0 },
        uHum:         { value: 0 },
        uCoChannel:   { value: 0 },
        // Tuner
        uHHold:        { value: 0 },
        uVHold:        { value: 0 },
        uHPos:         { value: 0.5 },
        uVPos:         { value: 0.5 },
        uRFTune:       { value: 0.5 },
        uInterlaced:   { value: 0 },
        uStandard:     { value: 1 },
        uVariant:      { value: 0 },
        uHanoverBars:  { value: 0 },
        uDelayLineErr: { value: 0 },
        uDecoder:      { value: 0 },
        uCrop43:      { value: 1 },
        uDotCrawl:    { value: 0 },
        uCrossColor:  { value: 0 },
        uChromaBleed: { value: 0 },
        uRainbow:     { value: 0 },
      },
      vertexShader:   VERT,
      fragmentShader: ANALOG_CRT,
      depthTest:  false,
      depthWrite: false,
    });

    // Copy/blit material (for prev-frame copy)
    this._copyMat = new THREE.ShaderMaterial({
      uniforms:     { uTexture: { value: null } },
      vertexShader:   VERT,
      fragmentShader: COPY_FRAG,
      depthTest:  false,
      depthWrite: false,
    });

    // Shared scene + camera + quad (reused across all passes)
    this._scene  = new THREE.Scene();
    this._camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2)));

    // Seed render targets with black
    this.renderer.setRenderTarget(this._signalRt);
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.clear();
    this.renderer.setRenderTarget(this._rt);
    this.renderer.clear();
    this.renderer.setRenderTarget(this._prevRt);
    this.renderer.clear();
    this.renderer.setRenderTarget(null);

    // 1×1 fallback texture for when no source is provided (test patterns)
    const fb = new Uint8Array([0, 0, 0, 255]);
    this._fallbackTex = new THREE.DataTexture(fb, 1, 1, THREE.RGBAFormat);
    this._fallbackTex.needsUpdate = true;

    // Pre-compile CRT shader to catch GLSL errors early
    this._scene.children[0].material = this._crtMat;
    try {
      this.renderer.compile(this._scene, this._camera);
    } catch (e) {
      console.error("[AnalogTV] CRT shader compile failed:", e);
    }
  }

  get texture() { return this._rt.texture; }

  tick(ps, dt, sourceTexture) {
    this._time += dt;

    const get = (id, def) => ps.get(id)?.value ?? def;
    const quad = this._scene.children[0];

    // ── Pass 1: Source + Signal ───────────────────────────────────────
    this._signalMat.uniforms.uTexture.value    = sourceTexture || this._fallbackTex;
    this._signalMat.uniforms.uCrop43.value     = get("analog.crop43");
    this._signalMat.uniforms.uBrightness.value = get("analog.brightness") / 100;
    this._signalMat.uniforms.uContrast.value   = get("analog.contrast")   / 100;
    this._signalMat.uniforms.uSaturation.value = get("analog.saturation") / 100;
    this._signalMat.uniforms.uHueOffset.value  = get("analog.hueOffset");
    const srcType = Math.round(get("analog.sourceType"));
    this._signalMat.uniforms.uPattern.value     = sourceTexture ? 0.0 : (srcType >= 7 ? (srcType - 6.0) : 0.0);
    this._signalMat.uniforms.uTime.value        = this._time;

    quad.material = this._signalMat;
    this.renderer.setRenderTarget(this._signalRt);
    this.renderer.render(this._scene, this._camera);

    // ── Pass 2: CRT Screen Physics ────────────────────────────────────
    this._crtMat.uniforms.uTexture.value    = this._signalRt.texture;
    this._crtMat.uniforms.uPrevTex.value    = this._prevRt.texture;
    this._crtMat.uniforms.uTime.value       = this._time;
    this._crtMat.uniforms.uScanlines.value  = get("analog.crt.scanlines")  / 100;
    this._crtMat.uniforms.uBloom.value      = get("analog.crt.bloom")      / 100;
    this._crtMat.uniforms.uVignette.value   = get("analog.crt.vignette")   / 100;
    this._crtMat.uniforms.uCurvature.value  = get("analog.crt.curvature")  / 100;
    this._crtMat.uniforms.uYokeRing.value   = get("analog.crt.yokeRing")   / 100;
    this._crtMat.uniforms.uSVM.value        = get("analog.crt.svm")        / 100;
    this._crtMat.uniforms.uBowl.value       = get("analog.crt.bowl");
    this._crtMat.uniforms.uRipple.value     = get("analog.crt.ripple")     / 100;
    this._crtMat.uniforms.uDecay.value      = get("analog.crt.decay")      / 100;
    this._crtMat.uniforms.uHalation.value   = get("analog.crt.halation")   / 100;
    this._crtMat.uniforms.uBW.value         = get("analog.crt.bwCRT");
    this._crtMat.uniforms.uBeamScan.value   = get("analog.crt.beamScan");
    this._crtMat.uniforms.uWaterLens.value  = get("analog.crt.waterLens");
    this._crtMat.uniforms.uPhosphor.value   = Math.round(get("analog.crt.phosphor"));
    this._crtMat.uniforms.uMaskType.value   = Math.round(get("analog.crt.maskType"));
    // RF Interference
    this._crtMat.uniforms.uGhost1Str.value   = get("analog.rf.ghost1Str")   / 100;
    this._crtMat.uniforms.uGhost1Delay.value = get("analog.rf.ghost1Delay");
    this._crtMat.uniforms.uGhost2Str.value   = get("analog.rf.ghost2Str")   / 100;
    this._crtMat.uniforms.uGhost2Delay.value = get("analog.rf.ghost2Delay");
    this._crtMat.uniforms.uGhost3Str.value   = get("analog.rf.ghost3Str")   / 100;
    this._crtMat.uniforms.uGhost3Delay.value = get("analog.rf.ghost3Delay");
    this._crtMat.uniforms.uFlutter.value     = get("analog.rf.flutter")     / 100;
    this._crtMat.uniforms.uImpulse.value     = get("analog.rf.impulse")     / 100;
    this._crtMat.uniforms.uRinging.value     = get("analog.rf.ringing")     / 100;
    this._crtMat.uniforms.uHum.value         = get("analog.rf.hum")         / 100;
    this._crtMat.uniforms.uCoChannel.value   = get("analog.rf.cochannel")   / 100;
    // Tuner
    this._crtMat.uniforms.uHHold.value        = get("analog.tuner.hHold")        / 100;
    this._crtMat.uniforms.uVHold.value        = get("analog.tuner.vHold")        / 100;
    this._crtMat.uniforms.uHPos.value         = get("analog.tuner.hPos")         / 100;
    this._crtMat.uniforms.uVPos.value         = get("analog.tuner.vPos")         / 100;
    this._crtMat.uniforms.uRFTune.value       = get("analog.tuner.rfTune")       / 100;
    this._crtMat.uniforms.uInterlaced.value   = get("analog.tuner.interlaced");
    this._crtMat.uniforms.uStandard.value     = Math.round(get("analog.tuner.standard"));
    this._crtMat.uniforms.uVariant.value      = Math.round(get("analog.tuner.variant"));
    this._crtMat.uniforms.uHanoverBars.value  = get("analog.tuner.hanoverBars");
    this._crtMat.uniforms.uDelayLineErr.value = get("analog.tuner.delayLineErr") / 100;
    this._crtMat.uniforms.uDecoder.value      = Math.round(get("analog.tuner.decoder"));
    this._crtMat.uniforms.uCrop43.value       = get("analog.crop43");
    this._crtMat.uniforms.uDotCrawl.value     = get("analog.composite.dotCrawl")    / 100;
    this._crtMat.uniforms.uCrossColor.value   = get("analog.composite.crossColor")  / 100;
    this._crtMat.uniforms.uChromaBleed.value  = get("analog.composite.chromaBleed") / 100;
    this._crtMat.uniforms.uRainbow.value      = get("analog.composite.rainbow")     / 100;

    quad.material = this._crtMat;
    this.renderer.setRenderTarget(this._rt);
    this.renderer.render(this._scene, this._camera);

    // ── Pass 3: Copy CRT output → prev-frame buffer (for next decay) ─
    this._copyMat.uniforms.uTexture.value = this._rt.texture;
    quad.material = this._copyMat;
    this.renderer.setRenderTarget(this._prevRt);
    this.renderer.render(this._scene, this._camera);

    this.renderer.setRenderTarget(null);
  }

  dispose() {
    this._signalRt.dispose();
    this._rt.dispose();
    this._prevRt.dispose();
    this._signalMat.dispose();
    this._crtMat.dispose();
    this._copyMat.dispose();
    this._scene.children[0]?.geometry?.dispose();
  }
}
