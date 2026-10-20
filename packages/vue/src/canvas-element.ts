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
import { useViewport } from './composables/use-viewport';

/** Props for {@link CanvasElement}. */
export interface CanvasElementProps {
  /** Canvas-space position of the element's top-left corner. */
  position: { x: number; y: number };
  /** Optional fixed size; omit to let the element size to its content. */
  size?: { w: number; h: number };
}

/**
 * Marks every store mutation this component makes as host-owned: external origin, so it
 * neither creates an undo step nor is re-broadcast to the sync hub.
 */
const HOST_ORIGIN = 'host';

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
    let elementId: string | null = null;
    let teardown: (() => void) | undefined;

    // Plain copies of the latest props, so the store never holds a reactive proxy.
    const geometry = () => ({
      position: { x: props.position.x, y: props.position.y },
      ...(props.size ? { size: { w: props.size.w, h: props.size.h } } : {}),
    });

    onMounted(() => {
      const container = document.createElement('div');
      Object.assign(container.style, { width: '100%', height: '100%' });

      const register = () => {
        // Append to domLayer immediately so teleported children are queryable in the document
        // before the viewport render loop fires via requestAnimationFrame.
        viewport.domLayer.appendChild(container);
        const { position, size } = geometry();
        return viewport.addHtmlElement(container, position, size, {
          transient: true,
          origin: HOST_ORIGIN,
        });
      };

      elementId = register();
      portalTarget.value = container;

      // A store clear detaches every canvas-owned DOM node and forgets the content registered
      // for it, so this component has to hand its container back afterwards. The decision is
      // deferred to a microtask because a remote clear is followed — synchronously, by the sync
      // client — by re-adding the transient elements: reading the store inside the event would
      // always report this element gone and add a duplicate.
      const handleStoreReplacement = () => {
        const clearedId = elementId;
        if (clearedId === null) return;
        queueMicrotask(() => {
          if (elementId !== clearedId) return;
          if (viewport.store.getById(clearedId)?.type === 'html') {
            // Survived the clear (the sync client re-adds transient elements after a remote
            // clear): restore the container as that element's content instead of adding a second.
            viewport.updateHtmlElement(clearedId, container);
          } else {
            elementId = register();
          }
          viewport.requestRender();
        });
      };
      // `clear` covers a clear-canvas gesture and a remote clear. A wholesale state replacement
      // (`loadState`/`loadJSON`) runs inside `suspendNotifications`, so the store coalesces its
      // events into a single `batch` instead: the same recovery applies.
      const unsubscribeClear = viewport.store.on('clear', handleStoreReplacement);
      const unsubscribeBatch = viewport.store.on('batch', handleStoreReplacement);

      teardown = () => {
        unsubscribeClear();
        unsubscribeBatch();
        if (elementId) {
          viewport.store.remove(elementId, { origin: HOST_ORIGIN });
          viewport.requestRender();
          elementId = null;
        }
        // Removing the element usually detaches the container; never leave it orphaned in the layer.
        if (container.parentNode === viewport.domLayer) container.remove();
      };
    });

    onBeforeUnmount(() => teardown?.());

    // Watched by value, so inline literals and re-renders with equal geometry do not update.
    watch(
      [() => props.position.x, () => props.position.y, () => props.size?.w, () => props.size?.h],
      () => {
        if (!elementId) return;
        viewport.store.update(elementId, geometry(), { origin: HOST_ORIGIN });
        viewport.requestRender();
      },
    );

    return () =>
      portalTarget.value ? h(Teleport, { to: portalTarget.value }, slots.default?.() ?? []) : null;
  },
});
