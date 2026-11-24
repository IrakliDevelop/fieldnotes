import type { SiteOptions } from './llms';
import { withBase } from './paths';

export type { SiteOptions };

/** Resolves a site path such as `/og.png` to an absolute URL under the base. */
export function absoluteUrl(path: string, opts: SiteOptions): string {
  return new URL(withBase(path, opts.base), opts.site).href;
}

/** Absolute canonical URL for a pathname that already includes the base. */
export function canonicalUrl(pathname: string, site: string): string {
  const last = pathname.split('/').pop() ?? '';
  const path = pathname.endsWith('/') || last.includes('.') ? pathname : `${pathname}/`;
  return new URL(path, site).href;
}

/** JSON-LD for the project, safe to embed in a `<script type="application/ld+json">`. */
export function softwareJsonLd(opts: { url: string; description: string }): string {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'SoftwareSourceCode',
    name: 'Field Notes',
    description: opts.description,
    url: opts.url,
    codeRepository: 'https://github.com/IrakliDevelop/fieldnotes',
    programmingLanguage: 'TypeScript',
    license: 'https://opensource.org/licenses/MIT',
  };
  // A literal `<` could open `</script>` and end the element early.
  return JSON.stringify(data).replace(/</g, '\\u003c');
}
