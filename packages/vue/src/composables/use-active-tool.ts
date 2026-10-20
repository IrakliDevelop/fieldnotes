import type { ShallowRef } from 'vue';
import { createActiveToolSource } from '@fieldnotes/core';
import { useViewport } from './use-viewport';
import { useSource } from './use-source';

/** `[activeToolName, setTool]` — the name updates on tool switches; `''` with no active tool. */
export function useActiveTool(): [Readonly<ShallowRef<string>>, (name: string) => void] {
  const viewport = useViewport();
  return [useSource(createActiveToolSource(viewport)), (name) => viewport.setTool(name)];
}
