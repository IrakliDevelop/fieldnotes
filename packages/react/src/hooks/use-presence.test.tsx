import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { PresenceChannel } from '@fieldnotes/core';
import { ViewportContext } from '../context';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { usePresence } from './use-presence';

class FakeChannel implements PresenceChannel {
  readonly sent: unknown[] = [];
  readonly messageHandlers = new Set<(from: string, data: unknown) => void>();
  readonly leaveHandlers = new Set<(from: string) => void>();

  sendPresence(data: unknown): void {
    this.sent.push(data);
  }

  onPresence(handler: (from: string, data: unknown) => void): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onPresenceLeave(handler: (from: string) => void): () => void {
    this.leaveHandlers.add(handler);
    return () => this.leaveHandlers.delete(handler);
  }

  emit(from: string, data: unknown): void {
    for (const handler of this.messageHandlers) handler(from, data);
  }

  emitLeave(from: string): void {
    for (const handler of this.leaveHandlers) handler(from);
  }
}

const identity = { id: 'u1', name: 'Ann', color: '#f00' };
const bob = { kind: 'awareness', id: 'u2', name: 'Bob', color: '#00f' };

describe('usePresence', () => {
  afterEach(() => destroyTestViewports());

  it('attaches on mount and lists peers from presence frames', () => {
    const viewport = createTestViewport();
    const channel = new FakeChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(() => usePresence(channel, { identity }), { wrapper });

    expect(result.current.peers).toEqual([]);

    act(() => channel.emit('p2', bob));
    expect(result.current.peers).toHaveLength(1);
    expect(result.current.peers[0]?.name).toBe('Bob');

    act(() => channel.emitLeave('p2'));
    expect(result.current.peers).toEqual([]);
  });

  it('the result object is stable while peers are unchanged', () => {
    const viewport = createTestViewport();
    const channel = new FakeChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result, rerender } = renderHook(() => usePresence(channel, { identity }), { wrapper });
    const initial = result.current;

    rerender();

    expect(result.current).toBe(initial);
  });

  it('announce sends a frame and setFields changes what is sent', () => {
    const viewport = createTestViewport();
    const channel = new FakeChannel();
    vi.spyOn(viewport, 'getSelectedIds').mockReturnValue(['e1']);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result } = renderHook(
      () =>
        usePresence(channel, {
          identity,
          fields: { selection: false },
          intervalMs: 0,
          heartbeatMs: 0,
        }),
      { wrapper },
    );

    act(() => result.current.announce());
    expect(channel.sent.at(-1)).toMatchObject({ kind: 'awareness', id: 'u1' });

    act(() => result.current.setFields({ selection: true }));
    expect(channel.sent.at(-1)).toMatchObject({ selection: ['e1'] });
  });

  it('detaches on unmount and on channel change', () => {
    const viewport = createTestViewport();
    const first = new FakeChannel();
    const second = new FakeChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { rerender, unmount } = renderHook(({ channel }) => usePresence(channel, { identity }), {
      initialProps: { channel: first },
      wrapper,
    });

    rerender({ channel: second });
    expect(first.messageHandlers).toHaveLength(0);
    expect(first.leaveHandlers).toHaveLength(0);
    expect(second.messageHandlers).toHaveLength(1);
    expect(second.leaveHandlers).toHaveLength(1);

    unmount();
    expect(second.messageHandlers).toHaveLength(0);
    expect(second.leaveHandlers).toHaveLength(0);
    expect(second.sent.at(-1)).toMatchObject({ id: 'u1', cleared: true });
  });

  it('unmounting the canvas with a usePresence child sends cleared and throws nothing', () => {
    const channel = new FakeChannel();
    function Consumer() {
      usePresence(channel, { identity });
      return null;
    }
    const { unmount } = render(
      <FieldNotesCanvas>
        <Consumer />
      </FieldNotesCanvas>,
    );

    expect(() => unmount()).not.toThrow();
    expect(channel.messageHandlers).toHaveLength(0);
    expect(channel.leaveHandlers).toHaveLength(0);
    expect(channel.sent.at(-1)).toMatchObject({ id: 'u1', cleared: true });
  });

  it('a null channel yields no peers and no sends', () => {
    const viewport = createTestViewport();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { result, rerender } = renderHook(() => usePresence(null, { identity }), { wrapper });
    const initial = result.current;
    const peers = result.current.peers;

    expect(peers).toEqual([]);
    expect(Object.isFrozen(peers)).toBe(true);
    rerender();
    expect(result.current).toBe(initial);
    expect(result.current.peers).toBe(peers);
    act(() => {
      result.current.announce();
      result.current.setFields({ selection: true });
    });
  });

  it('a StrictMode rehearsal leaves exactly one attachment', () => {
    const viewport = createTestViewport();
    const channel = new FakeChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );

    renderHook(() => usePresence(channel, { identity }), { wrapper, reactStrictMode: true });

    expect(channel.messageHandlers).toHaveLength(1);
    expect(channel.leaveHandlers).toHaveLength(1);
  });

  it('changing options alone does not reattach', () => {
    const viewport = createTestViewport();
    const channel = new FakeChannel();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <ViewportContext.Provider value={viewport}>{children}</ViewportContext.Provider>
    );
    const { rerender } = renderHook(({ options }) => usePresence(channel, options), {
      initialProps: {
        options: { identity, fields: { selection: false }, intervalMs: 0, heartbeatMs: 0 },
      },
      wrapper,
    });
    const messageHandler = Array.from(channel.messageHandlers)[0];
    const leaveHandler = Array.from(channel.leaveHandlers)[0];

    rerender({
      options: {
        identity: { id: 'u1', name: 'Annie', color: '#0f0' },
        fields: { selection: true },
        intervalMs: 1,
        heartbeatMs: 1,
      },
    });

    expect(Array.from(channel.messageHandlers)).toEqual([messageHandler]);
    expect(Array.from(channel.leaveHandlers)).toEqual([leaveHandler]);
    expect(channel.sent).not.toContainEqual(expect.objectContaining({ cleared: true }));
  });
});
