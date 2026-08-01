// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createHtmlElement } from '../elements/element-factory';
import { renderHtmlElements, validateHtmlExportOptions } from './html-export';

describe('renderHtmlElements', () => {
  const element = createHtmlElement({
    position: { x: 0, y: 0 },
    size: { w: 100, h: 50 },
    htmlType: 'chart',
  });

  it('reports unsupported embeds when no renderer is supplied', async () => {
    const onHtmlError = vi.fn();
    await expect(renderHtmlElements([element], { onHtmlError })).resolves.toEqual(new Map());
    expect(onHtmlError).toHaveBeenCalledWith({
      elementId: element.id,
      htmlType: 'chart',
      reason: 'unsupported',
    });
  });

  it('returns the source produced by an async renderer', async () => {
    const source = document.createElement('canvas');
    const renderHtml = vi.fn().mockResolvedValue(source);
    const result = await renderHtmlElements([element], { renderHtml });
    expect(renderHtml).toHaveBeenCalledWith(element);
    expect(result.get(element.id)).toBe(source);
  });

  it('reports renderer failures without rejecting the export', async () => {
    const cause = new Error('renderer failed');
    const onHtmlError = vi.fn();
    const result = await renderHtmlElements([element], {
      renderHtml: () => Promise.reject(cause),
      onHtmlError,
    });
    expect(result.size).toBe(0);
    expect(onHtmlError).toHaveBeenCalledWith({
      elementId: element.id,
      htmlType: 'chart',
      reason: 'render',
      cause,
    });
  });

  it('bounds a renderer that never settles', async () => {
    vi.useFakeTimers();
    try {
      const onHtmlError = vi.fn();
      const rendering = renderHtmlElements([element], {
        renderHtml: () => new Promise(() => undefined),
        htmlTimeoutMs: 25,
        onHtmlError,
      });
      await vi.advanceTimersByTimeAsync(25);
      await expect(rendering).resolves.toEqual(new Map());
      expect(onHtmlError).toHaveBeenCalledWith({
        elementId: element.id,
        htmlType: 'chart',
        reason: 'timeout',
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects invalid timeout configuration', () => {
    expect(() => validateHtmlExportOptions({ htmlTimeoutMs: 0 })).toThrow('htmlTimeoutMs');
  });
});
