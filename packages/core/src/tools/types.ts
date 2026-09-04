import type { Camera } from '../canvas/camera';
import type { ElementStore } from '../elements/element-store';
import type { HexOrientation } from '../elements/types';
import type { Bounds } from '../core/types';

export interface ToolContext {
  camera: Camera;
  store: ElementStore;
  requestRender: () => void;
  switchTool?: (name: string) => void;
  editElement?: (id: string) => void;
  fitNoteHeight?: (id: string) => void;
  setCursor?: (cursor: string) => void;
  snapToGrid?: boolean;
  gridSize?: number;
  gridType?: 'square' | 'hex';
  hexOrientation?: HexOrientation;
  activeLayerId?: string;
  isLayerVisible?: (layerId: string) => boolean;
  isLayerLocked?: (layerId: string) => boolean;
  smartGuides?: boolean;
  getVisibleRect?: () => Bounds;
}

export interface PointerState {
  x: number;
  y: number;
  pressure: number;
  pointerType: 'mouse' | 'touch' | 'pen';
  shiftKey: boolean;
}

export interface Tool {
  readonly name: string;
  onPointerDown(state: PointerState, ctx: ToolContext): void;
  onPointerMove(state: PointerState, ctx: ToolContext): void;
  onPointerUp(state: PointerState, ctx: ToolContext): void;
  /**
   * The gesture was taken over (a second pointer started navigation) or the
   * platform cancelled the pointer. Optional: tools without it receive
   * `onPointerUp` instead, exactly as before. Implement it when "up" and
   * "abandon" must differ (a multi-step tool must not treat a pinch as input).
   * The gesture's history transaction is still committed afterwards (an
   * in-progress store mutation must never be left open); a tool that wants
   * abandon semantics must revert its own store mutations before returning.
   */
  onPointerCancel?(state: PointerState, ctx: ToolContext): void;
  onHover?(state: PointerState, ctx: ToolContext): void;
  /**
   * Offered every keydown that reaches the canvas (never from editable
   * targets, and only within the viewport's keyboard scope) BEFORE the
   * shortcut map. Return `true` to consume it (default prevented, no shortcut
   * runs). Listeners are owned by the viewport, so a tool holds no DOM
   * subscriptions and deactivation cannot leak.
   */
  onKeyDown?(event: KeyboardEvent, ctx: ToolContext): boolean;
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
  | 'path'
  | 'template'
  | 'laser'
  | 'ping'
  | 'fog';
