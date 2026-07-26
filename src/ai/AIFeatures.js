/**
 * ImWeb AI Features — multi-provider system
 *
 * Providers: Anthropic, Google Gemini, OpenAI, Ollama (local)
 * Config persisted to localStorage key 'imweb-ai-config'.
 *
 * Exports:
 *   PROVIDERS                              — provider definitions for UI
 *   AIFeatures (class)                     — constructor(ps, ui)
 *   getApiKey / setApiKey / clearApiKey    — backward-compat (active provider)
 *   generatePreset / narrateState /
 *   coachSuggestion                        — backward-compat feature functions
 *   buildStateSnapshot /
 *   buildActivitySnapshot                  — pure state helpers
 */

import { SOURCES } from '../controls/ParameterSystem.js';

// ── Provider definitions ──────────────────────────────────────────────────────

export const PROVIDERS = {
  anthropic: {
    id:          'anthropic',
    name:        'Anthropic',
    keyLabel:    'API Key',
    keyUrl:      'https://console.anthropic.com/settings/keys',
    keyUrlLabel: 'Get API key →',
    keyPlaceholder: 'sk-ant-…',
    models:      ['claude-sonnet-5', 'claude-opus-4-8', 'claude-haiku-4-5', 'claude-opus-4-6', 'claude-sonnet-4-6'],
    defaultModel:'claude-sonnet-5',
    needsKey:    true,
  },
  gemini: {
    id:          'gemini',
    name:        'Google Gemini',
    keyLabel:    'API Key',
    keyUrl:      'https://aistudio.google.com/app/apikey',
    keyUrlLabel: 'Get API key →',
    keyPlaceholder: 'AIza…',
    models:      ['gemini-3.1-pro', 'gemini-3.1-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'],
    defaultModel:'gemini-2.0-flash',
    needsKey:    true,
  },
  openai: {
    id:          'openai',
    name:        'OpenAI',
    keyLabel:    'API Key',
    keyUrl:      'https://platform.openai.com/api-keys',
    keyUrlLabel: 'Get API key →',
    keyPlaceholder: 'sk-…',
    models:      ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'],
    defaultModel:'gpt-4o-mini',
    needsKey:    true,
  },
  ollama: {
    id:          'ollama',
    name:        'Ollama (local)',
    keyLabel:    'Base URL',
    keyUrl:      'http://localhost:11434',
    keyUrlLabel: 'Run locally — no key needed',
    keyPlaceholder: 'http://localhost:11434',
    models:      ['llama3.2', 'mistral', 'phi3', 'qwen2.5', 'deepseek-r1'],
    defaultModel:'llama3.2',
    needsKey:    false,
  },
  openrouter: {
    id:          'openrouter',
    name:        'OpenRouter',
    keyLabel:    'API Key',
    keyUrl:      'https://openrouter.ai/keys',
    keyUrlLabel: 'Get API key →',
    keyPlaceholder: 'sk-or-…',
    models:      ['anthropic/claude-sonnet-4.5', 'openai/gpt-4o-mini', 'google/gemini-2.0-flash-001', 'meta-llama/llama-3.3-70b-instruct'],
    defaultModel:'anthropic/claude-sonnet-4.5',
    needsKey:    true,
  },
};

// ── Config management ─────────────────────────────────────────────────────────

const CONFIG_KEY = 'imweb-ai-config';

function buildDefaultConfig() {
  return {
    activeProvider: 'gemini',
    providers: {
      anthropic:  { apiKey: '', model: 'claude-sonnet-4-6' },
      gemini:     { apiKey: '', model: 'gemini-2.0-flash' },
      openai:     { apiKey: '', model: 'gpt-4o-mini'       },
      ollama:     { apiKey: 'http://localhost:11434', model: 'llama3.2' },
      openrouter: { apiKey: '', model: 'anthropic/claude-sonnet-4.5' },
    },
    narrator: { interval: 10000, length: 'medium' },
    coach:    { interval: 45000 },
  };
}

