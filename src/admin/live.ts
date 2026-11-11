// Live parts of the admin panel that are always on screen:
// the Messages button and notification bell in the top bar, realtime updates,
// the GitHub deploy watcher and the site health checks.
import type { SupabaseClient } from '@supabase/supabase-js';
import { h, icon, ago } from './dom';

type Row = Record<string, any>;

export interface Ctx {
  sb: SupabaseClient;
  toast: (message: string, kind?: 'ok' | 'error') => void;
  site: (path: string) => string;
  repo: string;
  /** Turns a notification link such as "#projects" into an admin route. */
  route: (link: string) => string;
}

/** Fired on window whenever something changes; views listen to refresh themselves. */
export const changed = (table: string, row?: Row) =>
  window.dispatchEvent(new CustomEvent('admin:change', { detail: { table, row } }));

// ---------------------------------------------------------------------------
// Badge counts
// ---------------------------------------------------------------------------
export const counts = { messages: 0, notifications: 0, opportunities: 0, evaluations: 0, drafts: 0 };

function paintBadges() {
  for (const [id, n] of [
    ['badge-messages', counts.messages],
    ['badge-messages-side', counts.messages],
    ['badge-bell', counts.notifications],
    ['badge-opps-side', counts.opportunities],
    ['badge-evals-side', counts.evaluations],
    ['badge-drafts-side', counts.drafts],
  ] as const) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.textContent = n > 99 ? '99+' : n ? String(n) : '';
    el.hidden = !n;
  }
  const bell = document.getElementById('bell-btn');
  bell?.setAttribute('aria-label', counts.notifications ? `Notifications, ${counts.notifications} unread` : 'Notifications');
  const mail = document.getElementById('mail-btn');
  mail?.setAttribute('aria-label', counts.messages ? `Messages, ${counts.messages} unread` : 'Messages');
  document.title = (counts.notifications ? `(${counts.notifications}) ` : '') + 'Site admin';
}

export async function refreshCounts(ctx: Ctx) {
  const [m, n, o, d, e] = await Promise.all([
    ctx.sb.from('messages').select('id', { count: 'exact', head: true }).eq('is_read', false),
    ctx.sb.from('notifications').select('id', { count: 'exact', head: true }).eq('is_read', false),
    ctx.sb.from('opportunities').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    ctx.sb.from('posts').select('id', { count: 'exact', head: true }).eq('ai_generated', true).eq('published', false),
    ctx.sb.from('adaptive_ids_evaluation_requests').select('id', { count: 'exact', head: true }).eq('status', 'new'),
  ]);
  counts.messages = m.count ?? 0;
  counts.notifications = n.count ?? 0;
  counts.opportunities = o.count ?? 0;
  counts.drafts = d.error ? 0 : d.count ?? 0;
  counts.evaluations = e.error ? 0 : e.count ?? 0;
  paintBadges();
}

// ---------------------------------------------------------------------------
// Top bar: Messages button, notification bell, profile
// ---------------------------------------------------------------------------
const kindIcon: Record<string, string> = {
  message: 'mail',
  opportunity: 'briefcase',
  evaluation: 'shield',
  publish: 'upload',
  deploy: 'rocket',
  content: 'edit',
  health: 'alert',
  info: 'info',
};

let panelOpen = false;

