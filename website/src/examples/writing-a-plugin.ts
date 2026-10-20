import { pickBaseFields, Viewport } from '@fieldnotes/core';
import type {
  BaseElement,
  ElementTypeDefinition,
  ExtensionElementEnvelope,
  Size,
  Tool,
  ViewportPlugin,
} from '@fieldnotes/core';

// #region definition
interface Marker extends BaseElement {
  type: 'my-app:marker';
  label: string;
  size: Size;
}

const markerDefinition: ElementTypeDefinition<Marker> = {
  type: 'my-app:marker',
  legacyTypes: [],
  decodeLegacy: () => {
    throw new Error('my-app:marker has no legacy types');
  },
  validateData: (data) => typeof data['label'] === 'string',
  wrap: (el): ExtensionElementEnvelope => ({
    ...pickBaseFields(el),
    type: 'extension',
    extensionType: 'my-app:marker',
    size: el.size,
    data: { label: el.label },
  }),
  unwrap: (el) => ({
    ...pickBaseFields(el),
    type: 'my-app:marker',
    label: String(el.data['label']),
    size: el.size ?? { w: 40, h: 40 },
  }),
  bounds: (el) => ({ x: el.position.x, y: el.position.y, w: el.size.w, h: el.size.h }),
  render(ctx, el) {
    ctx.fillStyle = '#2f55a4';
    ctx.fillRect(el.position.x, el.position.y, el.size.w, el.size.h);
    ctx.fillStyle = '#ffffff';
    ctx.font = '14px sans-serif';
    ctx.fillText(el.label, el.position.x + 6, el.position.y + 24);
  },
};
// #endregion definition

// #region tool
const markerTool: Tool = {
  name: 'marker',
  onPointerDown(state, ctx) {
    ctx.store.add(
      markerDefinition.wrap({
        id: crypto.randomUUID(),
        type: 'my-app:marker',
        position: ctx.camera.screenToWorld({ x: state.x, y: state.y }),
        index: '',
        version: 1,
        locked: false,
        layerId: ctx.activeLayerId ?? '',
        label: 'A1',
        size: { w: 40, h: 40 },
      }),
    );
  },
  onPointerMove: () => undefined,
  onPointerUp: () => undefined,
};
// #endregion tool

// #region plugin
export const markerPlugin: ViewportPlugin = {
  name: 'my-app:markers',
  configure(ctx) {
    ctx.registerElementType(markerDefinition);
    ctx.registerTool(markerTool);
  },
};
// #endregion plugin

export function markerBoard(): void {
  // #region plugin
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion -- // #hide
  const viewport = new Viewport(document.getElementById('board')!, {
    tools: 'default',
    plugins: [markerPlugin],
  });
  viewport.setTool('marker');
  // #endregion plugin
}
