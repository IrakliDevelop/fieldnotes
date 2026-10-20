# @fieldnotes/vue

Vue bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Embed Vue components directly onto an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/vue
```

Requires Vue 3.5+ (`vue >=3.5 <4`) and `@fieldnotes/core >=0.96.0`.

## Quick Start

Full runnable example: `examples/vue` — `pnpm --filter fieldnotes-vue-example dev`

The canvas needs a container with a defined size — it fills whatever it's given. With no `tools`
prop and no tools registered in `onReady`, it registers the default tool bundle
(`createDefaultTools()`: hand, select, pencil, eraser, arrow, note, text, shape) with `select`
active, so a persisting board is one component:

```vue
<script setup lang="ts">
import { FieldNotesCanvas } from '@fieldnotes/vue';
import type { CanvasState } from '@fieldnotes/core';

const saved = localStorage.getItem('board') ?? undefined;
const save = (state: CanvasState) => localStorage.setItem('board', JSON.stringify(state));
</script>

<template>
  <div style="width: 100vw; height: 100vh">
    <FieldNotesCanvas :initial-data="saved" @change="save" style="width: 100%; height: 100%" />
  </div>
</template>
```

`initialData` takes a saved state object or JSON string. `onChange` receives `viewport.exportState()`,
trailing-debounced by `changeDebounceMs` (default 250); a pending call is flushed on unmount, and
the initial load is not reported as a change.

For your own toolbar, pass an explicit tool array and bind the active tool with `v-model:tool`.
Create tools in a plain `<script>` block (or another module) so they are module constants:

```vue
<script lang="ts">
import {
  HandTool,
  SelectTool,
  PencilTool,
  EraserTool,
  NoteTool,
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
</script>

<script setup lang="ts">
import { ref } from 'vue';
import { FieldNotesCanvas } from '@fieldnotes/vue';
import Toolbar from './Toolbar.vue';

const tool = ref('select');
</script>

<template>
  <FieldNotesCanvas v-model:tool="tool" :tools="TOOLS" style="width: 100vw; height: 100vh">
    <Toolbar :tool="tool" @select="tool = $event" />
  </FieldNotesCanvas>
</template>
```

### Keep the viewport and tools out of deep reactivity

Never wrap the `Viewport` or `Tool` instances in `ref()` or `reactive()`: a deep proxy is a
different object from the one core holds, and every internal read through it becomes tracked. Hold them in a module constant, a `shallowRef`, or mark
them with `markRaw`. The component unwraps the `tools` array and `options` it receives, and every
composable returns shallow refs, so nothing in this package proxies the viewport for you.

## Props and Events

Not all props are reactive — the canvas is stateful. Changing a mount-only prop after mount has no effect:

| Prop                            | Reactivity                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------- |
| `options`                       | Mount-only — the canvas is stateful; construct with the right options                     |
| `tools`                         | Array: reactive, append-only (pushes into a reactive array register too). Else mount-only |
| `initialData`                   | Mount-only — loaded once before `onReady`                                                 |
| `onChange` / `changeDebounceMs` | Reactive — the latest callback is used without resubscribing                              |
| `tool` / `onToolChange`         | Reactive (controlled). `v-model:tool` binds both                                          |
| `defaultTool`                   | Mount-only (uncontrolled initial tool); ignored when `tool` is set                        |
| `snapToGrid` (deprecated)       | Reactive compatibility prop; prefer a domain constraint service                           |
| `class` / `style`               | Fall through to the root `<div>`                                                          |

`tools` as an array registers each tool once (tools cannot be unregistered). `tools="default"`
registers `createDefaultTools()` at mount, before `onReady` (so you can customise them there).
Omitted registers the same bundle after `onReady` only when neither `options.tools` is set nor any
tool was registered by then, then activates `tool`, `defaultTool` or `select`; hosts that register
tools in `onReady` get no defaults. `:tools="[]"` registers nothing.

`onReady`, `onChange` and `onToolChange` are function props, so both `:on-ready="fn"` and
`@ready="fn"` work. `update:tool` is the only emit: it fires on every core tool switch (keyboard,
API, or the prop), which keeps `v-model:tool` in sync. A bare `:tool` never reverts a core switch,
like React's controlled prop.

- **`onReady(viewport)`** fires once after the `Viewport` is created, tools are registered and
  `initialData` is loaded. If it throws, the viewport is destroyed and the error goes through
  Vue's error handling: `app.config.errorHandler` when set; otherwise development rethrows it and
  production logs it.
- **`onChange(state)`** — see Quick Start. If the flush on unmount throws, the viewport is still
  destroyed and the error is passed to `reportError`.
- **`onToolChange(name)`** fires whenever the active tool changes.

The default slot renders only once the viewport exists, so components inside it can call
`useViewport()` and the composables during setup.

## Embedding Vue Components

The headline feature — render any Vue subtree as a canvas element that pans, zooms, and resizes
with the canvas:

```vue
<template>
  <FieldNotesCanvas style="width: 100vw; height: 100vh">
    <CanvasElement :position="{ x: 100, y: 200 }" :size="{ w: 300, h: 200 }">
      <MyCard />
    </CanvasElement>
    <CanvasElement :position="{ x: 500, y: 100 }">
      <button @click="clicked">Interactive button on the canvas</button>
    </CanvasElement>
  </FieldNotesCanvas>
</template>
```

Embedded components use a **two-mode interaction model**: by default they can be selected, dragged, and resized. **Double-click** to enter interact mode (clicks, inputs, forms work). **Escape** or click outside to exit.

`position` is required; `size` is optional — omit it to let the element size to its content. Both
props are reactive and watched by value: new objects with equal coordinates do not touch the store.
The slot is teleported into the canvas, so it keeps your component's context (provide/inject,
`useViewport()`).

`<CanvasElement>` is **host-owned**: Vue is the source of truth for its element. Its store mutations carry `origin: 'host'`, so mounting, moving, resizing and unmounting never create undo steps and are never sent to a sync relay (the DOM subtree exists only in this document). The element is **transient**: `exportState()` / `exportJSON()` omit it, so a saved canvas never contains a ghost of a Vue embed. After a store `clear` (a user's clear-canvas gesture or a remote one) or a `loadState()` the component re-registers itself, so the embed survives. To persist an embed across reloads, use the viewport's `registerHtmlRenderer` with an `htmlType` and serializable `data` instead.

## Minimap

```vue
<Minimap class="minimap" :width="200" :height="140" />
```

A collapsible thumbnail navigator. Props: `width` (default `200`), `height` (default `140`),
`defaultCollapsed` (uncontrolled, default `false`), `background`, `viewportStroke`. Positioning is
yours: every attribute (`class`, `style`, `data-*`, `aria-*`) falls through to the root element —
the wrapper `<div>`, or the expand button while collapsed. A host `aria-label` therefore replaces
the built-in "Expand minimap" label on the collapsed button. While collapsed no controller exists:
zero listeners, zero rendering. Works inside `<FieldNotesCanvas>` or under a host-provided
`ViewportKey`.

## Composables

Each composable has the same name as its `@fieldnotes/react` hook and must be called in `setup`
inside `<FieldNotesCanvas>` (or under `ViewportKey`). Subscriptions are released when the calling
scope is disposed. Single values are `Readonly<ShallowRef>`s; tuples hold a ref and a setter;
result objects hold `ComputedRef` state and plain action functions, so they destructure safely.

| Composable                        | Returns                                                                                                                                                          |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useViewport()`                   | The `Viewport`; throws outside a canvas                                                                                                                          |
| `useCamera()`                     | `ShallowRef<{ x, y, zoom }>`                                                                                                                                     |
| `useElements(type?)`              | `ShallowRef<CanvasElement[]>`, all or one type; a ref `type` is followed                                                                                         |
| `useElements(selector, isEqual?)` | `ShallowRef<R>`; updates only when the selected value changes (default: one-level shallow compare)                                                               |
| `useSelection()`                  | `ShallowRef<string[]>`, a stable array that changes only with the selection                                                                                      |
| `useSelectionStyle()`             | `[style, applyStyle]` — `style` is `ShallowRef<ElementStyle \| null>`; `applyStyle(patch)` is one undo step                                                      |
| `useSelectionStyleDetails()`      | `[details, applyStyle]` — per-field applicability, mixed state and common style                                                                                  |
| `useSelectionOps()`               | `selectedIds`, `selectedCount`, `canGroup`, `canUngroup`, `canAlign`, `canDistribute`, `isLocked`; `group`, `ungroup`, `toggleLock`, `align`, `distribute`       |
| `useHistory()`                    | `canUndo`, `canRedo`; `undo`, `redo`                                                                                                                             |
| `useLayers()`                     | `layers`, `activeLayerId`; `createLayer`, `removeLayer`, `renameLayer`, `reorderLayer`, `setVisible`, `setLocked`, `setOpacity`, `setActiveLayer`, `moveElement` |
| `useActiveTool()`                 | `[name, setTool]`; `name` is `''` with no active tool                                                                                                            |
| `useToolOptions(name)`            | `[options, setOptions]`; `options` is `null` for an unknown tool or one without options. A ref or getter `name` is followed                                      |
| `useElementRects(match)`          | `ShallowRef<readonly ElementRect[]>`; ignores camera motion. A ref `match` is followed                                                                           |

```vue
<script setup lang="ts">
import { useElements, useHistory } from '@fieldnotes/vue';
import type { CanvasElement } from '@fieldnotes/core';

// A selector updates only when its result changes; plain useElements() updates on every mutation.
const count = useElements((els: CanvasElement[]) => els.length);
const notes = useElements('note');
const { canUndo, canRedo, undo, redo } = useHistory();
</script>

<template>
  <p>{{ count }} elements, {{ notes.length }} notes</p>
  <button :disabled="!canUndo" @click="undo">Undo</button>
  <button :disabled="!canRedo" @click="redo">Redo</button>
</template>
```

The selector and `isEqual` are fixed at setup. Selectors returning nested fresh objects need a
custom `isEqual`, as in React.

## Escape Hatch

`useViewport()` returns the raw `Viewport` for anything the composables do not cover. A template
ref on `<FieldNotesCanvas>` exposes the same instance outside the canvas:

```vue
<script setup lang="ts">
import { useTemplateRef } from 'vue';
import { FieldNotesCanvas, type FieldNotesCanvasRef } from '@fieldnotes/vue';

const canvas = useTemplateRef<FieldNotesCanvasRef>('canvas');
</script>

<template>
  <FieldNotesCanvas ref="canvas" style="width: 100vw; height: 100vh" />
  <button @click="canvas?.viewport?.fitToContent()">Fit to content</button>
</template>
```

`viewport` is `null` before mount and after unmount. See the [core README](../core/README.md) for
the full `Viewport` API.

## Server-Side Rendering

Importing the package and server-rendering a page that contains `<FieldNotesCanvas>` does not
throw: the server renders an empty container and the canvas mounts on the client. Nuxt's
`<ClientOnly>` is not required. The default slot, `onReady` and the composables run only on the
client.

## Lifecycle

The viewport is created in `onMounted` and destroyed in `onBeforeUnmount`, exactly once — also
under `<KeepAlive>`, where deactivation keeps it and the final unmount destroys it. As in
`@fieldnotes/react`, the canvas destroys the viewport before its children unmount.

## Versioning

`@fieldnotes/core` and `@fieldnotes/vue` are versioned independently. The package's
`peerDependencies` declare the compatible core range (`>=0.96.0 <1.0.0`). Pre-1.0, minor versions
may contain breaking changes; if a core minor ever breaks the wrapper, a coordinated release raises
the lower bound.

## License

MIT
