import type { ElementStore } from '../elements/element-store';
import type { Command } from '../history/types';
import type { FogManager } from './fog-manager';
import type { FogStateV1, FogTileV1 } from './types';

export class FogRegionCommand implements Command {
  constructor(
    private readonly manager: FogManager,
    private readonly before: readonly FogTileV1[],
    private readonly after: readonly FogTileV1[],
  ) {}

  execute(_store: ElementStore): void {
    this.manager.applyTilesDirect(this.after);
  }

  undo(_store: ElementStore): void {
    this.manager.applyTilesDirect(this.before);
  }
}

export class FogResetCommand implements Command {
  constructor(
    private readonly manager: FogManager,
    private readonly before: FogStateV1 | null,
    private readonly after: FogStateV1 | null,
  ) {}

  execute(_store: ElementStore): void {
    this.manager.loadState(this.after);
  }

  undo(_store: ElementStore): void {
    this.manager.loadState(this.before);
  }
}
