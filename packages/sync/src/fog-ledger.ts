import type { FogMetaRecord, FogTileRecord, FogSnapshot } from './protocol';
import { isNewerFogRecord } from './protocol';
import { FOG_MAX_TILES, FOG_TILE_CELLS } from '@fieldnotes/core';
import type { FogDefinitionV1 } from '@fieldnotes/core';

const MAX_STORED_TILES = FOG_MAX_TILES;

export class FogLedger {
  private meta: FogMetaRecord | null = null;
  private tiles = new Map<string, FogTileRecord>();

  getMeta(): FogMetaRecord | null {
    return this.meta;
  }

  getTile(x: number, y: number): FogTileRecord | undefined {
    const record = this.tiles.get(tileKey(x, y));
    return record?.data !== undefined ? record : undefined;
  }

  getRecord(x: number, y: number): FogTileRecord | undefined {
    return this.tiles.get(tileKey(x, y));
  }

  applyMeta(record: FogMetaRecord): { accepted: boolean; correction?: FogMetaRecord } {
    if (this.meta && !isNewerFogRecord(record, this.meta)) {
      return { accepted: false, correction: this.meta };
    }

    const oldGeneration = this.meta?.definition?.generation;
    const oldBounds = this.meta?.definition?.bounds;
    this.meta = record;

    if (record.definition) {
      const newGen = record.definition.generation;
      if (oldGeneration !== undefined && newGen !== oldGeneration) {
        this.tiles.clear();
      } else if (record.definition.bounds && oldBounds) {
        this.pruneOutOfBounds(record.definition);
      }
    } else {
      this.tiles.clear();
    }

    return { accepted: true };
  }

  applyTile(record: FogTileRecord): { accepted: boolean; correction?: FogTileRecord } {
    if (!this.meta?.definition) {
      return { accepted: false };
    }

    if (record.generation !== this.meta.definition.generation) {
      const existing = this.tiles.get(tileKey(record.x, record.y));
      return {
        accepted: false,
        correction: existing ?? tombstone(record, this.meta.definition.generation),
      };
    }

    if (!tileIntersectsBounds(record.x, record.y, this.meta.definition)) {
      return { accepted: false };
    }

    const key = tileKey(record.x, record.y);
    const existing = this.tiles.get(key);

    if (existing && !isNewerFogRecord(record, existing)) {
      return { accepted: false, correction: existing };
    }

    if (!existing && record.data !== undefined && this.dataTileCount() >= MAX_STORED_TILES) {
      return { accepted: false };
    }

    this.tiles.set(key, record);

    return { accepted: true };
  }

  applyAuthoritative(record: FogTileRecord): void {
    const key = tileKey(record.x, record.y);
    this.tiles.set(key, record);
  }

  snapshot(): FogSnapshot | undefined {
    if (!this.meta) return undefined;
    const tiles = [...this.tiles.values()];
    if (tiles.length > MAX_STORED_TILES) {
      tiles.sort((a, b) => b.version - a.version || b.editor.localeCompare(a.editor));
      tiles.length = MAX_STORED_TILES;
    }
    return { meta: this.meta, tiles };
  }

  loadSnapshot(snap: FogSnapshot): void {
    this.meta = snap.meta;
    this.tiles.clear();
    for (const tile of snap.tiles) {
      this.tiles.set(tileKey(tile.x, tile.y), tile);
    }
  }

  clear(): void {
    this.meta = null;
    this.tiles.clear();
  }

  private dataTileCount(): number {
    let count = 0;
    for (const tile of this.tiles.values()) {
      if (tile.data !== undefined) count++;
    }
    return count;
  }

  private pruneOutOfBounds(def: FogDefinitionV1): void {
    for (const [key, tile] of this.tiles) {
      if (!tileIntersectsBounds(tile.x, tile.y, def)) {
        this.tiles.delete(key);
      }
    }
  }
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function tileIntersectsBounds(x: number, y: number, def: FogDefinitionV1): boolean {
  const tileWorldX = x * FOG_TILE_CELLS * def.cellSize;
  const tileWorldY = y * FOG_TILE_CELLS * def.cellSize;
  const tileWorldW = FOG_TILE_CELLS * def.cellSize;
  const tileWorldH = FOG_TILE_CELLS * def.cellSize;
  return !(
    tileWorldX + tileWorldW <= def.bounds.x ||
    tileWorldY + tileWorldH <= def.bounds.y ||
    tileWorldX >= def.bounds.x + def.bounds.w ||
    tileWorldY >= def.bounds.y + def.bounds.h
  );
}

function tombstone(record: FogTileRecord, generation: string): FogTileRecord {
  return {
    generation,
    x: record.x,
    y: record.y,
    version: 1,
    editor: 'hub',
  };
}
