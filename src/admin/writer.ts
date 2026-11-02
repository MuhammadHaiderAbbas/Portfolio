// AI writer page: trending topics, drafts waiting for approval, run history and setup.
import { h, icon, ago } from './dom';
import type { Ctx } from './live';

type Row = Record<string, any>;

const SOURCES: Record<string, string> = {
  google: 'Google Trends UK',
  hackernews: 'Hacker News',
  devto: 'dev.to',
  github: 'GitHub trending',
  security: 'Security advisory',
  manual: 'Added by you',
};
const STATUS: Record<string, string> = { new: 'Suggested', queued: 'Next to write', writing: 'Writing now', written: 'Written', skipped: 'Skipped' };

function randomToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function writerView(ctx: Ctx): Promise<HTMLElement> {
  const { sb } = ctx;
  const root = h('div', { class: 'writer' });
  const alive = () => root.isConnected;
  let filter = 'new';
  let topics: Row[] = [];
  let runs: Row[] = [];
  let drafts: Row[] = [];

  const statusSlot = h('div', {});
  const draftsSlot = h('div', {});
  const topicsSlot = h('div', {});
  const tabs = h('div', { class: 'seg', role: 'group', 'aria-label': 'Show topics' });
  const runsSlot = h('div', {});

  async function load() {
    const [t, r, d] = await Promise.all([
      sb.from('trend_topics').select('*').order('relevance', { ascending: false }).order('created_at', { ascending: false }).limit(200),
      sb.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(12),
      sb.from('posts').select('id,slug,title,excerpt,body,published_on,created_at,keywords,meta_description').eq('ai_generated', true).eq('published', false).order('created_at', { ascending: false }),
    ]);
    if (!alive()) return;
    if (t.error) {
      topicsSlot.replaceChildren(h('p', { class: 'error' }, `The AI writer tables are missing: run supabase/writer.sql in the Supabase SQL editor. (${t.error.message})`));
      return;
    }
    topics = t.data ?? [];
    runs = r.data ?? [];
    drafts = d.data ?? [];
    drawStatus();
    drawDrafts();
    drawTabs();
    drawTopics();
    drawRuns();
  }

  async function run(mode: 'trends' | 'write', btn?: HTMLButtonElement) {
    if (btn) btn.disabled = true;
    const { error } = await sb.rpc('run_writer', { p_mode: mode });
    if (btn) btn.disabled = false;
    if (error) return ctx.toast(`Could not start the writer: ${error.message}`, 'error');
    ctx.toast(mode === 'trends' ? 'Looking for trending topics. This takes about a minute.' : 'Writing has started. The draft appears here in 1–3 minutes.');
    let n = 0;
    const timer = setInterval(async () => {
      if (!alive() || ++n > 30) return clearInterval(timer);
      const before = runs[0]?.id;
      const { data } = await sb.from('agent_runs').select('*').order('started_at', { ascending: false }).limit(1);
      if (data?.[0] && (data[0].id !== before || data[0].status !== runs[0]?.status)) {
        await load();
        if (data[0].status !== 'running') clearInterval(timer);
      }
    }, 10000);
  }

  function drawStatus() {
    const last = runs[0];
    const okRun = runs.find((r) => r.status === 'ok');
    const findBtn = h('button', { class: 'btn btn-quiet', type: 'button' }, icon('globe', 16), ' Find trending topics');
    findBtn.addEventListener('click', () => run('trends', findBtn));
    const writeBtn = h('button', { class: 'btn', type: 'button' }, icon('edit', 16), ' Write an article now');
    writeBtn.addEventListener('click', () => run('write', writeBtn));
    statusSlot.replaceChildren(
      h(
        'div',
        { class: `writer-status ${last ? 'st-' + last.status : 'st-none'}` },
        h(
          'div',
          {},
          h('strong', {}, !last ? 'Not run yet' : last.status === 'running' ? 'Working now…' : last.status === 'ok' ? 'Last run finished' : 'Last run failed'),
          last ? h('span', { class: 'muted' }, ` ${ago(last.started_at)}`) : '',
          last?.summary ? h('p', {}, last.summary) : h('p', { class: 'muted' }, 'Runs every morning to collect trends, and writes on your chosen days. You can also start it here.'),
          last?.run_url ? h('a', { class: 'link-btn small', href: last.run_url, target: '_blank', rel: 'noopener' }, 'Open the run on GitHub') : ''
        ),
        h('div', { class: 'row' }, findBtn, writeBtn)
      ),
      !okRun ? setupCard() : ''
    );
  }

  function setupCard(): HTMLElement {
    const token = randomToken();
    const sql = `select vault.create_secret('${token}', 'agent_token');`;
    const copy = (text: string) => async () => {
      try {
        await navigator.clipboard.writeText(text);
        ctx.toast('Copied');
      } catch {
        ctx.toast('Copy failed: select the text and copy it by hand.', 'error');
      }
    };
    const repo = ctx.repo || 'MuhammadHaiderAbbas/Portfolio';
    return h(
      'section',
      { class: 'setup-card' },
      h('h2', {}, 'Set up the AI writer (once, about 5 minutes)'),
      h(
        'ol',
        {},
        h(
          'li',
          {},
          'Create a Claude API key at ',
          h('a', { href: 'https://console.anthropic.com/settings/keys', target: '_blank', rel: 'noopener' }, 'console.anthropic.com'),
          ' and add some credit (each article costs a few pence).'
        ),
        h(
          'li',
          {},
          'On GitHub open ',
          h('a', { href: `https://github.com/${repo}/settings/secrets/actions/new`, target: '_blank', rel: 'noopener' }, `${repo} → Settings → Secrets and variables → Actions`),
          ' and add a secret named ',
          h('code', {}, 'ANTHROPIC_API_KEY'),
          ' with the key.'
        ),
        h(
          'li',
          {},
          'Add a second secret named ',
          h('code', {}, 'AGENT_TOKEN'),
          ' with this value (made just now in your browser):',
          h('div', { class: 'row' }, h('code', { class: 'token' }, token), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: copy(token) }, 'Copy'))
        ),
        h(
          'li',
          {},
          'In Supabase open SQL Editor → New query, paste this and press Run (it stores the same value):',
          h('div', { class: 'row' }, h('code', { class: 'token' }, sql), h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: copy(sql) }, 'Copy'))
        ),
        h('li', {}, 'Come back here and press ', h('strong', {}, 'Find trending topics'), '.')
      ),
      h('p', { class: 'muted small' }, 'Changing the token later? Use the same value in both places; in Supabase run: ', h('code', {}, "select vault.update_secret(id, 'NEW-VALUE') from vault.secrets where name = 'agent_token';"))
    );
  }

  function drawDrafts() {
    if (!drafts.length) {
      draftsSlot.replaceChildren(h('p', { class: 'muted dash-empty' }, 'No drafts waiting. New AI drafts appear here for you to read and approve.'));
      return;
    }
    draftsSlot.replaceChildren(
      h(
        'ul',
        { class: 'drafts' },
        drafts.map((d) => {
          const words = String(d.body || '').split(/\s+/).filter(Boolean).length;
          const approve = h('button', { class: 'btn btn-sm', type: 'button' }, icon('check', 14), ' Approve and publish');
          approve.addEventListener('click', async () => {
            approve.disabled = true;
            const today = new Date().toISOString().slice(0, 10);
            const { error } = await sb.from('posts').update({ published: true, published_on: today }).eq('id', d.id);
            if (error) {
              approve.disabled = false;
              return ctx.toast(`Could not approve: ${error.message}`, 'error');
            }
            const pub = await sb.rpc('publish_site');
            window.dispatchEvent(new Event('admin:published'));
            window.dispatchEvent(new Event('admin:refresh-publish'));
            ctx.toast(pub.error ? 'Approved. Press Publish site to put it live.' : 'Approved. The site is rebuilding; the article is live in about a minute.');
            drafts = drafts.filter((x) => x !== d);
            drawDrafts();
          });
          const reject = h('button', { class: 'btn btn-quiet btn-sm', type: 'button' }, 'Delete draft');
          let armed = false;
          reject.addEventListener('click', async () => {
            if (!armed) {
              armed = true;
              reject.textContent = 'Click again to delete';
              setTimeout(() => {
                armed = false;
                reject.textContent = 'Delete draft';
              }, 4000);
              return;
            }
            await sb.from('trend_topics').update({ status: 'skipped' }).eq('post_id', d.id);
            const { error } = await sb.from('posts').delete().eq('id', d.id);
            if (error) return ctx.toast(`Could not delete: ${error.message}`, 'error');
            ctx.toast('Draft deleted');
            drafts = drafts.filter((x) => x !== d);
            drawDrafts();
          });
          return h(
            'li',
            {},
            h('div', { class: 'draft-main' }, h('h3', {}, d.title), h('p', { class: 'muted' }, d.meta_description || d.excerpt), h('p', { class: 'small muted' }, `${words.toLocaleString('en-GB')} words · written ${ago(d.created_at)}${d.keywords?.length ? ' · keyword: ' + d.keywords[0] : ''}`)),
            h('div', { class: 'row' }, h('a', { class: 'btn btn-quiet btn-sm', href: `#/posts/${d.id}` }, icon('edit', 14), ' Read and edit'), approve, reject)
          );
        })
      )
    );
  }

  function drawTabs() {
    const count = (s: string) => topics.filter((t) => (s === 'queued' ? ['queued', 'writing'].includes(t.status) : t.status === s)).length;
    tabs.replaceChildren(
      ...['new', 'queued', 'written', 'skipped'].map((s) =>
        h(
          'button',
          {
            type: 'button',
            'aria-pressed': String(filter === s),
            onclick: () => {
              filter = s;
              drawTabs();
              drawTopics();
            },
          },
          `${STATUS[s]} (${count(s)})`
        )
      )
    );
  }

  async function setStatus(t: Row, status: string, note: string) {
    const { error } = await sb.from('trend_topics').update({ status }).eq('id', t.id);
    if (error) return ctx.toast(`Could not update: ${error.message}`, 'error');
    t.status = status;
    ctx.toast(note);
    drawTabs();
    drawTopics();
  }

  function drawTopics() {
    const shown = topics.filter((t) => (filter === 'queued' ? ['queued', 'writing'].includes(t.status) : t.status === filter));
    if (!shown.length) {
      topicsSlot.replaceChildren(
        h('p', { class: 'muted dash-empty' }, topics.length ? 'Nothing here.' : 'No topics yet. Press “Find trending topics”, or add your own below.')
      );
      return;
    }
    topicsSlot.replaceChildren(
      h(
        'ul',
        { class: 'topics' },
        shown.map((t) => {
          const actions: Node[] = [];
          if (t.status === 'new' || t.status === 'skipped') {
            actions.push(h('button', { class: 'btn btn-quiet btn-sm', type: 'button', onclick: () => setStatus(t, 'queued', 'Added to the writing queue') }, 'Write next'));
          }
          if (t.status === 'new' || t.status === 'queued') {
            const now = h('button', { class: 'btn btn-sm', type: 'button' }, 'Write now');
            now.addEventListener('click', async () => {
              if (t.status !== 'queued') await setStatus(t, 'queued', 'Queued');
              run('write', now);
            });
            actions.push(now);
          }
          if (t.status === 'new' || t.status === 'queued') {
            actions.push(h('button', { class: 'link-btn small', type: 'button', onclick: () => setStatus(t, 'skipped', 'Skipped') }, 'Skip'));
          }
          if (t.status === 'written' && t.post_id) actions.push(h('a', { class: 'btn btn-quiet btn-sm', href: `#/posts/${t.post_id}` }, 'Open the article'));
          return h(
            'li',
            {},
            h(
              'div',
              { class: 'topic-score', title: `Relevance ${t.relevance} out of 100` },
              h('strong', {}, String(t.relevance)),
              h('span', { class: 'bar-track', 'aria-hidden': 'true' }, h('span', { class: 'bar-fill', style: `width:${t.relevance}%` }))
            ),
            h(
              'div',
              { class: 'topic-main' },
              h('h3', {}, t.keyword),
              t.angle ? h('p', {}, t.angle) : '',
              h(
                'p',
                { class: 'small muted' },
                h('span', { class: `src src-${t.source}` }, SOURCES[t.source] ?? t.source),
                t.title && t.title !== t.keyword ? ` · ${t.title}` : '',
                ' · ',
                ago(t.created_at),
                t.url ? [' · ', h('a', { href: t.url, target: '_blank', rel: 'noopener noreferrer' }, 'source')] : ''
              )
            ),
            h('div', { class: 'row topic-actions' }, actions)
          );
        })
      )
    );
  }

  function drawRuns() {
    runsSlot.replaceChildren(
      runs.length
        ? h(
            'ul',
            { class: 'feed' },
            runs.map((r) =>
              h(
                'li',
                {},
                h('span', { class: `health-ico-sm st-${r.status}` }, icon(r.status === 'ok' ? 'check' : r.status === 'failed' ? 'x' : 'clock', 14)),
                h('span', { class: 'feed-main' }, h('strong', {}, `${r.mode === 'trends' ? 'Trend search' : r.mode === 'write' ? 'Write now' : 'Daily run'}: ${r.status === 'ok' ? 'finished' : r.status}`), h('span', { class: 'muted' }, r.summary || '…')),
                r.run_url ? h('a', { class: 'feed-time', href: r.run_url, target: '_blank', rel: 'noopener' }, ago(r.started_at)) : h('span', { class: 'feed-time' }, ago(r.started_at))
              )
            )
          )
        : h('p', { class: 'muted dash-empty' }, 'No runs yet.')
    );
  }

  // Add your own topic
  const own = h('input', { type: 'text', maxlength: 160, placeholder: 'e.g. how I secure PHP login forms', 'aria-label': 'Your own topic' });
  const ownAngle = h('input', { type: 'text', maxlength: 500, placeholder: 'Angle or notes (optional)', 'aria-label': 'Angle or notes' });
  const addOwn = h(
    'form',
    {
      class: 'own-topic',
      onsubmit: async (e: Event) => {
        e.preventDefault();
        const keyword = own.value.trim().toLowerCase();
        if (!keyword) return own.focus();
        const { data, error } = await sb
          .from('trend_topics')
          .insert({ source: 'manual', keyword, title: own.value.trim(), angle: ownAngle.value.trim(), relevance: 100, status: 'queued' })
          .select()
          .single();
        if (error) return ctx.toast(/duplicate/i.test(error.message) ? 'That topic is already in the list.' : `Could not add: ${error.message}`, 'error');
        topics.unshift(data);
        own.value = '';
        ownAngle.value = '';
        filter = 'queued';
        drawTabs();
        drawTopics();
        ctx.toast('Added. It will be written next.');
      },
    },
    own,
    ownAngle,
    h('button', { class: 'btn btn-quiet', type: 'submit' }, 'Add topic')
  );

  const card = (title: string, sub: Node | string, ...body: Node[]) =>
    h('section', { class: 'dash-card' }, h('header', { class: 'dash-card-head' }, h('h2', {}, title), sub), ...body);

  root.append(
    h(
      'div',
      { class: 'view-head' },
      h(
        'div',
        {},
        h('h1', { tabindex: -1 }, 'AI writer'),
        h('p', { class: 'muted' }, 'Finds what people are searching for in your fields, writes a researched, search-friendly article with Claude, and makes a cover. Every article waits here for your approval.')
      ),
      h('a', { class: 'btn btn-quiet', href: '#/text' }, icon('layers', 16), ' Writer settings')
    ),
    statusSlot,
    h(
      'div',
      { class: 'writer-grid' },
      card('Drafts waiting for you', h('span', { class: 'muted small' }, 'Read, edit, then approve'), draftsSlot),
      card('Trending topics', tabs, topicsSlot, h('h3', {}, 'Add your own topic'), addOwn),
      card('Run history', h('span', { class: 'muted small' }, 'Latest 12'), runsSlot)
    )
  );

  load();
  const onChange = (e: Event) => {
    if (!alive()) return window.removeEventListener('admin:change', onChange);
    if (['agent_runs', 'notifications'].includes((e as CustomEvent).detail.table)) load();
  };
  window.addEventListener('admin:change', onChange);
  return root;
}
