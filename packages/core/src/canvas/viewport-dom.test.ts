// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { createWrapper, createCanvas, createDomLayer } from './viewport-dom';

describe('viewport-dom', () => {
  it('createWrapper is a relative, overflow-hidden div', () => {
    const el = createWrapper();
    expect(el.tagName).toBe('DIV');
    expect(el.style.position).toBe('relative');
    expect(el.style.overflow).toBe('hidden');
  });
  it('createCanvas is an absolutely-positioned canvas', () => {
    const el = createCanvas();
    expect(el.tagName).toBe('CANVAS');
    expect(el.style.position).toBe('absolute');
  });
  it('createDomLayer is a non-interactive layer with 0 0 transform-origin', () => {
    const el = createDomLayer();
    expect(el.tagName).toBe('DIV');
    expect(el.style.pointerEvents).toBe('none');
    expect(el.style.transformOrigin).toBe('0 0');
  });
});
