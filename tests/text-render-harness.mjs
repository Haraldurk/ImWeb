/**
 * Stubbed-2D-context harness for TextLayer.
 *
 * TextLayer's whole job is deciding WHERE and WHAT to draw; the actual
 * rasterising is the browser's. So the behaviour worth testing — which glyphs
 * are drawn, at what positions, with what alpha — is observable from a context
 * stub, no browser and no GPU, and it runs in the test suite rather than in
 * someone's session.
 *
 * measureText reports a flat 10px per character so positions are exact
 * integers and an advance bug shows up as arithmetic rather than as a
 * font-dependent near-miss.
 *
 * Export, don't run: tests/audit-text-render.mjs is the suite entry point.
 */

import * as THREE from 'three';

export const CHAR_W = 10;

/** Every text.* param the layer reads, at rest. Cases override what they need. */
export const REST = {
  'text.size': 72, 'text.opacity': 100, 'text.x': 50, 'text.y': 50,
  'text.spacing': 1.2, 'text.res': 0, 'text.weight': 400, 'text.italic': 0,
  'text.anim.dur': 1, 'text.align': 1, 'text.animMode': 0, 'text.animSpeed': 0,
  'text.animAmt': 0, 'text.anim.in': 0, 'text.anim.out': 0, 'text.anim.ease': 0,
  'text.stagger': 0, 'text.staggerFrom': 0, 'text.glitchSet': 0, 'text.font': 0,
  'text.mode': 0, 'text.hue': 0, 'text.sat': 0, 'text.bg': 0, 'text.bgOpacity': 100,
  'text.outline': 0, 'text.outlineHue': 0, 'text.outlineSat': 0,
  'text.letterspacing': 0, 'text.rotation': 0,
  'text.shadowBlur': 0, 'text.shadowX': 0, 'text.shadowY': 0,
  'text.autoplay': 0, 'text.rate': 0, 'text.auto': 0, 'text.progress': 0,
  'text.contentIdx': 0, 'text.advance': 0,
  'text.scrollX': 0, 'text.scrollY': 0, 'text.scrollGap': 20,
  'text.path': 0, 'text.pathRadius': 30, 'text.pathAngle': 0,
  'text.pathSpread': 360, 'text.pathWidth': 100, 'text.pathTwist': 0,
  'text.pathUpright': 0, 'text.pathFlip': 0,
};

/**
 * A 2D context that records draws with the current transform applied.
 * The CTM is a full 2x3 affine so rotate() and scale() are honoured — path
 * placement is exactly the feature that would slip past a translate-only stub.
 */
function makeCtx(record) {
  const I = () => [1, 0, 0, 1, 0, 0];   // a b c d e f
  const mul = (m, n) => [
    m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
  ];
  const ctx = {
    font: '', textAlign: '', textBaseline: '', fillStyle: '', strokeStyle: '',
    globalAlpha: 1, filter: 'none', lineWidth: 0, lineJoin: '',
    shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0, shadowColor: '',
    letterSpacing: '0px',
    _m: I(), _stack: [],
    save() { this._stack.push({ m: [...this._m], a: this.globalAlpha, f: this.filter }); },
    restore() {
      const s = this._stack.pop();
      if (s) { this._m = s.m; this.globalAlpha = s.a; this.filter = s.f; }
    },
    translate(x, y) { this._m = mul(this._m, [1, 0, 0, 1, x, y]); },
    rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._m = mul(this._m, [c, s, -s, c, 0, 0]); },
    scale(x, y) { this._m = mul(this._m, [x, 0, 0, y, 0, 0]); },
    clearRect() {}, fillRect() {},
    measureText(s) { return { width: s.length * CHAR_W }; },
    strokeText() {},
    fillText(s, x, y) {
      const m = this._m;
      record.push({
        s,
        x: +(m[0] * x + m[2] * y + m[4]).toFixed(4),
        y: +(m[1] * x + m[3] * y + m[5]).toFixed(4),
        a: +this.globalAlpha.toFixed(4),
        // Rotation of the drawn glyph, in degrees — 0 when nothing rotated it.
        rot: +(Math.atan2(m[1], m[0]) * 180 / Math.PI).toFixed(3),
      });
    },
  };
  return ctx;
}

let installed = false;

/** Install the DOM stubs TextLayer's constructor needs. Idempotent. */
export function installDom() {
  if (installed) return;
  installed = true;
  const record = [];
  globalThis.__textRecord = record;
  globalThis.document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => makeCtx(record) }),
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
  };
  // TextLayer only needs THREE.CanvasTexture and the filter constants; importing
  // the real module keeps the harness honest about that dependency.
  void THREE;
}

/** Fresh layer with `content` loaded. */
export async function makeLayer(content) {
  installDom();
  const { TextLayer } = await import('../src/inputs/TextLayer.js');
  const t = new TextLayer();
  t.setContent(content);
  return t;
}

/** Tick once with `overrides` on top of REST, returning the draws it produced. */
export function tick(layer, overrides = {}, dt = 0) {
  const P = { ...REST, ...overrides };
  const ps = { get: (id) => (id in P ? { value: P[id] } : undefined) };
  globalThis.__textRecord.length = 0;
  layer.tick(ps, dt);
  return [...globalThis.__textRecord];
}
