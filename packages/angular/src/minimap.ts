import { Component, NgZone, effect, inject, input, signal, viewChild } from '@angular/core';
import type { ElementRef, OnInit } from '@angular/core';
import { LIGHT_THEME_TOKENS, MinimapController } from '@fieldnotes/core';
import type { ThemeTokens } from '@fieldnotes/core';
import { injectViewport } from './inject-viewport';

/**
 * Collapsible thumbnail overview navigator. Renders inside `<fn-canvas>` (or under a
 * host-provided `FIELDNOTES_VIEWPORT`). Positioning is host-owned: place and style
 * `<fn-minimap>` via `class`/`style`. While collapsed, no controller exists: zero
 * listeners, zero rendering.
 */
@Component({
  selector: 'fn-minimap',
  template: `@if (collapsed()) {
      <button
        type="button"
        aria-label="Expand minimap"
        style="min-width: 44px; min-height: 44px; border: 1px solid rgba(0,0,0,0.15); border-radius: 8px; background: rgba(255,255,255,0.85); cursor: pointer; font: 18px/1 system-ui, sans-serif"
        [style.background]="tokens().minimapBackground"
        [style.border]="'1px solid ' + tokens().minimapBorder"
        [style.color]="tokens().chromeText || null"
        (click)="collapsed.set(false)"
      >
        ▣
      </button>
    } @else {
      <div style="position: relative">
        <canvas
          #canvas
          style="display: block"
          [style.width.px]="width()"
          [style.height.px]="height()"
        ></canvas>
        <button
          type="button"
          aria-label="Collapse minimap"
          style="position: absolute; top: 2px; right: 2px; width: 24px; height: 24px; padding: 0; border: none; border-radius: 4px; background: rgba(0,0,0,0.35); color: #fff; font: 14px/1 system-ui, sans-serif; cursor: pointer"
          (click)="collapsed.set(true)"
        >
          –
        </button>
      </div>
    }`,
  styles: ':host { display: block; }',
})
export class Minimap implements OnInit {
  /** Thumbnail width in CSS pixels. Default `200`. */
  readonly width = input(200);
  /** Thumbnail height in CSS pixels. Default `140`. */
  readonly height = input(140);
  /** Start collapsed (icon button only). Uncontrolled. Default `false`. */
  readonly defaultCollapsed = input(false);
  /** Backdrop fill behind the thumbnail. */
  readonly background = input<string>();
  /** Viewport rectangle stroke color. */
  readonly viewportStroke = input<string>();

  protected readonly collapsed = signal(false);
  protected readonly tokens = signal<ThemeTokens>(
    injectViewport()()?.getTheme().tokens ?? LIGHT_THEME_TOKENS,
  );
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  constructor() {
    const zone = inject(NgZone);
    const viewport = injectViewport();

    effect((onCleanup) => {
      const collapsed = this.collapsed();
      const canvas = this.canvas()?.nativeElement;
      const vp = viewport();
      const options = {
        width: this.width(),
        height: this.height(),
        background: this.background(),
        viewportStroke: this.viewportStroke(),
      };
      if (collapsed || !canvas || !vp) return;
      const controller = zone.runOutsideAngular(() => new MinimapController(vp, canvas, options));
      onCleanup(() => controller.dispose());
    });

    effect((onCleanup) => {
      const vp = viewport();
      if (!vp) return;
      this.tokens.set(vp.getTheme().tokens);
      onCleanup(vp.onThemeChange((theme) => this.tokens.set(theme.tokens)));
    });
  }

  ngOnInit(): void {
    this.collapsed.set(this.defaultCollapsed());
  }
}
