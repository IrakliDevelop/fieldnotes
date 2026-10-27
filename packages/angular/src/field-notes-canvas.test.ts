import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  Component,
  ErrorHandler,
  InjectionToken,
  NgZone,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture, TestModuleMetadata } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { HandTool, PencilTool, SelectTool, Viewport, createShape } from '@fieldnotes/core';
import type { CanvasState, ImportableCanvasState, Tool, ViewportOptions } from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from './context';
import { FieldNotesCanvas } from './field-notes-canvas';

const DEFAULT_TOOL_NAMES = ['hand', 'select', 'pencil', 'eraser', 'arrow', 'note', 'text', 'shape'];

interface HostInit {
  options?: ViewportOptions;
  tools?: Tool[] | 'default';
  initialData?: ImportableCanvasState | string;
  changeDebounceMs?: number;
  defaultTool?: string;
  tool?: string;
  onReady?: (viewport: Viewport) => void;
  onChange?: (state: CanvasState) => void;
}

const HOST_INIT = new InjectionToken<HostInit>('HOST_INIT');

@Component({
  selector: 'fn-test-host',
  imports: [FieldNotesCanvas],
  template: `<fn-canvas
    [options]="options"
    [tools]="tools()"
    [initialData]="initialData"
    [changeDebounceMs]="changeDebounceMs()"
    [defaultTool]="defaultTool"
    [(tool)]="tool"
    (ready)="onReady($event)"
    (stateChange)="onChange($event)"
    (toolChange)="toolChanges.push($event)"
  />`,
})
class Host {
  private readonly init = inject(HOST_INIT, { optional: true }) ?? {};
  readonly canvas = viewChild.required(FieldNotesCanvas);
  readonly options = this.init.options;
  readonly tools = signal(this.init.tools);
  readonly initialData = this.init.initialData;
  readonly changeDebounceMs = signal(this.init.changeDebounceMs ?? 250);
  readonly defaultTool = this.init.defaultTool;
  readonly tool = signal(this.init.tool);
  readonly readies: Viewport[] = [];
  readonly viewportsAtReady: (Viewport | null)[] = [];
  readonly states: CanvasState[] = [];
  readonly toolChanges: (string | undefined)[] = [];

  onReady(viewport: Viewport): void {
    this.readies.push(viewport);
    this.viewportsAtReady.push(this.canvas().viewport());
    this.init.onReady?.(viewport);
  }

  onChange(state: CanvasState): void {
    this.states.push(state);
    this.init.onChange?.(state);
  }
}

async function mount(init: HostInit = {}, { providers = [], ...rest }: TestModuleMetadata = {}) {
  TestBed.configureTestingModule({
    ...rest,
    providers: [{ provide: HOST_INIT, useValue: init }, ...providers],
  });
  const fixture = TestBed.createComponent(Host);
  await fixture.whenStable();
  const host = fixture.componentInstance;
  return { fixture, host, viewport: host.readies.at(-1) ?? null };
}

function mounted(viewport: Viewport | null): Viewport {
  if (!viewport) throw new Error('the canvas did not mount');
  return viewport;
}

function canvasOf(fixture: ComponentFixture<unknown>): FieldNotesCanvas {
  return fixture.debugElement.query(By.directive(FieldNotesCanvas)).componentInstance;
}

function addShape(viewport: Viewport, id: string) {
  viewport.store.add({
    ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
    id,
    layerId: viewport.layerManager.activeLayerId,
  });
}

