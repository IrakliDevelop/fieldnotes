# @fieldnotes/angular

Angular bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Standalone components and signal helpers that put Angular components on an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/angular
```

Requires Angular 20 to 22 (`@angular/core >=20.0.0 <23.0.0`) and `@fieldnotes/core >=0.98.0`.
Every export is standalone; there is no NgModule.

## Quick Start

Full runnable example: `examples/angular` (`pnpm --filter fieldnotes-angular-example dev`)

`<fn-canvas>` fills its own box, so give it a size. With no `tools` input and no tools registered
in the `ready` handler, it registers the default tool bundle (`createDefaultTools()`: hand, select,
pencil, eraser, arrow, note, text, shape) with `select` active, so a persisting board is one
element:

```ts
import { Component } from '@angular/core';
import { FieldNotesCanvas } from '@fieldnotes/angular';
import type { CanvasState } from '@fieldnotes/core';

@Component({
  selector: 'app-board',
  imports: [FieldNotesCanvas],
  template: `<fn-canvas
    [initialData]="saved"
    (stateChange)="save($event)"
    style="width: 100vw; height: 100vh"
  />`,
})
export class Board {
  protected readonly saved = localStorage.getItem('board') ?? undefined;

  protected save(state: CanvasState): void {
    localStorage.setItem('board', JSON.stringify(state));
  }
}
```

`initialData` takes a saved state object or JSON string. `stateChange` emits
`viewport.exportState()`, trailing-debounced by `changeDebounceMs` (default 250). A pending change
is emitted when the canvas is destroyed, and loading `initialData` emits nothing.

For your own toolbar, pass a tool array and bind the active tool with `[(tool)]`. Content you put
inside `<fn-canvas>` is projected above the board and can call the helpers:

```ts
import { Component, signal } from '@angular/core';
import { FieldNotesCanvas, injectActiveTool } from '@fieldnotes/angular';
import type { CanvasState } from '@fieldnotes/core';
import {
  EraserTool,
  HandTool,
  NoteTool,
  PencilTool,
  SelectTool,
  ShapeTool,
} from '@fieldnotes/core';

const TOOLS = [
  new HandTool(),
  new SelectTool(),
  new PencilTool(),
  new EraserTool(),
  new NoteTool(),
  new ShapeTool(),
];

@Component({
  selector: 'app-toolbar',
  template: `@for (name of names; track name) {
    <button [attr.aria-pressed]="active() === name" (click)="setTool(name)">{{ name }}</button>
  }`,
  styles: ':host { position: absolute; top: 8px; left: 8px; }',
})
export class Toolbar {
  protected readonly names = TOOLS.map((t) => t.name);
  private readonly activeTool = injectActiveTool();
  protected readonly active = this.activeTool[0];
  protected readonly setTool = this.activeTool[1];
}

@Component({
  selector: 'app-board',
  imports: [FieldNotesCanvas, Toolbar],
  template: `<fn-canvas
    [tools]="tools"
    [(tool)]="tool"
    (stateChange)="save($event)"
    style="width: 100vw; height: 100vh"
  >
    <app-toolbar />
  </fn-canvas>`,
})
export class Board {
  protected readonly tools = TOOLS;
  protected readonly tool = signal('select');

