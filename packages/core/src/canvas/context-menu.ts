import type { Point } from '../core/types';

export interface ContextMenuItem {
  label: string;
  action: string;
  disabled?: boolean;
}

export interface ContextMenuOptions {
  onCommand: (action: string) => void;
  onClose: () => void;
}

export class ContextMenu {
  private el: HTMLDivElement | null = null;
  private outsideListener: ((e: PointerEvent) => void) | null = null;
  private keyListener: ((e: KeyboardEvent) => void) | null = null;

  constructor(private readonly options: ContextMenuOptions) {}

  isOpen(): boolean {
    return this.el !== null;
  }

  open(items: ContextMenuItem[], screenPos: Point): void {
    this.close();
    const el = document.createElement('div');
    el.className = 'fieldnotes-context-menu';
    Object.assign(el.style, {
      position: 'fixed',
      left: `${screenPos.x}px`,
      top: `${screenPos.y}px`,
      zIndex: '10000',
      display: 'flex',
      flexDirection: 'column',
    });
    for (const item of items) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'fieldnotes-context-menu-item' +
        (item.disabled ? ' fieldnotes-context-menu-item--disabled' : '');
      btn.textContent = item.label;
      if (item.disabled) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => {
          this.options.onCommand(item.action);
          this.close();
        });
      }
      el.appendChild(btn);
    }
    document.body.appendChild(el);
    this.el = el;
    this.clampToViewport(el, screenPos);

    this.keyListener = (e: KeyboardEvent) => {
      if (e.key === 'Escape') this.close();
    };
    document.addEventListener('keydown', this.keyListener);

    this.outsideListener = (e: PointerEvent) => {
      if (this.el && !this.el.contains(e.target as Node)) this.close();
    };
    // Defer attaching so the opening gesture's own pointerdown doesn't immediately close it.
    setTimeout(() => {
      if (this.outsideListener) document.addEventListener('pointerdown', this.outsideListener);
    }, 0);
  }

  close(): void {
    if (this.keyListener) {
      document.removeEventListener('keydown', this.keyListener);
      this.keyListener = null;
    }
    if (this.outsideListener) {
      document.removeEventListener('pointerdown', this.outsideListener);
      this.outsideListener = null;
    }
    if (this.el) {
      this.el.remove();
      this.el = null;
      this.options.onClose();
    }
  }

  dispose(): void {
    this.close();
  }

  private clampToViewport(el: HTMLElement, screenPos: Point): void {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && screenPos.x + rect.width > window.innerWidth) {
      el.style.left = `${Math.max(0, screenPos.x - rect.width)}px`;
    }
    if (rect.height > 0 && screenPos.y + rect.height > window.innerHeight) {
      el.style.top = `${Math.max(0, screenPos.y - rect.height)}px`;
    }
  }
}
