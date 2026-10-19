import { createHtmlElement } from '@fieldnotes/core';
import type { Viewport } from '@fieldnotes/core';
import type { IconName } from '../shell/icons';
import { chart } from './chart';
import { checklist } from './checklist';
import { counter } from './counter';
import { palette } from './palette';
import { textCard } from './text-card';

/** An interactive HTML widget persisted as `htmlType` + `data`. */
export interface WidgetDef<D> {
  readonly htmlType: string;
  readonly label: string;
  readonly icon: IconName;
  readonly size: { w: number; h: number };
  initialData(): D;
  /** Validates persisted or remote data; malformed data yields `initialData()`. */
  parse(data: unknown): D;
  render(data: D, commit: (update: (current: D) => D) => void): HTMLElement;
  /** Patches `dom` in place; never steals focus or resets a focused input. */
  refresh(dom: HTMLElement, data: D): void;
}

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

/** Event a widget dispatches (bubbling) to show a toast; `detail` is the message. */
export const TOAST_EVENT = 'pg:toast';

/** Narrows persisted data to a plain object. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Creates an element with a class and optional text (always via textContent). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

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
      const dom = def.render(def.parse(el.data), (update) =>
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