function loadConfig() {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return buildDefaultConfig();
    const saved = JSON.parse(raw);
    // Merge so any new provider defaults are present
    const def = buildDefaultConfig();
    return {
      ...def,
      ...saved,
      providers: { ...def.providers, ...saved.providers },
      narrator: { ...def.narrator, ...saved.narrator },
      coach: { ...def.coach, ...saved.coach },
    };
  } catch {
    return buildDefaultConfig();
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
}

// Module-level config singleton — loaded once on first use
let _cfg = null;
function _config() { return (_cfg ??= loadConfig()); }

// ── Provider API callers ──────────────────────────────────────────────────────

async function callAnthropic(pcfg, system, user, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'x-api-key':     pcfg.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model:      pcfg.model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `Anthropic error ${res.status}`);
  }
  // Models with adaptive thinking (Sonnet 5, Opus 4.7+) return a thinking
  // block FIRST — content[0].text is undefined there. Find the text block.
  const content = (await res.json()).content ?? [];
  return content.find((b) => b.type === 'text')?.text ?? '';
}

async function callGemini(pcfg, system, user, maxTokens) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(pcfg.model)}:generateContent?key=${pcfg.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${system}\n\n${user}` }] }],
      generationConfig: { maxOutputTokens: maxTokens },
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `Gemini error ${res.status}`);
  }
  return ((await res.json()).candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('');
}

async function callOpenAI(pcfg, system, user, maxTokens) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${pcfg.apiKey}`,
    },
    body: JSON.stringify({
      model:      pcfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `OpenAI error ${res.status}`);
  }
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

async function callOpenRouter(pcfg, system, user, maxTokens) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${pcfg.apiKey}`,
      'HTTP-Referer':  'https://imweb.app',
      'X-Title':       'ImWeb',
    },
    body: JSON.stringify({
      model:      pcfg.model,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error?.message ?? `OpenRouter error ${res.status}`);
  }
  return (await res.json()).choices?.[0]?.message?.content ?? '';
}

async function callOllama(pcfg, system, user, _maxTokens) {
  const base = (pcfg.apiKey || 'http://localhost:11434').replace(/\/$/, '');
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  pcfg.model,
      stream: false,
      messages: [
        { role: 'system', content: system },
        { role: 'user',   content: user   },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status} — is it running at ${base}?`);
  return (await res.json()).message?.content ?? '';
}

// ── Model list fetchers ─────────────────────────────────────────────────────

async function fetchModels(providerId) {
  const cfg = _config();
  const pcfg = cfg.providers[providerId];
  if (!pcfg) throw new Error('No provider configured');
  switch (providerId) {
    case 'anthropic': {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: {
          'x-api-key': pcfg.apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (!res.ok) throw new Error(`Anthropic error ${res.status}`);
      const data = await res.json();
      return (data.data ?? []).map(m => m.id);
    }
    case 'gemini': {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${pcfg.apiKey}`);
      if (!res.ok) throw new Error(`Gemini error ${res.status}`);
      const data = await res.json();
      return (data.models ?? [])
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));
    }
    case 'openai': {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${pcfg.apiKey}` },
      });
      if (!res.ok) throw new Error(`OpenAI error ${res.status}`);
      const data = await res.json();
      return (data.data ?? [])
        .map(m => m.id)
        .filter(id => /^(gpt|o\d)/.test(id))
        .sort();
    }
    case 'ollama': {
      const base = (pcfg.apiKey || 'http://localhost:11434').replace(/\/$/, '');
      const res = await fetch(`${base}/api/tags`);
      if (!res.ok) throw new Error(`Ollama ${res.status} — is it running at ${base}?`);
      const data = await res.json();
      return (data.models ?? []).map(m => m.name);
    }
    case 'openrouter': {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) throw new Error(`OpenRouter error ${res.status}`);
      const data = await res.json();
      return (data.data ?? []).map(m => m.id).sort();
    }
    default:
      throw new Error(`Unknown provider: ${providerId}`);
  }
}

