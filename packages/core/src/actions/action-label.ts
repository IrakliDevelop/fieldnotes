import type { ActionContext, ActionDefinition } from './types';

export function resolveActionLabel(definition: ActionDefinition, context: ActionContext): string {
  if (typeof definition.label === 'string') return definition.label;
  try {
    return definition.label(context);
  } catch (error) {
    console.error(`[fieldnotes] action label() failed for "${definition.id}"`, error);
    return definition.id;
  }
}
