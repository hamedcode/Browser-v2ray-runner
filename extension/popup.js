// --- element refs ---
const el = (id) => document.getElementById(id);
const configList = el('configList');
const emptyLine = el('emptyLine');
const errorLine = el('errorLine');
const importResultLine = el('importResultLine');
const statusDot = el('statusDot');
const statusLine = el('statusLine');
const trafficValue = el('trafficValue');
const ipValue = el('ipValue');
const ipCheckBtn = el('ipCheckBtn');
const pingAllBtn = el('pingAllBtn');
const removeUnhealthyBtn = el('removeUnhealthyBtn');
const removeAllBtn = el('removeAllBtn');
const sortSelect = el('sortSelect');
const subList = el('subList');
const emptySubLine = el('emptySubLine');

let lang = 'en';
let accentColor = 'blue';
let statusPollTimer = null;
let testResults = new Map(); // link -> { ok, latencyMs, error } — persisted to storage
let sortMode = 'added'; // 'added' | 'ping' | 'name'

// --- i18n ---

function applyI18n() {
  V2RayI18n.applyDocumentDirection(lang);
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
  el('appTitle').textContent = t('title');
  el('tabConfigsBtn').textContent = t('tabConfigs');
  el('tabSubsBtn').textContent = t('tabSubs');
  el('tabSettingsBtn').textContent = t('tabSettings');
  el('addLabel').textContent = t('addLabel');
  el('addInput').placeholder = t('addPlaceholder');
  el('addBtn').textContent = t('add');
  el('dataUsageLabel').textContent = t('dataUsage');
  el('exitIPLabel').textContent = t('exitIP');
  ipCheckBtn.textContent = t('checkIP');
  el('languageLabel').textContent = t('language');
  el('accentColorLabel').textContent = t('accentColor');
  emptyLine.textContent = t('noConfigs');
  emptySubLine.textContent = t('noSubs');
  pingAllBtn.textContent = t('pingAll');
  removeUnhealthyBtn.textContent = t('removeUnhealthy');
  removeAllBtn.textContent = t('removeAll');
  el('subUrlInput').placeholder = t('subUrlPlaceholder');
  el('addSubBtn').textContent = t('addSubBtn');
  el('subNameInput').placeholder = t('subNamePlaceholder');
  sortSelect.options[0].textContent = t('sortAdded');
  sortSelect.options[1].textContent = t('sortPing');
  sortSelect.options[2].textContent = t('sortName');
}

async function initLanguage() {
  lang = await V2RayI18n.getLanguage();
  el('langEnBtn').classList.toggle('active', lang === 'en');
  el('langFaBtn').classList.toggle('active', lang === 'fa');
  applyI18n();
}

el('langEnBtn').addEventListener('click', () => switchLanguage('en'));
el('langFaBtn').addEventListener('click', () => switchLanguage('fa'));

async function switchLanguage(newLang) {
  lang = newLang;
  await V2RayI18n.setLanguage(newLang);
  el('langEnBtn').classList.toggle('active', lang === 'en');
  el('langFaBtn').classList.toggle('active', lang === 'fa');
  applyI18n();
  render();
}

// --- accent color ---

const COLOR_KEYS = Object.keys(V2RayConstants.ACCENT_COLORS);

async function initAccentColor() {
  const { accentColor: stored } = await browser.storage.local.get('accentColor');
  accentColor = stored && V2RayConstants.ACCENT_COLORS[stored] ? stored : 'blue';
  applyAccentColor();
  renderColorSwatches();
}

function applyAccentColor() {
  document.documentElement.style.setProperty('--accent', V2RayConstants.ACCENT_COLORS[accentColor]);
}

function renderColorSwatches() {
  const container = el('colorSwatches');
  container.innerHTML = '';
  COLOR_KEYS.forEach((key) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'color-swatch' + (key === accentColor ? ' active' : '');
    btn.style.background = V2RayConstants.ACCENT_COLORS[key];
    btn.title = key;
    btn.onclick = async () => {
      accentColor = key;
      await browser.storage.local.set({ accentColor: key });
      applyAccentColor();
      renderColorSwatches();
    };
    container.appendChild(btn);
  });
}

// --- tabs ---

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.tab;
    ['configs', 'subs', 'settings'].forEach((name) => {
      el('panel-' + name).hidden = target !== name;
    });
  });
});
el('settingsBtn').addEventListener('click', () => el('tabSettingsBtn').click());

