import { LIVE_NODE_ATTR, isLiveControlTarget } from './live-control';
import type { ViewportInteractions } from './viewport-interactions';

export interface WrapperEventsDeps {
  wrapper: HTMLDivElement;
  handlers: Pick<ViewportInteractions, 'onTapDown' | 'onDoubleTap' | 'onDragOver' | 'onDrop'>;
  embedded: boolean;
}

/** Adds the six wrapper listeners and returns one function that removes them. */
export function bindWrapperEvents(deps: WrapperEventsDeps): () => void {
  const { wrapper, embedded } = deps;
  const { onTapDown, onDoubleTap, onDragOver, onDrop } = deps.handlers;
  wrapper.addEventListener('pointerdown', onTapDown);
  wrapper.addEventListener('pointerup', onDoubleTap);
  wrapper.addEventListener('dragover', onDragOver);
  wrapper.addEventListener('drop', onDrop);
  // Native drag from live padding would fight the board's own drag; live controls keep theirs.
  const onDragStart = (e: DragEvent): void => {
    if (
      e.target instanceof Element &&
      e.target.closest('[data-element-id]')?.hasAttribute(LIVE_NODE_ATTR) &&
      !isLiveControlTarget(e.target, wrapper)
    ) {
      e.preventDefault();
    }
  };
  // Focusing a control can scroll the overflow:hidden wrapper and misalign DOM and canvas.
  const onWrapperScroll = (): void => {
    if (embedded || wrapper.querySelector(`[data-element-id][${LIVE_NODE_ATTR}]`)) {
      wrapper.scrollTop = 0;
      wrapper.scrollLeft = 0;
    }
  };
  wrapper.addEventListener('dragstart', onDragStart);
  wrapper.addEventListener('scroll', onWrapperScroll);
  return () => {
    wrapper.removeEventListener('dragstart', onDragStart);
    wrapper.removeEventListener('scroll', onWrapperScroll);
    wrapper.removeEventListener('pointerdown', onTapDown);
    wrapper.removeEventListener('pointerup', onDoubleTap);
    wrapper.removeEventListener('dragover', onDragOver);
    wrapper.removeEventListener('drop', onDrop);
  };
}
