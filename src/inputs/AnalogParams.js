import { PARAM_TYPE } from "../controls/ParameterSystem.js";

export function registerAnalogParams(ps) {
  const G = "analog";

  ps.register({
    id: "analog.sourceType", group: G, type: PARAM_TYPE.SELECT,
    options: ["Camera", "Movie", "Buffer", "Noise", "3D Scene", "Draw", "Output", "Snow", "SMPTE 75%", "SMPTE 100%", "Rainbow", "Gray Steps", "Multiburst", "Crosshatch", "Teletext"],
    value: 0, label: "Source"
  });

  ps.register({
    id: "analog.crop43", group: G, type: PARAM_TYPE.TOGGLE,
    value: 1, label: "Crop 4:3"
  });

  ps.register({
    id: "analog.brightness", group: G, min: -100, max: 100, value: 0,
    unit: "%", label: "Brightness"
  });

  ps.register({
    id: "analog.contrast", group: G, min: 0, max: 200, value: 100,
    unit: "%", label: "Contrast"
  });

  ps.register({
    id: "analog.saturation", group: G, min: 0, max: 200, value: 100,
    unit: "%", label: "Saturation"
  });

  ps.register({
    id: "analog.hueOffset", group: G, min: -180, max: 180, value: 0,
    unit: "\u00B0", label: "Hue Offset"
  });

  // ── CRT Screen Physics ────────────────────────────────────────────────

  ps.register({
    id: "analog.crt.scanlines", group: G, min: 0, max: 100, value: 30,
    unit: "%", label: "Scanlines"
  });

  ps.register({
    id: "analog.crt.bloom", group: G, min: 0, max: 100, value: 15,
    unit: "%", label: "Bloom"
  });

  ps.register({
    id: "analog.crt.vignette", group: G, min: 0, max: 100, value: 40,
    unit: "%", label: "Vignette"
  });

  ps.register({
    id: "analog.crt.curvature", group: G, min: 0, max: 100, value: 25,
    unit: "%", label: "Curvature"
  });

  ps.register({
    id: "analog.crt.yokeRing", group: G, min: 0, max: 100, value: 0,
    unit: "%", label: "Yoke Ring"
  });

  ps.register({
    id: "analog.crt.svm", group: G, min: 0, max: 100, value: 0,
    unit: "%", label: "SVM"
  });

  ps.register({
    id: "analog.crt.bowl", group: G, type: PARAM_TYPE.TOGGLE,
    value: 0, label: "Bowl"
  });

  ps.register({
    id: "analog.crt.ripple", group: G, min: 0, max: 100, value: 0,
    unit: "%", label: "Ripple"
  });

  ps.register({
    id: "analog.crt.decay", group: G, min: 0, max: 100, value: 30,
    unit: "%", label: "Decay"
  });

  ps.register({
    id: "analog.crt.halation", group: G, min: 0, max: 100, value: 10,
    unit: "%", label: "Halation"
  });

  ps.register({
    id: "analog.crt.bwCRT", group: G, type: PARAM_TYPE.TOGGLE,
    value: 0, label: "B&W CRT"
  });

  ps.register({
    id: "analog.crt.beamScan", group: G, type: PARAM_TYPE.TOGGLE,
    value: 0, label: "Beam Scan"
  });

  ps.register({
    id: "analog.crt.waterLens", group: G, type: PARAM_TYPE.TOGGLE,
    value: 0, label: "Water Lens"
  });

  ps.register({
    id: "analog.crt.phosphor", group: G, type: PARAM_TYPE.SELECT,
    options: ["P22", "P31", "P45", "P4", "P3", "P7", "P11", "P24"],
    value: 0, label: "Phosphor"
  });

  ps.register({
    id: "analog.crt.maskType", group: G, type: PARAM_TYPE.SELECT,
    options: ["None", "Aperture Grille", "Shadow Mask"],
    value: 0, label: "Mask"
  });

  // ── RF Interference ──────────────────────────────────────────────────

  ps.register({ id: "analog.rf.ghost1Str",    group: G, min: 0, max: 100, value: 0, unit: "%", label: "Ghost 1 Str" });
  ps.register({ id: "analog.rf.ghost1Delay",  group: G, min: 0, max: 64,  value: 8, unit: "px", label: "Ghost 1 Delay" });
  ps.register({ id: "analog.rf.ghost2Str",    group: G, min: 0, max: 100, value: 0, unit: "%", label: "Ghost 2 Str" });
  ps.register({ id: "analog.rf.ghost2Delay",  group: G, min: 0, max: 64,  value: 20,unit: "px", label: "Ghost 2 Delay" });
  ps.register({ id: "analog.rf.ghost3Str",    group: G, min: 0, max: 100, value: 0, unit: "%", label: "Ghost 3 Str" });
  ps.register({ id: "analog.rf.ghost3Delay",  group: G, min: 0, max: 64,  value: 4, unit: "px", label: "Ghost 3 Delay" });
  ps.register({ id: "analog.rf.flutter",      group: G, min: 0, max: 100, value: 0, unit: "%", label: "Flutter" });
  ps.register({ id: "analog.rf.impulse",      group: G, min: 0, max: 100, value: 0, unit: "%", label: "Impulse" });
  ps.register({ id: "analog.rf.ringing",      group: G, min: 0, max: 100, value: 0, unit: "%", label: "Ringing" });
  ps.register({ id: "analog.rf.hum",          group: G, min: 0, max: 100, value: 0, unit: "%", label: "Hum" });
  ps.register({ id: "analog.rf.cochannel",    group: G, min: 0, max: 100, value: 0, unit: "%", label: "Co-Channel" });

  // ── Composite Artifacts ──────────────────────────────────────────────

  ps.register({ id: "analog.composite.dotCrawl",   group: G, min: 0, max: 100, value: 0, unit: "%", label: "Dot Crawl" });
  ps.register({ id: "analog.composite.crossColor", group: G, min: 0, max: 100, value: 0, unit: "%", label: "Cross Color" });
  ps.register({ id: "analog.composite.chromaBleed",group: G, min: 0, max: 100, value: 0, unit: "%", label: "Chroma Bleed" });
  ps.register({ id: "analog.composite.rainbow",    group: G, min: 0, max: 100, value: 0, unit: "%", label: "Rainbow" });

  // ── Tuner ────────────────────────────────────────────────────────────

  ps.register({ id: "analog.tuner.hHold",        group: G, min: 0, max: 100, value: 0, unit: "%", label: "H-Hold" });
  ps.register({ id: "analog.tuner.vHold",        group: G, min: 0, max: 100, value: 0, unit: "%", label: "V-Hold" });
  ps.register({ id: "analog.tuner.hPos",         group: G, min: 0, max: 100, value: 50,unit: "%", label: "H-Pos" });
  ps.register({ id: "analog.tuner.vPos",         group: G, min: 0, max: 100, value: 50,unit: "%", label: "V-Pos" });
  ps.register({ id: "analog.tuner.rfTune",       group: G, min: 0, max: 100, value: 50,unit: "%", label: "RF Tune" });
  ps.register({ id: "analog.tuner.interlaced",   group: G, type: PARAM_TYPE.TOGGLE, value: 0, label: "Interlaced" });
  ps.register({ id: "analog.tuner.standard",     group: G, type: PARAM_TYPE.SELECT, options: ["B&W", "NTSC", "PAL", "SECAM", "MAC/HD"], value: 1, label: "Standard" });
  ps.register({ id: "analog.tuner.variant",      group: G, type: PARAM_TYPE.SELECT, options: ["Default", "PAL-M", "PAL-N", "PAL-60", "NTSC-J", "NTSC-4.43"], value: 0, label: "Variant" });
  ps.register({ id: "analog.tuner.hanoverBars",  group: G, type: PARAM_TYPE.TOGGLE, value: 0, label: "Hanover Bars" });
  ps.register({ id: "analog.tuner.delayLineErr", group: G, min: 0, max: 100, value: 0, unit: "%", label: "Delay Line Err" });
  ps.register({ id: "analog.tuner.decoder",      group: G, type: PARAM_TYPE.SELECT, options: ["Standard", "Simple", "Comb"], value: 0, label: "Decoder" });
}
