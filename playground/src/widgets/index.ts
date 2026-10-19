import { createHtmlElement } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import { chart } from './chart';
import { checklist } from './checklist';
import { counter } from './counter';
import { palette } from './palette';
import { isRecord, TOAST_EVENT } from './shared';
import type { WidgetDef } from './shared';
import { textCard } from './text-card';

export type { WidgetDef } from './shared';

// WidgetDef is invariant in D; re-parsing at the edges lets one list hold every widget.
function erase<D>(def: WidgetDef<D>): WidgetDef<unknown> {
  return {
    ...def,
    render: (data, commit) =>
      def.render(def.parse(data), (update) => commit((current) => update(def.parse(current)))),
    refresh: (dom, data) => def.refresh(dom, def.parse(data)),
  };
}

/** Every playground widget, in insert-flyout order. */
export const WIDGETS: readonly WidgetDef<unknown>[] = [
  erase(checklist),
  erase(counter),
  erase(palette),
  erase(chart),
  erase(textCard),
];

function toData(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new Error('Widget data must be an object');
  return value;
}

/** Registers every widget renderer and keeps widget DOM in sync with store updates. */
export function registerWidgets(viewport: Viewport, toast: (message: string) => void): () => void {
  const doms = new Map<string, HTMLElement>();
  const defs = new Map(WIDGETS.map((def) => [def.htmlType, def]));
  for (const def of WIDGETS) {
    viewport.registerHtmlRenderer(def.htmlType, (el) => {
      const dom = def.render(el.data, (update) =>
        viewport.transaction(() => {
          // Read the stored data, not the render-time closure, so undo and remote edits count.
          const stored = viewport.store.getById(el.id);
          const current = def.parse(stored?.type === 'html' ? stored.data : undefined);
          viewport.store.update(el.id, { data: toData(update(current)) });
        }),
      );
      dom.addEventListener(TOAST_EVENT, (event) => {
        if (event instanceof CustomEvent && typeof event.detail === 'string') toast(event.detail);
      });
      doms.set(el.id, dom);
      return dom;
    });
  }
  const unsubscribers = [
    viewport.store.on('update', ({ previous, current }) => {
      if (current.type !== 'html' || previous.type !== 'html' || current.data === previous.data) {
        return;
      }
      const def = current.htmlType === undefined ? undefined : defs.get(current.htmlType);
      const dom = doms.get(current.id);
      if (def && dom) def.refresh(dom, def.parse(current.data));
    }),
    viewport.store.on('remove', (el) => doms.delete(el.id)),
    // clear() (loadJSON, snapshots) emits no per-element 'remove'.
    viewport.store.on('clear', () => doms.clear()),
  ];
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}

/** Adds a widget at `world` as one undo step (joins an open transaction); returns its id. */
export function insertWidget(
  viewport: Viewport,
  def: WidgetDef<unknown>,
  world: { x: number; y: number },
  data: unknown = def.initialData(),
): string {
  const el = createHtmlElement({
    position: world,
    size: def.size,
    htmlType: def.htmlType,
    data: toData(data),
    layerId: viewport.layerManager.activeLayerId,
  });
  viewport.transaction(() => viewport.store.add(el));
  return el.id;
}
