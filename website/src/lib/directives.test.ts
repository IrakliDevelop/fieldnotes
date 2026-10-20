import { describe, expect, it } from 'vitest';
import { extractRegion } from './directives';

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
