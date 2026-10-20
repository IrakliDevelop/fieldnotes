import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exampleCode, extractRegion, readExamples } from './directives';

const SOURCE = `import { Viewport } from '@fieldnotes/core';

// #region outer
export function f(): void {
  // #region inner
  const a = 1;
    const b = a;
  // #endregion inner

  // #region inner-two
  console.log(b);
  // #endregion
}
// #endregion outer
`;

describe('extractRegion', () => {
  it('returns the dedented lines of a nested region', () => {
    expect(extractRegion(SOURCE, 'inner')).toBe('const a = 1;\n  const b = a;');
  });

  it('strips nested region markers from an enclosing region', () => {
    expect(extractRegion(SOURCE, 'outer')).toBe(
      [
        'export function f(): void {',
        '  const a = 1;',
        '    const b = a;',
        '',
        '  console.log(b);',
        '}',
      ].join('\n'),
    );
  });

  it('matches a region name exactly', () => {
    expect(extractRegion(SOURCE, 'inner-two')).toBe('console.log(b);');
  });

  it('throws when the region is missing', () => {
    expect(() => extractRegion(SOURCE, 'missing')).toThrow('region "missing" not found');
  });

  it('throws when the region is never closed', () => {
    expect(() => extractRegion('// #region open\nconst a = 1;\n', 'open')).toThrow(
      'region "open" is not closed',
    );
  });
});

describe('readExamples', () => {
  it('keys each example by file name without extension, with its language', () => {
    const dir = mkdtempSync(join(tmpdir(), 'examples-'));
    writeFileSync(join(dir, 'board.ts'), 'const a = 1;\n');
    writeFileSync(join(dir, 'app.tsx'), 'const b = <B />;\n');
    writeFileSync(join(dir, 'notes.md'), '# not an example\n');
    expect(readExamples(dir)).toEqual({
      board: { source: 'const a = 1;\n', lang: 'ts' },
      app: { source: 'const b = <B />;\n', lang: 'tsx' },
    });
  });
});

describe('exampleCode', () => {
  const examples = { demo: { source: SOURCE, lang: 'tsx' as const } };

  it('returns the region with the example language', () => {
    expect(exampleCode(examples, 'demo', 'inner-two', 'page.md')).toEqual({
      lang: 'tsx',
      value: 'console.log(b);',
    });
  });

  it.each([
    ['nope', 'inner', 'page.md: unknown example "nope"'],
    [undefined, 'inner', 'page.md: unknown example "undefined"'],
    ['demo', 'nope', 'page.md: example "demo": region "nope" not found'],
    ['demo', undefined, 'page.md: ::code{example="demo"} needs a region'],
  ])('example %s region %s throws naming the page', (example, region, message) => {
    expect(() => exampleCode(examples, example, region, 'page.md')).toThrow(message);
  });
});
