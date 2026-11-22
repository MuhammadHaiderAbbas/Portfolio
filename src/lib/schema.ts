// Structured data (schema.org JSON-LD) so search engines and AI assistants
// understand who you are and what each page is: a person, a project, a service,
// an article, a list. One Person node with a stable @id is referenced everywhere.
import type { Certification, Profile, Project, Service, Skill, TimelineItem } from './types';

type Ld = Record<string, unknown>;
const clean = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export function personId(site: URL | string): string {
  return new URL('/#person', site).href;
}

export function person(profile: Profile, site: URL, abs: (p: string) => string, skills: Skill[] = [], timeline: TimelineItem[] = []): Ld {
  const work = timeline.find((t) => t.kind === 'work');
  const study = timeline.filter((t) => t.kind === 'education');
  return clean({
    '@type': 'Person',
    '@id': personId(site),
    name: profile.name,
    alternateName: profile.short_name || undefined,
    url: abs('/'),
    image: profile.photo_url ? abs(profile.photo_url) : undefined,
    jobTitle: profile.roles?.[0] || profile.headline || undefined,
    description: profile.seo_description || profile.intro || undefined,
    email: profile.email ? `mailto:${profile.email}` : undefined,
    address: profile.location ? { '@type': 'PostalAddress', addressLocality: profile.location.split(',')[0].trim(), addressCountry: 'GB' } : undefined,
    sameAs: (profile.socials ?? []).map((s) => s.url).filter((u) => /^https?:\/\//.test(u)),
    knowsAbout: [...new Set(skills.map((s) => s.name).filter(Boolean))].slice(0, 30),
    worksFor: work?.organisation ? { '@type': 'Organization', name: work.organisation } : undefined,
    alumniOf: study.length ? study.map((s) => ({ '@type': 'EducationalOrganization', name: s.organisation })) : undefined,
  });
}

/** The homepage: a profile page about you. */
export function profilePage(personNode: Ld, abs: (p: string) => string): Ld {
  return { '@context': 'https://schema.org', '@type': 'ProfilePage', url: abs('/'), inLanguage: 'en-GB', mainEntity: personNode };
}

export function projectLd(p: Project, site: URL, abs: (p: string) => string): Ld {
  const code = Boolean(p.repo_url);
  return clean({
    '@context': 'https://schema.org',
    '@type': code ? 'SoftwareSourceCode' : 'CreativeWork',
    name: p.title,
    headline: p.title,
    description: p.summary,
    url: abs(`/projects/${p.slug}/`),
    image: p.cover_url ? abs(p.cover_url) : undefined,
    genre: p.category || undefined,
    keywords: (p.tech ?? []).join(', ') || undefined,
    dateCreated: p.project_date || (p.year ? String(p.year) : undefined),
    creativeWorkStatus: p.status || undefined,
    codeRepository: p.repo_url || undefined,
    programmingLanguage: code ? (p.tech ?? []).slice(0, 6) : undefined,
    sameAs: p.live_url || undefined,
    video: p.video_url ? { '@type': 'VideoObject', name: p.title, contentUrl: p.video_url, embedUrl: p.video_url, thumbnailUrl: p.cover_url ? abs(p.cover_url) : undefined, uploadDate: p.project_date || undefined, description: p.summary } : undefined,
    author: { '@id': personId(site) },
    creator: { '@id': personId(site) },
    inLanguage: 'en-GB',
  });
}

export function serviceLd(s: Service, site: URL, abs: (p: string) => string, currency = '£'): Ld {
  const price = String(s.price_label ?? '').replace(/[^0-9.]/g, '');
  return clean({
    '@context': 'https://schema.org',
    '@type': 'Service',
    name: s.title,
    description: s.tagline || s.description,
    url: s.slug ? abs(`/services/${s.slug}/`) : abs('/services/'),
    serviceType: s.title,
    provider: { '@id': personId(site) },
    areaServed: [{ '@type': 'Country', name: 'United Kingdom' }, 'Worldwide'],
    offers: price
      ? {
          '@type': 'Offer',
          price,
          priceCurrency: currency === '$' ? 'USD' : currency === '€' ? 'EUR' : 'GBP',
          description: [s.price_label, s.price_note].filter(Boolean).join(' '),
          availability: 'https://schema.org/InStock',
          url: s.slug ? abs(`/services/${s.slug}/`) : abs('/services/'),
        }
      : undefined,
  });
}

/** A listing page: the page itself plus an ordered list of what it links to. */
export function collectionLd(name: string, description: string, pageUrl: string, items: { url: string; name: string }[]): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name,
    description,
    url: pageUrl,
    inLanguage: 'en-GB',
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: items.length,
      itemListElement: items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, url: it.url, name: it.name })),
    },
  };
}

export function credentialsLd(certs: Certification[], site: URL): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    name: 'Certifications',
    itemListElement: certs.map((c, i) =>
      clean({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'EducationalOccupationalCredential',
          name: c.title,
          description: c.summary || undefined,
          credentialCategory: 'certificate',
          recognizedBy: c.issuer ? { '@type': 'Organization', name: c.issuer } : undefined,
          url: c.credential_url || undefined,
          about: { '@id': personId(site) },
        },
      })
    ),
  };
}

export function breadcrumbLd(crumbs: { name: string; url: string }[]): Ld {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: crumbs.map((c, i) => ({ '@type': 'ListItem', position: i + 1, name: c.name, item: c.url })),
  };
}
