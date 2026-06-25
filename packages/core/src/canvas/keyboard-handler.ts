import type { Camera } from './camera';
import type { ToolManager } from '../tools/tool-manager';
import type { ToolContext } from '../tools/types';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { ShortcutMap } from './shortcut-map';
import type { KeyboardActions } from './keyboard-actions';

const ZOOM_STEP = 1.2;

const NUDGE_DELTAS: Record<string, readonly [number, number]> = {
  'nudge-left': [-1, 0],
  'nudge-right': [1, 0],
  'nudge-up': [0, -1],
  'nudge-down': [0, 1],
};

export interface KeyboardHandlerDeps {
  element: HTMLElement;
  camera: Camera;
  actions: KeyboardActions;
  scope: 'focus' | 'window';
  shortcuts?: ShortcutOptions;
  abortSignal: AbortSignal;
  getToolContext: () => ToolContext | null;
  getToolManager: () => ToolManager | null;
  getIsToolActive: () => boolean;
  getLastPointerEvent: () => PointerEvent | null;
  getSpaceHeld: () => boolean;
  setSpaceHeld: (v: boolean) => void;
  getActivePointerCount: () => number;
  dispatchToolHover: (e: PointerEvent) => void;
}

export class KeyboardHandler {
  private readonly shortcutMap: ShortcutMap;

  constructor(private readonly deps: KeyboardHandlerDeps) {
    this.shortcutMap = new ShortcutMap(deps.shortcuts?.bindings);
    window.addEventListener('keydown', this.onKeyDown, { signal: deps.abortSignal });
    window.addEventListener('keyup', this.onKeyUp, { signal: deps.abortSignal });
  }

  get shortcuts(): ShortcutsApi {
    return this.shortcutMap;
  }

  private viewportCenter(): { x: number; y: number } {
    const rect = this.deps.element.getBoundingClientRect();
    return { x: rect.width / 2, y: rect.height / 2 };
  }

  private zoomByFactor(factor: number): void {
    this.deps.camera.zoomAt(this.deps.camera.zoom * factor, this.viewportCenter());
  }

  private zoomToLevel(level: number): void {
    this.deps.camera.zoomAt(level, this.viewportCenter());
  }

  onKeyDown = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable) return;
    const tag = target?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (!this.isInScope()) return;

    if (e.key === ' ') {
      this.deps.setSpaceHeld(true);
    }
    const action = this.shortcutMap.match(e);
    if (action !== null) {
      this.runAction(action, e);
    }
  };

  onKeyUp = (e: KeyboardEvent): void => {
    if (e.key === ' ') {
      this.deps.setSpaceHeld(false);
      if (this.deps.getActivePointerCount() === 0) {
        const lastPointerEvent = this.deps.getLastPointerEvent();
        if (lastPointerEvent) {
          this.deps.dispatchToolHover(lastPointerEvent);
        } else {
          this.deps.getToolContext()?.setCursor?.('default');
        }
      }
    }
  };

  runAction(action: string, e?: KeyboardEvent): void {
    switch (action) {
      case 'delete':
        e?.preventDefault();
        this.deps.actions.deleteSelected();
        return;
      case 'deselect':
        this.deps.actions.deselect();
        return;
      case 'undo':
        e?.preventDefault();
        this.deps.actions.undo();
        return;
      case 'redo':
        e?.preventDefault();
        this.deps.actions.redo();
        return;
      case 'select-all':
        e?.preventDefault();
        this.deps.actions.selectAll();
        return;
      case 'copy':
        e?.preventDefault();
        this.deps.actions.copy();
        return;
      case 'paste':
        e?.preventDefault();
        this.deps.actions.paste();
        return;
      case 'duplicate':
        e?.preventDefault();
        this.deps.actions.duplicate();
        return;
      case 'z-forward':
        e?.preventDefault();
        this.deps.actions.zOrder('forward');
        return;
      case 'z-backward':
        e?.preventDefault();
        this.deps.actions.zOrder('backward');
        return;
      case 'z-front':
        e?.preventDefault();
        this.deps.actions.zOrder('front');
        return;
      case 'z-back':
        e?.preventDefault();
        this.deps.actions.zOrder('back');
        return;
      case 'zoom-fit':
        e?.preventDefault();
        this.deps.actions.zoomToFit();
        return;
      case 'group':
        e?.preventDefault();
        this.deps.actions.group();
        return;
      case 'ungroup':
        e?.preventDefault();
        this.deps.actions.ungroup();
        return;
      case 'cut':
        e?.preventDefault();
        this.deps.actions.cut();
        return;
      case 'toggle-lock':
        e?.preventDefault();
        this.deps.actions.toggleLock();
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
        if (delta && this.deps.actions.nudge(delta[0], delta[1], e?.shiftKey ?? false)) {
          e?.preventDefault();
        }
        return;
      }
      default:
        if (action.startsWith('tool:')) {
          if (this.deps.getIsToolActive()) return;
          e?.preventDefault();
          this.deps.getToolContext()?.switchTool?.(action.slice('tool:'.length));
          return;
        }
        console.warn(`[fieldnotes] unknown shortcut action "${action}"`);
    }
  }

  private isInScope(): boolean {
    if (this.deps.scope === 'window') return true;
    const active = document.activeElement;
    return active === this.deps.element || this.deps.element.contains(active);
  }
}
