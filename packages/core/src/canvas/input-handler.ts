import type { Camera } from './camera';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext, PointerState } from '../tools/types';
import type { HistoryRecorder } from '../history/history-recorder';
import type { HistoryStack } from '../history/history-stack';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { InputFilter } from './input-filter';
import { KeyboardActions } from './keyboard-actions';
import { ShortcutMap } from './shortcut-map';

const ZOOM_SENSITIVITY = 0.001;
const ZOOM_STEP = 1.2;
const MIDDLE_BUTTON = 1;

const NUDGE_DELTAS: Record<string, readonly [number, number]> = {
  'nudge-left': [-1, 0],
  'nudge-right': [1, 0],
  'nudge-up': [0, -1],
  'nudge-down': [0, 1],
};

export interface InputHandlerOptions {
  toolManager?: ToolManager;
  toolContext?: ToolContext;
  historyRecorder?: HistoryRecorder;
  historyStack?: HistoryStack;
  fitToContent?: () => void;
  group?: () => void;
  ungroup?: () => void;
  toggleLock?: () => void;
  shortcuts?: ShortcutOptions;
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
  private lastPointerEvent: PointerEvent | null = null;
  private readonly inputFilter = new InputFilter();
  private deferredDown: PointerEvent | null = null;
  private readonly abortController = new AbortController();
  private readonly actions: KeyboardActions;
  private readonly shortcutMap: ShortcutMap;
  private readonly scope: 'focus' | 'window';

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: Camera,
    options: InputHandlerOptions = {},
  ) {
    this.toolManager = options.toolManager ?? null;
    this.toolContext = options.toolContext ?? null;
    this.historyRecorder = options.historyRecorder ?? null;
    this.historyStack = options.historyStack ?? null;
    this.actions = new KeyboardActions({
      getToolManager: () => this.toolManager,
      getToolContext: () => this.toolContext,
      getHistoryRecorder: () => this.historyRecorder,
      getHistoryStack: () => this.historyStack,
      isToolActive: () => this.isToolActive,
      fitToContent: options.fitToContent,
      group: options.group,
      ungroup: options.ungroup,
      toggleLock: options.toggleLock,
      getLastPointerWorld: () => this.lastPointerWorld(),
    });
    this.shortcutMap = new ShortcutMap(options.shortcuts?.bindings);
    this.scope = options.shortcuts?.scope ?? 'focus';
    this.element.style.touchAction = 'none';
    if (this.scope === 'focus') {
      this.element.tabIndex = 0;
      // Suppressed like other canvas SDKs; consumers needing a focus ring style their container.
      this.element.style.outline = 'none';
    }
    this.bind();
  }

  setToolManager(toolManager: ToolManager, toolContext: ToolContext): void {
    this.toolManager = toolManager;
    this.toolContext = toolContext;
  }

  flushPendingHistory(): void {
    this.actions.flushPendingNudge();
  }

  get shortcuts(): ShortcutsApi {
    return this.shortcutMap;
  }

  destroy(): void {
    this.actions.dispose();
    this.abortController.abort();
    this.inputFilter.reset();
    this.deferredDown = null;
    this.lastPointerEvent = null;
    if (this.scope === 'focus') {
      this.element.removeAttribute('tabindex');
      this.element.style.outline = '';
    }
  }

  private bind(): void {
    const opts = { signal: this.abortController.signal };

    this.element.addEventListener('wheel', this.onWheel, { ...opts, passive: false });
    this.element.addEventListener('pointerdown', this.onPointerDown, opts);
    this.element.addEventListener('pointermove', this.onPointerMove, opts);
    this.element.addEventListener('pointerup', this.onPointerUp, opts);
    this.element.addEventListener('pointerleave', this.onPointerLeave, opts);
    this.element.addEventListener('pointercancel', this.onPointerUp, opts);
    window.addEventListener('keydown', this.onKeyDown, opts);
    window.addEventListener('keyup', this.onKeyUp, opts);
  }

  private viewportCenter(): { x: number; y: number } {
    const rect = this.element.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  private zoomByFactor(factor: number): void {
    this.camera.zoomAt(this.camera.zoom * factor, this.viewportCenter());
  }

  private zoomToLevel(level: number): void {
    this.camera.zoomAt(level, this.viewportCenter());
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
    this.focusSelf();
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

    if (
      this.activePointers.size === 1 &&
      (e.button === 0 || e.pointerType === 'touch' || e.pointerType === 'pen')
    ) {
      const result = this.inputFilter.filterDown(e);
      if (result.action === 'suppress') return;
      if (result.action === 'defer') {
        this.deferredDown = e;
        return;
      }
      this.dispatchToolDown(e);
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    this.lastPointerEvent = e;

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

    if (e.pointerType === 'pen' && !this.activePointers.has(e.pointerId)) {
      this.dispatchToolHover(e);
    } else if (this.isToolActive) {
      this.dispatchToolMove(e);
    } else if (this.deferredDown) {
      const result = this.inputFilter.filterMove(e);
      if (result.action === 'dispatch') {
        this.dispatchToolDown(this.deferredDown);
        this.deferredDown = null;
        this.dispatchToolMove(e);
      }
    } else if (this.activePointers.size === 0) {
      this.dispatchToolHover(e);
    }
  };

  private onPointerUp = (e: PointerEvent): void => {
    try {
      this.element.releasePointerCapture(e.pointerId);
    } catch {
      // Already released (e.g., pointercancel fired first)
    }
    this.activePointers.delete(e.pointerId);

    if (this.activePointers.size < 2) {
      this.lastPinchDistance = 0;
    }

    if (this.isPanning && this.activePointers.size === 0) {
      this.isPanning = false;
    }

    const upResult = this.inputFilter.filterUp(e);

    if (this.isToolActive) {
      this.dispatchToolUp(e);
      this.isToolActive = false;
    } else if (this.deferredDown && upResult.pendingTap) {
      this.dispatchToolDown(this.deferredDown);
      this.dispatchToolUp(e);
      this.deferredDown = null;
    } else {
      this.deferredDown = null;
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!this.isInScope()) return;

    if (e.key === ' ') {
      this.spaceHeld = true;
    }
    const action = this.shortcutMap.match(e);
    if (action !== null) {
      this.runAction(action, e);
    }
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.spaceHeld = false;
      if (this.activePointers.size === 0) {
        if (this.lastPointerEvent) {
          this.dispatchToolHover(this.lastPointerEvent);
        } else {
          this.toolContext?.setCursor?.('default');
        }
      }
    }
  };

  runAction(action: string, e?: KeyboardEvent): void {
    switch (action) {
      case 'delete':
        e?.preventDefault();
        this.actions.deleteSelected();
        return;
      case 'deselect':
        this.actions.deselect();
        return;
      case 'undo':
        e?.preventDefault();
        this.actions.undo();
        return;
      case 'redo':
        e?.preventDefault();
        this.actions.redo();
        return;
      case 'select-all':
        e?.preventDefault();
        this.actions.selectAll();
        return;
      case 'copy':
        e?.preventDefault();
        this.actions.copy();
        return;
      case 'paste':
        e?.preventDefault();
        this.actions.paste();
        return;
      case 'duplicate':
        e?.preventDefault();
        this.actions.duplicate();
        return;
      case 'z-forward':
        e?.preventDefault();
        this.actions.zOrder('forward');
        return;
      case 'z-backward':
        e?.preventDefault();
        this.actions.zOrder('backward');
        return;
      case 'z-front':
        e?.preventDefault();
        this.actions.zOrder('front');
        return;
      case 'z-back':
        e?.preventDefault();
        this.actions.zOrder('back');
        return;
      case 'zoom-fit':
        e?.preventDefault();
        this.actions.zoomToFit();
        return;
      case 'group':
        e?.preventDefault();
        this.actions.group();
        return;
      case 'ungroup':
        e?.preventDefault();
        this.actions.ungroup();
        return;
      case 'cut':
        e?.preventDefault();
        this.actions.cut();
        return;
      case 'toggle-lock':
        e?.preventDefault();
        this.actions.toggleLock();
        return;
      case 'zoom-in':
        e?.preventDefault();
        this.zoomByFactor(ZOOM_STEP);
        return;
      case 'zoom-out':
        e?.preventDefault();
        this.zoomByFactor(1 / ZOOM_STEP);
        return;
      case 'zoom-reset':
        e?.preventDefault();
        this.zoomToLevel(1);
        return;
      case 'nudge-left':
      case 'nudge-right':
      case 'nudge-up':
      case 'nudge-down': {
        const delta = NUDGE_DELTAS[action];
        if (delta && this.actions.nudge(delta[0], delta[1], e?.shiftKey ?? false)) {
          e?.preventDefault();
        }
        return;
      }
      default:
        if (action.startsWith('tool:')) {
          if (this.isToolActive) return;
          e?.preventDefault();
          this.toolContext?.switchTool?.(action.slice('tool:'.length));
          return;
        }
        console.warn(`[fieldnotes] unknown shortcut action "${action}"`);
    }
  }

  hasClipboard(): boolean {
    return this.actions.hasClipboard();
  }

  private startPinch(): void {
    this.inputFilter.reset();
    this.deferredDown = null;
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

  private lastPointerWorld(): { x: number; y: number } | null {
    const e = this.lastPointerEvent;
    if (!e) return null;
    const rect = this.element.getBoundingClientRect();
    return this.camera.screenToWorld({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  private onPointerLeave = (e: PointerEvent): void => {
    this.lastPointerEvent = null;
    this.onPointerUp(e);
  };

  private toPointerState(e: PointerEvent): PointerState {
    const rect = this.element.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      pressure: e.pressure,
      pointerType: e.pointerType === 'touch' || e.pointerType === 'pen' ? e.pointerType : 'mouse',
      shiftKey: e.shiftKey,
    };
  }

  private dispatchToolDown(e: PointerEvent): void {
    if (!this.toolManager || !this.toolContext) return;
    this.actions.flushPendingNudge();
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

  private isInScope(): boolean {
    if (this.scope === 'window') return true;
    const active = document.activeElement;
    return active === this.element || this.element.contains(active);
  }

  private focusSelf(): void {
    if (this.scope !== 'focus' || this.isInScope()) return;
    this.element.focus({ preventScroll: true });
  }

  private cancelToolIfActive(e: PointerEvent): void {
    if (this.isToolActive) {
      this.dispatchToolUp(e);
      this.isToolActive = false;
    }
    this.deferredDown = null;
  }
}
