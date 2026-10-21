import { Component } from '@angular/core';
import { injectSelectionOps } from '@fieldnotes/angular';

@Component({
  selector: 'app-selection-panel',
  template: `<h4>Selection ({{ ops.selectedCount() }})</h4>
    <button [disabled]="!ops.canGroup()" (click)="ops.group()">Group</button>
    <button [disabled]="!ops.canUngroup()" (click)="ops.ungroup()">Ungroup</button>
    <button [disabled]="ops.selectedCount() === 0" (click)="ops.toggleLock()">
      {{ ops.isLocked() ? 'Unlock' : 'Lock' }}
    </button>
    <br />
    <button [disabled]="!ops.canAlign()" (click)="ops.align('left')">Align left</button>
    <button [disabled]="!ops.canDistribute()" (click)="ops.distribute('horizontal')">
      Distribute
    </button>
    <button [disabled]="ops.selectedCount() === 0" (click)="ops.rotateCW()">Rotate</button>`,
})
export class SelectionPanel {
  protected readonly ops = injectSelectionOps();
}
