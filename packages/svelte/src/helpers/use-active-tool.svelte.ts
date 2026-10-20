import type { Readable } from 'svelte/store';
import { createActiveToolSource } from '@fieldnotes/core';
import { useViewport } from '../context.js';
import { fromSource } from './from-source.svelte.js';

/** `[activeToolName, setTool]` — the name updates on tool switches; `''` with no active tool. */
export function useActiveTool(): [Readable<string>, (name: string) => void] {
  const viewport = useViewport();
  return [fromSource(createActiveToolSource(viewport)), (name) => viewport.setTool(name)];
}
