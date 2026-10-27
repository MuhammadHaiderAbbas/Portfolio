import { defineConfig } from 'astro/config';

// SITE_URL and BASE_PATH are filled in by the deploy workflow from GitHub Pages, so the
// site works at the custom domain (base "/") and at username.github.io/Portfolio/.
const site = process.env.SITE_URL || 'https://personalportfolio.website';
const base = process.env.BASE_PATH || '/';

export default defineConfig({
  site,
  base,
  trailingSlash: 'ignore',
  build: {
    format: 'directory',
    inlineStylesheets: 'always',
  },
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
});
