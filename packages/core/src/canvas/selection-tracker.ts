import type { ElementStore } from '../elements/element-store';
import type { Tool } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';

export function isSelectionSource(tool: Tool): tool is SelectTool {
  const candidate = tool as Partial<SelectTool>;
  return (
    tool.name === 'select' &&
    typeof candidate.onSelectionChange === 'function' &&
    typeof candidate.setSelection === 'function'
  );
}

export interface SelectionTrackerDeps {
  store: ElementStore;
  getSelectTool: () => SelectTool | undefined;
  getSelectedIds: () => string[];
  /** The recorder is created after the tracker; read only when an element is removed. */
  getCurrentTransactionId: () => number | null;
}

export class SelectionTracker {
  private readonly selectionListeners = new Set<() => void>();
  private detachSelectionSource: (() => void) | null = null;
  private pendingSelectionPrune = false;

  constructor(private readonly deps: SelectionTrackerDeps) {}

  attach(tool: SelectTool): void {
    this.detachSelectionSource?.();
    this.detachSelectionSource = tool.onSelectionChange(() => this.emitSelectionChange());
  }

  onChange(listener: () => void): () => void {
    this.selectionListeners.add(listener);
    return () => {
      this.selectionListeners.delete(listener);
    };
  }

  prune(): void {
    const tool = this.deps.getSelectTool();
    if (!tool) return;
    const ids = tool.selectedIds;
    const filtered = ids.filter((id) => this.deps.store.getById(id) !== undefined);
    if (filtered.length !== ids.length) tool.setSelection(filtered);
  }

  handleRemoved(id: string): void {
    if (!this.deps.getSelectedIds().includes(id)) return;
    if (this.deps.getCurrentTransactionId() !== null) {
      this.pendingSelectionPrune = true;
      return;
    }
    this.prune();
  }

  /** Runs the prune a removal deferred while a history transaction was open. */
  flushPendingPrune(): void {
    if (!this.pendingSelectionPrune) return;
    this.pendingSelectionPrune = false;
    this.prune();
  }

  dispose(): void {
    this.detachSelectionSource?.();
    this.detachSelectionSource = null;
    this.selectionListeners.clear();
  }

  private emitSelectionChange(): void {
    for (const listener of this.selectionListeners) {
      try {
        listener();
      } catch {
        // Selection listeners must not break each other or the caller.
      }
    }
  }
}
