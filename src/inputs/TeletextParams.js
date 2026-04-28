// Teletext parameter registration.
// Call registerTeletextParams(ps) once during init, after registerAnalogParams(ps).

import { PARAM_TYPE } from '../controls/ParameterSystem.js';

export function registerTeletextParams(ps) {
  const G = 'teletext';

  ps.register({
    id: 'teletext.page', group: G, type: PARAM_TYPE.SELECT,
    options: ['P100', 'P150', 'P400', 'P401', 'P500', 'P700', 'P900'],
    value: 0, label: 'Page'
  });

  ps.register({
    id: 'teletext.subpageInterval', group: G, type: PARAM_TYPE.CONTINUOUS,
    min: 1, max: 30, value: 5, step: 1, unit: 's', label: 'Sub-page interval'
  });

  ps.register({
    id: 'teletext.pollInterval', group: G, type: PARAM_TYPE.CONTINUOUS,
    min: 60, max: 600, value: 300, step: 30, unit: 's', label: 'Poll interval'
  });

  ps.register({
    id: 'teletext.latitude', group: G, type: PARAM_TYPE.CONTINUOUS,
    min: -90, max: 90, value: 64.1466, step: 0.0001, label: 'Latitude'
  });

  ps.register({
    id: 'teletext.longitude', group: G, type: PARAM_TYPE.CONTINUOUS,
    min: -180, max: 180, value: -21.9426, step: 0.0001, label: 'Longitude'
  });

  ps.register({
    id: 'teletext.subPageNext', group: G, type: PARAM_TYPE.TRIGGER,
    label: 'Sub-page ▶'
  });

  ps.register({
    id: 'teletext.subPagePrev', group: G, type: PARAM_TYPE.TRIGGER,
    label: 'Sub-page ◀'
  });

  // Cursor navigation
  ps.register({ id: 'teletext.cursorUp',   group: G, type: PARAM_TYPE.TRIGGER, label: 'Cursor ▲' });
  ps.register({ id: 'teletext.cursorDown', group: G, type: PARAM_TYPE.TRIGGER, label: 'Cursor ▼' });
  ps.register({ id: 'teletext.openItem',   group: G, type: PARAM_TYPE.TRIGGER, label: 'Open item' });

  // Direct item open — slots 1–8
  for (let i = 1; i <= 8; i++) {
    ps.register({ id: `teletext.openItem${i}`, group: G, type: PARAM_TYPE.TRIGGER, label: `Open item ${i}` });
  }
}
