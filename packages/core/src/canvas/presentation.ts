import type { CameraView } from './camera-view';
import type { Bounds } from '../core/types';
import type { ElementStore } from '../elements/element-store';
import { frameContentBounds, isFrameElement } from '../elements/frame-element';

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
