import type { APIRoute } from 'astro';
import { url } from '../lib/paths';

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nDisallow: ${url('/admin/')}\n\nSitemap: ${new URL(url('/sitemap.xml'), site).href}\n`, {
    headers: { 'Content-Type': 'text/plain' },
  });
