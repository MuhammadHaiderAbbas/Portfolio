// AI writer: finds trending topics in your fields, writes a well-researched article,
// has a second "editor" pass check it for safety and quality, and saves it.
// Articles that pass go live automatically one hour after the email (unless you
// hold them); anything the editor flags waits for you. Runs in GitHub Actions
// (.github/workflows/writer.yml), every morning and every evening.
//
//   node scripts/writer.mjs trends   collect and score trending topics only
//   node scripts/writer.mjs write    write the next article now
//   node scripts/writer.mjs auto     scheduled run (morning: trends + article, evening: article)
//
// AI providers are tried in order until one works, so the writer keeps running
// when credits run out: Claude (ANTHROPIC_API_KEY) → GitHub Models (free, uses the
// workflow's own token) → Google Gemini (GEMINI_API_KEY, free tier) → Groq
// (GROQ_API_KEY, free tier) → OpenRouter (OPENROUTER_API_KEY, free models) → OpenAI.
// WRITER_FAKE=1 replaces the internet and the AI with fixtures (for testing).
import { readFile } from 'node:fs/promises';

const mode = ['trends', 'write', 'auto'].includes(process.argv[2]) ? process.argv[2] : 'auto';
const FAKE = process.env.WRITER_FAKE === '1';
const SITE = (process.env.SITE_URL || 'https://personalportfolio.website').replace(/\/$/, '');

let fileCfg = {};
try {
  fileCfg = JSON.parse(await readFile(new URL('../supabase.config.json', import.meta.url), 'utf8'));
} catch {}
const SB_URL = (process.env.PUBLIC_SUPABASE_URL || fileCfg.url || '').replace(/\/$/, '');
const SB_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY || fileCfg.anonKey || '';
const TOKEN = process.env.AGENT_TOKEN || '';

// Defaults for the "AI writer" settings in Admin → Site text & settings
const DEFAULTS = {
  'ai.enabled': 'true',
  'ai.days': 'mon,tue,wed,thu,fri,sat,sun',
  'ai.per_run': '1',
  'ai.min_relevance': '60',
  'ai.length': '1200',
  'ai.focus':
    'Cybersecurity and ethical hacking; web development (PHP, MySQL, JavaScript); game development (Unity, Unreal); 3D, VFX and animation; AI and machine learning; e-commerce',
  'ai.audience': 'Recruiters, hiring managers, small businesses and fellow developers in the UK',
  'ai.tone': 'Clear, practical and professional, in British English. Helpful rather than salesy.',
};
const MAX_PER_DAY = 2;

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
// Topics that could get the author into trouble are never written
// ---------------------------------------------------------------------------
const BANNED = [
  /\b(election|elections|vote|voting|ballot|parliament|congress|senate|labour party|conservative party|tory|tories|reform uk|democrat|republican|trump|biden|harris|starmer|farage|putin|zelensky|netanyahu|hamas|israel|gaza|palestin|ukraine war|russia|iran|politic)/i,
  /\b(religio|islam|muslim|christian|jewish|hindu|church|mosque|blasphem)/i,
  /\b(murder|killed|killing|death|dies|died|dead|stabbing|shooting|terror|attack on|war\b|bomb|massacre|suicide|abuse|assault|rape|kidnap|missing person|funeral)/i,
  /\b(celebrity|kardashian|love island|strictly|x factor|royal family|king charles|prince|princess|footballer|premier league|champions league|transfer news|f1 |boxing|ufc)/i,
  /\b(cancer|covid|vaccine|diet|weight loss|medication|drug|overdose|mental health crisis|pregnan)/i,
  /\b(casino|betting|gambl|lottery|crypto price|bitcoin price|stock tip|investment advice|get rich|forex)/i,
  /\b(porn|onlyfans|sex|nude|adult content|escort)/i,
  /\b(weapon|firearm|gun|explosive)/i,
];
const isBanned = (text) => BANNED.some((re) => re.test(text || ''));

