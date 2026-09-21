// Chrome's MV3 service worker needs importScripts() to load dependencies.
// Firefox's MV3 background runs as a regular page (not a Worker), where
// importScripts doesn't exist at all — there, the same files are listed
// directly in manifest.firefox.json's background.scripts array instead, so
// this call is skipped and everything is already in scope by the time this
// line runs.
if (typeof importScripts === 'function') {
  importScripts(
    'common/browser-polyfill.js',
    'common/constants.js',
    'common/parser.js',
    'common/singbox-config.js'
  );
}

const C = V2RayConstants;
const NATIVE_HOST = 'com.v2rayext.host';
const NATIVE_TIMEOUT_MS = 8000;
const TEST_TIMEOUT_MS = 18000;
const TRAFFIC_POLL_MS = 3000;

let nativePort = null; // the persistent port for the active connection, if any
let state = 'stopped'; // 'stopped' | 'running' | 'unreachable'
let activeName = null;
let traffic = { up: 0, down: 0 };
let trafficTimer = null;
let lastIPInfo = null;
let lastIPError = null;

// --- proxy application: Chrome vs Firefox ---

const isFirefoxProxyAPI = !!(browser.proxy && browser.proxy.onRequest);

function firefoxProxyHandler() {
  return { type: 'socks', host: '127.0.0.1', port: C.LOCAL_PROXY_PORT, proxyDNS: true };
}

async function applyProxyOn() {
  if (isFirefoxProxyAPI) {
    if (!browser.proxy.onRequest.hasListener(firefoxProxyHandler)) {
      browser.proxy.onRequest.addListener(firefoxProxyHandler, { urls: ['<all_urls>'] });
    }
  } else if (browser.proxy && browser.proxy.settings) {
    await browser.proxy.settings.set({
      value: {
        mode: 'fixed_servers',
        rules: {
          singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: C.LOCAL_PROXY_PORT },
          bypassList: ['localhost', '127.0.0.1'],
        },
      },
      scope: 'regular',
    });
  }
}

async function applyProxyOff() {
  if (isFirefoxProxyAPI) {
    if (browser.proxy.onRequest.hasListener(firefoxProxyHandler)) {
      browser.proxy.onRequest.removeListener(firefoxProxyHandler);
    }
  } else if (browser.proxy && browser.proxy.settings) {
    await browser.proxy.settings.clear({ scope: 'regular' });
  }
}

// --- native host bridge ---
//
// Each Port tracks its own in-flight request (port._pending) rather than a
// shared module-level variable, so the persistent main connection and a
// one-off "test this config" call never clobber each other's callbacks —
// they're always on separate Port objects / separate host processes.

function openHostPort({ onUnexpectedDisconnect } = {}) {
  const port = browser.runtime.connectNative(NATIVE_HOST);
  port._pending = null;

  port.onMessage.addListener((msg) => {
    if (port._pending) {
      clearTimeout(port._pending.timer);
      const p = port._pending;
      port._pending = null;
      p.resolve(msg);
    }
  });

  port.onDisconnect.addListener(() => {
    const err = browser.runtime.lastError;
    if (port._pending) {
      clearTimeout(port._pending.timer);
      const p = port._pending;
      port._pending = null;
      p.reject(new Error((err && err.message) || 'ارتباط با هستِ محلی قطع شد'));
    }
    if (onUnexpectedDisconnect) onUnexpectedDisconnect();
  });

  return port;
}

function sendToPort(port, message, timeoutMs) {
  return new Promise((resolve, reject) => {
    port._pending = {
      resolve,
      reject,
      timer: setTimeout(() => {
        port._pending = null;
        reject(new Error('پاسخی از هستِ محلی دریافت نشد (timeout) — نصب رو چک کن'));
      }, timeoutMs || NATIVE_TIMEOUT_MS),
    };
    try {
      port.postMessage(message);
    } catch (e) {
      clearTimeout(port._pending.timer);
      port._pending = null;
      reject(e);
    }
  });
}

function closeNativePort() {
  if (nativePort) {
    try {
      nativePort.disconnect();
    } catch (e) {}
    nativePort = null;
  }
}

// --- traffic polling via sing-box's Clash-API-compatible controller ---

async function pollTraffic() {
  try {
    const res = await fetch(`http://127.0.0.1:${C.CLASH_API_PORT}/connections`, {
      headers: { Authorization: `Bearer ${C.CLASH_API_SECRET}` },
    });
    if (!res.ok) return;
    const data = await res.json();
    if (typeof data.uploadTotal === 'number') traffic.up = data.uploadTotal;
    if (typeof data.downloadTotal === 'number') traffic.down = data.downloadTotal;
  } catch (e) {
    // sing-box not up yet, or already stopped — ignore, next tick retries
  }
}

