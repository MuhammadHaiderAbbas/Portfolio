// Runs after `astro build`. Adds a Content-Security-Policy to every page: only
// this site's own scripts (and the exact inline scripts each page ships, by hash)
// may run, so injected code is blocked. Also sets a strict referrer policy.
// GitHub Pages cannot send HTTP headers, so these go in <meta> tags.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

const DIST = process.argv[2] || 'dist';
let cfg = {};
try {
  cfg = JSON.parse(await readFile('supabase.config.json', 'utf8'));
} catch {}
const sb = (process.env.PUBLIC_SUPABASE_URL || cfg.url || '').replace(/\/$/, '');
const sbWs = sb.replace(/^http/, 'ws');

async function* html(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* html(full);
    else if (e.name.endsWith('.html')) yield full;
  }
}

const hashOf = (s) => `'sha256-${createHash('sha256').update(s, 'utf8').digest('base64')}'`;
let pages = 0;
for await (const file of html(DIST)) {
  let doc = await readFile(file, 'utf8');
  if (/http-equiv="Content-Security-Policy"/i.test(doc)) continue;
  const isAdmin = file.includes(`${path.sep}admin${path.sep}`);
  // Inline scripts (not JSON data blocks) are allowed by their exact hash
  const hashes = new Set();
  for (const m of doc.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/gi)) {
    const attrs = m[1] || '';
    if (/\ssrc=/i.test(attrs) || /type="application\/(ld\+)?json"/i.test(attrs)) continue;
    if (m[2].trim()) hashes.add(hashOf(m[2]));
  }
  const connect = ["'self'", sb, sbWs, isAdmin ? 'https://api.github.com' : ''].filter(Boolean).join(' ');
  const policy = [
    "default-src 'self'",
    `script-src 'self' ${[...hashes].join(' ')}`.trim(),
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob: https:`,
    "font-src 'self'",
    `connect-src ${connect}`,
    "media-src 'self' https:",
    'frame-src https://www.youtube-nocookie.com https://www.youtube.com https://player.vimeo.com',
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "manifest-src 'self'",
    "worker-src 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
  const meta =
    `<meta http-equiv="Content-Security-Policy" content="${policy}">` +
    '<meta name="referrer" content="strict-origin-when-cross-origin">';
  const next = doc.replace(/<meta charset="[^"]*"\s*\/?>/i, (m) => m + meta);
  if (next === doc) {
    console.warn(`csp: no <meta charset> in ${file}, skipped`);
    continue;
  }
  await writeFile(file, next);
  pages++;
}
console.log(`csp: policy added to ${pages} page${pages === 1 ? '' : 's'}`);