  protected save(state: CanvasState): void {
    localStorage.setItem('board', JSON.stringify(state));
  }
}
```

Keep tool instances in a module constant or a field that is set once: core holds them by
reference, and a new array registers whatever tools in it are new.

## Inputs and Outputs

The canvas is stateful, so some inputs are read only at mount. Changing a mount-only input
afterwards has no effect:

| Member             | Kind                        | Reactivity                                                                                     |
| ------------------ | --------------------------- | ---------------------------------------------------------------------------------------------- |
| `options`          | input `ViewportOptions`     | Mount-only. The canvas is stateful; construct it with the right options                        |
| `tools`            | input `Tool[] \| 'default'` | An array is append-only: a new array reference registers its new tools. `'default'` mount-only |
| `initialData`      | input                       | Mount-only. Loaded once before `ready`                                                         |
| `changeDebounceMs` | input, default `250`        | Read each time a change is scheduled                                                           |
| `tool`             | model `string`              | Controlled; `[(tool)]` binds both ways                                                         |
| `defaultTool`      | input `string`              | Mount-only (uncontrolled initial tool); ignored when `tool` is set                             |
| `ready`            | output `Viewport`           | Once, after the viewport exists, tools are registered and `initialData` is loaded              |
| `stateChange`      | output `CanvasState`        | Trailing-debounced exported state; a pending one is emitted on destroy                         |
| `toolChange`       | output `string`             | The `tool` model's change event; see below                                                     |
| `viewport`         | `Signal<Viewport \| null>`  | Public field; `null` before mount, on the server and after destroy                             |

`tools` as an array registers each tool once (tools cannot be unregistered). Only a new array
reference is seen: pushing into the array you passed registers nothing, so pass
`[...tools, stamp]`. `tools="default"` registers `createDefaultTools()` at mount, before `ready`
(so you can customise them there). Omitted registers the same bundle after `ready` only when
neither `options.tools` is set nor any tool was registered by then, then activates `tool`,
`defaultTool` or `select`; hosts that register tools in `ready` get no defaults. `[tools]="[]"`
registers nothing.

- **`ready`** emits once the viewport is created. A listener that throws is reported to Angular's
  `ErrorHandler` and the viewport stays mounted.
- **`stateChange`**: see Quick Start. It is not called `change` because a `(change)` binding on an
  element also receives the native `change` event, which bubbles up from any input projected
  inside the canvas.
- **`tool` and `toolChange`**: setting `tool` activates that tool. A switch made inside the canvas
  (a keyboard shortcut, an API call, a tool that hands over) writes the model and emits
  `toolChange`, which keeps `[(tool)]` in sync. A value that came in through the `tool` binding
  emits nothing; that is how Angular's `model` works. A one-way `[tool]` binding never reverts a
  switch made inside the canvas.
- **Mount errors**: if mounting throws (for example on invalid `initialData`), the error goes to
  Angular's `ErrorHandler`, `viewport` stays `null` and the helpers keep their neutral values.

## Content Before Mount

Projected content renders at once, before the viewport exists, and on the server. The helpers
return signals that hold neutral values until `<fn-canvas>` mounts, then follow the board:

| Helper                          | Value before mount                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| `injectCamera()`                | `{ x: 0, y: 0, zoom: 1 }`                                                            |
| `injectElements(...)`           | `[]`, or the selector applied to `[]`                                                |
| `injectSelection()`             | `[]`                                                                                 |
| `injectHistory()`               | `canUndo` and `canRedo` `false`                                                      |
| `injectLayers()`                | `layers` `[]`, `activeLayerId` `''`                                                  |
| `injectActiveTool()`            | `''`                                                                                 |
| `injectToolOptions(name)`       | `null`                                                                               |
| `injectSelectionStyle()`        | `null`                                                                               |
| `injectSelectionStyleDetails()` | `null`                                                                               |
| `injectSelectionOps()`          | `selectedIds` `[]`, `selectedCount` `0`, the `can*` flags `false`, `isLocked` `null` |
| `injectElementRects(match)`     | `[]`                                                                                 |

These are not what a mounted board reports (a mounted board has one layer and `select` active).
Actions called before mount (`undo`, `createLayer`, `group`, the setters) throw
`[fieldnotes] <name> called before <fn-canvas> mounted`. Wait for `ready`, or check
`injectViewport()()` first.

## Embedding Angular Components

Render any Angular content as a canvas element that pans, zooms, and resizes with the canvas:

```ts
import { Component, signal } from '@angular/core';
import { CanvasElement, FieldNotesCanvas } from '@fieldnotes/angular';

