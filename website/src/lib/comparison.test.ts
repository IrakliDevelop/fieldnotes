import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { isExternal, parseComparison } from './comparison';

type Overrides = Record<string, string | undefined>;

const doc = (
  tldraw: Overrides = {},
  fieldNotes: Overrides = {},
  row: Record<string, unknown> = {},
) => ({
  checkedOn: '2026-10-20',
  columns: ['Field Notes', 'tldraw', 'Excalidraw'],
  rows: [
    {
      id: 'licence',
      label: 'Licence and cost',
      home: true,
      cells: {
        'Field Notes': { text: 'MIT.', href: '/docs/getting-started/', ...fieldNotes },
        tldraw: {
          text: 'Needs a licence key in production.',
          source: 'https://tldraw.dev/community/license',
          checkedOn: '2026-10-20',
          ...tldraw,
        },
      },
      ...row,
    },
  ],
});

describe('parseComparison', () => {
  it('accepts content/comparison.json with the five rows in order', () => {
    const json: unknown = JSON.parse(
      readFileSync(new URL('../../content/comparison.json', import.meta.url), 'utf8'),
    );

    const comparison = parseComparison(json);

    expect(comparison.rows.map((row) => [row.id, row.cells['Field Notes'].href])).toEqual([
      ['licence', 'https://github.com/IrakliDevelop/fieldnotes/blob/master/LICENSE'],
      ['framework', '/docs/getting-started/'],
      ['sync', '/docs/multiplayer/'],
      ['html', '/docs/html-elements/'],
      ['tabletop', '/docs/tabletop-maps/'],
    ]);
  });

  it('keeps a sourced cell and allows an absent one', () => {
    const { cells } = parseComparison(doc()).rows[0] ?? {};

    expect(cells?.tldraw?.source).toBe('https://tldraw.dev/community/license');
    expect(cells?.Excalidraw).toBeUndefined();
  });

  it('throws on a cell without a source', () => {
    expect(() => parseComparison(doc({ source: undefined }))).toThrow(
      'licence/tldraw: source must be an https URL',
    );
  });

  it('throws on an http source', () => {
    expect(() => parseComparison(doc({ source: 'http://tldraw.dev/' }))).toThrow(
      'licence/tldraw: source must be an https URL',
    );
  });

  it('throws on a cell without an ISO checkedOn', () => {
    expect(() => parseComparison(doc({ checkedOn: '20 October 2026' }))).toThrow(
      'licence/tldraw: checkedOn must be YYYY-MM-DD',
    );
  });

  it.each(['✓', '✔', '✕', '✗', '✘'])('throws on the glyph %s in a cell', (glyph) => {
    expect(() => parseComparison(doc({ text: `${glyph} yes` }))).toThrow(
      'licence/tldraw: no check or cross glyphs',
    );
  });

  it('throws on a glyph in a Field Notes cell', () => {
    expect(() => parseComparison(doc({}, { text: 'MIT ✓' }))).toThrow(
      'licence/Field Notes: no check or cross glyphs',
    );
  });

  it('accepts the repository LICENSE as a Field Notes href', () => {
    const href = 'https://github.com/IrakliDevelop/fieldnotes/blob/master/LICENSE';

    expect(parseComparison(doc({}, { href })).rows[0]?.cells['Field Notes'].href).toBe(href);
  });

  it('keeps the home flag of a row', () => {
    expect(parseComparison(doc()).rows[0]?.home).toBe(true);
  });

  it('throws on a row without a boolean home flag', () => {
    expect(() => parseComparison(doc({}, {}, { home: undefined }))).toThrow(
      /licence: home must be true or false/,
    );
    expect(() => parseComparison(doc({}, {}, { home: 'yes' }))).toThrow(
      /home must be true or false/,
    );
  });

  it('accepts the roadmap, the repository and the Bundlephobia page as a Field Notes href', () => {
    for (const href of [
      '/roadmap/',
      'https://github.com/IrakliDevelop/fieldnotes',
      'https://github.com/IrakliDevelop/fieldnotes/blob/master/packages/core/README.md',
      'https://bundlephobia.com/package/@fieldnotes/core',
    ]) {
      expect(() => parseComparison(doc({}, { href }))).not.toThrow();
    }
  });

  it('throws on any other Field Notes href', () => {
    for (const href of [
      '/playground/',
      'https://example.com/',
      'https://github.com/tldraw/tldraw',
      'docs/layers/',
      '',
    ]) {
      expect(() => parseComparison(doc({}, { href }))).toThrow(
        /href must be a docs page, \/roadmap\/, the repository or the Bundlephobia page/,
      );
    }
  });

  it('tells external hrefs from site paths', () => {
    expect(isExternal('https://github.com/IrakliDevelop/fieldnotes')).toBe(true);
    expect(isExternal('/docs/layers/')).toBe(false);
  });
});
