import { PARAM_TYPE } from "../controls/ParameterSystem.js";

export function registerAnalogParams(ps) {
  const G = "analog";

  ps.register({
    id: "analog.sourceType", group: G, type: PARAM_TYPE.SELECT,
    options: ["Camera", "Movie", "Buffer", "Noise", "3D Scene", "Draw", "Output"],
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
}
