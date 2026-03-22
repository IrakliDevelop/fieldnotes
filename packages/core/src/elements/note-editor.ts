import type { ElementStore } from './element-store';

export class NoteEditor {
  private editingId: string | null = null;
  private editingNode: HTMLDivElement | null = null;
  private blurHandler: (() => void) | null = null;
  private keyHandler: ((e: KeyboardEvent) => void) | null = null;
  private pointerHandler: ((e: PointerEvent) => void) | null = null;
  private pendingEditId: string | null = null;
  private onStopCallback: ((elementId: string) => void) | null = null;

  get isEditing(): boolean {
    return this.editingId !== null;
  }

  get editingElementId(): string | null {
    return this.editingId;
  }

  setOnStop(callback: (elementId: string) => void): void {
    this.onStopCallback = callback;
  }

  startEditing(node: HTMLDivElement, elementId: string, store: ElementStore): void {
    if (this.editingId === elementId) return;

    if (this.editingId) {
      this.stopEditing(store);
    }

    this.pendingEditId = elementId;

    requestAnimationFrame(() => {
      if (this.pendingEditId !== elementId) return;
      this.pendingEditId = null;
      this.activateEditing(node, elementId, store);
    });
  }

  stopEditing(store: ElementStore): void {
    this.pendingEditId = null;

    if (!this.editingId || !this.editingNode) return;

    const text = this.editingNode.textContent ?? '';
    store.update(this.editingId, { text });

    this.editingNode.contentEditable = 'false';
    Object.assign(this.editingNode.style, {
      userSelect: 'none',
      cursor: 'default',
    });

    if (this.blurHandler) {
      this.editingNode.removeEventListener('blur', this.blurHandler);
    }
    if (this.keyHandler) {
      this.editingNode.removeEventListener('keydown', this.keyHandler);
    }
    if (this.pointerHandler) {
      this.editingNode.removeEventListener('pointerdown', this.pointerHandler);
    }

    if (this.editingId && this.onStopCallback) {
      this.onStopCallback(this.editingId);
    }

    this.editingId = null;
    this.editingNode = null;
    this.blurHandler = null;
    this.keyHandler = null;
    this.pointerHandler = null;
  }

  destroy(store: ElementStore): void {
    this.pendingEditId = null;
    if (this.isEditing) {
      this.stopEditing(store);
    }
  }

  private activateEditing(node: HTMLDivElement, elementId: string, store: ElementStore): void {
    this.editingId = elementId;
    this.editingNode = node;

    node.contentEditable = 'true';
    Object.assign(node.style, {
      userSelect: 'text',
      cursor: 'text',
      outline: 'none',
    });
    node.focus();

    const selection = window.getSelection?.();
    if (selection) {
      const range = document.createRange();
      range.selectNodeContents(node);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    this.blurHandler = () => this.stopEditing(store);
    this.keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        node.blur();
      }
      e.stopPropagation();
    };
    this.pointerHandler = (e: PointerEvent) => {
      e.stopPropagation();
    };

    node.addEventListener('blur', this.blurHandler);
    node.addEventListener('keydown', this.keyHandler);
    node.addEventListener('pointerdown', this.pointerHandler);
  }
}
