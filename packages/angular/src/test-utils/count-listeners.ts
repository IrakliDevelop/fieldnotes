import { onTestFinished } from 'vitest';
import {
  Camera,
  ElementStore,
  HistoryStack,
  LayerManager,
  PencilTool,
  ShapeTool,
  ToolManager,
  Viewport,
} from '@fieldnotes/core';

type Subscribe = (...args: never[]) => () => void;

/** Wraps every viewport listener registration; the result counts those still subscribed. */
export function countOpenListeners(): () => number {
  let open = 0;
  const wrap = <K extends string>(proto: Record<K, Subscribe>, key: K) => {
    const original = proto[key];
    proto[key] = function (this: unknown, ...args: never[]) {
      open++;
      const off = original.apply(this, args);
      return () => {
        open--;
        off();
      };
    };
    onTestFinished(() => {
      proto[key] = original;
    });
  };
  wrap(Camera.prototype, 'onChange');
  wrap(ElementStore.prototype, 'onChange');
  wrap(Viewport.prototype, 'onSelectionChange');
  wrap(HistoryStack.prototype, 'onChange');
  wrap(LayerManager.prototype, 'on');
  wrap(ToolManager.prototype, 'onChange');
  wrap(PencilTool.prototype, 'onOptionsChange');
  wrap(ShapeTool.prototype, 'onOptionsChange');
  return () => open;
}
