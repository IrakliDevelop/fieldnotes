export class HybridRenderSurface {
  private readonly canvases = new Map<number, HTMLCanvasElement>();

  constructor(private readonly root: HTMLDivElement) {}

  beginFrame(activeOrders: ReadonlySet<number>, width: number, height: number): void {
    for (const [order, canvas] of this.canvases) {
      if (!activeOrders.has(order)) {
        canvas.remove();
        this.canvases.delete(order);
      }
    }

    for (const order of activeOrders) {
      const canvas = this.getCanvas(order);
      if (canvas.width !== width) canvas.width = width;
      if (canvas.height !== height) canvas.height = height;
      canvas.style.zIndex = String(order);
    }
  }

  getContext(order: number): CanvasRenderingContext2D | null {
    return this.getCanvas(order).getContext('2d');
  }

  clear(): void {
    for (const canvas of this.canvases.values()) canvas.remove();
    this.canvases.clear();
  }

  private getCanvas(order: number): HTMLCanvasElement {
    let canvas = this.canvases.get(order);
    if (canvas) return canvas;

    canvas = document.createElement('canvas');
    canvas.dataset['paintOrder'] = String(order);
    Object.assign(canvas.style, {
      position: 'absolute',
      inset: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
    });
    this.root.appendChild(canvas);
    this.canvases.set(order, canvas);
    return canvas;
  }
}
