import { describe, it, expect, vi } from 'vitest';
import { render } from 'svelte/server';
import type { Viewport } from '@fieldnotes/core';
import CanvasWithChild from './test-fixtures/CanvasWithChild.svelte';

describe('server rendering', () => {
  it('renders the root div without creating a Viewport or children', () => {
    const onready = vi.fn<(viewport: Viewport) => void>();
    const onviewport = vi.fn<(viewport: Viewport) => void>();
    const { body } = render(CanvasWithChild, { props: { onready, onviewport } });
    expect(body.replace(/<!--[^>]*-->/g, '')).toBe('<div></div>');
    expect(onready).not.toHaveBeenCalled();
    expect(onviewport).not.toHaveBeenCalled();
  });
});
