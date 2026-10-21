import { Component } from '@angular/core';
import { injectLayers } from '@fieldnotes/angular';

@Component({
  selector: 'app-layers-panel',
  template: `<h4>Layers</h4>
    <button (click)="layers.createLayer()">Add layer</button>
    <ul>
      @for (layer of layers.layers(); track layer.id) {
        <li [class.active]="layer.id === layers.activeLayerId()">
          <span (click)="layers.setActiveLayer(layer.id)">{{ layer.name }}</span>
          <button (click)="layers.setVisible(layer.id, !layer.visible)">
            {{ layer.visible ? 'Hide' : 'Show' }}
          </button>
          <button (click)="layers.setLocked(layer.id, !layer.locked)">
            {{ layer.locked ? 'Unlock' : 'Lock' }}
          </button>
        </li>
      }
    </ul>`,
})
export class LayersPanel {
  protected readonly layers = injectLayers();
}
