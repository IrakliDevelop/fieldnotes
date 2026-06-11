import type { ElementStore } from '../elements/element-store';
import type { CanvasElement } from '../elements/types';
import type { Command } from './types';
import type { HistoryStack } from './history-stack';
import type { LayerManager } from '../layers/layer-manager';
import type { Layer } from '../layers/types';
import {
  AddElementCommand,
  RemoveElementCommand,
  UpdateElementCommand,
  BatchCommand,
} from './commands';
import { CreateLayerCommand, RemoveLayerCommand, UpdateLayerCommand } from './layer-commands';

export class HistoryRecorder {
  private recording = true;
  private transaction: Command[] | null = null;
  private generation = 0;
  private updateSnapshots = new Map<string, CanvasElement>();
  private unsubscribers: (() => void)[];

  constructor(
    private readonly store: ElementStore,
    private readonly stack: HistoryStack,
    private readonly layerManager?: LayerManager,
  ) {
    this.unsubscribers = [
      store.on('add', (el) => this.onAdd(el)),
      store.on('remove', (el) => this.onRemove(el)),
      store.on('update', ({ previous, current }) => this.onUpdate(previous, current)),
    ];

    if (layerManager) {
      this.unsubscribers.push(
        layerManager.on('create', (layer) => this.onLayerCreate(layer)),
        layerManager.on('remove', (layer) => this.onLayerRemove(layer)),
        layerManager.on('update', ({ previous, current }) => this.onLayerUpdate(previous, current)),
      );
    }
  }

  pause(): void {
    this.recording = false;
  }

  resume(): void {
    this.recording = true;
  }

  begin(): void {
    if (this.transaction !== null) {
      this.commit();
    }
    this.transaction = [];
    this.updateSnapshots.clear();
    this.generation += 1;
  }

  get currentTransactionId(): number | null {
    return this.transaction !== null ? this.generation : null;
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

  private onLayerCreate(layer: Layer): void {
    if (!this.recording) return;
    if (!this.layerManager) return;
    this.record(new CreateLayerCommand(this.layerManager, layer));
  }

  private onLayerRemove(layer: Layer): void {
    if (!this.recording) return;
    if (!this.layerManager) return;
    this.record(new RemoveLayerCommand(this.layerManager, layer));
  }

  private onLayerUpdate(previous: Layer, current: Layer): void {
    if (!this.recording) return;
    if (!this.layerManager) return;
    this.record(new UpdateLayerCommand(this.layerManager, current.id, previous, current));
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
