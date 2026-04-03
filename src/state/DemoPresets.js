/**
 * Factory demo presets — seeded into IndexedDB on first launch.
 * All presets use no-camera sources (particles, slitscan, text, 3D scene).
 * Values are intentionally minimal: they set only the key source/effect params
 * and leave everything else at ParameterSystem defaults.
 */

export const DEMO_PRESETS = [
  {
    index: 0,
    name: 'Particles',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'scene3d.active': 0,
          'slitscan.active': 0,
          'camera.active': 0,
          'movie.active': 0,
          'blend.active': 1,
          'blend.amount': 50,
          'output.fade': 0,
        },
        fxOrder: null,
      }
    ],
    activeState: 0,
    thumbnail: null,
  },
  {
    index: 1,
    name: 'SlitScan',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'scene3d.active': 0,
          'slitscan.active': 1,
          'slitscan.speed': 2,
          'slitscan.width': 2,
          'camera.active': 0,
          'movie.active': 0,
          'blend.active': 1,
          'blend.amount': 70,
          'output.fade': 0,
        },
        fxOrder: null,
      }
    ],
    activeState: 0,
    thumbnail: null,
  },
  {
    index: 2,
    name: 'TextLayer',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'scene3d.active': 0,
          'slitscan.active': 0,
          'camera.active': 0,
          'movie.active': 0,
          'text.size': 48,
          'text.opacity': 100,
          'text.x': 50,
          'text.y': 50,
          'blend.active': 1,
          'output.fade': 0,
        },
        fxOrder: null,
      }
    ],
    activeState: 0,
    thumbnail: null,
  },
  {
    index: 3,
    name: '3D Scene',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'scene3d.active': 1,
          'slitscan.active': 0,
          'camera.active': 0,
          'movie.active': 0,
          'blend.active': 1,
          'blend.amount': 50,
          'output.fade': 0,
        },
        fxOrder: null,
      }
    ],
    activeState: 0,
    thumbnail: null,
  },
];
