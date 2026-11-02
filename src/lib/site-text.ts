// Every piece of fixed wording and every site setting, with its default.
// The database table `site_text` stores the values you edit in the admin panel
// (Admin → Site text & settings). Anything not in the database uses the default here,
// so new keys can be added without touching the database.

export type TextKind = 'text' | 'textarea' | 'bool' | 'color' | 'select';

export interface TextDef {
  key: string;
  group: string;
  label: string;
  value: string;
  kind?: TextKind;
  options?: { value: string; label: string }[];
  help?: string;
}

const on = 'true';

export const textDefs: TextDef[] = [
  // ---- Look and feel
  { group: 'Look and feel', key: 'theme.accent', label: 'Accent colour', value: '#007ced', kind: 'color' },
  {
    group: 'Look and feel',
    key: 'theme.default',
    label: 'Default colour theme',
    value: 'dark',
    kind: 'select',
    options: [
      { value: 'dark', label: 'Dark' },
      { value: 'light', label: 'Light' },
      { value: 'system', label: "Follow the visitor's device" },
    ],
    help: 'Visitors can still switch with the sun/moon button.',
  },
  { group: 'Look and feel', key: 'bg3d.enabled', label: 'Show the 3D background', value: on, kind: 'bool' },
  {
    group: 'Look and feel',
    key: 'bg3d.density',
    label: '3D background detail',
    value: 'medium',
    kind: 'select',
    options: [
      { value: 'low', label: 'Low (lightest on phones)' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  },
  { group: 'Look and feel', key: 'effects.tilt', label: '3D tilt on cards and photo', value: on, kind: 'bool' },
  { group: 'Look and feel', key: 'effects.roles', label: 'Rotate the role titles above your name', value: on, kind: 'bool' },

  // ---- Menu
  { group: 'Menu', key: 'nav.about', label: 'About link', value: 'About me' },
  { group: 'Menu', key: 'nav.resume', label: 'Resume link', value: 'Resume' },
  { group: 'Menu', key: 'nav.projects', label: 'Projects link', value: 'Portfolio' },
  { group: 'Menu', key: 'nav.services', label: 'Services link', value: 'Services' },
  { group: 'Menu', key: 'nav.blog', label: 'Blog link', value: 'Blog' },
  { group: 'Menu', key: 'nav.certifications', label: 'Certifications link', value: 'Certifications' },
  { group: 'Menu', key: 'nav.contact', label: 'Contact link', value: 'Contact' },
  { group: 'Menu', key: 'nav.show_blog', label: 'Show Blog in the menu', value: on, kind: 'bool', help: 'It only appears once a post is published.' },
  { group: 'Menu', key: 'nav.show_certifications', label: 'Show Certifications in the menu', value: on, kind: 'bool' },

  // ---- Homepage
  { group: 'Homepage', key: 'home.kicker', label: 'Small line above your name', value: 'Portfolio · Security · Web · Games · 3D' },
  { group: 'Homepage', key: 'home.scroll', label: 'Scroll hint (for screen readers)', value: 'Scroll to the content' },
  { group: 'Homepage', key: 'home.show_marquee', label: 'Show the moving strip of tools', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.marquee_title', label: 'Tools strip (for screen readers)', value: 'Tools I work with' },
  { group: 'Homepage', key: 'home.disciplines_title', label: 'Disciplines heading', value: 'Explore by discipline' },
  { group: 'Homepage', key: 'home.show_timeline', label: 'Show the experience timeline', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.timeline_title', label: 'Experience heading', value: 'Experience' },
  { group: 'Homepage', key: 'home.timeline_link', label: 'Link to the resume', value: 'Full resume' },
  { group: 'Homepage', key: 'home.services_popular', label: 'Highlighted service badge', value: 'Most popular' },
  { group: 'Homepage', key: 'home.cta_primary', label: 'Main button', value: 'View projects' },
  { group: 'Homepage', key: 'home.cta_cv', label: 'CV button', value: 'Download CV' },
  { group: 'Homepage', key: 'home.show_stats', label: 'Show the snapshot numbers', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.stats_title', label: 'Snapshot heading', value: 'Professional snapshot' },
  { group: 'Homepage', key: 'home.show_about', label: 'Show the About section', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.about_title', label: 'About heading', value: 'About me' },
  { group: 'Homepage', key: 'home.show_focus', label: 'Show "What I do"', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.focus_title', label: '"What I do" heading', value: 'What I do' },
  { group: 'Homepage', key: 'home.show_featured', label: 'Show featured projects', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.featured_title', label: 'Featured projects heading', value: 'Featured projects' },
  { group: 'Homepage', key: 'home.featured_all', label: 'Link to all projects', value: 'See all projects' },
  { group: 'Homepage', key: 'home.show_services', label: 'Show services', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.services_title', label: 'Services heading', value: 'Services' },
  { group: 'Homepage', key: 'home.services_button', label: 'Service card button', value: 'Contact me' },
  { group: 'Homepage', key: 'home.show_posts', label: 'Show latest blog posts', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.posts_title', label: 'Blog heading', value: 'Latest writing' },
  { group: 'Homepage', key: 'home.posts_all', label: 'Link to all posts', value: 'All posts' },
  { group: 'Homepage', key: 'home.show_cta', label: 'Show the closing call to action', value: on, kind: 'bool' },
  { group: 'Homepage', key: 'home.cta_title', label: 'Call to action heading', value: 'Have a role or a project in mind?' },
  { group: 'Homepage', key: 'home.cta_text', label: 'Call to action text', value: 'I reply to every message, usually within a day.', kind: 'textarea' },
  { group: 'Homepage', key: 'home.cta_button', label: 'Call to action button', value: 'Get in touch' },

  // ---- Resume
  { group: 'Resume page', key: 'resume.title', label: 'Page heading', value: 'Resume' },
  { group: 'Resume page', key: 'resume.intro', label: 'Introduction', value: 'Experience, education and skills across security, web systems, games, 3D and AI.', kind: 'textarea' },
  { group: 'Resume page', key: 'resume.cv_button', label: 'CV button', value: 'Download CV (PDF)' },
  { group: 'Resume page', key: 'resume.experience_title', label: 'Experience heading', value: 'Experience' },
  { group: 'Resume page', key: 'resume.education_title', label: 'Education heading', value: 'Education' },
  { group: 'Resume page', key: 'resume.skills_title', label: 'Skills heading', value: 'Skills' },
  { group: 'Resume page', key: 'resume.certs_title', label: 'Certifications heading', value: 'Certifications' },
  { group: 'Resume page', key: 'resume.certs_link', label: 'Link to certificates', value: 'View certificates' },

  // ---- Projects
  { group: 'Projects pages', key: 'projects.title', label: 'Page heading', value: 'Portfolio' },
  { group: 'Projects pages', key: 'projects.intro', label: 'Introduction', value: 'Security labs, web systems, games, 3D and video work, e-commerce and research.', kind: 'textarea' },
  { group: 'Projects pages', key: 'projects.filter_all', label: '"All" filter', value: 'All' },
  { group: 'Projects pages', key: 'projects.empty', label: 'When a filter has no projects', value: 'No projects in this category yet.' },
  { group: 'Projects pages', key: 'project.back', label: 'Back link on a project', value: 'Portfolio' },
  { group: 'Projects pages', key: 'project.live', label: 'Live site button', value: 'Visit the live site' },
  { group: 'Projects pages', key: 'project.code', label: 'Code button', value: 'View the code' },
  { group: 'Projects pages', key: 'project.video', label: 'Video button', value: 'Watch the video' },
  { group: 'Projects pages', key: 'project.document', label: 'Report button', value: 'Read the full report' },
  { group: 'Projects pages', key: 'project.role_label', label: '"Role" label', value: 'Role' },
  { group: 'Projects pages', key: 'project.status_label', label: '"Status" label', value: 'Status' },
  { group: 'Projects pages', key: 'project.year_label', label: '"Year" label', value: 'Year' },
  { group: 'Projects pages', key: 'project.gallery_title', label: 'Screenshots heading', value: 'Screenshots' },
  { group: 'Projects pages', key: 'project.related_title', label: 'Related projects heading', value: 'More projects like this' },

  // ---- Services
  { group: 'Services pages', key: 'services.title', label: 'Page heading', value: 'Services' },
  { group: 'Services pages', key: 'services.intro', label: 'Introduction', value: 'What I can build, design or test for you, how I work, and what it costs.', kind: 'textarea' },
  { group: 'Services pages', key: 'services.currency', label: 'Currency symbol', value: '£', help: 'Added in front of prices typed as plain numbers, like 500.' },
  { group: 'Services pages', key: 'services.view', label: 'Card link', value: 'See the details' },
  { group: 'Services pages', key: 'services.price_label', label: '"Price" label', value: 'Price' },
  { group: 'Services pages', key: 'services.delivery_label', label: '"Delivery" label', value: 'Typical delivery' },
  { group: 'Services pages', key: 'services.included_title', label: '"What\'s included" heading', value: "What's included" },
  { group: 'Services pages', key: 'services.process_title', label: '"How I work" heading', value: 'How I work' },
  { group: 'Services pages', key: 'services.tools_title', label: '"Tools" heading', value: 'Tools I use' },
  { group: 'Services pages', key: 'services.related_title', label: '"Related work" heading', value: 'Related work' },
  { group: 'Services pages', key: 'services.cta_title', label: 'Enquiry heading', value: 'Interested in this service?' },
  { group: 'Services pages', key: 'services.cta_text', label: 'Enquiry text', value: 'Tell me what you need and I will reply with a plan and a quote, usually within a day.', kind: 'textarea' },
  { group: 'Services pages', key: 'services.cta_button', label: 'Enquiry button', value: 'Ask about this service' },
  { group: 'Services pages', key: 'services.other_title', label: '"Other services" heading', value: 'Other services' },

  // ---- Lists (search, filters, grid and list view)
  { group: 'Lists and filters', key: 'list.search', label: 'Search box', value: 'Search' },
  { group: 'Lists and filters', key: 'list.all', label: '"All" filter', value: 'All' },
  { group: 'Lists and filters', key: 'list.grid', label: 'Grid view button', value: 'Grid' },
  { group: 'Lists and filters', key: 'list.list', label: 'List view button', value: 'List' },
  { group: 'Lists and filters', key: 'list.view_label', label: 'View switch (for screen readers)', value: 'Choose a layout' },
  { group: 'Lists and filters', key: 'list.filter_label', label: 'Filters (for screen readers)', value: 'Filter by category' },
  { group: 'Lists and filters', key: 'list.showing', label: 'Result count', value: 'Showing {shown} of {total}', help: '{shown} and {total} are filled in automatically.' },
  { group: 'Lists and filters', key: 'list.empty', label: 'When nothing matches', value: 'Nothing matches. Try another filter or search.' },

  // ---- Blog
  { group: 'Blog pages', key: 'blog.title', label: 'Page heading', value: 'Blog' },
  { group: 'Blog pages', key: 'blog.intro', label: 'Introduction', value: 'Write-ups and case studies from my security labs and projects.', kind: 'textarea' },
  { group: 'Blog pages', key: 'blog.empty', label: 'When there are no posts', value: 'No posts yet. The first write-up is on its way.' },
  { group: 'Blog pages', key: 'post.back', label: 'Back link on a post', value: 'Blog' },
  { group: 'Blog pages', key: 'post.toc', label: '"In this article" heading', value: 'In this article' },
  { group: 'Blog pages', key: 'post.sources', label: '"Sources" heading', value: 'Sources and further reading' },
  { group: 'Blog pages', key: 'post.ai_note', label: 'Note under AI-assisted articles', value: 'Researched and drafted with AI assistance from the sources above, then checked against my editorial standards.', kind: 'textarea', help: 'Leave empty to hide it.' },

  // ---- AI writer
  { group: 'AI writer', key: 'ai.enabled', label: 'Write articles automatically (morning and evening)', value: on, kind: 'bool', help: 'Turn off to stop scheduled writing. You can still write on demand from the AI writer page.' },
  {
    group: 'AI writer',
    key: 'ai.autopublish',
    label: 'Publish automatically if you do not respond',
    value: '60',
    kind: 'select',
    options: [
      { value: '0', label: 'Never: always wait for my approval' },
      { value: '30', label: 'After 30 minutes' },
      { value: '60', label: 'After 1 hour' },
      { value: '180', label: 'After 3 hours' },
      { value: '720', label: 'After 12 hours' },
    ],
    help: 'Only articles the safety editor passes with a quality score of 7/10 or more. You get an email with Publish now / Hold links. At most 3 automatic publishes a day.',
  },
  { group: 'AI writer', key: 'ai.days', label: 'Writing days', value: 'mon,tue,wed,thu,fri,sat,sun', help: 'Three-letter days, separated by commas: mon,tue,wed,thu,fri,sat,sun.' },
  {
    group: 'AI writer',
    key: 'ai.per_run',
    label: 'Articles per run (morning and evening)',
    value: '1',
    kind: 'select',
    options: [
      { value: '1', label: '1 (two a day)' },
      { value: '2', label: '2 (still at most two a day)' },
    ],
  },
  {
    group: 'AI writer',
    key: 'ai.length',
    label: 'Article length',
    value: '1200',
    kind: 'select',
    options: [
      { value: '800', label: 'Short (about 800 words)' },
      { value: '1200', label: 'Standard (about 1,200 words)' },
      { value: '1600', label: 'Long (about 1,600 words)' },
    ],
  },
  { group: 'AI writer', key: 'ai.min_relevance', label: 'Minimum topic relevance (0–100)', value: '60', help: 'Only topics scored at least this high are written automatically. Topics you queue by hand are always written.' },
  { group: 'AI writer', key: 'ai.focus', label: 'Your fields', value: 'Cybersecurity and ethical hacking; web development (PHP, MySQL, JavaScript); game development (Unity, Unreal); 3D, VFX and animation; AI and machine learning; e-commerce', kind: 'textarea' },
  { group: 'AI writer', key: 'ai.audience', label: 'Who the articles are for', value: 'Recruiters, hiring managers, small businesses and fellow developers in the UK', kind: 'textarea' },
  { group: 'AI writer', key: 'ai.tone', label: 'Writing style', value: 'Clear, practical and professional, in British English. Helpful rather than salesy.', kind: 'textarea' },

  // ---- Certifications
  { group: 'Certifications page', key: 'certs.title', label: 'Page heading', value: 'Certifications' },
  { group: 'Certifications page', key: 'certs.intro', label: 'Introduction', value: 'Courses and certificates in information security and ethical hacking.', kind: 'textarea' },
  { group: 'Certifications page', key: 'certs.verify', label: 'Verification link', value: 'Verify this credential' },
  { group: 'Certifications page', key: 'certs.more', label: '"More detail" toggle', value: 'What I learnt and how I use it' },
  { group: 'Certifications page', key: 'certs.empty', label: 'When there are none', value: 'No certifications are published yet.' },

  // ---- Contact
  { group: 'Contact page', key: 'contact.title', label: 'Page heading', value: 'Contact' },
  { group: 'Contact page', key: 'contact.intro', label: 'Introduction', value: 'Send a message about a role, a project or a question.', kind: 'textarea', help: 'Your availability line from the profile is used if this is empty.' },
  { group: 'Contact page', key: 'contact.email_label', label: 'Email label', value: 'Email' },
  { group: 'Contact page', key: 'contact.phone_label', label: 'Phone label', value: 'Phone and WhatsApp' },
  { group: 'Contact page', key: 'contact.location_label', label: 'Location label', value: 'Based in' },
  { group: 'Contact page', key: 'contact.social_label', label: 'Social links label', value: 'Elsewhere' },
  { group: 'Contact page', key: 'contact.form_title', label: 'Form heading', value: 'How can I help you?' },
  { group: 'Contact page', key: 'contact.name_field', label: 'Name field', value: 'Your name' },
  { group: 'Contact page', key: 'contact.email_field', label: 'Email field', value: 'Your email' },
  { group: 'Contact page', key: 'contact.subject_field', label: 'Subject field', value: 'Subject (optional)' },
  { group: 'Contact page', key: 'contact.message_field', label: 'Message field', value: 'Message' },
  { group: 'Contact page', key: 'contact.send', label: 'Send button', value: 'Send message' },
  { group: 'Contact page', key: 'contact.sent', label: 'After sending', value: 'Message sent. Thanks, I will reply soon.' },
  { group: 'Contact page', key: 'contact.failed', label: 'If sending fails', value: 'The message did not send. Try again, or email me directly.' },

  // ---- Hire me (recruiters)
  { group: 'Hire me page', key: 'hire.show', label: 'Show the Hire me page and button', value: on, kind: 'bool' },
  { group: 'Hire me page', key: 'nav.hire', label: 'Header button', value: 'Hire me' },
  { group: 'Hire me page', key: 'hire.title', label: 'Page heading', value: 'Hire me' },
  { group: 'Hire me page', key: 'hire.intro', label: 'Introduction', value: 'Recruiting for a role? Send the details here and they go straight to my dashboard. I reply to every company, usually within a day.', kind: 'textarea' },
  { group: 'Hire me page', key: 'hire.points', label: 'Why hire me (one per line)', value: 'Security testing, web systems and games, built end to end\nClear documentation and reports for every project\nBased in Birmingham, open to remote, hybrid and on-site roles\nAvailable for full-time, contract and freelance work', kind: 'textarea' },
  { group: 'Hire me page', key: 'hire.form_title', label: 'Form heading', value: 'Tell me about the role' },
  { group: 'Hire me page', key: 'hire.send', label: 'Send button', value: 'Send the opportunity' },
  { group: 'Hire me page', key: 'hire.sent', label: 'After sending', value: 'Thank you. Your opportunity has reached me and I will reply soon.' },
  { group: 'Hire me page', key: 'hire.failed', label: 'If sending fails', value: 'That did not send. Try again, or email me directly.' },
  { group: 'Hire me page', key: 'hire.link_help', label: 'Quick-apply help', value: 'Recruiters can pre-fill this form with a link like /hire/?company=Acme&role=Developer.', kind: 'textarea', help: 'Shown in small print under the form. Leave empty to hide it.' },

  // ---- Privacy and visit statistics
  { group: 'Privacy and statistics', key: 'analytics.enabled', label: 'Count visits for the dashboard', value: on, kind: 'bool', help: 'Cookie-free. Turn off to stop recording visits.' },
  { group: 'Privacy and statistics', key: 'footer.privacy', label: 'Footer privacy link', value: 'Privacy' },
  { group: 'Privacy and statistics', key: 'privacy.title', label: 'Privacy page heading', value: 'Privacy' },
  {
    group: 'Privacy and statistics',
    key: 'privacy.body',
    label: 'Privacy page text (Markdown)',
    kind: 'textarea',
    value: `## Visit statistics

This site counts visits so I can see which pages are useful. It does this without cookies and without storing your IP address.

For each page you open it records: the page address and title, the website you came from (only its name, such as google.com), your device type, browser and operating system, your language, your screen size, your device's **time zone** and how long the page stayed open. The time zone is used to show an approximate area (for example "London time zone, United Kingdom"); your exact location is never collected.

A random number kept only for the current browser tab links the pages you view in one visit. It disappears when you close the tab and cannot identify you.

Nothing is recorded if your browser sends **Do Not Track** or **Global Privacy Control**. Statistics are kept for up to 13 months and are never shared or sold.

## Messages and job opportunities

If you use the contact form or the Hire me form, what you type is stored so I can reply. Ask me at any time to see or delete it.

## Who looks after this data

The site is hosted on GitHub Pages and the data is stored with Supabase in London, UK. Contact me through the contact page with any privacy question.`,
  },

  // ---- Footer and other
  { group: 'Footer and other', key: 'footer.copyright', label: 'Copyright line', value: '© {year} {name}', help: '{year} and {name} are filled in automatically.' },
  { group: 'Footer and other', key: 'footer.about', label: 'Footer introduction', value: 'Security, web systems, games, 3D and AI: practical work, built and documented properly.', kind: 'textarea' },
  { group: 'Footer and other', key: 'footer.pages_title', label: '"Pages" heading', value: 'Pages' },
  { group: 'Footer and other', key: 'footer.contact_title', label: '"Contact" heading', value: 'Contact' },
  { group: 'Footer and other', key: 'footer.social_title', label: '"Elsewhere" heading', value: 'Elsewhere' },
  { group: 'Footer and other', key: 'footer.top', label: '"Back to top" link', value: 'Back to top' },
  { group: 'Footer and other', key: 'footer.cv_link', label: 'CV link', value: 'CV (PDF)' },
  { group: 'Footer and other', key: 'notfound.title', label: '"Page not found" heading', value: 'Page not found' },
  { group: 'Footer and other', key: 'notfound.text', label: '"Page not found" text', value: 'This page has moved or no longer exists.' },
  { group: 'Footer and other', key: 'notfound.button', label: '"Page not found" button', value: 'Go to the homepage' },
];

export type SiteText = Record<string, string>;

export function withDefaults(rows: { key: string; value: string }[] = []): SiteText {
  const out: SiteText = Object.fromEntries(textDefs.map((d) => [d.key, d.value]));
  for (const r of rows) if (r && typeof r.value === 'string' && r.key in out) out[r.key] = r.value;
  return out;
}

export const isOn = (t: SiteText, key: string) => t[key] === 'true';
