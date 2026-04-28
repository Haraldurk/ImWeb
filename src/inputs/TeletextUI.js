// TeletextUI — page navigation buttons, sub-page arrows, RSS URL input.
// Exported function buildTeletextUI(container, ps, teletextSource).
// Follows the same pattern as buildAnalogPresetBar() in src/ui/UI.js.

const PAGE_LABELS = ['P100', 'P150', 'P400', 'P401', 'P500', 'P700', 'P900'];
const RSS_KEY = 'imweb-teletext-rssUrl';
const ICS_KEY = 'imweb-teletext-ics-url';

/**
 * @param {HTMLElement} container       #teletext-params element
 * @param {object}      ps              ParameterSystem instance
 * @param {object}      teletextSource  TeletextSource instance
 */
export function buildTeletextUI(container, ps, teletextSource) {

  // Clear any existing UI refresh timer (defensive against re-init)
  if (teletextSource._uiRefreshTimer) {
    clearInterval(teletextSource._uiRefreshTimer);
    teletextSource._uiRefreshTimer = null;
  }

  // ── Page navigation buttons ───────────────────────────────────────────
  const navDiv = document.createElement('div');
  navDiv.className = 'tt-nav';
  container.appendChild(navDiv);

  const pageBtns = [];

  PAGE_LABELS.forEach((label, i) => {
    const btn = document.createElement('button');
    btn.className = 'tt-nav-btn';
    btn.textContent = label;
    btn.addEventListener('click', () => {
      ps.set('teletext.page', i);
    });
    navDiv.appendChild(btn);
    pageBtns.push(btn);
  });

  // Set initial active button
  {
    const idx = ps.get('teletext.page')?.value ?? 0;
    pageBtns[idx]?.classList.add('active');
  }

  // Keep active button in sync when page changes externally (preset, MIDI, etc.)
  ps.get('teletext.page')?.onChange?.(v => {
    pageBtns.forEach((btn, i) => btn.classList.toggle('active', i === v));
  });

  // ── Sub-page navigation ───────────────────────────────────────────────
  const spDiv = document.createElement('div');
  spDiv.className = 'tt-subpage';
  container.appendChild(spDiv);

  const spPrev = document.createElement('button');
  spPrev.className = 'tt-subpage-btn';
  spPrev.textContent = '\u25C0';     // ◀
  spPrev.addEventListener('click', () => {
    if (teletextSource._subPageCount <= 1) return;
    teletextSource.prevSubPage();
  });

  const spLabel = document.createElement('span');
  spLabel.className = 'tt-subpage-label';

  const spNext = document.createElement('button');
  spNext.className = 'tt-subpage-btn';
  spNext.textContent = '\u25B6';     // ▶
  spNext.addEventListener('click', () => {
    if (teletextSource._subPageCount <= 1) return;
    teletextSource.nextSubPage();
  });

  spDiv.appendChild(spPrev);
  spDiv.appendChild(spLabel);
  spDiv.appendChild(spNext);

  // Refresh the sub-page label every 250ms
  teletextSource._uiRefreshTimer = setInterval(() => {
    const idx   = teletextSource._subPageIdx;
    const count = teletextSource._subPageCount;
    spLabel.textContent = (idx + 1) + ' / ' + count;
    const idle = count <= 1;
    spPrev.disabled = idle;
    spNext.disabled = idle;
    spDiv.classList.toggle('idle', idle);
  }, 250);

  // ── RSS URL input ─────────────────────────────────────────────────────
  const rssDiv = document.createElement('div');
  rssDiv.className = 'tt-rss-row';
  container.appendChild(rssDiv);

  const rssInput = document.createElement('input');
  rssInput.className = 'tt-rss-url';
  rssInput.type = 'text';
  rssInput.placeholder = 'RSS feed URL...';
  rssInput.value = localStorage.getItem(RSS_KEY) ?? '';
  rssInput.spellcheck = false;

  // ── RSS preset source dropdown ───────────────────────────────────────
  const RSS_PRESETS = [
    { label: 'BBC News',      url: 'https://feeds.bbci.co.uk/news/rss.xml' },
    { label: 'RÚV',           url: 'https://www.ruv.is/rss/frettir' },
    { label: 'Reuters',       url: 'https://feeds.reuters.com/reuters/topNews' },
    { label: 'Al Jazeera',    url: 'https://www.aljazeera.com/xml/rss/all.xml' },
    { label: 'NASA',          url: 'https://www.nasa.gov/rss/dyn/breaking_news.rss' },
    { label: 'Hacker News',   url: 'https://hnrss.org/frontpage' },
    { label: 'The Verge',     url: 'https://www.theverge.com/rss/index.xml' },
  ];

  const presetDiv = document.createElement('div');
  presetDiv.className = 'tt-rss-preset-row';

  const presetSelect = document.createElement('select');
  presetSelect.className = 'tt-rss-preset';

  // Build options
  const defaultOpt = document.createElement('option');
  defaultOpt.value = '';
  defaultOpt.textContent = 'Select feed preset...';
  defaultOpt.disabled = true;
  presetSelect.appendChild(defaultOpt);

  RSS_PRESETS.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.url;
    opt.textContent = p.label;
    presetSelect.appendChild(opt);
  });

  const customOpt = document.createElement('option');
  customOpt.value = '';
  customOpt.textContent = 'Custom\u2026';
  presetSelect.appendChild(customOpt);

  // Pre-select matching preset (or custom if no match)
  const storedUrl = localStorage.getItem(RSS_KEY) ?? '';
  const matchedPreset = RSS_PRESETS.find(p => p.url === storedUrl);
  if (matchedPreset) {
    presetSelect.value = matchedPreset.url;
  } else if (storedUrl) {
    presetSelect.value = ''; // 'Custom…'
  }

  presetSelect.addEventListener('change', () => {
    const url = presetSelect.value;
    if (url) {
      rssInput.value = url;
      localStorage.setItem(RSS_KEY, url);
      if (teletextSource.fetchRSS) teletextSource.fetchRSS(url);
    } else {
      // 'Custom…' selected — focus the text input
      rssInput.select();
      rssInput.focus();
    }
  });

  presetDiv.appendChild(presetSelect);
  container.appendChild(presetDiv);

  const connectBtn = document.createElement('button');
  connectBtn.className = 'tt-connect-btn';
  connectBtn.textContent = 'Connect';
  connectBtn.addEventListener('click', () => {
    const url = rssInput.value.trim();
    localStorage.setItem(RSS_KEY, url);
    if (teletextSource.fetchRSS) {
      teletextSource.fetchRSS(url);
    }
  });
  // Enter key in input triggers connect
  rssInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); connectBtn.click(); }
  });

  rssDiv.appendChild(rssInput);
  rssDiv.appendChild(connectBtn);

  // ── Calendar ICS URL input ──────────────────────────────────────────────
  const calDiv = document.createElement('div');
  calDiv.className = 'tt-rss-row';
  container.appendChild(calDiv);

  const calLabel = document.createElement('small');
  calLabel.style.cssText = 'display:block;color:#556655;margin:4px 0 2px 0;font-size:10px;';
  calLabel.textContent = 'iCloud/Google .ics public URL (change webcal:// to https://)';
  calDiv.appendChild(calLabel);

  const calInput = document.createElement('input');
  calInput.className = 'tt-rss-url';
  calInput.type = 'text';
  calInput.placeholder = '.ics calendar URL...';
  calInput.value = localStorage.getItem(ICS_KEY) ?? '';
  calInput.spellcheck = false;

  const calBtn = document.createElement('button');
  calBtn.className = 'tt-connect-btn';
  calBtn.textContent = 'Connect';
  calBtn.addEventListener('click', () => {
    const url = calInput.value.trim();
    localStorage.setItem(ICS_KEY, url);
    if (teletextSource.fetchCalendar) teletextSource.fetchCalendar(url);
  });
  calInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); calBtn.click(); }
  });

  calDiv.appendChild(calInput);
  calDiv.appendChild(calBtn);
}
