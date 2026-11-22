import type { APIRoute } from 'astro';
import { getContent } from '../lib/content';
import { url } from '../lib/paths';

// Lets people install the site on their phone's home screen like an app.
export const GET: APIRoute = async () => {
  const { profile } = await getContent();
  const manifest = {
    name: `${profile.name} | Portfolio`,
    short_name: profile.short_name || profile.name.split(' ').slice(-2).join(' '),
    description: profile.seo_description || profile.intro,
    lang: 'en-GB',
    start_url: url('/'),
    scope: url('/'),
    display: 'standalone',
    background_color: '#041633',
    theme_color: '#007ced',
    categories: ['portfolio', 'technology', 'education'],
    icons: [
      { src: url('/icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
      { src: url('/icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
      { src: url('/icons/maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Projects', url: url('/projects/') },
      { name: 'Blog', url: url('/blog/') },
      { name: 'Hire me', url: url('/hire/') },
    ],
  };
  return new Response(JSON.stringify(manifest), { headers: { 'Content-Type': 'application/manifest+json' } });
};
