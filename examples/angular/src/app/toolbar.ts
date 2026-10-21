import { Component } from '@angular/core';
import { injectActiveTool } from '@fieldnotes/angular';

const TOOL_LABELS: readonly (readonly [string, string])[] = [
  ['select', 'Select (V)'],
  ['hand', 'Hand (H)'],
  ['pencil', 'Pencil (P)'],
  ['eraser', 'Eraser (E)'],
  ['note', 'Note (N)'],
  ['shape', 'Shape (S)'],
  ['stamp', 'Stamp'],
];

@Component({
  selector: 'app-toolbar',
  host: { class: 'toolbar' },
  template: `@for (entry of labels; track entry[0]) {
    <button [class.active]="active() === entry[0]" (click)="setTool(entry[0])">
      {{ entry[1] }}
    </button>
  }`,
})
export class Toolbar {
  protected readonly labels = TOOL_LABELS;
  private readonly activeTool = injectActiveTool();
  protected readonly active = this.activeTool[0];
  protected readonly setTool = this.activeTool[1];
}
