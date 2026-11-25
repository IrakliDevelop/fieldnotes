import type { ActionDefinition } from './types';
import type { ElementStore } from '../elements/element-store';
import type { LayerManager } from '../layers/layer-manager';
import type { ElementRegistry } from '../elements/element-registry';
import { isBoundTextContainer } from '../elements/bound-text';

export interface EditTextActionDeps {
  store: ElementStore;
  layerManager: LayerManager;
  elementRegistry: ElementRegistry;
  editBoundText: (id: string) => boolean;
  startEditingElement: (id: string) => void;
}

/** The `selection.edit-text` action: edits a note, text, or bound-text container. */
export function createEditTextAction(deps: EditTextActionDeps): ActionDefinition {
  return {
    id: 'selection.edit-text',
    label: 'Edit text',
    keywords: ['text', 'label', 'edit'],
    shortcut: ['enter'],
    menu: { group: 'clipboard', order: 5 },
    enabled: (ctx) => {
      if (ctx.selectedIds.length !== 1) return false;
      const id = ctx.selectedIds[0];
      const element = id ? deps.store.getById(id) : undefined;
      return !!(
        element &&
        !element.locked &&
        !deps.layerManager.isLayerLocked(element.layerId) &&
        (element.type === 'note' ||
          element.type === 'text' ||
          isBoundTextContainer(element, deps.elementRegistry))
      );
    },
    perform: (ctx) => {
      const id = ctx.selectedIds[0];
      if (!id) return false;
      const element = deps.store.getById(id);
      if (!element) return false;
      return isBoundTextContainer(element, deps.elementRegistry)
        ? deps.editBoundText(id)
        : (deps.startEditingElement(id), true);
    },
  };
}
