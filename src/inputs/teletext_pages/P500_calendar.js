// P500 — Calendar
// Accepts a public .ics URL stored in localStorage['imweb-teletext-ics-url'].
// Fetches via CORS proxy, parses inline (no library), shows today's events.
// Polls every 3600s via DATA_KEYS.

import { CANVAS_W, drawHeader, ttRow, ttCentered, ttRule } from '../teletext_draw.js';

// ── Inline iCal parser ──────────────────────────────────────────────────────

export function parseICal(icsText) {
  const events = [];
  const lines = icsText.split(/\r?\n/);
  let inEvent = false;
  let summary = '';
  let dtStart = '';
  let dtEnd = '';

  for (const raw of lines) {
    const line = raw.trim();
    if (line === 'BEGIN:VEVENT') {
      inEvent = true;
      summary = '';
      dtStart = '';
      dtEnd = '';
    } else if (line === 'END:VEVENT') {
      inEvent = false;
      if (summary && dtStart) {
        events.push({ summary: unescapeICal(summary), dtStart, dtEnd: dtEnd || dtStart });
      }
    } else if (inEvent) {
      if (line.startsWith('SUMMARY:')) {
        summary = line.slice(8);
      } else if (line.startsWith('SUMMARY;')) {
        const idx = line.indexOf(':');
        if (idx >= 0) summary = line.slice(idx + 1);
      } else if (line.startsWith('DTSTART:')) {
        dtStart = line.slice(8);
      } else if (line.startsWith('DTSTART;')) {
        const idx = line.indexOf(':');
        if (idx >= 0) dtStart = line.slice(idx + 1);
      } else if (line.startsWith('DTEND:')) {
        dtEnd = line.slice(6);
      } else if (line.startsWith('DTEND;')) {
        const idx = line.indexOf(':');
        if (idx >= 0) dtEnd = line.slice(idx + 1);
      }
    }
  }
  return events;
}

// Handle iCal escaping: \; → ;, \, → ,, \\ → \, \n → newline
function unescapeICal(str) {
  return str.replace(/\\;/g, ';').replace(/\\,/g, ',').replace(/\\\\/g, '\\').replace(/\\n/g, '\n').replace(/\\N/g, '\n');
}

// Parse an iCal date string into a Date.
// Handles: 20260428T140000Z, 20260428T140000, 20260428 (date only)
function parseICalDate(str) {
  const match = str.match(
    /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/
  );
  if (!match) return null;
  const [, y, m, d, hh, mm, ss] = match;
  return new Date(
    Date.UTC(+y, +m - 1, +d, +(hh ?? 0), +(mm ?? 0), +(ss ?? 0))
  );
}

function formatTime(d) {
  return [d.getHours(), d.getMinutes()].map(n => String(n).padStart(2, '0')).join(':');
}

function formatDateShort(d) {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[d.getMonth()]} ${d.getDate()}`;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth()  === b.getMonth()
    && a.getDate()   === b.getDate();
}

// ── Render ──────────────────────────────────────────────────────────────────

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {object|null} data         { events: [...], feedTitle?: string, fetchedAt?: number }
 * @param {number} subPageIdx
 * @returns {number} sub-page count
 */
export function renderP500(ctx, data, subPageIdx) {
  drawHeader(ctx, '500', 'CALENDAR');

  if (!data || !data.events || !data.events.length) {
    if (data === null) {
      ttCentered(ctx, 'NO CALENDAR CONFIGURED', 3, '#aaaaaa');
      ttCentered(ctx, 'Provide a public .ics URL below', 5, '#555555');
      ttCentered(ctx, 'iCloud: Calendar \u2192 Share \u2192 Public URL', 7, '#555555');
      ttCentered(ctx, 'Google: Settings \u2192 Secret iCal address', 8, '#555555');
      ttCentered(ctx, 'Change webcal:// to https://', 10, '#555555');
    } else {
      ttCentered(ctx, 'NO EVENTS FOUND', 3, '#aaaaaa');
      ttCentered(ctx, 'No upcoming events in the next 7 days.', 5, '#555555');
    }
    ttRule(ctx, 12);

    const ts = data?.fetchedAt ? new Date(data.fetchedAt) : null;
    if (ts) {
      const hhmm = formatTime(ts);
      ttCentered(ctx, `LAST FETCH: ${hhmm}`, 14, '#444444');
    }

    ttCentered(ctx, 'IMWEB  v 0.8.5', 22, '#005500');
    return 1;
  }

  const events = data.events;
  const today = new Date();

  // Filter to today
  const todayEvents = events.filter(ev => {
    const s = parseICalDate(ev.dtStart);
    if (!s) return false;
    return sameDay(s, today);
  });

  // Next upcoming events (not today)
  const upcoming = events.filter(ev => {
    const s = parseICalDate(ev.dtStart);
    if (!s) return false;
    return s > today && !sameDay(s, today);
  }).slice(0, 3);

  let row = 1;

  // ── Today's date ───────────────────────────────────────────────────────────
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });
  ttRow(ctx, `  ${dateStr}`, row++, '#ffffff');
  ttRule(ctx, row++, '#003300');

  // ── Today's events ─────────────────────────────────────────────────────────
  if (todayEvents.length === 0) {
    ttCentered(ctx, 'No events scheduled today.', row++, '#444444');
    row++;
  } else {
    todayEvents.forEach((ev, i) => {
      const s = parseICalDate(ev.dtStart);
      const e = parseICalDate(ev.dtEnd);
      let timeStr = '';
      if (s) {
        const isAllDay = ev.dtStart.length === 8; // YYYYMMDD only
        if (isAllDay) {
          timeStr = 'ALL DAY';
        } else if (e) {
          timeStr = `${formatTime(s)}-${formatTime(e)}`;
        } else {
          timeStr = formatTime(s);
        }
      }
      const summary = ev.summary.slice(0, 28);
      const color = (i % 2 === 0) ? '#00ff00' : '#00aaaa';
      ttRow(ctx, `  ${timeStr.padEnd(14)}${summary}`, row++, color);
    });
  }

  // ── Upcoming ───────────────────────────────────────────────────────────────
  if (upcoming.length > 0) {
    row++;
    ttRow(ctx, '  UPCOMING', row++, '#aaaaaa');
    upcoming.forEach(ev => {
      const s = parseICalDate(ev.dtStart);
      const dayLabel = s ? formatDateShort(s) : '';
      const summary = ev.summary.slice(0, 30);
      ttRow(ctx, `  ${dayLabel.padEnd(6)}${summary}`, row++, '#444444');
    });
  }

  // ── Timestamp ──────────────────────────────────────────────────────────────
  const ts = data.fetchedAt ? new Date(data.fetchedAt) : null;
  if (ts) {
    ttCentered(ctx, `LAST FETCH: ${formatTime(ts)}`, 22, '#444444');
  }

  return 1;
}
