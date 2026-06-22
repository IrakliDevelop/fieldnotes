import type { CanvasElement } from '../elements/types';
import type { ElementStore } from '../elements/element-store';
import type { Command } from './types';

export class AddElementCommand implements Command {
  private readonly element: CanvasElement;

  constructor(element: CanvasElement) {
    this.element = { ...element };
  }

  execute(store: ElementStore): void {
    store.add(this.element);
  }

  undo(store: ElementStore): void {
    store.remove(this.element.id);
  }
}

export class RemoveElementCommand implements Command {
  private readonly element: CanvasElement;

  constructor(element: CanvasElement) {
    this.element = { ...element };
  }

  execute(store: ElementStore): void {
    store.remove(this.element.id);
  }

  undo(store: ElementStore): void {
    store.add(this.element);
  }
}

export class UpdateElementCommand implements Command {
  constructor(
    private readonly id: string,
    private readonly previous: CanvasElement,
    private readonly current: CanvasElement,
  ) {}

  execute(store: ElementStore): void {
    store.update(this.id, diffPatch(this.previous, this.current));
  }

  undo(store: ElementStore): void {
    store.update(this.id, diffPatch(this.current, this.previous));
  }
}

// Patch turning `from` into `to`, explicitly setting keys that exist on `from`
// but not `to` to `undefined` so a merge-based `update` clears them.
function diffPatch(from: CanvasElement, to: CanvasElement): Partial<CanvasElement> {
  const patch: Record<string, unknown> = { ...to };
  for (const key of Object.keys(from)) {
    if (!(key in to)) patch[key] = undefined;
  }
  return patch as Partial<CanvasElement>;
}

export class BatchCommand implements Command {
  readonly commands: readonly Command[];

  constructor(commands: Command[]) {
    this.commands = [...commands];
  }

  execute(store: ElementStore): void {
    for (const cmd of this.commands) {
      cmd.execute(store);
    }
  }

  undo(store: ElementStore): void {
    for (let i = this.commands.length - 1; i >= 0; i--) {
      this.commands[i]?.undo(store);
    }
  }
}
