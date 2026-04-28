// P150 — Article reader (in-canvas)
// Renders a single RSS item's title + description with pagination.

import { CANVAS_W, CANVAS_H, COLS, ROWS, CH, drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

const LINES_PER_PAGE = 18; // rows 1–18 for text, 19–24 for nav

function wrapText(text, maxCols) {
  const words = text.split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + (current ? ' ' : '') + word).length <= maxCols) {
      current += (current ? ' ' : '') + word;
    } else {
      if (current) lines.push(current);
      current = word.slice(0, maxCols);
    }
  }
  if (current) lines.push(current);
  return lines;
}

export function renderArticle(ctx, item, subPageIdx = 0) {
  const title       = item.title ?? '';
  const description = item.description ?? 'No description available.';

  const allLines   = wrapText(description, 38);
  const totalPages = Math.max(1, Math.ceil(allLines.length / LINES_PER_PAGE));
  const safePage   = Math.min(subPageIdx, totalPages - 1);
  const pageLines  = allLines.slice(safePage * LINES_PER_PAGE, (safePage + 1) * LINES_PER_PAGE);

  drawHeader(ctx, '150', 'ARTICLE');

  // Title (up to 2 lines, cyan)
  const titleLines = wrapText(title, 38).slice(0, 2);
  titleLines.forEach((l, i) => ttRow(ctx, ' ' + l, 1 + i, '#00ffff'));
  ttRule(ctx, 1 + titleLines.length, '#003333');

  // Body text
  const bodyStart = 3;
  pageLines.forEach((l, i) => ttRow(ctx, ' ' + l, bodyStart + i, '#ffffff'));

  // Footer
  ttRule(ctx, ROWS - 4, '#003333');
  ttCentered(ctx, `PAGE ${safePage + 1} OF ${totalPages}`, ROWS - 3, '#888888');
  ttCentered(ctx, '\u25C4 BACK    ENTER: OPEN IN BROWSER', ROWS - 2, '#555555');
}
