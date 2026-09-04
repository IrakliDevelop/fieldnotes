import type { FogMetaRecord, FogTileRecord, FogSnapshot } from './protocol';
import { isNewerFogRecord } from './protocol';

export class FogLedger {
  private meta: FogMetaRecord | null = null;
  private tiles = new Map<string, FogTileRecord>();

  getMeta(): FogMetaRecord | null {
    return this.meta;
  }

  getTile(x: number, y: number): FogTileRecord | undefined {
    return this.tiles.get(tileKey(x, y));
  }

  applyMeta(record: FogMetaRecord): { accepted: boolean; correction?: FogMetaRecord } {
    if (this.meta && !isNewerFogRecord(record, this.meta)) {
      return { accepted: false, correction: this.meta };
    }

    const oldGeneration = this.meta?.definition?.generation;
    this.meta = record;

    if (record.definition) {
      const newGen = record.definition.generation;
      if (oldGeneration !== undefined && newGen !== oldGeneration) {
        this.tiles.clear();
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

    const key = tileKey(record.x, record.y);
    const existing = this.tiles.get(key);

    if (existing && !isNewerFogRecord(record, existing)) {
      return { accepted: false, correction: existing };
    }

    if (record.data === undefined) {
      this.tiles.delete(key);
    } else {
      this.tiles.set(key, record);
    }

    return { accepted: true };
  }

  snapshot(): FogSnapshot | undefined {
    if (!this.meta) return undefined;
    return {
      meta: this.meta,
      tiles: [...this.tiles.values()],
    };
  }

  loadSnapshot(snap: FogSnapshot): void {
    this.meta = snap.meta;
    this.tiles.clear();
    for (const tile of snap.tiles) {
      if (tile.data !== undefined) {
        this.tiles.set(tileKey(tile.x, tile.y), tile);
      }
    }
  }

  clear(): void {
    this.meta = null;
    this.tiles.clear();
  }
}

function tileKey(x: number, y: number): string {
  return `${x},${y}`;
}

function tombstone(record: FogTileRecord, generation: string): FogTileRecord {
  return {
    generation,
    x: record.x,
    y: record.y,
    version: 0,
    editor: '',
  };
}