// --- helpers ---

function formatBytes(n) {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

function flagEmoji(countryCode) {
  if (!countryCode || countryCode.length !== 2) return '';
  const codePoints = [...countryCode.toUpperCase()].map((c) => 0x1f1e6 + (c.charCodeAt(0) - 65));
  return String.fromCodePoint(...codePoints);
}

// Emoji flags are unreliable across OSes (notably Windows, which often
// doesn't combine the two regional-indicator codepoints into a glyph at all
// and just shows the raw letters). Use an actual small flag image from
// flagcdn.com instead — consistent everywhere — falling back to a plain
// text badge only if the image itself fails to load (offline, blocked, etc).
function flagBadge(countryCode) {
  const code = (countryCode || '').trim().toLowerCase();
  if (code.length === 2) {
    const img = document.createElement('img');
    img.className = 'flag-badge';
    img.src = `https://flagcdn.com/20x15/${code}.png`;
    img.width = 20;
    img.height = 15;
    img.alt = countryCode.toUpperCase();
    img.onerror = () => {
      const span = document.createElement('span');
      span.className = 'flag-badge flag-badge-text';
      span.textContent = countryCode.toUpperCase();
      if (img.parentNode) img.replaceWith(span);
    };
    return img;
  }
  const span = document.createElement('span');
  span.className = 'flag-badge flag-badge-text';
  span.textContent = (countryCode || '').toUpperCase();
  return span;
}

// Same idea for emoji (often flags) embedded inside config names pulled
// from subscription remarks — box any regional-indicator flag pairs found
// in the text instead of leaving raw/broken glyphs inline.
function renderNameWithFlags(container, name) {
  container.textContent = '';
  const regex = /[\u{1F1E6}-\u{1F1FF}]{2}/gu;
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(name)) !== null) {
    if (match.index > lastIndex) {
      container.appendChild(document.createTextNode(name.slice(lastIndex, match.index)));
    }
    const letters = [...match[0]].map((c) => String.fromCharCode(c.codePointAt(0) - 0x1f1e6 + 65)).join('');
    container.appendChild(flagBadge(letters));
    lastIndex = regex.lastIndex;
  }
  if (lastIndex < name.length) {
    container.appendChild(document.createTextNode(name.slice(lastIndex)));
  }
}

function friendlyNativeError(message) {
  const t = (k) => V2RayI18n.t(lang, k);
  if (message && /unknown action/i.test(message)) return t('hostOutdated');
  return message;
}

function renderIPValue(info) {
  ipValue.textContent = '';
  if (!info) {
    ipValue.textContent = '—';
    return;
  }
  if (info.countryCode) {
    ipValue.appendChild(flagBadge(info.countryCode));
  }
  ipValue.appendChild(document.createTextNode(` ${info.country || ''} · ${info.ip}`.trim()));
}

// --- config / subscription / test-result storage ---

async function getConfigs() {
  const { configs } = await browser.storage.local.get('configs');
  return configs || [];
}
async function saveConfigs(configs) {
  await browser.storage.local.set({ configs });
}
async function getSubs() {
  const { subscriptions } = await browser.storage.local.get('subscriptions');
  return subscriptions || [];
}
async function saveSubs(subs) {
  await browser.storage.local.set({ subscriptions: subs });
}
async function loadTestResults() {
  const { testResults: stored } = await browser.storage.local.get('testResults');
  testResults = new Map(Object.entries(stored || {}));
}
async function saveTestResults() {
  const obj = {};
  testResults.forEach((v, k) => (obj[k] = v));
  await browser.storage.local.set({ testResults: obj });
}
async function initSortMode() {
  const { configSort } = await browser.storage.local.get('configSort');
  sortMode = ['added', 'ping', 'name'].includes(configSort) ? configSort : 'added';
  sortSelect.value = sortMode;
}
sortSelect.addEventListener('change', async () => {
  sortMode = sortSelect.value;
  await browser.storage.local.set({ configSort: sortMode });
  await render();
});