// Phrases that make writing sound machine-made
const CLICHES = ["in today's fast-paced", 'delve', 'game-changer', 'game changer', 'unlock the power', 'tapestry', 'ever-evolving', 'in conclusion', 'navigating the complexities', 'look no further', 'revolutionize', 'revolutionise', 'seamlessly', 'elevate your', "it's important to note", 'in the realm of', 'landscape of'];

/** Longest run of identical words shared with the source, and share of copied 8-word phrases. */
function copying(article, source) {
  if (!source) return { longest: 0, share: 0 };
  const words = (s) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const a = words(article);
  const src = words(source);
  const grams = new Set();
  for (let i = 0; i + 8 <= src.length; i++) grams.add(src.slice(i, i + 8).join(' '));
  let hits = 0;
  let run = 0;
  let longest = 0;
  for (let i = 0; i + 8 <= a.length; i++) {
    if (grams.has(a.slice(i, i + 8).join(' '))) {
      hits++;
      run++;
      longest = Math.max(longest, run + 7);
    } else run = 0;
  }
  return { longest, share: a.length > 8 ? hits / (a.length - 7) : 0 };
}

// ---------------------------------------------------------------------------
// AI providers, tried in order
// ---------------------------------------------------------------------------
const openAiStyle = (name, endpoint, keyEnv, models, maxSource) => ({
  name,
  key: process.env[keyEnv] || '',
  models: (process.env[`${keyEnv.replace(/_API_KEY|_TOKEN/, '')}_MODEL`] || '').split(',').filter(Boolean).concat(models),
  maxSource,
  async call(model, { system, prompt, tool, maxTokens }) {
    const body = {
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      tools: [{ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.input_schema } }],
      tool_choice: { type: 'function', function: { name: tool.name } },
      max_tokens: maxTokens,
      temperature: 0.6,
    };
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', 'HTTP-Referer': SITE, 'X-Title': 'Portfolio AI writer' },
      body: JSON.stringify(body),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`${res.status} ${j?.error?.message || JSON.stringify(j).slice(0, 160)}`);
    const msg = j.choices?.[0]?.message;
    const args = msg?.tool_calls?.[0]?.function?.arguments;
    if (args) return typeof args === 'string' ? JSON.parse(args) : args;
    // Some free models answer in plain text: accept a JSON object in the reply
    const text = String(msg?.content || '').replace(/^```(?:json)?|```$/gm, '');
    const start = text.indexOf('{');
    if (start >= 0) return JSON.parse(text.slice(start, text.lastIndexOf('}') + 1));
    throw new Error('no structured answer');
  },
});

const PROVIDERS = [
  {
    name: 'Claude',
    key: process.env.ANTHROPIC_API_KEY || '',
    models: (process.env.AI_MODEL || '').split(',').filter(Boolean).concat(['claude-sonnet-5-5', 'claude-haiku-5-5']),
    maxSource: 9000,
    async call(model, { system, prompt, tool, maxTokens }) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': this.key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model, max_tokens: maxTokens, system, tools: [tool], tool_choice: { type: 'tool', name: tool.name }, messages: [{ role: 'user', content: prompt }] }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`${res.status} ${j?.error?.message || ''}`);
      const use = j.content?.find((c) => c.type === 'tool_use');
      if (!use) throw new Error('no structured answer');
      return use.input;
    },
  },
  // Free for every GitHub account, using the workflow's own token (permission: models: read)
  openAiStyle('GitHub Models (free)', 'https://models.github.ai/inference/chat/completions', 'GITHUB_TOKEN', ['openai/gpt-4.1-mini', 'openai/gpt-4o-mini', 'meta/llama-3.3-70b-instruct'], 3500),
  openAiStyle('Google Gemini', 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', 'GEMINI_API_KEY', ['gemini-2.5-flash', 'gemini-flash-latest'], 9000),
  openAiStyle('Groq', 'https://api.groq.com/openai/v1/chat/completions', 'GROQ_API_KEY', ['llama-3.3-70b-versatile', 'openai/gpt-oss-120b'], 6000),
  openAiStyle('OpenRouter', 'https://openrouter.ai/api/v1/chat/completions', 'OPENROUTER_API_KEY', ['meta-llama/llama-3.3-70b-instruct:free', 'deepseek/deepseek-chat-v3-0324:free'], 6000),
  openAiStyle('OpenAI', 'https://api.openai.com/v1/chat/completions', 'OPENAI_API_KEY', ['gpt-4.1-mini'], 9000),
];

