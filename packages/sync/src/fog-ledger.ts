import type { FogMetaRecord, FogTileRecord, FogSnapshot } from './protocol';
import { isNewerFogRecord } from './protocol';
import {
  FOG_MAX_TILES,
  FOG_TILE_CELLS,
  validateFogTile,
  canonicalizeFogTile,
} from '@fieldnotes/core';
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
    if (!this.isCompatibleSameGeneration(record)) {
      return { accepted: false, correction: this.meta ?? undefined };
    }

    this.setMeta(record);
    return { accepted: true };
  }

  applyTile(record: FogTileRecord): { accepted: boolean; correction?: FogTileRecord } {
    return this.applyTileTo(this.tiles, record);
  }

  applyPatch(records: readonly FogTileRecord[]): {
    accepted: FogTileRecord[];
    corrections: FogTileRecord[];
  } {
    const working = new Map(this.tiles);
    const accepted: FogTileRecord[] = [];
    const corrections: FogTileRecord[] = [];

    for (const record of records) {
      const result = this.applyTileTo(working, record, false);
      if (result.accepted) accepted.push(record);
      else if (result.correction) corrections.push(result.correction);
    }

    if (working.size > MAX_STORED_TILES) {
      return {
        accepted: [],
        corrections: records.flatMap((record) => {
          const correction = this.correctionFor(record);
          return correction ? [correction] : [];
        }),
      };
    }

    this.tiles = working;
    return { accepted, corrections };
  }

  private applyTileTo(
    tiles: Map<string, FogTileRecord>,
    record: FogTileRecord,
    enforceCap = true,
  ): { accepted: boolean; correction?: FogTileRecord } {
    if (!this.meta?.definition) {
      return { accepted: false };
    }

    if (record.generation !== this.meta.definition.generation) {
      const existing = tiles.get(tileKey(record.x, record.y));
      return {
        accepted: false,
        correction: existing ?? tombstone(record, this.meta.definition.generation),
      };
    }

    if (!tileIntersectsBounds(record.x, record.y, this.meta.definition)) {
      return { accepted: false };
    }
    if (record.data !== undefined) {
      try {
        validateFogTile({ x: record.x, y: record.y, data: record.data }, this.meta.definition);
      } catch {
        return { accepted: false };
      }
    }

    const key = tileKey(record.x, record.y);
    const existing = tiles.get(key);

    if (existing && !isNewerFogRecord(record, existing)) {
      return { accepted: false, correction: existing };
    }

    if (enforceCap && !existing && tiles.size >= MAX_STORED_TILES) {
      return { accepted: false };
    }

    tiles.set(key, record);

    return { accepted: true };
  }

  private correctionFor(record: FogTileRecord): FogTileRecord | undefined {
    if (!this.meta?.definition) return undefined;
    return (
      this.tiles.get(tileKey(record.x, record.y)) ??
      tombstone(record, this.meta.definition.generation)
    );
  }

  applyMetaAuthoritative(record: FogMetaRecord): void {
    this.setMeta(record);
  }

  applyAuthoritative(record: FogTileRecord): boolean {
    if (!this.meta?.definition) return false;
    if (record.generation !== this.meta.definition.generation) return false;
    if (!tileIntersectsBounds(record.x, record.y, this.meta.definition)) return false;
    if (record.data !== undefined) {
      try {
        validateFogTile({ x: record.x, y: record.y, data: record.data }, this.meta.definition);
      } catch {
        return false;
      }
    }
    const key = tileKey(record.x, record.y);
    if (!this.tiles.has(key) && this.tiles.size >= MAX_STORED_TILES) return false;
    this.tiles.set(key, record);
    return true;
  }

  snapshot(): FogSnapshot | undefined {
    if (!this.meta) return undefined;
    return { meta: this.meta, tiles: [...this.tiles.values()] };
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

  private pruneOutOfBounds(def: FogDefinitionV1): void {
    for (const [key, tile] of this.tiles) {
      if (!tileIntersectsBounds(tile.x, tile.y, def)) {
        this.tiles.delete(key);
      } else if (tile.data !== undefined) {
        const canonical = canonicalizeFogTile({ x: tile.x, y: tile.y, data: tile.data }, def);
        if (canonical) this.tiles.set(key, { ...tile, data: canonical.data });
        else this.tiles.delete(key);
      }
    }
  }

  private setMeta(record: FogMetaRecord): void {
    const oldGeneration = this.meta?.definition?.generation;
    const oldBounds = this.meta?.definition?.bounds;
    this.meta = record;

    if (!record.definition) {
      this.tiles.clear();
      return;
    }
    if (oldGeneration === undefined || record.definition.generation !== oldGeneration) {
      this.tiles.clear();
    } else if (oldBounds) {
      this.pruneOutOfBounds(record.definition);
    }
  }

  private isCompatibleSameGeneration(record: FogMetaRecord): boolean {
    const current = this.meta?.definition;
    const next = record.definition;
    if (!current || !next || current.generation !== next.generation) return true;
    return (
      current.cellSize === next.cellSize &&
      current.tileCells === next.tileCells &&
      current.base === next.base &&
      next.bounds.x <= current.bounds.x &&
      next.bounds.y <= current.bounds.y &&
      next.bounds.x + next.bounds.w >= current.bounds.x + current.bounds.w &&
      next.bounds.y + next.bounds.h >= current.bounds.y + current.bounds.h
    );
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
