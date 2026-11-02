// Runs before `astro build`. Makes a branded cover image (1200×630 WebP) for every
// published blog post that has no cover of its own, so AI-written articles look
// finished and share well on LinkedIn, X and WhatsApp. Covers are saved to
// public/media/covers/<slug>.webp; existing files are kept.
import { mkdir, readFile, access } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const W = 1200;
const H = 630;
const OUT = path.join('public', 'media', 'covers');
const FONT_BOLD = path.resolve('scripts/fonts/Tinos_700Bold.ttf');
const FONT_ITALIC = path.resolve('scripts/fonts/Tinos_400Regular_Italic.ttf');

let fileCfg = {};
try {
  fileCfg = JSON.parse(await readFile('supabase.config.json', 'utf8'));
} catch {}
const HOST = (() => {
  try {
    return new URL(process.env.SITE_URL || 'https://personalportfolio.website').host;
  } catch {
    return 'personalportfolio.website';
  }
})();
let AUTHOR = 'Muhammad Haider Abbas';
const url = (process.env.PUBLIC_SUPABASE_URL || fileCfg.url || '').replace(/\/$/, '');
const key = process.env.PUBLIC_SUPABASE_ANON_KEY || fileCfg.anonKey || '';

async function loadPosts() {
  if (url && key && process.env.CONTENT_SOURCE !== 'seed') {
    const prof = await fetch(`${url}/rest/v1/profile?id=eq.1&select=name`, { headers: { apikey: key } }).then((r) => (r.ok ? r.json() : [])).catch(() => []);
    if (prof[0]?.name) AUTHOR = prof[0].name;
    const res = await fetch(`${url}/rest/v1/posts?published=eq.true&select=slug,title,tags,cover_url`, { headers: { apikey: key } });
    if (!res.ok) throw new Error(`covers: posts request failed (${res.status})`);
    return res.json();
  }
  const seed = JSON.parse(await readFile('src/data/seed.json', 'utf8'));
  return seed.posts.filter((p) => p.published !== false);
}

