import { describe, expect, it } from 'vitest';
import type { Examples } from './directives';
import { llmsFullTxt, llmsTxt, toMarkdownTwin } from './llms';

const EXAMPLES: Examples = {
  demo: {
    source: '// #region mount\nconst board = createBoard(el);\n// #endregion mount\n',
    lang: 'ts',
  },
  view: { source: '// #region app\nconst app = <Board />;\n// #endregion app\n', lang: 'tsx' },
};

const OPTS = { examples: EXAMPLES, site: 'https://iraklidevelop.github.io', base: '/fieldnotes/' };

const BODY = `
Read [layers](/docs/layers/) or [the site](https://example.com/).

::code{example="demo" region="mount"}

:::margin
Give the container a height.

It fills its parent.
:::

::board{example="demo"}

::code{example="view" region="app"}

\`\`\`md
::board{example="literal"} and [x](/kept/)
\`\`\`
`;

describe('toMarkdownTwin', () => {
  it('turns the frontmatter into a heading and each directive into plain Markdown', () => {
    expect(
      toMarkdownTwin(
        { title: 'Getting started', description: 'A board that saves.', body: BODY },
        OPTS,
      ),
    ).toBe(`# Getting started

A board that saves.

Read [layers](https://iraklidevelop.github.io/fieldnotes/docs/layers/) or [the site](https://example.com/).

\`\`\`ts
const board = createBoard(el);
\`\`\`

> Give the container a height.
>
> It fills its parent.

(A live board runs this example on the page.)

\`\`\`tsx
const app = <Board />;
\`\`\`

\`\`\`md
::board{example="literal"} and [x](/kept/)
\`\`\`
`);
  });

  it('makes links absolute at base / too', () => {
    expect(
      toMarkdownTwin(
        { title: 'T', description: 'D.', body: '[a](/docs/a/)' },
        { ...OPTS, base: '/' },
      ),
    ).toBe('# T\n\nD.\n\n[a](https://iraklidevelop.github.io/docs/a/)\n');
  });

  it('throws naming the page for an unknown example', () => {
    expect(() =>
      toMarkdownTwin(
        { title: 'T', description: 'D.', body: '::code{example="nope" region="x"}' },
        OPTS,
      ),
    ).toThrow('T: unknown example "nope"');
  });
});

const PAGES = [
  {
    id: 'layers',
    data: {
      title: 'Layers',
      description: 'Layers keep drawings apart.',
      group: 'Guides' as const,
      order: 1,
    },
    body: 'See [start](/docs/getting-started/).\n',
  },
  {
    id: 'getting-started',
    data: {
      title: 'Getting started',
      description: 'A board that saves.',
      group: 'Start' as const,
      order: 1,
    },
    body: '::code{example="demo" region="mount"}\n',
  },
];

describe('llmsTxt', () => {
  it('lists the docs twins in nav order, then the optional links', () => {
    expect(llmsTxt(PAGES, OPTS)).toBe(`# Field Notes

> Field Notes is an infinite-canvas SDK for the browser: freehand pens, shapes, sticky notes, arrows and live HTML elements on one zoomable board. \`@fieldnotes/core\` is vanilla TypeScript; React bindings, a WebSocket sync client and server, Redis persistence and tabletop elements are separate packages.

## Docs

- [Getting started](https://iraklidevelop.github.io/fieldnotes/docs/getting-started.md): A board that saves.
- [Layers](https://iraklidevelop.github.io/fieldnotes/docs/layers.md): Layers keep drawings apart.

## Optional

- [API reference](https://iraklidevelop.github.io/fieldnotes/api/): TypeDoc pages for every export of every package.
- [Changelog](https://iraklidevelop.github.io/fieldnotes/changelog/): Every release with its date.
- [Roadmap](https://iraklidevelop.github.io/fieldnotes/roadmap/): What is built, what is next and what is not built yet.
`);
  });
});

describe('llmsFullTxt', () => {
  it('joins every twin in nav order with a rule', () => {
    expect(llmsFullTxt(PAGES, OPTS)).toBe(`# Getting started

A board that saves.

\`\`\`ts
const board = createBoard(el);
\`\`\`

---

# Layers

Layers keep drawings apart.

See [start](https://iraklidevelop.github.io/fieldnotes/docs/getting-started/).
`);
  });
});
