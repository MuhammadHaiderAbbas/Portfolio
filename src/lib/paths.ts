// The site can be served from the domain root (personalportfolio.website/) or from a
// GitHub Pages sub-address (username.github.io/Portfolio/). The build sets the base
// automatically; these helpers add it to every internal link and file path.
const BASE = (import.meta.env.BASE_URL ?? '/').replace(/\/$/, '');

const external = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/** Prefix a site path ("/projects/", "/img/x.webp") with the base. Leaves full URLs alone. */
export function url(path: string | null | undefined): string {
  if (!path) return '';
  if (external.test(path)) return path;
  const p = path.startsWith('/') ? path : `/${path}`;
  return BASE + p;
}

/** Add the base to root-relative links and images inside rendered Markdown. */
export function rebaseHtml(html: string): string {
  if (!BASE) return html;
  return html.replace(/(\s(?:src|href)=")\/(?!\/)/g, `$1${BASE}/`);
}

export const basePath = BASE;
