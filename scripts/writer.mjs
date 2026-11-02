// AI writer: finds trending topics in your fields, scores them, and writes
// well-researched article DRAFTS with Claude. Runs in GitHub Actions
// (.github/workflows/writer.yml); drafts wait in the admin panel for approval.
//
//   node scripts/writer.mjs trends   collect and score trending topics only
//   node scripts/writer.mjs write    write the next article(s) now
//   node scripts/writer.mjs auto     daily run: trends, and write on the chosen days
//
// Needs: ANTHROPIC_API_KEY, AGENT_TOKEN, and the Supabase URL + publishable key
// (env PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY or supabase.config.json).
// WRITER_FAKE=1 replaces the internet and Claude with fixtures (for testing).
import { readFile } from 'node:fs/promises';

const mode = ['trends', 'write', 'auto'].includes(process.argv[2]) ? process.argv[2] : 'auto';
const FAKE = process.env.WRITER_FAKE === '1';
const MODEL = process.env.AI_MODEL || 'claude-sonnet-5-5';
const SITE = (process.env.SITE_URL || 'https://personalportfolio.website').replace(/\/$/, '');

let fileCfg = {};
try {
  fileCfg = JSON.parse(await readFile(new URL('../supabase.config.json', import.meta.url), 'utf8'));
} catch {}
const SB_URL = (process.env.PUBLIC_SUPABASE_URL || fileCfg.url || '').replace(/\/$/, '');
const SB_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY || fileCfg.anonKey || '';
const TOKEN = process.env.AGENT_TOKEN || '';
const API_KEY = process.env.ANTHROPIC_API_KEY || '';

// Defaults for the "AI writer" settings in Admin → Site text & settings
const DEFAULTS = {
  'ai.enabled': 'true',
  'ai.days': 'mon,thu',
  'ai.per_run': '1',
  'ai.min_relevance': '65',
  'ai.length': '1200',
  'ai.focus':
    'Cybersecurity and ethical hacking; web development (PHP, MySQL, JavaScript); game development (Unity, Unreal); 3D, VFX and animation; AI and machine learning; e-commerce',
  'ai.audience': 'Recruiters, hiring managers, small businesses and fellow developers in the UK',
  'ai.tone': 'Clear, practical and professional, in British English. Helpful rather than salesy.',
};

