import type { Bounds } from '../core/types';
import type {
  FogBase,
  FogChangeEvent,
  FogOperation,
  FogPatch,
  FogRegion,
  FogStateV1,
  FogTileV1,
  FogViewEvent,
  FogViewMode,
} from './types';
import { FOG_TILE_CELLS } from './types';
import {
  rasterizeRegion,
  applyRasterResult,
  validateFogState,
  recommendedFogCellSize,
  encodeBase64,
  createTileBytes,
} from './tile-codec';
import { FogRegionCommand, FogResetCommand } from './fog-command';
import type { Command } from '../history/types';

export type FogIdFactory = () => string;

let nextId = 1;
function defaultIdFactory(): string {
  return `fog-gen-${nextId++}`;
}

export interface FogManagerOptions {
  idFactory?: FogIdFactory;
  onCommand?: (command: Command) => void;
}

type ChangeListener = (event: FogChangeEvent) => void;
type ViewListener = (event: FogViewEvent) => void;

export class FogManager {
  private state: FogStateV1 | null = null;
  private viewMode: FogViewMode = 'off';
  private readonly idFactory: FogIdFactory;
  private readonly onCommand: ((command: Command) => void) | undefined;
  private readonly changeListeners = new Set<ChangeListener>();
  private readonly viewListeners = new Set<ViewListener>();
  constructor(options: FogManagerOptions = {}) {
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.onCommand = options.onCommand;
  }

  getState(): FogStateV1 | null {
    if (!this.state) return null;
    return {
      definition: { ...this.state.definition, bounds: { ...this.state.definition.bounds } },
      tiles: this.state.tiles.map((t) => ({ ...t })),
    };
  }

  getViewMode(): FogViewMode {
    return this.viewMode;
  }

  initialize(options: { bounds: Bounds; base?: FogBase; cellSize?: number }): FogStateV1 {
    const base = options.base ?? 'covered';
    const cellSize = options.cellSize ?? recommendedFogCellSize(options.bounds);
    const generation = this.idFactory();

    const newState: FogStateV1 = {
      definition: {
        version: 1,
        generation,
        bounds: { ...options.bounds },
        cellSize,
        tileCells: FOG_TILE_CELLS as 128,
        base,
      },
      tiles: [],
    };

    const before = this.state;
    this.state = newState;

    const command = new FogResetCommand(this, before, newState);
    this.onCommand?.(command);
    this.notifyChange({ kind: 'definition' });

    return newState;
  }

  loadState(state: FogStateV1 | null, meta?: { origin?: string }): void {
    if (state !== null) {
      validateFogState(state);
      this.state = structuredClone(state) as FogStateV1;
    } else {
      this.state = null;
    }
    this.notifyChange({
      kind: state === null ? 'disable' : 'definition',
      origin: meta?.origin,
    });
  }

  setBounds(bounds: Bounds): void {
    if (!this.state) return;
    const def = this.state.definition;

    const tiles = this.state.tiles.filter((tile) => {
      const tileWorldX = tile.x * FOG_TILE_CELLS * def.cellSize;
      const tileWorldY = tile.y * FOG_TILE_CELLS * def.cellSize;
      const tileWorldW = FOG_TILE_CELLS * def.cellSize;
      const tileWorldH = FOG_TILE_CELLS * def.cellSize;
      return !(
        tileWorldX + tileWorldW <= bounds.x ||
        tileWorldY + tileWorldH <= bounds.y ||
        tileWorldX >= bounds.x + bounds.w ||
        tileWorldY >= bounds.y + bounds.h
      );
    });

    const before = this.state;
    this.state = {
      definition: { ...def, bounds: { ...bounds } },
      tiles,
    };

    const command = new FogResetCommand(this, before, this.state);
    this.onCommand?.(command);
    this.notifyChange({ kind: 'definition' });
  }

  reset(base: FogBase): void {
    if (!this.state) return;

    const before = this.state;
    const generation = this.idFactory();

    this.state = {
      definition: { ...this.state.definition, base, generation },
      tiles: [],
    };

    const command = new FogResetCommand(this, before, this.state);
    this.onCommand?.(command);
    this.notifyChange({ kind: 'reset' });
  }

  disable(): void {
    if (!this.state) return;

    const before = this.state;
    this.state = null;

    const command = new FogResetCommand(this, before, null);
    this.onCommand?.(command);
    this.notifyChange({ kind: 'disable' });
  }

  setViewMode(mode: FogViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.notifyView({ mode });
  }

  applyRegion(region: FogRegion, operation: FogOperation): void {
    if (!this.state) return;

    const result = rasterizeRegion(this.state, region, operation);
    if (result.noop) return;

    const before = this.collectTiles(result.changed);
    const newState = applyRasterResult(this.state, result);
    this.state = newState;

    const command = new FogRegionCommand(this, before, result.changed);
    this.onCommand?.(command);
    this.notifyChange({
      kind: 'tiles',
      tiles: result.changed.map((t) => ({ x: t.x, y: t.y })),
    });
  }

  applyPatchDirect(patch: FogPatch, meta?: { origin?: string }): void {
    if (!this.state) return;

    const result = applyRasterResult(this.state, { changed: patch.tiles, noop: false });
    this.state = result;
    this.notifyChange({
      kind: 'tiles',
      tiles: patch.tiles.map((t) => ({ x: t.x, y: t.y })),
      origin: meta?.origin,
    });
  }

  applyTilesDirect(tiles: readonly FogTileV1[]): void {
    if (!this.state) return;

    const result = applyRasterResult(this.state, { changed: tiles, noop: false });
    this.state = result;
    this.notifyChange({
      kind: 'tiles',
      tiles: tiles.map((t) => ({ x: t.x, y: t.y })),
    });
  }

  on(event: 'change', listener: ChangeListener): () => void;
  on(event: 'view', listener: ViewListener): () => void;
  on(event: 'change' | 'view', listener: ChangeListener | ViewListener): () => void {
    if (event === 'change') {
      const l = listener as ChangeListener;
      this.changeListeners.add(l);
      return () => this.changeListeners.delete(l);
    }
    const l = listener as ViewListener;
    this.viewListeners.add(l);
    return () => this.viewListeners.delete(l);
  }

  dispose(): void {
    this.changeListeners.clear();
    this.viewListeners.clear();
  }

  private collectTiles(changed: readonly FogTileV1[]): FogTileV1[] {
    if (!this.state) return [];
    const result: FogTileV1[] = [];
    for (const c of changed) {
      const existing = this.state.tiles.find((t) => t.x === c.x && t.y === c.y);
      if (existing) {
        result.push(existing);
      } else {
        const baseVal = this.state.definition.base === 'revealed';
        result.push({
          x: c.x,
          y: c.y,
          data: encodeBase64(createTileBytes(baseVal)),
        });
      }
    }
    return result;
  }

  private notifyChange(event: FogChangeEvent): void {
    for (const listener of this.changeListeners) {
      try {
        listener(event);
      } catch {
        // isolated
      }
    }
  }

  private notifyView(event: FogViewEvent): void {
    for (const listener of this.viewListeners) {
      try {
        listener(event);
      } catch {
        // isolated
      }
    }
  }
}
