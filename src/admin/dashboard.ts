// The admin dashboard: live visitors, visit statistics, an approximate-area map,
// site health, and the latest messages and job opportunities.
import { h, svg, icon, ago, duration } from './dom';
import { area, areaLabel, flag, map, project, type Area } from './geo';
import { healthChecks, deployRuns, type Ctx } from './live';

type Row = Record<string, any>;
const nf = new Intl.NumberFormat('en-GB');
const fmt = (n: number) => nf.format(Math.round(n || 0));

const RANGES = [
  { days: 1, label: '24 hours' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
];

function savedRange(): number {
  try {
    const v = Number(localStorage.getItem('admin:range'));
    return RANGES.some((r) => r.days === v) ? v : 7;
  } catch {
    return 7;
  }
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------
function card(title: string, sub: Node | string | null, ...body: (Node | string)[]): HTMLElement {
  return h('section', { class: 'dash-card' }, h('header', { class: 'dash-card-head' }, h('h2', {}, title), sub ?? ''), ...body);
}

function delta(now: number, before: number, lowerIsBetter = false): HTMLElement | string {
  if (!before && !now) return '';
  if (!before) return h('span', { class: 'delta up' }, 'New');
  const pct = Math.round(((now - before) / before) * 100);
  if (pct === 0) return h('span', { class: 'delta' }, '→ same as before');
  const good = lowerIsBetter ? pct < 0 : pct > 0;
  return h('span', { class: `delta ${good ? 'up' : 'down'}` }, `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`, h('span', { class: 'sr' }, ' compared with the period before'));
}

function kpi(label: string, value: string, ico: string, extra: Node | string = '', id?: string): HTMLElement {
  return h('div', { class: 'kpi', id }, h('span', { class: 'kpi-label' }, icon(ico, 16), label), h('strong', { class: 'kpi-value' }, value), h('span', { class: 'kpi-extra' }, extra));
}

/** Horizontal bars: one series, so a single colour; the number is always printed. */
function bars(items: { name: string; n: number; label?: Node | string; title?: string }[], empty = 'No data yet'): HTMLElement {
  if (!items.length) return h('p', { class: 'muted dash-empty' }, empty);
  const max = Math.max(...items.map((i) => i.n), 1);
  return h(
    'ul',
    { class: 'bars' },
    items.map((i) =>
      h(
        'li',
        { title: i.title ?? `${i.name}: ${fmt(i.n)}` },
        h('span', { class: 'bar-label' }, i.label ?? i.name),
        h('span', { class: 'bar-value' }, fmt(i.n)),
        h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${Math.max(2, (i.n / max) * 100)}%` }))
      )
    )
  );
}

const deviceIcon = (d: string) => (d === 'mobile' ? 'phone' : d === 'tablet' ? 'tablet' : 'monitor');
const prettyPath = (p: string, title?: string) => (title ? title.replace(/\s*\|.*$/, '') : '') || p;

// ---------------------------------------------------------------------------
// Visits chart (views as an area, visitors as a line, one y axis)
// ---------------------------------------------------------------------------
function visitsChart(series: { t: string; views: number; visitors: number }[], hourly: boolean): HTMLElement {
  const wrap = h('div', { class: 'chart' });
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const legend = h(
    'div',
    { class: 'legend' },
    h('span', {}, h('i', { class: 'sw sw-views' }), 'Page views'),
    h('span', {}, h('i', { class: 'sw sw-visitors' }), 'Visitors')
  );
  const plot = h('div', { class: 'chart-plot' });
  wrap.append(legend, plot, tip);

  const label = (t: string, long = false) => {
    const d = new Date(t);
    if (hourly) return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) + (long ? `, ${d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}` : '');
    return d.toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short' });
  };

  const draw = () => {
    const W = Math.max(280, plot.clientWidth);
    const H = 240;
    const m = { t: 12, r: 12, b: 26, l: 40 };
    const iw = W - m.l - m.r;
    const ih = H - m.t - m.b;
    const n = series.length;
    const rawMax = Math.max(1, ...series.map((s) => s.views));
    const step = niceStep(rawMax / 4);
    const yMax = Math.ceil(rawMax / step) * step;
    const x = (i: number) => m.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = (v: number) => m.t + ih - (v / yMax) * ih;

    const root = svg('svg', { width: W, height: H, viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `Page views and visitors over the last ${hourly ? '24 hours' : n + ' days'}` });
    for (let v = 0; v <= yMax; v += step) {
      root.append(svg('line', { x1: m.l, x2: W - m.r, y1: y(v), y2: y(v), class: v === 0 ? 'axis' : 'grid' }));
      root.append(svg('text', { x: m.l - 8, y: y(v) + 4, 'text-anchor': 'end', class: 'tick' }, fmt(v)));
    }
    const every = Math.max(1, Math.ceil(n / Math.floor(iw / 70)));
    series.forEach((s, i) => {
      if (i % every === 0 || i === n - 1) {
        if (i !== n - 1 && n - 1 - i < every * 0.6) return;
        root.append(svg('text', { x: x(i), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle', class: 'tick' }, label(s.t)));
      }
    });
    const line = (key: 'views' | 'visitors') => series.map((s, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(s[key]).toFixed(1)}`).join('');
    if (n) {
      root.append(svg('path', { d: `${line('views')}L${x(n - 1)},${y(0)}L${x(0)},${y(0)}Z`, class: 'area-views' }));
      root.append(svg('path', { d: line('views'), class: 'line-views' }));
      root.append(svg('path', { d: line('visitors'), class: 'line-visitors' }));
    }
    const cross = svg('line', { y1: m.t, y2: m.t + ih, class: 'cross', visibility: 'hidden' });
    const dotV = svg('circle', { r: 4.5, class: 'dot-views', visibility: 'hidden' });
    const dotU = svg('circle', { r: 4.5, class: 'dot-visitors', visibility: 'hidden' });
    root.append(cross, dotV, dotU);
    const hit = svg('rect', { x: m.l, y: m.t, width: iw, height: ih + m.b, fill: 'transparent' });
    root.append(hit);

    const show = (clientX: number) => {
      const r = (root as unknown as Element).getBoundingClientRect();
      const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left - m.l) / iw) * (n - 1))));
      const s = series[i];
      if (!s) return;
      for (const el of [cross, dotV, dotU]) el.setAttribute('visibility', 'visible');
      cross.setAttribute('x1', String(x(i)));
      cross.setAttribute('x2', String(x(i)));
      dotV.setAttribute('cx', String(x(i)));
      dotV.setAttribute('cy', String(y(s.views)));
      dotU.setAttribute('cx', String(x(i)));
      dotU.setAttribute('cy', String(y(s.visitors)));
      tip.replaceChildren(
        h('strong', {}, label(s.t, true)),
        h('span', {}, h('i', { class: 'sw sw-views' }), `Page views ${fmt(s.views)}`),
        h('span', {}, h('i', { class: 'sw sw-visitors' }), `Visitors ${fmt(s.visitors)}`)
      );
      tip.hidden = false;
      const left = x(i) + 14;
      tip.style.left = `${left + 170 > W ? x(i) - 14 - tip.offsetWidth : left}px`;
      tip.style.top = `${legend.offsetHeight + 8}px`;
    };
    const hide = () => {
      for (const el of [cross, dotV, dotU]) el.setAttribute('visibility', 'hidden');
      tip.hidden = true;
    };
    hit.addEventListener('pointermove', (e) => show((e as PointerEvent).clientX));
    hit.addEventListener('pointerdown', (e) => show((e as PointerEvent).clientX));
    hit.addEventListener('pointerleave', hide);
    plot.replaceChildren(root);
  };
  new ResizeObserver(() => draw()).observe(plot);
  requestAnimationFrame(draw);
  return wrap;
}

