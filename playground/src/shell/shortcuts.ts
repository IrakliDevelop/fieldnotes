import type { SceneInstance } from '../scene';
import { activateTool } from './toolbar';

function isTyping(): boolean {
  const el = document.activeElement;
  return (
    el instanceof HTMLElement && (el.isContentEditable || el.matches('input, textarea, select'))
  );
}

/** Activates the current scene's tool whose key was pressed. */
export function bindShortcuts(current: () => SceneInstance | null): void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || isTyping()) return;
    if (event.target instanceof Element && event.target.closest('[data-element-id]')) return;
    const instance = current();
    const spec = instance?.tools.find((tool) => tool.key === event.key);
    if (instance && spec) activateTool(instance.viewport, spec);
  };
  window.addEventListener('keydown', onKeyDown);
}
