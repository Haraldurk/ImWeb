// P700 — Now Playing
// Shows ImWeb movie state (filename + speed) when a movie is loaded.
// Falls back to navigator.mediaSession.metadata for the current tab.
// mediaSession is per-document — it only reflects media playing in this tab.

import { drawHeader, ttCentered, ttRow, ttRule } from '../teletext_draw.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|undefined} data    { filename, speed, on }
 */
export function renderP700(ctx, data) {
  drawHeader(ctx, '700', 'NOW PLAYING');

  const on  = data?.on;
  const fn  = data?.filename;
  const spd = data?.speed;

  if (on && fn) {
    // ── Movie loaded & active ──────────────────────────────────────────────
    const base = fn.split('/').pop().split('\\').pop(); // basename
    ttRow(ctx, '  MOVIE', 2, '#ffffff');
    ttRow(ctx, `  ${base}`, 3, '#00ff00');

    ttRow(ctx, '  STATUS', 5, '#ffffff');
    ttRow(ctx, '  \u25CF PLAYING', 6, '#00ff00');

    ttRow(ctx, '  SPEED', 8, '#ffffff');
    ttRow(ctx, `  \u00D7 ${spd.toFixed(2)}`, 9, '#00ffff');

    ttRule(ctx, 11);

    // mediaSession fallback block
    const md = navigator.mediaSession?.metadata;
    if (md) {
      ttRow(ctx, '  TAB MEDIA', 13, '#444444');
      const t = md.title || '';
      if (t) ttRow(ctx, `  Title: ${t.substring(0, 34)}`, 14, '#444444');
      const a = md.artist || '';
      if (a) ttRow(ctx, `  Artist: ${a.substring(0, 33)}`, 15, '#444444');
    }

    ttCentered(ctx, 'MOVIE SOURCE: ImWeb movie input', 22, '#003300');
    return;
  }

  // ── No movie active — check mediaSession ─────────────────────────────────
  const md = navigator.mediaSession?.metadata;

  if (!md) {
    ttCentered(ctx, 'NO MEDIA PLAYING', 3, '#aaaaaa');
    ttCentered(ctx, 'Load a movie via the Movie source', 5, '#555555');
    ttCentered(ctx, 'to populate this page.', 6, '#555555');
    ttCentered(ctx, 'Or play media in this tab for', 8, '#555555');
    ttCentered(ctx, 'navigator.mediaSession display.', 9, '#555555');
    ttRule(ctx, 11);
    ttCentered(ctx, 'SCOPE: This tab only (ImWeb)', 22, '#003300');
    return;
  }

  // ── mediaSession available (no movie) ────────────────────────────────────
  const t = md.title || 'Untitled';
  ttRow(ctx, '  TITLE', 2, '#ffffff');
  ttCentered(ctx, t.substring(0, 38), 3, '#ffff00');

  const a = md.artist || 'Unknown artist';
  ttRow(ctx, '  ARTIST', 5, '#ffffff');
  ttCentered(ctx, a.substring(0, 38), 6, '#00ffff');

  const al = md.album || 'Unknown album';
  ttRow(ctx, '  ALBUM', 8, '#ffffff');
  ttCentered(ctx, al.substring(0, 38), 9, '#00ffff');

  const art = md.artwork;
  ttRow(ctx, '  ARTWORK', 11, '#ffffff');
  if (art && art.length) {
    ttCentered(ctx, '\u25A0 artwork available', 12, '#00ffff');
  } else {
    ttCentered(ctx, '\u2014 none \u2014', 12, '#00ffff');
  }

  ttRule(ctx, 14);
  ttRow(ctx, '  Load a movie via the Movie source', 16, '#555555');
  ttRow(ctx, '  for ImWeb movie info on this page.', 17, '#555555');
  ttCentered(ctx, 'SCOPE: This tab only (navigator.mediaSession)', 22, '#003300');
}
