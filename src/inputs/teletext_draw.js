// Shared Canvas 2D drawing utilities for Teletext page renderers.
// Imported by TeletextSource.js and all teletext_pages/*.js modules.
// No circular imports — nothing here imports from TeletextSource.js.

export const CANVAS_W = 720;
export const CANVAS_H = 576;
export const COLS     = 40;
export const ROWS     = 25;
export const CW       = CANVAS_W / COLS; // 18 px / column
export const CH       = CANVAS_H / ROWS; // ~23 px / row

const FONT = `bold 30px 'Courier New', monospace`;

/**
 * Draw the standard Teletext header bar (row 0):
 * page number left, title centred, live clock right.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string|number} pageNum  e.g. '100'
 * @param {string}        title    e.g. 'IMWEB TELETEXT'
 */
export function drawHeader(ctx, pageNum, title) {
  const now   = new Date();
  const clock = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');

  // Header background — dark green bar
  ctx.fillStyle = '#005500';
  ctx.fillRect(0, 0, CANVAS_W, CH);

  ctx.font         = FONT;
  ctx.textBaseline = 'middle';

  ctx.textAlign = 'left';
  ctx.fillStyle = '#00ff00';
  ctx.fillText(String(pageNum), 4, CH * 0.5);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#00ff00';
  ctx.fillText(title, CANVAS_W / 2, CH * 0.5);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(clock, CANVAS_W - 4, CH * 0.5);

  ctx.textBaseline = 'alphabetic';
}

/**
 * Draw a left-aligned text string at grid row r.
 * Row 0 is the header; content starts at row 1.
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text   — up to ~42 chars visible
 * @param {number} r      — row index (0-based)
 * @param {string} [color]
 */
export function ttRow(ctx, text, r, color = '#00cc00') {
  ctx.font         = FONT;
  ctx.textAlign    = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle    = color;
  const safe = String(text).slice(0, COLS);
  ctx.fillText(safe, 4, r * CH + CH * 0.82);
}

/**
 * Draw centred text at row r.
 */
export function ttCentered(ctx, text, r, color = '#00cc00') {
  ctx.font         = FONT;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle    = color;
  const safe = String(text).slice(0, COLS);
  ctx.fillText(safe, CANVAS_W / 2, r * CH + CH * 0.82);
}

/**
 * Draw a horizontal rule (dashes) at row r.
 */
export function ttRule(ctx, r, color = '#003300') {
  ttRow(ctx, '-'.repeat(40), r, color);
}
