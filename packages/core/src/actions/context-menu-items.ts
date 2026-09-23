import type { ContextMenuItem } from '../canvas/context-menu';
import type { ActionContext, ActionDefinition, ActionMenuPlacement, ActionsApi } from './types';
import { BUILTIN_MENU_GROUPS } from './builtin-actions';

/** An action whose `menu` field is guaranteed present. */
interface MenuAction {
  readonly def: ActionDefinition;
  readonly menu: ActionMenuPlacement;
}

/**
 * Build the context-menu item list from the action registry.
 *
 * Visible items are those with a `menu` placement whose `isEnabled` returns
 * true.  Groups appear in `BUILTIN_MENU_GROUPS` order first, then unknown
 * groups in first-seen registration order.  Within a group items are sorted
 * by `menu.order` ascending (stable).  Exactly one separator between
 * non-empty groups; none at the ends.
 */
export function buildContextMenuItems(actions: ActionsApi, ctx: ActionContext): ContextMenuItem[] {
  // Collect enabled actions that have menu placement.
  const eligible: MenuAction[] = [];
  for (const def of actions.list()) {
    if (def.menu && actions.isEnabled(def.id)) {
      eligible.push({ def, menu: def.menu });
    }
  }

  if (eligible.length === 0) return [];

  // Group actions by menu.group, preserving registration order within each group.
  const groups = new Map<string, MenuAction[]>();
  for (const entry of eligible) {
    const group = entry.menu.group;
    let list = groups.get(group);
    if (!list) {
      list = [];
      groups.set(group, list);
    }
    list.push(entry);
  }

  // Determine group order: built-in groups first (in BUILTIN_MENU_GROUPS order),
  // then unknown groups in first-seen order (from the Map iteration order).
  const orderedGroupNames: string[] = [];
  for (const name of BUILTIN_MENU_GROUPS) {
    if (groups.has(name)) {
      orderedGroupNames.push(name);
    }
  }
  for (const name of groups.keys()) {
    if (!(BUILTIN_MENU_GROUPS as readonly string[]).includes(name)) {
      orderedGroupNames.push(name);
    }
  }

  // Build the flat item list with separators between non-empty groups.
  const items: ContextMenuItem[] = [];
  for (const groupName of orderedGroupNames) {
    const groupEntries = groups.get(groupName);
    if (!groupEntries || groupEntries.length === 0) continue;

    // Sort within the group by menu.order ascending (stable sort preserves registration order for ties).
    groupEntries.sort((a, b) => a.menu.order - b.menu.order);

    // Add separator before this group (if not the first).
    if (items.length > 0) {
      items.push({ separator: true });
    }

    for (const entry of groupEntries) {
      const label = typeof entry.def.label === 'function' ? entry.def.label(ctx) : entry.def.label;
      items.push({ label, action: entry.def.id });
    }
  }

  return items;
}
