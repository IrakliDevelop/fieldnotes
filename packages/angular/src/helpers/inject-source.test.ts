import { afterEach, describe, expect, it } from 'vitest';
import { Component, input, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  PencilTool,
  ShapeTool,
  createCameraSource,
  createToolOptionsSource,
} from '@fieldnotes/core';
import type { CameraState, Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from '../context';
import { countOpenListeners } from '../test-utils/count-listeners';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectSource, requireViewport } from './inject-source';

afterEach(destroyTestViewports);

const FALLBACK: CameraState = { x: -1, y: -1, zoom: -1 };

function viewportWithTools() {
  const viewport = createTestViewport();
  viewport.toolManager.register(new PencilTool({ color: '#ff0000' }));
  viewport.toolManager.register(new ShapeTool({ strokeWidth: 4 }));
  return viewport;
}

describe('injectSource', () => {
  it('holds the fallback while the viewport signal is null', async () => {
    const { result } = await mountHelper(() => injectSource(createCameraSource, FALLBACK), null);
    expect(result()).toBe(FALLBACK);
  });

  it('follows the source once a viewport is set', async () => {
    const { result, provided, fixture } = await mountHelper(
      () => injectSource(createCameraSource, FALLBACK),
      null,
    );
    const viewport = createTestViewport();
    provided.set(viewport);
    await fixture.whenStable();
    expect(result()).toEqual({ x: 0, y: 0, zoom: 1 });
    viewport.camera.pan(10, 20);
    expect(result()).toEqual({ x: 10, y: 20, zoom: 1 });
  });

  it('resubscribes when the input changes', async () => {
    const viewport = viewportWithTools();
    const name = signal('pencil');
    const open = countOpenListeners();
    const { result, fixture } = await mountHelper(
      () => injectSource((vp) => createToolOptionsSource(vp, name), null, name),
      viewport,
    );
    expect(result()?.['color']).toBe('#ff0000');
    const subscribed = open();

    name.set('shape');
    await fixture.whenStable();
    expect(result()?.['strokeWidth']).toBe(4);
    expect(open()).toBe(subscribed);
    viewport.toolManager.getTool('shape')?.setOptions?.({ strokeWidth: 9 });
    expect(result()?.['strokeWidth']).toBe(9);
    viewport.toolManager.getTool('pencil')?.setOptions?.({ color: '#00ff00' });
    expect(result()?.['color']).toBeUndefined();
  });

  it('returns to the fallback and unsubscribes when the viewport goes back to null', async () => {
    const viewport = createTestViewport();
    const open = countOpenListeners();
    const baseline = open();
    const { result, provided, fixture } = await mountHelper(
      () => injectSource(createCameraSource, FALLBACK),
      viewport,
    );
    expect(open()).toBe(baseline + 1);

    provided.set(null);
    await fixture.whenStable();
    expect(result()).toBe(FALLBACK);
    expect(open()).toBe(baseline);
    viewport.camera.pan(10, 20);
    expect(result()).toBe(FALLBACK);
  });

  it('unsubscribes on destroy', async () => {
    const viewport = createTestViewport();
    const open = countOpenListeners();
    const baseline = open();
    const { result, fixture } = await mountHelper(
      () => injectSource(createCameraSource, FALLBACK),
      viewport,
    );
    expect(open()).toBe(baseline + 1);
    fixture.destroy();
    expect(open()).toBe(baseline);
    viewport.camera.pan(10, 20);
    expect(result()).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('does not read a required input passed as input during injection', async () => {
    @Component({ selector: 'fn-test-options', template: '{{ options()?.["color"] }}' })
    class Options {
      readonly name = input.required<string>();
      protected readonly options = injectSource(
        (vp) => createToolOptionsSource(vp, this.name),
        null,
        this.name,
      );
    }
    @Component({
      selector: 'fn-test-host',
      imports: [Options],
      template: '<fn-test-options name="pencil" />',
    })
    class Host {}
    TestBed.configureTestingModule({
      providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: signal(viewportWithTools()) }],
    });
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    expect(fixture.nativeElement.textContent).toBe('#ff0000');
  });
});

describe('requireViewport', () => {
  it('returns the viewport when one exists', () => {
    const viewport = createTestViewport();
    expect(requireViewport(signal<Viewport | null>(viewport), 'undo')).toBe(viewport);
  });

  it('throws a named error before mount', () => {
    expect(() => requireViewport(signal<Viewport | null>(null), 'undo')).toThrow(
      '[fieldnotes] undo called before <fn-canvas> mounted',
    );
  });
});