const log = (...a) => console.log('[writer]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// Supabase (only the agent_* functions, authorised by AGENT_TOKEN)
// ---------------------------------------------------------------------------
async function rpc(name, args) {
  const res = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: { apikey: SB_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: TOKEN, ...args }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${name} failed (${res.status}): ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------
async function get(url, { json = true, timeout = 15000, headers = {} } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { 'User-Agent': 'portfolio-ai-writer (+https://personalportfolio.website)', Accept: json ? 'application/json' : '*/*', ...headers },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return json ? await res.json() : await res.text();
  } finally {
    clearTimeout(t);
  }
}

const decode = (s = '') =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .trim();

/** Readable text of a web page, for grounding an article in its source. */
async function pageText(url, max = 7000) {
  if (!url || !/^https?:\/\//.test(url) || FAKE) return '';
  try {
    const html = await get(url, { json: false, timeout: 12000, headers: { Accept: 'text/html' } });
    const body = String(html)
      .replace(/<(script|style|noscript|svg|nav|footer|header|form)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|h[1-6]|li|tr|div|section|article)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
    return decode(body).replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim().slice(0, max);
  } catch (e) {
    log(`could not read ${url}: ${e.message}`);
    return '';
  }
}

// ---------------------------------------------------------------------------
// Trend sources. Each one can fail on its own without stopping the run.
// ---------------------------------------------------------------------------
const sources = {
  async google() {
    const xml = await get('https://trends.google.com/trending/rss?geo=GB', { json: false });
    return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].slice(0, 25).map(([, it]) => {
      const pick = (tag) => decode((it.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1] || '');
      const news = [...it.matchAll(/<ht:news_item_title>([\s\S]*?)<\/ht:news_item_title>/g)].map((m) => decode(m[1]));
      const traffic = Number(pick('ht:approx_traffic').replace(/\D/g, '')) || 0;
      return { source: 'google', keyword: pick('title'), title: news[0] || pick('title'), url: pick('ht:news_item_url'), context: news.slice(0, 3).join(' | '), score: traffic };
    });
  },
  async hackernews() {
    const j = await get('https://hn.algolia.com/api/v1/search?tags=front_page&hitsPerPage=30');
    return j.hits.map((h) => ({ source: 'hackernews', keyword: h.title, title: h.title, url: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, context: `${h.points} points, ${h.num_comments} comments on Hacker News`, score: h.points }));
  },
  async devto() {
    const j = await get('https://dev.to/api/articles?top=3&per_page=30');
    return j.map((a) => ({ source: 'devto', keyword: a.title, title: a.title, url: a.url, context: `Tags: ${(a.tag_list || []).join(', ')}. ${a.description || ''}`.slice(0, 600), score: a.positive_reactions_count }));
  },
  async github() {
    const since = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
    const headers = process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {};
    const j = await get(`https://api.github.com/search/repositories?q=created:%3E${since}&sort=stars&order=desc&per_page=20`, { headers });
    return j.items.map((r) => ({ source: 'github', keyword: r.full_name, title: `${r.full_name}: ${r.description || ''}`.slice(0, 300), url: r.html_url, context: `${r.stargazers_count} stars this week. Language: ${r.language || 'n/a'}. Topics: ${(r.topics || []).join(', ')}`, score: r.stargazers_count }));
  },
  async security() {
    const j = await get('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', { timeout: 25000 });
    return [...j.vulnerabilities]
      .sort((a, b) => (a.dateAdded < b.dateAdded ? 1 : -1))
      .slice(0, 20)
      .map((v) => ({
        source: 'security',
        keyword: `${v.cveID} ${v.vendorProject} ${v.product}`,
        title: `${v.cveID}: ${v.vulnerabilityName}`,
        url: `https://nvd.nist.gov/vuln/detail/${v.cveID}`,
        context: `${v.shortDescription} Added to CISA's Known Exploited Vulnerabilities list on ${v.dateAdded}. Required action: ${v.requiredAction}`.slice(0, 900),
        score: 50,
      }));
  },
};

async function collect() {
  if (FAKE) return fixtures.candidates;
  const all = [];
  for (const [name, fn] of Object.entries(sources)) {
    try {
      const items = (await fn()).filter((x) => x.keyword);
      log(`${name}: ${items.length} items`);
      all.push(...items);
    } catch (e) {
      log(`${name}: skipped (${e.message})`);
    }
  }
  return all;
}

// ---------------------------------------------------------------------------
// Claude
// ---------------------------------------------------------------------------
async function claude({ system, prompt, tool, maxTokens = 4000 }) {
  if (FAKE) return fixtures.claude(tool.name);
  if (!API_KEY) throw new Error('ANTHROPIC_API_KEY is not set. Add it under GitHub → Settings → Secrets and variables → Actions.');
  for (let attempt = 1; ; attempt++) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: maxTokens,
        system,
        tools: [tool],
        tool_choice: { type: 'tool', name: tool.name },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if ((res.status === 429 || res.status >= 500) && attempt < 4) {
      await sleep(attempt * 8000);
      continue;
    }
    const j = await res.json();
    if (!res.ok) throw new Error(`Claude API error ${res.status}: ${j?.error?.message || JSON.stringify(j).slice(0, 200)}`);
    const use = j.content?.find((c) => c.type === 'tool_use');
    if (!use) throw new Error('Claude returned no structured answer');
    return use.input;
  }
}

const scoreTool = {
  name: 'save_topics',
  description: 'Save the trending topics that are worth an article on this portfolio.',
  input_schema: {
    type: 'object',
    properties: {
      topics: {
        type: 'array',
        maxItems: 12,
        items: {
          type: 'object',
          properties: {
            index: { type: 'integer', description: 'Index of the candidate in the list' },
            keyword: { type: 'string', description: 'The search phrase people would type, 2–6 words, lowercase' },
            relevance: { type: 'integer', minimum: 0, maximum: 100, description: 'How well it fits the author and audience' },
            angle: { type: 'string', description: 'One sentence: the useful article this author could write about it' },
          },
          required: ['index', 'keyword', 'relevance', 'angle'],
        },
      },
    },
    required: ['topics'],
  },
};

async function scoreTopics(candidates, ctx, settings) {
  const list = candidates.map((c, i) => `${i}. [${c.source}] ${c.title}${c.context ? ' — ' + c.context.slice(0, 220) : ''}`).join('\n');
  const recent = (ctx.recent_keywords || []).slice(0, 80).join('; ');
  const existing = (ctx.posts || []).map((p) => p.title).join('; ');
  const out = await claude({
    system: 'You are the editor of a professional portfolio blog. You pick topics that are trending now and genuinely relevant to the author. You never pick celebrity gossip, sport, politics, tragedies or anything unrelated to the author’s fields.',
    prompt: `Author: ${ctx.profile?.name}. ${ctx.profile?.headline || ''}\nFields: ${settings['ai.focus']}\nAudience: ${settings['ai.audience']}\n\nAlready written: ${existing || 'nothing yet'}\nAlready considered recently: ${recent || 'none'}\n\nTrending now:\n${list}\n\nChoose up to 12 candidates that would make a useful, timely article for this author and audience. Skip anything off-topic or already covered. Rate relevance honestly (most general news is below 40).`,
    tool: scoreTool,
    maxTokens: 3000,
  });
  return (out.topics || [])
    .filter((t) => candidates[t.index])
    .map((t) => ({ ...candidates[t.index], keyword: String(t.keyword).toLowerCase().slice(0, 160), relevance: t.relevance, angle: t.angle }));
}

