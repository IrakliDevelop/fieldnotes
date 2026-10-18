// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { sanitizeNoteHtml, parseStyledRuns, isNoteContentEmpty } from './note-sanitizer';

describe('sanitizeNoteHtml', () => {
  it('passes plain text through unchanged', () => {
    expect(sanitizeNoteHtml('hello world')).toBe('hello world');
  });

  it('preserves bold tags', () => {
    expect(sanitizeNoteHtml('<b>bold</b>')).toBe('<b>bold</b>');
  });

  it('preserves strong tags', () => {
    expect(sanitizeNoteHtml('<strong>bold</strong>')).toBe('<strong>bold</strong>');
  });

  it('preserves italic tags', () => {
    expect(sanitizeNoteHtml('<i>italic</i>')).toBe('<i>italic</i>');
  });

  it('preserves em tags', () => {
    expect(sanitizeNoteHtml('<em>italic</em>')).toBe('<em>italic</em>');
  });

  it('preserves underline tags', () => {
    expect(sanitizeNoteHtml('<u>underline</u>')).toBe('<u>underline</u>');
  });

  it('preserves strikethrough tags', () => {
    expect(sanitizeNoteHtml('<s>struck</s>')).toBe('<s>struck</s>');
  });

  it('preserves strike tags', () => {
    expect(sanitizeNoteHtml('<strike>struck</strike>')).toBe('<strike>struck</strike>');
  });

  it('preserves del tags', () => {
    expect(sanitizeNoteHtml('<del>deleted</del>')).toBe('<del>deleted</del>');
  });

  it('preserves br tags', () => {
    expect(sanitizeNoteHtml('line1<br>line2')).toBe('line1<br>line2');
  });

  it('preserves div tags', () => {
    expect(sanitizeNoteHtml('<div>paragraph</div>')).toBe('<div>paragraph</div>');
  });

  it('preserves span with font-size style', () => {
    expect(sanitizeNoteHtml('<span style="font-size: 18px;">big</span>')).toBe(
      '<span style="font-size: 18px;">big</span>',
    );
  });

  it('strips script tags', () => {
    expect(sanitizeNoteHtml('<script>alert("xss")</script>hello')).toBe('hello');
  });

  it('strips event handler attributes', () => {
    expect(sanitizeNoteHtml('<b onclick="alert(1)">bold</b>')).toBe('<b>bold</b>');
  });

  it('strips img tags', () => {
    expect(sanitizeNoteHtml('<img src="x.png">hello')).toBe('hello');
  });

  it('strips anchor tags but keeps text', () => {
    expect(sanitizeNoteHtml('<a href="http://evil.com">link</a>')).toBe('link');
  });

  it('strips non-font-size CSS properties from span', () => {
    expect(sanitizeNoteHtml('<span style="color: red; font-size: 18px;">text</span>')).toBe(
      '<span style="font-size: 18px;">text</span>',
    );
  });

  it('strips style attribute from non-span elements', () => {
    expect(sanitizeNoteHtml('<b style="color: red;">bold</b>')).toBe('<b>bold</b>');
  });

  it('handles nested formatting', () => {
    expect(sanitizeNoteHtml('<b><i>bold italic</i></b>')).toBe('<b><i>bold italic</i></b>');
  });

  it('returns empty string for empty input', () => {
    expect(sanitizeNoteHtml('')).toBe('');
  });
});

describe('sanitizeNoteHtml memo', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Pushes every earlier output out of the bounded memo so the next call really parses.
  function evictMemo(): void {
    for (let i = 0; i < 300; i++) sanitizeNoteHtml(`filler ${i}`);
  }

  it.each([
    'hello world',
    '<b>bold</b>',
    '<strong>bold</strong>',
    '<i>italic</i>',
    '<em>italic</em>',
    '<u>underline</u>',
    '<s>struck</s>',
    '<strike>struck</strike>',
    '<del>deleted</del>',
    'line1<br>line2',
    '<div>paragraph</div>',
    '<span style="font-size: 18px;">big</span>',
    '<script>alert("xss")</script>hello',
    '<b onclick="alert(1)">bold</b>',
    '<img src="x.png">hello',
    '<a href="http://evil.com">link</a>',
    '<span style="color: red; font-size: 18px;">text</span>',
    '<b style="color: red;">bold</b>',
    '<b><i>bold italic</i></b>',
    '<span style="font-size: 1.5em">em</span>',
    '<span style="font-size: calc(10px + 2em)">calc</span>',
    '<span style="font-size: 12px; font-weight: bold">px</span>',
    '<section><article><a href="x"><img src="y">deep</a></article></section>',
    '<b>keep<!-- hidden --></b><!-- top -->',
    '<div><script>bad()</script><span onclick="x()">ok</span></div>',
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  ])('sanitizing the output of %s again yields the same string', (input) => {
    const once = sanitizeNoteHtml(input);
    evictMemo();
    expect(sanitizeNoteHtml(once)).toBe(once);
  });

  it('returns an already sanitized string without parsing it again', () => {
    const once = sanitizeNoteHtml(
      '<b onclick="x()">memo</b> <span style="font-size: 20px;">hit</span>',
    );
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');

    expect(sanitizeNoteHtml(once)).toBe(once);
    expect(parse).not.toHaveBeenCalled();
  });

  it('forgets the oldest output once 300 newer inputs were sanitized', () => {
    const first = sanitizeNoteHtml('<i>oldest entry</i>');
    for (let i = 0; i < 300; i++) sanitizeNoteHtml(`<b>${i}</b>`);
    const parse = vi.spyOn(DOMParser.prototype, 'parseFromString');

    expect(sanitizeNoteHtml(first)).toBe('<i>oldest entry</i>');
    expect(parse).toHaveBeenCalledTimes(1);
  });
});

