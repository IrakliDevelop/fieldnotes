import type { CameraView } from './camera-view';
import { assertValidView } from './camera-view';
import type { Camera } from './camera';
import { CameraAnimator, type FrameScheduler } from './camera-animator';
import type { Bounds } from '../core/types';
import type { ElementStore } from '../elements/element-store';
import { frameContentBounds, isFrameElement } from '../elements/frame-element';
import { isLiveControlTarget } from './live-control';

/** One slide: the world rectangle to frame, contain-fit on any screen. */
export interface PresentationSlide {
  readonly view: CameraView;
  /** Set when the slide was built from a frame. */
  readonly frameId?: string;
}

export interface PresentationStartOptions {
  /** Default: every frame on a visible layer, in scene order (D1). Copied at start. */
  readonly slides?: readonly PresentationSlide[];
  /** Slide to open on; a non-integer or out-of-range value opens slide 0. Default 0. */
  readonly index?: number;
  /** Request fullscreen on the host container. Default `true`. */
  readonly fullscreen?: boolean;
  /** Animate steps between slides; `prefers-reduced-motion: reduce` forces jumps. Default `true`. */
  readonly animate?: boolean;
}

export interface PresentationState {
  readonly active: boolean;
  /** `-1` while inactive. */
  readonly index: number;
  /** `0` while inactive. */
  readonly count: number;
  /** Whether the host container is `document.fullscreenElement`. */
  readonly fullscreen: boolean;
}

export interface PresentationApi {
  /** Same reference until something changes, so sources can compare by identity. */
  getState(): PresentationState;
  /** The slides of the running presentation; empty while inactive. */
  getSlides(): readonly PresentationSlide[];
  /** `false` when already active or when there are no slides. Throws on an invalid slide view. */
  start(options?: PresentationStartOptions): boolean;
  exit(): void;
  /** `false` at the last slide or while inactive; no wrap-around. */
  next(): boolean;
  /** `false` at the first slide or while inactive. */
  previous(): boolean;
  /** `false` while inactive or when `index` is not an integer in `[0, count)`. */
  goTo(index: number): boolean;
  onChange(listener: () => void): () => void;
}

export interface PresentationModeDeps {
  container: HTMLElement;
  wrapper: HTMLElement;
  camera: Camera;
  getCanvasSize(): { w: number; h: number };
  defaultSlides(): PresentationSlide[];
  onResize(listener: () => void): () => void;
  activeToolName(): string | null;
  /** Runs the `tool.<name>` action; `false` when the registry refused (gesture active, no tool). */
  setTool(name: string): boolean;
  clearSelection(): void;
  /** Cancels pan inertia so a coast cannot write the camera after a slide. */
  stopCameraMotion(): void;
  /** Animator timing seams, as `CameraAnimatorOptions`; production omits them. */
  frames?: FrameScheduler;
  now?: () => number;
}

const INACTIVE: PresentationState = { active: false, index: -1, count: 0, fullscreen: false };

