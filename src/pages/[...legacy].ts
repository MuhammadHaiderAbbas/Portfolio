// Addresses from the old site, so links already shared or indexed by Google keep working.
import type { APIRoute, GetStaticPaths } from 'astro';
import { url } from '../lib/paths';

const moved: Record<string, string> = {
  'index.html': '/',
  'resume.html': '/resume/',
  'portfolio.html': '/projects/',
  'blogs.html': '/blog/',
  'certs.html': '/certifications/',
  'contact.html': '/contact/',
  'project-detailed-03.html': '/projects/cybersecurity-lab-dvwa/',
  'project-details/project-detailed-01.html': '/projects/car-marketplace/',
  'project-details/project-detailed-02.html': '/projects/unity-tactical-fps/',
  'project-details/project-detailed-04.html': '/projects/family-haven-shopify/',
  'project-details/project-detailed-05.html': '/projects/ml-anomaly-detection/',
};

export const getStaticPaths: GetStaticPaths = () =>
  Object.entries(moved)
    .filter(([from]) => from !== 'index.html')
    .map(([from, to]) => ({ params: { legacy: from }, props: { to } }));

export const GET: APIRoute = ({ props }) => {
  const to = url(props.to as string);
  return new Response(
    `<!doctype html><meta charset="utf-8"><title>Moved</title><meta name="robots" content="noindex"><link rel="canonical" href="${to}"><meta http-equiv="refresh" content="0; url=${to}"><a href="${to}">This page has moved.</a>\n`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
  );
};
