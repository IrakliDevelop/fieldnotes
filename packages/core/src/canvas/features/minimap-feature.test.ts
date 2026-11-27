/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viewport } from '../viewport';
import type { ViewportOptions } from '../viewport';
import type { PluginStartContext, ViewportPlugin } from '../viewport-plugin';
import { Minimap } from '../minimap';
import { minimapFeature } from './minimap-feature';

let container: HTMLDivElement;
const viewports: Viewport[] = [];
const mounts = new Map<Viewport, HTMLElement>();

// Each viewport mounts into its own child so two viewports can share the test container.
function createViewport(options?: ViewportOptions): Viewport {
  const mount = container.appendChild(document.createElement('div'));
  const viewport = new Viewport(mount, options);
  viewports.push(viewport);
  mounts.set(viewport, mount);
  return viewport;
}

const minimapCanvases = (viewport: Viewport) =>
  mounts.get(viewport)?.querySelectorAll<HTMLCanvasElement>('[data-fieldnotes-minimap]') ?? [];

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  for (const viewport of viewports.splice(0)) viewport.destroy();
  mounts.clear();
  container.remove();
  vi.restoreAllMocks();
});

describe('minimapFeature', () => {
  it('adds one minimap canvas whose chrome follows setTheme', () => {
    const viewport = createViewport({ plugins: [minimapFeature()] });
    const canvases = minimapCanvases(viewport);
    expect(canvases.length).toBe(1);
    expect(canvases[0]?.style.background).toBe('rgba(255, 255, 255, 0.85)');
    viewport.setTheme('dark');
    expect(canvases[0]?.style.background).toBe('rgba(30, 31, 34, 0.85)');
  });

  it('without the feature there is no minimap canvas', () => {
    expect(minimapCanvases(createViewport()).length).toBe(0);
  });

  it('destroy removes the minimap canvas', () => {
    const viewport = createViewport({ plugins: [minimapFeature()] });
    expect(minimapCanvases(viewport).length).toBe(1);
    viewport.destroy();
    expect(minimapCanvases(viewport).length).toBe(0);
  });

  it.each(['before', 'after'] as const)(
    'registerExtraBounds from a plugin listed %s the feature invalidates the minimap',
    (order) => {
      let context: PluginStartContext | undefined;
      const bounds: ViewportPlugin = {
        name: 'test:bounds',
        start: (ctx) => {
          context = ctx;
          return undefined;
        },
      };
      const feature = minimapFeature();
      createViewport({ plugins: order === 'before' ? [bounds, feature] : [feature, bounds] });
      const invalidate = vi.spyOn(Minimap.prototype, 'invalidateScene');
      const dispose = context?.registerExtraBounds(() => ({ x: 0, y: 0, w: 10, h: 10 }));
      expect(invalidate).toHaveBeenCalledTimes(1);
      dispose?.();
      expect(invalidate).toHaveBeenCalledTimes(2);
    },
  );

  it('one feature object serves two viewports; destroying the first keeps the second', () => {
    const feature = minimapFeature();
    const first = createViewport({ plugins: [feature] });
    const second = createViewport({ plugins: [feature] });
    first.destroy();
    const canvases = minimapCanvases(second);
    expect(canvases.length).toBe(1);
    second.setTheme('dark');
    expect(canvases[0]?.style.background).toBe('rgba(30, 31, 34, 0.85)');
  });
});
