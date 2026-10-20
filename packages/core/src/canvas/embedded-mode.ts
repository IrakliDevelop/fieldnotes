import { isLiveControlTarget, isTextEntryTarget } from './live-control';

/** A touchstart this soon after a pen pointerdown belongs to that pen. */
const PEN_TOUCH_WINDOW_MS = 50;

export interface EmbeddedModeDeps {
  wrapper: HTMLElement;
  isMenuOpen: () => boolean;
  /** Runs before listeners on every engaged → disengaged transition. */
  onDisengage: () => void;
}

/** Engaged flag of an embedded board: wrapper touch-action and the document Escape listener. */
export class EmbeddedMode {
  private engaged = false;
  private destroyed = false;
  private lastPenDownAt = -Infinity;
  private readonly listeners = new Set<(engaged: boolean) => void>();

  constructor(private readonly deps: EmbeddedModeDeps) {
    deps.wrapper.style.touchAction = 'manipulation';
    deps.wrapper.style.overscrollBehavior = 'auto';
    deps.wrapper.addEventListener('pointerdown', this.onPointerDown);
    deps.wrapper.addEventListener('touchstart', this.onTouchStart, { passive: false });
  }

  isEngaged(): boolean {
    return this.engaged;
  }

  setEngaged(engaged: boolean): void {
    if (this.destroyed || engaged === this.engaged) return;
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
    this.destroyed = true;
    document.removeEventListener('keydown', this.onKeyDown);
    this.deps.wrapper.removeEventListener('pointerdown', this.onPointerDown);
    this.deps.wrapper.removeEventListener('touchstart', this.onTouchStart);
    this.listeners.clear();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented) return;
    if (this.deps.isMenuOpen() || isTextEntryTarget(e.target)) return;
    this.setEngaged(false);
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') this.lastPenDownAt = e.timeStamp;
  };

  /**
   * Stops a disengaged stylus from scrolling the page, as touch-action applies to it on iPad.
   * Unverified on devices (no iOS or Android spike ran); unit tests are the only evidence.
   */
  private readonly onTouchStart = (e: TouchEvent): void => {
    if (this.engaged || isLiveControlTarget(e.target, this.deps.wrapper)) return;
    const penJustDown = e.timeStamp - this.lastPenDownAt <= PEN_TOUCH_WINDOW_MS;
    for (const touch of e.changedTouches) {
      // touchType is WebKit-only; elsewhere the pen pointerdown just before identifies a stylus.
      const type = 'touchType' in touch ? touch.touchType : undefined;
      if (type === 'stylus' || (type === undefined && penJustDown)) {
        e.preventDefault();
        return;
      }
    }
  };
}
