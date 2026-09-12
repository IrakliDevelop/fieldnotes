import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FieldNotesCanvas } from './field-notes-canvas';
import { CanvasElement } from './canvas-element';
import type { Viewport } from '@fieldnotes/core';

describe('CanvasElement', () => {
  afterEach(cleanup);

  it('adds an html element to the store on mount', () => {
    const captured: { vp: Viewport | null } = { vp: null };
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          captured.vp = v;
        }}
      >
        <CanvasElement position={{ x: 10, y: 20 }}>
          <div>Hello</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    const vp = captured.vp;
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
    const captured: { vp: Viewport | null } = { vp: null };
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
          captured.vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    const vp = captured.vp;
    expect(vp).not.toBeNull();
    if (!vp) return;
    expect(vp.store.getElementsByType('html').length).toBe(1);

    showChild = false;
    rerender(
      <FieldNotesCanvas
        onReady={(v) => {
          captured.vp = v;
        }}
      >
        <Inner />
      </FieldNotesCanvas>,
    );
    expect(vp.store.getElementsByType('html').length).toBe(0);
  });

  it('uses custom size when provided', () => {
    const captured: { vp: Viewport | null } = { vp: null };
    render(
      <FieldNotesCanvas
        onReady={(v) => {
          captured.vp = v;
        }}
      >
        <CanvasElement position={{ x: 0, y: 0 }} size={{ w: 400, h: 300 }}>
          <div>Sized</div>
        </CanvasElement>
      </FieldNotesCanvas>,
    );
    const vp = captured.vp;
    expect(vp).not.toBeNull();
    if (!vp) return;
    const elements = vp.store.getElementsByType('html');
    expect(elements[0]?.size).toEqual({ w: 400, h: 300 });
  });
});
