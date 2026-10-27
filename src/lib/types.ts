import type { SiteText } from './site-text';

export interface LinkItem {
  label: string;
  url: string;
}

export interface Discipline {
  label: string;
  category: string;
}

export interface Profile {
  name: string;
  short_name: string;
  headline: string;
  intro: string;
  about: string;
  availability: string;
  location: string;
  email: string;
  phone: string;
  photo_url: string;
  cv_url: string;
  roles: string[];
  disciplines: Discipline[];
  socials: LinkItem[];
  seo_description: string;
}

export interface Project {
  slug: string;
  title: string;
  summary: string;
  category: string;
  tech: string[];
  cover_url: string;
  gallery: string[];
  body: string;
  live_url: string;
  repo_url: string;
  video_url: string;
  document_url: string;
  status: string;
  role: string;
  year: string;
  featured: boolean;
  published: boolean;
  sort_order: number;
  project_date: string | null;
}

export interface Post {
  slug: string;
  title: string;
  excerpt: string;
  cover_url: string;
  tags: string[];
  body: string;
  published: boolean;
  published_on: string;
}

export interface Certification {
  title: string;
  issuer: string;
  issued_label: string;
  summary: string;
  details: string;
  credential_url: string;
  image_url: string;
  sort_order: number;
  published: boolean;
}

export interface TimelineItem {
  kind: 'work' | 'education';
  title: string;
  organisation: string;
  period: string;
  description: string;
  sort_order: number;
  published: boolean;
}

export interface Skill {
  group_name: string;
  name: string;
  level: number | null;
  sort_order: number;
}

export interface Service {
  slug: string | null;
  title: string;
  icon: string;
  tagline: string;
  body: string;
  tools: string[];
  process: string[];
  delivery_time: string;
  related_category: string;
  description: string;
  price_label: string;
  price_note: string;
  features: string[];
  highlighted: boolean;
  sort_order: number;
  published: boolean;
}

export interface Stat {
  label: string;
  value: string;
  icon: string;
  sort_order: number;
}

export interface FocusArea {
  title: string;
  description: string;
  icon: string;
  sort_order: number;
}

export interface SiteContent {
  profile: Profile;
  projects: Project[];
  posts: Post[];
  certifications: Certification[];
  timeline: TimelineItem[];
  skills: Skill[];
  services: Service[];
  stats: Stat[];
  focus: FocusArea[];
  text: SiteText;
  source: 'supabase' | 'seed';
}
