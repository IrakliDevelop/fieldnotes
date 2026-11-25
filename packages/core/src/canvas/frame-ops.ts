import type { ElementStore } from '../elements/element-store';
import type { ElementRegistry } from '../elements/element-registry';
import type { LayerManager } from '../layers/layer-manager';
import { createId } from '../elements/create-id';
import {
  planAddToFrame,
  planDissolveFrame,
  planFrameSelection,
  planRemoveFromFrame,
} from '../elements/frame-commands';

export interface FrameOpsDeps {
  store: ElementStore;
  elementRegistry: ElementRegistry;
  layerManager: LayerManager;
  transaction: <T>(operation: () => T) => T;
  requestRender: () => void;
  setSelection: (ids: string[]) => void;
}

export class FrameOps {
  constructor(private readonly deps: FrameOpsDeps) {}

  setParent(childId: string, parentId: string | null): void {
    this.deps.transaction(() => {
      const child = this.deps.store.getById(childId);
      const nextParent = parentId ?? undefined;
      const clearContainer = child?.type === 'text' && child.containerId !== nextParent;
      if (!child || (child.parentId === nextParent && !clearContainer)) return;
      this.deps.store.update(childId, {
        parentId: nextParent,
        ...(clearContainer ? { containerId: undefined } : {}),
      });
      this.deps.requestRender();
    });
  }

  frameSelection(
    ids: readonly string[],
    options?: { readonly title?: string; readonly color?: string; readonly padding?: number },
  ): string {
    const id = createId('frame');
    const plan = planFrameSelection(
      ids,
      options ?? {},
      id,
      this.deps.store,
      this.deps.elementRegistry,
      this.deps.layerManager,
    );
    this.deps.transaction(() => {
      if (!plan.add) throw new Error('Frame command plan has no frame');
      this.deps.store.add(plan.add);
      if (plan.updates.length > 0) this.deps.store.updateMany(plan.updates);
      this.deps.setSelection([id]);
    });
    this.deps.requestRender();
    return id;
  }

  addToFrame(frameId: string, ids: readonly string[]): void {
    const plan = planAddToFrame(
      frameId,
      ids,
      this.deps.store,
      this.deps.elementRegistry,
      this.deps.layerManager,
    );
    this.deps.transaction(() => {
      if (plan.updates.length > 0) this.deps.store.updateMany(plan.updates);
    });
    this.deps.requestRender();
  }

  removeFromFrame(frameId: string, ids: readonly string[]): void {
    const plan = planRemoveFromFrame(
      frameId,
      ids,
      this.deps.store,
      this.deps.elementRegistry,
      this.deps.layerManager,
    );
    this.deps.transaction(() => {
      if (plan.updates.length > 0) this.deps.store.updateMany(plan.updates);
    });
    this.deps.requestRender();
  }

  dissolveFrame(frameId: string): void {
    const plan = planDissolveFrame(
      frameId,
      this.deps.store,
      this.deps.elementRegistry,
      this.deps.layerManager,
    );
    this.deps.transaction(() => {
      if (plan.updates.length > 0) this.deps.store.updateMany(plan.updates);
      if (plan.removeId) this.deps.store.remove(plan.removeId);
    });
    this.deps.requestRender();
  }
}
