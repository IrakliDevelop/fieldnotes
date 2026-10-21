import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, InjectionToken, NgZone, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MinimapController } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from './context';
import { FieldNotesCanvas } from './field-notes-canvas';
import { Minimap } from './minimap';
import { createTestViewport, destroyTestViewports } from './test-utils/create-test-viewport';

// Permissive fake 2D context: any drawing call succeeds; property writes are kept. These tests
// assert component behavior (canvas presence, controller lifecycle), not drawing output.
function makeContext(): CanvasRenderingContext2D {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop) {
      if (typeof prop === 'string' && prop in target) return target[prop];
      return vi.fn();
    },
    set(target, prop, value) {
      if (typeof prop === 'string') target[prop] = value;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

beforeEach(() => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => makeContext());
});

afterEach(() => {
  vi.restoreAllMocks();
  destroyTestViewports();
});

const DEFAULT_COLLAPSED = new InjectionToken<boolean>('DEFAULT_COLLAPSED');

@Component({
  imports: [FieldNotesCanvas, Minimap],
  template: `<fn-canvas (ready)="viewport = $event">
    @if (shown()) {
      <fn-minimap
        class="corner"
        [width]="width()"
        [height]="height()"
        [defaultCollapsed]="defaultCollapsed"
      />
    }
  </fn-canvas>`,
})
class Host {
  viewport: Viewport | null = null;
  readonly defaultCollapsed = inject(DEFAULT_COLLAPSED, { optional: true }) ?? false;
  readonly shown = signal(true);
  readonly width = signal(200);
  readonly height = signal(140);
}

async function mount(defaultCollapsed = false) {
  TestBed.configureTestingModule({
    providers: [{ provide: DEFAULT_COLLAPSED, useValue: defaultCollapsed }],
  });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const root: HTMLElement = fixture.nativeElement;
  const click = async (selector: string) => {
    root.querySelector<HTMLButtonElement>(selector)?.click();
    await fixture.whenStable();
  };
  return { fixture, host: fixture.componentInstance, root, click };
}

const collapseButton = 'button[aria-label="Collapse minimap"]';
const expandButton = 'button[aria-label="Expand minimap"]';

describe('Minimap', () => {
  it('renders an expanded minimap by default', async () => {
    const { root } = await mount();
    // The FieldNotesCanvas host canvas plus the minimap's own canvas.
    expect(root.querySelectorAll('canvas').length).toBe(2);
    expect(root.querySelector(collapseButton)?.textContent?.trim()).toBe('–');
  });

  it('renders only a button when defaultCollapsed', async () => {
    const { root } = await mount(true);
    expect(root.querySelectorAll('canvas').length).toBe(1);
    expect(root.querySelector(expandButton)?.textContent?.trim()).toBe('▣');
    expect(root.querySelector(collapseButton)).toBeNull();
  });

  it('constructs no controller while collapsed', async () => {
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    await mount(true);
    expect(requestDraw).not.toHaveBeenCalled();
  });

  it('clicking collapse removes the canvas and disposes the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const { root, click } = await mount();
    await click(collapseButton);
    expect(root.querySelectorAll('canvas').length).toBe(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(root.querySelector(expandButton)).not.toBeNull();
  });

  it('clicking expand after collapse recreates a controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const { root, click } = await mount();
    expect(requestDraw).toHaveBeenCalledTimes(1);

    await click(collapseButton);
    await click(expandButton);

    expect(root.querySelectorAll('canvas').length).toBe(2);
    expect(requestDraw).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('an input change replaces the controller', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const { fixture, host } = await mount();
    host.width.set(150);
    await fixture.whenStable();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(requestDraw).toHaveBeenCalledTimes(2);
  });

  it('destroying while expanded disposes the controller exactly once', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const { fixture, host } = await mount();
    host.shown.set(false);
    await fixture.whenStable();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('throws outside the provider', () => {
    expect(() => TestBed.createComponent(Minimap)).toThrow(
      'injectViewport must be used inside <fn-canvas>',
    );
  });

  it('applies width/height inputs to the canvas inline style', async () => {
    const { fixture, host, root } = await mount();
    host.width.set(120);
    host.height.set(80);
    await fixture.whenStable();
    const canvas = root.querySelector(collapseButton)?.parentElement?.querySelector('canvas');
    expect(canvas?.style.width).toBe('120px');
    expect(canvas?.style.height).toBe('80px');
  });

  it('a class on <fn-minimap> applies to the host', async () => {
    const { root } = await mount();
    const minimap = root.querySelector<HTMLElement>('fn-minimap.corner');
    expect(minimap?.querySelector(collapseButton)).not.toBeNull();
    expect(minimap && getComputedStyle(minimap).display).toBe('block');
  });

  it('follows a host-provided viewport signal and disposes when it returns to null', async () => {
    const dispose = vi.spyOn(MinimapController.prototype, 'dispose');
    const requestDraw = vi.spyOn(MinimapController.prototype, 'requestDraw');
    const provided = signal<Viewport | null>(null);
    TestBed.configureTestingModule({
      providers: [{ provide: FIELDNOTES_VIEWPORT, useValue: provided }],
    });
    const fixture = TestBed.createComponent(Minimap);
    await fixture.whenStable();
    expect(requestDraw).not.toHaveBeenCalled();

    provided.set(createTestViewport());
    await fixture.whenStable();
    expect(requestDraw).toHaveBeenCalledTimes(1);

    provided.set(createTestViewport());
    await fixture.whenStable();
    expect(requestDraw).toHaveBeenCalledTimes(2);
    expect(dispose).toHaveBeenCalledTimes(1);

    provided.set(null);
    await fixture.whenStable();
    expect(dispose).toHaveBeenCalledTimes(2);
  });
});

describe('Minimap in a zone app', () => {
  it.runIf('Zone' in globalThis)(
    'a pointer drag on the minimap causes no change detection',
    async () => {
      const { host, root } = await mount();
      const before = host.viewport?.camera.position;
      const zone = TestBed.inject(NgZone);
      let turns = 0;
      zone.onMicrotaskEmpty.subscribe(() => turns++);

      const sibling = document.createElement('div');
      document.body.appendChild(sibling);
      zone.run(() => sibling.addEventListener('pointermove', () => undefined));
      sibling.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1 }));
      expect(turns).toBeGreaterThan(0);
      sibling.remove();

      turns = 0;
      const canvas = root.querySelector(collapseButton)?.parentElement?.querySelector('canvas');
      for (const [type, x] of [
        ['pointerdown', 10],
        ['pointermove', 40],
        ['pointermove', 80],
        ['pointerup', 80],
      ] as const) {
        canvas?.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: x,
          }),
        );
      }
      expect(host.viewport?.camera.position).not.toEqual(before);
      expect(turns).toBe(0);
    },
  );
});
