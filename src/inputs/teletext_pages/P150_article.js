// P150 — Article reader (in-canvas)
// Renders a single RSS item's title + description with pagination.
// Handles three states: loading (fetching), failed/fallback, success (articleText).

import { CANVAS_W, CANVAS_H, COLS, ROWS, CH, drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

const LINES_PER_PAGE = 18;

function wrapText(text, maxCols) {
  const lines = [];
  for (const para of text.split(' \u00B6 ')) {
    const words = para.split(' ');
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
    lines.push(''); // blank line between paragraphs
  }
  return lines.filter((l, i, a) => !(l === '' && (i === 0 || i === a.length - 1)));
}

export function renderArticle(ctx, item, subPageIdx = 0) {
  const title       = item.title ?? '';
  const description = item.description ?? 'No description available.';
  const fetching    = item.fetching;
  const fetchFailed = item.fetchFailed;
  const articleText = item.articleText;

  drawHeader(ctx, '150', 'ARTICLE');

  // Title (up to 2 lines, cyan)
  const titleLines = wrapText(title, 38).slice(0, 2);
  titleLines.forEach((l, i) => ttRow(ctx, ' ' + l, 1 + i, '#00ffff'));
  ttRule(ctx, 1 + titleLines.length, '#003333');

  // ── Loading state ──────────────────────────────────────────────────────────
  if (fetching) {
    const dots = '.'.repeat((new Date().getSeconds() % 4) + 1);
    ttCentered(ctx, `FETCHING ARTICLE${dots}`, 5, '#ffff00');
    const shortUrl = (item.link || '').slice(0, 36);
    if (shortUrl) ttCentered(ctx, shortUrl, 7, '#555555');
    ttCentered(ctx, 'ESC to cancel', 10, '#555555');
    ttRule(ctx, ROWS - 4, '#003333');
    ttCentered(ctx, 'ARTICLE FETCH: ON', ROWS - 3, '#003300');
    ttCentered(ctx, '\u25C4 BACK    ENTER: OPEN IN BROWSER', ROWS - 2, '#555555');
    return;
  }

  // ── Failed / no fetched content ─ fallback to RSS description ─────────────
  if (fetchFailed || !articleText) {
    if (fetchFailed) {
      ttRow(ctx, '  FULL TEXT UNAVAILABLE', 3, '#aa0000');
      ttRule(ctx, 4, '#333300');
    }

    const bodyText = articleText || description;
    const allLines   = wrapText(bodyText, 38);
    const totalPages = Math.max(1, Math.ceil(allLines.length / LINES_PER_PAGE));
    const safePage   = Math.min(subPageIdx, totalPages - 1);
    const pageLines  = allLines.slice(safePage * LINES_PER_PAGE, (safePage + 1) * LINES_PER_PAGE);

    const bodyStart = fetchFailed ? 5 : 3;
    pageLines.forEach((l, i) => ttRow(ctx, ' ' + l, bodyStart + i, '#ffffff'));

    ttRule(ctx, ROWS - 4, '#003333');
    ttCentered(ctx, `PAGE ${safePage + 1} OF ${totalPages}`, ROWS - 3, '#888888');
    ttCentered(ctx, '\u25C4 BACK    ENTER: OPEN IN BROWSER', ROWS - 2, '#555555');
    return;
  }

  // ── Success state — fetched article text with paragraphs ──────────────────
  const allLines   = wrapText(articleText, 38);
  const totalPages = Math.max(1, Math.ceil(allLines.length / LINES_PER_PAGE));
  const safePage   = Math.min(subPageIdx, totalPages - 1);
  const pageLines  = allLines.slice(safePage * LINES_PER_PAGE, (safePage + 1) * LINES_PER_PAGE);

  const bodyStart = 3;
  pageLines.forEach((l, i) => ttRow(ctx, ' ' + l, bodyStart + i, '#ffffff'));

  ttRule(ctx, ROWS - 4, '#003333');
  ttCentered(ctx, `PAGE ${safePage + 1} OF ${totalPages}`, ROWS - 3, '#888888');
  ttCentered(ctx, '\u25C4 BACK    ENTER: OPEN IN BROWSER', ROWS - 2, '#555555');
}