function errorHandlerSpy() {
  const handleError = vi.fn<(error: unknown) => void>();
  const testModule: TestModuleMetadata = {
    rethrowApplicationErrors: false,
    providers: [{ provide: ErrorHandler, useValue: { handleError } }],
  };
  return { handleError, testModule };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('FieldNotesCanvas', () => {
  it('creates a Viewport with a canvas inside the container', async () => {
    const { fixture, viewport } = await mount();
    const container = fixture.nativeElement.querySelector('fn-canvas > div');
    expect(container.querySelector('canvas')).not.toBeNull();
    expect(canvasOf(fixture).viewport()).toBe(viewport);
    expect(fixture.nativeElement.querySelectorAll('canvas')).toHaveLength(1);
  });

  it('the container fills the positioned block host and isolates the canvas stacking', async () => {
    const { fixture } = await mount();
    const host: HTMLElement = fixture.nativeElement.querySelector('fn-canvas');
    const container = host.firstElementChild;
    if (!(container instanceof HTMLDivElement)) throw new Error('no container');
    expect(container.style.position).toBe('absolute');
    expect(container.style.inset).toMatch(/^0(px)?$/);
    expect(container.style.zIndex).toBe('0');
    expect(getComputedStyle(host).display).toBe('block');
    expect(getComputedStyle(host).position).toBe('relative');
  });

  it('destroys the Viewport once on destroy', async () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const { fixture } = await mount();
    const canvas = canvasOf(fixture);
    const host: HTMLElement = fixture.nativeElement.querySelector('fn-canvas');
    fixture.destroy();
    expect(host.querySelector('canvas')).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(canvas.viewport()).toBeNull();
  });

  it('exposes the viewport through viewChild', async () => {
    const { host, viewport } = await mount();
    expect(host.canvas().viewport()).toBe(mounted(viewport));
  });

  it('viewport is non-null inside the ready handler', async () => {
    const { host, viewport } = await mount();
    expect(host.viewportsAtReady).toEqual([mounted(viewport)]);
  });

  it('registers tools passed as inputs', async () => {
    const { host, viewport } = await mount({
      tools: [new HandTool(), new SelectTool()],
      defaultTool: 'select',
    });
    expect(host.readies).toHaveLength(1);
    expect(mounted(viewport).toolManager.toolNames).toEqual(['hand', 'select']);
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('select');
  });

  it('a bare canvas registers the default bundle with select active', async () => {
    const { viewport } = await mount();
    expect(mounted(viewport).toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('select');
  });

  it('tools=[] registers nothing and activates no tool', async () => {
    const { viewport } = await mount({ tools: [] });
    expect(mounted(viewport).toolManager.toolNames).toEqual([]);
    expect(mounted(viewport).toolManager.activeTool).toBeNull();
  });

  it("tools='default' registers the default bundle even with options.tools set", async () => {
    const { viewport } = await mount({ tools: 'default', options: { tools: [new HandTool()] } });
    expect(mounted(viewport).toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('select');
  });

  it("tools='default' registers the bundle before ready", async () => {
    let namesAtReady: string[] = [];
    await mount({
      tools: 'default',
      onReady: (vp) => {
        namesAtReady = [...vp.toolManager.toolNames];
      },
    });
    expect(namesAtReady).toEqual(DEFAULT_TOOL_NAMES);
  });

  it('omitted tools register no defaults when the ready handler registered a tool', async () => {
    const { viewport } = await mount({ onReady: (vp) => vp.toolManager.register(new HandTool()) });
    expect(mounted(viewport).toolManager.toolNames).toEqual(['hand']);
    expect(mounted(viewport).toolManager.activeTool).toBeNull();
  });

  it('omitted tools activate the tool input after the ready handler registered it', async () => {
    const warn = vi.spyOn(console, 'warn');
    const { viewport } = await mount({
      tool: 'hand',
      onReady: (vp) => vp.toolManager.register(new HandTool()),
    });
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('hand');
    expect(warn).not.toHaveBeenCalled();
  });

  it('omitted tools defer to options.tools instead of the default bundle', async () => {
    const { viewport } = await mount({ options: { tools: [new HandTool()] } });
    expect(mounted(viewport).toolManager.toolNames).toEqual(['hand']);
  });

  it('defaultTool wins over select with the default bundle', async () => {
    const { viewport } = await mount({ defaultTool: 'pencil' });
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('pencil');
  });

  it('a new tools array after mount registers its unregistered tools', async () => {
    const hand = new HandTool();
    const { fixture, host, viewport } = await mount({ tools: [hand] });
    const pencil = new PencilTool();
    host.tools.set([new HandTool(), pencil]);
    await fixture.whenStable();
    expect(mounted(viewport).toolManager.toolNames).toEqual(['hand', 'pencil']);
    expect(mounted(viewport).toolManager.getTool('hand')).toBe(hand);
    expect(mounted(viewport).toolManager.getTool('pencil')).toBe(pencil);
  });

  it('controlled tool wins over defaultTool at mount', async () => {
    const { viewport } = await mount({
      tools: [new HandTool(), new SelectTool()],
      defaultTool: 'hand',
      tool: 'select',
    });
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('select');
  });

  it('a tool input change switches the active tool and emits no toolChange', async () => {
    const { fixture, host, viewport } = await mount({
      tools: [new HandTool(), new SelectTool()],
      tool: 'select',
    });
    host.tool.set('hand');
    await fixture.whenStable();
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('hand');
    expect(host.toolChanges).toEqual([]);
  });

  it('an API tool switch writes back through [(tool)] and emits toolChange once', async () => {
    const { fixture, host, viewport } = await mount({
      tools: [new HandTool(), new SelectTool()],
      tool: 'select',
    });
    mounted(viewport).setTool('hand');
    await fixture.whenStable();
    expect(host.tool()).toBe('hand');
    expect(host.toolChanges).toEqual(['hand']);
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('hand');
  });

  it('a keyboard tool switch writes back through [(tool)]', async () => {
    const { fixture, host, viewport } = await mount({
      options: { shortcuts: { scope: 'window' } },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    await fixture.whenStable();
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('hand');
    expect(host.tool()).toBe('hand');
    expect(host.toolChanges).toEqual(['hand']);
  });

  it('content children can inject FIELDNOTES_VIEWPORT and see null then the viewport', async () => {
    @Component({ selector: 'fn-test-consumer', template: '' })
    class Consumer {
      readonly viewport = inject(FIELDNOTES_VIEWPORT);
      readonly atConstruction = this.viewport();
    }
    @Component({
      imports: [FieldNotesCanvas, Consumer],
      template: '<fn-canvas (ready)="viewport = $event"><fn-test-consumer /></fn-canvas>',
    })
    class ConsumerHost {
      viewport: Viewport | null = null;
    }
    const fixture = TestBed.createComponent(ConsumerHost);
    await fixture.whenStable();
    const consumer: Consumer = fixture.debugElement.query(By.directive(Consumer)).componentInstance;
    expect(consumer.atConstruction).toBeNull();
    expect(consumer.viewport()).toBe(mounted(fixture.componentInstance.viewport));
  });

  it('a native change event from projected content does not reach (stateChange)', async () => {
    @Component({
      imports: [FieldNotesCanvas],
      template: '<fn-canvas (stateChange)="calls = calls + 1"><input /></fn-canvas>',
    })
    class InputHost {
      calls = 0;
    }
    const fixture = TestBed.createComponent(InputHost);
    await fixture.whenStable();
    fixture.nativeElement
      .querySelector('input')
      .dispatchEvent(new Event('change', { bubbles: true }));
    expect(fixture.componentInstance.calls).toBe(0);
  });

  it('a throwing ready listener does not destroy the viewport', async () => {
    const { handleError, testModule } = errorHandlerSpy();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('host setup failed');
    const { fixture, viewport } = await mount(
      {
        onReady: () => {
          throw failure;
        },
      },
      testModule,
    );
    expect(handleError).toHaveBeenCalledWith(failure);
    expect(destroy).not.toHaveBeenCalled();
    expect(canvasOf(fixture).viewport()).toBe(mounted(viewport));
  });

  it('a mount failure after ready reaches ErrorHandler and resets viewport to null', async () => {
    const { handleError, testModule } = errorHandlerSpy();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('activate failed');
    const boom: Tool = {
      name: 'boom',
      onPointerDown: () => undefined,
      onPointerMove: () => undefined,
      onPointerUp: () => undefined,
      onActivate: () => {
        throw failure;
      },
    };
    const { fixture, host } = await mount(
      { tool: 'boom', onReady: (vp) => vp.toolManager.register(boom) },
      testModule,
    );
    expect(host.readies).toHaveLength(1);
    expect(handleError).toHaveBeenCalledWith(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(canvasOf(fixture).viewport()).toBeNull();
  });

  it('invalid initialData reaches ErrorHandler and leaves viewport null', async () => {
    const { handleError, testModule } = errorHandlerSpy();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const { fixture, host } = await mount({ initialData: '{' }, testModule);
    expect(handleError.mock.calls[0]?.[0]).toBeInstanceOf(SyntaxError);
    expect(host.readies).toEqual([]);
    expect(canvasOf(fixture).viewport()).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
    fixture.destroy();
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});

describe('FieldNotesCanvas initialData and stateChange', () => {
  const saved = {
    version: 5,
    camera: { position: { x: 0, y: 0 }, zoom: 1 },
    elements: [
      {
        ...createShape({ position: { x: 10, y: 20 }, size: { w: 30, h: 40 }, index: 'a0' }),
        id: 's1',
      },
    ],
  } satisfies ImportableCanvasState;

  function fakeTimers() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  }

  it.each([
    ['object', saved],
    ['JSON string', JSON.stringify(saved)],
  ])('loads initialData given as %s before ready without a stateChange', async (_, data) => {
    let idsAtReady: string[] = [];
    const { host } = await mount({
      initialData: data,
      onReady: (vp) => {
        idsAtReady = vp.store.getAll().map((e) => e.id);
      },
    });
    fakeTimers();
    vi.advanceTimersByTime(1000);
    expect(idsAtReady).toEqual(['s1']);
    expect(host.states).toEqual([]);
  });

  it('registering deferred defaults after ready does not emit stateChange', async () => {
    const { host, viewport } = await mount();
    fakeTimers();
    vi.advanceTimersByTime(1000);
    expect(mounted(viewport).toolManager.activeTool?.name).toBe('select');
    expect(host.states).toEqual([]);
  });

  it('debounces rapid changes into one stateChange with the exported state', async () => {
    const { host, viewport } = await mount();
    fakeTimers();
    addShape(mounted(viewport), 'a');
    vi.advanceTimersByTime(100);
    addShape(mounted(viewport), 'b');
    vi.advanceTimersByTime(249);
    expect(host.states).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(host.states).toHaveLength(1);
    expect(host.states[0]?.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(host.states[0]).toEqual(mounted(viewport).exportState());
  });

  it('changeDebounceMs=0 fires on the next timer, not synchronously', async () => {
    const { host, viewport } = await mount({ changeDebounceMs: 0 });
    fakeTimers();
    addShape(mounted(viewport), 'a');
    expect(host.states).toEqual([]);
    vi.advanceTimersByTime(0);
    expect(host.states).toHaveLength(1);
  });

  it('uses the latest changeDebounceMs', async () => {
    const { fixture, host, viewport } = await mount();
    host.changeDebounceMs.set(10);
    await fixture.whenStable();
    fakeTimers();
    addShape(mounted(viewport), 'a');
    vi.advanceTimersByTime(10);
    expect(host.states).toHaveLength(1);
  });

  it('flushes a pending stateChange exactly once on destroy, before viewport destroy', async () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    let destroysBeforeFlush = -1;
    const { fixture, host, viewport } = await mount({
      onChange: () => {
        destroysBeforeFlush = destroy.mock.calls.length;
      },
    });
    fakeTimers();
    addShape(mounted(viewport), 'a');
    fixture.destroy();
    vi.advanceTimersByTime(1000);
    expect(host.states).toHaveLength(1);
    expect(host.states[0]?.elements.map((e) => e.id)).toEqual(['a']);
    expect(destroysBeforeFlush).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending stateChange to the parent listener on destroy without a console warning', async () => {
    const warn = vi.spyOn(console, 'warn');
    const error = vi.spyOn(console, 'error');
    const { fixture, host, viewport } = await mount();
    addShape(mounted(viewport), 'a');
    fixture.destroy();
    expect(host.states.map((s) => s.elements.map((e) => e.id))).toEqual([['a']]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('a throwing (stateChange) listener during the destroy flush reaches ErrorHandler and the viewport is still destroyed', async () => {
    const { handleError, testModule } = errorHandlerSpy();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const quota = new Error('quota exceeded');
    const { fixture, viewport } = await mount(
      {
        onChange: () => {
          throw quota;
        },
      },
      testModule,
    );
    addShape(mounted(viewport), 'a');
    expect(() => fixture.destroy()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(handleError).toHaveBeenCalledWith(quota);
  });
});

describe('FieldNotesCanvas in a zone app', () => {
  it.runIf('Zone' in globalThis)(
    'ready, stateChange and toolChange handlers update the host template without detectChanges',
    async () => {
      @Component({
        imports: [FieldNotesCanvas],
        template: `<fn-canvas
            (ready)="viewport = $event"
            (stateChange)="states = states + 1"
            (toolChange)="tool = $event"
          />
          <p>{{ viewport ? 'ready' : 'waiting' }} {{ states }} {{ tool }}</p>`,
      })
      class ZoneHost {
        viewport: Viewport | null = null;
        states = 0;
        tool: string | undefined = '';
      }
      const fixture = TestBed.createComponent(ZoneHost);
      await fixture.whenStable();
      const text = () => fixture.nativeElement.querySelector('p').textContent.trim();
      expect(text()).toBe('ready 0');

      const viewport = mounted(fixture.componentInstance.viewport);
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      addShape(viewport, 'a');
      vi.advanceTimersByTime(250);
      await fixture.whenStable();
      expect(text()).toBe('ready 1');

      viewport.setTool('hand');
      await fixture.whenStable();
      expect(text()).toBe('ready 1 hand');
    },
  );

  it.runIf('Zone' in globalThis)(
    'ready, stateChange and toolChange listeners run inside the Angular zone',
    async () => {
      @Component({
        imports: [FieldNotesCanvas],
        template: `<fn-canvas
          (ready)="record('ready')"
          (stateChange)="record('stateChange')"
          (toolChange)="record('toolChange')"
        />`,
      })
      class ZoneHost {
        readonly calls: string[] = [];
        record(name: string): void {
          this.calls.push(`${name} ${NgZone.isInAngularZone()}`);
        }
      }
      const fixture = TestBed.createComponent(ZoneHost);
      await fixture.whenStable();
      const viewport = mounted(canvasOf(fixture).viewport());
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      addShape(viewport, 'a');
      vi.advanceTimersByTime(250);
      viewport.setTool('hand');
      expect(fixture.componentInstance.calls).toEqual([
        'ready true',
        'stateChange true',
        'toolChange true',
      ]);
    },
  );

  it.runIf('Zone' in globalThis)(
    'a pointer drag on the canvas causes no change detection',
    async () => {
      @Component({ imports: [FieldNotesCanvas], template: '<fn-canvas />' })
      class DragHost {}
      const fixture = TestBed.createComponent(DragHost);
      await fixture.whenStable();
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
      const canvas = fixture.nativeElement.querySelector('canvas');
      for (const [type, x] of [
        ['pointerdown', 10],
        ['pointermove', 40],
        ['pointermove', 80],
        ['pointerup', 80],
      ] as const) {
        canvas.dispatchEvent(
          new PointerEvent(type, {
            bubbles: true,
            pointerId: 1,
            button: 0,
            clientX: x,
            clientY: x,
          }),
        );
      }
      expect(turns).toBe(0);
    },
  );
});