const articleTool = {
  name: 'save_article',
  description: 'Save the finished blog article.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Headline, under 65 characters, includes the main keyword naturally' },
      seo_title: { type: 'string', description: 'Search result title, 50–60 characters' },
      meta_description: { type: 'string', description: 'Search result description, 140–158 characters, with the keyword and a reason to click' },
      slug: { type: 'string', description: 'Short lowercase URL slug, 3–6 words joined by hyphens' },
      excerpt: { type: 'string', description: 'Two-sentence summary for cards' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'Broad categories, Title Case' },
      keywords: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 8, description: 'Main keyword first, then related search phrases' },
      body: { type: 'string', description: 'The article in Markdown. No H1. Use ## and ### headings.' },
      sources: {
        type: 'array',
        items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] },
      },
    },
    required: ['title', 'seo_title', 'meta_description', 'slug', 'excerpt', 'tags', 'keywords', 'body', 'sources'],
  },
};

async function writeArticle(topic, ctx, settings) {
  const sourceText = await pageText(topic.url);
  const links = [
    ...(ctx.projects || []).map((p) => `- Project "${p.title}" (${p.category}): /projects/${p.slug}/ — ${p.summary}`),
    ...(ctx.services || []).map((s) => `- Service "${s.title}": /services/${s.slug}/ — ${s.tagline || ''}`),
    '- Contact page: /contact/',
    '- Hire me page (for recruiters): /hire/',
  ].join('\n');
  const words = Number(settings['ai.length']) || 1200;
  const today = new Date().toISOString().slice(0, 10);
  return claude({
    system: `You write blog articles for the portfolio of ${ctx.profile?.name}, published on ${SITE}. ${settings['ai.tone']}
Rules you always follow:
- Accuracy first. For anything about this specific news item, rely only on the source material provided. If a detail is not in it, do not state it. Never invent statistics, quotes, dates, prices, version numbers or customer stories.
- Do not claim the author did, built or tested something unless it appears in the author profile or project list.
- Add real value: explain what happened, why it matters to the audience, and practical steps or lessons. Prefer concrete advice over hype.
- Search-friendly but natural: use the main keyword in the first paragraph and in one or two headings; use related phrases naturally; never keyword-stuff.
- Structure: a short hook paragraph, then ## sections, a "## Key takeaways" bullet list, and a "## FAQ" with 3 questions as ### headings and short answers.
- Link 1–3 of the author's own pages where genuinely relevant (relative links exactly as given), and link the source(s) in the text.
- For security topics, explain defence and mitigation only; never give exploitation steps or working attack code.
- British English. About ${words} words.`,
    prompt: `Today is ${today}.

Author profile:
${ctx.profile?.headline || ''}
${(ctx.profile?.about || ctx.profile?.intro || '').slice(0, 1800)}

Author's own pages you may link:
${links}

Topic: ${topic.title || topic.keyword}
Main keyword: ${topic.keyword}
Suggested angle: ${topic.angle || 'your choice'}
Where it is trending: ${topic.source}${topic.context ? ' — ' + topic.context : ''}
Source URL: ${topic.url || 'none'}

Source material (may be partial):
"""
${sourceText || topic.context || 'No source text available. Write an evergreen explainer on the keyword without claiming any specific recent facts.'}
"""

Write the article and save it with the tool.`,
    tool: articleTool,
    maxTokens: 8000,
  });
}

