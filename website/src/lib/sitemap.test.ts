import { describe, expect, it } from 'vitest';
import { robotsTxt, sitePaths, sitemapXml } from './sitemap';

const ROOT = { site: 'https://fieldnotesjs.dev', base: '/' };
const NESTED = { site: 'https://fieldnotesjs.dev', base: '/fieldnotes/' };

describe('sitePaths', () => {
  it('lists the site pages with docs in the given order', () => {
    expect(sitePaths(['getting-started', 'layers'])).toEqual([
      '/',
      '/docs/',
      '/docs/getting-started/',
      '/docs/layers/',
      '/compare/',
      '/roadmap/',
      '/changelog/',
      '/playground/',
      '/api/',
    ]);
  });
  it('leaves out the dev demo, the 404 page and the Markdown twins', () => {
    const paths = sitePaths(['layers']);
    expect(paths.filter((path) => /^\/dev\/|404|\.md$/.test(path))).toEqual([]);
  });
});

describe('sitemapXml', () => {
  it('writes one absolute loc per path', () => {
    expect(sitemapXml(['/', '/docs/layers/'], ROOT)).toBe(
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
        '  <url><loc>https://fieldnotesjs.dev/</loc></url>\n' +
        '  <url><loc>https://fieldnotesjs.dev/docs/layers/</loc></url>\n' +
        '</urlset>\n',
    );
  });
  it('includes a non-root base exactly once', () => {
    expect(sitemapXml(['/docs/layers/'], NESTED)).toContain(
      '<loc>https://fieldnotesjs.dev/fieldnotes/docs/layers/</loc>',
    );
  });
  it('escapes an ampersand in a path', () => {
    expect(sitemapXml(['/a&b/'], ROOT)).toContain('<loc>https://fieldnotesjs.dev/a&amp;b/</loc>');
  });
});

describe('robotsTxt', () => {
  it('allows every crawler and names the sitemap under the base', () => {
    expect(robotsTxt(NESTED)).toBe(
      'User-agent: *\nAllow: /\n\nSitemap: https://fieldnotesjs.dev/fieldnotes/sitemap.xml\n',
    );
  });
});
