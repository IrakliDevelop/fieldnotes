import type { IconName } from '../shell/icons';

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
