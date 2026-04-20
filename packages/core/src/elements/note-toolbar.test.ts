// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NoteToolbar } from './note-toolbar';

describe('NoteToolbar', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    Object.defineProperty(container, 'getBoundingClientRect', {
      value: () => ({ top: 100, left: 50, bottom: 200, right: 250, width: 200, height: 100 }),
    });
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
  });

  it('creates toolbar element on show', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    expect(document.querySelector('[data-note-toolbar]')).not.toBeNull();
    toolbar.hide();
  });

  it('removes toolbar element on hide', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    toolbar.hide();
    expect(document.querySelector('[data-note-toolbar]')).toBeNull();
  });

  it('contains bold button', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const btn = toolbar.getElement()?.querySelector('[data-format="bold"]');
    expect(btn).not.toBeNull();
    toolbar.hide();
  });

  it('contains italic button', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const btn = toolbar.getElement()?.querySelector('[data-format="italic"]');
    expect(btn).not.toBeNull();
    toolbar.hide();
  });

  it('contains underline button', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const btn = toolbar.getElement()?.querySelector('[data-format="underline"]');
    expect(btn).not.toBeNull();
    toolbar.hide();
  });

  it('contains strikethrough button', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const btn = toolbar.getElement()?.querySelector('[data-format="strikethrough"]');
    expect(btn).not.toBeNull();
    toolbar.hide();
  });

  it('contains font size selector', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const select = toolbar.getElement()?.querySelector('select');
    expect(select).not.toBeNull();
    toolbar.hide();
  });

  it('font size selector has correct presets', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const select = toolbar.getElement()?.querySelector('select') as HTMLSelectElement | null;
    const values = Array.from(select?.options ?? []).map((o) => o.value);
    expect(values).toEqual(['12', '14', '18', '24']);
    toolbar.hide();
  });

  it('positions above note by default', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const el = toolbar.getElement();
    expect(el?.style.position).toBe('fixed');
    toolbar.hide();
  });

  it('executes bold command on button click', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const execSpy = vi.spyOn(document, 'execCommand').mockReturnValue(true);
    const btn = toolbar.getElement()?.querySelector('[data-format="bold"]') as HTMLElement;
    btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(execSpy).toHaveBeenCalledWith('bold');
    execSpy.mockRestore();
    toolbar.hide();
  });

  it('prevents default on button pointerdown to keep focus', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    const btn = toolbar.getElement()?.querySelector('[data-format="bold"]') as HTMLElement;
    const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
    btn.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    toolbar.hide();
  });

  it('hide is safe to call when not shown', () => {
    const toolbar = new NoteToolbar();
    expect(() => toolbar.hide()).not.toThrow();
  });

  it('updatePosition repositions the toolbar', () => {
    const toolbar = new NoteToolbar();
    toolbar.show(container);
    toolbar.updatePosition(container);
    const el = toolbar.getElement();
    expect(el?.style.position).toBe('fixed');
    toolbar.hide();
  });
});