describe('parseStyledRuns', () => {
  it('parses plain text into a single run', () => {
    const runs = parseStyledRuns('hello', 14);
    expect(runs).toEqual([
      {
        text: 'hello',
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        fontSize: 14,
      },
    ]);
  });

  it('parses bold text', () => {
    const runs = parseStyledRuns('<b>bold</b>', 14);
    expect(runs).toEqual([
      {
        text: 'bold',
        bold: true,
        italic: false,
        underline: false,
        strikethrough: false,
        fontSize: 14,
      },
    ]);
  });

  it('parses strong as bold', () => {
    const runs = parseStyledRuns('<strong>bold</strong>', 14);
    expect(runs[0]?.bold).toBe(true);
  });

  it('parses italic text', () => {
    const runs = parseStyledRuns('<i>italic</i>', 14);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses em as italic', () => {
    const runs = parseStyledRuns('<em>italic</em>', 14);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses underline text', () => {
    const runs = parseStyledRuns('<u>underline</u>', 14);
    expect(runs[0]?.underline).toBe(true);
  });

  it('parses strikethrough text', () => {
    const runs = parseStyledRuns('<s>struck</s>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses del as strikethrough', () => {
    const runs = parseStyledRuns('<del>struck</del>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses strike as strikethrough', () => {
    const runs = parseStyledRuns('<strike>struck</strike>', 14);
    expect(runs[0]?.strikethrough).toBe(true);
  });

  it('parses font-size from span', () => {
    const runs = parseStyledRuns('<span style="font-size: 24px;">big</span>', 14);
    expect(runs[0]?.fontSize).toBe(24);
  });

  it('parses nested formatting', () => {
    const runs = parseStyledRuns('<b><i>both</i></b>', 14);
    expect(runs[0]?.bold).toBe(true);
    expect(runs[0]?.italic).toBe(true);
  });

  it('parses mixed content into multiple runs', () => {
    const runs = parseStyledRuns('plain <b>bold</b> plain', 14);
    expect(runs).toHaveLength(3);
    expect(runs[0]?.text).toBe('plain ');
    expect(runs[0]?.bold).toBe(false);
    expect(runs[1]?.text).toBe('bold');
    expect(runs[1]?.bold).toBe(true);
    expect(runs[2]?.text).toBe(' plain');
    expect(runs[2]?.bold).toBe(false);
  });

  it('converts br to newline', () => {
    const runs = parseStyledRuns('line1<br>line2', 14);
    const text = runs.map((r) => r.text).join('');
    expect(text).toBe('line1\nline2');
  });

  it('converts div to newline', () => {
    const runs = parseStyledRuns('<div>line1</div><div>line2</div>', 14);
    const text = runs.map((r) => r.text).join('');
    expect(text).toContain('\n');
  });

  it('uses baseFontSize as default', () => {
    const runs = parseStyledRuns('text', 18);
    expect(runs[0]?.fontSize).toBe(18);
  });

  it('returns empty array for empty input', () => {
    expect(parseStyledRuns('', 14)).toEqual([]);
  });
});

describe('isNoteContentEmpty', () => {
  it('treats empty and whitespace-only strings as empty', () => {
    expect(isNoteContentEmpty('')).toBe(true);
    expect(isNoteContentEmpty('   ')).toBe(true);
  });

  it('treats markup-only content as empty', () => {
    expect(isNoteContentEmpty('<br>')).toBe(true);
    expect(isNoteContentEmpty('<div><br></div>')).toBe(true);
    expect(isNoteContentEmpty('&nbsp;')).toBe(true);
    expect(isNoteContentEmpty('<b> </b>')).toBe(true);
  });

  it('treats real text as non-empty', () => {
    expect(isNoteContentEmpty('<div>x</div>')).toBe(false);
    expect(isNoteContentEmpty('hello')).toBe(false);
    expect(isNoteContentEmpty('<b>bold</b>')).toBe(false);
  });
});
