export type CanvasWatch = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  onRestore: () => void,
) => () => void;

const noop = (): void => undefined;

interface WatchEntry {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  onRestore: () => void;
  onLost: (event: Event) => void;
  onRestored: () => void;
}

export class ContextLossGuard {
  private readonly lost = new Set<HTMLCanvasElement | OffscreenCanvas>();
  private readonly watches = new Set<WatchEntry>();
  private readonly restoring = new Set<HTMLCanvasElement | OffscreenCanvas>();
  private mask: HTMLDivElement | null = null;
  private disposed = false;

  constructor(
    private readonly wrapper: HTMLDivElement,
    private readonly requestRecovery: () => void,
  ) {}

  watch: CanvasWatch = (canvas, onRestore) => {
    if (this.disposed) return noop;
    const entry: WatchEntry = {
      canvas,
      onRestore,
      onLost: (event) => {
        event.preventDefault?.();
        if (this.disposed || this.lost.has(canvas)) return;
        this.lost.add(canvas);
        this.showMask();
      },
      onRestored: () => {
        if (this.disposed || !this.lost.has(canvas)) return;
        let restored = false;
        this.restoring.add(canvas);
        try {
          onRestore();
          restored = true;
        } catch {
          // A failed owner remains lost; recovery still repaints every other surface.
        } finally {
          this.restoring.delete(canvas);
          if (restored) this.lost.delete(canvas);
          this.requestRecovery();
        }
      },
    };
    canvas.addEventListener('contextlost', entry.onLost);
    canvas.addEventListener('contextrestored', entry.onRestored);
    this.watches.add(entry);
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      canvas.removeEventListener('contextlost', entry.onLost);
      canvas.removeEventListener('contextrestored', entry.onRestored);
      this.watches.delete(entry);
      if (this.disposed) return;
      if (this.restoring.has(canvas)) return;
      if (!this.lost.delete(canvas)) return;
      this.requestRecovery();
    };
  };

  frameComplete(): void {
    if (this.lost.size === 0) this.mask?.remove();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.watches) {
      entry.canvas.removeEventListener('contextlost', entry.onLost);
      entry.canvas.removeEventListener('contextrestored', entry.onRestored);
    }
    this.watches.clear();
    this.lost.clear();
    this.mask?.remove();
  }

  private showMask(): void {
    if (!this.mask) {
      const mask = document.createElement('div');
      mask.dataset['fieldnotesContextLossMask'] = '';
      Object.assign(mask.style, {
        position: 'absolute',
        inset: '0',
        zIndex: '2147483647',
        background: '#000',
        opacity: '1',
        pointerEvents: 'none',
      });
      this.mask = mask;
    }
    this.wrapper.appendChild(this.mask);
  }
}
