// TeletextSource — Canvas 2D Teletext engine.
// Produces a THREE.CanvasTexture that AnalogTV.js accepts as its source texture.
// Uses a dirty-flag repaint model: canvas only redraws when page changes or clock ticks.
// Never touches Pipeline.addPass() — it is a standalone texture producer like TextLayer.

import * as THREE from 'three';
import { CANVAS_W, CANVAS_H, drawHeader, ttRow, ttRule } from './teletext_draw.js';
import { renderP100 } from './teletext_pages/P100_index.js';
import { renderP900 } from './teletext_pages/P900_system.js';
import { renderP400 } from './teletext_pages/P400_weather.js';
import { renderP401 } from './teletext_pages/P401_forecast.js';
import { renderP150 } from './teletext_pages/P150_headlines.js';
import { renderP500, parseICal } from './teletext_pages/P500_calendar.js';
import { renderP700 } from './teletext_pages/P700_nowplaying.js';

// ── Page registry ─────────────────────────────────────────────────────────────
// Render functions are added here as each build step lands.
// A null renderer shows a "coming soon" placeholder.

const PAGE_IDS = ['P100', 'P150', 'P400', 'P401', 'P500', 'P700', 'P900'];

const PAGE_TITLES = {
  P100: 'IMWEB TELETEXT',
  P150: 'HEADLINES',
  P400: 'WEATHER TODAY',
  P401: 'HOURLY FORECAST',
  P500: 'CALENDAR',
  P700: 'NOW PLAYING',
  P900: 'SYSTEM INFO',
};

const PAGE_RENDERERS = {
  P100: renderP100,
  P150: renderP150,
  P400: renderP400,
  P401: renderP401,
  P500: renderP500,
  P700: renderP700,
  P900: renderP900,
};

const DATA_KEYS = {
  P150: 'rss',
  P400: 'weather',
  P401: 'weather',
  P500: 'calendar',
  P700: 'movie',
};

// ── TeletextSource ────────────────────────────────────────────────────────────

export class TeletextSource {
  constructor() {
    this._canvas        = document.createElement('canvas');
    this._canvas.width  = CANVAS_W;
    this._canvas.height = CANVAS_H;
    this._ctx = this._canvas.getContext('2d', { willReadFrequently: false });

    this.texture = new THREE.CanvasTexture(this._canvas);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this._pageIdx = 0;
    this._dirty   = true; // force first paint

    this._subPageIdx   = 0;
    this._subPageCount = 1;

    this._subPageTimer   = null;
    this._uiRefreshTimer = null;

    this._cachedData    = {};
    this._fetchInFlight = {};

    this._movieInput = null; // set via setMovieInput() from main.js

    // 1-second interval keeps the live clock (and later P900) ticking.
    // Cheap: sets a boolean only; actual canvas work happens in tick().
    this._clockTimer = setInterval(() => { this._dirty = true; }, 1000);
  }

  /**
   * Called from the main render loop when AnalogTV source === TELETEXT_SRC_IDX.
   * Handles page switches and dirty-flag repaints.
   */
  tick(ps, dt) {
    const pageIdx = ps.get('teletext.page')?.value ?? 0;
    if (pageIdx !== this._pageIdx) {
      this._pageIdx    = pageIdx;
      this._subPageIdx = 0;
      this._subPageCount = 1;
      this._dirty      = true;
    }

    // Poll data sources when on a data page
    const pageId = PAGE_IDS[this._pageIdx] ?? 'P100';
    const dk = DATA_KEYS[pageId];
    if (dk) {
      const pollMs = (ps.get('teletext.pollInterval')?.value ?? 300) * 1000;
      if (!this._cachedData[dk]) {
        // No data yet — fetch immediately (once)
        if (!this._fetchInFlight[dk]) this._dispatchFetch(dk, ps);
      } else {
        const stale = Date.now() - this._cachedData[dk].fetchedAt > pollMs;
        if (stale && !this._fetchInFlight[dk]) {
          this._dispatchFetch(dk, ps);
        }
      }
    }
    // P700 movie state is synchronous — update every tick when on P700
    if (pageId === 'P700' && this._movieInput) {
      const clip = this._movieInput.currentClip;
      this._cachedData.movie = {
        data: {
          filename: clip?.name ?? null,
          speed:    ps.get('movie.speed')?.value ?? 1.0,
          on:       ps.get('movie.active')?.value ?? 0,
        },
        fetchedAt: Date.now()
      };
      this._dirty = true;
    }
    if (this._dirty) {
      this._dirty = false;    // reset before render so any re-entrant set is preserved
      this._render();
      this.texture.needsUpdate = true;
    }
  }

