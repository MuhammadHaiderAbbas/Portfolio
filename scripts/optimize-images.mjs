// Converts images to right-sized WebP for the site.
// Usage: node scripts/optimize-images.mjs <input-file> <output-name> [maxWidth]
//        e.g. node scripts/optimize-images.mjs ~/Desktop/shot.png projects/my-game 1600
// Output lands in public/img/<output-name>.webp
// (Images uploaded through the admin panel are resized in the browser automatically.)
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const [input, name, maxWidth = '1600'] = process.argv.slice(2);
if (!input || !name) {
  console.error('Usage: node scripts/optimize-images.mjs <input> <output-name> [maxWidth]');
  process.exit(1);
}
const out = path.join('public', 'img', `${name}.webp`);
await mkdir(path.dirname(out), { recursive: true });
const info = await sharp(input)
  .rotate()
  .resize({ width: Number(maxWidth), withoutEnlargement: true })
  .webp({ quality: 78, effort: 5 })
  .toFile(out);
console.log(`${out}  ${info.width}x${info.height}  ${(info.size / 1024).toFixed(0)} KB`);