export function topbarWidgets(ctx: Ctx, email: string, onSignOut: () => void): HTMLElement {
  const mail = h(
    'a',
    { class: 'tb-btn', id: 'mail-btn', href: '#/messages', title: 'Messages' },
    icon('mail', 20),
    h('span', { class: 'tb-badge', id: 'badge-messages', hidden: !counts.messages }, counts.messages || '')
  );

  const list = h('ul', { class: 'notif-list' });
  const panel = h(
    'div',
    { class: 'notif-panel', id: 'notif-panel', role: 'dialog', 'aria-label': 'Notifications', hidden: true },
    h(
      'div',
      { class: 'notif-head' },
      h('strong', {}, 'Notifications'),
      h(
        'button',
        {
          class: 'link-btn small',
          type: 'button',
          onclick: async () => {
            const { error } = await ctx.sb.from('notifications').update({ is_read: true }).eq('is_read', false);
            if (error) return ctx.toast(`Could not update: ${error.message}`, 'error');
            counts.notifications = 0;
            paintBadges();
            fill();
          },
        },
        'Mark all as read'
      )
    ),
    list
  );

  async function fill() {
    list.replaceChildren(h('li', { class: 'notif-empty' }, 'Loading…'));
    const { data, error } = await ctx.sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(30);
    if (error) return list.replaceChildren(h('li', { class: 'notif-empty error' }, error.message));
    if (!data?.length) return list.replaceChildren(h('li', { class: 'notif-empty' }, 'Nothing yet. New messages, job offers, Adaptive IDS enquiries, publishes and site problems appear here.'));
    list.replaceChildren(
      ...data.map((n: Row) => {
        const external = /^https?:\/\//.test(n.link);
        const open = async () => {
          if (!n.is_read) {
            await ctx.sb.from('notifications').update({ is_read: true }).eq('id', n.id);
            counts.notifications = Math.max(0, counts.notifications - 1);
            paintBadges();
          }
          close();
          if (external) window.open(n.link, '_blank', 'noopener');
          else if (n.link) location.hash = ctx.route(n.link);
        };
        return h(
          'li',
          { class: `notif notif-${n.level}${n.is_read ? '' : ' unread'}` },
          h(
            'button',
            { type: 'button', onclick: open },
            h('span', { class: 'notif-ico' }, icon(kindIcon[n.kind] ?? 'info', 16)),
            h(
              'span',
              { class: 'notif-text' },
              h('span', { class: 'notif-title' }, n.title),
              n.body ? h('span', { class: 'notif-body' }, n.body) : '',
              h('time', { datetime: n.created_at }, ago(n.created_at))
            ),
            n.is_read ? '' : h('span', { class: 'notif-dot', 'aria-label': 'Unread' })
          )
        );
      })
    );
  }

  const close = () => {
    panelOpen = false;
    panel.hidden = true;
    bell.setAttribute('aria-expanded', 'false');
  };
  const bell = h(
    'button',
    {
      class: 'tb-btn',
      id: 'bell-btn',
      type: 'button',
      title: 'Notifications',
      'aria-haspopup': 'dialog',
      'aria-expanded': 'false',
      'aria-controls': 'notif-panel',
      onclick: (e: Event) => {
        e.stopPropagation();
        panelOpen = !panelOpen;
        panel.hidden = !panelOpen;
        bell.setAttribute('aria-expanded', String(panelOpen));
        if (panelOpen) fill();
      },
    },
    icon('bell', 20),
    h('span', { class: 'tb-badge', id: 'badge-bell', hidden: !counts.notifications }, counts.notifications || '')
  );
  document.addEventListener('click', (e) => {
    if (panelOpen && !panel.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (panelOpen && e.key === 'Escape') {
      close();
      bell.focus();
    }
  });
  window.addEventListener('admin:change', (e) => {
    if ((e as CustomEvent).detail.table === 'notifications' && panelOpen) fill();
  });

  const initial = (email[0] || 'A').toUpperCase();
  const profile = h(
    'div',
    { class: 'tb-profile' },
    h('span', { class: 'avatar', 'aria-hidden': 'true' }, initial),
    h('span', { class: 'muted who' }, email),
    h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: onSignOut }, 'Sign out')
  );

  return h(
    'div',
    { class: 'topbar-actions' },
    h('a', { class: 'tb-link', href: ctx.site('/'), target: '_blank', rel: 'noopener' }, 'View site'),
    mail,
    h('div', { class: 'tb-bell' }, bell, panel),
    profile
  );
}

// ---------------------------------------------------------------------------
// Realtime + polling
// ---------------------------------------------------------------------------
let started = false;

