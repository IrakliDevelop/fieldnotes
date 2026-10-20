import { describe, expect, it } from 'vitest';
import { docsNav } from './docs-nav';
import type { DocEntry } from './docs-nav';

const entry = (id: string, group: DocEntry['data']['group'], order: number): DocEntry => ({
  id,
  data: { title: `Title ${id}`, group, order },
});

const ENTRIES = [
  entry('layers', 'Guides', 2),
  entry('glossary', 'Reference', 1),
  entry('using-react', 'Start', 2),
  entry('tools', 'Guides', 1),
  entry('getting-started', 'Start', 1),
];

describe('docsNav', () => {
  it('orders groups Start, Guides, Reference and pages by order, with the fixed reference links last', () => {
    expect(docsNav(ENTRIES).groups).toEqual([
      {
        name: 'Start',
        items: [
          {
            slug: 'getting-started',
            title: 'Title getting-started',
            href: '/docs/getting-started/',
          },
          { slug: 'using-react', title: 'Title using-react', href: '/docs/using-react/' },
        ],
      },
      {
        name: 'Guides',
        items: [
          { slug: 'tools', title: 'Title tools', href: '/docs/tools/' },
          { slug: 'layers', title: 'Title layers', href: '/docs/layers/' },
        ],
      },
      {
        name: 'Reference',
        items: [
          { slug: 'glossary', title: 'Title glossary', href: '/docs/glossary/' },
          { slug: 'api', title: 'API reference', href: '/api/' },
          { slug: 'changelog', title: 'Changelog', href: '/changelog/' },
          { slug: 'roadmap', title: 'Roadmap', href: '/roadmap/' },
        ],
      },
    ]);
  });

  it('leaves out a group with no pages, but always lists Reference', () => {
    expect(docsNav([entry('getting-started', 'Start', 1)]).groups.map((g) => g.name)).toEqual([
      'Start',
      'Reference',
    ]);
  });

  it.each([
    ['getting-started', undefined, 'using-react'],
    ['using-react', 'getting-started', 'tools'],
    ['layers', 'tools', 'glossary'],
    ['glossary', 'layers', undefined],
  ])('prevNext(%s) crosses groups in nav order', (slug, prev, next) => {
    const { prev: p, next: n } = docsNav(ENTRIES).prevNext(slug);
    expect([p?.slug, n?.slug]).toEqual([prev, next]);
  });

  it('prevNext of a slug that is not a docs page is empty', () => {
    expect(docsNav(ENTRIES).prevNext('api')).toEqual({});
  });
});
