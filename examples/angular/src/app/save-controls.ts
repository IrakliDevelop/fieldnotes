import { Component } from '@angular/core';
import { injectViewport } from '@fieldnotes/angular';

@Component({
  selector: 'app-save-controls',
  host: { class: 'toolbar', style: 'top: 64px' },
  template: `<button [disabled]="!viewport()" (click)="save()">Save</button>
    <button [disabled]="!viewport()" (click)="load()">Load</button>`,
})
export class SaveControls {
  protected readonly viewport = injectViewport();

  protected save(): void {
    const viewport = this.viewport();
    if (viewport) localStorage.setItem('fieldnotes-example', viewport.exportJSON());
  }

  protected load(): void {
    const viewport = this.viewport();
    const json = localStorage.getItem('fieldnotes-example');
    if (viewport && json) viewport.loadJSON(json);
  }
}