@Component({
  selector: 'app-board',
  imports: [FieldNotesCanvas, CanvasElement],
  template: `<fn-canvas style="width: 100vw; height: 100vh">
    <fn-canvas-element [position]="{ x: 100, y: 200 }" [size]="{ w: 300, h: 200 }">
      <p>A card on the board</p>
    </fn-canvas-element>
    <fn-canvas-element [position]="{ x: 500, y: 100 }">
      <button (click)="clicks.set(clicks() + 1)">Clicked {{ clicks() }} times</button>
    </fn-canvas-element>
  </fn-canvas>`,
})
export class Board {
  protected readonly clicks = signal(0);
}
```

Embedded components use a **two-mode interaction model**: by default they can be selected, dragged, and resized. **Double-click** to enter interact mode (clicks, inputs, forms work). **Escape** or click outside to exit.

`position` is required; `size` is optional. Omit it to let the element size to its content. Both
inputs are reactive, and new objects with equal coordinates do not touch the store. The content
stays in your component's injector, so it can call `injectViewport()` and the helpers. Until a
viewport exists the content renders in place.

`<fn-canvas-element>` is **host-owned**: Angular is the source of truth for its element. Its store mutations carry `origin: 'host'`, so mounting, moving, resizing and destroying never create undo steps and are never sent to a sync relay (the DOM subtree exists only in this document). The element is **transient**: `exportState()` / `exportJSON()` omit it, so a saved canvas never contains a ghost of an Angular embed. After a store `clear` (a user's clear-canvas gesture or a remote one) or a `loadState()` the component re-registers itself, so the embed survives. To persist an embed across reloads, use the viewport's `registerHtmlRenderer` with an `htmlType` and serializable `data` instead.

## Minimap

```html
<fn-minimap class="minimap" [width]="200" [height]="140" />
```

A collapsible thumbnail navigator. Inputs: `width` (default `200`), `height` (default `140`),
`defaultCollapsed` (uncontrolled, default `false`), `background`, `viewportStroke`. Positioning is
yours: style the `<fn-minimap>` host with `class` or `style`. While collapsed no controller exists:
zero listeners, zero rendering. Works inside `<fn-canvas>` or under a host-provided
`FIELDNOTES_VIEWPORT`.

## Helpers

Each helper is named after its `@fieldnotes/react` hook with `inject` for `use`, and must be
called in an injection context (a constructor or field initializer) inside `<fn-canvas>` or under
a host-provided `FIELDNOTES_VIEWPORT`. Subscriptions are released when the calling component is
destroyed. Single values are `Signal`s; tuples hold a signal and a setter; result objects hold
signals and plain action functions, so they destructure safely.

| Helper                               | Returns                                                                                                                                                                             |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `injectViewport()`                   | `Signal<Viewport \| null>`; throws outside a canvas                                                                                                                                 |
| `injectCamera()`                     | `Signal<CameraState>` (`{ x, y, zoom }`)                                                                                                                                            |
| `injectElements(type?)`              | `Signal<CanvasElement[]>`, all or one type; a `Signal` type is followed                                                                                                             |
| `injectElements(selector, isEqual?)` | `Signal<R>`; updates only when the selected value changes (default: one-level shallow compare)                                                                                      |
| `injectSelection()`                  | `Signal<string[]>`, a stable array that changes only with the selection                                                                                                             |
| `injectSelectionStyle()`             | `[style, applyStyle]`: `style` is `Signal<ElementStyle \| null>`; `applyStyle(patch)` is one undo step                                                                              |
| `injectSelectionStyleDetails()`      | `[details, applyStyle]`: per-field applicability, mixed state and common style                                                                                                      |
| `injectSelectionOps()`               | `selectedIds`, `selectedCount`, `canGroup`, `canUngroup`, `canAlign`, `canDistribute`, `isLocked`; `group`, `ungroup`, `toggleLock`, `align`, `distribute`, `rotateCW`, `rotateCCW` |
| `injectHistory()`                    | `canUndo`, `canRedo`; `undo`, `redo`                                                                                                                                                |
| `injectLayers()`                     | `layers`, `activeLayerId`; `createLayer`, `removeLayer`, `renameLayer`, `reorderLayer`, `setVisible`, `setLocked`, `setOpacity`, `setActiveLayer`, `moveElement`                    |
| `injectActiveTool()`                 | `[name, setTool]`; `name` is `''` with no active tool                                                                                                                               |
| `injectToolOptions(name)`            | `[options, setOptions]`; `options` is `null` for an unknown tool or one without options. A `Signal` name is followed                                                                |
| `injectElementRects(match)`          | `Signal<readonly ElementRect[]>`; ignores camera motion. A `Signal` match is followed                                                                                               |

```ts
import { Component } from '@angular/core';
import { injectElements, injectHistory } from '@fieldnotes/angular';
import type { CanvasElement } from '@fieldnotes/core';

