import { describe, expect, it } from 'vitest';
import { absoluteUrl, canonicalUrl, softwareJsonLd } from './seo';

const ROOT = { site: 'https://fieldnotesjs.dev', base: '/' };
const NESTED = { site: 'https://fieldnotesjs.dev', base: '/fieldnotes/' };

describe('absoluteUrl', () => {
  it('joins a site path to the origin under the root base', () => {
    expect(absoluteUrl('/og.png', ROOT)).toBe('https://fieldnotesjs.dev/og.png');
  });
  it('includes a non-root base exactly once', () => {
    expect(absoluteUrl('/og.png', NESTED)).toBe('https://fieldnotesjs.dev/fieldnotes/og.png');
  });
});

describe('canonicalUrl', () => {
  it('keeps a page pathname that already includes the base', () => {
    expect(canonicalUrl('/fieldnotes/docs/layers/', NESTED.site)).toBe(
      'https://fieldnotesjs.dev/fieldnotes/docs/layers/',
    );
  });
  it('adds the trailing slash a page pathname is missing', () => {
    expect(canonicalUrl('/docs/layers', ROOT.site)).toBe('https://fieldnotesjs.dev/docs/layers/');
  });
  it('leaves a file pathname without a trailing slash', () => {
    expect(canonicalUrl('/og.png', ROOT.site)).toBe('https://fieldnotesjs.dev/og.png');
  });
  it('returns the origin with a slash for the home page', () => {
    expect(canonicalUrl('/', ROOT.site)).toBe('https://fieldnotesjs.dev/');
  });
});

describe('softwareJsonLd', () => {
  const parsed = (description: string) =>
    JSON.parse(softwareJsonLd({ url: 'https://fieldnotesjs.dev/', description })) as Record<
      string,
      unknown
    >;

  it('describes the project as MIT TypeScript source with its repository', () => {
    expect(parsed('A board.')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'SoftwareSourceCode',
      name: 'Field Notes',
      description: 'A board.',
      url: 'https://fieldnotesjs.dev/',
      codeRepository: 'https://github.com/IrakliDevelop/fieldnotes',
      programmingLanguage: 'TypeScript',
      license: 'https://opensource.org/licenses/MIT',
    });
  });
  it('cannot close the script element it is embedded in', () => {
    const json = softwareJsonLd({ url: 'https://fieldnotesjs.dev/', description: '</script>"&' });
    expect(json).not.toContain('</script');
    expect(parsed('</script>"&').description).toBe('</script>"&');
  });
});