function niceStep(raw: number): number {
  if (raw <= 1) return 1;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
}

// ---------------------------------------------------------------------------
// Map of approximate areas
// ---------------------------------------------------------------------------
function worldMap(): { el: HTMLElement; paint: (zones: { name: string; n: number }[], live: Row[]) => void } {
  const tip = h('div', { class: 'chart-tip', hidden: true });
  const dots = svg('g', { class: 'map-dots' });
  const liveG = svg('g', { class: 'map-live' });
  const root = svg(
    'svg',
    { viewBox: `0 0 ${map.w} ${map.h}`, class: 'map', role: 'img', 'aria-label': 'World map of visitor areas, worked out from device time zones' },
    svg('path', { d: map.d, class: 'land' }),
    dots,
    liveG
  );
  const el = h('div', { class: 'map-wrap' }, root as unknown as Node, tip);

  const place = (a: Area) => (a.lat === null || a.lon === null ? null : project(a.lon, a.lat));
  const showTip = (e: PointerEvent, text: string) => {
    const r = el.getBoundingClientRect();
    tip.textContent = text;
    tip.hidden = false;
    tip.style.left = `${Math.min(e.clientX - r.left + 12, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = `${e.clientY - r.top + 12}px`;
  };

  const paint = (zones: { name: string; n: number }[], live: Row[]) => {
    const max = Math.max(1, ...zones.map((z) => z.n));
    dots.replaceChildren(
      ...zones
        .map((z) => ({ z, a: area(z.name) }))
        .filter(({ a }) => a.lat !== null)
        .sort((p, q) => q.z.n - p.z.n)
        .map(({ z, a }) => {
          const [cx, cy] = place(a)!;
          const c = svg('circle', { cx: cx.toFixed(1), cy: cy.toFixed(1), r: (3.5 + Math.sqrt(z.n / max) * 14).toFixed(1), class: 'map-dot', tabindex: 0 });
          const text = `${flag(a.cc)} ${areaLabel(a)}: ${fmt(z.n)} visitor${z.n === 1 ? '' : 's'}`;
          c.append(svg('title', {}, text));
          c.addEventListener('pointermove', (e) => showTip(e as PointerEvent, text));
          c.addEventListener('pointerleave', () => (tip.hidden = true));
          return c;
        })
    );
    const byZone = new Map<string, number>();
    for (const v of live) byZone.set(v.timezone, (byZone.get(v.timezone) ?? 0) + 1);
    liveG.replaceChildren(
      ...[...byZone].flatMap(([tz, n]) => {
        const a = area(tz);
        const p = place(a);
        if (!p) return [];
        const text = `${flag(a.cc)} ${areaLabel(a)}: ${n} watching now`;
        const g = svg('g', { transform: `translate(${p[0].toFixed(1)} ${p[1].toFixed(1)})` });
        g.append(svg('circle', { r: 6, class: 'live-ring' }), svg('circle', { r: 5, class: 'live-dot' }), svg('title', {}, text));
        g.addEventListener('pointermove', (e) => showTip(e as PointerEvent, text));
        g.addEventListener('pointerleave', () => (tip.hidden = true));
        return [g];
      })
    );
  };
  return { el, paint };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------
export async function dashboardView(ctx: Ctx): Promise<HTMLElement> {
  const { sb } = ctx;
  let days = savedRange();

  const root = h('div', { class: 'dash' });
  const alive = () => root.isConnected;
  const updated = h('span', { class: 'live-note' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), 'Live');

  const rangeBtns = RANGES.map((r) =>
    h(
      'button',
      {
        type: 'button',
        'aria-pressed': String(r.days === days),
        onclick: () => {
          days = r.days;
          try {
            localStorage.setItem('admin:range', String(days));
          } catch {}
          rangeBtns.forEach((b, i) => b.setAttribute('aria-pressed', String(RANGES[i].days === days)));
          loadStats();
        },
      },
      r.label
    )
  );

  // Slots filled by the loaders below
  const kpis = h('div', { class: 'kpis' });
  const chartSlot = h('div', { class: 'chart-slot' }, h('p', { class: 'muted dash-empty' }, 'Loading…'));
  const mapView = worldMap();
  const areasSlot = h('div', {});
  const countriesSlot = h('div', {});
  const watchingSlot = h('div', {});
  const recentSlot = h('div', {});
  const pagesSlot = h('div', {});
  const sourcesSlot = h('div', {});
  const devicesSlot = h('div', {});
  const browsersSlot = h('div', {});
  const systemsSlot = h('div', {});
  const languagesSlot = h('div', {});
  const healthSlot = h('div', {}, h('p', { class: 'muted dash-empty' }, 'Running checks…'));
  const inboxSlot = h('div', {});
  const contentSlot = h('div', {});
  const watchingCount = h('strong', { class: 'kpi-value' }, '–');
  const todayLine = h('span', { class: 'kpi-extra' }, '');

  let liveRows: Row[] = [];
  let zoneRows: { name: string; n: number }[] = [];

  async function loadStats() {
    const { data, error } = await sb.rpc('dashboard_stats', { p_days: days });
    if (!alive()) return;
    if (error) {
      chartSlot.replaceChildren(h('p', { class: 'error' }, `Statistics are not available: ${error.message}`));
      return;
    }
    const s = data as Row;
    const t = s.totals;
    const p = s.previous;
    kpis.replaceChildren(
      h(
        'div',
        { class: 'kpi kpi-live' },
        h('span', { class: 'kpi-label' }, h('span', { class: 'pulse', 'aria-hidden': 'true' }), 'Watching now'),
        watchingCount,
        todayLine
      ),
      kpi('Visitors', fmt(t.visitors), 'users', delta(t.visitors, p.visitors)),
      kpi('Page views', fmt(t.views), 'eye', delta(t.views, p.views)),
      kpi('Avg. time on page', duration(t.avg_seconds), 'clock', delta(t.avg_seconds, p.avg_seconds)),
      kpi('Pages per visit', t.visitors ? (t.views / t.visitors).toFixed(1) : '0', 'layers', `${t.bounce}% left after one page`)
    );
    chartSlot.replaceChildren(
      t.views ? visitsChart(s.series, s.hourly) : h('p', { class: 'muted dash-empty' }, 'No visits in this period yet. They appear here as soon as people open the published site.')
    );

    zoneRows = s.zones;
    mapView.paint(zoneRows, liveRows);
    const areas = zoneRows.slice(0, 6).map((z) => {
      const a = area(z.name);
      return { name: areaLabel(a), n: z.n, label: h('span', {}, h('span', { class: 'flag', 'aria-hidden': 'true' }, flag(a.cc)), areaLabel(a)) };
    });
    areasSlot.replaceChildren(bars(areas, 'No visitors yet.'));
    const byCountry = new Map<string, { n: number; cc: string; name: string }>();
    for (const z of zoneRows) {
      const a = area(z.name);
      const k = a.cc || 'unknown';
      const c = byCountry.get(k) ?? { n: 0, cc: a.cc, name: a.country };
      c.n += z.n;
      byCountry.set(k, c);
    }
    countriesSlot.replaceChildren(
      bars(
        [...byCountry.values()]
          .sort((a, b) => b.n - a.n)
          .slice(0, 6)
          .map((c) => ({ name: c.name, n: c.n, label: h('span', {}, h('span', { class: 'flag', 'aria-hidden': 'true' }, flag(c.cc)), c.name) })),
        'No visitors yet.'
      )
    );

    pagesSlot.replaceChildren(
      s.pages.length
        ? h(
            'table',
            { class: 'dash-table' },
            h('thead', {}, h('tr', {}, h('th', {}, 'Page'), h('th', {}, 'Views'), h('th', {}, 'Visitors'), h('th', {}, 'Avg. time'))),
            h(
              'tbody',
              {},
              s.pages.map((r: Row) =>
                h(
                  'tr',
                  {},
                  h('td', {}, h('a', { href: ctx.site(r.path), target: '_blank', rel: 'noopener' }, prettyPath(r.path, r.title)), h('span', { class: 'path' }, r.path)),
                  h('td', {}, fmt(r.views)),
                  h('td', {}, fmt(r.visitors)),
                  h('td', {}, duration(r.avg_seconds))
                )
              )
            )
          )
        : h('p', { class: 'muted dash-empty' }, 'No page views yet.')
    );
    sourcesSlot.replaceChildren(bars(s.referrers.map((r: Row) => ({ name: r.name, n: r.n })), 'No visitors yet.'));
    devicesSlot.replaceChildren(
      bars(s.devices.map((r: Row) => ({ name: r.name, n: r.n, label: h('span', {}, icon(deviceIcon(r.name), 14), ' ', r.name[0].toUpperCase() + r.name.slice(1)) })))
    );
    browsersSlot.replaceChildren(bars(s.browsers.map((r: Row) => ({ name: r.name, n: r.n }))));
    systemsSlot.replaceChildren(bars(s.systems.map((r: Row) => ({ name: r.name, n: r.n }))));
    let langNames: Intl.DisplayNames | null = null;
    try {
      langNames = new Intl.DisplayNames(['en-GB'], { type: 'language' });
    } catch {}
    languagesSlot.replaceChildren(
      bars(
        s.languages.map((r: Row) => {
          let name = r.name;
          try {
            name = r.name === 'unknown' ? 'Unknown' : langNames?.of(r.name) ?? r.name;
          } catch {}
          return { name, n: r.n };
        })
      )
    );
  }

  async function loadLive() {
    const { data, error } = await sb.rpc('dashboard_live');
    if (!alive() || error) return;
    const d = data as Row;
    liveRows = d.watching;
    watchingCount.textContent = fmt(liveRows.length);
    todayLine.textContent = `Today: ${fmt(d.today.visitors)} visitor${d.today.visitors === 1 ? '' : 's'}, ${fmt(d.today.views)} views`;
    mapView.paint(zoneRows, liveRows);
    const serverNow = new Date(d.now).getTime();
    watchingSlot.replaceChildren(
      liveRows.length
        ? h(
            'ul',
            { class: 'feed' },
            liveRows.map((v) => {
              const a = area(v.timezone);
              return h(
                'li',
                {},
                h('span', { class: 'feed-ico live' }, icon(deviceIcon(v.device), 16)),
                h(
                  'span',
                  { class: 'feed-main' },
                  h('a', { href: ctx.site(v.path), target: '_blank', rel: 'noopener' }, prettyPath(v.path, v.title)),
                  h('span', { class: 'muted' }, `${flag(a.cc)} ${areaLabel(a)} · ${v.browser || 'Browser'} on ${v.os || 'device'}${v.referrer ? ' · from ' + v.referrer : ''}`)
                ),
                h('span', { class: 'feed-time' }, `on page ${duration((serverNow - new Date(v.created_at).getTime()) / 1000)}`)
              );
            })
          )
        : h('p', { class: 'muted dash-empty' }, 'Nobody is on the site right now.')
    );
    recentSlot.replaceChildren(
      d.recent.length
        ? h(
            'ul',
            { class: 'feed' },
            d.recent.slice(0, 12).map((v: Row) => {
              const a = area(v.timezone);
              return h(
                'li',
                {},
                h('span', { class: 'feed-ico' }, h('span', { class: 'flag', 'aria-hidden': 'true' }, flag(a.cc))),
                h(
                  'span',
                  { class: 'feed-main' },
                  h('span', {}, prettyPath(v.path, v.title)),
                  h('span', { class: 'muted' }, `${areaLabel(a)} · ${v.device || 'device'}${v.duration_s ? ' · ' + duration(v.duration_s) : ''}${v.referrer ? ' · from ' + v.referrer : ''}`)
                ),
                h('time', { class: 'feed-time', datetime: v.created_at }, ago(v.created_at, serverNow))
              );
            })
          )
        : h('p', { class: 'muted dash-empty' }, 'No visits yet.')
    );
    updated.lastChild!.textContent = `Live · updated ${new Date().toLocaleTimeString('en-GB')}`;
  }

  const healthIcon = { ok: 'check', info: 'info', warning: 'alert', error: 'x' } as const;
  const healthWord = { ok: 'OK', info: 'Note', warning: 'Needs attention', error: 'Problem' } as const;
  async function loadHealth() {
    const checks = await healthChecks(ctx);
    if (!alive()) return;
    const bad = checks.filter((c) => c.level === 'error' || c.level === 'warning').length;
    healthSlot.replaceChildren(
      h('p', { class: `health-summary ${bad ? 'warn' : 'ok'}` }, icon(bad ? 'alert' : 'heart', 18), bad ? `${bad} thing${bad > 1 ? 's' : ''} need${bad > 1 ? '' : 's'} attention` : 'All systems healthy'),
      h(
        'ul',
        { class: 'health' },
        checks.map((c) =>
          h(
            'li',
            { class: `health-${c.level}` },
            h('span', { class: 'health-ico' }, icon(healthIcon[c.level], 15), h('span', { class: 'sr' }, healthWord[c.level])),
            h('span', { class: 'feed-main' }, h('strong', {}, c.title), h('span', { class: 'muted' }, c.detail)),
            c.link
              ? /^https?:/.test(c.link)
                ? h('a', { class: 'link-btn small', href: c.link, target: '_blank', rel: 'noopener' }, 'Open')
                : h('a', { class: 'link-btn small', href: c.link }, 'Fix')
              : ''
          )
        )
      )
    );
  }

  async function loadInbox() {
    const [m, o] = await Promise.all([
      sb.from('messages').select('id,name,subject,body,is_read,created_at').order('created_at', { ascending: false }).limit(4),
      sb.from('opportunities').select('id,company,role_title,job_type,work_mode,status,created_at').order('created_at', { ascending: false }).limit(4),
    ]);
    if (!alive()) return;
    const items = [
      ...(o.data ?? []).map((r: Row) => ({
        at: r.created_at,
        node: h(
          'li',
          { class: r.status === 'new' ? 'unread' : '' },
          h('span', { class: 'feed-ico opp' }, icon('briefcase', 16)),
          h('a', { class: 'feed-main', href: '#/opportunities' }, h('strong', {}, `${r.company}: ${r.role_title}`), h('span', { class: 'muted' }, `${r.job_type} · ${r.work_mode} · ${r.status}`)),
          h('time', { class: 'feed-time', datetime: r.created_at }, ago(r.created_at))
        ),
      })),
      ...(m.data ?? []).map((r: Row) => ({
        at: r.created_at,
        node: h(
          'li',
          { class: r.is_read ? '' : 'unread' },
          h('span', { class: 'feed-ico' }, icon('mail', 16)),
          h('a', { class: 'feed-main', href: '#/messages' }, h('strong', {}, r.name), h('span', { class: 'muted' }, r.subject || r.body.slice(0, 90))),
          h('time', { class: 'feed-time', datetime: r.created_at }, ago(r.created_at))
        ),
      })),
    ].sort((a, b) => (a.at < b.at ? 1 : -1));
    inboxSlot.replaceChildren(items.length ? h('ul', { class: 'feed' }, items.slice(0, 6).map((i) => i.node)) : h('p', { class: 'muted dash-empty' }, 'No messages or job opportunities yet.'));
  }

  async function loadContent() {
    const tables = [
      ['projects', 'Projects', '#/projects'],
      ['posts', 'Blog posts', '#/posts'],
      ['services', 'Services', '#/services'],
      ['certifications', 'Certifications', '#/certifications'],
      ['skills', 'Skills', '#/skills'],
      ['timeline', 'Experience', '#/timeline'],
    ] as const;
    const res = await Promise.all(tables.map(([t]) => sb.from(t).select('published')));
    const runs = await deployRuns(ctx);
    if (!alive()) return;
    const last = runs?.[0];
    contentSlot.replaceChildren(
      h(
        'ul',
        { class: 'content-grid' },
        tables.map(([, label, href], i) => {
          const rows = res[i].data ?? [];
          const live = rows.filter((r: Row) => r.published).length;
          return h('li', {}, h('a', { href }, h('strong', {}, fmt(live)), h('span', {}, label), rows.length > live ? h('span', { class: 'muted' }, `${rows.length - live} hidden`) : ''));
        })
      ),
      last
        ? h(
            'p',
            { class: 'muted deploy-line' },
            icon('rocket', 14),
            ` Last deploy: ${last.status !== 'completed' ? 'in progress' : last.conclusion === 'success' ? 'succeeded' : last.conclusion} ${ago(last.updated_at)}. `,
            h('a', { href: last.html_url, target: '_blank', rel: 'noopener' }, 'Details')
          )
        : ''
    );
  }

  // Welcome, to-do list and quick actions
  const hello = h('h1', { tabindex: -1 }, 'Dashboard');
  const todoSlot = h('div', { class: 'todo' });
  const writerSlot = h('div', {}, h('p', { class: 'muted dash-empty' }, 'Loading…'));
  async function loadWelcome() {
    const [prof, drafts, msgs, opps, state, topics, run] = await Promise.all([
      sb.from('profile').select('short_name,name').eq('id', 1).maybeSingle(),
      sb.from('posts').select('id,title,created_at').eq('ai_generated', true).eq('published', false).order('created_at', { ascending: false }),
      sb.from('messages').select('id', { count: 'exact', head: true }).eq('is_read', false),
      sb.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'new'),
      sb.from('site_state').select('*').eq('id', 1).maybeSingle(),
      sb.from('trend_topics').select('keyword,relevance,source,status').in('status', ['new', 'queued']).order('relevance', { ascending: false }).limit(5),
      sb.from('agent_runs').select('status,started_at,summary').order('started_at', { ascending: false }).limit(1),
    ]);
    if (!alive()) return;
    const first = (prof.data?.short_name || prof.data?.name || '').split(' ')[0];
    const hr = new Date().getHours();
    const part = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
    hello.textContent = first ? `${part}, ${first}` : 'Dashboard';
    const st = state.data;
    const unpublished = st && (!st.last_published_at || new Date(st.content_changed_at) > new Date(st.last_published_at));
    const items: [number | boolean, string, string, string][] = [
      [drafts.data?.length ?? 0, 'edit', `${drafts.data?.length} AI article draft${drafts.data?.length === 1 ? '' : 's'} to review`, '#/writer'],
      [opps.count ?? 0, 'briefcase', `${opps.count} new job opportunit${opps.count === 1 ? 'y' : 'ies'}`, '#/opportunities'],
      [msgs.count ?? 0, 'mail', `${msgs.count} unread message${msgs.count === 1 ? '' : 's'}`, '#/messages'],
      [Boolean(unpublished), 'upload', 'Changes waiting to be published', '#/dashboard'],
    ];
    const open = items.filter(([n]) => n);
    todoSlot.replaceChildren(
      h('h2', { class: 'todo-title' }, open.length ? 'Needs you' : 'All caught up'),
      open.length
        ? h('ul', {}, open.map(([, ic, text, href]) => h('li', {}, h('a', { href }, icon(ic, 16), text, h('span', { 'aria-hidden': 'true' }, '→')))))
        : h('p', { class: 'muted' }, 'No drafts, messages or job offers waiting. Nice work.'),
      h(
        'div',
        { class: 'quick' },
        h('a', { class: 'btn btn-sm', href: '#/projects/new' }, '+ New project'),
        h('a', { class: 'btn btn-quiet btn-sm', href: '#/posts/new' }, '+ New blog post'),
        h('a', { class: 'btn btn-quiet btn-sm', href: '#/writer' }, icon('edit', 14), ' AI writer'),
        h('a', { class: 'btn btn-quiet btn-sm', href: '#/text' }, 'Site text & settings'),
        h('a', { class: 'btn btn-quiet btn-sm', href: ctx.site('/'), target: '_blank', rel: 'noopener' }, 'View site')
      )
    );
    const last = run.data?.[0];
    writerSlot.replaceChildren(
      h(
        'p',
        { class: 'small muted writer-line' },
        last ? `Last run ${ago(last.started_at)}: ${last.status === 'ok' ? 'finished' : last.status}.` : 'Not set up yet: open the AI writer to connect it.'
      ),
      topics.error || !topics.data?.length
        ? h('p', { class: 'muted dash-empty' }, 'No trending topics yet.')
        : bars(
            topics.data.map((x: Row) => ({ name: x.keyword, n: x.relevance, label: h('span', {}, x.status === 'queued' ? '★ ' : '', x.keyword), title: `${x.keyword}: relevance ${x.relevance}/100` }))
          ),
      h('a', { class: 'link-btn small', href: '#/writer' }, drafts.data?.length ? `Review ${drafts.data.length} draft${drafts.data.length === 1 ? '' : 's'}` : 'Open the AI writer')
    );
  }

  root.append(
    h(
      'div',
      { class: 'view-head' },
      h('div', {}, hello, h('p', { class: 'muted dash-sub' }, new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }), ' · ', updated)),
      h('div', { class: 'seg', role: 'group', 'aria-label': 'Time period' }, rangeBtns)
    ),
    todoSlot,
    kpis,
    h(
      'div',
      { class: 'dash-grid' },
      h('div', { class: 'span-2' }, card('Visits', null, chartSlot)),
      card('On the site now', null, watchingSlot),
      h(
        'div',
        { class: 'span-2' },
        card(
          'Where visitors are',
          h('span', { class: 'muted small' }, 'Approximate, from device time zones'),
          mapView.el,
          h('div', { class: 'map-lists' }, h('div', {}, h('h3', {}, 'Top areas'), areasSlot), h('div', {}, h('h3', {}, 'Countries'), countriesSlot))
        )
      ),
      card('Latest visits', null, recentSlot),
      card('Site health', h('button', { class: 'link-btn small', type: 'button', onclick: () => loadHealth() }, 'Check again'), healthSlot),
      card('Inbox', h('a', { class: 'link-btn small', href: '#/opportunities' }, 'Opportunities'), inboxSlot),
      card('AI writer: top topics', h('span', { class: 'muted small' }, 'Relevance /100'), writerSlot),
      h('div', { class: 'span-2' }, card('Top pages', null, pagesSlot)),
      card('Where they came from', null, sourcesSlot),
      card('Devices', null, devicesSlot),
      card('Browsers', null, browsersSlot),
      card('Systems and languages', null, systemsSlot, h('h3', {}, 'Languages'), languagesSlot),
      card('Content', h('span', { class: 'muted small' }, 'Published items'), contentSlot)
    )
  );

  loadWelcome();
  loadStats();
  loadLive();
  loadHealth();
  loadInbox();
  loadContent();

  // Live updates: realtime events plus a steady poll as a fallback.
  let pending = 0;
  const onChange = (e: Event) => {
    if (!alive()) return window.removeEventListener('admin:change', onChange);
    const table = (e as CustomEvent).detail.table;
    if (table === 'page_views') {
      clearTimeout(pending);
      pending = window.setTimeout(() => {
        loadLive();
        loadStats();
      }, 1200);
    } else if (table === 'messages' || table === 'opportunities') {
      loadInbox();
      loadWelcome();
    } else if (table === 'agent_runs' || table === 'notifications') loadWelcome();
  };
  window.addEventListener('admin:change', onChange);
  let ticks = 0;
  const timer = setInterval(() => {
    if (!alive()) return clearInterval(timer);
    if (document.visibilityState !== 'visible') return;
    ticks++;
    loadLive();
    if (ticks % 6 === 0) loadStats();
  }, 10000);

  return root;
}
