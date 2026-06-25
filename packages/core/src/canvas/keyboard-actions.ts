import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import type { HistoryRecorder } from '../history/history-recorder';
import type { HistoryStack } from '../history/history-stack';
import type { CanvasElement } from '../elements/types';
import type { Point } from '../core/types';
import { createId } from '../elements/create-id';
import { getElementsBoundingBox } from '../elements/bounds';

export interface KeyboardActionsDeps {
  getToolManager: () => ToolManager | null;
  getToolContext: () => ToolContext | null;
  getHistoryRecorder: () => HistoryRecorder | null;
  getHistoryStack: () => HistoryStack | null;
  isToolActive: () => boolean;
  fitToContent?: () => void;
  group?: () => void;
  ungroup?: () => void;
  toggleLock?: () => void;
  getLastPointerWorld?: () => Point | null;
}

export class KeyboardActions {
  private clipboard: CanvasElement[] = [];
  private pasteCount = 0;
  private nudgeTimer: ReturnType<typeof setTimeout> | null = null;
  private nudgeTxId: number | null = null;

  constructor(private readonly deps: KeyboardActionsDeps) {}

  dispose(): void {
    this.flushPendingNudge();
  }

  private selectTool(): { tool: SelectTool; ctx: ToolContext } | null {
    const tm = this.deps.getToolManager();
    const ctx = this.deps.getToolContext();
    if (!tm || !ctx) return null;
    const tool = tm.activeTool;
    if (tool?.name !== 'select') return null;
    return { tool: tool as SelectTool, ctx };
  }

  private selectableElements(ctx: ToolContext): CanvasElement[] {
    return ctx.store
      .getAll()
      .filter(
        (el) =>
          !el.locked &&
          (ctx.isLayerVisible?.(el.layerId) ?? true) &&
          !(ctx.isLayerLocked?.(el.layerId) ?? false),
      );
  }

  nudge(dx: number, dy: number, byCell: boolean): boolean {
    if (this.deps.isToolActive()) return false;
    const sel = this.selectTool();
    if (!sel) return false;
    if (sel.tool.selectedIds.length === 0) return false;

    const step = byCell ? (sel.ctx.gridSize ?? 10) : 1;
    if (this.nudgeTimer === null) {
      const recorder = this.deps.getHistoryRecorder();
      recorder?.begin();
      this.nudgeTxId = recorder?.currentTransactionId ?? null;
    } else {
      clearTimeout(this.nudgeTimer);
      const recorder = this.deps.getHistoryRecorder();
      if (recorder?.currentTransactionId !== this.nudgeTxId) {
        recorder?.begin();
        this.nudgeTxId = recorder?.currentTransactionId ?? null;
      }
    }
    const moved = sel.tool.nudgeSelection(dx * step, dy * step, sel.ctx);
    this.nudgeTimer = setTimeout(() => this.flushPendingNudge(), 400);
    return moved;
  }

  flushPendingNudge(): void {
    if (this.nudgeTimer === null) return;
    clearTimeout(this.nudgeTimer);
    this.nudgeTimer = null;
    const recorder = this.deps.getHistoryRecorder();
    if (recorder?.currentTransactionId === this.nudgeTxId) {
      recorder?.commit();
    }
    this.nudgeTxId = null;
  }

  deleteSelected(): void {
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
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
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
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
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
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

  cut(): void {
    if (this.deps.isToolActive()) return;
    this.copy();
    this.deleteSelected();
  }

  hasClipboard(): boolean {
    return this.clipboard.length > 0;
  }

  paste(): void {
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
    if (this.clipboard.length === 0) return;
    const sel = this.selectTool();
    if (!sel) return;

    const cursor = this.deps.getLastPointerWorld?.() ?? null;
    if (cursor) {
      const bbox = getElementsBoundingBox(this.clipboard);
      if (bbox) {
        const centerX = bbox.x + bbox.w / 2;
        const centerY = bbox.y + bbox.h / 2;
        this.insertClones(this.clipboard, { x: cursor.x - centerX, y: cursor.y - centerY }, sel);
        return;
      }
    }

    this.pasteCount++;
    this.insertClones(this.clipboard, { x: this.pasteCount * 20, y: this.pasteCount * 20 }, sel);
  }

  duplicate(): void {
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
    const sel = this.selectTool();
    if (!sel) return;
    const source: CanvasElement[] = [];
    for (const id of sel.tool.selectedIds) {
      const el = sel.ctx.store.getById(id);
      if (el) source.push(el);
    }
    if (source.length === 0) return;
    this.insertClones(source, { x: 20, y: 20 }, sel);
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
    const ids = this.selectableElements(sel.ctx).map((el) => el.id);
    sel.tool.setSelection(ids);
    sel.ctx.requestRender();
  }

  cycleSelection(direction: 1 | -1): void {
    if (this.deps.isToolActive()) return;
    const tm = this.deps.getToolManager();
    const ctx = this.deps.getToolContext();
    if (!tm || !ctx) return;
    if (tm.activeTool?.name !== 'select') ctx.switchTool?.('select');
    const sel = this.selectTool();
    if (!sel) return;
    const eligible = this.selectableElements(sel.ctx).filter((el) => el.type !== 'grid');
    if (eligible.length === 0) return;
    const idxs = sel.tool.selectedIds
      .map((id) => eligible.findIndex((e) => e.id === id))
      .filter((i) => i >= 0);
    const anchor =
      idxs.length === 0
        ? direction > 0
          ? -1
          : 0
        : direction > 0
          ? Math.max(...idxs)
          : Math.min(...idxs);
    const next = (anchor + direction + eligible.length) % eligible.length;
    const target = eligible[next];
    if (!target) return;
    sel.tool.setSelection([target.id]);
    sel.ctx.requestRender();
  }

  zoomToFit(): void {
    if (this.deps.isToolActive()) return;
    this.deps.fitToContent?.();
  }

  group(): void {
    if (this.deps.isToolActive()) return;
    this.deps.group?.();
  }

  ungroup(): void {
    if (this.deps.isToolActive()) return;
    this.deps.ungroup?.();
  }

  toggleLock(): void {
    if (this.deps.isToolActive()) return;
    this.deps.toggleLock?.();
  }

  zOrder(operation: 'forward' | 'backward' | 'front' | 'back'): void {
    if (this.deps.isToolActive()) return;
    this.flushPendingNudge();
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
    offset: Point,
    sel: { tool: SelectTool; ctx: ToolContext },
  ): void {
    const idMap = new Map<string, string>();
    for (const el of source) {
      idMap.set(el.id, createId(el.type));
    }

    const groupIdMap = new Map<string, string>();
    for (const el of source) {
      if (el.groupId && !groupIdMap.has(el.groupId)) groupIdMap.set(el.groupId, createId('group'));
    }

    const newIds: string[] = [];
    const recorder = this.deps.getHistoryRecorder();
    recorder?.begin();

    for (const el of source) {
      const clone = structuredClone(el);
      const newId = idMap.get(el.id);
      if (!newId) continue;
      clone.id = newId;
      if (clone.groupId) clone.groupId = groupIdMap.get(clone.groupId) ?? clone.groupId;
      clone.position = { x: clone.position.x + offset.x, y: clone.position.y + offset.y };

      if (clone.type === 'arrow') {
        const arrow = clone;
        arrow.from = { x: arrow.from.x + offset.x, y: arrow.from.y + offset.y };
        arrow.to = { x: arrow.to.x + offset.x, y: arrow.to.y + offset.y };
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