@Component({
  selector: 'app-status',
  template: `<p>{{ count() }} elements, {{ notes().length }} notes</p>
    <button [disabled]="!history.canUndo()" (click)="history.undo()">Undo</button>
    <button [disabled]="!history.canRedo()" (click)="history.redo()">Redo</button>`,
})
export class Status {
  // A selector updates only when its result changes; plain injectElements() updates on every mutation.
  protected readonly count = injectElements((els: CanvasElement[]) => els.length);
  protected readonly notes = injectElements('note');
  protected readonly history = injectHistory();
}
```

A plain argument is fixed at injection; pass a `Signal` to `injectElements(type)`,
`injectToolOptions` or `injectElementRects` to follow it. Selectors returning nested fresh objects
need a custom `isEqual`, as in React.

## Escape Hatch

`injectViewport()` returns the viewport signal for anything the helpers do not cover. Outside the
canvas, query the component and read its `viewport` signal:

```ts
import { Component, viewChild } from '@angular/core';
import { FieldNotesCanvas } from '@fieldnotes/angular';

@Component({
  selector: 'app-board',
  imports: [FieldNotesCanvas],
  template: `<fn-canvas style="width: 100vw; height: 100vh" />
    <button (click)="canvas()?.viewport()?.fitToContent()">Fit to content</button>`,
})
export class Board {
  protected readonly canvas = viewChild(FieldNotesCanvas);
}
```

`viewport()` is `null` before mount and after destroy. See the [core README](../core/README.md)
for the full `Viewport` API.

## Change Detection

Zoneless apps (the default since Angular 21) and zone.js apps are both supported and tested. The
viewport and every core object the package creates run outside the Angular zone, so pointer
moves, animation frames and debounce timers on the board do not trigger change detection in a
zone.js app. `ready`, `stateChange` and `toolChange` are emitted inside the zone, so a handler that
updates your template renders without a manual `detectChanges`.

## Server-Side Rendering

Importing the package and server-rendering a page that contains `<fn-canvas>` does not throw. The
canvas mounts in `afterNextRender`, which runs only in the browser, so the server renders an empty
container and touches no DOM API. Projected content renders on the server with the helpers'
neutral values.

## Lifecycle

The viewport is created after the first render and destroyed in `<fn-canvas>`'s `ngOnDestroy`,
exactly once, after the pending `stateChange` is emitted. As in `@fieldnotes/vue`, the canvas
destroys the viewport before its children clean up; `<fn-canvas-element>`, `<fn-minimap>` and the
helpers tolerate that order.

## Versioning

`@fieldnotes/core` and `@fieldnotes/angular` are versioned independently. The package's
`peerDependencies` declare the compatible ranges (`@angular/core >=20.0.0 <23.0.0`,
`@fieldnotes/core >=0.98.0 <1.0.0`). Each new Angular major needs a peer-range check before the
upper bound moves. Pre-1.0, minor versions may contain breaking changes; if a core minor ever breaks
the wrapper, a coordinated release raises the lower bound.

## License

MIT
