# @fieldnotes/svelte

Svelte bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Embed Svelte components directly onto an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/svelte
```

Requires Svelte 5 (`svelte >=5 <6`, runes) and `@fieldnotes/core >=0.96.0`. The package ships
`.svelte` sources, so your bundler compiles them with your Svelte version (Vite with
`@sveltejs/vite-plugin-svelte`, or SvelteKit).

## Quick Start

Full runnable example: `examples/svelte` — `pnpm --filter fieldnotes-svelte-example dev`

The canvas needs a container with a defined size — it fills whatever it's given. With no `tools`
prop and no tools registered in `onready`, it registers the default tool bundle
(`createDefaultTools()`: hand, select, pencil, eraser, arrow, note, text, shape) with `select`
active, so a persisting board is one component:

```svelte
<script lang="ts">
  import { FieldNotesCanvas } from '@fieldnotes/svelte';
  import type { CanvasState } from '@fieldnotes/core';

  const saved = localStorage.getItem('board') ?? undefined;
  const save = (state: CanvasState) => localStorage.setItem('board', JSON.stringify(state));
</script>

<div style="width: 100vw; height: 100vh">
  <FieldNotesCanvas initialData={saved} onchange={save} style="width: 100%; height: 100%" />
</div>
```

`initialData` takes a saved state object or JSON string. `onchange` receives `viewport.exportState()`,
trailing-debounced by `changeDebounceMs` (default 250); a pending call is flushed on unmount, and
the initial load is not reported as a change.

For your own toolbar, pass an explicit tool array and control the active tool with `tool` and
`ontoolchange`. Keep `tools` a module constant or `$state.raw([...])`, never a deep `$state` proxy:

```svelte
<script module lang="ts">
  import { HandTool, SelectTool, PencilTool, EraserTool, NoteTool, ShapeTool } from '@fieldnotes/core';

  const TOOLS = [
    new HandTool(),
    new SelectTool(),
    new PencilTool(),
    new EraserTool(),
    new NoteTool(),
    new ShapeTool(),
  ];
</script>

<script lang="ts">
  import { FieldNotesCanvas } from '@fieldnotes/svelte';
  import Toolbar from './Toolbar.svelte';

  let tool = $state('select');
  const setTool = (name: string) => (tool = name);
</script>

<FieldNotesCanvas tools={TOOLS} {tool} ontoolchange={setTool} style="width: 100vw; height: 100vh">
  <Toolbar {tool} onselect={setTool} />
</FieldNotesCanvas>
```

## Props

Not all props are reactive — the canvas is stateful. Changing a mount-only prop after mount has no effect:

| Prop                            | Reactivity                                                                   |
| ------------------------------- | ---------------------------------------------------------------------------- |
| `options`                       | Mount-only — the canvas is stateful; construct with the right options        |
| `tools`                         | Array: reactive, append-only. Omitted or `'default'`: mount-only (see below) |
| `initialData`                   | Mount-only — loaded once before `onready`                                    |
| `onchange` / `changeDebounceMs` | Reactive — the latest callback is used without resubscribing                 |
| `tool` / `ontoolchange`         | Reactive (controlled)                                                        |
| `defaultTool`                   | Mount-only (uncontrolled initial tool); ignored when `tool` is set           |
| `snapToGrid` (deprecated)       | Reactive compatibility prop; prefer a domain constraint service              |
| `class` / `style` / `children`  | Reactive; `class` and `style` apply to the root `<div>`                      |

`tools` as an array registers each tool once (tools cannot be unregistered). `tools="default"`
registers `createDefaultTools()` at mount, before `onready` (so you can customise them there).
Omitted registers the same bundle after `onready` only when neither `options.tools` is set nor any
tool was registered by then, then activates `tool`, `defaultTool` or `select`; hosts that register
tools in `onready` get no defaults. `tools={[]}` registers nothing.

`tool` is a plain prop, not `$bindable`: a core tool switch (keyboard or API) never reverts or
overwrites it. Update your state from `ontoolchange`, as in the example above.

- **`onready(viewport)`** fires once after the `Viewport` is created, tools are registered and
  `initialData` is loaded. If it throws, the viewport is destroyed and the error is rethrown.
- **`onchange(state)`** — see Quick Start. If the flush on unmount throws, the viewport is still
  destroyed and the error is passed to `reportError`.
- **`ontoolchange(name)`** fires whenever the active tool changes (keyboard, API, or the `tool` prop).

`children` render only once the viewport exists, so components inside can call `useViewport()` and
the helpers during init.

## Embedding Svelte Components

The headline feature — render any Svelte subtree as a canvas element that pans, zooms, and
resizes with the canvas:

```svelte
<FieldNotesCanvas style="width: 100vw; height: 100vh">
  <CanvasElement position={{ x: 100, y: 200 }} size={{ w: 300, h: 200 }}>
    <MyCard />
  </CanvasElement>
  <CanvasElement position={{ x: 500, y: 100 }}>
    <button onclick={clicked}>Interactive button on the canvas</button>
  </CanvasElement>
