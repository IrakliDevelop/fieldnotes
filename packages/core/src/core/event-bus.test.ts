import { describe, it, expect, vi } from 'vitest';
import { EventBus } from './event-bus';

interface TestEvents {
  click: { x: number; y: number };
  resize: { width: number };
  empty: null;
}

describe('EventBus', () => {
  it('calls listener when event is emitted', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();

    bus.on('click', listener);
    bus.emit('click', { x: 10, y: 20 });

    expect(listener).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('supports multiple listeners for same event', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();

    bus.on('click', a);
    bus.on('click', b);
    bus.emit('click', { x: 0, y: 0 });

    expect(a).toHaveBeenCalledOnce();
    expect(b).toHaveBeenCalledOnce();
  });

  it('removes listener with off()', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();

    bus.on('click', listener);
    bus.off('click', listener);
    bus.emit('click', { x: 0, y: 0 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('returns unsubscribe function from on()', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();

    const unsub = bus.on('click', listener);
    unsub();
    bus.emit('click', { x: 0, y: 0 });

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not throw when emitting with no listeners', () => {
    const bus = new EventBus<TestEvents>();
    expect(() => bus.emit('click', { x: 0, y: 0 })).not.toThrow();
  });

  it('supports void events', () => {
    const bus = new EventBus<TestEvents>();
    const listener = vi.fn();

    bus.on('empty', listener);
    bus.emit('empty', null);

    expect(listener).toHaveBeenCalledOnce();
  });

  it('removes all listeners with clear()', () => {
    const bus = new EventBus<TestEvents>();
    const a = vi.fn();
    const b = vi.fn();

    bus.on('click', a);
    bus.on('resize', b);
    bus.clear();
    bus.emit('click', { x: 0, y: 0 });
    bus.emit('resize', { width: 100 });

    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
  });

  it('continues to later listeners when one throws', () => {
    const bus = new EventBus<TestEvents>();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const second = vi.fn();

    bus.on('click', () => {
      throw new Error('listener boom');
    });
    bus.on('click', second);

    expect(() => bus.emit('click', { x: 1, y: 2 })).not.toThrow();
    expect(second).toHaveBeenCalledWith({ x: 1, y: 2 });
    errorSpy.mockRestore();
  });

  it('logs the event name and error when a listener throws', () => {
    const bus = new EventBus<TestEvents>();
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(vi.fn());
    const boom = new Error('listener boom');

    bus.on('resize', () => {
      throw boom;
    });
    bus.emit('resize', { width: 100 });

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('resize'), boom);
    errorSpy.mockRestore();
  });
});