const failures = [];
/** Runs one AI task on the first provider that works. Returns { out, by }. */
async function ai(task) {
  if (FAKE) return fixtures.ai(task.tool.name);
  const available = PROVIDERS.filter((p) => p.key);
  if (!available.length) throw new Error('No AI provider is set up. Add ANTHROPIC_API_KEY (or a free GEMINI_API_KEY / GROQ_API_KEY) as a GitHub secret.');
  let last = '';
  for (const p of available) {
    for (const model of [...new Set(p.models)]) {
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const prompt = typeof task.prompt === 'function' ? task.prompt(p.maxSource) : task.prompt;
          const out = await p.call(model, { ...task, prompt });
          return { out, by: `${p.name} (${model})` };
        } catch (e) {
          const msg = String(e.message || e);
          last = msg;
          log(`${p.name} ${model}: ${msg.slice(0, 160)}`);
          failures.push(`${p.name}: ${msg.slice(0, 120)}`);
          if (/^(429|5\d\d)/.test(msg) && attempt === 1) {
            await sleep(6000);
            continue;
          }
          break;
        }
      }
      // Credit, key or permission problems: skip the provider's other models
      if (/^(400|401|402|403)\b/.test(last) && /credit|billing|quota|balance|permission|key|auth|unauthori/i.test(last)) break;
    }
  }
  throw new Error(`Every AI provider failed: ${failures.slice(-4).join(' | ')}`);
}

// ---------------------------------------------------------------------------
// Prompts
// ---------------------------------------------------------------------------
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
  const safe = candidates.filter((c) => !isBanned(`${c.keyword} ${c.title} ${c.context}`)).slice(0, 110);
  const list = safe.map((c, i) => `${i}. [${c.source}] ${c.title}${c.context ? ' — ' + c.context.slice(0, 200) : ''}`).join('\n');
  const { out } = await ai({
    system:
      'You are the editor of a professional portfolio blog. You pick topics that are trending now and genuinely relevant to the author. Never pick politics, religion, crime, deaths, wars, health, celebrities, sport, gambling, finance tips or anything about a named private person.',
    prompt: `Author: ${ctx.profile?.name}. ${ctx.profile?.headline || ''}\nFields: ${settings['ai.focus']}\nAudience: ${settings['ai.audience']}\n\nAlready written: ${(ctx.posts || []).map((p) => p.title).join('; ') || 'nothing yet'}\nAlready considered recently: ${(ctx.recent_keywords || []).slice(0, 80).join('; ') || 'none'}\n\nTrending now:\n${list}\n\nChoose up to 12 candidates that would make a useful, timely article for this author and audience. Skip anything off-topic, risky or already covered. Rate relevance honestly (most general news is below 40).`,
    tool: scoreTool,
    maxTokens: 3000,
  });
  return (out.topics || [])
    .filter((t) => safe[t.index] && !isBanned(t.keyword))
    .map((t) => ({ ...safe[t.index], keyword: String(t.keyword).toLowerCase().slice(0, 160), relevance: Math.max(0, Math.min(100, Number(t.relevance) || 0)), angle: t.angle }));
}

const evergreenTool = {
  name: 'suggest_topic',
  description: 'Suggest one evergreen article topic.',
  input_schema: {
    type: 'object',
    properties: { keyword: { type: 'string' }, angle: { type: 'string' } },
    required: ['keyword', 'angle'],
  },
};