export function startLive(ctx: Ctx) {
  if (started) return;
  started = true;
  // The site owner's own visits are not counted in the statistics.
  try {
    localStorage.setItem('portfolio:no-track', '1');
  } catch {}

  const quiet = new Set(['content', 'publish']); // caused by you, so no pop-up
  ctx.sb
    .channel('admin-live')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, (p) => {
      const n = p.new as Row;
      counts.notifications++;
      paintBadges();
      if (!quiet.has(n.kind)) ctx.toast(n.title, n.level === 'error' ? 'error' : 'ok');
      changed('notifications', n);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, (p) => {
      refreshCounts(ctx);
      changed('messages', p.new as Row);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'opportunities' }, (p) => {
      refreshCounts(ctx);
      changed('opportunities', p.new as Row);
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'adaptive_ids_evaluation_requests' }, (p) => {
      refreshCounts(ctx);
      changed('adaptive_ids_evaluation_requests', p.new as Row);
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'page_views' }, (p) => changed('page_views', p.new as Row))
    .on('postgres_changes', { event: '*', schema: 'public', table: 'agent_runs' }, (p) => {
      refreshCounts(ctx);
      changed('agent_runs', p.new as Row);
    })
    .subscribe();

  refreshCounts(ctx);
  setInterval(() => document.visibilityState === 'visible' && refreshCounts(ctx), 30000);

  // Deploys: check GitHub now and then, and often right after a publish.
  let fastUntil = 0;
  let next = 0;
  window.addEventListener('admin:published', () => {
    fastUntil = Date.now() + 5 * 60_000;
    next = Date.now() + 20_000;
  });
  const loop = async () => {
    if (Date.now() >= next && document.visibilityState === 'visible') {
      next = Date.now() + (Date.now() < fastUntil ? 20_000 : 180_000);
      await watchDeploys(ctx);
    }
    setTimeout(loop, 5000);
  };
  loop();

  // Health checks once per sign-in session; problems become notifications.
  try {
    if (!sessionStorage.getItem('admin:health-run')) {
      sessionStorage.setItem('admin:health-run', '1');
      setTimeout(() => healthChecks(ctx, true), 4000);
    }
  } catch {
    setTimeout(() => healthChecks(ctx, true), 4000);
  }
}

// ---------------------------------------------------------------------------
// GitHub deploys (public repository: no token needed for reading)
// ---------------------------------------------------------------------------
export interface Run {
  id: number;
  status: string;
  conclusion: string | null;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  html_url: string;
  event: string;
  head_commit?: { message?: string };
}

let runsCache: { at: number; runs: Run[] | null } = { at: 0, runs: null };

