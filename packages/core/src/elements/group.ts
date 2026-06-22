import type { CanvasElement } from './types';

/** Expand a selection to include every co-member of any group it touches. Returns `ids`
 * unchanged (same reference) when no selected element is grouped. */
export function expandToGroups(ids: string[], elements: CanvasElement[]): string[] {
  const byId = new Map(elements.map((e) => [e.id, e]));
  const groupIds = new Set<string>();
  for (const id of ids) {
    const g = byId.get(id)?.groupId;
    if (g) groupIds.add(g);
  }
  if (groupIds.size === 0) return ids;
  const idSet = new Set(ids);
  const result = [...ids];
  for (const el of elements) {
    if (el.groupId && groupIds.has(el.groupId) && !idSet.has(el.id)) {
      result.push(el.id);
      idSet.add(el.id);
    }
  }
  return result;
}
