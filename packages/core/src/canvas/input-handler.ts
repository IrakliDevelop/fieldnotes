import type { Camera } from './camera';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext, PointerState } from '../tools/types';
import type { SelectTool } from '../tools/select-tool';
import type { HistoryRecorder } from '../history/history-recorder';
import type { HistoryStack } from '../history/history-stack';

const ZOOM_SENSITIVITY = 0.001;
const MIDDLE_BUTTON = 1;

export interface InputHandlerOptions {
  toolManager?: ToolManager;
  toolContext?: ToolContext;
  historyRecorder?: HistoryRecorder;
  historyStack?: HistoryStack;
}

export class InputHandler {
  private isPanning = false;
  private lastPointer = { x: 0, y: 0 };
  private spaceHeld = false;
  private activePointers = new Map<number, { x: number; y: number }>();
  private lastPinchDistance = 0;
  private lastPinchCenter = { x: 0, y: 0 };
  private toolManager: ToolManager | null;
  private toolContext: ToolContext | null;
  private historyRecorder: HistoryRecorder | null;
  private historyStack: HistoryStack | null;
  private isToolActive = false;
  private readonly abortController = new AbortController();

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    options: InputHandlerOptions = {},
  ) {
    this.toolManager = options.toolManager ?? null;
    this.toolContext = options.toolContext ?? null;
    this.historyRecorder = options.historyRecorder ?? null;
    this.historyStack = options.historyStack ?? null;
    this.element.style.touchAction = 'none';
    this.bind();
  }

  setToolManager(toolManager: ToolManager, toolContext: ToolContext): void {
    this.toolManager = toolManager;
    this.toolContext = toolContext;
  }

  destroy(): void {
    this.abortController.abort();
  }

  private bind(): void {
    const opts = { signal: this.abortController.signal };

    this.element.addEventListener('wheel', this.onWheel, { ...opts, passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown, opts);
    this.element.addEventListener('pointermove', this.onPointerMove, opts);
    this.element.addEventListener('pointerup', this.onPointerUp, opts);
    this.element.addEventListener('pointerleave', this.onPointerUp, opts);
    this.element.addEventListener('pointercancel', this.onPointerUp, opts);
    window.addEventListener('keydown', this.onKeyDown, opts);
    window.addEventListener('keyup', this.onKeyUp, opts);
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    const rect = this.element.getBoundingClientRect();
    const zoomFactor = 1 - e.deltaY * ZOOM_SENSITIVITY;
    const newZoom = this.camera.zoom * zoomFactor;
    this.camera.zoomAt(newZoom, {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    });
  };

  private onPointerDown = (e: PointerEvent): void => {
    this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    this.element.setPointerCapture?.(e.pointerId);

    if (this.activePointers.size === 2) {
      this.startPinch();
      this.cancelToolIfActive(e);
      return;
    }

    if (e.button === MIDDLE_BUTTON || (e.button === 0 && this.spaceHeld)) {
      this.isPanning = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      return;
    }

    if (this.activePointers.size === 1 && e.button === 0) {
      this.dispatchToolDown(e);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (this.activePointers.has(e.pointerId)) {
      this.activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (this.activePointers.size === 2) {
      this.handlePinchMove();
      return;
    }

    if (this.isPanning) {
      const dx = e.clientX - this.lastPointer.x;
      const dy = e.clientY - this.lastPointer.y;
      this.lastPointer = { x: e.clientX, y: e.clientY };
      this.camera.pan(dx, dy);
      return;
    }

    if (this.isToolActive) {
      this.dispatchToolMove(e);
    } else if (this.activePointers.size === 0) {
      this.dispatchToolHover(e);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size < 2) {
      this.lastPinchDistance = 0;
    }

    if (this.isPanning && this.activePointers.size === 0) {
      this.isPanning = false;
    }

    if (this.isToolActive) {
      this.dispatchToolUp(e);
      this.isToolActive = false;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement)?.isContentEditable) return;

    if (e.key === ' ') {
      this.spaceHeld = true;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      this.deleteSelected();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      this.handleUndo();
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      this.handleRedo();
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.spaceHeld = false;
    }
  };

  private startPinch(): void {
    this.isPanning = true;
    const [a, b] = this.getPinchPoints();
    this.lastPinchDistance = this.distance(a, b);
    this.lastPinchCenter = this.midpoint(a, b);
    this.lastPointer = { ...this.lastPinchCenter };
  }

  private handlePinchMove(): void {
    const [a, b] = this.getPinchPoints();
    const dist = this.distance(a, b);
    const center = this.midpoint(a, b);

    if (this.lastPinchDistance > 0) {
      const scale = dist / this.lastPinchDistance;
      const newZoom = this.camera.zoom * scale;
      this.camera.zoomAt(newZoom, center);
    }

    const dx = center.x - this.lastPointer.x;
    const dy = center.y - this.lastPointer.y;
    this.camera.pan(dx, dy);

    this.lastPinchDistance = dist;
    this.lastPinchCenter = center;
    this.lastPointer = { ...center };
  }

  private getPinchPoints(): [{ x: number; y: number }, { x: number; y: number }] {
    const pts = [...this.activePointers.values()];
    return [pts[0] ?? { x: 0, y: 0 }, pts[1] ?? { x: 0, y: 0 }];
  }

  private distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  private midpoint(
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): { x: number; y: number } {
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  private toPointerState(e: PointerEvent): PointerState {
    const rect = this.element.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure,
    };
  }

  private dispatchToolDown(e: PointerEvent): void {
    if (!this.toolManager || !this.toolContext) return;
    this.historyRecorder?.begin();
    this.isToolActive = true;
    this.toolManager.handlePointerDown(this.toPointerState(e), this.toolContext);
  }

  private dispatchToolMove(e: PointerEvent): void {
    if (!this.toolManager || !this.toolContext) return;
    this.toolManager.handlePointerMove(this.toPointerState(e), this.toolContext);
  }

  private dispatchToolHover(e: PointerEvent): void {
    if (!this.toolManager?.activeTool || !this.toolContext) return;
    const tool = this.toolManager.activeTool;
    if (tool.onHover) {
      tool.onHover(this.toPointerState(e), this.toolContext);
    }
  }

  private dispatchToolUp(e: PointerEvent): void {
    if (!this.toolManager || !this.toolContext) return;
    this.toolManager.handlePointerUp(this.toPointerState(e), this.toolContext);
    this.historyRecorder?.commit();
  }

  private deleteSelected(): void {
    if (!this.toolManager || !this.toolContext) return;
    const tool = this.toolManager.activeTool;
    if (tool?.name !== 'select') return;
    const selectTool = tool as SelectTool;
    const ids = selectTool.selectedIds;
    if (ids.length === 0) return;
    this.historyRecorder?.begin();
    for (const id of ids) {
      this.toolContext.store.remove(id);
    }
    this.historyRecorder?.commit();
    this.toolContext.requestRender();
  }

  private handleUndo(): void {
    if (!this.historyStack || !this.toolContext) return;
    this.historyRecorder?.pause();
    this.historyStack.undo(this.toolContext.store);
    this.historyRecorder?.resume();
    this.toolContext.requestRender();
  }

  private handleRedo(): void {
    if (!this.historyStack || !this.toolContext) return;
    this.historyRecorder?.pause();
    this.historyStack.redo(this.toolContext.store);
    this.historyRecorder?.resume();
    this.toolContext.requestRender();
  }

  private cancelToolIfActive(e: PointerEvent): void {
    if (this.isToolActive) {
      this.dispatchToolUp(e);
      this.isToolActive = false;
    }
  }
}