async function evergreenTopic(ctx, settings) {
  const { out } = await ai({
    system: 'You plan articles for a professional portfolio blog.',
    prompt: `Fields: ${settings['ai.focus']}\nAudience: ${settings['ai.audience']}\nAlready written: ${(ctx.posts || []).map((p) => p.title).join('; ') || 'nothing yet'}\n\nSuggest ONE evergreen, practical article topic in these fields that people search for, that is not already covered, and that shows real expertise. Keyword: the search phrase (2–6 words, lowercase). Angle: one sentence.`,
    tool: evergreenTool,
    maxTokens: 400,
  });
  if (isBanned(out.keyword)) throw new Error('Suggested topic was off-limits');
  return { source: 'manual', keyword: String(out.keyword).toLowerCase().slice(0, 160), title: out.keyword, url: '', context: 'Evergreen topic chosen because no trending topic qualified.', score: 0, relevance: 70, angle: out.angle };
}

const articleTool = {
  name: 'save_article',
  description: 'Save the finished blog article.',
  input_schema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Headline under 65 characters, specific and curiosity-raising, includes the main keyword naturally' },
      seo_title: { type: 'string', description: 'Search result title, 50–60 characters' },
      meta_description: { type: 'string', description: 'Search result description, 140–158 characters, with the keyword and a reason to click' },
      slug: { type: 'string', description: 'Short lowercase URL slug, 3–6 words joined by hyphens' },
      excerpt: { type: 'string', description: 'Two-sentence summary for cards' },
      tags: { type: 'array', items: { type: 'string' }, minItems: 2, maxItems: 4, description: 'Broad categories, Title Case' },
      keywords: { type: 'array', items: { type: 'string' }, minItems: 4, maxItems: 8, description: 'Main keyword first, then related search phrases' },
      body: { type: 'string', description: 'The article in Markdown. No H1. Use ## and ### headings.' },
      sources: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, url: { type: 'string' } }, required: ['title', 'url'] } },
    },
    required: ['title', 'seo_title', 'meta_description', 'slug', 'excerpt', 'tags', 'keywords', 'body', 'sources'],
  },
};

function writerBrief(ctx, settings) {
  const words = Number(settings['ai.length']) || 1200;
  return `You are ghost-writing for ${ctx.profile?.name}, whose portfolio is ${SITE}. Every article should leave readers (especially recruiters and potential clients) thinking: "this person really knows their craft and explains it brilliantly". ${settings['ai.tone']}

Voice and craft:
- Write like a thoughtful practitioner, not a content mill: a sharp opening hook (a concrete situation, question or surprising fact from the source), then clear reasoning, worked examples, trade-offs and opinions backed by reasons.
- Explain "why" as well as "how". Use short paragraphs, varied sentence length, plain words. One idea per paragraph.
- Offer something original: a checklist, a decision framework, a short code or config example (safe and defensive), a common mistake and its fix.
- Never use these clichés: ${CLICHES.join(', ')}.

Rules you must follow:
- Accuracy first. For facts about this specific news item, rely only on the source material. If a detail is not in it, do not state it. Never invent statistics, quotes, dates, prices, version numbers, customers or case studies.
- Never claim the author did, built, tested or experienced anything that is not in the author profile or project list below. You may connect the topic to his real projects, linking them.
- No politics, religion, health or financial advice, and nothing defamatory: do not criticise named people; describe companies' products and incidents factually and fairly.
- Security topics: defence, detection and patching only. Never give exploitation steps, working attack code or ways to bypass security.
- Do not copy sentences from the source. Summarise in your own words and link it.
- Search-friendly but natural: the main keyword in the first paragraph and in one or two headings; related phrases where they fit; never keyword-stuff.
- Structure: hook paragraph, ## sections (with ### where useful), "## Key takeaways" (bullets), "## FAQ" (3 questions as ### headings with short answers), and a closing paragraph that invites readers to get in touch about this kind of work.
- Link 1–3 of the author's own pages where genuinely relevant (relative links exactly as given), and link the source(s) in the text.
- British English. About ${words} words.`;
}

