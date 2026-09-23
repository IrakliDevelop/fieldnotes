import type { Viewport } from '../canvas/viewport';
import type { ElementStore } from '../elements/element-store';

export interface ActionContext {
  readonly viewport: Viewport;
  readonly store: ElementStore;
  readonly selectedIds: readonly string[];
}

export type ActionSource = 'keyboard' | 'menu' | 'api';

export interface ActionInvocation {
  readonly source: ActionSource;
  readonly shiftKey: boolean;
}

export interface ActionMenuPlacement {
  /** Built-in groups: 'clipboard' | 'arrange' | 'transform' | 'lock'. Plugins may use any string. */
  readonly group: string;
  /** Ascending within a group. */
  readonly order: number;
}

export interface ActionDefinition {
  /** Namespaced, unique, e.g. 'edit.undo', 'tool.pencil', 'my-plugin.frobnicate'. */
  readonly id: string;
  readonly label: string | ((ctx: ActionContext) => string);
  readonly keywords?: readonly string[];
  /** Identifier only (e.g. 'undo'); UI layers map it to a glyph. Core never renders it. */
  readonly icon?: string;
  /** Default bindings in ShortcutMap syntax. User rebinding overrides these. */
  readonly shortcut?: readonly string[];
  /** Match with or without Shift held (nudge). Default false. */
  readonly allowShift?: boolean;
  /** Present when the action appears in the context menu. */
  readonly menu?: ActionMenuPlacement;
  /** Default: always enabled. Disabled actions are hidden from the menu and ignored by run(). */
  readonly enabled?: (ctx: ActionContext) => boolean;
  /** Call preventDefault on the triggering keyboard event. Default true. */
  readonly preventDefault?: boolean;
  /** Return false to report "nothing happened" (keyboard then does not preventDefault). */
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- callbacks may omit the return; false means "nothing happened"
  readonly perform: (ctx: ActionContext, invocation: ActionInvocation) => void | boolean;
}

export interface ActionsApi {
  /** Throws if id is already registered. Returns the unregister function. */
  register(definition: ActionDefinition): () => void;
  get(id: string): ActionDefinition | undefined;
  /** Registration order. */
  list(): readonly ActionDefinition[];
  isEnabled(id: string): boolean;
  /** Returns false when unknown or disabled, or when perform returned false. */
  run(id: string, invocation?: Partial<ActionInvocation>): boolean;
  onChange(listener: () => void): () => void;
}
