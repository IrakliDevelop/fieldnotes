import { describe, expect, it } from 'vitest';
import { withBase } from './paths';

describe('withBase', () => {
  it.each([
    ['/', '/docs/', '/docs/'],
    ['/', '/playground/?scene=x#h', '/playground/?scene=x#h'],
    ['/', 'https://x.y/', 'https://x.y/'],
    ['/', '#top', '#top'],
    ['/', '', '/'],
    ['/fieldnotes/', '/docs/', '/fieldnotes/docs/'],
    ['/fieldnotes/', '/playground/?scene=x#h', '/fieldnotes/playground/?scene=x#h'],
    ['/fieldnotes/', 'https://x.y/', 'https://x.y/'],
    ['/fieldnotes/', '#top', '#top'],
    ['/fieldnotes/', '', '/fieldnotes/'],
    ['/fieldnotes', '/docs/', '/fieldnotes/docs/'],
  ])('at base %s maps %s to %s', (base, path, expected) => {
    expect(withBase(path, base)).toBe(expected);
  });
});
