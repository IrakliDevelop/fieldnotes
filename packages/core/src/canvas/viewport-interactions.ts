import type { Camera } from './camera';
import type { Point } from '../core/types';
import type { ElementStore } from '../elements/element-store';
import type { NoteEditor } from '../elements/note-editor';
import type { InteractMode } from './interact-mode';
import type { DomNodeManager } from './dom-node-manager';
import type { RenderLoop } from './render-loop';
import type { HistoryRecorder } from '../history/history-recorder';
import type { CanvasElement } from '../elements/types';
import type { ToolContext } from '../tools/types';
import { DoubleTapDetector } from './double-tap-detector';
import { getElementBounds } from '../elements/element-bounds';
import {
  escapePlainTextHtml,
  isNoteContentEmpty,
  sanitizeNoteHtml,
} from '../elements/note-sanitizer';
import { hitTest } from '../tools/select-hit';
import { isLiveControlTarget } from './live-control';
import { createBoundText, getBoundText, isBoundTextContainer } from '../elements/bound-text';
import { isPasteLink, normalizeLink } from '../elements/link';

export interface ViewportInteractionsDeps {
  store: ElementStore;
  camera: Camera;
  wrapper: HTMLDivElement;
  domLayer: HTMLDivElement;
  renderLoop: RenderLoop;
  domNodeManager: DomNodeManager;
  noteEditor: NoteEditor;
  interactMode: InteractMode;
  recorder: HistoryRecorder;
  toolContext: ToolContext;
  requestRender: () => void;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- undefined keeps the host-owns-it contract
  dropHandler?: (event: DragEvent, worldPosition: Point) => boolean | void;
  insertText(text: string, anchor: Point, link?: string): void;
  insertFiles(files: File[], anchor: Point, kind: 'drop'): boolean;
  insertWhenIdle(run: () => void): void;
  acceptsPointer?: (e: PointerEvent) => boolean;
  isMac: () => boolean;
  activeToolName: () => string | null;
  openLink: (elementId: string, event: PointerEvent | null) => void;
}

export class ViewportInteractions {
  private readonly doubleTapDetector = new DoubleTapDetector();
  private tapDownX = 0;
  private tapDownY = 0;
  private tapModifier = false;
  private tapWasInteracting = false;
  private gestureOpenedLink = false;
  private createdEdit: { id: string; transactionId: number } | null = null;

  constructor(private readonly deps: ViewportInteractionsDeps) {}

  startEditingElement(id: string): void {
    const element = this.deps.store.getById(id);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return;
    if (element.type === 'text' && element.containerId) {
      const container = this.deps.store.getById(element.containerId);
      if (container && getBoundText(container, this.deps.store)?.id === element.id) {
        this.editBoundText(container.id);
        return;
      }
    }
    this.openEditor(id);
  }

  editBoundText(containerId: string): boolean {
    const requested = this.deps.store.getById(containerId);
    const container =
      requested?.type === 'text' && requested.containerId
        ? this.deps.store.getById(requested.containerId)
        : requested;
    if (!container || !isBoundTextContainer(container, this.deps.store.elementRegistry))
      return false;
    if (requested?.type === 'text' && getBoundText(container, this.deps.store)?.id !== requested.id)
      return false;
    const isLayerLocked = this.deps.toolContext.isLayerLocked;
    if (container.locked || (isLayerLocked && isLayerLocked(container.layerId))) return false;
    const existing = getBoundText(container, this.deps.store);
    if (existing && this.deps.noteEditor.isEditingOrPending(existing.id)) return true;
    this.deps.noteEditor.stopEditing(this.deps.store);
    if (existing) {
      return this.openEditor(existing.id);
    }
    this.deps.recorder.begin();
    const legacyLabel =
      container.type === 'arrow' ? escapePlainTextHtml(container.label ?? '') : undefined;
    const text = createBoundText(container, { text: legacyLabel }, this.deps.store.elementRegistry);
    const transactionId = this.deps.recorder.currentTransactionId;
    if (transactionId === null)
      throw new Error('bound text creation requires a history transaction');
    this.createdEdit = { id: text.id, transactionId };
    this.deps.store.add(text);
    if (container.type === 'arrow' && container.label)
      this.deps.store.update(container.id, { label: undefined });
    this.deps.requestRender();
    this.deps.renderLoop.flush();
    const stored = this.deps.store.getById(text.id);
    if (!stored || stored.type !== 'text') throw new Error('bound text was not added');
    this.deps.domNodeManager.syncDomNode(stored);
    if (!this.openEditor(stored.id)) {
      this.deps.store.remove(text.id);
      if (!this.deps.recorder.rollbackIfOnly(text.id)) this.deps.recorder.commit();
      this.createdEdit = null;
      return false;
    }
    return true;
  }

