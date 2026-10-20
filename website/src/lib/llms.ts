import { exampleCode } from './directives';
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

const FENCE = /^\s*(```|~~~)/;
const LEAF = /^::(code|board)\{(.*)\}\s*$/;

const SUMMARY =
  'Field Notes is an infinite-canvas SDK for the browser: freehand pens, shapes, sticky notes, arrows and live HTML elements on one zoomable board. `@fieldnotes/core` is vanilla TypeScript; React bindings, a WebSocket sync client and server, Redis persistence and tabletop elements are separate packages.';

const OPTIONAL = [
  ['API reference', '/api/', 'TypeDoc pages for every export of every package.'],
  ['Changelog', '/changelog/', 'Every release with its date.'],
  ['Roadmap', '/roadmap/', 'What is built, what is next and what is not built yet.'],
] as const;

const siteRoot = ({ site, base }: SiteOptions) => new URL(base, site).href;

const attributesOf = (text: string) =>
  Object.fromEntries([...text.matchAll(/(\w+)="([^"]*)"/g)].map((m) => [m[1], m[2]]));

/** A docs page as plain Markdown: directives become code, a note line and blockquotes; links become absolute. */
export function toMarkdownTwin(
  page: { title: string; description: string; body: string },
  { examples, ...site }: TwinOptions,
): string {
  const root = siteRoot(site);
  const absolute = (url: string) => withBase(url, root);
  const out: string[] = [];
  let inFence = false;
  let inMargin = false;
  for (const raw of page.body.trim().split('\n')) {
    let line = raw;
    if (FENCE.test(line)) {
      inFence = !inFence;
    } else if (!inFence) {
      if (/^:::margin\b/.test(line)) {
        inMargin = true;
        continue;
      }
      if (inMargin && line.trim() === ':::') {
        inMargin = false;
        continue;
      }
      const leaf = LEAF.exec(line);
      if (leaf?.[1] === 'code') {
        const attrs = attributesOf(leaf[2] ?? '');
        const { lang, value } = exampleCode(examples, attrs.example, attrs.region, page.title);
        line = `\`\`\`${lang}\n${value}\n\`\`\``;
      } else if (leaf?.[1] === 'board') {
        line = '(A live board runs this example on the page.)';
      } else {
        line = line
          .replace(/\]\((\/[^)\s]*)/g, (_, url: string) => `](${absolute(url)}`)
          .replace(
            /^(\s*\[[^\]]+\]:\s*)(\/\S+)/,
            (_, label: string, url: string) => label + absolute(url),
          );
      }
    }
    for (const part of line.split('\n')) out.push(inMargin ? `> ${part}`.trimEnd() : part);
  }
  return `# ${page.title}\n\n${page.description}\n\n${out.join('\n')}\n`;
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
