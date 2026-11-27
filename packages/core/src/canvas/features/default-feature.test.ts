/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from '../viewport';
import { defaultFeatures } from './default-feature';
import { createNote } from '../../elements/element-factory';
import { SelectTool } from '../../tools/select-tool';

let container: HTMLDivElement;
let viewport: Viewport | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  viewport?.destroy();
  viewport = null;
  container.remove();
});

describe('defaultFeatures', () => {
  it('installs the palette and presentation with the default action order', () => {
    viewport = new Viewport(container, { plugins: defaultFeatures(), tools: [new SelectTool()] });
    const note = createNote({
      position: { x: 0, y: 0 },
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(note);
    viewport.toolManager.getTool<SelectTool>('select')?.setSelection([note.id]);
    const ids = viewport.actions.list().map((action) => action.id);
    const firstPresentation = ids.indexOf('presentation.start');
    expect(ids.slice(firstPresentation)).toEqual([
      'presentation.start',
      'presentation.exit',
      'presentation.next',
      'presentation.previous',
      'link.set',
      'link.remove',
      'link.open',
      'selection.edit-text',
      'palette.open',
      'palette.help',
      'tool.select',
    ]);
    expect(
      ids.slice(0, firstPresentation).some((id) => /^(link|selection\.edit|palette|tool)/.test(id)),
    ).toBe(false);
    viewport.palette.open();
    expect(viewport.palette.isOpen()).toBe(true);
  });

  it('passes palette options to the palette', () => {
    viewport = new Viewport(container, {
      plugins: defaultFeatures({ palette: { strings: { placeholder: 'Suche' } } }),
    });
    viewport.palette.open();
    const input = container.querySelector('.fieldnotes-palette-input');
    expect(input?.getAttribute('placeholder')).toBe('Suche');
  });
});
