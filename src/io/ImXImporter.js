/**
 * ImWeb — ImX Preset Importer
 *
 * Converts ImX (.imx) preset files to ImWeb preset format.
 *
 * ImX file format:
 *   - gzip-compressed XML
 *   - Root element: <ImX>
 *   - <param-list> defines all parameter IDs and names
 *   - <preset-list> → <preset> → <states> → <state index="N"> → <mapstate> per param
 *   - mVal / mMin / mMax: IEEE 754 float32 stored as signed int32 bits
 *   - cType: 10=uncontrolled, 1=float(MIDI CC), 2=toggle(key)
 *   - mPar1: MIDI CC number (cType=1) or ASCII key code (cType=2)
 *
 * Param name disambiguation uses `fmappiname` (plugin/parent name).
 * Key: `${fmapname}@${fmappiname}` or just `${fmapname}` for root params.
 */

// ── ImX name → ImWeb param id mapping ─────────────────────────────────────────
// Values are remapped proportionally using each param's own mMin/mMax range.
// Special handlers for non-trivial cases.
//
// Key format: "ParamName@PluginName" or "ParamName" for root params.

const PARAM_MAP = {
  // ── Movie ──────────────────────────────────────────────────────────────────
  'Movie1Toggle@Movie1Select':  'movie.active',
  'Movie1Speed@Movie1Select':   'movie.speed',
  'Movie1Start@Movie1Select':   'movie.start',
  'Movie1Loop@Movie1Select':    'movie.loop',
  'Movie1Scrub@Movie1Select':   'movie.pos',

  // ── Keyer ──────────────────────────────────────────────────────────────────
  'Keyer':                      'keyer.active',
  'KeyLumaTop@Keyer':           'keyer.white',
  'KeyLumaBot@Keyer':           'keyer.black',
  'KeySoftness@Keyer':          'keyer.softness',
  'KeyColorWidth@Keyer':        'keyer.chromarange',

  // ── Displacement ───────────────────────────────────────────────────────────
  'Displace':                   '_displace_active', // special: drives displace.amount > 0
  'DisplaceStrength@Displace':  'displace.amount',
  'DisplaceOffset@Displace':    'displace.offset',
  'DisplaceAngle@Displace':     'displace.angle',
  // DisplaceMode: 0=normal, 1=colormapped, 2=RotateGrey — handled specially below

  // ── Blend & Feedback ───────────────────────────────────────────────────────
  'Blend':                      'blend.active',
  'BlendStrength@Blend':        'blend.amount',
  'OffsetX@Feedback':           'feedback.hor',
  'OffsetY@Feedback':           'feedback.ver',
  'OffsetScale@Feedback':       'feedback.scale',
  'FadeToBlack':                'output.fade',

  // ── Colors / Mattes ────────────────────────────────────────────────────────
  'Hue-1@Matte1':               'color1.hue',
  'Sat-1@Matte1':               'color1.sat',
  'Val-1@Matte1':               'color1.val',
  'Hue-2@Matte2':               'color2.hue',
  'Sat-2@Matte2':               'color2.sat',
  'Val-2@Matte2':               'color2.val',

  // ── Buffer ─────────────────────────────────────────────────────────────────
  'Pan-X@Buffer':               'buffer.panX',
  'Pan-Y@Buffer':               'buffer.panY',
  'Scale@Buffer':               'buffer.scale',
  'Seq1Select@Sequence':        'buffer.fs1',
  'Seq2Select@Sequence':        'buffer.fs2',

  // ── Slit Scan ──────────────────────────────────────────────────────────────
  'ScanProcess':                'slitscan.active',
  'amount@ScanProcess':         'slitscan.pos',
  // mode@ScanProcess: handled specially (value 0-3 → slitscan.axis 0-3)

  // ── Noise ──────────────────────────────────────────────────────────────────
  'type@Noise':                 'noise.type',
  'density@Noise':              'noise.scale',

  // ── Mirror → camera mirror ─────────────────────────────────────────────────
  'Mirror':                     'mirror.camera',

  // ── Zoom → feedback zoom ───────────────────────────────────────────────────
  'zoom-x@Zoom':                'feedback.zoom',

  // ── Mixer (blend) ──────────────────────────────────────────────────────────
  'mix@Mixer':                  'blend.amount',

  // ── Mosaic → Pixelate ──────────────────────────────────────────────────────
  'Amount@Mosaic':              'effect.pixelate',

  // ── Multi (tiling) → ignored for now ──────────────────────────────────────
  // 'Horizontal@Multi':        null,

  // ── ColorClamp → Levels (skipped: ImX strengthR=0 maps to lvwhite=0 which crushes output)
  // 'strengthR@ColorClamp':    'effect.lvwhite',
  // 'offsetR@ColorClamp':      'effect.lvblack',

  // ── Particles (Dust) ───────────────────────────────────────────────────────
  'Sensitivity@Dust':           'particle.life',
  'Gravity@Dust':               'particle.gravity',
  'LifeTime@Dust':              'particle.life',
  'Sparkle@Dust':               'particle.size',

  // ── Offset (shift) ─────────────────────────────────────────────────────────
  'horshift@Offset':            'feedback.hor',
  'vershift@Offset':            'feedback.ver',

  // ── Logic (transfer mode) ──────────────────────────────────────────────────
  // operation@Logic 0-7 → feedback.mode: complex mapping, handled specially

  // ── Sine (warp / displacement) ─────────────────────────────────────────────
  'freq1@Sine':                 'displace.warpamt',
  'amp1@Sine':                  'displace.amount',
};

