/**
 * ImWeb AI Features
 *
 * Three AI-powered features using the Anthropic API (user-supplied key).
 *
 * Feature 1: AI Preset Generator — describe a look, get parameter values
 * Feature 2: Parameter Narrator  — live one-sentence description of signal path
 * Feature 3: Performance Coach   — 30-second activity watch, one actionable suggestion
 *
 * API key stored in localStorage as 'imweb-anthropic-key'.
 * All calls go directly to api.anthropic.com (requires browser CORS header).
 */

const API_URL   = 'https://api.anthropic.com/v1/messages';
const MODEL     = 'claude-sonnet-4-6';
const KEY_STORE = 'imweb-anthropic-key';

// ── Core API call ─────────────────────────────────────────────────────────────

async function callClaude(apiKey, systemPrompt, userPrompt, maxTokens = 512) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `API error ${res.status}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text ?? '';
}

// ── API key management ────────────────────────────────────────────────────────

export function getApiKey() { return localStorage.getItem(KEY_STORE) ?? ''; }
export function setApiKey(k) { localStorage.setItem(KEY_STORE, k); }
export function clearApiKey() { localStorage.removeItem(KEY_STORE); }

// ── System prompt helpers ─────────────────────────────────────────────────────

const PARAM_REFERENCE = `
ImWeb parameter reference (id → range/options, description):
SOURCES (for layer.fg, layer.bg, layer.ds):
  0=Camera, 1=Movie, 2=Buffer, 3=Color, 4=Noise, 5=3D Scene, 6=Draw, 7=Output(feedback),
  8=BG1, 9=BG2, 10=Color2, 11=Text, 12=Sound, 13=Delay, 14=Scope, 15=SlitScan,
  16=Particles, 17=Seq1, 18=Seq2, 19=Seq3

LAYERS:
  layer.fg [0..19]     — foreground source
  layer.bg [0..19]     — background source
  layer.ds [0..19]     — displacement/key source

KEYER:
  keyer.active [0/1]   — luma keyer on/off
  keyer.white  [0..1]  — upper threshold (white key level)
  keyer.black  [0..1]  — lower threshold (black key level)
  keyer.soft   [0..1]  — edge softness

DISPLACEMENT:
  displace.amount  [0..1]   — displacement strength
  displace.angle   [0..360] — displacement direction in degrees
  displace.offset  [-1..1]  — grey-level offset
  displace.rotateg [0/1]    — circular displacement (RotateGrey)
  displace.warp    [0..9]   — 0=off, 1=H-Wave, 2=V-Wave, 3=Radial, 4=Spiral,
                              5=Shear, 6=Pinch, 7=Turb, 8=Rings, 9=Custom
  displace.warpamt [0..100] — warp strength %

TRANSFERMODE:
  transfermode.mode [0..22] — 0=Copy, 1=XOR, 2=OR, 3=AND, 4=Multiply, 5=Screen,
    6=Add, 7=Difference, 8=Exclusion, 9=Overlay, 10=Hardlight, 11=Softlight,
    12=Dodge, 13=Burn, 14=Subtract, 15=Divide, 16=PinLight, 17=VividLight,
    18=Hue, 19=Saturation, 20=Color, 21=Luminosity

BLEND / FEEDBACK:
  blend.active  [0/1]    — frame persistence on/off
  blend.amount  [0..1]   — blend mix (0=no blend, 1=full persistence)
  feedback.scale [-0.5..0.5] — feedback zoom
  feedback.x    [-0.5..0.5] — horizontal feedback offset
  feedback.y    [-0.5..0.5] — vertical feedback offset

COLOR SHIFT:
  colorshift.amount [0..1] — global hue rotation

COLOR SOURCE:
  color.hue  [0..360]  — BG color hue
  color.sat  [0..100]  — saturation
  color.val  [0..100]  — brightness

SCENE 3D:
  scene3d.spin.x/y/z [−180..180] — auto-spin speed °/s
  scene3d.geo  [0..12] — geometry: 0=Sphere, 1=Torus, 2=Box, 3=Plane, 4=Cylinder,
    5=Cone, 6=TorusKnot, 7=Ring, 8=Capsule, 9=Octahedron, 10=Icosahedron,
    11=Tetrahedron, 12=Dodecahedron

MOVIE:
  movie.speed  [-1..3]  — playback speed (1=normal, 0=paused, negative=reverse)
  movie.bpmsync [0/1]   — lock to BPM

EFFECTS:
  effect.fade      [0..1]   — fade to black
  effect.interlace [0/1]    — scan-line interlace effect
  effect.bloom     [0/1]    — bloom glow
  effect.vignette  [0/1]    — vignette
  effect.kaleid    [0/1]    — kaleidoscope
  effect.mirror    [0/1]    — quad mirror
  effect.grain     [0/1]    — film grain
  effect.strobe    [0/1]    — stroboscope
  effect.pixsort   [0/1]    — pixel sort glitch
  effect.lut       [0/1]    — 3D LUT colour grading

OUTPUT:
  output.brightness [−1..1]
  output.contrast   [0..2]
