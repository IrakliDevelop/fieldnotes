import type { BaseElement } from './types';

/** Copies the `BaseElement` fields present on `element`, so adapters need not list them by hand. */
export function pickBaseFields(element: BaseElement): BaseElement {
  const {
    id,
    type,
    position,
    index,
    version,
    editor,
    locked,
    layerId,
    groupId,
    parentId,
    rotation,
  } = element;
  const base: BaseElement = { id, type, position, index, version, locked, layerId };
  if (editor !== undefined) base.editor = editor;
  if (groupId !== undefined) base.groupId = groupId;
  if (parentId !== undefined) base.parentId = parentId;
  if (rotation !== undefined) base.rotation = rotation;
  return base;
}
