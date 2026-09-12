import { describe, it, expect, afterEach } from 'vitest';
import { StrictMode } from 'react';
import { render, cleanup } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { CanvasElement } from './canvas-element';
import type { Viewport } from '@fieldnotes/core';

describe('CanvasElement', () => {
  afterEach(cleanup);

  it('adds an html element to the store on mount', () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <div>Hello</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    const elements = vp.store.getElementsByType('html');
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
  });

  it('renders children via portal', () => {
    render(
      <FieldNotesCanvas>
        <CanvasElement position={{ x: 0, y: 0 }}>
          <span data-testid="portal-child">Portal Content</span>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    const child = document.querySelector('[data-testid="portal-child"]');
    expect(child).not.toBeNull();
    expect(child?.textContent).toBe('Portal Content');
  });

  it('removes element from store on unmount', () => {
    let vp: Viewport | null = null;
    let showChild = true;

    function Inner() {
      if (!showChild) return null;
      return (
        <CanvasElement position={{ x: 0, y: 0 }}>
          <div>Remove me</div>
        </CanvasElement>
      );
    }

    const { rerender } = render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);

    showChild = false;
    rerender(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    expect(vp.store.getElementsByType('html').length).toBe(0);
  });

  it('uses custom size when provided', () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 0, y: 0 }} size={{ w: 400, h: 300 }}>
          <div>Sized</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    const elements = vp.store.getElementsByType('html');
    expect(elements[0]?.size).toEqual({ w: 400, h: 300 });
  });

  it('never records undo steps', () => {
    let vp: Viewport | null = null;

    function Tree({ x, w }: { x: number; w: number }) {
      return (
        <FieldNotesCanvas
          onReady={(v) => {
            vp = v;
          }}
        >
          <CanvasElement position={{ x, y: 0 }} size={{ w, h: 100 }}>
            <div>Host owned</div>
          </CanvasElement>
        </FieldNotesCanvas>
      );
    }

    const { rerender, unmount } = render(<Tree x={10} w={200} />);
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.history.undoCount).toBe(0);

    rerender(<Tree x={55} w={320} />);
    expect(vp.history.undoCount).toBe(0);
    const elements = vp.store.getElementsByType('html');
    expect(elements[0]?.position).toEqual({ x: 55, y: 0 });
    expect(elements[0]?.size).toEqual({ w: 320, h: 100 });

    unmount();
    expect(vp.history.undoCount).toBe(0);
  });

  it('is excluded from exported state', () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }} size={{ w: 200, h: 100 }}>
          <div>Not exported</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(vp.exportState().elements.filter((el) => el.type === 'html')).toEqual([]);
  });

  it('tags its store mutations with origin host', () => {
    const origins: (string | undefined)[] = [];
    const unsubs: (() => void)[] = [];

    function Tree({ x }: { x: number }) {
      return (
        <FieldNotesCanvas
          onReady={(v) => {
            unsubs.push(
              v.store.on('add', (_el, meta) => {
                origins.push(meta.origin);
              }),
              v.store.on('update', (_ev, meta) => {
                origins.push(meta.origin);
              }),
              v.store.on('remove', (_el, meta) => {
                origins.push(meta.origin);
              }),
            );
          }}
        >
          <CanvasElement position={{ x, y: 0 }} size={{ w: 200, h: 100 }}>
            <div>Tagged</div>
          </CanvasElement>
        </FieldNotesCanvas>
      );
    }

    const { rerender, unmount } = render(<Tree x={0} />);
    rerender(<Tree x={40} />);
    unmount();
    unsubs.forEach((fn) => fn());

    expect(origins.length).toBeGreaterThanOrEqual(3);
    expect(origins.every((origin) => origin === 'host')).toBe(true);
  });

  it('stays mounted and rendered after a remote clear', async () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <span data-testid="clear-survivor">Survivor</span>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    const before = vp.store.getElementsByType('html');
    expect(before.length).toBe(1);
    const id = before[0]?.id;

    // Replay what the sync client does on a remote clear: transient elements are snapshotted,
    // the store is cleared, and they are re-added with the remote origin.
    const transients = vp.store.snapshot().filter((el) => el.type === 'html' && el.transient);
    vp.store.clear({ origin: 'remote' });
    for (const el of transients) vp.store.add(el, { origin: 'remote' });
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(id);
    expect(document.querySelector('[data-testid="clear-survivor"]')).not.toBeNull();
  });

  it('is re-added after a local clear', async () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <span data-testid="local-clear-survivor">Survivor</span>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);

    vp.store.clear();
    const undoCountAfterClear = vp.history.undoCount;
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(document.querySelector('[data-testid="local-clear-survivor"]')).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterClear);
  });

  it('stays mounted and rendered after viewport.loadState', async () => {
    let vp: Viewport | null = null;
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <span data-testid="load-state-survivor">Survivor</span>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);

    // The exported state deliberately omits the transient element, so loading it back drops the
    // embed from the store. `loadState` runs inside `suspendNotifications`, so the store emits a
    // single coalesced `batch` event rather than `clear`.
    vp.loadState(vp.exportState());
    const undoCountAfterLoad = vp.history.undoCount;
    await Promise.resolve();

    const after = vp.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(document.querySelector('[data-testid="load-state-survivor"]')).not.toBeNull();
    expect(vp.history.undoCount).toBe(undoCountAfterLoad);
  });

  it('mounts exactly one element under StrictMode', () => {
    let vp: Viewport | null = null;
    render(
      <StrictMode>
        <FieldNotesCanvas
          onReady={(v) => {
            vp = v;
          }}
        >
          <CanvasElement position={{ x: 5, y: 6 }}>
            <span data-testid="strict-child">Strict</span>
          </CanvasElement>
        </FieldNotesCanvas>
      </StrictMode>,
    );
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);
    expect(vp.history.undoCount).toBe(0);
    expect(document.querySelector('[data-testid="strict-child"]')).not.toBeNull();
    // No orphan container: core adopts the container out of `domLayer` into its own paint stack
    // synchronously on `add`, so any child left directly under `domLayer` is a container whose
    // effect run was discarded (StrictMode's double invocation) and never cleaned up.
    expect(vp.domLayer.children.length).toBe(0);
  });
});
