import type { CameraView } from './camera-view';
import { assertValidView } from './camera-view';
import type { Camera } from './camera';
import { CameraAnimator, type FrameScheduler } from './camera-animator';
import type { Bounds } from '../core/types';
import type { ElementStore } from '../elements/element-store';
import { frameContentBounds, isFrameElement } from '../elements/frame-element';
import { isLiveControlTarget } from './live-control';
import type { ActionDefinition } from '../actions/types';

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
  /** Whether the container or an element inside it is `document.fullscreenElement`. */
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

/** Action definitions for a presentation mode. */
export function createPresentationActions(mode: PresentationApi): ActionDefinition[] {
  return [
    {
      id: 'presentation.start',
      label: 'Present',
      keywords: ['presentation', 'slideshow', 'fullscreen'],
      icon: 'present',
      enabled: () => !mode.getState().active,
      perform: () => mode.start(),
    },
    {
      id: 'presentation.exit',
      label: 'Exit presentation',
      icon: 'present-exit',
      enabled: () => mode.getState().active,
      perform: () => mode.exit(),
    },
    {
      id: 'presentation.next',
      label: 'Next slide',
      icon: 'present-next',
      enabled: () => mode.getState().active,
      perform: () => mode.next(),
    },
    {
      id: 'presentation.previous',
      label: 'Previous slide',
      icon: 'present-previous',
      enabled: () => mode.getState().active,
      perform: () => mode.previous(),
    },
  ];
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

interface PendingFullscreen {
  owner: object | null;
  cleanupStarted: boolean;
}

export class PresentationMode implements PresentationApi {
  private state = INACTIVE;
  private slides: PresentationSlide[] = [];
  private animator: CameraAnimator | null = null;
  private disposeResize: (() => void) | null = null;
  private previousCamera: { x: number; y: number; zoom: number } | null = null;
  private previousTool: string | null = null;
  private animate = true;
  private ownsFullscreen = false;
  private session: object | null = null;
  private pendingFullscreen: PendingFullscreen | null = null;
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
      typeof options.index === 'number' &&
      Number.isInteger(options.index) &&
      options.index >= 0 &&
      options.index < slides.length
        ? options.index
        : 0;
    const position = this.deps.camera.position;
    this.previousCamera = { x: position.x, y: position.y, zoom: this.deps.camera.zoom };
    this.previousTool = null;
    this.session = {};
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
      fullscreen: this.isContainerFullscreen(),
    };
    this.applySlide(index, false);
    this.emit();
    this.requestFullscreen(options.fullscreen !== false);
    return true;
  }

  exit(): void {
    if (!this.state.active) return;

    this.stop();
    this.exitFullscreen();
    this.deps.stopCameraMotion();
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
    this.session = null;
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
    const fullscreen = this.isContainerFullscreen();
    const pending = this.pendingFullscreen;
    if (pending !== null && this.isStaleFullscreenRequest()) {
      if (fullscreen) {
        this.cleanupFullscreenRequest(pending);
        if (!this.state.fullscreen) {
          this.state = { ...this.state, fullscreen: true };
          this.emit();
        }
        return;
      }
      if (pending.cleanupStarted) {
        this.finishFullscreenCleanup(pending);
        return;
      }
    }
    if (fullscreen && !this.state.fullscreen) {
      if (this.pendingFullscreen?.owner === this.session && this.session !== null) {
        this.ownsFullscreen = true;
      }
      this.state = { ...this.state, fullscreen: true };
      this.emit();
    } else if (!fullscreen && this.state.fullscreen) {
      this.exit();
    }
  };

  private shouldHandleKey(target: EventTarget | null): boolean {
    const element = target instanceof HTMLElement ? target : null;
    if (
      element?.isContentEditable ||
      (element !== null &&
        element.closest('[contenteditable]:not([contenteditable="false"])') !== null)
    ) {
      return false;
    }
    const tag = element?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
    if (element?.matches('button, a[href], [role]')) return false;
    if (!this.state.fullscreen) {
      const activeElement = document.activeElement;
      if (
        activeElement !== null &&
        activeElement !== document.body &&
        !this.deps.container.contains(activeElement)
      ) {
        return false;
      }
    }
    return !isLiveControlTarget(target, this.deps.wrapper);
  }

  private exitFullscreen(): void {
    const session = this.session;
    const pending = this.pendingFullscreen;
    const pendingOwned = pending?.owner === session && session !== null;
    if (pendingOwned && pending !== null) pending.owner = null;
    const fullscreen = this.isContainerFullscreen();
    if (!fullscreen || (!this.ownsFullscreen && !pendingOwned)) return;
    if (pendingOwned && pending !== null) {
      this.cleanupFullscreenRequest(pending);
      return;
    }
    const cleanup = { owner: null, cleanupStarted: true };
    this.pendingFullscreen = cleanup;
    void document.exitFullscreen().then(
      () => this.finishFullscreenCleanup(cleanup),
      () => this.finishFullscreenCleanup(cleanup),
    );
  }

  private requestFullscreen(enabled: boolean): void {
    const session = this.session;
    const pending = this.pendingFullscreen;
    if (!enabled) {
      if (pending !== null && this.isStaleFullscreenRequest() && this.isContainerFullscreen()) {
        this.cleanupFullscreenRequest(pending);
      }
      return;
    }
    if (pending !== null && !pending.cleanupStarted) {
      pending.owner = session;
      return;
    }
    if (
      this.isContainerFullscreen() ||
      typeof this.deps.container.requestFullscreen !== 'function'
    ) {
      return;
    }
    const request = { owner: session, cleanupStarted: false };
    this.pendingFullscreen = request;
    void this.deps.container.requestFullscreen().then(
      () => this.settleFullscreenRequest(request),
      () => {
        if (this.pendingFullscreen === request && !request.cleanupStarted) {
          this.pendingFullscreen = null;
        }
      },
    );
  }

  private settleFullscreenRequest(request: PendingFullscreen): void {
    if (this.pendingFullscreen !== request) return;
    const fullscreen = this.isContainerFullscreen();
    if (request.owner === this.session && this.session !== null && fullscreen) {
      this.ownsFullscreen = true;
      this.pendingFullscreen = null;
      return;
    }
    if (!fullscreen) {
      this.finishFullscreenCleanup(request);
      return;
    }
    this.cleanupFullscreenRequest(request);
  }

  private isStaleFullscreenRequest(): boolean {
    return this.pendingFullscreen !== null && this.pendingFullscreen.owner !== this.session;
  }

  private cleanupFullscreenRequest(request: PendingFullscreen): void {
    if (request.cleanupStarted) return;
    request.cleanupStarted = true;
    if (document.fullscreenElement !== this.deps.container) {
      this.finishFullscreenCleanup(request);
      return;
    }
    void document.exitFullscreen().then(
      () => this.finishFullscreenCleanup(request),
      () => this.finishFullscreenCleanup(request),
    );
  }

  private finishFullscreenCleanup(request: PendingFullscreen): void {
    if (this.pendingFullscreen !== request || document.fullscreenElement === this.deps.container) {
      return;
    }
    this.pendingFullscreen = null;
    this.normalizeFullscreen();
  }

  private normalizeFullscreen(): void {
    if (!this.state.fullscreen) return;
    this.state = { ...this.state, fullscreen: false };
    this.emit();
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
