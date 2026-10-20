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

  it('makes links and images absolute at base / too', () => {
    expect(
      toMarkdownTwin(
        { title: 'T', description: 'D.', body: '[a](/docs/a/) ![b](/img/b.png)' },
        { ...OPTS, base: '/' },
      ),
    ).toBe(
      '# T\n\nD.\n\n[a](https://iraklidevelop.github.io/docs/a/) ![b](https://iraklidevelop.github.io/img/b.png)\n',
    );
  });

  it('turns an indented ::code inside a list item into a fence in that item', () => {
    const body = '1. Mount it.\n\n   ::code{example="demo" region="mount"}\n\n2. Draw.\n';
    expect(toMarkdownTwin({ title: 'T', description: 'D.', body }, OPTS)).toBe(
      '# T\n\nD.\n\n1. Mount it.\n\n   ```ts\n   const board = createBoard(el);\n   ```\n\n2. Draw.\n',
    );
  });

  it.each([
    ['unquoted', '::code{example=demo region=mount}'],
    ['single-quoted', "::code{example='demo' region='mount'}"],
  ])('reads %s directive attributes', (_, body) => {
    expect(toMarkdownTwin({ title: 'T', description: 'D.', body }, OPTS)).toBe(
      '# T\n\nD.\n\n```ts\nconst board = createBoard(el);\n```\n',
    );
  });

  it('keeps a text directive in prose as written', () => {
    expect(
      toMarkdownTwin({ title: 'T', description: 'D.', body: 'Meet at word:thing today.' }, OPTS),
    ).toBe('# T\n\nD.\n\nMeet at word:thing today.\n');
  });

  it.each([['::note{x="y"}'], [':::tip\nText.\n:::']])(
    'throws naming the page for the unknown directive %s',
    (body) => {
      expect(() => toMarkdownTwin({ title: 'T', description: 'D.', body }, OPTS)).toThrow(
        /^T: unknown directive (note|tip)$/,
      );
    },
  );

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
