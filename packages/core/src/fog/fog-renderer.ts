import type { Camera } from '../canvas/camera';
import type { FogStateV1, FogViewMode } from './types';
import { FOG_TILE_CELLS } from './types';
import { decodeBase64 } from './tile-codec';

const DEFAULT_EDITOR_COLOR = 'rgba(30, 40, 60, 0.45)';
const DEFAULT_PLAYER_COLOR = '#0b1020';

export interface FogRendererOptions {
  editorColor?: string;
  playerColor?: string;
}

export class FogRenderer {
  private tileCache = new Map<string, Uint8Array>();
  private state: FogStateV1 | null = null;
  private viewMode: FogViewMode = 'off';
  private dirty = true;
  private editorColor: string;
  private playerColor: string;

  constructor(options: FogRendererOptions = {}) {
    this.editorColor = options.editorColor ?? DEFAULT_EDITOR_COLOR;
    this.playerColor = options.playerColor ?? DEFAULT_PLAYER_COLOR;
  }

  setState(state: FogStateV1 | null): void {
    this.state = state;
    this.tileCache.clear();
    this.dirty = true;
  }

  setViewMode(mode: FogViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
    this.tileCache.clear();
    this.dirty = true;
  }

  getState(): FogStateV1 | null {
    return this.state;
  }

  getViewMode(): FogViewMode {
    return this.viewMode;
  }

  markDirty(): void {
    this.dirty = true;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  isVisible(): boolean {
    return this.viewMode !== 'off' && this.state !== null;
  }

  render(
    ctx: CanvasRenderingContext2D,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    _dpr: number,
  ): void {
    if (!this.state || this.viewMode === 'off') return;

    const def = this.state.definition;
    const cellSize = def.cellSize;
    const tileWorldSize = FOG_TILE_CELLS * cellSize;

    const color = this.viewMode === 'editor' ? this.editorColor : this.playerColor;

    const worldBounds = getVisibleWorld(camera, viewportWidth, viewportHeight);
    const minTX = Math.floor(Math.max(def.bounds.x, worldBounds.x) / tileWorldSize);
    const minTY = Math.floor(Math.max(def.bounds.y, worldBounds.y) / tileWorldSize);
    const maxTX = Math.floor(
      Math.min(def.bounds.x + def.bounds.w - 1, worldBounds.x + worldBounds.w) / tileWorldSize,
    );
    const maxTY = Math.floor(
      Math.min(def.bounds.y + def.bounds.h - 1, worldBounds.y + worldBounds.h) / tileWorldSize,
    );

    ctx.save();
    ctx.translate(camera.position.x, camera.position.y);
    ctx.scale(camera.zoom, camera.zoom);

    const tileMap = new Map<string, string>();
    for (const tile of this.state.tiles) {
      tileMap.set(`${tile.x},${tile.y}`, tile.data);
    }

    const baseCovered = def.base === 'covered';

    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const key = `${tx},${ty}`;
        const data = tileMap.get(key);
        const tileWorldX = tx * tileWorldSize;
        const tileWorldY = ty * tileWorldSize;

        if (!data && baseCovered) {
          ctx.fillStyle = color;
          const clipX = Math.max(tileWorldX, def.bounds.x);
          const clipY = Math.max(tileWorldY, def.bounds.y);
          const clipR = Math.min(tileWorldX + tileWorldSize, def.bounds.x + def.bounds.w);
          const clipB = Math.min(tileWorldY + tileWorldSize, def.bounds.y + def.bounds.h);
          if (clipR > clipX && clipB > clipY) {
            ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
          }
          continue;
        }

        if (!data && !baseCovered) {
          continue;
        }

        if (data) {
          this.renderTile(ctx, data, tx, ty, def, color);
        }
      }
    }

