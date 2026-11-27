/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Viewport } from '../viewport';
import type { ViewportOptions } from '../viewport';
import type { ViewportPlugin } from '../viewport-plugin';
import { paletteFeature } from './palette-feature';
import { presentationFeature } from './presentation-feature';
import { createFrame } from '../../elements/frame-element';

let container: HTMLDivElement;
const viewports: Viewport[] = [];

function createViewport(options?: ViewportOptions): Viewport {
  const viewport = new Viewport(container, options);
  viewports.push(viewport);
  return viewport;
}

function addFrames(viewport: Viewport): void {
  for (const [index, x] of [0, 1000].entries()) {
    viewport.store.add(
      createFrame({
        position: { x, y: 0 },
        size: { w: 400, h: 324 },
        layerId: viewport.layerManager.activeLayerId,
        index: `a${index}`,
      }),
    );
  }
}

const pressEscape = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

beforeEach(() => {
  container = document.createElement('div');
  Object.defineProperties(container, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  document.body.appendChild(container);
});

afterEach(() => {
  for (const viewport of viewports.splice(0)) viewport.destroy();
  container.remove();
});

describe('paletteFeature', () => {
  it('without the feature, the palette and help stay closed and no palette action exists', () => {
    const viewport = createViewport();
    viewport.palette.open();
    viewport.shortcutsHelp.open();
    expect(viewport.palette.isOpen()).toBe(false);
    expect(viewport.shortcutsHelp.isOpen()).toBe(false);
    expect(viewport.actions.list().some((action) => action.id.startsWith('palette.'))).toBe(false);
  });

  it('with the feature, the palette and help open', () => {
    const viewport = createViewport({ plugins: [paletteFeature()] });
    viewport.palette.open();
    expect(viewport.palette.isOpen()).toBe(true);
    expect(container.querySelectorAll('.fieldnotes-palette')).toHaveLength(1);
    viewport.shortcutsHelp.open();
    expect(viewport.shortcutsHelp.isOpen()).toBe(true);
    expect(viewport.palette.isOpen()).toBe(false);
  });

  it('applies custom strings to the palette', () => {
    const viewport = createViewport({
      plugins: [paletteFeature({ strings: { placeholder: 'Suche' } })],
    });
    viewport.palette.open();
    const input = container.querySelector('.fieldnotes-palette-input');
    expect(input?.getAttribute('placeholder')).toBe('Suche');
  });

  it.each<[string, () => ViewportPlugin[]]>([
    ['palette first', () => [paletteFeature(), presentationFeature()]],
    ['presentation first', () => [presentationFeature(), paletteFeature()]],
  ])(
    'with %s, Escape closes the open palette and keeps the presentation running',
    (_order, plugins) => {
      const viewport = createViewport({ plugins: plugins() });
      addFrames(viewport);
      expect(viewport.presentation.start({ fullscreen: false, animate: false })).toBe(true);
      viewport.palette.open();
      pressEscape();
      expect(viewport.presentation.getState().active).toBe(true);
      viewport.shortcutsHelp.open();
      pressEscape();
      expect(viewport.presentation.getState().active).toBe(true);
    },
  );

  it.each(['palette.open', 'palette.help'])(
    'destroy after %s leaves no palette or help node',
    (id) => {
      const viewport = createViewport({ plugins: [paletteFeature()] });
      expect(viewport.runAction(id)).toBe(true);
      expect(container.querySelector('.fieldnotes-palette, .fieldnotes-help')).not.toBeNull();
      viewport.destroy();
      expect(container.querySelector('.fieldnotes-palette, .fieldnotes-help')).toBeNull();
      expect(viewport.palette.isOpen()).toBe(false);
      expect(viewport.shortcutsHelp.isOpen()).toBe(false);
    },
  );

  it('one feature object serves two viewports independently', () => {
    const feature = paletteFeature();
    const first = createViewport({ plugins: [feature] });
    const second = createViewport({ plugins: [feature] });
    expect(first.runAction('palette.open')).toBe(true);
    expect(first.palette.isOpen()).toBe(true);
    expect(second.palette.isOpen()).toBe(false);
    first.destroy();
    expect(second.runAction('palette.open')).toBe(true);
    expect(second.palette.isOpen()).toBe(true);
    expect(second.runAction('palette.help')).toBe(true);
    expect(second.shortcutsHelp.isOpen()).toBe(true);
  });
});
