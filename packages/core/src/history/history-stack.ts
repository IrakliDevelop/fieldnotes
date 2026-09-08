import type { ElementStore } from '../elements/element-store';
import { EventBus } from '../core/event-bus';
import type { Command } from './types';

export interface HistoryStackOptions {
  maxSize?: number;
}

export interface HistorySnapshot {
  readonly undo: readonly Command[];
  readonly redo: readonly Command[];
}

const DEFAULT_MAX_SIZE = 100;

export class HistoryStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;
  private readonly bus = new EventBus<{ change: undefined }>();

  constructor(options: HistoryStackOptions = {}) {
    this.maxSize = options.maxSize ?? DEFAULT_MAX_SIZE;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get undoCount(): number {
    return this.undoStack.length;
  }

  get redoCount(): number {
    return this.redoStack.length;
  }

  push(command: Command): void {
    this.undoStack.push(command);
    this.redoStack = [];

    if (this.undoStack.length > this.maxSize) {
      this.undoStack.shift();
    }

    this.notifyChange();
  }

  undo(store: ElementStore): boolean {
    const command = this.undoStack.pop();
    if (!command) return false;

    command.undo(store);
    this.redoStack.push(command);
    this.notifyChange();
    return true;
  }

  redo(store: ElementStore): boolean {
    const command = this.redoStack.pop();
    if (!command) return false;

    command.execute(store);
    this.undoStack.push(command);
    this.notifyChange();
    return true;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.notifyChange();
  }

  snapshot(): HistorySnapshot {
    return { undo: [...this.undoStack], redo: [...this.redoStack] };
  }

  loadSnapshot(snapshot: HistorySnapshot): void {
    this.undoStack = [...snapshot.undo];
    this.redoStack = [...snapshot.redo];
    this.notifyChange();
  }

  onChange(listener: () => void): () => void {
    return this.bus.on('change', () => listener());
  }

  suspendNotifications(): { resume(): void; discard(): void } {
    return this.bus.suspendNotifications(() => ({ event: 'change', data: undefined }));
  }

  private notifyChange(): void {
    this.bus.emit('change', undefined);
  }
}
