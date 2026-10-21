import {
  Teleport,
  defineComponent,
  h,
  onBeforeUnmount,
  onMounted,
  shallowRef,
  watch,
  type PropType,
} from 'vue';
import { attachHostElement } from '@fieldnotes/core';
import type { HostElementHandle } from '@fieldnotes/core';
import { useViewport } from './composables/use-viewport';

/** Props for {@link CanvasElement}. */
export interface CanvasElementProps {
  /** Canvas-space position of the element's top-left corner. */
  position: { x: number; y: number };
  /** Optional fixed size; omit to let the element size to its content. */
  size?: { w: number; h: number };
}

// Exported for the props/interface parity check in the test; not public API.
export const canvasElementProps = {
  position: { type: Object as PropType<CanvasElementProps['position']>, required: true },
  size: Object as PropType<CanvasElementProps['size']>,
} as const;

/**
 * Renders its default slot as an HTML element embedded in the canvas coordinate space.
 * The element is host-owned and transient: it is driven entirely by props, never appears
 * in exported state, and never records an undo step.
 * Must be used inside a `<FieldNotesCanvas>`.
 */
export const CanvasElement = defineComponent({
  name: 'CanvasElement',
  // The root is a Teleport, which cannot inherit attributes.
  inheritAttrs: false,
  props: canvasElementProps,
  setup(props, { slots }) {
    const viewport = useViewport();
    const portalTarget = shallowRef<HTMLElement | null>(null);
    let host: HostElementHandle | undefined;

    onMounted(() => {
      const container = document.createElement('div');
      Object.assign(container.style, { width: '100%', height: '100%' });
      host = attachHostElement(viewport, container, props);
      portalTarget.value = container;
    });

    onBeforeUnmount(() => host?.destroy());

    // Watched by value, so inline literals and re-renders with equal geometry do not update.
    watch(
      [() => props.position.x, () => props.position.y, () => props.size?.w, () => props.size?.h],
      () => host?.setGeometry(props),
    );

    return () =>
      portalTarget.value ? h(Teleport, { to: portalTarget.value }, slots.default?.() ?? []) : null;
  },
});