    ctx.restore();
    this.dirty = false;
  }

  renderForExport(
    ctx: CanvasRenderingContext2D,
    state: FogStateV1,
    mode: 'editor' | 'player',
    color?: string,
  ): void {
    const def = state.definition;
    const cellSize = def.cellSize;
    const tileWorldSize = FOG_TILE_CELLS * cellSize;
    const fogColor = color ?? (mode === 'editor' ? this.editorColor : this.playerColor);
    const baseCovered = def.base === 'covered';

    const tileMap = new Map<string, string>();
    for (const tile of state.tiles) {
      tileMap.set(`${tile.x},${tile.y}`, tile.data);
    }

    const minTX = Math.floor(def.bounds.x / tileWorldSize);
    const minTY = Math.floor(def.bounds.y / tileWorldSize);
    const maxTX = Math.floor((def.bounds.x + def.bounds.w - 1) / tileWorldSize);
    const maxTY = Math.floor((def.bounds.y + def.bounds.h - 1) / tileWorldSize);

    for (let ty = minTY; ty <= maxTY; ty++) {
      for (let tx = minTX; tx <= maxTX; tx++) {
        const key = `${tx},${ty}`;
        const data = tileMap.get(key);
        const tileWorldX = tx * tileWorldSize;
        const tileWorldY = ty * tileWorldSize;

        if (!data && baseCovered) {
          ctx.fillStyle = fogColor;
          const clipX = Math.max(tileWorldX, def.bounds.x);
          const clipY = Math.max(tileWorldY, def.bounds.y);
          const clipR = Math.min(tileWorldX + tileWorldSize, def.bounds.x + def.bounds.w);
          const clipB = Math.min(tileWorldY + tileWorldSize, def.bounds.y + def.bounds.h);
          if (clipR > clipX && clipB > clipY) {
            ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
          }
          continue;
        }

        if (data) {
          this.renderTileForExport(ctx, data, tx, ty, def, fogColor);
        }
      }
    }
  }

  dispose(): void {
    this.tileCache.clear();
    this.state = null;
  }

  private decodeTile(data: string): Uint8Array {
    let bytes = this.tileCache.get(data);
    if (!bytes) {
      bytes = decodeBase64(data);
      this.tileCache.set(data, bytes);
    }
    return bytes;
  }

  private renderTile(
    ctx: CanvasRenderingContext2D,
    data: string,
    tx: number,
    ty: number,
    def: FogStateV1['definition'],
    color: string,
  ): void {
    const cellSize = def.cellSize;
    const tileWorldX = tx * FOG_TILE_CELLS * cellSize;
    const tileWorldY = ty * FOG_TILE_CELLS * cellSize;
    const bytes = this.decodeTile(data);

    ctx.fillStyle = color;

    for (let row = 0; row < FOG_TILE_CELLS; row++) {
      for (let col = 0; col < FOG_TILE_CELLS; col++) {
        const cellWorldX = tileWorldX + col * cellSize;
        const cellWorldY = tileWorldY + row * cellSize;

        if (
          cellWorldX < def.bounds.x ||
          cellWorldY < def.bounds.y ||
          cellWorldX >= def.bounds.x + def.bounds.w ||
          cellWorldY >= def.bounds.y + def.bounds.h
        ) {
          continue;
        }

        const index = row * FOG_TILE_CELLS + col;
        const byteIndex = index >> 3;
        const bitIndex = 7 - (index & 7);
        const revealed = (((bytes[byteIndex] as number) >> bitIndex) & 1) === 1;

        const covered = !revealed;
        if (covered) {
          ctx.fillRect(cellWorldX, cellWorldY, cellSize, cellSize);
        }
      }
    }
  }

  private renderTileForExport(
    ctx: CanvasRenderingContext2D,
    data: string,
    tx: number,
    ty: number,
    def: FogStateV1['definition'],
    color: string,
  ): void {
    this.renderTile(ctx, data, tx, ty, def, color);
  }
}

function getVisibleWorld(
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
): { x: number; y: number; w: number; h: number } {
  const topLeft = camera.screenToWorld({ x: 0, y: 0 });
  const bottomRight = camera.screenToWorld({ x: viewportWidth, y: viewportHeight });
  return {
    x: topLeft.x,
    y: topLeft.y,
    w: bottomRight.x - topLeft.x,
    h: bottomRight.y - topLeft.y,
  };
}
