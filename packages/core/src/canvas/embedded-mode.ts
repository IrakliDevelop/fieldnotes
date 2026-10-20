import { isTextEntryTarget } from './live-control';

export interface EmbeddedModeDeps {
  wrapper: HTMLElement;
  isMenuOpen: () => boolean;
  /** Runs before listeners on every engaged → disengaged transition. */
  onDisengage: () => void;
}

/** Engaged flag of an embedded board: wrapper touch-action and the document Escape listener. */
export class EmbeddedMode {
  private engaged = false;
  private readonly listeners = new Set<(engaged: boolean) => void>();

  constructor(private readonly deps: EmbeddedModeDeps) {
    deps.wrapper.style.touchAction = 'manipulation';
    deps.wrapper.style.overscrollBehavior = 'auto';
  }

  isEngaged(): boolean {
    return this.engaged;
  }

  setEngaged(engaged: boolean): void {
    if (engaged === this.engaged) return;
    this.engaged = engaged;
    this.deps.wrapper.style.touchAction = engaged ? 'none' : 'manipulation';
    if (engaged) {
      document.addEventListener('keydown', this.onKeyDown);
    } else {
      document.removeEventListener('keydown', this.onKeyDown);
      this.deps.onDisengage();
    }
    for (const listener of [...this.listeners]) listener(engaged);
  }

  onChange(listener: (engaged: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Touch is ignored while disengaged so the page can scroll; mouse and pen are never gated. */
  acceptsPointer(pointerType: string): boolean {
    return this.engaged || pointerType !== 'touch';
  }

  destroy(): void {
    document.removeEventListener('keydown', this.onKeyDown);
    this.listeners.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (this.deps.isMenuOpen() || isTextEntryTarget(e.target)) return;
    this.setEngaged(false);
  };
}