// ── Module-level call router ──────────────────────────────────────────────────

async function _call(system, user, maxTokens = 512) {
  const cfg  = _config();
  const id   = cfg.activeProvider;
  const pcfg = cfg.providers[id];
  if (!pcfg) throw new Error('No provider configured');
  if (PROVIDERS[id]?.needsKey && !pcfg.apiKey) throw new Error('no-key');
  switch (id) {
    case 'anthropic':  return callAnthropic (pcfg, system, user, maxTokens);
    case 'gemini':     return callGemini    (pcfg, system, user, maxTokens);
    case 'openai':     return callOpenAI    (pcfg, system, user, maxTokens);
    case 'ollama':     return callOllama    (pcfg, system, user, maxTokens);
    case 'openrouter': return callOpenRouter(pcfg, system, user, maxTokens);
    default:           throw new Error(`Unknown provider: ${id}`);
  }
}

// ── Backward-compatible API key helpers ───────────────────────────────────────

export function getApiKey() {
  const cfg = _config();
  return cfg.providers[cfg.activeProvider]?.apiKey ?? '';
}
export function setApiKey(k) {
  const cfg = _config();
  (cfg.providers[cfg.activeProvider] ??= {}).apiKey = k;
  saveConfig(cfg);
}
export function clearApiKey() {
  const cfg = _config();
  if (cfg.providers[cfg.activeProvider]) cfg.providers[cfg.activeProvider].apiKey = '';
  saveConfig(cfg);
}

export function getNarratorConfig() {
  return _config().narrator;
}
export function getCoachConfig() {
  return _config().coach;
}

// ── System prompts ────────────────────────────────────────────────────────────

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
  const text = await _call(PRESET_SYSTEM,
    `Create ImWeb parameters for this look: "${description}"`, 600);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Bad response: no JSON found');
  const data = JSON.parse(match[0]);
  if (!data.params || typeof data.params !== 'object') throw new Error('Bad response: missing params');
  return data; // { params: {...}, explanation: "..." }
}

// ── Feature: Live GLSL shader generator ──────────────────────────────────────

const SHADER_SYSTEM = `You write GLSL ES 1.00 fragment shaders for ImWeb, a live video synthesis instrument.
The following uniforms are ALREADY DECLARED and fed per-frame — never redeclare them:
  varying vec2 vUv;              // 0..1 UV coords
  uniform sampler2D uTexture;    // input frame at the routed insert point
  uniform sampler2D tAudio;      // 256x2 texture: y<0.5 FFT bins, y>0.5 waveform; .r = 0..1
  uniform sampler2D tPrev;       // previous output frame (feedback/trails)
  uniform vec2  uResolution;     // canvas size in px
  uniform float uTime;           // seconds
  uniform float uBPM;            // detected tempo (0 = unknown)
  uniform float uBeat;           // beat phase 0..1 (0 = on the beat)
  uniform float uLevel;          // overall audio level 0..1
  uniform float uBass;           // low-band energy 0..1
  uniform float uMid;            // mid-band energy 0..1
  uniform float uHigh;           // high-band energy 0..1
  uniform float uParam1;         // performance knob 0..1
  uniform float uParam2;         // performance knob 0..1
  uniform float uParam3;         // performance knob 0..1
  uniform float uParam4;         // performance knob 0..1

CRITICAL RULES — violating any of these breaks the instrument:
- DO NOT declare uniforms or varyings (uTexture, uTime, vUv, tAudio, tPrev,
  uResolution, uBPM, uBeat, uLevel, uBass, uMid, uHigh, uParam1..4, etc.).
  They are injected automatically by the engine. Redeclaring them — with or
  without precision qualifiers — causes duplicate-declaration compile errors.
  Start your code directly with the // uParams: line followed by
  void main() { ... } (helper functions before main() are allowed).
- Strictly WebGL 1.0 / GLSL ES 1.00: use gl_FragColor and texture2D().
  NEVER use #version, precision statements, in/out qualifiers, texture(),
  fragColor, or any WebGL 2.0 / GLSL ES 3.00 syntax.
- Output ONLY raw GLSL code. NO markdown, NO backticks, no prose.

Rules:
- The FIRST line must be exactly: // uParams: <Label1> | <Label2> | <Label3> | <Label4>
  (short labels for what uParam1..4 control in your shader; always use all four).
- Define void main() exactly once. The shader is a full-screen pass.
- Base the image on uTexture unless the request is clearly fully generative.
- Wire uParam1..4 to the most performance-relevant quantities in the effect.`;

