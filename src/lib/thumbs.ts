import { existsSync } from 'node:fs';
import path from 'node:path';

/** srcset for an image when scripts/thumbs.mjs made a small copy of it, else undefined. */
export function srcsetFor(src: string | undefined, full: (p: string) => string): string | undefined {
  if (!src || !src.startsWith('/') || /^\/\//.test(src)) return undefined;
  const base = `/media/thumbs${src.replace(/\.(jpe?g|png)$/i, '.webp')}`;
  const sizes = [640, 1024]
    .map((w) => ({ w, p: base.replace(/\.webp$/i, `-${w}.webp`) }))
    .filter((x) => existsSync(path.join(process.cwd(), 'public', x.p)));
  if (!sizes.length) return undefined;
  return [...sizes.map((x) => `${full(x.p)} ${x.w}w`), `${full(src)} 1600w`].join(', ');
}
