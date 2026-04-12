/**
 * ImWeb Geometry Factory
 * All procedural geometry generators.
 * Each returns a THREE.BufferGeometry.
 */

import * as THREE from 'three';

export class GeometryFactory {
  create(name, params = {}) {
    const fn = this[name.toLowerCase()];
    if (fn) return fn.call(this, params);
    console.warn(`[GeometryFactory] Unknown geometry: ${name}, falling back to Sphere`);
    return this.sphere(params);
  }

  sphere({ radius = 1, widthSeg = 128, heightSeg = 128 } = {}) {
    return new THREE.SphereGeometry(radius, widthSeg, heightSeg);
  }

  torus({ radius = 0.8, tube = 0.3, radSeg = 128, tubeSeg = 32 } = {}) {
    return new THREE.TorusGeometry(radius, tube, radSeg, tubeSeg);
  }

  cube({ size = 1.4 } = {}) {
    return new THREE.BoxGeometry(size, size, size, 64, 64, 64);
  }

  plane({ w = 2, h = 2, wSeg = 128, hSeg = 128 } = {}) {
    return new THREE.PlaneGeometry(w, h, wSeg, hSeg);
  }

  cylinder({ rt = 0.6, rb = 0.6, height = 1.6, seg = 64, hSeg = 64 } = {}) {
    return new THREE.CylinderGeometry(rt, rb, height, seg, hSeg);
  }

  capsule({ radius = 0.5, length = 1, cap = 32, radSeg = 64 } = {}) {
    return new THREE.CapsuleGeometry(radius, length, cap, radSeg);
  }

  torusknot({ radius = 0.7, tube = 0.2, tubeSeg = 256, radSeg = 32, p = 2, q = 3 } = {}) {
    return new THREE.TorusKnotGeometry(radius, tube, tubeSeg, radSeg, p, q);
  }

  cone({ radius = 0.8, height = 1.6, seg = 64, hSeg = 64 } = {}) {
    return new THREE.ConeGeometry(radius, height, seg, hSeg);
  }

  dodecahedron({ radius = 1, detail = 3 } = {}) {
    return new THREE.DodecahedronGeometry(radius, detail);
  }

  icosahedron({ radius = 1, detail = 5 } = {}) {
    return new THREE.IcosahedronGeometry(radius, detail);
  }

  octahedron({ radius = 1, detail = 5 } = {}) {
    return new THREE.OctahedronGeometry(radius, detail);
  }

  tetrahedron({ radius = 1, detail = 5 } = {}) {
    return new THREE.TetrahedronGeometry(radius, detail);
  }

  // Ring (like a flat disc with a hole)
  ring({ innerR = 0.3, outerR = 1, thetaSeg = 128, phiSeg = 8 } = {}) {
    return new THREE.RingGeometry(innerR, outerR, thetaSeg, phiSeg);
  }
}

export const GEOMETRY_NAMES = [
  'Sphere', 'Torus', 'Cube', 'Plane', 'Cylinder',
  'Capsule', 'TorusKnot', 'Cone', 'Dodecahedron', 'Icosahedron',
  'Octahedron', 'Tetrahedron', 'Ring',
];