  private openEditor(id: string): boolean {
    const element = this.deps.store.getById(id);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return false;

    this.deps.renderLoop.flush();

    const node = this.deps.domNodeManager.getNode(id);
    if (node) {
      const toolbarPosition = this.toolbarPositionFor(element);
      if (toolbarPosition) {
        this.deps.noteEditor.startEditing(node, id, this.deps.store, toolbarPosition);
      } else {
        this.deps.noteEditor.startEditing(node, id, this.deps.store);
      }
      return true;
    }
    return false;
  }

  liveFitHeight(elementId: string): void {
    const element = this.deps.store.getById(elementId);
    if (!element || element.type !== 'text' || element.autoResize === false) return;
    const node = this.deps.domNodeManager.getNode(elementId);
    if (!node) return;
    const previousHeight = node.style.height;
    const previousWidth = node.style.width;
    node.style.height = 'auto';
    if (element.wrap === false) node.style.width = 'auto';
    const height = node.scrollHeight;
    const width = element.wrap === false ? node.scrollWidth : element.size.w;
    node.style.height = previousHeight;
    node.style.width = previousWidth;
    const size = { w: width, h: height };
    const container =
      element.containerId && element.parentId === element.containerId
        ? this.deps.store.getById(element.containerId)
        : undefined;
    const isBound =
      container !== undefined &&
      isBoundTextContainer(container, this.deps.store.elementRegistry) &&
      getBoundText(container, this.deps.store)?.id === element.id;
    const text = isBound ? sanitizeNoteHtml(node.innerHTML) : element.text;
    if (
      height > 0 &&
      (height !== element.size.h || width !== element.size.w || (isBound && text !== element.text))
    ) {
      this.deps.store.update(elementId, isBound ? { text, size } : { size });
      this.deps.noteEditor.updateToolbarPosition?.();
    }
  }

  fitNoteHeight(elementId: string): void {
    const element = this.deps.store.getById(elementId);
    if (!element || element.type !== 'note') return;
    if (isNoteContentEmpty(element.text)) return;
    const node = this.deps.domNodeManager.getNode(elementId);
    if (!node) return;
    const measured = node.scrollHeight;
    if (measured > element.size.h) {
      this.deps.store.update(elementId, { size: { w: element.size.w, h: measured } });
    }
  }

  onTextEditStop(elementId: string): void {
    const element = this.deps.store.getById(elementId);
    if (!element) return;

    if (element.type === 'note') {
      if (isNoteContentEmpty(element.text)) {
        this.deps.store.remove(elementId);
        return;
      }
      return;
    }

    if (element.type !== 'text') return;

    if (element.containerId && isNoteContentEmpty(element.text)) {
      this.deps.store.remove(elementId);
      return;
    }

    if (!element.text || element.text.trim() === '') {
      this.deps.store.remove(elementId);
      return;
    }

    this.liveFitHeight(elementId);
  }

  /** Opens a link at most once per pointer gesture: a modifier press on a badge must not open twice. */
  openGestureLink(elementId: string, event: PointerEvent | null): void {
    if (this.gestureOpenedLink) return;
    this.gestureOpenedLink = true;
    this.deps.openLink(elementId, event);
  }

  onTapDown = (e: PointerEvent): void => {
    this.gestureOpenedLink = false;
    if (!this.accepts(e)) return;
    this.tapDownX = e.clientX;
    this.tapDownY = e.clientY;
    this.tapModifier = e.button === 0 && (this.deps.isMac() ? e.metaKey : e.ctrlKey);
    // Read at down: interact mode's window pointerdown listener exits it before the up.
    this.tapWasInteracting = this.deps.interactMode.isInteracting();
  };

  onDoubleTap = (e: PointerEvent): void => {
    if (!this.accepts(e)) return;
    const dx = e.clientX - this.tapDownX;
    const dy = e.clientY - this.tapDownY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved > 10) return;

    const rect = this.deps.wrapper.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = this.deps.camera.screenToWorld(screen);

    if (this.tapModifier && !this.tapWasInteracting && this.deps.activeToolName() === 'select') {
      const hit = hitTest(world, this.deps.toolContext);
      if (hit?.link !== undefined) {
        this.openGestureLink(hit.id, e);
        return;
      }
    }

    if (!this.doubleTapDetector.feed(e)) return;
    if (typeof document.elementFromPoint !== 'function') return;

    const el = document.elementFromPoint(e.clientX, e.clientY);

