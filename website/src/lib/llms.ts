import remarkDirective from 'remark-directive';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { unified } from 'unified';
import { exampleCode, mapNodes } from './directives';
import type { Examples } from './directives';
import { orderDocs } from './docs-nav';
import type { DocEntry } from './docs-nav';
import { withBase } from './paths';

interface SiteOptions {
  site: string;
  base: string;
}

type TwinOptions = SiteOptions & { examples: Examples };

/** A `docs` collection entry with the fields the twins read. */
export type LlmsEntry = DocEntry & { data: { description: string }; body?: string };

const BOARD_NOTE = '(A live board runs this example on the page.)';

const SUMMARY =
  'Field Notes is an infinite-canvas SDK for the browser: freehand pens, shapes, sticky notes, arrows and live HTML elements on one zoomable board. `@fieldnotes/core` is vanilla TypeScript; React, Vue and Svelte bindings, a WebSocket sync client and server, Redis persistence and tabletop elements are separate packages.';

const OPTIONAL = [
  ['API reference', '/api/', 'TypeDoc pages for every export of every package.'],
  ['Changelog', '/changelog/', 'Every release with its date.'],
  ['Roadmap', '/roadmap/', 'What is built, what is next and what is not built yet.'],
] as const;

const siteRoot = ({ site, base }: SiteOptions) => new URL(base, site).href;

// The page's parser (remark-parse plus remark-directive), so the twin accepts exactly what the page does.
const markdown = unified().use(remarkParse).use(remarkDirective).use(remarkStringify, {
  bullet: '-',
  rule: '-',
});

/** A docs page as plain Markdown: directives become code, a note line and blockquotes; URLs become absolute. */
export function toMarkdownTwin(
  page: { title: string; description: string; body: string },
  { examples, ...site }: TwinOptions,
): string {
  const root = siteRoot(site);
  const tree = markdown.parse(page.body);
  mapNodes(tree, (node) => {
    const hasUrl = node.type === 'link' || node.type === 'image' || node.type === 'definition';
    if (hasUrl && node.url.startsWith('/')) node.url = withBase(node.url, root);
    if (node.type === 'leafDirective' && node.name === 'code') {
      const { example, region } = node.attributes ?? {};
      return {
        type: 'code',
        ...exampleCode(examples, example ?? undefined, region ?? undefined, page.title),
      };
    }
    if (node.type === 'leafDirective' && node.name === 'board') {
      return { type: 'paragraph', children: [{ type: 'text', value: BOARD_NOTE }] };
    }
    if (node.type === 'containerDirective' && node.name === 'margin') {
      return { type: 'blockquote', children: node.children };
    }
    // Text directives stay: the page shows them as the literal text they were written as.
    if (node.type === 'leafDirective' || node.type === 'containerDirective') {
      throw new Error(`${page.title}: unknown directive ${node.name}`);
    }
    return node;
  });
  return `# ${page.title}\n\n${page.description}\n\n${markdown.stringify(tree)}`;
}

/** `/llms.txt`: a summary, every docs twin in nav order, then the API reference, changelog and roadmap. */
export function llmsTxt(entries: readonly LlmsEntry[], site: SiteOptions): string {
  const root = siteRoot(site);
  const docs = orderDocs(entries).map(
    ({ id, data }) => `- [${data.title}](${withBase(`/docs/${id}.md`, root)}): ${data.description}`,
  );
  const optional = OPTIONAL.map(
    ([title, path, summary]) => `- [${title}](${withBase(path, root)}): ${summary}`,
  );
  return `# Field Notes\n\n> ${SUMMARY}\n\n## Docs\n\n${docs.join('\n')}\n\n## Optional\n\n${optional.join('\n')}\n`;
}

/** `/llms-full.txt`: every docs twin in nav order. */
export function llmsFullTxt(entries: readonly LlmsEntry[], opts: TwinOptions): string {
  const twins = orderDocs(entries).map((entry) =>
    toMarkdownTwin({ ...entry.data, body: entry.body ?? '' }, opts).trimEnd(),
  );
  return `${twins.join('\n\n---\n\n')}\n`;
}
