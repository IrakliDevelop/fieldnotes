import type {
  ElementStore,
  ToolContext,
  ExtensionElementEnvelope,
  ElementRegistry,
  ConstraintServiceAccess,
} from '@fieldnotes/core';
import type { GridElement } from '../elements/types';
import { createGrid } from '../elements/element-factory';
import { GridConstraintService } from './grid-constraint-service';

/** Minimal interface for history recording (matches core's HistoryRecorder). */
export interface HistoryRecorderLike {
  begin(): void;
  commit(): void;
}

export interface GridInfo {
  gridType: 'square' | 'hex';
  hexOrientation: 'pointy' | 'flat';
  cellSize: number;
  cellRadius: number;
}

export interface GridControllerDeps {
  store: ElementStore;
  recorder: HistoryRecorderLike;
  requestRender: () => void;
  getActiveLayerId: () => string;
  toolContext: ToolContext;
  defaultGridSize: number;
  elementRegistry: ElementRegistry;
  constraintService?: ConstraintServiceAccess;
}

export class GridController {
  private readonly listeners = new Set<(info: GridInfo | null) => void>();
  private readonly constraintService: GridConstraintService;

  constructor(private readonly deps: GridControllerDeps) {
    this.constraintService = new GridConstraintService(() => this.getInfo());
    if (deps.constraintService && 'setImplementation' in deps.constraintService) {
      (deps.constraintService as { setImplementation: (impl: unknown) => void }).setImplementation(
        this.constraintService,
      );
    }
  }

  add(input: {
    gridType?: 'square' | 'hex';
    hexOrientation?: 'pointy' | 'flat';
    cellSize?: number;
    strokeColor?: string;
    strokeWidth?: number;
    opacity?: number;
  }): string {
    const existing = this.getGridEnvelope();
    this.deps.recorder.begin();
    if (existing) {
      this.deps.store.remove(existing.id);
    }
    const grid = createGrid({ ...input, layerId: this.deps.getActiveLayerId() });
    const adapter = this.deps.elementRegistry.getAdapter('vtt:grid');
    const envelope = adapter ? adapter.wrap(grid) : (grid as unknown as ExtensionElementEnvelope);
    this.deps.store.add(envelope as unknown as GridElement);
    this.deps.recorder.commit();
    this.deps.requestRender();
    this.syncContext();
    return grid.id;
  }

  update(
    updates: Partial<
      Pick<
        GridElement,
        'gridType' | 'hexOrientation' | 'cellSize' | 'strokeColor' | 'strokeWidth' | 'opacity'
      >
    >,
  ): void {
    const envelope = this.getGridEnvelope();
    if (!envelope) return;
    const grid = this.unwrapGrid(envelope);
    if (!grid) return;
    const updated: GridElement = { ...grid, ...updates };
    const adapter = this.deps.elementRegistry.getAdapter('vtt:grid');
    const newEnvelope = adapter
      ? adapter.wrap(updated)
      : (updated as unknown as ExtensionElementEnvelope);
    this.deps.recorder.begin();
    this.deps.store.update(envelope.id, newEnvelope as unknown as GridElement);
    this.deps.recorder.commit();
    this.deps.requestRender();
    this.syncContext();
  }

  remove(): void {
    const envelope = this.getGridEnvelope();
    if (!envelope) return;
    this.deps.recorder.begin();
    this.deps.store.remove(envelope.id);
    this.deps.recorder.commit();
    this.deps.requestRender();
    this.syncContext();
  }

  getInfo(): GridInfo | null {
    const envelope = this.getGridEnvelope();
    if (!envelope) return null;
    const grid = this.unwrapGrid(envelope);
    if (!grid) return null;
    return {
      gridType: grid.gridType,
      hexOrientation: grid.hexOrientation,
      cellSize: grid.cellSize,
      cellRadius: grid.gridType === 'hex' ? grid.cellSize : grid.cellSize / 2,
    };
  }

  onChange(listener: (info: GridInfo | null) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  syncContext(): void {
    const envelope = this.getGridEnvelope();
    const grid = envelope ? this.unwrapGrid(envelope) : null;
    if (grid) {
      this.deps.toolContext.gridSize = grid.cellSize;
      this.deps.toolContext.gridType = grid.gridType;
      this.deps.toolContext.hexOrientation = grid.hexOrientation;
    } else {
      this.deps.toolContext.gridSize = this.deps.defaultGridSize;
      this.deps.toolContext.gridType = undefined;
      this.deps.toolContext.hexOrientation = undefined;
    }
    this.notify();
  }

  private getGridEnvelope(): ExtensionElementEnvelope | null {
    const extensionElements = this.deps.store.getElementsByType('extension');
    return (
      extensionElements.find((el) => el.type === 'extension' && el.extensionType === 'vtt:grid') ??
      null
    );
  }

  private unwrapGrid(envelope: ExtensionElementEnvelope): GridElement | null {
    const adapter = this.deps.elementRegistry.getAdapter('vtt:grid');
    if (!adapter) return null;
    return adapter.unwrap(envelope) as unknown as GridElement;
  }
  private notify(): void {
    const info = this.getInfo();
    for (const listener of this.listeners) {
      listener(info);
    }
  }
}