function authorPages(ctx) {
  return [
    ...(ctx.projects || []).map((p) => `- Project "${p.title}" (${p.category}): /projects/${p.slug}/ — ${p.summary}`),
    ...(ctx.services || []).map((s) => `- Service "${s.title}": /services/${s.slug}/ — ${s.tagline || ''}`),
    '- Contact page: /contact/',
    '- Hire me page (for recruiters): /hire/',
  ].join('\n');
}

async function writeArticle(topic, ctx, settings, sourceText) {
  const today = new Date().toISOString().slice(0, 10);
  return ai({
    system: writerBrief(ctx, settings),
    prompt: (maxSource) => `Today is ${today}.

Author profile:
${ctx.profile?.headline || ''}
${(ctx.profile?.about || ctx.profile?.intro || '').slice(0, maxSource > 5000 ? 1800 : 700)}

Author's own pages you may link:
${authorPages(ctx).slice(0, maxSource > 5000 ? 4000 : 1200)}

Topic: ${topic.title || topic.keyword}
Main keyword: ${topic.keyword}
Suggested angle: ${topic.angle || 'your choice'}
Where it is trending: ${topic.source}${topic.context ? ' — ' + topic.context.slice(0, 400) : ''}
Source URL: ${topic.url || 'none'}

Source material (may be partial):
"""
${(sourceText || topic.context || 'No source text available. Write an evergreen explainer on the keyword without claiming any specific recent facts.').slice(0, maxSource)}
"""

Write the article and save it with the tool.`,
    tool: articleTool,
    maxTokens: 6000,
  });
}

const reviewTool = {
  name: 'save_review',
  description: 'Save your editorial review of the article.',
  input_schema: {
    type: 'object',
    properties: {
      safe: { type: 'boolean', description: 'True only if publishing it could not embarrass the author or cause legal, ethical or reputational trouble' },
      quality: { type: 'integer', minimum: 1, maximum: 10, description: 'How strongly it showcases the author as an expert writer (7 = good enough to publish)' },
      issues: { type: 'array', items: { type: 'string' }, description: 'Specific problems, most serious first' },
    },
    required: ['safe', 'quality', 'issues'],
  },
};

async function reviewArticle(article, topic, ctx, sourceText) {
  return ai({
    system:
      'You are a strict senior editor and risk reviewer for a professional portfolio blog. You protect the author’s reputation. Mark the article unsafe if it: states facts not supported by the source (for news), invents statistics, quotes or experiences, claims the author did something not in his profile, criticises or makes claims about named people, could be defamatory, gives medical, legal or financial advice, touches politics or religion, gives offensive-security instructions or working exploit code, copies the source, or contains anything offensive, discriminatory or sexual. Rate quality honestly: clarity, depth, originality, structure, usefulness, and whether it reads naturally (not like generic AI text).',
    prompt: (maxSource) => `Author profile: ${ctx.profile?.headline || ''}. ${(ctx.profile?.about || '').slice(0, 600)}
Author projects: ${(ctx.projects || []).map((p) => p.title).join('; ').slice(0, 800)}

Source material:
"""
${(sourceText || topic.context || 'none').slice(0, Math.min(maxSource, 4000))}
"""

Article to review:
TITLE: ${article.title}
${String(article.body).slice(0, maxSource > 5000 ? 14000 : 6000)}`,
    tool: reviewTool,
    maxTokens: 1200,
  });
}

async function reviseArticle(article, issues, topic, ctx, settings, sourceText) {
  return ai({
    system: writerBrief(ctx, settings),
    prompt: (maxSource) => `Your editor returned this draft with these problems:
- ${issues.join('\n- ')}

Rewrite it to fix every problem while keeping what works. Same rules as before.

Source material:
"""
${(sourceText || topic.context || 'none').slice(0, Math.min(maxSource, 4000))}
"""

Author's own pages you may link:
${authorPages(ctx).slice(0, 1500)}

Draft:
TITLE: ${article.title}
${String(article.body).slice(0, maxSource > 5000 ? 14000 : 5000)}

Save the improved article with the tool.`,
    tool: articleTool,
    maxTokens: 6000,
  });
}

