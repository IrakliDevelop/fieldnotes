import type { Root } from 'mdast';
import { exampleCode, findExample, mapNodes } from './directives';
import type { Examples } from './directives';
import { withBase } from './paths';

/** Options for {@link remarkFieldnotes}. */
export interface RemarkFieldnotesOptions {
  base: string;
  examples: Examples;
}

const boardHtml = (example: string) =>
  `<figure class="live-board" data-live-board="${example}"><div class="live-board-frame">` +
  '<div class="board-placeholder" aria-hidden="true">' +
  '<svg viewBox="0 0 900 320" preserveAspectRatio="xMidYMid slice">' +
  '<path d="M120 200c40-60 100-90 160-70 50 18 70 70 130 60 60-10 90-80 160-70" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
  '<rect x="640" y="90" width="150" height="100" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>' +
  '</svg></div><div data-live-board-mount></div>' +
  '<button type="button" class="live-board-clear">Clear board</button></div>' +
  '<figcaption>A live board running the snippet above.</figcaption></figure>';

/** Renders `:::margin`, `::code` and `::board`, restores stray text directives and adds `base` to root-relative URLs. */
export function remarkFieldnotes({ base, examples }: RemarkFieldnotesOptions) {
  return (tree: Root, file: { path?: string; value: unknown }): void => {
    const where = file.path ?? 'Markdown';
    const source = String(file.value);
    mapNodes(tree, (node) => {
      const hasUrl = node.type === 'link' || node.type === 'image' || node.type === 'definition';
      if (hasUrl && node.url.startsWith('/')) node.url = withBase(node.url, base);
      if (node.type === 'textDirective') {
        // `word:thing` in prose is not a directive; give the author's text back.
        return {
          type: 'text',
          value: source.slice(node.position?.start.offset, node.position?.end.offset),
        };
      }
      if (node.type === 'leafDirective' && node.name === 'code') {
        return {
          type: 'code',
          ...exampleCode(
            examples,
            node.attributes?.example ?? undefined,
            node.attributes?.region ?? undefined,
            where,
          ),
        };
      }
      if (node.type === 'leafDirective' && node.name === 'board') {
        const example = node.attributes?.example ?? undefined;
        findExample(examples, example, where);
        return { type: 'html', value: boardHtml(String(example)) };
      }
      if (node.type === 'containerDirective' && node.name === 'margin') {
        node.data = { hName: 'aside', hProperties: { className: ['margin-note'] } };
      }
      return node;
    });
  };
}
