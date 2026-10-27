// Runs before `astro build`. Copies every file uploaded through the admin panel
// (Supabase Storage, bucket "media") into public/media/, so the live site serves
// images from its own domain and keeps working even if Supabase is paused.
import { mkdir, writeFile, access, readFile } from 'node:fs/promises';
import path from 'node:path';

let fileCfg = {};
try {
  fileCfg = JSON.parse(await readFile('supabase.config.json', 'utf8'));
} catch {}
const url = (process.env.PUBLIC_SUPABASE_URL || fileCfg.url || '').replace(/\/$/, '');
const key = process.env.PUBLIC_SUPABASE_ANON_KEY || fileCfg.anonKey || '';
if (!url || !key || process.env.CONTENT_SOURCE === 'seed') {
  console.log('fetch-media: Supabase not configured, skipping');
  process.exit(0);
}

const tables = [
  'profile?select=*',
  'projects?published=eq.true&select=*',
  'posts?published=eq.true&select=*',
  'certifications?published=eq.true&select=*',
];
const prefix = `${url}/storage/v1/object/public/media/`;
const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const pattern = new RegExp(`${escaped}([^\\s"'()<>\\\\]+)`, 'g');

const found = new Set();
for (const t of tables) {
  const res = await fetch(`${url}/rest/v1/${t}`, { headers: { apikey: key } });
  if (!res.ok) throw new Error(`fetch-media: ${t} failed with ${res.status}`);
  for (const m of (await res.text()).matchAll(pattern)) found.add(decodeURIComponent(m[1]));
}

let copied = 0;
for (const file of found) {
  if (file.includes('..')) continue;
  const dest = path.join('public', 'media', file);
  try {
    await access(dest);
    continue;
  } catch {}
  const res = await fetch(prefix + file.split('/').map(encodeURIComponent).join('/'));
  if (!res.ok) {
    console.warn(`fetch-media: could not download ${file} (${res.status}); the page will link to Supabase instead`);
    continue;
  }
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, Buffer.from(await res.arrayBuffer()));
  copied++;
}
console.log(`fetch-media: ${found.size} uploaded files referenced, ${copied} downloaded`);
