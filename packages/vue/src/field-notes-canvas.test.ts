import { describe, it, expect, expectTypeOf, vi, afterEach, type Mock } from 'vitest';
import { mount, enableAutoUnmount } from '@vue/test-utils';
import {
  KeepAlive,
  createApp,
  defineComponent,
  h,
  nextTick,
  provide,
  reactive,
  ref,
  type ExtractPublicPropTypes,
  type VNode,
} from 'vue';
import type { fieldNotesCanvasProps } from './field-notes-canvas';
import {
  FieldNotesCanvas,
  type FieldNotesCanvasProps,
  type FieldNotesCanvasRef,
} from './field-notes-canvas';
import { ViewportKey } from './context';
import { useViewport } from './composables/use-viewport';
import { createTestViewport, destroyTestViewports } from './test-utils/create-test-viewport';
import { HandTool, SelectTool, PencilTool, Viewport, createShape } from '@fieldnotes/core';
import type { CanvasState, ImportableCanvasState, Tool } from '@fieldnotes/core';

type OnReady = Mock<(viewport: Viewport) => void>;

const DEFAULT_TOOL_NAMES = [
  'hand',
  'select',
  'pencil',
  'eraser',
  'arrow',
  'note',
  'text',
  'shape',
  'frame',
];

/** The viewport handed to the `index`-th `onReady` call (negative counts from the end). */
function viewportAt(onReady: OnReady, index: number): Viewport {
  const call = onReady.mock.calls.at(index);
  if (!call) throw new Error(`onReady was not called (call index ${index})`);
  return call[0];
}

enableAutoUnmount(afterEach);

/** Mounts through a plain app whose errorHandler receives lifecycle throws, as in production. */
function mountWithErrorHandler(render: () => VNode) {
  const errorHandler = vi.fn();
  const app = createApp({ render });
  app.config.errorHandler = errorHandler;
  app.mount(document.createElement('div'));
  return { app, errorHandler };
}

