import type { ElementStore } from '../elements/element-store';
import type { Command } from './types';

export interface HistoryStackOptions {
  maxSize?: number;
}

const DEFAULT_MAX_SIZE = 100;

export class HistoryStack {
  private undoStack: Command[] = [];
  private redoStack: Command[] = [];
  private readonly maxSize: number;
  private changeListeners = new Set<() => void>();

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

  onChange(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  private notifyChange(): void {
    this.changeListeners.forEach((fn) => fn());
  }
}
