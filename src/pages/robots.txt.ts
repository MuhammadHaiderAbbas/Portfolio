import type { APIRoute } from 'astro';
import { url } from '../lib/paths';

// Everyone may crawl the public site, including AI search assistants (they bring
// readers and cite sources). Private pages stay out.
export const GET: APIRoute = ({ site }) =>
  new Response(
    [
      'User-agent: *',
      `Disallow: ${url('/admin/')}`,
      `Disallow: ${url('/review/')}`,
      '',
      `Sitemap: ${new URL(url('/sitemap.xml'), site).href}`,
      '',
    ].join('\n'),
    { headers: { 'Content-Type': 'text/plain' } }
  );
