import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseRoadmap } from './roadmap';

const valid = `# Roadmap

## Built

- Sticky notes
- Layers

## Next

- Starter templates

## Not built yet

- Command palette
`;

describe('parseRoadmap', () => {
  it('reads the three sections as flat lists', () => {
    expect(parseRoadmap(valid)).toEqual({
      built: ['Sticky notes', 'Layers'],
      next: ['Starter templates'],
      notBuilt: ['Command palette'],
    });
  });

  it('throws naming a missing section', () => {
    expect(() => parseRoadmap(valid.replace('## Next\n\n- Starter templates\n', ''))).toThrow(
      'roadmap.md: missing section "Next"',
    );
  });

  it('throws on a nested bullet', () => {
    expect(() => parseRoadmap(valid.replace('- Layers', '- Layers\n  - Locking'))).toThrow(
      'roadmap.md: nested bullet "  - Locking"',
    );
  });

  it('throws on an unknown or repeated section', () => {
    expect(() => parseRoadmap(`${valid}\n## Later\n\n- Dark theme\n`)).toThrow(
      'roadmap.md: unexpected section "Later"',
    );
    expect(() => parseRoadmap(`${valid}\n## Next\n\n- Dark theme\n`)).toThrow(
      'roadmap.md: unexpected section "Next"',
    );
  });

  it('throws on text that is not a bullet', () => {
    expect(() => parseRoadmap(valid.replace('- Layers', 'Layers'))).toThrow(
      'roadmap.md: expected a "- " bullet, found "Layers"',
    );
  });

  it('lists clipping, frames, and the performance gate as built', () => {
    const roadmap = parseRoadmap(
      readFileSync(new URL('../../content/roadmap.md', import.meta.url), 'utf8'),
    );

    expect(roadmap.built).toContain(
      'Parent and child elements with nested rectangular clipping across canvas, DOM, minimap, PNG and SVG export',
    );
    expect(roadmap.built).toContain(
      'A scheduled Chromium performance gate that records 90 render-loop samples on 10,011 elements against a checked-in p95 budget',
    );
    expect(roadmap.built).toContain('Frames that group and clip elements');
    expect(roadmap.next).not.toContain(
      'Parent and child elements with nested rectangular clipping across canvas, DOM, minimap, PNG and SVG export',
    );
    expect(roadmap.next).toEqual([
      "I'm making starter templates on StackBlitz and CodeSandbox for a vanilla board and a React board.",
      "I'm bringing the React bindings up to the core API: hooks and props for autosave, export, camera control, shortcuts and presence.",
    ]);
    expect(roadmap.next).not.toContain('Frames that group and clip elements');
    expect(roadmap.notBuilt).toEqual([
      'Find text on the board',
      'Command palette',
      'Elbow arrows that route around shapes',
      'Text inside shapes',
    ]);
  });
});