function sortConfigs(configs) {
  const withIdx = configs.map((c, i) => ({ c, i }));
  if (sortMode === 'name') {
    withIdx.sort((a, b) => a.c.name.localeCompare(b.c.name));
  } else if (sortMode === 'ping') {
    const rank = (item) => {
      const r = testResults.get(item.c.link);
      if (r && r.ok) return [0, r.latencyMs];
      if (!r) return [1, 0];
      return [2, 0]; // tested and failed — sort last
    };
    withIdx.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      return ra[0] !== rb[0] ? ra[0] - rb[0] : ra[1] - rb[1];
    });
  } else {
    withIdx.sort((a, b) => (a.c.addedAt ?? a.i) - (b.c.addedAt ?? b.i));
  }
  return withIdx.map((x) => x.c);
}

// --- status / traffic / ip ---

async function refreshStatus() {
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
  const res = await browser.runtime.sendMessage({ type: 'status' });
  const status = res && res.ok ? res.status : 'unreachable';
  const activeName = res && res.activeName;
  const connected = status === 'running';

  statusDot.className = 'dot ' + (connected ? 'running' : status === 'unreachable' ? 'unreachable' : 'stopped');
  statusLine.textContent = connected ? `${t('connected')}: ${activeName}` : status === 'unreachable' ? t('unreachable') : t('disconnected');

  if (connected && res.traffic) {
    trafficValue.textContent = `↑ ${formatBytes(res.traffic.up)} · ↓ ${formatBytes(res.traffic.down)}`;
  } else {
    trafficValue.textContent = `↑ 0 B · ↓ 0 B`;
  }

  if (connected) {
    if (res.ipInfo) renderIPValue(res.ipInfo);
    else if (!res.ipError) ipValue.textContent = '…'; // still checking automatically
  } else {
    ipValue.textContent = '—';
  }

  return { connected, activeName };
}

ipCheckBtn.addEventListener('click', async () => {
  errorLine.textContent = '';
  ipValue.textContent = '…';
  const res = await browser.runtime.sendMessage({ type: 'ipinfo' });
  if (!res.ok) {
    ipValue.textContent = '—';
    errorLine.textContent = friendlyNativeError(res.error);
    return;
  }
  renderIPValue(res.info);
});

// --- render config list ---

async function render() {
  const configs = sortConfigs(await getConfigs());
  const { connected, activeName } = await refreshStatus();
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);

  emptyLine.hidden = configs.length > 0;
  configList.innerHTML = '';

  configs.forEach((cfg) => {
    const isActive = connected && cfg.name === activeName;

    const li = document.createElement('li');
    li.className = isActive ? 'active' : '';

    const top = document.createElement('div');
    top.className = 'cfg-top';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'cfg-name';
    renderNameWithFlags(nameSpan, cfg.name);
    top.appendChild(nameSpan);

    const actions = document.createElement('span');
    actions.className = 'cfg-actions';

    const connectBtn = document.createElement('button');
    connectBtn.className = 'connect-btn' + (isActive ? ' running' : '');
    connectBtn.textContent = isActive ? t('disconnect') : t('connect');
    connectBtn.onclick = () => onToggle(cfg, isActive);
    actions.appendChild(connectBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = t('remove');
    removeBtn.onclick = () => onRemove(cfg.link);
    actions.appendChild(removeBtn);

    top.appendChild(actions);
    li.appendChild(top);

    const result = testResults.get(cfg.link);
    if (result) {
      const resultLine = document.createElement('div');
      resultLine.className = 'cfg-result ' + (result.ok ? 'ok' : 'fail');
      if (result.ok) {
        resultLine.textContent = `${result.latencyMs}ms`;
      } else {
        resultLine.textContent = '-1';
        if (result.error) resultLine.title = result.error;
      }
      li.appendChild(resultLine);
    }

    configList.appendChild(li);
  });

  await renderSubs();
}

async function onToggle(cfg, isCurrentlyActive) {
  errorLine.textContent = '';
  if (isCurrentlyActive) {
    await browser.runtime.sendMessage({ type: 'disconnect' });
  } else {
    ipValue.textContent = '…'; // connecting triggers an automatic IP check
    const res = await browser.runtime.sendMessage({ type: 'connect', link: cfg.link });
    if (!res.ok) errorLine.textContent = friendlyNativeError(res.error);
  }
  await render();
}

async function onRemove(link) {
  const configs = await getConfigs();
  testResults.delete(link);
  await saveConfigs(configs.filter((c) => c.link !== link));
  await saveTestResults();
  await render();
}

// --- ping all, in parallel (each slot gets its own local test port so
// concurrent sing-box test instances never collide) ---

