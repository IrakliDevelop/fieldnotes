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

  it('appends the frame structure cache to Built and keeps the remaining sections current', () => {
    const roadmap = parseRoadmap(
      readFileSync(new URL('../../content/roadmap.md', import.meta.url), 'utf8'),
    );

    expect(roadmap.built).toContain(
      'Parent and child elements with nested rectangular clipping across canvas, DOM, minimap, PNG and SVG export',
    );
    expect(roadmap.built).toContain(
      'A scheduled Chromium performance gate that records 90 render-loop samples on 10,011 elements against a checked-in p95 budget',
    );
    const camera = roadmap.built.indexOf(
      'Camera constraints applied to camera mutations and animations',
    );
    const frames = roadmap.built.indexOf('Frames that group and clip elements');
    const shortcuts = roadmap.built.indexOf(
      'Shortcuts help on the ? key, generated from the current bindings',
    );
    expect(camera).toBeGreaterThanOrEqual(0);
    expect(frames).toBeGreaterThanOrEqual(0);
    expect(shortcuts).toBeGreaterThanOrEqual(0);
    expect(camera).toBeLessThan(frames);
    expect(frames).toBeLessThan(shortcuts);
    expect(roadmap.built.at(-1)).toBe(
      'A render loop that skips the pass over every element when nothing was added, removed or reordered, and hides off-screen notes once',
    );
    expect(roadmap.built.at(-2)).toBe(
      'Light, dark and system board themes with colour tokens, element colours adapted on the dark board, and exports that follow them',
    );
    expect(roadmap.built.at(-3)).toBe(
      'PDF export with one page per frame or one for the board, keeping element links, and SVG export with selectable text and embedded fonts',
    );
    expect(roadmap.built.at(-4)).toBe(
      'PNG and SVG exports that reopen as the board they came from',
    );
    expect(roadmap.built.at(-5)).toBe(
      'Links on elements that open from a badge or with ⌘/Ctrl+click',
    );
    const elbow = roadmap.built.indexOf('Elbow arrows that route around shapes');
    expect(elbow).toBeGreaterThanOrEqual(0);
    expect(elbow).toBeLessThan(roadmap.built.length - 6);
    expect(roadmap.built).toContain('React bindings: a canvas component and hooks');
    expect(roadmap.built.indexOf('React bindings: a canvas component and hooks')).toBeLessThan(
      roadmap.built.indexOf(
        'Vue and Svelte bindings: a canvas component and helpers with the React hook names',
      ),
    );
    expect(roadmap.built).toHaveLength(new Set(roadmap.built).size);
    expect(roadmap.next).toEqual([
      "I'm working on selection and input polish: lasso selection, flipping, `setSelection`, wheel zoom and pan, and following the display's pixel density.",
    ]);
    expect(roadmap.notBuilt).toEqual(['Vector PDF with selectable text']);
    for (const section of [roadmap.built, roadmap.next, roadmap.notBuilt]) {
      expect(section).not.toContain(
        "I'm making starter templates on StackBlitz and CodeSandbox for a vanilla board and a React board.",
      );
    }
  });
});
