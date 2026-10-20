import { describe, it, expect, afterEach } from 'vitest';
import { enableAutoUnmount } from '@vue/test-utils';
import { HandTool, SelectTool } from '@fieldnotes/core';
import { useActiveTool } from './use-active-tool';
import { mountComposable } from '../test-utils/mount-composable';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';

enableAutoUnmount(afterEach);
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
    } = mountComposable(() => useActiveTool());
    expect(toolName.value).toBe('');
  });

  it('returns the active tool name and a setter that switches it', () => {
    const {
      result: [toolName, setTool],
    } = mountComposable(() => useActiveTool(), viewportWithTools());
    expect(toolName.value).toBe('select');
    setTool('hand');
    expect(toolName.value).toBe('hand');
  });

  it('updates when the tool changes externally', () => {
    const viewport = viewportWithTools();
    const {
      result: [toolName],
    } = mountComposable(() => useActiveTool(), viewport);
    viewport.toolManager.setTool('hand', viewport.toolContext);
    expect(toolName.value).toBe('hand');
  });
});