export async function deployRuns(ctx: Ctx, maxAge = 15000): Promise<Run[] | null> {
  if (!ctx.repo) return null;
  if (runsCache.runs && Date.now() - runsCache.at < maxAge) return runsCache.runs;
  try {
    const res = await fetch(`https://api.github.com/repos/${ctx.repo}/actions/workflows/deploy.yml/runs?per_page=6`, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return runsCache.runs;
    const json = await res.json();
    runsCache = { at: Date.now(), runs: json.workflow_runs ?? [] };
    return runsCache.runs;
  } catch {
    return runsCache.runs;
  }
}

const why = (r: Run) =>
  r.event === 'repository_dispatch' ? 'after you pressed Publish' : r.event === 'push' ? 'after a code update' : r.event === 'schedule' ? 'nightly refresh' : 'started by hand';

async function watchDeploys(ctx: Ctx) {
  const runs = await deployRuns(ctx, 0);
  if (!runs) return;
  const rows = runs
    .filter((r) => r.status === 'completed' && Date.now() - new Date(r.updated_at).getTime() < 24 * 3600_000)
    // Only the newest finished run, plus any failures: one notification per publish, not a backlog.
    .filter((r, i) => i === 0 || r.conclusion !== 'success')
    .map((r) => {
      const ok = r.conclusion === 'success';
      const secs = Math.round((new Date(r.updated_at).getTime() - new Date(r.run_started_at || r.created_at).getTime()) / 1000);
      return {
        kind: 'deploy',
        level: ok ? 'success' : r.conclusion === 'cancelled' ? 'warning' : 'error',
        title: ok ? 'Site is live with the latest content' : `Deploy ${r.conclusion === 'cancelled' ? 'cancelled' : 'failed'}`,
        body: ok
          ? `Rebuilt in ${secs}s (${why(r)}).`
          : `The rebuild ${why(r)} did not finish, so the live site still shows the previous version. Open the run to see why.`,
        link: r.html_url,
        dedupe_key: `deploy:${r.id}`,
      };
    });
  if (rows.length) await ctx.sb.from('notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
}

// ---------------------------------------------------------------------------
// Site health
// ---------------------------------------------------------------------------
export interface Check {
  id: string;
  level: 'ok' | 'info' | 'warning' | 'error';
  title: string;
  detail: string;
  link?: string;
}

export async function healthChecks(ctx: Ctx, notify = false): Promise<Check[]> {
  const out: Check[] = [];
  const add = (c: Check) => out.push(c);
  const { sb } = ctx;

  // 1. Live site answers
  const t0 = performance.now();
  try {
    const res = await fetch(ctx.site('/'), { cache: 'no-store' });
    const ms = Math.round(performance.now() - t0);
    add(
      res.ok
        ? { id: 'site', level: ms > 3000 ? 'warning' : 'ok', title: 'Website is online', detail: `Homepage answered in ${ms} ms.` }
        : { id: 'site', level: 'error', title: 'Website is not answering properly', detail: `The homepage returned error ${res.status}.` }
    );
  } catch {
    add({ id: 'site', level: 'error', title: 'Website could not be reached', detail: 'The homepage did not load from here.' });
  }

  // 2. Database
  const t1 = performance.now();
  const [state, profile, projects, services, posts, msgs, opps, views, evals] = await Promise.all([
    sb.from('site_state').select('*').eq('id', 1).maybeSingle(),
    sb.from('profile').select('photo_url,cv_url,email,intro').eq('id', 1).maybeSingle(),
    sb.from('projects').select('slug,title,cover_url,summary,published'),
    sb.from('services').select('title,price_label,published'),
    sb.from('posts').select('title,cover_url,excerpt,published'),
    sb.from('messages').select('created_at').eq('is_read', false).order('created_at').limit(1),
    sb.from('opportunities').select('created_at').eq('status', 'new').order('created_at').limit(1),
    sb.from('page_views').select('created_at').order('created_at', { ascending: false }).limit(1),
    sb.from('adaptive_ids_evaluation_requests').select('created_at').eq('status', 'new').order('created_at').limit(1),
  ]);
  const dbMs = Math.round(performance.now() - t1);
  add(
    state.error
      ? { id: 'db', level: 'error', title: 'Database problem', detail: state.error.message }
      : { id: 'db', level: 'ok', title: 'Database is connected', detail: `Content loaded in ${dbMs} ms.` }
  );

  // 3. Deploys
  const runs = await deployRuns(ctx);
  const last = runs?.[0];
  if (!ctx.repo) add({ id: 'deploy', level: 'info', title: 'Deploy status unknown', detail: 'The GitHub repository is not set for this build.' });
  else if (!runs) add({ id: 'deploy', level: 'info', title: 'Could not reach GitHub', detail: 'Deploy status will show when GitHub answers.' });
  else if (!last) add({ id: 'deploy', level: 'info', title: 'No deploys yet', detail: 'Press Publish to build the site.' });
  else if (last.status !== 'completed')
    add({ id: 'deploy', level: 'info', title: 'Deploy in progress', detail: `Started ${ago(last.created_at)} (${why(last)}).`, link: last.html_url });
  else if (last.conclusion === 'success')
    add({ id: 'deploy', level: 'ok', title: 'Last deploy succeeded', detail: `Finished ${ago(last.updated_at)} (${why(last)}).`, link: last.html_url });
  else
    add({ id: 'deploy', level: 'error', title: 'Last deploy failed', detail: `The live site is still on the previous version. Failed ${ago(last.updated_at)}.`, link: last.html_url });

  // 4. Unpublished changes
  const s = state.data;
  if (s && (!s.last_published_at || new Date(s.content_changed_at) > new Date(s.last_published_at))) {
    const hours = (Date.now() - new Date(s.content_changed_at).getTime()) / 3600_000;
    add({
      id: 'unpublished',
      level: hours > 24 ? 'warning' : 'info',
      title: 'Changes waiting to be published',
      detail: `Last edit ${ago(s.content_changed_at)}. Press Publish to put them live.`,
    });
  } else add({ id: 'unpublished', level: 'ok', title: 'Everything is published', detail: s?.last_published_at ? `Last published ${ago(s.last_published_at)}.` : 'No edits since the last build.' });

  // 5. Content gaps
  const p = profile.data;
  const missing = [!p?.photo_url && 'photo', !p?.cv_url && 'CV', !p?.email && 'email', !p?.intro && 'introduction'].filter(Boolean);
  if (missing.length) add({ id: 'profile', level: 'warning', title: 'Profile is incomplete', detail: `Missing: ${missing.join(', ')}.`, link: '#/profile' });
  const pub = (projects.data ?? []).filter((r: Row) => r.published);
  const noImg = pub.filter((r: Row) => !r.cover_url).length;
  const noSum = pub.filter((r: Row) => !r.summary).length;
  if (noImg || noSum)
    add({
      id: 'projects',
      level: 'warning',
      title: 'Some projects need attention',
      detail: [noImg && `${noImg} without a cover image`, noSum && `${noSum} without a summary`].filter(Boolean).join(', ') + '.',
      link: '#/projects',
    });
  else add({ id: 'projects', level: 'ok', title: 'Projects look complete', detail: `${pub.length} published, each with an image and summary.` });
  const noPrice = (services.data ?? []).filter((r: Row) => r.published && !r.price_label).length;
  if (noPrice) add({ id: 'services', level: 'warning', title: 'Services without a price', detail: `${noPrice} published service${noPrice > 1 ? 's have' : ' has'} no price.`, link: '#/services' });
  const postsNoCover = (posts.data ?? []).filter((r: Row) => r.published && !r.cover_url).length;
  if (postsNoCover) add({ id: 'posts', level: 'info', title: 'Blog posts without a cover', detail: `${postsNoCover} published post${postsNoCover > 1 ? 's' : ''}.`, link: '#/posts' });

  // 6. Waiting for a reply
  const oldMsg = msgs.data?.[0];
  if (oldMsg && Date.now() - new Date(oldMsg.created_at).getTime() > 3 * 86400_000)
    add({ id: 'messages', level: 'warning', title: 'A message has waited over 3 days', detail: `Oldest unread arrived ${ago(oldMsg.created_at)}.`, link: '#/messages' });
  const oldOpp = opps.data?.[0];
  if (oldOpp && Date.now() - new Date(oldOpp.created_at).getTime() > 2 * 86400_000)
    add({ id: 'opportunities', level: 'warning', title: 'A job opportunity is not reviewed yet', detail: `It arrived ${ago(oldOpp.created_at)}.`, link: '#/opportunities' });
  const oldEval = evals.data?.[0];
  if (oldEval && Date.now() - new Date(oldEval.created_at).getTime() > 2 * 86400_000)
    add({ id: 'evaluations', level: 'warning', title: 'An Adaptive IDS enquiry has waited over 2 days', detail: `It arrived ${ago(oldEval.created_at)}; adaptiveids.com promises a reply within two working days.`, link: '#/evaluations' });

  // 7. Visit counting
  const lastView = views.data?.[0];
  if (views.error) add({ id: 'visits', level: 'error', title: 'Visit statistics are not available', detail: views.error.message });
  else if (!lastView) add({ id: 'visits', level: 'info', title: 'No visits recorded yet', detail: 'Visits appear here once the updated site is published and people open it.' });
  else if (Date.now() - new Date(lastView.created_at).getTime() > 7 * 86400_000)
    add({ id: 'visits', level: 'warning', title: 'No visits for a week', detail: `Last visit ${ago(lastView.created_at)}. Check the site is online and visit counting is on.` });
  else add({ id: 'visits', level: 'ok', title: 'Visit counting is working', detail: `Last visit ${ago(lastView.created_at)}.` });

  if (notify) {
    const day = new Date().toISOString().slice(0, 10);
    const rows = out
      .filter((c) => c.level === 'warning' || c.level === 'error')
      .map((c) => ({
        kind: 'health',
        level: c.level,
        title: c.title,
        body: c.detail,
        link: c.link ?? '#/dashboard',
        dedupe_key: `health:${c.id}:${day}`,
      }));
    if (rows.length) await sb.from('notifications').upsert(rows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
  }
  const rank = { error: 0, warning: 1, info: 2, ok: 3 };
  return out.sort((a, b) => rank[a.level] - rank[b.level]);
}
