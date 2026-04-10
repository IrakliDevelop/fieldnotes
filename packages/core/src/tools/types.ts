import type { Camera } from '../canvas/camera';
import type { ElementStore } from '../elements/element-store';
import type { HexOrientation } from '../elements/types';

export interface ToolContext {
  camera: Camera;
  store: ElementStore;
  requestRender: () => void;
  switchTool?: (name: string) => void;
  editElement?: (id: string) => void;
  setCursor?: (cursor: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  gridType?: 'square' | 'hex';
  hexOrientation?: HexOrientation;
  activeLayerId?: string;
  isLayerVisible?: (layerId: string) => boolean;
  isLayerLocked?: (layerId: string) => boolean;
}

export interface PointerState {
  x: number;
  y: number;
  pressure: number;
}

export interface Tool {
  readonly name: string;
  onPointerDown(state: PointerState, ctx: ToolContext): void;
  onPointerMove(state: PointerState, ctx: ToolContext): void;
  onPointerUp(state: PointerState, ctx: ToolContext): void;
  onHover?(state: PointerState, ctx: ToolContext): void;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  renderOverlay?(ctx: CanvasRenderingContext2D): void;
  getOptions?(): object;
  setOptions?(options: object): void;
  onOptionsChange?(listener: () => void): () => void;
}

export type ToolName =
  | 'hand'
  | 'select'
  | 'pencil'
  | 'eraser'
  | 'arrow'
  | 'note'
  | 'image'
  | 'text'
  | 'shape'
  | 'measure'
  | 'template';
