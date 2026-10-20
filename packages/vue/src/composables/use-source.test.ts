import { describe, it, expect, afterEach, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick } from 'vue';
import { FieldNotesCanvas } from '../field-notes-canvas';
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
});

describe('composables under an unmounting canvas', () => {
  it('unmount without errors or warnings after the canvas destroyed the viewport', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => null);
    const Consumer = defineComponent({
      setup() {
        useActiveTool();
        useCamera();
        useElementRects((el) => el.id);
        useElements();
        useElements((els) => els.length);
        useHistory();
        useLayers();
        useSelection();
        useSelectionOps();
        useSelectionStyle();
        useSelectionStyleDetails();
        useToolOptions('pencil');
        return () => null;
      },
    });
    const errorHandler = vi.fn();
    const warnHandler = vi.fn();
    const app = createApp({ render: () => h(FieldNotesCanvas, null, () => h(Consumer)) });
    app.config.errorHandler = errorHandler;
    app.config.warnHandler = warnHandler;
    app.mount(document.createElement('div'));
    await nextTick();

    expect(() => app.unmount()).not.toThrow();
    expect(errorHandler).not.toHaveBeenCalled();
    expect(warnHandler).not.toHaveBeenCalled();
  });
});
