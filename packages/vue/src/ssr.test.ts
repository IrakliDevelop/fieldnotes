import { describe, it, expect, vi } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import type { Viewport } from '@fieldnotes/core';
import { FieldNotesCanvas } from './field-notes-canvas';

describe('server rendering', () => {
  it('renders the root div without creating a Viewport', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const html = await renderToString(
      createSSRApp({ render: () => h(FieldNotesCanvas, { onReady }, () => h('span')) }),
    );
    expect(html).toBe('<div></div>');
    expect(onReady).not.toHaveBeenCalled();
  });
});
