// Built-in vintage TV presets for the AnalogTV module
// Each preset stores values for all 43 analog.* parameters

export const BUILTIN_PRESETS = [
  {
    name: "Clean Tube",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":100,"analog.hueOffset":0,
      "analog.crt.scanlines":20,"analog.crt.bloom":8,"analog.crt.vignette":30,"analog.crt.curvature":10,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":20,"analog.crt.halation":5,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":1,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Cheap Portable",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":5,"analog.contrast":110,"analog.saturation":90,"analog.hueOffset":0,
      "analog.crt.scanlines":15,"analog.crt.bloom":30,"analog.crt.vignette":70,"analog.crt.curvature":70,
      "analog.crt.yokeRing":40,"analog.crt.svm":0,"analog.crt.bowl":1,"analog.crt.ripple":15,
      "analog.crt.decay":25,"analog.crt.halation":20,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":10,"analog.rf.impulse":5,
      "analog.rf.ringing":0,"analog.rf.hum":15,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Bad Antenna",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":100,"analog.hueOffset":0,
      "analog.crt.scanlines":25,"analog.crt.bloom":10,"analog.crt.vignette":40,"analog.crt.curvature":25,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":20,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":40,"analog.rf.ghost1Delay":12,"analog.rf.ghost2Str":25,"analog.rf.ghost2Delay":28,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":25,"analog.rf.impulse":10,
      "analog.rf.ringing":0,"analog.rf.hum":20,"analog.rf.cochannel":35,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":30,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "VHS Tracking",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":90,"analog.hueOffset":0,
      "analog.crt.scanlines":35,"analog.crt.bloom":10,"analog.crt.vignette":30,"analog.crt.curvature":15,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":40,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":20,"analog.rf.ghost1Delay":6,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":35,"analog.rf.impulse":15,
      "analog.rf.ringing":0,"analog.rf.hum":10,"analog.rf.cochannel":0,
      "analog.tuner.hHold":25,"analog.tuner.vHold":70,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":40,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Security Mon",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":-10,"analog.contrast":150,"analog.saturation":50,"analog.hueOffset":0,
      "analog.crt.scanlines":25,"analog.crt.bloom":5,"analog.crt.vignette":50,"analog.crt.curvature":0,
      "analog.crt.yokeRing":0,"analog.crt.svm":60,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":15,"analog.crt.halation":5,"analog.crt.bwCRT":1,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":0,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Worn Phosphor",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":-5,"analog.contrast":90,"analog.saturation":85,"analog.hueOffset":0,
      "analog.crt.scanlines":30,"analog.crt.bloom":25,"analog.crt.vignette":55,"analog.crt.curvature":35,
      "analog.crt.yokeRing":10,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":30,"analog.crt.halation":35,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":2,"analog.crt.maskType":2,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":5,
      "analog.rf.ringing":0,"analog.rf.hum":10,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":45,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Classic NTSC",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":105,"analog.saturation":110,"analog.hueOffset":0,
      "analog.crt.scanlines":25,"analog.crt.bloom":12,"analog.crt.vignette":35,"analog.crt.curvature":30,
      "analog.crt.yokeRing":10,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":5,
      "analog.crt.decay":20,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":2,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":10,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":5,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":48,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":1,"analog.tuner.delayLineErr":20,"analog.tuner.decoder":1,
    }
  },
  {
    name: "PAL Studio",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":100,"analog.hueOffset":0,
      "analog.crt.scanlines":40,"analog.crt.bloom":5,"analog.crt.vignette":10,"analog.crt.curvature":0,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":10,"analog.crt.halation":5,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":1,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":55,"analog.tuner.interlaced":1,"analog.tuner.standard":2,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":1,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":2,
    }
  },
  {
    name: "Degaussed",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":130,"analog.hueOffset":30,
      "analog.crt.scanlines":15,"analog.crt.bloom":20,"analog.crt.vignette":40,"analog.crt.curvature":45,
      "analog.crt.yokeRing":80,"analog.crt.svm":0,"analog.crt.bowl":1,"analog.crt.ripple":40,
      "analog.crt.decay":20,"analog.crt.halation":15,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":1,"analog.crt.phosphor":1,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Snow Storm",
    values: {
      "analog.sourceType":7,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":120,"analog.saturation":50,"analog.hueOffset":0,
      "analog.crt.scanlines":20,"analog.crt.bloom":5,"analog.crt.vignette":35,"analog.crt.curvature":25,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":10,"analog.crt.halation":5,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":15,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":30,"analog.rf.impulse":40,
      "analog.rf.ringing":0,"analog.rf.hum":10,"analog.rf.cochannel":20,
      "analog.tuner.hHold":20,"analog.tuner.vHold":15,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":35,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "UHF Tuning",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":-10,"analog.contrast":80,"analog.saturation":60,"analog.hueOffset":0,
      "analog.crt.scanlines":30,"analog.crt.bloom":15,"analog.crt.vignette":45,"analog.crt.curvature":30,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":20,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":2,
      "analog.rf.ghost1Str":60,"analog.rf.ghost1Delay":18,"analog.rf.ghost2Str":35,"analog.rf.ghost2Delay":40,
      "analog.rf.ghost3Str":15,"analog.rf.ghost3Delay":8,"analog.rf.flutter":40,"analog.rf.impulse":25,
      "analog.rf.ringing":15,"analog.rf.hum":30,"analog.rf.cochannel":50,
      "analog.tuner.hHold":10,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":25,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "SECAM Color",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":120,"analog.hueOffset":0,
      "analog.crt.scanlines":22,"analog.crt.bloom":10,"analog.crt.vignette":30,"analog.crt.curvature":20,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":15,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":1,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":52,"analog.tuner.interlaced":1,"analog.tuner.standard":3,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":1,"analog.tuner.delayLineErr":15,"analog.tuner.decoder":2,
    }
  },
  {
    name: "Broadcast Cam",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":105,"analog.saturation":100,"analog.hueOffset":0,
      "analog.crt.scanlines":10,"analog.crt.bloom":18,"analog.crt.vignette":15,"analog.crt.curvature":8,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":5,"analog.crt.halation":12,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":1,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":55,"analog.tuner.interlaced":0,"analog.tuner.standard":2,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "CCTV Night",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":15,"analog.contrast":140,"analog.saturation":30,"analog.hueOffset":0,
      "analog.crt.scanlines":5,"analog.crt.bloom":35,"analog.crt.vignette":60,"analog.crt.curvature":0,
      "analog.crt.yokeRing":0,"analog.crt.svm":80,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":35,"analog.crt.halation":40,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":1,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":10,"analog.rf.ghost1Delay":4,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":5,"analog.rf.impulse":15,
      "analog.rf.ringing":0,"analog.rf.hum":5,"analog.rf.cochannel":10,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":45,"analog.tuner.interlaced":0,"analog.tuner.standard":0,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Arcade Burn",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":5,"analog.contrast":120,"analog.saturation":80,"analog.hueOffset":0,
      "analog.crt.scanlines":35,"analog.crt.bloom":25,"analog.crt.vignette":40,"analog.crt.curvature":40,
      "analog.crt.yokeRing":5,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":45,"analog.crt.halation":30,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":1,"analog.crt.maskType":2,
      "analog.rf.ghost1Str":25,"analog.rf.ghost1Delay":16,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":10,
      "analog.rf.ringing":0,"analog.rf.hum":8,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":42,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Oscilloscope",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":10,"analog.contrast":130,"analog.saturation":0,"analog.hueOffset":0,
      "analog.crt.scanlines":0,"analog.crt.bloom":50,"analog.crt.vignette":25,"analog.crt.curvature":5,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":60,"analog.crt.halation":50,"analog.crt.bwCRT":0,"analog.crt.beamScan":1,
      "analog.crt.waterLens":0,"analog.crt.phosphor":3,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":0,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":0,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Broken V-Hold",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":100,"analog.hueOffset":0,
      "analog.crt.scanlines":20,"analog.crt.bloom":10,"analog.crt.vignette":35,"analog.crt.curvature":25,
      "analog.crt.yokeRing":0,"analog.crt.svm":0,"analog.crt.bowl":0,"analog.crt.ripple":10,
      "analog.crt.decay":20,"analog.crt.halation":10,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":20,"analog.rf.impulse":10,
      "analog.rf.ringing":0,"analog.rf.hum":5,"analog.rf.cochannel":0,
      "analog.tuner.hHold":15,"analog.tuner.vHold":90,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":50,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "80s Music Vid",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":5,"analog.contrast":115,"analog.saturation":150,"analog.hueOffset":0,
      "analog.crt.scanlines":18,"analog.crt.bloom":20,"analog.crt.vignette":25,"analog.crt.curvature":25,
      "analog.crt.yokeRing":0,"analog.crt.svm":15,"analog.crt.bowl":0,"analog.crt.ripple":0,
      "analog.crt.decay":10,"analog.crt.halation":15,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":0,"analog.crt.phosphor":0,"analog.crt.maskType":2,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":5,"analog.rf.impulse":0,
      "analog.rf.ringing":0,"analog.rf.hum":0,"analog.rf.cochannel":0,
      "analog.tuner.hHold":0,"analog.tuner.vHold":0,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":52,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":3,"analog.tuner.hanoverBars":0,"analog.tuner.delayLineErr":0,"analog.tuner.decoder":0,
    }
  },
  {
    name: "Mag Storm",
    values: {
      "analog.sourceType":0,"analog.crop43":1,
      "analog.brightness":0,"analog.contrast":100,"analog.saturation":140,"analog.hueOffset":60,
      "analog.crt.scanlines":10,"analog.crt.bloom":15,"analog.crt.vignette":30,"analog.crt.curvature":55,
      "analog.crt.yokeRing":90,"analog.crt.svm":0,"analog.crt.bowl":1,"analog.crt.ripple":60,
      "analog.crt.decay":15,"analog.crt.halation":20,"analog.crt.bwCRT":0,"analog.crt.beamScan":0,
      "analog.crt.waterLens":1,"analog.crt.phosphor":4,"analog.crt.maskType":0,
      "analog.rf.ghost1Str":0,"analog.rf.ghost1Delay":8,"analog.rf.ghost2Str":0,"analog.rf.ghost2Delay":20,
      "analog.rf.ghost3Str":0,"analog.rf.ghost3Delay":4,"analog.rf.flutter":15,"analog.rf.impulse":20,
      "analog.rf.ringing":25,"analog.rf.hum":25,"analog.rf.cochannel":30,
      "analog.tuner.hHold":35,"analog.tuner.vHold":40,"analog.tuner.hPos":50,"analog.tuner.vPos":50,
      "analog.tuner.rfTune":30,"analog.tuner.interlaced":0,"analog.tuner.standard":1,
      "analog.tuner.variant":0,"analog.tuner.hanoverBars":1,"analog.tuner.delayLineErr":40,"analog.tuner.decoder":1,
    }
  },
];

export function captureAnalogState(ps) {
  const s = {};
  ps.getGroup('analog').forEach(p => { s[p.id] = p.value; });
  return s;
}

export function applyAnalogPreset(ps, values) {
  Object.entries(values).forEach(([id, v]) => {
    ps.set(id, v);
  });
}
