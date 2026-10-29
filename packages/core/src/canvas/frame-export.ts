import type { Bounds } from '../core/types';
import { isFrameElement } from '../elements/frame-element';
import type { ElementStore } from '../elements/element-store';

export function resolveFrameExport(
  store: ElementStore,
  frameId: string | undefined,
): { readonly region: Bounds; readonly descendantIds: ReadonlySet<string> } | undefined {
  if (frameId === undefined) return undefined;

  const frame = store.getById(frameId);
  if (!frame || !isFrameElement(frame) || frame.parentId !== undefined) {
    throw new RangeError('frameId must identify a root frame');
  }
  const clipBounds = store.elementRegistry.getAdapter(frame.extensionType)?.clipBounds;
  if (!clipBounds) throw new RangeError('frameId must identify a frame with clip bounds');

  return {
    region: { ...clipBounds(frame) },
    descendantIds: new Set(store.getDescendants(frameId).map((element) => element.id)),
  };
}