// ImX Logic.operation values → ImWeb feedback.mode index
// ImX: 0=Copy, 1=AND, 2=OR, 3=XOR, 4=Difference, 5=Add, 6=Subtract, 7=Multiply
const LOGIC_TO_TRANSFER = { 0: 0, 1: 3, 2: 2, 3: 1, 4: 9, 5: 7, 6: 14, 7: 4 };

// ImX DisplaceMode values
const DISPLACE_MODE_ROTATEG = 2;

// ── ImWeb param natural ranges (needed to remap normalized ImX values) ─────────
const IMWEB_RANGES = {
  'movie.speed':     [-1, 3],
  'movie.start':     [0, 100],
  'movie.loop':      [0, 100],
  'movie.pos':       [0, 100],
  'keyer.white':     [0, 100],
  'keyer.black':     [0, 100],
  'keyer.softness':  [0, 100],
  'keyer.chromarange': [0, 100],
  'displace.amount': [0, 100],
  'displace.offset': [-100, 100],
  'displace.angle':  [0, 360],
  'blend.amount':    [0, 100],
  'feedback.hor':    [-100, 100],
  'feedback.ver':    [-100, 100],
  'feedback.scale':  [-50, 50],
  'feedback.zoom':   [0, 100],
  'output.fade':     [0, 100],
  'color1.hue':      [0, 100],
  'color1.sat':      [0, 100],
  'color1.val':      [0, 100],
  'color2.hue':      [0, 100],
  'color2.sat':      [0, 100],
  'color2.val':      [0, 100],
  'buffer.panX':     [0, 100],
  'buffer.panY':     [0, 100],
  'buffer.scale':    [0, 5],
  'buffer.fs1':      [0, 15],
  'buffer.fs2':      [0, 15],
  'slitscan.pos':    [0, 100],
  'noise.type':      [0, 7],
  'noise.scale':     [1, 64],
  'effect.pixelate': [1, 200],
  'effect.lvwhite':  [0, 100],
  'effect.lvblack':  [0, 100],
  'particle.life':   [0, 100],
  'particle.gravity':[0, 100],
  'particle.size':   [1, 32],
  'displace.warpamt':[0, 100],
};

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Decode IEEE 754 float32 stored as a signed 32-bit integer string. */
function intBitsToFloat(str) {
  const i = parseInt(str, 10);
  const buf = new ArrayBuffer(4);
  new Int32Array(buf)[0] = i;
  return new Float32Array(buf)[0];
}

/**
 * Remap a value from [srcMin, srcMax] to [dstMin, dstMax].
 * Returns dstMin if srcMin === srcMax (degenerate range).
 */
function remap(v, srcMin, srcMax, dstMin, dstMax) {
  if (srcMax === srcMin) return dstMin;
  const norm = Math.max(0, Math.min(1, (v - srcMin) / (srcMax - srcMin)));
  return dstMin + norm * (dstMax - dstMin);
}

/** Clamp a value to a range. */
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ── XML gunzip helper (browser) ───────────────────────────────────────────────

async function gunzipBytes(arrayBuffer) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(arrayBuffer);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(result);
}

// ── Core import ───────────────────────────────────────────────────────────────

/**
 * Parse an ImX file (ArrayBuffer) and return an array of ImWeb preset objects.
 * Suitable for passing to PresetManager.importAll().
 */
