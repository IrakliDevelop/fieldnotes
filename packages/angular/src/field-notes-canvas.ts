import {
  Component,
  NgZone,
  afterNextRender,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import type { ElementRef, OnDestroy } from '@angular/core';
import { mountViewport } from '@fieldnotes/core';
import type {
  CanvasState,
  ImportableCanvasState,
  MountedViewport,
  Tool,
  Viewport,
  ViewportOptions,
} from '@fieldnotes/core';
import { FIELDNOTES_VIEWPORT } from './context';

/** Mounts a Field Notes Viewport; projected content renders above it and can inject the viewport. */
@Component({
  selector: 'fn-canvas',
  // The container's z-index makes a stacking context, so projected positioned overlays paint above the canvas.
  template: '<div #container style="position: absolute; inset: 0; z-index: 0"></div><ng-content />',
  styles: ':host { display: block; position: relative; }',
  providers: [
    { provide: FIELDNOTES_VIEWPORT, useFactory: () => inject(FieldNotesCanvas).viewport },
  ],
})
export class FieldNotesCanvas implements OnDestroy {
  /** Constructor-only: changes after mount are ignored (the canvas is stateful). */
  readonly options = input<ViewportOptions>();
  /**
   * `'default'` (mount-only): `createDefaultTools()` registered before `ready`, `select` active.
   * Omitted: the same bundle after `ready`, only if no tools are registered by then.
   * An array is append-only: a new array reference registers its unregistered tools; in-place mutation is not seen.
   */
  readonly tools = input<Tool[] | 'default'>();
  /** Mount-only: a saved state (object or JSON string) loaded before `ready`. */
  readonly initialData = input<ImportableCanvasState | string>();
  /** Debounce window for `stateChange` in milliseconds (default 250). */
  readonly changeDebounceMs = input(250);
  /** Uncontrolled initial tool. Ignored when `tool` is set. */
  readonly defaultTool = input<string>();
  /** Controlled active tool; pair with `[(tool)]`. Keyboard and API changes write it back. */
  readonly tool = model<string | undefined>();
  /** Emits once the viewport exists; a throwing listener does not destroy it. */
  readonly ready = output<Viewport>();
  /** Trailing-debounced with the exported state after any change; flushed on destroy. */
  readonly stateChange = output<CanvasState>();

  private readonly current = signal<Viewport | null>(null);
  /** The mounted viewport; `null` before mount, on the server, and after destroy. */
  readonly viewport = this.current.asReadonly();

  private readonly container = viewChild.required<ElementRef<HTMLDivElement>>('container');
  private mounted: MountedViewport | undefined;

  constructor() {
    const zone = inject(NgZone);
    const { tool, defaultTool, changeDebounceMs } = this;
    afterNextRender(() => {
      const opts = {
        options: untracked(this.options),
        tools: untracked(this.tools),
        initialData: untracked(this.initialData),
        get tool() {
          return untracked(tool);
        },
        get defaultTool() {
          return untracked(defaultTool);
        },
        get changeDebounceMs() {
          return untracked(changeDebounceMs);
        },
        onReady: (vp: Viewport) => {
          this.current.set(vp);
          zone.run(() => this.ready.emit(vp));
        },
        onChange: (state: CanvasState) => zone.run(() => this.stateChange.emit(state)),
        onToolChange: (name: string) => zone.run(() => this.tool.set(name)),
      };
      this.mounted = zone.runOutsideAngular(() =>
        mountViewport(this.container().nativeElement, opts),
      );
    });

    effect(() => {
      const vp = this.viewport();
      const tool = this.tool();
      if (!vp || !this.mounted || tool === undefined) return;
      const { mounted } = this;
      untracked(() => mounted.setTool(tool));
    });

    effect(() => {
      const vp = this.viewport();
      const tools = this.tools();
      if (!vp || !this.mounted || !Array.isArray(tools)) return;
      const { mounted } = this;
      untracked(() => mounted.addTools(tools));
    });
  }

  // Not DestroyRef: outputs are disposed before DestroyRef callbacks, which would drop the final flush.
  ngOnDestroy(): void {
    this.mounted?.destroy();
    this.mounted = undefined;
    this.current.set(null);
  }
}
