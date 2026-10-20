import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, provide, ref } from 'vue';
import { PencilTool, ShapeTool } from '@fieldnotes/core';
import type { ElementType } from '@fieldnotes/core';
import { FieldNotesCanvas } from '../field-notes-canvas';
import { ViewportKey } from '../context';
import { countOpenListeners } from '../test-utils/count-listeners';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { useActiveTool } from './use-active-tool';
import { useCamera } from './use-camera';
import { useElementRects } from './use-element-rects';
import { useElements } from './use-elements';
import { useHistory } from './use-history';
import { useLayers } from './use-layers';
import { useSelection } from './use-selection';
import { useSelectionOps } from './use-selection-ops';
import { useSelectionStyle } from './use-selection-style';
import { useSelectionStyleDetails } from './use-selection-style-details';
import { useToolOptions } from './use-tool-options';

afterEach(() => {
  vi.restoreAllMocks();
  destroyTestViewports();
});

const toolName = ref('pencil');
const elementType = ref<ElementType | undefined>(undefined);

const Consumer = defineComponent({
  setup() {
    useActiveTool();
    useCamera();
    useElementRects((el) => el.id);
    useElements(elementType);
    useElements((els) => els.length);
    useHistory();
    useLayers();
    useSelection();
    useSelectionOps();
    useSelectionStyle();
    useSelectionStyleDetails();
    useToolOptions(toolName);
    return () => null;
  },
});

describe('composable listener balance', () => {
  it('release every viewport listener when the whole canvas unmounts', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const open = countOpenListeners();
    const baseline = open();
    const errorHandler = vi.fn();
    const warnHandler = vi.fn();
    const app = createApp({ render: () => h(FieldNotesCanvas, null, () => h(Consumer)) });
    app.config.errorHandler = errorHandler;
    app.config.warnHandler = warnHandler;
    app.mount(document.createElement('div'));
    await nextTick();
    expect(open()).toBeGreaterThan(baseline);

    expect(() => app.unmount()).not.toThrow();
    expect(open()).toBe(baseline);
    expect(errorHandler).not.toHaveBeenCalled();
    expect(warnHandler).not.toHaveBeenCalled();
  });

  it('release every listener when a consumer unmounts after its inputs changed', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const viewport = createTestViewport();
    viewport.toolManager.register(new PencilTool());
    viewport.toolManager.register(new ShapeTool());
    const open = countOpenListeners();
    const baseline = open();
    const shown = ref(true);
    toolName.value = 'pencil';
    elementType.value = undefined;
    const app = createApp({
      setup() {
        provide(ViewportKey, viewport);
        return () => (shown.value ? h(Consumer) : null);
      },
    });
    app.mount(document.createElement('div'));
    expect(open()).toBeGreaterThan(baseline);

    toolName.value = 'shape';
    elementType.value = 'note';
    await nextTick();
    shown.value = false;
    await nextTick();

    expect(open()).toBe(baseline);
    app.unmount();
  });
});