export async function importImX(arrayBuffer) {
  const xml  = await gunzipBytes(arrayBuffer);
  const doc  = new DOMParser().parseFromString(xml, 'application/xml');

  if (doc.querySelector('parsererror')) {
    throw new Error('ImX XML parse error: ' + doc.querySelector('parsererror').textContent.slice(0, 100));
  }

  const presets = [];
  let imwebIndex = 0;

  for (const presetEl of doc.querySelectorAll('preset')) {
    const presetName = presetEl.getAttribute('mName') ?? `Preset ${imwebIndex}`;
    const stateEls   = presetEl.querySelectorAll(':scope > states > state');

    // Build ImWeb controller assignments from state 0 (consistent across states)
    const controllers = {};
    const state0 = stateEls[0];
    if (state0) {
      for (const ms of state0.querySelectorAll('mapstate')) {
        const ctrl = _extractController(ms);
        if (ctrl) controllers[ctrl.imwebId] = { controller: ctrl.config };
      }
    }

    // Build ImWeb DisplayStates — one per ImX state
    const displayStates = {};
    let stateIdx = 0;
    for (const stateEl of stateEls) {
      const values = {};
      for (const ms of stateEl.querySelectorAll('mapstate')) {
        const mapped = _mapstate(ms);
        if (mapped) Object.assign(values, mapped);
      }
      displayStates[stateIdx] = { label: String(stateIdx), values };
      stateIdx++;
    }

    presets.push({
      index:       imwebIndex,
      name:        presetName,
      controllers,
      states:      displayStates,
      activeState: 0,
      created:     Date.now(),
      modified:    Date.now(),
    });

    imwebIndex++;
  }

  return presets;
}

// ── Map a single <mapstate> element to ImWeb param values ─────────────────────

function _mapstate(ms) {
  const name    = ms.getAttribute('fmapname')   ?? '';
  const plugin  = ms.getAttribute('fmappiname') ?? '';
  const key     = plugin ? `${name}@${plugin}` : name;
  const keyAlt  = name; // fallback without plugin

  const cType   = parseInt(ms.getAttribute('cType') ?? '10', 10);
  const mValStr = ms.getAttribute('mVal') ?? '0';
  const mMinStr = ms.getAttribute('mMin') ?? '0';
  const mMaxStr = ms.getAttribute('mMax') ?? '1065353216'; // default max = 1.0

  const rawVal = intBitsToFloat(mValStr);
  const rawMin = intBitsToFloat(mMinStr);
  const rawMax = intBitsToFloat(mMaxStr);

  // ── Special case: DisplaceMode ──────────────────────────────────────────────
  if (name === 'DisplaceMode' && plugin === 'Displace') {
    return { 'displace.rotateg': Math.round(rawVal) === DISPLACE_MODE_ROTATEG ? 1 : 0 };
  }

  // ── Special case: mode@ScanProcess ─────────────────────────────────────────
  if (name === 'mode' && plugin === 'ScanProcess') {
    return { 'slitscan.axis': clamp(Math.round(rawVal), 0, 3) };
  }

  // ── Special case: Logic operation → TransferMode ───────────────────────────
  if (name === 'operation' && plugin === 'Logic') {
    const mode = LOGIC_TO_TRANSFER[Math.round(rawVal)] ?? 0;
    return { 'feedback.mode': mode };
  }

  // ── Special case: _displace_active ─────────────────────────────────────────
  if (name === 'Displace' && plugin === '') {
    // ImX Displace is a toggle; if on, set a non-zero amount
    return { 'displace.amount': rawVal > 0.5 ? 50 : 0 };
  }

  // ── Look up in mapping table ────────────────────────────────────────────────
  const imwebId = PARAM_MAP[key] ?? PARAM_MAP[keyAlt];
  if (!imwebId || imwebId.startsWith('_')) return null;

  let imwebValue;

  if (cType === 2 || (rawMax - rawMin) < 0.0001) {
    // Toggle/enum or degenerate range — use raw integer value directly
    imwebValue = Math.round(rawVal);
  } else {
    // Float: remap from ImX range to ImWeb range
    const [dstMin, dstMax] = IMWEB_RANGES[imwebId] ?? [0, 100];
    imwebValue = remap(rawVal, rawMin, rawMax, dstMin, dstMax);
  }

  return { [imwebId]: imwebValue };
}

// ── Extract controller assignment from a <mapstate> element ──────────────────

function _extractController(ms) {
  const name   = ms.getAttribute('fmapname')   ?? '';
  const plugin = ms.getAttribute('fmappiname') ?? '';
  const key    = plugin ? `${name}@${plugin}` : name;
  const keyAlt = name;

  const imwebId = PARAM_MAP[key] ?? PARAM_MAP[keyAlt];
  if (!imwebId || imwebId.startsWith('_')) return null;

  const cType = parseInt(ms.getAttribute('cType') ?? '10', 10);
  const mPar1 = parseInt(ms.getAttribute('mPar1') ?? '0', 10);

  if (mPar1 === 0 || cType === 10) return null;

  if (cType === 1) {
    // Float param — mPar1 is MIDI CC number
    return { imwebId, config: { type: 'midi-cc', cc: mPar1 } };
  }
  if (cType === 2) {
    // Toggle/enum — mPar1 is ASCII key code
    const char = String.fromCharCode(mPar1);
    if (char.trim()) return { imwebId, config: { type: 'key', key: char } };
  }

  return null;
}
