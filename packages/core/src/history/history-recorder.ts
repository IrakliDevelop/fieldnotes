import type { ElementStore } from '../elements/element-store';
import type { CanvasElement } from '../elements/types';
import type { Command } from './types';
import type { HistoryStack } from './history-stack';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
  BatchCommand,
} from './commands';

export class HistoryRecorder {
  private recording = true;
  private transaction: Command[] | null = null;
  private updateSnapshots = new Map<string, CanvasElement>();
  private unsubscribers: (() => void)[];

  constructor(
    private readonly store: ElementStore,
    private readonly stack: HistoryStack,
  ) {
    this.unsubscribers = [
      store.on('add', (el) => this.onAdd(el)),
      store.on('remove', (el) => this.onRemove(el)),
      store.on('update', ({ previous, current }) => this.onUpdate(previous, current)),
    ];
  }

  pause(): void {
    this.recording = false;
  }

  resume(): void {
    this.recording = true;
  }

  begin(): void {
    this.transaction = [];
    this.updateSnapshots.clear();
  }

  commit(): void {
    if (!this.transaction) return;

    const finalCommands = this.flushUpdateSnapshots();
    const all = [...this.transaction, ...finalCommands];
    this.transaction = null;
    this.updateSnapshots.clear();

    if (all.length === 0) return;
    const first = all[0];
    this.stack.push(all.length === 1 && first ? first : new BatchCommand(all));
  }

  rollback(): void {
    this.transaction = null;
    this.updateSnapshots.clear();
  }

  destroy(): void {
    this.unsubscribers.forEach((fn) => fn());
  }

  private record(command: Command): void {
    if (this.transaction) {
      this.transaction.push(command);
    } else {
      this.stack.push(command);
    }
  }

  private onAdd(element: CanvasElement): void {
    if (!this.recording) return;
    this.record(new AddElementCommand(element));
  }

  private onRemove(element: CanvasElement): void {
    if (!this.recording) return;

    if (this.transaction && this.updateSnapshots.has(element.id)) {
      this.updateSnapshots.delete(element.id);
    }

    this.record(new RemoveElementCommand(element));
  }

  private onUpdate(previous: CanvasElement, current: CanvasElement): void {
    if (!this.recording) return;

    if (this.transaction) {
      if (!this.updateSnapshots.has(current.id)) {
        this.updateSnapshots.set(current.id, { ...previous });
      }
    } else {
      this.stack.push(new UpdateElementCommand(current.id, previous, current));
    }
  }

  private flushUpdateSnapshots(): Command[] {
    const commands: Command[] = [];
    for (const [id, previous] of this.updateSnapshots) {
      const current = this.store.getById(id);
      if (current) {
        commands.push(new UpdateElementCommand(id, previous, current));
      }
    }
    return commands;
  }
}
