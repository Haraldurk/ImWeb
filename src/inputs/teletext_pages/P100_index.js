// P100 — Index / Help page
// Renders the Teletext index listing all available pages.

import { drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderP100(ctx) {
  drawHeader(ctx, '100', 'IMWEB TELETEXT');

  ttCentered(ctx, 'I M W E B   T E L E T E X T', 2, '#00ff00');
  ttCentered(ctx, 'Your live video instrument',   3, '#aaaaaa');

  ttRule(ctx, 5, '#003300');

  // Page directory — colours follow standard Teletext palette
  const pages = [
    { num: '150', title: 'Headlines',        source: 'RSS Feed',   color: '#ffffff' },
    { num: '400', title: 'Weather',          source: 'Open-Meteo', color: '#00ffff' },
    { num: '401', title: 'Hourly Forecast',  source: '',           color: '#00ffff' },
    { num: '500', title: 'Calendar',         source: '',           color: '#ffff00' },
    { num: '700', title: 'Now Playing',      source: 'Media Sess', color: '#ff00ff' },
    { num: '900', title: 'System Info',      source: '',           color: '#00ff00' },
  ];

  pages.forEach((p, i) => {
    const gap  = Math.max(1, 23 - p.title.length - p.source.length);
    const line = ` ${p.num}  ${p.title}${' '.repeat(gap)}${p.source}`;
    ttRow(ctx, line, 7 + i, p.color);
  });

  ttRule(ctx, 14, '#003300');

  ttCentered(ctx, 'Use page buttons to navigate',   16, '#888888');
  ttCentered(ctx, 'Sub-pages advance automatically', 17, '#888888');

  ttRule(ctx, 19, '#003300');

  ttCentered(ctx, 'IMWEB  v 0.8.5', 21, '#005500');
}
