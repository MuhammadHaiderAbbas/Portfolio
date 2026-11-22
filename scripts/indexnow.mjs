// After a build: compares the new sitemap with the one currently live and lists the
// pages that are new or changed. The deploy workflow then sends that list to
// IndexNow (Bing, Yandex, Seznam, Naver; Bing also feeds DuckDuckGo, Yahoo and
// ChatGPT search), so they re-crawl those pages within hours.
//   node scripts/indexnow.mjs prepare dist   → prints changed URLs, one per line
//   node scripts/indexnow.mjs send < urls    → submits them
import { readFile } from 'node:fs/promises';

export const KEY = 'fcc02200242556ab9d93421a66495caf';
const [mode, dist = 'dist'] = process.argv.slice(2);

const entries = (xml) =>
  new Map([...String(xml).matchAll(/<url>\s*<loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)].map((m) => [m[1], m[2] || '']));

if (mode === 'prepare') {
  const next = entries(await readFile(`${dist}/sitemap.xml`, 'utf8'));
  const site = new URL([...next.keys()][0] || 'https://personalportfolio.website/').origin;
  let prev = new Map();
  try {
    const res = await fetch(`${site}/sitemap.xml`, { signal: AbortSignal.timeout(20000) });
    if (res.ok) prev = entries(await res.text());
  } catch {}
  const changed = [...next].filter(([u, mod]) => !prev.has(u) || prev.get(u) !== mod).map(([u]) => u);
  // A new or updated article also changes the homepage and blog list
  if (changed.some((u) => u.includes('/blog/'))) changed.push(`${site}/`, `${site}/blog/`);
  console.log([...new Set(changed)].slice(0, 500).join('\n'));
} else if (mode === 'send') {
  const urls = (await new Promise((r) => {
    let d = '';
    process.stdin.on('data', (c) => (d += c)).on('end', () => r(d));
  }))
    .split('\n')
    .map((s) => s.trim())
    .filter((s) => /^https:\/\//.test(s));
  if (!urls.length) {
    console.log('indexnow: nothing changed');
    process.exit(0);
  }
  const host = new URL(urls[0]).host;
  const res = await fetch('https://api.indexnow.org/indexnow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: KEY, keyLocation: `https://${host}/${KEY}.txt`, urlList: urls }),
  });
  console.log(`indexnow: sent ${urls.length} URL${urls.length === 1 ? '' : 's'} (HTTP ${res.status})`);
}
