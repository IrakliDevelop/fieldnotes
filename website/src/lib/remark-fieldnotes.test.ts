import { createMarkdownProcessor } from '@astrojs/markdown-remark';
import remarkDirective from 'remark-directive';
import { describe, expect, it } from 'vitest';
import type { Examples } from './directives';
import { remarkFieldnotes } from './remark-fieldnotes';

const EXAMPLES: Examples = {
  demo: {
    source: '// #region mount\nconst board = createBoard(el);\n// #endregion mount\n',
    lang: 'ts',
  },
  view: { source: '// #region app\nconst app = <Board />;\n// #endregion app\n', lang: 'tsx' },
};

async function render(markdown: string, base = '/'): Promise<string> {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, [remarkFieldnotes, { base, examples: EXAMPLES }]],
  });
  const { code } = await processor.render(markdown, {
    fileURL: new URL('file:///site/content/docs/page.md'),
  });
  return code;
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, '');

describe('remarkFieldnotes', () => {
  it('renders :::margin as an aside.margin-note', async () => {
    expect(await render(':::margin\nGive the container a height.\n:::')).toBe(
      '<aside class="margin-note"><p>Give the container a height.</p></aside>',
    );
  });

  it.each([
    ['demo', 'mount', 'ts', 'const board = createBoard(el);'],
    ['view', 'app', 'tsx', 'const app = <Board />;'],
  ])(
    'renders ::code{example="%s" region="%s"} as a %s block of the region',
    async (example, region, lang, code) => {
      const html = await render(`::code{example="${example}" region="${region}"}`);
      expect(html).toMatch(
        new RegExp(`^<pre class="astro-code[^"]*"[^>]* data-language="${lang}"`),
      );
      expect(textOf(html).replaceAll('&#x3C;', '<')).toBe(code);
    },
  );

  it('renders ::board as a live-board figure with a static placeholder, a mount, hidden board buttons and the caption', async () => {
    const html = await render('::board{example="demo"}');
    expect(html).toMatch(/^<figure class="live-board" data-live-board="demo">/);
    expect(html).toContain('<div class="board-placeholder" aria-hidden="true">');
    expect(html).toContain('<div data-live-board-mount=""></div>');
    expect(html).toContain(
      '<div class="live-board-actions"><button type="button" class="live-board-engage" hidden>Draw on this board</button><button type="button" class="live-board-clear" hidden>Clear board</button></div>',
    );
    expect(html).toMatch(
      /<figcaption>A live board running the snippet above\.<\/figcaption><\/figure>$/,
    );
  });

  it('prefixes root-relative links and images with the base and leaves other URLs alone', async () => {
    const html = await render(
      '[a](/docs/layers/) [b](https://example.com/x) [c](#install) [d](//cdn.example.com/y) [e][ref] ![f](/img/f.png) ![g](https://example.com/g.png)\n\n[ref]: /changelog/',
      '/fieldnotes/',
    );
    expect(html).toBe(
      '<p><a href="/fieldnotes/docs/layers/">a</a> <a href="https://example.com/x">b</a> <a href="#install">c</a> <a href="//cdn.example.com/y">d</a> <a href="/fieldnotes/changelog/">e</a> <img src="/fieldnotes/img/f.png" alt="f"> <img src="https://example.com/g.png" alt="g"></p>',
    );
  });

  it('leaves root-relative links unchanged at base /', async () => {
    expect(await render('[a](/docs/layers/)')).toBe('<p><a href="/docs/layers/">a</a></p>');
  });

  it.each([
    ['::code{example="nope" region="mount"}', 'unknown example "nope"'],
    ['::board{example="nope"}', 'unknown example "nope"'],
    ['::code{example="demo" region="nope"}', 'example "demo": region "nope" not found'],
  ])('%s throws naming the Markdown file', async (markdown, message) => {
    await expect(render(markdown)).rejects.toThrow(`/site/content/docs/page.md: ${message}`);
  });

  it('turns a text directive back into its literal text', async () => {
    expect(await render('Meet at word:thing[label]{a="b"} today.')).toBe(
      '<p>Meet at word:thing[label]{a="b"} today.</p>',
    );
  });
});
