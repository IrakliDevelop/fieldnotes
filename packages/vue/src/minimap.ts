import { defineComponent, h, ref, shallowRef, watch, type StyleValue } from 'vue';
import { MinimapController } from '@fieldnotes/core';
import { useViewport } from './composables/use-viewport';

/** Props for {@link Minimap}; `class` and `style` fall through to the root. */
export interface MinimapProps {
  /** Thumbnail width in CSS pixels. Default `200`. */
  width?: number;
  /** Thumbnail height in CSS pixels. Default `140`. */
  height?: number;
  /** Start collapsed (icon button only). Uncontrolled. Default `false`. */
  defaultCollapsed?: boolean;
  /** Backdrop fill behind the thumbnail. */
  background?: string;
  /** Viewport rectangle stroke color. */
  viewportStroke?: string;
}

const toggleStyle: StyleValue = {
  position: 'absolute',
  top: '2px',
  right: '2px',
  width: '24px',
  height: '24px',
  padding: '0',
  border: 'none',
  borderRadius: '4px',
  background: 'rgba(0,0,0,0.35)',
  color: '#fff',
  font: '14px/1 system-ui, sans-serif',
  cursor: 'pointer',
};

const collapsedStyle: StyleValue = {
  minWidth: '44px',
  minHeight: '44px',
  border: '1px solid rgba(0,0,0,0.15)',
  borderRadius: '8px',
  background: 'rgba(255,255,255,0.85)',
  cursor: 'pointer',
  font: '18px/1 system-ui, sans-serif',
};

// Exported for the props/interface parity check in the test; not public API.
export const minimapProps = {
  width: { type: Number, default: 200 },
  height: { type: Number, default: 140 },
  defaultCollapsed: { type: Boolean, default: false },
  background: String,
  viewportStroke: String,
} as const;

/**
 * Collapsible thumbnail overview navigator. Renders inside `<FieldNotesCanvas>`
 * (or under a host-provided `ViewportKey`). Positioning is host-owned — place and
 * style the component via `class`/`style`. While collapsed, no controller
 * exists: zero listeners, zero rendering.
 */
export const Minimap = defineComponent({
  name: 'Minimap',
  props: minimapProps,
  setup(props) {
    const viewport = useViewport();
    const collapsed = ref(props.defaultCollapsed);
    const canvas = shallowRef<HTMLCanvasElement | null>(null);

    watch(
      [
        collapsed,
        canvas,
        () => props.width,
        () => props.height,
        () => props.background,
        () => props.viewportStroke,
      ],
      ([isCollapsed, el, width, height, background, viewportStroke], _, onCleanup) => {
        if (isCollapsed || !el) return;
        const controller = new MinimapController(viewport, el, {
          width,
          height,
          background,
          viewportStroke,
        });
        onCleanup(() => controller.dispose());
      },
      { immediate: true, flush: 'post' },
    );

    return () => {
      if (collapsed.value) {
        return h(
          'button',
          {
            type: 'button',
            'aria-label': 'Expand minimap',
            onClick: () => (collapsed.value = false),
            style: collapsedStyle,
          },
          '▣',
        );
      }
      return h('div', { style: { position: 'relative' } }, [
        h('canvas', {
          ref: canvas,
          style: { width: `${props.width}px`, height: `${props.height}px`, display: 'block' },
        }),
        h(
          'button',
          {
            type: 'button',
            'aria-label': 'Collapse minimap',
            onClick: () => (collapsed.value = true),
            style: toggleStyle,
          },
          '–',
        ),
      ]);
    };
  },
});
