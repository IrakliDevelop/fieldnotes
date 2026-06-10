import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import type { HistoryRecorder } from '../history/history-recorder';
import type { HistoryStack } from '../history/history-stack';
import type { CanvasElement, ArrowElement } from '../elements/types';
import { createId } from '../elements/create-id';

export interface KeyboardActionsDeps {
  getToolManager: () => ToolManager | null;
  getToolContext: () => ToolContext | null;
  getHistoryRecorder: () => HistoryRecorder | null;
  getHistoryStack: () => HistoryStack | null;
  isToolActive: () => boolean;
  fitToContent?: () => void;
}

export class KeyboardActions {
  private clipboard: CanvasElement[] = [];
  private pasteCount = 0;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: KeyboardActionsDeps) {}

  dispose(): void {
    this.flushNudge();
  }

  private selectTool(): { tool: SelectTool; ctx: ToolContext } | null {
    const tm = this.deps.getToolManager();
    const ctx = this.deps.getToolContext();
    if (!tm || !ctx) return null;
    const tool = tm.activeTool;
    if (tool?.name !== 'select') return null;
    return { tool: tool as SelectTool, ctx };
  }

  nudge(dx: number, dy: number, byCell: boolean): boolean {
    if (this.deps.isToolActive()) return false;
    const sel = this.selectTool();
    if (!sel) return false;
    if (sel.tool.selectedIds.length === 0) return false;

    const step = byCell ? (sel.ctx.gridSize ?? 10) : 1;
    if (this.nudgeTimer === null) {
      this.deps.getHistoryRecorder()?.begin();
    } else {
      clearTimeout(this.nudgeTimer);
    }
    const moved = sel.tool.nudgeSelection(dx * step, dy * step, sel.ctx);
    this.nudgeTimer = setTimeout(() => this.flushNudge(), 400);
    return moved;
  }

  private flushNudge(): void {
    if (this.nudgeTimer === null) return;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    this.deps.getHistoryRecorder()?.commit();
  }

  deleteSelected(): void {
    this.flushNudge();
    const sel = this.selectTool();
    if (!sel) return;
    const ids = sel.tool.selectedIds;
    if (ids.length === 0) return;
    const recorder = this.deps.getHistoryRecorder();
    recorder?.begin();
    for (const id of ids) {
      sel.ctx.store.remove(id);
    }
    recorder?.commit();
    sel.ctx.requestRender();
  }

  undo(): void {
    this.flushNudge();
    const ctx = this.deps.getToolContext();
    const stack = this.deps.getHistoryStack();
    if (!stack || !ctx) return;
    const recorder = this.deps.getHistoryRecorder();
    recorder?.pause();
    stack.undo(ctx.store);
    recorder?.resume();
    ctx.requestRender();
  }

  redo(): void {
    this.flushNudge();
    const ctx = this.deps.getToolContext();
    const stack = this.deps.getHistoryStack();
    if (!stack || !ctx) return;
    const recorder = this.deps.getHistoryRecorder();
    recorder?.pause();
    stack.redo(ctx.store);
    recorder?.resume();
    ctx.requestRender();
  }

  copy(): void {
    if (this.deps.isToolActive()) return;
    const sel = this.selectTool();
    if (!sel) return;
    const ids = sel.tool.selectedIds;
    if (ids.length === 0) return;
    this.clipboard = [];
    for (const id of ids) {
      const el = sel.ctx.store.getById(id);
      if (el) this.clipboard.push(structuredClone(el));
    }
    this.pasteCount = 0;
  }

  paste(): void {
    this.flushNudge();
    if (this.clipboard.length === 0 || this.deps.isToolActive()) return;
    const sel = this.selectTool();
    if (!sel) return;
    this.pasteCount++;
    this.insertClones(this.clipboard, this.pasteCount * 20, sel);
  }

  duplicate(): void {
    this.flushNudge();
    if (this.deps.isToolActive()) return;
    const sel = this.selectTool();
    if (!sel) return;
    const source: CanvasElement[] = [];
    for (const id of sel.tool.selectedIds) {
      const el = sel.ctx.store.getById(id);
      if (el) source.push(el);
    }
    if (source.length === 0) return;
    this.insertClones(source, 20, sel);
  }

  deselect(): void {
    if (this.deps.isToolActive()) return;
    const sel = this.selectTool();
    if (!sel) return;
    if (sel.tool.selectedIds.length === 0) return;
    sel.tool.setSelection([]);
    sel.ctx.requestRender();
  }

  selectAll(): void {
    if (this.deps.isToolActive()) return;
    const tm = this.deps.getToolManager();
    const ctx = this.deps.getToolContext();
    if (!tm || !ctx) return;
    if (tm.activeTool?.name !== 'select') {
      ctx.switchTool?.('select');
    }
    const sel = this.selectTool();
    if (!sel) return;
    const ids = sel.ctx.store
      .getAll()
      .filter(
        (el) =>
          !el.locked &&
          (sel.ctx.isLayerVisible?.(el.layerId) ?? true) &&
          !(sel.ctx.isLayerLocked?.(el.layerId) ?? false),
      )
      .map((el) => el.id);
    sel.tool.setSelection(ids);
    sel.ctx.requestRender();
  }

  zOrder(operation: 'forward' | 'backward' | 'front' | 'back'): void {
    this.flushNudge();
    const sel = this.selectTool();
    if (!sel) return;
    const ids = sel.tool.selectedIds;
    if (ids.length === 0) return;
    const recorder = this.deps.getHistoryRecorder();
    recorder?.begin();
    for (const id of ids) {
      switch (operation) {
        case 'forward':
          sel.ctx.store.bringForward(id);
          break;
        case 'backward':
          sel.ctx.store.sendBackward(id);
          break;
        case 'front':
          sel.ctx.store.bringToFront(id);
          break;
        case 'back':
          sel.ctx.store.sendToBack(id);
          break;
      }
    }
    recorder?.commit();
    sel.ctx.requestRender();
  }

  private insertClones(
    source: CanvasElement[],
    offset: number,
    sel: { tool: SelectTool; ctx: ToolContext },
  ): void {
    const idMap = new Map<string, string>();
    for (const el of source) {
      idMap.set(el.id, createId(el.type));
    }

    const newIds: string[] = [];
    const recorder = this.deps.getHistoryRecorder();
    recorder?.begin();

    for (const el of source) {
      const clone = structuredClone(el);
      const newId = idMap.get(el.id);
      if (!newId) continue;
      clone.id = newId;
      clone.position = { x: clone.position.x + offset, y: clone.position.y + offset };

      if (clone.type === 'arrow') {
        const arrow = clone as ArrowElement;
        arrow.from = { x: arrow.from.x + offset, y: arrow.from.y + offset };
        arrow.to = { x: arrow.to.x + offset, y: arrow.to.y + offset };
        delete arrow.cachedControlPoint;

        if (arrow.fromBinding) {
          const newTarget = idMap.get(arrow.fromBinding.elementId);
          if (newTarget) {
            arrow.fromBinding = { elementId: newTarget };
          } else {
            delete arrow.fromBinding;
          }
        }
        if (arrow.toBinding) {
          const newTarget = idMap.get(arrow.toBinding.elementId);
          if (newTarget) {
            arrow.toBinding = { elementId: newTarget };
          } else {
            delete arrow.toBinding;
          }
        }
      }

      if (sel.ctx.activeLayerId) {
        clone.layerId = sel.ctx.activeLayerId;
      }

      sel.ctx.store.add(clone);
      newIds.push(clone.id);
    }

    recorder?.commit();
    sel.tool.setSelection(newIds);
    sel.ctx.requestRender();
  }
}
