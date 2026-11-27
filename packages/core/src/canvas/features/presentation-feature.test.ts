/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Viewport } from '../viewport';
import type { ViewportOptions } from '../viewport';
import { presentationFeature } from './presentation-feature';
import { featureHostOf } from '../feature-host';
import { createFrame } from '../../elements/frame-element';
import { createNote } from '../../elements/element-factory';
import { SelectTool } from '../../tools/select-tool';
import type * as PresentationModule from '../presentation';

const failStart = vi.hoisted(() => ({ value: false }));

vi.mock('../presentation', async (importOriginal) => {
  const actual = await importOriginal<typeof PresentationModule>();
  class PresentationMode extends actual.PresentationMode {
    constructor(deps: ConstructorParameters<typeof actual.PresentationMode>[0]) {
      if (failStart.value) throw new Error('presentation start failed');
      super(deps);
    }
  }
  return { ...actual, PresentationMode };
});

let container: HTMLDivElement;
const viewports: Viewport[] = [];

function createViewport(options?: ViewportOptions): Viewport {
  const viewport = new Viewport(container, options);
  viewports.push(viewport);
  return viewport;
}

function addFrames(viewport: Viewport): void {
  for (const [index, x] of [0, 1000].entries()) {
    viewport.store.add(
      createFrame({
        position: { x, y: 0 },
        size: { w: 400, h: 324 },
        layerId: viewport.layerManager.activeLayerId,
        index: `a${index}`,
      }),
    );
  }
}

const start = (viewport: Viewport) =>
  viewport.presentation.start({ fullscreen: false, animate: false });

const pressEscape = () =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));

beforeEach(() => {
  container = document.createElement('div');
  Object.defineProperties(container, {
    clientWidth: { value: 800, configurable: true },
    clientHeight: { value: 600, configurable: true },
  });
  document.body.appendChild(container);
});

afterEach(() => {
  failStart.value = false;
  for (const viewport of viewports.splice(0)) viewport.destroy();
  container.remove();
});

describe('presentationFeature', () => {
  it('without the feature, start throws and getState is one stable inactive state', () => {
    const viewport = createViewport();
    addFrames(viewport);
    expect(() => start(viewport)).toThrow(
      'Viewport: presentation needs `presentationFeature()` in `plugins`',
    );
    const state = viewport.presentation.getState();
    expect(state).toEqual({ active: false, index: -1, count: 0, fullscreen: false });
    expect(viewport.presentation.getState()).toBe(state);
  });

  it('with the feature, start presents a scene with two frames', () => {
    const viewport = createViewport({ plugins: [presentationFeature()] });
    addFrames(viewport);
    expect(start(viewport)).toBe(true);
    expect(viewport.presentation.getState()).toEqual({
      active: true,
      index: 0,
      count: 2,
      fullscreen: false,
    });
  });

  it('Escape does not end the presentation while the context menu is open', () => {
    const viewport = createViewport({
      plugins: [presentationFeature()],
      tools: [new SelectTool()],
    });
    addFrames(viewport);
    const note = createNote({
      position: { x: 0, y: 0 },
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(note);
    expect(start(viewport)).toBe(true);
    viewport.toolManager.getTool<SelectTool>('select')?.setSelection([note.id]);
    viewport.openContextMenu({ x: 10, y: 10 });
    expect(document.querySelector('.fieldnotes-context-menu')).not.toBeNull();
    pressEscape();
    expect(viewport.presentation.getState().active).toBe(true);
  });

  it('a tracked overlay that reports open keeps Escape from ending the presentation', () => {
    const viewport = createViewport({ plugins: [presentationFeature()] });
    addFrames(viewport);
    expect(start(viewport)).toBe(true);
    const untrack = featureHostOf(viewport).trackOverlay(() => true);
    pressEscape();
    expect(viewport.presentation.getState().active).toBe(true);
    untrack();
    pressEscape();
    expect(viewport.presentation.getState().active).toBe(false);
  });

  it('one feature object serves two viewports independently', () => {
    const feature = presentationFeature();
    const first = createViewport({ plugins: [feature] });
    const second = createViewport({ plugins: [feature] });
    addFrames(first);
    addFrames(second);
    expect(first.runAction('presentation.start')).toBe(true);
    expect(first.presentation.getState().active).toBe(true);
    expect(second.presentation.getState().active).toBe(false);
    first.destroy();
    expect(second.runAction('presentation.start')).toBe(true);
    expect(second.presentation.getState().active).toBe(true);
  });

  it('destroy ends a running presentation and detaches it from the viewport', () => {
    const viewport = createViewport({ plugins: [presentationFeature()] });
    addFrames(viewport);
    expect(start(viewport)).toBe(true);
    const running = viewport.presentation;
    viewport.destroy();
    expect(running.getState().active).toBe(false);
    expect(() => start(viewport)).toThrow('presentationFeature()');
    expect(container.children).toHaveLength(0);
  });

  it('a start failure makes the constructor throw and leaves the viewport destroyed', () => {
    failStart.value = true;
    expect(() => new Viewport(container, { plugins: [presentationFeature()] })).toThrow(
      'presentation start failed',
    );
    expect(container.children).toHaveLength(0);
  });

  it('registers presentation actions after the built-ins and before link and edit-text', () => {
    const viewport = createViewport({
      plugins: [presentationFeature()],
      palette: false,
      tools: [new SelectTool()],
    });
    const note = createNote({
      position: { x: 0, y: 0 },
      layerId: viewport.layerManager.activeLayerId,
    });
    viewport.store.add(note);
    viewport.toolManager.getTool<SelectTool>('select')?.setSelection([note.id]);
    const ids = viewport.actions.list().map((action) => action.id);
    const firstPresentation = ids.indexOf('presentation.start');
    expect(ids.slice(firstPresentation)).toEqual([
      'presentation.start',
      'presentation.exit',
      'presentation.next',
      'presentation.previous',
      'link.set',
      'link.remove',
      'link.open',
      'selection.edit-text',
      'tool.select',
    ]);
    expect(
      ids.slice(0, firstPresentation).some((id) => /^(link|selection\.edit|tool)/.test(id)),
    ).toBe(false);
  });
});
