import type { SiteOptions } from './seo';
import { absoluteUrl } from './seo';

/** Indexable site paths; the dev demo, 404 page and Markdown twins stay out. */
export function sitePaths(docSlugs: readonly string[]): string[] {
  return [
    '/',
    '/docs/',
    ...docSlugs.map((slug) => `/docs/${slug}/`),
    '/roadmap/',
    '/changelog/',
    '/playground/',
    '/api/',
  ];
}

/** Sitemap XML with one absolute `<loc>` per path. */
export function sitemapXml(paths: readonly string[], opts: SiteOptions): string {
  const urls = paths.map((path) => {
    const loc = absoluteUrl(path, opts).replace(/&/g, '&amp;');
    return `  <url><loc>${loc}</loc></url>\n`;
  });
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    urls.join('') +
    '</urlset>\n'
  );
}

/** Robots file that allows every crawler and names the sitemap. */
export function robotsTxt(opts: SiteOptions): string {
  return `User-agent: *\nAllow: /\n\nSitemap: ${absoluteUrl('/sitemap.xml', opts)}\n`;
}