/**
 * Extract GLSL from a model response, discarding conversational text.
 * 1. Fenced block (any language tag) → contents of the first block.
 * 2. Unfenced → slice from the first code-looking line (// uParams:,
 *    #define, uniform/varying/const, a function definition, or void main)
 *    to the last closing brace, dropping prose before and after.
 * 3. Nothing code-looking at all → the trimmed response (compile check
 *    downstream reports the real error).
 * Exported for headless tests.
 */
export function extractGlsl(text) {
  const hasMain = (s) => /void\s+main\s*\(/.test(s);
  const longest = (arr) => arr.reduce((a, b) => (b.length > a.length ? b : a), '');
  // Distinguishes real split-off code (starts with a comment, directive, or
  // top-level declaration/definition) from quoted mid-expression excerpts
  const looksTopLevel = (b) =>
    /^[ \t]*(\/\/|\/\*|#|precision\b|uniform\b|varying\b|const\b|struct\b|(?:float|vec[234]|mat[234]|int)\s+\w+\s*\(|void\s+\w+)/.test(b);

  const blocks = [...text.matchAll(/```[\w-]*[ \t]*\r?\n?([\s\S]*?)```/g)]
    .map((m) => m[1].trim())
    .filter(Boolean);

  let candidate = null;
  if (blocks.length) {
    const withMain = blocks.filter(hasMain);
    // Several complete shaders (model offered variants): take the longest
    if (withMain.length > 1) return longest(withMain);
    if (withMain.length === 1) {
      // One main() — stitch in sibling blocks that look like top-level
      // code (models split helpers and main across fences with prose
      // between), but never quoted mid-expression excerpts
      return blocks
        .filter((b) => b === withMain[0] || looksTopLevel(b))
        .join('\n');
    }
    candidate = longest(blocks); // fences present, but no main() anywhere
  } else {
    // Unclosed fence (response truncated mid-code): take everything after it
    const open = text.match(/```[\w-]*[ \t]*\r?\n?/);
    if (open) candidate = text.slice(open.index + open[0].length).trim() || null;
  }
  if (candidate && hasMain(candidate)) return candidate;

  // Heuristic slice over the raw text — may recover a main() that sat
  // outside the fences; strip any stray fence-marker lines it swallows
  const start = text.search(
    /^[ \t]*(\/\/\s*uParams:|#define\b|precision\b|uniform\b|varying\b|const\b|(?:float|vec[234]|mat[234]|int)\s+\w+\s*\(|void\s+main\b)/m,
  );
  if (start !== -1) {
    const body = text.slice(start);
    const lastBrace = body.lastIndexOf('}');
    const sliced = (lastBrace === -1 ? body : body.slice(0, lastBrace + 1))
      .replace(/^[ \t]*```.*$/gm, '')
      .trim();
    if (hasMain(sliced) || !candidate) return sliced;
  }
  return candidate ?? text.trim();
}

/**
 * Generate a Live GLSL shader from a natural-language description.
 * Pass priorCode + priorError for the single automatic recovery retry.
 */
export async function generateShader(description, priorCode = null, priorError = null) {
  const user = priorError
    ? `Your previous shader failed to compile.\nCompiler error:\n${priorError}\n\nBroken code:\n${priorCode}\n\nOutput ONLY the corrected COMPLETE shader (same rules) for the original request: "${description}". Do not explain the fix, do not quote the broken lines — code only.`
    : `Write a shader: "${description}"`;
  // Generous budget: on adaptive-thinking models (Sonnet 5, Opus 4.7+)
  // max_tokens covers thinking + code, and complex shaders think a lot
  const raw = await _call(SHADER_SYSTEM, user, 4000);
  // DEV-only ground truth for diagnosing extraction/model misbehaviour —
  // filter the console with [glsl-ai]
  if (import.meta.env?.DEV) {
    console.log(`[glsl-ai] raw response${priorError ? ' (retry)' : ''}:\n${raw}`);
  }
  // Providers throw on HTTP errors, but a 200 with an unexpected shape
  // (content filter, exhausted quota, wrong model) falls back to '' —
  // never feed that to the GLSL compiler as a phantom 'Missing main()'.
  if (!raw?.trim()) {
    throw new Error(
      'Empty response from the AI provider — check the model name, quota, or content filters.',
    );
  }
  const code = extractGlsl(raw);
  if (import.meta.env?.DEV) {
    console.log(`[glsl-ai] extracted:\n${code}`);
  }
  if (!code) throw new Error('The AI response contained no usable code.');
  return code;
}

// ── Feature 2: Parameter Narrator ────────────────────────────────────────────

const NARRATOR_LENGTHS = {
  short:  { words: 15, maxTokens: 80,  sentences: 'ONE concise sentence' },
  medium: { words: 35, maxTokens: 150, sentences: 'one or two sentences' },
  long:   { words: 70, maxTokens: 250, sentences: 'two or three sentences' },
};

function narratorSystem(length) {
  const cfg = NARRATOR_LENGTHS[length] ?? NARRATOR_LENGTHS.medium;
  return `You are the voice of ImWeb, a real-time video synthesis instrument.
Given a snapshot of the current signal path, return ${cfg.sentences} (max ${cfg.words} words total) describing
what is visually happening — like "Camera keyed over noise with slow displacement feedback loop".
Be specific about what's active: name the sources, effects, and modes in play. No punctuation at end. No preamble.`;
}

export async function narrateState(stateSnapshot, length = 'medium') {
  const cfg = NARRATOR_LENGTHS[length] ?? NARRATOR_LENGTHS.medium;
  return _call(narratorSystem(length), `Current signal path: ${stateSnapshot}`, cfg.maxTokens);
}

// Imported, not copied. A hand-copy here drifted twice: once causing the
// Narrator to describe the wrong source entirely (e.g. "Noise" reported as
// "3D"), and again at 25 entries against a 27-entry list, so any layer routed
// to Movie B or Mix Bus was narrated as '?'.
const SOURCE_NAMES = SOURCES;

// Adds a short, source-specific detail (e.g. which noise type or 3D geometry
// is active) so the Narrator can describe what's actually on screen, not just
// which slot it's routed through.
function describeSourceDetail(name, ps) {
  switch (name) {
    case 'Noise': {
      const t = ps.get('noise.type');
      return t?.options ? `noise=${t.options[t.value] ?? '?'}` : null;
    }
    case '3D Scene':
    case '3D Depth': {
      if (!ps.get('scene3d.active')?.value) return null;
      const g = ps.get('scene3d.geo');
      return g?.options ? `3D=${(g.options[g.value] ?? '?').replace(/^.*: /, '')}` : null;
    }
    case 'SDF': {
      if (!ps.get('sdf.active')?.value) return null;
      const s = ps.get('sdf.shape');
      return s?.options ? `SDF=${s.options[s.value] ?? '?'}` : null;
    }
    case 'Analog': {
      const t = ps.get('analog.sourceType');
      return t?.options ? `analog=${t.options[t.value] ?? '?'}` : null;
    }
    case 'Seq1': case 'Seq2': case 'Seq3': {
      const s = ps.get(`${name.toLowerCase()}.source`);
      return s?.options ? `${name} src=${s.options[s.value] ?? '?'}` : null;
    }
    case 'SlitScan':
      return ps.get('slitscan.active')?.value ? 'slit-scan' : null;
    case 'Particles': return 'particle field';
    case 'VWarp':     return 'vasulka warp';
    case 'TimeDisp':  return 'time-displaced';
    default: return null;
  }
}

export function buildStateSnapshot(ps) {
  const fg = SOURCE_NAMES[ps.get('layer.fg').value] ?? '?';
  const bg = SOURCE_NAMES[ps.get('layer.bg').value] ?? '?';
  const ds = SOURCE_NAMES[ps.get('layer.ds').value] ?? '?';
  const parts = [`FG=${fg}`, `BG=${bg}`, `DS=${ds}`];

  for (const name of new Set([fg, bg, ds])) {
    const detail = describeSourceDetail(name, ps);
    if (detail) parts.push(detail);
  }

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
  if (ps.get('effect.bloom')?.value)   parts.push('bloom');
  if (ps.get('effect.kaleid')?.value)  parts.push('kaleidoscope');
  if (ps.get('effect.mirror')?.value)  parts.push('quad-mirror');
  if (ps.get('effect.strobe')?.value)  parts.push('strobe');
  if (ps.get('effect.pixsort')?.value) parts.push('pixel-sort');
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
  return _call(COACH_SYSTEM, `30-second performance activity: ${activitySnapshot}`, 80);
}

export function buildActivitySnapshot(recentChanges, ps) {
  const changed   = recentChanges.map(r => r.id).join(', ') || 'nothing';
  const unchanged = ['keyer.active','displace.amount','blend.active','effect.bloom','effect.kaleid','effect.mirror']
    .filter(id => !recentChanges.find(r => r.id === id))
    .join(', ');
  const fg = SOURCE_NAMES[ps.get('layer.fg').value] ?? '?';
  const bg = SOURCE_NAMES[ps.get('layer.bg').value] ?? '?';
  return `Current FG=${fg}, BG=${bg}. Recently changed: ${changed}. Untouched: ${unchanged}.`;
}

// ── AIFeatures class ──────────────────────────────────────────────────────────

export class AIFeatures {
  constructor(ps, ui) {
    this.ps = ps;
    this.ui = ui;
  }

  // Config accessors
  getConfig()             { return _config(); }
  setActiveProvider(id)   { _config().activeProvider = id; saveConfig(_config()); }
  setProviderKey(id, key) {
    const cfg = _config();
    const pCfg = (cfg.providers[id] ??= {});
    if (pCfg.apiKey !== key) delete pCfg.lastTest;
    pCfg.apiKey = key;
    saveConfig(cfg);
  }
  setProviderModel(id, m) { (_config().providers[id] ??= {}).model  = m;   saveConfig(_config()); }

  setNarratorInterval(ms) { _config().narrator = { ..._config().narrator, interval: ms }; saveConfig(_config()); }
  setNarratorLength(len)  { _config().narrator = { ..._config().narrator, length: len }; saveConfig(_config()); }
  setCoachInterval(ms)    { _config().coach    = { ..._config().coach, interval: ms };    saveConfig(_config()); }

  // Persist the result of a connection test for a provider, with a timestamp
  // so the status survives panel rebuilds and page reloads.
  setProviderTestResult(id, { ok, message }) {
    const cfg = _config();
    (cfg.providers[id] ??= {}).lastTest = { ok, message, ts: Date.now() };
    saveConfig(cfg);
  }

  // Internal call router (delegates to module-level _call)
  async _call(system, user, maxTokens = 512) { return _call(system, user, maxTokens); }

  // Test the active provider with a minimal request
  async testConnection() {
    return _call('Reply with exactly the word: ok', 'ok', 10);
  }

  // Fetch the live model list for a provider from its API
  async fetchModels(id) { return fetchModels(id); }

  // Feature methods (delegates to module-level functions)
  async generatePreset(description)    { return generatePreset(description); }
  async narrateState()                 { return narrateState(buildStateSnapshot(this.ps), _config().narrator?.length); }
  async coachSuggestion(recentChanges) { return coachSuggestion(buildActivitySnapshot(recentChanges, this.ps)); }
}
