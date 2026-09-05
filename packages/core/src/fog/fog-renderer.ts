import type { Camera } from '../canvas/camera';
import type { FogStateV1, FogViewMode } from './types';
import { FOG_TILE_CELLS } from './types';
import { decodeBase64 } from './tile-codec';
import type { FogStyle, ResolvedFogStyle, ResolvedProceduralStyle } from './fog-style';
import { resolveFogStyle } from './fog-style';
import type { ProceduralTileData } from './fog-procedural-tile';
import { clearProceduralTileCache, getCachedProceduralTile } from './fog-procedural-tile';

const DEFAULT_EDITOR_COLOR = 'rgba(30, 40, 60, 0.45)';
const DEFAULT_PLAYER_COLOR = '#0b1020';

export interface FogRendererOptions {
  editorColor?: string;
  playerColor?: string;
  editorStyle?: FogStyle;
  playerStyle?: FogStyle;
}

export class FogRenderer {
  private tileCache = new Map<string, HTMLCanvasElement>();
  private patternCache = new Map<string, CanvasPattern | null>();
  private state: FogStateV1 | null = null;
  private viewMode: FogViewMode = 'off';
  private dirty = true;
  private readonly editorStyle: ResolvedFogStyle;
  private readonly playerStyle: ResolvedFogStyle;

  constructor(options: FogRendererOptions = {}) {
    this.editorStyle = resolveFogStyle(
      options.editorStyle,
      options.editorColor,
      DEFAULT_EDITOR_COLOR,
    );
    this.playerStyle = resolveFogStyle(
      options.playerStyle,
      options.playerColor,
      DEFAULT_PLAYER_COLOR,
    );
  }

  setState(state: FogStateV1 | null): void {
    this.state = state;
    this.dirty = true;
  }

  setViewMode(mode: FogViewMode): void {
    if (mode === this.viewMode) return;
    this.viewMode = mode;
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

  getResolvedStyle(mode: 'editor' | 'player'): ResolvedFogStyle {
    return mode === 'editor' ? this.editorStyle : this.playerStyle;
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

    const mode = this.viewMode === 'editor' ? 'editor' : 'player';
    const style = this.getResolvedStyle(mode);
    const proceduralStyle = style.kind === 'procedural' ? style : null;
    const color =
      style.kind === 'procedural'
        ? normalizeCanvasColor(
            ctx,
            style.backdrop,
            mode === 'player' ? DEFAULT_PLAYER_COLOR : DEFAULT_EDITOR_COLOR,
          )
        : style.color;
    const safetyColor = proceduralStyle && mode === 'player' ? DEFAULT_PLAYER_COLOR : null;

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
            if (safetyColor) {
              ctx.fillStyle = safetyColor;
              ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
            }
            ctx.fillStyle = color;
            ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
            if (proceduralStyle) {
              this.paintProceduralOverlay(
                ctx,
                proceduralStyle,
                clipX,
                clipY,
                clipR - clipX,
                clipB - clipY,
              );
            }
          }
          continue;
        }

        if (!data && !baseCovered) {
          continue;
        }

