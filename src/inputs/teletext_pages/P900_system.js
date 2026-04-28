// P900 — System Info page
// Renders live clock, browser/OS data. No fetch — everything from Date and navigator.

import { drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * @param {CanvasRenderingContext2D} ctx
 */
export function renderP900(ctx) {
  const now = new Date();

  const dayName  = DAYS[now.getDay()];
  const dateNum  = String(now.getDate()).padStart(2, '0');
  const month    = MONTHS[now.getMonth()];
  const year     = now.getFullYear();
  const time     = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map(n => String(n).padStart(2, '0')).join(':');

  let timezone;
  try { timezone = Intl.DateTimeFormat().resolvedOptions().timeZone; }
  catch { timezone = 'unknown'; }

  const ua = navigator.userAgent;
  const browser = ua.length > 38 ? ua.substring(0, 36) + '..' : ua;

  const lang     = navigator.language || 'unknown';
  const online   = navigator.onLine ? 'YES' : 'NO';
  const screenW  = window.screen?.width  ?? '?';
  const screenH  = window.screen?.height ?? '?';

  drawHeader(ctx, '900', 'SYSTEM INFO');

  ttRow(ctx, '', 1);

  // Date row
  ttRow(ctx, '  DATE', 2, '#ffffff');
  ttRow(ctx, `  ${dayName} ${dateNum} ${month} ${year}`, 3, '#00ffff');

  // Time row — prominent
  ttRow(ctx, '  TIME', 5, '#ffffff');
  ttCentered(ctx, time, 6, '#ffff00');

  ttRule(ctx, 8);

  ttRow(ctx, '  TIMEZONE', 10, '#ffffff');
  ttRow(ctx, `  ${timezone}`, 11, '#00ffff');

  ttRow(ctx, '  LANGUAGE', 13, '#ffffff');
  ttRow(ctx, `  ${lang}`, 14, '#00ffff');

  ttRow(ctx, '  ONLINE', 16, '#ffffff');
  ttRow(ctx, `  ${online}`, 17, '#00ffff');

  ttRow(ctx, '  SCREEN', 19, '#ffffff');
  ttRow(ctx, `  ${screenW} \u00D7 ${screenH}`, 20, '#00ffff');

  ttRow(ctx, '  BROWSER', 22, '#ffffff');
  ttRow(ctx, `  ${browser}`, 23, '#00ffff');

  // Footer
  ttCentered(ctx, 'IMWEB  v 0.8.5', 24, '#005500');
}
