import { describe, expect, it } from 'vitest';
import { elementLink, isAllowedLink, isPasteLink, normalizeLink, parseElementLink } from './link';

describe('link', () => {
  it.each([
    'https://example.com',
    'http://a.b/c?d=1#e',
    'mailto:a@b.com',
    'HTTPS://EXAMPLE.COM',
    '#fn:element=abc',
  ])('isAllowedLink accepts %s', (link) => expect(isAllowedLink(link)).toBe(true));

  it.each([
    'javascript:alert(1)',
    'JavaScript:alert(1)',
    'java\tscript:alert(1)',
    'data:text/html,x',
    'vbscript:x',
    'https://user:pw@host',
    'https://user@host',
    `https://${'a'.repeat(2041)}`, // 2049 chars
    'https://example.com/\u0001',
    'https://example.com/\u007f',
    'https://example.com/a\nb',
    '#fn:element=',
    '#fn:element=a b',
    'example.com',
    '',
    'ftp://x',
  ])('isAllowedLink rejects %j', (link) => expect(isAllowedLink(link)).toBe(false));

  it.each([
    ['  example.com/path ', 'https://example.com/path'],
    ['www.example.com', 'https://www.example.com'],
    ['https://x.y', 'https://x.y'],
    ['#fn:element=k', '#fn:element=k'],
    ['javascript:x', null],
    ['a@b.com', null],
    ['readme.md', 'https://readme.md'],
    ['has space.com', null],
    [`https://${'a'.repeat(2041)}`, null],
  ])('normalizeLink(%j) is %j', (input, out) => expect(normalizeLink(input)).toBe(out));

  it.each(['3.14', 'readme.md', 'v1.2', 'a@b.com', 'example.com', 'hello world', ''])(
    'isPasteLink rejects %j',
    (l) => expect(isPasteLink(l)).toBe(false),
  );

  it.each([
    'www.example.com',
    ' https://example.com ',
    'mailto:a@b.com',
    'HTTP://EXAMPLE.COM',
    'WWW.X.Y',
  ])('isPasteLink accepts %j', (l) => expect(isPasteLink(l)).toBe(true));

  it('elementLink and parseElementLink round-trip', () => {
    expect(elementLink('abc')).toBe('#fn:element=abc');
    expect(parseElementLink('#fn:element=abc')).toBe('abc');
    expect(parseElementLink('https://x.y')).toBeNull();
    expect(parseElementLink('#fn:element=')).toBeNull();
  });
});
