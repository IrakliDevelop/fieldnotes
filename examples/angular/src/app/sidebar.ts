import { Component } from '@angular/core';
import { injectElements, injectHistory } from '@fieldnotes/angular';
import type { CanvasElement } from '@fieldnotes/core';
import { LayersPanel } from './layers-panel';
import { SelectionPanel } from './selection-panel';

@Component({
  selector: 'app-sidebar',
  host: { class: 'sidebar' },
  imports: [LayersPanel, SelectionPanel],
  template: `<h3>Board</h3>
    <p>{{ count() }} elements</p>
    <button [disabled]="!history.canUndo()" (click)="history.undo()">Undo</button>
    <button [disabled]="!history.canRedo()" (click)="history.redo()">Redo</button>
    <app-selection-panel />
    <app-layers-panel />
    <h4>Notes</h4>
    <ul>
      @for (n of notes(); track n.id) {
        <li>{{ preview(n) }}</li>
      }
    </ul>`,
})
export class Sidebar {
  protected readonly count = injectElements((els: CanvasElement[]) => els.length);
  protected readonly notes = injectElements('note');
  protected readonly history = injectHistory();

  protected preview(el: CanvasElement): string {
    return el.type === 'note' && el.text ? el.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)';
  }
}
