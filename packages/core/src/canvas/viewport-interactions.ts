import type { Camera } from './camera';
import type { ElementStore } from '../elements/element-store';
import type { NoteEditor } from '../elements/note-editor';
import type { InteractMode } from './interact-mode';
import type { DomNodeManager } from './dom-node-manager';
import type { RenderLoop } from './render-loop';
import type { HistoryRecorder } from '../history/history-recorder';
import type { ArrowElement } from '../elements/types';
import type { ToolContext } from '../tools/types';
import { DoubleTapDetector } from './double-tap-detector';
import { isNearArrowCurve } from '../elements/arrow-geometry';
import { getElementBounds } from '../elements/element-bounds';
import { isNoteContentEmpty } from '../elements/note-sanitizer';
import { hitTest } from '../tools/select-hit';
import { isLiveControlTarget } from './live-control';
import { createBoundText, getBoundText, isBoundTextContainer } from '../elements/bound-text';

/** Screen pixels; converted to world units per zoom at the call site. */
const ARROW_HIT_THRESHOLD_PX = 10;

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
  addImage: (src: string, position: { x: number; y: number }) => string;
  dropHandler?: (event: DragEvent, worldPosition: { x: number; y: number }) => void;
  acceptsPointer?: (e: PointerEvent) => boolean;
}

export class ViewportInteractions {
  private readonly doubleTapDetector = new DoubleTapDetector();
  private tapDownX = 0;
  private tapDownY = 0;
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
    const text = createBoundText(container, {
      text:
        container.type === 'arrow'
          ? (container.label ?? '')
              .replace(/&/g, '&amp;')
              .replace(/</g, '&lt;')
              .replace(/>/g, '&gt;')
              .replace(/"/g, '&quot;')
              .replace(/'/g, '&#39;')
          : undefined,
    });
    const transactionId = this.deps.recorder.currentTransactionId;
    if (transactionId === null)
      throw new Error('bound text creation requires a history transaction');
    this.createdEdit = { id: text.id, transactionId };
    this.deps.store.add(text);
    if (container.type === 'arrow' && container.label)
      this.deps.store.update(container.id, { label: undefined });
    this.deps.requestRender();
    this.deps.renderLoop.flush();
    this.deps.domNodeManager.syncDomNode(text);
    if (!this.openEditor(text.id)) {
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
      this.deps.noteEditor.startEditing(node, id, this.deps.store);
      return true;
    }
    return false;
  }

  liveFitHeight(elementId: string): void {
    const element = this.deps.store.getById(elementId);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return;
    if (element.type === 'text' && element.autoResize === false) return;
    const node = this.deps.domNodeManager.getNode(elementId);
    if (!node) return;
    const previousHeight = node.style.height;
    const previousWidth = node.style.width;
    node.style.height = 'auto';
    if (element.type === 'text' && element.wrap === false) node.style.width = 'auto';
    const height = node.scrollHeight;
    const width =
      element.type === 'text' && element.wrap === false ? node.scrollWidth : element.size.w;
    node.style.height = previousHeight;
    node.style.width = previousWidth;
    if (height > 0 && (height !== element.size.h || width !== element.size.w)) {
      this.deps.store.update(elementId, { size: { w: width, h: height } });
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
      this.liveFitHeight(elementId);
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

  onTapDown = (e: PointerEvent): void => {
    if (!this.accepts(e)) return;
    this.tapDownX = e.clientX;
    this.tapDownY = e.clientY;
  };

  onDoubleTap = (e: PointerEvent): void => {
    if (!this.accepts(e)) return;
    const dx = e.clientX - this.tapDownX;
    const dy = e.clientY - this.tapDownY;
    const moved = Math.sqrt(dx * dx + dy * dy);
    if (moved > 10) return;

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

    const rect = this.deps.wrapper.getBoundingClientRect();
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const world = this.deps.camera.screenToWorld(screen);

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

  findArrowAt(world: { x: number; y: number }): ArrowElement | undefined {
    const tolerance = ARROW_HIT_THRESHOLD_PX / this.deps.camera.zoom;
    const candidates = [...this.deps.store.getAll()].reverse();
    for (const el of candidates) {
      if (
        el.type === 'arrow' &&
        isNearArrowCurve(world, el, tolerance, (id) => {
          const bound = this.deps.store.getById(id);
          return bound ? getElementBounds(bound) : null;
        })
      ) {
        return el;
      }
    }
    return undefined;
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

  onDragOver = (e: DragEvent): void => {
    e.preventDefault();
  };

  onDrop = (e: DragEvent): void => {
    e.preventDefault();
    const rect = this.deps.wrapper.getBoundingClientRect();
    const screenPos = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPos = this.deps.camera.screenToWorld(screenPos);

    if (this.deps.dropHandler) {
      this.deps.dropHandler(e, worldPos);
      return;
    }

    const files = e.dataTransfer?.files;
    if (!files) return;

    for (const file of files) {
      if (!file.type.startsWith('image/')) continue;

      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        if (typeof src !== 'string') return;
        this.deps.addImage(src, worldPos);
      };
      reader.readAsDataURL(file);
    }
  };
}
