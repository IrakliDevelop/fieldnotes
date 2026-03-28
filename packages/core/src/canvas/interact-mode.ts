export interface InteractModeDeps {
  getNode: (id: string) => HTMLDivElement | undefined;
}

export class InteractMode {
  private interactingElementId: string | null = null;
  private readonly getNode: (id: string) => HTMLDivElement | undefined;

  constructor(deps: InteractModeDeps) {
    this.getNode = deps.getNode;
  }

  startInteracting(id: string): void {
    this.stopInteracting();
    const node = this.getNode(id);
    if (!node) return;

    this.interactingElementId = id;
    node.style.pointerEvents = 'auto';
    node.addEventListener('pointerdown', this.onNodePointerDown);

    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('pointerdown', this.onPointerDown);
  }

  stopInteracting(): void {
    if (!this.interactingElementId) return;

    const node = this.getNode(this.interactingElementId);
    if (node) {
      node.style.pointerEvents = 'none';
      node.removeEventListener('pointerdown', this.onNodePointerDown);
    }

    this.interactingElementId = null;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('pointerdown', this.onPointerDown);
  }

  isInteracting(): boolean {
    return this.interactingElementId !== null;
  }

  destroy(): void {
    this.stopInteracting();
  }

  private onNodePointerDown = (e: PointerEvent): void => {
    e.stopPropagation();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      this.stopInteracting();
    }
  };

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.interactingElementId) return;
    const target = e.target;
    if (!(target instanceof Element)) {
      this.stopInteracting();
      return;
    }

    const node = this.getNode(this.interactingElementId);
    if (node && !node.contains(target)) {
      this.stopInteracting();
    }
  };
}
