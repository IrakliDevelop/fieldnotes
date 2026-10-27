/** @vitest-environment jsdom */
import { describe, expect, it, vi } from 'vitest';
import { ContextLossGuard } from './context-loss-guard';

function event(type: string): Event {
  return new Event(type, { cancelable: true });
}

describe('ContextLossGuard', () => {
  it('masks once for every lost canvas and waits for a full frame after all restore', () => {
    const wrapper = document.createElement('div');
    const base = document.createElement('canvas');
    const hybrid = document.createElement('canvas');
    const recover = vi.fn();
    const guard = new ContextLossGuard(wrapper, recover);
    const restoreBase = vi.fn();
    guard.watch(base, restoreBase);
    guard.watch(hybrid, vi.fn());

    const lost = event('contextlost');
    base.dispatchEvent(lost);
    base.dispatchEvent(event('contextlost'));
    hybrid.dispatchEvent(event('contextlost'));
    const mask = wrapper.querySelector('[data-fieldnotes-context-loss-mask]');
    expect(lost.defaultPrevented).toBe(true);
    expect(mask).not.toBeNull();
    expect(mask?.getAttribute('style')).toContain('background: rgb(0, 0, 0)');
    expect(wrapper.lastElementChild).toBe(mask);
    if (!(mask instanceof HTMLElement)) throw new Error('context loss mask missing');
    expect(mask.style.position).toBe('absolute');
    expect(mask.style.inset).toBe('0px');
    expect(mask.style.opacity).toBe('1');
    expect(mask.style.zIndex).toBe('2147483647');
    expect(wrapper.children.length).toBe(1);

    base.dispatchEvent(event('contextrestored'));
    guard.frameComplete();
    expect(restoreBase).toHaveBeenCalledOnce();
    expect(recover).toHaveBeenCalledOnce();
    expect(wrapper.contains(mask)).toBe(true);

    hybrid.dispatchEvent(event('contextrestored'));
    expect(wrapper.contains(mask)).toBe(true);
    guard.frameComplete();
    expect(wrapper.contains(mask)).toBe(false);
  });

  it('removes listeners and mask when disposed', () => {
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    const recover = vi.fn();
    const guard = new ContextLossGuard(wrapper, recover);
    const dispose = guard.watch(canvas, vi.fn());
    canvas.dispatchEvent(event('contextlost'));
    dispose();
    dispose();
    guard.frameComplete();
    guard.dispose();
    canvas.dispatchEvent(event('contextlost'));
    expect(wrapper.querySelector('[data-fieldnotes-context-loss-mask]')).toBeNull();
    expect(recover).toHaveBeenCalledOnce();
  });

  it('waits for a full frame after a lost watch is disposed', () => {
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    const recover = vi.fn();
    const guard = new ContextLossGuard(wrapper, recover);
    const dispose = guard.watch(canvas, vi.fn());
    canvas.dispatchEvent(event('contextlost'));
    const mask = wrapper.querySelector('[data-fieldnotes-context-loss-mask]');
    dispose();
    expect(recover).toHaveBeenCalledOnce();
    expect(wrapper.contains(mask)).toBe(true);
    guard.frameComplete();
    expect(wrapper.contains(mask)).toBe(false);
  });

  it('removes active OffscreenCanvas-shaped watches when the guard is disposed', () => {
    const wrapper = document.createElement('div');
    const target = new EventTarget() as OffscreenCanvas;
    const guard = new ContextLossGuard(wrapper, vi.fn());
    const remove = vi.spyOn(target, 'removeEventListener');
    guard.watch(target, vi.fn());
    guard.dispose();
    guard.dispose();
    target.dispatchEvent(event('contextlost'));
    target.dispatchEvent(event('contextrestored'));
    expect(remove).toHaveBeenCalledWith('contextlost', expect.any(Function));
    expect(remove).toHaveBeenCalledWith('contextrestored', expect.any(Function));
    expect(wrapper.querySelector('[data-fieldnotes-context-loss-mask]')).toBeNull();
  });

  it('keeps the mask after an owner fails to discard a restored canvas', () => {
    const wrapper = document.createElement('div');
    const canvas = document.createElement('canvas');
    const recover = vi.fn();
    const guard = new ContextLossGuard(wrapper, recover);
    guard.watch(canvas, () => {
      throw new Error('discard failed');
    });
    canvas.dispatchEvent(event('contextlost'));
    canvas.dispatchEvent(event('contextrestored'));
    guard.frameComplete();
    expect(wrapper.querySelector('[data-fieldnotes-context-loss-mask]')).not.toBeNull();
    expect(recover).toHaveBeenCalledOnce();
  });
});
