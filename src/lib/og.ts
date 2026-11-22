import { existsSync } from 'node:fs';
import path from 'node:path';

const has = (p: string) => existsSync(path.join(process.cwd(), 'public', p));

/**
 * The best link-preview image for a page: a JPEG made for sharing when one exists
 * (every network shows JPEG; some do not show WebP), else the page's own image,
 * else the site's share card, else the profile photo.
 */
export function shareImage(image: string | undefined, fallback: string | undefined): string | undefined {
  if (image && image.startsWith('/media/og/') && !has(image)) image = undefined;
  if (image) {
    const cover = image.match(/^\/media\/covers\/(.+)\.webp$/);
    if (cover && has(`/media/og/post-${cover[1]}.jpg`)) return `/media/og/post-${cover[1]}.jpg`;
    const og = `/media/thumbs${image.replace(/\.(webp|jpe?g|png)$/i, '')}-og.jpg`;
    if (/^\/(img|media)\//.test(image) && has(og)) return og;
    return image;
  }
  if (has('/media/og/site.jpg')) return '/media/og/site.jpg';
  return fallback;
}

export const isShareCard = (p?: string) => Boolean(p && /\/media\/og\/.+\.jpg$/.test(p));
