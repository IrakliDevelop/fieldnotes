import type { Camera } from './camera';
import type { Tool, ToolContext } from '../tools/types';
import type { ShortcutOptions, ShortcutsApi } from './shortcut-map';
import { ShortcutMap } from './shortcut-map';
import type { KeyboardActions } from './keyboard-actions';
import type { ActionRegistry } from '../actions/action-registry';
import { createBuiltinActions } from '../actions/builtin-actions';

export interface KeyboardHandlerDeps {
  element: HTMLElement;
  camera: Camera;
  keyboardActions: KeyboardActions;
  actions?: ActionRegistry;
  scope: 'focus' | 'window';
  shortcuts?: ShortcutOptions;
  abortSignal: AbortSignal;
  getToolContext: () => ToolContext | null;
  getIsToolActive: () => boolean;
  getActiveTool: () => Tool | null;
  getLastPointerEvent: () => PointerEvent | null;
  setSpaceHeld: (v: boolean) => void;
  getActivePointerCount: () => number;
  dispatchToolHover: (e: PointerEvent) => void;
  addImage: (src: string, world: { x: number; y: number }) => string;
  getLastPointerWorld: () => { x: number; y: number } | null;
  getCenteredWorld: () => { x: number; y: number };
  onPaste?: (e: ClipboardEvent, world: { x: number; y: number }) => void;
}

export class KeyboardHandler {
  readonly shortcutMap: ShortcutMap;

  constructor(private readonly deps: KeyboardHandlerDeps) {
    this.shortcutMap = new ShortcutMap(deps.shortcuts?.bindings);

    if (deps.actions) {
      deps.actions.attachShortcuts(this.shortcutMap);
      const ka = deps.keyboardActions;
      for (const def of createBuiltinActions({
        keyboardActions: ka,
        zoomByFactor: (f) => this.zoomByFactor(f),
        zoomToLevel: (l) => this.zoomToLevel(l),
        canPaste: () => ka.hasClipboard(),
      })) {
        deps.actions.register(def);
      }
    }

    window.addEventListener('keydown', this.onKeyDown, { signal: deps.abortSignal });
    window.addEventListener('keyup', this.onKeyUp, { signal: deps.abortSignal });
    window.addEventListener('paste', this.onPaste, { signal: deps.abortSignal });
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

  private shouldHandle(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (el?.isContentEditable) return false;
    const tag = el?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    return this.isInScope();
  }

  onKeyDown = (e: KeyboardEvent): void => {
    if (!this.shouldHandle(e.target)) return;

    if (e.key === ' ') {
      this.deps.setSpaceHeld(true);
    }

    const tool = this.deps.getActiveTool();
    const ctx = this.deps.getToolContext();
    if (tool?.onKeyDown && ctx && tool.onKeyDown(e, ctx)) {
      e.preventDefault();
      return;
    }

    const id = this.shortcutMap.match(e);
    if (id !== null && this.deps.actions) {
      const handled = this.deps.actions.run(id, { source: 'keyboard', shiftKey: e.shiftKey });
      if (handled) {
        const def = this.deps.actions.get(id);
        if (def?.preventDefault !== false) {
          e.preventDefault();
        }
      }
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

  onPaste = (e: ClipboardEvent): void => {
    if (!this.shouldHandle(e.target)) return;
    const items = e.clipboardData?.items;
    let file: File | null = null;
    if (items) {
      for (const it of items) {
        if (it.kind === 'file' && it.type.startsWith('image/')) {
          file = it.getAsFile();
          break;
        }
      }
    }
    if (file) {
      e.preventDefault();
      const world = this.deps.getLastPointerWorld() ?? this.deps.getCenteredWorld();
      if (this.deps.onPaste) {
        this.deps.onPaste(e, world);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === 'string') this.deps.addImage(reader.result, world);
      };
      reader.readAsDataURL(file);
      return;
    }
    this.deps.keyboardActions.paste();
  };

  private isInScope(): boolean {
    if (this.deps.scope === 'window') return true;
    const active = document.activeElement;
    return active === this.deps.element || this.deps.element.contains(active);
  }
}