function startTrafficPolling() {
  stopTrafficPolling();
  traffic = { up: 0, down: 0 };
  trafficTimer = setInterval(pollTraffic, TRAFFIC_POLL_MS);
  pollTraffic();
}

function stopTrafficPolling() {
  if (trafficTimer) {
    clearInterval(trafficTimer);
    trafficTimer = null;
  }
}

// --- action (toolbar) icon: blue = disconnected, green = connected ---

function setActionIcon(connected) {
  const suffix = connected ? '-connected' : '';
  const path = {
    16: `icons/icon16${suffix}.png`,
    48: `icons/icon48${suffix}.png`,
    128: `icons/icon128${suffix}.png`,
  };
  const api = browser.action || browser.browserAction;
  if (api && api.setIcon) api.setIcon({ path });
}

// --- public actions, called from the popup ---

async function connect(link) {
  const parsed = V2RayParser.parseLink(link);
  const config = V2RaySingbox.buildConfig(parsed.outbound);

  closeNativePort();
  const port = openHostPort({
    onUnexpectedDisconnect: () => {
      if (port !== nativePort) return; // stale port from a previous session
      nativePort = null;
      if (state === 'running') applyProxyOff();
      state = 'stopped';
      activeName = null;
      lastIPInfo = null;
      lastIPError = null;
      stopTrafficPolling();
      setActionIcon(false);
      browser.storage.local.set({ connected: false, activeName: null });
    },
  });
  nativePort = port;

  let res;
  try {
    res = await sendToPort(port, { action: 'start', config });
  } catch (err) {
    closeNativePort();
    state = 'unreachable';
    setActionIcon(false);
    throw err;
  }

  if (!res || !res.ok) {
    closeNativePort();
    state = 'stopped';
    setActionIcon(false);
    throw new Error((res && res.error) || 'اجرای هسته ناموفق بود');
  }

  await applyProxyOn();
  state = 'running';
  activeName = parsed.name;
  startTrafficPolling();
  setActionIcon(true);
  await browser.storage.local.set({ connected: true, activeName: parsed.name });

  // Auto-check the exit IP right after connecting — fire and forget, so the
  // "connect" call itself doesn't block on it. sing-box needs a brief moment
  // to actually bind its local listener after "start" returns OK, so retry
  // a couple of times with a short delay instead of firing immediately
  // (an immediate attempt is the main reason this used to fail silently).
  lastIPInfo = null;
  lastIPError = null;
  autoCheckIPWithRetry();

  return parsed.name;
}

