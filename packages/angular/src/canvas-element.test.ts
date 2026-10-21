import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import {
  Component,
  InjectionToken,
  NgZone,
  inject,
  reflectComponentType,
  signal,
} from '@angular/core';
import type { InputSignal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { Viewport } from '@fieldnotes/core';
import { CanvasElement } from './canvas-element';
import { FIELDNOTES_VIEWPORT } from './context';
import { FieldNotesCanvas } from './field-notes-canvas';
import { Minimap } from './minimap';
import { createTestViewport, destroyTestViewports } from './test-utils/create-test-viewport';

const ON_READY = new InjectionToken<(viewport: Viewport) => void>('ON_READY');

@Component({
  selector: 'fn-test-host',
  imports: [FieldNotesCanvas, CanvasElement],
  template: `<fn-canvas (ready)="onReady($event)">
    @if (shown()) {
      <fn-canvas-element [position]="position()" [size]="size()">
        <span data-testid="child">Hello</span>
      </fn-canvas-element>
    }
  </fn-canvas>`,
})
class Host {
  private readonly readyHook = inject(ON_READY, { optional: true });
  viewport: Viewport | null = null;
  readonly shown = signal(true);
  readonly position = signal({ x: 10, y: 20 });
  readonly size = signal<{ w: number; h: number } | undefined>(undefined);

  onReady(viewport: Viewport): void {
    this.readyHook?.(viewport);
    this.viewport = viewport;
  }
}

async function mount(onReady?: (viewport: Viewport) => void) {
  TestBed.configureTestingModule({
    providers: onReady ? [{ provide: ON_READY, useValue: onReady }] : [],
  });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.componentInstance;
  const viewport = host.viewport;
  if (!viewport) throw new Error('the canvas did not mount');
  return { fixture, host, viewport };
}

function child(): Element | null {
  return document.querySelector('[data-testid="child"]');
}

// Core adopts the container out of `domLayer` into its paint stack, a sibling under the wrapper.
function inCanvas(viewport: Viewport | null | undefined, node: Element | null): boolean {
  return viewport?.domLayer.parentElement?.contains(node) ?? false;
}

afterEach(() => {
  vi.restoreAllMocks();
  destroyTestViewports();
});

describe('CanvasElement', () => {
  it('declares a required position input and an optional size input', () => {
    expectTypeOf<CanvasElement['position']>().toEqualTypeOf<
      InputSignal<{ x: number; y: number }>
    >();
    expectTypeOf<CanvasElement['size']>().toEqualTypeOf<
      InputSignal<{ w: number; h: number } | undefined>
    >();
    expect(reflectComponentType(CanvasElement)?.inputs.map((i) => i.templateName)).toEqual([
      'position',
      'size',
    ]);
  });

  it('adds a transient html element at the given position on mount', async () => {
    const { viewport } = await mount();
    const elements = viewport.store.getElementsByType('html');
    expect(elements.length).toBe(1);
    expect(elements[0]?.position).toEqual({ x: 10, y: 20 });
    expect(elements[0]?.transient).toBe(true);
  });

  it('projects its content into the container inside the viewport', async () => {
    const { viewport } = await mount();
    const node = child();
    expect(node?.textContent).toBe('Hello');
    expect(inCanvas(viewport, node)).toBe(true);
  });

  it('leaves no orphan container in the DOM layer', async () => {
    const { viewport } = await mount();
    expect(viewport.store.getElementsByType('html').length).toBe(1);
    expect(viewport.domLayer.children.length).toBe(0);
  });

  it('removes the element from the store on destroy', async () => {
    const { fixture, host, viewport } = await mount();
    expect(viewport.store.getElementsByType('html').length).toBe(1);
    host.shown.set(false);
    await fixture.whenStable();
    expect(viewport.store.getElementsByType('html').length).toBe(0);
    expect(child()).toBeNull();
  });

  it('uses the size input when provided', async () => {
    TestBed.configureTestingModule({});
    const fixture = TestBed.createComponent(Host);
    fixture.componentInstance.size.set({ w: 400, h: 300 });
    await fixture.whenStable();
    expect(fixture.componentInstance.viewport?.store.getElementsByType('html')[0]?.size).toEqual({
      w: 400,
      h: 300,
    });
  });

  it('updates geometry on input change and never records undo steps', async () => {
    const { fixture, host, viewport } = await mount();
    expect(viewport.history.undoCount).toBe(0);

    host.position.set({ x: 55, y: 0 });
    host.size.set({ w: 320, h: 100 });
    await fixture.whenStable();
    const elements = viewport.store.getElementsByType('html');
    expect(elements[0]?.position).toEqual({ x: 55, y: 0 });
    expect(elements[0]?.size).toEqual({ w: 320, h: 100 });
    expect(viewport.history.undoCount).toBe(0);

    host.shown.set(false);
    await fixture.whenStable();
    expect(viewport.history.undoCount).toBe(0);
  });

  it('does not update the store when the inputs change to equal geometry', async () => {
    const { fixture, host, viewport } = await mount();
    const updates = vi.fn();
    viewport.store.on('update', updates);
    host.position.set({ x: 10, y: 20 });
    await fixture.whenStable();
    expect(updates).not.toHaveBeenCalled();
  });

  it('is excluded from exported state', async () => {
    const { viewport } = await mount();
    expect(viewport.store.getElementsByType('html').length).toBe(1);
    expect(viewport.exportState().elements.filter((el) => el.type === 'html')).toEqual([]);
  });

  it('tags its store mutations with origin host', async () => {
    const origins: (string | undefined)[] = [];
    const { fixture, host } = await mount((v) => {
      v.store.on('add', (_el, meta) => origins.push(meta.origin));
      v.store.on('update', (_ev, meta) => origins.push(meta.origin));
      v.store.on('remove', (_el, meta) => origins.push(meta.origin));
    });
    host.position.set({ x: 40, y: 20 });
    await fixture.whenStable();
    host.shown.set(false);
    await fixture.whenStable();
    fixture.destroy();
    expect(origins).toEqual(['host', 'host', 'host']);
  });

  it('stays mounted and rendered after a remote clear', async () => {
    const { viewport } = await mount();
    const id = viewport.store.getElementsByType('html')[0]?.id;

    // Replays the sync client's remote clear: transients snapshotted, store cleared, re-added.
    const transients = viewport.store.snapshot().filter((el) => el.type === 'html' && el.transient);
    viewport.store.clear({ origin: 'remote' });
    for (const el of transients) viewport.store.add(el, { origin: 'remote' });
    await Promise.resolve();

    const after = viewport.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.id).toBe(id);
    expect(child()).not.toBeNull();
  });

  it('is re-added at its latest position after a local clear, without an undo step', async () => {
    const { fixture, host, viewport } = await mount();
    host.position.set({ x: 70, y: 20 });
    await fixture.whenStable();

    viewport.store.clear();
    const undoCountAfterClear = viewport.history.undoCount;
    await Promise.resolve();

    const after = viewport.store.getElementsByType('html');
    expect(after.length).toBe(1);
    expect(after[0]?.position).toEqual({ x: 70, y: 20 });
    expect(child()).not.toBeNull();
    expect(viewport.history.undoCount).toBe(undoCountAfterClear);
  });

  it('stays mounted and rendered after viewport.loadState', async () => {
    const { viewport } = await mount();
    // The exported state omits the transient element; loadState emits one coalesced `batch`.
    viewport.loadState(viewport.exportState());
    const undoCountAfterLoad = viewport.history.undoCount;
    await Promise.resolve();

    expect(viewport.store.getElementsByType('html').length).toBe(1);
    expect(child()).not.toBeNull();
    expect(viewport.history.undoCount).toBe(undoCountAfterLoad);
  });

  it('does not re-register when destroyed before the clear recovery microtask runs', async () => {
    const { fixture, host, viewport } = await mount();
    viewport.store.clear();
    host.shown.set(false);
    fixture.detectChanges();
    await Promise.resolve();
    expect(viewport.store.getElementsByType('html').length).toBe(0);
  });

  it('keeps every keyed container in the canvas after a reorder', async () => {
    @Component({
      imports: [FieldNotesCanvas, CanvasElement],
      template: `<fn-canvas (ready)="viewport = $event">
        @for (item of items(); track item.id) {
          <fn-canvas-element [position]="{ x: 0, y: 0 }">
            <span [attr.data-id]="item.id">{{ item.id }}</span>
          </fn-canvas-element>
        }
      </fn-canvas>`,
    })
    class ListHost {
      viewport: Viewport | null = null;
      readonly items = signal([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
    }
    const fixture = TestBed.createComponent(ListHost);
    await fixture.whenStable();
    const host = fixture.componentInstance;
    host.items.update((items) => [...items].reverse());
    await fixture.whenStable();
    for (const id of ['a', 'b', 'c']) {
      expect(inCanvas(host.viewport, document.querySelector(`[data-id="${id}"]`))).toBe(true);
    }
    expect(host.viewport?.store.getElementsByType('html').length).toBe(3);
  });
});

describe('CanvasElement in a zone app', () => {
  it.runIf('Zone' in globalThis)(
    'a position change leaves no pending macrotask in the Angular zone',
    async () => {
      const { fixture, host, viewport } = await mount();
      const zone = TestBed.inject(NgZone);
      const control = zone.run(() => setTimeout(() => undefined, 1000));
      expect(zone.hasPendingMacrotasks).toBe(true);
      clearTimeout(control);
      expect(zone.hasPendingMacrotasks).toBe(false);

      host.position.set({ x: 30, y: 20 });
      fixture.detectChanges();
      expect(viewport.store.getElementsByType('html')[0]?.position).toEqual({ x: 30, y: 20 });
      expect(zone.hasPendingMacrotasks).toBe(false);
    },
  );
});

describe('CanvasElement under a host-provided viewport signal', () => {
  @Component({
    imports: [CanvasElement],
    template: `<fn-canvas-element [position]="{ x: 1, y: 2 }">
      <span data-testid="child">Hello</span>
    </fn-canvas-element>`,
  })
  class ProvidedHost {}

  async function mountProvided() {
    const provided = signal<Viewport | null>(null);
    TestBed.configureTestingModule({
      providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: provided }],
    });
    const fixture = TestBed.createComponent(ProvidedHost);
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement.querySelector('fn-canvas-element');
    return { fixture, provided, host };
  }

  it('renders content in place before mount', async () => {
    const { host } = await mountProvided();
    expect(host.querySelector('div > [data-testid="child"]')?.textContent).toBe('Hello');
  });

  it('moves to a new viewport and back in place when the signal returns to null', async () => {
    const { fixture, provided, host } = await mountProvided();
    const first = createTestViewport();
    provided.set(first);
    await fixture.whenStable();
    expect(inCanvas(first, child())).toBe(true);

    const second = createTestViewport();
    provided.set(second);
    await fixture.whenStable();
    expect(first.store.getElementsByType('html').length).toBe(0);
    expect(second.store.getElementsByType('html')[0]?.position).toEqual({ x: 1, y: 2 });
    expect(inCanvas(second, child())).toBe(true);

    provided.set(null);
    await fixture.whenStable();
    expect(second.store.getElementsByType('html').length).toBe(0);
    expect(host.contains(child())).toBe(true);
  });
});

describe('destroying a whole canvas', () => {
  it('tears down a CanvasElement and a Minimap after the viewport is destroyed, without errors', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const error = vi.spyOn(console, 'error');
    @Component({
      imports: [FieldNotesCanvas, CanvasElement, Minimap],
      template: `<fn-canvas>
        <fn-canvas-element [position]="{ x: 0, y: 0 }"><div></div></fn-canvas-element>
        <fn-minimap />
      </fn-canvas>`,
    })
    class TeardownHost {}
    const fixture = TestBed.createComponent(TeardownHost);
    await fixture.whenStable();
    expect(fixture.nativeElement.querySelector('[aria-label="Collapse minimap"]')).not.toBeNull();

    expect(() => fixture.destroy()).not.toThrow();
    await Promise.resolve();
    expect(error).not.toHaveBeenCalled();
  });
});
