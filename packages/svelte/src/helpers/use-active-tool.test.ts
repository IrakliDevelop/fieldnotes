import { describe, it, expect, afterEach } from 'vitest';
import { HandTool, SelectTool } from '@fieldnotes/core';
import { useActiveTool } from './use-active-tool.svelte.js';
import { mountHelper, record } from '../test-fixtures/mount-helper';
import { createTestViewport, destroyTestViewports } from '../test-fixtures/create-test-viewport';

afterEach(destroyTestViewports);

function viewportWithTools() {
  const viewport = createTestViewport();
  viewport.toolManager.register(new HandTool());
  viewport.toolManager.register(new SelectTool());
  viewport.setTool('select');
  return viewport;
}

describe('useActiveTool', () => {
  it('returns an empty name when no tool is active', () => {
    const {
      result: [toolName],
    } = mountHelper(() => useActiveTool());
    expect(record(toolName)).toEqual(['']);
  });

  it('returns the active tool name and a setter that switches it', () => {
    const {
      result: [toolName, setTool],
    } = mountHelper(() => useActiveTool(), viewportWithTools());
    const values = record(toolName);
    setTool('hand');
    expect(values).toEqual(['select', 'hand']);
  });

  it('updates when the tool changes externally', () => {
    const viewport = viewportWithTools();
    const {
      result: [toolName],
    } = mountHelper(() => useActiveTool(), viewport);
    const values = record(toolName);
    viewport.toolManager.setTool('hand', viewport.toolContext);
    expect(values.at(-1)).toBe('hand');
  });
});