pingAllBtn.addEventListener('click', async () => {
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
  errorLine.textContent = '';
  const configs = await getConfigs();
  if (configs.length === 0) return;

  pingAllBtn.disabled = true;
  removeUnhealthyBtn.disabled = true;
  const original = pingAllBtn.textContent;
  const concurrency = Math.min(V2RayConstants.TEST_CONCURRENCY, configs.length);
  let completed = 0;
  pingAllBtn.textContent = t('pingingAll', 0, configs.length);

  let next = 0;
  async function worker(slot) {
    const port = V2RayConstants.TEST_PROXY_PORT + slot;
    while (true) {
      const i = next++;
      if (i >= configs.length) return;
      const cfg = configs[i];
      try {
        const res = await browser.runtime.sendMessage({ type: 'test', link: cfg.link, port });
        testResults.set(cfg.link, res.ok ? { ok: true, latencyMs: res.latencyMs } : { ok: false, error: friendlyNativeError(res.error) });
      } catch (err) {
        testResults.set(cfg.link, { ok: false, error: err.message });
      }
      completed++;
      pingAllBtn.textContent = t('pingingAll', completed, configs.length);
      await saveTestResults();
      await render();
    }
  }

  await Promise.all(Array.from({ length: concurrency }, (_, slot) => worker(slot)));

  pingAllBtn.disabled = false;
  removeUnhealthyBtn.disabled = false;
  pingAllBtn.textContent = original;
});

// --- remove unhealthy / remove all ---

removeUnhealthyBtn.addEventListener('click', async () => {
  const configs = await getConfigs();
  const kept = configs.filter((cfg) => {
    const result = testResults.get(cfg.link);
    return !(result && result.ok === false);
  });
  configs.filter((cfg) => !kept.includes(cfg)).forEach((cfg) => testResults.delete(cfg.link));
  await saveConfigs(kept);
  await saveTestResults();
  await render();
});

removeAllBtn.addEventListener('click', async () => {
  testResults.clear();
  await saveConfigs([]);
  await saveTestResults();
  await render();
});

// --- subscriptions ---

async function refreshSubscription(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.text();
  const decoded = V2RayParser.decodeSubscriptionBody(body);
  const lines = decoded
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));

  let added = 0;
  let skipped = 0;
  const newTagged = [];
  for (const line of lines) {
    try {
      const parsed = V2RayParser.parseLink(line);
      newTagged.push({ name: parsed.name, link: line, subId: url, addedAt: Date.now() });
      added++;
    } catch (err) {
      skipped++;
    }
  }

  const configs = await getConfigs();
  const removed = configs.filter((c) => c.subId === url);
  removed.forEach((c) => testResults.delete(c.link));
  const kept = configs.filter((c) => c.subId !== url);
  await saveConfigs(kept.concat(newTagged));
  await saveTestResults();

  const subs = await getSubs();
  const idx = subs.findIndex((s) => s.url === url);
  if (idx >= 0) {
    subs[idx].lastUpdated = Date.now();
    subs[idx].count = newTagged.length;
    await saveSubs(subs);
  }

  return { added, skipped };
}

async function addOrUpdateSubscription(url, name) {
  const subs = await getSubs();
  let sub = subs.find((s) => s.url === url);
  if (!sub) {
    subs.push({ url, name: name || '', addedAt: Date.now(), lastUpdated: null, count: 0 });
    await saveSubs(subs);
  } else if (name && name !== sub.name) {
    sub.name = name;
    await saveSubs(subs);
  }
  return refreshSubscription(url);
}

async function removeSubscription(url) {
  const subs = await getSubs();
  await saveSubs(subs.filter((s) => s.url !== url));
  const configs = await getConfigs();
  const removed = configs.filter((c) => c.subId === url);
  removed.forEach((c) => testResults.delete(c.link));
  await saveConfigs(configs.filter((c) => c.subId !== url));
  await saveTestResults();
}

