import type { Camera } from './camera';
import type { ElementStore } from '../elements/element-store';
import type { ElementRenderer } from '../elements/element-renderer';
import type { NoteEditor } from '../elements/note-editor';
import type { ArrowLabelEditor } from '../elements/arrow-label-editor';
import type { InteractMode } from './interact-mode';
import type { DomNodeManager } from './dom-node-manager';
import type { RenderLoop } from './render-loop';
import type { HistoryRecorder } from '../history/history-recorder';
import type { CanvasElement, ArrowElement } from '../elements/types';
import { DoubleTapDetector } from './double-tap-detector';
import { isNearBezier } from '../elements/arrow-geometry';
import { isNoteContentEmpty } from '../elements/note-sanitizer';

const ARROW_HIT_THRESHOLD = 10;

export interface ViewportInteractionsDeps {
  store: ElementStore;
  camera: Camera;
  wrapper: HTMLDivElement;
  domLayer: HTMLDivElement;
  renderLoop: RenderLoop;
  domNodeManager: DomNodeManager;
  noteEditor: NoteEditor;
  arrowLabelEditor: ArrowLabelEditor;
  interactMode: InteractMode;
  renderer: ElementRenderer;
  recorder: HistoryRecorder;
  requestRender: () => void;
  addImage: (src: string, position: { x: number; y: number }) => string;
  dropHandler?: (event: DragEvent, worldPosition: { x: number; y: number }) => void;
}

export class ViewportInteractions {
  private readonly doubleTapDetector = new DoubleTapDetector();
  private tapDownX = 0;
  private tapDownY = 0;

  constructor(private readonly deps: ViewportInteractionsDeps) {}

  startEditingElement(id: string): void {
    const element = this.deps.store.getById(id);
    if (!element || (element.type !== 'note' && element.type !== 'text')) return;

    this.deps.renderLoop.flush();

    const node = this.deps.domNodeManager.getNode(id);
    if (node) {
      this.deps.noteEditor.startEditing(node, id, this.deps.store);
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
      this.fitNoteHeight(elementId);
      return;
    }

    if (element.type !== 'text') return;

    if (!element.text || element.text.trim() === '') {
      this.deps.store.remove(elementId);
      return;
    }

    const node = this.deps.domNodeManager.getNode(elementId);
    if (node && 'size' in element) {
      const measured = node.scrollHeight;
      if (measured !== element.size.h) {
        this.deps.store.update(elementId, { size: { w: element.size.w, h: measured } });
      }
    }
  }

  onTapDown = (e: PointerEvent): void => {
    this.tapDownX = e.clientX;
    this.tapDownY = e.clientY;
  };

  onDoubleTap = (e: PointerEvent): void => {
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
    const hit = this.hitTestWorld(world);
    if (hit?.type === 'html') {
      this.deps.interactMode.startInteracting(hit.id);
      return;
    }

    const arrow = this.findArrowAt(world);
    if (arrow) {
      this.startArrowLabelEdit(arrow);
    }
  };

  findArrowAt(world: { x: number; y: number }): ArrowElement | undefined {
    const candidates = this.deps.store.queryPoint(world).reverse();
    for (const el of candidates) {
      if (
        el.type === 'arrow' &&
        isNearBezier(world, el.from, el.to, el.bend, ARROW_HIT_THRESHOLD)
      ) {
        return el;
      }
    }
    return undefined;
  }

  startArrowLabelEdit(arrow: ArrowElement): void {
    this.deps.arrowLabelEditor.startEditing({
      arrow,
      layer: this.deps.domLayer,
      store: this.deps.store,
      recorder: this.deps.recorder,
      onDone: () => {
        this.deps.renderer.setLabelEditingId(null);
        this.deps.requestRender();
      },
    });
    // Set AFTER startEditing: starting a new edit cleans up any prior session, whose onDone
    // synchronously clears the editing id — so claim suppression for this arrow last.
    this.deps.renderer.setLabelEditingId(arrow.id);
  }

  private hitTestWorld(world: { x: number; y: number }): CanvasElement | null {
    const candidates = this.deps.store.queryPoint(world).reverse();
    for (const el of candidates) {
      if (!('size' in el)) continue;
      const { x, y } = el.position;
      const { w, h } = el.size;
      if (world.x >= x && world.x <= x + w && world.y >= y && world.y <= y + h) {
        return el;
      }
    }
    return null;
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
