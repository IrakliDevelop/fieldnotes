# @fieldnotes/react

React bindings for the [Field Notes](https://github.com/IrakliDevelop/fieldnotes) infinite canvas SDK. Embed React components directly onto an infinite, pannable, zoomable canvas.

## Install

```bash
npm install @fieldnotes/core @fieldnotes/react
```

Requires React 18+ and `@fieldnotes/core` 0.105.0 or newer. Using Vue, Svelte or Angular? See [`@fieldnotes/vue`](../vue), [`@fieldnotes/svelte`](../svelte) and [`@fieldnotes/angular`](../angular).

## Quick Start

Full runnable example: `examples/react-app` — `pnpm --filter fieldnotes-react-example dev`

The canvas needs a container with a defined size — it fills whatever it's given. With no `tools`
prop and no tools registered in `onReady`, it registers the default tool bundle
(`createDefaultTools()`: hand, select, pencil, eraser, arrow, note, text, shape) with `select`
active, so a persisting board is one line:

```tsx
import { FieldNotesCanvas } from '@fieldnotes/react';
import type { CanvasState } from '@fieldnotes/core';

const saved = localStorage.getItem('board') ?? undefined;
const save = (state: CanvasState) => localStorage.setItem('board', JSON.stringify(state));

export function App() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <FieldNotesCanvas
        initialData={saved}
        onChange={save}
        style={{ width: '100%', height: '100%' }}
      />
    </div>
  );
}
```

`initialData` takes a saved state object or JSON string. `onChange` receives `viewport.exportState()`,
trailing-debounced by `changeDebounceMs` (default 250); a pending call is flushed on unmount, and
the initial load is not reported as a change.

For your own toolbar, pass an explicit tool array and control the active tool:

```tsx
import { useState } from 'react';
import { FieldNotesCanvas } from '@fieldnotes/react';
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

export function App() {
  const [tool, setTool] = useState('select');

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <FieldNotesCanvas
        tools={TOOLS}
        tool={tool}
        onToolChange={setTool}
        style={{ width: '100%', height: '100%' }}
      >
        <Toolbar tool={tool} onSelect={setTool} />
      </FieldNotesCanvas>
    </div>
  );
}

function Toolbar({ tool, onSelect }: { tool: string; onSelect: (name: string) => void }) {
  const TOOL_LABELS: readonly (readonly [string, string])[] = [
    ['select', 'Select'],
    ['hand', 'Hand'],
    ['pencil', 'Pencil'],
    ['eraser', 'Eraser'],
    ['note', 'Note'],
    ['shape', 'Shape'],
  ];

  return (
    <div className="toolbar">
      {TOOL_LABELS.map(([name, label]) => (
        <button key={name} className={tool === name ? 'active' : ''} onClick={() => onSelect(name)}>
          {label}
        </button>
      ))}
    </div>
  );
}
```

## Prop Reactivity

Not all props are reactive — the canvas is stateful. Changing a mount-only prop after mount has no effect:

| Prop                               | Reactivity                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `options`                          | Mount-only; construct the stateful canvas with the right options.                                                                                                                                                                                                                                                              |
| `tools`                            | An array reconciles by name: new names register and names that leave unregister. A new instance under a registered name is ignored until that name leaves the array or the canvas remounts. Tools registered in `onReady` or `options.tools` stay.                                                                             |
| `initialData`                      | Mount-only; loaded once before `onReady`.                                                                                                                                                                                                                                                                                      |
| `autoSave`                         | Mount-only. After `onReady`, a board saved under `key` replaces `initialData` and anything `onReady` added; edits then save 1000ms after the last change. `ref.autoSave?.clear()` deletes the saved board.                                                                                                                     |
| `onChange` / `changeDebounceMs`    | Reactive; the latest callback is used without resubscribing.                                                                                                                                                                                                                                                                   |
| `tool` / `onToolChange`            | Controlled; `onToolChange` also receives `''` when `tools` removes the active tool and no fallback exists.                                                                                                                                                                                                                     |
| `defaultTool`                      | Mount-only uncontrolled initial tool.                                                                                                                                                                                                                                                                                          |
| `shortcuts`                        | Reactive; hoist the object. Removed actions return to defaults.                                                                                                                                                                                                                                                                |
| `activation` / `onElementActivate` | Reactive; hoist `activation`. `{ gesture: 'single' }` or `'double'` makes a click or double-click on a board element call `onElementActivate` with the element and world point. `null` turns it off; omitting the prop leaves it unchanged. Canvas-drawn elements only; `HostElement` content uses double-click interact mode. |
| `snapToGrid` (deprecated)          | Reactive compatibility prop; prefer a domain constraint service.                                                                                                                                                                                                                                                               |
| Other `div` props                  | Spread on the root div; DOM `onChange` is not available.                                                                                                                                                                                                                                                                       |

With a `tool` prop, the prop decides the active tool: a switch from the keyboard or the API is reverted unless `onToolChange` updates `tool` in the same call, as `onToolChange={setTool}` does. An update deferred to a timer or a promise lands after the revert. A host that never updates `tool` should pass `defaultTool` instead.

After `tools` removes a tool, `useToolOptions` for that name keeps returning its last options until the component re-renders, then returns `null`.

`tools="default"` registers `createDefaultTools()` at mount, before `onReady`. Without a `tools` prop the canvas registers the same bundle after `onReady`, only when `options.tools` is unset and `onReady` registered no tool, then activates `tool`, `defaultTool` or `select`. `tools={[]}` registers nothing. Hoist an array out of render.

Runtime changes beyond these go through the viewport — access it via `useViewport()` or the ref. Grid snapping is domain behavior; VTT consumers should configure `GridController` and its constraint service rather than adopting the deprecated React prop. The background pattern is constructor-only (`options.background`).

## Embedding React Components

The headline feature — render any React subtree as a canvas element that pans, zooms, and resizes with the canvas:

```tsx
import { FieldNotesCanvas, HostElement } from '@fieldnotes/react';
import { SelectTool } from '@fieldnotes/core';

function App() {
  return (
    <FieldNotesCanvas
      tools={[new SelectTool()]}
      defaultTool="select"
      style={{ width: '100vw', height: '100vh' }}
    >
      <HostElement position={{ x: 100, y: 200 }} size={{ w: 300, h: 200 }}>
        <MyCard />
      </HostElement>

      <HostElement position={{ x: 500, y: 100 }}>
        <button onClick={() => console.log('clicked!')}>Interactive button on the canvas</button>
      </HostElement>
    </FieldNotesCanvas>
  );
}
```

Embedded components use a **two-mode interaction model**: by default they can be selected, dragged, and resized. **Double-click** to enter interact mode (clicks, inputs, forms work). **Escape** or click outside to exit.

`position` is required; `size` is optional. Omit it to let the element size to its content. Both props are reactive: updating them moves or resizes the element on the canvas.

`<HostElement>` is **host-owned**: React is the source of truth for its element. Its store mutations carry `origin: 'host'`, so mounting, moving, resizing and unmounting never create undo steps and are never sent to a sync relay (the DOM subtree exists only in this document). The element is **transient**: `exportState()` / `exportJSON()` omit it, so a saved canvas never contains a ghost of a React embed. After a store `clear` (a user's clear-canvas gesture or a remote one) or a `loadState()` the component re-registers itself, so the embed survives. To persist an embed across reloads, use the viewport's `registerHtmlRenderer` with an `htmlType` and serializable `data` instead.

`CanvasElement` and `CanvasElementProps` are deprecated aliases of `HostElement` and `HostElementProps`; `@fieldnotes/react` 0.16.0 removes them. The `CanvasElement` type from `@fieldnotes/core` (the union of board elements) is unrelated and stays.

## Undo / Redo

`useHistory` returns reactive undo/redo state and action callbacks:

```tsx
import { useHistory } from '@fieldnotes/react';

function UndoRedo() {
  const { canUndo, canRedo, undo, redo } = useHistory();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>
        Undo
      </button>
      <button onClick={redo} disabled={!canRedo}>
        Redo
      </button>
    </div>
  );
}
```

## Why Is My Sidebar Re-rendering 60×/s?

`useElements()` with no arguments re-renders on every store mutation. For derived values, pass a selector — the hook only re-renders when the selected value changes:

```tsx
import { useCallback } from 'react';
import { useElements } from '@fieldnotes/react';
import type { CanvasElement } from '@fieldnotes/core';

export function Sidebar() {
  // Stable selector: useCallback with [] dependency or module-scope function
  const count = useElements(useCallback((els: CanvasElement[]) => els.length, []));
  const notes = useElements('note');

  return (
    <div className="sidebar">
      <p>{count} elements</p>
      <ul>
        {notes.map((n) => (
          <li key={n.id}>{n.text ? n.text.replace(/<[^>]+>/g, '').slice(0, 30) : '(empty)'}</li>
        ))}
      </ul>
    </div>
  );
}
```

Alternatively, hoist expensive rendering into a memoized child and pass elements as props — React's `memo` then does the comparison.

**Default comparator is one-level shallow**: arrays are compared by index, plain objects by key, primitives by `Object.is`. Selectors returning nested fresh objects (e.g. `els => els.map(e => ({ ...e.position }))`) still cause re-renders with the default comparator — pass a custom `isEqual` as the second argument:

```tsx
const positions = useElements(
  useCallback((els: CanvasElement[]) => els.map((e) => e.position), []),
  (a, b) => a.length === b.length && a.every((p, i) => p.x === b[i]?.x && p.y === b[i]?.y),
);
```

## Selection & Styling

### `useSelection`

Returns the current selection as a reactive, referentially-stable `string[]` of element IDs. Re-renders only when the selection changes.

```tsx
import { useSelection } from '@fieldnotes/react';

function SelectionBadge() {
  const ids = useSelection();
  return <span>{ids.length} selected</span>;
}
```

### `useSelectionStyle`

Returns `[style, applyStyle]` — the shared style of the current selection and a stable callback to apply a style patch to it.

- `style` is an `ElementStyle` (`{ color?, fillColor?, strokeWidth?, opacity?, fontSize? }`) containing only properties that are identical across all selected elements. Properties that differ are omitted. `style` is `null` when nothing is selected.
- `applyStyle(patch)` applies the patch to the current selection in a single undo step.

```tsx
import { useSelectionStyle } from '@fieldnotes/react';

function StyleToolbar() {
  const [style, applyStyle] = useSelectionStyle();

  return (
    <div>
      <input
        type="color"
        value={style?.color ?? '#000000'}
        disabled={!style}
        onChange={(e) => applyStyle({ color: e.target.value })}
      />
      <input
        type="range"
        min={1}
        max={20}
        value={style?.strokeWidth ?? 2}
        disabled={!style}
        onChange={(e) => applyStyle({ strokeWidth: Number(e.target.value) })}
      />
    </div>
  );
}
```

### `useSelectionOps`

Returns reactive selection state plus group/ungroup/lock/align/distribute actions for the core selection operations. Re-renders only when the selection (or its derived predicates) changes.

- State: `selectedIds`, `selectedCount`, `canGroup`, `canUngroup`, `canAlign`, `canDistribute`, and `isLocked` (`true`/`false` when the selection is uniformly locked/unlocked, `null` when empty or mixed).
- Actions: `group()`, `ungroup()`, `toggleLock()`, `align(edge)`, `distribute(axis)` — each runs in a single undo step. Requires core `>=0.36.0`.

```tsx
import { useSelectionOps } from '@fieldnotes/react';

function SelectionToolbar() {
  const {
    selectedCount,
    canGroup,
    canUngroup,
    isLocked,
    group,
    ungroup,
    toggleLock,
    align,
    distribute,
  } = useSelectionOps();

  return (
    <div>
      <button disabled={!canGroup} onClick={group}>
        Group
      </button>
      <button disabled={!canUngroup} onClick={ungroup}>
        Ungroup
      </button>
      <button disabled={selectedCount === 0} onClick={toggleLock}>
        {isLocked ? 'Unlock' : 'Lock'}
      </button>
      <button onClick={() => align('left')}>Align left</button>
      <button onClick={() => distribute('horizontal')}>Distribute</button>
    </div>
  );
}
```

See [core README](../core/README.md#styling-the-selection) for the full `ElementStyle` mapping table and the underlying `Viewport` methods.

## Save / Load

The mount-only `autoSave` prop saves the board to localStorage under `key` (or to an `adapter`) and restores it on the next mount ([Saving and loading](https://iraklidevelop.github.io/fieldnotes/docs/saving-and-loading/)):

```tsx
<FieldNotesCanvas autoSave={{ key: 'my-board' }} style={{ width: '100%', height: '100%' }} />
```

Use `useExport` and `useLoad` for manual export and loading:

```tsx
import { useExport, useLoad } from '@fieldnotes/react';

export function SaveControls() {
  const { exportJSON } = useExport();
  const loadState = useLoad();

  const save = () => {
    localStorage.setItem('fieldnotes-example', exportJSON());
  };
  const load = () => {
    const json = localStorage.getItem('fieldnotes-example');
    if (json) loadState(json);
  };

  return (
    <div>
      <button onClick={save}>Save</button>
      <button onClick={load}>Load</button>
    </div>
  );
}
```

## Minimap

Render `<Minimap>` inside `<FieldNotesCanvas>` and position it with `style` or `className`. `width` and `height` default to 200 and 140 CSS pixels, `background` and `viewportStroke` set its colours, and `defaultCollapsed` starts it folded. Leave `options.minimap` off when you render `<Minimap>`, or the board shows two.

```tsx
import { FieldNotesCanvas, Minimap } from '@fieldnotes/react';

<FieldNotesCanvas style={{ width: '100%', height: '100%' }}>
  <Minimap defaultCollapsed />
</FieldNotesCanvas>;
```

## Camera

`useCameraControls` returns `pan`, `moveTo`, `setZoom`, `zoomAt`, `centerAt`, `fitToContent`, `captureView` and `animateTo`. `useCanvasSize` returns the board's `w` and `h` in CSS pixels and re-renders on resize.

```tsx
import { useCameraControls, useCanvasSize } from '@fieldnotes/react';

function CameraControls() {
  const { fitToContent } = useCameraControls();
  const { w, h } = useCanvasSize();
  return (
    <button onClick={() => fitToContent()}>
      Fit {w} × {h}
    </button>
  );
}
```

## Shortcuts

Hoist shortcut bindings for the `shortcuts` prop, and use `useShortcuts` to read or change them.

```tsx
import { FieldNotesCanvas, useShortcuts } from '@fieldnotes/react';

const SHORTCUTS = { 'edit.undo': 'mod+u' };

function ShortcutControls() {
  const { bindings, reset } = useShortcuts();
  return <button onClick={() => reset('edit.undo')}>{bindings['edit.undo']?.join(', ')}</button>;
}

<FieldNotesCanvas shortcuts={SHORTCUTS}>
  <ShortcutControls />
</FieldNotesCanvas>;
```

## Presence

`usePresence(client, { identity })` draws other people's cursors and selections on the board and returns them as `peers`. Pass a `SyncClient` (any `PresenceChannel`) or `null`. Nothing is sent until you call `announce()`, so call it once the connection is live.

```tsx
import { useEffect } from 'react';
import { usePresence } from '@fieldnotes/react';
import type { SyncClient } from '@fieldnotes/sync';

function Presence({ client, live }: { client: SyncClient | null; live: boolean }) {
  const { peers, announce } = usePresence(client, { identity: { id: 'me' } });
  useEffect(() => {
    if (live) announce();
  }, [live, announce]);
  return <span>{peers.length} peers</span>;
}
```

## One element

`useElement` reads one element by id and returns `null` when it is absent.

```tsx
import { useElement } from '@fieldnotes/react';

function ElementName({ id }: { id: string }) {
  const element = useElement(id);
  return <span>{element?.id ?? 'Missing'}</span>;
}
```

## Transactions

`useTransaction` groups synchronous viewport mutations into one undo step.

```tsx
import { useTransaction, useViewport } from '@fieldnotes/react';

function GroupedEdit() {
  const transaction = useTransaction();
  const viewport = useViewport();
  return <button onClick={() => transaction(() => viewport.clear())}>Clear</button>;
}
```

## Custom Tools

Implement the `Tool` interface from `@fieldnotes/core` and register it via the `tools` prop. Hoist the array so instances are not recreated on every render:

```tsx
import type { Tool, ToolContext, PointerState } from '@fieldnotes/core';
import { createNote } from '@fieldnotes/core';

export class StampTool implements Tool {
  readonly name = 'stamp';

  onPointerDown(state: PointerState, ctx: ToolContext): void {
    const world = ctx.camera.screenToWorld({ x: state.x, y: state.y });
    ctx.store.add(
      createNote({
        position: { x: world.x - 50, y: world.y - 25 },
        size: { w: 100, h: 50 },
        text: 'stamp',
        layerId: ctx.activeLayerId ?? '',
      }),
    );
    ctx.requestRender();
  }

  onPointerMove(_state: PointerState, _ctx: ToolContext): void {}
  onPointerUp(_state: PointerState, _ctx: ToolContext): void {}
}
```

Register alongside the built-in tools:

```tsx
import { createDefaultTools } from '@fieldnotes/core';
import { StampTool } from './StampTool';

// Hoisted — stable reference across renders
const TOOLS = [...createDefaultTools(), new StampTool()];

function App() {
  const [tool, setTool] = useState('select');
  return (
    <FieldNotesCanvas tools={TOOLS} tool={tool} onToolChange={setTool} style={...}>
      <Toolbar tool={tool} onSelect={setTool} />
    </FieldNotesCanvas>
  );
}
```

## Events

### `onReady`

`onReady` runs once per viewport, synchronously, after `initialData` loads and before autosave loads a saved board. An array or `'default'` `tools` prop is registered by then; the default bundle for an omitted prop registers after it. In development, StrictMode mounts twice, so `onReady` runs for two viewports and the first is destroyed. Make setup safe to repeat, and put anything that needs cleanup in a child effect that calls `useViewport()`.

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  onReady={(viewport) => {
    const saved = localStorage.getItem('board');
    if (saved) viewport.loadJSON(saved);
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

### `onToolChange`

Fires whenever the active tool changes — from the keyboard, the API, or the controlled `tool` prop. Pair with `useState` and memoize with `useCallback` when the function body is non-trivial:

```tsx
const [tool, setTool] = useState('select');

<FieldNotesCanvas tool={tool} onToolChange={setTool} tools={TOOLS} style={...} />
```

### `options.onImageError`

Called when an image element fails to load. Receives `{ src: string; elementIds: string[] }` — the source URL and all element IDs that reference it:

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  options={{
    onImageError: ({ src, elementIds }) => {
      console.warn(`Image failed: ${src}`, elementIds);
    },
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

### `options.onDrop`

Fires for **every** drop event on the canvas surface. Providing this callback replaces the built-in image-drop handling entirely — if you want images to work, handle them yourself. Receives the original `DragEvent` and the world-space drop position:

```tsx
<FieldNotesCanvas
  tools={TOOLS}
  options={{
    onDrop: (event, worldPosition) => {
      const url = event.dataTransfer?.getData('text/uri-list');
      if (url) {
        // add your own image element at worldPosition
      }
    },
  }}
  style={{ width: '100%', height: '100%' }}
/>
```

## Escape Hatch

`useViewport()` returns the raw `Viewport` instance for anything not covered by the hooks above. A `ref` on `<FieldNotesCanvas>` gives the same access outside of child components. Its `viewport` is set before parent mount effects and reads `null` after unmount. `ref.autoSave` is the `AutoSave` instance from the `autoSave` prop, or `null` without one.

```tsx
import { useRef } from 'react';
import { FieldNotesCanvas, type FieldNotesCanvasRef } from '@fieldnotes/react';

function App() {
  const canvasRef = useRef<FieldNotesCanvasRef>(null);

  return (
    <>
      <FieldNotesCanvas ref={canvasRef} style={{ width: '100vw', height: '100vh' }} />
      <button onClick={() => canvasRef.current?.viewport?.fitToContent()}>Fit to content</button>
    </>
  );
}
```

See the [core README](../core/README.md) for the full `Viewport` API — `exportJSON`/`loadJSON`, `fitToContent`, `shortcuts.rebind`, `setSnapToGrid`, and more.

## Versioning

`@fieldnotes/core` and `@fieldnotes/react` are versioned independently. The react
package's `peerDependencies` declare the compatible core range. Pre-1.0, minor
versions may contain breaking changes. The core peer range is bounded at the next major rather than per-minor; if a core minor
ever breaks the wrapper, a coordinated react release raises the lower bound.

## License

MIT
