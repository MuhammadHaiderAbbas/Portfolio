// Describes every editable content type. The admin panel builds its lists and forms from this.
import { icons } from '../lib/icons';

const iconOptions = [{ value: '', label: 'No icon' }, ...Object.entries(icons).map(([value, i]) => ({ value, label: i.label }))];

export type FieldType =
  | 'lines'
  | 'level'
  | 'text'
  | 'textarea'
  | 'markdown'
  | 'url'
  | 'email'
  | 'image'
  | 'images'
  | 'file'
  | 'tags'
  | 'bool'
  | 'number'
  | 'date'
  | 'select'
  | 'pairs';

export interface Field {
  name: string;
  label: string;
  type: FieldType;
  help?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** For 'pairs': names and labels of the two sub-fields */
  pair?: [{ name: string; label: string }, { name: string; label: string }];
  /** Folder inside the media bucket for uploads */
  folder?: string;
  /** Suggestions shown under a text field (e.g. existing categories) */
  suggestFrom?: string;
}

export interface Section {
  key: string;
  table: string;
  label: string;
  singular: string;
  singleton?: boolean;
  titleField: string;
  subtitle?: (row: Record<string, any>) => string;
  order: { column: string; ascending: boolean }[];
  fields: Field[];
  defaults?: Record<string, unknown>;
  hasSlug?: boolean;
  publicPath?: (row: Record<string, any>) => string | null;
}

const published: Field = {
  name: 'published',
  label: 'Show on the website',
  type: 'bool',
  help: 'Switch off to keep it as a hidden draft.',
};
const sortOrder: Field = {
  name: 'sort_order',
  label: 'Position',
  type: 'number',
  help: 'Lower numbers appear first.',
};

