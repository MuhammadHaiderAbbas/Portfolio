import type { APIRoute } from 'astro';
import { getContent } from '../lib/content';
import { url } from '../lib/paths';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Every public page, with the date it last changed (so search engines re-crawl
// updates) and its main image (so it can appear in image search).
export const GET: APIRoute = async ({ site }) => {
  const { profile, projects, posts, certifications, services } = await getContent();
  const abs = (p: string) => new URL(url(p), site).href;
  const newest = (posts[0]?.updated_at || posts[0]?.published_on || '').slice(0, 10);
  type Entry = { path: string; lastmod?: string; image?: string; title?: string };
  const entries: Entry[] = [
    { path: '/', lastmod: newest, image: profile.photo_url, title: profile.name },
    { path: '/resume/' },
    { path: '/projects/' },
    { path: '/contact/' },
    { path: '/hire/' },
    { path: '/privacy/' },
    ...(certifications.length ? [{ path: '/certifications/' }] : []),
    ...(services.length ? [{ path: '/services/' }] : []),
    ...services.filter((s) => s.slug).map((s) => ({ path: `/services/${s.slug}/`, title: s.title })),
    ...(posts.length ? [{ path: '/blog/', lastmod: newest }] : []),
    ...projects.map((p) => ({ path: `/projects/${p.slug}/`, lastmod: (p as { updated_at?: string }).updated_at?.slice(0, 10), image: p.cover_url, title: p.title })),
    ...posts.map((p) => ({ path: `/blog/${p.slug}/`, lastmod: (p.updated_at || p.published_on || '').slice(0, 10), image: p.cover_url, title: p.title })),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${entries
  .map(
    (e) =>
      `  <url><loc>${abs(e.path)}</loc>${e.lastmod ? `<lastmod>${e.lastmod}</lastmod>` : ''}${
        e.image && e.image.startsWith('/') ? `<image:image><image:loc>${esc(abs(e.image))}</image:loc></image:image>` : ''
      }</url>`
  )
  .join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