</FieldNotesCanvas>
```

Embedded components use a **two-mode interaction model**: by default they can be selected, dragged, and resized. **Double-click** to enter interact mode (clicks, inputs, forms work). **Escape** or click outside to exit.

`position` is required; `size` is optional — omit it to let the element size to its content. Both
props are reactive and compared by value: new objects with equal coordinates do not touch the
store. The children keep their component context (`useViewport()` works inside), and keyed
reorders of `CanvasElement`s leave their content on the canvas.

`<CanvasElement>` is **host-owned**: Svelte is the source of truth for its element. Its store mutations carry `origin: 'host'`, so mounting, moving, resizing and unmounting never create undo steps and are never sent to a sync relay (the DOM subtree exists only in this document). The element is **transient**: `exportState()` / `exportJSON()` omit it, so a saved canvas never contains a ghost of a Svelte embed. After a store `clear` (a user's clear-canvas gesture or a remote one) or a `loadState()` the component re-registers itself, so the embed survives. To persist an embed across reloads, use the viewport's `registerHtmlRenderer` with an `htmlType` and serializable `data` instead.

## Minimap

```svelte
<Minimap class="minimap" width={200} height={140} />
```

A collapsible thumbnail navigator. Props: `width` (default `200`), `height` (default `140`),
`defaultCollapsed` (uncontrolled, default `false`), `background`, `viewportStroke`, and `class` /
`style` for positioning, which is yours. While collapsed no controller exists: zero listeners,
zero rendering. Works inside `<FieldNotesCanvas>` or under `setViewportContext(viewport)`.

## Helpers

Each helper has the same name as its `@fieldnotes/react` hook and returns Svelte stores. Call it
during component init (the top level of `<script>`) inside `<FieldNotesCanvas>` or under
`setViewportContext`; a getter `useToolOptions` name is tracked with `$effect.pre`, which only
works there. Stores subscribe to the viewport while they have subscribers, so `$store` in the
template is all you need. Single values are `Readable`s; tuples hold a store and a setter; result
objects are a `Readable` of the state that also carries the action functions (`$history.canUndo`,
`history.undo()`).

| Helper                            | Returns                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useViewport()`                   | The `Viewport`; throws outside a canvas                                                                                                                                            |
| `setViewportContext(viewport)`    | Provides a host-created viewport to descendants (call during init)                                                                                                                 |
| `useCamera()`                     | `Readable<{ x, y, zoom }>`                                                                                                                                                         |
| `useElements(type?)`              | `Readable<CanvasElement[]>`, all or one type; `type` is fixed at init                                                                                                              |
| `useElements(selector, isEqual?)` | `Readable<R>`; updates only when the selected value changes (default: one-level shallow compare)                                                                                   |
| `useSelection()`                  | `Readable<string[]>`, a stable array that changes only with the selection                                                                                                          |
| `useSelectionStyle()`             | `[style, applyStyle]` — `style` is `Readable<ElementStyle \| null>`; `applyStyle(patch)` is one undo step                                                                          |
| `useSelectionStyleDetails()`      | `[details, applyStyle]` — per-field applicability, mixed state and common style                                                                                                    |
| `useSelectionOps()`               | `$ops`: `selectedIds`, `selectedCount`, `canGroup`, `canUngroup`, `canAlign`, `canDistribute`, `isLocked`; `ops.group`, `ungroup`, `toggleLock`, `align`, `distribute`             |
| `useHistory()`                    | `$history`: `canUndo`, `canRedo`; `history.undo`, `redo`                                                                                                                           |
| `useLayers()`                     | `$layers`: `layers`, `activeLayerId`; `layers.createLayer`, `removeLayer`, `renameLayer`, `reorderLayer`, `setVisible`, `setLocked`, `setOpacity`, `setActiveLayer`, `moveElement` |
| `useActiveTool()`                 | `[name, setTool]`; `$name` is `''` with no active tool                                                                                                                             |
| `useToolOptions(name)`            | `[options, setOptions]`; `$options` is `null` for an unknown tool or one without options. A getter `() => name` is tracked                                                         |
| `useElementRects(match)`          | `Readable<readonly ElementRect[]>`; ignores camera motion. `match` is fixed at init                                                                                                |

```svelte
<script lang="ts">
  import { useElements, useHistory } from '@fieldnotes/svelte';
  import type { CanvasElement } from '@fieldnotes/core';

  // A selector updates only when its result changes; plain useElements() updates on every mutation.
  const count = useElements((els: CanvasElement[]) => els.length);
  const notes = useElements('note');
  const history = useHistory();
</script>

<p>{$count} elements, {$notes.length} notes</p>
<button onclick={history.undo} disabled={!$history.canUndo}>Undo</button>
<button onclick={history.redo} disabled={!$history.canRedo}>Redo</button>
```

Selectors returning nested fresh objects need a custom `isEqual`, as in React.

## Escape Hatch

`useViewport()` returns the raw `Viewport` for anything the helpers do not cover. Outside the
canvas, keep the instance `onready` hands you in `$state.raw` (never deep `$state`); it is
destroyed when the canvas unmounts. See the [core README](../core/README.md) for the full
`Viewport` API.

## Server-Side Rendering

Importing the package and server-rendering a page that contains `<FieldNotesCanvas>`
(`svelte/server` `render`, SvelteKit SSR) does not throw: the server renders an empty container
and the canvas mounts on the client. `children`, `onready` and the helpers run only on the client.

## Lifecycle

The viewport is created in `onMount` and destroyed exactly once when the component is destroyed.
Svelte tears down the children first — `CanvasElement`s remove their elements and helper stores
unsubscribe while the viewport is still alive — and then the canvas flushes a pending `onchange`
and destroys the viewport. `@fieldnotes/react` and `@fieldnotes/vue` destroy the viewport before
their children unmount.

## Versioning

`@fieldnotes/core` and `@fieldnotes/svelte` are versioned independently. The package's
`peerDependencies` declare the compatible core range (`>=0.96.0 <1.0.0`). Pre-1.0, minor versions
may contain breaking changes; if a core minor ever breaks the wrapper, a coordinated release raises
the lower bound.

## License

MIT
