import { createShape } from '@fieldnotes/core';
import type { ShapeElement } from '@fieldnotes/core';
import type { SyncOp } from '@fieldnotes/sync';

/** A protocol-2 shape: `createShape` with a valid index key, since its default `''` is never sent. */
export function v2Shape(input: Parameters<typeof createShape>[0]): ShapeElement {
  return createShape({ index: 'a0', ...input });
}

/** A protocol-2 remove, which must carry a version and an editor. */
export function v2Remove(
  id: string,
  version = 2,
  editor = 'client',
): Extract<SyncOp, { kind: 'remove' }> {
  return { kind: 'remove', id, version, editor };
}
