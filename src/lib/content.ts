// Loads all site content once per build.
// With a Supabase URL and public key (from environment variables or supabase.config.json),
// content comes from the database: published rows only. Without them, the site builds
// from src/data/seed.json, so it can deploy before Supabase is set up.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { marked } from 'marked';
import seed from '../data/seed.json';
import { rebaseHtml } from './paths';
import { withDefaults } from './site-text';
import type { SiteContent } from './types';

function fileConfig(): { url?: string; anonKey?: string } {
  try {
    return JSON.parse(readFileSync(path.join(process.cwd(), 'supabase.config.json'), 'utf8'));
  } catch {
    return {};
  }
}
const fc = fileConfig();
const SUPABASE_URL = (import.meta.env.PUBLIC_SUPABASE_URL || fc.url || '').replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || fc.anonKey || '';

async function rest<T>(query: string): Promise<T> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${query}`, {
    headers: { apikey: SUPABASE_KEY, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Supabase request failed for ${query}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const bySort = <T extends { sort_order?: number }>(a: T, b: T) => (a.sort_order ?? 0) - (b.sort_order ?? 0);
const live = <T extends { published?: boolean }>(rows: T[] = []) => rows.filter((r) => r.published !== false);

function fromSeed(): SiteContent {
  const s = seed as any;
  return {
    profile: s.profile,
    projects: live(s.projects).sort(bySort),
    posts: live<any>(s.posts).sort((a, b) => b.published_on.localeCompare(a.published_on)),
    certifications: live(s.certifications).sort(bySort),
    timeline: live(s.timeline).sort(bySort),
    skills: live(s.skills).sort(bySort),
    services: live(s.services).sort(bySort),
    stats: live(s.stats).sort(bySort),
    focus: live(s.focus_areas).sort(bySort),
    text: withDefaults(),
    source: 'seed',
  };
}

async function fromSupabase(): Promise<SiteContent> {
  const pub = 'published=eq.true&select=*';
  const [profiles, projects, posts, certifications, timeline, skills, services, stats, focus, text] = await Promise.all([
    rest<any[]>('profile?id=eq.1&select=*'),
    rest<any[]>(`projects?${pub}&order=sort_order.asc,project_date.desc.nullslast`),
    rest<any[]>(`posts?${pub}&order=published_on.desc`),
    rest<any[]>(`certifications?${pub}&order=sort_order.asc`),
    rest<any[]>(`timeline?${pub}&order=sort_order.asc`),
    rest<any[]>(`skills?${pub}&order=sort_order.asc`),
    rest<any[]>(`services?${pub}&order=sort_order.asc`),
    rest<any[]>(`stats?${pub}&order=sort_order.asc`),
    rest<any[]>(`focus_areas?${pub}&order=sort_order.asc`),
    rest<{ key: string; value: string }[]>('site_text?select=key,value'),
  ]);
  if (!profiles[0]) throw new Error('Supabase has no profile row. Run supabase/schema.sql first.');
  if (!projects.length && !profiles[0].name) {
    // Database set up but nothing imported yet: keep the site complete with the built-in content.
    console.warn('Supabase is empty; building from src/data/seed.json until content is imported in the admin panel.');
    return fromSeed();
  }
  return localiseMedia({
    profile: { roles: [], ...profiles[0] },
    projects,
    posts,
    certifications,
    timeline,
    skills,
    services,
    stats,
    focus,
    text: withDefaults(text),
    source: 'supabase',
  });
}

// Point uploaded-file links at the copies that scripts/fetch-media.mjs saved in public/media/.
function localiseMedia(content: SiteContent): SiteContent {
  const prefix = `${SUPABASE_URL}/storage/v1/object/public/media/`;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const json = JSON.stringify(content).replace(new RegExp(`${escaped}([^\\s"'()<>\\\\]+)`, 'g'), (whole, file) => {
    const local = path.join(process.cwd(), 'public', 'media', decodeURIComponent(file));
    return existsSync(local) ? `/media/${file}` : whole;
  });
  return withCovers(JSON.parse(json));
}

// Posts without their own image use the branded cover made by scripts/covers.mjs.
function withCovers(content: SiteContent): SiteContent {
  for (const p of content.posts) {
    if (!p.cover_url && existsSync(path.join(process.cwd(), 'public', 'media', 'covers', `${p.slug}.webp`))) {
      p.cover_url = `/media/covers/${p.slug}.webp`;
    }
  }
  return content;
}

let cached: Promise<SiteContent> | undefined;
let cachedAt = 0;

// CONTENT_SOURCE=seed builds from seed.json even when Supabase is configured (offline previews).
const forceSeed = process.env.CONTENT_SOURCE === 'seed';

export function getContent(): Promise<SiteContent> {
  // A production build reads the content once. The local preview (npm run dev) re-reads it
  // every few seconds, so edits saved in the admin panel show up on refresh.
  const stale = import.meta.env.DEV && Date.now() - cachedAt > 3000;
  if (!cached || stale) {
    cachedAt = Date.now();
    cached = SUPABASE_URL && SUPABASE_KEY && !forceSeed ? fromSupabase() : Promise.resolve(fromSeed());
    cached.catch(() => (cached = undefined));
  }
  return cached;
}

export const supabaseConfig = { url: SUPABASE_URL, key: SUPABASE_KEY };

export function md(text: string): string {
  return rebaseHtml(marked.parse(text ?? '', { async: false, gfm: true }) as string);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
}

export function youtubeId(link: string): string | null {
  const m = link?.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{11})/);
  return m ? m[1] : null;
}

export function projectCategories(projects: SiteContent['projects']): string[] {
  return [...new Set(projects.map((p) => p.category).filter(Boolean))];
}

/** A price typed as a plain number ("500", "1,250") gets the currency symbol in front. */
export function formatPrice(label: string, currency: string): string {
  const v = (label ?? '').trim();
  return /^\d[\d,.]*$/.test(v) ? `${currency}${v}` : v;
}

/** Group values and count them, for filter buttons. */
export function countBy(values: string[]): { value: string; label: string; count: number }[] {
  const m = new Map<string, number>();
  for (const v of values.filter(Boolean)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m.entries()].map(([value, count]) => ({ value, label: value, count }));
}

/** Fill {year} and {name} placeholders in editable text. */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (m, k) => vars[k] ?? m);
}
