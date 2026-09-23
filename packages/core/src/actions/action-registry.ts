import type { ActionContext, ActionDefinition, ActionInvocation, ActionsApi } from './types';
import { resolveActionId } from './legacy-action-ids';

export interface ShortcutDefaultsSink {
  setDefault(id: string, bindings: readonly string[], allowShift: boolean): void;
  clearDefault(id: string): void;
}

export class ActionRegistry implements ActionsApi {
  private readonly definitions = new Map<string, ActionDefinition>();
  private readonly listeners = new Set<() => void>();
  private sink: ShortcutDefaultsSink | undefined;

  constructor(private readonly getContext: () => ActionContext) {}

  attachShortcuts(sink: ShortcutDefaultsSink): void {
    this.sink = sink;
    for (const def of this.definitions.values()) {
      if (def.shortcut) {
        sink.setDefault(def.id, def.shortcut, def.allowShift === true);
      }
    }
  }

  register(definition: ActionDefinition): () => void {
    if (definition.id.length === 0) {
      throw new Error('Action id must not be empty');
    }
    if (this.definitions.has(definition.id)) {
      throw new Error(`Action "${definition.id}" is already registered`);
    }
    this.definitions.set(definition.id, definition);

    if (this.sink && definition.shortcut) {
      this.sink.setDefault(definition.id, definition.shortcut, definition.allowShift === true);
    }

    this.emitChange();

    let removed = false;
    return () => {
      if (removed) return;
      removed = true;
      this.definitions.delete(definition.id);
      if (this.sink && definition.shortcut) {
        this.sink.clearDefault(definition.id);
      }
      this.emitChange();
    };
  }

  get(id: string): ActionDefinition | undefined {
    return this.definitions.get(resolveActionId(id));
  }

  list(): readonly ActionDefinition[] {
    return [...this.definitions.values()];
  }

  isEnabled(id: string): boolean {
    const def = this.get(id);
    if (!def) return false;
    if (def.enabled) {
      try {
        return def.enabled(this.getContext());
      } catch (error) {
        console.error(`[fieldnotes] action enabled() failed for "${def.id}"`, error);
        return false;
      }
    }
    return true;
  }

  run(id: string, invocation?: Partial<ActionInvocation>): boolean {
    const resolved = resolveActionId(id);
    const def = this.definitions.get(resolved);
    if (!def) return false;

    const ctx = this.getContext();
    if (def.enabled) {
      try {
        if (!def.enabled(ctx)) return false;
      } catch (error) {
        console.error(`[fieldnotes] action enabled() failed for "${resolved}"`, error);
        return false;
      }
    }

    const fullInvocation: ActionInvocation = {
      source: invocation?.source ?? 'api',
      shiftKey: invocation?.shiftKey ?? false,
    };

    const result = def.perform(ctx, fullInvocation);
    return result !== false;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[fieldnotes] action listener failed', error);
      }
    }
  }
}
