/**
 * ImWeb WarpMaps — Phase 2
 *
 * Procedurally generates a set of classic warp map textures.
 * Each map is a 256×256 THREE.DataTexture where:
 *   R channel = horizontal displacement (0.5 = none, 0 = max left, 1 = max right)
 *   G channel = vertical displacement   (0.5 = none)
 *
 * Maps are pre-built once at startup and stay in GPU memory.
 * The `displace.warp` SELECT parameter (map1–map8) indexes into this array.
 *
 * Patterns:
 *   1  Horizontal wave
 *   2  Vertical wave
 *   3  Radial (outward push from center)
 *   4  Spiral
 *   5  Diagonal shear
 *   6  Pinch (inward pull to center)
 *   7  Turbulence (pseudo-random)
 *   8  Concentric rings
 */

import * as THREE from 'three';

const SIZE = 256;

function makeMap(fillFn) {
  const data = new Uint8Array(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    const ny = y / (SIZE - 1); // 0..1
    for (let x = 0; x < SIZE; x++) {
      const nx = x / (SIZE - 1);
      const [r, g] = fillFn(nx, ny);
      const i = (y * SIZE + x) * 4;
      data[i]     = Math.round(Math.max(0, Math.min(1, r)) * 255);
      data[i + 1] = Math.round(Math.max(0, Math.min(1, g)) * 255);
      data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat);
  tex.needsUpdate = true;
  return tex;
}

// Simple deterministic hash for turbulence
function hash(x, y) {
  const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function smoothNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  return (
    hash(ix,     iy)     * (1 - ux) * (1 - uy) +
    hash(ix + 1, iy)     * ux       * (1 - uy) +
    hash(ix,     iy + 1) * (1 - ux) * uy       +
    hash(ix + 1, iy + 1) * ux       * uy
  );
}

export function buildWarpMaps() {
  return [
    // 1 — Horizontal sine wave
    makeMap((x, y) => [0.5 + 0.5 * Math.sin(y * Math.PI * 4), 0.5]),

    // 2 — Vertical sine wave
    makeMap((x, y) => [0.5, 0.5 + 0.5 * Math.sin(x * Math.PI * 4)]),

    // 3 — Radial outward push
    makeMap((x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const len = r > 0 ? r : 0.0001;
      return [0.5 + dx / len * 0.5, 0.5 + dy / len * 0.5];
    }),

    // 4 — Spiral (radial + rotational)
    makeMap((x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const a  = Math.atan2(dy, dx) + r * Math.PI * 4;
      return [0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5];
    }),

    // 5 — Diagonal shear
    makeMap((x, y) => [0.5 + (y - 0.5) * 0.5, 0.5 + (x - 0.5) * 0.5]),

    // 6 — Pinch (inward pull to center)
    makeMap((x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const s  = 1 - r * 1.5;
      return [0.5 + dx * s, 0.5 + dy * s];
    }),

    // 7 — Turbulence (smooth noise)
    makeMap((x, y) => [
      0.5 + (smoothNoise(x * 4,     y * 4)     - 0.5),
      0.5 + (smoothNoise(x * 4 + 5, y * 4 + 5) - 0.5),
    ]),

    // 8 — Concentric rings
    makeMap((x, y) => {
      const dx = x - 0.5, dy = y - 0.5;
      const r  = Math.sqrt(dx * dx + dy * dy);
      const w  = Math.sin(r * Math.PI * 12) * 0.5;
      const len = r > 0 ? r : 0.0001;
      return [0.5 + dx / len * w, 0.5 + dy / len * w];
    }),
  ];
}