function tidy(a, topic) {
  const body = String(a.body || '')
    .replace(/^# (.+)$/gm, '## $1') // no second H1 on the page
    .trim();
  const words = body.split(/\s+/).length;
  if (words < 350) throw new Error(`Article too short (${words} words)`);
  const sources = [...(a.sources || [])];
  if (topic.url && !sources.some((s) => s.url === topic.url)) sources.unshift({ title: topic.title || topic.keyword, url: topic.url });
  return {
    ...a,
    body,
    title: String(a.title).slice(0, 120),
    meta_description: String(a.meta_description).slice(0, 170),
    keywords: (a.keywords || []).map((k) => String(k).toLowerCase()),
    sources: sources.filter((s) => /^https?:\/\//.test(s.url)).slice(0, 8),
  };
}

// ---------------------------------------------------------------------------
// Test fixtures (WRITER_FAKE=1)
// ---------------------------------------------------------------------------
const fixtures = {
  candidates: [
    { source: 'hackernews', keyword: 'Passkeys roll out to more banks', title: 'Passkeys roll out to more UK banks', url: 'https://example.com/passkeys', context: '512 points', score: 512 },
    { source: 'google', keyword: 'premier league', title: 'Premier League results', url: '', context: '', score: 50000 },
    { source: 'security', keyword: 'CVE-2026-0001 Example Router', title: 'CVE-2026-0001: Example Router auth bypass', url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001', context: 'Auth bypass in Example Router admin page.', score: 50 },
  ],
  claude(name) {
    if (name === 'save_topics')
      return { topics: [{ index: 0, keyword: 'passkeys for banking', relevance: 86, angle: 'What passkeys mean for online banking security and how small businesses can adopt them.' }, { index: 2, keyword: 'router authentication bypass', relevance: 72, angle: 'How to check and patch exposed router admin pages.' }] };
    return {
      title: 'Passkeys for Banking: What Changes and Why It Matters',
      seo_title: 'Passkeys for Banking: What Changes in 2026',
      meta_description: 'Passkeys are replacing passwords at UK banks. Here is how they stop phishing, what changes for customers, and what small businesses should do next.',
      slug: 'passkeys-for-banking',
      excerpt: 'Passkeys are arriving at more banks. Here is what they are and why they matter.',
      tags: ['Cybersecurity', 'Authentication'],
      keywords: ['passkeys for banking', 'passwordless login', 'phishing protection', 'fido2'],
      body: '## Why passkeys matter\n\n' + 'Passkeys replace passwords with a key stored on your device. '.repeat(60) + '\n\n## Key takeaways\n\n- Passkeys resist phishing\n\n## FAQ\n\n### Are passkeys safe?\n\nYes.',
      sources: [{ title: 'Passkeys roll out', url: 'https://example.com/passkeys' }],
    };
  },
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
const runUrl = process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : '';

if (!SB_URL || !SB_KEY || !TOKEN) {
  console.error('[writer] Missing Supabase settings or AGENT_TOKEN. See README → "AI writer".');
  process.exit(1);
}

let runId = null;
let found = 0;
let written = 0;
const notes = [];
try {
  runId = await rpc('agent_log', { p_run_id: null, p_mode: mode, p_status: 'running', p_run_url: runUrl });
  let ctx = await rpc('agent_context', {});
  const settings = { ...DEFAULTS, ...(ctx.settings || {}) };

  if (mode === 'trends' || mode === 'auto') {
    const candidates = await collect();
    if (candidates.length) {
      const scored = await scoreTopics(candidates, ctx, settings);
      found = await rpc('agent_save_topics', { p_topics: scored });
      notes.push(`${candidates.length} trending items checked, ${scored.length} relevant topics saved.`);
    } else notes.push('No trend source answered.');
  }

  const day = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date().getUTCDay()];
  const writeDay = settings['ai.days'].toLowerCase().includes(day);
  const shouldWrite = mode === 'write' || (mode === 'auto' && settings['ai.enabled'] === 'true' && writeDay);
  if (mode === 'auto' && !shouldWrite) notes.push(settings['ai.enabled'] !== 'true' ? 'Scheduled writing is switched off.' : `Not a writing day (${settings['ai.days']}).`);

  if (shouldWrite) {
    ctx = await rpc('agent_context', {});
    const min = Number(settings['ai.min_relevance']) || 65;
    const perRun = Math.max(1, Math.min(3, Number(settings['ai.per_run']) || 1));
    const picks = [...ctx.queued, ...ctx.candidates.filter((c) => c.relevance >= min)].slice(0, perRun);
    if (!picks.length) notes.push(`No topic scored ${min} or more yet, so nothing was written.`);
    for (const topic of picks) {
      if (!(await rpc('agent_claim_topic', { p_topic_id: topic.id }))) continue;
      try {
        log(`writing: ${topic.keyword}`);
        const article = tidy(await writeArticle(topic, ctx, settings), topic);
        const saved = await rpc('agent_save_post', { p_topic_id: topic.id, p_post: article });
        written++;
        notes.push(`Draft saved: "${article.title}" (/blog/${saved.slug}/).`);
      } catch (e) {
        await rpc('agent_release_topic', { p_topic_id: topic.id }).catch(() => {});
        throw e;
      }
    }
  }
  await rpc('agent_log', { p_run_id: runId, p_mode: mode, p_status: 'ok', p_topics: found, p_articles: written, p_summary: notes.join(' ') });
  log('done:', notes.join(' '));
} catch (e) {
  console.error('[writer] failed:', e.message);
  if (runId) await rpc('agent_log', { p_run_id: runId, p_mode: mode, p_status: 'failed', p_topics: found, p_articles: written, p_summary: [...notes, e.message].join(' ') }).catch(() => {});
  process.exit(1);
}