`;

// ── Feature 1: AI Preset Generator ───────────────────────────────────────────

const PRESET_SYSTEM = `You are an ImWeb parameter designer. ImWeb is a real-time video synthesis instrument.
${PARAM_REFERENCE}
The user describes a visual look or mood. You respond with ONLY a JSON object (no markdown, no explanation before/after):
{
  "params": { "param.id": value, ... },
  "explanation": "One sentence describing what you set and why."
}
Set only the parameters that matter for the described look. Use musically/visually expressive values.
Important: layer.fg/bg/ds must be integers, all booleans are 0 or 1 (not true/false).`;

export async function generatePreset(description) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');

  const text = await callClaude(key, PRESET_SYSTEM,
    `Create ImWeb parameters for this look: "${description}"`, 600);

  // Extract JSON from response (in case there's any surrounding text)
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Bad response: no JSON found');
  const data = JSON.parse(match[0]);
  if (!data.params || typeof data.params !== 'object') throw new Error('Bad response: missing params');
  return data; // { params: {...}, explanation: "..." }
}

// ── Feature 2: Parameter Narrator ────────────────────────────────────────────

const NARRATOR_SYSTEM = `You are the voice of ImWeb, a real-time video synthesis instrument.
Given a snapshot of the current signal path, return ONE concise sentence (max 15 words) describing
what is visually happening — like "Camera keyed over noise with slow displacement feedback loop".
Be specific about what's active. No punctuation at end. No preamble.`;

export async function narrateState(stateSnapshot) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');
  return callClaude(key, NARRATOR_SYSTEM,
    `Current signal path: ${stateSnapshot}`, 80);
}

export function buildStateSnapshot(ps) {
  const srcNames = ['Camera','Movie','Buffer','Color','Noise','3D','Draw','Output',
    'BG1','BG2','Color2','Text','Sound','Delay','Scope','SlitScan','Particles','Seq1','Seq2','Seq3'];
  const fg = srcNames[ps.get('layer.fg').value] ?? '?';
  const bg = srcNames[ps.get('layer.bg').value] ?? '?';
  const ds = srcNames[ps.get('layer.ds').value] ?? '?';
  const parts = [`FG=${fg}`, `BG=${bg}`, `DS=${ds}`];

  if (ps.get('keyer.active')?.value) parts.push('keyer active');
  if (ps.get('displace.amount')?.value > 0.05) parts.push(`displace=${ps.get('displace.amount').value.toFixed(2)}`);
  if (ps.get('blend.active')?.value) parts.push(`blend=${ps.get('blend.amount')?.value?.toFixed(2) ?? '?'}`);
  const tm = ps.get('transfermode.mode')?.value;
  if (tm && tm > 0) {
    const modes = ['XOR','OR','AND','Multiply','Screen','Add','Difference','Exclusion',
      'Overlay','Hardlight','Softlight','Dodge','Burn','Subtract','Divide'];
    parts.push(`mode=${modes[tm-1] ?? tm}`);
  }
  if (ps.get('colorshift.amount')?.value > 0.05) parts.push('colorshift');
  if (ps.get('effect.bloom')?.value)    parts.push('bloom');
  if (ps.get('effect.kaleid')?.value)   parts.push('kaleidoscope');
  if (ps.get('effect.mirror')?.value)   parts.push('quad-mirror');
  if (ps.get('effect.strobe')?.value)   parts.push('strobe');
  if (ps.get('effect.pixsort')?.value)  parts.push('pixel-sort');
  if (Math.abs(ps.get('feedback.x')?.value ?? 0) > 0.02 || Math.abs(ps.get('feedback.y')?.value ?? 0) > 0.02) {
    parts.push('feedback-drift');
  }
  return parts.join(', ');
}

// ── Feature 3: Performance Coach ─────────────────────────────────────────────

const COACH_SYSTEM = `You are a performance coach for ImWeb, a real-time video synthesis instrument.
Given a 30-second snapshot of parameter activity, suggest ONE short actionable thing to try.
Keep it under 12 words. Start with a verb. Be specific to ImWeb parameters and sources.
Examples: "Try routing Noise to FG for more texture" or "Increase feedback.x to drift the frame"
No preamble, no explanation, just the suggestion.`;

export async function coachSuggestion(activitySnapshot) {
  const key = getApiKey();
  if (!key) throw new Error('no-key');
  return callClaude(key, COACH_SYSTEM,
    `30-second performance activity: ${activitySnapshot}`, 80);
}

export function buildActivitySnapshot(recentChanges, ps) {
  const srcNames = ['Camera','Movie','Buffer','Color','Noise','3D','Draw','Output',
    'BG1','BG2','Color2','Text','Sound','Delay','Scope','SlitScan','Particles','Seq1','Seq2','Seq3'];
  const changed   = recentChanges.map(r => r.id).join(', ') || 'nothing';
  const unchanged = ['keyer.active','displace.amount','blend.active','effect.bloom','effect.kaleid','effect.mirror']
    .filter(id => !recentChanges.find(r => r.id === id))
    .join(', ');
  const fg = srcNames[ps.get('layer.fg').value] ?? '?';
  const bg = srcNames[ps.get('layer.bg').value] ?? '?';
  return `Current FG=${fg}, BG=${bg}. Recently changed: ${changed}. Untouched: ${unchanged}.`;
}
