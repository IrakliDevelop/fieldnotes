import type { Signal } from '@angular/core';
import { createActiveToolSource } from '@fieldnotes/core';
import { injectViewport } from '../inject-viewport';
import { injectSource, requireViewport } from './inject-source';

/** `[activeToolName, setTool]` — the name updates on tool switches; `''` with no active tool. */
export function injectActiveTool(): [Signal<string>, (name: string) => void] {
  const viewport = injectViewport();
  return [
    injectSource(createActiveToolSource, ''),
    (name) => requireViewport(viewport, 'setActiveTool').setTool(name),
  ];
}
