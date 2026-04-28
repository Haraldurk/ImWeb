// P401 — Hourly Forecast
// Renders next 12 hours from Open-Meteo hourly data.

import { drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';
import { WMO_CODES } from './wmo_codes.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|undefined} data  Open-Meteo JSON response
 */
export function renderP401(ctx, data) {
  drawHeader(ctx, '401', 'HOURLY FORECAST');

  if (!data || !data.hourly) {
    ttCentered(ctx, 'FETCHING FORECAST DATA...', 3, '#888888');
    return;
  }

  const h = data.hourly;
  const times   = h.time   || [];
  const temps   = h.temperature_2m || [];
  const precip  = h.precipitation_probability || [];
  const codes   = h.weather_code || [];

  // Find the first hour that starts at or after the current hour
  const now = new Date();
  const currentHour = now.getHours();
  const currentDate = now.toISOString().substring(0, 10); // YYYY-MM-DD
  const dateTimes = times.map((t, i) => ({ t, i }));

  // Find index of today's HH:00 matching currentHour, or first >= currentHour
  let startIdx = dateTimes.findIndex(dt => {
    const t = dt.t;
    const hh = parseInt(t.substring(11, 13), 10);
    const dd = t.substring(0, 10);
    return dd >= currentDate && hh >= currentHour;
  });
  if (startIdx < 0) startIdx = 0;

  // Column header
  ttRow(ctx, '  TIME       TEMP    PRECIP%    CONDITION', 1, '#888888');

  // 12 rows (rows 2–13)
  for (let i = 0; i < 12 && (startIdx + i) < times.length; i++) {
    const idx = startIdx + i;
    const r = 2 + i;
    const tStr  = times[idx]?.substring(11, 16) ?? '--:--';
    const tVal  = temps[idx]  ?? '--';
    const pVal  = precip[idx] ?? '--';
    const wCode = codes[idx]  ?? -1;
    const cond  = WMO_CODES[wCode] ?? '--';

    let color = '#00ffff';
    if (i === 0) color = '#00ff00'; // current hour in green

    const line = `  ${tStr}     ${String(tVal).padStart(3)}\u00B0C     ${String(pVal).padEnd(3)}%     ${cond}`;
    ttRow(ctx, line, r, color);
  }

  // Row 15: rule
  ttRule(ctx, 15);

  // Row 22: Timestamp
  const ts = data._fetchedAt ? new Date(data._fetchedAt) : null;
  if (ts) {
    const hhmm = [ts.getHours(), ts.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
    ttCentered(ctx, `LAST UPDATE: ${hhmm}`, 22, '#444444');
  }
}
