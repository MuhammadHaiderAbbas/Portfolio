import type { APIRoute } from 'astro';
import { getContent } from '../lib/content';
import { url } from '../lib/paths';

export const GET: APIRoute = async ({ site }) => {
  const { projects, posts, certifications, services } = await getContent();
  const paths = [
    '/',
    '/resume/',
    '/projects/',
    '/contact/',
    '/hire/',
    '/privacy/',
    ...(certifications.length ? ['/certifications/'] : []),
    ...(services.length ? ['/services/'] : []),
    ...services.filter((s) => s.slug).map((s) => `/services/${s.slug}/`),
    ...(posts.length ? ['/blog/'] : []),
    ...projects.map((p) => `/projects/${p.slug}/`),
    ...posts.map((p) => `/blog/${p.slug}/`),
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${new URL(url(p), site).href}</loc></url>`).join('\n')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
};