  _render() {
    const ctx    = this._ctx;
    const pageId = PAGE_IDS[this._pageIdx] ?? 'P100';
    const render = PAGE_RENDERERS[pageId];

    // Clear to black
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    if (render) {
      const dk = DATA_KEYS[pageId];
      const cached = this._cachedData[dk];
      const count = render(ctx, cached?.data, this._subPageIdx);
      this.setSubPageCount(count ?? 1);
    } else {
      // Placeholder for pages not yet implemented
      const title = PAGE_TITLES[pageId] ?? pageId;
      drawHeader(ctx, pageId.replace('P', ''), title);
      ttRow(ctx, '', 2, '#000000');
      ttRow(ctx, `  ${pageId}  ${title}`, 3, '#666666');
      ttRow(ctx, '  Coming in a future build step.', 5, '#444444');
      ttRow(ctx, '  Return to P100 for the index.', 6, '#444444');
      ttRule(ctx, 8, '#222222');
    }
  }

  nextSubPage() {
    this._subPageIdx = (this._subPageIdx + 1) % this._subPageCount;
    this._dirty = true;
  }

  prevSubPage() {
    this._subPageIdx = (this._subPageIdx - 1 + this._subPageCount) % this._subPageCount;
    this._dirty = true;
  }

  setSubPageCount(n) {
    this._subPageCount = Math.max(1, n | 0);
    if (this._subPageIdx >= this._subPageCount) this._subPageIdx = 0;
  }

  _dispatchFetch(dataKey, ps) {
    if (dataKey === 'weather') {
      this._fetchWeather(ps);
    } else if (dataKey === 'rss') {
      this._fetchRSS();
    } else if (dataKey === 'calendar') {
      this._fetchCalendar(ps);
    }
  }

  async _fetchWeather(ps) {
    this._fetchInFlight.weather = true;
    try {
      const lat = ps.get('teletext.latitude')?.value  ?? 64.1466;
      const lon = ps.get('teletext.longitude')?.value ?? -21.9426;
      const url = 'https://api.open-meteo.com/v1/forecast'
        + `?latitude=${lat}&longitude=${lon}`
        + '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m'
        + '&hourly=temperature_2m,weather_code,precipitation_probability'
        + '&daily=temperature_2m_max,temperature_2m_min,weather_code,precipitation_probability_max'
        + '&timezone=auto&forecast_days=6';

      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // Attach lat/lon (may differ from request due to Open-Meteo rounding)
      if (json.latitude == null)  json.latitude  = lat;
      if (json.longitude == null) json.longitude = lon;
      json._fetchedAt = Date.now();

      this._cachedData.weather = { data: json, fetchedAt: Date.now() };
      this._dirty = true;
    } catch (e) {
      console.warn('[TeletextSource] Weather fetch failed:', e.message);
    } finally {
      this._fetchInFlight.weather = false;
    }
  }

  async _fetchRSS() {
    const url = localStorage.getItem('imweb-teletext-rssUrl') ?? 'https://feeds.bbci.co.uk/news/rss.xml';
    this._fetchInFlight.rss = true;
    try {
      const proxyUrl = 'https://api.rss2json.com/v1/api.json?rss_url='
        + encodeURIComponent(url) + '&count=50';
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.status !== 'ok') throw new Error('RSS status: ' + (json.status || 'unknown'));
      const items = json.items || [];
      this._cachedData.rss = {
        data: { items, feedTitle: json.feed?.title ?? '', fetchedAt: Date.now() },
        fetchedAt: Date.now(),
      };
      this.setSubPageCount(Math.ceil(items.length / 5));
      this._dirty = true;
    } catch (e) {
      console.warn('[TeletextSource] RSS fetch failed:', e.message);
    } finally {
      this._fetchInFlight.rss = false;
    }
  }

  fetchRSS(url) {
    localStorage.setItem('imweb-teletext-rssUrl', url);
    delete this._cachedData.rss;
    this._fetchInFlight.rss = false;
    this._dispatchFetch('rss');
  }

  async _fetchCalendar(ps) {
    const url = localStorage.getItem('imweb-teletext-ics-url');
    if (!url) {
      this._cachedData.calendar = null;
      this._dirty = true;
      return;
    }
    this._fetchInFlight.calendar = true;
    try {
      const proxyUrl = 'https://corsproxy.io/?' + encodeURIComponent(url);
      const res = await fetch(proxyUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const events = parseICal(text);
      if (events.length === 0) throw new Error('No VEVENT blocks found in .ics file');
      this._cachedData.calendar = {
        data: { events, feedTitle: null },
        fetchedAt: Date.now(),
      };
      this._dirty = true;
    } catch (e) {
      console.warn('[TeletextSource] Calendar fetch failed:', e.message);
    } finally {
      this._fetchInFlight.calendar = false;
    }
  }

  fetchCalendar(url) {
    if (url !== undefined) localStorage.setItem('imweb-teletext-ics-url', url);
    delete this._cachedData.calendar;
    this._fetchInFlight.calendar = false;
    this._dispatchFetch('calendar');
  }

  setMovieInput(movieInput) {
    this._movieInput = movieInput;
  }

  dispose() {
    clearInterval(this._clockTimer);
    if (this._subPageTimer) clearInterval(this._subPageTimer);
    if (this._uiRefreshTimer) clearInterval(this._uiRefreshTimer);
    this.texture.dispose();
  }
}
