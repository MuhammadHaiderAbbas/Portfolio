import type { APIRoute } from 'astro';
import { getContent } from '../lib/content';
import { url } from '../lib/paths';

const esc = (s = '') => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Article feed for readers, LinkedIn/Feedly and search engines.
export const GET: APIRoute = async ({ site }) => {
  const { profile, posts, text: t } = await getContent();
  const abs = (p: string) => new URL(url(p), site).href;
  const items = posts
    .slice(0, 30)
    .map((p) => {
      const link = abs(`/blog/${p.slug}/`);
      return `    <item>
      <title>${esc(p.title)}</title>
      <link>${link}</link>
      <guid isPermaLink="true">${link}</guid>
      <pubDate>${new Date(p.published_on + 'T09:00:00Z').toUTCString()}</pubDate>
      <description>${esc(p.meta_description || p.excerpt)}</description>
${p.tags.map((x) => `      <category>${esc(x)}</category>`).join('\n')}
${p.cover_url ? `      <enclosure url="${esc(abs(p.cover_url))}" type="image/${p.cover_url.endsWith('.png') ? 'png' : p.cover_url.endsWith('.jpg') ? 'jpeg' : 'webp'}" length="0"/>` : ''}
    </item>`;
    })
    .join('\n');
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${esc(`${profile.name}: ${t['blog.title']}`)}</title>
    <link>${abs('/blog/')}</link>
    <atom:link href="${abs('/rss.xml')}" rel="self" type="application/rss+xml"/>
    <description>${esc(t['blog.intro'])}</description>
    <language>en-gb</language>
${items}
  </channel>
</rss>`;
  return new Response(body, { headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
};
