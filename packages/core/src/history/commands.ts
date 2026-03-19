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
    store.update(this.id, { ...this.current });
  }

  undo(store: ElementStore): void {
    store.update(this.id, { ...this.previous });
  }
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