    const nodeEl = (el as HTMLElement | null)?.closest<HTMLDivElement>('[data-element-id]');
    if (nodeEl) {
      const elementId = nodeEl.dataset['elementId'];
      if (elementId) {
        const element = this.deps.store.getById(elementId);
        if (element?.type === 'note' || element?.type === 'text') {
          this.startEditingElement(elementId);
          return;
        }
      }
    }

    // HTML embeds keep double-tap priority: you double-tapped inside the embed even if an
    // arrow's curve passes nearby. Arrow-label editing only when no embed is hit.
    // Locked layers stay activatable (pointer-input invariant); only hidden layers are skipped.
    const hit = hitTest(
      world,
      { ...this.deps.toolContext, isLayerLocked: () => false },
      (el) => 'size' in el && el.type !== 'extension',
    );
    if (hit?.type === 'html') {
      if (!hit.interactive) this.deps.interactMode.startInteracting(hit.id);
      return;
    }

    const boundHit = this.findBoundTextContainerAt(world);
    if (boundHit) this.editBoundText(boundHit.id);
  };

  private accepts(e: PointerEvent): boolean {
    const acceptsPointer = this.deps.acceptsPointer;
    return (
      (!acceptsPointer || acceptsPointer(e)) && !isLiveControlTarget(e.target, this.deps.wrapper)
    );
  }

  private findBoundTextContainerAt(world: { x: number; y: number }) {
    const hit = hitTest(
      world,
      { ...this.deps.toolContext, isLayerLocked: () => false },
      (element) => isBoundTextContainer(element, this.deps.store.elementRegistry),
    );
    return hit && isBoundTextContainer(hit, this.deps.store.elementRegistry) ? hit : undefined;
  }

  beginEditHistory(id: string): void {
    if (
      this.createdEdit?.id === id &&
      this.createdEdit.transactionId === this.deps.recorder.currentTransactionId
    ) {
      return;
    }
    this.deps.recorder.begin();
  }

  commitEditHistory(id: string): void {
    this.onTextEditStop(id);
    if (!this.deps.recorder.rollbackIfOnly(id)) this.deps.recorder.commit();
    if (this.createdEdit?.id === id) this.createdEdit = null;
  }

  abandonEditHistory(id: string): void {
    if (
      this.createdEdit?.id !== id ||
      this.createdEdit.transactionId !== this.deps.recorder.currentTransactionId
    )
      return;
    this.commitEditHistory(id);
  }

  private toolbarPositionFor(element: CanvasElement): (() => DOMRect | null) | undefined {
    if (element.type !== 'text' || !element.containerId || element.parentId !== element.containerId)
      return undefined;
    const container = this.deps.store.getById(element.containerId);
    if (
      !container ||
      !isBoundTextContainer(container, this.deps.store.elementRegistry) ||
      getBoundText(container, this.deps.store)?.id !== element.id
    )
      return undefined;
    const id = container.id;
    return () => {
      const current = this.deps.store.getById(id);
      if (!current || !isBoundTextContainer(current, this.deps.store.elementRegistry)) return null;
      const bounds = getElementBounds(current, this.deps.store.elementRegistry);
      if (!bounds) return null;
      const topLeft = this.deps.camera.worldToScreen({ x: bounds.x, y: bounds.y });
      const bottomRight = this.deps.camera.worldToScreen({
        x: bounds.x + bounds.w,
        y: bounds.y + bounds.h,
      });
      const wrapper = this.deps.wrapper.getBoundingClientRect();
      return new DOMRect(
        wrapper.left + topLeft.x,
        wrapper.top + topLeft.y,
        bottomRight.x - topLeft.x,
        bottomRight.y - topLeft.y,
      );
    };
  }

  onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const rect = this.deps.wrapper.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = this.deps.camera.screenToWorld(screenPos);

    if (this.deps.dropHandler && this.deps.dropHandler(e, worldPos) !== false) return;
    const dt = e.dataTransfer;
    if (!dt) return;
    const files = [...dt.files];
    if (files.length === 0) {
      const uri =
        dt
          .getData('text/uri-list')
          .split(/\r?\n/)
          .find((l) => l.trim() !== '' && !l.startsWith('#')) ?? '';
      const text = uri || dt.getData('text/plain');
      const line = text.trim();
      if (line === '') return;
      this.deps.insertWhenIdle(() => {
        if (!line.includes('\n') && isPasteLink(line)) {
          this.deps.insertText(line, worldPos, normalizeLink(line) ?? undefined);
        } else {
          this.deps.insertText(text, worldPos);
        }
      });
      return;
    }
    this.deps.insertFiles(files, worldPos, 'drop');
  };
}
