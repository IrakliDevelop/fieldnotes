import { Component, signal } from '@angular/core';
import { CanvasElement, FieldNotesCanvas, Minimap } from '@fieldnotes/angular';
import { createDefaultTools } from '@fieldnotes/core';
import type { Viewport, ViewportOptions } from '@fieldnotes/core';
import { SaveControls } from './save-controls';
import { Sidebar } from './sidebar';
import { StampTool } from './stamp-tool';
import { Toolbar } from './toolbar';

const TOOLS = [...createDefaultTools(), new StampTool()];

@Component({
  selector: 'app-root',
  imports: [FieldNotesCanvas, CanvasElement, Minimap, Toolbar, Sidebar, SaveControls],
  template: `<fn-canvas
    class="canvas"
    [tools]="tools"
    [(tool)]="tool"
    [options]="options"
    (ready)="onReady($event)"
  >
    <header class="header">Active tool: {{ tool() }}</header>
    <app-toolbar />
    <app-save-controls />
    <app-sidebar />
    <fn-canvas-element [position]="{ x: 120, y: 160 }" [size]="{ w: 220, h: 140 }">
      <div class="card">
        <p>An Angular component on the board</p>
        <p class="hint">Double-click the card, then use the button</p>
        <button (click)="clicks.update((n) => n + 1)">Clicked {{ clicks() }} times</button>
      </div>
    </fn-canvas-element>
    <fn-minimap class="minimap" />
  </fn-canvas>`,
})
export class App {
  protected readonly tools = TOOLS;
  protected readonly tool = signal('select');
  protected readonly clicks = signal(0);
  protected readonly options: ViewportOptions = {
    onImageError: ({ src }) => window.alert(`Image failed to load: ${src}`),
  };

  protected onReady(viewport: Viewport): void {
    (window as Window & { __fieldnotesViewport?: Viewport }).__fieldnotesViewport = viewport;
  }
}
