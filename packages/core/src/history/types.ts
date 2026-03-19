import type { ElementStore } from '../elements/element-store';

export interface Command {
  execute(store: ElementStore): void;
  undo(store: ElementStore): void;
}
