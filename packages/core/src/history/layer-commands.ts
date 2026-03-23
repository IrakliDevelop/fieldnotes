import type { ElementStore } from '../elements/element-store';
import type { Command } from './types';
import type { LayerManager } from '../layers/layer-manager';
import type { Layer } from '../layers/types';

export class CreateLayerCommand implements Command {
  constructor(
    private readonly manager: LayerManager,
    private readonly layer: Layer,
  ) {}

  execute(_store: ElementStore): void {
    this.manager.addLayerDirect(this.layer);
  }

  undo(_store: ElementStore): void {
    this.manager.removeLayerDirect(this.layer.id);
  }
}

export class RemoveLayerCommand implements Command {
  constructor(
    private readonly manager: LayerManager,
    private readonly layer: Layer,
  ) {}

  execute(_store: ElementStore): void {
    this.manager.removeLayerDirect(this.layer.id);
  }

  undo(_store: ElementStore): void {
    this.manager.addLayerDirect(this.layer);
  }
}

export class UpdateLayerCommand implements Command {
  constructor(
    private readonly manager: LayerManager,
    private readonly layerId: string,
    private readonly previous: Layer,
    private readonly current: Layer,
  ) {}

  execute(_store: ElementStore): void {
    this.manager.updateLayerDirect(this.layerId, { ...this.current });
  }

  undo(_store: ElementStore): void {
    this.manager.updateLayerDirect(this.layerId, { ...this.previous });
  }
}