export class PresentationMode implements PresentationApi {
  private state = INACTIVE;
  private slides: PresentationSlide[] = [];
  private animator: CameraAnimator | null = null;
  private disposeResize: (() => void) | null = null;
  private previousCamera: { x: number; y: number; zoom: number } | null = null;
  private previousTool: string | null = null;
  private animate = true;
  private ownsFullscreen = false;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: PresentationModeDeps) {}

  getState(): PresentationState {
    return this.state;
  }

  getSlides(): readonly PresentationSlide[] {
    return this.slides;
  }

  start(options: PresentationStartOptions = {}): boolean {
    if (this.state.active) return false;

    const slides = [...(options.slides ?? this.deps.defaultSlides())];
    if (slides.length === 0) return false;
    for (const slide of slides) assertValidView(slide.view);

    const index =
      Number.isInteger(options.index) && options.index >= 0 && options.index < slides.length
        ? options.index
        : 0;
    const position = this.deps.camera.position;
    this.previousCamera = { x: position.x, y: position.y, zoom: this.deps.camera.zoom };
    this.previousTool = null;
    this.slides = slides;
    this.animate = options.animate !== false && !this.prefersReducedMotion();
    this.animator = new CameraAnimator(this.deps.wrapper, this.deps.camera, {
      getCanvasSize: this.deps.getCanvasSize,
      interactive: false,
      frames: this.deps.frames,
      now: this.deps.now,
    });
    this.disposeResize = this.deps.onResize(() => this.refit());
    window.addEventListener('keydown', this.onKeyDown, true);
    document.addEventListener('fullscreenchange', this.onFullscreenChange);
    this.deps.clearSelection();
    const activeTool = this.deps.activeToolName();
    if (activeTool !== 'laser' && activeTool !== 'hand' && this.deps.setTool('hand')) {
      this.previousTool = activeTool;
    }
    this.deps.wrapper.focus({ preventScroll: true });
    this.state = {
      active: true,
      index,
      count: slides.length,
      fullscreen: document.fullscreenElement === this.deps.container,
    };
    this.applySlide(index, false);
    this.emit();
    if (
      options.fullscreen !== false &&
      document.fullscreenElement !== this.deps.container &&
      typeof this.deps.container.requestFullscreen === 'function'
    ) {
      this.ownsFullscreen = true;
      void this.deps.container.requestFullscreen().catch(() => undefined);
    }
    return true;
  }

  exit(): void {
    if (!this.state.active) return;

    this.stop();
    this.exitFullscreen();
    const previousCamera = this.previousCamera;
    if (previousCamera !== null) {
      this.deps.camera.setZoom(previousCamera.zoom);
      this.deps.camera.moveTo(previousCamera.x, previousCamera.y);
    }
    if (this.previousTool !== null) this.deps.setTool(this.previousTool);
    this.reset();
    this.emit();
  }

  next(): boolean {
    return this.goTo(this.state.index + 1);
  }

  previous(): boolean {
    return this.goTo(this.state.index - 1);
  }

  goTo(index: number): boolean {
    if (
      !this.state.active ||
      !Number.isInteger(index) ||
      index < 0 ||
      index >= this.slides.length
    ) {
      return false;
    }
    if (index === this.state.index) {
      this.applySlide(index, this.animate);
      return true;
    }

    this.applySlide(index, this.animate);
    this.state = { ...this.state, index };
    this.emit();
    return true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  destroy(): void {
    this.stop();
    this.exitFullscreen();
    this.reset();
    this.listeners.clear();
  }

  private prefersReducedMotion(): boolean {
    return (
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  private refit(): void {
    if (!this.state.active) return;
    this.applySlide(this.state.index, false);
  }

  private applySlide(index: number, animate: boolean): void {
    const slide = this.slides[index];
    const animator = this.animator;
    if (slide === undefined || animator === null) return;
    this.deps.stopCameraMotion();
    if (animate) animator.animateTo(slide.view);
    else animator.jumpTo(slide.view);
  }

  private stop(): void {
    window.removeEventListener('keydown', this.onKeyDown, true);
    document.removeEventListener('fullscreenchange', this.onFullscreenChange);
    this.disposeResize?.();
    this.disposeResize = null;
    this.animator?.dispose();
    this.animator = null;
  }

  private reset(): void {
    this.previousCamera = null;
    this.previousTool = null;
    this.slides = [];
    this.ownsFullscreen = false;
    this.state = INACTIVE;
  }

  private onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey || !this.shouldHandleKey(event.target))
      return;

    let method: (() => void) | null = null;
    if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'PageDown' ||
      (event.key === ' ' && !event.shiftKey)
    ) {
      method = () => this.next();
    } else if (
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp' ||
      event.key === 'PageUp' ||
      (event.key === ' ' && event.shiftKey)
    ) {
      method = () => this.previous();
    } else if (event.key === 'Home') {
      method = () => this.goTo(0);
    } else if (event.key === 'End') {
      method = () => this.goTo(this.state.count - 1);
    } else if (event.key === 'Escape') {
      method = () => this.exit();
    }
    if (method === null) return;
    event.preventDefault();
    event.stopPropagation();
    method();
  };

  private onFullscreenChange = (): void => {
    const fullscreen = document.fullscreenElement === this.deps.container;
    if (fullscreen && !this.state.fullscreen) {
      this.state = { ...this.state, fullscreen: true };
      this.emit();
    } else if (!fullscreen && this.state.fullscreen) {
      this.exit();
    }
  };

  private shouldHandleKey(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    if (element?.isContentEditable || element?.closest('[contenteditable]') !== null) return false;
    const tag = element?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    return !isLiveControlTarget(target, this.deps.wrapper);
  }

  private exitFullscreen(): void {
    if (this.ownsFullscreen && document.fullscreenElement === this.deps.container) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener();
  }
}

export function framePresentationSlides(
  store: ElementStore,
  isLayerVisible: (layerId: string) => boolean,
): PresentationSlide[] {
  return store.getAll().flatMap((el) => {
    if (!isFrameElement(el) || !isLayerVisible(el.layerId)) return [];
    const view: Bounds = frameContentBounds(el);
    return [{ view, frameId: el.id }];
  });
}
