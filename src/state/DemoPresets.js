/**
 * Factory demo presets — seeded into IndexedDB on first launch.
 * All presets use no-camera sources.
 * Values set only the key params; everything else stays at ParameterSystem defaults.
 *
 * To re-seed after first launch: clear IndexedDB in DevTools →
 *   Application → Storage → IndexedDB → imweb-presets, then reload.
 *
 * Source indices: Camera=0, Movie=1, Buffer=2, Color=3, Noise=4,
 *   3D Scene=5, Draw=6, Output=7, Particles=16, SDF=21
 * Transfer modes: Copy=0, XOR=1, Multiply=4, Screen=5, Add=6
 */

export const DEMO_PRESETS = [
  {
    index: 0,
    name: 'SDF Metaballs',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'layer.fg': 21,        // SDF
          'layer.bg': 4,         // Noise
          'sdf.active': 1,
          'sdf.speed': 0.25,
          'sdf.warp': 0.35,
          'sdf.glow': 0.55,
          'sdf.ao': 0.6,
          'sdf.hue': 200,
          'sdf.sat': 0.75,
          'sdf.val': 1.0,
          'sdf.distance': 1.5,
          'blend.active': 1,
          'blend.amount': 35,
          'output.transfer': 5,  // Screen
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },

  {
    index: 1,
    name: 'Noise Feedback',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'layer.fg': 4,         // Noise
          'layer.bg': 4,         // Noise
          'displace.warp': 4,    // Spiral
          'displace.warpamt': 28,
          'blend.active': 1,
          'blend.amount': 82,
          'feedback.rotate': 1.5,
          'feedback.zoom': 2,
          'output.transfer': 5,  // Screen
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },

  {
    index: 2,
    name: '3D Orbit',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'layer.fg': 5,               // 3D Scene
          'layer.bg': 3,               // Color
          'scene3d.active': 1,
          'scene3d.geo': 6,            // TorusKnot
          'scene3d.spin.y': 40,
          'scene3d.blob.amount': 1.0,
          'scene3d.blob.speed': 0.4,
          'scene3d.mat.roughness': 0.1,
          'scene3d.mat.metalness': 0.85,
          'scene3d.mat.emissive': 0.15,
          'scene3d.light.ambient': 0.3,
          'scene3d.light.point': 1.2,
          'output.transfer': 0,        // Copy
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },

  {
    index: 3,
    name: 'KIFS Fractal',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'layer.fg': 21,        // SDF
          'layer.bg': 3,         // Color
          'sdf.active': 1,
          'sdf.shape': 2,        // Torus
          'sdf.kifsIter': 3,
          'sdf.kifsAngle': 42,
          'sdf.speed': 0.12,
          'sdf.warp': 0.2,
          'sdf.glow': 0.7,
          'sdf.ao': 0.5,
          'sdf.hue': 28,
          'sdf.sat': 0.9,
          'sdf.val': 1.0,
          'blend.active': 0,
          'output.transfer': 0,  // Copy
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },

  {
    index: 4,
    name: 'Cloner Wave',
    controllers: {},
    states: [
      {
        label: 'State 0',
        values: {
          'layer.fg': 5,                 // 3D Scene
          'layer.bg': 4,                 // Noise
          'scene3d.active': 1,
          'scene3d.geo': 0,              // Sphere
          'scene3d.clone.mode': 2,       // Ring
          'scene3d.clone.count': 18,
          'scene3d.clone.spread': 3.5,
          'scene3d.clone.wave': 0.6,
          'scene3d.clone.waveamp': 1.8,
          'scene3d.clone.wavefreq': 1.0,
          'scene3d.spin.y': 15,
          'scene3d.mat.roughness': 0.3,
          'scene3d.mat.metalness': 0.6,
          'scene3d.light.point': 1.5,
          'output.transfer': 5,          // Screen
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },

  {
    index: 5,
    name: 'Temporal Smear',
    controllers: {},
    states: [
      {
        // State 0: Noise feedback source building the ring buffer
        label: 'Build',
        values: {
          'layer.fg': 4,           // Noise — builds VWarp history
          'layer.bg': 4,           // Noise
          'vwarp.active': 1,       // Start capturing
          'vwarp.strength': 0.8,
          'vwarp.axis': 0,         // Horizontal sweep
          'blend.active': 1,
          'blend.amount': 75,
          'feedback.zoom': 2,
          'feedback.rotate': 0.5,
          'output.transfer': 5,    // Screen
        },
        fxOrder: null,
      },
      {
        // State 1: Switch FG to VWarp output — temporal slit-scan visible
        label: 'Slit-scan',
        values: {
          'layer.fg': 22,          // VWarp temporal output
          'layer.bg': 4,           // Noise
          'vwarp.active': 1,
          'vwarp.strength': 0.8,
          'vwarp.axis': 0,
          'vwarp.mix': 1.0,
          'output.transfer': 0,    // Copy
        },
        fxOrder: null,
      },
    ],
    activeState: 0,
    thumbnail: null,
  },
];
