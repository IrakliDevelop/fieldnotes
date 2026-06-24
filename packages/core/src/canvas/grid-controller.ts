import type { ElementStore } from '../elements/element-store';
import type { HistoryRecorder } from '../history/history-recorder';
import type { ToolContext } from '../tools/types';
import type { GridElement } from '../elements/types';
import { createGrid } from '../elements/element-factory';

export interface GridInfo {
  gridType: 'square' | 'hex';
  hexOrientation: 'pointy' | 'flat';
  cellSize: number;
  cellRadius: number;
}

export interface GridControllerDeps {
  store: ElementStore;
  recorder: HistoryRecorder;
  requestRender: () => void;
  getActiveLayerId: () => string;
  toolContext: ToolContext;
  defaultGridSize: number;
}

export class GridController {
  private readonly listeners = new Set<(info: GridInfo | null) => void>();

  constructor(private readonly deps: GridControllerDeps) {}

  add(input: {
    gridType?: 'square' | 'hex';
    hexOrientation?: 'pointy' | 'flat';
    cellSize?: number;
    strokeColor?: string;
    strokeWidth?: number;
    opacity?: number;
  }): string {
    const existing = this.deps.store.getElementsByType('grid')[0];
    this.deps.recorder.begin();
    if (existing) {
      this.deps.store.remove(existing.id);
    }
    const grid = createGrid({ ...input, layerId: this.deps.getActiveLayerId() });
    this.deps.store.add(grid);
    this.deps.recorder.commit();
    this.deps.requestRender();
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
    const grid = this.deps.store.getElementsByType('grid')[0];
    if (!grid) return;
    this.deps.recorder.begin();
    this.deps.store.update(grid.id, updates);
    this.deps.recorder.commit();
    this.deps.requestRender();
  }

  remove(): void {
    const grid = this.deps.store.getElementsByType('grid')[0];
    if (!grid) return;
    this.deps.recorder.begin();
    this.deps.store.remove(grid.id);
    this.deps.recorder.commit();
    this.deps.requestRender();
  }

  getInfo(): GridInfo | null {
    const grid = this.deps.store.getElementsByType('grid')[0];
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
    const grid = this.deps.store.getElementsByType('grid')[0];
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

  private notify(): void {
    const info = this.getInfo();
    for (const listener of this.listeners) {
      listener(info);
    }
  }
}