async function renderSubs() {
  const subs = await getSubs();
  const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);

  emptySubLine.hidden = subs.length > 0;
  subList.innerHTML = '';

  subs.forEach((sub) => {
    const li = document.createElement('li');

    const top = document.createElement('div');
    top.className = 'sub-top';

    const urlSpan = document.createElement('span');
    urlSpan.className = 'sub-url';
    urlSpan.textContent = sub.name ? sub.name : sub.url;
    urlSpan.title = sub.url;
    top.appendChild(urlSpan);

    const actions = document.createElement('span');
    actions.className = 'sub-actions';

    const renameBtn = document.createElement('button');
    renameBtn.textContent = '✎';
    renameBtn.title = t('renameSub');
    renameBtn.onclick = async () => {
      const newName = window.prompt(t('renameSubPrompt'), sub.name || '');
      if (newName === null) return; // cancelled
      const subs = await getSubs();
      const idx = subs.findIndex((s) => s.url === sub.url);
      if (idx >= 0) {
        subs[idx].name = newName.trim();
        await saveSubs(subs);
      }
      await render();
    };
    actions.appendChild(renameBtn);

    const updateBtn = document.createElement('button');
    updateBtn.textContent = t('updateSub');
    updateBtn.onclick = async () => {
      updateBtn.disabled = true;
      const original = updateBtn.textContent;
      updateBtn.textContent = t('subUpdating');
      try {
        await refreshSubscription(sub.url);
      } catch (err) {
        errorLine.textContent = err.message;
      }
      updateBtn.disabled = false;
      updateBtn.textContent = original;
      await render();
    };
    actions.appendChild(updateBtn);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '✕';
    removeBtn.title = t('removeSubBtn');
    removeBtn.onclick = async () => {
      await removeSubscription(sub.url);
      await render();
    };
    actions.appendChild(removeBtn);

    top.appendChild(actions);
    li.appendChild(top);

    const meta = document.createElement('div');
    meta.className = 'sub-meta';
    const when = sub.lastUpdated ? new Date(sub.lastUpdated).toLocaleString(lang === 'fa' ? 'fa-IR' : 'en-US') : t('subNever');
    const urlPart = sub.name ? `${sub.url} · ` : '';
    meta.textContent = `${urlPart}${t('subCount', sub.count || 0)} · ${when}`;
    li.appendChild(meta);

    subList.appendChild(li);
  });
}

el('addSubForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorLine.textContent = '';
  const urlInput = el('subUrlInput');
  const nameInput = el('subNameInput');
  const url = urlInput.value.trim();
  const name = nameInput.value.trim();
  if (!url) return;

  el('addSubBtn').disabled = true;
  try {
    await addOrUpdateSubscription(url, name);
    urlInput.value = '';
    nameInput.value = '';
    await render();
  } catch (err) {
    errorLine.textContent = err.message;
  } finally {
    el('addSubBtn').disabled = false;
  }
});

// --- unified smart add: single link / multiple links / subscription URL,
// auto-detected per non-empty line. Blank lines and comments are silently
// skipped rather than counted as errors. A detected subscription URL is
// registered under the Subs tab so it can be updated later. ---

el('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  errorLine.textContent = '';
  importResultLine.textContent = '';
  const textarea = el('addInput');
  const text = textarea.value.trim();
  if (!text) return;

  el('addBtn').disabled = true;
  try {
    const { added, skipped } = await smartImport(text);
    const t = (k, ...a) => V2RayI18n.t(lang, k, ...a);
    importResultLine.textContent = [added ? t('importedCount', added) : null, skipped ? t('importErrors', skipped) : null]
      .filter(Boolean)
      .join(' · ');
    textarea.value = '';
    await render();
  } finally {
    el('addBtn').disabled = false;
  }
});

async function smartImport(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#')); // blank/comment lines silently ignored

  let added = 0;
  let skipped = 0;

  for (const line of lines) {
    if (/^(vless|vmess|trojan|ss|socks5?):\/\//i.test(line)) {
      try {
        const parsed = V2RayParser.parseLink(line);
        const configs = await getConfigs();
        configs.push({ name: parsed.name, link: line, addedAt: Date.now() });
        await saveConfigs(configs);
        added++;
      } catch (err) {
        skipped++;
      }
      continue;
    }

    if (/^https?:\/\//i.test(line)) {
      try {
        const result = await addOrUpdateSubscription(line);
        added += result.added;
        skipped += result.skipped;
      } catch (err) {
        skipped++; // whole subscription failed to fetch/decode
      }
      continue;
    }

    skipped++; // not a recognized link or URL
  }

  return { added, skipped };
}

// --- boot ---

(async function init() {
  await initLanguage();
  await initAccentColor();
  await initSortMode();
  await loadTestResults();
  await render();
  statusPollTimer = setInterval(refreshStatus, 2500);
})();
