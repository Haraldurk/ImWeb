// P150 — RSS Headlines
// Fetches via rss2json.com CORS proxy, renders 12 headlines per sub-page.

import { CANVAS_W, drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|undefined} data    { items, feedTitle, fetchedAt }
 * @param {number} subPageIdx
 */
export function renderP150(ctx, data, subPageIdx) {
  drawHeader(ctx, '150', 'HEADLINES');

  if (!data || !data.items || !data.items.length) {
    ttCentered(ctx, 'FETCHING HEADLINES...', 3, '#888888');
    ttCentered(ctx, 'Connect an RSS feed below', 5, '#555555');
    return;
  }

  const items = data.items;
  const title = data.feedTitle || '';

  // Feed source name — right-aligned on row 1
  ctx.font = 'bold 18px \'Courier New\', monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#444444';
  ctx.fillText(title.substring(0, 42), CANVAS_W - 4, 1 * 23 + 23 * 0.82);
  ctx.textAlign = 'left';

  // 12 headlines per sub-page, rows 2–13
  const perPage = 5;
  const start = subPageIdx * perPage;
  const slice = items.slice(start, start + perPage);

  slice.forEach((item, i) => {
    const title = item.title || '';
    const titleTrunc = title.length > 35 ? title.slice(0, 34).trimEnd() + '\u2026' : title;
    const color = (i % 2 === 0) ? '#ffffff' : '#aaaaaa';
    const num = (i + 1).toString().padStart(2, ' ');
    ttRow(ctx, ` ${num}. ${titleTrunc}`, 2 + i, color);
  });

  // Page indicator
  const totalPages = Math.ceil(items.length / perPage);
  ttCentered(ctx, `PAGE ${subPageIdx + 1} OF ${totalPages}`, 15, '#888888');

  // Timestamp
  const ts = data.fetchedAt ? new Date(data.fetchedAt) : null;
  if (ts) {
    const hhmm = [ts.getHours(), ts.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
    ttCentered(ctx, `LAST UPDATE: ${hhmm}`, 22, '#444444');
  }

  return totalPages;
}
