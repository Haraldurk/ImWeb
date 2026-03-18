/**
 * ImWeb .cube LUT file parser
 *
 * Parses the Adobe .cube format (3D LUT) into a Float32Array
 * encoded for the LUT3D shader (2D strip layout).
 *
 * Returns: { data: Float32Array (RGB, row-major N*N × N), size: N }
 *
 * The 2D layout packs N horizontal slices of N×N pixels:
 *   x-axis = R  (0..N-1 within each slice)
 *   y-axis = G  (0..N-1 rows)
 *   slice  = B  (slice index 0..N-1, laid out left-to-right)
 * So pixel at (sliceIdx * N + rIdx, gIdx) maps to LUT[b][g][r].
 */

export function parseCubeFile(text) {
  const lines  = text.split(/\r?\n/);
  let   size   = 0;
  const values = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (line.startsWith('LUT_3D_SIZE')) {
      size = parseInt(line.split(/\s+/)[1]);
      continue;
    }
    // Skip header keywords
    if (/^(TITLE|DOMAIN_MIN|DOMAIN_MAX|LUT_1D_SIZE|LUT_1D_INPUT_RANGE)/.test(line)) continue;

    // Data line: three floats
    const parts = line.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        values.push(r, g, b);
      }
    }
  }

  if (size === 0 || values.length < size * size * size * 3) {
    throw new Error(`[CubeLoader] Invalid .cube file (size=${size}, entries=${values.length / 3})`);
  }

  const N    = size;
  // cube values are stored in .cube as r-fastest, g-next, b-slowest:
  //   index = r + g*N + b*N*N
  // We need to remap to 2D strip: pixel (bSlice*N + r, g)
  // Buffer layout: RGB floats, width=N*N, height=N
  const buf = new Float32Array(N * N * N * 3);

  for (let b = 0; b < N; b++) {
    for (let g = 0; g < N; g++) {
      for (let r = 0; r < N; r++) {
        const srcIdx = (r + g * N + b * N * N) * 3; // .cube index
        const dstX   = b * N + r;                    // pixel column in 2D tex
        const dstY   = g;                             // pixel row in 2D tex
        const dstIdx = (dstY * N * N + dstX) * 3;
        buf[dstIdx]     = values[srcIdx];
        buf[dstIdx + 1] = values[srcIdx + 1];
        buf[dstIdx + 2] = values[srcIdx + 2];
      }
    }
  }

  return { data: buf, size: N };
}
