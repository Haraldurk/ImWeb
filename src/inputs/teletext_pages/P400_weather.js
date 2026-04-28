// P400 — Weather Today
// Renders current conditions from Open-Meteo API data.

import { drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';
import { WMO_CODES, windDir } from './wmo_codes.js';

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|undefined} data  Open-Meteo JSON response
 */
export function renderP400(ctx, data) {
  drawHeader(ctx, '400', 'WEATHER TODAY');

  if (!data) {
    ttCentered(ctx, 'FETCHING WEATHER DATA...', 3, '#888888');
    return;
  }

  const cur = data.current || {};
  const daily = (data.daily && data.daily.time) ? data.daily : null;
  const todayIdx = daily ? daily.time.findIndex(t => {
    const d = new Date();
    return t === d.toISOString().substring(0, 10);
  }) : -1;

  // Row 2: Location
  ttRow(ctx, '  LOCATION', 2, '#ffffff');
  ttRow(ctx, `  ${data.latitude?.toFixed(4)} \u00B0N  ${data.longitude?.toFixed(4)} \u00B0E`, 3, '#00ffff');

  // Row 5: Temperature
  ttRow(ctx, '  TEMPERATURE', 5, '#ffffff');
  const temp  = cur.temperature_2m     ?? '--';
  const feels = cur.apparent_temperature ?? '--';
  ttRow(ctx, `  ${temp}\u00B0C     feels like ${feels}\u00B0C`, 6, '#ffff00');

  // Row 7: Humidity
  ttRow(ctx, '  HUMIDITY', 7, '#ffffff');
  ttRow(ctx, `  ${cur.relative_humidity_2m ?? '--'}%`, 8, '#00ffff');

  // Row 9: Wind
  ttRow(ctx, '  WIND', 9, '#ffffff');
  const wSpeed = cur.wind_speed_10m       ?? '--';
  const wDirDeg = cur.wind_direction_10m  ?? 0;
  const wDirStr = windDir(wDirDeg);
  ttRow(ctx, `  ${wSpeed} km/h  from ${wDirStr}`, 10, '#00ffff');

  // Row 11: Condition
  ttRow(ctx, '  CONDITION', 11, '#ffffff');
  const wmo = cur.weather_code ?? -1;
  ttRow(ctx, `  ${WMO_CODES[wmo] ?? 'Unknown'}`, 12, '#00ffff');

  // Row 13: rule
  ttRule(ctx, 13);

  // Row 14: Today's high/low
  ttRow(ctx, '  TODAY', 14, '#ffffff');
  const hi = todayIdx >= 0 ? (daily.temperature_2m_max?.[todayIdx] ?? '--') : '--';
  const lo = todayIdx >= 0 ? (daily.temperature_2m_min?.[todayIdx] ?? '--') : '--';
  ttRow(ctx, `  HIGH: ${hi}\u00B0C    LOW: ${lo}\u00B0C`, 15, '#ffff00');

  // Row 16: Precipitation
  ttRow(ctx, '  PRECIPITATION', 16, '#ffffff');
  const precip = todayIdx >= 0 ? (daily.precipitation_probability_max?.[todayIdx] ?? '--') : '--';
  ttRow(ctx, `  ${precip}%`, 17, '#00ffff');

  // Row 22: Timestamp
  const ts = data._fetchedAt ? new Date(data._fetchedAt) : null;
  if (ts) {
    const hhmm = [ts.getHours(), ts.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
    ttCentered(ctx, `LAST UPDATE: ${hhmm}`, 22, '#444444');
  }
}