describe('FieldNotesCanvas', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('declares runtime props matching FieldNotesCanvasProps', () => {
    expectTypeOf<ExtractPublicPropTypes<typeof fieldNotesCanvasProps>>().branded.toEqualTypeOf<
      Readonly<FieldNotesCanvasProps>
    >();
  });

  it('creates a Viewport with a canvas inside the root div', () => {
    const wrapper = mount(FieldNotesCanvas);
    expect(wrapper.element.tagName).toBe('DIV');
    expect(wrapper.element.querySelector('canvas')).not.toBeNull();
  });

  it('destroys the Viewport on unmount', () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const wrapper = mount(FieldNotesCanvas);
    const root = wrapper.element;
    wrapper.unmount();
    expect(root.querySelector('canvas')).toBeNull();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('passes class and style through to the root div', () => {
    const wrapper = mount(FieldNotesCanvas, {
      attrs: { class: 'my-canvas', style: 'border: 1px solid red' },
    });
    expect(wrapper.element.classList.contains('my-canvas')).toBe(true);
    expect((wrapper.element as HTMLElement).style.border).toBe('1px solid red');
  });

  it('renders the default slot once the viewport exists, with useViewport available', async () => {
    let seen: Viewport | undefined;
    const Consumer = defineComponent({
      setup() {
        seen = useViewport();
        return () => h('span', { class: 'child' });
      },
    });
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const wrapper = mount(FieldNotesCanvas, {
      props: { onReady },
      slots: { default: () => h(Consumer) },
    });
    await nextTick();
    expect(wrapper.find('.child').exists()).toBe(true);
    expect(seen).toBe(viewportAt(onReady, 0));
  });

  it('exposes the viewport through a template ref', async () => {
    const canvas = ref<FieldNotesCanvasRef | null>(null);
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(() => h(FieldNotesCanvas, { ref: canvas, onReady }));
    await nextTick();
    expect(canvas.value?.viewport).toBe(viewportAt(onReady, 0));
  });

  it('registers tools passed as props', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], defaultTool: 'select', onReady },
    });
    expect(onReady).toHaveBeenCalledTimes(1);
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual(['hand', 'select']);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('a bare canvas registers the default bundle with select active', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, { props: { onReady } });
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it('tools=[] registers nothing and activates no tool', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, { props: { tools: [], onReady } });
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual([]);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it("tools='default' registers the default bundle even with options.tools set", () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, {
      props: { tools: 'default', options: { tools: [new HandTool()] }, onReady },
    });
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual(DEFAULT_TOOL_NAMES);
    expect(viewport.toolManager.activeTool?.name).toBe('select');
  });

  it("tools='default' registers the bundle before onReady", () => {
    let namesAtReady: string[] = [];
    mount(FieldNotesCanvas, {
      props: {
        tools: 'default',
        onReady: (vp: Viewport) => {
          namesAtReady = [...vp.toolManager.toolNames];
        },
      },
    });
    expect(namesAtReady).toEqual(DEFAULT_TOOL_NAMES);
  });

  it('omitted tools register no defaults when onReady registered a tool', () => {
    const onReady = vi.fn((vp: Viewport) => {
      vp.toolManager.register(new HandTool());
    });
    mount(FieldNotesCanvas, { props: { onReady } });
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.toolNames).toEqual(['hand']);
    expect(viewport.toolManager.activeTool).toBeNull();
  });

  it('omitted tools activate the tool prop after onReady registered it', () => {
    const onReady = vi.fn((vp: Viewport) => {
      vp.toolManager.register(new HandTool());
    });
    const warn = vi.spyOn(console, 'warn');
    mount(FieldNotesCanvas, { props: { tool: 'hand', onReady } });
    const viewport = viewportAt(onReady, 0);
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(warn).not.toHaveBeenCalled();
  });

  it('omitted tools defer to options.tools instead of the default bundle', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, { props: { options: { tools: [new HandTool()] }, onReady } });
    expect(viewportAt(onReady, 0).toolManager.toolNames).toEqual(['hand']);
  });

  it('defaultTool wins over select with the default bundle', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, { props: { defaultTool: 'pencil', onReady } });
    expect(viewportAt(onReady, 0).toolManager.activeTool?.name).toBe('pencil');
  });

  it('tools replaced after mount are registered', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const wrapper = mount(FieldNotesCanvas, { props: { tools: [new HandTool()], onReady } });
    const viewport = viewportAt(onReady, 0);
    await wrapper.setProps({ tools: [new HandTool(), new PencilTool()] });
    expect(viewport.toolManager.toolNames).toEqual(['hand', 'pencil']);
  });

  it('a tool pushed into a reactive tools array is registered unproxied', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const hand = new HandTool();
    const tools = reactive<Tool[]>([hand]);
    mount(FieldNotesCanvas, { props: { tools, onReady } });
    const viewport = viewportAt(onReady, 0);
    const pencil = new PencilTool();
    tools.push(pencil);
    await nextTick();
    expect(viewport.toolManager.getTool('pencil')).toBe(pencil);
    expect(viewport.toolManager.getTool('hand')).toBe(hand);
  });

  it('constructs the viewport from unproxied options', () => {
    const hand = new HandTool();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, { props: { options: reactive({ tools: [hand] }), onReady } });
    expect(viewportAt(onReady, 0).toolManager.getTool('hand')).toBe(hand);
  });

  it('controlled tool wins over defaultTool at mount', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    mount(FieldNotesCanvas, {
      props: {
        tools: [new HandTool(), new SelectTool()],
        defaultTool: 'hand',
        tool: 'select',
        onReady,
      },
    });
    expect(viewportAt(onReady, 0).toolManager.activeTool?.name).toBe('select');
  });

  it('tool prop change switches the active tool', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const wrapper = mount(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], tool: 'select', onReady },
    });
    const viewport = viewportAt(onReady, 0);
    await wrapper.setProps({ tool: 'hand' });
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('an API tool switch calls onToolChange and emits update:tool without reverting the prop', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onToolChange = vi.fn<(name: string) => void>();
    const wrapper = mount(FieldNotesCanvas, {
      props: { tools: [new HandTool(), new SelectTool()], tool: 'select', onToolChange, onReady },
    });
    const viewport = viewportAt(onReady, 0);
    viewport.setTool('hand');
    expect(onToolChange).toHaveBeenCalledWith('hand');
    expect(wrapper.emitted('update:tool')).toEqual([['hand']]);
    expect(wrapper.props('tool')).toBe('select');
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
  });

  it('a keyboard tool switch emits update:tool', () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const wrapper = mount(FieldNotesCanvas, {
      props: { options: { shortcuts: { scope: 'window' } }, onReady },
    });
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'h' }));
    expect(viewportAt(onReady, 0).toolManager.activeTool?.name).toBe('hand');
    expect(wrapper.emitted('update:tool')).toEqual([['hand']]);
  });

  it('v-model:tool does not loop (set -> update:tool -> same value)', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    let changeCount = 0;
    const tool = ref('select');
    const tools = [new HandTool(), new SelectTool()];
    mount(() =>
      h(FieldNotesCanvas, {
        tools,
        tool: tool.value,
        'onUpdate:tool': (name: string) => {
          changeCount++;
          tool.value = name;
        },
        onReady,
      }),
    );
    const viewport = viewportAt(onReady, 0);
    viewport.setTool('hand');
    await nextTick();
    expect(tool.value).toBe('hand');
    expect(viewport.toolManager.activeTool?.name).toBe('hand');
    expect(changeCount).toBe(1);
  });

  it('snapToGrid is reactive', async () => {
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const wrapper = mount(FieldNotesCanvas, { props: { snapToGrid: true, onReady } });
    const viewport = viewportAt(onReady, 0);
    await nextTick();
    expect(viewport.snapToGrid).toBe(true);
    await wrapper.setProps({ snapToGrid: false });
    expect(viewport.snapToGrid).toBe(false);
  });

  it('an absent snapToGrid leaves the core flag untouched', async () => {
    const setSnapToGrid = vi.spyOn(Viewport.prototype, 'setSnapToGrid');
    mount(FieldNotesCanvas);
    await nextTick();
    expect(setSnapToGrid).not.toHaveBeenCalled();
  });

  it('under KeepAlive, deactivation keeps the viewport and unmount destroys it once', async () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const shown = ref(true);
    const Other = defineComponent({ render: () => h('p') });
    const wrapper = mount(() =>
      h(KeepAlive, null, shown.value ? h(FieldNotesCanvas, { onReady, onChange }) : h(Other)),
    );
    const viewport = viewportAt(onReady, 0);
    addShape(viewport, 'a');
    shown.value = false;
    await nextTick();
    expect(destroy).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    shown.value = true;
    await nextTick();
    expect(onReady).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(destroy.mock.contexts).toEqual([viewport]);
    vi.useRealTimers();
  });
});

