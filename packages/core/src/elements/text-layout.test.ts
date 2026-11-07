import { describe, expect, it } from 'vitest';
import { layoutStyledRuns } from './text-layout';
import type { StyledRun } from './note-sanitizer';

const regular: StyledRun = {
  text: 'one two',
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  fontSize: 10,
};

describe('layoutStyledRuns', () => {
  it('wraps words but preserves explicit lines and bold fonts', () => {
    const layout = layoutStyledRuns(
      (text) => text.length * 10,
      [regular, { ...regular, text: '\nthree', bold: true }],
      40,
      1.4,
    );

    expect(layout.lines.map((line) => line.fragments.map((fragment) => fragment.text))).toEqual([
      ['one'],
      ['two'],
      ['three'],
    ]);
    expect(layout.lines[2]?.fragments[0]?.font).toContain('bold');
    expect(layout.height).toBe(42);
  });

  it('keeps empty content as an empty line', () => {
    expect(layoutStyledRuns(() => 0, [], Infinity, 1.4)).toMatchObject({
      width: 0,
      height: 0,
      lines: [{ fragments: [] }],
    });
  });

  it('does not wrap with an infinite width', () => {
    const layout = layoutStyledRuns((text) => text.length * 10, [regular], Infinity, 1.4);

    expect(layout.lines.map((line) => line.fragments.map((fragment) => fragment.text))).toEqual([
      ['one', 'two'],
    ]);
    expect(layout.width).toBe(70);
  });
});
