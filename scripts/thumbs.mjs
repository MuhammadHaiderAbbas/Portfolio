// Runs before `astro build`: makes 640px and 1024px-wide copies of every large image in
// public/img and public/media, saved under public/media/thumbs/. Listing cards
// use it via srcset, so phones download a fraction of the full image.
import { readdir, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const WIDTHS = [640, 1024];
const OUT = path.join('public', 'media', 'thumbs');
const roots = [path.join('public', 'img'), path.join('public', 'media')];

async function* walk(dir) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (path.resolve(full) !== path.resolve(OUT)) yield* walk(full);
    } else if (/\.(webp|jpe?g|png)$/i.test(e.name)) yield full;
  }
}

let made = 0;
for (const root of roots) {
  for await (const file of walk(root)) {
    const rel = path.relative('public', file).replace(/\.(jpe?g|png)$/i, '.webp');
    for (const WIDTH of WIDTHS) {
      const dest = path.join(OUT, rel.replace(/\.webp$/i, `-${WIDTH}.webp`));
      try {
        const [src, out] = await Promise.all([stat(file), stat(dest).catch(() => null)]);
        if (out && out.mtimeMs >= src.mtimeMs) continue;
        const meta = await sharp(file).metadata();
        if (!meta.width || meta.width <= WIDTH * 1.25) continue;
        await mkdir(path.dirname(dest), { recursive: true });
        await sharp(file).resize({ width: WIDTH }).webp({ quality: 76 }).toFile(dest);
        made++;
      } catch (e) {
        console.warn(`thumbs: skipped ${file} (${e.message})`);
      }
    }
  }
}
// JPEG share images (1200 wide) for project pictures and uploads: shown as link
// previews on LinkedIn, X, Facebook and WhatsApp.
for (const root of [path.join('public', 'img', 'projects'), path.join('public', 'img', 'posts'), path.join('public', 'media', 'uploads')]) {
  for await (const file of walk(root)) {
    const rel = path.relative('public', file).replace(/\.(webp|jpe?g|png)$/i, '');
    const dest = path.join(OUT, `${rel}-og.jpg`);
    try {
      const [src, out] = await Promise.all([stat(file), stat(dest).catch(() => null)]);
      if (out && out.mtimeMs >= src.mtimeMs) continue;
      await mkdir(path.dirname(dest), { recursive: true });
      await sharp(file).resize({ width: 1200, withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toFile(dest);
      made++;
    } catch (e) {
      console.warn(`thumbs: skipped share image for ${file} (${e.message})`);
    }
  }
}
console.log(`thumbs: ${made} new small image${made === 1 ? '' : 's'}`);
