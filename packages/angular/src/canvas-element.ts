import {
  Component,
  DestroyRef,
  ElementRef,
  NgZone,
  effect,
  inject,
  input,
  untracked,
  viewChild,
} from '@angular/core';
import { attachHostElement } from '@fieldnotes/core';
import type { HostElementHandle } from '@fieldnotes/core';
import { injectViewport } from './inject-viewport';

/**
 * Renders its projected content as an HTML element embedded in the canvas coordinate space.
 * The element is host-owned and transient: it is driven entirely by inputs, never appears
 * in exported state, and never records an undo step. Before a viewport exists the content
 * renders in place. Must be used inside `<fn-canvas>`.
 */
@Component({
  selector: 'fn-canvas-element',
  template: '<div #container style="width: 100%; height: 100%"><ng-content /></div>',
  // Angular moves the host in a keyed `@for`, never the container living in the canvas layer.
  styles: ':host { display: contents; }',
})
export class CanvasElement {
  /** Canvas-space position of the element's top-left corner. */
  readonly position = input.required<{ x: number; y: number }>();
  /** Optional fixed size; omit to let the element size to its content. */
  readonly size = input<{ w: number; h: number }>();

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');

  constructor() {
    const zone = inject(NgZone);
    const host: HTMLElement = inject(ElementRef).nativeElement;
    const viewport = injectViewport();
    let handle: HostElementHandle | undefined;

    effect(() => {
      const vp = viewport();
      untracked(() => {
        if (handle) {
          zone.runOutsideAngular(() => handle?.destroy());
          handle = undefined;
          host.appendChild(this.container().nativeElement);
        }
        if (!vp) return;
        const geometry = { position: this.position(), size: this.size() };
        handle = zone.runOutsideAngular(() =>
          attachHostElement(vp, this.container().nativeElement, geometry),
        );
      });
    });

    effect(() => {
      const geometry = { position: this.position(), size: this.size() };
      // Outside the zone: store.update re-arms mountViewport's change timer, a tracked macrotask.
      zone.runOutsideAngular(() => handle?.setGeometry(geometry));
    });

    inject(DestroyRef).onDestroy(() => zone.runOutsideAngular(() => handle?.destroy()));
  }
}