        if (data) {
          if (safetyColor) this.renderTile(ctx, data, tx, ty, def, safetyColor);
          this.renderTile(ctx, data, tx, ty, def, color);
          if (proceduralStyle) {
            this.renderTileProceduralOverlay(ctx, data, tx, ty, def, proceduralStyle);
          }
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
    style?: FogStyle,
  ): void {
    const def = state.definition;
    const cellSize = def.cellSize;
    const tileWorldSize = FOG_TILE_CELLS * cellSize;
    const resolved = style
      ? resolveFogStyle(
          style,
          undefined,
          mode === 'editor' ? DEFAULT_EDITOR_COLOR : DEFAULT_PLAYER_COLOR,
        )
      : this.getResolvedStyle(mode);
    const proceduralStyle = !color && resolved.kind === 'procedural' ? resolved : null;
    const fogColor =
      color ??
      (proceduralStyle
        ? normalizeCanvasColor(
            ctx,
            proceduralStyle.backdrop,
            mode === 'player' ? DEFAULT_PLAYER_COLOR : DEFAULT_EDITOR_COLOR,
          )
        : resolved.kind === 'solid'
          ? resolved.color
          : resolved.backdrop);
    const safetyColor = proceduralStyle && mode === 'player' ? DEFAULT_PLAYER_COLOR : null;
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
            if (safetyColor) {
              ctx.fillStyle = safetyColor;
              ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
            }
            ctx.fillStyle = fogColor;
            ctx.fillRect(clipX, clipY, clipR - clipX, clipB - clipY);
            if (proceduralStyle) {
              this.paintProceduralOverlay(
                ctx,
                proceduralStyle,
                clipX,
                clipY,
                clipR - clipX,
                clipB - clipY,
              );
            }
          }
          continue;
        }

        if (data) {
          if (safetyColor) this.renderTileForExport(ctx, data, tx, ty, def, safetyColor);
          this.renderTileForExport(ctx, data, tx, ty, def, fogColor);
          if (proceduralStyle) {
            this.renderTileProceduralOverlay(ctx, data, tx, ty, def, proceduralStyle);
          }
        }
      }
    }
  }

  dispose(): void {
    this.tileCache.clear();
    this.patternCache.clear();
    clearProceduralTileCache();
    this.state = null;
  }

  private getOrCreatePattern(
    ctx: CanvasRenderingContext2D,
    style: ResolvedProceduralStyle,
    worldScale: number,
  ): CanvasPattern | null {
    const key = `${style.backdrop}\0${style.tint}\0${style.opacity}\0${style.scale}\0${style.seed}\0${style.detail}\0${worldScale}`;
    const cached = this.patternCache.get(key);
    if (cached !== undefined) return cached;

    let pattern: CanvasPattern | null = null;
    try {
      const tileData = getCachedProceduralTile(style);
      pattern = this.createPatternFromTileData(ctx, tileData, style, worldScale);
    } catch {
      // The backdrop is already painted. Pattern allocation, ImageData, and
      // browser canvas failures must degrade to solid fog instead of killing a frame.
    }

    if (this.patternCache.size >= 32) {
      const oldest = this.patternCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.patternCache.delete(oldest);
    }
    this.patternCache.set(key, pattern);
    return pattern;
  }

  private createPatternFromTileData(
    ctx: CanvasRenderingContext2D,
    tileData: ProceduralTileData,
    style: ResolvedProceduralStyle,
    worldScale: number,
  ): CanvasPattern | null {
    if (typeof document === 'undefined') return null;

    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = tileData.width;
    sourceCanvas.height = tileData.height;
    const sourceCtx = sourceCanvas.getContext('2d');
    if (!sourceCtx) return null;

    const imageData = new ImageData(
      new Uint8ClampedArray(tileData.data),
      tileData.width,
      tileData.height,
    );
    sourceCtx.putImageData(imageData, 0, 0);
    sourceCtx.globalCompositeOperation = 'source-in';
    sourceCtx.fillStyle = normalizeCanvasColor(sourceCtx, style.tint, '#ffffff');
    sourceCtx.fillRect(0, 0, tileData.width, tileData.height);
    sourceCtx.globalCompositeOperation = 'source-over';

    const patternScale = (style.scale * worldScale) / tileData.width;
    const pattern = ctx.createPattern(sourceCanvas, 'repeat');
    if (pattern && typeof pattern.setTransform === 'function' && typeof DOMMatrix !== 'undefined') {
      try {
        pattern.setTransform(new DOMMatrix([patternScale, 0, 0, patternScale, 0, 0]));
        return pattern;
      } catch {
        // Older implementations can expose setTransform but reject DOMMatrix input.
        // Fall through to the bounded raster-scale compatibility path.
      }
    }

    const patternPx = Math.round(style.scale * worldScale);
    if (patternPx < 1) return null;

    const patternCanvas = document.createElement('canvas');
    patternCanvas.width = patternPx;
    patternCanvas.height = patternPx;
    const patternCtx = patternCanvas.getContext('2d');
    if (!patternCtx) return null;

    patternCtx.drawImage(sourceCanvas, 0, 0, patternPx, patternPx);

    return ctx.createPattern(patternCanvas, 'repeat');
  }

  private paintProceduralOverlay(
    ctx: CanvasRenderingContext2D,
    style: ResolvedProceduralStyle,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const pattern = this.getOrCreatePattern(ctx, style, 1);
    if (!pattern) return;

    ctx.save();
    ctx.fillStyle = pattern;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  }

  private renderTileProceduralOverlay(
    ctx: CanvasRenderingContext2D,
    data: string,
    tx: number,
    ty: number,
    def: FogStateV1['definition'],
    style: ResolvedProceduralStyle,
  ): void {
    const cellSize = def.cellSize;
    const tileWorldX = tx * FOG_TILE_CELLS * cellSize;
    const tileWorldY = ty * FOG_TILE_CELLS * cellSize;

    const pattern = this.getOrCreatePattern(ctx, style, 1);
    if (!pattern) return;

    const bytes = decodeBase64(data);

    ctx.save();
    ctx.fillStyle = pattern;

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

        if (!revealed) {
          ctx.fillRect(cellWorldX, cellWorldY, cellSize, cellSize);
        }
      }
    }

    ctx.restore();
  }

  private tileRaster(data: string, color: string): HTMLCanvasElement | null {
    const key = `${color} ${data}`;
    const cached = this.tileCache.get(key);
    if (cached) return cached;
    if (typeof document === 'undefined') return null;
    const canvas = document.createElement('canvas');
    canvas.width = FOG_TILE_CELLS;
    canvas.height = FOG_TILE_CELLS;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const bytes = decodeBase64(data);
    ctx.fillStyle = color;
    for (let row = 0; row < FOG_TILE_CELLS; row++) {
      for (let col = 0; col < FOG_TILE_CELLS; col++) {
        const index = row * FOG_TILE_CELLS + col;
        const byteIndex = index >> 3;
        const bitIndex = 7 - (index & 7);
        const revealed = (((bytes[byteIndex] as number) >> bitIndex) & 1) === 1;
        if (!revealed) ctx.fillRect(col, row, 1, 1);
      }
    }
    if (this.tileCache.size >= 256) {
      const oldest = this.tileCache.keys().next().value as string | undefined;
      if (oldest !== undefined) this.tileCache.delete(oldest);
    }
    this.tileCache.set(key, canvas);
    return canvas;
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
    const raster = this.tileRaster(data, color);
    if (raster) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(def.bounds.x, def.bounds.y, def.bounds.w, def.bounds.h);
      ctx.clip();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(
        raster,
        tileWorldX,
        tileWorldY,
        FOG_TILE_CELLS * cellSize,
        FOG_TILE_CELLS * cellSize,
      );
      ctx.restore();
      return;
    }
    const bytes = decodeBase64(data);

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

/**
 * Resolve a Canvas-compatible CSS color without implementing a partial CSS parser.
 * Invalid assignments leave fillStyle unchanged; two sentinels distinguish that
 * behavior from a valid color's stable canonical representation.
 */
function normalizeCanvasColor(
  ctx: CanvasRenderingContext2D,
  value: string,
  fallback: string,
): string {
  const previous = ctx.fillStyle;
  try {
    ctx.fillStyle = '#010203';
    ctx.fillStyle = value;
    const first = ctx.fillStyle;
    ctx.fillStyle = '#040506';
    ctx.fillStyle = value;
    const second = ctx.fillStyle;
    return typeof first === 'string' && first === second ? first : fallback;
  } catch {
    return fallback;
  } finally {
    ctx.fillStyle = previous;
  }
}
