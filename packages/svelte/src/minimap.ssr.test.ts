import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAllContexts } from 'svelte';
import { render } from 'svelte/server';
import { MinimapController, Viewport } from '@fieldnotes/core';
import type { MinimapProps } from './index.js';
import { Minimap } from './index.js';
import HelperHost from './test-fixtures/HelperHost.svelte';

// Never touched on the server: the controller is created in an effect, which SSR skips.
const viewport: Viewport = Object.create(Viewport.prototype);

// The context a provided Viewport sets up, captured so Minimap can render without a canvas.
function viewportContext() {
  let context = new Map<unknown, unknown>();
  // Server output renders lazily: reading `body` runs the component.
  void render(HelperHost, { props: { viewport, run: () => (context = getAllContexts()) } }).body;
  return context;
}

const renderMinimap = (props: MinimapProps) =>
  render(Minimap, { props, context: viewportContext() }).body.replace(/<!--[^>]*-->/g, '');

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Minimap server rendering', () => {
  it('renders the expanded canvas at the given size with merged class and style', () => {
    const html = renderMinimap({ width: 120, height: 80, class: 'corner', style: 'top: 4px' });
    expect(html).toMatch(/^<div class="corner" style="position: relative; top: 4px">/);
    expect(html).toContain('<canvas style="width: 120px; height: 80px; display: block"></canvas>');
    expect(html).toContain('aria-label="Collapse minimap"');
    expect(html).not.toContain('Expand minimap');
  });

  it('renders the default size when width and height are omitted', () => {
    expect(renderMinimap({})).toContain('style="width: 200px; height: 140px; display: block"');
  });

  it('renders only the expand button when defaultCollapsed', () => {
    const html = renderMinimap({ defaultCollapsed: true, class: 'corner', style: 'top: 4px' });
    expect(html).toMatch(
      /^<button type="button" aria-label="Expand minimap" class="corner" style="[^"]*; top: 4px">▣<\/button>$/,
    );
    expect(html).not.toContain('<canvas');
  });

  it('creates no controller on the server', () => {
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    expect(() => renderMinimap({})).not.toThrow();
    expect(requestDraw).not.toHaveBeenCalled();
  });
});