// Motif per topic, from the post's tags
const motifs = [
  [/secur|hack|cyber|cve|vuln|phish|auth|privacy|passkey/i, 'shield', '<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'],
  [/game|unity|unreal|play/i, 'gamepad', '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 6.3A3 3 0 0 0 5 18c1 0 1.9-.5 2.4-1.3L9 15h6l1.6 1.7A3 3 0 0 0 19 18a3 3 0 0 0 3-3.1l-.7-6.3A4 4 0 0 0 17.3 5Z"/>'],
  [/3d|blender|vfx|animat|video|render/i, 'cube', '<path d="M21 16V8a2 2 0 0 0-1-1.7l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.7l7 4a2 2 0 0 0 2 0l7-4a2 2 0 0 0 1-1.7Z"/><path d="m3.3 7 8.7 5 8.7-5M12 22V12"/>'],
  [/\bai\b|machine|ml|llm|model|data|neural/i, 'brain', '<path d="M12 5a3 3 0 1 0-6 .1A4 4 0 0 0 4 12a4 4 0 0 0 2 6 3 3 0 0 0 6 0V5Z"/><path d="M12 5a3 3 0 1 1 6 .1A4 4 0 0 1 20 12a4 4 0 0 1-2 6 3 3 0 0 1-6 0"/>'],
  [/shop|commerce|business|market|seo|brand|career/i, 'chart', '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 6-6"/>'],
];
const fallbackMotif = ['code', '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>'];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const hash = (s) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function background(slug, motifPath) {
  const h = hash(slug);
  // A slowly varying hue around the brand blue, so covers differ but stay on brand
  const hue = 208 + (h % 22) - 6;
  const pts = [];
  const n = 260;
  const R = 230;
  const cx = 965;
  const cy = 300;
  const rot = (h % 360) * (Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = i * 2.399963 + rot;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;
    // tilt
    const yy = y * Math.cos(0.4) - z * Math.sin(0.4);
    const zz = y * Math.sin(0.4) + z * Math.cos(0.4);
    const depth = (zz + 1) / 2;
    pts.push(`<circle cx="${(cx + x * R).toFixed(1)}" cy="${(cy + yy * R).toFixed(1)}" r="${(1.2 + depth * 2.4).toFixed(2)}" fill="#bfe1ff" fill-opacity="${(0.18 + depth * 0.7).toFixed(2)}"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${hue} 80% 9%)"/>
      <stop offset="0.55" stop-color="hsl(${hue} 85% 22%)"/>
      <stop offset="1" stop-color="hsl(${hue} 100% 44%)"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.8" cy="0.45" r="0.5">
      <stop offset="0" stop-color="#7cc2ff" stop-opacity="0.45"/>
      <stop offset="1" stop-color="#7cc2ff" stop-opacity="0"/>
    </radialGradient>
    <pattern id="grid" width="48" height="48" patternUnits="userSpaceOnUse">
      <path d="M48 0H0V48" fill="none" stroke="#ffffff" stroke-opacity="0.05"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <rect width="${W}" height="${H}" fill="url(#glow)"/>
  <circle cx="${cx}" cy="${cy}" r="${R + 34}" fill="none" stroke="#ffffff" stroke-opacity="0.12" stroke-width="2"/>
  ${pts.join('')}
  <g transform="translate(${cx - 46} ${cy - 46}) scale(3.85)" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${motifPath}</g>
  <rect x="80" y="86" width="56" height="3" fill="#7cc2ff"/>
</svg>`;
}

async function textImage(markup, font, fontfile, width) {
  return sharp({ text: { text: markup, font, fontfile, width, rgba: true, wrap: 'word', spacing: 6 } }).png().toBuffer();
}

async function cover(post) {
  const tag = (post.tags || [])[0] || 'Article';
  const [, , motifPath] = motifs.find(([re]) => re.test([post.title, ...(post.tags || [])].join(' '))) ?? [null, ...fallbackMotif];
  const base = sharp(Buffer.from(background(post.slug, motifPath)));
  // Title: shrink until it fits in four lines
  let title;
  for (const size of [64, 56, 50, 44]) {
    title = await textImage(`<span foreground="#ffffff">${esc(post.title)}</span>`, `Tinos Bold ${size}`, FONT_BOLD, 640);
    if ((await sharp(title).metadata()).height <= 330) break;
  }
  const kicker = await textImage(`<span foreground="#bfe1ff" letter_spacing="3000">${esc(tag.toUpperCase())}</span>`, 'Tinos Bold 20', FONT_BOLD, 640);
  const footer = await textImage(`<span foreground="#dbeeff">${esc(AUTHOR)} · ${esc(HOST)}</span>`, 'Tinos Italic 24', FONT_ITALIC, 700);
  const th = (await sharp(title).metadata()).height;
  const top = Math.max(150, Math.round((H - th) / 2) - 10);
  return base
    .composite([
      { input: kicker, left: 80, top: 110 },
      { input: title, left: 80, top },
      { input: footer, left: 80, top: H - 78 },
    ])
    .webp({ quality: 84 })
    .toBuffer();
}

// Preview one cover: COVERS_SAMPLE='{"slug":"x","title":"…","tags":["…"]}' COVERS_OUT=file.webp
if (process.env.COVERS_SAMPLE) {
  await sharp(await cover(JSON.parse(process.env.COVERS_SAMPLE))).toFile(process.env.COVERS_OUT || 'cover-sample.webp');
  process.exit(0);
}

const posts = await loadPosts();
await mkdir(OUT, { recursive: true });
let made = 0;
for (const p of posts) {
  if (p.cover_url || !p.slug) continue;
  const dest = path.join(OUT, `${p.slug}.webp`);
  try {
    await access(dest);
    if (!process.env.COVERS_FORCE) continue;
  } catch {}
  await sharp(await cover(p)).toFile(dest);
  made++;
}
console.log(`covers: ${made} new cover${made === 1 ? '' : 's'} for posts without their own image`);