function addShape(viewport: Viewport, id: string) {
  viewport.store.add({
    ...createShape({ position: { x: 0, y: 0 }, size: { w: 5, h: 5 } }),
    id,
    layerId: viewport.layerManager.activeLayerId,
  });
}

describe('FieldNotesCanvas initialData and onChange', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

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

  it.each([
    ['object', saved],
    ['JSON string', JSON.stringify(saved)],
  ])('loads initialData given as %s before onReady without calling onChange', (_, data) => {
    vi.useFakeTimers();
    const onChange = vi.fn<(state: CanvasState) => void>();
    let idsAtReady: string[] = [];
    mount(FieldNotesCanvas, {
      props: {
        initialData: data,
        onChange,
        onReady: (vp: Viewport) => {
          idsAtReady = vp.store.getAll().map((e) => e.id);
        },
      },
    });
    vi.advanceTimersByTime(1000);
    expect(idsAtReady).toEqual(['s1']);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('destroys the viewport and rethrows when initialData fails to load', () => {
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const { app, errorHandler } = mountWithErrorHandler(() =>
      h(FieldNotesCanvas, { initialData: '{' }),
    );
    expect(errorHandler.mock.calls[0]?.[0]).toBeInstanceOf(SyntaxError);
    expect(destroy).toHaveBeenCalledTimes(1);
    app.unmount();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the viewport and rethrows when onReady throws', () => {
    vi.useFakeTimers();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const failure = new Error('host setup failed');
    const onChange = vi.fn<(state: CanvasState) => void>();
    const { app, errorHandler } = mountWithErrorHandler(() =>
      h(FieldNotesCanvas, {
        onChange,
        onReady: (vp: Viewport) => {
          addShape(vp, 'a');
          throw failure;
        },
      }),
    );
    expect(errorHandler.mock.calls[0]?.[0]).toBe(failure);
    expect(destroy).toHaveBeenCalledTimes(1);
    app.unmount();
    vi.advanceTimersByTime(1000);
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('registering deferred defaults after onReady does not fire onChange', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    mount(FieldNotesCanvas, { props: { onChange, onReady } });
    vi.advanceTimersByTime(1000);
    expect(viewportAt(onReady, 0).toolManager.activeTool?.name).toBe('select');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('debounces rapid changes into one onChange with the exported state', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    mount(FieldNotesCanvas, { props: { onChange, onReady } });
    const viewport = viewportAt(onReady, 0);
    addShape(viewport, 'a');
    vi.advanceTimersByTime(100);
    addShape(viewport, 'b');
    vi.advanceTimersByTime(249);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onChange).toHaveBeenCalledTimes(1);
    const state = onChange.mock.calls[0]?.[0];
    expect(state?.elements.map((e) => e.id)).toEqual(['a', 'b']);
    expect(state).toEqual(viewport.exportState());
  });

  it('changeDebounceMs=0 fires on the next timer, not synchronously', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    mount(FieldNotesCanvas, { props: { onChange, changeDebounceMs: 0, onReady } });
    addShape(viewportAt(onReady, 0), 'a');
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(0);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('uses the latest changeDebounceMs', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const onChange = vi.fn<(state: CanvasState) => void>();
    const wrapper = mount(FieldNotesCanvas, { props: { onChange, onReady } });
    await wrapper.setProps({ changeDebounceMs: 10 });
    addShape(viewportAt(onReady, 0), 'a');
    vi.advanceTimersByTime(10);
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('flushes a pending change exactly once on unmount, before destroy', () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    let destroysBeforeFlush = -1;
    const onChange = vi.fn<(state: CanvasState) => void>(() => {
      destroysBeforeFlush = destroy.mock.calls.length;
    });
    const wrapper = mount(FieldNotesCanvas, { props: { onChange, onReady } });
    addShape(viewportAt(onReady, 0), 'a');
    wrapper.unmount();
    vi.advanceTimersByTime(1000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]?.[0].elements.map((e) => e.id)).toEqual(['a']);
    expect(destroysBeforeFlush).toBe(0);
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys the viewport and reports the error when the unmount flush throws', () => {
    vi.useFakeTimers();
    const reportError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal('reportError', reportError);
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const destroy = vi.spyOn(Viewport.prototype, 'destroy');
    const quota = new Error('quota exceeded');
    const wrapper = mount(FieldNotesCanvas, {
      props: {
        onChange: () => {
          throw quota;
        },
        onReady,
      },
    });
    addShape(viewportAt(onReady, 0), 'a');
    expect(() => wrapper.unmount()).not.toThrow();
    expect(destroy).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledWith(quota);
  });

  it('falls back to console.error when reportError is unavailable', () => {
    vi.useFakeTimers();
    vi.stubGlobal('reportError', undefined);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const quota = new Error('quota exceeded');
    const wrapper = mount(FieldNotesCanvas, {
      props: {
        onChange: () => {
          throw quota;
        },
        onReady,
      },
    });
    addShape(viewportAt(onReady, 0), 'a');
    wrapper.unmount();
    expect(error).toHaveBeenCalledWith('[fieldnotes] onChange failed during unmount', quota);
  });

  it('uses a replaced onChange without duplicate calls', async () => {
    vi.useFakeTimers();
    const onReady = vi.fn<(viewport: Viewport) => void>();
    const first = vi.fn<(state: CanvasState) => void>();
    const second = vi.fn<(state: CanvasState) => void>();
    const wrapper = mount(FieldNotesCanvas, { props: { onChange: first, onReady } });
    await wrapper.setProps({ onChange: second });
    addShape(viewportAt(onReady, 0), 'a');
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('useViewport', () => {
  afterEach(destroyTestViewports);

  it('throws outside <FieldNotesCanvas>', () => {
    const Consumer = defineComponent({
      setup() {
        useViewport();
        return () => null;
      },
    });
    const { errorHandler } = mountWithErrorHandler(() => h(Consumer));
    expect(errorHandler.mock.calls[0]?.[0]).toEqual(
      new Error('useViewport must be used inside <FieldNotesCanvas>'),
    );
  });

  it('returns a viewport a host provided under ViewportKey', () => {
    const viewport = createTestViewport();
    let seen: Viewport | undefined;
    const Consumer = defineComponent({
      setup() {
        seen = useViewport();
        return () => null;
      },
    });
    const Host = defineComponent({
      setup() {
        provide(ViewportKey, viewport);
        return () => h(Consumer);
      },
    });
    mount(Host);
    expect(seen).toBe(viewport);
  });
});
