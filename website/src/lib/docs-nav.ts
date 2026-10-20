/** Docs sidebar groups, in display order. */
export const DOC_GROUPS = ['Start', 'Guides', 'Reference'] as const;

/** One of {@link DOC_GROUPS}. */
export type DocGroup = (typeof DOC_GROUPS)[number];

/** The fields of a `docs` collection entry the nav reads. */
export interface DocEntry {
  id: string;
  data: { title: string; group: DocGroup; order: number };
}

/** A sidebar link; `href` is root-relative, so callers add the base. */
export interface NavItem {
  slug: string;
  title: string;
  href: string;
}

/** The sidebar groups and the previous and next page of a docs page. */
export interface DocsNav {
  groups: { name: DocGroup; items: NavItem[] }[];
  prevNext(slug: string): { prev?: NavItem; next?: NavItem };
}

const REFERENCE_LINKS: NavItem[] = [
  { slug: 'api', title: 'API reference', href: '/api/' },
  { slug: 'changelog', title: 'Changelog', href: '/changelog/' },
  { slug: 'roadmap', title: 'Roadmap', href: '/roadmap/' },
];

/** Docs entries in nav order: by group, then `order`, then slug. */
export function orderDocs<T extends DocEntry>(entries: readonly T[]): T[] {
  return [...entries].sort(
    (a, b) =>
      DOC_GROUPS.indexOf(a.data.group) - DOC_GROUPS.indexOf(b.data.group) ||
      a.data.order - b.data.order ||
      a.id.localeCompare(b.id),
  );
}

const toItem = (entry: DocEntry): NavItem => ({
  slug: entry.id,
  title: entry.data.title,
  href: `/docs/${entry.id}/`,
});

/** Builds the docs sidebar; Reference always ends with the API reference, changelog and roadmap. */
export function docsNav(entries: readonly DocEntry[]): DocsNav {
  const ordered = orderDocs(entries);
  const pages = ordered.map(toItem);
  const groups = DOC_GROUPS.map((name) => ({
    name,
    items: [
      ...ordered.filter((entry) => entry.data.group === name).map(toItem),
      ...(name === 'Reference' ? REFERENCE_LINKS : []),
    ],
  })).filter((group) => group.items.length > 0);
  return {
    groups,
    prevNext(slug) {
      const index = pages.findIndex((page) => page.slug === slug);
      if (index === -1) return {};
      return { prev: pages[index - 1], next: pages[index + 1] };
    },
  };
}
