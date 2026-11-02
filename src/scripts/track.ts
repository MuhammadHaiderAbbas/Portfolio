// Cookie-free visit counter for the admin dashboard.
// Records the page, where the visitor came from, device type and time zone
// (for an approximate area). No cookies, no IP address, no exact location.
// Skipped for Do Not Track / Global Privacy Control, bots, the admin panel
// and the site owner's own browser (marked when signing in to the admin).

const cfg = document.body.dataset;
const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
const ua = navigator.userAgent;

function allowed(): boolean {
  if (!cfg.sbUrl || !cfg.sbKey || cfg.track !== 'on') return false;
  if (nav.doNotTrack === '1' || nav.globalPrivacyControl === true) return false;
  if (navigator.webdriver && !new URLSearchParams(location.search).has('track-test')) return false;
  if (/bot|crawl|spider|slurp|preview|headless|lighthouse|facebookexternalhit|embedly/i.test(ua)) return false;
  if (/\/admin(\/|$)/.test(location.pathname)) return false;
  try {
    if (localStorage.getItem('portfolio:no-track') === '1') return false;
  } catch {}
  return true;
}

function uuid(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64;
  b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function session(): string {
  try {
    let id = sessionStorage.getItem('portfolio:visit');
    if (!id) {
      id = uuid().replace(/-/g, '').slice(0, 20);
      sessionStorage.setItem('portfolio:visit', id);
    }
    return id;
  } catch {
    return uuid().replace(/-/g, '').slice(0, 20);
  }
}

function device(): string {
  if (/iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua))) return 'tablet';
  if (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) return 'tablet';
  if (/Mobi|iPhone|iPod|Android/i.test(ua)) return 'mobile';
  return 'desktop';
}

function browser(): string {
  const rules: [RegExp, string][] = [
    [/Edg(e|A|iOS)?\//, 'Edge'],
    [/OPR\/|Opera/, 'Opera'],
    [/SamsungBrowser/, 'Samsung Internet'],
    [/Firefox|FxiOS/, 'Firefox'],
    [/Chrome|CriOS|Chromium/, 'Chrome'],
    [/Safari/, 'Safari'],
  ];
  return rules.find(([re]) => re.test(ua))?.[1] ?? 'Other';
}

function os(): string {
  const rules: [RegExp, string][] = [
    [/Windows/, 'Windows'],
    [/iPhone|iPad|iPod/, 'iOS'],
    [/Macintosh/, navigator.maxTouchPoints > 1 ? 'iPadOS' : 'macOS'],
    [/Android/, 'Android'],
    [/CrOS/, 'ChromeOS'],
    [/Linux/, 'Linux'],
  ];
  return rules.find(([re]) => re.test(ua))?.[1] ?? 'Other';
}

function referrer(): string {
  const utm = new URLSearchParams(location.search).get('utm_source') || new URLSearchParams(location.search).get('ref');
  if (utm) return utm.toLowerCase().slice(0, 200);
  try {
    if (!document.referrer) return '';
    const host = new URL(document.referrer).hostname.replace(/^www\./, '');
    return host === location.hostname.replace(/^www\./, '') ? '' : host.slice(0, 200);
  } catch {
    return '';
  }
}

// Path without the site's base folder (e.g. /Portfolio), always ending in a slash.
function pagePath(): string {
  const base = (cfg.base || '').replace(/\/$/, '');
  let p = location.pathname;
  if (base && p.startsWith(base)) p = p.slice(base.length) || '/';
  if (!p.endsWith('/') && !/\.\w+$/.test(p)) p += '/';
  return p.slice(0, 300);
}

if (allowed()) {
  const base = cfg.sbUrl!.replace(/\/$/, '') + '/rest/v1';
  const headers = { apikey: cfg.sbKey!, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  const id = uuid();
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {}

  const view = {
    id,
    session_id: session(),
    path: pagePath(),
    title: document.title.slice(0, 200),
    referrer: referrer(),
    timezone: tz.slice(0, 64),
    device: device(),
    browser: browser(),
    os: os(),
    language: (navigator.language || '').slice(0, 20),
    screen: `${screen.width}x${screen.height}`.slice(0, 20),
  };

  let visible = document.visibilityState === 'visible' ? 1 : 0;
  let seconds = 0;
  let lastTick = performance.now();
  let started = false;

  const tick = () => {
    const now = performance.now();
    if (visible) seconds += (now - lastTick) / 1000;
    lastTick = now;
  };
  const ping = (keepalive = false) => {
    if (!started) return;
    tick();
    fetch(`${base}/rpc/view_ping`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ p_id: id, p_seconds: Math.round(seconds) }),
      keepalive,
    }).catch(() => {});
  };

  fetch(`${base}/page_views`, { method: 'POST', headers, body: JSON.stringify(view), keepalive: true })
    .then((r) => {
      started = r.ok;
    })
    .catch(() => {});

  // Heartbeat while the page is on screen: drives "now watching" and time on page.
  setInterval(() => {
    if (document.visibilityState === 'visible') ping();
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    tick();
    visible = document.visibilityState === 'visible' ? 1 : 0;
    ping(!visible);
  });
  addEventListener('pagehide', () => ping(true));
}
