/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi } from 'vitest';
import { KeyboardActions } from './keyboard-actions';
import type { KeyboardActionsDeps } from './keyboard-actions';
import { Camera } from './camera';
import { ElementStore } from '../elements/element-store';
import { SelectTool } from '../tools/select-tool';
import { createNote } from '../elements/element-factory';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { HistoryRecorder } from '../history/history-recorder';

function makeCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    camera: new Camera(),
    store: new ElementStore(),
    requestRender: vi.fn(),
    ...overrides,
  };
}

function makeActions(
  opts: {
    ctx?: ToolContext;
    tool?: SelectTool;
    recorder?: HistoryRecorder;
    fitToContent?: () => void;
  } = {},
): { actions: KeyboardActions; ctx: ToolContext; tool: SelectTool } {
  const ctx = opts.ctx ?? makeCtx();
  const tool = opts.tool ?? new SelectTool();
  tool.onActivate(ctx);
  const tm = { activeTool: tool } as unknown as ToolManager;
  const deps: KeyboardActionsDeps = {
    getToolManager: () => tm,
    getToolContext: () => ctx,
    getHistoryRecorder: () => opts.recorder ?? null,
    getHistoryStack: () => null,
    isToolActive: () => false,
    fitToContent: opts.fitToContent,
  };
  return { actions: new KeyboardActions(deps), ctx, tool };
}

describe('KeyboardActions.deselect', () => {
  it('clears the selection when select tool has one', () => {
    const { actions, ctx, tool } = makeActions();
    const note = createNote({ position: { x: 0, y: 0 }, size: { w: 100, h: 50 } });
    ctx.store.add(note);
    tool.setSelection([note.id]);

    actions.deselect();

    expect(tool.selectedIds).toEqual([]);
  });

  it('is a no-op when nothing is selected', () => {
    const { actions, ctx } = makeActions();
    vi.mocked(ctx.requestRender).mockClear();
    actions.deselect();
    expect(ctx.requestRender).not.toHaveBeenCalled();
  });
});
