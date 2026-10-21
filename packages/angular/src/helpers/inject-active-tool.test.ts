import { afterEach, describe, expect, it } from 'vitest';
import { HandTool, SelectTool } from '@fieldnotes/core';
import { createTestViewport, destroyTestViewports } from '../test-utils/create-test-viewport';
import { mountHelper } from '../test-utils/mount-helper';
import { injectActiveTool } from './inject-active-tool';

afterEach(destroyTestViewports);

function viewportWithTools() {
  const viewport = createTestViewport();
  viewport.toolManager.register(new HandTool());
  viewport.toolManager.register(new SelectTool());
  viewport.setTool('select');
  return viewport;
}

describe('injectActiveTool', () => {
  it("holds '' and the setter throws before a viewport exists", async () => {
    const {
      result: [toolName, setTool],
    } = await mountHelper(() => injectActiveTool(), null);
    expect(toolName()).toBe('');
    expect(() => setTool('hand')).toThrow(
      '[fieldnotes] setActiveTool called before <fn-canvas> mounted',
    );
  });

  it('returns an empty name when no tool is active', async () => {
    const {
      result: [toolName],
    } = await mountHelper(() => injectActiveTool());
    expect(toolName()).toBe('');
  });

  it('returns the active tool name and a setter that switches it', async () => {
    const {
      result: [toolName, setTool],
    } = await mountHelper(() => injectActiveTool(), viewportWithTools());
    expect(toolName()).toBe('select');
    setTool('hand');
    expect(toolName()).toBe('hand');
  });

  it('updates when the tool changes externally', async () => {
    const viewport = viewportWithTools();
    const {
      result: [toolName],
    } = await mountHelper(() => injectActiveTool(), viewport);
    viewport.toolManager.setTool('hand', viewport.toolContext);
    expect(toolName()).toBe('hand');
  });
});