export const sections: Section[] = [
  {
    key: 'profile',
    table: 'profile',
    label: 'Profile',
    singular: 'profile',
    singleton: true,
    titleField: 'name',
    order: [],
    publicPath: () => '/',
    fields: [
      { name: 'name', label: 'Full name', type: 'text', required: true },
      { name: 'short_name', label: 'Short name', type: 'text', help: 'Used in the header and page titles.' },
      { name: 'headline', label: 'Headline', type: 'text', help: 'One sentence under your name on the homepage.' },
      { name: 'intro', label: 'Introduction', type: 'textarea', help: 'Two or three sentences for the homepage and resume.' },
      { name: 'about', label: 'About', type: 'markdown', help: 'Longer About section. Markdown is supported.' },
      { name: 'roles', label: 'Role titles above your name', type: 'lines', help: 'One per line. They rotate on the homepage.' },
      { name: 'availability', label: 'Availability', type: 'text', help: 'Shown with a green dot. Leave empty to hide.' },
      { name: 'photo_url', label: 'Photo', type: 'image', folder: 'profile' },
      { name: 'cv_url', label: 'CV (PDF)', type: 'file', folder: 'cv' },
      { name: 'email', label: 'Email', type: 'email' },
      { name: 'phone', label: 'Phone', type: 'text' },
      { name: 'location', label: 'Location', type: 'text' },
      {
        name: 'socials',
        label: 'Social links',
        type: 'pairs',
        pair: [
          { name: 'label', label: 'Name' },
          { name: 'url', label: 'Link' },
        ],
      },
      {
        name: 'disciplines',
        label: 'Disciplines on the homepage',
        type: 'pairs',
        help: 'Each one links to the projects filtered by the matching project category.',
        pair: [
          { name: 'label', label: 'Label' },
          { name: 'category', label: 'Project category' },
        ],
      },
      { name: 'seo_description', label: 'Search engine description', type: 'textarea', help: 'About 155 characters shown in Google results.' },
    ],
  },
  {
    key: 'projects',
    table: 'projects',
    label: 'Projects',
    singular: 'project',
    titleField: 'title',
    subtitle: (r) => [r.category, r.featured ? 'Featured' : '', r.published ? '' : 'Draft'].filter(Boolean).join(', '),
    order: [
      { column: 'sort_order', ascending: true },
      { column: 'created_at', ascending: false },
    ],
    hasSlug: true,
    publicPath: (r) => (r.published ? `/projects/${r.slug}/` : null),
    defaults: { published: false, featured: false, sort_order: 100, tech: [], gallery: [] },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'Web address', type: 'text', required: true, help: 'Lowercase words joined by hyphens, e.g. my-new-game.' },
      { name: 'summary', label: 'Summary', type: 'textarea', help: 'One or two sentences for the project card.' },
      { name: 'category', label: 'Category', type: 'text', suggestFrom: 'category' },
      { name: 'tech', label: 'Tools and technologies', type: 'tags' },
      { name: 'cover_url', label: 'Cover image', type: 'image', folder: 'projects' },
      { name: 'body', label: 'Write-up', type: 'markdown' },
      { name: 'gallery', label: 'Screenshots', type: 'images', folder: 'projects' },
      { name: 'live_url', label: 'Live site link', type: 'url' },
      { name: 'repo_url', label: 'Code link', type: 'url' },
      { name: 'video_url', label: 'Video link', type: 'url', help: 'YouTube links show as a playable cover.' },
      { name: 'document_url', label: 'Report or documentation (PDF or Word)', type: 'file', folder: 'docs' },
      { name: 'role', label: 'My role', type: 'text', help: 'For example "Full-stack developer".' },
      { name: 'status', label: 'Status', type: 'text', help: 'For example "Live", "Academic project".' },
      { name: 'year', label: 'Year', type: 'text' },
      { name: 'project_date', label: 'Date (for sorting)', type: 'date' },
      { name: 'featured', label: 'Feature on the homepage', type: 'bool' },
      published,
      sortOrder,
    ],
  },
  {
    key: 'posts',
    table: 'posts',
    label: 'Blog posts',
    singular: 'post',
    titleField: 'title',
    subtitle: (r) => [r.published_on, r.published ? '' : 'Draft', r.ai_generated ? 'AI draft' : ''].filter(Boolean).join(', '),
    order: [{ column: 'published_on', ascending: false }],
    hasSlug: true,
    publicPath: (r) => (r.published ? `/blog/${r.slug}/` : null),
    defaults: { published: false, tags: [] },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'slug', label: 'Web address', type: 'text', required: true, help: 'Lowercase words joined by hyphens.' },
      { name: 'excerpt', label: 'Excerpt', type: 'textarea', help: 'Shown in the post list and in search results.' },
      { name: 'cover_url', label: 'Cover image', type: 'image', folder: 'posts' },
      { name: 'body', label: 'Post', type: 'markdown' },
      { name: 'tags', label: 'Tags', type: 'tags' },
      { name: 'published_on', label: 'Date', type: 'date' },
      { name: 'seo_title', label: 'Search result title', type: 'text', help: '50–60 characters. Leave empty to use the title.' },
      { name: 'meta_description', label: 'Search result description', type: 'textarea', help: '140–158 characters: what the reader gets and why to click. Leave empty to use the excerpt.' },
      { name: 'keywords', label: 'Keywords', type: 'tags', help: 'Main search phrase first, then related ones.' },
      {
        name: 'sources',
        label: 'Sources',
        type: 'pairs',
        help: 'Listed under the article. The AI writer fills these in.',
        pair: [
          { name: 'title', label: 'Title' },
          { name: 'url', label: 'Link' },
        ],
      },
      published,
    ],
  },
  {
    key: 'certifications',
    table: 'certifications',
    label: 'Certifications',
    singular: 'certification',
    titleField: 'title',
    subtitle: (r) => [r.issuer, r.issued_label, r.published ? '' : 'Hidden'].filter(Boolean).join(', '),
    order: [{ column: 'sort_order', ascending: true }],
    publicPath: () => '/certifications/',
    defaults: { published: true, sort_order: 100 },
    fields: [
      { name: 'title', label: 'Name', type: 'text', required: true },
      { name: 'issuer', label: 'Issued by', type: 'text' },
      { name: 'issued_label', label: 'Date', type: 'text', help: 'For example "2025" or "January 2023".' },
      { name: 'summary', label: 'Summary', type: 'textarea', help: 'One or two sentences on the card.' },
      { name: 'details', label: 'More detail', type: 'markdown', help: 'Shown when a visitor opens "More detail". For example what you learnt and how you use it.' },
      { name: 'image_url', label: 'Certificate image', type: 'image', folder: 'certs' },
      { name: 'credential_url', label: 'Verification link', type: 'url' },
      published,
      sortOrder,
    ],
  },
  {
    key: 'timeline',
    table: 'timeline',
    label: 'Experience & education',
    singular: 'entry',
    titleField: 'title',
    subtitle: (r) => [r.kind === 'education' ? 'Education' : 'Experience', r.organisation, r.period].filter(Boolean).join(', '),
    order: [
      { column: 'kind', ascending: false },
      { column: 'sort_order', ascending: true },
    ],
    publicPath: () => '/resume/',
    defaults: { kind: 'work', published: true, sort_order: 100 },
    fields: [
      {
        name: 'kind',
        label: 'Type',
        type: 'select',
        options: [
          { value: 'work', label: 'Experience' },
          { value: 'education', label: 'Education' },
        ],
      },
      { name: 'title', label: 'Role or qualification', type: 'text', required: true },
      { name: 'organisation', label: 'Organisation', type: 'text' },
      { name: 'period', label: 'Dates', type: 'text', help: 'For example "2023 – present".' },
      { name: 'description', label: 'Description', type: 'markdown' },
      published,
      sortOrder,
    ],
  },
  {
    key: 'skills',
    table: 'skills',
    label: 'Skills',
    singular: 'skill',
    titleField: 'name',
    subtitle: (r) => r.group_name,
    order: [
      { column: 'group_name', ascending: true },
      { column: 'sort_order', ascending: true },
    ],
    publicPath: () => '/resume/',
    defaults: { published: true, sort_order: 100, group_name: 'Technical skills', level: null },
    fields: [
      { name: 'name', label: 'Skill', type: 'text', required: true },
      { name: 'group_name', label: 'Group', type: 'text', suggestFrom: 'group_name' },
      { name: 'level', label: 'Level (%)', type: 'level', help: 'Shows a bar. Leave empty to show the skill as a tag instead.' },
      published,
      sortOrder,
    ],
  },
  {
    key: 'services',
    table: 'services',
    label: 'Services',
    singular: 'service',
    titleField: 'title',
    subtitle: (r) => [r.highlighted ? 'Highlighted' : '', r.published ? '' : 'Hidden'].filter(Boolean).join(', '),
    order: [{ column: 'sort_order', ascending: true }],
    hasSlug: true,
    publicPath: (r) => (r.published && r.slug ? `/services/${r.slug}/` : '/services/'),
    defaults: { published: true, sort_order: 100, features: [], tools: [], process: [], price_label: 'Custom', price_note: 'per project', highlighted: false, icon: 'code' },
    fields: [
      { name: 'title', label: 'Service', type: 'text', required: true },
      { name: 'slug', label: 'Web address', type: 'text', required: true, help: 'Lowercase words joined by hyphens, e.g. web-systems.' },
      { name: 'icon', label: 'Icon', type: 'select', options: iconOptions },
      { name: 'tagline', label: 'Tagline', type: 'text', help: 'One sentence shown under the title.' },
      { name: 'price_label', label: 'Price', type: 'text', help: 'A plain number like 500 gets the currency from Site text & settings. Or write "Custom", "From £250", "35%".' },
      { name: 'price_note', label: 'Price note', type: 'text', help: 'For example "per project".' },
      { name: 'delivery_time', label: 'Typical delivery time', type: 'text', help: 'For example "2–6 weeks".' },
      { name: 'description', label: 'Short description', type: 'textarea', help: 'Shown on the service cards.' },
      { name: 'features', label: "What's included", type: 'lines', help: 'One per line.' },
      { name: 'body', label: 'Full write-up', type: 'markdown', help: 'Shown on the service page: your approach, examples and who it suits.' },
      { name: 'process', label: 'How I work (steps)', type: 'lines', help: 'One step per line, in order. Start with a short name and a colon, e.g. "Scope: agree the goals".' },
      { name: 'tools', label: 'Tools', type: 'tags' },
      { name: 'related_category', label: 'Related project category', type: 'text', suggestFrom: 'related_category', help: 'Projects in this category are shown on the service page.' },
      { name: 'highlighted', label: 'Highlight this card', type: 'bool' },
      published,
      sortOrder,
    ],
  },
  {
    key: 'stats',
    table: 'stats',
    label: 'Snapshot numbers',
    singular: 'number',
    titleField: 'label',
    subtitle: (r) => [r.value, r.published ? '' : 'Hidden'].filter(Boolean).join(', '),
    order: [{ column: 'sort_order', ascending: true }],
    publicPath: () => '/',
    defaults: { published: true, sort_order: 100, icon: 'monitor' },
    fields: [
      { name: 'label', label: 'Label', type: 'text', required: true, help: 'For example "Core projects".' },
      { name: 'value', label: 'Number', type: 'text', help: 'For example "10+".' },
      { name: 'icon', label: 'Icon', type: 'select', options: iconOptions },
      published,
      sortOrder,
    ],
  },
  {
    key: 'focus',
    table: 'focus_areas',
    label: 'What I do',
    singular: 'block',
    titleField: 'title',
    subtitle: (r) => (r.published ? '' : 'Hidden'),
    order: [{ column: 'sort_order', ascending: true }],
    publicPath: () => '/',
    defaults: { published: true, sort_order: 100, icon: 'code' },
    fields: [
      { name: 'title', label: 'Title', type: 'text', required: true },
      { name: 'description', label: 'Description', type: 'textarea' },
      { name: 'icon', label: 'Icon', type: 'select', options: iconOptions },
      published,
      sortOrder,
    ],
  },
];