async function autoCheckIPWithRetry() {
  const delays = [800, 2000, 3500]; // ms before each attempt
  for (const delay of delays) {
    await sleep(delay);
    if (state !== 'running') return; // disconnected while we were waiting
    try {
      lastIPInfo = await fetchIPInfo();
      lastIPError = null;
      return;
    } catch (err) {
      lastIPError = err.message;
      // try again after the next delay
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function disconnect() {
  await applyProxyOff();
  stopTrafficPolling();
  if (nativePort) {
    try {
      await sendToPort(nativePort, { action: 'stop' });
    } catch (e) {}
  }
  closeNativePort();
  state = 'stopped';
  activeName = null;
  lastIPInfo = null;
  lastIPError = null;
  setActionIcon(false);
  await browser.storage.local.set({ connected: false, activeName: null });
}

function getStatus() {
  return { status: state, activeName, traffic, ipInfo: lastIPInfo, ipError: lastIPError };
}

async function fetchIPInfo() {
  if (state !== 'running') {
    throw new Error('اول باید متصل باشی تا آی‌پی خروجی واقعی رو ببینی');
  }

  const providers = [
    { url: 'https://api.ip.sb/geoip', parse: (d) => ({ ip: d.ip, country: d.country, countryCode: d.country_code }) },
    { url: 'https://ipwho.is/', parse: (d) => ({ ip: d.ip, country: d.country, countryCode: d.country_code }) },
    { url: 'https://ipapi.co/json/', parse: (d) => ({ ip: d.ip, country: d.country_name, countryCode: d.country_code }) },
  ];

  let lastErr = null;
  for (const provider of providers) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(provider.url, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) {
        lastErr = new Error(`${provider.url} -> HTTP ${res.status}`);
        continue;
      }
      const data = await res.json();
      const info = provider.parse(data);
      if (info.ip) return info;
      lastErr = new Error(`${provider.url} -> پاسخ ناقص`);
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
    }
  }
  throw new Error('هیچ‌کدوم از سرویس‌های بررسی آی‌پی جواب ندادن' + (lastErr ? `: ${lastErr.message}` : ''));
}

// Runs a candidate config on its own throwaway port/process. `port` lets
// several tests run concurrently on different ports without colliding; it
// never touches the active connection or the real browser proxy setting.
async function testConfig(link, port) {
  const parsed = V2RayParser.parseLink(link);
  const testPort = port || C.TEST_PROXY_PORT;
  const config = V2RaySingbox.buildTestConfig(parsed.outbound, testPort);

  const hostPort = openHostPort();
  try {
    const res = await sendToPort(hostPort, { action: 'test', config, test_port: testPort }, TEST_TIMEOUT_MS);
    if (!res || !res.ok) {
      throw new Error((res && res.error) || 'تست ناموفق بود');
    }
    return { latencyMs: res.latency_ms };
  } finally {
    try {
      hostPort.disconnect();
    } catch (e) {}
  }
}

// Used by the first-run onboarding page to detect whether the native host
// is installed and reachable, independent of whether sing-box is currently
// running. connectNative() itself throws/disconnects immediately (with a
// "not found" style error) if the host isn't registered, so a clean
// "status" round-trip is enough to confirm the installer worked.
function checkNativeHost() {
  return new Promise((resolve) => {
    let settled = false;
    let port;
    try {
      port = openHostPort({
        onUnexpectedDisconnect: () => {
          if (!settled) {
            settled = true;
            resolve(false);
          }
        },
      });
    } catch (e) {
      resolve(false);
      return;
    }
    sendToPort(port, { action: 'status' }, 3000)
      .then((res) => {
        if (!settled) {
          settled = true;
          resolve(!!(res && res.ok));
        }
      })
      .catch(() => {
        if (!settled) {
          settled = true;
          resolve(false);
        }
      })
      .finally(() => {
        try {
          port.disconnect();
        } catch (e) {}
      });
  });
}

// A default subscription seeded on first install (same shape as a
// user-added one, so it shows up in the Subs tab and can be renamed or
// removed exactly like any subscription the user adds themselves).
const DEFAULT_SUBSCRIPTIONS = [
  {
    url: 'https://raw.githubusercontent.com/hamedcode/port-based-v2ray-configs/main/sub/top100.txt',
    name: 'Top 100 (port-based)',
  },
];

async function seedDefaultSubscriptions() {
  const { subscriptions } = await browser.storage.local.get('subscriptions');
  const subs = subscriptions || [];
  const { configs } = await browser.storage.local.get('configs');
  let cfgs = configs || [];
  let changed = false;

  for (const def of DEFAULT_SUBSCRIPTIONS) {
    if (subs.some((s) => s.url === def.url)) continue;
    subs.push({ url: def.url, name: def.name, addedAt: Date.now(), lastUpdated: null, count: 0 });
    changed = true;
    try {
      const res = await fetch(def.url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.text();
      const decoded = V2RayParser.decodeSubscriptionBody(body);
      const lines = decoded
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('//') && !l.startsWith('#'));
      const tagged = [];
      for (const line of lines) {
        try {
          const parsed = V2RayParser.parseLink(line);
          tagged.push({ name: parsed.name, link: line, subId: def.url, addedAt: Date.now() });
        } catch (e) {
          // skip unparsable lines, same as a manual subscription add
        }
      }
      cfgs = cfgs.concat(tagged);
      const idx = subs.findIndex((s) => s.url === def.url);
      subs[idx].count = tagged.length;
      subs[idx].lastUpdated = Date.now();
    } catch (e) {
      // Left at count 0 / lastUpdated null — same state as any subscription
      // whose first fetch failed; the user can hit refresh in the Subs tab.
    }
  }

  if (changed) {
    await browser.storage.local.set({ subscriptions: subs, configs: cfgs });
  }
}

// Opens the onboarding page once, right after the extension is first
// installed (not on browser updates/reloads), so average users get clear
// setup instructions instead of an empty popup with no working proxy.
browser.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    browser.tabs.create({ url: browser.runtime.getURL('onboarding.html') });
    seedDefaultSubscriptions();
  }
});

browser.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      if (msg.type === 'checkNativeHost') {
        const ok = await checkNativeHost();
        sendResponse({ ok });
      } else if (msg.type === 'connect') {
        const name = await connect(msg.link);
        sendResponse({ ok: true, name });
      } else if (msg.type === 'disconnect') {
        await disconnect();
        sendResponse({ ok: true });
      } else if (msg.type === 'status') {
        sendResponse({ ok: true, ...getStatus() });
      } else if (msg.type === 'ipinfo') {
        const info = await fetchIPInfo();
        lastIPInfo = info;
        lastIPError = null;
        sendResponse({ ok: true, info });
      } else if (msg.type === 'test') {
        const result = await testConfig(msg.link, msg.port);
        sendResponse({ ok: true, ...result });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err.message });
    }
  })();
  return true; // keep the message channel open for the async response
});
