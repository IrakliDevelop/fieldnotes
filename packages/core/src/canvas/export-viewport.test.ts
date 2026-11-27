// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Viewport } from './viewport';
import { exportSvg } from './export-svg';
import { createNote, createShape } from '../elements/element-factory';

const DARK_BACKGROUND = 'fill="#1e1f22"';

describe('exportSvg(viewport)', () => {
  let vp: Viewport | null = null;

  afterEach(() => {
    vp?.destroy();
    vp = null;
  });

  function darkScene(): Viewport {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const viewport = new Viewport(container);
    viewport.setTheme('dark');
    viewport.store.add(createNote({ position: { x: 0, y: 0 }, text: 'hello' }));
    viewport.store.add(createShape({ position: { x: 300, y: 40 }, size: { w: 60, h: 40 } }));
    vp = viewport;
    return viewport;
  }

  it('matches the explicit store form completed with the viewport defaults', async () => {
    const viewport = darkScene();
    const svg = await exportSvg(viewport);
    expect(svg).toContain(DARK_BACKGROUND);
    expect(svg).toBe(
      await exportSvg(viewport.store, viewport.exportDefaults().options(), viewport.layerManager),
    );
  });

  it('passes a custom theme option through', async () => {
    const viewport = darkScene();
    const svg = await exportSvg(viewport, { theme: 'light' });
    expect(svg).not.toContain(DARK_BACKGROUND);
    expect(svg).toBe(
      await exportSvg(
        viewport.store,
        viewport.exportDefaults().options({ theme: 'light' }),
        viewport.layerManager,
      ),
    );
  });
});