function tidy(a, topic) {
  const body = String(a.body || '')
    .replace(/^# (.+)$/gm, '## $1')
    .trim();
  const words = body.split(/\s+/).length;
  if (words < 350) throw new Error(`Article too short (${words} words)`);
  const sources = [...(a.sources || [])];
  if (topic.url && !sources.some((s) => s.url === topic.url)) sources.unshift({ title: topic.title || topic.keyword, url: topic.url });
  return {
    ...a,
    body,
    title: String(a.title).slice(0, 120),
    meta_description: String(a.meta_description || '').slice(0, 170),
    keywords: (a.keywords || []).map((k) => String(k).toLowerCase()),
    tags: (a.tags || []).slice(0, 4),
    sources: sources.filter((s) => /^https?:\/\//.test(s.url)).slice(0, 8),
  };
}

/** Write, check, and if needed revise once. Returns the article with its review attached. */
async function produce(topic, ctx, settings) {
  const sourceText = await pageText(topic.url);
  let { out, by } = await writeArticle(topic, ctx, settings, sourceText);
  let article = tidy(out, topic);
  let review;
  for (let round = 1; round <= 2; round++) {
    const r = (await reviewArticle(article, topic, ctx, sourceText)).out;
    const problems = [...(r.issues || [])];
    const copy = copying(article.body, sourceText);
    if (copy.longest >= 18 || copy.share > 0.08) problems.unshift(`Copies the source too closely (${copy.longest} identical words in a row)`);
    if (isBanned(`${article.title} ${article.body}`)) problems.unshift('Touches an off-limits subject');
    const cliches = CLICHES.filter((c) => article.body.toLowerCase().includes(c));
    if (cliches.length) problems.push(`Uses clichés: ${cliches.join(', ')}`);
    const hardFail = problems.some((p) => /copies the source|off-limits/i.test(p));
    review = { safe: Boolean(r.safe) && !hardFail, quality: Number(r.quality) || 0, issues: problems };
    log(`review round ${round}: safe=${review.safe} quality=${review.quality} ${problems.slice(0, 3).join(' | ')}`);
    if ((review.safe && review.quality >= 7 && !cliches.length) || round === 2) break;
    const revised = await reviseArticle(article, problems, topic, ctx, settings, sourceText);
    article = tidy(revised.out, topic);
    by = revised.by;
  }
  return { ...article, review: { safe: review.safe, quality: review.quality, notes: review.issues.slice(0, 6).join('; '), model: by } };
}

// ---------------------------------------------------------------------------
// Test fixtures (WRITER_FAKE=1)
// ---------------------------------------------------------------------------
const fixtures = {
  candidates: [
    { source: 'hackernews', keyword: 'Passkeys roll out to more banks', title: 'Passkeys roll out to more UK banks', url: 'https://example.com/passkeys', context: '512 points', score: 512 },
    { source: 'google', keyword: 'premier league', title: 'Premier League results', url: '', context: '', score: 50000 },
    { source: 'google', keyword: 'election results', title: 'Election results tonight', url: '', context: '', score: 90000 },
    { source: 'security', keyword: 'CVE-2026-0001 Example Router', title: 'CVE-2026-0001: Example Router auth bypass', url: 'https://nvd.nist.gov/vuln/detail/CVE-2026-0001', context: 'Auth bypass in Example Router admin page.', score: 50 },
  ],
  reviews: 0,
  ai(name) {
    if (process.env.WRITER_FAKE_FAIL === name) throw new Error('Every AI provider failed: Claude: 400 Your credit balance is too low');
    if (name === 'save_topics')
      return { out: { topics: [{ index: 0, keyword: 'passkeys for banking', relevance: 86, angle: 'What passkeys mean for online banking security.' }, { index: 2, keyword: 'router authentication bypass', relevance: 72, angle: 'How to check and patch exposed router admin pages.' }] }, by: 'Fake' };
    if (name === 'suggest_topic') return { out: { keyword: 'secure php login forms', angle: 'A practical checklist.' }, by: 'Fake' };
    if (name === 'save_review') {
      this.reviews++;
      return { out: this.reviews % 2 === 1 ? { safe: true, quality: 6, issues: ['Opening is generic'] } : { safe: true, quality: 8, issues: [] }, by: 'Fake' };
    }
    return {
      out: {
        title: 'Passkeys for Banking: What Changes and Why It Matters',
        seo_title: 'Passkeys for Banking: What Changes in 2026',
        meta_description: 'Passkeys are replacing passwords at UK banks. Here is how they stop phishing, what changes for customers, and what small businesses should do next.',
        slug: 'passkeys-for-banking',
        excerpt: 'Passkeys are arriving at more banks. Here is what they are and why they matter.',
        tags: ['Cybersecurity', 'Authentication'],
        keywords: ['passkeys for banking', 'passwordless login', 'phishing protection', 'fido2'],
        body: '## Why passkeys matter\n\n' + 'Passkeys replace passwords with a key stored on your device. '.repeat(60) + '\n\n## Key takeaways\n\n- Passkeys resist phishing\n\n## FAQ\n\n### Are passkeys safe?\n\nYes.',
        sources: [{ title: 'Passkeys roll out', url: 'https://example.com/passkeys' }],
      },
      by: 'Fake writer',
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
  const morning = new Date().getUTCHours() < 13;

  // Morning runs (and "trends") refresh the topic list; evening runs do too if it is thin.
  if (mode === 'trends' || (mode === 'auto' && (morning || (ctx.candidates || []).length < 3))) {
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
    const today = Number(ctx.today_ai || 0);
    const room = mode === 'write' ? 1 : Math.max(0, MAX_PER_DAY - today);
    const perRun = Math.min(room, Math.max(1, Math.min(2, Number(settings['ai.per_run']) || 1)));
    if (!perRun) notes.push(`Already ${today} articles today; the daily limit is ${MAX_PER_DAY}.`);
    const min = Number(settings['ai.min_relevance']) || 60;
    const picks = [...(ctx.queued || []), ...(ctx.candidates || []).filter((c) => c.relevance >= min && !isBanned(c.keyword))].slice(0, perRun);
    // Nothing trending qualifies: keep the blog going with an evergreen topic
    if (perRun && !picks.length) {
      const t = await evergreenTopic(ctx, settings);
      await rpc('agent_save_topics', { p_topics: [t] });
      ctx = await rpc('agent_context', {});
      const fresh = (ctx.candidates || []).find((c) => c.keyword === t.keyword);
      if (fresh) picks.push(fresh);
      notes.push(`No trending topic qualified, so an evergreen topic was chosen: "${t.keyword}".`);
    }
    for (const topic of picks) {
      if (!(await rpc('agent_claim_topic', { p_topic_id: topic.id }))) continue;
      try {
        log(`writing: ${topic.keyword}`);
        const article = await produce(topic, ctx, settings);
        const saved = await rpc('agent_save_post', { p_topic_id: topic.id, p_post: article });
        written++;
        notes.push(
          saved.status === 'pending'
            ? `"${article.title}" passed review (${article.review.quality}/10, ${article.review.model}) and publishes automatically unless you hold it.`
            : `"${article.title}" needs your review: ${article.review.notes || 'flagged by the editor'}.`
        );
      } catch (e) {
        await rpc('agent_release_topic', { p_topic_id: topic.id }).catch(() => {});
        throw e;
      }
    }
  }
  if (failures.length && written) notes.push(`Fallbacks used: ${[...new Set(failures.map((f) => f.split(':')[0]))].join(', ')} failed first.`);
  await rpc('agent_log', { p_run_id: runId, p_mode: mode, p_status: 'ok', p_topics: found, p_articles: written, p_summary: notes.join(' ') });
  log('done:', notes.join(' '));
} catch (e) {
  console.error('[writer] failed:', e.message);
  if (runId) await rpc('agent_log', { p_run_id: runId, p_mode: mode, p_status: 'failed', p_topics: found, p_articles: written, p_summary: [...notes, e.message].join(' ').slice(0, 1900) }).catch(() => {});
  process.exit(1);
}
